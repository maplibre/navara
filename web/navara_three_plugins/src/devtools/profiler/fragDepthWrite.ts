/**
 * Whether a GLSL fragment shader statically uses `gl_FragDepth` once its
 * preprocessor conditionals are resolved. A shader that does turns off the
 * GPU's early depth test, so every fragment it rasterizes is shaded, hidden
 * or not.
 *
 * The source is the complete one the GPU compiles (three's define prefix and
 * resolved `#include`s). Object-like `#define`s are expanded inside `#if`
 * expressions; an unknown identifier counts as 0, as in C.
 */
export function writesFragDepth(source: string): boolean {
  const lines = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, "")
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/);

  const macros = new Map<string, string>();
  // One entry per open `#if`: whether its current branch is live, and
  // whether an earlier branch of it already was.
  const stack: { live: boolean; taken: boolean }[] = [];
  const live = () => stack.every((s) => s.live);

  for (const line of lines) {
    const directive = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!directive) {
      if (live() && /\bgl_FragDepth\b/.test(line)) return true;
      continue;
    }
    const [, name, rest] = directive;
    switch (name) {
      case "if":
      case "ifdef":
      case "ifndef": {
        // A dead parent hides every branch, so nothing is evaluated.
        const value = !live()
          ? false
          : name === "if"
            ? evaluate(rest, macros) !== 0
            : macros.has(rest.trim()) === (name === "ifdef");
        stack.push({ live: value, taken: value });
        break;
      }
      case "elif": {
        const top = stack[stack.length - 1] as
          (typeof stack)[number] | undefined;
        if (!top) break;
        const parentLive = stack.slice(0, -1).every((s) => s.live);
        const value = !top.taken && parentLive && evaluate(rest, macros) !== 0;
        top.live = value;
        top.taken ||= value;
        break;
      }
      case "else": {
        const top = stack[stack.length - 1] as
          (typeof stack)[number] | undefined;
        if (!top) break;
        top.live = !top.taken;
        top.taken = true;
        break;
      }
      case "endif":
        stack.pop();
        break;
      case "define": {
        if (!live()) break;
        const m = /^(\w+)(\([^)]*\))?\s*(.*)$/.exec(rest);
        if (m) macros.set(m[1], m[2] ? "1" : m[3].trim());
        break;
      }
      case "undef":
        if (live()) macros.delete(rest.trim());
        break;
    }
  }
  return false;
}

type Token = { kind: "num"; value: number } | { kind: "op"; value: string };

const OPERATORS = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "(",
  ")",
  "!",
  "~",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
];

/** Binary operators by precedence, lowest first. */
const BINARY: string[][] = [
  ["||"],
  ["&&"],
  ["|"],
  ["^"],
  ["&"],
  ["==", "!="],
  ["<", ">", "<=", ">="],
  ["<<", ">>"],
  ["+", "-"],
  ["*", "/", "%"],
];

function tokenize(expr: string, macros: Map<string, string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const rest = expr.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const defined = /^defined\s*(?:\(\s*(\w+)\s*\)|(\w+))/.exec(rest);
    if (defined) {
      const value = macros.has(defined[1] ?? defined[2]) ? 1 : 0;
      tokens.push({ kind: "num", value });
      i += defined[0].length;
      continue;
    }
    const number = /^(0x[0-9a-f]+|\d+(\.\d*)?(e[+-]?\d+)?)[uUlLfF]*/i.exec(
      rest,
    );
    if (number) {
      tokens.push({ kind: "num", value: Number(number[1]) });
      i += number[0].length;
      continue;
    }
    const ident = /^\w+/.exec(rest);
    if (ident) {
      tokens.push(...expand(ident[0], macros));
      i += ident[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => rest.startsWith(o));
    if (!op) throw new Error(`Unexpected "${rest[0]}" in #if ${expr}`);
    tokens.push({ kind: "op", value: op });
    i += op.length;
  }
  return tokens;
}

/** An identifier's replacement tokens; unknown or self-referencing → 0. */
function expand(
  name: string,
  macros: Map<string, string>,
  seen = new Set<string>(),
): Token[] {
  const body = macros.get(name);
  if (body === undefined || body === "" || seen.has(name)) {
    return [{ kind: "num", value: 0 }];
  }
  seen.add(name);
  const inner = new Map(macros);
  for (const s of seen) inner.delete(s);
  return [
    { kind: "op", value: "(" },
    ...tokenize(body, inner),
    { kind: "op", value: ")" },
  ];
}

function evaluate(expr: string, macros: Map<string, string>): number {
  const tokens = tokenize(expr, macros);
  let pos = 0;

  const peek = () => tokens[pos] as Token | undefined;
  const take = () => tokens[pos++];

  const unary = (): number => {
    const t = take();
    if (!t) throw new Error(`Incomplete #if ${expr}`);
    if (t.kind === "num") return t.value;
    switch (t.value) {
      case "(": {
        const value = binary(0);
        take();
        return value;
      }
      case "!":
        return unary() === 0 ? 1 : 0;
      case "-":
        return -unary();
      case "+":
        return unary();
      case "~":
        return ~unary();
    }
    throw new Error(`Unexpected "${t.value}" in #if ${expr}`);
  };

  const binary = (level: number): number => {
    if (level === BINARY.length) return unary();
    let left = binary(level + 1);
    for (;;) {
      const t = peek();
      if (!t || t.kind !== "op" || !BINARY[level].includes(t.value)) {
        return left;
      }
      take();
      const right = binary(level + 1);
      left = apply(t.value, left, right);
    }
  };

  return binary(0);
}

function apply(op: string, a: number, b: number): number {
  switch (op) {
    case "||":
      return a !== 0 || b !== 0 ? 1 : 0;
    case "&&":
      return a !== 0 && b !== 0 ? 1 : 0;
    case "|":
      return a | b;
    case "^":
      return a ^ b;
    case "&":
      return a & b;
    case "==":
      return a === b ? 1 : 0;
    case "!=":
      return a !== b ? 1 : 0;
    case "<":
      return a < b ? 1 : 0;
    case ">":
      return a > b ? 1 : 0;
    case "<=":
      return a <= b ? 1 : 0;
    case ">=":
      return a >= b ? 1 : 0;
    case "<<":
      return a << b;
    case ">>":
      return a >> b;
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? 0 : Math.trunc(a / b);
    case "%":
      return b === 0 ? 0 : a % b;
  }
  throw new Error(`Unknown operator ${op}`);
}
