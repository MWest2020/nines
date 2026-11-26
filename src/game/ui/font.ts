// Our own pixel font for canvas text (DESIGN.md, Sizes: an 8 px font, 10 px line height).
// Drawn for Nines and released with it; no font file is downloaded or shipped. Capitals and
// digits are 7 px tall, lower case has a 5 px x-height with 2 px descenders. Proportional:
// each glyph is as wide as its widest row, plus 1 px spacing.
//
// Pure data and measuring, no Phaser: pixelfont.ts turns this into a texture, and the
// wrapping is tested in Node.

/** Rows from the top of a capital (row 0) down to the bottom of a descender (row 8). */
const G: Record<string, string> = {
  ' ': '... ... ... ... ... ... ...',
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  a: '.... .... .##. ...# .### #..# .###',
  b: '#... #... ###. #..# #..# #..# ###.',
  c: '.... .... .### #... #... #... .###',
  d: '...# ...# .### #..# #..# #..# .###',
  e: '.... .... .##. #..# #### #... .###',
  f: '.## #.. ### #.. #.. #.. #..',
  g: '.... .... .### #..# #..# #..# .### ...# .##.',
  h: '#... #... ###. #..# #..# #..# #..#',
  i: '# . # # # # #',
  j: '..# ... ..# ..# ..# ..# ..# ..# ##.',
  k: '#... #... #..# #.#. ##.. #.#. #..#',
  l: '#. #. #. #. #. #. .#',
  m: '..... ..... ####. #.#.# #.#.# #.#.# #.#.#',
  n: '.... .... ###. #..# #..# #..# #..#',
  o: '.... .... .##. #..# #..# #..# .##.',
  p: '.... .... ###. #..# #..# #..# ###. #... #...',
  q: '.... .... .### #..# #..# #..# .### ...# ...#',
  r: '.... .... #.## ##.. #... #... #...',
  s: '.... .... .### #... .##. ...# ###.',
  t: '.#. .#. ### .#. .#. .#. ..#',
  u: '.... .... #..# #..# #..# #..# .###',
  v: '..... ..... #...# #...# .#.#. .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '.... .... #..# #..# .##. #..# #..#',
  y: '.... .... #..# #..# #..# #..# .### ...# .##.',
  z: '.... .... #### ..#. .#.. #... ####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  '!': '# # # # # . #',
  '"': '#.# #.#',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  "'": '# #',
  '(': '.# #. #. #. #. #. .#',
  ')': '#. .# .# .# .# .# #.',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#.. .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  ',': '.. .. .. .. .. .# .# #.',
  '-': '.... .... .... ####',
  '.': '. . . . . . #',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  ':': '. . # . . . #',
  ';': '.. .. .# .. .. .. .# #.',
  '<': '...# ..#. .#.. #... .#.. ..#. ...#',
  '=': '.... .... #### .... ####',
  '>': '#... .#.. ..#. ...# ..#. .#.. #...',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  '[': '## #. #. #. #. #. ##',
  '\\': '#.... #.... .#... ..#.. ...#. ....# ....#',
  ']': '## .# .# .# .# .# ##',
  '^': '..#.. .#.#. #...#',
  _: '.... .... .... .... .... .... .... ####',
  '`': '#. .#',
  '{': '..# .#. .#. #.. .#. .#. ..#',
  '|': '# # # # # # #',
  '}': '#.. .#. .#. ..# .#. .#. #..',
  '~': '..... ..... .#... #.#.# ...#.',
  '€': '..### .#... ####. .#... ####. .#... ..###',
  '·': '. . . #',
  '×': '..... #...# .#.#. ..#.. .#.#. #...#',
  '≈': '..... .#... #.#.# ...#. .#... #.#.# ...#.',
  '…': '..... ..... ..... ..... ..... ..... #.#.#',
  '–': '.... .... .... ####',
  '—': '..... ..... ..... #####',
  '’': '# #',
  '‘': '# #',
  '“': '#.# #.#',
  '”': '#.# #.#',
  'é': '..#. .#.. .##. #..# #### #... .###',
  'è': '.#.. ..#. .##. #..# #### #... .###',
  'ë': '#..# .... .##. #..# #### #... .###',
  'ê': '.##. #..# .##. #..# #### #... .###',
  'á': '..#. .#.. .##. ...# .### #..# .###',
  'à': '.#.. ..#. .##. ...# .### #..# .###',
  'ä': '#..# .... .##. ...# .### #..# .###',
  'í': '.# .. #. #. #. #. #.',
  'ï': '#.# ... .#. .#. .#. .#. .#.',
  'ó': '..#. .#.. .##. #..# #..# #..# .##.',
  'ö': '#..# .... .##. #..# #..# #..# .##.',
  'ú': '..#. .#.. #..# #..# #..# #..# .###',
  'ü': '#..# .... #..# #..# #..# #..# .###',
  'ç': '.... .... .### #... #... #... .### ..#. .#..',
  'ñ': '.#.# #.#. ###. #..# #..# #..# #..#',
};

export const FONT = {
  /** pixels from the top of the line to the top of a capital */
  top: 1,
  lineHeight: 10,
  /** rows a glyph may use: 7 for capitals, 2 more for descenders */
  rows: 9,
  spacing: 1,
} as const;

export interface Glyph {
  ch: string;
  width: number;
  /** rows of booleans, top to bottom, `width` wide */
  pixels: boolean[][];
}

export const GLYPHS: ReadonlyMap<string, Glyph> = new Map(
  Object.entries(G).map(([ch, src]) => {
    const rows = src.split(' ');
    const width = Math.max(...rows.map((r) => r.length));
    return [ch, { ch, width, pixels: rows.map((r) => [...r.padEnd(width, '.')].map((c) => c === '#')) }];
  }),
);

/** Characters the font lacks become "?", so nothing silently disappears. */
export function sanitize(text: string): string {
  return [...text.normalize('NFC')].map((c) => (c === '\n' || GLYPHS.has(c) ? c : '?')).join('');
}

export const advance = (ch: string): number => (GLYPHS.get(ch)?.width ?? GLYPHS.get('?')!.width) + FONT.spacing;

/** Width in pixels of one line (the spacing after the last glyph not counted). */
export function measure(line: string): number {
  let w = 0;
  for (const c of line) w += advance(c);
  return Math.max(0, w - FONT.spacing);
}

/**
 * Break text into lines no wider than maxWidth, at spaces; a word wider than a whole line is
 * cut. Existing newlines are kept.
 */
export function wrap(text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of sanitize(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') out.push(line);
      line = word;
      while (measure(line) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

/** Split text into pages of at most `lines` lines each (the dialogue box shows three). */
export function paginate(text: string, maxWidth: number, lines: number): string[] {
  const all = wrap(text, maxWidth);
  const pages: string[] = [];
  for (let i = 0; i < all.length; i += lines) pages.push(all.slice(i, i + lines).join('\n'));
  return pages.length > 0 ? pages : [''];
}

/** Cut a line to fit, ending in an ellipsis. */
export function ellipsize(line: string, maxWidth: number): string {
  const s = sanitize(line);
  if (measure(s) <= maxWidth) return s;
  let cut = s.length;
  while (cut > 0 && measure(`${s.slice(0, cut)}…`) > maxWidth) cut--;
  return `${s.slice(0, cut).trimEnd()}…`;
}
