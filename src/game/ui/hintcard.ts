// The "Ask the AI?" card (DESIGN.md, AI tokens): a hint that has unlocked shows its price before
// it shows itself. Shared by the terminal and the battle overlays. The rules live in
// core/tokens.ts; this only renders an offer and calls back when the player pays.

import type { Translate } from '../../core/i18n';
import type { HintOffer } from '../../core/tokens';
import './hintcard.css';

/** How an overlay reaches the token rules (the wiring maps it onto GameApi.hintOffer/askHint). */
export interface HintGate {
  offer(key: string): HintOffer;
  /** pay and reveal; false when refused (no tokens) */
  ask(key: string): boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The price line of an offer, in the player's language. */
export function offerText(t: Translate, offer: HintOffer): string {
  if (offer.kind === 'broke') return t('ui.hint.broke');
  if (offer.kind !== 'ask') return '';
  if (offer.cost === 0) return t('ui.hint.offer_house', { penalty: offer.percent - offer.after });
  return offer.after < offer.percent
    ? t('ui.hint.offer', { cost: offer.cost, penalty: offer.percent - offer.after, tokens: offer.tokens })
    : t('ui.hint.offer_floor', { cost: offer.cost, after: offer.after, tokens: offer.tokens });
}

/**
 * One element per unlocked hint: its text when it is paid for (or free), else the offer with an
 * "Ask the AI" button. `text` turns a hint key into its sentence; `changed` re-renders after a
 * purchase. `cls` is the overlay's own class for a shown hint, so each keeps its look.
 */
export function hintCards(
  keys: readonly string[],
  opts: { t: Translate; gate?: HintGate; text: (key: string) => string; changed: () => void; cls?: (key: string, i: number) => string },
): HTMLElement[] {
  const { t, gate } = opts;
  return keys.map((key, i) => {
    const offer: HintOffer = gate ? gate.offer(key) : { kind: 'free' };
    if (offer.kind === 'shown' || offer.kind === 'free') return el('p', opts.cls?.(key, i), opts.text(key));
    const card = el('div', offer.kind === 'broke' ? 'nh-card nh-broke' : 'nh-card');
    card.dataset['hint'] = key;
    card.append(el('p', 'nh-ready', t('ui.hint.ready')), el('p', 'nh-cost', offerText(t, offer)));
    if (offer.kind === 'ask') {
      const b = el('button', 'nh-ask', t('ui.hint.ask'));
      b.type = 'button';
      b.addEventListener('click', () => {
        if (gate?.ask(key)) opts.changed();
      });
      card.append(b);
    }
    return card;
  });
}
