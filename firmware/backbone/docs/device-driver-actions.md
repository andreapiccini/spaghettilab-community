# Device driver actions (firmware 0.3.5)

Wire-v1 profiles remain supported. Wire-v2 adds profile map key 14, an array of
`[action_id, first_sample_op, op_count]`. IDs are unique in 1–8. Slices are
contiguous, cover the existing shared sample-op pool (16 operations total), and
end with EMIT_RECORD. Init and safe-stop sequences remain shared by the device.
No additional static operation pool is allocated.

LOAD_ARGUMENT (opcode 26) uses the eight-word operation tuple:
`[26, dst, argument_id, required, width, little_endian, default_low, default_high]`.
Widths are 1–8 bytes; parameter IDs are 1–8. Required arguments, integer overflow,
byte lengths, duplicate and unused arguments are checked before any bus access.
Arguments support unsigned/signed integers, booleans and fixed-length bytes.
LOAD_ARGUMENT is allowed only in action sequences. Result fields must specify
their EMIT_FIELD byte width. Actions may emit a subset of the shared schema,
including no fields for a write-only action.

MODULE_COMMAND retains keys 0 (module key) and 1 (action/command ID), adding
optional key 2 (numeric field ID → argument value map). Declarative action
responses contain key 0 (field ID → decoded integer map), key 1 (actual RX byte
strings) and key 2 (capture truncated). Legacy drivers retain the empty response.
Capture is bounded to eight reads of up to eight bytes each.

The `device-action` rule invokes an action on matching records. Configuration:
1 source module key; 2 optional source action ID (0 = any); 3 target module key;
4 target action ID; 5 optional source field; 6 optional argument ID;
7 optional unsigned constant; 8 trigger (0 every record, 1 rising, 2 falling).
Source field values preserve their type when forwarded; a constant takes
precedence. Returned action records enter the runtime queue and can feed further
rules. Command chains are bounded to eight hops, including derived records.
The module-manager busy guard serializes access to each device context.

Frontend generation of wire-v2 profiles and device-action rules is a separate
compiler integration; action authoring alone does not activate runtime wiring.

Validation: ESP32-S3 signed build; 18 native tests covering communication,
profiles (including multiple actions and parameter preflight) and runtime
(including source/action filters, edge triggers and signed value forwarding).
