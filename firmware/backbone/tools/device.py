#!/usr/bin/env python3
"""Cross-platform host helper for Zephyr flashing and serial consoles."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
import glob
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import ssl
import stat
import secrets
import subprocess
import sys
import time
from typing import Iterator


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DOMAINS_FILE = BUILD / "domains.yaml"
ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])")
ZEPHYR_LOG_RE = re.compile(
    r"^\[(?P<time>[^]]+)]\s+<(?P<level>[^>]+)>\s+"
    r"(?P<module>[^:]+):\s*(?P<message>.*)$"
)


class ToolError(RuntimeError):
    """An actionable host-tool error."""


def windows_ports() -> list[str]:
    """Read serial port names from the Windows registry."""
    try:
        import winreg
    except ImportError:
        return []

    ports: list[str] = []
    key_path = r"HARDWARE\DEVICEMAP\SERIALCOMM"
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
            index = 0
            while True:
                try:
                    ports.append(str(winreg.EnumValue(key, index)[1]))
                    index += 1
                except OSError:
                    break
    except OSError:
        pass
    return ports


def serial_ports() -> list[str]:
    """Return likely physical USB serial ports for the current host."""
    system = platform.system()
    if system == "Windows":
        return sorted(set(windows_ports()))

    if system == "Darwin":
        patterns = (
            "/dev/cu.usbmodem*",
            "/dev/cu.usbserial*",
            "/dev/cu.SLAB_USBtoUART*",
            "/dev/cu.wchusbserial*",
        )
    else:
        by_id = sorted(glob.glob("/dev/serial/by-id/*"))
        if by_id:
            return by_id
        patterns = ("/dev/ttyACM*", "/dev/ttyUSB*")

    return sorted({port for pattern in patterns for port in glob.glob(pattern)})


def selected_port(explicit: str | None) -> str:
    """Use an explicit port or require one unambiguous detected port."""
    if explicit:
        return explicit

    ports = serial_ports()
    if not ports:
        raise ToolError(
            "No USB serial port detected. Connect the board with a data cable, "
            "run 'make ports', or pass PORT=<device>."
        )
    if len(ports) > 1:
        choices = "\n  ".join(ports)
        raise ToolError(
            "More than one USB serial port was detected. Select one with "
            f"PORT=<device>:\n  {choices}"
        )
    return ports[0]


def read_required(path: Path, purpose: str) -> str:
    """Read a generated build file or explain how to create it."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ToolError(
            f"Missing {purpose}: {path.relative_to(ROOT)}. Run 'make build' first."
        ) from exc


def sysbuild_domain_names() -> list[str]:
    """Return domains in generated flash order, or an empty legacy-build marker."""
    if not DOMAINS_FILE.is_file():
        return []

    text = read_required(DOMAINS_FILE, "sysbuild domain configuration")
    lines = text.splitlines()
    try:
        start_idx = lines.index("flash_order:") + 1
    except ValueError as exc:
        raise ToolError("The sysbuild domain configuration has no flash_order list.")

    names: list[str] = []
    for line in lines[start_idx:]:
        match = re.fullmatch(r"\s+-\s+(\S+)\s*", line)
        if match is None:
            break
        names.append(match.group(1))
    if not names:
        raise ToolError("The sysbuild flash_order list is empty.")
    return names


def runner_configurations() -> list[tuple[Path, str]]:
    """Read runner configurations for a legacy build or all sysbuild domains."""
    domain_names = sysbuild_domain_names()
    if not domain_names:
        path = BUILD / "zephyr" / "runners.yaml"
        return [(path, read_required(path, "Zephyr runner configuration"))]

    configurations: list[tuple[Path, str]] = []
    for name in domain_names:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise ToolError(f"Invalid sysbuild domain name: {name!r}.")
        path = BUILD / name / "zephyr" / "runners.yaml"
        configurations.append(
            (path, read_required(path, f"runner configuration for domain {name}"))
        )
    return configurations


def zephyr_runner() -> tuple[str, list[tuple[Path, str]]]:
    """Return one common flash runner and its ordered image configurations."""
    configurations = runner_configurations()
    runner_names: list[str] = []

    for _, text in configurations:
        match = re.search(r"(?m)^flash-runner:\s*(\S+)\s*$", text)
        if match is None:
            raise ToolError("A build domain does not define a default flash runner.")
        runner_names.append(match.group(1))

    if any(name != runner_names[0] for name in runner_names[1:]):
        raise ToolError("Sysbuild domains require different flash runners.")
    return runner_names[0], configurations


def yaml_argument(text: str, name: str, default: str | None = None) -> str:
    """Read one scalar runner argument from Zephyr's generated YAML."""
    match = re.search(rf"(?m)^\s*-\s+--{re.escape(name)}=(.*)$", text)
    if match:
        return match.group(1).strip()
    if default is not None:
        return default
    raise ToolError(f"The Zephyr runner did not provide --{name}.")


def kconfig_string(name: str) -> str:
    """Read a quoted Kconfig value from the active build."""
    domain_names = sysbuild_domain_names()
    config_file = (
        BUILD / "app" / "zephyr" / ".config"
        if domain_names
        else BUILD / "zephyr" / ".config"
    )
    text = read_required(config_file, "Zephyr build configuration")
    match = re.search(rf'(?m)^{re.escape(name)}="([^"]+)"$', text)
    if not match:
        raise ToolError(f"The Zephyr build does not define {name}.")
    return match.group(1)


def esptool_prefix() -> list[str]:
    """Find the host esptool command."""
    command = shutil.which("esptool") or shutil.which("esptool.py")
    if command:
        return [command]
    try:
        __import__("esptool")
        return [sys.executable, "-m", "esptool"]
    except ImportError as exc:
        raise ToolError(
            "The Espressif runner requires esptool on the host. Install it and retry."
        ) from exc


def esp32_image_arguments(
    configurations: list[tuple[Path, str]],
) -> list[str]:
    """Resolve ordered flash addresses and binaries from generated runner files."""
    arguments: list[str] = []

    for runners_file, text in configurations:
        match = re.search(r"(?m)^\s+bin_file:\s*(\S+)\s*$", text)
        if match is None:
            raise ToolError(f"Runner file has no bin_file: {runners_file}.")
        image = runners_file.parent / match.group(1)
        if not image.is_file():
            raise ToolError(f"Missing generated firmware image: {image}.")
        arguments.extend(
            [yaml_argument(text, "esp-app-address", "0x0"), str(image)]
        )
    return arguments


