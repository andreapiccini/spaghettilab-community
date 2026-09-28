"""In-process fake BLE Core + client transport (no radio)."""

from __future__ import annotations

import asyncio
import os
import struct
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from tools.spaghetti_gateway.auth import build_proof, parse_challenge, verify_proof
from tools.spaghetti_gateway.constants import (
    AUTH_CHALLENGE_SIZE,
    AUTH_CHALLENGE_TYPE,
    DEFAULT_FRAGMENT_MTU,
    DEVICE_ID_SIZE,
    KEY_SIZE,
    NONCE_SIZE,
)
from tools.spaghetti_gateway.envelope import decode_envelope, encode_event, encode_response
from tools.spaghetti_gateway.framing import Reassembly, fragment_envelope

OnBytes = Callable[[bytes], Awaitable[None] | None]
OnBootId = Callable[[int, int], Awaitable[None] | None]


@dataclass
class FakeAdvertisement:
    device_id: bytes
    name: str
    address: str


@dataclass
class FakeCoreState:
    device_id: bytes
    key: bytes
    credential_id: int = 1
    boot_id: int = 1
    lost_records: int = 0
    # Central replay cache only (principal+correlation → request bytes).
    replay: dict[int, bytes] = field(default_factory=dict)
    next_session_id: int = 1
    next_message_id: int = 1
    next_event_sequence: int = 1
    authenticated: bool = False
    disconnects: int = 0


class FakeBleRadio:
    """Shared radio registry used by scan/connect in tests."""

    def __init__(self) -> None:
        self._cores: dict[str, FakeCoreState] = {}

    def register(self, device_id: bytes, key: bytes) -> FakeCoreState:
        if len(device_id) != DEVICE_ID_SIZE or len(key) != KEY_SIZE:
            raise ValueError("device_id and key must be 32 bytes")
        hex_id = device_id.hex()
        state = FakeCoreState(device_id=device_id, key=key)
        self._cores[hex_id] = state
        return state

    def list_advertisements(self) -> list[FakeAdvertisement]:
        out: list[FakeAdvertisement] = []
        for hex_id, state in self._cores.items():
            out.append(
                FakeAdvertisement(
                    device_id=state.device_id,
                    name=f"Spaghetti-{hex_id[:8]}",
                    address=(
                        f"FA:KE:{hex_id[:2]}:{hex_id[2:4]}:"
                        f"{hex_id[4:6]}:{hex_id[6:8]}"
                    ),
                )
            )
        return out

    def get(self, device_id_hex: str) -> FakeCoreState:
        key = device_id_hex.lower()
        if key not in self._cores:
            raise KeyError(f"unknown device {device_id_hex}")
        return self._cores[key]

    async def connect(self, device_id_hex: str) -> "FakeBleLink":
        state = self.get(device_id_hex)
        link = FakeBleLink(state)
        await link.start_challenge()
        return link


class FakeBleLink:
    """One ATT connection to a FakeCoreState."""

    def __init__(self, state: FakeCoreState) -> None:
        self.state = state
        self._on_response_frame: Optional[OnBytes] = None
        self._on_event_bytes: Optional[OnBytes] = None
        self._connected = True
        self._session_id = 0
        self._nonce = b""
        self._request_reassembly = Reassembly()

    def set_handlers(
        self,
        *,
        on_response_frame: OnBytes | None = None,
        on_event_bytes: OnBytes | None = None,
    ) -> None:
        self._on_response_frame = on_response_frame
        self._on_event_bytes = on_event_bytes

    @property
    def connected(self) -> bool:
        return self._connected

    async def start_challenge(self) -> None:
        self.state.authenticated = False
        if self.state.next_session_id == 0:
            self.state.next_session_id = 1
        self._session_id = self.state.next_session_id
        self.state.next_session_id += 1
        self._nonce = os.urandom(NONCE_SIZE)
        challenge = (
            bytes([AUTH_CHALLENGE_TYPE])
            + struct.pack("<I", self._session_id)
            + self._nonce
        )
        await self._deliver_event_raw(challenge)

    async def disconnect(self) -> None:
        self._connected = False
        self.state.authenticated = False
        self.state.disconnects += 1
        self._request_reassembly.reset()

    async def write_request(self, data: bytes) -> None:
        if not self._connected:
            raise ConnectionError("not connected")
        if not self.state.authenticated:
            verify_proof(
                self.state.key,
                self._nonce,
                self.state.device_id,
                self._session_id,
                data,
            )
            self.state.authenticated = True
            await self.push_status_event()
            return

        complete = self._request_reassembly.feed(data)
        if complete is None:
            return
        await self._handle_envelope(complete)

    async def _handle_envelope(self, envelope_bytes: bytes) -> None:
        env = decode_envelope(envelope_bytes)
        correlation = env.correlation_id
        prior = self.state.replay.get(correlation)
        if prior is not None:
            if prior != envelope_bytes:
                response = encode_response(correlation, status=4)
            else:
                # Same bytes: central replay returns the prior effect.
                response = encode_response(
                    correlation, status=0, payload=b"replay"
                )
            await self._emit_framed_response(response)
            return

        self.state.replay[correlation] = envelope_bytes
        response = encode_response(
            correlation,
            status=0,
            payload=struct.pack("<I", env.operation) + self.state.device_id[:4],
        )
        await self._emit_framed_response(response)

    async def push_status_event(self) -> None:
        payload = struct.pack("<QQ", self.state.boot_id, self.state.lost_records)
        if self.state.next_event_sequence == 0:
            self.state.next_event_sequence = 1
        sequence = self.state.next_event_sequence
        self.state.next_event_sequence += 1
        event = encode_event(event_type=2, sequence=sequence, payload=payload)
        await self._emit_framed_event(event)

    async def bump_boot_id(self) -> None:
        self.state.boot_id += 1
        self.state.replay.clear()
        await self.push_status_event()

    async def _emit_framed_response(self, envelope: bytes) -> None:
        message_id = self._next_message_id()
        for frame in fragment_envelope(
            message_id, envelope, max_chunk=DEFAULT_FRAGMENT_MTU
        ):
            await self._deliver_response_frame(frame)

    async def _emit_framed_event(self, envelope: bytes) -> None:
        message_id = self._next_message_id()
        for frame in fragment_envelope(
            message_id, envelope, max_chunk=DEFAULT_FRAGMENT_MTU
        ):
            await self._deliver_event_raw(frame)

    def _next_message_id(self) -> int:
        if self.state.next_message_id == 0:
            self.state.next_message_id = 1
        message_id = self.state.next_message_id
        self.state.next_message_id += 1
        return message_id

    async def _deliver_response_frame(self, frame: bytes) -> None:
        if self._on_response_frame is None:
            return
        result = self._on_response_frame(frame)
        if asyncio.iscoroutine(result):
            await result

    async def _deliver_event_raw(self, data: bytes) -> None:
        if self._on_event_bytes is None:
            return
        result = self._on_event_bytes(data)
        if asyncio.iscoroutine(result):
            await result


