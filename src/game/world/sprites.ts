// Texture keys, walk animations and the tinted placeholder NPC. All images are same-origin files
// in dist/ (imported with ?url, or set on the content bundle by the build).

import Phaser from 'phaser';
import type { ContentBundle, NpcSpec, QuestEntry } from '../../content/types';
import { npcKey, questKey } from '../../content/types';
import { FACINGS, type Facing } from '../../world/grid';
import playerUrl from '../../../assets/sprites/player.png?url';
import placeholderUrl from '../../../assets/sprites/npc-placeholder.png?url';

export const PLAYER_KEY = 'sprite:player';
const PLACEHOLDER_KEY = 'sprite:placeholder';

/** Every NPC in the content, with where its strings and sheet come from. */
export interface NpcEntry {
  npc: NpcSpec;
  /** `quest.<id>.` or `npc.<id>.` */
  keyPrefix: string;
  spriteUrl?: string;
  textureKey: string;
  frame: number;
}

export function allNpcs(content: ContentBundle): NpcEntry[] {
  const entry = (npc: NpcSpec, keyPrefix: string, spriteUrl: string | undefined): NpcEntry => ({
    npc,
    keyPrefix,
    ...(spriteUrl ? { spriteUrl } : {}),
    textureKey: `sprite:npc:${npc.id}`,
    frame: spriteUrl && npc.sprite ? npc.sprite.frame : 16,
  });
  return [
    ...content.npcs.map((n) => entry(n, npcKey(n.id, ''), n.spriteUrl)),
    ...content.quests.flatMap((q: QuestEntry) => (q.npc ? [entry(q.npc, questKey(q.id, ''), q.spriteUrl)] : [])),
  ];
}

export const tilesetKey = (url: string): string => `tiles:${url}`;

export function preloadSprites(scene: Phaser.Scene, content: ContentBundle): void {
  scene.load.spritesheet(PLAYER_KEY, playerUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.image(PLACEHOLDER_KEY, placeholderUrl);
  for (const n of allNpcs(content)) {
    if (n.spriteUrl) scene.load.spritesheet(n.textureKey, n.spriteUrl, { frameWidth: n.frame, frameHeight: n.frame });
  }
  for (const m of content.maps) {
    for (const url of Object.values(m.images ?? {})) {
      if (!scene.textures.exists(tilesetKey(url))) scene.load.image(tilesetKey(url), url);
    }
  }
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// The placeholder's clothes: mist becomes the tint, grey a darker shade of it.
const MIST = hexToRgb('#b0b8b8');
const GREY = hexToRgb('#788890');

/** A copy of the placeholder sheet with its clothes in `tint`, as a 3 x 4 sheet of 16 px frames. */
function tintedPlaceholder(scene: Phaser.Scene, key: string, tint: string): void {
  const src = scene.textures.get(PLACEHOLDER_KEY).getSourceImage() as HTMLImageElement;
  const tex = scene.textures.createCanvas(key, src.width, src.height);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const [r, g, b] = hexToRgb(tint);
  const shade = (v: number) => Math.floor((v * 0.65) / 8) * 8;
  for (let i = 0; i < img.data.length; i += 4) {
    const px = [img.data[i], img.data[i + 1], img.data[i + 2]];
    const is = (c: [number, number, number]) => px[0] === c[0] && px[1] === c[1] && px[2] === c[2];
    if (is(MIST)) img.data.set([r, g, b], i);
    else if (is(GREY)) img.data.set([shade(r), shade(g), shade(b)], i);
  }
  ctx.putImageData(img, 0, 0);
  for (let f = 0; f < 12; f++) tex.add(f, 0, (f % 3) * 16, Math.floor(f / 3) * 16, 16, 16);
  tex.refresh();
}

/** After loading: placeholder sheets for NPCs without one, and the walk animations. */
export function createSprites(scene: Phaser.Scene, content: ContentBundle): void {
  const keys = [PLAYER_KEY];
  for (const n of allNpcs(content)) {
    if (!n.spriteUrl && !scene.textures.exists(n.textureKey)) tintedPlaceholder(scene, n.textureKey, n.npc.tint ?? '#b0b8b8');
    keys.push(n.textureKey);
  }
  for (const key of keys) {
    FACINGS.forEach((facing, row) => {
      const f = (c: number) => ({ key, frame: row * 3 + c });
      if (!scene.anims.exists(walkAnim(key, facing))) {
        // DESIGN.md: step, stand, step, stand at 8 fps
        scene.anims.create({ key: walkAnim(key, facing), frames: [f(0), f(1), f(2), f(1)], frameRate: 8, repeat: -1 });
      }
    });
  }
}

export const walkAnim = (key: string, facing: Facing): string => `${key}:walk-${facing}`;

/** The standing frame for a facing (middle column of its row). */
export const standFrame = (facing: Facing): number => FACINGS.indexOf(facing) * 3 + 1;
