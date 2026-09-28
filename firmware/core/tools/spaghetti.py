#!/usr/bin/env python3
"""Spaghetti CLI V1 — catalog-driven JSON Config and Protocol operations."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import signal
import sys
import threading
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.spaghetti_protocol import (  # noqa: E402
    FakeCoreState,
    FakeMgmtUpdateChannel,
    FakeTransport,
    ProtocolConflictError,
    ProtocolError,
    SpaghettiClient,
    UpdateResumeState,
    config_to_user_json,
    load_credentials_file,
    network_psk_from_credentials,
    parse_duration_ms,
    parse_reset_scope,
    parse_services,
    rail_verification,
    redact_sensitive,
    run_update,
    stable_json_dumps,
    status_exit_code,
    topology_to_json,
    user_json_to_config,
    verify_signed_image_local,
)


class CliError(RuntimeError):
    def __init__(self, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def _emit_json(document: Any, quiet: bool) -> None:
    if quiet:
        return
    sys.stdout.write(stable_json_dumps(document))


def _emit_text(text: str, quiet: bool) -> None:
    if quiet:
        return
    sys.stdout.write(text if text.endswith("\n") else text + "\n")


def _rich_table(title: str, columns: list[str], rows: list[list[Any]], quiet: bool) -> None:
    if quiet:
        return
    try:
        from rich.console import Console
        from rich.table import Table

        table = Table(title=title)
        for column in columns:
            table.add_column(column)
        for row in rows:
            table.add_row(*[str(cell) for cell in row])
        Console().print(table)
    except ImportError:
        _emit_text(title, False)
        _emit_text("\t".join(columns), False)
        for row in rows:
            _emit_text("\t".join(str(cell) for cell in row), False)


def build_client(args: argparse.Namespace) -> SpaghettiClient:
    transport_name = getattr(args, "transport", "auto") or "auto"
    timeout_ms = int(getattr(args, "timeout_ms", 5000))

    if getattr(args, "fake", False) or os.environ.get("SPAGHETTI_FAKE") == "1":
        state = getattr(args, "_fake_state", None) or FakeCoreState()
        transport = FakeTransport("fake", state.handler)
        client = SpaghettiClient(
            transport,
            default_timeout_ms=timeout_ms,
            driver_schemas=state.schemas,
        )
        args._client_state = state
        return client

    if transport_name == "auto":
        # Unique choice only: prefer explicit serial when one port exists.
        try:
            from tools.device import serial_ports

            ports = serial_ports()
        except Exception:  # noqa: BLE001
            ports = []
        if len(ports) == 1 and not getattr(args, "host", None):
            transport_name = "serial"
            if not getattr(args, "port", None):
                args.port = ports[0]
        elif getattr(args, "host", None):
            transport_name = "network"
        else:
            raise CliError(
                "transport auto requires a unique target; pass "
                "--transport serial|network|mqtt|ble"
            )

    if transport_name == "fake":
        state = FakeCoreState()
        transport = FakeTransport("fake", state.handler)
        return SpaghettiClient(
            transport, default_timeout_ms=timeout_ms, driver_schemas=state.schemas
        )

    if transport_name == "serial":
        return _serial_protocol_client(args, timeout_ms)
    if transport_name == "network":
        return _network_protocol_client(args, timeout_ms)
    if transport_name == "mqtt":
        return _mqtt_protocol_client(args, timeout_ms)
    if transport_name == "ble":
        return _ble_protocol_client(args, timeout_ms)
    raise CliError(f"unknown transport {transport_name!r}")


def _serial_protocol_client(args: argparse.Namespace, timeout_ms: int) -> SpaghettiClient:
    """Protocol V1 over USB Serial/JTAG: kind + BE uint32 length + envelope."""
    import time

    try:
        import serial as serial_mod
    except ImportError as exc:
        raise CliError("pyserial required; run 'make host-tools'") from exc

    from tools.device import open_serial_without_reset
    from tools.spaghetti_protocol import ProtocolTimeoutError

    port = getattr(args, "port", None)
    if not port:
        raise CliError("--port is required for serial transport")

    kind_response = 0x00
    kind_event = 0x01
    kind_request = 0x02
    max_envelope = 512 + 64

    def frame_stream(kind: int, envelope: bytes) -> bytes:
        return bytes([kind]) + len(envelope).to_bytes(4, "big") + envelope

    class SerialProtocolTransport:
        name = "serial"

        def __init__(self) -> None:
            self._conn = open_serial_without_reset(serial_mod, port, 115200)
            self._conn.timeout = 0.05
            self._buf = bytearray()
            try:
                self._conn.reset_input_buffer()
            except Exception:  # noqa: BLE001
                pass

        def _pop_frame(self) -> tuple[int, bytes] | None:
            while len(self._buf) >= 5:
                kind = self._buf[0]
                if kind not in (kind_response, kind_event):
                    del self._buf[0]
                    continue
                length = int.from_bytes(self._buf[1:5], "big")
                if length > max_envelope:
                    del self._buf[0]
                    continue
                if len(self._buf) < 5 + length:
                    return None
                envelope = bytes(self._buf[5 : 5 + length])
                del self._buf[: 5 + length]
                return kind, envelope
            return None

        def send(self, request: bytes, timeout_ms: int) -> bytes:
            self._conn.write(frame_stream(kind_request, request))
            self._conn.flush()
            deadline = time.monotonic() + (timeout_ms / 1000.0)
            while time.monotonic() < deadline:
                waiting = self._conn.in_waiting
                chunk = self._conn.read(waiting if waiting else 1)
                if chunk:
                    self._buf.extend(chunk)
                while True:
                    parsed = self._pop_frame()
                    if parsed is None:
                        break
                    kind, envelope = parsed
                    if kind == kind_response:
                        return envelope
            raise ProtocolTimeoutError()

        def close(self) -> None:
            self._conn.close()

    return SpaghettiClient(
        SerialProtocolTransport(), default_timeout_ms=timeout_ms
    )


def _network_protocol_client(args: argparse.Namespace, timeout_ms: int) -> SpaghettiClient:
    del timeout_ms
    raise CliError(
        "network Protocol DTLS transport is provisioned for update/console; "
        "use --fake for Protocol V1 host tests or mqtt/ble when available"
    )


def _mqtt_protocol_client(args: argparse.Namespace, timeout_ms: int) -> SpaghettiClient:
    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise CliError("paho-mqtt required; run 'make host-tools'") from exc

    host = getattr(args, "mqtt_host", None) or getattr(args, "host", None) or "127.0.0.1"
    port = int(getattr(args, "mqtt_port", 1883))
    core_id = getattr(args, "core_id", None)
    client_id = getattr(args, "client_id", None) or f"spaghetti-cli-{os.getpid()}"
    base = getattr(args, "base_topic", None) or "spaghetti"
    if not core_id:
        raise CliError("--core-id is required for mqtt transport")

    credentials = getattr(args, "credentials", None)
    username = None
    password = None
    if credentials:
        document = load_credentials_file(credentials)
        username = document.get("username") or document.get("identity")
        password = document.get("password") or document.get("psk")

    class MqttTransport:
        name = "mqtt"

        def __init__(self) -> None:
            self._client = mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv311)
            if username:
                self._client.username_pw_set(str(username), str(password) if password else None)
            self._pending: dict[int, threading.Event] = {}
            self._responses: dict[int, bytes] = {}
            self._lock = threading.Lock()
            req = f"{base}/v1/cores/{core_id}/requests/{client_id}"
            resp = f"{base}/v1/cores/{core_id}/responses/{client_id}"
            self._request_topic = req
            self._response_topic = resp
            self._client.on_message = self._on_message
            self._client.connect(host, port, keepalive=30)
            self._client.subscribe(resp)
            self._client.loop_start()

        def _on_message(self, _client: Any, _userdata: Any, message: Any) -> None:
            from tools.spaghetti_protocol import decode_response

            try:
                correlation_id, _status, _code, _payload = decode_response(message.payload)
            except Exception:  # noqa: BLE001
                return
            with self._lock:
                self._responses[correlation_id] = bytes(message.payload)
                event = self._pending.get(correlation_id)
                if event:
                    event.set()

        def send(self, request: bytes, timeout_ms: int) -> bytes:
            from tools.spaghetti_protocol import decode_request

            correlation_id, _op, _payload = decode_request(request)
            event = threading.Event()
            with self._lock:
                self._pending[correlation_id] = event
                self._responses.pop(correlation_id, None)
            self._client.publish(self._request_topic, request)
            if not event.wait(timeout_ms / 1000.0):
                with self._lock:
                    self._pending.pop(correlation_id, None)
                raise ProtocolError("timeout", "mqtt response timeout")
            with self._lock:
                self._pending.pop(correlation_id, None)
                response = self._responses.pop(correlation_id)
            return response

        def close(self) -> None:
            self._client.loop_stop()
            self._client.disconnect()

    return SpaghettiClient(MqttTransport(), default_timeout_ms=timeout_ms)


def _ble_protocol_client(args: argparse.Namespace, timeout_ms: int) -> SpaghettiClient:
    del args, timeout_ms
    raise CliError(
        "ble Protocol transport uses the phase-365 gateway; "
        "for host tests use --fake or tools.spaghetti_gateway"
    )


def cmd_catalog(client: SpaghettiClient, args: argparse.Namespace) -> int:
    catalog = client.get_catalog(force_refresh=bool(getattr(args, "refresh", False)))
    document = {
        "protocol_version": catalog.protocol_version,
        "config_version": catalog.config_version,
        "fingerprint": catalog.fingerprint,
        "driver_count": catalog.driver_count,
        "drivers": [
            {
                "type_id": d.type_id,
                "command_count": d.command_count,
                "commands": [{"command_id": c.command_id, "name": c.name} for c in d.commands],
                "fields": [
                    {
                        "field_id": f.field_id,
                        "name": f.name,
                        "type": f.type,
                        "semantic": f.semantic,
                    }
                    for f in d.fields
                ],
            }
            for d in catalog.drivers
        ],
    }
    if args.json:
        _emit_json(document, args.quiet)
    else:
        rows = [
            [d.type_id, d.command_count, len(d.fields), len(d.commands)]
            for d in catalog.drivers
        ]
        _rich_table(
            f"Catalog fingerprint={catalog.fingerprint[:16]}…",
            ["type_id", "commands", "fields", "named_cmds"],
            rows,
            args.quiet,
        )
    return 0


def cmd_status(client: SpaghettiClient, args: argparse.Namespace) -> int:
    status = client.get_status()
    document = {
        "state": status.state,
        "mode": status.mode,
        "image_state": status.image_state,
        "active_slot": status.active_slot,
        "image_confirmed": status.image_confirmed,
        "version": status.version,
        "port_count": status.port_count,
        "last_reset_cause": status.last_reset_cause,
        "health_state": status.health_state,
        "modules": [asdict(m) for m in status.modules],
    }
    if status.boot_id is not None:
        document["boot_id"] = status.boot_id
    if status.device_id:
        document["device_id"] = status.device_id.hex()
    if status.device_name:
        document["device_name"] = status.device_name
    if status.chain_peers:
        document["chain_peers"] = [
            {
                "node_id": peer.node_id,
                "mac": peer.mac.hex(),
                "flags": peer.flags,
                "local": peer.local,
                "version": peer.version,
            }
            for peer in status.chain_peers
        ]
    if status.nfc_tags:
        document["nfc_tags"] = [
            {
                "port_id": tag.port_id,
                "type_id": tag.type_id,
                "uid": tag.uid.hex(),
                "node_id": tag.node_id,
                "local": tag.local,
            }
            for tag in status.nfc_tags
        ]
    if args.json:
        _emit_json(document, args.quiet)
    else:
        _emit_text(
            f"version={status.version} slot={status.active_slot} "
            f"confirmed={status.image_confirmed} state={status.state}",
            args.quiet,
        )
    return 0


def cmd_capabilities(client: SpaghettiClient, args: argparse.Namespace) -> int:
    caps = client.get_capabilities()
    if args.json:
        _emit_json(caps, args.quiet)
    else:
        rows = [[k, v] for k, v in caps.items()]
        _rich_table("Capabilities", ["field", "value"], rows, args.quiet)
    return 0


def cmd_topology(client: SpaghettiClient, args: argparse.Namespace) -> int:
    topology = client.get_topology()
    document = topology_to_json(topology)
    if args.json:
        _emit_json(document, args.quiet)
        return 0
    rows = []
    for flow in topology.flows:
        for bay in flow.bays:
            for rail_id in bay.available_power_rails:
                rail = next((r for r in topology.power_rails if r.id == rail_id), None)
                verification, enforcement = rail_verification(
                    rail.assurance if rail else "unmanaged"
                )
                rows.append(
                    [
                        flow.id,
                        flow.direction,
                        flow.port_id,
                        flow.signal_count,
                        bay.id,
                        rail_id,
                        f"{verification}/{enforcement}",
                    ]
                )
    _rich_table(
        "Topology",
        ["flow", "direction", "port", "signals", "bay", "rail", "power"],
        rows,
        args.quiet,
    )
    return 0


def cmd_connectivity_status(client: SpaghettiClient, args: argparse.Namespace) -> int:
    snapshot = client.get_connectivity_status()
    if args.json:
        _emit_json(snapshot, args.quiet)
    else:
        _emit_text(stable_json_dumps(snapshot).rstrip(), args.quiet)
    return 0


def cmd_connectivity_lease(client: SpaghettiClient, args: argparse.Namespace) -> int:
    services = parse_services(args.services)
    duration_ms = parse_duration_ms(args.duration)
    client.acquire_connectivity_lease(services, duration_ms)
    document = {"services": args.services, "duration_ms": duration_ms, "acquired": True}
    if args.json:
        _emit_json(document, args.quiet)
    else:
        _emit_text(f"lease acquired services={args.services} duration_ms={duration_ms}", args.quiet)
    return 0


def cmd_connectivity_release(client: SpaghettiClient, args: argparse.Namespace) -> int:
    client.release_connectivity_lease()
    if args.json:
        _emit_json({"released": True}, args.quiet)
    else:
        _emit_text("lease released", args.quiet)
    return 0


def _load_user_config(path: Path, client: SpaghettiClient) -> Any:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CliError(f"invalid config JSON: {exc}") from exc
    catalog = client.get_catalog()
    return user_json_to_config(document, catalog)


def cmd_config_get(client: SpaghettiClient, args: argparse.Namespace) -> int:
    snapshot = client.get_config()
    catalog = client.get_catalog()
    document = config_to_user_json(snapshot.config, catalog, snapshot.revision)
    if args.output:
        Path(args.output).write_text(stable_json_dumps(document), encoding="utf-8")
        if not args.quiet and not args.json:
            _emit_text(f"wrote {args.output}", False)
    if args.json or not args.output:
        if args.json:
            _emit_json(document, args.quiet)
        else:
            _emit_text(stable_json_dumps(document).rstrip(), args.quiet)
    return 0


def cmd_config_validate(client: SpaghettiClient, args: argparse.Namespace) -> int:
    config = _load_user_config(Path(args.config_file), client)
    client.validate_config(config)
    document = {"valid": True}
    if args.json:
        _emit_json(document, args.quiet)
    else:
        _emit_text("config valid", args.quiet)
    return 0


def cmd_config_apply(client: SpaghettiClient, args: argparse.Namespace) -> int:
    path = Path(args.config_file)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CliError(f"invalid config JSON: {exc}") from exc
    catalog = client.get_catalog()
    config = user_json_to_config(raw, catalog)
    if args.expected_generation is not None:
        expected = int(args.expected_generation)
    elif "generation" in raw:
        expected = int(raw["generation"])
    else:
        expected = client.get_config().revision.generation
    client.validate_config(config)
    try:
        result = client.apply_config(config, expected)
    except ProtocolConflictError:
        message = {
            "status": "conflict",
            "message": "Config generation changed; re-read and merge before apply",
            "expected_generation": expected,
        }
        if args.json:
            _emit_json(message, args.quiet)
        else:
            _emit_text(
                "CONFLICT: Config changed on device; re-read/merge — apply was not forced",
                args.quiet,
            )
        return status_exit_code("conflict")
    document = {
        "changed": result.changed,
        "generation": result.revision.generation,
        "sha256": result.revision.sha256,
    }
    if args.json:
        _emit_json(document, args.quiet)
    else:
        _emit_text(
            f"apply changed={result.changed} generation={result.revision.generation}",
            args.quiet,
        )
    return 0


def cmd_discovery_scan(client: SpaghettiClient, args: argparse.Namespace) -> int:
    client.scan_discovery(int(args.port), bool(args.allow_state_changing))
    if args.json:
        _emit_json({"scanned_port": int(args.port)}, args.quiet)
    else:
        _emit_text(f"scanned port {args.port}", args.quiet)
    return 0


def cmd_discovery_list(client: SpaghettiClient, args: argparse.Namespace) -> int:
    candidates = client.list_discovery()
    if args.json:
        _emit_json({"candidates": candidates}, args.quiet)
    else:
        rows = [
            [c["id"], c["port_id"], c["suggested_type_id"], c.get("confidence", 0)]
            for c in candidates
        ]
        _rich_table(
            "Discovery",
            ["id", "port", "type", "confidence"],
            rows,
            args.quiet,
        )
    return 0


def cmd_discovery_accept(client: SpaghettiClient, args: argparse.Namespace) -> int:
    client.accept_discovery(int(args.candidate), int(args.key))
    if args.json:
        _emit_json({"accepted": int(args.candidate), "key": int(args.key)}, args.quiet)
    else:
        _emit_text(f"accepted candidate {args.candidate} as key {args.key}", args.quiet)
    return 0


def cmd_module_command(client: SpaghettiClient, args: argparse.Namespace) -> int:
    fields: dict[str, Any] = {}
    for item in args.fields:
        if "=" not in item:
            raise CliError(f"field assignment required: {item}")
        name, value = item.split("=", 1)
        if value.lower() in ("true", "false"):
            fields[name] = value.lower() == "true"
        elif value.isdigit() or (value.startswith("-") and value[1:].isdigit()):
            fields[name] = int(value)
        else:
            fields[name] = value
    client.module_command(int(args.key), args.command, fields)
    if args.json:
        _emit_json({"key": int(args.key), "command": args.command, "ok": True}, args.quiet)
    else:
        _emit_text(f"module {args.key} command {args.command} ok", args.quiet)
    return 0


def cmd_factory_reset(client: SpaghettiClient, args: argparse.Namespace) -> int:
    scope = parse_reset_scope(args.scope)
    if not args.yes:
        if args.quiet:
            raise CliError("factory-reset requires --yes with --quiet")
        prompt = f"Type RESET to confirm factory-reset scope={args.scope}: "
        if sys.stdin.isatty():
            answer = input(prompt)
        else:
            raise CliError("factory-reset requires interactive confirmation or --yes")
        if answer.strip() != "RESET":
            raise CliError("factory-reset cancelled")
    client.factory_reset(scope)
    if args.json:
        _emit_json({"scope": args.scope, "reset": True}, args.quiet)
    else:
        _emit_text(f"factory-reset scope={args.scope} requested", args.quiet)
    return 0


def _progress_printer(quiet: bool, as_json: bool) -> Callable[[int, int, float], None]:
    def _cb(offset: int, total: int, throughput: float) -> None:
        if quiet or as_json:
            return
        percent = 100.0 * offset / total if total else 100.0
        _emit_text(
            f"update {percent:5.1f}% ({offset}/{total}) {throughput/1024:.1f} KiB/s",
            False,
        )

    return _cb


def cmd_update(client: SpaghettiClient, args: argparse.Namespace, kind: str) -> int:
    del client
    image = Path(args.image)
    meta = verify_signed_image_local(image)
    state = getattr(args, "_client_state", None)
    if state is None:
        # Live transports: open channel abstractions; for now require fake or
        # explicit session wiring in tests.
        if kind == "wifi":
            _ = network_psk_from_credentials(args.credentials) if args.credentials else None
            raise CliError(
                "live wifi update requires an armed DTLS-PSK peer; use --fake in tests"
            )
        if kind == "uart":
            raise CliError("live uart update requires SMP group 64; use --fake in tests")
        if kind == "ble":
            raise CliError("live ble update requires phase-365 framing; use --fake in tests")

    channel = FakeMgmtUpdateChannel(state.update, device_id=getattr(args, "device_id", "device-1"))
    resume = None
    if getattr(args, "resume_session", None):
        resume = UpdateResumeState(
            device_id=getattr(args, "device_id", "device-1"),
            image_hash=getattr(args, "resume_hash", meta["sha256"]),
            total_size=int(getattr(args, "resume_size", meta["size"])),
            session_id=int(args.resume_session),
            offset=int(getattr(args, "resume_offset", 0)),
        )
    cancel_event = threading.Event()

    def _handle_sigint(_signum: int, _frame: Any) -> None:
        cancel_event.set()

    previous = signal.signal(signal.SIGINT, _handle_sigint)
    try:
        result = run_update(
            channel,
            image,
            resume=resume,
            progress_cb=_progress_printer(args.quiet, args.json),
            cancel_event=cancel_event,
        )
    finally:
        signal.signal(signal.SIGINT, previous)

    document = {
        "transport": kind,
        "trial": True,
        "version": result.get("version"),
        "active_slot": result.get("active_slot"),
        "confirmed": False,
        "sha256": result.get("sha256"),
        "host": getattr(args, "host", None),
        "device_id": getattr(args, "device_id", None),
    }
    if args.json:
        _emit_json(document, args.quiet)
    else:
        _emit_text(
            f"update {kind} trial version={result.get('version')} "
            f"slot={result.get('active_slot')} confirmed=false",
            args.quiet,
        )
    return 0


def add_common_flags(
    parser: argparse.ArgumentParser, *, include_serial_port: bool = True
) -> None:
    parser.add_argument(
        "--transport",
        default="auto",
        choices=["auto", "serial", "network", "mqtt", "ble", "fake"],
    )
    parser.add_argument("--credentials", help="0600 credentials JSON (never put secrets on argv)")
    parser.add_argument("--host", help="network/mqtt host")
    if include_serial_port:
        parser.add_argument("--port", help="serial device or network port override")
    parser.add_argument("--mqtt-host", dest="mqtt_host")
    parser.add_argument("--mqtt-port", dest="mqtt_port", type=int, default=1883)
    parser.add_argument("--core-id", dest="core_id")
    parser.add_argument("--client-id", dest="client_id")
    parser.add_argument("--base-topic", dest="base_topic", default="spaghetti")
    parser.add_argument("--timeout-ms", dest="timeout_ms", type=int, default=5000)
    parser.add_argument("--json", action="store_true", help="stable machine JSON")
    parser.add_argument("--quiet", action="store_true", help="exit status only")
    parser.add_argument(
        "--fake",
        action="store_true",
        help="use in-memory fake Core (tests / no hardware)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="spaghetti", description="Spaghetti CLI V1")
    add_common_flags(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    catalog = sub.add_parser("catalog")
    add_common_flags(catalog)
    catalog.add_argument("--refresh", action="store_true")
    catalog.set_defaults(func=cmd_catalog)

    status = sub.add_parser("status")
    add_common_flags(status)
    status.set_defaults(func=cmd_status)

    capabilities = sub.add_parser("capabilities")
    add_common_flags(capabilities)
    capabilities.set_defaults(func=cmd_capabilities)

    topology = sub.add_parser("topology")
    add_common_flags(topology)
    topology.set_defaults(func=cmd_topology)

    connectivity = sub.add_parser("connectivity")
    conn_sub = connectivity.add_subparsers(dest="connectivity_command", required=True)
    c_status = conn_sub.add_parser("status")
    add_common_flags(c_status)
    c_status.set_defaults(func=cmd_connectivity_status)
    c_lease = conn_sub.add_parser("lease")
    add_common_flags(c_lease)
    c_lease.add_argument("--services", required=True)
    c_lease.add_argument("--duration", required=True)
    c_lease.set_defaults(func=cmd_connectivity_lease)
    c_release = conn_sub.add_parser("release")
    add_common_flags(c_release)
    c_release.set_defaults(func=cmd_connectivity_release)

    config = sub.add_parser("config")
    config_sub = config.add_subparsers(dest="config_command", required=True)
    c_get = config_sub.add_parser("get")
    add_common_flags(c_get)
    c_get.add_argument("--output")
    c_get.set_defaults(func=cmd_config_get)
    c_validate = config_sub.add_parser("validate")
    add_common_flags(c_validate)
    c_validate.add_argument("config_file")
    c_validate.set_defaults(func=cmd_config_validate)
    c_apply = config_sub.add_parser("apply")
    add_common_flags(c_apply)
    c_apply.add_argument("config_file")
    c_apply.add_argument("--expected-generation", type=int, default=None)
    c_apply.set_defaults(func=cmd_config_apply)

    discovery = sub.add_parser("discovery")
    disc_sub = discovery.add_subparsers(dest="discovery_command", required=True)
    d_scan = disc_sub.add_parser("scan")
    add_common_flags(d_scan, include_serial_port=False)
    d_scan.add_argument("--port", required=True, help="Spaghetti Port id to scan")
    d_scan.add_argument("--allow-state-changing", action="store_true")
    d_scan.set_defaults(func=cmd_discovery_scan)
    d_list = disc_sub.add_parser("list")
    add_common_flags(d_list)
    d_list.set_defaults(func=cmd_discovery_list)
    d_accept = disc_sub.add_parser("accept")
    add_common_flags(d_accept)
    d_accept.add_argument("candidate")
    d_accept.add_argument("--key", required=True)
    d_accept.set_defaults(func=cmd_discovery_accept)

    module = sub.add_parser("module")
    module_sub = module.add_subparsers(dest="module_command", required=True)
    m_cmd = module_sub.add_parser("command")
    add_common_flags(m_cmd)
    m_cmd.add_argument("key")
    m_cmd.add_argument("command")
    m_cmd.add_argument("fields", nargs="*")
    m_cmd.set_defaults(func=cmd_module_command)

    update = sub.add_parser("update")
    update_sub = update.add_subparsers(dest="update_command", required=True)
    for kind in ("uart", "wifi", "ble"):
        u = update_sub.add_parser(kind)
        add_common_flags(u)
        if kind == "wifi":
            u.add_argument("host")
            u.add_argument("image")
        elif kind == "ble":
            u.add_argument("device_id")
            u.add_argument("image")
        else:
            u.add_argument("image")
        u.add_argument("--resume-session", dest="resume_session")
        u.add_argument("--resume-hash", dest="resume_hash")
        u.add_argument("--resume-size", dest="resume_size", type=int)
        u.add_argument("--resume-offset", dest="resume_offset", type=int, default=0)
        u.set_defaults(func=lambda client, args, k=kind: cmd_update(client, args, k))

    reset = sub.add_parser("factory-reset")
    add_common_flags(reset)
    reset.add_argument(
        "--scope",
        required=True,
        choices=["config", "network", "credentials", "bonds", "all"],
    )
    reset.add_argument("--yes", action="store_true", help="skip interactive confirmation")
    reset.set_defaults(func=cmd_factory_reset)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        client = build_client(args)
        try:
            return int(args.func(client, args))
        finally:
            client.close()
    except ProtocolError as exc:
        if not args.quiet:
            sys.stderr.write(redact_sensitive(f"error: {exc}\n"))
        return exc.exit_code
    except CliError as exc:
        if not getattr(args, "quiet", False):
            sys.stderr.write(redact_sensitive(f"error: {exc}\n"))
        return exc.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
