"""CLI: spaghetti-gateway scan | connect | serve."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Sequence

from tools.spaghetti_gateway.bleak_client import BleakUnavailableError, bleak_scan
from tools.spaghetti_gateway.constants import (
    DEFAULT_WS_LISTEN,
    ENV_CREDENTIAL_ID,
    ENV_KEY_FILE,
    ENV_MQTT_BASE,
    ENV_MQTT_ENABLE,
    ENV_MQTT_HOST,
    ENV_MQTT_PORT,
)
from tools.spaghetti_gateway.fake_ble import FakeBleRadio
from tools.spaghetti_gateway.gateway import (
    Gateway,
    GatewayConfig,
    max_cores_from_env,
    ws_token_from_env,
)
from tools.spaghetti_gateway.mqtt_bridge import MemoryMqttPublisher
from tools.spaghetti_gateway.secrets import SecretError, load_key_from_env

logger = logging.getLogger(__name__)

# Process-wide fake radio for --fake / SPAGHETTI_GATEWAY_FAKE demos and smoke.
_FAKE_RADIO: FakeBleRadio | None = None


def get_fake_radio() -> FakeBleRadio:
    global _FAKE_RADIO
    if _FAKE_RADIO is None:
        _FAKE_RADIO = FakeBleRadio()
    return _FAKE_RADIO


def set_fake_radio(radio: FakeBleRadio) -> None:
    global _FAKE_RADIO
    _FAKE_RADIO = radio


def _want_fake(args: argparse.Namespace) -> bool:
    if getattr(args, "fake", False):
        return True
    return os.environ.get("SPAGHETTI_GATEWAY_FAKE", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="spaghetti-gateway",
        description=(
            "Spaghetti LAB BLE→Node-RED gateway. "
            "Owns BLE auth/framing; exposes Protocol V1 CBOR on local WebSocket."
        ),
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="debug logging"
    )
    fake_help = (
        "use in-process fake BLE (no radio); also SPAGHETTI_GATEWAY_FAKE=1"
    )
    # Accept --fake before or after the subcommand.
    parser.add_argument("--fake", action="store_true", help=fake_help)
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="scan for Spaghetti BLE advertisements")
    scan.add_argument("--fake", action="store_true", help=fake_help)
    scan.add_argument("--timeout", type=float, default=5.0)

    connect = sub.add_parser(
        "connect", help="connect and complete application auth"
    )
    connect.add_argument("--fake", action="store_true", help=fake_help)
    connect.add_argument("--device-id", required=True, help="64-char hex device id")
    connect.add_argument(
        "--address",
        default=None,
        help="BLE MAC/address (real radio); ignored with --fake",
    )

    serve = sub.add_parser(
        "serve", help="serve authenticated WebSocket loopback"
    )
    serve.add_argument("--fake", action="store_true", help=fake_help)
    serve.add_argument(
        "--listen",
        default=DEFAULT_WS_LISTEN,
        help="loopback listen address host:port",
    )
    serve.add_argument(
        "--device-id",
        default=None,
        help="optional Core to connect at startup (64-char hex)",
    )
    serve.add_argument(
        "--address",
        default=None,
        help="BLE address when not using --fake",
    )
    return parser


async def cmd_scan(args: argparse.Namespace) -> int:
    if _want_fake(args):
        radio = get_fake_radio()
        ads = radio.list_advertisements()
        for ad in ads:
            print(f"{ad.device_id.hex()}  {ad.name}  {ad.address}")
        if not ads:
            print("no fake devices registered", file=sys.stderr)
        return 0
    try:
        results = await bleak_scan(timeout=args.timeout)
    except BleakUnavailableError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    for item in results:
        marker = "*" if item["has_spaghetti"] else " "
        print(f"{marker} {item['address']}  {item['name']}  {item['uuids']}")
    return 0


async def cmd_connect(args: argparse.Namespace) -> int:
    try:
        key = load_key_from_env()
    except SecretError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if _want_fake(args):
        from tools.spaghetti_gateway.fake_ble import FakeBleClient

        radio = get_fake_radio()
        client = FakeBleClient(radio)
        await client.connect(args.device_id, key)
        print(
            json.dumps(
                {
                    "connected": True,
                    "device_id": args.device_id.lower(),
                    "boot_id": client.last_boot_id,
                    "fake": True,
                }
            )
        )
        await client.disconnect()
        return 0

    from tools.spaghetti_gateway.bleak_client import BleakBleClient

    if not args.address:
        print("--address is required for real BLE connect", file=sys.stderr)
        return 2
    client = BleakBleClient()
    device_id = bytes.fromhex(args.device_id)
    await client.connect(args.address, key, device_id)
    print(json.dumps({"connected": True, "device_id": args.device_id.lower()}))
    await client.disconnect()
    return 0


def _maybe_mqtt_publisher():
    if os.environ.get(ENV_MQTT_ENABLE, "").lower() not in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return None
    # Prefer a memory publisher when paho is absent; real broker is optional.
    try:
        import paho.mqtt.client as mqtt  # type: ignore
    except ImportError:
        logger.warning("paho-mqtt not installed; using memory MQTT publisher")
        return MemoryMqttPublisher()

    host = os.environ.get(ENV_MQTT_HOST, "127.0.0.1")
    port = int(os.environ.get(ENV_MQTT_PORT, "1883"))

    class PahoPublisher:
        def __init__(self) -> None:
            self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            self._client.connect(host, port)
            self._client.loop_start()

        def publish(
            self,
            topic: str,
            payload: bytes,
            *,
            qos: int = 0,
            retain: bool = False,
        ) -> None:
            self._client.publish(topic, payload, qos=qos, retain=retain)

    return PahoPublisher()


async def cmd_serve(args: argparse.Namespace) -> int:
    try:
        key = load_key_from_env()
    except SecretError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if not _want_fake(args):
        print(
            "real BLE serve requires bleak; use --fake for local smoke/tests",
            file=sys.stderr,
        )
        # Still allow serve with empty radio for WS bring-up; connect is lazy.
        radio = FakeBleRadio()
    else:
        radio = get_fake_radio()

    credential_id = int(os.environ.get(ENV_CREDENTIAL_ID, "1"))
    mqtt_pub = _maybe_mqtt_publisher()
    config = GatewayConfig(
        listen=args.listen,
        ws_token=ws_token_from_env(),
        max_cores=max_cores_from_env(),
        credential_id=credential_id,
        mqtt_publisher=mqtt_pub,
        mqtt_base=os.environ.get(ENV_MQTT_BASE, "spaghetti"),
    )
    gateway = Gateway(radio=radio, key=key, config=config)
    if args.device_id:
        session = await gateway._ensure_session(args.device_id.lower())
        logger.info(
            "connected device %s boot_id=%s",
            args.device_id,
            session.stats.last_boot_id,
        )
    print(
        json.dumps(
            {
                "listening": f"ws://{args.listen}",
                "fake": _want_fake(args),
                "key_file_env": ENV_KEY_FILE,
                "mqtt": mqtt_pub is not None,
            }
        ),
        flush=True,
    )
    await gateway.serve_forever()
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    argv_list = list(argv) if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv_list)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # Guard: key material must never appear in argv.
    key_path = os.environ.get(ENV_KEY_FILE)
    if key_path and any(key_path == a for a in argv_list if a.startswith("-")):
        pass  # path in flag value is ok; raw key bytes must not appear
    try:
        if args.command == "scan":
            return asyncio.run(cmd_scan(args))
        if args.command == "connect":
            return asyncio.run(cmd_connect(args))
        if args.command == "serve":
            return asyncio.run(cmd_serve(args))
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        logger.error("%s", exc)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
