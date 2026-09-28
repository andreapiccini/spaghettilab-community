"""Optional MQTT bridge: publish the same Protocol V1 bytes on V1 topics."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from tools.spaghetti_gateway.constants import DEFAULT_MQTT_BASE
from tools.spaghetti_gateway.envelope import decode_envelope


class MqttPublisher(Protocol):
    def publish(
        self,
        topic: str,
        payload: bytes,
        *,
        qos: int = 0,
        retain: bool = False,
    ) -> None: ...


@dataclass
class MemoryMqttPublisher:
    """Test double that records publishes."""

    messages: list[tuple[str, bytes, int, bool]] = field(default_factory=list)

    def publish(
        self,
        topic: str,
        payload: bytes,
        *,
        qos: int = 0,
        retain: bool = False,
    ) -> None:
        self.messages.append((topic, payload, qos, retain))


class MqttBridge:
    """
    Bridge BLE gateway traffic onto MQTT V1 topic layout.

    Publishes the exact CBOR envelope bytes — no alternate Config API.
    """

    def __init__(
        self,
        publisher: MqttPublisher,
        core_id_hex: str,
        *,
        base_topic: str = DEFAULT_MQTT_BASE,
        client_id: str = "ble-gateway",
    ) -> None:
        self.publisher = publisher
        self.core_id_hex = core_id_hex.lower()
        self.base_topic = base_topic.rstrip("/")
        self.client_id = client_id

    def _prefix(self) -> str:
        return f"{self.base_topic}/v1/cores/{self.core_id_hex}"

    def publish_response(self, envelope: bytes) -> None:
        topic = f"{self._prefix()}/responses/{self.client_id}"
        self.publisher.publish(topic, envelope, qos=1, retain=False)

    def publish_event(self, envelope: bytes) -> None:
        try:
            env = decode_envelope(envelope)
        except ValueError:
            topic = f"{self._prefix()}/state"
            self.publisher.publish(topic, envelope, qos=1, retain=True)
            return
        if env.event_type == 1:
            # records — module id unknown without payload parse; generic path
            topic = f"{self._prefix()}/modules/0/records"
            self.publisher.publish(topic, envelope, qos=0, retain=False)
        elif env.event_type == 2:
            topic = f"{self._prefix()}/state"
            self.publisher.publish(topic, envelope, qos=1, retain=True)
        elif env.event_type == 3:
            topic = f"{self._prefix()}/discovery"
            self.publisher.publish(topic, envelope, qos=1, retain=False)
        else:
            topic = f"{self._prefix()}/state"
            self.publisher.publish(topic, envelope, qos=1, retain=False)

    def publish_request_mirror(self, envelope: bytes) -> None:
        """Optional mirror of outbound requests (same bytes)."""
        topic = f"{self._prefix()}/requests/{self.client_id}"
        self.publisher.publish(topic, envelope, qos=1, retain=False)
