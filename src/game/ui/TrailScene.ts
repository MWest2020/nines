// The Career Trail (DESIGN.md, Career Trail): our own skill map. The three towns sit on a road
// from left to right; the chosen town's branches leave it as side paths with milestone
// stones. A done stone is gold and filled, an open one an outline, a locked one grey with a
// padlock notch, so state never depends on colour alone. Choosing a stone shows its name,
// branch, town and the quest that lights it. Everything comes from core/game.ts trail().

import type Phaser from 'phaser';
import type { NodeState, TrailNode, TrailView } from '../../core/game';
import { findNpc } from '../../core/talk';
import { questKey } from '../../content/types';
import { ellipsize, measure } from './font';
import { pixelText } from './pixelfont';
import { Screen } from './Screen';
import { C, hex, panel } from './theme';
import { button, buttonWidth } from './widgets';

const P = { x: 4, y: 4, w: 232, h: 152 } as const;
const ROAD_Y = P.y + 24;
const ROWS_Y = P.y + 48;
const ROW_H = 13;
const LABEL_W = 100;
const STONE_X = P.x + 116;
/** at most; stones close up when a branch has more. The screen fits five branch rows of five
 *  stones per town, and tests/game/ui.test.ts holds the roadmap to that. */
const STONE_DX = 20;
const FOOT_Y = P.y + P.h - 43;

/** Draw a stone centred on (cx, cy) in its state's shape. */
export function stone(g: Phaser.GameObjects.Graphics, cx: number, cy: number, state: NodeState): void {
  if (state === 'done') {
    g.fillStyle(hex(C.gold), 1).fillPoints(diamond(cx, cy, 4), true);
  } else if (state === 'open') {
    g.fillStyle(hex(C.ink), 1).fillPoints(diamond(cx, cy, 4), true);
    g.lineStyle(1, hex(C.paper), 1).strokePoints(diamond(cx + 0.5, cy + 0.5, 4), true);
  } else {
    g.fillStyle(hex(C.grey), 1).fillRect(cx - 3, cy - 3, 7, 7);
    g.fillStyle(hex(C.ink), 1).fillRect(cx - 1, cy - 3, 3, 2); // the padlock notch
  }
}

const diamond = (cx: number, cy: number, r: number) => [
  { x: cx, y: cy - r },
  { x: cx + r, y: cy },
  { x: cx, y: cy + r },
  { x: cx - r, y: cy },
];

export class TrailScene extends Screen {
  /** index of the town whose paths are shown; null = pick the furthest open town */
  private town: number | null = null;
  private detail: Phaser.GameObjects.BitmapText[] = [];
  private items: ({ kind: 'town'; index: number } | { kind: 'node'; node: TrailNode } | { kind: 'close' })[] = [];

  constructor() {
    super('trail');
  }

  override create(): void {
    this.town = null;
    super.create();
  }

