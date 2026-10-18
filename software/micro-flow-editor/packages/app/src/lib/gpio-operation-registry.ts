import type {
  DeviceRecipeDraft,
  DeviceRecipeOp,
  DeviceValueSource,
  GpioSignalDef,
  GpioSignalType,
} from "./device-recipe-draft.js";

export type GpioOperationType = Extract<
  DeviceRecipeOp["type"],
  | "gpio_read"
  | "gpio_write"
  | "gpio_debounce"
  | "gpio_toggle"
  | "gpio_pulse"
  | "gpio_read_analog"
  | "gpio_set_pwm"
  | "gpio_set_pwm_pulse"
  | "gpio_stop_pwm"
>;

export type GpioCapabilityRequirement =
  | "digital_read"
  | "digital_write"
  | "adc"
  | "pwm"
  | "continuous_route"
  | "timed_output";

export type GpioOperationDefinition = {
  readonly type: GpioOperationType;
  readonly label: { readonly it: string; readonly en: string };
  readonly description: { readonly it: string; readonly en: string };
  readonly signalTypes: readonly GpioSignalType[];
  readonly capabilities: readonly GpioCapabilityRequirement[];
  readonly runtime: "supported" | "representation_only";
  readonly runtimeNote?: { readonly it: string; readonly en: string };
  readonly resultType?: "bool" | "number";
};

export const GPIO_OPERATION_DEFINITIONS: readonly GpioOperationDefinition[] = [
  {
    type: "gpio_read",
    label: { it: "Leggi digitale", en: "Read digital" },
    description: {
      it: "Legge lo stato digitale del pin, anche quando è configurato come uscita.",
      en: "Reads the digital pin state, including pins configured as outputs.",
    },
    signalTypes: ["digital_input", "digital_output"],
    capabilities: ["digital_read"],
    runtime: "supported",
    resultType: "bool",
  },
  {
    type: "gpio_write",
    label: { it: "Imposta digitale", en: "Set digital" },
    description: {
      it: "Imposta HIGH/LOW rispettando la polarità logica del segnale.",
      en: "Sets HIGH/LOW while respecting the signal logical polarity.",
    },
    signalTypes: ["digital_output"],
    capabilities: ["digital_write"],
    runtime: "supported",
  },
  {
    type: "gpio_toggle",
    label: { it: "Inverti digitale", en: "Toggle digital" },
    description: {
      it: "Inverte lo stato logico corrente dell’uscita.",
      en: "Toggles the current logical output state.",
    },
    signalTypes: ["digital_output"],
    capabilities: ["digital_write"],
    runtime: "representation_only",
    runtimeNote: {
      it: "Richiede memoria dello stato nel backend GPIO.",
      en: "Requires GPIO state memory in the backend.",
    },
  },
  {
    type: "gpio_pulse",
    label: { it: "Impulso digitale", en: "Pulse digital" },
    description: {
      it: "Attiva l’uscita per una durata e poi ripristina lo stato.",
      en: "Activates the output for a duration, then restores its state.",
    },
    signalTypes: ["digital_output"],
    capabilities: ["digital_write", "timed_output"],
    runtime: "supported",
  },
  {
    type: "gpio_debounce",
    label: { it: "Antirimbalzo", en: "Debounce" },
    description: {
      it: "Stabilizza un ingresso digitale campionato.",
      en: "Stabilizes a sampled digital input.",
    },
    signalTypes: ["digital_input"],
    capabilities: ["digital_read"],
    runtime: "representation_only",
    runtimeNote: {
      it: "Richiede polling o interrupt supportato dal backend.",
      en: "Requires backend-supported polling or interrupts.",
    },
    resultType: "bool",
  },
  {
    type: "gpio_read_analog",
    label: { it: "Leggi analogico", en: "Read analog" },
    description: {
      it: "Legge il valore ADC grezzo e, se configurato, quello convertito.",
      en: "Reads raw ADC and, when configured, converted values.",
    },
    signalTypes: ["analog_input"],
    capabilities: ["adc"],
    runtime: "representation_only",
    runtimeNote: {
      it: "Richiede una rotta ADC compatibile assegnata dall’hardware.",
      en: "Requires a compatible ADC route assigned by hardware.",
    },
    resultType: "number",
  },
  {
    type: "gpio_set_pwm",
    label: { it: "Imposta PWM", en: "Set PWM" },
    description: {
      it: "Imposta frequenza e duty cycle dell’uscita PWM.",
      en: "Sets PWM output frequency and duty cycle.",
    },
    signalTypes: ["pwm_output"],
    capabilities: ["pwm", "continuous_route"],
    runtime: "representation_only",
    runtimeNote: {
      it: "Richiede una rotta PWM continua e bloccabile.",
      en: "Requires a continuous lockable PWM route.",
    },
  },
  {
    type: "gpio_set_pwm_pulse",
    label: { it: "Imposta larghezza impulso", en: "Set pulse width" },
    description: {
      it: "Imposta la larghezza impulso in microsecondi.",
      en: "Sets pulse width in microseconds.",
    },
    signalTypes: ["pwm_output"],
    capabilities: ["pwm", "continuous_route"],
    runtime: "representation_only",
  },
  {
    type: "gpio_stop_pwm",
    label: { it: "Ferma PWM", en: "Stop PWM" },
    description: {
      it: "Ferma il PWM applicando il comportamento sicuro configurato.",
      en: "Stops PWM using the configured safe behavior.",
    },
    signalTypes: ["pwm_output"],
    capabilities: ["pwm"],
    runtime: "representation_only",
  },
] as const;

