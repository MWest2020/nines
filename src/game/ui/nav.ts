// Keyboard focus between UI items, by geometry. Pure, so it is tested in Node.

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Focusable {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The next item in a direction from the current one: the nearest whose centre lies that way,
 * with sideways distance counting double so a straight line wins. Stays put at an edge.
 */
export function navigate(items: readonly Focusable[], current: number, dir: Dir): number {
  const from = items[current];
  if (!from) return items.length > 0 ? 0 : -1;
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best = current;
  let bestScore = Infinity;
  items.forEach((it, i) => {
    if (i === current) return;
    const dx = it.x + it.w / 2 - cx;
    const dy = it.y + it.h / 2 - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) return;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
