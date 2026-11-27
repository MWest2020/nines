// Fair grading of free text (src/sim/check.ts). Mark's playtest, 27 Nov 2026: "I wrote it up and
// rated it (has the words critical and high in them). seems stuck." The old check wanted one of
// five exact spellings of "Severity: high|critical" and said nothing when it failed. These are
// realistic, sloppy write-ups: the fair ones pass, and the rest get a note that says what is wrong.

import { describe, expect, it } from 'vitest';
import type { CheckSpec } from '../../src/content/types';
import { fieldValues, grade, readNumber, scaleWords } from '../../src/sim/check';
import { createSession, run, saveFile } from '../../src/sim/session';
import { content, t } from '../helpers';

const SEVERITY: CheckSpec = { file: '/f.txt', choice: { field: 'Severity', scale: ['low', 'medium', 'high', 'critical'], accept: ['high', 'critical'] } };
const note = (spec: CheckSpec, text: string) => {
  const r = grade(spec, text);
  return r.ok ? 'ok' : t(r.note!.key, r.note!.params);
};

describe('a Severity line', () => {
  it('passes one allowed value however it is written', () => {
    for (const text of [
      'Severity: high',
      'Severity: HIGH',
      'severity:high',
      'Severity : Critical',
      '**Severity:** High',
      '- Severity: high (CVSS 7.5)',
      'Severity - critical',
      'Severity = high',
      'SEVERITY: Critical, because anyone can download it',
      'Severity: hoog',
      'Severity: Kritiek',
      'FINDING 01\nSeverity: ?\nSeverity: high', // the template's line kept, a real one added
    ]) expect(note(SEVERITY, text), text).toBe('ok');
  });
  it('says exactly what is wrong otherwise: two values, none, off the scale, too mild, no line', () => {
    expect(note(SEVERITY, 'Severity: Critical / High')).toBe('Severity line has two values: high, critical. Pick one.');
    expect(note(SEVERITY, 'Severity: high, maybe critical')).toBe('Severity line has two values: high, critical. Pick one.');
    expect(note(SEVERITY, 'Severity: low to high, critical if real')).toBe('Severity line has 3 values: low, high, critical. Pick one.');
    expect(note(SEVERITY, 'Severity: ?')).toBe('Severity is still empty: rate it low, medium, high, critical.');
    expect(note(SEVERITY, 'Severity:')).toBe('Severity is still empty: rate it low, medium, high, critical.');
    expect(note(SEVERITY, 'Severity: severe')).toBe('Severity: "severe" is not on the scale. Pick one of: low, medium, high, critical.');
    expect(note(SEVERITY, 'Severity: medium')).toMatch(/^Severity is medium\. Is that really how bad it is\?/);
    expect(note(SEVERITY, 'Rating: high')).toBe('f.txt has no "Severity:" line yet.');
    // "high" elsewhere in the text is not a rating
    expect(note(SEVERITY, 'Severity: ?\nImpact: high')).toBe('Severity is still empty: rate it low, medium, high, critical.');
  });
  it('helpers: the words on a scale, in scale order, Dutch and short forms included', () => {
    expect(scaleWords('CRIT / hoog / med', ['low', 'medium', 'high', 'critical'])).toEqual(['medium', 'high', 'critical']);
    expect(scaleWords('highly unlikely', ['low', 'high'])).toEqual([]);
    expect(fieldValues('a\n> **Severity**: High\n', 'Severity')).toEqual([{ line: 2, value: 'High', next: [] }]);
  });
});

describe('fields that must be filled in', () => {
  const TICKET: CheckSpec = { file: '/home/dev/changes/CHG-1042.txt', fields: ['What', 'Why', 'Rollback'] };
  it('pass when filled, on the line or on the next one, in any case', () => {
    expect(note(TICKET, 'What: comma to dot in prices.yaml\nWhy: shop down\nRollback: git revert')).toBe('ok');
    expect(note(TICKET, 'what - fixed croissant price\nWHY: the shop would not start\nRollback:\n  revert the commit')).toBe('ok');
    expect(note(TICKET, '- **What**: price fix\n- **Why**: outage\n- **Rollback**: none needed, n/a')).toBe('ok');
  });
  it('name the first one still empty or missing', () => {
    expect(note(TICKET, 'What: price fix\nWhy: ?\nRollback: ?')).toBe('Why is still empty in CHG-1042.txt.');
    expect(note(TICKET, 'What: price fix\nWhy: shop down\nRollback: TODO')).toBe('Rollback is still empty in CHG-1042.txt.');
    expect(note(TICKET, 'What: price fix\nWhy: shop down')).toBe('CHG-1042.txt has no "Rollback:" line yet.');
    expect(note(TICKET, 'What: ...\nWhy: x\nRollback: y')).toBe('What is still empty in CHG-1042.txt.');
  });
  it('numbers: a dot or a comma, a euro sign and spaces all count; the wrong number is named', () => {
    const DROP: CheckSpec = { file: '/home/guest/drop/for-vince.txt', fields: [{ name: 'choco_bar', number: 1.25 }, { name: 'cola', number: 1.45 }] };
    for (const text of ['choco_bar: 1.25\ncola: 1.45', 'choco_bar: €1,25\ncola: € 1,45', 'Choco Bar: 1.25 EUR\nCola: 1.45', 'choco-bar = 1.25\ncola = 1.45']) expect(note(DROP, text), text).toBe('ok');
    expect(note(DROP, 'choco_bar: 1.10\ncola: 1.45')).toBe('choco_bar in for-vince.txt says 1.10: check it against what you found.');
    expect(note(DROP, 'choco_bar: cheap\ncola: 1.45')).toBe('choco_bar in for-vince.txt should be a number, not "cheap".');
    expect(readNumber('€ 1,25')).toBe(1.25);
  });
  it('a missing file is a note too', () => {
    expect(note(TICKET, undefined as unknown as string)).toBe('CHG-1042.txt is gone: write it again.');
  });
});

