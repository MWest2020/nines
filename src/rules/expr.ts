// The condition language for win conditions, hints, events and dialogue.
//
// A small, typed expression language: literals, variables, function calls, comparison and
// boolean logic. It is parsed into an AST and evaluated by walking that AST. There is no
// `eval`, no `new Function`, no property access, no assignment and no loops, so content can
// only ask questions about state that the engine chose to expose through a Registry.
//
//   expr    := or
//   or      := and (("||" | "or") and)*
//   and     := not (("&&" | "and") not)*
//   not     := ("!" | "not") not | cmp
//   cmp     := atom (("==" | "!=" | "<" | "<=" | ">" | ">=") atom)?
//   atom    := NUMBER | STRING | "true" | "false" | IDENT | IDENT "(" args? ")" | "(" expr ")"
//   args    := expr ("," expr)*
//   NUMBER  := digits ("." digits)? ("K" | "M" | "G" | "T")?    sizes in powers of 1024
//   STRING  := '"' ... '"' | "'" ... "'"                         escapes: \\ \" \' \n \t

export type ValueType = 'number' | 'string' | 'boolean';
export type Value = number | string | boolean;

export interface Signature {
  args: ValueType[];
  returns: ValueType;
  /** For string results: the only values it can return. Lets the checker catch typos. */
  values?: readonly string[];
  /** Argument positions that must be absolute paths when given as literals. */
  pathArgs?: readonly number[];
}

export interface Registry {
  vars: Record<string, Signature>;
  funcs: Record<string, Signature>;
}

export type Node =
  | { kind: 'lit'; value: Value; pos: number }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'call'; name: string; args: Node[]; pos: number }
  | { kind: 'not'; expr: Node; pos: number }
  | { kind: 'logic'; op: '&&' | '||'; left: Node; right: Node; pos: number }
  | { kind: 'cmp'; op: CmpOp; left: Node; right: Node; pos: number };

export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export const LIMITS = { maxLength: 512, maxDepth: 24, maxArgs: 4 } as const;

export class ExprError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(`${message} (at ${pos})`);
    this.name = 'ExprError';
  }
}

// ---------------------------------------------------------------- lexer

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'eof'; pos: number };

const SIZE_SUFFIX: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
const ESCAPES: Record<string, string> = { '\\': '\\', '"': '"', "'": "'", n: '\n', t: '\t' };
const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||'];
const ONE_CHAR_OPS = ['<', '>', '!', '(', ')', ','];

