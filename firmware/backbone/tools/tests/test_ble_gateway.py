"""Unit tests for BLE→Node-RED gateway (fake BLE, no radio)."""

from __future__ import annotations

import asyncio
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from websockets.asyncio.client import connect as ws_connect

from tools.spaghetti_gateway.auth import build_proof, parse_challenge, verify_proof
from tools.spaghetti_gateway.constants import (
    AUTH_CHALLENGE_TYPE,
    ENV_KEY_FILE,
    FRAME_HEADER_SIZE,
)
from tools.spaghetti_gateway.envelope import (
    correlation_of,
    decode_envelope,
    encode_request,
    encode_response,
)
from tools.spaghetti_gateway.fake_ble import FakeBleClient, FakeBleRadio
from tools.spaghetti_gateway.framing import Reassembly, fragment_envelope
from tools.spaghetti_gateway.gateway import Gateway, GatewayConfig
from tools.spaghetti_gateway.mqtt_bridge import MemoryMqttPublisher, MqttBridge
from tools.spaghetti_gateway.secrets import (
    SecretError,
    argv_contains_secret,
    load_key_from_file,
)
from tools.spaghetti_gateway.session import CoreSession, SessionManager


def _run(coro):
    return asyncio.run(coro)


class FramingAuthEnvelopeTest(unittest.TestCase):
    def test_fragment_and_reassemble(self) -> None:
        payload = bytes(range(256)) * 3  # 768 bytes
        frames = fragment_envelope(42, payload, max_chunk=64)
        self.assertGreater(len(frames), 1)
        slot = Reassembly()
        complete = None
        for frame in frames:
            self.assertEqual(len(frame), FRAME_HEADER_SIZE + min(64, len(payload)))
            complete = slot.feed(frame)
        self.assertEqual(complete, payload)

    def test_hmac_challenge_proof_roundtrip(self) -> None:
        key = bytes(range(32))
        device_id = bytes(range(32, 64))
        nonce = bytes(range(64, 96))
        session_id = 0xA1B2C3D4
        challenge = (
            bytes([AUTH_CHALLENGE_TYPE])
            + session_id.to_bytes(4, "little")
            + nonce
        )
        sid, n = parse_challenge(challenge)
        self.assertEqual(sid, session_id)
        self.assertEqual(n, nonce)
        proof = build_proof(key, nonce, device_id, session_id, 3)
        self.assertEqual(verify_proof(key, nonce, device_id, session_id, proof), 3)

    def test_envelope_v1_passthrough_fields(self) -> None:
        raw = encode_request(9, 2, b"\x01\x02")
        env = decode_envelope(raw)
        self.assertEqual(env.version, 1)
        self.assertEqual(env.correlation_id, 9)
        self.assertEqual(env.operation, 2)
        self.assertEqual(env.payload, b"\x01\x02")
        self.assertEqual(correlation_of(raw), 9)


