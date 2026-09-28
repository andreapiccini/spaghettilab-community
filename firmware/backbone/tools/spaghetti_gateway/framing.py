"""BLE 8-byte little-endian framing and bounded reassembly."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from tools.spaghetti_gateway.constants import ENVELOPE_MAX, FRAME_HEADER_SIZE


@dataclass(frozen=True)
class FrameHeader:
    message_id: int
    offset: int
    total: int


def parse_frame_header(data: bytes) -> FrameHeader:
    if len(data) < FRAME_HEADER_SIZE:
        raise ValueError("frame too short for header")
    message_id, offset, total = struct.unpack_from("<IHH", data, 0)
    return FrameHeader(message_id=message_id, offset=offset, total=total)


def encode_frame_header(header: FrameHeader) -> bytes:
    return struct.pack("<IHH", header.message_id, header.offset, header.total)


def fragment_envelope(
    message_id: int,
    envelope: bytes,
    *,
    max_chunk: int = 180,
) -> list[bytes]:
    """Split a Protocol envelope into framed BLE ATT writes."""
    if not envelope:
        raise ValueError("empty envelope")
    if len(envelope) > ENVELOPE_MAX:
        raise ValueError("envelope exceeds absolute maximum")
    if max_chunk < 1:
        raise ValueError("max_chunk must be positive")

    total = len(envelope)
    frames: list[bytes] = []
    offset = 0
    while offset < total:
        chunk = envelope[offset : offset + max_chunk]
        header = FrameHeader(message_id=message_id, offset=offset, total=total)
        frames.append(encode_frame_header(header) + chunk)
        offset += len(chunk)
    return frames


@dataclass
class Reassembly:
    """One in-flight reassembly slot (mirrors firmware peer rules)."""

    active: bool = False
    message_id: int = 0
    total: int = 0
    received: int = 0
    buffer: bytearray = field(default_factory=bytearray)
    bitmap: set[int] = field(default_factory=set)

    def reset(self) -> None:
        self.active = False
        self.message_id = 0
        self.total = 0
        self.received = 0
        self.buffer = bytearray()
        self.bitmap.clear()

    def feed(self, frame: bytes) -> bytes | None:
        """
        Feed one framed ATT payload.

        Returns the complete envelope when all bytes are present, else None.
        Raises ValueError on protocol violations.
        """
        header = parse_frame_header(frame)
        payload = frame[FRAME_HEADER_SIZE:]
        if header.total == 0 or header.total > ENVELOPE_MAX:
            raise ValueError("invalid total")
        if header.offset > header.total:
            raise ValueError("offset beyond total")
        end = header.offset + len(payload)
        if end > header.total:
            raise ValueError("fragment overrun")

        if self.active and header.message_id != self.message_id:
            raise ValueError("second message_id while reassembly open")

        if not self.active:
            self.active = True
            self.message_id = header.message_id
            self.total = header.total
            self.buffer = bytearray(header.total)
            self.bitmap.clear()
            self.received = 0
        elif header.total != self.total:
            raise ValueError("total mismatch")

        # Exact duplicate fragments for the open message_id may be ignored.
        for index in range(header.offset, end):
            if index in self.bitmap:
                continue
            self.bitmap.add(index)
            self.buffer[index] = payload[index - header.offset]
            self.received += 1

        if self.received == self.total:
            complete = bytes(self.buffer)
            self.reset()
            return complete
        return None
