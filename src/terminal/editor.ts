// The built-in editor's buffer logic: where the cursor is, which lines hold a tab (tabs are
// what break YAML, so the gutter marks them), and what the Tab key does (two spaces). Pure; the
// overlay keeps the text in a <textarea> and asks these functions.

export const TAB_MARK = '⇥';
export const INDENT = '  ';

export interface Edit {
  text: string;
  /** the cursor after the edit (start = end) */
  cursor: number;
}

/** Text as the editor holds it: newlines normalised to \n. */
export const normalizeText = (text: string): string => text.replace(/\r\n?/g, '\n');

export const lineCount = (text: string): number => text.split('\n').length;

/** 1-based numbers of the lines that contain a tab character. */
export function tabLines(text: string): number[] {
  const out: number[] = [];
  text.split('\n').forEach((l, i) => {
    if (l.includes('\t')) out.push(i + 1);
  });
  return out;
}

/** The gutter: a right-aligned line number per line, followed by the tab mark or a space. */
export function gutter(text: string): string[] {
  const lines = text.split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)}${l.includes('\t') ? TAB_MARK : ' '}`);
}

/** 1-based line and column of an offset in the text. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const nl = before.lastIndexOf('\n');
  return { line: (before.match(/\n/g) ?? []).length + 1, col: before.length - nl };
}

/** The Tab key: replace the selection (or insert at the cursor) with two spaces. */
export function insertIndent(text: string, start: number, end: number): Edit {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  return { text: text.slice(0, a) + INDENT + text.slice(b), cursor: a + INDENT.length };
}

/** True when the buffer differs from what was opened. */
export const isDirty = (original: string, current: string): boolean => normalizeText(original) !== normalizeText(current);
