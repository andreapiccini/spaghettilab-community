# SELECT / OK — four configuration slots

The hardware addition is two XKB TS-1187A-B-A-B switches, C318884, and four green Xinglight XL-3216UGC-FB LEDs, C3646937. No extra touch controller, LED driver or pull-up resistors are added. PCB outline remains78x57.2mm, with a flat rounded bottom. SELECT and OK flank the1–4 indicators below the breadboard. Touch targets and mode indicators remain aligned to physical rows at2.54mm.

## Inputs and LED channels

- SW1 SELECT: GPIO21, module pad23, historical net UI_BANK_N, switch to GND. Enable internal pull-up; active low.
- SW2 OK: GPIO13, module pad21, net GPIO13, switch to GND. Enable internal pull-up; active low. GPIO13 is shared with the parked south/mezzanine exports J25.7 and J26.22 and is reserved for OK.
- GPIO15,16,43,44,47,48 remain unassigned to the local UI.
- Debounce each switch for25ms before emitting UI edges. The reference state machine expects debounced edges.
- D700 slot1: cathode LABEL_CA6, anode LABEL_CA8.
- D701 slot2: cathode LABEL_CA6, anode LABEL_CA9.
- D702 slot3: cathode LABEL_CA7, anode LABEL_CA1.
- D703 slot4: cathode LABEL_CA7, anode LABEL_CA2.

These are four unused channels on the existing U70 IS31FL3731. Total populated driver channels66of144, leaving78free;67physical LEDs including the direct CAN termination LED. New LEDs remain on the service top, at45degrees, with illuminated number windows on the user side. Switches are on the user-facing bottom. The16-row Holtek remains dedicated to the16row electrodes. DEBUG remains a passive status indicator, not an extra menu item.

## Interaction

1. SELECT short press/release cycles PLAY/PAUSE -> STOP -> LOAD -> SAVE -> DELETE. The focused icon lights brightly; other active status indicators may be dimmer.
2. OK on LOAD, SAVE or DELETE opens the slot selector. SELECT advances1->2->3->4->1. The selected number is bright; other occupied slots may be dim, empty slots dark.
3. OK confirms LOAD or SAVE in the selected slot. DELETE requires holding OK for2seconds while the slot selector is open. A short OK press does not delete.
4. Pressing both switches requests STOP immediately after input debounce, aborts menu navigation and suppresses single-key actions until both switches are released. This also suppresses an in-progress delete hold.

PLAY applies the working configuration and starts execution. PAUSE holds existing outputs and stops program execution; it does not remove row power. STOP sets all programmable rows to logical Hi-Z while retaining the working draft. Fixed power and the ESP32 itself remain powered. Navigating actions/slots never changes outputs.

LOAD validates the stored profile first. A valid load disarms the rows, replaces the draft and requires PLAY to activate it. An empty/invalid slot leaves draft and outputs unchanged. SAVE stores a copy of the draft in the selected slot. DELETE removes only that stored slot; it does not erase the current working draft or change live outputs.

Row touch edits the draft. In the simulation, RUNNING applies row edits, PAUSED holds outputs until resuming, and STOPPED keeps outputs disconnected. Real adapters must use break-before-make and the existing reset interlock when applying a configuration.

## Reference implementation and integration boundary

Select-ok-ui.mjs implements this state machine for the interactive preview. Select-ok-ui.test.mjs exercises storage isolation, slot selection, safe load, pause retention,2-second delete, chord priority, invalid-profile rejection and disarmed initialization. Browser interaction additionally checks save/load slot2, PLAY and the simultaneous STOP shortcut.

This is NOT an installed device firmware driver. GPIO sampling/debounce, row-driver hooks, LED register mapping, program execution pause/resume and persistent storage need integration into the actual backbone firmware. The simulator's example version1 profile contains16primary row modes only. A production adapter must serialize the full validated board configuration, including MCU profiles/parameters, using the existing firmware configuration/storage contract; do not silently discard ADC/PWM or sensor settings. Persist atomically and reject incompatible profiles before altering outputs. Simulator persistence uses widget state, not ESP32 flash.

GPIO input/pull-up support: https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html

## CAD verification

The complete9-sheet schematic is present as backbone.kicad_sch and sibling sheets, with project-local symbol/footprint libraries.231electrical components match the PCB's pad nets, values and footprint identifiers. The four mechanical mounting holes have no schematic symbols. The16-row expansion pin assignments were restored to the original GND/GPIO15/16/43/44 mapping when removing stale20-row remnants. J25/J26/J27 remain parked off-board as before.

ERC:0errors and68warnings (existing one-use labels, untyped USB pins and junction warnings). The full PCB DRC still reports existing layout violations and499unrouted connections; this is not a manufacturing release. No DRC violations involve the two new switches or four new slot LEDs, and there are no schematic/PCB net-conflict warnings. See select-ok-verification.json and the complete reports.

The existing XKB footprint is reused. Its3D switch body is a locally generated dimensional proxy, not an official manufacturer model. Optical reverse mounting, PCB transmission and close-pitch row touch require a physical sample.
