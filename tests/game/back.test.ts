import { describe, expect, it } from 'vitest';
import { goBack, pushBack } from '../../src/game/back';

// The Android back button (src/game/back.ts, called by android/.../MainActivity.java).
describe('the Android back button', () => {
  it('closes the newest overlay first, then the one under it', () => {
    const closed: string[] = [];
    const offTerminal = pushBack(() => closed.push('terminal'));
    const offBattle = pushBack(() => closed.push('battle'));
    expect(goBack(() => true, () => closed.push('pad'))).toBe(true);
    offBattle();
    expect(goBack(() => true, () => closed.push('pad'))).toBe(true);
    offTerminal();
    expect(closed).toEqual(['battle', 'terminal']);
  });

  it('sends the on-screen back button while a screen, the menu or a dialogue is open', () => {
    let pad = 0;
    expect(goBack(() => true, () => pad++)).toBe(true);
    expect(pad).toBe(1);
  });

  it('says false with nothing open, so the app goes to the background', () => {
    let pad = 0;
    expect(goBack(() => false, () => pad++)).toBe(false);
    expect(pad).toBe(0);
  });

  it('unregistering twice, or out of order, leaves the other overlays alone', () => {
    const closed: string[] = [];
    const offA = pushBack(() => closed.push('a'));
    const offB = pushBack(() => closed.push('b'));
    offA();
    offA();
    expect(goBack(() => false, () => undefined)).toBe(true);
    offB();
    expect(goBack(() => false, () => undefined)).toBe(false);
    expect(closed).toEqual(['b']);
  });
});