  protected draw(): Phaser.GameObjects.GameObject[] {
    const { store, t } = this.api;
    const view = store.trail();
    if (this.town === null) {
      const open = view.towns.map((tw, i) => (tw.open ? i : -1)).filter((i) => i >= 0);
      this.town = open.at(-1) ?? 0;
    }
    const town = view.towns[this.town]!;
    this.items = [];
    const out: Phaser.GameObjects.GameObject[] = [panel(this, P.x, P.y, P.w, P.h, 13)];
    out.push(pixelText(this, P.x + 6, P.y + 2, t('ui.roadmap.title'), C.paper));

    // the road with its towns
    const g = this.add.graphics();
    out.push(g);
    const n = view.towns.length;
    const seg = (P.w - 16) / n;
    g.fillStyle(hex(C.slate), 1).fillRect(P.x + 8 + seg / 2, ROAD_Y, seg * (n - 1), 1);
    view.towns.forEach((tw, i) => {
      const cx = Math.round(P.x + 8 + seg * i + seg / 2);
      const selected = i === this.town;
      g.fillStyle(hex(tw.open ? C.shadow : C.ink), 1).fillRect(cx - 5, ROAD_Y - 5, 11, 11);
      g.lineStyle(1, hex(selected ? C.gold : tw.open ? C.paper : C.grey), 1).strokeRect(cx - 4.5, ROAD_Y - 4.5, 10, 10);
      if (!tw.open) g.fillStyle(hex(C.grey), 1).fillRect(cx - 1, ROAD_Y - 1, 3, 3);
      else if (tw.done > 0) g.fillStyle(hex(C.gold), 1).fillRect(cx - 2, ROAD_Y - 2, 5, 5);
      const label = ellipsize(t(tw.title), seg - 4);
      out.push(pixelText(this, Math.round(cx - measure(label) / 2), ROAD_Y + 7, label, selected ? C.gold : tw.open ? C.mist : C.grey));
      this.items.push({ kind: 'town', index: i });
      this.focusable(this.ring(out, cx - 7, ROAD_Y - 7, 15, 15, () => this.pickTown(i)));
    });

    // the side paths of the chosen town, one per branch, with their stones
    const nodes = view.nodes.filter((nd) => nd.stage === town.stage);
    const branches = store.content.roadmap.branches.filter((b) => nodes.some((nd) => nd.branch === b.id));
    if (branches.length === 0) out.push(pixelText(this, P.x + 6, ROWS_Y, t('ui.roadmap.empty'), C.grey));
    branches.forEach((b, row) => {
      const y = ROWS_Y + row * ROW_H;
      const mine = nodes.filter((nd) => nd.branch === b.id);
      out.push(pixelText(this, P.x + 6, y - 4, ellipsize(t(b.title), LABEL_W), C.paper));
      const xp = t('ui.roadmap.xp', { xp: view.xp[b.id] ?? 0 });
      out.push(pixelText(this, P.x + P.w - 6 - measure(xp), y - 4, xp, (view.xp[b.id] ?? 0) > 0 ? C.leaf : C.grey));
      // stones share the room between the label and the XP column
      const dx = mine.length > 1 ? Math.min(STONE_DX, Math.floor((P.x + P.w - 10 - measure(xp) - 8 - STONE_X) / (mine.length - 1))) : STONE_DX;
      g.fillStyle(hex(C.slate), 1).fillRect(P.x + 6 + LABEL_W + 4, y, STONE_X - (P.x + 10 + LABEL_W) + dx * (mine.length - 1), 1);
      mine.forEach((nd, j) => {
        const cx = STONE_X + j * dx;
        stone(g, cx, y, nd.state);
        this.items.push({ kind: 'node', node: nd });
        this.focusable(this.ring(out, cx - 6, y - 6, 13, 13, () => this.setFocus(this.items.findIndex((it) => it.kind === 'node' && it.node.id === nd.id))));
      });
    });

    // the footer: legend, progress and the chosen item's details
    g.fillStyle(hex(C.slate), 1).fillRect(P.x + 1, FOOT_Y, P.w - 2, 1);
    let lx = P.x + 10;
    for (const state of ['done', 'open', 'locked'] as const) {
      stone(g, lx, FOOT_Y + 7, state);
      const word = t(`ui.roadmap.${state}`);
      out.push(pixelText(this, lx + 7, FOOT_Y + 2, word, C.mist));
      lx += 7 + measure(word) + 12;
    }
    const progress = t('ui.roadmap.progress', { town: t(town.title), done: town.done, total: town.total });
    out.push(pixelText(this, P.x + P.w - 6 - measure(progress), FOOT_Y + 2, ellipsize(progress, P.x + P.w - 6 - lx), C.gold));
    this.detail = [0, 1, 2].map((i) => pixelText(this, P.x + 6, FOOT_Y + 13 + i * 10, '', i === 0 ? C.paper : C.mist));
    out.push(...this.detail);

    const close = t('ui.close');
    this.items.push({ kind: 'close' });
    out.push(...this.addButton(button(this, P.x + P.w - 6 - buttonWidth(close), P.y + 1, close, () => this.close())));

    // start on the first stone of the chosen town when there is one
    if (this.focus === 0 || this.focus >= this.items.length) {
      const first = this.items.findIndex((it) => it.kind === 'node');
      this.focus = first >= 0 ? first : this.town;
    }
    this.showDetail(view);
    return out;
  }

  /** A focus outline drawn around an item, and a hit zone that picks it. */
  private ring(out: Phaser.GameObjects.GameObject[], x: number, y: number, w: number, h: number, pick: () => void) {
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', pick);
    const outline = this.add.graphics();
    out.push(zone, outline);
    return {
      x,
      y,
      w,
      h,
      activate: pick,
      setFocus: (on: boolean) => {
        outline.clear();
        if (on) outline.lineStyle(1, hex(C.gold), 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      },
    };
  }

  private pickTown(i: number): void {
    if (i === this.town) return;
    this.town = i;
    this.focus = 0;
    this.redraw();
  }

  protected override onFocus(): void {
    this.showDetail(this.api.store.trail());
  }

  private showDetail(view: TrailView): void {
    const { store, t } = this.api;
    const it = this.items[this.focus];
    const lines = ['', '', ''];
    if (it?.kind === 'node') {
      const nd = it.node;
      const branch = store.content.roadmap.branches.find((b) => b.id === nd.branch);
      const town = store.content.roadmap.towns.find((tw) => tw.stage === nd.stage);
      lines[0] = t(nd.title);
      lines[1] = t('ui.roadmap.where', { branch: branch ? t(branch.title) : nd.branch, town: town ? t(town.title) : nd.stage });
      lines[2] =
        nd.litBy.length > 0
          ? t('ui.roadmap.lit_by', {
              quest: nd.litBy.map((l) => t(questKey(l.quest, 'title'))).join(t('ui.list_sep')),
              state: t(`ui.roadmap.quest.${nd.litBy[0]!.state}`),
            })
          : t('ui.roadmap.no_quest');
    } else if (it?.kind === 'town') {
      const tw = view.towns[it.index]!;
      lines[0] = t(tw.title);
      lines[1] = t('ui.roadmap.progress', { town: t(tw.title), done: tw.done, total: tw.total });
      if (tw.open) lines[2] = t('ui.roadmap.town_open');
      else {
        const gate = store.content.quests.find((q) => q.battle?.trigger.kind === 'gate' && q.battle.trigger.town === tw.id);
        const giver = gate ? findNpc(store.content, gate.quest.giver) : null;
        lines[2] = t('ui.battle.gate_closed', { town: t(tw.title), name: giver ? t(giver.key(giver.spec.name)) : '' });
      }
    }
    lines.forEach((l, i) => this.detail[i]?.setText(ellipsize(l, P.w - 12)));
  }
}
