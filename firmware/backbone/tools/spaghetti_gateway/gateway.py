"""Local authenticated WebSocket loopback: binary messages = V1 CBOR envelopes."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from tools.spaghetti_gateway.constants import (
    DEFAULT_WS_LISTEN,
    ENV_MAX_CORES,
    ENV_WS_TOKEN,
    MAX_CORES_DEFAULT,
)
from tools.spaghetti_gateway.envelope import decode_envelope
from tools.spaghetti_gateway.fake_ble import FakeBleRadio
from tools.spaghetti_gateway.mqtt_bridge import MqttBridge, MqttPublisher
from tools.spaghetti_gateway.session import SessionManager

logger = logging.getLogger(__name__)


@dataclass
class GatewayConfig:
    listen: str = DEFAULT_WS_LISTEN
    ws_token: str = "local-dev-token"
    max_cores: int = MAX_CORES_DEFAULT
    credential_id: int = 1
    mqtt_publisher: MqttPublisher | None = None
    mqtt_base: str = "spaghetti"
    mqtt_client_id: str = "ble-gateway"


@dataclass
class HostClient:
    """WebSocket client identity — never escalates BLE principal permissions."""

    identity: str
    websocket: ServerConnection
    device_id_hex: str | None = None


@dataclass
class Gateway:
    radio: FakeBleRadio
    key: bytes
    config: GatewayConfig
    sessions: SessionManager = field(init=False)
    clients: dict[str, HostClient] = field(default_factory=dict)
    boot_id_signals: list[tuple[str, int, int]] = field(default_factory=list)
    _server: Any = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.sessions = SessionManager(
            self.radio,
            self.key,
            max_cores=self.config.max_cores,
            credential_id=self.config.credential_id,
        )

    @property
    def host(self) -> str:
        return self.config.listen.rsplit(":", 1)[0]

    @property
    def port(self) -> int:
        return int(self.config.listen.rsplit(":", 1)[1])

    def _check_token(self, websocket: ServerConnection) -> bool:
        expected = self.config.ws_token
        if not expected:
            return False
        path = websocket.request.path if websocket.request else "/"
        query = parse_qs(urlparse(path).query)
        token = (query.get("token") or [None])[0]
        if token is None:
            headers = websocket.request.headers if websocket.request else {}
            auth = headers.get("Authorization", "")
            if auth.lower().startswith("bearer "):
                token = auth[7:].strip()
        return token == expected

    async def _broadcast_to_device(
        self, device_id_hex: str, envelope: bytes
    ) -> None:
        dead: list[str] = []
        for identity, client in self.clients.items():
            if client.device_id_hex != device_id_hex:
                continue
            try:
                await client.websocket.send(envelope)
            except ConnectionClosed:
                dead.append(identity)
        for identity in dead:
            self.clients.pop(identity, None)

    async def _on_boot_id(
        self, device_id_hex: str, previous: int, current: int
    ) -> None:
        self.boot_id_signals.append((device_id_hex, previous, current))
        notice = json.dumps(
            {
                "type": "boot_id_changed",
                "device_id": device_id_hex,
                "previous": previous,
                "current": current,
            }
        ).encode("utf-8")
        # Text control plane for discontinuity; binary remains V1 envelopes.
        dead: list[str] = []
        for identity, client in self.clients.items():
            if client.device_id_hex != device_id_hex:
                continue
            try:
                await client.websocket.send(notice.decode("utf-8"))
            except ConnectionClosed:
                dead.append(identity)
        for identity in dead:
            self.clients.pop(identity, None)

    async def _ensure_session(self, device_id_hex: str):
        bridge: MqttBridge | None = None
        if self.config.mqtt_publisher is not None:
            bridge = MqttBridge(
                self.config.mqtt_publisher,
                device_id_hex,
                base_topic=self.config.mqtt_base,
                client_id=self.config.mqtt_client_id,
            )

        async def on_response(envelope: bytes) -> None:
            if bridge is not None:
                bridge.publish_response(envelope)
            await self._broadcast_to_device(device_id_hex, envelope)

        async def on_event(envelope: bytes) -> None:
            if bridge is not None:
                bridge.publish_event(envelope)
            await self._broadcast_to_device(device_id_hex, envelope)

        session = await self.sessions.get_or_create(
            device_id_hex,
            on_response=on_response,
            on_event=on_event,
            on_boot_id_change=self._on_boot_id,
        )
        if not session.connected:
            await session.connect()
        return session

    async def handle_client(self, websocket: ServerConnection) -> None:
        if not self._check_token(websocket):
            await websocket.close(4401, "unauthorized")
            return

        identity = f"ws-{id(websocket):x}"
        client = HostClient(identity=identity, websocket=websocket)
        self.clients[identity] = client
        logger.info("host client connected identity=%s", identity)

        try:
            async for message in websocket:
                if isinstance(message, str):
                    await self._handle_text(client, message)
                    continue
                if not isinstance(message, (bytes, bytearray)):
                    continue
                envelope = bytes(message)
                # Passthrough: must be a V1 envelope; no alternate API.
                decode_envelope(envelope)
                if client.device_id_hex is None:
                    await websocket.send(
                        json.dumps(
                            {"type": "error", "error": "select device first"}
                        )
                    )
                    continue
                session = await self._ensure_session(client.device_id_hex)
                session.host_identities.add(identity)
                if self.config.mqtt_publisher is not None:
                    MqttBridge(
                        self.config.mqtt_publisher,
                        client.device_id_hex,
                        base_topic=self.config.mqtt_base,
                        client_id=self.config.mqtt_client_id,
                    ).publish_request_mirror(envelope)
                await session.send_envelope(envelope)
        except ConnectionClosed:
            pass
        finally:
            self.clients.pop(identity, None)
            logger.info("host client disconnected identity=%s", identity)

    async def _handle_text(self, client: HostClient, message: str) -> None:
        try:
            document = json.loads(message)
        except json.JSONDecodeError:
            await client.websocket.send(
                json.dumps({"type": "error", "error": "invalid json"})
            )
            return
        msg_type = document.get("type")
        if msg_type == "select_device":
            device_id = str(document.get("device_id", "")).lower()
            if len(device_id) != 64:
                await client.websocket.send(
                    json.dumps(
                        {"type": "error", "error": "device_id must be 64 hex"}
                    )
                )
                return
            client.device_id_hex = device_id
            await client.websocket.send(
                json.dumps(
                    {
                        "type": "selected",
                        "device_id": device_id,
                        "host_identity": client.identity,
                        "note": (
                            "host identity does not escalate BLE principal"
                        ),
                    }
                )
            )
            session = await self._ensure_session(device_id)
            session.host_identities.add(client.identity)
            return
        if msg_type == "scan":
            ads = await FakeBleClientScan(self.radio).scan()
            await client.websocket.send(
                json.dumps(
                    {
                        "type": "scan_result",
                        "devices": [
                            {
                                "device_id": ad.device_id.hex(),
                                "name": ad.name,
                                "address": ad.address,
                            }
                            for ad in ads
                        ],
                    }
                )
            )
            return
        if msg_type == "ping":
            await client.websocket.send(json.dumps({"type": "pong"}))
            return
        await client.websocket.send(
            json.dumps({"type": "error", "error": f"unknown type {msg_type}"})
        )

    async def start(self) -> None:
        self._server = await serve(
            self.handle_client,
            self.host,
            self.port,
            max_size=4096,
        )
        logger.info("gateway listening on ws://%s:%s", self.host, self.port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        for device_id in list(self.sessions.sessions):
            await self.sessions.drop(device_id)

    async def serve_forever(self) -> None:
        await self.start()
        assert self._server is not None
        await self._server.wait_closed()


class FakeBleClientScan:
    def __init__(self, radio: FakeBleRadio) -> None:
        self.radio = radio

    async def scan(self):
        return self.radio.list_advertisements()


def parse_listen(value: str) -> tuple[str, int]:
    host, _, port_s = value.partition(":")
    if not host or not port_s:
        raise ValueError("listen must be host:port")
    return host, int(port_s)


def max_cores_from_env() -> int:
    raw = os.environ.get(ENV_MAX_CORES)
    if not raw:
        return MAX_CORES_DEFAULT
    return max(1, int(raw))


def ws_token_from_env() -> str:
    return os.environ.get(ENV_WS_TOKEN, "local-dev-token")
