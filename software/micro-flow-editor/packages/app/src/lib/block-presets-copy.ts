import type { LocaleId } from "./locale.js";
import type { BlockPreset } from "../components/physical-composition/block-presets.js";

type BlockPresetCopy = {
  readonly name: string;
  readonly category: string;
  readonly description: string;
};

type BlockLibraryChrome = {
  readonly title: string;
  readonly hint: string;
};

const LIBRARY_IT: BlockLibraryChrome = {
  title: "Libreria blocchi",
  hint: "Punti di partenza generici (nome, categoria, descrizione) — nessuna specifica elettrica (indirizzo, pin, soglie): quelle vanno inserite a mano dopo aver aggiunto il nodo, in base al componente reale scelto.",
};

const LIBRARY_EN: BlockLibraryChrome = {
  title: "Block library",
  hint: "Generic starting points (name, category, description) — no electrical specifics (address, pin, thresholds): fill those in by hand after adding the node, from the real part you chose.",
};

const EN_PRESETS: Record<string, BlockPresetCopy> = {
  "blk-io-4": {
    name: "4 digital I/O lines",
    category: "Digital I/O",
    description: "Four general-purpose digital I/O lines.",
  },
  "blk-io-3g": {
    name: "3 I/O lines + ground",
    category: "Digital I/O",
    description: "Three digital I/O lines plus the ground reference.",
  },
  "blk-io-2p5": {
    name: "2 I/O lines + 5V supply",
    category: "Digital I/O",
    description: "Two digital I/O lines plus 5V output and ground.",
  },
  "blk-relay-2lp": {
    name: "2 low-power relays",
    category: "Relays",
    description: "Two low-power mechanical relays, independent normally-open contacts.",
  },
  "blk-relay-2hp": {
    name: "2 high-power relays",
    category: "Relays",
    description: "Two high-power mechanical relays, normally-open/closed contacts.",
  },
  "blk-relay-2ss": {
    name: "2 solid-state relays",
    category: "Relays",
    description: "Two normally-open solid-state relays.",
  },
  "blk-relay-ac": {
    name: "High-voltage AC solid-state relay",
    category: "Relays",
    description: "Solid-state relay for high-voltage AC loads, normally open.",
  },
  "blk-iso-2in": {
    name: "2 isolated inputs",
    category: "Isolated inputs",
    description: "Two opto-isolated inputs with independent terminals, isolated from system ground.",
  },
  "blk-iso-3in-neg": {
    name: "3 isolated inputs, common (−)",
    category: "Isolated inputs",
    description: "Three opto-isolated inputs with a common negative terminal.",
  },
  "blk-iso-3in-pos": {
    name: "3 isolated inputs, common (+)",
    category: "Isolated inputs",
    description: "Three opto-isolated inputs with a common positive terminal.",
  },
  "blk-iso-4in": {
    name: "4 opto-isolated inputs, common ground",
    category: "Isolated inputs",
    description: "Four opto-isolated inputs with a common-ground negative terminal.",
  },
  "blk-dry-4in": {
    name: "4 dry-contact inputs",
    category: "Isolated inputs",
    description: "Four dry-contact inputs for external switches.",
  },
  "blk-rs232-4": {
    name: "RS232 port (4 lines)",
    category: "Serial",
    description: "Simple RS232 port with TX, RX, RTS, CTS lines.",
  },
  "blk-rs232-485": {
    name: "RS232/422/485 port",
    category: "Serial",
    description: "Universal serial port with electronic mode selection.",
  },
  "blk-rs485": {
    name: "RS485 port",
    category: "Serial",
    description: "Full/half-duplex RS485 port, with auxiliary 5V output.",
  },
  "blk-rs232-iso": {
    name: "Isolated RS232/422/485 port",
    category: "Serial",
    description: "Galvanically isolated serial port with mode selection.",
  },
  "blk-oc-4": {
    name: "4 open-collector outputs",
    category: "Outputs",
    description: "Four open-collector outputs.",
  },
  "blk-oc-2npn": {
    name: "2 isolated NPN 24V open-collector outputs",
    category: "Outputs",
    description: "Two isolated open-collector outputs, NPN configuration, 24V.",
  },
  "blk-oc-2pnp": {
    name: "2 isolated PNP 24V open-collector outputs",
    category: "Outputs",
    description: "Two isolated open-collector outputs, PNP configuration, 24V.",
  },
  "blk-psu-5v-lp": {
    name: "5V low-power supply",
    category: "Power",
    description: "Non-isolated supply, 5V output, 9–18V input, shutdown control.",
  },
  "blk-psu-5v-mp": {
    name: "5V medium-power supply",
    category: "Power",
    description: "Non-isolated supply, 5V output, 9–18V input, shutdown control.",
  },
  "blk-psu-5v-hp": {
    name: "5V high-power supply",
    category: "Power",
    description: "Non-isolated supply, 5V output, 8–60V input, shutdown control.",
  },
  "blk-psu-poe": {
    name: "Isolated PoE supply",
    category: "Power",
    description: "Isolated Power-over-Ethernet supply, 5V output.",
  },
  "blk-psu-wide": {
    name: "Wide-input-range supply",
    category: "Power",
    description: "Supply with 8–60V input and output current up to several amperes.",
  },
  "blk-psu-dual15": {
    name: "±15V low-power supply",
    category: "Power",
    description: "Non-isolated supply, ±15V output, 5V input.",
  },
  "blk-adc-4ch": {
    name: "4-channel ADC",
    category: "Analog",
    description: "4-channel analog-to-digital converter, ±10V range.",
  },
  "blk-dac-4ch": {
    name: "4-channel DAC",
    category: "Analog",
    description: "4-channel digital-to-analog converter, ±10V range.",
  },
  "blk-adc-stream": {
    name: "Multichannel streaming ADC",
    category: "Analog",
    description: "High-precision ADC, streaming acquisition, multichannel.",
  },
  "blk-adc-iso": {
    name: "Isolated ADC ±10V/4–20mA",
    category: "Analog",
    description: "Galvanically isolated analog-to-digital converter, voltage or current (4–20mA) input.",
  },
  "blk-pot-dig": {
    name: "Digital potentiometer",
    category: "Analog",
    description: "Digital potentiometer, 8-bit resolution, selectable resistance.",
  },
  "blk-pwm-oc": {
    name: "3 open-collector PWM",
    category: "Outputs",
    description: "Three PWM outputs with an open-collector stage.",
  },
  "blk-pwm-pwr": {
    name: "3 power PWM outputs",
    category: "Outputs",
    description: "Three PWM outputs with a power stage (external supply required).",
  },
  "blk-temp-rtd": {
    name: "RTD temperature meter",
    category: "Sensors",
    description: "Input for an RTD temperature probe.",
  },
  "blk-temp-amb": {
    name: "Ambient temperature sensor",
    category: "Sensors",
    description: "Integrated ambient temperature sensor.",
  },
  "blk-temp-hum": {
    name: "Temperature/humidity sensor",
    category: "Sensors",
    description: "Combined temperature and relative-humidity sensor.",
  },
  "blk-light": {
    name: "Ambient light sensor",
    category: "Sensors",
    description: "Ambient light sensor in the visible spectrum.",
  },
  "blk-baro": {
    name: "Barometric pressure sensor",
    category: "Sensors",
    description: "Atmospheric pressure sensor.",
  },
  "blk-accel": {
    name: "3-axis accelerometer",
    category: "Sensors",
    description: "3-axis accelerometer, usable as a shock sensor.",
  },
  "blk-btn": {
    name: "Push button",
    category: "User interface",
    description: "Single push button.",
  },
  "blk-led": {
    name: "Indicator LED",
    category: "User interface",
    description: "High-visibility indicator LED, selectable color.",
  },
  "blk-ir": {
    name: "IR receiver/transmitter",
    category: "User interface",
    description: "Infrared receiver circuit and transmitter diode.",
  },
  "blk-rtc": {
    name: "RTC with backed NVRAM",
    category: "Interface",
    description: "Real-time clock and non-volatile memory with backup battery.",
  },
  "blk-onewire": {
    name: "1-Wire port",
    category: "Interface",
    description: "Port for a 1-Wire/Single-Wire bus.",
  },
  "blk-sd": {
    name: "micro SD slot",
    category: "Storage",
    description: "Slot for a micro SD card.",
  },
  "blk-usb": {
    name: "USB port",
    category: "Interface",
    description: "USB port, Mini-B type with OTG support.",
  },
  "blk-modem-lte": {
    name: "LTE modem (4G)",
    category: "Connectivity",
    description: "LTE cellular modem for remote connectivity.",
  },
  "blk-modem-nbiot": {
    name: "Cat-M1/NB-IoT modem",
    category: "Connectivity",
    description: "Low-power cellular modem for IoT applications.",
  },
  "blk-conn-terminal": {
    name: "Terminal block",
    category: "Connectors",
    description: "Screw terminal block for direct wiring.",
  },
  "blk-conn-db9": {
    name: "DB9 connector",
    category: "Connectors",
    description: "DB9 serial connector.",
  },
  "blk-conn-power": {
    name: "Power input",
    category: "Connectors",
    description: "Power jack plus screw terminals.",
  },
  "blk-ac-detect": {
    name: "AC voltage detector",
    category: "Sensors",
    description: "Detector for AC mains voltage presence.",
  },
  "blk-fpga": {
    name: "FPGA coprocessor",
    category: "Processing",
    description: "Small FPGA for dedicated on-module logic.",
  },
};

export function blockLibraryChrome(locale: LocaleId): BlockLibraryChrome {
  return locale === "en" ? LIBRARY_EN : LIBRARY_IT;
}

export function localizedBlockPreset(preset: BlockPreset, locale: LocaleId): BlockPreset {
  if (locale !== "en") return preset;
  const en = EN_PRESETS[preset.code];
  if (!en) return preset;
  return { ...preset, ...en };
}
