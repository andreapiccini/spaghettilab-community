"""Shared Protocol V1 golden vectors (contracts/protocol-v1/vectors/v1).

TypeScript SDK and this Python suite must read the same JSON files. C host/CLI
coverage lands in phase 380; until then Python+TS are the gate.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import cbor2

VECTORS = Path(__file__).resolve().parents[4] / "contracts/protocol-v1/vectors/v1"


class ProtocolVectorTest(unittest.TestCase):
    def test_vector_files_exist(self) -> None:
        names = sorted(p.stem for p in VECTORS.glob("*.json"))
        self.assertEqual(
            names,
            [
                "catalog",
                "config",
                "error",
                "int64min",
                "record",
                "request",
                "response",
                "uint64max",
            ],
        )

    def test_each_vector_decodes(self) -> None:
        for path in sorted(VECTORS.glob("*.json")):
            with self.subTest(path.name):
                doc = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(doc["name"], path.stem)
                raw = bytes.fromhex(doc["cbor_hex"])
                decoded = cbor2.loads(raw)
                self.assertIsNotNone(decoded)
                # Re-encode may differ (definite vs indefinite); decode must succeed.
                roundtrip = cbor2.loads(cbor2.dumps(decoded))
                self.assertEqual(roundtrip, decoded)

    def test_request_envelope_keys(self) -> None:
        doc = json.loads((VECTORS / "request.json").read_text(encoding="utf-8"))
        decoded = cbor2.loads(bytes.fromhex(doc["cbor_hex"]))
        self.assertEqual(decoded[0], 1)
        self.assertEqual(decoded[1], doc["normalized"]["correlation_id"])
        self.assertEqual(decoded[2], doc["normalized"]["operation"])
        self.assertIsInstance(decoded[3], (bytes, bytearray))

    def test_extreme_integers(self) -> None:
        int64 = json.loads((VECTORS / "int64min.json").read_text(encoding="utf-8"))
        uint64 = json.loads((VECTORS / "uint64max.json").read_text(encoding="utf-8"))
        self.assertEqual(cbor2.loads(bytes.fromhex(int64["cbor_hex"])), -(1 << 63))
        self.assertEqual(cbor2.loads(bytes.fromhex(uint64["cbor_hex"])), (1 << 64) - 1)
        self.assertEqual(int64["normalized"]["value"], str(-(1 << 63)))
        self.assertEqual(uint64["normalized"]["value"], str((1 << 64) - 1))

    def test_firmware_get_status_request_matches_native_sim_vector(self) -> None:
        # Pinned in tests/protocol/src/main.c test_envelope_golden_vectors.
        expected = bytes.fromhex("bf0001010102020340ff")
        doc = json.loads((VECTORS / "request.json").read_text(encoding="utf-8"))
        self.assertEqual(bytes.fromhex(doc["cbor_hex"]), expected)


if __name__ == "__main__":
    unittest.main()
