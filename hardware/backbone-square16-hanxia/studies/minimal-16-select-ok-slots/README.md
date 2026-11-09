# Sixteen-row backbone — SELECT / OK and four slots

Open backbone.kicad_pro, backbone.kicad_sch or backbone.kicad_pcb in this directory. The project contains the complete9-sheet schematic corresponding to this PCB variant, including the16-key touch controller. All231electrical components match the actual PCB pad nets, values and footprint identifiers. Project-local libraries and models are included.

Two physical XKB buttons SELECT and OK are placed below the breadboard, flanking four illuminated green slot numbers1–4. The board remains78x57.2mm with a flat rounded bottom. All row touch targets and3.3V/GND/MCU indicators remain at2.54mm and aligned with the holes. Magnetics remain centred.

SELECT uses GPIO21 (UI_BANK_N), OK uses GPIO13, both active low with internal pull-ups. Four new LEDs reuse unused channels on the existing IS31FL3731:66used,78free,67physical LEDs. No extra controller is added; six other GPIOs remain available. See UI-BOM-additions.csv and slot-indicators.json.

See SELECT-OK-UI.md for action/slot navigation,2-second delete, simultaneous STOP and the integration contract. The interactive reference logic is implemented and tested in select-ok-ui.mjs; physical firmware integration and persistent flash storage are not implemented here. It is a simulator/reference, not a flashed working board.

CAD verification and source reports are included. ERC has0errors and68warnings. No new-switch/slot-LED DRC violations or schematic/PCB net conflicts remain. Overall routing/DRC is incomplete, with legacy layout issues and499unrouted connections. Touch discrimination and reverse-mounted LED optics remain unqualified. This variant is not ready for production.

This complete variant is separate from the older parent hardware project so it does not overwrite the open KiCad files there. Previous studies and old cost summaries do not describe its final BOM. No assembly/PCB pricing is implied.
