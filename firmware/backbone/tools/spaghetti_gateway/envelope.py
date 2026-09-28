"""Minimal Protocol V1 CBOR envelope codec (passthrough-friendly)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cbor2

from tools.spaghetti_gateway.constants import (
    ENVELOPE_MAX,
    KEY_CORRELATION,
    KEY_OPCODE,
    KEY_PAYLOAD,
    KEY_VERSION,
    PROTOCOL_VERSION,
)


@dataclass(frozen=True)
class Envelope:
    """Canonical V1 map: version / correlation-or-sequence / opcode / payload."""

    version: int
    field1: int
    field2: int
    payload: bytes

    @property
    def correlation_id(self) -> int:
        return self.field1

    @property
    def operation(self) -> int:
        return self.field2

    @property
    def status(self) -> int:
        return self.field2

    @property
    def event_type(self) -> int:
        return self.field2

    @property
    def sequence(self) -> int:
        return self.field1


def encode_envelope(envelope: Envelope) -> bytes:
    if envelope.version != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    if len(envelope.payload) > ENVELOPE_MAX:
        raise ValueError("payload exceeds absolute maximum")
    document: dict[int, Any] = {
        KEY_VERSION: envelope.version,
        KEY_CORRELATION: envelope.field1,
        KEY_OPCODE: envelope.field2,
        KEY_PAYLOAD: envelope.payload,
    }
    encoded = cbor2.dumps(document, canonical=True)
    if len(encoded) > ENVELOPE_MAX:
        raise ValueError("encoded envelope exceeds absolute maximum")
    return encoded


def decode_envelope(data: bytes) -> Envelope:
    if not data:
        raise ValueError("empty envelope")
    if len(data) > ENVELOPE_MAX:
        raise ValueError("envelope exceeds absolute maximum")
    document = cbor2.loads(data)
    if not isinstance(document, dict):
        raise ValueError("envelope must be a CBOR map")
    try:
        version = int(document[KEY_VERSION])
        field1 = int(document[KEY_CORRELATION])
        field2 = int(document[KEY_OPCODE])
        payload = document[KEY_PAYLOAD]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("malformed envelope keys") from exc
    if not isinstance(payload, (bytes, bytearray)):
        raise ValueError("payload must be a byte string")
    if version != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    return Envelope(
        version=version,
        field1=field1,
        field2=field2,
        payload=bytes(payload),
    )


def encode_request(correlation_id: int, operation: int, payload: bytes = b"") -> bytes:
    if correlation_id == 0:
        raise ValueError("correlation_id must be nonzero")
    return encode_envelope(
        Envelope(
            version=PROTOCOL_VERSION,
            field1=correlation_id,
            field2=operation,
            payload=payload,
        )
    )


def encode_response(
    correlation_id: int,
    status: int,
    payload: bytes = b"",
) -> bytes:
    return encode_envelope(
        Envelope(
            version=PROTOCOL_VERSION,
            field1=correlation_id,
            field2=status,
            payload=payload,
        )
    )


def encode_event(event_type: int, sequence: int, payload: bytes = b"") -> bytes:
    return encode_envelope(
        Envelope(
            version=PROTOCOL_VERSION,
            field1=sequence,
            field2=event_type,
            payload=payload,
        )
    )


def correlation_of(data: bytes) -> int:
    return decode_envelope(data).correlation_id