class FakeBleClient:
    """Client transport that talks to FakeBleRadio (no bleak radio)."""

    def __init__(self, radio: FakeBleRadio) -> None:
        self.radio = radio
        self.link: FakeBleLink | None = None
        self.device_id: bytes | None = None
        self._key: bytes | None = None
        self._credential_id = 1
        self._next_message_id = 1
        self._pending_challenge: bytes | None = None
        self._authenticated = False
        self._response_reassembly = Reassembly()
        self._event_reassembly = Reassembly()
        self.on_response: Optional[OnBytes] = None
        self.on_event: Optional[OnBytes] = None
        self.on_boot_id: Optional[OnBootId] = None
        self.last_boot_id: int | None = None
        self.lost_records: int = 0

    @property
    def authenticated(self) -> bool:
        return self._authenticated

    async def scan(self) -> list[FakeAdvertisement]:
        return self.radio.list_advertisements()

    async def connect(
        self,
        device_id_hex: str,
        key: bytes,
        *,
        credential_id: int = 1,
    ) -> None:
        self._key = key
        self._credential_id = credential_id
        self.device_id = bytes.fromhex(device_id_hex)
        self._response_reassembly.reset()
        self._event_reassembly.reset()
        self._pending_challenge = None
        self._authenticated = False
        self.link = await self.radio.connect(device_id_hex)
        self.link.set_handlers(
            on_response_frame=self._on_response_frame,
            on_event_bytes=self._on_event_bytes,
        )
        # Challenge was delivered during connect before handlers were set.
        # Re-issue challenge now that handlers exist.
        await self.link.start_challenge()
        if self._pending_challenge is None:
            raise ConnectionError("missing auth challenge")
        session_id, nonce = parse_challenge(self._pending_challenge)
        assert self.device_id is not None
        proof = build_proof(
            key, nonce, self.device_id, session_id, credential_id
        )
        await self.link.write_request(proof)
        self._authenticated = True
        self._pending_challenge = None

    async def disconnect(self) -> None:
        if self.link is not None:
            await self.link.disconnect()
        self._authenticated = False

    async def send_envelope(self, envelope: bytes) -> None:
        if self.link is None or not self._authenticated:
            raise ConnectionError("not authenticated")
        if self._next_message_id == 0:
            self._next_message_id = 1
        message_id = self._next_message_id
        self._next_message_id += 1
        for frame in fragment_envelope(
            message_id, envelope, max_chunk=DEFAULT_FRAGMENT_MTU
        ):
            await self.link.write_request(frame)

    async def _on_response_frame(self, frame: bytes) -> None:
        complete = self._response_reassembly.feed(frame)
        if complete is None or self.on_response is None:
            return
        result = self.on_response(complete)
        if asyncio.iscoroutine(result):
            await result

    async def _on_event_bytes(self, data: bytes) -> None:
        # Challenge is a fixed-size raw notify, not an 8-byte framed envelope.
        # Message_id 1 also starts with 0x01 — do not confuse the two.
        if len(data) == AUTH_CHALLENGE_SIZE and data[0] == AUTH_CHALLENGE_TYPE:
            self._pending_challenge = data
            return
        # Framed Protocol events (or incomplete fragments).
        try:
            complete = self._event_reassembly.feed(data)
        except ValueError:
            # Not a frame — ignore.
            return
        if complete is None:
            return
        await self._handle_event_envelope(complete)

    async def _handle_event_envelope(self, data: bytes) -> None:
        try:
            env = decode_envelope(data)
        except ValueError:
            env = None
        if env is not None and env.event_type == 2 and len(env.payload) >= 16:
            boot_id, lost = struct.unpack_from("<QQ", env.payload, 0)
            previous = self.last_boot_id
            self.last_boot_id = boot_id
            self.lost_records = lost
            if previous is not None and previous != boot_id and self.on_boot_id:
                result = self.on_boot_id(previous, boot_id)
                if asyncio.iscoroutine(result):
                    await result
        if self.on_event is not None:
            result = self.on_event(data)
            if asyncio.iscoroutine(result):
                await result
