import {
  evaluateAdapterExpression,
  packAdapterValue,
  type AdapterContext,
  type AdapterValue,
} from "./display-adapter-expression.js";
import {
  createNamedAction,
  effectiveActionSteps,
  parseVarRef,
  recipeVariables,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";

export const DISPLAY_TOOLS_META_KEY = "__displayTools";
export const DISPLAY_FUNCTIONS = [
  "pixel",
  "line",
  "rect",
  "text",
  "clear",
  "flush",
] as const;
export type DisplayFunction = (typeof DISPLAY_FUNCTIONS)[number];
export const DISPLAY_FUNCTION_LABELS: Record<DisplayFunction, string> = {
  pixel: "Punto",
  line: "Linea",
  rect: "Rettangolo",
  text: "Testo",
  clear: "Pulisci",
  flush: "Aggiorna",
};
export type DisplayElement = {
  id: string;
  kind: Exclude<DisplayFunction, "flush">;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: 0 | 1;
  text: string;
  filled: boolean;
};
export type AdapterInput = {
  variableId: string;
  expression: string;
  width: number;
  byteOrder: "le" | "be";
};
export type AdapterOutput = { name: string; expression: string };
export type DisplayAdapterCall = {
  id: string;
  actionId: string;
  inputs: readonly AdapterInput[];
  outputs: readonly AdapterOutput[];
  repeat: "once" | "frame-chunks";
  chunkSize: number;
};
export type DisplayAdapter = Partial<
  Record<DisplayFunction, readonly DisplayAdapterCall[]>
>;
export type DisplayToolProject = {
  version: 1;
  id: string;
  name: string;
  driverId: string;
  width: number;
  height: number;
  packing: "pages" | "rows";
  elements: readonly DisplayElement[];
  adapter: DisplayAdapter;
};
export const createDisplayTool = (): DisplayToolProject => ({
  version: 1,
  id: crypto.randomUUID(),
  name: "Display",
  driverId: "",
  width: 128,
  height: 64,
  packing: "pages",
  elements: [],
  adapter: {},
});
export function parseDisplayTools(raw?: string): readonly DisplayToolProject[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is DisplayToolProject =>
            item?.version === 1 &&
            typeof item.id === "string" &&
            Array.isArray(item.elements) &&
            item.adapter &&
            typeof item.adapter === "object",
        )
      : [];
  } catch {
    return [];
  }
}
export function displayFunctionInputs(kind: DisplayFunction): readonly string[] {
  return kind === "line"
    ? ["x1", "y1", "x2", "y2", "color"]
    : kind === "rect"
      ? ["x", "y", "width", "height", "color", "filled"]
      : kind === "pixel"
        ? ["x", "y", "color"]
        : kind === "text"
          ? ["x", "y", "text", "color"]
          : kind === "clear"
            ? ["color"]
            : ["frame", "chunk", "offset", "index", "screenWidth", "screenHeight"];
}
// Compact 5×7 bitmap font, columns with the least significant bit at the top.
const glyphs: Record<string, readonly number[]> = {
  " ": [0, 0, 0, 0, 0],
  A: [126, 17, 17, 17, 126],
  B: [127, 73, 73, 73, 54],
  C: [62, 65, 65, 65, 34],
  D: [127, 65, 65, 34, 28],
  E: [127, 73, 73, 73, 65],
  F: [127, 9, 9, 9, 1],
  G: [62, 65, 73, 73, 122],
  H: [127, 8, 8, 8, 127],
  I: [0, 65, 127, 65, 0],
  J: [32, 64, 65, 63, 1],
  K: [127, 8, 20, 34, 65],
  L: [127, 64, 64, 64, 64],
  M: [127, 2, 12, 2, 127],
  N: [127, 4, 8, 16, 127],
  O: [62, 65, 65, 65, 62],
  P: [127, 9, 9, 9, 6],
  Q: [62, 65, 81, 33, 94],
  R: [127, 9, 25, 41, 70],
  S: [70, 73, 73, 73, 49],
  T: [1, 1, 127, 1, 1],
  U: [63, 64, 64, 64, 63],
  V: [31, 32, 64, 32, 31],
  W: [63, 64, 56, 64, 63],
  X: [99, 20, 8, 20, 99],
  Y: [7, 8, 112, 8, 7],
  Z: [97, 81, 73, 69, 67],
  "0": [62, 81, 73, 69, 62],
  "1": [0, 66, 127, 64, 0],
  "2": [66, 97, 81, 73, 70],
  "3": [33, 65, 69, 75, 49],
  "4": [24, 20, 18, 127, 16],
  "5": [39, 69, 69, 69, 57],
  "6": [60, 74, 73, 73, 48],
  "7": [1, 113, 9, 5, 3],
  "8": [54, 73, 73, 73, 54],
  "9": [6, 73, 73, 41, 30],
  ".": [0, 96, 96, 0, 0],
  "-": [8, 8, 8, 8, 8],
  "!": [0, 0, 95, 0, 0],
  "?": [2, 1, 81, 9, 6],
  ":": [0, 54, 54, 0, 0],
  "/": [32, 16, 8, 4, 2],
};
export function rasterDisplay(
  project: Pick<DisplayToolProject, "width" | "height" | "elements">,
): Uint8Array {
  const { width, height } = project;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 512))
    throw new Error("Dimensioni display: da 1 a 512 pixel per lato.");
  if (project.elements.length > 256)
    throw new Error("Massimo 256 elementi nel disegno.");
  const pixels = new Uint8Array(width * height);
  const set = (x: number, y: number, color: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height)
      pixels[Math.round(y) * width + Math.round(x)] = color;
  };
  for (const element of project.elements) {
    if (
      ![element.x1, element.y1, element.x2, element.y2].every(
        (n) => Number.isInteger(n) && n >= 0 && n < 512,
      )
    )
      throw new Error("Coordinate: numeri interi tra 0 e 511.");
    let { x1: x, y1: y } = element;
    const { x2, y2, color } = element;
    switch (element.kind) {
      case "clear":
        pixels.fill(color);
        break;
      case "pixel":
        set(x, y, color);
        break;
      case "line": {
        const dx = Math.abs(x2 - x),
          sx = x < x2 ? 1 : -1,
          dy = -Math.abs(y2 - y),
          sy = y < y2 ? 1 : -1;
        let error = dx + dy;
        for (;;) {
          set(x, y, color);
          if (x === x2 && y === y2) break;
          const doubled = error * 2;
          if (doubled >= dy) {
            error += dy;
            x += sx;
          }
          if (doubled <= dx) {
            error += dx;
            y += sy;
          }
        }
        break;
      }
      case "rect":
        for (let yy = Math.min(y, y2); yy <= Math.max(y, y2); yy++)
          for (let xx = Math.min(x, x2); xx <= Math.max(x, x2); xx++)
            if (element.filled || xx === x || xx === x2 || yy === y || yy === y2)
              set(xx, yy, color);
        break;
      case "text":
        [...element.text.slice(0, 128)].forEach((char, index) => {
          const glyph = glyphs[char.toUpperCase()] ?? glyphs["?"]!;
          glyph.forEach((column, xx) => {
            for (let yy = 0; yy < 7; yy++)
              if (column & (1 << yy)) set(x + index * 6 + xx, y + yy, color);
          });
        });
        break;
    }
  }
  return pixels;
}
export function displayFrame(project: DisplayToolProject): number[] {
  const pixels = rasterDisplay(project),
    { width, height } = project;
  if (project.packing === "pages") {
    const bytes = Array.from({ length: width * Math.ceil(height / 8) }, () => 0);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (pixels[y * width + x])
          bytes[Math.floor(y / 8) * width + x]! |= 1 << (y % 8);
    return bytes;
  }
  const stride = Math.ceil(width / 8),
    bytes = Array.from({ length: stride * height }, () => 0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (pixels[y * width + x])
        bytes[y * stride + Math.floor(x / 8)]! |= 1 << (7 - (x % 8));
  return bytes;
}
export function displayInputVariables(driver: DeviceRecipeDraft) {
  const names = new Set(
    [
      ...(driver.flowInterfaces ?? []),
      ...driver.commands.flatMap((action) => action.steps),
    ].flatMap((op) =>
      op.type === "sample_external" && op.inputMode !== "trigger" ? [op.into] : [],
    ),
  );
  return recipeVariables(driver).filter((variable) => names.has(variable.name));
}
export type CompiledDisplayCall = {
  elementId: string;
  function: DisplayFunction;
  actionId: string;
  actionLabel: string;
  steps: readonly DeviceRecipeOp[];
  outputs: readonly AdapterOutput[];
  context: AdapterContext;
};
export function compileDisplayProgram(
  project: DisplayToolProject,
  driver: DeviceRecipeDraft,
): readonly CompiledDisplayCall[] {
  if (project.driverId !== driver.id)
    throw new Error("Seleziona il driver associato a questo adapter.");
  const frame = displayFrame(project),
    variables = recipeVariables(driver),
    calls: CompiledDisplayCall[] = [];
  const emit = (kind: DisplayFunction, element?: DisplayElement) => {
    const mappings = project.adapter[kind] ?? [];
    if (!mappings.length) {
      // A full-frame adapter handles all graphic primitives in one final upload.
      if (
        kind !== "flush" &&
        project.adapter.flush?.some((call) => call.repeat === "frame-chunks")
      )
        return;
      if (kind === "flush") return;
      throw new Error(
        `Mappa la funzione «${DISPLAY_FUNCTION_LABELS[kind]}» nella scheda Driver e adapter.`,
      );
    }
    for (const mapping of mappings) {
      const outputNames = new Set<string>();
      for (const output of mapping.outputs) {
        if (
          !/^[a-z_]\w*$/i.test(output.name) ||
          outputNames.has(output.name) ||
          !output.expression.trim()
        )
          throw new Error(
            "Ogni conversione di risposta richiede un nome univoco e una formula.",
          );
        outputNames.add(output.name);
      }
      const action = driver.commands.find((action) => action.id === mapping.actionId);
      if (!action)
        throw new Error(
          `${DISPLAY_FUNCTION_LABELS[kind]}: scegli un’azione del driver.`,
        );
      if (
        !Number.isInteger(mapping.chunkSize) ||
        mapping.chunkSize < 1 ||
        mapping.chunkSize > 32
      )
        throw new Error("Dimensione blocco framebuffer: da 1 a 32 byte.");
      const count =
        mapping.repeat === "frame-chunks"
          ? Math.ceil(frame.length / mapping.chunkSize)
          : 1;
      for (let index = 0; index < count; index++) {
        const offset = index * mapping.chunkSize;
        const context: AdapterContext = {
          x: element?.x1 ?? 0,
          y: element?.y1 ?? 0,
          x1: element?.x1 ?? 0,
          y1: element?.y1 ?? 0,
          x2: element?.x2 ?? 0,
          y2: element?.y2 ?? 0,
          width: element ? Math.abs(element.x2 - element.x1) + 1 : project.width,
          height: element ? Math.abs(element.y2 - element.y1) + 1 : project.height,
          text: element?.text ?? "",
          color: element?.color ?? 0,
          filled: Number(element?.filled ?? false),
          frame,
          chunk: frame.slice(offset, offset + mapping.chunkSize),
          index,
          offset,
          screenWidth: project.width,
          screenHeight: project.height,
        };
        const values = new Map<string, number[]>();
        for (const input of mapping.inputs) {
          const variable = variables.find(
            (variable) => variable.id === input.variableId,
          );
          if (!variable)
            throw new Error(
              `${action.label}: variabile dell’adapter non più disponibile.`,
            );
          if (values.has(variable.name))
            throw new Error(
              `${action.label}: la variabile ${variable.name} è mappata più volte.`,
            );
          const value = evaluateAdapterExpression(input.expression, context);
          values.set(
            variable.name,
            packAdapterValue(value, input.width, input.byteOrder),
          );
        }
        const replace = (tokens: readonly string[]) =>
          tokens.flatMap((token) => {
            const name = parseVarRef(token);
            if (!name) return [token];
            const value = values.get(name);
            if (!value)
              throw new Error(
                `${action.label}: mappa l’ingresso $${name} nell’adapter.`,
              );
            return value.map((byte) =>
              byte.toString(16).padStart(2, "0").toUpperCase(),
            );
          });
        const steps = effectiveActionSteps(driver, action).flatMap(
          (op): DeviceRecipeOp[] => {
            if (["sample_external", "encode", "decode", "emit"].includes(op.type))
              return [];
            switch (op.type) {
              case "i2c_write":
                return [{ ...op, bytes: replace(op.bytes) }];
              case "i2c_write_read":
                return [{ ...op, writeBytes: replace(op.writeBytes) }];
              case "spi_transfer":
                return [{ ...op, txBytes: replace(op.txBytes) }];
              case "w1_write":
                return [{ ...op, bytes: replace(op.bytes) }];
              case "i2c_transaction":
                return [
                  {
                    ...op,
                    phases: op.phases.map((phase) =>
                      phase.kind === "write"
                        ? { ...phase, bytes: replace(phase.bytes) }
                        : phase,
                    ),
                  },
                ];
              case "wait":
              case "i2c_read":
                return [op];
              default:
                throw new Error(
                  `${action.label}: operazione ${op.type} non eseguibile dal tool.`,
                );
            }
          },
        );
        if (!steps.length)
          throw new Error(
            `${action.label}: l’azione non contiene operazioni del dispositivo.`,
          );
        if (
          steps.some(
            (op) =>
              (op.type === "i2c_write" && op.bytes.length > 32) ||
              (op.type === "i2c_write_read" && op.writeBytes.length > 32),
          )
        )
          throw new Error(
            `${action.label}: messaggio oltre 32 byte. Riduci i byte per blocco dell’adapter.`,
          );
        calls.push({
          elementId: element?.id ?? "flush",
          function: kind,
          actionId: action.id,
          actionLabel: action.label,
          steps,
          outputs: mapping.outputs,
          context,
        });
        if (calls.length > 1024)
          throw new Error("Il programma supera 1024 chiamate del driver.");
      }
    }
  };
  project.elements.forEach((element) => emit(element.kind, element));
  if (project.elements.length) emit("flush");
  if (!calls.length)
    throw new Error("Aggiungi un elemento grafico e configura il suo adapter.");
  return calls;
}
export function displayCallDraft(
  driver: DeviceRecipeDraft,
  call: CompiledDisplayCall,
): DeviceRecipeDraft {
  const action = createNamedAction({
    id: "display-tool-test",
    label: call.actionLabel,
    steps: call.steps,
  });
  return {
    ...driver,
    category: "sensor",
    flowInterfaces: [],
    flowInterfaceActions: {},
    commands: [action],
  };
}
export function displayAdapterOutputs(
  call: CompiledDisplayCall,
  reads: readonly (readonly number[])[],
): Readonly<Record<string, AdapterValue>> {
  const context = {
    ...call.context,
    ...Object.fromEntries(reads.map((bytes, index) => [`rx${index}`, bytes])),
  };
  return Object.fromEntries(
    call.outputs.map((output) => {
      if (!/^[a-z_]\w*$/i.test(output.name))
        throw new Error("Assegna un nome valido al valore restituito dall’adapter.");
      return [output.name, evaluateAdapterExpression(output.expression, context)];
    }),
  );
}
export function displayProgramAction(
  project: DisplayToolProject,
  driver: DeviceRecipeDraft,
) {
  const calls = compileDisplayProgram(project, driver);
  return createNamedAction({
    id: `display-tool:${project.id}`,
    name: `display_${project.id.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`,
    label: project.name,
    description: "Programma grafico generato dal tool Display con adapter manuale.",
    steps: calls.flatMap((call, callIndex) =>
      call.steps.map((op, index) => ({
        ...op,
        id: `${project.id}:${callIndex}:${index}`,
      })),
    ),
    exposeOnCanvas: true,
  });
}
