/** User-facing logical blocks. Wire properties are explicit numeric fields. */
export const LOGIC_TYPES = new Set(["logic_and", "logic_or", "logic_if", "logic_while"]);
export function logicProperties(type: string, p: Readonly<Record<string, unknown>>, inputType = "int") {
  if (!LOGIC_TYPES.has(type)) return p;
  const operation = Number(p.condition ?? 1);
  const raw = String(p.value ?? 0).trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error("Logica: inserisci un valore numerico valido.");
  const value = Number(raw);
  const decimal = ["number", "float", "string"].includes(inputType);
  if (!Number.isInteger(operation) || operation < 0 || operation > 7)
    throw new Error("Logica: scegli una condizione valida.");
  if (!Number.isFinite(value)) throw new Error("Logica: il confronto richiede un numero finito.");
  if (["number", "float"].includes(inputType) && Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new Error("Logica: questo ingresso usa due decimali; inserisci al massimo due cifre decimali.");
  if (!decimal && !Number.isSafeInteger(value)) throw new Error("Logica: l’ingresso è intero; il confronto richiede un intero.");
  if (["bool", "digital"].includes(inputType) && value !== 0 && value !== 1) throw new Error("Logica: scegli vero/alto o falso/basso.");
  if (type === "logic_if" && [p.whenTrue ?? "high", p.whenFalse ?? "low"].some(level => level !== "high" && level !== "low"))
    throw new Error("IF: scegli Alto o Basso per il risultato della condizione.");
  return type === "logic_and" || type === "logic_or" ? {} : {
    "1": BigInt(operation), "2": decimal ? 0n : BigInt(value),
    ...(decimal ? { "7": String(value), "8": inputType === "string" ? 255n : 2n } : {}),
    ...(type === "logic_if" ? { "5": p.whenTrue === "low" ? 0n : 1n, "6": p.whenFalse === "high" ? 1n : 0n } : {}),
  };
}
export function requireLogicInputType(label: string, type: string | undefined) {
  if (!type || !["bool", "boolean", "digital", "number", "float", "string", "int", "int64", "uint64", "integer", "uint8", "int16", "uint16", "int32", "uint32"].includes(type))
    throw new Error(`${label}: tipo di ingresso ${type ?? "sconosciuto"} non supportato. Collega un booleano, un segnale digitale, un numero o una stringa contenente soltanto un numero.`);
}
