"""Application BLE challenge / HMAC proof (PROTOCOL_V1.md)."""

from __future__ import annotations

import hashlib
import hmac
import struct

from tools.spaghetti_gateway.constants import (
    AUTH_CHALLENGE_SIZE,
    AUTH_CHALLENGE_TYPE,
    AUTH_PROOF_SIZE,
    AUTH_PROOF_TYPE,
    DEVICE_ID_SIZE,
    HMAC_SIZE,
    KEY_SIZE,
    NONCE_SIZE,
)


def parse_challenge(data: bytes) -> tuple[int, bytes]:
    """Return (session_id, nonce) from an event notify challenge."""
    if len(data) < AUTH_CHALLENGE_SIZE:
        raise ValueError("challenge too short")
    if data[0] != AUTH_CHALLENGE_TYPE:
        raise ValueError("not a challenge frame")
    session_id = struct.unpack_from("<I", data, 1)[0]
    nonce = data[5 : 5 + NONCE_SIZE]
    return session_id, nonce


def build_proof(
    key: bytes,
    nonce: bytes,
    device_id: bytes,
    session_id: int,
    credential_id: int,
) -> bytes:
    """Build the request-characteristic proof write."""
    if len(key) != KEY_SIZE:
        raise ValueError("key must be 32 bytes")
    if len(nonce) != NONCE_SIZE:
        raise ValueError("nonce must be 32 bytes")
    if len(device_id) != DEVICE_ID_SIZE:
        raise ValueError("device_id must be 32 bytes")
    if not 0 <= credential_id <= 0xFFFF:
        raise ValueError("credential_id out of range")

    message = nonce + device_id + struct.pack("<I", session_id)
    digest = hmac.new(key, message, hashlib.sha256).digest()
    assert len(digest) == HMAC_SIZE
    return (
        bytes([AUTH_PROOF_TYPE])
        + struct.pack("<H", credential_id)
        + digest
    )


def verify_proof(
    key: bytes,
    nonce: bytes,
    device_id: bytes,
    session_id: int,
    proof: bytes,
) -> int:
    """Verify a proof write; return credential_id on success."""
    if len(proof) != AUTH_PROOF_SIZE:
        raise ValueError("proof size mismatch")
    if proof[0] != AUTH_PROOF_TYPE:
        raise ValueError("not a proof frame")
    credential_id = struct.unpack_from("<H", proof, 1)[0]
    expected = build_proof(key, nonce, device_id, session_id, credential_id)
    if not hmac.compare_digest(proof, expected):
        raise ValueError("HMAC mismatch")
    return credential_id