def esp32_command(
    port: str,
    baud: int,
    configurations: list[tuple[Path, str]],
) -> list[str]:
    """Build one esptool command for a legacy image or all sysbuild domains."""
    chip = kconfig_string("CONFIG_SOC")
    runner_text = configurations[0][1]

    return [
        *esptool_prefix(),
        "--chip",
        chip,
        "--port",
        port,
        "--baud",
        str(baud),
        "write-flash",
        "--flash-mode",
        yaml_argument(runner_text, "esp-flash-mode", "keep"),
        "--flash-freq",
        yaml_argument(runner_text, "esp-flash-freq", "keep"),
        "--flash-size",
        yaml_argument(runner_text, "esp-flash-size", "detect"),
        *esp32_image_arguments(configurations),
    ]


def generic_west_command() -> list[str]:
    """Delegate non-Espressif runners to a host Zephyr installation."""
    west = shutil.which("west")
    if not west:
        raise ToolError(
            "This build uses a non-Espressif runner. Install a compatible Zephyr "
            "host environment (including west and the runner utility), then retry."
        )
    return [west, "flash", "-d", str(BUILD)]


def run_flash(args: argparse.Namespace) -> int:
    """Flash with the runner selected by the active Zephyr build."""
    runner, configurations = zephyr_runner()
    if runner == "esp32":
        port = selected_port(args.port)
        command = esp32_command(port, args.baud, configurations)
    else:
        command = generic_west_command()
        if args.port:
            print(
                f"Note: runner '{runner}' controls device selection; PORT is not a "
                "portable Zephyr runner option.",
                file=sys.stderr,
            )

    print(f"Flash runner: {runner}")
    print("Command: " + " ".join(command))
    if args.dry_run:
        return 0
    return subprocess.call(command, cwd=ROOT)


def run_screen(args: argparse.Namespace) -> int:
    """Open the selected serial port with the native host monitor."""
    port = selected_port(args.port)
    if platform.system() == "Windows":
        command = [
            sys.executable,
            "-m",
            "serial.tools.miniterm",
            port,
            str(args.baud),
        ]
    else:
        screen = shutil.which("screen")
        if not screen:
            raise ToolError("The serial console requires 'screen' on this host.")
        command = [screen, port, str(args.baud)]

    print(f"Opening {port} at {args.baud} baud.")
    return subprocess.call(command)


def monitor_dependencies():
    """Load optional monitor dependencies or provide one install command."""
    try:
        import serial
        from rich import box
        from rich.console import Console
        from rich.panel import Panel
        from rich.table import Table
        from rich.text import Text
    except ImportError as exc:
        raise ToolError(
            "The styled monitor requires pyserial and rich. Install them once with "
            "'make host-tools', or use 'make monitor' to install them automatically."
        ) from exc

    return serial, Console, Panel, Table, Text, box


def clean_terminal_text(value: str) -> str:
    """Remove terminal control sequences before applying host-side styling."""
    return ANSI_ESCAPE_RE.sub("", value).replace("\r", "")


def zephyr_log_parts(value: str) -> tuple[str, str, str, str] | None:
    """Parse one plain Zephyr log line into stable display fields."""
    match = ZEPHYR_LOG_RE.match(clean_terminal_text(value))
    if match is None:
        return None
    return (
        match.group("time"),
        match.group("level"),
        match.group("module"),
        match.group("message"),
    )


