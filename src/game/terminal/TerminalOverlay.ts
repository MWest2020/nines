// The terminal overlay (ARCHITECTURE.md, The Phaser layer; DESIGN.md, Terminal overlay): DOM
// over the dimmed world. xterm.js only renders output; input is our own <input>, because
// xterm's hidden-textarea input is unreliable with Android keyboards. Beside the output: the
// objectives and the hints; below it: the quick-command strip. `edit` opens the built-in editor.
//
// Everything the player sees comes from the session (src/sim/session.ts) and the locale files.
// The overlay never touches the game state itself: it calls its TerminalHost, which the wiring
// (./wire.ts) maps onto the GameApi.

import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';
import { questKey, type QuestEntry } from '../../content/types';
import type { Translate } from '../../core/i18n';
import { createSession, type FiredEvent, prompt, run, type RunResult, saveFile, type Session, stripControl } from '../../sim/session';
import { complete } from '../../terminal/complete';
import { gutter, INDENT, insertIndent, isDirty, lineCol, lineCount, normalizeText, tabLines } from '../../terminal/editor';
import { down, type History, newHistory, record, up } from '../../terminal/history';
import { pushBack } from '../back';
import { type HintGate, hintCards } from '../ui/hintcard';
import { followVisualViewport } from '../touch/viewport';

export interface TerminalHost {
  t: Translate;
  /** the homelab's hint boost (the Raspberry Pi's "hints come one try sooner") */
  hintBoost: number;
  /** AI tokens: an unlocked hint shows its price and is revealed once paid (core/tokens.ts).
   *  Without a gate, hints show at once. */
  hints?: HintGate;
  /** locale key of the quest giver's name: they speak the consequences */
  speaker?: string;
  /** apply money and flags from fired events; returns the money actually gained or lost */
  applyEvents(events: readonly FiredEvent[]): number;
  /** the last objective was met: pay the reward. Null when it was paid before. `hints` AI hints
   *  brought it down to `percent` of the full reward. */
  complete(): { money: number; xp: number; percent: number; hints: number } | null;
  /** the overlay has closed and removed itself */
  closed(won: boolean): void;
}

/** SGR colours from DESIGN.md (Terminal): prompts in ice, errors in orange. */
const SGR = {
  prompt: '\x1b[38;2;136;184;232m',
  error: '\x1b[38;2;232;152;88m',
  dim: '\x1b[38;2;120;136;144m',
  reset: '\x1b[0m',
} as const;

const FONT = 'ui-monospace, monospace';

/** Keys for phones, which hide them (DESIGN.md, Terminal on a phone): they insert at the cursor. */
const INSERT_KEYS = ['|', '/', '-', '~', '*'];

