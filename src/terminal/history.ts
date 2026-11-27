// The input line's command history, walked with the up and down keys like a shell's. Pure:
// every function returns a new History. The line being typed when the player first presses up
// is kept as the draft and comes back after the newest entry.

export interface History {
  entries: string[];
  /** entries.length while the player is on the draft (the line being typed) */
  pos: number;
  draft: string;
}

export const HISTORY_LIMIT = 100;

export const newHistory = (): History => ({ entries: [], pos: 0, draft: '' });

/** A line was run: remember it (not blank lines, not the same line twice in a row) and go back to an empty draft. */
export function record(h: History, line: string): History {
  const keep = line.trim() !== '' && h.entries[h.entries.length - 1] !== line;
  const entries = keep ? [...h.entries, line].slice(-HISTORY_LIMIT) : h.entries;
  return { entries, pos: entries.length, draft: '' };
}

/** Up: the previous entry. `current` is what the input shows now; on the draft it is saved. */
export function up(h: History, current: string): { history: History; line: string } {
  if (h.entries.length === 0) return { history: h, line: current };
  const draft = h.pos === h.entries.length ? current : h.draft;
  const pos = Math.max(0, h.pos - 1);
  return { history: { ...h, pos, draft }, line: h.entries[pos]! };
}

/** Down: the next entry, and after the newest one the draft again. */
export function down(h: History, current: string): { history: History; line: string } {
  if (h.pos >= h.entries.length) return { history: h, line: current };
  const pos = h.pos + 1;
  return { history: { ...h, pos }, line: pos === h.entries.length ? h.draft : h.entries[pos]! };
}
