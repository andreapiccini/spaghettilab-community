export type WhiteLedStep = { kind: "on" | "off" | "intensity"; value: number };
export type WhiteLedConfig = { initialIntensity: number; actions: readonly { id: string; name: string; steps: readonly WhiteLedStep[] }[] };
export function whiteLedConfig(properties: Readonly<Record<string, unknown>>): WhiteLedConfig {
  const raw = properties.whiteLedConfig;
  if (typeof raw === "string") { try { return JSON.parse(raw) as WhiteLedConfig; } catch { /* legacy node */ } }
  return { initialIntensity: 0, actions: [
    { id: "on", name: "Accendi", steps: [{ kind: "on", value: 100 }] },
    { id: "off", name: "Spegni", steps: [{ kind: "off", value: 0 }] },
    { id: "intensity", name: "Imposta intensità", steps: [{ kind: "intensity", value: 50 }] },
  ] };
}
export function whiteLedProperties(properties: Readonly<Record<string, unknown>>) {
  const config = whiteLedConfig(properties);
  const percent = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("LED bianco: l’intensità deve essere un intero da 0 a 100."); return n; };
  const result: Record<string, bigint | boolean | string> = { "1": 1n, "2": false, "3": BigInt(percent(config.initialIntensity)) };
  for (const [index, id] of ["on", "off", "intensity"].entries()) {
    const action = config.actions.find(a => a.id === id);
    if (!action || !action.steps.length || action.steps.length > 8) throw new Error("LED bianco: ogni azione richiede da 1 a 8 passi.");
    result[String(6 + index)] = action.steps.map(step => step.kind === "on" ? 100 : step.kind === "off" ? 0 : percent(step.value)).join(",");
  }
  return result;
}
