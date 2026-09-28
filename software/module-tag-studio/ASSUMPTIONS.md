# Assumptions (v1)

1. Protocol layout is exactly `hardware/modules/nfc-tag/README.md` draft V1; binary fields are not invented beyond that document.
2. Product Code endianness matches bringup `core_util.py`: `pc = data[0] | (data[1] << 8)` with ST25TN01K = `0x9090` (`90 90`).
3. ST25TN01K factory lock bit plan (static page 2 + dynamic page 44) follows the pairing described in protocol §12; exact bit masks are documented in `docs/st25tn01k-lock-map.md` and must be validated on hardware before production locking.
4. Registry trust in v1 uses a **development** `dev-hash` signature = hex(SHA-256 truncated of canonical functional JSON). Not for production PKI.
5. Device binding live query from module electronics is not wired; operators may paste a hash / use zeros.
6. Kill / ANDEF / Product ID / UID writes are never offered in the UI.
7. Bringup adapter talks to a local Node server that spawns `firmware/bringup/scripts/core_util.py` with structured argv.
