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
from tools.spaghetti_protocol import (
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
ENVELOPE_MAX = 512 + 64
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
SLUP_LIST_TIMEOUT_S = 2.5
SLUP_LIST_GIVE_UP_S = 0.4
SLUP_LIST_CACHE_S = 30.0


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


def _slup_list_sync(core: BoundCore) -> tuple[SlupPeer, ...]:
    """Leave Protocol mode briefly and run the existing `slup list` shell command."""
    now = time.monotonic()
    if core.slup_peers and (now - core.slup_peers_at) < SLUP_LIST_CACHE_S:
        return core.slup_peers

    conn = core.connection
    buffer = bytearray()
    try:
        with core.write_lock:
            conn.write(b"\x03")
            conn.flush()
            time.sleep(0.12)
            if hasattr(conn, "reset_input_buffer"):
                conn.reset_input_buffer()
            conn.write(b"slup list\r\n")
            conn.flush()
            deadline = time.monotonic() + SLUP_LIST_TIMEOUT_S
            started = time.monotonic()
            while time.monotonic() < deadline:
                waiting = getattr(conn, "in_waiting", 0) or 0
                chunk = conn.read(waiting if waiting else 1)
                if chunk:
                    buffer.extend(chunk)
                    text = bytes(buffer).decode("utf-8", errors="replace")
                    if "load/blink" in text or "SLUP list failed" in text:
                        break
                elif (time.monotonic() - started) > SLUP_LIST_GIVE_UP_S and not buffer:
                    break
    except Exception as exc:  # noqa: BLE001
        logger.debug("slup list failed port=%s: %s", core.port, exc)
        return core.slup_peers
    finally:
        _drain_serial(conn)

    peers = parse_slup_list(bytes(buffer).decode("utf-8", errors="replace"))
    if peers:
        core.slup_peers = peers
        core.slup_peers_at = time.monotonic()
        return peers
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
                return BoundCore(
                    device_id_hex=device_id,
                    device_name=status.device_name or "",
                    version=status.version,
                    port=port,
                    connection=conn,
                    write_lock=threading.Lock(),
                )
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
            peers = core.slup_peers if busy else _slup_list_sync(core)
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
    stop: threading.Event,
    queue: asyncio.Queue[bytes],
    loop: asyncio.AbstractEventLoop,
) -> None:
    try:
        while not stop.is_set():
            waiting = connection.in_waiting
            chunk = connection.read(waiting if waiting else 1)
            if chunk:
                loop.call_soon_threadsafe(queue.put_nowait, bytes(chunk))
    except Exception:  # noqa: BLE001
        loop.call_soon_threadsafe(queue.put_nowait, b"")


async def _pipe_core(websocket: Any, core: BoundCore) -> None:
    await asyncio.to_thread(_drain_serial, core.connection, 0.2)
    stop = threading.Event()
    incoming: asyncio.Queue[bytes] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    reader = threading.Thread(
        target=_read_serial_chunks,
        args=(core.connection, stop, incoming, loop),
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
                return
            buffer.extend(chunk)
            while True:
                parsed = pop_usb_frame(buffer)
                if parsed is None:
                    break
                kind, envelope = parsed
                if kind == KIND_RESPONSE:
                    idle.set()
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
                device_id = path[len("/core/") :].lower()
                core = bridge.get(device_id)
                if core is None:
                    await asyncio.to_thread(bridge.refresh)
                    core = bridge.get(device_id)
                if core is None:
                    await websocket.close(4404, "unknown core")
                    return
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
