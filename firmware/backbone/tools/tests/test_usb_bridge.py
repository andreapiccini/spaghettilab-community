"""USB Serial/JTAG → WebSocket bridge: framing and loopback session."""

from __future__ import annotations

import asyncio
import json
import threading
import time
import unittest
from unittest import mock

from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.server import serve

from tools.spaghetti_protocol import (
    CoreStatus,
    Operation,
    decode_request,
    encode_get_status_response,
    encode_request,
    encode_response,
)
from tools.usb_bridge import (
    KIND_REQUEST,
    KIND_RESPONSE,
    BoundCore,
    SlupPeer,
    UsbBridge,
    _read_serial_chunks,
    _status_peers_sync,
    encode_usb_frame,
    make_handler,
    make_process_request,
    parse_slup_list,
    pop_usb_frame,
)


DEVICE_ID = bytes(range(32))
DEVICE_ID_HEX = DEVICE_ID.hex()


class SlupListParseTest(unittest.TestCase):
    def test_parses_master_and_peer(self) -> None:
        text = (
            "idx  role    node_id   mac                 version\r\n"
            "1  master  0xe1c52c  90:70:69:e1:c5:2c  0.1.0+0\r\n"
            "2  peer    0xe18030  90:70:69:e1:80:30  0.1.0+1\r\n"
            "load/blink with idx or 0xNODE  (1 is this master)\r\n"
        )
        peers = parse_slup_list(text)
        self.assertEqual(len(peers), 2)
        self.assertEqual(peers[0].role, "master")
        self.assertEqual(peers[0].node_id, 0xE1C52C)
        self.assertEqual(peers[0].device_id_hex, "907069e1c52c" + ("0" * 52))
        self.assertEqual(peers[0].version, "0.1.0+0")
        self.assertEqual(peers[1].role, "peer")
        self.assertEqual(peers[1].node_id, 0xE18030)
        self.assertEqual(peers[1].mac, "90:70:69:e1:80:30")
        self.assertEqual(peers[1].version, "0.1.0+1")

    def test_parses_list_without_version(self) -> None:
        peers = parse_slup_list("1  master  0xe1c52c  90:70:69:e1:c5:2c\r\n")
        self.assertEqual(len(peers), 1)
        self.assertEqual(peers[0].version, "")

    def test_status_without_remotes_clears_cached_slave(self) -> None:
        cached = (
            SlupPeer(
                device_id_hex="907069e18030" + ("0" * 52),
                device_name="",
                node_id=0xE18030,
                mac="90:70:69:e1:80:30",
                role="peer",
            ),
        )
        serial = FakeSerial()
        core = BoundCore(
            device_id_hex=DEVICE_ID_HEX,
            device_name="BridgeCore",
            version="test",
            port="/dev/cu.usbmodem-fake",
            connection=serial,
            write_lock=threading.Lock(),
            slup_peers=cached,
            slup_peers_at=0.0,
        )
        self.assertEqual(_status_peers_sync(core), ())


class FramingTest(unittest.TestCase):
    def test_roundtrip(self) -> None:
        envelope = encode_request(7, Operation.GET_STATUS, b"")
        frame = encode_usb_frame(KIND_RESPONSE, envelope)
        buffer = bytearray(frame)
        parsed = pop_usb_frame(buffer)
        self.assertEqual(parsed, (KIND_RESPONSE, envelope))
        self.assertEqual(buffer, b"")

    def test_skips_shell_junk(self) -> None:
        envelope = encode_request(3, Operation.GET_STATUS, b"")
        frame = encode_usb_frame(KIND_RESPONSE, envelope)
        buffer = bytearray(b"uart:~$ \r\n") + frame
        parsed = pop_usb_frame(buffer)
        self.assertEqual(parsed, (KIND_RESPONSE, envelope))

    def test_incomplete_waits(self) -> None:
        envelope = encode_request(3, Operation.GET_STATUS, b"")
        frame = encode_usb_frame(KIND_RESPONSE, envelope)
        buffer = bytearray(frame[:4])
        self.assertIsNone(pop_usb_frame(buffer))
        self.assertEqual(len(buffer), 4)
        buffer.extend(frame[4:])
        parsed = pop_usb_frame(buffer)
        self.assertEqual(parsed, (KIND_RESPONSE, envelope))

    def test_accepts_get_status_larger_than_old_576_limit(self) -> None:
        envelope = bytes([0xA0]) + (b"\x00" * 700)
        frame = encode_usb_frame(KIND_RESPONSE, envelope)
        self.assertGreater(len(envelope), 576)
        parsed = pop_usb_frame(bytearray(frame))
        self.assertEqual(parsed, (KIND_RESPONSE, envelope))

    def test_oversize_length_is_skipped(self) -> None:
        # High length byte is not a frame kind, so skip-1 resyncs on the real frame.
        bogus = bytes([KIND_RESPONSE, 0x80, 0x00, 0x00, 0x10])
        envelope = encode_request(1, Operation.GET_STATUS, b"")
        frame = encode_usb_frame(KIND_RESPONSE, envelope)
        buffer = bytearray(bogus + frame)
        parsed = pop_usb_frame(buffer)
        self.assertEqual(parsed, (KIND_RESPONSE, envelope))


