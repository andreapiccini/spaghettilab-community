# Data

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Data distributes typed `spaghetti_record` values without exposing the producing
driver to consumers. The logger, tests, and MQTT adapter know the generic record
shape, not INA219 field names or I2C details.

## Responsibilities

Data owns the zbus channel, static observers, and diagnostic counters. It does not
perform acquisitions, own Modules or Ports, or retain publisher pointers. After each
successful zbus publish it forwards a copy to Record Delivery.

## Record Delivery

`record_delivery.c` keeps a bounded RAM ring of full record copies
(`CONFIG_SPAGHETTI_MAX_RECORD_QUEUE`) and a static cursor per compiled consumer
(`CONFIG_SPAGHETTI_MAX_RECORD_CONSUMERS`). Adapters register with
`SPAGHETTI_RECORD_CONSUMER_DEFINE` and call `set_consumer_active` when they can
accept work.

- Peek returns the next pending record for one consumer; ack advances only that
  consumer.
- Overflow drops the oldest record and increments `lost` only for active consumers
  that had not acked it.
- Inactive consumers do not hold the queue; when reactivated they start from the
  oldest record still present.
- With no active consumers the ring still retains the last N records.
- V1 does not keep history across reboot: a new `boot_id` or rising `lost` is an
  explicit discontinuity for Node-RED.

MQTT still also receives live records over zbus; the delivery consumer tracks
connection lifetime so queued records remain available after reconnect. BLE
registers a stub consumer ID for a later transport.

## File

| File | Role |
|---|---|
| `include/spaghetti/data.h` | Public record publish API and statistics. |
| `include/spaghetti/record_delivery.h` | Per-consumer queue, peek, ack, and status. |
| `subsys/data/data.c` | Channel, subscribers, logger, and publish. |
| `subsys/data/record_delivery.c` | Bounded ring and consumer cursors. |
| `tests/data/` | Fan-out and bounded pool exhaustion. |
| `tests/record_delivery/` | Ring wrap, overflow, and independent cursors. |

## API

```c
int spaghetti_data_init(void);
int spaghetti_data_publish(
	const struct spaghetti_record *record,
	k_timeout_t timeout);
int spaghetti_data_get_stats(struct spaghetti_data_stats *out);
```

The channel is `spaghetti_record_chan`. The logger prints source, schema, version,
boot ID, timestamp, sequence, and field ID/type without inventing field names.

## zbus capacity

Message subscribers share a static `net_buf` pool. Firmware configures buffers large
enough for one `spaghetti_record` (752 bytes on the minimal profile):

```ini
CONFIG_ZBUS_MSG_SUBSCRIBER_NET_BUF_STATIC_DATA_SIZE=768
```