class StyledSerialOutput:
    """Format complete Zephyr lines while preserving interactive shell bytes."""

    def __init__(self, console, text_type, panel_type, table_type, box_style) -> None:
        self.console = console
        self.text_type = text_type
        self.panel_type = panel_type
        self.table_type = table_type
        self.box_style = box_style
        self.pending = bytearray()
        self.at_line_start = True
        self.shell_prompt_seen = False
        self.wifi_scan_active = False
        self.wifi_scan_rows: list[list[str]] = []
        self.wifi_help_active = False
        self.wifi_help_lines: list[str] = []
        self.wifi_status_active = False
        self.wifi_status_lines: list[str] = []

    def _raw(self, data: bytes) -> None:
        self.console.file.buffer.write(data)
        self.console.file.buffer.flush()

    def _print_shell_prompt(self, data: bytes) -> None:
        """Forward a Zephyr shell prompt without changing its terminal style."""
        self.shell_prompt_seen = True
        self._raw(data)

    def _print_line(self, data: bytes) -> None:
        value = clean_terminal_text(data.decode("utf-8", errors="replace"))
        stripped = value.strip()

        if stripped == "wifi - Wi-Fi commands":
            self.wifi_help_active = True
            self.wifi_help_lines.clear()
            return

        if self.wifi_help_active:
            if stripped != "Subcommands:":
                self.wifi_help_lines.append(value)
            return

        if stripped == "Status: successful":
            self.wifi_status_active = True
            self.wifi_status_lines.clear()
            return

        if self.wifi_status_active:
            if stripped and set(stripped) != {"="}:
                self.wifi_status_lines.append(value)
            return

        if stripped == "Scan requested":
            self.wifi_scan_active = True
            self.wifi_scan_rows.clear()
            self.console.print("  [cyan]◌ scanning for Wi-Fi networks…[/]")
            return

        if (
            self.wifi_scan_active
            and "Num" in stripped
            and "SSID" in stripped
        ):
            return

        row_match = re.search(r"(?:^|\s)(\d+\s*\|.*)$", stripped)
        if self.wifi_scan_active and row_match is not None:
            cells = [cell.strip() for cell in row_match.group(1).split("|")]
            if len(cells) == 7:
                self.wifi_scan_rows.append(cells)
                return

        if self.wifi_scan_active and "Scan request done" in stripped:
            self._print_wifi_scan_table()
            self.wifi_scan_active = False
            self.wifi_scan_rows.clear()
            return

        if self.wifi_scan_active and re.search(r"\w+:~\$", stripped):
            return

        parts = zephyr_log_parts(value)
        if parts is None:
            if value:
                self.console.print(value, style="white", highlight=False)
            else:
                self.console.print()
            return

        timestamp, level, module, message = parts
        if "ZEPHYR FATAL ERROR" in message:
            self.console.print(
                self.panel_type.fit(
                    f"[bold red]{message}[/]\n"
                    f"[dim]{timestamp} · {module}[/]",
                    title="[bold red]Firmware fault[/]",
                    border_style="red",
                    padding=(0, 2),
                )
            )
            return

        level_styles = {
            "dbg": ("DBG", "dim cyan"),
            "inf": ("INF", "green"),
            "wrn": ("WRN", "yellow"),
            "err": ("ERR", "bold red"),
        }
        label, level_style = level_styles.get(
            level.lower(), (level.upper(), "white")
        )
        line = self.text_type()
        line.append(f" {timestamp:>16} ", style="dim")
        line.append(f" {label:^3} ", style=f"reverse {level_style}")
        line.append(f"  {module:<28}", style="bold cyan")
        line.append(message, style=level_style if level.lower() == "err" else "white")
        self.console.print(line, highlight=False)

    def _print_wifi_scan_table(self) -> None:
        table = self.table_type(
            title=f"Nearby Wi-Fi networks  [dim]({len(self.wifi_scan_rows)})[/]",
            box=self.box_style.ROUNDED,
            border_style="white",
            header_style="bold blue",
            title_style="bold white",
            expand=True,
            pad_edge=True,
        )
        table.add_column("#", justify="right", style="dim", no_wrap=True)
        table.add_column("Network", ratio=1, min_width=22, overflow="ellipsis")
        table.add_column("Channel", justify="center", style="cyan", no_wrap=True)
        table.add_column("Signal", justify="right", no_wrap=True)
        table.add_column("Security", style="yellow", no_wrap=True)

        for row in self.wifi_scan_rows:
            number, ssid_cell, channel, rssi_cell, security, bssid, mfp = row
            ssid = re.sub(r"\s+\d+\s*$", "", ssid_cell)
            channel = re.sub(r"\s+", " ", channel)
            channel = re.sub(r"^(\d+) \(([^)]+)\)$", r"\1 · \2", channel)
            try:
                rssi = int(rssi_cell)
            except ValueError:
                rssi_style = "white"
            else:
                if rssi >= -60:
                    rssi_style = "green"
                elif rssi >= -75:
                    rssi_style = "yellow"
                else:
                    rssi_style = "red"
            rssi_text = self.text_type(f"{rssi_cell} dBm", style=rssi_style)
            network = self.text_type(ssid, style="bold white")
            network.append(f"\n{bssid} · MFP {mfp.lower()}", style="dim")
            table.add_row(number, network, channel, rssi_text, security)

        self.console.print(table)
        self.console.print("  [green]● scan complete[/]")

    def _print_wifi_help_table(self) -> None:
        entries: list[tuple[str, str, list[str]]] = []
        command = ""
        description = ""
        details: list[str] = []

        for line in self.wifi_help_lines:
            entry = re.match(r"^\s{2}(\S+)\s+:\s*(.*)$", line)
            if entry is not None:
                if command:
                    entries.append((command, description, details))
                command = entry.group(1)
                description = entry.group(2).strip()
                details = []
                continue

            if command and line.strip():
                details.append(line.strip())

        if command:
            entries.append((command, description, details))

        table = self.table_type(
            title=f"Wi-Fi commands  [dim]({len(entries)})[/]",
            box=self.box_style.ROUNDED,
            border_style="white",
            header_style="bold blue",
            title_style="bold white",
            expand=True,
            pad_edge=True,
            show_lines=True,
        )
        table.add_column("Command", style="bold green", no_wrap=True)
        table.add_column("Description and usage", ratio=1)

        for command, description, details in entries:
            information = self.text_type(description, style="white")
            if details:
                information.append("\n")
                for index, detail in enumerate(details):
                    if index:
                        information.append("\n")
                    style = "yellow" if detail.startswith("Usage:") else "dim white"
                    information.append(detail, style=style)
            table.add_row(command, information)

        self.console.print(table)
        self.console.print("  [green]● command list complete[/]")

    def _print_wifi_status_table(self) -> None:
        fields: list[tuple[str, str]] = []

        for line in self.wifi_status_lines:
            if ":" not in line:
                continue
            label, value = line.split(":", 1)
            label = label.strip()
            value = value.strip()
            if value == "*float*":
                value = "unavailable · firmware float formatting disabled"
            fields.append((label, value))

        table = self.table_type(
            title="Wi-Fi connection",
            box=self.box_style.ROUNDED,
            border_style="white",
            header_style="bold blue",
            title_style="bold white",
            expand=True,
            pad_edge=True,
        )
        table.add_column("Property", style="bold blue", no_wrap=True)
        table.add_column("Value", ratio=1)

        for label, value in fields:
            value_style = "white"
            if label == "State":
                value_style = "bold green" if value == "COMPLETED" else "yellow"
            elif label == "SSID":
                value_style = "bold white"
            elif label in {"Security", "MFP"}:
                value_style = "yellow"
            elif label in {"Interface Mode", "Link Mode", "Band", "Channel"}:
                value_style = "cyan"
            elif label == "RSSI":
                try:
                    rssi = int(value)
                except ValueError:
                    value_style = "white"
                else:
                    if rssi >= -60:
                        value_style = "green"
                    elif rssi >= -75:
                        value_style = "yellow"
                    else:
                        value_style = "red"
                    value = f"{value} dBm"
            elif "unavailable" in value:
                value_style = "dim yellow"
            table.add_row(label, self.text_type(value, style=value_style))

        self.console.print(table)
        self.console.print("  [green]● Wi-Fi status received[/]")

    def feed(self, data: bytes) -> None:
        """Consume serial bytes without delaying the interactive shell prompt."""
        for byte in data:
            if self.wifi_status_active:
                self.pending.append(byte)
                if byte == ord("\n"):
                    line = bytes(self.pending).rstrip(b"\r\n")
                    self.pending.clear()
                    self._print_line(line)
                    self.at_line_start = True
                    continue

                visible = clean_terminal_text(
                    self.pending.decode("utf-8", errors="ignore")
                )
                if re.search(r"\w+:~\$ $", visible):
                    self._print_wifi_status_table()
                    self.wifi_status_active = False
                    self.wifi_status_lines.clear()
                    self._print_shell_prompt(bytes(self.pending))
                    self.pending.clear()
                    self.at_line_start = False
                continue

            if self.wifi_help_active:
                self.pending.append(byte)
                if byte == ord("\n"):
                    line = bytes(self.pending).rstrip(b"\r\n")
                    self.pending.clear()
                    self._print_line(line)
                    self.at_line_start = True
                    continue

                visible = clean_terminal_text(
                    self.pending.decode("utf-8", errors="ignore")
                )
                if re.search(r"\w+:~\$ $", visible):
                    self._print_wifi_help_table()
                    self.wifi_help_active = False
                    self.wifi_help_lines.clear()
                    self._print_shell_prompt(bytes(self.pending))
                    self.pending.clear()
                    self.at_line_start = False
                continue

            if self.wifi_scan_active:
                self.pending.append(byte)
                if byte == ord("\n"):
                    line = bytes(self.pending).rstrip(b"\r\n")
                    self.pending.clear()
                    self._print_line(line)
                    self.at_line_start = True
                continue

            if not self.at_line_start:
                self._raw(bytes((byte,)))
                if byte == ord("\n"):
                    self.at_line_start = True
                continue

            self.pending.append(byte)
            if byte == ord("\n"):
                line = bytes(self.pending).rstrip(b"\r\n")
                self.pending.clear()
                self._print_line(line)
                self.at_line_start = True
                continue

            visible = clean_terminal_text(
                self.pending.decode("utf-8", errors="ignore")
            )
            if visible.endswith("$ "):
                self._print_shell_prompt(bytes(self.pending))
                self.pending.clear()
                self.at_line_start = False

    def flush(self) -> None:
        """Write any incomplete device output before stopping the monitor."""
        if self.pending:
            self._raw(bytes(self.pending))
            self.pending.clear()

    def begin_connection(self) -> None:
        """Reset line parsing after a new serial transport is opened."""
        self.pending.clear()
        self.at_line_start = True
        self.shell_prompt_seen = False
        self.wifi_scan_active = False
        self.wifi_scan_rows.clear()
        self.wifi_help_active = False
        self.wifi_help_lines.clear()
        self.wifi_status_active = False
        self.wifi_status_lines.clear()

    def end_connection(self) -> None:
        """Close an interrupted interactive line before reconnecting."""
        had_open_line = bool(self.pending) or not self.at_line_start
        self.flush()
        if had_open_line:
            self._raw(b"\x1b[0m\r\n")
        self.at_line_start = True
        self.shell_prompt_seen = False


