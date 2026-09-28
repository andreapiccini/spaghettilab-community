"""USB Serial/JTAG → localhost WebSocket bridge for browsers without Web Serial.

Safari (and Tauri-on-macOS WKWebView) cannot call navigator.serial. This
process opens Core USB ports with Protocol V1 stream framing and exposes the
same message-oriented WebSocket shape React Flow already uses
(WebSocketProtocolTransport: raw request envelopes in, kind-byte + envelope
out). Bind 127.0.0.1 only.

HTTP:
  GET /list          JSON {cores: [...]}  (CORS *, used by Safari via Vite)

WebSocket paths:
  /list              text JSON {cores: [...]} then close
  /core/<device_id>  binary Protocol V1 session
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

from tools.device import open_serial_without_reset, serial_ports
import cbor2

from tools.spaghetti_protocol import (
    CoreStatus,
    Operation,
    decode_get_status_response,
    decode_response,
    encode_request,
)

logger = logging.getLogger("spaghetti.usb_bridge")

KIND_RESPONSE = 0x00
KIND_EVENT = 0x01
KIND_REQUEST = 0x02
HEADER_SIZE = 5
ENVELOPE_MAX = 2048 + 64
DEFAULT_LISTEN = "127.0.0.1:8766"
IDENTIFY_TIMEOUT_S = 4.0
RESPONSE_WAIT_S = 8.0
# SpaghettiClient starts at 1; a colliding GET_STATUS with a different payload
# is CONFLICT for the whole replay window (~30 s on Core V1).
IDENTIFY_CORRELATION = 0x71C0FFEE
EMPTY_MAP_PAYLOAD = b"\xa0"


def _bridge_path(path: str) -> str:
    """Strip query string and optional Vite proxy prefix `/usb-bridge`."""
    path = path.split("?", 1)[0]
    if path.startswith("/usb-bridge"):
        path = path[len("/usb-bridge") :] or "/"
    return path


def encode_usb_frame(kind: int, envelope: bytes) -> bytes:
    if len(envelope) > ENVELOPE_MAX:
        raise ValueError("envelope too large")
    return bytes([kind]) + len(envelope).to_bytes(4, "big") + envelope


def pop_usb_frame(buffer: bytearray) -> tuple[int, bytes] | None:
    """Reassemble one response/event frame; skip leftover Shell bytes."""
    while len(buffer) >= 1:
        kind = buffer[0]
        if kind not in (KIND_RESPONSE, KIND_EVENT):
            del buffer[0]
            continue
        if len(buffer) < HEADER_SIZE:
            return None
        length = int.from_bytes(buffer[1:5], "big")
        if length > ENVELOPE_MAX:
            del buffer[0]
            continue
        if len(buffer) < HEADER_SIZE + length:
            return None
        envelope = bytes(buffer[HEADER_SIZE : HEADER_SIZE + length])
        del buffer[: HEADER_SIZE + length]
        return kind, envelope
    return None


@dataclass
class SlupPeer:
    device_id_hex: str
    device_name: str
    node_id: int
    mac: str
    role: str
    version: str = ""


@dataclass
class BoundCore:
    device_id_hex: str
    device_name: str
    version: str
    port: str
    connection: Any
    write_lock: threading.Lock
    slup_peers: tuple[SlupPeer, ...] = ()
    slup_peers_at: float = 0.0


_SLUP_PEER_LINE = re.compile(
    r"^\s*(\d+)\s+(master|peer)\s+0x([0-9a-fA-F]{1,6})\s+"
    r"([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})"
    r"(?:\s+(\S+))?\s*$",
    re.MULTILINE,
)
STATUS_PEERS_TIMEOUT_S = 2.5


def _drain_serial(connection: Any, settle_s: float = 0.15) -> None:
    """Drop leftover Shell/`slup list` bytes so they cannot look like Protocol frames."""
    try:
        if hasattr(connection, "reset_input_buffer"):
            connection.reset_input_buffer()
        deadline = time.monotonic() + settle_s
        while time.monotonic() < deadline:
            waiting = getattr(connection, "in_waiting", 0) or 0
            if waiting:
                connection.read(waiting)
                continue
            time.sleep(0.02)
            waiting = getattr(connection, "in_waiting", 0) or 0
            if not waiting:
                break
            connection.read(waiting)
    except Exception:  # noqa: BLE001
        pass


def mac_to_device_id_hex(mac: str) -> str:
    compact = "".join(ch for ch in mac.lower() if ch in "0123456789abcdef")
    return (compact + ("0" * 64))[:64]


def parse_slup_list(text: str) -> tuple[SlupPeer, ...]:
    peers: list[SlupPeer] = []
    seen: set[str] = set()
    for match in _SLUP_PEER_LINE.finditer(text):
        role = match.group(2).lower()
        node_id = int(match.group(3), 16) & 0xFFFFFF
        mac = match.group(4).lower()
        device_id = mac_to_device_id_hex(mac)
        if device_id in seen:
            continue
        seen.add(device_id)
        version = match.group(5) or ""
        if version == "-":
            version = ""
        peers.append(
            SlupPeer(
                device_id_hex=device_id,
                device_name="",
                node_id=node_id,
                mac=mac,
                role=role,
                version=version,
            )
        )
    return tuple(peers)


def _mac_device_id(mac: bytes) -> str:
    hex_id = mac.hex()
    return hex_id + ("0" * max(0, 64 - len(hex_id)))


def peers_from_status(status: CoreStatus, fallback_id: str) -> tuple[SlupPeer, ...]:
    peers: list[SlupPeer] = []
    for peer in status.chain_peers:
        mac = ":".join(f"{byte:02x}" for byte in peer.mac[:6]) if peer.mac else ""
        device_id = _mac_device_id(peer.mac) if peer.mac else fallback_id
        peers.append(
            SlupPeer(
                device_id_hex=device_id,
                device_name="",
                node_id=peer.node_id,
                mac=mac,
                role="master" if peer.local else "peer",
                version=peer.version,
            )
        )
    return tuple(peers)


def _apply_status(core: BoundCore, status: CoreStatus) -> None:
    if status.device_id:
        core.device_id_hex = status.device_id.hex()
    if status.device_name is not None:
        core.device_name = status.device_name
    if status.version:
        core.version = status.version
    core.slup_peers = peers_from_status(status, core.device_id_hex)
    core.slup_peers_at = time.monotonic()


def _get_status_sync(core: BoundCore) -> CoreStatus | None:
    """Read one live status from an idle USB root."""
    conn = core.connection
    buffer = bytearray()
    try:
        with core.write_lock:
            if hasattr(conn, "reset_input_buffer"):
                conn.reset_input_buffer()
            envelope = encode_request(
                IDENTIFY_CORRELATION, Operation.GET_STATUS, EMPTY_MAP_PAYLOAD
            )
            conn.write(encode_usb_frame(KIND_REQUEST, envelope))
            conn.flush()
            deadline = time.monotonic() + STATUS_PEERS_TIMEOUT_S
            while time.monotonic() < deadline:
                waiting = getattr(conn, "in_waiting", 0) or 0
                chunk = conn.read(waiting if waiting else 1)
                if not chunk:
                    time.sleep(0.01)
                    continue
                buffer.extend(chunk)
                while True:
                    parsed = pop_usb_frame(buffer)
                    if parsed is None:
                        break
                    kind, body = parsed
                    if kind != KIND_RESPONSE:
                        continue
                    _corr, name, _code, payload = decode_response(body)
                    if name != "ok":
                        return None
                    return decode_get_status_response(payload)
    except Exception as exc:  # noqa: BLE001
        logger.debug("GET_STATUS failed port=%s: %s", core.port, exc)
    return None


def _status_peers_sync(core: BoundCore) -> tuple[SlupPeer, ...]:
    """Read live chainPeers from GET_STATUS without leaving Protocol mode."""
    status = _get_status_sync(core)
    if status is not None:
        _apply_status(core, status)
    return core.slup_peers


def _close_quiet(connection: Any) -> None:
    try:
        connection.close()
    except Exception:  # noqa: BLE001
        pass


def _identify_sync(port: str) -> BoundCore | None:
    try:
        import serial as serial_mod
    except ImportError:
        logger.error("pyserial missing; run make host-tools")
        return None

    try:
        conn = open_serial_without_reset(serial_mod, port, 115200)
    except Exception as exc:  # noqa: BLE001
        logger.debug("skip %s: %s", port, exc)
        return None

    buffer = bytearray()
    try:
        conn.reset_input_buffer()
        envelope = encode_request(
            IDENTIFY_CORRELATION, Operation.GET_STATUS, EMPTY_MAP_PAYLOAD
        )
        conn.write(encode_usb_frame(KIND_REQUEST, envelope))
        conn.flush()
        deadline = time.monotonic() + IDENTIFY_TIMEOUT_S
        while time.monotonic() < deadline:
            waiting = conn.in_waiting
            chunk = conn.read(waiting if waiting else 1)
            if chunk:
                buffer.extend(chunk)
            while True:
                parsed = pop_usb_frame(buffer)
                if parsed is None:
                    break
                kind, body = parsed
                if kind != KIND_RESPONSE:
                    continue
                _corr, name, _code, payload = decode_response(body)
                if name != "ok":
                    _close_quiet(conn)
                    return None
                status = decode_get_status_response(payload)
                if status.device_id:
                    device_id = status.device_id.hex()
                else:
                    device_id = f"usb-{port.rsplit('/', 1)[-1]}"
                core = BoundCore(
                    device_id_hex=device_id,
                    device_name=status.device_name or "",
                    version=status.version,
                    port=port,
                    connection=conn,
                    write_lock=threading.Lock(),
                )
                _apply_status(core, status)
                return core
        _close_quiet(conn)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.debug("identify failed on %s: %s", port, exc)
        _close_quiet(conn)
        return None


class UsbBridge:
    def __init__(self) -> None:
        self.cores: dict[str, BoundCore] = {}
        self._busy: set[str] = set()
        self._lock = threading.Lock()
        self._scan_lock = threading.Lock()
        self._session_ws: dict[str, Any] = {}

    def refresh(self) -> list[BoundCore]:
        with self._scan_lock:
            return self._refresh_locked()

    def _refresh_locked(self) -> list[BoundCore]:
        present = set(serial_ports())
        with self._lock:
            stale = [
                device_id
                for device_id, core in self.cores.items()
                if core.port not in present and device_id not in self._busy
            ]
            for device_id in stale:
                _close_quiet(self.cores[device_id].connection)
                del self.cores[device_id]

            # A macOS USB serial path is commonly reused when boards are
            # swapped. Revalidate every idle root instead of treating the
            # path as a permanent device identity.
            idle = [
                (device_id, core)
                for device_id, core in self.cores.items()
                if device_id not in self._busy and core.port in present
            ]

        for old_device_id, core in idle:
            status = _get_status_sync(core)
            if status is None:
                _close_quiet(core.connection)
                with self._lock:
                    if self.cores.get(old_device_id) is core:
                        del self.cores[old_device_id]
                continue

            _apply_status(core, status)
            if core.device_id_hex == old_device_id:
                continue
            with self._lock:
                if self.cores.get(old_device_id) is core:
                    del self.cores[old_device_id]
                replaced = self.cores.get(core.device_id_hex)
                if replaced is not None and replaced is not core:
                    _close_quiet(replaced.connection)
                self.cores[core.device_id_hex] = core
            logger.info(
                "core on %s changed identity %s -> %s",
                core.port,
                old_device_id[:12],
                core.device_id_hex[:12],
            )

        with self._lock:
            known_ports = {core.port for core in self.cores.values()}

        for path in present:
            if path in known_ports:
                continue
            core = _identify_sync(path)
            if core is None:
                continue
            with self._lock:
                previous = self.cores.get(core.device_id_hex)
                if previous is not None and previous.port != core.port:
                    if core.device_id_hex not in self._busy:
                        _close_quiet(previous.connection)
                self.cores[core.device_id_hex] = core
                known_ports.add(path)
            logger.info(
                "core %s name=%s port=%s",
                core.device_id_hex[:12],
                core.device_name or "-",
                path,
            )
        with self._lock:
            return list(self.cores.values())

    def cores_document(self) -> dict[str, Any]:
        cores = self.refresh()
        document: list[dict[str, Any]] = []
        for core in cores:
            busy = False
            with self._lock:
                busy = core.device_id_hex in self._busy
            # While a Flow session owns the port we cannot refresh GET_STATUS.
            # Serving the last cached peers makes unplugged slaves linger in the
            # Connetti picker — omit them until the port is free again.
            peers = () if busy else core.slup_peers
            document.append(
                {
                    "deviceIdHex": core.device_id_hex,
                    "deviceName": core.device_name,
                    "version": core.version,
                    "port": core.port,
                    "peers": [
                        {
                            "deviceIdHex": peer.device_id_hex,
                            "deviceName": peer.device_name,
                            "nodeId": peer.node_id,
                            "mac": peer.mac,
                            "role": peer.role,
                            "version": peer.version,
                        }
                        for peer in peers
                        if peer.role != "master"
                        and peer.device_id_hex != core.device_id_hex
                    ],
                }
            )
        return {"cores": document}

    def get(self, device_id_hex: str) -> BoundCore | None:
        with self._lock:
            return self.cores.get(device_id_hex)

    def resolve(self, device_id_hex: str) -> tuple[str, BoundCore] | None:
        """Resolve an exact root, or the sole live USB root after a board swap."""
        with self._lock:
            core = self.cores.get(device_id_hex)
            if core is not None:
                return device_id_hex, core
            if len(self.cores) == 1:
                actual_id, actual_core = next(iter(self.cores.items()))
                return actual_id, actual_core
            return None

    def try_acquire(self, device_id_hex: str) -> BoundCore | None:
        with self._lock:
            core = self.cores.get(device_id_hex)
            if core is None or device_id_hex in self._busy:
                return None
            self._busy.add(device_id_hex)
            return core

    def release(self, device_id_hex: str) -> None:
        with self._lock:
            self._busy.discard(device_id_hex)

    def attach_session(self, device_id_hex: str, websocket: Any) -> None:
        with self._lock:
            self._session_ws[device_id_hex] = websocket

    def take_session(self, device_id_hex: str) -> Any:
        with self._lock:
            return self._session_ws.pop(device_id_hex, None)


def _read_serial_chunks(
    connection: Any,
    port: str,
    stop: threading.Event,
    queue: asyncio.Queue[bytes],
    loop: asyncio.AbstractEventLoop,
) -> None:
    last_presence_check = 0.0

    def publish(chunk: bytes) -> bool:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, chunk)
            return True
        except RuntimeError:
            return False

    try:
        while not stop.is_set():
            waiting = connection.in_waiting
            chunk = connection.read(waiting if waiting else 1)
            if chunk:
                if not publish(bytes(chunk)):
                    return
                continue
            now = time.monotonic()
            if now - last_presence_check < 0.5:
                continue
            last_presence_check = now
            if port not in set(serial_ports()):
                publish(b"")
                return
    except Exception:  # noqa: BLE001
        publish(b"")


async def _pipe_core(websocket: Any, core: BoundCore) -> None:
    await asyncio.to_thread(_drain_serial, core.connection, 0.2)
    stop = threading.Event()
    incoming: asyncio.Queue[bytes] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    reader = threading.Thread(
        target=_read_serial_chunks,
        args=(core.connection, core.port, stop, incoming, loop),
        daemon=True,
    )
    reader.start()
    buffer = bytearray()
    idle = asyncio.Event()
    idle.set()

    async def pump_serial() -> None:
        while True:
            chunk = await incoming.get()
            if not chunk:
                await websocket.close(1011, "serial disconnected")
                return
            buffer.extend(chunk)
            while True:
                parsed = pop_usb_frame(buffer)
                if parsed is None:
                    break
                kind, envelope = parsed
                if kind == KIND_RESPONSE:
                    idle.set()
                    try:
                        _corr, name, _code, payload = decode_response(envelope)
                        if name == "ok":
                            document = cbor2.loads(payload)
                            if (
                                isinstance(document, dict)
                                and 5 in document
                                and 8 in document
                                and 9 in document
                            ):
                                _apply_status(core, decode_get_status_response(payload))
                    except Exception:  # noqa: BLE001
                        pass
                await websocket.send(bytes([kind]) + envelope)

    serial_task = asyncio.create_task(pump_serial())
    try:
        async for message in websocket:
            if not isinstance(message, (bytes, bytearray)):
                continue
            payload = bytes(message)

            def write() -> None:
                with core.write_lock:
                    core.connection.write(encode_usb_frame(KIND_REQUEST, payload))
                    core.connection.flush()

            try:
                await asyncio.wait_for(idle.wait(), timeout=RESPONSE_WAIT_S)
            except TimeoutError:
                logger.warning("usb in-flight wait timed out port=%s", core.port)
            idle.clear()
            try:
                await asyncio.to_thread(write)
            except Exception:
                idle.set()
                logger.exception("usb write failed port=%s", core.port)
                break
    finally:
        stop.set()
        serial_task.cancel()
        try:
            await serial_task
        except asyncio.CancelledError:
            pass
        await asyncio.to_thread(reader.join, 1.0)


def make_handler(bridge: UsbBridge):
    async def handler(websocket: Any, path: str | None = None) -> None:
        from websockets.exceptions import ConnectionClosed

        if path is None:
            request = getattr(websocket, "request", None)
            path = request.path if request is not None else "/"
        path = _bridge_path(path)
        try:
            if path in ("/", "/list"):
                document = await asyncio.to_thread(bridge.cores_document)
                await websocket.send(json.dumps(document))
                return
            if path.startswith("/core/"):
                requested_id = path[len("/core/") :].lower()
                resolved = bridge.resolve(requested_id)
                if resolved is None:
                    await asyncio.to_thread(bridge.refresh)
                    resolved = bridge.resolve(requested_id)
                if resolved is None:
                    await websocket.close(4404, "unknown core")
                    return
                device_id, core = resolved
                if device_id != requested_id:
                    logger.info(
                        "routing replaced USB root %s -> %s",
                        requested_id[:12],
                        device_id[:12],
                    )
                previous = bridge.take_session(device_id)
                if previous is not None:
                    try:
                        await previous.close(4409, "replaced")
                    except Exception:  # noqa: BLE001
                        pass
                    for _ in range(40):
                        acquired = bridge.try_acquire(device_id)
                        if acquired is not None:
                            break
                        await asyncio.sleep(0.05)
                else:
                    acquired = bridge.try_acquire(device_id)
                if acquired is None:
                    bridge.release(device_id)
                    acquired = bridge.try_acquire(device_id)
                if acquired is None:
                    await websocket.close(4409, "core busy")
                    return
                bridge.attach_session(device_id, websocket)
                try:
                    await _pipe_core(websocket, acquired)
                except ConnectionClosed:
                    pass
                finally:
                    with bridge._lock:
                        if bridge._session_ws.get(device_id) is websocket:
                            bridge._session_ws.pop(device_id, None)
                    bridge.release(device_id)
                return
            await websocket.close(4404, "unknown path")
        except ConnectionClosed:
            pass

    return handler


def make_process_request(bridge: UsbBridge):
    """Serve GET /list as plain HTTP so Safari can fetch via the Vite proxy."""

    async def process_request(connection: Any, request: Any) -> Any:
        from websockets.datastructures import Headers
        from websockets.http11 import Response

        del connection
        upgrade = request.headers.get("Upgrade", "")
        if str(upgrade).lower() == "websocket":
            return None
        path = _bridge_path(getattr(request, "path", "/"))
        method = str(getattr(request, "method", "GET")).upper()
        cors = [
            ("Access-Control-Allow-Origin", "*"),
            ("Access-Control-Allow-Methods", "GET, OPTIONS"),
            ("Access-Control-Allow-Headers", "*"),
        ]
        if method == "OPTIONS":
            return Response(204, "No Content", Headers(cors))
        if path in ("/", "/list") and method == "GET":
            document = await asyncio.to_thread(bridge.cores_document)
            body = json.dumps(document).encode()
            return Response(
                200,
                "OK",
                Headers(
                    [
                        ("Content-Type", "application/json"),
                        ("Content-Length", str(len(body))),
                        ("Connection", "close"),
                        *cors,
                    ]
                ),
                body,
            )
        return None

    return process_request


async def run_server(listen: str) -> None:
    from websockets.asyncio.server import serve

    host, port_s = listen.rsplit(":", 1)
    port = int(port_s)
    bridge = UsbBridge()
    await asyncio.to_thread(bridge.refresh)
    async with serve(
        make_handler(bridge),
        host,
        port,
        max_size=4096,
        process_request=make_process_request(bridge),
    ):
        logger.info(
            "USB bridge on ws://%s:%s  (Safari: keep make monitor closed)",
            host,
            port,
        )
        await asyncio.Future()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="USB Protocol V1 bridge for Safari/React Flow"
    )
    parser.add_argument("--listen", default=DEFAULT_LISTEN, help="loopback host:port")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )
    try:
        asyncio.run(run_server(args.listen))
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