export function gpioOperationDefinition(
  type: DeviceRecipeOp["type"],
): GpioOperationDefinition | undefined {
  return GPIO_OPERATION_DEFINITIONS.find((definition) => definition.type === type);
}

export function gpioSignalType(signal: GpioSignalDef): GpioSignalType {
  if (signal.signalType) return signal.signalType;
  return signal.direction === "in" ? "digital_input" : "digital_output";
}

export function normalizeGpioSignal(signal: GpioSignalDef): GpioSignalDef {
  const signalType = gpioSignalType(signal);
  return {
    ...signal,
    identifier: signal.identifier?.trim() || signal.id,
    description: signal.description ?? "",
    signalType,
    requirements:
      signal.requirements ??
      (signalType === "digital_input"
        ? { readable: true }
        : signalType === "digital_output"
          ? { writable: true }
          : signalType === "analog_input"
            ? { readable: true, adc: true }
            : { writable: true, pwm: true, dedicatedRoute: true }),
  };
}

export function compatibleGpioSignals(
  draft: Pick<DeviceRecipeDraft, "binding">,
  type: GpioOperationType,
): readonly GpioSignalDef[] {
  const definition = gpioOperationDefinition(type);
  if (!definition) return [];
  return draft.binding.gpioSignals.filter((signal) =>
    definition.signalTypes.includes(gpioSignalType(signal)),
  );
}

export function defaultGpioOperation(
  type: GpioOperationType,
  draft: DeviceRecipeDraft,
  id: string,
): DeviceRecipeOp {
  const signal = compatibleGpioSignals(draft, type)[0] ?? draft.binding.gpioSignals[0];
  const signalId = signal?.id ?? "SIGNAL";
  switch (type) {
    case "gpio_read":
      return { id, type, signalId, into: "livello" };
    case "gpio_write":
      return { id, type, signalId, level: 1 };
    case "gpio_debounce":
      return { id, type, signalId, sampleMs: 5, stableMs: 20, into: "livello" };
    case "gpio_toggle":
      return { id, type, signalId };
    case "gpio_pulse":
      return {
        id,
        type,
        signalId,
        activeState: 1,
        durationMs: { kind: "fixed", value: 500 },
        restoreState: 0,
      };
    case "gpio_read_analog":
      return { id, type, signalId, into: "raw" };
    case "gpio_set_pwm":
      return {
        id,
        type,
        signalId,
        frequencyHz: {
          kind: "fixed",
          value: signal?.configuration?.pwmFrequencyHz ?? 1000,
        },
        dutyPercent: {
          kind: "fixed",
          value: signal?.configuration?.initialDutyPercent ?? 0,
        },
      };
    case "gpio_set_pwm_pulse":
      return {
        id,
        type,
        signalId,
        pulseWidthUs: {
          kind: "fixed",
          value: signal?.configuration?.pulseWidthUs ?? 1500,
        },
      };
    case "gpio_stop_pwm":
      return { id, type, signalId, behavior: "configured" };
  }
}

export function gpioWriteLogicalLevel(
  op: Extract<DeviceRecipeOp, { type: "gpio_write" }>,
): 0 | 1 | undefined {
  if (!op.value) return op.level;
  if (op.value.kind !== "fixed") return undefined;
  if (typeof op.value.value === "boolean") return op.value.value ? 1 : 0;
  if (typeof op.value.value === "number") return op.value.value ? 1 : 0;
  if (op.value.value === "HIGH" || op.value.value === "high") return 1;
  if (op.value.value === "LOW" || op.value.value === "low") return 0;
  return op.level;
}

export function physicalLevelForSignal(signal: GpioSignalDef, logical: 0 | 1): 0 | 1 {
  return signal.activeLow ? ((logical === 1 ? 0 : 1) as 0 | 1) : logical;
}