@contextmanager
def raw_stdin() -> Iterator[None]:
    """Forward keys immediately on POSIX and restore the terminal on exit."""
    if platform.system() == "Windows" or not sys.stdin.isatty():
        yield
        return

    import termios
    descriptor = sys.stdin.fileno()
    previous = termios.tcgetattr(descriptor)
    current = termios.tcgetattr(descriptor)
    current[3] &= ~(termios.ECHO | termios.ICANON | termios.ISIG)
    current[6][termios.VMIN] = 1
    current[6][termios.VTIME] = 0
    try:
        termios.tcsetattr(descriptor, termios.TCSADRAIN, current)
        yield
    finally:
        termios.tcsetattr(descriptor, termios.TCSADRAIN, previous)


def read_host_key() -> bytes | None:
    """Return all currently available host input without blocking."""
    if platform.system() == "Windows":
        import msvcrt

        available = bytearray()
        while msvcrt.kbhit():
            available.extend(msvcrt.getch())
        return bytes(available) if available else None

    import select

    readable, _, _ = select.select([sys.stdin], [], [], 0.02)
    return os.read(sys.stdin.fileno(), 64) if readable else None


def is_monitor_exit_key(key: bytes | None) -> bool:
    """Recognize portable monitor-only exit keys before forwarding input."""
    return key is not None and (b"\x18" in key or b"\x1d" in key)


class NetworkLineEditor:
    """Keep bounded command history for the restricted network console."""

    HISTORY_LIMIT = 32

    def __init__(self, prompt: bytes = b"network:~$ ") -> None:
        self.prompt = prompt
        self.history: list[bytes] = []
        self.line = bytearray()
        self.history_index: int | None = None
        self.draft = b""
        self.pending_control = bytearray()

    def reset_line(self) -> None:
        """Discard an incomplete line while preserving session history."""
        self.line.clear()
        self.history_index = None
        self.draft = b""
        self.pending_control.clear()

    def _replace_line(self, replacement: bytes) -> tuple[bytes, bytes]:
        wire = (b"\x7f" * len(self.line)) + replacement
        self.line[:] = replacement
        echo = b"\r\x1b[2K" + self.prompt + replacement
        return wire, echo

    def _history_up(self) -> tuple[bytes, bytes]:
        if not self.history:
            return b"", b""
        if self.history_index is None:
            self.draft = bytes(self.line)
            self.history_index = len(self.history) - 1
        else:
            self.history_index = max(0, self.history_index - 1)
        return self._replace_line(self.history[self.history_index])

    def _history_down(self) -> tuple[bytes, bytes]:
        if self.history_index is None:
            return b"", b""
        if self.history_index < (len(self.history) - 1):
            self.history_index += 1
            replacement = self.history[self.history_index]
        else:
            self.history_index = None
            replacement = self.draft
        return self._replace_line(replacement)

    def _remember_line(self) -> None:
        command = bytes(self.line).strip()
        if command and (not self.history or self.history[-1] != command):
            self.history.append(command)
            del self.history[:-self.HISTORY_LIMIT]
        self.line.clear()
        self.history_index = None
        self.draft = b""

    def process(self, keys: bytes) -> tuple[bytes, bytes]:
        """Return bytes for the device and bytes echoed on the host terminal."""
        data = bytes(self.pending_control) + keys
        self.pending_control.clear()
        wire = bytearray()
        echo = bytearray()
        index = 0

        while index < len(data):
            byte = data[index]
            if byte == 0x1b:
                end = index + 1
                if end >= len(data):
                    self.pending_control.extend(data[index:])
                    break
                if data[end] != ord("["):
                    index += 2
                    continue
                end += 1
                while end < len(data) and not 0x40 <= data[end] <= 0x7e:
                    end += 1
                if end >= len(data):
                    self.pending_control.extend(data[index:])
                    break
                if data[end] == ord("A"):
                    replacement_wire, replacement_echo = self._history_up()
                    wire.extend(replacement_wire)
                    echo.extend(replacement_echo)
                elif data[end] == ord("B"):
                    replacement_wire, replacement_echo = self._history_down()
                    wire.extend(replacement_wire)
                    echo.extend(replacement_echo)
                index = end + 1
                continue

            if byte in (0x00, 0xe0):
                if (index + 1) >= len(data):
                    self.pending_control.extend(data[index:])
                    break
                code = data[index + 1]
                if code == ord("H"):
                    replacement_wire, replacement_echo = self._history_up()
                    wire.extend(replacement_wire)
                    echo.extend(replacement_echo)
                elif code == ord("P"):
                    replacement_wire, replacement_echo = self._history_down()
                    wire.extend(replacement_wire)
                    echo.extend(replacement_echo)
                index += 2
                continue

            if byte == 0x03:
                wire.append(byte)
                self.reset_line()
            elif byte == 0x15:
                replacement_wire, replacement_echo = self._replace_line(b"")
                wire.extend(replacement_wire)
                echo.extend(replacement_echo)
                self.history_index = None
                self.draft = b""
            elif byte in (0x08, 0x7f):
                if self.line:
                    self.line.pop()
                    wire.append(0x7f)
                    echo.extend(b"\b \b")
                self.history_index = None
            elif byte in (ord("\r"), ord("\n")):
                wire.append(byte)
                echo.append(byte)
                self._remember_line()
            elif 0x20 <= byte <= 0x7e:
                self.line.append(byte)
                wire.append(byte)
                echo.append(byte)
                self.history_index = None
            index += 1

        return bytes(wire), bytes(echo)