describe('in the quests', () => {
  const scenario = (id: string) => content().quests.find((q) => q.id === id)!.scenario!;
  const FINDING = '/home/pentest/engagement/finding-01.txt';

  it("the Polderbank finding: Mark's write-up gets a note instead of silence, and passes once settled", () => {
    const s = createSession(scenario('bank-pentest'), { t });
    // before the player writes anything, no notes nag
    expect(run(s, 'cat ~/engagement/scope.txt').objectives.every((o) => o.note === undefined)).toBe(true);
    const sloppy = [
      'FINDING 01',
      'Title: open directory listing with a DB backup',
      'Severity: Critical / High',
      'Where: staging.polderbank, the exports folder (directory listing on)',
      'What anyone on the internet could do: download the whole database backup',
      'Recommendation: switch the listing off, move the backup out of the web root',
    ].join('\n');
    const r = saveFile(s, FINDING, sloppy);
    const by = (id: string) => r.objectives.find((o) => o.id === id)!;
    expect(by('where').done).toBe(true); // "directory listing" and "exports" count, not only "autoindex" and "/exports"
    expect(by('severity').done).toBe(false);
    expect(t(by('severity').note!.key, by('severity').note!.params)).toBe('Severity line has two values: high, critical. Pick one.');
    const fixed = saveFile(s, FINDING, sloppy.replace('Critical / High', 'critical'));
    expect(fixed.objectives.every((o) => o.done)).toBe(true);
    expect(fixed.justWon).toBe(true);
  });
  it('the Polderbank finding: a missing place and a mild rating get their own notes', () => {
    const s = createSession(scenario('bank-pentest'), { t });
    run(s, 'cat ~/engagement/scope.txt');
    const r = saveFile(s, FINDING, 'Title: autoindex is on\nSeverity: low\n');
    const by = (id: string) => r.objectives.find((o) => o.id === id)!;
    expect(by('where').note).toEqual({ key: 'check.where_path', scope: 'quest', params: { file: 'finding-01.txt' } });
    expect(by('severity').note).toEqual({ key: 'check.severity_low', scope: 'quest', params: { file: 'finding-01.txt', field: 'Severity', value: 'low' } });
  });
  it('the webshop finding (Medior City) is graded the same way', () => {
    const s = createSession(scenario('webshop-scope'), { t });
    run(s, 'cat ~/engagement/scope.txt');
    const r = saveFile(s, FINDING, [
      'Title: Debug page open on staging',
      'Where: /_DEBUG route, debug mode on in settings.ini',
      'What: it shows the STRIPE_KEY and the DB PASSWORD (names only)',
      'Severity: HIGH',
      'Recommendation: Debug off and the route denied; Rotate every key it showed.',
    ].join('\n'));
    expect(r.objectives.filter((o) => !o.done).map((o) => o.id)).toEqual([]);
  });
  it('the change tickets and the logbook are filled-in checks', () => {
    const bakery = createSession(scenario('bakery-hotfix'), { t });
    const r = saveFile(bakery, '/home/dev/changes/CHG-1042.txt', 'CHANGE CHG-1042\nWhat: croissant price 1,80 -> 1.80\nWhy: the shop would not start\nRollback: ?\n');
    const ticket = r.objectives.find((o) => o.id === 'ticket')!;
    expect(ticket.done).toBe(false);
    expect(t(ticket.note!.key, ticket.note!.params)).toBe('Rollback is still empty in CHG-1042.txt.');
    const cafe = createSession(scenario('repair-cafe'), { t });
    const text = run(cafe, 'cat ~/logbook.txt').out.join('\n').replace('what I did: ?', 'what I did: restarted booking-web after the power cut');
    expect(saveFile(cafe, '/home/volunteer/logbook.txt', text).objectives.find((o) => o.id === 'logbook')!.done).toBe(true);
  });
});