function validateValueSource(
  source: DeviceValueSource,
  draft: DeviceRecipeDraft,
): string | undefined {
  if (source.kind === "fixed")
    return typeof source.value === "number" && Number.isFinite(source.value)
      ? undefined
      : "Il valore fisso deve essere numerico";
  if (source.kind === "parameter")
    return draft.commands.some((command) =>
      command.params.some((parameter) => parameter.id === source.parameterId),
    )
      ? undefined
      : `Parametro azione mancante: ${source.parameterId}`;
  return draft.variables.some((variable) => variable.name === source.name)
    ? undefined
    : `Variabile mancante: ${source.name}`;
}

export function validateGpioOperation(
  op: DeviceRecipeOp,
  draft: DeviceRecipeDraft,
): readonly string[] {
  const definition = gpioOperationDefinition(op.type);
  if (!definition || !("signalId" in op)) return [];
  const errors: string[] = [];
  const signal = draft.binding.gpioSignals.find((item) => item.id === op.signalId);
  if (!signal) return [`Segnale GPIO mancante: ${op.signalId}`];
  if (!definition.signalTypes.includes(gpioSignalType(signal))) {
    errors.push(
      `${definition.label.it} non è compatibile con ${signal.name} (${gpioSignalType(signal)})`,
    );
  }
  if (op.type === "gpio_write" && op.value) {
    const error = validateValueSource(op.value, draft);
    if (error) errors.push(error);
  }
  if (op.type === "gpio_debounce") {
    if (op.sampleMs <= 0) errors.push("Il campionamento deve essere maggiore di 0 ms");
    if (op.stableMs < op.sampleMs)
      errors.push("La stabilità deve essere almeno pari al campionamento");
  }
  if (op.type === "gpio_pulse") {
    const error = validateValueSource(op.durationMs, draft);
    if (error) errors.push(error);
    if (op.durationMs.kind === "fixed" && Number(op.durationMs.value) <= 0)
      errors.push("La durata impulso deve essere maggiore di 0 ms");
  }
  if (op.type === "gpio_set_pwm") {
    for (const source of [op.frequencyHz, op.dutyPercent]) {
      const error = validateValueSource(source, draft);
      if (error) errors.push(error);
    }
    if (
      op.dutyPercent.kind === "fixed" &&
      (Number(op.dutyPercent.value) < 0 || Number(op.dutyPercent.value) > 100)
    )
      errors.push("Il duty cycle deve essere tra 0 e 100%");
  }
  if (op.type === "gpio_set_pwm_pulse") {
    const error = validateValueSource(op.pulseWidthUs, draft);
    if (error) errors.push(error);
    if (op.pulseWidthUs.kind === "fixed" && Number(op.pulseWidthUs.value) <= 0)
      errors.push("La larghezza impulso deve essere maggiore di 0 µs");
  }
  return errors;
}

export function validateGpioSignal(signal: GpioSignalDef): readonly string[] {
  const errors: string[] = [];
  const type = gpioSignalType(signal);
  const config = signal.configuration;
  if (!(signal.identifier ?? signal.id).trim())
    errors.push(`${signal.name}: identificatore obbligatorio`);
  if (type === "digital_input") {
    if ((config?.debounceMs ?? 0) < 0)
      errors.push(`${signal.name}: debounce non valido`);
    if (config?.pollingIntervalMs !== undefined && config.pollingIntervalMs <= 0)
      errors.push(`${signal.name}: intervallo polling non valido`);
  }
  if (type === "analog_input") {
    if (config?.samplingIntervalMs !== undefined && config.samplingIntervalMs <= 0)
      errors.push(`${signal.name}: intervallo campionamento non valido`);
    if (
      config?.rawMin !== undefined &&
      config.rawMax !== undefined &&
      config.rawMin === config.rawMax
    )
      errors.push(`${signal.name}: intervallo ADC nullo`);
    if (
      config?.calibrationMultiplier !== undefined &&
      !Number.isFinite(config.calibrationMultiplier)
    )
      errors.push(`${signal.name}: moltiplicatore calibrazione non valido`);
  }
  if (type === "pwm_output") {
    if ((config?.pwmFrequencyHz ?? 0) <= 0)
      errors.push(`${signal.name}: frequenza PWM non valida`);
    const dutyValues = [
      config?.initialDutyPercent ?? 0,
      config?.dutyMinPercent ?? 0,
      config?.dutyMaxPercent ?? 100,
      config?.safeDutyPercent ?? 0,
    ];
    if (dutyValues.some((value) => value < 0 || value > 100))
      errors.push(`${signal.name}: duty cycle fuori intervallo 0–100%`);
    if ((config?.dutyMinPercent ?? 0) > (config?.dutyMaxPercent ?? 100))
      errors.push(`${signal.name}: duty minimo maggiore del massimo`);
  }
  return errors;
}
