# NFC workspace: software phase

The NFC workspace uses a dedicated NFC-only CAN reader and a master-mediated memory bridge.
Master firmware 0.5.2 implements NFC_PAGE (33); NFC-only readers remain peripheral devices.

## Available in the app

- Global bell (including the Devices header), unread count, immutable scan history,
  dismissible toast and optional short audio. Audio is unlocked by a user gesture.
- Tag NFC screen with module name/type, existing-driver selector including **Crea
  driver**, memory HEX, explicit read and write/verify actions.
- Global, versioned local driver library; models, physical units and project
  installations are distinct. Definitions retain their stable driver IDs and the
  installed revision is pinned. Project drafts are imported without losing old
  revisions. Drafts cannot be selected as completed drivers.
- Creating a driver opens the existing Devices editor. The previous stored draft
  is backed up, NFC drafts are saved separately in the library, and completing the
  driver returns to the tag instead of immediately placing a canvas block.
- Module recognition dialog, Backbone choice, existing-driver association, power
  declaration and connector guidance using the actual applied physical draft.
  Only **OK, connesso** creates a block, in the selected device graph. It does not
  deploy a graph automatically. Repeated scans do not create duplicate blocks.
- Current automatic wiring follows the existing I2C driver runtime. Unknown
  variants, missing/unapplied ports, ambiguous SDA/SCL, incompatible connector
  power and occupied I2C addresses block installation with a concrete explanation.
  The existing pin configurator applies hardware configuration; the NFC guide
  consumes that confirmed configuration rather than silently reconfiguring pins.
- Image references are part of model metadata, with a placeholder in the UI.
  Image asset management remains the later addition requested by the user.
- Catalog provider interface and honest unconfigured remote implementation. There
  is no invented server or fake download. Locally authored modules are never
  displayed as official; CRC integrity is not publisher authentication.

## Memory and transport contract

`NfcMemoryBridge` in `nfc-workspace.ts` is the boundary for the firmware phase:

- target: master binding, reader CAN node, antenna, expected UID;
- read: actual UID, supported family, writability, user memory bytes;
- write: user bytes only; abort signal and expected UID must be checked by the
  adapter before every page operation;
- access is serialized per reader/antenna by the adapter; UID/system/lock pages
  are never part of the ordinary writer;
- ordinary operations have an 8-second deadline; scan reads use 12 seconds and complete write/readback uses 30 seconds, all abortable;
- write success requires exact full readback from the same UID.

The production adapter in `nfc-memory-bridge.ts` supplies memory access through
`SpaghettiClient.nfcPage`. Requests include the complete UID, CAN node, antenna,
page and optional four write bytes. The master serializes page requests and waits
for the matching bounded CAN acknowledgement. ST25TN01K capability/product pages
are checked before exposing user pages 4–43. New presentations read memory before
notification; periodic discovery publishes only completed NFC snapshots so
partially received CAN responses cannot simulate repeated tag removals.

The master 0.5.2 image has been flashed and its identity/version verified. Physical
NFC page read/write still needs a supported tag presented to the connected reader;
software codec tests are not evidence of an RF write succeeding.

The explicit simulator exercises the same codec and writer. Its memory is
persisted separately, and it supports removal, replacement and timeout errors.
It never sends a production hardware command. Test notifications and tag details
are labelled **Simulazione**.

## Fair tag format SLF1 v1

The 160-byte Type 2 user area (ST25TN01K pages 4–43) contains:

| Offset | Content |
|---|---|
| 0–3 | ASCII `SLF1` |
| 4 | schema version `1` |
| 5 | type `1` = module |
| 6–7 | payload length, uint16 little endian |
| 8 onward | five UTF8 fields, each prefixed by uint8 byte length: name, model ID, unit ID, driver ID, driver revision |
| after payload | CRC32 (IEEE), little endian, over header plus payload |
| remaining | zero padding |

Names are bounded by actual UTF8 byte capacity, not character count. Neither
images nor driver code are stored in a tag. SLM1 data, including wrapped NDEF
records, remains read-only. Unknown, protected or corrupt tags are not silently
converted. SLF1 is an app format; production writes use the UID-bound master/CAN
page bridge and must complete full readback before reporting success.

## Verification

App tests cover UTF8/capacity, corrupted or truncated content, legacy retention,
write/readback, protection, unsupported family, UID replacement, removal,
deadlines, retained simulated memory, driver revisions/integrity, actual v1/v2
pins, explicit power, address conflicts, graph destination, duplicate installs,
first snapshot, continuous presence, rescanning, separate antennas and masters.
The browser flow was exercised from blank tag through driver creation, verified
write and rescan. Production CAN read/write and NFC-only master exclusion are
reserved for firmware integration and hardware tests.
