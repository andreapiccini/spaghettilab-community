import {
  describeDeviceOp,
  type DeviceRecipeOp,
} from "../../lib/device-recipe-draft.js";
import { gpioOperationDefinition } from "../../lib/gpio-operation-registry.js";
export function workbenchStepLabel(op: DeviceRecipeOp, it: boolean) {
  if (op.label?.trim()) return op.label.trim();
  const gpio = gpioOperationDefinition(op.type);
  if (gpio) return it ? gpio.label.it : gpio.label.en;
  if (op.type === "gpio_read") return it ? "Leggi ingresso" : "Read input";
  if (op.type === "gpio_write") return it ? "Imposta uscita" : "Set output";
  if (op.type === "gpio_debounce") return it ? "Filtra antirimbalzo" : "Debounce input";
  return op.type === "i2c_write"
    ? it
      ? "Scrivi messaggio"
      : "Write message"
    : op.type === "i2c_read" || op.type === "i2c_write_read"
      ? it
        ? "Leggi risposta"
        : "Read response"
      : describeDeviceOp(op);
}
export function workbenchStepDetail(
  op: DeviceRecipeOp,
  it: boolean,
  signals: readonly { id: string; name: string }[] = [],
) {
  if (op.type === "dht22_read") return `$${op.temperatureInto} · $${op.humidityInto}`;
  if (op.type === "dht22_convert") return `$${op.input} → $${op.into} · ${op.format === "float" ? "float °C" : "testo con °C"}`;
  if (op.type === "dht22_power") return op.on ? "GPIO HIGH · avvio 2 s" : "GPIO LOW · DATA ad alta impedenza";
  if (op.type === "stepper")
    return op.command === "position"
      ? `$${op.positionVariable} · 0–360°`
      : "IN1 · IN2 · IN3 · IN4";
  const signalName =
    "signalId" in op
      ? (signals.find((signal) => signal.id === op.signalId)?.name ?? op.signalId)
      : "";
  if (op.type === "gpio_read") return `${signalName} · $${op.into}`;
  if (op.type === "gpio_write")
    return `${signalName} · ${
      op.value?.kind === "parameter"
        ? op.value.parameterId
        : op.value?.kind === "variable"
          ? `$${op.value.name}`
          : op.level
            ? it
              ? "alto"
              : "high"
            : it
              ? "basso"
              : "low"
    }`;
  if (op.type === "gpio_debounce")
    return `${signalName} · ${op.sampleMs} / ${op.stableMs} ms · $${op.into}`;
  if (
    op.type === "gpio_toggle" ||
    op.type === "gpio_pulse" ||
    op.type === "gpio_read_analog" ||
    op.type === "gpio_set_pwm" ||
    op.type === "gpio_set_pwm_pulse" ||
    op.type === "gpio_stop_pwm"
  )
    return signalName;
  return op.type === "i2c_write"
    ? `${op.bytes.length} byte`
    : op.type === "i2c_read" || op.type === "i2c_write_read"
      ? `${op.type === "i2c_read" ? op.len : op.readLen} byte · $${op.into}`
      : it
        ? "Avanzato"
        : "Advanced";
}

export function workbenchStepKind(op: DeviceRecipeOp, it: boolean) {
  if (op.type === "dht22_read" || op.type === "dht22_power" || op.type === "dht22_convert") return "DHT22";
  if (op.type === "stepper") return "ULN2003";
  const gpio = gpioOperationDefinition(op.type);
  if (gpio)
    return gpio.runtime === "supported"
      ? it
        ? "GPIO"
        : "GPIO"
      : it
        ? "GPIO · backend richiesto"
        : "GPIO · backend required";
  if (op.type === "gpio_read") return it ? "Lettura GPIO" : "GPIO read";
  if (op.type === "gpio_write") return it ? "Scrittura GPIO" : "GPIO write";
  if (op.type === "gpio_debounce") return it ? "Ingresso filtrato" : "Filtered input";
  if (op.type === "i2c_write") return it ? "Scrittura" : "Write";
  if (op.type === "i2c_read") return it ? "Lettura" : "Read";
  if (op.type === "i2c_write_read") return it ? "Scrittura + lettura" : "Write + read";
  return describeDeviceOp(op);
}
