// The dialogue box (DESIGN.md, World and dialogue box): a dark ink panel with paper text at the
// bottom of the view, 232 x 48 px with a 4 px margin, three lines of text. A name tab sits on
// its top edge with a 1 px gold rule under the name; square corners. Text types out; a tap,
// Enter or Space shows it all, the next one advances. A small gold caret blinks when there is
// more. Our own shape, not a copy of any other game's box.

import Phaser from 'phaser';
import { measure, paginate, sanitize } from './font';
import { pixelText } from './pixelfont';
import { C, hex, VIEW } from './theme';

const BOX = { x: 4, w: 232, h: 48 } as const;
const PAD = { x: 6, y: 5 } as const;
const LINES = 3;
const TEXT_W = BOX.w - 2 * PAD.x - 6;
/** milliseconds per character while typing */
const TYPE_MS = 22;

export interface Page {
  speaker: string | null;
  text: string;
}

/** Split lines (already translated) into the pages the box shows: three lines each. */
export function pagesOf(lines: readonly { speaker: string | null; text: string }[]): Page[] {
  return lines.flatMap((l) => paginate(l.text, TEXT_W, LINES).map((text) => ({ speaker: l.speaker, text })));
}

export class DialogueBox {
  private readonly root: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.BitmapText;
  private readonly name: Phaser.GameObjects.BitmapText;
  private readonly caret: Phaser.GameObjects.Graphics;
  private pages: Page[] = [];
  private index = 0;
  private shown = 0;
  private typing: Phaser.Time.TimerEvent | null = null;
  private finish: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly scene: Phaser.Scene) {
    const y = VIEW.height - BOX.h - 4;
    this.frame = scene.add.graphics();
    this.body = pixelText(scene, BOX.x + PAD.x, y + PAD.y, '', C.paper);
    this.name = pixelText(scene, BOX.x + PAD.x, y - 9, '', C.gold);
    this.caret = scene.add.graphics();
    this.caret.setPosition(BOX.x + BOX.w - 9, y + BOX.h - 10);
    scene.tweens.add({ targets: this.caret, alpha: 0, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped' });
    // a full-screen catcher: while the box is open a tap anywhere advances it
    const catcher = scene.add.zone(0, 0, VIEW.width, VIEW.height).setOrigin(0).setInteractive();
    catcher.on('pointerdown', () => this.advance());
    this.root = scene.add.container(0, 0, [catcher, this.frame, this.name, this.body, this.caret]).setVisible(false).setDepth(30);
    this.root.setActive(false);
    catcher.disableInteractive();
    this.catcher = catcher;
  }

  private readonly catcher: Phaser.GameObjects.Zone;

  get open(): boolean {
    return this.finish !== null;
  }

  /** Show pages; resolves when the last one is dismissed. Calls queue up one after another. */
  show(pages: readonly Page[]): Promise<void> {
    const run = () =>
      new Promise<void>((resolve) => {
        if (pages.length === 0) return resolve();
        this.pages = [...pages];
        this.index = 0;
        this.finish = resolve;
        this.root.setVisible(true).setActive(true);
        this.catcher.setInteractive();
        this.render();
      });
    this.queue = this.queue.then(run);
    return this.queue;
  }

  /** Enter, Space or a tap: complete the typing, or go to the next page, or close. */
  advance(): void {
    if (!this.finish) return;
    const page = this.pages[this.index]!;
    if (this.shown < page.text.length) {
      this.stopTyping();
      this.shown = page.text.length;
      this.body.setText(page.text);
      this.showCaret();
      return;
    }
    this.index++;
    if (this.index < this.pages.length) return this.render();
    this.stopTyping();
    this.root.setVisible(false).setActive(false);
    this.catcher.disableInteractive();
    const done = this.finish;
    this.finish = null;
    done();
  }

  /** A blinking caret when another page follows; a small square on the last one. */
  private showCaret(): void {
    const g = this.caret.clear().fillStyle(hex(C.gold), 1);
    if (this.index < this.pages.length - 1) g.fillTriangle(0, 0, 0, 6, 3, 3);
    else g.fillRect(0, 2, 3, 3);
    this.caret.setVisible(true);
  }

  private stopTyping(): void {
    this.typing?.remove(false);
    this.typing = null;
  }

  private render(): void {
    const page = this.pages[this.index]!;
    const y = VIEW.height - BOX.h - 4;
    const g = this.frame.clear();
    g.fillStyle(hex(C.ink), 1).fillRect(BOX.x, y, BOX.w, BOX.h);
    g.lineStyle(1, hex(C.slate), 1).strokeRect(BOX.x + 0.5, y + 0.5, BOX.w - 1, BOX.h - 1);
    if (page.speaker) {
      const w = measure(page.speaker) + 2 * PAD.x;
      g.fillStyle(hex(C.ink), 1).fillRect(BOX.x, y - 11, w, 12);
      g.lineStyle(1, hex(C.slate), 1).strokeRect(BOX.x + 0.5, y - 10.5, w - 1, 11);
      g.fillStyle(hex(C.gold), 1).fillRect(BOX.x + 3, y, w - 6, 1);
    }
    this.name.setText(sanitize(page.speaker ?? ''));
    this.stopTyping();
    this.shown = 0;
    this.body.setText('');
    this.caret.setVisible(false);
    this.typing = this.scene.time.addEvent({
      delay: TYPE_MS,
      repeat: Math.max(0, page.text.length - 1),
      callback: () => {
        this.shown++;
        this.body.setText(page.text.slice(0, this.shown));
        if (this.shown >= page.text.length) {
          this.typing = null;
          this.showCaret();
        }
      },
    });
  }
}