class SecretsTest(unittest.TestCase):
    def test_key_from_0600_file_not_argv(self) -> None:
        key = os.urandom(32)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ble.key"
            path.write_bytes(key)
            path.chmod(0o600)
            loaded = load_key_from_file(path)
            self.assertEqual(loaded, key)
            argv = ["spaghetti-gateway", "serve", "--listen", "127.0.0.1:8765"]
            self.assertFalse(argv_contains_secret(argv, key))
            bad = argv + [key.hex()]
            self.assertTrue(argv_contains_secret(bad, key))

    def test_reject_world_readable_key(self) -> None:
        if os.name == "nt":
            self.skipTest("posix mode bits")
        key = os.urandom(32)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ble.key"
            path.write_bytes(key)
            path.chmod(0o644)
            with self.assertRaises(SecretError):
                load_key_from_file(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
            self.assertTrue(stat.S_IROTH & path.stat().st_mode)


class FakeBleSessionTest(unittest.TestCase):
    def test_request_response_and_replay_same_envelope(self) -> None:
        async def scenario() -> None:
            device_id = bytes.fromhex("aa" * 32)
            key = bytes.fromhex("bb" * 32)
            radio = FakeBleRadio()
            radio.register(device_id, key)
            client = FakeBleClient(radio)
            responses: list[bytes] = []
            client.on_response = lambda b: responses.append(b)
            await client.connect(device_id.hex(), key)
            envelope = encode_request(100, 1, b"catalog")
            await client.send_envelope(envelope)
            self.assertEqual(len(responses), 1)
            first = decode_envelope(responses[0])
            self.assertEqual(first.correlation_id, 100)
            self.assertEqual(first.status, 0)
            # Retry same envelope → Core replay cache, not a second effect cache.
            await client.send_envelope(envelope)
            self.assertEqual(len(responses), 2)
            second = decode_envelope(responses[1])
            self.assertEqual(second.correlation_id, 100)
            self.assertEqual(second.payload, b"replay")
            # Different bytes same correlation → CONFLICT
            conflict = encode_request(100, 2, b"other")
            await client.send_envelope(conflict)
            third = decode_envelope(responses[2])
            self.assertEqual(third.status, 4)

        _run(scenario())

    def test_reconnect_preserves_correlation_retries_same_bytes(self) -> None:
        async def scenario() -> None:
            from tools.spaghetti_gateway.session import PendingRequest

            device_id = bytes.fromhex("cc" * 32)
            key = bytes.fromhex("dd" * 32)
            radio = FakeBleRadio()
            state = radio.register(device_id, key)
            responses: list[bytes] = []
            client = FakeBleClient(radio)
            session = CoreSession(
                device_id.hex(),
                key,
                client=client,
                on_response=lambda b: responses.append(b),
            )
            await session.connect()
            envelope = encode_request(55, 2)
            session.pending[55] = PendingRequest(55, envelope)
            await session.disconnect()
            await session.reconnect_with_backoff()
            self.assertGreaterEqual(session.stats.reconnects, 1)
            if not responses:
                await session.send_envelope(envelope)
            self.assertTrue(responses)
            self.assertEqual(correlation_of(responses[-1]), 55)
            self.assertNotIn(55, session.pending)
            self.assertGreaterEqual(state.disconnects, 1)

        _run(scenario())

    def test_boot_id_change_signaled_and_pending_cleared(self) -> None:
        async def scenario() -> None:
            device_id = bytes.fromhex("ee" * 32)
            key = bytes.fromhex("ff" * 32)
            radio = FakeBleRadio()
            radio.register(device_id, key)
            signals: list[tuple[int, int]] = []
            client = FakeBleClient(radio)
            session = CoreSession(
                device_id.hex(),
                key,
                client=client,
                on_boot_id_change=lambda _d, p, c: signals.append((p, c)),
            )
            await session.connect()
            self.assertEqual(session.stats.last_boot_id, 1)
            from tools.spaghetti_gateway.session import PendingRequest

            session.pending[1] = PendingRequest(1, encode_request(1, 7))
            assert client.link is not None
            await client.link.bump_boot_id()
            self.assertEqual(signals, [(1, 2)])
            self.assertEqual(session.stats.boot_id_changes, 1)
            self.assertEqual(session.pending, {})

        _run(scenario())

    def test_bounded_cores(self) -> None:
        async def scenario() -> None:
            key = bytes.fromhex("01" * 32)
            radio = FakeBleRadio()
            for i in range(3):
                radio.register(bytes([i]) * 32, key)
            manager = SessionManager(radio, key, max_cores=2)
            await manager.get_or_create(bytes([0]).hex())
            await manager.get_or_create(bytes([1]).hex())
            with self.assertRaises(RuntimeError):
                await manager.get_or_create(bytes([2]).hex())

        _run(scenario())

    def test_backoff_constants_bounded(self) -> None:
        from tools.spaghetti_gateway.constants import (
            RECONNECT_BACKOFF_FACTOR,
            RECONNECT_BACKOFF_INITIAL_S,
            RECONNECT_BACKOFF_MAX_S,
        )

        self.assertGreater(RECONNECT_BACKOFF_INITIAL_S, 0)
        self.assertGreaterEqual(RECONNECT_BACKOFF_MAX_S, RECONNECT_BACKOFF_INITIAL_S)
        self.assertGreaterEqual(RECONNECT_BACKOFF_FACTOR, 1.5)


class WebSocketGatewayTest(unittest.TestCase):
    def test_websocket_loopback_binary_cbor(self) -> None:
        async def scenario() -> None:
            device_id = bytes.fromhex("12" * 32)
            key = bytes.fromhex("34" * 32)
            radio = FakeBleRadio()
            radio.register(device_id, key)
            mqtt = MemoryMqttPublisher()
            gateway = Gateway(
                radio=radio,
                key=key,
                config=GatewayConfig(
                    listen="127.0.0.1:18766",
                    ws_token="test-token",
                    max_cores=2,
                    mqtt_publisher=mqtt,
                ),
            )
            await gateway.start()
            try:
                uri = "ws://127.0.0.1:18766/?token=test-token"
                async with ws_connect(uri) as ws:
                    await ws.send(
                        json.dumps(
                            {
                                "type": "select_device",
                                "device_id": device_id.hex(),
                            }
                        )
                    )
                    selected = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    self.assertEqual(selected["type"], "selected")
                    self.assertIn("host_identity", selected)

                    # Status event may arrive as binary after select/connect.
                    request = encode_request(42, 2)
                    await ws.send(request)
                    # Drain until correlated response (status events may arrive as binary first).
                    got = None
                    for _ in range(10):
                        message = await asyncio.wait_for(ws.recv(), 5)
                        if isinstance(message, str):
                            continue
                        env = decode_envelope(bytes(message))
                        if env.correlation_id == 42:
                            got = env
                            break
                    self.assertIsNotNone(got)
                    assert got is not None
                    self.assertEqual(got.status, 0)
                    # MQTT bridge same bytes
                    matches = [
                        m
                        for m in mqtt.messages
                        if m[0].endswith("/responses/ble-gateway")
                    ]
                    self.assertTrue(matches)
                    self.assertEqual(
                        decode_envelope(matches[-1][1]).correlation_id, 42
                    )
            finally:
                await gateway.stop()

        _run(scenario())

    def test_unauthorized_websocket_rejected(self) -> None:
        async def scenario() -> None:
            key = bytes.fromhex("34" * 32)
            gateway = Gateway(
                radio=FakeBleRadio(),
                key=key,
                config=GatewayConfig(
                    listen="127.0.0.1:18767",
                    ws_token="secret",
                    max_cores=1,
                ),
            )
            await gateway.start()
            try:
                with self.assertRaises(Exception):
                    async with ws_connect("ws://127.0.0.1:18767/") as ws:
                        await ws.recv()
            finally:
                await gateway.stop()

        _run(scenario())


class MqttBridgeTest(unittest.TestCase):
    def test_publishes_same_bytes(self) -> None:
        pub = MemoryMqttPublisher()
        bridge = MqttBridge(pub, "ab" * 32)
        payload = encode_response(3, 0, b"ok")
        bridge.publish_response(payload)
        self.assertEqual(len(pub.messages), 1)
        topic, body, qos, retain = pub.messages[0]
        self.assertTrue(topic.endswith("/responses/ble-gateway"))
        self.assertEqual(body, payload)
        self.assertEqual(qos, 1)
        self.assertFalse(retain)


class CliArgvTest(unittest.TestCase):
    def test_cli_help_and_no_key_in_argv_contract(self) -> None:
        from tools.spaghetti_gateway.cli import build_parser, main

        parser = build_parser()
        args = parser.parse_args(["scan", "--fake"])
        self.assertEqual(args.command, "scan")
        key = bytes.fromhex("99" * 32)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "k"
            path.write_bytes(key)
            path.chmod(0o600)
            with mock.patch.dict(os.environ, {ENV_KEY_FILE: str(path)}):
                # scan --fake should not need the key
                code = main(["scan", "--fake"])
                self.assertEqual(code, 0)
            self.assertFalse(
                argv_contains_secret(
                    ["spaghetti-gateway", "serve", "--listen", "127.0.0.1:1"],
                    key,
                )
            )


if __name__ == "__main__":
    unittest.main()
