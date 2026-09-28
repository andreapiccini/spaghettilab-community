"""Optional bleak-backed BLE client for real radios."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from tools.spaghetti_gateway.auth import build_proof, parse_challenge
from tools.spaghetti_gateway.constants import (
    AUTH_CHALLENGE_TYPE,
    DEFAULT_FRAGMENT_MTU,
    EVENT_UUID,
    REQUEST_UUID,
    RESPONSE_UUID,
    SERVICE_UUID,
)
from tools.spaghetti_gateway.framing import Reassembly, fragment_envelope

logger = logging.getLogger(__name__)


class BleakUnavailableError(RuntimeError):
    pass


def _require_bleak():
    try:
        from bleak import BleakClient, BleakScanner  # noqa: F401
    except ImportError as exc:
        raise BleakUnavailableError(
            "bleak is not installed; run make host-tools"
        ) from exc
    from bleak import BleakClient, BleakScanner

    return BleakClient, BleakScanner


async def bleak_scan(timeout: float = 5.0) -> list[dict[str, Any]]:
    _, BleakScanner = _require_bleak()
    devices = await BleakScanner.discover(timeout=timeout)
    results: list[dict[str, Any]] = []
    for device in devices:
        uuids = []
        if device.metadata:
            uuids = list(device.metadata.get("uuids") or [])
        results.append(
            {
                "address": device.address,
                "name": device.name,
                "uuids": uuids,
                "has_spaghetti": SERVICE_UUID.lower()
                in [u.lower() for u in uuids],
            }
        )
    return results


class BleakBleClient:
    """Minimal bleak transport: challenge, framing, envelope send/receive."""

    def __init__(self) -> None:
        self._client = None
        self._response_reassembly = Reassembly()
        self._event_reassembly = Reassembly()
        self._pending_challenge: bytes | None = None
        self._challenge_event = asyncio.Event()
        self._next_message_id = 1
        self.device_id: bytes | None = None
        self.on_response = None
        self.on_event = None

    async def connect(
        self,
        address: str,
        key: bytes,
        device_id: bytes,
        *,
        credential_id: int = 1,
    ) -> None:
        BleakClient, _ = _require_bleak()
        self.device_id = device_id
        self._client = BleakClient(address)
        await self._client.connect()
        await self._client.start_notify(RESPONSE_UUID, self._on_response_notify)
        await self._client.start_notify(EVENT_UUID, self._on_event_notify)
        try:
            await asyncio.wait_for(self._challenge_event.wait(), timeout=10.0)
        except asyncio.TimeoutError as exc:
            raise ConnectionError("BLE auth challenge timeout") from exc
        assert self._pending_challenge is not None
        session_id, nonce = parse_challenge(self._pending_challenge)
        proof = build_proof(key, nonce, device_id, session_id, credential_id)
        await self._client.write_gatt_char(REQUEST_UUID, proof, response=True)

    async def disconnect(self) -> None:
        if self._client is not None and self._client.is_connected:
            await self._client.disconnect()
        self._client = None

    async def send_envelope(self, envelope: bytes) -> None:
        if self._client is None or not self._client.is_connected:
            raise ConnectionError("not connected")
        if self._next_message_id == 0:
            self._next_message_id = 1
        message_id = self._next_message_id
        self._next_message_id += 1
        for frame in fragment_envelope(
            message_id, envelope, max_chunk=DEFAULT_FRAGMENT_MTU
        ):
            await self._client.write_gatt_char(
                REQUEST_UUID, frame, response=True
            )

    def _on_response_notify(self, _handle: int, data: bytearray) -> None:
        try:
            complete = self._response_reassembly.feed(bytes(data))
        except ValueError as exc:
            logger.warning("response frame rejected: %s", exc)
            return
        if complete is not None and self.on_response is not None:
            result = self.on_response(complete)
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)

    def _on_event_notify(self, _handle: int, data: bytearray) -> None:
        from tools.spaghetti_gateway.constants import AUTH_CHALLENGE_SIZE

        raw = bytes(data)
        if len(raw) == AUTH_CHALLENGE_SIZE and raw and raw[0] == AUTH_CHALLENGE_TYPE:
            self._pending_challenge = raw
            self._challenge_event.set()
            return
        try:
            complete = self._event_reassembly.feed(raw)
        except ValueError:
            return
        if complete is not None and self.on_event is not None:
            result = self.on_event(complete)
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)
