/** Stable authoring references are resolved into ephemeral command IDs at deploy. */
export const SEQUENCE_TYPE = "ab.sequence";
export const SEQUENCE_ID = "appblocks.sequence";
export const MOVEMENT_COMPLETED = "movement-completed";
export const MOVEMENT_COMPLETED_FIELD = 65534;
export type SequenceStep =
  | { id: string; kind: "wait"; durationMs: number }
  | {
      id: string;
      kind: "action";
      moduleId: string;
      actionId: string;
      value: number;
      waitForMotion: boolean;
    };
export const DEFAULT_SEQUENCE_STEPS: readonly SequenceStep[] = [
  { id: "wait-1", kind: "wait", durationMs: 1000 },
];
export function sequenceSteps(
  properties: Readonly<Record<string, unknown>>,
): readonly SequenceStep[] {
  if (properties.stepsJson === undefined) return DEFAULT_SEQUENCE_STEPS;
  try {
    const parsed: unknown = JSON.parse(String(properties.stepsJson));
    if (!Array.isArray(parsed)) return [];
    return parsed.every(
      (row) =>
        !!row &&
        typeof row === "object" &&
        typeof row.id === "string" &&
        (row.kind === "wait" || row.kind === "action"),
    )
      ? (parsed as SequenceStep[])
      : [];
  } catch {
    return [];
  }
}
export function validateSequenceSteps(steps: readonly SequenceStep[]): void {
  if (!steps.length || steps.length > 8)
    throw new Error("Sequenza: inserisci da 1 a 8 passi.");
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new Error("Sequenza: ogni passo deve avere un riferimento distinto.");
  for (const step of steps) {
    if (step.kind === "wait") {
      if (
        !Number.isInteger(step.durationMs) ||
        step.durationMs < 1 ||
        step.durationMs > 60000
      )
        throw new Error("Sequenza: ogni attesa deve essere tra 1 e 60000 ms.");
    } else {
      if (!step.moduleId || !step.actionId)
        throw new Error("Sequenza: scegli modulo e azione per ogni passo.");
      if (!Number.isInteger(step.value) || step.value < 0 || step.value > 0xffffffff)
        throw new Error("Sequenza: il valore deve essere un intero positivo o zero.");
    }
  }
}
export function sequenceActionNodeId(moduleId: string, actionId: string): string {
  return `sequence-action:${moduleId.length}:${moduleId}:${actionId}`;
}
export function encodeSequenceProgram(
  steps: readonly SequenceStep[],
  resolve: (step: Extract<SequenceStep, { kind: "action" }>) => {
    key: number;
    command: number;
    argument: number;
    motion: boolean;
  },
): Uint8Array {
  validateSequenceSteps(steps);
  const result = new Uint8Array(steps.length * 8);
  const view = new DataView(result.buffer);
  steps.forEach((step, index) => {
    const offset = index * 8;
    if (step.kind === "wait") {
      view.setUint32(offset + 4, step.durationMs, true);
      return;
    }
    const target = resolve(step);
    if (
      target.key < 1 ||
      target.key > 255 ||
      target.command < 1 ||
      target.command > 8 ||
      target.argument < 0 ||
      target.argument > 8
    )
      throw new Error("Sequenza: destinazione non disponibile sul Core.");
    if (target.motion && step.value > 360)
      throw new Error("Sequenza: la posizione deve essere tra 0 e 360°.");
    result[offset] = target.motion && step.waitForMotion ? 2 : 1;
    result[offset + 1] = target.key;
    result[offset + 2] = target.command;
    result[offset + 3] = target.argument;
    view.setUint32(offset + 4, step.value, true);
  });
  return result;
}