class FakeSerial:
    def __init__(self) -> None:
        self._rx = bytearray()
        self._lock = threading.Lock()
        self.timeout = 0.05
        self.written = bytearray()

    @property
    def in_waiting(self) -> int:
        with self._lock:
            return len(self._rx)

    def write(self, data: bytes) -> int:
        self.written.extend(data)
        if len(data) < 5 or data[0] != KIND_REQUEST:
            return len(data)
        length = int.from_bytes(data[1:5], "big")
        envelope = data[5 : 5 + length]
        if len(envelope) != length:
            return len(data)
        corr, op, _payload = decode_request(envelope)
        if op != Operation.GET_STATUS:
            return len(data)
        status = CoreStatus(
            version="test",
            device_id=DEVICE_ID,
            device_name="BridgeCore",
        )
        reply = encode_response(corr, "ok", encode_get_status_response(status))
        framed = encode_usb_frame(KIND_RESPONSE, reply)
        with self._lock:
            self._rx.extend(framed)
        return len(data)

    def read(self, size: int) -> bytes:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            with self._lock:
                if self._rx:
                    chunk = bytes(self._rx[:size])
                    del self._rx[:size]
                    return chunk
            time.sleep(0.005)
        return b""

    def flush(self) -> None:
        return None

    def reset_input_buffer(self) -> None:
        with self._lock:
            self._rx.clear()

    def close(self) -> None:
        return None


def _run(coro):
    return asyncio.run(coro)


