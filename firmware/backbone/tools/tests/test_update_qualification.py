"""Tests for deterministic update-qualification evidence helpers."""

import struct
from pathlib import Path
import tempfile
import unittest

from tools.update_qualification import (
    MCUBOOT_IMAGE_MAGIC,
    QualificationError,
    generated_version,
    mcuboot_image_metadata,
    report_case_statuses,
)


class UpdateQualificationTest(unittest.TestCase):
    """Verify public-header parsing and strict report status extraction."""

    def test_parse_mcuboot_header(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "signed.bin"
            image.write_bytes(
                struct.pack(
                    "<IIHHIIBBHII",
                    MCUBOOT_IMAGE_MAGIC,
                    0,
                    32,
                    0,
                    4096,
                    0,
                    1,
                    2,
                    3,
                    4,
                    0,
                )
            )

            metadata = mcuboot_image_metadata(image)

            self.assertEqual(metadata["version"], "1.2.3+4")
            self.assertEqual(metadata["image_size"], 4096)

    def test_reject_invalid_header_and_duplicate_report_case(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "invalid.bin"
            image.write_bytes(bytes(32))
            with self.assertRaises(QualificationError):
                mcuboot_image_metadata(image)

        duplicate = (
            "| Q-001 | Common | Action | Expected | PASS | Evidence |\n"
            "| Q-001 | UART | Action | Expected | NOT RUN | Evidence |\n"
        )
        with self.assertRaises(QualificationError):
            report_case_statuses(duplicate)

    def test_extract_report_statuses(self) -> None:
        report = (
            "| ID | Transport | Action | Expected | Status | Evidence |\n"
            "|---|---|---|---|---|---|\n"
            "| Q-001 | Common | Action | Expected | PASS | log |\n"
            "| Q-002 | Wi-Fi | Action | Expected | NOT RUN | - |\n"
        )

        self.assertEqual(
            report_case_statuses(report),
            {"Q-001": "PASS", "Q-002": "NOT RUN"},
        )

    def test_read_generated_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            header = Path(directory) / "version.h"
            header.write_text(
                '#define APP_VERSION_STRING           "1.2.3"\n',
                encoding="utf-8",
            )

            self.assertEqual(
                generated_version(header, "APP_VERSION_STRING"), "1.2.3"
            )


if __name__ == "__main__":
    unittest.main()
