// The battle overlay (DESIGN.md, Battles: the war room; ARCHITECTURE.md, The Phaser layer). DOM
// over the dimmed world, like the terminal: crisp text, the device's own fonts, and native
// buttons for keyboard, mouse and touch. It renders a Screen (src/battle/screen.ts, pure and
// tested) and turns input into the calls there; it holds no rules of its own.
//
// What it is not, on purpose (AGENTS.md, rule 1): no announcement catchphrase, no two figures
// facing each other, no bars over sprites, no four-item command menu, no cursor triangle, no
// letters on buttons. A chat transcript with a head-only portrait, a whiteboard, two labelled
// gauges in a side panel and answer cards that span the width.
//
// Keys. Tab and Shift+Tab move through the controls (they stay inside the overlay); arrows move
// between cards; Enter or Space picks a card or presses a button; in an order round Space picks
// a step up, the arrows move it and Space puts it down (each step also has ↑/↓ buttons, and
// dragging works with a mouse or a finger). Escape leaves the conversation; nothing is
// recorded for a battle left half-way. Key presses inside the overlay never reach Phaser.

import './battle.css';
import { type BattleRound, type Grade, questKey } from '../../content/types';
import type { Translate } from '../../core/i18n';
import * as S from '../../battle/screen';

export interface OverlayOptions {
  t: Translate;
  screen: S.Screen;
  /** the attacker's name for the header (translated), e.g. "Ingrid · staff engineer" */
  attacker: string;
  /** who speaks in the transcript (translated), e.g. "Ingrid" */
  speaker: string;
  /** a fresh head-only portrait for each message group, or null for none */
  portrait: () => HTMLCanvasElement | null;
  /** A try ended: record it. Returns lines (translated) to show under the verdict. */
  record: (outcome: 'won' | 'lost') => string[];
  parent?: HTMLElement;
}

type El = HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The overlay's tab stops: buttons and the one card or step per list that holds the tab stop. */
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';

