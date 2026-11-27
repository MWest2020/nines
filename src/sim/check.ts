// Fair grading of free text the player writes: a pentest finding, a change ticket, a logbook, a
// drop file. Mark's playtest (27 Nov 2026): a finding rated "critical and high" sat there without
// a word, because the old check wanted one exact spelling of "Severity: high". Now a `check`
// parses the file the way a person reads it and, when something is still wrong, says exactly
// what (a note under the objective) instead of staying silent.
//
// - `fields`: `Name: value` lines must be filled in (not empty, not "?", "TODO", "tbd", "..."),
//   case-insensitive, with markdown decoration (`- **What**:`) allowed; a value may also continue
//   on the next lines. With `number`, the value must be that number: 1.25, 1,25, €1.25, € 1,25.
// - `choice`: exactly one value from a scale on the `Field:` line(s), e.g. Severity from low,
//   medium, high, critical (Dutch words count too). Two values is an answer the player has to
//   settle ("Severity has two values: critical, high. Pick one."), none is a missing rating.
// - `mentions`: any word of each group must appear somewhere, case-insensitive.
//
// Pure: it reads the file's text and returns whether it passes and the first problem as a locale
// key with parameters.

import type { CheckSpec } from '../content/types';

export interface CheckNote {
  /** a global locale key (ui.check.*) or, when `scope` is quest, a key in the quest's folder */
  key: string;
  scope: 'global' | 'quest';
  params: Record<string, string | number>;
}

export interface CheckResult {
  ok: boolean;
  note?: CheckNote;
}

/** What still means "not filled in". */
const PLACEHOLDER = /^(\?+|\.{2,}|…|todo|tbd|tbc|xxx|<[^>]*>|_+)$/i;

/** Words on a severity-like scale, Dutch and short forms included. */
const SYNONYMS: Record<string, string> = {
  laag: 'low',
  gering: 'low',
  info: 'low',
  informational: 'low',
  med: 'medium',
  moderate: 'medium',
  middel: 'medium',
  gemiddeld: 'medium',
  matig: 'medium',
  hoog: 'high',
  crit: 'critical',
  kritiek: 'critical',
  kritisch: 'critical',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text after `Field:` (or `Field -`, `Field =`) on each line that starts with the field. */
export function fieldValues(text: string, field: string): { line: number; value: string; next: string[] }[] {
  // "choco_bar", "choco bar" and "Choco-Bar" are the same field; a label before it ("Today: what
  // I did: ...") is allowed
  const name = escape(field).replace(/[_ -]/g, '[_ -]?');
  const re = new RegExp(`^[\\s>*_#\`-]*(?:[A-Za-z]+:[ \\t]*)?${name}[\\s*_\`]*(?:[:=]|\\s-\\s|\\s–\\s)(.*)$`, 'i');
  const lines = text.split('\n');
  const found: { line: number; value: string; next: string[] }[] = [];
  lines.forEach((l, i) => {
    const m = re.exec(l);
    if (!m) return;
    // a value that continues on the next lines, until a blank line or the next `Something:` line
    const next: string[] = [];
    for (const n of lines.slice(i + 1)) {
      if (n.trim() === '' || /^[\s>*_#`-]*[A-Za-z][\w ()/'-]{0,40}[\s*_`]*:/.test(n)) break;
      next.push(n.trim());
    }
    found.push({ line: i + 1, value: m[1]!.replace(/[*_`]+/g, ' ').trim(), next });
  });
  return found;
}

const filled = (v: string): boolean => v !== '' && !PLACEHOLDER.test(v.trim());

/** A price or amount as the player may write it: 1.25, 1,25, €1.25, € 1,25, 1.25 EUR. */
export function readNumber(v: string): number | null {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(v.replace(/\s+/g, ''));
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** The scale words a value names, in scale order, each once. */
export function scaleWords(value: string, scale: readonly string[]): string[] {
  const words = value.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  const named = new Set<string>();
  for (const w of words) {
    const s = scale.find((x) => x.toLowerCase() === w) ?? (Object.hasOwn(SYNONYMS, w) ? scale.find((x) => x.toLowerCase() === SYNONYMS[w]) : undefined);
    if (s) named.add(s);
  }
  return scale.filter((s) => named.has(s));
}

const note = (key: string, params: CheckNote['params'], scope: CheckNote['scope'] = 'global'): CheckResult => ({ ok: false, note: { key, scope, params } });

/** Grade one file against a check. A missing file is a note too. */
export function grade(spec: CheckSpec, text: string | undefined): CheckResult {
  const file = spec.file.slice(spec.file.lastIndexOf('/') + 1);
  if (text === undefined) return note('ui.check.no_file', { file });
  for (const raw of spec.fields ?? []) {
    const f = typeof raw === 'string' ? { name: raw } : raw;
    const hits = fieldValues(text, f.name);
    if (hits.length === 0) return note('ui.check.no_field', { file, field: f.name });
    const value = hits.map((h) => (filled(h.value) ? h.value : h.next.find(filled) ?? '')).find(filled);
    if (value === undefined) return note('ui.check.empty_field', { file, field: f.name });
    if (f.number !== undefined) {
      const n = readNumber(value);
      if (n === null) return note('ui.check.not_number', { file, field: f.name, value });
      if (Math.abs(n - f.number) > 1e-9) return note('ui.check.wrong_number', { file, field: f.name, value });
    }
  }
  if (spec.choice) {
    const c = spec.choice;
    const hits = fieldValues(text, c.field);
    const scale = c.scale.join(', ');
    if (hits.length === 0) return note('ui.check.no_field', { file, field: c.field });
    const named = scaleWords(hits.map((h) => h.value).join(' '), c.scale);
    if (named.length === 0) {
      const value = hits.map((h) => h.value).find(filled);
      if (value === undefined) return note('ui.check.choice_empty', { file, field: c.field, scale });
      return note('ui.check.choice_unknown', { file, field: c.field, value, scale });
    }
    if (named.length > 1) return note(named.length === 2 ? 'ui.check.choice_two' : 'ui.check.choice_many', { file, field: c.field, values: named.join(', '), n: named.length });
    const value = named[0]!;
    if (!c.accept.includes(value)) return c.wrong ? note(c.wrong, { file, field: c.field, value }, 'quest') : note('ui.check.choice_wrong', { file, field: c.field, value });
  }
  for (const m of spec.mentions ?? []) {
    const low = text.toLowerCase();
    if (!m.any.some((w) => low.includes(w.toLowerCase()))) return note(m.missing, { file }, 'quest');
  }
  return { ok: true };
}
