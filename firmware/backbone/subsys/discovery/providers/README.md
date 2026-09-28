# Discovery providers

[← Discovery](../README.md) ·
[EXTENDING path 3](../../../EXTENDING_SPAGHETTI_LAB.md#3-discovery-provider)

Providers are optional and auto-registered via
`SPAGHETTI_DISCOVERY_PROVIDER_DEFINE`. Do not edit `discovery.c` to register a
provider. The production board V1 image links **zero** hardware providers.
Start from
[`templates/firmware/discovery_provider.c.template`](../../../templates/firmware/discovery_provider.c.template)
or the fakes in `tests/discovery_providers/`.

## Declaring a provider

```c
static const struct spaghetti_discovery_provider_ops ops = {
    .scan = my_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(my_provider) = {
    .provider_id = "board.example",
    .api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
    .method = SPAGHETTI_DISCOVERY_METHOD_EEPROM,
    .confidence = SPAGHETTI_DISCOVERY_AUTHORITATIVE,
    .probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
    .required_capabilities = SPAGHETTI_PORT_CAP_I2C,
    .ops = &ops,
};
```

Discovery does not retain provider callbacks after `scan()` returns. Each emitted
candidate is validated and copied. Duplicates use Port + provider ID + identity.

## Method notes

| Method | Guidance |
|---|---|
| EEPROM | Decode with `spaghetti_identity_record_decode()`. Removable EEPROMs use the Port I2C transaction API, not a static Devicetree EEPROM node, unless the board truly has a fixed memory. |
| I2C register | Address/register/mask come from verified board or catalog policy. Never scan every address destructively. |
| Analog | Use non-overlapping ADC windows derived from the schematic and measured tolerances. |
| 1-Wire | ROM+CRC is authoritative for presence; family code alone does not prove a full Spaghetti Module type. |
| Custom | Board-specific proprietary protocols. |

State-changing probes require `allow_state_changing` in the scan policy.

## Identity record V1

Little-endian layout consumed by `spaghetti_identity_record_decode()`:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `0x53495044` (`SPID`) |
| 4 | 1 | Format version (`1`) |
| 5 | 1 | Identity byte count (`1..16`) |
| 6 | 2 | Body length (bytes after header, excluding CRC) |
| 8 | identity_len | Stable identity bytes |
| … | 24 | Suggested type ID, NUL-padded |
| … | 1 | Bay ID (`0xFF` = unspecified) |
| … | 1 | Power rail ID (`0xFF` = unspecified) |
| … | 1 | Property count |
| … | var | Properties: `field_id` LE16 + type byte + value |
| end | 4 | CRC-32 IEEE over header + body |

Property value encodings:

- `BOOL`: 1 byte (`0`/`1`)
- `INT64` / `UINT64`: 8-byte little-endian
- `TEXT` / `BYTES`: 1-byte length then payload (bounded by schema limits)

Returns `0`, `-EINVAL`, `-EMSGSIZE`, `-EBADMSG`, `-ENOTSUP`, or `-ERANGE`.
Output candidate fields change only after the full record validates.