def monitor_header(console, panel_type, endpoint: str, detail: str) -> None:
    """Show one calm session summary without consuming vertical space later."""
    console.print(
        panel_type.fit(
            f"[bold cyan]Spaghetti LAB[/]  [dim]multi-transport monitor[/]\n"
            f"[green]●[/] [bold]{endpoint}[/]  [dim]{detail}[/]\n"
            "[dim]Ctrl+X closes · Ctrl+C is sent to console[/]",
            border_style="cyan",
            padding=(0, 2),
        )
    )


def network_credentials(path_text: str | None) -> tuple[str, bytes]:
    """Load a protected TLS-PSK credential file without an insecure fallback."""
    if not path_text:
        raise ToolError(
            "Network monitor requires CREDENTIALS=<protected JSON file>."
        )
    path = Path(path_text).expanduser()
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ToolError(f"Cannot read remote-console credentials: {path}.") from exc
    if os.name != "nt" and mode & 0o077:
        raise ToolError(
            f"Credential file {path} is accessible by other users; run "
            f"'chmod 600 {path}'."
        )
    if not isinstance(document, dict):
        raise ToolError("Credential JSON must contain one object.")
    identity = document.get("identity")
    psk_hex = document.get("psk")
    if not isinstance(identity, str) or not 1 <= len(identity.encode()) <= 32:
        raise ToolError("Credential identity must contain 1 to 32 UTF-8 bytes.")
    if not isinstance(psk_hex, str) or not re.fullmatch(
        r"[0-9A-Fa-f]{64}", psk_hex
    ):
        raise ToolError("Credential psk must contain exactly 64 hexadecimal digits.")
    return identity, bytes.fromhex(psk_hex)


