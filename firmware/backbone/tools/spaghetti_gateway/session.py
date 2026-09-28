"""Per-Core BLE session: owns connection, retry, boot_id, no effect cache."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from tools.spaghetti_gateway.constants import (
    RECONNECT_BACKOFF_FACTOR,
    RECONNECT_BACKOFF_INITIAL_S,
    RECONNECT_BACKOFF_MAX_S,
)
from tools.spaghetti_gateway.envelope import correlation_of, decode_envelope
from tools.spaghetti_gateway.fake_ble import FakeBleClient, FakeBleRadio

logger = logging.getLogger(__name__)

OnEnvelope = Callable[[bytes], Awaitable[None] | None]
OnBootIdChange = Callable[[str, int, int], Awaitable[None] | None]


@dataclass
class PendingRequest:
    """In-flight request bytes preserved across reconnect (no second cache)."""

    correlation_id: int
    envelope: bytes
    created_at: float = field(default_factory=time.monotonic)


@dataclass
class CoreSessionStats:
    reconnects: int = 0
    boot_id_changes: int = 0
    lost_records: int = 0
    last_boot_id: int | None = None


class CoreSession:
    """
    Owns one Core BLE link.

    Retry retransmits the exact same envelope bytes. The Core replay cache
    decides duplicates. This session never stores response effects.
    """

    def __init__(
        self,
        device_id_hex: str,
        key: bytes,
        *,
        client: FakeBleClient,
        credential_id: int = 1,
        on_response: OnEnvelope | None = None,
        on_event: OnEnvelope | None = None,
        on_boot_id_change: OnBootIdChange | None = None,
    ) -> None:
        self.device_id_hex = device_id_hex.lower()
        self.key = key
        self.credential_id = credential_id
        self.client = client
        self.on_response = on_response
        self.on_event = on_event
        self.on_boot_id_change = on_boot_id_change
        self.pending: dict[int, PendingRequest] = {}
        self.stats = CoreSessionStats()
        self._lock = asyncio.Lock()
        self._connected = False
        # Host-side WS client identities — never escalate BLE principal.
        self.host_identities: set[str] = set()

    @property
    def connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        async with self._lock:
            self.client.on_response = self._handle_response
            self.client.on_event = self._handle_event
            self.client.on_boot_id = self._handle_boot_id
            await self.client.connect(
                self.device_id_hex,
                self.key,
                credential_id=self.credential_id,
            )
            self._connected = True
            # Status event during auth may have already stamped boot_id.
            if self.client.last_boot_id is not None:
                self.stats.last_boot_id = self.client.last_boot_id
            elif self.client.link is not None:
                self.stats.last_boot_id = self.client.link.state.boot_id
            self.stats.lost_records = self.client.lost_records

    async def disconnect(self) -> None:
        async with self._lock:
            await self.client.disconnect()
            self._connected = False

    async def send_envelope(self, envelope: bytes) -> None:
        """Forward V1 CBOR bytes; remember correlation for reconnect retry."""
        correlation = correlation_of(envelope)
        self.pending[correlation] = PendingRequest(
            correlation_id=correlation, envelope=envelope
        )
        if not self._connected:
            await self.connect()
        await self.client.send_envelope(envelope)

    async def reconnect_with_backoff(self) -> None:
        """Drop link, reconnect with exponential backoff, retry pending."""
        delay = RECONNECT_BACKOFF_INITIAL_S
        last_error: Exception | None = None
        await self.disconnect()
        for attempt in range(8):
            try:
                if attempt > 0:
                    await asyncio.sleep(delay)
                    delay = min(
                        delay * RECONNECT_BACKOFF_FACTOR,
                        RECONNECT_BACKOFF_MAX_S,
                    )
                await self.connect()
                self.stats.reconnects += 1
                for pending in list(self.pending.values()):
                    await self.client.send_envelope(pending.envelope)
                return
            except Exception as exc:  # noqa: BLE001 — bounded backoff loop
                last_error = exc
                logger.warning(
                    "reconnect failed for %s: %s", self.device_id_hex, exc
                )
        raise ConnectionError(
            f"reconnect exhausted for {self.device_id_hex}: {last_error}"
        )

    async def _handle_response(self, envelope: bytes) -> None:
        try:
            corr = correlation_of(envelope)
            self.pending.pop(corr, None)
        except ValueError:
            pass
        if self.on_response is not None:
            result = self.on_response(envelope)
            if asyncio.iscoroutine(result):
                await result

    async def _handle_event(self, envelope: bytes) -> None:
        if self.on_event is not None:
            result = self.on_event(envelope)
            if asyncio.iscoroutine(result):
                await result

    async def _handle_boot_id(self, previous: int, current: int) -> None:
        self.stats.boot_id_changes += 1
        self.stats.last_boot_id = current
        self.stats.lost_records = self.client.lost_records
        # Drop pending command retries across boot — caller must not auto-replay
        # command/reset/update; we clear pending so reconnect won't re-issue.
        self.pending.clear()
        if self.on_boot_id_change is not None:
            result = self.on_boot_id_change(
                self.device_id_hex, previous, current
            )
            if asyncio.iscoroutine(result):
                await result


class SessionManager:
    """Bounded set of CoreSession instances."""

    def __init__(
        self,
        radio: FakeBleRadio,
        key: bytes,
        *,
        max_cores: int,
        credential_id: int = 1,
    ) -> None:
        self.radio = radio
        self.key = key
        self.max_cores = max_cores
        self.credential_id = credential_id
        self.sessions: dict[str, CoreSession] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(
        self,
        device_id_hex: str,
        *,
        on_response: OnEnvelope | None = None,
        on_event: OnEnvelope | None = None,
        on_boot_id_change: OnBootIdChange | None = None,
    ) -> CoreSession:
        device_id_hex = device_id_hex.lower()
        async with self._lock:
            existing = self.sessions.get(device_id_hex)
            if existing is not None:
                return existing
            if len(self.sessions) >= self.max_cores:
                raise RuntimeError(
                    f"core limit reached ({self.max_cores}); disconnect one first"
                )
            client = FakeBleClient(self.radio)
            session = CoreSession(
                device_id_hex,
                self.key,
                client=client,
                credential_id=self.credential_id,
                on_response=on_response,
                on_event=on_event,
                on_boot_id_change=on_boot_id_change,
            )
            self.sessions[device_id_hex] = session
            return session

    async def drop(self, device_id_hex: str) -> None:
        device_id_hex = device_id_hex.lower()
        async with self._lock:
            session = self.sessions.pop(device_id_hex, None)
        if session is not None:
            await session.disconnect()
