"""Host-side tests for protected remote-console credentials."""

import json
import os
from pathlib import Path
import tempfile
import unittest

from tools.device import (
    NetworkLineEditor,
    ToolError,
    create_network_credentials,
    network_credentials,
)


class NetworkLineEditorTest(unittest.TestCase):
    """Verify local editing for the restricted network console."""

    def test_history_replaces_remote_and_visible_line(self) -> None:
        editor = NetworkLineEditor()

        self.assertEqual(editor.process(b"help"), (b"help", b"help"))
        self.assertEqual(editor.process(b"\r"), (b"\r", b"\r"))
        self.assertEqual(editor.process(b"draft"), (b"draft", b"draft"))

        wire, echo = editor.process(b"\x1b[A")
        self.assertEqual(wire, (b"\x7f" * 5) + b"help")
        self.assertEqual(echo, b"\r\x1b[2Knetwork:~$ help")

        wire, echo = editor.process(b"\x1b[B")
        self.assertEqual(wire, (b"\x7f" * 4) + b"draft")
        self.assertEqual(echo, b"\r\x1b[2Knetwork:~$ draft")

    def test_fragmented_arrow_and_unsupported_cursor_key(self) -> None:
        editor = NetworkLineEditor()
        editor.process(b"spaghetti status\r")

        self.assertEqual(editor.process(b"\x1b["), (b"", b""))
        wire, echo = editor.process(b"A")
        self.assertEqual(wire, b"spaghetti status")
        self.assertTrue(echo.endswith(b"spaghetti status"))
        self.assertEqual(editor.process(b"\x1b[D"), (b"", b""))

    def test_history_is_bounded_and_control_u_clears_line(self) -> None:
        editor = NetworkLineEditor()
        for index in range(NetworkLineEditor.HISTORY_LIMIT + 4):
            editor.process(f"command-{index}\r".encode())

        self.assertEqual(len(editor.history), NetworkLineEditor.HISTORY_LIMIT)
        editor.process(b"temporary")
        wire, echo = editor.process(b"\x15")
        self.assertEqual(wire, b"\x7f" * len(b"temporary"))
        self.assertEqual(echo, b"\r\x1b[2Knetwork:~$ ")


class RemoteConsoleCredentialTest(unittest.TestCase):
    """Verify creation, validation, and non-overwrite behavior."""

    def test_create_and_read_owner_only_credential(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "keys" / "core.json"

            created = create_network_credentials(str(path), "core-v1")
            identity, psk = network_credentials(str(created))
            document = json.loads(created.read_text(encoding="utf-8"))

            self.assertEqual(created, path)
            self.assertEqual(identity, "core-v1")
            self.assertEqual(len(psk), 32)
            self.assertEqual(len(document["psk"]), 64)
            if os.name != "nt":
                self.assertEqual(created.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ToolError):
                create_network_credentials(str(path), "core-v1")

    def test_reject_invalid_identity_and_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"

            with self.assertRaises(ToolError):
                create_network_credentials(str(path), "identity with spaces")
            path.write_text(
                json.dumps({"identity": "core-v1", "psk": "00"}),
                encoding="utf-8",
            )
            if os.name != "nt":
                path.chmod(0o600)
            with self.assertRaises(ToolError):
                network_credentials(str(path))


if __name__ == "__main__":
    unittest.main()