export function tokenize(src: string): Tok[] {
  if (src.length > LIMITS.maxLength) {
    throw new ExprError(`expression longer than ${LIMITS.maxLength} characters`, 0);
  }
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    if (c >= '0' && c <= '9') {
      while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      }
      let v = Number(src.slice(start, i));
      const suffix = src[i];
      if (suffix !== undefined && suffix in SIZE_SUFFIX) {
        v *= SIZE_SUFFIX[suffix]!;
        i++;
      }
      if (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) {
        throw new ExprError(`bad number "${src.slice(start, i + 1)}"`, start);
      }
      toks.push({ t: 'num', v, pos: start });
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      let v = '';
      for (;;) {
        if (i >= src.length) throw new ExprError('unterminated string', start);
        const d = src[i]!;
        if (d === c) {
          i++;
          break;
        }
        if (d === '\\') {
          const e = src[i + 1];
          if (e === undefined || !(e in ESCAPES)) throw new ExprError('bad escape in string', i);
          v += ESCAPES[e];
          i += 2;
          continue;
        }
        v += d;
        i++;
      }
      toks.push({ t: 'str', v, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      toks.push({ t: 'id', v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      toks.push({ t: 'op', v: two, pos: start });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      toks.push({ t: 'op', v: c, pos: start });
      i++;
      continue;
    }
    if (c === '=') throw new ExprError('use == to compare', start);
    if (c === '&' || c === '|') throw new ExprError(`use ${c}${c}`, start);
    throw new ExprError(`unexpected character "${c}"`, start);
  }
  toks.push({ t: 'eof', pos: src.length });
  return toks;
}

// ---------------------------------------------------------------- parser

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;

  const peek = (): Tok => toks[p]!;
  const next = (): Tok => toks[p++]!;
  const isOp = (v: string): boolean => {
    const k = peek();
    return k.t === 'op' && k.v === v;
  };
  const isWord = (v: string): boolean => {
    const k = peek();
    return k.t === 'id' && k.v === v;
  };
  const expectOp = (v: string): void => {
    const k = next();
    if (k.t !== 'op' || k.v !== v) throw new ExprError(`expected "${v}"`, k.pos);
  };
  const enter = (pos: number): void => {
    if (++depth > LIMITS.maxDepth) throw new ExprError('expression nested too deeply', pos);
  };

  function parseOr(): Node {
    enter(peek().pos);
    let left = parseAnd();
    while (isOp('||') || isWord('or')) {
      const pos = next().pos;
      left = { kind: 'logic', op: '||', left, right: parseAnd(), pos };
    }
    depth--;
    return left;
  }

  function parseAnd(): Node {
    let left = parseNot();
    while (isOp('&&') || isWord('and')) {
      const pos = next().pos;
      left = { kind: 'logic', op: '&&', left, right: parseNot(), pos };
    }
    return left;
  }

  function parseNot(): Node {
    if (isOp('!') || isWord('not')) {
      const pos = next().pos;
      enter(pos);
      const expr = parseNot();
      depth--;
      return { kind: 'not', expr, pos };
    }
    return parseCmp();
  }

  function parseCmp(): Node {
    const left = parseAtom();
    const k = peek();
    if (k.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(k.v)) {
      next();
      const right = parseAtom();
      const after = peek();
      if (after.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(after.v)) {
        throw new ExprError('comparisons cannot be chained; use && between them', after.pos);
      }
      return { kind: 'cmp', op: k.v as CmpOp, left, right, pos: k.pos };
    }
    return left;
  }

  function parseAtom(): Node {
    const k = next();
    switch (k.t) {
      case 'num':
        return { kind: 'lit', value: k.v, pos: k.pos };
      case 'str':
        return { kind: 'lit', value: k.v, pos: k.pos };
      case 'id': {
        if (k.v === 'true' || k.v === 'false') return { kind: 'lit', value: k.v === 'true', pos: k.pos };
        if (['and', 'or', 'not'].includes(k.v)) throw new ExprError(`unexpected "${k.v}"`, k.pos);
        if (isOp('(')) {
          next();
          const args: Node[] = [];
          if (!isOp(')')) {
            for (;;) {
              args.push(parseOr());
              if (args.length > LIMITS.maxArgs) throw new ExprError('too many arguments', k.pos);
              if (isOp(',')) {
                next();
                continue;
              }
              break;
            }
          }
          expectOp(')');
          return { kind: 'call', name: k.v, args, pos: k.pos };
        }
        return { kind: 'var', name: k.v, pos: k.pos };
      }
      case 'op':
        if (k.v === '(') {
          const inner = parseOr();
          expectOp(')');
          return inner;
        }
        throw new ExprError(`unexpected "${k.v}"`, k.pos);
      case 'eof':
        throw new ExprError('unexpected end of expression', k.pos);
    }
  }

  const ast = parseOr();
  const end = peek();
  if (end.t !== 'eof') throw new ExprError('unexpected text after expression', end.pos);
  return ast;
}

// ---------------------------------------------------------------- checker

function sigOf(node: Node, reg: Registry): Signature | undefined {
  if (node.kind === 'var') return reg.vars[node.name];
  if (node.kind === 'call') return reg.funcs[node.name];
  return undefined;
}

/** Static type check against a registry. Returns the expression's type or throws ExprError. */
export function check(node: Node, reg: Registry): ValueType {
  switch (node.kind) {
    case 'lit':
      return typeof node.value as ValueType;
    case 'var': {
      const sig = reg.vars[node.name];
      if (!sig) {
        if (reg.funcs[node.name]) throw new ExprError(`"${node.name}" is a function; call it with ( )`, node.pos);
        throw new ExprError(`unknown name "${node.name}"`, node.pos);
      }
      return sig.returns;
    }
    case 'call': {
      const sig = reg.funcs[node.name];
      if (!sig) {
        if (reg.vars[node.name]) throw new ExprError(`"${node.name}" is not a function; drop the ( )`, node.pos);
        throw new ExprError(`unknown function "${node.name}"`, node.pos);
      }
      if (node.args.length !== sig.args.length) {
        throw new ExprError(`${node.name}() takes ${sig.args.length} argument(s), got ${node.args.length}`, node.pos);
      }
      node.args.forEach((arg, i) => {
        const t = check(arg, reg);
        if (t !== sig.args[i]) {
          throw new ExprError(`argument ${i + 1} of ${node.name}() must be a ${sig.args[i]}, got a ${t}`, arg.pos);
        }
        if (sig.pathArgs?.includes(i) && arg.kind === 'lit' && !String(arg.value).startsWith('/')) {
          throw new ExprError(`argument ${i + 1} of ${node.name}() must be an absolute path`, arg.pos);
        }
      });
      return sig.returns;
    }
    case 'not': {
      const t = check(node.expr, reg);
      if (t !== 'boolean') throw new ExprError(`"!" needs a boolean, got a ${t}`, node.pos);
      return 'boolean';
    }
    case 'logic': {
      for (const side of [node.left, node.right]) {
        const t = check(side, reg);
        if (t !== 'boolean') throw new ExprError(`"${node.op}" needs booleans, got a ${t}`, side.pos);
      }
      return 'boolean';
    }
    case 'cmp': {
      const lt = check(node.left, reg);
      const rt = check(node.right, reg);
      if (lt !== rt) throw new ExprError(`cannot compare a ${lt} with a ${rt}`, node.pos);
      if (['<', '<=', '>', '>='].includes(node.op) && lt !== 'number') {
        throw new ExprError(`"${node.op}" compares numbers only`, node.pos);
      }
      for (const [a, b] of [
        [node.left, node.right],
        [node.right, node.left],
      ] as const) {
        const sig = sigOf(a, reg);
        if (sig?.values && b.kind === 'lit' && !sig.values.includes(String(b.value))) {
          throw new ExprError(`"${String(b.value)}" is never a value here; expected one of: ${sig.values.join(', ')}`, b.pos);
        }
      }
      return 'boolean';
    }
  }
}

export interface Compiled {
  source: string;
  ast: Node;
}

/** Parse and type-check a condition. It must be boolean. Throws ExprError. */
export function compile(source: string, reg: Registry): Compiled {
  const ast = parse(source);
  const t = check(ast, reg);
  if (t !== 'boolean') throw new ExprError(`a condition must be true or false, this is a ${t}`, 0);
  return { source, ast };
}

// ---------------------------------------------------------------- evaluator

/** What an expression may ask. Implementations live with the state they read (sim, progress). */
export interface Env {
  vars: Record<string, () => Value>;
  funcs: Record<string, (...args: Value[]) => Value>;
}

export function evaluate(node: Node, env: Env): Value {
  switch (node.kind) {
    case 'lit':
      return node.value;
    case 'var': {
      const f = env.vars[node.name];
      if (!f) throw new ExprError(`no value for "${node.name}"`, node.pos);
      return f();
    }
    case 'call': {
      const f = env.funcs[node.name];
      if (!f) throw new ExprError(`no function "${node.name}"`, node.pos);
      return f(...node.args.map((a) => evaluate(a, env)));
    }
    case 'not':
      return !evaluate(node.expr, env);
    case 'logic': {
      const l = evaluate(node.left, env);
      if (node.op === '&&') return l === true ? evaluate(node.right, env) === true : false;
      return l === true ? true : evaluate(node.right, env) === true;
    }
    case 'cmp': {
      const l = evaluate(node.left, env);
      const r = evaluate(node.right, env);
      switch (node.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return (l as number) < (r as number);
        case '<=':
          return (l as number) <= (r as number);
        case '>':
          return (l as number) > (r as number);
        case '>=':
          return (l as number) >= (r as number);
      }
    }
  }
}

/** Evaluate a compiled condition. A runtime error counts as false, never as a crash. */
export function test(c: Compiled, env: Env): boolean {
  try {
    return evaluate(c.ast, env) === true;
  } catch {
    return false;
  }
}

/** Names of all functions called with a literal first argument, e.g. service("nginx"). */
export function literalCalls(node: Node, out: { name: string; arg: Value; pos: number }[] = []) {
  switch (node.kind) {
    case 'call': {
      const first = node.args[0];
      if (first?.kind === 'lit') out.push({ name: node.name, arg: first.value, pos: first.pos });
      node.args.forEach((a) => literalCalls(a, out));
      break;
    }
    case 'not':
      literalCalls(node.expr, out);
      break;
    case 'logic':
    case 'cmp':
      literalCalls(node.left, out);
      literalCalls(node.right, out);
      break;
    default:
      break;
  }
  return out;
}
