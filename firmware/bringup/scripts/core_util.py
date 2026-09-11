#!/usr/bin/env python3
"""PC utility: protobuf + COBS over CORE USB CDC (S3 only; C3 is on CAN)."""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path


def _ensure_host_deps() -> None:
    """Use firmware/bringup/.venv so Homebrew Python (PEP 668) still works."""
    try:
        import serial  # noqa: F401
        import rich  # noqa: F401

        return
    except ImportError:
        pass

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv = os.path.join(root, ".venv")
    py = os.path.join(venv, "bin", "python3")
    req = os.path.join(root, "requirements.txt")
    in_venv = os.path.abspath(sys.prefix) == os.path.abspath(venv)

    if not in_venv:
        if not os.path.isfile(py):
            subprocess.check_call([sys.executable, "-m", "venv", venv])
        try:
            subprocess.check_call(
                [py, "-c", "import serial, rich"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            subprocess.check_call([py, "-m", "pip", "install", "-q", "-r", req])
        os.execv(py, [py, *sys.argv])

    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-r", req])
    import serial  # noqa: F401
    import rich  # noqa: F401


_ensure_host_deps()
import serial  # noqa: E402
from rich import box  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.panel import Panel  # noqa: E402
from rich.progress import (  # noqa: E402
    BarColumn,
    DownloadColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)
from rich.table import Table  # noqa: E402


NFC_INFO = 0x20
NFC_REG_READ = 0x21
NFC_REG_WRITE = 0x22
NFC_SCAN = 0x23
NFC_TAG_READ = 0x24
NFC_TAG_WRITE = 0x25
NFC_UID_READ = 0x26

ST25R100_REGISTERS = (
    "OPERATION", "GENERAL", "REGULATOR", "TX_DRIVER", "TX_MOD", "TX_RES_MOD",
    "RX_ANA1", "RX_ANA2", "RX_DIG", "CORR1", "CORR2", "CORR3", "CORR4",
    "CORR5", "CORR6", "DISPLAY1", "DISPLAY2", "STATUS", "PROTOCOL",
    "PROTOCOL_TX1", "PROTOCOL_TX2", "PROTOCOL_TX3", "PROTOCOL_RX1",
    "PROTOCOL_RX2", "PROTOCOL_RX3", "EMD1", "EMD2", "MRT_SQT_CONF", "MRT",
    "SQT", "NRT_GPT_CONF", "NRT1", "NRT2", "GPT1", "GPT2", "DISPLAY3",
    "DISPLAY4", "OVUNSHOOT_CONF", "OVERSHOOT_CONF", "UNDERSHOOT_CONF",
    "WAKEUP_CONF1", "WAKEUP_CONF2", "WU_I_CONF", "WU_I_DELTA", "WU_I_ADC",
    "WU_I_REF", "WU_I_CAL", "WU_Q_CONF", "WU_Q_DELTA", "WU_Q_ADC", "WU_Q_REF",
    "WU_Q_CAL", "TX_FRAME1", "TX_FRAME2", "FIFO_STATUS1", "FIFO_STATUS2",
    "COLLISION", "IRQ_MASK1", "IRQ_MASK2", "IRQ_MASK3", "IRQ1", "IRQ2", "IRQ3",
    "IC_ID",
)
ST25R100_RO = set(range(0x10, 0x12)) | set(range(0x23, 0x25)) | set(range(0x2C, 0x2F)) | set(range(0x31, 0x34)) | set(range(0x36, 0x39)) | set(range(0x3C, 0x40))


def parse_int(value: str) -> int:
    return int(value, 0)


def interpret_register(address: int, value: int) -> str:
    if address == 0x00:
        names = ((5, "TX"), (4, "RX"), (3, "AM"), (1, "oscillator"), (0, "wake-up"))
        active = [name for bit, name in names if value & (1 << bit)]
        return "active: " + (", ".join(active) if active else "none")
    if address == 0x01:
        antenna = "RFO2/RFI2" if value & 0x10 else "RFO1/RFI1"
        mode = "single-ended" if value & 0x20 else "differential"
        return f"antenna {antenna}, mode {mode}"
    if address == 0x11:
        names = ((7, "subcarrier"), (6, "GPT"), (5, "NRT"), (4, "MRT"), (3, "RX active"), (2, "RX on"), (1, "TX on"))
        active = [name for bit, name in names if value & (1 << bit)]
        return ", ".join(active) if active else "idle"
    if address == 0x12:
        protocols = {1: "ISO14443A", 2: "ISO14443B", 4: "Topaz/T1T", 5: "ISO15693/NFC-V"}
        return f"protocol {protocols.get(value & 0x0F, 'RFU/other')}, TX rate {(value >> 4) & 3}, RX rate {(value >> 6) & 3}"
    if address == 0x3F:
        chip = "ST25R100/ST25R200" if (value & 0xF8) == 0xA8 else "unexpected IC"
        return f"{chip}, revision {value & 0x07}"
    return f"set bits: {', '.join(str(bit) for bit in range(7, -1, -1) if value & (1 << bit)) or 'none'}"


def interpret_t2t_page(page: int, data: bytes) -> str:
    if page == 0:
        uid = data[:3].hex(":").upper()
        return f"ST25TN01K: UID0..2 {uid} + BCC1 0x{data[3]:02X} (RO)"
    if page == 1:
        return f"ST25TN01K: UID3..6 {data.hex(':').upper()} (RO)"
    if page == 2:
        return f"ST25TN01K: internal 0x{data[0]:02X}, SYSBLOCK 0x{data[1]:02X}, STATLOCK_0=0x{data[2]:02X}, STATLOCK_1=0x{data[3]:02X} (OTP lock)"
    if page == 3:
        if len(data) == 4 and data[0] == 0xE1:
            model = "ST25TN01K" if data[2] == 0x14 else "ST25TN512" if data[2] == 0x08 else "T2T"
            return f"{model} CC (OTP): NDEF v{data[1] >> 4}.{data[1] & 0x0F}, area {data[2] * 8} B, access 0x{data[3]:02X}"
        return "Non-standard Capability Container"
    if 4 <= page <= 43:
        ascii_text = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
        if page == 4 and data:
            tlv = {0x00: "NULL", 0x01: "Lock Control", 0x02: "Memory Control", 0x03: "NDEF", 0xFD: "Proprietary", 0xFE: "Terminator"}.get(data[0], "unknown")
            return f"ST25TN01K user memory · TLV {tlv} · ASCII {ascii_text}"
        return f"ST25TN01K user memory · ASCII {ascii_text}"
    if page == 44:
        return f"ST25TN01K lock OTP: DYNLOCK_0=0x{data[0]:02X}, DYNLOCK_1=0x{data[1]:02X}, DYNLOCK_2=0x{data[2]:02X}, SYSLOCK=0x{data[3]:02X}"
    if page == 45:
        pc = data[0] | (data[1] << 8)
        model = "ST25TN01K" if pc == 0x9090 else "ST25TN512" if pc == 0x9091 else "unknown model"
        return f"Product ID (RO): PC=0x{pc:04X} {model}, REV=0x{data[2]:02X}, KID=0x{data[3]:02X}"
    if page == 46:
        cfg = data[0] | (data[1] << 8)
        return (f"ANDEF_CFG: block={cfg & 0x3F}, byte={(cfg >> 14) & 3}, "
                f"custom={'on' if cfg & 0x0100 else 'off'}, UTC={'on' if cfg & 0x0400 else 'off'}")
    if page == 47:
        return "KILL_PWD: intentionally unreadable value (READ returns 00)"
    if page == 48:
        return "Kill keyhole: writing the correct password irreversibly kills the tag"
    if 49 <= page <= 59:
        return "ST25TN01K internal area: do not write"
    if 60 <= page <= 62:
        return f"ANDEF_CUSTOM · ASCII {''.join(chr(b) if 32 <= b < 127 else '.' for b in data)}"
    if page == 63:
        return (f"ANDEF_CUSTOM tail={data[:2].decode('ascii', 'replace')!r}, "
                f"ANDEF_SEP=0x{data[2]:02X} ({chr(data[2]) if 32 <= data[2] < 127 else '.'})")
    ascii_text = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
    return f"outside ST25TN01K map · ASCII {ascii_text}"


def cobs_encode_frame(data: bytes) -> bytes:
    if not data:
        return bytes([1, 0])
    out = bytearray(1)
    code_idx = 0
    code = 1
    for b in data:
        if b == 0:
            out[code_idx] = code
            code = 1
            code_idx = len(out)
            out.append(0)
        else:
            out.append(b)
            code += 1
            if code == 0xFF:
                out[code_idx] = code
                code = 1
                code_idx = len(out)
                out.append(0)
    out[code_idx] = code
    out.append(0)
    return bytes(out)


def cobs_decode_frame(frame: bytes) -> bytes:
    if frame.endswith(b"\x00"):
        frame = frame[:-1]
    if not frame:
        return b""
    out = bytearray()
    i = 0
    while i < len(frame):
        code = frame[i]
        if code == 0 or i + code > len(frame) + 1:
            raise ValueError("corrupted COBS frame")
        i += 1
        for _ in range(1, code):
            if i >= len(frame):
                raise ValueError("truncated COBS frame")
            out.append(frame[i])
            i += 1
        if code != 0xFF and i < len(frame):
            out.append(0)
    return bytes(out)


def encode_varint(v: int) -> bytes:
    v &= 0xFFFFFFFF
    out = bytearray()
    while v > 0x7F:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v & 0x7F)
    return bytes(out)


def encode_key(field: int, wire: int) -> bytes:
    return encode_varint((field << 3) | wire)


def encode_uint32(field: int, v: int) -> bytes:
    if v == 0:
        return b""
    return encode_key(field, 0) + encode_varint(v)


def encode_bool(field: int, v: bool) -> bytes:
    return encode_uint32(field, 1 if v else 0)


def encode_bytes(field: int, data: bytes) -> bytes:
    return encode_key(field, 2) + encode_varint(len(data)) + data


def encode_string(field: int, s: str) -> bytes:
    if not s:
        return b""
    return encode_bytes(field, s.encode("utf-8"))


def encode_sub(field: int, inner: bytes) -> bytes:
    return encode_bytes(field, inner)


def host_msg(nonce: int, field: int, inner: bytes = b"", node_id: int | None = None) -> bytes:
    node = b""
    if node_id is not None:
        node = encode_uint32(2, node_id) + encode_bool(3, True)
    return encode_uint32(1, nonce) + node + encode_sub(field, inner)


def decode_varint(buf: bytes, off: int) -> tuple[int, int]:
    v = 0
    shift = 0
    while off < len(buf):
        b = buf[off]
        off += 1
        v |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return v, off
        shift += 7
        if shift >= 35:
            raise ValueError("varint exceeds uint32")
    raise ValueError("truncated varint")


def skip_field(buf: bytes, off: int, wire: int) -> int:
    if wire == 0:
        _, off = decode_varint(buf, off)
        return off
    if wire == 1:
        return off + 8
    if wire == 5:
        return off + 4
    if wire == 2:
        n, off = decode_varint(buf, off)
        return off + n
    raise ValueError("unsupported wire type %d" % wire)


def decode_fields(buf: bytes) -> dict[int, list]:
    off = 0
    fields: dict[int, list] = {}
    while off < len(buf):
        key, off = decode_varint(buf, off)
        field, wire = key >> 3, key & 7
        if wire == 0:
            v, off = decode_varint(buf, off)
            fields.setdefault(field, []).append(("varint", v))
        elif wire == 2:
            n, off = decode_varint(buf, off)
            fields.setdefault(field, []).append(("bytes", buf[off : off + n]))
            off += n
        else:
            off = skip_field(buf, off, wire)
    return fields


def parse_core(buf: bytes) -> dict:
    top = decode_fields(buf)
    nonce = top.get(1, [("varint", 0)])[0][1]
    out: dict = {"nonce": nonce, "kind": None}
    if 10 in top:
        inner = decode_fields(top[10][0][1])
        ver = inner.get(1, [("bytes", b"")])[0][1]
        out["kind"] = "pong"
        out["version"] = ver.decode("utf-8", "replace") if isinstance(ver, bytes) else str(ver)
    elif 11 in top:
        inner = decode_fields(top[11][0][1])
        ok = inner.get(1, [("varint", 0)])[0][1] != 0
        msg = inner.get(2, [("bytes", b"")])[0][1]
        pct = inner.get(3, [("varint", 0)])[0][1]
        mode = inner.get(4, [("varint", 0)])[0][1]
        out.update(
            kind="ack",
            ok=ok,
            message=msg.decode("utf-8", "replace") if isinstance(msg, bytes) else str(msg),
            progress_pct=pct,
            mode_used=mode,
        )
    elif 12 in top:
        inner = decode_fields(top[12][0][1])
        det = inner.get(4, [("bytes", b"")])[0][1]
        out.update(
            kind="status",
            c3_alive=inner.get(1, [("varint", 0)])[0][1] != 0,
            uart_busy=inner.get(2, [("varint", 0)])[0][1] != 0,
            last_error=inner.get(3, [("varint", 0)])[0][1],
            detail=det.decode("utf-8", "replace") if isinstance(det, bytes) else str(det),
        )
    elif 13 in top:
        inner = decode_fields(top[13][0][1])
        raw = inner.get(4, [("bytes", b"")])[0][1]
        detail = inner.get(5, [("bytes", b"")])[0][1]
        out.update(
            kind="nfc",
            ok=inner.get(1, [("varint", 0)])[0][1] != 0,
            status=inner.get(2, [("varint", 0)])[0][1],
            command=inner.get(3, [("varint", 0)])[0][1],
            data=raw if isinstance(raw, bytes) else b"",
            detail=detail.decode("utf-8", "replace") if isinstance(detail, bytes) else str(detail),
        )
    elif 14 in top:
        inner = decode_fields(top[14][0][1])
        raw = inner.get(1, [("bytes", b"")])[0][1]
        nodes = []
        if isinstance(raw, bytes):
            for off in range(0, len(raw) - 9, 10):
                node_id = int.from_bytes(raw[off : off + 4], "little")
                mac = raw[off + 4 : off + 10]
                nodes.append({"node_id": node_id, "node": f"0x{node_id:06X}",
                              "mac": mac.hex(":").upper()})
        out.update(kind="nodes", nodes=nodes, count=len(nodes))
    return out


def find_port(explicit: str | None) -> str:
    if explicit:
        matches = glob.glob(explicit)
        if matches:
            return sorted(matches)[0]
        return explicit
    ports = sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/tty.usbmodem*"))
    if not ports:
        sys.exit("No /dev/cu.usbmodem* port found. Connect the CORE over USB-C.")
    return ports[0]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def human_bytes(value: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{value} B"


def response_panel(console: Console, title: str, payload: dict) -> None:
    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column(style="bold white")
    for key, value in payload.items():
        color = "green" if value is True else "red" if value is False else "cyan"
        table.add_row(key.replace("_", " ").title(), f"[{color}]{value}[/]")
    console.print(Panel(table, title=title, border_style="bright_blue", box=box.ROUNDED))


def json_safe(payload: dict) -> dict:
    return {key: (value.hex().upper() if isinstance(value, bytes) else value) for key, value in payload.items()}


def show_registers(console: Console, rows: list[tuple[int, int]]) -> None:
    table = Table(title="ST25R100 · SPI registers", box=box.ROUNDED, border_style="bright_blue")
    table.add_column("Addr", style="cyan", no_wrap=True)
    table.add_column("Register", style="bold white")
    table.add_column("Access", justify="center")
    table.add_column("Hex", style="bright_magenta", justify="center")
    table.add_column("Binary", style="dim")
    table.add_column("Interpretation")
    for address, value in rows:
        table.add_row(
            f"0x{address:02X}", ST25R100_REGISTERS[address],
            "RO" if address in ST25R100_RO else "RW", f"0x{value:02X}",
            f"{value:08b}", interpret_register(address, value),
        )
    console.print(table)


def show_tag_pages(console: Console, antenna: int, rows: list[tuple[int, bytes]]) -> None:
    table = Table(title=f"ST25TN01K · Type 2 memory · antenna {antenna}", box=box.ROUNDED, border_style="green")
    table.add_column("Page", style="cyan", justify="right")
    table.add_column("Address", style="dim")
    table.add_column("Hex", style="bright_magenta")
    table.add_column("Interpretation")
    for page, data in rows:
        table.add_row(str(page), f"0x{page * 4:04X}", data.hex(" ").upper(), interpret_t2t_page(page, data))
    console.print(table)


class FlashError(RuntimeError):
    pass


class CoreClient:
    def __init__(self, port: str, timeout: float, console: Console,
                 json_mode: bool = False, node_id: int | None = None) -> None:
        self.port = port
        self.console = console
        self.json_mode = json_mode
        self.node_id = node_id
        self.retry_count = 0
        self.flash_context: dict = {}
        self.ser = serial.Serial(port, 115200, timeout=timeout)
        time.sleep(0.3)
        self.ser.reset_input_buffer()
        self.nonce = 1

    def emit(self, event: str, **data) -> None:
        if self.json_mode:
            print(json.dumps({"event": event, "timestamp": utc_now(), **data}), flush=True)

    def close(self) -> None:
        self.ser.close()

    def transact(
        self, payload: bytes, timeout: float | None = None, retries: int = 0
    ) -> dict:
        frame = cobs_encode_frame(payload)
        expected_nonce = decode_fields(payload).get(1, [("varint", 0)])[0][1]
        wait = timeout if timeout is not None else self.ser.timeout or 5
        for attempt in range(retries + 1):
            if attempt:
                # A lost USB packet can leave an unterminated COBS fragment in
                # the S3 accumulator.  An empty delimiter discards that tail;
                # its nonce=0 error reply is ignored below.
                self.ser.write(b"\x00")
                self.ser.flush()
            written = self.ser.write(frame)
            self.ser.flush()
            if written != len(frame):
                raise TimeoutError(
                    "partial USB write: %d/%d bytes" % (written, len(frame))
                )
            deadline = time.time() + wait
            buf = bytearray()
            while time.time() < deadline:
                chunk = self.ser.read(1)
                if not chunk:
                    continue
                buf.extend(chunk)
                if chunk != b"\x00":
                    continue
                try:
                    reply = parse_core(cobs_decode_frame(bytes(buf)))
                except ValueError:
                    # Ignore a damaged/partial USB frame and keep waiting for
                    # the valid protobuf response in the same attempt.
                    buf.clear()
                    continue
                buf.clear()
                if reply.get("nonce") != expected_nonce:
                    continue
                return reply
            if attempt < retries:
                self.retry_count += 1
                self.emit(
                    "transport_retry",
                    transport="usb_cdc",
                    attempt=attempt + 1,
                    max_retries=retries,
                    **self.flash_context,
                )
                if not self.json_mode:
                    self.console.print(
                        "[yellow]● USB ACK lost[/] · retrying the same block "
                        "[dim](%d/%d)[/]" % (attempt + 1, retries)
                    )
        raise TimeoutError("no COBS response from CORE (timeout)")

    def transact_begin(
        self,
        payload: bytes,
        timeout: float = 30,
        on_progress=None,
    ) -> dict:
        """Wait for flash_begin. Progress ACKs are ok=true with mode_used=0."""
        frame = cobs_encode_frame(payload)
        expected_nonce = decode_fields(payload).get(1, [("varint", 0)])[0][1]
        written = self.ser.write(frame)
        self.ser.flush()
        if written != len(frame):
            raise TimeoutError("partial USB write: %d/%d bytes" % (written, len(frame)))
        deadline = time.time() + timeout
        buf = bytearray()
        last = None
        while time.time() < deadline:
            chunk = self.ser.read(1)
            if not chunk:
                continue
            buf.extend(chunk)
            if chunk != b"\x00":
                continue
            try:
                reply = parse_core(cobs_decode_frame(bytes(buf)))
            except ValueError:
                buf.clear()
                continue
            buf.clear()
            if reply.get("nonce") != expected_nonce:
                continue
            last = reply
            if reply.get("kind") != "ack":
                return reply
            if not reply.get("ok"):
                return reply
            if reply.get("mode_used", 0) != 0:
                return reply
            if on_progress:
                on_progress(reply.get("message") or "working")
        if last is not None:
            raise TimeoutError(
                "no final flash_begin ACK from CORE (timeout); last: %s"
                % last.get("message", "")
            )
        raise TimeoutError("no COBS response from CORE (timeout)")

    def ping(self) -> dict:
        n = self.nonce
        self.nonce += 1
        return self.transact(host_msg(n, 10, b"", self.node_id), timeout=3)

    def status(self) -> dict:
        n = self.nonce
        self.nonce += 1
        return self.transact(host_msg(n, 11, b"", self.node_id), timeout=3)

    def reboot_c3(self, update: bool, rom: bool) -> dict:
        n = self.nonce
        self.nonce += 1
        inner = encode_bool(1, update) + encode_bool(2, rom)
        return self.transact(host_msg(n, 12, inner, self.node_id), timeout=3)

    def discover_nodes(self) -> dict:
        n = self.nonce
        self.nonce += 1
        return self.transact(host_msg(n, 17), timeout=3)

    def nfc(self, command: int, payload: bytes = b"", timeout: float = 3) -> dict:
        if len(payload) > 7:
            raise ValueError("NFC payload exceeds 7 bytes")
        n = self.nonce
        self.nonce += 1
        inner = encode_uint32(1, command) + encode_bytes(2, payload)
        return self.transact(host_msg(n, 16, inner, self.node_id), timeout=timeout)

    def nfc_info(self) -> dict:
        reply = self.nfc(NFC_INFO, timeout=5)
        data = reply.get("data", b"")
        ic_id = data[0] if len(data) else 0
        irq_flags = data[2] if len(data) > 2 else 0
        irq_count = ((data[4] | (data[5] << 8)) if len(data) > 5 else 0)
        return {
            **reply,
            "ready": reply.get("ok", False),
            "ic_id": ic_id,
            "chip": "ST25R100/ST25R200" if (ic_id & 0xF8) == 0xA8 else "unknown",
            "revision": ic_id & 0x07,
            "rfal_error": data[1] if len(data) > 1 else 0,
            "detection_mode": (
                "IRQ + low-power card detection"
                if irq_flags & 1
                else "direct scan/fallback"
            ),
            "irq_seen": bool(irq_flags & 2),
            "wakeup_antenna": data[3] if len(data) > 3 else 0,
            "wakeup_irq_count": irq_count,
        }

    def nfc_reg_read(self, address: int) -> int:
        reply = self.nfc(NFC_REG_READ, bytes([address]))
        if not reply.get("ok") or len(reply.get("data", b"")) < 2:
            raise FlashError(f"register read 0x{address:02X}: {reply.get('detail')} (status {reply.get('status')})")
        return reply["data"][1]

    def nfc_reg_write(self, address: int, value: int) -> None:
        reply = self.nfc(NFC_REG_WRITE, bytes([address, value]))
        if not reply.get("ok"):
            raise FlashError(f"register write 0x{address:02X}: {reply.get('detail')} (status {reply.get('status')})")

    def nfc_probe(self, antenna: int, wupa: bool = False) -> dict:
        reply = self.nfc(NFC_SCAN, bytes([antenna, 0xD2, int(wupa)]), timeout=10)
        data = reply.get("data", b"")
        if not reply.get("ok") or len(data) != 6 or data[0] != 0xD2:
            raise FlashError("NFC probe unavailable: install the nfc-probe recovery image on C3")
        flags, rc, bits = data[1:4]
        tx_done = bool(flags & 2)
        deadline = bool(flags & 4)
        valid = tx_done and rc == 0 and bits == 16
        return {"antenna": antenna, "command": "WUPA" if wupa else "REQA",
                "started": bool(flags & 1), "tx_complete": tx_done,
                "software_deadline": deadline, "rfal_error": rc, "rx_bits": bits,
                "atqa_hex": data[4:6].hex(" ").upper() if bits else "",
                "atqa_valid": valid,
                "result": "ATQA received" if valid else
                          "Software deadline expired" if deadline else
                          "TX completed; RX timed out" if tx_done and rc == 4 else
                          "RFAL exchange failed or incomplete"}

    def nfc_scan(self, antenna: int = 1) -> dict:
        # CORE may wait up to 8 seconds for the C3 TWAI response. Keep the host
        # deadline longer so CORE can return its structured diagnostic instead
        # of the CLI incorrectly reporting a USB/COBS timeout.
        reply = self.nfc(NFC_SCAN, bytes([antenna]), timeout=10)
        data = reply.get("data", b"")
        if not reply.get("ok"):
            result = {"found": False, "antenna": antenna or 0,
                      "status": reply.get("status", 1),
                      "result": "Scan failed; firmware did not provide RFAL diagnostics"}
            if len(data) >= 4 and data[3] == 0xD1:
                errors = {0: "ERR_NONE", 1: "ERR_NOMEM", 2: "ERR_BUSY", 3: "ERR_IO",
                          4: "ERR_TIMEOUT", 7: "ERR_PARAM", 9: "ERR_FRAMING",
                          11: "ERR_PROTO", 21: "ERR_CRC", 22: "ERR_NOTFOUND",
                          27: "ERR_PAR", 29: "ERR_RF_COLLISION", 33: "ERR_WRONG_STATE",
                          36: "ERR_HW_MISMATCH"}
                stages = {0: "reader initialization", 1: "reader configuration",
                          2: "technology detection (WUPA then anticollision)",
                          3: "wake-up / anticollision / selection", 4: "selected"}
                result.update(antenna=data[0], rfal_error=data[1],
                              rfal_error_name=errors.get(data[1], f"RFAL_{data[1]}"),
                              stage=stages.get(data[2], f"unknown ({data[2]})"),
                              result="Scan failed")
                if data[1] == 4:
                    result["result"] = "RFAL timeout; tag absence is not confirmed"
            elif result["status"] == 255:
                result["result"] = reply.get("detail", "No NFC response from C3")
            return result
        ant = data[0] if len(data) > 0 else 0
        tag_type = data[1] if len(data) > 1 else 0
        uid_len = data[2] if len(data) > 2 else 0
        uid = bytearray(data[3:6])
        offset = len(uid)
        while offset < uid_len:
            part = self.nfc(NFC_UID_READ, bytes([offset]))
            pdata = part.get("data", b"")
            if not part.get("ok") or len(pdata) < 2:
                break
            uid.extend(pdata[2 : 2 + min(4, uid_len - offset)])
            offset = len(uid)
        uid = uid[:uid_len]
        return {
            "found": True,
            "antenna": ant,
            "tag_type": {1: "NFC-A Type 2", 2: "NFC-A Type 4", 3: "NFC-A"}.get(tag_type, f"type {tag_type}"),
            "tag_type_code": tag_type,
            "uid": uid.hex(":").upper(),
        }

    def nfc_tag_read(self, antenna: int, page: int) -> bytes:
        reply = self.nfc(NFC_TAG_READ, bytes([antenna, page]), timeout=5)
        data = reply.get("data", b"")
        if not reply.get("ok") or len(data) < 6:
            status = reply.get("status")
            detail = reply.get("detail") or "NFC operation failed"
            if status == 255:
                raise FlashError(f"tag page {page} read: C3 response timeout ({detail})")
            raise FlashError(f"tag page {page} read: Type 2 tag not found or RFAL error {status}")
        return bytes(data[2:6])

    def nfc_tag_write(self, antenna: int, page: int, data: bytes) -> None:
        reply = self.nfc(NFC_TAG_WRITE, bytes([antenna, page]) + data, timeout=5)
        if not reply.get("ok"):
            raise FlashError(f"tag page {page} write: Type 2 tag not found or RFAL error {reply.get('status')}")

    def flash_c3(self, path: str, mode: int, invert: bool = False) -> None:
        data = open(path, "rb").read()
        crc = zlib.crc32(data) & 0xFFFFFFFF
        chunk_sz = 192 if mode == 3 else 224
        total_chunks = math.ceil(len(data) / chunk_sz)
        mode_name = {0: "AUTO", 1: "ROM / SLIP", 2: "OTA / SLUP", 3: "OTA / ESP-NOW"}.get(mode, str(mode))
        node_label = f"0x{self.node_id:06X}" if self.node_id is not None else "legacy"
        route = (
            "PC → USB CDC → CORE S3; handshake TWAI ENTER_UPDATE (if C3 app is up); "
            "image UART-over-CAN PHY → BACKBONE C3 (never CAN frames)"
        )
        if mode == 1:
            route = (
                "PC → USB CDC → CORE S3 SLIP → UART-over-CAN → C3 ROM. "
                "This path has never gotten a C3 ACK on this hardware (TX echo only). "
                "J15 USB-UART is the reliable first program."
            )
        elif mode == 3:
            route = (
                "PC → USB CDC → CORE S3 → ESP-NOW channel 1 → BACKBONE C3; "
                "TWAI remains available outside the OTA session"
            )
        started_at = time.monotonic()
        self.retry_count = 0
        self.flash_context = {
            "phase": "prepare",
            "node_id": self.node_id,
            "node": node_label,
            "bytes_sent": 0,
            "total_bytes": len(data),
            "chunk_index": 0,
            "total_chunks": total_chunks,
        }

        self.emit(
            "flash_start",
            phase="prepare",
            target="esp32c3",
            node_id=self.node_id,
            node=node_label,
            port=self.port,
            image=str(Path(path).resolve()),
            image_size=len(data),
            crc32=f"0x{crc:08x}",
            mode_requested=mode,
            mode_name=mode_name,
            uart_inverted=invert,
            chunk_size=chunk_sz,
            total_chunks=total_chunks,
            route=route,
        )
        if not self.json_mode:
            details = Table.grid(padding=(0, 2))
            details.add_column(style="dim", no_wrap=True)
            details.add_column(style="bold white")
            details.add_row("Target", f"ESP32-C3 · BACKBONE · node {node_label}")
            details.add_row("Mode", mode_name)
            details.add_row("Image", f"{Path(path).name} · {human_bytes(len(data))}")
            details.add_row("Integrity", f"CRC32 0x{crc:08x}")
            details.add_row("Transport", route)
            details.add_row("Packets", f"{total_chunks} × max {chunk_sz} B")
            self.console.print(
                Panel(
                    details,
                    title="[bold cyan]Firmware update[/]",
                    subtitle=f"[dim]{self.port}[/]",
                    border_style="bright_blue",
                    box=box.ROUNDED,
                )
            )
            if mode == 1:
                self.console.print(
                    Panel(
                        "S3 [bold]--rom[/] SLIP through the CAN PHY has [bold]never[/] "
                        "received a C3 ACK on this board — only the S3 TX echo.\n"
                        "[bold]Reliable first flash:[/] BACKBONE [bold]J15 UART PROG[/] "
                        "+ USB-UART (3.3 V):\n"
                        "  • J15 pin 1 [bold]CAN_TX[/] = C3 GPIO21 TX  →  adapter RX\n"
                        "  • J15 pin 2 [bold]CAN_RX[/] = C3 GPIO20 RX  ←  adapter TX\n"
                        "  • GND from J1 / board ground (J15 is TX/RX only)\n"
                        "  • IO9=0, pulse RESET, EN back to 3.3 V, then esptool --chip esp32c3\n"
                        "This command does not sit on Negotiating: it fails immediately "
                        "with the echo/J15 message (CAN-UART ROM has never ACKed here).",
                        title="[bold yellow]First-flash note[/]",
                        border_style="yellow",
                        box=box.ROUNDED,
                    )
                )

        n = self.nonce
        self.nonce += 1
        inner = (
            encode_uint32(1, len(data))
            + encode_uint32(2, crc)
            + encode_uint32(3, 0)
            + encode_uint32(4, mode)
            + encode_bool(5, invert)
        )
        progress = Progress(
            SpinnerColumn(style="cyan"),
            TextColumn("[bold]{task.description}"),
            BarColumn(bar_width=34, complete_style="bright_cyan", finished_style="green"),
            TaskProgressColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TimeRemainingColumn(),
            TimeElapsedColumn(),
            console=self.console,
            disable=self.json_mode,
        )
        begin_label = (
            "SLIP sync…" if mode == 1
            else "ESP-NOW handshake…" if mode == 3
            else "SLUP handshake…"
        )
        with progress:
            task = progress.add_task(begin_label, total=len(data))
            self.flash_context["phase"] = "handshake"
            self.emit("flash_phase", **self.flash_context)

            def _on_begin_progress(message: str) -> None:
                text = (message or begin_label).strip()
                if len(text) > 72:
                    text = text[:69] + "…"
                progress.update(task, description=text)
                self.emit("flash_begin_progress", message=message, **self.flash_context)

            ack = self.transact_begin(
                host_msg(n, 13, inner, self.node_id),
                timeout=30,
                on_progress=_on_begin_progress,
            )
            self._require_ack(ack, "begin")
            mode_used = ack.get("mode_used", 0)
            self.emit(
                "flash_begin",
                phase="transfer",
                node_id=self.node_id,
                node=node_label,
                mode_used=mode_used,
                detail=ack.get("message", ""),
            )
            progress.update(task, description="Transferring")

            off = 0
            chunk_index = 0
            last_event_pct = -1
            while off < len(data):
                piece = data[off : off + chunk_sz]
                n = self.nonce
                self.nonce += 1
                self.flash_context.update(
                    phase="transfer", bytes_sent=off, chunk_index=chunk_index + 1
                )
                cin = encode_uint32(1, off) + encode_bytes(2, piece)
                ack = self.transact(host_msg(n, 14, cin, self.node_id), timeout=20, retries=2)
                self._require_ack(ack, "chunk @%d" % off)
                off += len(piece)
                chunk_index += 1
                self.flash_context.update(bytes_sent=off, chunk_index=chunk_index)
                elapsed = max(time.monotonic() - started_at, 0.001)
                rate = off / elapsed
                eta = (len(data) - off) / rate if rate else None
                pct = off * 100.0 / len(data)
                progress.update(task, completed=off)
                event_pct = int(pct)
                if event_pct != last_event_pct or off == len(data):
                    self.emit(
                        "flash_progress",
                        phase="transfer",
                        node_id=self.node_id,
                        node=node_label,
                        percent=round(pct, 2),
                        bytes_sent=off,
                        total_bytes=len(data),
                        chunk_index=chunk_index,
                        total_chunks=total_chunks,
                        elapsed_s=round(elapsed, 3),
                        rate_Bps=round(rate, 1),
                        eta_s=round(eta, 3) if eta is not None else None,
                        retries=self.retry_count,
                    )
                    last_event_pct = event_pct

            progress.update(task, description="Verifying and activating")
            self.flash_context["phase"] = "verify"
            self.emit("flash_phase", **self.flash_context)
        n = self.nonce
        self.nonce += 1
        ack = self.transact(host_msg(n, 15, b"", self.node_id), timeout=15)
        self._require_ack(ack, "finish")
        elapsed = max(time.monotonic() - started_at, 0.001)
        rate = len(data) / elapsed
        self.emit(
            "flash_complete",
            phase="complete",
            node_id=self.node_id,
            node=node_label,
            ok=True,
            percent=100.0,
            bytes_sent=len(data),
            total_bytes=len(data),
            chunks_sent=total_chunks,
            elapsed_s=round(elapsed, 3),
            average_rate_Bps=round(rate, 1),
            retries=self.retry_count,
            crc32=f"0x{crc:08x}",
            message=ack.get("message", "flash OK"),
        )
        self.flash_context.update(phase="complete", bytes_sent=len(data))
        if not self.json_mode:
            result = Table.grid(padding=(0, 2))
            result.add_column(style="dim")
            result.add_column(style="bold white")
            result.add_row("Status", "[bold green]● Completed[/]")
            result.add_row("Transferred", f"{human_bytes(len(data))} in {elapsed:.1f} s")
            result.add_row("Average speed", f"{human_bytes(int(rate))}/s")
            result.add_row("Blocks", f"{total_chunks} · USB retries {self.retry_count}")
            result.add_row("Verification", f"CRC32 0x{crc:08x}")
            result.add_row("Node", node_label)
            result.add_row("C3", "Firmware activated · device-requested reboot")
            self.console.print(
                Panel(
                    result,
                    title="[bold green]Update completed[/]",
                    border_style="green",
                    box=box.ROUNDED,
                )
            )

    @staticmethod
    def _require_ack(msg: dict, step: str) -> None:
        if msg.get("kind") != "ack":
            raise FlashError("%s: unexpected response %s" % (step, msg))
        if not msg.get("ok"):
            raise FlashError("%s failed: %s" % (step, msg.get("message")))


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "USB protobuf+COBS console for CORE (ESP32-S3). "
            "The PC never talks directly to the C3. Flashing uses UART over the CAN PHY "
            "(GPIO5 TX / GPIO4 RX); runtime ping/reboot uses TWAI while the C3 app runs."
        )
    )
    ap.add_argument("--port", default=None, help="CORE S3 USB port, e.g. /dev/cu.usbmodem1101")
    ap.add_argument(
        "--node", type=parse_int, default=None,
        help="C3 Node ID discovered with 'nodes', e.g. 0x0D6730; omit for legacy single-node mode",
    )
    ap.add_argument(
        "--json",
        action="store_true",
        help="emit structured NDJSON events without the Rich interface",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    sub.add_parser("nodes", help="discover all addressable ESP32-C3 nodes on CAN")
    sub.add_parser("status")
    rb = sub.add_parser("reboot-c3")
    rb.add_argument(
        "--update",
        action="store_true",
        help="TWAI: reboot the C3, then open the UART SLUP window",
    )
    rb.add_argument(
        "--rom",
        action="store_true",
        help="TWAI: ask the C3 to enter the UART-over-CAN ROM bootloader",
    )
    sub.add_parser(
        "rom-bridge",
        help="put the C3 in ROM mode and turn the S3 into a raw serial bridge for esptool",
    )
    fl = sub.add_parser("flash-c3")
    fl.add_argument("--bin", required=True, help="merged.bin (--rom) or firmware.bin (SLUP/ESP-NOW OTA)")
    fl.add_argument(
        "--rom",
        action="store_true",
        help=(
            "try C3 ROM SLIP via S3 UART-over-CAN. This path has never ACKed on this "
            "hardware; J15 USB-UART is the reliable first program. Does not hang the TUI."
        ),
    )
    fl.add_argument(
        "--slup",
        action="store_true",
        help=(
            "UART SLUP over CAN PHY (never CAN frames). Always sends SLUP\\x01 "
            "even if TWAI ping fails. Pulse C3 RESET during the command to hit "
            "the ~1.2 s boot listen window."
        ),
    )
    fl.add_argument(
        "--espnow",
        action="store_true",
        help="application OTA over ESP-NOW through CORE S3; requires global --node",
    )
    fl.add_argument(
        "--invert",
        action="store_true",
        help="invert S3 UART TX+RX (GPIO5/4) when CANH/CANL are swapped in the cable",
    )
    sub.add_parser("nfc-info", help="check ST25R100 SPI communication and identity")
    rr = sub.add_parser("nfc-reg-read", help="read one or all ST25R100 registers")
    rr.add_argument("address", nargs="?", default="all", help="address (e.g. 0x3f) or all")
    rw = sub.add_parser("nfc-reg-write", help="write an ST25R100 RW register")
    rw.add_argument("address", type=parse_int)
    rw.add_argument("value", type=parse_int)
    rw.add_argument("--force", action="store_true", help="also allow addresses marked read-only")
    ns = sub.add_parser(
        "nfc-scan",
        help="poll NFC-A on silkscreen ANT1 (RFO2/RFI2); put the tag on that coil",
    )
    ns.add_argument(
        "--antenna",
        type=int,
        choices=(1, 2),
        default=1,
        help="1 = physical ANT1 / RFO2 (default), 2 = physical ANT2 / RFO1",
    )
    probe = sub.add_parser("nfc-probe", help="repeat raw NFC-A requests with separate TX/RX diagnostics")
    probe.add_argument("--antenna", type=int, choices=(1, 2), required=True)
    probe.add_argument("--request", choices=("reqa", "wupa"), default="wupa")
    probe.add_argument("--count", type=int, default=20, help="number of probes; 0 repeats until Ctrl+C")
    probe.add_argument("--interval-ms", type=int, default=500, help="minimum host start-to-start interval")
    tr = sub.add_parser("tag-read", help="read pages from an NFC-A Type 2 tag")
    tr.add_argument("--antenna", type=int, choices=(1, 2), required=True)
    tr.add_argument("--page", type=parse_int, default=0)
    tr.add_argument("--count", type=int, default=8)
    tw = sub.add_parser("tag-write", help="write 4 bytes to an NFC-A Type 2 tag page")
    tw.add_argument("--antenna", type=int, choices=(1, 2), required=True)
    tw.add_argument("--page", type=parse_int, required=True)
    tw.add_argument("--data", required=True, help='4 hex bytes, e.g. "DE AD BE EF"')
    tw.add_argument("--force", action="store_true", help="allow ST25TN01K system/OTP areas")
    tw.add_argument("--allow-kill", action="store_true", help="explicitly allow page 0x30 (irreversible KILL)")
    args = ap.parse_args()

    port = find_port(args.port)
    console = Console(highlight=False, soft_wrap=True)
    if args.node is not None and not 0 <= args.node <= 0xFFFFFE:
        ap.error("--node must be between 0x000000 and 0xFFFFFE")
    cli = CoreClient(port, timeout=2, console=console, json_mode=args.json, node_id=args.node)
    node_label = f"0x{args.node:06X}" if args.node is not None else "legacy (single node)"
    try:
        if args.cmd == "ping":
            reply = cli.ping()
            if args.json:
                cli.emit("ping", **reply)
            else:
                response_panel(console, "CORE", {"port": port, **reply})
        elif args.cmd == "nodes":
            reply = cli.discover_nodes()
            if args.json:
                cli.emit("nodes", **reply)
            else:
                table = Table(title="ESP32-C3 nodes on CAN", box=box.ROUNDED, border_style="bright_blue")
                table.add_column("Node ID", style="bold cyan")
                table.add_column("Factory MAC", style="white")
                for node in reply.get("nodes", []):
                    table.add_row(node["node"], node["mac"])
                console.print(table)
                if not reply.get("nodes"):
                    console.print("[yellow]No addressable nodes found.[/] Firmware older than 0.15 only responds in legacy mode.")
        elif args.cmd == "status":
            reply = cli.status()
            if args.json:
                cli.emit("status", **reply)
            else:
                response_panel(console, "System status", {"port": port, "node": node_label, **reply})
        elif args.cmd == "reboot-c3":
            reply = cli.reboot_c3(args.update, args.rom)
            if args.json:
                cli.emit("reboot_c3", **reply)
            else:
                response_panel(console, "C3 reboot", {"port": port, "node": node_label, **reply})
        elif args.cmd == "rom-bridge":
            reply = cli.reboot_c3(True, True)
            if args.json:
                cli.emit("rom_bridge", **reply)
            else:
                response_panel(console, "ROM bridge", {"port": port, **reply})
            if not reply.get("ok"):
                raise FlashError("rom-bridge failed: %s" % reply.get("message"))
            if not args.json:
                console.print(
                    "[green]● Local raw bridge active.[/] Use esptool on the same USB port; "
                    "the C3 must already be in ROM mode."
                )
        elif args.cmd == "flash-c3":
            if sum((args.rom, args.slup, args.espnow)) > 1:
                ap.error("choose only one of --rom, --slup, or --espnow")
            mode = 0
            if args.rom:
                mode = 1
            elif args.slup:
                mode = 2
            elif args.espnow:
                if args.node is None:
                    ap.error("--espnow requires global --node before flash-c3")
                mode = 3
            cli.flash_c3(args.bin, mode, invert=args.invert)
        elif args.cmd == "nfc-info":
            reply = cli.nfc_info()
            clean = {k: v for k, v in reply.items() if k != "data"}
            if args.json:
                cli.emit("nfc_info", **json_safe(clean))
            else:
                response_panel(console, "ST25R100", {"port": port, **clean})
                ic = clean.get("ic_id", 0)
                if (ic & 0xF8) != 0xA8:
                    console.print(
                        "[yellow]IC is not 0xA8.[/] SPI did not see an ST25R100. "
                        "Do not debug tag coupling until nfc-info shows chip ST25R100/ST25R200."
                    )
                elif not clean.get("ready"):
                    console.print(
                        "[yellow]Chip ID is OK but RFAL is not ready.[/] "
                        "A stuck IRQ used to quarantine the reader — rebuild/flash the C3 image."
                    )
        elif args.cmd == "nfc-reg-read":
            if args.address.lower() == "all":
                addresses = range(0x40)
            else:
                address = parse_int(args.address)
                if not 0 <= address <= 0x3F:
                    raise ValueError("register address outside range 0x00..0x3F")
                addresses = (address,)
            rows = [(address, cli.nfc_reg_read(address)) for address in addresses]
            if args.json:
                cli.emit("nfc_registers", registers=[{
                    "address": address, "name": ST25R100_REGISTERS[address], "value": value,
                    "hex": f"0x{value:02X}", "access": "ro" if address in ST25R100_RO else "rw",
                    "interpretation": interpret_register(address, value),
                } for address, value in rows])
            else:
                show_registers(console, rows)
                if any(address in (0x3C, 0x3D, 0x3E) for address, _ in rows):
                    console.print("[yellow]Note:[/] reading IRQ registers may consume or clear latched events.")
        elif args.cmd == "nfc-reg-write":
            if not 0 <= args.address <= 0x3F or not 0 <= args.value <= 0xFF:
                raise ValueError("address 0x00..0x3F and value 0x00..0xFF are required")
            if args.address in ST25R100_RO and not args.force:
                raise ValueError("the datasheet marks this register read-only; use --force only for intentional diagnostics")
            cli.nfc_reg_write(args.address, args.value)
            value = cli.nfc_reg_read(args.address)
            result = {"address": args.address, "name": ST25R100_REGISTERS[args.address], "value": value,
                      "hex": f"0x{value:02X}", "interpretation": interpret_register(args.address, value)}
            if args.json:
                cli.emit("nfc_register_written", **result)
            else:
                show_registers(console, [(args.address, value)])
        elif args.cmd == "nfc-probe":
            if args.count < 0 or args.interval_ms < 100:
                raise ValueError("count must be nonnegative and interval-ms must be at least 100")
            index = 0
            try:
                while args.count == 0 or index < args.count:
                    started = time.monotonic()
                    result = cli.nfc_probe(args.antenna, args.request == "wupa")
                    index += 1
                    result.update(probe=index, elapsed_ms=round((time.monotonic() - started) * 1000, 1))
                    if args.json:
                        cli.emit("nfc_probe", **result)
                    else:
                        response_panel(console, "NFC probe", result)
                        if index == 1 and not result.get("atqa_valid"):
                            console.print(
                                "[yellow]TX without ATQA:[/] after flash, "
                                "[bold]nfc-reg-read 0x01[/] must show "
                                "antenna RFO2/RFI2, mode single-ended for ANT1. "
                                "Scope RFO2 (driver) vs RFI2 (divider into the chip). "
                                "Field on RFO2 and a flat RFI2 is a matching/RX hardware path."
                            )
                    if args.count == 0 or index < args.count:
                        time.sleep(max(0, args.interval_ms / 1000 - (time.monotonic() - started)))
            except KeyboardInterrupt:
                if not args.json:
                    console.print("[yellow]NFC probe stopped[/]")
        elif args.cmd == "nfc-scan":
            result = cli.nfc_scan(args.antenna)
            if result.get("found") and result.get("tag_type_code") == 1:
                try:
                    product = cli.nfc_tag_read(result["antenna"], 45)
                    pc = product[0] | (product[1] << 8)
                    result.update(
                        product_code=f"0x{pc:04X}",
                        model="ST25TN01K" if pc == 0x9090 else "ST25TN512" if pc == 0x9091 else "unknown Type 2",
                        product_revision=f"0x{product[2]:02X}",
                        key_id=f"0x{product[3]:02X}",
                    )
                except FlashError:
                    result["model"] = "NFC-A Type 2 (Product ID unreadable)"
            if args.json:
                cli.emit("nfc_scan", **result)
            elif result["found"]:
                response_panel(console, "Tag detected", result)
            else:
                response_panel(console, "NFC scan", result)
                console.print(
                    "[yellow]Default is ANT1[/] (silkscreen ANT1 = ST25R100 RFO2/RFI2). "
                    "Put the tag on that coil, not the phone on the BACKBONE. "
                    "Timeout = no ATQA after WUPA. Status 255 = C3 did not answer TWAI. "
                    "Try ANT2 only with [bold]--antenna 2[/]."
                )
        elif args.cmd == "tag-read":
            if not 0 <= args.page <= 0x3F or not 1 <= args.count <= 64 or args.page + args.count > 64:
                raise ValueError("ST25TN01K exposes 64 pages: page 0..63 and a valid count are required")
            rows = [(page, cli.nfc_tag_read(args.antenna, page)) for page in range(args.page, args.page + args.count)]
            if args.json:
                cli.emit("tag_pages", antenna=args.antenna, pages=[{
                    "page": page, "address": page * 4, "hex": data.hex().upper(),
                    "bytes": list(data), "interpretation": interpret_t2t_page(page, data),
                } for page, data in rows])
            else:
                show_tag_pages(console, args.antenna, rows)
        elif args.cmd == "tag-write":
            compact = args.data.replace("0x", "").replace(" ", "").replace(":", "").replace("-", "")
            try:
                data = bytes.fromhex(compact)
            except ValueError as exc:
                raise ValueError("--data must contain hexadecimal bytes") from exc
            if len(data) != 4 or not 0 <= args.page <= 0x3F:
                raise ValueError("exactly 4 bytes and an ST25TN01K page from 0 to 63 are required")
            if args.page in (0, 1, 45) or 49 <= args.page <= 59:
                raise ValueError("ST25TN01K identification/internal-area page is not writable")
            if args.page == 48 and not (args.force and args.allow_kill):
                raise ValueError("page 0x30 is the irreversible KILL keyhole: --force and --allow-kill are required")
            if not 4 <= args.page <= 43 and not args.force:
                raise ValueError("outside user memory 0x04..0x2B; use --force for system/OTP areas")
            product = cli.nfc_tag_read(args.antenna, 45)
            product_code = product[0] | (product[1] << 8)
            if product_code != 0x9090 and not args.force:
                raise ValueError(f"tag is not identified as ST25TN01K (PC=0x{product_code:04X}); use --force if intentional")
            cli.nfc_tag_write(args.antenna, args.page, data)
            verify = cli.nfc_tag_read(args.antenna, args.page)
            result = {"antenna": args.antenna, "model": "ST25TN01K" if product_code == 0x9090 else "unknown",
                      "product_code": f"0x{product_code:04X}", "page": args.page, "hex": verify.hex().upper(),
                      "verified": verify == data, "interpretation": interpret_t2t_page(args.page, verify)}
            if args.json:
                cli.emit("tag_page_written", **result)
            else:
                show_tag_pages(console, args.antenna, [(args.page, verify)])
                console.print("[green]● Write verified[/]" if verify == data else "[red]● Verification failed[/]")
        return 0
    except (TimeoutError, FlashError, ValueError, serial.SerialException) as exc:
        error_context = dict(cli.flash_context)
        error_context.update(phase="failed", ok=False, message=str(exc))
        cli.emit("flash_error" if cli.flash_context else "error", **error_context)
        if not args.json:
            console.print(
                Panel(
                    str(exc),
                    title=("[bold red]Update interrupted[/]" if cli.flash_context
                           else "[bold red]Command failed[/]"),
                    border_style="red",
                    box=box.ROUNDED,
                )
            )
        return 2
    finally:
        cli.close()


if __name__ == "__main__":
    sys.exit(main())
