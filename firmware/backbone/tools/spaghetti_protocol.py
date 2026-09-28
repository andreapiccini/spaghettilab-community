#!/usr/bin/env python3
"""Protocol V1 envelope, catalog/config codecs, client, and fake transport.

Aligned with the TypeScript host SDK (phase 378): same operations, status codes,
INT64/UINT64 JSON decimal-string rule, catalog fingerprint cache, and retry
semantics (identical bytes + correlation). Does not expose Zephyr errno as API.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import IntEnum
import hashlib
import json
import os
from pathlib import Path
import random
import re
import secrets
import stat
import threading
import time
from typing import Any, Callable, Iterator, Mapping, Protocol, runtime_checkable
import getpass

import cbor2

PROTOCOL_VERSION = 1
PAYLOAD_ABSOLUTE_MAX = 2048
CONFIG_WIRE_VERSION = 4
JS_SAFE_MIN = -(2**53) + 1
JS_SAFE_MAX = (2**53) - 1
INTEGER_STRING = re.compile(r"^-?\d+$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

KEY_VERSION = 0
KEY_FIELD1 = 1
KEY_FIELD2 = 2
KEY_PAYLOAD = 3

NO_RETRY_STATUSES = frozenset({"conflict", "unauthorized", "invalid_argument"})

FLOW_DIRECTIONS = ("field_to_core", "core_to_field", "bidirectional")
RAIL_ASSURANCE = ("unmanaged", "switched", "switched_and_measured")
VALUE_TYPES = ("bool", "int64", "uint64", "text", "bytes")
SEMANTICS = (
    "value",
    "module_key_ref",
    "record_field_ref",
    "command_ref",
    "port_ref",
    "flow_ref",
    "bay_ref",
    "power_rail_ref",
    "duration_ms",
)

SERVICE_BITS = {
    "ble": 1 << 0,
    "wifi": 1 << 1,
    "mqtt": 1 << 2,
    "remote_console": 1 << 3,
}

RESET_SCOPES = {
    "config": 1 << 0,
    "network": 1 << 1,
    "credentials": 1 << 2,
    "bonds": 1 << 3,
    "all": 0x0F,
}

STATUS_EXIT_CODES = {
    "ok": 0,
    "invalid_argument": 1,
    "unsupported": 2,
    "unauthorized": 3,
    "conflict": 4,
    "busy": 5,
    "unavailable": 6,
    "timeout": 7,
    "resource_exhausted": 8,
    "malformed_request": 9,
    "internal_error": 10,
}


class Operation(IntEnum):
    GET_CATALOG = 1
    GET_STATUS = 2
    APPLY_CONFIG = 3
    LIST_DISCOVERY = 4
    SCAN_DISCOVERY = 5
    ACCEPT_DISCOVERY = 6
    MODULE_COMMAND = 7
    GET_UPDATE_STATUS = 8
    GET_CAPABILITIES = 9
    GET_CONNECTIVITY_STATUS = 10
    ACQUIRE_CONNECTIVITY_LEASE = 11
    RELEASE_CONNECTIVITY_LEASE = 12
    OPEN_NETWORK_MAINTENANCE = 13
    OPEN_WIFI_UPDATE = 14
    FACTORY_RESET = 15
    GET_CONFIG = 16
    VALIDATE_CONFIG = 17
    GET_AUDIT_LOG = 18
    GET_JOB_STATUS = 19
    GET_TOPOLOGY = 20
    GET_RESOURCES = 21
    LIST_DEVICE_PROFILES = 22
    GET_DEVICE_PROFILE = 23
    VALIDATE_DEVICE_PROFILE = 24
    INSTALL_DEVICE_PROFILE = 25
    REMOVE_DEVICE_PROFILE = 26
    GET_FEATURES = 27
    OPEN_BLE_UPDATE = 28
    WRITE_BLE_UPDATE = 29
    FINISH_BLE_UPDATE = 30
    CANCEL_BLE_UPDATE = 31


PROTOCOL_STATUS_CODES = {
    "ok": 0,
    "invalid_argument": 1,
    "unsupported": 2,
    "unauthorized": 3,
    "conflict": 4,
    "busy": 5,
    "unavailable": 6,
    "timeout": 7,
    "resource_exhausted": 8,
    "malformed_request": 9,
    "internal_error": 10,
}
PROTOCOL_STATUS_NAMES = {v: k for k, v in PROTOCOL_STATUS_CODES.items()}


class ProtocolError(Exception):
    def __init__(
        self,
        status: str,
        message: str | None = None,
        correlation_id: int | None = None,
    ) -> None:
        super().__init__(message or status)
        self.status = status
        self.correlation_id = correlation_id

    @property
    def exit_code(self) -> int:
        return STATUS_EXIT_CODES.get(self.status, 10)


class ProtocolConflictError(ProtocolError):
    def __init__(
        self, message: str = "conflict", correlation_id: int | None = None
    ) -> None:
        super().__init__("conflict", message, correlation_id)


class ProtocolTimeoutError(ProtocolError):
    def __init__(self, correlation_id: int | None = None) -> None:
        super().__init__("timeout", "request timed out", correlation_id)


class ProtocolCodecError(ProtocolError):
    def __init__(self, message: str) -> None:
        super().__init__("malformed_request", message)


def status_exit_code(status: str) -> int:
    return STATUS_EXIT_CODES.get(status, 10)


def bytes_to_hex(data: bytes | bytearray) -> str:
    return bytes(data).hex()


def hex_to_bytes(hex_text: str) -> bytes:
    clean = hex_text.strip().lower().removeprefix("0x")
    if len(clean) % 2 or (clean and not re.fullmatch(r"[0-9a-f]*", clean)):
        raise ProtocolCodecError("invalid hex string")
    return bytes.fromhex(clean)


def integer_from_json(value: Any) -> int:
    if isinstance(value, str):
        if not INTEGER_STRING.fullmatch(value):
            raise ProtocolCodecError(f"{value!r} is not a valid integer string")
        return int(value)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolCodecError(
            f"expected integer number or decimal string, got {type(value).__name__}"
        )
    if value < JS_SAFE_MIN or value > JS_SAFE_MAX:
        raise ProtocolCodecError(
            f"{value} is outside the JSON safe-integer range; use a decimal string"
        )
    return value


def integer_to_json(value: int) -> int | str:
    if JS_SAFE_MIN <= value <= JS_SAFE_MAX:
        return value
    return str(value)


def infer_wire_type(json_value: Any) -> str:
    if isinstance(json_value, bool):
        return "bool"
    if isinstance(json_value, int) and not isinstance(json_value, bool):
        if json_value < JS_SAFE_MIN or json_value > JS_SAFE_MAX:
            raise ProtocolCodecError("JSON number is not a safe integer")
        return "int64" if json_value < 0 else "uint64"
    if isinstance(json_value, str):
        if INTEGER_STRING.fullmatch(json_value):
            return "int64" if json_value.startswith("-") else "uint64"
        if re.fullmatch(r"[0-9a-fA-F]+", json_value) and len(json_value) % 2 == 0:
            return "bytes"
        return "text"
    raise ProtocolCodecError("unsupported JSON wire value")


def wire_value_from_json(json_value: Any, wire_type: str) -> Any:
    if wire_type == "bool":
        if not isinstance(json_value, bool):
            raise ProtocolCodecError("expected boolean")
        return json_value
    if wire_type == "text":
        if not isinstance(json_value, str):
            raise ProtocolCodecError("expected text string")
        return json_value
    if wire_type == "int64":
        return integer_from_json(json_value)
    if wire_type == "uint64":
        n = integer_from_json(json_value)
        if n < 0:
            raise ProtocolCodecError("uint64 cannot be negative")
        return n
    if wire_type == "bytes":
        if not isinstance(json_value, str):
            raise ProtocolCodecError("bytes must be hex string in JSON")
        return hex_to_bytes(json_value)
    raise ProtocolCodecError(f"unsupported wire type {wire_type}")


def wire_value_to_json(value: Any, wire_type: str) -> Any:
    if wire_type in ("int64", "uint64"):
        return integer_to_json(int(value))
    if wire_type == "bytes":
        return bytes_to_hex(value)
    return value


def redact_sensitive(text: str) -> str:
    """Mask hex-looking secrets and common credential keys in debug text."""
    redacted = re.sub(r"(?i)(psk|password|secret|key|token)(\s*[:=]\s*)\S+", r"\1\2***", text)
    redacted = re.sub(r"\b[0-9a-fA-F]{64}\b", "***", redacted)
    return redacted


def load_credentials_file(path_text: str | None) -> dict[str, Any]:
    """Load a 0600 credentials JSON file (no secrets on argv)."""
    if not path_text:
        raise ProtocolError("invalid_argument", "credentials path required")
    path = Path(path_text).expanduser()
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProtocolError("invalid_argument", f"cannot read credentials: {path}") from exc
    if os.name != "nt" and mode & 0o077:
        raise ProtocolError(
            "invalid_argument",
            f"credential file {path} is accessible by other users; run 'chmod 600 {path}'",
        )
    if not isinstance(document, dict):
        raise ProtocolError("invalid_argument", "credential JSON must be an object")
    return document


def network_psk_from_credentials(path_text: str | None) -> tuple[str, bytes]:
    document = load_credentials_file(path_text)
    identity = document.get("identity")
    psk_hex = document.get("psk")
    if not isinstance(identity, str) or not 1 <= len(identity.encode()) <= 32:
        raise ProtocolError("invalid_argument", "credential identity invalid")
    if not isinstance(psk_hex, str) or not re.fullmatch(r"[0-9A-Fa-f]{64}", psk_hex):
        raise ProtocolError("invalid_argument", "credential psk must be 64 hex digits")
    return identity, bytes.fromhex(psk_hex)


def prompt_secret(prompt: str = "PSK (hex): ") -> str:
    return getpass.getpass(prompt)


# --- Envelope -----------------------------------------------------------------


def encode_envelope(field1: int, field2: int, payload: bytes = b"") -> bytes:
    if len(payload) > PAYLOAD_ABSOLUTE_MAX:
        raise ProtocolCodecError("payload exceeds absolute maximum")
    if field1 == 0:
        raise ProtocolCodecError("correlation/sequence must be nonzero")
    document = {
        KEY_VERSION: PROTOCOL_VERSION,
        KEY_FIELD1: field1,
        KEY_FIELD2: field2,
        KEY_PAYLOAD: payload,
    }
    encoded = cbor2.dumps(document, canonical=True)
    if len(encoded) > PAYLOAD_ABSOLUTE_MAX:
        raise ProtocolCodecError("encoded envelope exceeds absolute maximum")
    return encoded


def decode_envelope(data: bytes) -> tuple[int, int, bytes]:
    if not data:
        raise ProtocolCodecError("empty envelope")
    if len(data) > PAYLOAD_ABSOLUTE_MAX:
        raise ProtocolCodecError("envelope exceeds absolute maximum")
    document = cbor2.loads(data)
    if not isinstance(document, dict):
        raise ProtocolCodecError("envelope must be a CBOR map")
    try:
        version = int(document[KEY_VERSION])
        field1 = int(document[KEY_FIELD1])
        field2 = int(document[KEY_FIELD2])
        payload = document[KEY_PAYLOAD]
    except (KeyError, TypeError, ValueError) as exc:
        raise ProtocolCodecError("malformed envelope keys") from exc
    if version != PROTOCOL_VERSION:
        raise ProtocolCodecError("unsupported envelope version")
    if field1 == 0:
        raise ProtocolCodecError("correlation/sequence must be nonzero")
    if not isinstance(payload, (bytes, bytearray)):
        raise ProtocolCodecError("payload must be a byte string")
    if len(payload) > PAYLOAD_ABSOLUTE_MAX:
        raise ProtocolCodecError("payload exceeds absolute maximum")
    return field1, field2, bytes(payload)


def encode_request(correlation_id: int, operation: int, payload: bytes = b"") -> bytes:
    if correlation_id == 0:
        raise ProtocolCodecError("correlation_id must be nonzero")
    if not 1 <= operation <= 31:
        raise ProtocolCodecError(f"invalid operation {operation}")
    return encode_envelope(correlation_id, operation, payload)


def encode_response(
    correlation_id: int, status: str | int, payload: bytes = b""
) -> bytes:
    if isinstance(status, str):
        if status not in PROTOCOL_STATUS_CODES:
            raise ProtocolCodecError(f"unknown status {status}")
        status_code = PROTOCOL_STATUS_CODES[status]
    else:
        status_code = status
        if status_code not in PROTOCOL_STATUS_NAMES:
            raise ProtocolCodecError(f"unknown status {status}")
    if correlation_id == 0:
        raise ProtocolCodecError("correlation_id must be nonzero")
    return encode_envelope(correlation_id, status_code, payload)


def decode_request(data: bytes) -> tuple[int, int, bytes]:
    field1, field2, payload = decode_envelope(data)
    if not 1 <= field2 <= 31:
        raise ProtocolCodecError(f"unsupported operation {field2}")
    return field1, field2, payload


def decode_response(data: bytes) -> tuple[int, str, int, bytes]:
    field1, field2, payload = decode_envelope(data)
    name = PROTOCOL_STATUS_NAMES.get(field2)
    if name is None:
        raise ProtocolCodecError(f"unknown status {field2}")
    return field1, name, field2, payload


# --- Catalog ------------------------------------------------------------------


@dataclass
class CatalogField:
    field_id: int
    name: str
    type: str
    semantic: str = "value"
    reference_group: int = 0
    unit: str | None = None
    description: str | None = None
    minimum: int | None = None
    maximum: int | None = None


@dataclass
class CatalogCommand:
    command_id: int
    name: str


@dataclass
class CatalogDriver:
    type_id: str
    command_count: int
    commands: list[CatalogCommand] = field(default_factory=list)
    fields: list[CatalogField] = field(default_factory=list)


@dataclass
class Catalog:
    protocol_version: int
    config_version: int
    fingerprint: str
    drivers: list[CatalogDriver]
    driver_count: int


@dataclass
class CatalogPage:
    protocol_version: int
    config_version: int
    fingerprint: str
    drivers: list[CatalogDriver]
    next_cursor: int
    driver_count: int


def encode_get_catalog_request(cursor: int = 0, limit: int = 8) -> bytes:
    return cbor2.dumps({0: cursor, 1: limit}, canonical=True)


def encode_catalog_page(page: CatalogPage) -> bytes:
    fp = hex_to_bytes(page.fingerprint)
    if len(fp) != 32:
        raise ProtocolCodecError("catalog fingerprint must be 32 bytes")
    drivers = [
        {0: d.type_id, 1: d.command_count}
        for d in page.drivers
    ]
    return cbor2.dumps(
        {
            0: page.protocol_version,
            1: page.config_version,
            2: fp,
            3: drivers,
            4: page.next_cursor,
            5: page.driver_count,
        },
        canonical=True,
    )


def decode_catalog_page(payload: bytes) -> CatalogPage:
    document = cbor2.loads(payload)
    if not isinstance(document, dict):
        raise ProtocolCodecError("GetCatalogResponse must be a map")
    drivers_raw = document.get(3, [])
    drivers: list[CatalogDriver] = []
    for entry in drivers_raw:
        if not isinstance(entry, dict):
            raise ProtocolCodecError("CatalogDriver must be a map")
        drivers.append(
            CatalogDriver(
                type_id=str(entry[0]),
                command_count=int(entry[1]),
            )
        )
    return CatalogPage(
        protocol_version=int(document[0]),
        config_version=int(document[1]),
        fingerprint=bytes_to_hex(document[2]),
        drivers=drivers,
        next_cursor=int(document[4]),
        driver_count=int(document[5]),
    )


def merge_catalog_pages(pages: list[CatalogPage]) -> Catalog:
    if not pages:
        raise ProtocolCodecError("empty catalog pages")
    fingerprint = pages[0].fingerprint
    drivers: list[CatalogDriver] = []
    for page in pages:
        if page.fingerprint != fingerprint:
            raise ProtocolCodecError("catalog fingerprint changed during pagination")
        drivers.extend(page.drivers)
    last = pages[-1]
    return Catalog(
        protocol_version=last.protocol_version,
        config_version=last.config_version,
        fingerprint=fingerprint,
        drivers=drivers,
        driver_count=last.driver_count,
    )


def attach_driver_schemas(
    catalog: Catalog, schemas: Mapping[str, CatalogDriver]
) -> Catalog:
    """Attach host-side field/command schemas keyed by type_id (no local INA table)."""
    drivers = []
    for driver in catalog.drivers:
        schema = schemas.get(driver.type_id)
        if schema is None:
            drivers.append(driver)
            continue
        drivers.append(
            CatalogDriver(
                type_id=driver.type_id,
                command_count=driver.command_count,
                commands=list(schema.commands),
                fields=list(schema.fields),
            )
        )
    return replace(catalog, drivers=drivers)


# --- Config -------------------------------------------------------------------


@dataclass
class ModuleConfig:
    key: int
    port: int
    type: str
    properties: dict[str, Any]
    property_types: dict[str, str] = field(default_factory=dict)
    bay: int | None = None
    power_rail: int | None = None


@dataclass
class ScheduleConfig:
    source_key: int
    period_ms: int
    enabled: bool


@dataclass
class RuleConfig:
    key: int
    type: str
    properties: dict[str, Any]
    property_types: dict[str, str] = field(default_factory=dict)


@dataclass
class BlockConfig:
    key: int
    type: str
    min_version: int
    exact_version: int
    properties: dict[str, Any]
    property_types: dict[str, str] = field(default_factory=dict)


@dataclass
class EdgeConfig:
    source_key: int
    source_port_or_field: int
    target_key: int
    target_input: int
    source_kind: int


@dataclass
class MqttConfig:
    enabled: bool = False
    host: str = ""
    port: int = 1883
    base_topic: str = "spaghetti"
    security: int = 0
    credential_id: int = 0


@dataclass
class EnergyPolicy:
    availability: int = 0
    window_ms: int = 0
    period_ms: int = 0


@dataclass
class SpaghettiConfig:
    version: int = CONFIG_WIRE_VERSION
    modules: list[ModuleConfig] = field(default_factory=list)
    schedules: list[ScheduleConfig] = field(default_factory=list)
    rules: list[RuleConfig] = field(default_factory=list)
    blocks: list[BlockConfig] = field(default_factory=list)
    edges: list[EdgeConfig] = field(default_factory=list)
    connectivity_policy: int = 0
    energy_policy: EnergyPolicy = field(default_factory=EnergyPolicy)
    mqtt: MqttConfig = field(default_factory=MqttConfig)


@dataclass
class ConfigRevision:
    generation: int
    sha256: str


@dataclass
class ConfigSnapshot:
    config: SpaghettiConfig
    revision: ConfigRevision


@dataclass
class ApplyResult:
    changed: bool
    revision: ConfigRevision


def empty_config() -> SpaghettiConfig:
    return SpaghettiConfig()


def _encode_properties(
    properties: dict[str, Any],
    property_types: dict[str, str] | None = None,
    name_to_id: Mapping[str, int] | None = None,
) -> dict[int, Any]:
    encoded: dict[int, Any] = {}
    for key, json_value in properties.items():
        if re.fullmatch(r"\d+", str(key)):
            field_id = int(key)
            if field_id == 0:
                raise ProtocolCodecError("field id must be nonzero")
        else:
            if name_to_id is None or key not in name_to_id:
                raise ProtocolCodecError(f"unknown property field {key!r}")
            field_id = name_to_id[key]
        wire_type = (
            (property_types or {}).get(str(key))
            or (property_types or {}).get(str(field_id))
            or infer_wire_type(json_value)
        )
        encoded[field_id] = wire_value_from_json(json_value, wire_type)
    return dict(sorted(encoded.items()))


def _decode_properties(raw: Any) -> tuple[dict[str, Any], dict[str, str]]:
    if not isinstance(raw, dict):
        raise ProtocolCodecError("properties must be a map")
    properties: dict[str, Any] = {}
    property_types: dict[str, str] = {}
    for field_id, value in raw.items():
        key = str(int(field_id))
        if isinstance(value, bool):
            wire_type = "bool"
        elif isinstance(value, int):
            wire_type = "int64" if value < 0 else "uint64"
        elif isinstance(value, str):
            wire_type = "text"
        elif isinstance(value, (bytes, bytearray)):
            wire_type = "bytes"
            value = bytes(value)
        else:
            raise ProtocolCodecError(f"unsupported property value for field {key}")
        properties[key] = wire_value_to_json(value, wire_type)
        property_types[key] = wire_type
    return properties, property_types


def encode_config(config: SpaghettiConfig) -> bytes:
    modules = []
    for module in config.modules:
        entry: dict[int, Any] = {
            0: module.key,
            1: module.port,
            2: module.type,
            3: _encode_properties(module.properties, module.property_types),
        }
        if module.bay is not None:
            entry[4] = module.bay
        if module.power_rail is not None:
            entry[5] = module.power_rail
        modules.append(entry)
    schedules = [
        {0: s.source_key, 1: s.period_ms, 2: s.enabled} for s in config.schedules
    ]
    rules = [
        {
            0: r.key,
            1: r.type,
            2: _encode_properties(r.properties, r.property_types),
        }
        for r in config.rules
    ]
    blocks = [
        {
            0: b.key,
            1: b.type,
            2: b.min_version,
            3: b.exact_version,
            4: _encode_properties(b.properties, b.property_types),
        }
        for b in config.blocks
    ]
    edges = [
        {
            0: e.source_key,
            1: e.source_port_or_field,
            2: e.target_key,
            3: e.target_input,
            4: e.source_kind,
        }
        for e in config.edges
    ]
    mqtt = {
        0: config.mqtt.enabled,
        1: config.mqtt.host,
        2: config.mqtt.port,
        3: config.mqtt.base_topic,
        4: config.mqtt.security,
        5: config.mqtt.credential_id,
    }
    energy = {
        0: config.energy_policy.availability,
        1: config.energy_policy.window_ms,
        2: config.energy_policy.period_ms,
    }
    document = {
        0: config.version or CONFIG_WIRE_VERSION,
        1: modules,
        2: schedules,
        3: rules,
        4: mqtt,
        5: config.connectivity_policy,
        6: energy,
        7: blocks,
        8: edges,
    }
    return cbor2.dumps(document, canonical=True)


def decode_config(payload: bytes) -> SpaghettiConfig:
    document = cbor2.loads(payload)
    if not isinstance(document, dict):
        raise ProtocolCodecError("config must be a map")

    def modules() -> list[ModuleConfig]:
        out: list[ModuleConfig] = []
        for entry in document.get(1, []):
            props, types = _decode_properties(entry[3])
            out.append(
                ModuleConfig(
                    key=int(entry[0]),
                    port=int(entry[1]),
                    type=str(entry[2]),
                    properties=props,
                    property_types=types,
                    bay=int(entry[4]) if 4 in entry else None,
                    power_rail=int(entry[5]) if 5 in entry else None,
                )
            )
        return out

    mqtt_raw = document.get(4, {})
    energy_raw = document.get(6, {})
    return SpaghettiConfig(
        version=int(document.get(0, CONFIG_WIRE_VERSION)),
        modules=modules(),
        schedules=[
            ScheduleConfig(
                source_key=int(s[0]), period_ms=int(s[1]), enabled=bool(s[2])
            )
            for s in document.get(2, [])
        ],
        rules=[
            RuleConfig(
                key=int(r[0]),
                type=str(r[1]),
                properties=_decode_properties(r[2])[0],
                property_types=_decode_properties(r[2])[1],
            )
            for r in document.get(3, [])
        ],
        mqtt=MqttConfig(
            enabled=bool(mqtt_raw.get(0, False)),
            host=str(mqtt_raw.get(1, "")),
            port=int(mqtt_raw.get(2, 1883)),
            base_topic=str(mqtt_raw.get(3, "spaghetti")),
            security=int(mqtt_raw.get(4, 0)),
            credential_id=int(mqtt_raw.get(5, 0)),
        ),
        connectivity_policy=int(document.get(5, 0)),
        energy_policy=EnergyPolicy(
            availability=int(energy_raw.get(0, 0)),
            window_ms=int(energy_raw.get(1, 0)),
            period_ms=int(energy_raw.get(2, 0)),
        ),
        blocks=[
            BlockConfig(
                key=int(b[0]),
                type=str(b[1]),
                min_version=int(b[2]),
                exact_version=int(b[3]),
                properties=_decode_properties(b[4])[0],
                property_types=_decode_properties(b[4])[1],
            )
            for b in document.get(7, [])
        ],
        edges=[
            EdgeConfig(
                source_key=int(e[0]),
                source_port_or_field=int(e[1]),
                target_key=int(e[2]),
                target_input=int(e[3]),
                source_kind=int(e[4]),
            )
            for e in document.get(8, [])
        ],
    )


def config_sha256(config: SpaghettiConfig) -> str:
    return hashlib.sha256(encode_config(config)).hexdigest()


def encode_get_config_response(snapshot: ConfigSnapshot) -> bytes:
    return cbor2.dumps(
        {
            0: snapshot.revision.generation,
            1: hex_to_bytes(snapshot.revision.sha256),
            2: encode_config(snapshot.config),
        },
        canonical=True,
    )


def decode_get_config_response(payload: bytes) -> ConfigSnapshot:
    document = cbor2.loads(payload)
    sha = document[1]
    if not isinstance(sha, (bytes, bytearray)) or len(sha) != 32:
        raise ProtocolCodecError("sha256 must be 32 bytes")
    return ConfigSnapshot(
        revision=ConfigRevision(generation=int(document[0]), sha256=bytes_to_hex(sha)),
        config=decode_config(document[2]),
    )


def encode_validate_config_request(config: SpaghettiConfig) -> bytes:
    return cbor2.dumps({0: encode_config(config)}, canonical=True)


def encode_validate_config_response(valid: bool = True, **detail: int) -> bytes:
    if valid:
        return cbor2.dumps({0: True}, canonical=True)
    return cbor2.dumps(
        {
            0: False,
            1: detail.get("field", 0),
            2: detail.get("index", 0),
            3: detail.get("reason", 0),
        },
        canonical=True,
    )


def decode_validate_config_response(payload: bytes) -> None:
    document = cbor2.loads(payload)
    if not bool(document.get(0)):
        raise ProtocolCodecError(
            "config validation failed "
            f"field={document.get(1)} index={document.get(2)} reason={document.get(3)}"
        )


def encode_apply_config_request(config: SpaghettiConfig, expected_generation: int) -> bytes:
    return cbor2.dumps(
        {0: expected_generation, 1: encode_config(config)},
        canonical=True,
    )


def encode_apply_config_response(result: ApplyResult) -> bytes:
    return cbor2.dumps(
        {
            0: result.changed,
            1: result.revision.generation,
            2: hex_to_bytes(result.revision.sha256),
        },
        canonical=True,
    )


def decode_apply_config_response(payload: bytes) -> ApplyResult:
    document = cbor2.loads(payload)
    sha = document[2]
    if not isinstance(sha, (bytes, bytearray)) or len(sha) != 32:
        raise ProtocolCodecError("sha256 must be 32 bytes")
    return ApplyResult(
        changed=bool(document[0]),
        revision=ConfigRevision(generation=int(document[1]), sha256=bytes_to_hex(sha)),
    )


# --- Status / topology / misc payloads ----------------------------------------


@dataclass
class ModuleStatus:
    key: int
    id: int
    port_id: int
    state: int
    endpoint_kind: int
    endpoint_value_raw: int
    type_id: str


@dataclass
class ChainPeerStatus:
    node_id: int = 0
    mac: bytes = b""
    flags: int = 0
    local: bool = False
    version: str = ""


@dataclass
class NfcTagStatus:
    port_id: int = 0
    type_id: str = ""
    uid: bytes = b""
    node_id: int = 0
    local: bool = False


@dataclass
class CoreStatus:
    state: int = 0
    mode: int = 0
    image_state: int = 0
    active_slot: int = 0
    image_confirmed: bool = False
    version: str = ""
    port_count: int = 0
    last_reset_cause: int = 0
    health_state: int = 0
    modules: list[ModuleStatus] = field(default_factory=list)
    boot_id: int | None = None
    device_id: bytes | None = None
    device_name: str = ""
    chain_peers: list[ChainPeerStatus] = field(default_factory=list)
    nfc_tags: list[NfcTagStatus] = field(default_factory=list)


@dataclass
class FunctionBay:
    id: int
    ordinal_from_field: int
    available_power_rails: list[int]
    module_key: int | None = None
    admission: int | None = None


@dataclass
class HardwareFlow:
    id: int
    port_id: int
    direction: str
    signal_count: int
    bays: list[FunctionBay]


@dataclass
class PowerRail:
    id: int
    assurance: str
    max_total_microamps: int | None = None


@dataclass
class CoreTopology:
    flows: list[HardwareFlow]
    power_rails: list[PowerRail]


@dataclass
class TopologyPage:
    flows: list[HardwareFlow]
    power_rails: list[PowerRail]
    next_cursor: int


def encode_get_status_response(status: CoreStatus) -> bytes:
    modules = [
        {
            0: m.key,
            1: m.id,
            2: m.port_id,
            3: m.state,
            4: m.endpoint_kind,
            5: m.endpoint_value_raw,
            6: m.type_id,
        }
        for m in status.modules
    ]
    document: dict[int, Any] = {
        0: status.state,
        1: status.mode,
        2: status.image_state,
        3: status.active_slot,
        4: status.image_confirmed,
        5: status.version,
        6: status.port_count,
        7: status.last_reset_cause,
        8: status.health_state,
        9: modules,
    }
    if status.device_id:
        document[10] = status.device_id
    elif status.boot_id is not None:
        document[10] = status.boot_id
    if status.device_name:
        document[11] = status.device_name
    if status.chain_peers:
        document[12] = [
            {
                0: peer.node_id,
                1: peer.mac,
                2: peer.flags,
                3: peer.local,
                4: peer.version,
            }
            for peer in status.chain_peers
        ]
    if status.nfc_tags:
        document[13] = [
            {
                0: tag.port_id,
                1: tag.type_id,
                2: tag.uid,
                3: tag.node_id,
                4: tag.local,
            }
            for tag in status.nfc_tags
        ]
    return cbor2.dumps(document, canonical=True)


def decode_get_status_response(payload: bytes) -> CoreStatus:
    if not payload:
        return CoreStatus()
    document = cbor2.loads(payload)
    modules = [
        ModuleStatus(
            key=int(m[0]),
            id=int(m[1]),
            port_id=int(m[2]),
            state=int(m[3]),
            endpoint_kind=int(m[4]),
            endpoint_value_raw=int(m[5]),
            type_id=str(m[6]),
        )
        for m in document.get(9, [])
    ]
    raw_identity = document.get(10)
    device_id = raw_identity if isinstance(raw_identity, (bytes, bytearray)) else None
    boot_id: int | None
    if isinstance(raw_identity, int):
        boot_id = int(raw_identity)
    else:
        boot_id = None
    raw_name = document.get(11)
    device_name = str(raw_name) if isinstance(raw_name, str) else ""
    chain_peers: list[ChainPeerStatus] = []
    for raw in document.get(12, []) or []:
        if not isinstance(raw, dict):
            continue
        mac = raw.get(1, b"")
        chain_peers.append(
            ChainPeerStatus(
                node_id=int(raw.get(0, 0)),
                mac=bytes(mac) if isinstance(mac, (bytes, bytearray)) else b"",
                flags=int(raw.get(2, 0)),
                local=bool(raw.get(3, False)),
                version=str(raw.get(4, "") or ""),
            )
        )
    nfc_tags: list[NfcTagStatus] = []
    for raw in document.get(13, []) or []:
        if not isinstance(raw, dict):
            continue
        uid = raw.get(2, b"")
        nfc_tags.append(
            NfcTagStatus(
                port_id=int(raw.get(0, 0)),
                type_id=str(raw.get(1, "") or ""),
                uid=bytes(uid) if isinstance(uid, (bytes, bytearray)) else b"",
                node_id=int(raw.get(3, 0)),
                local=bool(raw.get(4, False)),
            )
        )
    return CoreStatus(
        state=int(document.get(0, 0)),
        mode=int(document.get(1, 0)),
        image_state=int(document.get(2, 0)),
        active_slot=int(document.get(3, 0)),
        image_confirmed=bool(document.get(4, False)),
        version=str(document.get(5, "")),
        port_count=int(document.get(6, 0)),
        last_reset_cause=int(document.get(7, 0)),
        health_state=int(document.get(8, 0)),
        modules=modules,
        boot_id=boot_id,
        device_id=bytes(device_id) if device_id is not None else None,
        device_name=device_name,
        chain_peers=chain_peers,
        nfc_tags=nfc_tags,
    )


def encode_get_topology_request(cursor: int = 0, limit: int = 2) -> bytes:
    return cbor2.dumps({0: cursor, 1: limit}, canonical=True)


def _rail_mask_to_ids(mask: int) -> list[int]:
    return [bit for bit in range(32) if mask & (1 << bit)]


def encode_topology_page(page: TopologyPage) -> bytes:
    flows = []
    for flow in page.flows:
        direction = FLOW_DIRECTIONS.index(flow.direction) if flow.direction in FLOW_DIRECTIONS else 2
        bays = []
        for bay in flow.bays:
            mask = 0
            for rail_id in bay.available_power_rails:
                mask |= 1 << rail_id
            rails = [
                {
                    0: r.id,
                    1: max(0, RAIL_ASSURANCE.index(r.assurance))
                    if r.assurance in RAIL_ASSURANCE
                    else 0,
                    2: r.max_total_microamps or 0,
                }
                for r in page.power_rails
                if r.id in bay.available_power_rails
            ]
            bays.append(
                {
                    0: bay.id,
                    1: bay.ordinal_from_field,
                    2: mask,
                    3: bay.module_key or 0,
                    4: bay.admission or 0,
                    5: rails,
                }
            )
        flows.append(
            {
                0: flow.id,
                1: flow.port_id,
                2: direction,
                3: 5,
                4: bays,
            }
        )
    return cbor2.dumps({0: flows, 1: page.next_cursor}, canonical=True)


def decode_topology_page(payload: bytes) -> TopologyPage:
    document = cbor2.loads(payload)
    power_rails: list[PowerRail] = []
    rail_by_id: dict[int, PowerRail] = {}
    flows: list[HardwareFlow] = []
    for entry in document.get(0, []):
        bays = []
        for bay_entry in entry.get(4, []):
            for rail_entry in bay_entry.get(5, []):
                rail = PowerRail(
                    id=int(rail_entry[0]),
                    assurance=RAIL_ASSURANCE[int(rail_entry[1])]
                    if int(rail_entry[1]) < len(RAIL_ASSURANCE)
                    else "unmanaged",
                    max_total_microamps=int(rail_entry.get(2, 0)),
                )
                if rail.id not in rail_by_id:
                    rail_by_id[rail.id] = rail
                    power_rails.append(rail)
            module_key = int(bay_entry.get(3, 0)) or None
            bays.append(
                FunctionBay(
                    id=int(bay_entry[0]),
                    ordinal_from_field=int(bay_entry[1]),
                    available_power_rails=_rail_mask_to_ids(int(bay_entry[2])),
                    module_key=module_key,
                    admission=int(bay_entry.get(4, 0)),
                )
            )
        direction_code = int(entry[2])
        flows.append(
            HardwareFlow(
                id=int(entry[0]),
                port_id=int(entry[1]),
                direction=FLOW_DIRECTIONS[direction_code]
                if direction_code < len(FLOW_DIRECTIONS)
                else "bidirectional",
                signal_count=5,
                bays=bays,
            )
        )
    return TopologyPage(
        flows=flows,
        power_rails=power_rails,
        next_cursor=int(document.get(1, 0)),
    )


def rail_verification(assurance: str) -> tuple[str, str]:
    """Return (verification_label, enforcement_label) for topology display."""
    if assurance == "unmanaged":
        return "unverified", "manual jumper"
    if assurance == "switched_and_measured":
        return "measured", "enforced"
    if assurance == "switched":
        return "switched", "enforced"
    return "unverified", "manual jumper"


def encode_module_command_request(key: int, command_id: int) -> bytes:
    return cbor2.dumps({0: key, 1: command_id}, canonical=True)


def encode_factory_reset_request(scope_mask: int) -> bytes:
    return cbor2.dumps({0: scope_mask}, canonical=True)


def encode_lease_request(services: int, duration_ms: int) -> bytes:
    return cbor2.dumps({0: services, 1: duration_ms}, canonical=True)


def encode_scan_discovery_request(port_id: int, allow_state_changing: bool) -> bytes:
    return cbor2.dumps({0: port_id, 1: 1 if allow_state_changing else 0}, canonical=True)


def encode_accept_discovery_request(candidate_id: int, key: int) -> bytes:
    return cbor2.dumps({0: candidate_id, 1: key}, canonical=True)


def encode_capabilities_response(caps: dict[str, Any]) -> bytes:
    return cbor2.dumps(
        {
            0: caps.get("resource_profile", 0),
            1: caps.get("build_capabilities", 0),
            2: caps.get("core_variant", ""),
            3: caps.get("max_protocol_payload", PAYLOAD_ABSOLUTE_MAX),
            4: caps.get("max_inflight_requests", 1),
            5: caps.get("replay_window_ms", 5000),
            6: caps.get("max_modules", 8),
            7: caps.get("max_principals", 4),
        },
        canonical=True,
    )


def decode_capabilities_response(payload: bytes) -> dict[str, Any]:
    document = cbor2.loads(payload) if payload else {}
    return {
        "resource_profile": int(document.get(0, 0)),
        "build_capabilities": int(document.get(1, 0)),
        "core_variant": str(document.get(2, "")),
        "max_protocol_payload": int(document.get(3, 0)),
        "max_inflight_requests": int(document.get(4, 0)),
        "replay_window_ms": int(document.get(5, 0)),
        "max_modules": int(document.get(6, 0)),
        "max_principals": int(document.get(7, 0)),
    }


def encode_connectivity_status(snapshot: dict[str, Any]) -> bytes:
    return cbor2.dumps(
        {
            0: snapshot.get("policy", 0),
            1: snapshot.get("active_services", 0),
            2: snapshot.get("leased_services", 0),
            3: snapshot.get("lease_expires_at_ms", 0),
            4: snapshot.get("last_error", 0),
        },
        canonical=True,
    )


def decode_connectivity_status(payload: bytes) -> dict[str, Any]:
    document = cbor2.loads(payload) if payload else {}
    return {
        "policy": int(document.get(0, 0)),
        "active_services": int(document.get(1, 0)),
        "leased_services": int(document.get(2, 0)),
        "lease_expires_at_ms": integer_to_json(int(document.get(3, 0))),
        "last_error": int(document.get(4, 0)),
    }


def encode_discovery_list_response(
    candidates: list[dict[str, Any]], next_cursor: int = 0
) -> bytes:
    encoded = [
        {
            0: c["id"],
            1: c["port_id"],
            2: c.get("generation", 0),
            3: c.get("confidence", 0),
            4: c.get("suggested_type_id", ""),
        }
        for c in candidates
    ]
    return cbor2.dumps({0: encoded, 1: next_cursor}, canonical=True)


def decode_discovery_list_response(payload: bytes) -> tuple[list[dict[str, Any]], int]:
    document = cbor2.loads(payload) if payload else {0: [], 1: 0}
    candidates = [
        {
            "id": int(c[0]),
            "port_id": int(c[1]),
            "generation": int(c.get(2, 0)),
            "confidence": int(c.get(3, 0)),
            "suggested_type_id": str(c.get(4, "")),
        }
        for c in document.get(0, [])
    ]
    return candidates, int(document.get(1, 0))


# --- User JSON ↔ catalog resolution -------------------------------------------


def _driver_by_type(catalog: Catalog, type_id: str) -> CatalogDriver:
    for driver in catalog.drivers:
        if driver.type_id == type_id:
            return driver
    raise ProtocolError("invalid_argument", f"unknown module type {type_id!r} in catalog")


def _field_maps(driver: CatalogDriver) -> tuple[dict[str, CatalogField], dict[int, CatalogField]]:
    by_name = {f.name: f for f in driver.fields}
    by_id = {f.field_id: f for f in driver.fields}
    return by_name, by_id


def _resolve_properties(
    properties: dict[str, Any],
    driver: CatalogDriver,
    *,
    require_known: bool,
) -> tuple[dict[str, Any], dict[str, str]]:
    by_name, by_id = _field_maps(driver)
    resolved: dict[str, Any] = {}
    types: dict[str, str] = {}
    for key, value in properties.items():
        field: CatalogField | None = None
        if re.fullmatch(r"\d+", str(key)):
            field = by_id.get(int(key))
            field_id = int(key)
        else:
            field = by_name.get(str(key))
            if field is None and require_known:
                raise ProtocolError(
                    "invalid_argument",
                    f"unknown property field {key!r} for type {driver.type_id!r}",
                )
            if field is None:
                raise ProtocolError(
                    "invalid_argument",
                    f"catalog has no field schema for {key!r} on {driver.type_id!r}",
                )
            field_id = field.field_id
        if field is None and require_known and driver.fields:
            raise ProtocolError(
                "invalid_argument",
                f"unknown property field id {key} for type {driver.type_id!r}",
            )
        wire_type = field.type if field else infer_wire_type(value)
        wire_value = wire_value_from_json(value, wire_type)
        if field is not None:
            if field.minimum is not None and isinstance(wire_value, int):
                if wire_value < field.minimum:
                    raise ProtocolError(
                        "invalid_argument",
                        f"{field.name} below minimum {field.minimum}",
                    )
            if field.maximum is not None and isinstance(wire_value, int):
                if wire_value > field.maximum:
                    raise ProtocolError(
                        "invalid_argument",
                        f"{field.name} above maximum {field.maximum}",
                    )
        resolved[str(field_id)] = wire_value_to_json(wire_value, wire_type)
        types[str(field_id)] = wire_type
    return resolved, types


def user_json_to_config(document: dict[str, Any], catalog: Catalog) -> SpaghettiConfig:
    """Resolve human JSON (names) to wire Config using catalog field IDs."""
    if not isinstance(document, dict):
        raise ProtocolError("invalid_argument", "config JSON must be an object")
    config = empty_config()
    config.version = int(document.get("version", CONFIG_WIRE_VERSION))
    for module in document.get("modules", []):
        type_id = str(module["type"])
        driver = _driver_by_type(catalog, type_id)
        props, types = _resolve_properties(
            dict(module.get("properties", {})), driver, require_known=True
        )
        config.modules.append(
            ModuleConfig(
                key=int(module["key"]),
                port=int(module["port"]),
                type=type_id,
                properties=props,
                property_types=types,
                bay=int(module["bay"]) if "bay" in module else None,
                power_rail=int(module["power_rail"]) if "power_rail" in module else None,
            )
        )
    for schedule in document.get("schedules", []):
        config.schedules.append(
            ScheduleConfig(
                source_key=int(schedule["source_key"]),
                period_ms=int(schedule["period_ms"]),
                enabled=bool(schedule.get("enabled", True)),
            )
        )
    for rule in document.get("rules", []):
        type_id = str(rule["type"])
        driver = _driver_by_type(catalog, type_id) if catalog.drivers else CatalogDriver(type_id, 0)
        # Rules may reuse type ids from rule registry; if absent, fail.
        if not any(d.type_id == type_id for d in catalog.drivers):
            raise ProtocolError("invalid_argument", f"unknown rule type {type_id!r} in catalog")
        props, types = _resolve_properties(
            dict(rule.get("properties", {})), driver, require_known=True
        )
        config.rules.append(
            RuleConfig(
                key=int(rule["key"]),
                type=type_id,
                properties=props,
                property_types=types,
            )
        )
    if "connectivity_policy" in document:
        config.connectivity_policy = int(document["connectivity_policy"])
    if "mqtt" in document:
        mqtt = document["mqtt"]
        config.mqtt = MqttConfig(
            enabled=bool(mqtt.get("enabled", False)),
            host=str(mqtt.get("host", "")),
            port=int(mqtt.get("port", 1883)),
            base_topic=str(mqtt.get("base_topic", "spaghetti")),
            security=int(mqtt.get("security", 0)),
            credential_id=int(mqtt.get("credential_id", 0)),
        )
    if "energy_policy" in document:
        energy = document["energy_policy"]
        config.energy_policy = EnergyPolicy(
            availability=int(energy.get("availability", 0)),
            window_ms=int(energy.get("window_ms", 0)),
            period_ms=int(energy.get("period_ms", 0)),
        )
    return config


def config_to_user_json(
    config: SpaghettiConfig,
    catalog: Catalog | None = None,
    revision: ConfigRevision | None = None,
) -> dict[str, Any]:
    """Stable snake_case JSON; prefers catalog field names when available."""
    drivers = {d.type_id: d for d in (catalog.drivers if catalog else [])}

    def props_out(module: ModuleConfig) -> dict[str, Any]:
        driver = drivers.get(module.type)
        by_id = {f.field_id: f for f in driver.fields} if driver else {}
        out: dict[str, Any] = {}
        for key, value in module.properties.items():
            field = by_id.get(int(key)) if re.fullmatch(r"\d+", key) else None
            name = field.name if field else key
            wire_type = module.property_types.get(key, infer_wire_type(value))
            out[name] = wire_value_to_json(
                wire_value_from_json(value, wire_type), wire_type
            )
        return out

    document: dict[str, Any] = {
        "version": config.version,
        "modules": [
            {
                "key": m.key,
                "port": m.port,
                **({"bay": m.bay} if m.bay is not None else {}),
                **({"power_rail": m.power_rail} if m.power_rail is not None else {}),
                "type": m.type,
                "properties": props_out(m),
            }
            for m in config.modules
        ],
        "schedules": [
            {
                "source_key": s.source_key,
                "period_ms": s.period_ms,
                "enabled": s.enabled,
            }
            for s in config.schedules
        ],
        "rules": [
            {"key": r.key, "type": r.type, "properties": r.properties}
            for r in config.rules
        ],
        "blocks": [],
        "edges": [],
        "connectivity_policy": config.connectivity_policy,
        "energy_policy": {
            "availability": config.energy_policy.availability,
            "window_ms": config.energy_policy.window_ms,
            "period_ms": config.energy_policy.period_ms,
        },
        "mqtt": {
            "enabled": config.mqtt.enabled,
            "host": config.mqtt.host,
            "port": config.mqtt.port,
            "base_topic": config.mqtt.base_topic,
            "security": config.mqtt.security,
            "credential_id": config.mqtt.credential_id,
        },
    }
    if revision is not None:
        document["generation"] = revision.generation
        document["sha256"] = revision.sha256
    return document


def topology_to_json(topology: CoreTopology) -> dict[str, Any]:
    rails = []
    for rail in topology.power_rails:
        verification, enforcement = rail_verification(rail.assurance)
        rails.append(
            {
                "id": rail.id,
                "assurance": rail.assurance,
                "verification": verification,
                "enforcement": enforcement,
                "max_total_microamps": rail.max_total_microamps,
            }
        )
    return {
        "flows": [
            {
                "id": f.id,
                "port_id": f.port_id,
                "direction": f.direction,
                "signal_count": f.signal_count,
                "bays": [
                    {
                        "id": b.id,
                        "ordinal_from_field": b.ordinal_from_field,
                        "available_power_rails": list(b.available_power_rails),
                        "module_key": b.module_key,
                        "admission": b.admission,
                    }
                    for b in f.bays
                ],
            }
            for f in topology.flows
        ],
        "power_rails": rails,
    }


# --- Transport / client -------------------------------------------------------


@runtime_checkable
class ProtocolTransport(Protocol):
    name: str

    def send(self, request: bytes, timeout_ms: int) -> bytes: ...

    def close(self) -> None: ...


FakeHandler = Callable[[int, bytes, int], tuple[str, bytes] | bytes]


class FakeTransport:
    """In-memory Protocol V1 transport for unit tests."""

    def __init__(self, name: str, handler: FakeHandler) -> None:
        self.name = name
        self.handler = handler
        self.sent: list[bytes] = []
        self.fail_times = 0
        self.delay_ms = 0
        self.wrong_correlation = False
        self.closed = False
        self.disconnect_after_sends: int | None = None
        self._lock = threading.Lock()

    def send(self, request: bytes, timeout_ms: int) -> bytes:
        if self.closed:
            raise ProtocolError("unavailable", "transport closed")
        copy = bytes(request)
        with self._lock:
            self.sent.append(copy)
            send_count = len(self.sent)
        if self.disconnect_after_sends is not None and send_count > self.disconnect_after_sends:
            raise ProtocolError("unavailable", "disconnected")
        if self.fail_times > 0:
            self.fail_times -= 1
            time.sleep(min(timeout_ms, 20) / 1000.0)
            raise ProtocolTimeoutError()
        if self.delay_ms > timeout_ms:
            time.sleep((timeout_ms + 5) / 1000.0)
            raise ProtocolTimeoutError()
        if self.delay_ms > 0:
            time.sleep(self.delay_ms / 1000.0)
        correlation_id, operation, payload = decode_request(copy)
        result = self.handler(operation, payload, correlation_id)
        if isinstance(result, (bytes, bytearray)):
            status, response_payload = "ok", bytes(result)
        else:
            status, response_payload = result
        response_correlation = (
            (correlation_id + 1) if self.wrong_correlation else correlation_id
        )
        return encode_response(response_correlation, status, response_payload)

    def close(self) -> None:
        self.closed = True


class SpaghettiClient:
    """Transport-independent Protocol V1 client (sync)."""

    def __init__(
        self,
        transport: ProtocolTransport,
        *,
        default_timeout_ms: int = 5000,
        max_retries: int = 2,
        retry_delay_ms: int = 100,
        replay_window_ms: int = 5000,
        driver_schemas: Mapping[str, CatalogDriver] | None = None,
    ) -> None:
        self.transport = transport
        self.default_timeout_ms = default_timeout_ms
        self.max_retries = max_retries
        self.retry_delay_ms = retry_delay_ms
        self.replay_window_ms = replay_window_ms
        self.driver_schemas = dict(driver_schemas or {})
        self._next_correlation = secrets.randbelow(0x7FFFFFFF) + 1
        self._catalog_cache: Catalog | None = None
        self._boot_id: int | None = None
        self._closed = False
        self._recent: dict[int, tuple[bytes, float, int]] = {}

    def close(self) -> None:
        self._closed = True
        self.transport.close()

    def invalidate_catalog(self, fingerprint: str | None = None) -> None:
        if fingerprint is None or (
            self._catalog_cache and self._catalog_cache.fingerprint != fingerprint
        ):
            self._catalog_cache = None

    def get_catalog(self, force_refresh: bool = False) -> Catalog:
        if not force_refresh and self._catalog_cache is not None:
            return self._catalog_cache
        while True:
            pages: list[CatalogPage] = []
            cursor = 0
            fingerprint: str | None = None
            restart = False
            while True:
                payload = encode_get_catalog_request(cursor, 8)
                response = self._call(Operation.GET_CATALOG, payload)
                page = decode_catalog_page(response)
                if fingerprint is None:
                    fingerprint = page.fingerprint
                elif page.fingerprint != fingerprint:
                    self._catalog_cache = None
                    restart = True
                    break
                pages.append(page)
                if page.next_cursor == 0:
                    break
                cursor = page.next_cursor
            if restart:
                continue
            catalog = merge_catalog_pages(pages)
            if self.driver_schemas:
                catalog = attach_driver_schemas(catalog, self.driver_schemas)
            if (
                self._catalog_cache
                and self._catalog_cache.fingerprint != catalog.fingerprint
            ):
                self._catalog_cache = None
            self._catalog_cache = catalog
            return catalog

    def get_status(self) -> CoreStatus:
        payload = self._call(Operation.GET_STATUS, b"")
        status = decode_get_status_response(payload)
        if status.boot_id is not None:
            self._observe_boot_id(status.boot_id)
        return status

    def get_topology(self) -> CoreTopology:
        flows: list[HardwareFlow] = []
        power_rails: list[PowerRail] = []
        seen: set[int] = set()
        cursor = 0
        while True:
            response = self._call(
                Operation.GET_TOPOLOGY, encode_get_topology_request(cursor, 2)
            )
            page = decode_topology_page(response)
            flows.extend(page.flows)
            for rail in page.power_rails:
                if rail.id not in seen:
                    seen.add(rail.id)
                    power_rails.append(rail)
            if page.next_cursor == 0:
                break
            cursor = page.next_cursor
        return CoreTopology(flows=flows, power_rails=power_rails)

    def get_config(self) -> ConfigSnapshot:
        payload = self._call(Operation.GET_CONFIG, b"")
        return decode_get_config_response(payload)

    def validate_config(self, config: SpaghettiConfig) -> None:
        payload = encode_validate_config_request(config)
        response = self._call(Operation.VALIDATE_CONFIG, payload)
        decode_validate_config_response(response)

    def apply_config(
        self, config: SpaghettiConfig, expected_generation: int
    ) -> ApplyResult:
        payload = encode_apply_config_request(config, expected_generation)
        response = self._call(Operation.APPLY_CONFIG, payload)
        return decode_apply_config_response(response)

    def get_capabilities(self) -> dict[str, Any]:
        payload = self._call(Operation.GET_CAPABILITIES, b"")
        return decode_capabilities_response(payload)

    def get_connectivity_status(self) -> dict[str, Any]:
        payload = self._call(Operation.GET_CONNECTIVITY_STATUS, b"")
        return decode_connectivity_status(payload)

    def acquire_connectivity_lease(self, services: int, duration_ms: int) -> bytes:
        return self._call(
            Operation.ACQUIRE_CONNECTIVITY_LEASE,
            encode_lease_request(services, duration_ms),
        )

    def release_connectivity_lease(self) -> None:
        self._call(Operation.RELEASE_CONNECTIVITY_LEASE, b"")

    def scan_discovery(self, port_id: int, allow_state_changing: bool = False) -> None:
        self._call(
            Operation.SCAN_DISCOVERY,
            encode_scan_discovery_request(port_id, allow_state_changing),
        )

    def list_discovery(self) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        cursor = 0
        while True:
            payload = cbor2.dumps({0: cursor, 1: 8}, canonical=True)
            response = self._call(Operation.LIST_DISCOVERY, payload)
            page, next_cursor = decode_discovery_list_response(response)
            candidates.extend(page)
            if next_cursor == 0:
                break
            cursor = next_cursor
        return candidates

    def accept_discovery(self, candidate_id: int, key: int) -> None:
        self._call(
            Operation.ACCEPT_DISCOVERY,
            encode_accept_discovery_request(candidate_id, key),
        )

    def module_command(
        self, key: int, command: str, arguments: dict[str, Any] | None = None
    ) -> None:
        del arguments  # reserved; wire MODULE_COMMAND carries key+command_id
        catalog = self.get_catalog()
        try:
            command_id = int(command)
        except ValueError:
            command_id = -1
            for driver in catalog.drivers:
                for entry in driver.commands:
                    if entry.name == command:
                        command_id = entry.command_id
                        break
                if command_id >= 0:
                    break
            if command_id < 0:
                raise ProtocolError(
                    "invalid_argument", f"unknown command {command!r} in catalog"
                )
        self._call(
            Operation.MODULE_COMMAND, encode_module_command_request(key, command_id)
        )

    def factory_reset(self, scope_mask: int) -> None:
        self._call(Operation.FACTORY_RESET, encode_factory_reset_request(scope_mask))

    def _observe_boot_id(self, boot_id: int) -> None:
        if self._boot_id is not None and self._boot_id != boot_id:
            self._catalog_cache = None
            self._recent.clear()
        self._boot_id = boot_id

    def _allocate_correlation_id(self) -> int:
        for _ in range(0xFFFFFFFF):
            self._next_correlation = (
                1 if self._next_correlation == 0xFFFFFFFF else self._next_correlation + 1
            )
            if self._next_correlation == 0:
                self._next_correlation = 1
            if self._next_correlation not in self._recent:
                return self._next_correlation
        raise ProtocolError("resource_exhausted", "correlation id space exhausted")

    def _call(self, operation: Operation, payload: bytes) -> bytes:
        if self._closed:
            raise ProtocolError("unavailable", "client is closed")
        correlation_id = self._allocate_correlation_id()
        request_bytes = encode_request(correlation_id, int(operation), payload)
        sent_at = time.monotonic()
        self._recent[correlation_id] = (request_bytes, sent_at, int(operation))
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            if self._boot_id is not None and attempt > 0:
                age_ms = (time.monotonic() - sent_at) * 1000
                if age_ms > self.replay_window_ms:
                    raise ProtocolError(
                        "unavailable",
                        "replay window expired; refusing automatic retry after reconnect",
                        correlation_id,
                    )
            try:
                response_bytes = self.transport.send(
                    request_bytes, self.default_timeout_ms
                )
                resp_corr, status, _code, resp_payload = decode_response(response_bytes)
                if resp_corr != correlation_id:
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay_ms / 1000.0)
                        continue
                    raise ProtocolError(
                        "internal_error",
                        f"unexpected correlation {resp_corr}",
                        correlation_id,
                    )
                if status != "ok":
                    if status in NO_RETRY_STATUSES:
                        if status == "conflict":
                            raise ProtocolConflictError(
                                "protocol conflict", correlation_id
                            )
                        raise ProtocolError(status, status, correlation_id)
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay_ms / 1000.0)
                        continue
                    raise ProtocolError(status, status, correlation_id)
                self._recent.pop(correlation_id, None)
                return resp_payload
            except ProtocolError as exc:
                last_error = exc
                if exc.status in NO_RETRY_STATUSES:
                    self._recent.pop(correlation_id, None)
                    raise
                if isinstance(exc, ProtocolTimeoutError) or exc.status == "timeout":
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay_ms / 1000.0)
                        continue
                    self._recent.pop(correlation_id, None)
                    raise ProtocolTimeoutError(correlation_id) from exc
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay_ms / 1000.0)
                    continue
            except Exception as exc:  # noqa: BLE001 — transport failures
                last_error = ProtocolError("unavailable", str(exc), correlation_id)
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay_ms / 1000.0)
                    continue
        self._recent.pop(correlation_id, None)
        if isinstance(last_error, ProtocolError):
            raise last_error
        raise ProtocolTimeoutError(correlation_id)


# --- Fake core state + update channel -----------------------------------------


def default_ina219_schema() -> CatalogDriver:
    """Test/host schema attachment — not a hardcoded encode table in the CLI path."""
    return CatalogDriver(
        type_id="ina219",
        command_count=1,
        commands=[CatalogCommand(1, "sample")],
        fields=[
            CatalogField(1, "i2c_address", "uint64", minimum=1, maximum=127),
            CatalogField(2, "shunt_milliohm", "uint64", minimum=1, maximum=100000),
            CatalogField(
                3, "current_lsb_microamp", "uint64", minimum=1, maximum=1000000
            ),
            CatalogField(4, "large_count", "uint64"),
            CatalogField(5, "signed_extreme", "int64"),
        ],
    )


class FakeCoreState:
    """Mutable fake Core used by FakeTransport handlers and update tests."""

    def __init__(
        self,
        *,
        catalog: Catalog | None = None,
        topology: CoreTopology | None = None,
        config: SpaghettiConfig | None = None,
        generation: int = 1,
        schemas: Mapping[str, CatalogDriver] | None = None,
    ) -> None:
        self.catalog = catalog or Catalog(
            protocol_version=1,
            config_version=5,
            fingerprint="11" * 32,
            drivers=[CatalogDriver("ina219", 1)],
            driver_count=1,
        )
        self.topology = topology or CoreTopology(
            flows=[
                HardwareFlow(
                    id=0,
                    port_id=0,
                    direction="field_to_core",
                    signal_count=5,
                    bays=[
                        FunctionBay(
                            id=0,
                            ordinal_from_field=0,
                            available_power_rails=[1, 2],
                        )
                    ],
                )
            ],
            power_rails=[
                PowerRail(1, "unmanaged", 0),
                PowerRail(2, "switched", 500000),
            ],
        )
        self.config = config or empty_config()
        self.generation = generation
        self.schemas = dict(schemas or {"ina219": default_ina219_schema()})
        self.candidates: list[dict[str, Any]] = []
        self.lease_active = False
        self.capabilities = {
            "resource_profile": 1,
            "build_capabilities": 0x0F,
            "core_variant": "core-v1",
            "max_protocol_payload": 512,
            "max_inflight_requests": 2,
            "replay_window_ms": 5000,
            "max_modules": 8,
            "max_principals": 4,
        }
        self.status = CoreStatus(
            state=1,
            mode=0,
            image_state=0,
            active_slot=0,
            image_confirmed=True,
            version="1.0.0",
            port_count=1,
            boot_id=1,
        )
        self.update = FakeUpdateSession()
        self.fingerprint_override: str | None = None
        self.validate_fail = False

    def handler(self, operation: int, payload: bytes, correlation_id: int) -> tuple[str, bytes] | bytes:
        del correlation_id
        op = Operation(operation)
        if op == Operation.GET_CATALOG:
            document = cbor2.loads(payload) if payload else {}
            cursor = int(document.get(0, 0)) if isinstance(document, dict) else 0
            fingerprint = self.fingerprint_override or self.catalog.fingerprint
            drivers = self.catalog.drivers
            # Single-page unless caller mutates fingerprint mid-read via override.
            page = CatalogPage(
                protocol_version=self.catalog.protocol_version,
                config_version=self.catalog.config_version,
                fingerprint=fingerprint,
                drivers=drivers[cursor:] if cursor else drivers,
                next_cursor=0,
                driver_count=self.catalog.driver_count,
            )
            if cursor == 0 and len(drivers) > 1:
                page = CatalogPage(
                    protocol_version=self.catalog.protocol_version,
                    config_version=self.catalog.config_version,
                    fingerprint=fingerprint,
                    drivers=drivers[:1],
                    next_cursor=1,
                    driver_count=self.catalog.driver_count,
                )
            elif cursor >= 1:
                page = CatalogPage(
                    protocol_version=self.catalog.protocol_version,
                    config_version=self.catalog.config_version,
                    fingerprint=fingerprint,
                    drivers=drivers[1:],
                    next_cursor=0,
                    driver_count=self.catalog.driver_count,
                )
            return encode_catalog_page(page)
        if op == Operation.GET_STATUS:
            return encode_get_status_response(self.status)
        if op == Operation.GET_TOPOLOGY:
            return encode_topology_page(
                TopologyPage(
                    flows=self.topology.flows,
                    power_rails=self.topology.power_rails,
                    next_cursor=0,
                )
            )
        if op == Operation.GET_CONFIG:
            encoded = encode_config(self.config)
            return encode_get_config_response(
                ConfigSnapshot(
                    config=self.config,
                    revision=ConfigRevision(
                        generation=self.generation,
                        sha256=hashlib.sha256(encoded).hexdigest(),
                    ),
                )
            )
        if op == Operation.VALIDATE_CONFIG:
            if self.validate_fail:
                return encode_validate_config_response(False, field=1, index=0, reason=1)
            return encode_validate_config_response(True)
        if op == Operation.APPLY_CONFIG:
            document = cbor2.loads(payload)
            expected = int(document[0])
            if expected != self.generation:
                return ("conflict", b"")
            new_config = decode_config(document[1])
            new_hash = hashlib.sha256(encode_config(new_config)).hexdigest()
            old_hash = hashlib.sha256(encode_config(self.config)).hexdigest()
            changed = new_hash != old_hash
            self.config = new_config
            if changed:
                self.generation += 1
            return encode_apply_config_response(
                ApplyResult(
                    changed=changed,
                    revision=ConfigRevision(
                        generation=self.generation, sha256=new_hash
                    ),
                )
            )
        if op == Operation.GET_CAPABILITIES:
            return encode_capabilities_response(self.capabilities)
        if op == Operation.GET_CONNECTIVITY_STATUS:
            return encode_connectivity_status(
                {
                    "policy": 1,
                    "active_services": 2 if self.lease_active else 0,
                    "leased_services": 2 if self.lease_active else 0,
                    "lease_expires_at_ms": 120000 if self.lease_active else 0,
                    "last_error": 0,
                }
            )
        if op == Operation.ACQUIRE_CONNECTIVITY_LEASE:
            self.lease_active = True
            return cbor2.dumps({0: "127.0.0.1", 1: 1337, 2: 120000, 3: 2}, canonical=True)
        if op == Operation.RELEASE_CONNECTIVITY_LEASE:
            self.lease_active = False
            return b""
        if op == Operation.SCAN_DISCOVERY:
            document = cbor2.loads(payload)
            port_id = int(document[0])
            self.candidates = [
                {
                    "id": 1,
                    "port_id": port_id,
                    "generation": 1,
                    "confidence": 2,
                    "suggested_type_id": "ina219",
                }
            ]
            return b""
        if op == Operation.LIST_DISCOVERY:
            return encode_discovery_list_response(self.candidates, 0)
        if op == Operation.ACCEPT_DISCOVERY:
            return b""
        if op == Operation.MODULE_COMMAND:
            return b""
        if op == Operation.FACTORY_RESET:
            return b""
        if op == Operation.GET_UPDATE_STATUS:
            return self.update.status_payload()
        if op == Operation.OPEN_BLE_UPDATE:
            return self.update.open(payload)
        if op == Operation.WRITE_BLE_UPDATE:
            return self.update.write(payload)
        if op == Operation.FINISH_BLE_UPDATE:
            return self.update.finish()
        if op == Operation.CANCEL_BLE_UPDATE:
            return self.update.cancel()
        return ("unsupported", b"")


@dataclass
class FakeUpdateSession:
    """Shared update state for UART/Wi-Fi/BLE fake channels."""

    device_id: str = "device-1"
    session_id: int = 0
    image_hash: str = ""
    total_size: int = 0
    offset: int = 0
    active: bool = False
    version: str = "1.0.0"
    confirmed: bool = True
    active_slot: int = 0
    disconnect_at_percent: float | None = None
    cancelled: bool = False

    def status_payload(self) -> bytes:
        return cbor2.dumps(
            {
                0: 1 if self.active else 0,
                1: 1,
                2: 5000,
                3: self.active_slot,
                4: self.confirmed,
                5: self.offset,
                6: self.total_size,
                7: self.session_id,
                8: self.image_hash,
                9: self.version,
            },
            canonical=True,
        )

    def open(self, payload: bytes) -> bytes:
        document = cbor2.loads(payload) if payload else {}
        image_size = int(document.get(0, 0))
        image_hash = (
            bytes_to_hex(document[1])
            if isinstance(document.get(1), (bytes, bytearray))
            else str(document.get(1, ""))
        )
        version = str(document.get(2, "0.0.0"))
        self.session_id = self.session_id + 1 or 1
        self.total_size = image_size
        self.image_hash = image_hash
        self.offset = 0
        self.active = True
        self.cancelled = False
        self.version = version
        self.confirmed = False
        return cbor2.dumps({0: self.session_id, 1: 0}, canonical=True)

    def write(self, payload: bytes) -> tuple[str, bytes] | bytes:
        if not self.active:
            return ("busy", b"")
        document = cbor2.loads(payload)
        session_id = int(document[0])
        offset = int(document[1])
        data = document[2]
        if session_id != self.session_id:
            return ("conflict", b"")
        if offset != self.offset:
            return ("invalid_argument", b"")
        if self.disconnect_at_percent is not None and self.total_size:
            percent = 100.0 * (self.offset / self.total_size)
            if percent >= self.disconnect_at_percent:
                raise ProtocolError("unavailable", "update link disconnected")
        self.offset = offset + len(data)
        return cbor2.dumps({0: self.offset}, canonical=True)

    def finish(self) -> tuple[str, bytes] | bytes:
        if not self.active or self.offset != self.total_size:
            return ("invalid_argument", b"")
        self.active = False
        self.confirmed = False  # trial finalize
        self.active_slot = 1 - self.active_slot
        return cbor2.dumps({0: self.version, 1: self.active_slot, 2: False}, canonical=True)

    def cancel(self) -> bytes:
        self.active = False
        self.cancelled = True
        self.offset = 0
        self.total_size = 0
        self.session_id = 0
        return b""


@dataclass
class UpdateResumeState:
    device_id: str
    image_hash: str
    total_size: int
    session_id: int
    offset: int


class UpdateChannel(Protocol):
    def read_status(self) -> dict[str, Any]: ...

    def write_chunk(self, offset: int, total: int, data: bytes) -> int: ...

    def cancel(self) -> None: ...

    def finalize_trial(self) -> dict[str, Any]: ...


class FakeMgmtUpdateChannel:
    """UART/Wi-Fi style chunk channel used by unit tests."""

    CHUNK_MAX = 192

    def __init__(self, session: FakeUpdateSession, device_id: str = "device-1") -> None:
        self.session = session
        self.device_id = device_id

    def read_status(self) -> dict[str, Any]:
        return {
            "device_id": self.device_id,
            "offset": self.session.offset,
            "total": self.session.total_size,
            "session_id": self.session.session_id,
            "image_hash": self.session.image_hash,
            "version": self.session.version,
            "active_slot": self.session.active_slot,
            "confirmed": self.session.confirmed,
        }

    def begin(self, total: int, image_hash: str, version: str) -> None:
        self.session.open(
            cbor2.dumps({0: total, 1: hex_to_bytes(image_hash), 2: version}, canonical=True)
            if len(image_hash) == 64
            else cbor2.dumps({0: total, 1: image_hash, 2: version}, canonical=True)
        )

    def write_chunk(self, offset: int, total: int, data: bytes) -> int:
        if len(data) > self.CHUNK_MAX:
            raise ProtocolError("invalid_argument", "chunk exceeds 192 bytes")
        if not self.session.active:
            self.begin(total, self.session.image_hash or ("00" * 32), self.session.version)
            self.session.total_size = total
        result = self.session.write(
            cbor2.dumps(
                {0: self.session.session_id, 1: offset, 2: data}, canonical=True
            )
        )
        if isinstance(result, tuple):
            raise ProtocolError(result[0], result[0])
        return int(cbor2.loads(result)[0])

    def cancel(self) -> None:
        self.session.cancel()

    def finalize_trial(self) -> dict[str, Any]:
        result = self.session.finish()
        if isinstance(result, tuple):
            raise ProtocolError(result[0], result[0])
        document = cbor2.loads(result)
        return {
            "version": str(document[0]),
            "active_slot": int(document[1]),
            "confirmed": bool(document[2]),
        }


def verify_signed_image_local(path: Path) -> dict[str, Any]:
    """Local header/hash checks; optionally delegates to imgtool when available."""
    data = path.read_bytes()
    if len(data) < 32:
        raise ProtocolError("invalid_argument", f"image too small: {path}")
    magic = int.from_bytes(data[0:4], "little")
    if magic != 0x96F3B83D:
        raise ProtocolError("invalid_argument", f"invalid MCUboot magic: {path}")
    image_size = int.from_bytes(data[12:16], "little")
    major, minor = data[20], data[21]
    revision = int.from_bytes(data[22:24], "little")
    build = int.from_bytes(data[24:28], "little")
    version = f"{major}.{minor}.{revision}+{build}"
    digest = hashlib.sha256(data).hexdigest()
    # Best-effort imgtool verify — never required for fake tests.
    try:
        import shutil
        import subprocess

        imgtool = shutil.which("imgtool")
        if imgtool:
            subprocess.run(
                [imgtool, "verify", str(path)],
                check=False,
                capture_output=True,
                text=True,
            )
    except OSError:
        pass
    return {
        "path": str(path),
        "size": len(data),
        "image_size": image_size,
        "version": version,
        "sha256": digest,
        "bytes": data,
    }


def run_update(
    channel: FakeMgmtUpdateChannel,
    image_path: Path,
    *,
    resume: UpdateResumeState | None = None,
    progress_cb: Callable[[int, int, float], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """Send ordered chunks, show progress, trial-finalize, cancel on request."""
    meta = verify_signed_image_local(image_path)
    data: bytes = meta["bytes"]
    total = len(data)
    image_hash = meta["sha256"]
    device_id = channel.device_id

    if resume is not None:
        if (
            resume.device_id != device_id
            or resume.image_hash != image_hash
            or resume.total_size != total
            or resume.session_id == 0
        ):
            channel.cancel()
            resume = None
        else:
            status = channel.read_status()
            if (
                status.get("session_id") != resume.session_id
                or status.get("image_hash") != image_hash
                or status.get("total") != total
            ):
                channel.cancel()
                resume = None

    if resume is None:
        channel.begin(total, image_hash, meta["version"])
        offset = 0
    else:
        offset = resume.offset

    started = time.monotonic()
    try:
        while offset < total:
            if cancel_event is not None and cancel_event.is_set():
                channel.cancel()
                raise ProtocolError("unavailable", "update cancelled")
            chunk = data[offset : offset + FakeMgmtUpdateChannel.CHUNK_MAX]
            offset = channel.write_chunk(offset, total, chunk)
            elapsed = max(time.monotonic() - started, 1e-6)
            throughput = offset / elapsed
            if progress_cb:
                progress_cb(offset, total, throughput)
        result = channel.finalize_trial()
        # Reconnect verification (fake immediate).
        status = channel.read_status()
        if status.get("confirmed") is True:
            raise ProtocolError("internal_error", "update finalized as confirmed")
        result["trial"] = True
        result["sha256"] = image_hash
        return result
    except KeyboardInterrupt:
        channel.cancel()
        raise


def parse_duration_ms(text: str) -> int:
    match = re.fullmatch(r"(\d+)(ms|s|m)?", text.strip())
    if not match:
        raise ProtocolError("invalid_argument", f"invalid duration {text!r}")
    value = int(match.group(1))
    unit = match.group(2) or "s"
    if unit == "ms":
        return value
    if unit == "s":
        return value * 1000
    return value * 60_000


def parse_services(text: str) -> int:
    mask = 0
    for part in text.split(","):
        name = part.strip().lower()
        if not name:
            continue
        if name not in SERVICE_BITS:
            raise ProtocolError("invalid_argument", f"unknown service {name!r}")
        mask |= SERVICE_BITS[name]
    if mask == 0:
        raise ProtocolError("invalid_argument", "at least one service required")
    return mask


def parse_reset_scope(text: str) -> int:
    if text not in RESET_SCOPES:
        raise ProtocolError(
            "invalid_argument",
            f"unknown reset scope {text!r}; use config|network|credentials|bonds|all",
        )
    return RESET_SCOPES[text]


def stable_json_dumps(document: Any) -> str:
    return json.dumps(document, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
