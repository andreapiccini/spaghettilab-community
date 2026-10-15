/** Small expression language for manual byte adapters. No JavaScript/eval or object access. */
export type AdapterValue = number | string | readonly number[];
export type AdapterContext = Readonly<Record<string, AdapterValue>>;
const numeric = (value: AdapterValue): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Serve un valore numerico finito.");
  return value;
};
export function adapterBytes(value: AdapterValue): number[] {
  if (!Array.isArray(value)) throw new Error("Serve una lista di byte.");
  if (
    value.length > 65536 ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  )
    throw new Error("Ogni byte deve essere compreso tra 0 e 255.");
  return [...value];
}
export function packAdapterValue(
  value: AdapterValue,
  width: number,
  order: "be" | "le",
): number[] {
  if (Array.isArray(value)) return adapterBytes(value);
  const n = numeric(value);
  if (!Number.isSafeInteger(n) || !Number.isInteger(width) || width < 1 || width > 8)
    throw new Error(
      "Conversione in byte: intero esatto e larghezza da 1 a 8 richiesti.",
    );
  const big = BigInt(n),
    bits = BigInt(width * 8);
  if (big < -(1n << (bits - 1n)) || big >= 1n << bits)
    throw new Error(`Il valore ${n} non entra in ${width} byte.`);
  const packed = BigInt.asUintN(width * 8, big);
  const bytes = Array.from({ length: width }, (_, i) =>
    Number((packed >> BigInt(i * 8)) & 255n),
  );
  return order === "be" ? bytes.reverse() : bytes;
}
const precedence: Record<string, number> = {
  "|": 1,
  "^": 2,
  "&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "<<": 6,
  ">>": 6,
  ">>>": 6,
  "+": 7,
  "-": 7,
  "*": 8,
  "/": 8,
  "%": 8,
};
export function evaluateAdapterExpression(
  source: string,
  context: AdapterContext,
): AdapterValue {
  if (!source.trim() || source.length > 4096)
    throw new Error("Inserisci una formula (massimo 4096 caratteri).");
  const tokens: string[] = [];
  const lexer =
    /\s*(0x[0-9a-f]+|0b[01]+|\d+(?:\.\d+)?|[a-z_]\w*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|>>>|>>|<<|<=|>=|==|!=|\[|\]|[+\-*/%&|^~(),<>])/giy;
  let offset = 0;
  while (offset < source.trimEnd().length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(source);
    if (!match)
      throw new Error(
        `Formula non valida vicino a «${source.slice(offset, offset + 15)}».`,
      );
    tokens.push(match[1]!);
    offset = lexer.lastIndex;
  }
  let cursor = 0,
    depth = 0;
  const take = () => tokens[cursor++];
  const expect = (token: string) => {
    if (take() !== token) throw new Error(`Atteso «${token}».`);
  };
  const functions: Record<string, (...values: AdapterValue[]) => AdapterValue> = {
    bytes: (...values) => adapterBytes(values.map(numeric)),
    concat: (...values) => adapterBytes(values.flatMap((value) => adapterBytes(value))),
    utf8: (value) => {
      if (typeof value !== "string") throw new Error("utf8 richiede testo.");
      return [...new TextEncoder().encode(value)];
    },
    ascii: (value) => {
      if (
        typeof value !== "string" ||
        [...value].some((char) => char.charCodeAt(0) > 127)
      )
        throw new Error("ascii richiede testo ASCII.");
      return [...value].map((char) => char.charCodeAt(0));
    },
    slice: (value, start, count) =>
      adapterBytes(value).slice(
        numeric(start),
        count === undefined ? undefined : numeric(start) + numeric(count),
      ),
    len: (value) =>
      typeof value === "string" || Array.isArray(value) ? value.length : 1,
    lo: (value) => numeric(value) & 255,
    hi: (value) => (numeric(value) >>> 8) & 255,
    le16: (value) => packAdapterValue(value, 2, "le"),
    be16: (value) => packAdapterValue(value, 2, "be"),
    le32: (value) => packAdapterValue(value, 4, "le"),
    be32: (value) => packAdapterValue(value, 4, "be"),
    min: (...values) => Math.min(...values.map(numeric)),
    max: (...values) => Math.max(...values.map(numeric)),
    round: (value) => Math.round(numeric(value)),
    floor: (value) => Math.floor(numeric(value)),
    clamp: (value, min, max) =>
      Math.max(numeric(min), Math.min(numeric(max), numeric(value))),
  };
  function atom(): AdapterValue {
    if (++depth > 64) throw new Error("Formula troppo annidata.");
    const token = take();
    let value: AdapterValue;
    if (token === "(") {
      value = expression();
      expect(")");
    } else if (token === "-" || token === "+" || token === "~") {
      const operand = numeric(atom());
      value = token === "-" ? -operand : token === "~" ? ~operand : operand;
    } else if (token === "[") {
      const values: number[] = [];
      if (tokens[cursor] !== "]") {
        do {
          values.push(numeric(expression()));
        } while (tokens[cursor] === "," && take());
      }
      expect("]");
      value = adapterBytes(values);
    } else if (token && /^\d/.test(token)) value = Number(token);
    else if (token?.startsWith('"')) value = JSON.parse(token) as string;
    else if (token?.startsWith("'"))
      value = token.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    else if (token && /^[a-z_]\w*$/i.test(token)) {
      if (tokens[cursor] === "(") {
        take();
        const args: AdapterValue[] = [];
        if (tokens[cursor] !== ")") {
          do {
            args.push(expression());
          } while (tokens[cursor] === "," && take());
        }
        expect(")");
        if (!Object.hasOwn(functions, token))
          throw new Error(`Funzione «${token}» non disponibile.`);
        value = functions[token]!(...args);
      } else {
        if (!Object.hasOwn(context, token))
          throw new Error(`Parametro «${token}» non disponibile.`);
        value = context[token]!;
      }
    } else throw new Error("Valore mancante nella formula.");
    while (tokens[cursor] === "[") {
      take();
      const index = numeric(expression());
      expect("]");
      if (
        (!Array.isArray(value) && typeof value !== "string") ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length
      )
        throw new Error(`Indice ${index} non disponibile.`);
      value = value[index]!;
    }
    depth--;
    return value;
  }
  function expression(min = 0): AdapterValue {
    let left = atom();
    while ((precedence[tokens[cursor] ?? ""] ?? -1) >= min) {
      const operator = take()!,
        right = expression(precedence[operator]! + 1);
      if (operator === "+" && (typeof left === "string" || typeof right === "string")) {
        left = String(left) + String(right);
        continue;
      }
      const a = numeric(left),
        b = numeric(right);
      switch (operator) {
        case "+":
          left = a + b;
          break;
        case "-":
          left = a - b;
          break;
        case "*":
          left = a * b;
          break;
        case "/":
          if (!b) throw new Error("Divisione per zero.");
          left = a / b;
          break;
        case "%":
          if (!b) throw new Error("Divisione per zero.");
          left = a % b;
          break;
        case "&":
          left = a & b;
          break;
        case "|":
          left = a | b;
          break;
        case "^":
          left = a ^ b;
          break;
        case "<<":
          left = a << b;
          break;
        case ">>":
          left = a >> b;
          break;
        case ">>>":
          left = a >>> b;
          break;
        case "==":
          left = Number(a === b);
          break;
        case "!=":
          left = Number(a !== b);
          break;
        case "<":
          left = Number(a < b);
          break;
        case ">":
          left = Number(a > b);
          break;
        case "<=":
          left = Number(a <= b);
          break;
        case ">=":
          left = Number(a >= b);
          break;
      }
    }
    return left;
  }
  const result = expression();
  if (cursor !== tokens.length)
    throw new Error(`Elemento inatteso «${tokens[cursor]}».`);
  if (typeof result === "number") numeric(result);
  return result;
}
