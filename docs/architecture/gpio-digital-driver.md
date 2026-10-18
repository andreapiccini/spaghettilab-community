# Digital GPIO drivers

Digital drivers use the same Initialization / Actions / Input–Output workbench
and Flow variable bindings as I2C drivers. Electrical wiring and DATA assignment
belong to Module Function, not Devices.

A new digital output provides HIGH, LOW, Follow input, and Read state. All actions
read the pad after executing and can publish the resulting 0/1 value. Initialization
writes the chosen initial state once when the driver is activated. A digital input
provides Read input and never changes the electrical direction while reading.
A new driver uses one stable logical DATA signal and a boolean `var1`. Renaming
variables updates GPIO value sources as well as reads and Flow interfaces.

Module Function stores `{boardKey, channel}` as `gpioAssignment` on the project
module. Deployment validates the applied direction and local board, resolves DATA
to the indexed channel, and rejects missing, ambiguous, incompatible or duplicate
assignments. A unique compatible channel can be selected automatically. An assigned
GPIO driver replaces the automatically generated raw-input module for that line;
it does not remove it from the saved project. The current native digital path
supports connector channels 0–3 and one DATA signal per driver.

The profile protocol retains GPIO_GET (7) and GPIO_SET (8), adding optional indexed
channels (GET imm0; SET imm1). GPIO_SET_VALUE (32) writes from a temporary value:
src_a is the canonical little-endian 0/1 integer, imm0 is the channel, imm1 inverts
the logical level for an active-low signal. Every source byte is checked before
changing the pin. The compiler normalizes byte order and numeric transformations;
values such as 2, -1 or 256 must fail, never be truncated into a valid level.
Old firmware rejects opcode 32 rather than silently interpreting variable writes
as immediate values.

Output pins enable their input buffer as well as output drive, allowing actual pad
readback without switching direction. Indexed state reads accept applied digital
input/output modes only. Test captures include GPIO_GET values; tests use the live
applied pin map and never guess channel zero or change physical routing.

Validation: app profile/deployment/capture tests; model wire round trips; native
profile execution tests for HIGH/LOW, inversion, readback and rejection of 256;
ESP32-S3 master build. Master 90:70:69:e1:c5:2c was updated to 0.5.2+0 with an
application-only write and hash verification. Physical GPIO wiring was not tested.