class BridgeSessionTest(unittest.TestCase):
    def test_missing_serial_port_ends_only_the_active_pipe(self) -> None:
        async def scenario() -> None:
            queue: asyncio.Queue[bytes] = asyncio.Queue()
            stop = threading.Event()
            loop = asyncio.get_running_loop()

            with mock.patch("tools.usb_bridge.serial_ports", return_value=[]):
                await asyncio.to_thread(
                    _read_serial_chunks,
                    FakeSerial(),
                    "/dev/cu.usbmodem-removed",
                    stop,
                    queue,
                    loop,
                )

            self.assertEqual(await asyncio.wait_for(queue.get(), timeout=1), b"")

        _run(scenario())

    def test_refresh_rekeys_a_replaced_board_on_the_same_usb_path(self) -> None:
        old_id = "ff" * 32
        serial = FakeSerial()
        bridge = UsbBridge()
        bridge.cores[old_id] = BoundCore(
            device_id_hex=old_id,
            device_name="Old",
            version="old",
            port="/dev/cu.usbmodem-fake",
            connection=serial,
            write_lock=threading.Lock(),
        )

        with mock.patch(
            "tools.usb_bridge.serial_ports",
            return_value=["/dev/cu.usbmodem-fake"],
        ):
            document = bridge.cores_document()

        self.assertIsNone(bridge.get(old_id))
        self.assertIsNotNone(bridge.get(DEVICE_ID_HEX))
        self.assertEqual(document["cores"][0]["deviceIdHex"], DEVICE_ID_HEX)
        self.assertEqual(document["cores"][0]["deviceName"], "BridgeCore")

    def test_resolve_old_identity_to_the_only_live_usb_root(self) -> None:
        bridge = UsbBridge()
        core = BoundCore(
            device_id_hex=DEVICE_ID_HEX,
            device_name="BridgeCore",
            version="test",
            port="/dev/cu.usbmodem-fake",
            connection=FakeSerial(),
            write_lock=threading.Lock(),
        )
        bridge.cores[DEVICE_ID_HEX] = core

        resolved = bridge.resolve("ff" * 32)

        self.assertEqual(resolved, (DEVICE_ID_HEX, core))

    def test_list_and_core_pipe(self) -> None:
        async def scenario() -> None:
            serial = FakeSerial()
            bridge = UsbBridge()
            bridge.cores[DEVICE_ID_HEX] = BoundCore(
                device_id_hex=DEVICE_ID_HEX,
                device_name="BridgeCore",
                version="test",
                port="/dev/cu.usbmodem-fake",
                connection=serial,
                write_lock=threading.Lock(),
            )
            async with serve(
                make_handler(bridge),
                "127.0.0.1",
                0,
                max_size=4096,
                process_request=make_process_request(bridge),
            ) as server:
                port = server.sockets[0].getsockname()[1]
                origin = f"ws://127.0.0.1:{port}"
                async with ws_connect(f"{origin}/list") as ws:
                    document = json.loads(await ws.recv())
                self.assertEqual(document["cores"][0]["deviceIdHex"], DEVICE_ID_HEX)
                self.assertEqual(document["cores"][0]["deviceName"], "BridgeCore")

                request = encode_request(9, Operation.GET_STATUS, b"")
                async with ws_connect(f"{origin}/core/{DEVICE_ID_HEX}") as ws:
                    await ws.send(request)
                    frame = await asyncio.wait_for(ws.recv(), timeout=2)
                self.assertIsInstance(frame, (bytes, bytearray))
                self.assertEqual(frame[0], KIND_RESPONSE)
                envelope = bytes(frame[1:])
                from tools.spaghetti_protocol import decode_response, decode_get_status_response

                _corr, name, _code, payload = decode_response(envelope)
                self.assertEqual(name, "ok")
                status = decode_get_status_response(payload)
                self.assertEqual(status.device_id, DEVICE_ID)
                self.assertEqual(status.device_name, "BridgeCore")

        with mock.patch(
            "tools.usb_bridge.serial_ports",
            return_value=["/dev/cu.usbmodem-fake"],
        ), mock.patch("tools.usb_bridge._status_peers_sync", return_value=()):
            _run(scenario())

    def test_http_list(self) -> None:
        async def scenario() -> None:
            import urllib.request

            serial = FakeSerial()
            bridge = UsbBridge()
            bridge.cores[DEVICE_ID_HEX] = BoundCore(
                device_id_hex=DEVICE_ID_HEX,
                device_name="BridgeCore",
                version="test",
                port="/dev/cu.usbmodem-fake",
                connection=serial,
                write_lock=threading.Lock(),
            )
            async with serve(
                make_handler(bridge),
                "127.0.0.1",
                0,
                max_size=4096,
                process_request=make_process_request(bridge),
            ) as server:
                port = server.sockets[0].getsockname()[1]

                def fetch() -> dict:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/list") as resp:
                        return json.loads(resp.read())

                document = await asyncio.to_thread(fetch)
                self.assertEqual(document["cores"][0]["deviceIdHex"], DEVICE_ID_HEX)

        with mock.patch(
            "tools.usb_bridge.serial_ports",
            return_value=["/dev/cu.usbmodem-fake"],
        ), mock.patch("tools.usb_bridge._status_peers_sync", return_value=()):
            _run(scenario())

    def test_busy_core_omits_cached_peers(self) -> None:
        bridge = UsbBridge()
        bridge.cores[DEVICE_ID_HEX] = BoundCore(
            device_id_hex=DEVICE_ID_HEX,
            device_name="BridgeCore",
            version="test",
            port="/dev/cu.usbmodem-fake",
            connection=FakeSerial(),
            write_lock=threading.Lock(),
            slup_peers=(
                SlupPeer(
                    device_id_hex="907069e18030" + ("0" * 52),
                    device_name="",
                    node_id=0xE18030,
                    mac="90:70:69:e1:80:30",
                    role="peer",
                    version="0.1.0+0",
                ),
            ),
        )
        bridge._busy.add(DEVICE_ID_HEX)

        with mock.patch(
            "tools.usb_bridge.serial_ports",
            return_value=["/dev/cu.usbmodem-fake"],
        ), mock.patch("tools.usb_bridge._status_peers_sync") as sync:
            document = bridge.cores_document()
            sync.assert_not_called()
            self.assertEqual(document["cores"][0]["peers"], [])


if __name__ == "__main__":
    unittest.main()
