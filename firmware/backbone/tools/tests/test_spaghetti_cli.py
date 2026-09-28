#!/usr/bin/env python3
"""Fake-transport coverage for Spaghetti CLI V1 (TASK-380)."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
import threading
import unittest
from unittest import mock

from tools import spaghetti as spaghetti_cli
from tools.spaghetti_protocol import (
    Catalog,
    CatalogDriver,
    CatalogField,
    CatalogPage,
    FakeCoreState,
    FakeMgmtUpdateChannel,
    FakeTransport,
    FakeUpdateSession,
    JS_SAFE_MAX,
    Operation,
    ProtocolConflictError,
    ProtocolError,
    ProtocolTimeoutError,
    SpaghettiClient,
    UpdateResumeState,
    config_sha256,
    config_to_user_json,
    decode_request,
    decode_response,
    encode_catalog_page,
    encode_config,
    encode_request,
    encode_response,
    integer_from_json,
    integer_to_json,
    load_credentials_file,
    parse_duration_ms,
    parse_reset_scope,
    parse_services,
    run_update,
    stable_json_dumps,
    status_exit_code,
    topology_to_json,
    user_json_to_config,
    verify_signed_image_local,
    wire_value_from_json,
)


MCUBOOT_MAGIC = 0x96F3B83D


def _make_image(path: Path, size: int = 400) -> Path:
    header = bytearray(32)
    struct.pack_into("<I", header, 0, MCUBOOT_MAGIC)
    struct.pack_into("<I", header, 12, size)
    header[20] = 2
    header[21] = 3
    struct.pack_into("<H", header, 22, 4)
    struct.pack_into("<I", header, 24, 5)
    path.write_bytes(bytes(header) + os.urandom(max(0, size - 32)))
    return path


class IntegerJsonTest(unittest.TestCase):
    def test_outside_safe_range_is_decimal_string(self) -> None:
        huge = (1 << 63) - 1
        self.assertEqual(integer_to_json(huge), str(huge))
        self.assertEqual(integer_from_json(str(huge)), huge)
        self.assertEqual(integer_to_json(JS_SAFE_MAX), JS_SAFE_MAX)
        with self.assertRaises(ProtocolError):
            integer_from_json(JS_SAFE_MAX + 1)

    def test_uint64_negative_rejected(self) -> None:
        with self.assertRaises(ProtocolError):
            wire_value_from_json("-1", "uint64")


class EnvelopeTest(unittest.TestCase):
    def test_request_response_roundtrip(self) -> None:
        raw = encode_request(7, Operation.GET_STATUS, b"")
        corr, op, payload = decode_request(raw)
        self.assertEqual((corr, op, payload), (7, 2, b""))
        resp = encode_response(7, "ok", b"")
        c2, status, code, _ = decode_response(resp)
        self.assertEqual((c2, status, code), (7, "ok", 0))

    def test_status_exit_codes(self) -> None:
        self.assertEqual(status_exit_code("ok"), 0)
        self.assertEqual(status_exit_code("conflict"), 4)
        self.assertEqual(status_exit_code("timeout"), 7)


class CatalogConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self.state = FakeCoreState()
        self.transport = FakeTransport("fake", self.state.handler)
        self.client = SpaghettiClient(
            self.transport,
            default_timeout_ms=500,
            max_retries=1,
            retry_delay_ms=1,
            driver_schemas=self.state.schemas,
        )

    def tearDown(self) -> None:
        self.client.close()

    def test_catalog_not_local_ina_table(self) -> None:
        catalog = self.client.get_catalog()
        self.assertEqual(catalog.drivers[0].type_id, "ina219")
        # CLI resolves names only via attached catalog schema, not a private table.
        document = {
            "modules": [
                {
                    "key": 10,
                    "port": 0,
                    "bay": 0,
                    "power_rail": 1,
                    "type": "ina219",
                    "properties": {
                        "i2c_address": 64,
                        "shunt_milliohm": 100,
                        "current_lsb_microamp": 200,
                    },
                }
            ],
            "schedules": [{"source_key": 10, "period_ms": 1000, "enabled": True}],
            "rules": [],
        }
        config = user_json_to_config(document, catalog)
        self.assertEqual(config.modules[0].properties["1"], 64)
        self.assertEqual(config.modules[0].properties["2"], 100)

    def test_unknown_type_and_field(self) -> None:
        catalog = self.client.get_catalog()
        with self.assertRaises(ProtocolError):
            user_json_to_config(
                {"modules": [{"key": 1, "port": 0, "type": "nope", "properties": {}}]},
                catalog,
            )
        with self.assertRaises(ProtocolError):
            user_json_to_config(
                {
                    "modules": [
                        {
                            "key": 1,
                            "port": 0,
                            "type": "ina219",
                            "properties": {"unknown_field": 1},
                        }
                    ]
                },
                catalog,
            )

    def test_range_validation(self) -> None:
        catalog = self.client.get_catalog()
        with self.assertRaises(ProtocolError):
            user_json_to_config(
                {
                    "modules": [
                        {
                            "key": 1,
                            "port": 0,
                            "type": "ina219",
                            "properties": {"i2c_address": 200},
                        }
                    ]
                },
                catalog,
            )

    def test_int64_uint64_in_user_json(self) -> None:
        catalog = self.client.get_catalog()
        huge = str((1 << 64) - 1)
        tiny = str(-(1 << 63))
        config = user_json_to_config(
            {
                "modules": [
                    {
                        "key": 1,
                        "port": 0,
                        "type": "ina219",
                        "properties": {
                            "i2c_address": 64,
                            "large_count": huge,
                            "signed_extreme": tiny,
                        },
                    }
                ]
            },
            catalog,
        )
        self.assertEqual(config.modules[0].properties["4"], huge)
        self.assertEqual(config.modules[0].properties["5"], tiny)
        out = config_to_user_json(config, catalog)
        self.assertEqual(out["modules"][0]["properties"]["large_count"], huge)

    def test_config_validate_and_apply_generation(self) -> None:
        catalog = self.client.get_catalog()
        document = {
            "modules": [
                {
                    "key": 10,
                    "port": 0,
                    "type": "ina219",
                    "properties": {"i2c_address": 64},
                }
            ],
            "schedules": [],
            "rules": [],
        }
        config = user_json_to_config(document, catalog)
        self.client.validate_config(config)
        result = self.client.apply_config(config, 1)
        self.assertTrue(result.changed)
        self.assertEqual(result.revision.generation, 2)
        # identical apply → changed=false
        again = self.client.apply_config(config, 2)
        self.assertFalse(again.changed)
        self.assertEqual(again.revision.generation, 2)

    def test_config_conflict_not_forced(self) -> None:
        catalog = self.client.get_catalog()
        before = len(self.transport.sent)
        config = user_json_to_config(
            {
                "modules": [
                    {
                        "key": 1,
                        "port": 0,
                        "type": "ina219",
                        "properties": {"i2c_address": 64},
                    }
                ]
            },
            catalog,
        )
        with self.assertRaises(ProtocolConflictError):
            self.client.apply_config(config, 99)
        # conflict is never auto-retried (exactly one APPLY attempt)
        apply_sends = [
            decode_request(frame)[1]
            for frame in self.transport.sent[before:]
        ]
        self.assertEqual(apply_sends, [Operation.APPLY_CONFIG])

    def test_fingerprint_cache_and_invalidation(self) -> None:
        first = self.client.get_catalog()
        before = len(self.transport.sent)
        second = self.client.get_catalog()
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(len(self.transport.sent), before)
        self.client.invalidate_catalog("ff" * 32)
        self.client.get_catalog()
        self.assertGreater(len(self.transport.sent), before)

    def test_fingerprint_change_mid_pagination(self) -> None:
        reads = {"n": 0}
        fingerprint = {"v": "11" * 32}

        def handler(operation: int, payload: bytes, correlation_id: int):
            del correlation_id
            if operation != Operation.GET_CATALOG:
                return self.state.handler(operation, payload, 1)
            reads["n"] += 1
            import cbor2

            cursor = int(cbor2.loads(payload).get(0, 0)) if payload else 0
            if reads["n"] == 2:
                fingerprint["v"] = "22" * 32
            if cursor == 0:
                return encode_catalog_page(
                    CatalogPage(
                        1,
                        5,
                        fingerprint["v"],
                        [CatalogDriver("a", 0)],
                        1,
                        2,
                    )
                )
            return encode_catalog_page(
                CatalogPage(
                    1,
                    5,
                    fingerprint["v"],
                    [CatalogDriver("b", 0)],
                    0,
                    2,
                )
            )

        transport = FakeTransport("fake", handler)
        client = SpaghettiClient(transport, default_timeout_ms=200, max_retries=0)
        catalog = client.get_catalog(True)
        self.assertEqual(catalog.fingerprint, "22" * 32)
        self.assertEqual([d.type_id for d in catalog.drivers], ["a", "b"])
        client.close()

    def test_retry_preserves_bytes_and_correlation(self) -> None:
        self.transport.fail_times = 1
        self.client.get_status()
        self.assertEqual(len(self.transport.sent), 2)
        self.assertEqual(self.transport.sent[0], self.transport.sent[1])
        a = decode_request(self.transport.sent[0])
        b = decode_request(self.transport.sent[1])
        self.assertEqual(a[0], b[0])

    def test_wrong_correlation_then_timeout_path(self) -> None:
        self.transport.wrong_correlation = True
        with self.assertRaises(ProtocolError):
            self.client.get_status()

    def test_duplicate_response_ok(self) -> None:
        status = self.client.get_status()
        self.assertEqual(status.version, "1.0.0")

    def test_topology_unverified_vs_enforced(self) -> None:
        topology = self.client.get_topology()
        document = topology_to_json(topology)
        rails = {r["id"]: r for r in document["power_rails"]}
        self.assertEqual(rails[1]["verification"], "unverified")
        self.assertEqual(rails[1]["enforcement"], "manual jumper")
        self.assertEqual(rails[2]["enforcement"], "enforced")

    def test_capabilities_lease_reset(self) -> None:
        caps = self.client.get_capabilities()
        self.assertEqual(caps["core_variant"], "core-v1")
        self.client.acquire_connectivity_lease(parse_services("wifi"), 120_000)
        snap = self.client.get_connectivity_status()
        self.assertEqual(snap["leased_services"], 2)
        self.client.release_connectivity_lease()
        self.client.factory_reset(parse_reset_scope("config"))

    def test_discovery_flow(self) -> None:
        self.client.scan_discovery(0, allow_state_changing=True)
        candidates = self.client.list_discovery()
        self.assertEqual(candidates[0]["suggested_type_id"], "ina219")
        self.client.accept_discovery(1, 10)

    def test_module_command_from_catalog_name(self) -> None:
        self.client.module_command(10, "sample")


class CredentialsTest(unittest.TestCase):
    def test_insecure_permissions_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "creds.json"
            path.write_text(
                json.dumps({"identity": "core", "psk": "ab" * 32}), encoding="utf-8"
            )
            os.chmod(path, 0o644)
            with self.assertRaises(ProtocolError):
                load_credentials_file(str(path))

    def test_secure_permissions_ok(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "creds.json"
            path.write_text(
                json.dumps({"identity": "core", "psk": "ab" * 32}), encoding="utf-8"
            )
            os.chmod(path, 0o600)
            document = load_credentials_file(str(path))
            self.assertEqual(document["identity"], "core")


class UpdateTest(unittest.TestCase):
    def test_progress_trial_and_cancel(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = _make_image(Path(tmp) / "signed.bin", 500)
            session = FakeUpdateSession()
            channel = FakeMgmtUpdateChannel(session)
            progress: list[tuple[int, int]] = []
            result = run_update(
                channel,
                image,
                progress_cb=lambda o, t, thr: progress.append((o, t)),
            )
            self.assertTrue(result["trial"])
            self.assertFalse(result["confirmed"])
            self.assertTrue(progress)
            self.assertFalse(session.confirmed)

    def test_disconnect_mid_transfer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = _make_image(Path(tmp) / "signed.bin", 800)
            session = FakeUpdateSession(disconnect_at_percent=10.0)
            channel = FakeMgmtUpdateChannel(session)
            with self.assertRaises(ProtocolError):
                run_update(channel, image)

    def test_resume_mismatch_cancels_and_restarts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = _make_image(Path(tmp) / "signed.bin", 400)
            session = FakeUpdateSession()
            channel = FakeMgmtUpdateChannel(session, device_id="device-1")
            meta = verify_signed_image_local(image)
            bad_resume = UpdateResumeState(
                device_id="other",
                image_hash=meta["sha256"],
                total_size=meta["size"],
                session_id=9,
                offset=64,
            )
            result = run_update(channel, image, resume=bad_resume)
            self.assertTrue(result["trial"])
            self.assertGreater(session.session_id, 0)

    def test_resume_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = _make_image(Path(tmp) / "signed.bin", 400)
            session = FakeUpdateSession()
            channel = FakeMgmtUpdateChannel(session)
            meta = verify_signed_image_local(image)
            channel.begin(meta["size"], meta["sha256"], meta["version"])
            # write one chunk then resume
            first = meta["bytes"][:192]
            offset = channel.write_chunk(0, meta["size"], first)
            resume = UpdateResumeState(
                device_id="device-1",
                image_hash=meta["sha256"],
                total_size=meta["size"],
                session_id=session.session_id,
                offset=offset,
            )
            result = run_update(channel, image, resume=resume)
            self.assertTrue(result["trial"])


class CliInvocationTest(unittest.TestCase):
    def _run(self, argv: list[str], fake_state: FakeCoreState | None = None) -> tuple[int, str, str]:
        state = fake_state or FakeCoreState()
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch("sys.stdout", stdout), mock.patch("sys.stderr", stderr):
            # Inject fake state through environment + monkeypatch build_client
            original = spaghetti_cli.build_client

            def build(args):
                args.fake = True
                args._fake_state = state
                return original(args)

            with mock.patch.object(spaghetti_cli, "build_client", side_effect=build):
                code = spaghetti_cli.main(["--fake", *argv])
        return code, stdout.getvalue(), stderr.getvalue()

    def test_json_stable_catalog_and_quiet(self) -> None:
        code, out, _ = self._run(["catalog", "--json"])
        self.assertEqual(code, 0)
        first = out
        code2, out2, _ = self._run(["catalog", "--json"])
        self.assertEqual(first, out2)
        json.loads(out)
        code3, out3, _ = self._run(["catalog", "--quiet"])
        self.assertEqual(code3, 0)
        self.assertEqual(out3, "")

    def test_config_apply_conflict_exit(self) -> None:
        state = FakeCoreState(generation=5)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab.json"
            path.write_text(
                json.dumps(
                    {
                        "modules": [
                            {
                                "key": 1,
                                "port": 0,
                                "type": "ina219",
                                "properties": {"i2c_address": 64},
                            }
                        ],
                        "schedules": [],
                        "rules": [],
                        "generation": 1,
                    }
                ),
                encoding="utf-8",
            )
            code, out, _ = self._run(
                ["config", "apply", str(path), "--json"], fake_state=state
            )
            self.assertEqual(code, 4)
            self.assertIn("conflict", out)

    def test_config_validate_apply_get(self) -> None:
        state = FakeCoreState()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lab.json"
            path.write_text(
                json.dumps(
                    {
                        "modules": [
                            {
                                "key": 10,
                                "port": 0,
                                "bay": 0,
                                "power_rail": 1,
                                "type": "ina219",
                                "properties": {
                                    "i2c_address": 64,
                                    "shunt_milliohm": 100,
                                    "current_lsb_microamp": 200,
                                },
                            }
                        ],
                        "schedules": [
                            {"source_key": 10, "period_ms": 1000, "enabled": True}
                        ],
                        "rules": [],
                    }
                ),
                encoding="utf-8",
            )
            code, _, _ = self._run(
                ["config", "validate", str(path), "--json"], fake_state=state
            )
            self.assertEqual(code, 0)
            code, out, _ = self._run(
                ["config", "apply", str(path), "--json"], fake_state=state
            )
            self.assertEqual(code, 0)
            document = json.loads(out)
            self.assertTrue(document["changed"])
            code, out, _ = self._run(["config", "get", "--json"], fake_state=state)
            self.assertEqual(code, 0)
            got = json.loads(out)
            self.assertEqual(got["modules"][0]["properties"]["i2c_address"], 64)

    def test_topology_json_fields(self) -> None:
        code, out, _ = self._run(["topology", "--json"])
        self.assertEqual(code, 0)
        document = json.loads(out)
        self.assertIn("flows", document)
        self.assertIn("power_rails", document)
        self.assertEqual(document["flows"][0]["signal_count"], 5)

    def test_factory_reset_requires_yes_when_quiet(self) -> None:
        code, _, err = self._run(["factory-reset", "--scope", "all", "--quiet"])
        self.assertNotEqual(code, 0)
        code, _, _ = self._run(["factory-reset", "--scope", "all", "--yes", "--quiet"])
        self.assertEqual(code, 0)

    def test_update_uart_fake(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = _make_image(Path(tmp) / "signed.bin", 450)
            code, out, _ = self._run(["update", "uart", str(image), "--json"])
            self.assertEqual(code, 0)
            document = json.loads(out)
            self.assertTrue(document["trial"])
            self.assertFalse(document["confirmed"])

    def test_connectivity_and_module(self) -> None:
        code, _, _ = self._run(
            ["connectivity", "lease", "--services", "wifi", "--duration", "120s", "--json"]
        )
        self.assertEqual(code, 0)
        code, _, _ = self._run(["connectivity", "status", "--json"])
        self.assertEqual(code, 0)
        code, _, _ = self._run(["connectivity", "release", "--quiet"])
        self.assertEqual(code, 0)
        code, _, _ = self._run(["module", "command", "10", "sample", "--quiet"])
        self.assertEqual(code, 0)

    def test_invalid_json_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{", encoding="utf-8")
            code, _, err = self._run(["config", "validate", str(path)])
            self.assertNotEqual(code, 0)
            self.assertIn("invalid", err.lower())


class HelpersTest(unittest.TestCase):
    def test_duration_and_services(self) -> None:
        self.assertEqual(parse_duration_ms("120s"), 120_000)
        self.assertEqual(parse_duration_ms("500ms"), 500)
        self.assertEqual(parse_services("wifi,mqtt"), (1 << 1) | (1 << 2))
        self.assertEqual(parse_reset_scope("bonds"), 1 << 3)

    def test_stable_json(self) -> None:
        text = stable_json_dumps({"b": 1, "a": 2})
        self.assertTrue(text.startswith('{\n  "a"'))


if __name__ == "__main__":
    unittest.main()
