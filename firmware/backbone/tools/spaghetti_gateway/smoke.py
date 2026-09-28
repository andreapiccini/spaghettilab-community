"""Fake BLE → gateway → WebSocket smoke (no radio, no Node-RED process).

Covers select_device, Protocol request/response, and MQTT bridge fan-out so the
BLE host path exercises the same envelope contract as MQTT smoke.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path

from websockets.asyncio.client import connect as ws_connect

from tools.spaghetti_gateway.constants import ENV_KEY_FILE, ENV_WS_TOKEN
from tools.spaghetti_gateway.envelope import (
    decode_envelope,
    encode_request,
)
from tools.spaghetti_gateway.fake_ble import FakeBleRadio
from tools.spaghetti_gateway.gateway import Gateway, GatewayConfig
from tools.spaghetti_gateway.mqtt_bridge import MemoryMqttPublisher


async def run_smoke() -> None:
    device_id = bytes.fromhex("11" * 32)
    key = bytes.fromhex("22" * 32)
    radio = FakeBleRadio()
    radio.register(device_id, key)

    with tempfile.TemporaryDirectory() as tmp:
        key_path = Path(tmp) / "ble.key"
        key_path.write_bytes(key)
        key_path.chmod(0o600)
        os.environ[ENV_KEY_FILE] = str(key_path)
        os.environ[ENV_WS_TOKEN] = "smoke-token"

        mqtt = MemoryMqttPublisher()
        gateway = Gateway(
            radio=radio,
            key=key,
            config=GatewayConfig(
                listen="127.0.0.1:18765",
                ws_token="smoke-token",
                max_cores=2,
                mqtt_publisher=mqtt,
            ),
        )
        await gateway.start()
        try:
            uri = "ws://127.0.0.1:18765/?token=smoke-token"
            async with ws_connect(uri) as ws:
                await ws.send(
                    json.dumps(
                        {
                            "type": "select_device",
                            "device_id": device_id.hex(),
                        }
                    )
                )
                selected = json.loads(await ws.recv())
                assert selected["type"] == "selected"

                for correlation_id, operation in ((7, 2), (8, 1)):
                    request = encode_request(
                        correlation_id=correlation_id, operation=operation
                    )
                    await ws.send(request)
                    response = None
                    for _ in range(10):
                        message = await ws.recv()
                        if isinstance(message, str):
                            continue
                        env = decode_envelope(bytes(message))
                        if env.correlation_id == correlation_id:
                            response = bytes(message)
                            break
                    assert response is not None
                    env = decode_envelope(response)
                    assert env.status == 0

                assert any(
                    topic.endswith("/responses/ble-gateway")
                    for topic, _payload, _qos, _retain in mqtt.messages
                )
        finally:
            await gateway.stop()

    print("node-red-ble-smoke: OK")


def main() -> int:
    asyncio.run(run_smoke())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