interface Dialog {
  speaker?: string;
  text: string;
  extra?: string;
  button: string;
  then?: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class TerminalOverlay {
  private readonly session: Session;
  private readonly t: Translate;
  private readonly root: HTMLDivElement;
  private readonly term: Terminal;
  private readonly screen: HTMLDivElement;
  private readonly promptEl: HTMLSpanElement;
  private readonly input: HTMLInputElement;
  private readonly objList: HTMLUListElement;
  private readonly objCount: HTMLSpanElement;
  private readonly objToggle: HTMLButtonElement;
  private readonly hintList: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly editor: {
    box: HTMLDivElement;
    title: HTMLSpanElement;
    gutter: HTMLPreElement;
    area: HTMLTextAreaElement;
    status: HTMLDivElement;
    path: string;
  };
  private readonly resize: ResizeObserver | null;
  /** stops fitting the overlay to the visual viewport (the soft keyboard) */
  private readonly unfollow: () => void;
  private history: History = newHistory();
  private dialogs: Dialog[] = [];
  /** locale keys (in this quest's folder) of the hints unlocked so far, oldest first */
  private hints: string[] = [];
  private won = false;
  private closedAlready = false;
  /** False until the key that opened the terminal is released: its Enter must not run a line. */
  private ready = false;
  /** `exit` was typed while a dialogue was up: close once the dialogues are read */
  private closeAfterDialogs = false;
  /** Esc was pressed once on a changed buffer: a second Esc discards */
  private escArmed = false;
  private editorOriginal = '';
  /** unregisters the Android back button's handler (src/game/back.ts) */
  private readonly unback: () => void;
  private readonly quickBar: HTMLDivElement;

  constructor(
    private readonly quest: QuestEntry,
    private readonly host: TerminalHost,
    parent: HTMLElement = document.body,
  ) {
    const scenario = quest.scenario;
    if (!scenario) throw new Error(`quest ${quest.id} has no scenario`);
    this.t = host.t;
    const t = this.t;
    this.session = createSession(scenario, { t, hintBoost: host.hintBoost });

    // ---- the frame
    this.root = el('div', 'nt-overlay');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', t('ui.terminal.label', { host: scenario.host }));
    this.root.tabIndex = -1;
    // Keys typed here are the terminal's: never let them reach Phaser's window listener, which
    // would move the player or swallow WASD and Space. Key-ups do reach it, so a direction held
    // while the terminal opened is not stuck down when it closes.
    for (const type of ['keydown', 'keypress'] as const) this.root.addEventListener(type, (e) => e.stopPropagation());
    // The key that opened the terminal (Enter or Space, handled by Phaser during its keydown) is
    // still down: its keypress, repeats and input must not type or run anything. A release, a
    // fresh key or a tap arms the terminal.
    this.root.addEventListener('keyup', () => {
      this.ready = true;
    });
    this.root.addEventListener(
      'keydown',
      (e) => {
        if (!e.repeat) this.ready = true;
        else if (!this.ready) e.preventDefault();
      },
      true,
    );
    for (const type of ['keypress', 'beforeinput'] as const) {
      this.root.addEventListener(
        type,
        (e) => {
          if (!this.ready) e.preventDefault();
        },
        true,
      );
    }
    this.root.addEventListener('pointerdown', () => {
      this.ready = true;
    });
    // focus stays inside the overlay: a click on the backdrop gives it back to the input
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) {
        e.preventDefault();
        this.focus();
      }
    });

    const win = el('div', 'nt-window');
    const head = el('div', 'nt-head');
    head.append(el('span', 'nt-host', scenario.host));
    this.objToggle = el('button', 'nt-objtoggle');
    this.objToggle.type = 'button';
    this.objCount = el('span', 'nt-count');
    this.objToggle.append(el('span', 'nt-objlabel', t('ui.terminal.objectives')), this.objCount);
    this.objToggle.addEventListener('click', () => win.classList.toggle('nt-show-side'));
    const close = el('button', 'nt-close', '✕');
    close.type = 'button';
    close.title = t('ui.terminal.close');
    close.setAttribute('aria-label', t('ui.terminal.close'));
    close.addEventListener('click', () => this.close());
    head.append(this.objToggle, close);

    const body = el('div', 'nt-body');
    const main = el('div', 'nt-main');
    this.screen = el('div', 'nt-screen');
    const form = el('form', 'nt-inputline');
    this.promptEl = el('span', 'nt-prompt');
    this.input = el('input', 'nt-input');
    Object.assign(this.input, { type: 'text', autocomplete: 'off', spellcheck: false, enterKeyHint: 'send' });
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('autocorrect', 'off');
    this.input.setAttribute('aria-label', t('ui.terminal.input'));
    form.append(this.promptEl, this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.dialog = el('div', 'nt-dialog');
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-live', 'assertive');
    this.dialog.hidden = true;
    main.append(this.screen, this.dialog, form);

    const side = el('aside', 'nt-side');
    side.append(el('h2', 'nt-sidehead', t('ui.terminal.objectives')));
    this.objList = el('ul', 'nt-objectives');
    side.append(this.objList, el('h2', 'nt-sidehead', t('ui.terminal.hint')));
    this.hintList = el('div', 'nt-hints');
    this.hintList.setAttribute('aria-live', 'polite');
    side.append(this.hintList);
    body.append(main, side);

    const quick = el('div', 'nt-quick');
    this.quickBar = quick;
    quick.setAttribute('role', 'toolbar');
    quick.setAttribute('aria-label', t('ui.terminal.quick'));
    const key = (label: string, action: () => void, cls = 'nt-key') => {
      const b = el('button', cls, label);
      b.type = 'button';
      // keep the soft keyboard up: do not move focus away from the input
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        action();
        this.input.focus();
      });
      quick.append(b);
    };
    key('Tab', () => this.tab());
    key('↑', () => this.walk('up'));
    key('↓', () => this.walk('down'));
    for (const k of INSERT_KEYS) key(k, () => this.insert(k));
    for (const line of scenario.quick ?? []) key(line, () => this.fill(line), 'nt-cmd');
    key('exit', () => this.fill('exit'), 'nt-cmd');

    // ---- the editor, over the terminal
    const box = el('div', 'nt-editor');
    box.hidden = true;
    const ehead = el('div', 'nt-head');
    const title = el('span', 'nt-host');
    const cancel = el('button', 'nt-btn', t('ui.editor.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.closeEditor(false));
    const save = el('button', 'nt-btn nt-primary', t('ui.save'));
    save.type = 'button';
    save.addEventListener('click', () => this.closeEditor(true));
    ehead.append(title, cancel, save);
    const ebody = el('div', 'nt-editbody');
    const gut = el('pre', 'nt-gutter');
    gut.setAttribute('aria-hidden', 'true');
    const area = el('textarea', 'nt-area');
    Object.assign(area, { spellcheck: false, wrap: 'off' });
    area.setAttribute('autocapitalize', 'off');
    area.setAttribute('autocorrect', 'off');
    area.setAttribute('aria-label', t('ui.editor.label'));
    ebody.append(gut, area);
    const status = el('div', 'nt-status');
    box.append(ehead, ebody, status);
    this.editor = { box, title, gutter: gut, area, status, path: '' };
    area.addEventListener('keydown', (e) => this.onEditorKey(e));
    for (const ev of ['input', 'click', 'keyup', 'select'] as const) area.addEventListener(ev, () => this.renderEditor());
    area.addEventListener('scroll', () => {
      gut.scrollTop = area.scrollTop;
    });

    win.append(head, body, quick, box);
    this.root.append(win);
    parent.append(this.root);
    // the input line and quick strip stay above a soft keyboard
    this.unfollow = followVisualViewport(this.root);

    // ---- xterm, output only
    this.term = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      fontFamily: FONT,
      fontSize: 14,
      scrollback: 2000,
      // an accessibility tree of the output, for screen readers
      screenReaderMode: true,
      theme: { background: '#081008', foreground: '#88e090', cursor: '#081008', selectionBackground: '#306838' },
      // Output never carries OSC 8 links (content and player text have control characters
      // removed), and if one ever did, activating it does nothing: no window.open.
      linkHandler: { activate: () => undefined },
    });
    this.term.open(this.screen);
    // a click on the output gives the input back its focus, unless the player selected text
    this.screen.addEventListener('mouseup', () => {
      if (!this.term.hasSelection()) this.focus();
    });
    this.resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fit());
    this.resize?.observe(this.screen);
    this.fit();

    this.print([t(questKey(quest.id, scenario.motd)), ''], SGR.dim);
    this.handle(run(this.session, ''));
    // The Android back button: Esc in the editor (a changed buffer asks twice), else ✕.
    this.unback = pushBack(() => (this.editor.box.hidden ? this.close() : this.editorEscape()));
    this.focus();
  }

  // ---- output

  private print(lines: readonly string[], color?: string): void {
    for (const l of lines) {
      const text = stripControl(l);
      this.term.write(color ? `${color}${text}${SGR.reset}\n` : `${text}\n`);
    }
  }

  /** The line as the player typed it, after the prompt in its colour. */
  private echo(line: string, suffix = ''): void {
    this.term.write(`${SGR.prompt}${stripControl(prompt(this.session.state))}${SGR.reset}${stripControl(line)}${suffix}\n`);
  }

  /** Size xterm to its box without the fit addon: measure one cell in the same font. */
  private fit(): void {
    const box = this.screen.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const probe = el('span', 'nt-probe', 'W'.repeat(20));
    probe.style.font = `${this.term.options.fontSize}px ${FONT}`;
    this.screen.append(probe);
    const cell = probe.getBoundingClientRect();
    probe.remove();
    const cw = cell.width / 20;
    const ch = cell.height;
    if (cw <= 0 || ch <= 0) return;
    // 6 px left padding, and xterm 6 draws its 14 px scrollbar over the content
    const cols = Math.max(20, Math.floor((box.width - 6 - 14) / cw));
    const rows = Math.max(5, Math.floor((box.height - 8) / ch));
    if (cols !== this.term.cols || rows !== this.term.rows) this.term.resize(cols, rows);
  }

  // ---- the input line

  private focus(): void {
    if (!this.editor.box.hidden) this.editor.area.focus();
    else if (!this.dialog.hidden) this.dialog.querySelector('button')?.focus();
    else this.input.focus();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      this.tab();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.walk(e.key === 'ArrowUp' ? 'up' : 'down');
    } else if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
      // Ctrl-C: drop the line, like a shell. With text selected it copies, as usual.
      if (this.input.selectionStart !== this.input.selectionEnd) return;
      e.preventDefault();
      this.echo(this.input.value, '^C');
      this.input.value = '';
      this.history = record(this.history, '');
    } else if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      this.term.clear();
    }
  }

  private tab(): void {
    const at = this.input.selectionStart ?? this.input.value.length;
    const r = complete(this.session.state, this.input.value, at);
    if (r.options.length > 0) {
      this.echo(this.input.value);
      this.print([r.options.join('  ')]);
    }
    this.input.value = r.line;
    this.input.setSelectionRange(r.cursor, r.cursor);
  }

  private walk(dir: 'up' | 'down'): void {
    const r = (dir === 'up' ? up : down)(this.history, this.input.value);
    this.history = r.history;
    this.input.value = r.line;
    this.input.setSelectionRange(r.line.length, r.line.length);
  }

  private insert(text: string): void {
    const a = this.input.selectionStart ?? this.input.value.length;
    const b = this.input.selectionEnd ?? a;
    this.input.value = this.input.value.slice(0, a) + text + this.input.value.slice(b);
    this.input.setSelectionRange(a + text.length, a + text.length);
  }

  private fill(line: string): void {
    this.input.value = line;
    this.input.setSelectionRange(line.length, line.length);
  }

  private submit(): void {
    if (!this.ready || !this.dialog.hidden || !this.editor.box.hidden) return;
    const line = this.input.value;
    this.input.value = '';
    this.echo(line);
    this.history = record(this.history, line);
    const r = run(this.session, line);
    // a failed command in orange, except systemctl status of a failed unit (exit 3), which is
    // the block the player came to read
    if (r.out.length > 0) this.print(r.out, r.exit !== 0 && r.exit !== 3 ? SGR.error : undefined);
    if (r.ui?.clear) this.term.clear();
    this.handle(r);
    if (r.ui?.editor) this.openEditor(r.ui.editor.path, r.ui.editor.content);
    if (r.ui?.close) {
      if (this.dialog.hidden) this.close();
      else this.closeAfterDialogs = true;
    }
  }

  // ---- what a step did: consequences, hints, objectives, the win

  private handle(r: RunResult): void {
    if (r.events.length > 0) {
      const delta = this.host.applyEvents(r.events);
      r.events.forEach((ev, i) => {
        const params = { money: Math.abs(ev.money) };
        const text = ev.scope === 'quest' ? this.t(questKey(this.quest.id, ev.say), params) : this.t(ev.say, params);
        const last = i === r.events.length - 1;
        const extra = last && delta !== 0 ? this.t(delta < 0 ? 'ui.toast.money_lost' : 'ui.toast.money_gained', { amount: Math.abs(delta) }) : undefined;
        this.queue({ ...(this.host.speaker ? { speaker: this.t(this.host.speaker) } : {}), text, ...(extra ? { extra } : {}), button: this.t('ui.terminal.next') });
      });
    }
    this.hints.push(...r.hints);
    this.renderSide(r);
    this.promptEl.textContent = prompt(this.session.state);
    if (r.justWon) {
      this.won = true;
      const reward = this.host.complete();
      this.queue({
        text: this.t('ui.terminal.won'),
        extra: reward ? this.rewardText(reward) : this.t('ui.terminal.won_again'),
        button: this.t('ui.terminal.continue'),
        then: () => this.close(),
      });
    }
  }

  private renderSide(r: RunResult): void {
    this.objList.replaceChildren(
      ...r.objectives.map((o) => {
        const li = el('li', o.done ? 'nt-done' : 'nt-open');
        // shape as well as colour: a filled dot when done, a ring when open
        li.append(el('span', 'nt-mark', o.done ? '●' : '○'), el('span', '', this.t(questKey(this.quest.id, o.text))));
        return li;
      }),
    );
    const done = r.objectives.filter((o) => o.done).length;
    this.objCount.textContent = `${done}/${r.objectives.length}`;
    this.renderHints();
  }

  private renderHints(): void {
    if (this.hints.length === 0) {
      this.hintList.replaceChildren(el('p', 'nt-nohint', this.t('ui.terminal.no_hint')));
      return;
    }
    const last = this.hints.length - 1;
    this.hintList.replaceChildren(
      ...hintCards(this.hints, {
        t: this.t,
        ...(this.host.hints ? { gate: this.host.hints } : {}),
        text: (k) => this.t(questKey(this.quest.id, k)),
        changed: () => {
          this.renderHints();
          // back to the command line on a desktop; a phone keeps its keyboard down
          if (window.matchMedia?.('(pointer: fine)').matches) this.input.focus({ preventScroll: true });
        },
        cls: (_, i) => (i === last ? 'nt-hint nt-latest' : 'nt-hint'),
      }),
    );
  }

  private rewardText(r: { money: number; xp: number; percent: number; hints: number }): string {
    const base = this.t('ui.quest.reward', { money: r.money, xp: r.xp });
    if (r.hints === 0) return base;
    return `${base} ${this.t(r.hints === 1 ? 'ui.reward.hints_one' : 'ui.reward.hints_many', { hints: r.hints, percent: r.percent })}`;
  }

  // ---- dialogue inside the overlay: consequences and the win

  private queue(d: Dialog): void {
    this.dialogs.push(d);
    if (this.dialog.hidden) this.nextDialog();
  }

  private nextDialog(): void {
    const d = this.dialogs.shift();
    if (!d) {
      this.dialog.hidden = true;
      this.input.disabled = false;
      this.setQuickEnabled(true);
      if (this.closeAfterDialogs) {
        this.close();
        return;
      }
      this.focus();
      return;
    }
    this.input.disabled = true;
    this.setQuickEnabled(false);
    const parts: HTMLElement[] = [];
    if (d.speaker) parts.push(el('div', 'nt-speaker', d.speaker));
    parts.push(el('p', 'nt-say', d.text));
    if (d.extra) parts.push(el('p', 'nt-extra', d.extra));
    const b = el('button', 'nt-btn nt-primary', d.button);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (d.then) {
        this.dialogs = [];
        d.then();
        return;
      }
      this.nextDialog();
    });
    parts.push(b);
    this.dialog.replaceChildren(...parts);
    this.dialog.hidden = false;
    b.focus();
  }

  private setQuickEnabled(on: boolean): void {
    for (const b of this.quickBar.querySelectorAll('button')) b.disabled = !on;
  }

  // ---- the editor

  private openEditor(path: string, content: string): void {
    const e = this.editor;
    e.path = path;
    e.title.textContent = this.t('ui.editor.title', { path });
    e.area.value = normalizeText(content);
    this.editorOriginal = e.area.value;
    this.escArmed = false;
    e.box.hidden = false;
    e.area.setSelectionRange(0, 0);
    e.area.scrollTop = 0;
    this.renderEditor();
    if (this.dialog.hidden) e.area.focus();
  }

  private onEditorKey(e: KeyboardEvent): void {
    const a = this.editor.area;
    if (e.key !== 'Escape') this.escArmed = false;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      // insertText keeps the textarea's undo history; assigning value would clear it
      if (!document.execCommand?.('insertText', false, INDENT)) {
        const r = insertIndent(a.value, a.selectionStart, a.selectionEnd);
        a.value = r.text;
        a.setSelectionRange(r.cursor, r.cursor);
      }
      this.renderEditor();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this.closeEditor(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.editorEscape();
    }
  }

  private editorEscape(): void {
    // a changed buffer needs a second Esc, so one stray key does not throw the work away
    if (isDirty(this.editorOriginal, this.editor.area.value) && !this.escArmed) {
      this.escArmed = true;
      this.renderEditor();
      return;
    }
    this.closeEditor(false);
  }

  private renderEditor(): void {
    const e = this.editor;
    const text = e.area.value;
    e.gutter.textContent = gutter(text).join('\n');
    e.gutter.scrollTop = e.area.scrollTop;
    const { line, col } = lineCol(text, e.area.selectionStart);
    const tabs = tabLines(text);
    const parts = [
      this.t('ui.editor.position', { line, col }),
      tabs.length === 0 ? this.t('ui.editor.no_tabs') : this.t(tabs.length === 1 ? 'ui.editor.tab_one' : 'ui.editor.tab_many', { lines: tabs.join(', ') }),
      this.t('ui.editor.tab_key'),
      this.escArmed ? this.t('ui.editor.esc_again') : this.t('ui.editor.keys'),
    ];
    e.status.textContent = parts.join(' · ');
    e.status.classList.toggle('nt-warn', tabs.length > 0 || this.escArmed);
  }

  private closeEditor(save: boolean): void {
    const e = this.editor;
    if (e.box.hidden) return;
    e.box.hidden = true;
    if (save) {
      const text = normalizeText(e.area.value);
      const lines = lineCount(text.replace(/\n$/, ''));
      this.print([this.t(lines === 1 ? 'ui.terminal.written_one' : 'ui.terminal.written', { path: e.path, lines })], SGR.dim);
      this.handle(saveFile(this.session, e.path, text));
    } else {
      this.print([this.t('ui.terminal.discarded', { path: e.path })], SGR.dim);
    }
    this.focus();
  }

  // ---- closing

  close(): void {
    if (this.closedAlready) return;
    this.closedAlready = true;
    this.unback();
    this.resize?.disconnect();
    this.unfollow();
    this.term.dispose();
    this.root.remove();
    this.host.closed(this.won);
  }
}

export function openTerminal(quest: QuestEntry, host: TerminalHost, parent?: HTMLElement): TerminalOverlay {
  return new TerminalOverlay(quest, host, parent);
}