def create_network_credentials(path_text: str | None, identity: str) -> Path:
    """Create one owner-only remote-console credential without overwriting."""
    if not path_text:
        raise ToolError("Credential creation requires CREDENTIALS=<JSON file>.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", identity):
        raise ToolError(
            "IDENTITY must contain 1 to 32 letters, digits, '.', '_' or '-'."
        )
    path = Path(path_text).expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    document = json.dumps(
        {"identity": identity, "psk": secrets.token_hex(32)}, indent=2
    ) + "\n"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(path, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(document)
    except FileExistsError as exc:
        raise ToolError(
            f"Credential file already exists and was not replaced: {path}."
        ) from exc
    except OSError as exc:
        raise ToolError(f"Cannot create credential file: {path}.") from exc
    return path


def serial_dependency():
    """Load pyserial for non-interactive local provisioning commands."""
    try:
        import serial
    except ImportError as exc:
        raise ToolError(
            "Local provisioning requires pyserial; run 'make host-tools'."
        ) from exc
    return serial


def open_serial_without_reset(serial, port: str, baud: int):
    """Open ESP USB-Serial/JTAG without asserting boot or reset lines."""
    connection = serial.Serial()
    connection.port = port
    connection.baudrate = baud
    connection.timeout = 0.05
    connection.write_timeout = 0.5
    connection.dtr = False
    connection.rts = False
    # pyserial normally sends DTR/RTS ioctls while opening the port. On the
    # ESP32-C3 native USB-Serial/JTAG peripheral those transitions reset the
    # chip. Temporarily mark both lines as flow-controlled so open() leaves
    # their existing state untouched, then disable flow control without
    # writing either modem-control line.
    connection.dsrdtr = True
    connection.rtscts = True
    try:
        connection.open()
        if os.name != "nt":
            import fcntl
            import struct
            import termios

            # Release DTR and RTS together. Updating them one after the other
            # passes through the ESP32-C3 USB-JTAG boot/reset sequence.
            tiocmset = getattr(termios, "TIOCMSET", 0x5418)
            fcntl.ioctl(connection.fileno(), tiocmset, struct.pack("I", 0))
            attributes = termios.tcgetattr(connection.fileno())
            attributes[2] &= ~termios.HUPCL
            termios.tcsetattr(
                connection.fileno(), termios.TCSANOW, attributes
            )
        else:
            connection.dtr = False
            connection.rts = False
        connection.dsrdtr = False
        connection.rtscts = False
    except Exception:
        connection.close()
        raise
    return connection


def read_serial_until(connection, markers: tuple[bytes, ...], timeout: float) -> bytes:
    """Read bounded serial output until one marker is observed."""
    deadline = time.monotonic() + timeout
    received = bytearray()
    while time.monotonic() < deadline:
        chunk = connection.read(connection.in_waiting or 1)
        if chunk:
            received.extend(chunk)
            if len(received) > 16384:
                del received[:-8192]
            if any(marker in received for marker in markers):
                return bytes(received)
    expected = ", ".join(marker.decode(errors="replace") for marker in markers)
    raise ToolError(f"Timed out waiting for device response: {expected}.")


def open_local_shell(serial, port: str, baud: int):
    """Open and synchronize the development USB Zephyr Shell."""
    connection = None
    try:
        connection = open_serial_without_reset(serial, port, baud)
        connection.reset_input_buffer()
        connection.write(b"\x03")
        connection.flush()
        read_serial_until(connection, (b":~$ ",), 3.0)
        # Discard bytes that arrived immediately after the synchronization
        # prompt, so they cannot terminate the first real command early.
        time.sleep(0.05)
        connection.reset_input_buffer()
        return connection
    except (OSError, serial.SerialException, ToolError) as exc:
        if connection is not None:
            connection.close()
        raise ToolError(f"Cannot open local USB Shell on {port}.") from exc


def shell_command(connection, command: str, timeout: float = 5.0) -> str:
    """Execute one local Shell command and return output through its next prompt."""
    connection.reset_input_buffer()
    connection.write(command.encode("ascii") + b"\r")
    connection.flush()
    response = read_serial_until(connection, (b":~$ ",), timeout)
    return clean_terminal_text(response.decode("utf-8", errors="replace"))


def write_paced_line(connection, value: bytes) -> None:
    """Send hidden input without overflowing a small firmware RX ring buffer."""
    for offset in range(0, len(value), 8):
        connection.write(value[offset : offset + 8])
        connection.flush()
        time.sleep(0.01)
    connection.write(b"\r")
    connection.flush()


def ensure_usb_maintenance(serial, port: str, baud: int):
    """Return a synchronized USB Shell after entering a one-shot Maintenance boot."""
    connection = open_local_shell(serial, port, baud)
    status = shell_command(connection, "spaghetti status")
    mode_match = re.search(r"\bmode=(normal|maintenance|unprovisioned)\b", status)
    if mode_match is None:
        connection.close()
        detail = status.strip() or "<empty response>"
        raise ToolError(
            "The USB Shell did not return a recognizable Core mode. "
            f"Response: {detail}"
        )
    if mode_match.group(1) != "normal":
        return connection, mode_match.group(1), False

    response = shell_command(
        connection, "spaghetti maintenance reboot", timeout=3.0
    )
    if "Rebooting into Maintenance mode" not in response:
        connection.close()
        raise ToolError("The Core refused the one-shot Maintenance reboot.")
    connection.close()

    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            connection = open_local_shell(serial, port, baud)
            status = shell_command(connection, "spaghetti status")
        except ToolError:
            continue
        if "mode=maintenance" in status:
            return connection, "maintenance", True
        connection.close()
    raise ToolError("The Core did not reconnect over USB in Maintenance mode.")


def provision_remote_credential(connection, identity: str, psk: bytes) -> None:
    """Install one credential through an already-active local Maintenance Shell."""
    command = f"spaghetti remote provision {identity}"
    connection.write(command.encode("ascii") + b"\r")
    connection.flush()
    read_serial_until(
        connection, (b"PSK (64 hex digits; input is hidden):",), 5.0
    )
    time.sleep(0.1)
    write_paced_line(connection, psk.hex().encode("ascii"))
    response = read_serial_until(
        connection,
        (
            b"Remote-console credential saved",
            b"credential was not saved",
            b"PSK input failed",
            b"PSK must contain",
            b"PSK contains a non-hexadecimal character",
            b":~$ ",
        ),
        15.0,
    )
    if b"Remote-console credential saved" not in response:
        detail = clean_terminal_text(response.decode(errors="replace")).strip()
        raise ToolError(f"Device rejected remote-console credential: {detail}")
    if b":~$ " not in response:
        read_serial_until(connection, (b":~$ ",), 3.0)


def wait_for_usb_mode(serial, port: str, baud: int, expected: str):
    """Wait for reboot/reconnect and return a Shell in the requested Core mode."""
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            connection = open_local_shell(serial, port, baud)
            status = shell_command(connection, "spaghetti status")
        except ToolError:
            continue
        if f"mode={expected}" in status:
            return connection
        connection.close()
    raise ToolError(f"The Core did not reconnect over USB in {expected} mode.")


def run_remote_console_credential(args: argparse.Namespace) -> int:
    """Generate a protected host credential used by provisioning and TLS."""
    path = create_network_credentials(args.credentials, args.identity)
    print(f"Created remote-console credential: {path}")
    print("Keep this file private and back it up; its PSK was not printed.")
    return 0


def run_remote_console_provision(args: argparse.Namespace) -> int:
    """Provision the host credential through the local development USB Shell."""
    serial = serial_dependency()
    identity, psk = network_credentials(args.credentials)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", identity):
        raise ToolError(
            "Provisioning identity must contain only letters, digits, '.', '_' or '-'."
        )
    port = selected_port(args.port)
    connection, mode, rebooted = ensure_usb_maintenance(serial, port, args.baud)
    try:
        provision_remote_credential(connection, identity, psk)
    finally:
        connection.close()
    print(f"Provisioned identity {identity!r} through {port} in {mode} mode.")
    if rebooted:
        print("The Core remains in Maintenance; reboot it to return to Normal mode.")
    return 0


def run_remote_console_enable(args: argparse.Namespace) -> int:
    """Provision credentials, create safe Config if absent, and enter Normal mode."""
    credential_path = Path(args.credentials).expanduser()
    if not credential_path.exists():
        create_network_credentials(str(credential_path), args.identity)
        print(f"Created remote-console credential: {credential_path}")
    identity, psk = network_credentials(str(credential_path))
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", identity):
        raise ToolError("Credential identity is not safe for the local Shell.")

    serial = serial_dependency()
    port = selected_port(args.port)
    connection, _, _ = ensure_usb_maintenance(serial, port, args.baud)
    try:
        provision_remote_credential(connection, identity, psk)
        response = shell_command(connection, "spaghetti maintenance finish")
        if "rebooting into Normal mode" not in response:
            raise ToolError(
                "The Core did not accept Normal-mode activation: " + response.strip()
            )
    finally:
        connection.close()

    connection = wait_for_usb_mode(serial, port, args.baud, "normal")
    try:
        remote_status = shell_command(connection, "spaghetti remote status")
        wifi_profiles = shell_command(connection, "spaghetti wifi list")
        profile_match = re.search(r"\bprofiles=(\d+)\b", wifi_profiles)
        profile_count = int(profile_match.group(1)) if profile_match else 0
        if profile_count > 0:
            shell_command(connection, "spaghetti wifi connect")
    finally:
        connection.close()

    if "credentials=1" not in remote_status or "state=listening" not in remote_status:
        raise ToolError("Normal mode started, but the remote listener is not ready.")
    print(f"Normal mode and remote console are enabled on {port}.")
    if profile_count > 0:
        print("Wi-Fi connection requested using the saved profiles.")
    else:
        print("No Wi-Fi profile is saved; add one over USB before connecting remotely.")
    return 0


def run_remote_console_clear(args: argparse.Namespace) -> int:
    """Revoke the device credential through the local development USB Shell."""
    serial = serial_dependency()
    port = selected_port(args.port)
    connection, mode, rebooted = ensure_usb_maintenance(serial, port, args.baud)
    try:
        response = shell_command(connection, "spaghetti remote clear")
        if "Remote-console credential cleared" not in response:
            raise ToolError(response.strip())
    finally:
        connection.close()
    print(f"Cleared the remote-console credential through {port} in {mode} mode.")
    if rebooted:
        print("The Core remains in Maintenance; reboot it to return to Normal mode.")
    return 0


def psk_client_context(identity: str, psk: bytes) -> ssl.SSLContext:
    """Build the only accepted TLS profile for a remote-console client."""
    if not hasattr(ssl.SSLContext, "set_psk_client_callback"):
        raise ToolError("Network console requires Python 3.13 or newer with TLS-PSK.")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    try:
        context.set_ciphers("PSK-AES128-GCM-SHA256")
    except ssl.SSLError as exc:
        raise ToolError("Host OpenSSL does not provide the required PSK cipher.") from exc
    context.set_psk_client_callback(lambda _hint: (identity, psk))
    return context


def open_network_monitor(host: str | None, port: str | None, credentials: str | None):
    """Create one TLS 1.2 socket authenticated with the provisioned PSK."""
    if not host:
        raise ToolError("Network monitor requires HOST=<device IPv4 address>.")
    try:
        tcp_port = int(port or "1338")
    except ValueError as exc:
        raise ToolError("Network PORT must be a decimal TCP port.") from exc
    if not 1 <= tcp_port <= 65535:
        raise ToolError("Network PORT must be between 1 and 65535.")
    identity, psk = network_credentials(credentials)
    context = psk_client_context(identity, psk)
    plain = None
    try:
        plain = socket.create_connection((host, tcp_port), timeout=3.0)
        connection = context.wrap_socket(plain, server_hostname=None)
        connection.settimeout(0.05)
    except (OSError, ssl.SSLError) as exc:
        if plain is not None:
            plain.close()
        raise ToolError(
            "TLS-PSK connection failed; check address, identity and credential."
        ) from exc
    return connection, f"{host}:{tcp_port}", f"TLS-PSK · identity {identity}"


def probe_remote_console(
    address: str,
    port: int,
    context: ssl.SSLContext,
    timeout: float,
) -> str | None:
    """Return an authenticated remote-console address or no match."""
    plain = None
    connection = None
    try:
        plain = socket.create_connection((address, port), timeout=timeout)
        connection = context.wrap_socket(plain, server_hostname=None)
        connection.settimeout(timeout)
        greeting = connection.recv(128)
        if greeting.startswith(b"Spaghetti LAB authenticated network console"):
            return address
    except (OSError, ssl.SSLError):
        return None
    finally:
        if connection is not None:
            connection.close()
        elif plain is not None:
            plain.close()
    return None


def run_remote_console_list(args: argparse.Namespace) -> int:
    """Discover only consoles authenticated by one credential on a bounded subnet."""
    _, Console, _, Table, _, box = monitor_dependencies()
    identity, psk = network_credentials(args.credentials)
    context = psk_client_context(identity, psk)
    try:
        network = ipaddress.ip_network(args.subnet, strict=False)
    except ValueError as exc:
        raise ToolError("SUBNET must be a valid IPv4 CIDR such as 192.168.1.0/24.") from exc
    if network.version != 4:
        raise ToolError("Remote-console discovery currently supports IPv4 only.")
    if not 1 <= args.network_port <= 65535:
        raise ToolError("Remote-console port must be between 1 and 65535.")
    if not 0.05 <= args.timeout <= 5.0:
        raise ToolError("Discovery timeout must be between 0.05 and 5 seconds.")
    addresses = [str(address) for address in network.hosts()]
    if len(addresses) > 4094:
        raise ToolError("Discovery is limited to at most 4094 host addresses.")

    matches: list[str] = []
    with ThreadPoolExecutor(max_workers=min(32, len(addresses) or 1)) as executor:
        futures = {
            executor.submit(
                probe_remote_console,
                address,
                args.network_port,
                context,
                args.timeout,
            ): address
            for address in addresses
        }
        for future in as_completed(futures):
            match = future.result()
            if match is not None:
                matches.append(match)

    console = Console(highlight=False)
    table = Table(
        title=f"Authenticated Spaghetti consoles · identity {identity}",
        box=box.ROUNDED,
        border_style="white",
        header_style="bold blue",
        title_style="bold white",
    )
    table.add_column("Address", style="bold white")
    table.add_column("Port", justify="right", style="cyan")
    table.add_column("Authentication", style="green")
    for address in sorted(matches, key=ipaddress.ip_address):
        table.add_row(address, str(args.network_port), "TLS-PSK verified")
    console.print(table)
    if not matches:
        console.print("  [yellow]○ no matching console found[/]")
        return 1
    return 0


def run_monitor(args: argparse.Namespace) -> int:
    """Open the shared styled monitor over serial or authenticated TLS."""
    serial, Console, Panel, Table, Text, box = monitor_dependencies()
    transport = "serial" if args.transport == "auto" else args.transport
    serial_port = selected_port(args.port) if transport == "serial" else None
    console = Console(highlight=False, soft_wrap=True)
    output = StyledSerialOutput(console, Text, Panel, Table, box)
    network_editor = NetworkLineEditor()
    connection = None
    disconnected_reported = False
    next_shell_wake = 0.0
    shell_wake_attempts = 0

    if transport == "serial":
        monitor_header(
            console, Panel, str(serial_port), f"serial · {args.baud} baud"
        )
    else:
        endpoint = f"{args.host or 'missing host'}:{args.port or '1338'}"
        monitor_header(console, Panel, endpoint, "network · authenticated TLS-PSK")
    with raw_stdin():
        try:
            while True:
                if connection is None:
                    try:
                        if transport == "serial":
                            connection = open_serial_without_reset(
                                serial, serial_port, args.baud
                            )
                        else:
                            connection, _, _ = open_network_monitor(
                                args.host, args.port, args.credentials
                            )
                        output.begin_connection()
                        network_editor.reset_line()
                        console.print(
                            "  [green]● connected[/]",
                            highlight=False,
                        )
                        if args.wake_shell and transport == "serial":
                            connection.write(b"\x03")
                            connection.flush()
                            shell_wake_attempts = 1
                            next_shell_wake = time.monotonic() + 0.35
                        disconnected_reported = False
                    except ToolError as exc:
                        if not disconnected_reported:
                            console.print(
                                f"  [yellow]○ {exc}; waiting for reconnect[/]"
                            )
                            disconnected_reported = True
                        if is_monitor_exit_key(read_host_key()):
                            break
                        time.sleep(0.5)
                        continue
                    except serial.SerialException:
                        if not disconnected_reported:
                            console.print(
                                "  [yellow]○ device unavailable; waiting for reconnect[/]"
                            )
                            disconnected_reported = True
                        if is_monitor_exit_key(read_host_key()):
                            break
                        time.sleep(0.5)
                        continue

                try:
                    if transport == "serial":
                        available = connection.in_waiting
                        received = connection.read(available or 1)
                    else:
                        try:
                            received = connection.recv(1024)
                        except socket.timeout:
                            received = None
                        if received is None:
                            key = read_host_key()
                            if is_monitor_exit_key(key):
                                break
                            if key:
                                wire, echo = network_editor.process(key)
                                if wire:
                                    connection.sendall(wire)
                                if echo:
                                    output.feed(echo)
                            continue
                        if received == b"":
                            raise ConnectionResetError("remote console closed")
                    if received:
                        output.feed(received)

                    if (
                        args.wake_shell
                        and transport == "serial"
                        and not output.shell_prompt_seen
                        and shell_wake_attempts < 4
                        and time.monotonic() >= next_shell_wake
                    ):
                        connection.write(b"\x03")
                        connection.flush()
                        shell_wake_attempts += 1
                        next_shell_wake = time.monotonic() + 0.5

                    key = read_host_key()
                    if is_monitor_exit_key(key):
                        break
                    if key:
                        if transport == "serial":
                            connection.write(key)
                        else:
                            wire, echo = network_editor.process(key)
                            if wire:
                                connection.sendall(wire)
                            if echo:
                                output.feed(echo)
                except (OSError, ssl.SSLError, serial.SerialException):
                    output.end_connection()
                    connection.close()
                    connection = None
                    if transport == "network":
                        time.sleep(0.5)
        finally:
            output.flush()
            if connection is not None:
                connection.close()

    console.print("\n  [dim]monitor closed[/]")
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Create the command-line parser."""
    parser = argparse.ArgumentParser(
        description="Detect, flash, and monitor a Zephyr board from the host."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("ports", help="list detected USB serial ports")

    flash = subparsers.add_parser("flash", help="flash the active Zephyr build")
    flash.add_argument("--port", help="serial device override")
    flash.add_argument("--baud", type=int, default=460800)
    flash.add_argument("--dry-run", action="store_true")

    screen = subparsers.add_parser("screen", help="open the serial console")
    screen.add_argument("--port", help="serial device override")
    screen.add_argument("--baud", type=int, default=115200)

    monitor = subparsers.add_parser(
        "monitor", help="open the styled serial or TLS-PSK monitor"
    )
    monitor.add_argument(
        "--transport", choices=("auto", "serial", "network"), default="auto"
    )
    monitor.add_argument("--port", help="serial device or network TCP port")
    monitor.add_argument("--host", help="network device IPv4 address")
    monitor.add_argument("--credentials", help="protected TLS-PSK JSON file")
    monitor.add_argument("--baud", type=int, default=115200)
    monitor.add_argument(
        "--no-wake",
        action="store_false",
        dest="wake_shell",
        help="do not synchronize the Shell prompt after connecting",
    )
    monitor.set_defaults(wake_shell=True)

    credential = subparsers.add_parser(
        "remote-console-credential",
        help="create one protected TLS-PSK credential file",
    )
    credential.add_argument("--credentials", required=True)
    credential.add_argument("--identity", default="core-v1")

    provision = subparsers.add_parser(
        "remote-console-provision",
        help="provision TLS-PSK through the local development USB Shell",
    )
    provision.add_argument("--port", help="development USB Shell serial device")
    provision.add_argument("--baud", type=int, default=115200)
    provision.add_argument("--credentials", required=True)

    enable = subparsers.add_parser(
        "remote-console-enable",
        help="provision USB, create safe Config, and enter Normal mode",
    )
    enable.add_argument("--port", help="development USB Shell serial device")
    enable.add_argument("--baud", type=int, default=115200)
    enable.add_argument("--credentials", required=True)
    enable.add_argument("--identity", default="core-v1")

    clear = subparsers.add_parser(
        "remote-console-clear",
        help="clear TLS-PSK through the local development USB Shell",
    )
    clear.add_argument("--port", help="development USB Shell serial device")
    clear.add_argument("--baud", type=int, default=115200)

    discover = subparsers.add_parser(
        "remote-console-list",
        help="find remote consoles by authenticated TLS-PSK probing",
    )
    discover.add_argument("--subnet", required=True)
    discover.add_argument("--credentials", required=True)
    discover.add_argument("--network-port", type=int, default=1338)
    discover.add_argument("--timeout", type=float, default=0.35)
    return parser


def main() -> int:
    """Run the requested host operation."""
    args = build_parser().parse_args()
    try:
        if args.command == "ports":
            ports = serial_ports()
            if ports:
                print("\n".join(ports))
            else:
                print("No USB serial ports detected.")
            return 0
        if args.command == "flash":
            return run_flash(args)
        if args.command == "screen":
            return run_screen(args)
        if args.command == "remote-console-credential":
            return run_remote_console_credential(args)
        if args.command == "remote-console-provision":
            return run_remote_console_provision(args)
        if args.command == "remote-console-enable":
            return run_remote_console_enable(args)
        if args.command == "remote-console-clear":
            return run_remote_console_clear(args)
        if args.command == "remote-console-list":
            return run_remote_console_list(args)
        return run_monitor(args)
    except ToolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
