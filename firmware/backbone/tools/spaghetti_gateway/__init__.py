"""BLE → Node-RED gateway: Protocol V1 envelopes over local WebSocket."""

from tools.spaghetti_gateway.constants import (
    ENVELOPE_MAX,
    FRAME_HEADER_SIZE,
    MAX_CORES_DEFAULT,
)

__all__ = [
    "ENVELOPE_MAX",
    "FRAME_HEADER_SIZE",
    "MAX_CORES_DEFAULT",
]