/** Open the overlay on a screen; resolves with the last screen when the player closes it. */
export function runBattle(opts: OverlayOptions): Promise<S.Screen> {
  return new Promise((resolve, reject) => {
    try {
      new BattleOverlay(opts, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

class BattleOverlay {
  private s: S.Screen;
  private readonly t: Translate;
  private readonly root: El;
  private readonly title: El;
  private readonly round: El;
  private readonly board: El;
  private readonly log: El;
  private readonly answer: El;
  private readonly end: El;
  private readonly side: El;
  private readonly sr: El;
  private shown = 0;
  private grabbed: string | null = null;
  private readonly lines: string[] = [];
  private readonly before: Element | null;

  constructor(
    private readonly opts: OverlayOptions,
    private readonly resolve: (last: S.Screen) => void,
  ) {
    this.s = opts.screen;
    this.t = opts.t;
    this.before = document.activeElement;

    this.root = el('div', 'nb-battle');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'nb-title');
    this.root.dataset.battle = this.s.battle.id;
    const win = el('div', 'nb-window');
    const head = el('header', 'nb-head');
    this.title = el('h2', 'nb-title');
    this.title.id = 'nb-title';
    this.round = el('span', 'nb-round');
    const leave = el('button', 'nb-leave', '✕');
    leave.type = 'button';
    leave.setAttribute('aria-label', this.t('ui.battle.leave'));
    leave.title = this.t('ui.battle.leave');
    leave.addEventListener('click', () => this.close());
    head.append(this.title, this.round, leave);

    const body = el('div', 'nb-body');
    const main = el('div', 'nb-main');
    this.board = el('section', 'nb-board');
    this.board.setAttribute('aria-label', this.t('ui.battle.whiteboard'));
    this.log = el('div', 'nb-log');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    // a tab stop, so the keyboard can scroll back through the conversation
    this.log.tabIndex = 0;
    this.log.setAttribute('aria-label', this.t('ui.battle.transcript'));
    this.answer = el('section', 'nb-answer');
    this.end = el('section', 'nb-end');
    main.append(this.board, this.log, this.answer, this.end);
    this.side = el('aside', 'nb-side');
    this.side.setAttribute('aria-label', this.t('ui.battle.meters'));
    body.append(main, this.side);
    this.sr = el('div', 'nb-sr');
    this.sr.setAttribute('aria-live', 'assertive');
    win.append(head, body);
    this.root.append(win, this.sr);
    (opts.parent ?? document.body).append(this.root);

    try {
      this.render();
    } catch (err) {
      this.root.remove();
      throw err;
    }
    window.addEventListener('keydown', this.onKey, true);
    this.focusFirst();
  }

  // ---- lifecycle

  private close(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    if (this.before instanceof HTMLElement && this.before.isConnected) this.before.focus();
    this.resolve(this.s);
  }

  private set(next: S.Screen): void {
    const ended = !S.finished(this.s) && S.finished(next);
    this.s = next;
    if (ended) this.lines.splice(0, this.lines.length, ...this.opts.record(next.state.status === 'won' ? 'won' : 'lost'));
    this.render();
  }

  private say(text: string): void {
    this.sr.textContent = '';
    // a new node each time, so a screen reader announces a repeat as well
    this.sr.append(el('span', undefined, text));
  }

  // ---- rendering

  private render(): void {
    const { t, s } = this;
    const kind = s.battle.spec.kind;
    this.root.dataset.phase = s.phase;
    this.title.textContent = `${t(S.KIND_KEY[kind])} · ${this.opts.attacker}`;
    const v = s.view;
    this.round.textContent = v ? t('ui.battle.round', { n: v.number, of: v.of }) : '';
    this.renderBoard();
    this.renderLog();
    this.renderSide();
    const atEnd = s.phase === 'end';
    this.log.hidden = atEnd;
    this.board.hidden = this.board.hidden || atEnd;
    this.answer.hidden = atEnd;
    this.end.hidden = !atEnd;
    if (atEnd) this.renderEnd();
    else this.renderAnswer();
  }

  private renderBoard(): void {
    const { t } = this;
    const design = this.s.battle.spec.kind === 'design';
    const { notes, proposal } = S.whiteboard(this.s);
    // Other kinds show a proposal to judge on the board too; only interviews keep it up.
    this.board.hidden = !design && proposal.length === 0;
    this.board.replaceChildren();
    if (this.board.hidden) return;
    // While a proposal is judged it has the board to itself; the requirements come back after.
    if (design && proposal.length === 0) {
      this.board.append(el('h3', undefined, t('ui.battle.whiteboard')));
      if (notes.length === 0) this.board.append(el('p', 'nb-empty', t('ui.battle.board_empty')));
      else {
        const ul = el('ul');
        for (const k of notes) ul.append(el('li', undefined, S.boardText(t(k))));
        this.board.append(ul);
      }
    }
    if (proposal.length > 0) {
      const box = el('div', 'nb-proposal');
      box.append(el('h3', undefined, `${t('ui.battle.whiteboard')} · ${t('ui.battle.proposal')}`));
      const ul = el('ul');
      for (const k of proposal) ul.append(el('li', undefined, S.boardText(t(k))));
      box.append(ul);
      this.board.append(box);
    }
  }

  private renderLog(): void {
    const { t } = this;
    const entries = this.s.transcript;
    if (entries.length < this.shown) {
      // a retry: a fresh transcript
      this.log.replaceChildren();
      this.shown = 0;
    }
    let firstNew: El | null = null;
    for (let i = this.shown; i < entries.length; i++) {
      const e = entries[i]!;
      const prev = entries[i - 1];
      switch (e.kind) {
        case 'announce':
          this.log.append(el('p', 'nb-announce', t(e.text)));
          break;
        case 'narration':
          this.log.append(el('p', 'nb-narr', t(e.text)));
          break;
        case 'attacker': {
          const first = prev?.kind !== 'attacker';
          const row = el('div', 'nb-msg nb-them');
          const face = el('div', first ? 'nb-face' : 'nb-face nb-blank');
          face.setAttribute('aria-hidden', 'true');
          const pic = first ? this.opts.portrait() : null;
          if (pic) face.append(pic);
          const bubble = el('div', 'nb-bubble');
          if (first) bubble.append(el('span', 'nb-who', this.opts.speaker));
          bubble.append(el('span', undefined, t(e.text)));
          row.append(face, bubble);
          this.log.append(row);
          break;
        }
        case 'answer': {
          const row = el('div', 'nb-msg nb-you');
          const bubble = el('div', 'nb-bubble');
          bubble.append(el('span', 'nb-who', t('ui.battle.you')));
          if (e.ordered) {
            const ol = el('ol');
            for (const k of e.texts) ol.append(el('li', undefined, t(k)));
            bubble.append(ol);
          } else if (e.texts.length > 1) {
            const ul = el('ul');
            for (const k of e.texts) ul.append(el('li', undefined, t(k)));
            bubble.append(ul);
          } else bubble.append(el('span', undefined, t(e.texts[0] ?? '')));
          row.append(bubble);
          this.log.append(row);
          break;
        }
        case 'note': {
          const note = el('div', 'nb-note');
          const head = el('p');
          head.append(this.mark(e.grade));
          const deltas = this.deltas(e.confidence, e.pressure);
          if (deltas) head.append(' ', el('span', 'nb-delta', `· ${deltas}`));
          note.append(head);
          for (const k of e.explanations) note.append(el('p', undefined, t(k)));
          this.log.append(note);
          break;
        }
      }
    }
    if (entries.length > this.shown) {
      firstNew = (this.log.children[this.log.children.length - (entries.length - this.shown)] as El | undefined) ?? null;
      this.shown = entries.length;
      // Show what is new from its top (the answer and its explanation, or the next question),
      // so nothing new starts above the fold. Runs after layout, once the cards have their size.
      const target = firstNew;
      requestAnimationFrame(() => {
        if (target) this.log.scrollTop = Math.max(0, target.offsetTop - this.log.offsetTop - 8);
      });
    }
  }

  private mark(grade: Grade): El {
    return el('span', `nb-mark nb-g-${grade}`, `${S.GRADE_MARK[grade]} ${this.t(S.GRADE_KEY[grade])}`);
  }

  private deltas(confidence: number, pressure: number): string {
    const { t } = this;
    const kind = this.s.battle.spec.kind;
    const parts: string[] = [];
    if (pressure !== 0) parts.push(t('ui.battle.delta', { label: t(S.PRESSURE_KEY[kind]), value: pressure }));
    if (confidence !== 0) parts.push(t('ui.battle.delta', { label: t('ui.battle.confidence'), value: confidence }));
    return parts.join(' · ');
  }

  private meter(label: string, value: number, max: number, fill: string): El {
    const m = el('div', 'nb-meter');
    m.setAttribute('role', 'meter');
    m.setAttribute('aria-label', label);
    m.setAttribute('aria-valuemin', '0');
    m.setAttribute('aria-valuemax', String(max));
    m.setAttribute('aria-valuenow', String(value));
    const head = el('div', 'nb-meter-head');
    head.append(el('span', undefined, label), el('span', 'nb-value', String(value)));
    const gauge = el('div', 'nb-gauge');
    gauge.setAttribute('aria-hidden', 'true');
    const bar = el('div', `nb-fill ${fill}`);
    bar.style.width = `${max > 0 ? Math.round((value / max) * 100) : 0}%`;
    gauge.append(bar);
    m.append(head, gauge);
    return m;
  }

  private renderSide(): void {
    const { t, s } = this;
    const max = s.battle.max;
    const kind = s.battle.spec.kind;
    this.side.replaceChildren(
      this.meter(t('ui.battle.confidence'), s.state.confidence, max.confidence, `nb-${S.confidenceTone(s.state.confidence, max.confidence)}`),
      this.meter(t(S.PRESSURE_KEY[kind]), s.state.pressure, max.pressure, 'nb-them'),
    );
    const hints = s.phase === 'answer' && s.view ? s.view.hints : [];
    if (hints.length > 0) {
      const box = el('section', 'nb-hints');
      box.append(el('h3', undefined, t('ui.battle.hint')));
      for (const k of hints) box.append(el('p', undefined, t(questKey(s.quest, k))));
      this.side.append(box);
    }
  }

  private button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el('button', primary ? 'nb-btn nb-primary' : 'nb-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private renderAnswer(): void {
    const { t, s } = this;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.id ?? null;
    const focusedArrow = (document.activeElement as HTMLElement | null)?.dataset?.arrow ?? null;
    this.answer.replaceChildren();
    if (s.phase === 'review') {
      const foot = el('div', 'nb-foot');
      const go = this.button(t(S.finished(s) ? 'ui.battle.debrief' : 'ui.battle.continue'), () => {
        this.set(S.next(this.s));
        if (this.s.phase === 'answer') this.focusFirst();
      }, true);
      go.dataset.action = 'continue';
      foot.append(go);
      this.answer.append(foot);
      return;
    }
    const v = s.view;
    if (!v) return;
    const ins = S.instructionOf(v);
    const instr = el('p', 'nb-instr', t(ins.key, ins.params));
    instr.id = 'nb-instr';
    this.answer.append(instr);
    const mode = S.interactionOf(v.round);
    if (mode === 'order') this.answer.append(this.orderList(v.round));
    else this.answer.append(this.pickList(mode));

    const foot = el('div', 'nb-foot');
    const count = el('span', 'nb-count');
    if (mode === 'many') count.textContent = t('ui.battle.picked', { n: s.selection.length, of: v.pick });
    const send = this.button(t('ui.battle.send'), () => this.send(), true);
    send.dataset.action = 'send';
    send.disabled = !S.canSend(s);
    foot.append(count, send);
    this.answer.append(foot);

    // keep the keyboard where it was across a redraw
    if (!focusedId) return;
    const item = this.answer.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedId)}"]`);
    if (!item) return;
    this.rove(item);
    const arrow = focusedArrow ? item.querySelector<HTMLButtonElement>(`[data-arrow="${focusedArrow}"]`) : null;
    if (arrow && !arrow.disabled) arrow.focus();
    else item.focus();
  }

  private focusStep(id: string): void {
    const li = this.answer.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    this.rove(li);
    li.focus();
  }

  /** One tab stop per list: the item that has (or last had) the keyboard. */
  private rove(item: HTMLElement): void {
    const siblings = item.parentElement ? [...item.parentElement.children] : [];
    for (const x of siblings) if (x instanceof HTMLElement && x.dataset.id) x.tabIndex = x === item ? 0 : -1;
  }

  private pickList(mode: 'one' | 'many'): El {
    const { t, s } = this;
    const v = s.view!;
    const list = el('div', 'nb-cards');
    list.setAttribute('role', mode === 'one' ? 'radiogroup' : 'group');
    list.setAttribute('aria-labelledby', 'nb-instr');
    const q = this.questionId();
    if (q) list.setAttribute('aria-describedby', q);
    const full = S.full(s);
    v.cards.forEach((id, i) => {
      const picked = s.selection.includes(id);
      const card = el('button', 'nb-card');
      card.type = 'button';
      card.dataset.id = id;
      card.setAttribute('role', mode === 'one' ? 'radio' : 'checkbox');
      card.setAttribute('aria-checked', String(picked));
      if (full && !picked) card.setAttribute('aria-disabled', 'true');
      // one tab stop for the group; arrows move inside it
      const anchor = s.selection[0] ?? v.cards[0];
      card.tabIndex = id === anchor ? 0 : -1;
      const tick = mode === 'one' ? (picked ? '(•)' : '( )') : picked ? '[✓]' : '[ ]';
      card.append(el('span', 'nb-tick', tick), el('span', undefined, t(questKey(s.quest, S.cardText(v.round, id)))));
      card.setAttribute('aria-posinset', String(i + 1));
      card.setAttribute('aria-setsize', String(v.cards.length));
      card.addEventListener('click', () => {
        const next = S.toggle(this.s, id);
        if (next === this.s && full && !picked) this.say(t('ui.battle.picked', { n: s.selection.length, of: v.pick }));
        this.set(next);
        this.answer.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
      });
      list.append(card);
    });
    return list;
  }

  private orderList(round: BattleRound): El {
    const { t, s } = this;
    const n = s.selection.length;
    const help = el('p', 'nb-sr', t('ui.battle.order_help'));
    help.id = 'nb-order-help';
    const wrap = el('div', 'nb-cards-wrap');
    const ol = el('ol', 'nb-cards');
    ol.setAttribute('aria-labelledby', 'nb-instr');
    const q = this.questionId();
    ol.setAttribute('aria-describedby', q ? `${q} nb-order-help` : 'nb-order-help');
    s.selection.forEach((id, i) => {
      const text = t(questKey(s.quest, S.cardText(round, id)));
      const li = el('li', this.grabbed === id ? 'nb-step nb-grabbed' : 'nb-step');
      li.dataset.id = id;
      li.tabIndex = (this.grabbed ?? s.selection[0]) === id ? 0 : -1;
      li.setAttribute('aria-label', t('ui.battle.step', { n: i + 1, of: n, text }));
      if (this.grabbed === id) li.setAttribute('aria-current', 'true');
      // grabbed: a different handle and a visible word, not only a colour
      const handle = el('span', 'nb-handle', this.grabbed === id ? '⇅' : '⠿');
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (e) => this.dragStart(e, ol, id));
      const up = el('button', 'nb-arrow', '↑');
      up.type = 'button';
      up.tabIndex = -1;
      up.dataset.arrow = 'up';
      up.disabled = i === 0;
      up.setAttribute('aria-label', t('ui.battle.move_up'));
      up.addEventListener('click', () => this.moveBy(id, -1, false));
      const down = el('button', 'nb-arrow', '↓');
      down.type = 'button';
      down.tabIndex = -1;
      down.dataset.arrow = 'down';
      down.disabled = i === n - 1;
      down.setAttribute('aria-label', t('ui.battle.move_down'));
      down.addEventListener('click', () => this.moveBy(id, 1, false));
      li.append(handle, el('span', 'nb-pos', `${i + 1}.`), el('span', 'nb-step-text', text));
      if (this.grabbed === id) li.append(el('span', 'nb-moving', t('ui.battle.moving')));
      li.append(up, down);
      ol.append(li);
    });
    wrap.append(help, ol);
    return wrap;
  }

  private moveBy(id: string, delta: number, keyboard: boolean): void {
    const from = this.s.selection.indexOf(id);
    if (from < 0) return;
    this.set(S.move(this.s, from, from + delta));
    const at = this.s.selection.indexOf(id);
    if (keyboard) this.focusStep(id);
    this.say(this.t('ui.battle.moved', { n: at + 1, of: this.s.selection.length }));
  }

  /** Drag a step by its handle (mouse, pen or finger). The list holds the pointer capture. */
  private dragStart(e: PointerEvent, ol: HTMLOListElement, id: string): void {
    e.preventDefault();
    ol.setPointerCapture(e.pointerId);
    const dragged = ol.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`);
    dragged?.classList.add('nb-dragging');
    const onMove = (m: PointerEvent) => {
      const items = [...ol.querySelectorAll<HTMLElement>('li')];
      const others = items.filter((li) => li.dataset.id !== id);
      let to = others.findIndex((li) => {
        const r = li.getBoundingClientRect();
        return m.clientY < r.top + r.height / 2;
      });
      if (to < 0) to = others.length;
      const ref = others[to] ?? null;
      if (dragged && dragged.nextElementSibling !== ref) ol.insertBefore(dragged, ref);
    };
    const onUp = () => {
      ol.removeEventListener('pointermove', onMove);
      ol.removeEventListener('pointerup', onUp);
      ol.removeEventListener('pointercancel', onUp);
      dragged?.classList.remove('nb-dragging');
      const order = [...ol.querySelectorAll<HTMLElement>('li')].map((li) => li.dataset.id!);
      const from = this.s.selection.indexOf(id);
      const to = order.indexOf(id);
      if (!ol.isConnected || from < 0 || to === from) return;
      this.set(S.move(this.s, from, to));
      this.say(this.t('ui.battle.moved', { n: to + 1, of: order.length }));
    };
    ol.addEventListener('pointermove', onMove);
    ol.addEventListener('pointerup', onUp);
    ol.addEventListener('pointercancel', onUp);
  }

  /** The id of the question on screen (the attacker's latest message), for aria-describedby. */
  private questionId(): string | null {
    const bubbles = this.log.querySelectorAll<HTMLElement>('.nb-them .nb-bubble');
    const last = bubbles[bubbles.length - 1];
    if (!last) return null;
    last.id ||= `nb-q-${bubbles.length}`;
    return last.id;
  }

  private send(): void {
    if (!S.canSend(this.s)) return;
    this.grabbed = null;
    this.set(S.send(this.s));
    this.answer.querySelector<HTMLElement>('[data-action="continue"]')?.focus();
  }

  private renderEnd(): void {
    const { t, s } = this;
    const won = s.state.status === 'won';
    this.end.replaceChildren();
    const box = el('div', won ? 'nb-won' : 'nb-lost');
    box.append(el('p', 'nb-verdict', `${won ? '✓' : '✗'} ${t(won ? 'ui.battle.won' : 'ui.battle.lost')}`));
    const outro = won ? s.battle.spec.outro.won : s.battle.spec.outro.lost;
    for (const k of outro) box.append(el('p', undefined, t(questKey(s.quest, k))));
    for (const line of this.lines) box.append(el('p', 'nb-reward', line));
    const actions = el('div', 'nb-actions');
    const again = this.button(t('ui.battle.retry'), () => {
      this.set(S.retry(this.s));
      this.focusFirst();
    }, !won);
    again.dataset.action = 'retry';
    const close = this.button(t('ui.close'), () => this.close(), won);
    close.dataset.action = 'close';
    actions.append(again, close);
    box.append(actions);
    this.end.append(box);

    this.end.append(el('h3', undefined, t('ui.battle.debrief')));
    const ol = el('ol', 'nb-debrief');
    // a tab stop, so the keyboard can scroll through the debrief
    ol.tabIndex = 0;
    ol.setAttribute('aria-label', t('ui.battle.debrief'));
    for (const row of s.debrief) {
      const li = el('li');
      li.append(el('p', 'nb-q', t(row.question)));
      const yours = el('p', 'nb-yours');
      yours.append(this.mark(row.grade), ` · ${t('ui.battle.you')}: ${row.answer.map((k) => t(k)).join(row.ordered ? ' → ' : t('ui.list_sep'))}`);
      li.append(yours);
      const why = el('div', 'nb-why');
      for (const k of row.explanations) why.append(el('p', undefined, t(k)));
      li.append(why);
      ol.append(li);
    }
    this.end.append(ol);
    this.end.scrollTop = 0;
    (won ? close : again).focus();
  }

  private focusFirst(): void {
    const target =
      this.answer.querySelector<HTMLElement>('[tabindex="0"]') ??
      this.answer.querySelector<HTMLElement>('button:not([disabled])') ??
      this.end.querySelector<HTMLElement>('button');
    target?.focus();
  }

  // ---- keyboard

  private onKey = (e: KeyboardEvent): void => {
    // Everything typed while the overlay is open is ours: Phaser (on window, bubbling) never
    // sees it, so the world and the HUD do not act on a key meant for a card or a button.
    e.stopPropagation();
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.grabbed) this.drop();
      else this.close();
      return;
    }
    if (e.key === 'Tab') {
      this.trapTab(e);
      return;
    }
    if (!target || !this.root.contains(target)) {
      if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) {
        e.preventDefault();
        this.focusFirst();
      }
      return;
    }
    if (target.matches('li.nb-step')) this.stepKey(e, target);
    else if (target.matches('.nb-card')) this.cardKey(e, target);
  };

  private trapTab(e: KeyboardEvent): void {
    const items = [...this.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (items.length === 0) return;
    const active = document.activeElement;
    let i = items.indexOf(active as HTMLElement);
    if (i < 0 && active && this.root.contains(active)) {
      // focus sits on something outside the tab order (the log, say): go on from where it is
      const after = items.findIndex((x) => active.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
      i = (after < 0 ? items.length : after) - (e.shiftKey ? 0 : 1);
    }
    const nextIndex = i < 0 ? (e.shiftKey ? items.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
    e.preventDefault();
    items[nextIndex]!.focus();
  }

  private cardKey(e: KeyboardEvent, card: HTMLElement): void {
    const cards = [...this.answer.querySelectorAll<HTMLElement>('.nb-card')];
    const i = cards.indexOf(card);
    const go = (j: number) => {
      e.preventDefault();
      const c = cards[(j + cards.length) % cards.length]!;
      // radio buttons: the arrows also pick (a pick-many group only moves the focus)
      if (c.getAttribute('role') === 'radio') {
        this.set(S.toggle(this.s, c.dataset.id!));
        const fresh = this.answer.querySelector<HTMLElement>(`[data-id="${CSS.escape(c.dataset.id!)}"]`);
        if (fresh) {
          this.rove(fresh);
          fresh.focus();
        }
        return;
      }
      this.rove(c);
      c.focus();
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(cards.length - 1);
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.send();
    }
  }

  private stepKey(e: KeyboardEvent, li: HTMLElement): void {
    const id = li.dataset.id!;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return this.send();
      if (this.grabbed === id) this.drop();
      else {
        this.grabbed = id;
        this.render();
        this.focusStep(id);
        const at = this.s.selection.indexOf(id);
        this.say(this.t('ui.battle.grabbed', { n: at + 1, of: this.s.selection.length }));
      }
      return;
    }
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    if (this.grabbed === id) {
      this.moveBy(id, delta, true);
      return;
    }
    const items = [...this.answer.querySelectorAll<HTMLElement>('li.nb-step')];
    const j = items.indexOf(li) + delta;
    const to = items[j];
    if (!to) return;
    this.rove(to);
    to.focus();
  }

  private drop(): void {
    const id = this.grabbed;
    this.grabbed = null;
    this.render();
    if (!id) return;
    this.focusStep(id);
    const at = this.s.selection.indexOf(id);
    this.say(this.t('ui.battle.dropped', { n: at + 1, of: this.s.selection.length }));
  }
}
