// A minimal dialogue box, only until the real one (HudScene, a later chunk) listens to the world's
// talk and use events. Shape from DESIGN.md: an ink panel with paper text, a name tab on its top
// edge with a 1 px gold rule under it, square corners, 232 x 48 at the bottom of the view, and a
// caret when there is more. No typing effect, no portraits.

import Phaser from 'phaser';

const INK = 0x101820;
const PAPER = '#f8f0d8';
const GOLD = 0xf8d070;
const SLATE = 0x485860;

export class PlaceholderDialogue {
  private readonly box: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Text;
  private page = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    name: string,
    private readonly pages: string[],
    private readonly onClose: () => void,
  ) {
    const { width, height } = scene.scale.gameSize;
    const x = 4;
    const y = height - 48 - 4;
    const w = width - 8;
    const font = { fontFamily: 'ui-monospace, monospace', fontSize: '8px', color: PAPER } as const;
    const label = scene.add.text(x + 6, y - 9, name, font);
    const tabW = Math.ceil(label.width) + 12;
    const parts: Phaser.GameObjects.GameObject[] = [
      scene.add.rectangle(x, y - 11, tabW, 11, INK).setOrigin(0).setStrokeStyle(1, SLATE),
      scene.add.rectangle(x, y, w, 48, INK).setOrigin(0).setStrokeStyle(1, SLATE),
      scene.add.rectangle(x + 1, y, tabW - 2, 1, GOLD).setOrigin(0),
      label,
    ];
    this.body = scene.add.text(x + 6, y + 5, '', { ...font, lineSpacing: 2, wordWrap: { width: w - 18 } });
    this.caret = scene.add.text(x + w - 9, y + 38, '>', { ...font, color: '#f8d070' });
    this.box = scene.add.container(0, 0, [...parts, this.body, this.caret]).setScrollFactor(0).setDepth(2000);
    scene.tweens.add({ targets: this.caret, alpha: 0, duration: 400, yoyo: true, repeat: -1 });
    this.show();
  }

  /** Enter or Space: next page, or close after the last. */
  advance(): void {
    if (this.page < this.pages.length - 1) {
      this.page++;
      this.show();
    } else {
      this.close();
    }
  }

  close(): void {
    this.box.destroy();
    this.onClose();
  }

  private show(): void {
    this.body.setText(this.pages[this.page] ?? '');
    this.caret.setVisible(this.page < this.pages.length - 1);
  }
}
