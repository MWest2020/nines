import { describe, expect, it } from 'vitest';
import { check, compile, type Env, evaluate, ExprError, LIMITS, parse, type Registry, test, tokenize } from '../../src/rules/expr';
import { PROGRESS_FACTS, SCENARIO_FACTS } from '../../src/rules/registries';

const REG: Registry = {
  vars: { n: { args: [], returns: 'number' }, ok: { args: [], returns: 'boolean' }, s: { args: [], returns: 'string', values: ['a', 'b'] } },
  funcs: {
    double: { args: ['number'], returns: 'number' },
    has: { args: ['string'], returns: 'boolean' },
    p: { args: ['string'], returns: 'boolean', pathArgs: [0] },
  },
};

function env(over: Partial<{ n: number; ok: boolean; s: string }> = {}): Env & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    vars: { n: () => over.n ?? 5, ok: () => over.ok ?? true, s: () => over.s ?? 'a' },
    funcs: {
      double: (x) => (x as number) * 2,
      has: (x) => {
        calls.push(String(x));
        return x === 'yes';
      },
      p: () => true,
    },
  };
}

const run = (src: string, e: Env = env()) => test(compile(src, REG), e);

describe('lexer', () => {
  it('reads numbers with size suffixes', () => {
    const toks = tokenize('1 2.5 3K 2G');
    expect(toks.slice(0, 4).map((t) => ('v' in t ? t.v : null))).toEqual([1, 2.5, 3072, 2 * 1024 ** 3]);
  });
  it('reads both quote styles and escapes', () => {
    expect(tokenize(`"a\\"b" 'c\\'d' "x\\ny"`).slice(0, 3).map((t) => ('v' in t ? t.v : null))).toEqual(['a"b', "c'd", 'x\ny']);
  });
  it('rejects a single = with a helpful message', () => {
    expect(() => tokenize('n = 3')).toThrow(/use ==/);
  });
  it('rejects a single & or |', () => {
    expect(() => tokenize('ok & ok')).toThrow(/&&/);
    expect(() => tokenize('ok | ok')).toThrow(/\|\|/);
  });
  it('rejects unterminated strings, bad escapes and stray characters', () => {
    expect(() => tokenize('"abc')).toThrow(/unterminated/);
    expect(() => tokenize('"\\q"')).toThrow(/escape/);
    expect(() => tokenize('n + 1')).toThrow(/unexpected character/);
    expect(() => tokenize('3x')).toThrow(/bad number/);
  });
  it('limits the length', () => {
    expect(() => tokenize('n'.repeat(LIMITS.maxLength + 1))).toThrow(ExprError);
  });
});

describe('parser', () => {
  it('gives && precedence over ||', () => {
    const ast = parse('ok || ok && ok');
    expect(ast.kind === 'logic' && ast.op).toBe('||');
  });
  it('accepts the word forms and, or, not', () => {
    expect(run('not ok or n > 3 and true')).toBe(true);
  });
  it('refuses chained comparisons', () => {
    expect(() => parse('1 < n < 9')).toThrow(/chained/);
  });
  it('refuses trailing text, empty input and dangling operators', () => {
    expect(() => parse('ok ok')).toThrow(/after expression/);
    expect(() => parse('')).toThrow(/end of expression/);
    expect(() => parse('ok &&')).toThrow(/end of expression/);
    expect(() => parse('has("x"')).toThrow(/expected "\)"/);
  });
  it('limits nesting depth', () => {
    const deep = '('.repeat(LIMITS.maxDepth + 1) + 'ok' + ')'.repeat(LIMITS.maxDepth + 1);
    expect(() => parse(deep)).toThrow(/nested too deeply/);
  });
  it('has no way to reach JavaScript', () => {
    for (const src of ['constructor', 'ok.constructor', 'this', 'globalThis["x"]', 'n[0]', 'x => x', 'a = 1', '`x`']) {
      expect(() => compile(src, REG), src).toThrow(ExprError);
    }
  });
});

describe('type checker', () => {
  it('requires a boolean condition', () => {
    expect(() => compile('n', REG)).toThrow(/true or false/);
    expect(() => compile('double(2)', REG)).toThrow(/true or false/);
  });
  it('knows names, functions and arity', () => {
    expect(() => compile('nope', REG)).toThrow(/unknown name/);
    expect(() => compile('nope()', REG)).toThrow(/unknown function/);
    expect(() => compile('has', REG)).toThrow(/is a function/);
    expect(() => compile('ok()', REG)).toThrow(/not a function/);
    expect(() => compile('has()', REG)).toThrow(/takes 1/);
  });
  it('checks argument and operand types', () => {
    expect(() => compile('has(3)', REG)).toThrow(/must be a string/);
    expect(() => compile('n == "5"', REG)).toThrow(/cannot compare/);
    expect(() => compile('s < "b"', REG)).toThrow(/numbers only/);
    expect(() => compile('!n', REG)).toThrow(/needs a boolean/);
    expect(() => compile('ok && n', REG)).toThrow(/needs booleans/);
  });
  it('catches typos in known string values', () => {
    expect(() => compile('s == "c"', REG)).toThrow(/never a value/);
    expect(() => compile('"c" != s', REG)).toThrow(/never a value/);
    expect(() => compile('service("x") == "actve"', SCENARIO_FACTS)).toThrow(/never a value/);
  });
  it('wants absolute paths where a path is expected', () => {
    expect(() => compile('p("var/log")', REG)).toThrow(/absolute path/);
    expect(() => compile('disk_usage("var") < 80', SCENARIO_FACTS)).toThrow(/absolute path/);
  });
  it('accepts the examples from the brief', () => {
    for (const src of ['disk_usage("/var") < 80', 'service("nginx") == "active"', 'pipeline_valid == true']) {
      expect(check(compile(src, SCENARIO_FACTS).ast, SCENARIO_FACTS)).toBe('boolean');
    }
    expect(() => compile('quest("disk-full") == "done" && money >= 100', PROGRESS_FACTS)).not.toThrow();
  });
});

describe('evaluator', () => {
  it('compares numbers, strings and booleans', () => {
    expect(run('n == 5')).toBe(true);
    expect(run('n != 5')).toBe(false);
    expect(run('n < 6 && n <= 5 && n > 4 && n >= 5')).toBe(true);
    expect(run('s == "a"')).toBe(true);
    expect(run('ok == true')).toBe(true);
    expect(run('double(n) == 10')).toBe(true);
    expect(run('n < 1K')).toBe(true);
  });
  it('short-circuits', () => {
    const e = env({ ok: false });
    expect(run('ok && has("left")', e)).toBe(false);
    expect(run('!ok || has("right")', e)).toBe(true);
    expect(e.calls).toEqual([]);
  });
  it('treats a runtime error as false, never a crash', () => {
    const broken: Env = { vars: {}, funcs: {} };
    expect(test(compile('ok', REG), broken)).toBe(false);
    expect(() => evaluate(parse('ok'), broken)).toThrow(/no value/);
  });
});
