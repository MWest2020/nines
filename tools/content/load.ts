// Load, validate and bundle /content. Runs in Node only: at build time (the Vite plugin), in
// `npm test` and in CI. Nothing here ships to the player; the game gets the resulting JSON.
//
// Two layers of checks:
//   1. JSON Schema (ajv) per file type: shape, types, patterns, sizes.
//   2. Semantic checks the schemas cannot express: ids match folders, references resolve,
//      every condition parses and type-checks, every locale key exists in both languages
//      with the same placeholders, sprites are real PNGs of the right size, and the content
//      folder holds data files only.

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import Ajv2020Import from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import {
  type BattleSpec,
  type ContentBundle,
  type Credit,
  type LocaleId,
  type LocaleMap,
  LOCALES,
  type NpcSpec,
  npcKey,
  type QuestEntry,
  type QuestSpec,
  questKey,
  type RoadmapSpec,
  type ScenarioSpec,
  type ShopSpec,
} from '../../src/content/types';
import { compile, type Node, type Registry } from '../../src/rules/expr';
import { has } from '../../src/rules/own';
import { COMMANDS } from '../../src/sim/shell/commands';
import { BATTLE_FACTS, PROGRESS_FACTS, SCENARIO_FACTS } from '../../src/rules/registries';
import { normalize } from '../../src/sim/path';
import { createSession } from '../../src/sim/session';
import { answerRound, compileBattle, startBattle } from '../../src/battle/engine';
import { perfectAnswer, worstAnswer } from '../../src/battle/score';

// ajv is CommonJS; depending on the loader the class is the default export or its .default.
type AjvClass = typeof Ajv2020Import;
const Ajv2020: AjvClass = ((Ajv2020Import as unknown as { default?: AjvClass }).default ?? Ajv2020Import) as AjvClass;

export interface LoadResult {
  bundle: ContentBundle | null;
  errors: string[];
  /** absolute paths of sprite sheets, for the bundler to emit as assets */
  sprites: SpriteRef[];
}

export interface SpriteRef {
  /** a quest folder's giver, or a world npc */
  owner: 'quest' | 'npc';
  id: string;
  file: string;
}

/** Control characters other than tab, newline and carriage return (ANSI/OSC escapes start here). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** Functions whose first argument names something; it must be a literal so it can be checked. */
const NAME_ARGS = new Set(['service', 'pods_running', 'restarted', 'flag', 'ran', 'quest', 'has_item', 'xp']);

function callsIn(node: Node, out: { name: string; first: Node | undefined }[] = []) {
  switch (node.kind) {
    case 'call':
      out.push({ name: node.name, first: node.args[0] });
      node.args.forEach((a) => callsIn(a, out));
      break;
    case 'not':
      callsIn(node.expr, out);
      break;
    case 'logic':
    case 'cmp':
      callsIn(node.left, out);
      callsIn(node.right, out);
      break;
    default:
      break;
  }
  return out;
}

/** Ids in a cycle of "requires" edges, or [] when there is none. */
function findCycle(edges: Record<string, readonly string[]>): string[] {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] => {
    if (state.get(id) === 'done') return [];
    if (state.get(id) === 'open') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'open');
    stack.push(id);
    for (const next of has(edges, id) ? edges[id]! : []) {
      const c = visit(next);
      if (c.length > 0) return c;
    }
    stack.pop();
    state.set(id, 'done');
    return [];
  };
  for (const id of Object.keys(edges)) {
    const c = visit(id);
    if (c.length > 0) return c;
  }
  return [];
}

const SCHEMA_FILES = ['common', 'quest', 'scenario', 'battle', 'npc', 'locale', 'roadmap', 'shop'];
const SCHEMA_BASE = 'https://nines.invalid/schemas/';

/**
 * Words that would point at someone else's IP. Content must never need them. The second half
 * is the franchise's battle language, in English and Dutch: its "a wild ... appeared!"
 * catchphrase, its effectiveness and fainting lines, its town leaders and its battle menu.
 * Battles say "PAGER: ..." or "Incoming: ..." instead (DESIGN.md, Battles).
 */
export const DENYLIST = new RegExp(
  [
    'pok[eé]\\s?mon', 'pikachu', 'pok[eé]\\s?dex', 'pok[eé]\\s?ball', 'nintendo', 'game\\s?freak', 'game\\s?boy',
    '\\bwild\\b[^.!?\\n]{0,40}\\bappear', '\\bwilde?\\b[^.!?\\n]{0,40}\\bversch(ijnt|een|enen)',
    'super[\\s-]?effecti(ve|ef)', 'not very effective', 'niet erg effectief', '\\bfainted\\b', 'flauwgevallen',
    '\\bgym\\s?leader', '\\belite\\s?four\\b', '\\btrainer\\s+battle', '\\bfight\\b[^\\n]{0,40}\\bbag\\b[^\\n]{0,40}\\brun\\b',
  ].join('|'),
  'i',
);

const dirnameOf = (p: string): string => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));

const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;
const placeholders = (s: string): string => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');

export function loadContent(contentDir: string, schemaDir: string): LoadResult {
  const errors: string[] = [];
  const sprites: SpriteRef[] = [];
  const rel = (p: string) => relative(join(contentDir, '..'), p);
  const err = (file: string, msg: string) => errors.push(`${rel(file)}: ${msg}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
  for (const name of SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8')) as object);
  }

  function read<T>(file: string, schema: string): T | null {
    if (!existsSync(file)) {
      err(file, 'missing');
      return null;
    }
    let data: unknown;
    try {
      data = parseYaml(readFileSync(file, 'utf8'), { uniqueKeys: true, prettyErrors: true });
    } catch (e) {
      err(file, `YAML: ${(e as Error).message.split('\n')[0]}`);
      return null;
    }
    const raw = readFileSync(file, 'utf8');
    if (DENYLIST.test(raw)) err(file, 'mentions a name we must not use (IP rule, AGENTS.md)');
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (strings.push(k), collect(x));
    };
    collect(data);
    if (strings.some((x) => CONTROL.test(x))) err(file, 'contains control characters (escape sequences are not allowed in content)');
    const validate = ajv.getSchema(`${SCHEMA_BASE}${schema}.schema.json`)!;
    if (!validate(data)) {
      for (const e of validate.errors ?? []) err(file, `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
      return null;
    }
    return data as T;
  }

  // ---- the content folder holds data only
  const allowed = [
    /^locales\/(en|nl)\.yaml$/,
    /^(roadmap|shop)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/(quest|scenario|battle|npc)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/locales\/(en|nl)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/[a-z0-9-]+\.png$/,
    // maps/<id>.json (Tiled) is allowed once the MVP build adds its schema and checks.
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        err(p, 'symbolic links are not allowed in content');
        return [];
      }
      return st.isDirectory() ? walk(p) : [p];
    });
  const contentFiles = walk(contentDir);
  for (const file of contentFiles) {
    const r = relative(contentDir, file).split('\\').join('/');
    if (DENYLIST.test(r)) err(file, 'the path mentions a name we must not use (IP rule, AGENTS.md)');
    if (!allowed.some((re) => re.test(r))) err(file, 'unexpected file: content holds YAML, PNG sprites and Tiled JSON maps only');
  }

  // ---- locales
  function readLocales(dir: string): Record<LocaleId, LocaleMap> | null {
    const maps = {} as Record<LocaleId, LocaleMap>;
    for (const l of LOCALES) {
      const m = read<LocaleMap>(join(dir, `${l}.yaml`), 'locale');
      if (!m) return null;
      maps[l] = m;
    }
    const enFile = join(dir, 'en.yaml');
    for (const k of Object.keys(maps.en)) if (!has(maps.nl, k)) err(join(dir, 'nl.yaml'), `missing key "${k}"`);
    for (const k of Object.keys(maps.nl)) if (!has(maps.en, k)) err(enFile, `missing key "${k}"`);
    for (const k of Object.keys(maps.en)) {
      const nl = has(maps.nl, k) ? maps.nl[k] : undefined;
      if (nl !== undefined && placeholders(maps.en[k]!) !== placeholders(nl)) {
        err(join(dir, 'nl.yaml'), `"${k}" has placeholders {${placeholders(nl)}}, en has {${placeholders(maps.en[k]!)}}`);
      }
    }
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(maps[l])) {
        if (DENYLIST.test(v)) err(join(dir, `${l}.yaml`), `"${k}" mentions a name we must not use (IP rule, AGENTS.md)`);
      }
    }
    return maps;
  }

  const global = readLocales(join(contentDir, 'locales'));
  const roadmap = read<RoadmapSpec>(join(contentDir, 'roadmap.yaml'), 'roadmap');
  const shop = read<ShopSpec>(join(contentDir, 'shop.yaml'), 'shop');

  const needGlobal = (file: string, key: string) => {
    if (global && !has(global.en, key)) err(file, `unknown locale key "${key}" (content/locales)`);
  };
  if (roadmap) {
    const f = join(contentDir, 'roadmap.yaml');
    const ids = new Set<string>();
    for (const x of [...roadmap.towns, ...roadmap.branches, ...roadmap.nodes]) needGlobal(f, x.title);
    for (const n of roadmap.nodes) {
      if (ids.has(n.id)) err(f, `duplicate node "${n.id}"`);
      ids.add(n.id);
    }
    for (const n of roadmap.nodes) for (const r of n.requires) if (!ids.has(r)) err(f, `node "${n.id}" requires unknown node "${r}"`);
  }
  if (shop) {
    const f = join(contentDir, 'shop.yaml');
    const ids = new Set(shop.items.map((i) => i.id));
    if (ids.size !== shop.items.length) err(f, 'duplicate item ids');
    for (const i of shop.items) {
      needGlobal(f, i.title);
      needGlobal(f, i.description);
      for (const r of i.requires) if (!ids.has(r)) err(f, `item "${i.id}" requires unknown item "${r}"`);
    }
  }

  // ---- conditions
  const checkExpr = (file: string, where: string, src: string, reg: Registry): void => {
    try {
      compile(src, reg);
    } catch (e) {
      err(file, `${where}: ${(e as Error).message} in: ${src}`);
    }
  };

  // Name-like arguments must be literals, and the names must exist.
  const checkNames = (file: string, src: string, reg: Registry, known: (name: string, arg: string) => string | null): void => {
    let ast: Node;
    try {
      ast = compile(src, reg).ast;
    } catch {
      return; // already reported
    }
    for (const c of callsIn(ast)) {
      if (!NAME_ARGS.has(c.name)) continue;
      if (c.first?.kind !== 'lit') {
        err(file, `${c.name}() needs a quoted name, not an expression, in: ${src}`);
        continue;
      }
      const problem = known(c.name, String(c.first.value));
      if (problem) err(file, `${c.name}("${String(c.first.value)}"): ${problem}`);
    }
  };

  // ---- sprites
  const checkSprite = (dir: string, npc: NpcSpec): string | null => {
    if (!npc.sprite) return null;
    const file = join(dir, npc.sprite.file);
    if (!existsSync(file)) {
      err(join(dir, 'npc.yaml'), `sprite ${npc.sprite.file} not found`);
      return null;
    }
    const b = readFileSync(file);
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length < 24 || !sig.every((x, i) => b[i] === x)) {
      err(file, 'not a PNG');
      return null;
    }
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const f = npc.sprite.frame;
    if (w !== 3 * f || h !== 4 * f) err(file, `sheet is ${w}x${h}; with ${f}px frames it must be ${3 * f}x${4 * f} (3 columns x 4 rows)`);
    return file;
  };

  const maps = existsSync(join(contentDir, 'maps'))
    ? new Set(readdirSync(join(contentDir, 'maps')).map((n) => n.replace(/\.json$/, '')))
    : null;
  const checkMap = (file: string, map: string) => {
    if (maps && !maps.has(map)) err(file, `unknown map "${map}"`);
  };

  // ---- npcs and quests
  const npcs: { npc: NpcSpec; dir: string; questId?: string }[] = [];
  const progressExprs: { file: string; src: string }[] = [];
  const progressFlags = new Set<string>();
  const checkNpc = (dir: string, npc: NpcSpec, local: LocaleMap | null, questId?: string) => {
    const file = join(dir, 'npc.yaml');
    const keys = [npc.name, ...npc.dialogue.flatMap((d) => d.lines)];
    for (const k of keys) if (local && !has(local, k)) err(file, `unknown locale key "${k}"`);
    npc.dialogue.forEach((d, i) => {
      if (d.when === undefined) return;
      checkExpr(file, `dialogue[${i}].when`, d.when, PROGRESS_FACTS);
      progressExprs.push({ file, src: d.when });
    });
    checkMap(file, npc.spawn.map);
    if (DENYLIST.test(npc.author.name)) err(file, 'author name mentions a name we must not use');
    const sprite = checkSprite(dir, npc);
    if (sprite) sprites.push(questId ? { owner: 'quest', id: questId, file: sprite } : { owner: 'npc', id: npc.id, file: sprite });
    npcs.push({ npc, dir, ...(questId ? { questId } : {}) });
    return keys;
  };

  const worldNpcs: NpcSpec[] = [];
  const npcLocales: Record<LocaleId, LocaleMap> = { en: {}, nl: {} };
  const npcsDir = join(contentDir, 'npcs');
  if (existsSync(npcsDir)) {
    for (const id of readdirSync(npcsDir).sort()) {
      const dir = join(npcsDir, id);
      const npc = read<NpcSpec>(join(dir, 'npc.yaml'), 'npc');
      const loc = readLocales(join(dir, 'locales'));
      if (!npc) continue;
      if (npc.id !== id) err(join(dir, 'npc.yaml'), `id "${npc.id}" must equal the folder name "${id}"`);
      const used = checkNpc(dir, npc, loc?.en ?? null);
      if (loc) {
        for (const k of Object.keys(loc.en)) if (!used.includes(k)) err(join(dir, 'locales', 'en.yaml'), `unused key "${k}"`);
        for (const l of LOCALES) for (const [k, v] of Object.entries(loc[l])) npcLocales[l][npcKey(id, k)] = v;
      }
      worldNpcs.push(npc);
    }
  }

  // ---- battles: shape, references, and that the battle can be won and lost
  const STAGES = ['junior', 'medior', 'senior'];
  const gates = new Map<string, string>();
  const checkBattle = (file: string, id: string, quest: QuestSpec, b: BattleSpec, need: (file: string, key: string) => void): void => {
    [b.attacker, ...b.intro, ...b.outro.won, ...b.outro.lost].forEach((k) => need(file, k));
    const roundIds = b.rounds.map((r) => r.id);
    if (new Set(roundIds).size !== roundIds.length) err(file, 'round ids must be unique');
    for (const r of b.rounds) {
      const at = `round "${r.id}"`;
      r.prompt.forEach((k) => need(file, k));
      if (r.type === 'order') {
        const ids = r.items.map((i) => i.id);
        if (new Set(ids).size !== ids.length) err(file, `${at}: item ids must be unique`);
        r.items.forEach((i) => (need(file, i.text), need(file, i.why)));
        const ranks = r.items.map((i, n) => i.rank ?? n + 1);
        if (ranks.some((x, n) => n > 0 && x < ranks[n - 1]!)) err(file, `${at}: list the items in the right order (ranks must not go down)`);
        if (new Set(ranks).size === 1) err(file, `${at}: all items have the same rank, so there is nothing to order`);
        continue;
      }
      const ids = r.options.map((o) => o.id);
      if (new Set(ids).size !== ids.length) err(file, `${at}: option ids must be unique`);
      r.options.forEach((o) => (need(file, o.text), need(file, o.why)));
      const bests = r.options.filter((o) => o.grade === 'best').length;
      if (bests === 0) err(file, `${at}: needs an option graded best`);
      if (r.type === 'flaw') r.proposal.forEach((k) => need(file, k));
      if (r.type === 'clarify' && (r.pick ?? 1) >= r.options.length) err(file, `${at}: pick must be smaller than the number of options`);
      if (r.type === 'estimate') {
        need(file, r.working);
        if (bests !== 1) err(file, `${at}: exactly one range is graded best`);
        r.options.forEach((o, n) => {
          const last = n === r.options.length - 1;
          if (o.max === undefined && !last) err(file, `${at}: only the last range may leave out max`);
          if (o.max !== undefined && o.max <= o.min) err(file, `${at}: range "${o.id}" must have max above min`);
          const next = r.options[n + 1];
          if (next && o.max !== next.min) err(file, `${at}: range "${o.id}" must end where "${next.id}" starts (ranges ascend and touch)`);
        });
        const best = r.options.find((o) => o.grade === 'best');
        if (best && (r.value < best.min || (best.max !== undefined && r.value >= best.max))) err(file, `${at}: value ${r.value} is not in the range graded best`);
      }
    }
    const hintIds = (b.hints ?? []).map((h) => h.id);
    if (new Set(hintIds).size !== hintIds.length) err(file, 'hint ids must be unique');
    (b.hints ?? []).forEach((h, i) => {
      need(file, h.text);
      if (h.round !== undefined && !roundIds.includes(h.round)) err(file, `hints[${i}]: no round "${h.round}"`);
      checkExpr(file, `hints[${i}].when`, h.when, BATTLE_FACTS);
    });
    const t = b.trigger;
    if (t.kind === 'pager') {
      checkExpr(file, 'trigger.when', t.when, PROGRESS_FACTS);
      progressExprs.push({ file, src: t.when });
    }
    if (t.kind === 'gate' && roadmap) {
      const town = roadmap.towns.find((x) => x.id === t.town);
      if (!town) err(file, `trigger: unknown town "${t.town}"`);
      else if (STAGES.indexOf(town.stage) !== STAGES.indexOf(quest.stage) + 1) err(file, `trigger: the gate to ${town.id} (${town.stage}) must be a quest of the stage before it, not ${quest.stage}`);
      if (gates.has(t.town)) err(file, `trigger: ${gates.get(t.town)} already guards the road to ${t.town}`);
      gates.set(t.town, id);
    }
    // Play it both ways: a perfect play must win, the worst play must lose.
    try {
      const c = compileBattle(id, b);
      for (const [how, pick, want] of [['a perfect play', perfectAnswer, 'won'], ['the worst play', worstAnswer, 'lost']] as const) {
        let st = startBattle(c);
        for (let n = 0; n < b.rounds.length && st.status === 'active'; n++) st = answerRound(c, st, pick(b.rounds[st.round]!)).state;
        if (st.status !== want) err(file, `${how} ends ${st.status}; raise or lower the rounds' stakes (pressure ${c.max.pressure}, stakes add up to ${b.rounds.reduce((x, r) => x + r.stakes, 0)})`);
      }
    } catch (e) {
      err(file, `cannot start: ${(e as Error).message}`);
    }
  };

  const quests: QuestEntry[] = [];
  const questLocales: Record<LocaleId, LocaleMap> = { en: {}, nl: {} };
  const questsDir = join(contentDir, 'quests');
  const questIds = existsSync(questsDir) ? readdirSync(questsDir).sort() : [];
  for (const id of questIds) {
    const dir = join(questsDir, id);
    const qFile = join(dir, 'quest.yaml');
    const sFile = join(dir, 'scenario.yaml');
    const bFile = join(dir, 'battle.yaml');
    const quest = read<QuestSpec>(qFile, 'quest');
    const hasScenario = existsSync(sFile);
    const hasBattle = existsSync(bFile);
    if (hasScenario && hasBattle) err(bFile, 'a quest folder has scenario.yaml (a terminal quest) or battle.yaml (a battle), not both');
    const scenario = hasScenario || !hasBattle ? read<ScenarioSpec>(sFile, 'scenario') : null;
    const battle = hasBattle && !hasScenario ? read<BattleSpec>(bFile, 'battle') : null;
    const npc = existsSync(join(dir, 'npc.yaml')) ? read<NpcSpec>(join(dir, 'npc.yaml'), 'npc') : null;
    const loc = readLocales(join(dir, 'locales'));
    if (!quest || !loc || (!scenario && !battle)) continue;

    const used = new Set<string>();
    const need = (file: string, key: string) => {
      used.add(key);
      if (!has(loc.en, key)) err(file, `unknown locale key "${key}"`);
    };

    if (quest.id !== id) err(qFile, `id "${quest.id}" must equal the folder name "${id}"`);
    if (DENYLIST.test(quest.author.name)) err(qFile, 'author name mentions a name we must not use');
    [quest.title, quest.summary, ...quest.dialogue.offer, ...quest.dialogue.active, ...quest.dialogue.done].forEach((k) => need(qFile, k));
    for (const r of quest.requires) {
      if (r === id) err(qFile, 'a quest cannot require itself');
      else if (!questIds.includes(r)) err(qFile, `requires unknown quest "${r}"`);
    }
    const node = roadmap?.nodes.find((n) => n.id === quest.roadmap_node);
    if (roadmap && !node) err(qFile, `unknown roadmap_node "${quest.roadmap_node}"`);
    if (node && node.branch !== quest.branch) err(qFile, `roadmap_node "${node.id}" is on branch ${node.branch}, the quest on ${quest.branch}`);
    checkMap(qFile, quest.start.map);

    if (scenario) {
      // scenario: paths, references, conditions
      const paths = [scenario.home, scenario.cwd, ...(scenario.dirs ?? []), ...Object.keys(scenario.files ?? {}), ...scenario.mounts.map((m) => m.path)];
      for (const p of paths) if (p !== undefined && normalize(p) !== p) err(sFile, `path "${p}" is not normalised (no trailing /, . or ..)`);
      if (!scenario.mounts.some((m) => m.path === '/')) err(sFile, 'a mount for "/" is required');
      if (new Set(scenario.mounts.map((m) => m.path)).size !== scenario.mounts.length) err(sFile, 'mount paths must be unique');
      need(sFile, scenario.motd);
      scenario.objectives.forEach((o, i) => {
        need(sFile, o.text);
        checkExpr(sFile, `objectives[${i}].done_when`, o.done_when, SCENARIO_FACTS);
      });
      (scenario.hints ?? []).forEach((h, i) => {
        need(sFile, h.text);
        checkExpr(sFile, `hints[${i}].when`, h.when, SCENARIO_FACTS);
      });
      (scenario.events ?? []).forEach((e, i) => {
        need(sFile, e.say);
        checkExpr(sFile, `events[${i}].when`, e.when, SCENARIO_FACTS);
      });
      if (scenario.outage?.say) need(sFile, scenario.outage.say);
      for (const [name, s] of Object.entries(scenario.services ?? {})) {
        if (s.restart?.succeeds_if) checkExpr(sFile, `services.${name}.restart.succeeds_if`, s.restart.succeeds_if, SCENARIO_FACTS);
      }
      for (const [name, d] of Object.entries(scenario.deployments ?? {})) {
        if (d.restart?.succeeds_if) checkExpr(sFile, `deployments.${name}.restart.succeeds_if`, d.restart.succeeds_if, SCENARIO_FACTS);
      }
      const ids = [...scenario.objectives, ...(scenario.hints ?? []), ...(scenario.events ?? [])].map((x) => x.id);
      if (new Set(ids).size !== ids.length) err(sFile, 'objective, hint and event ids must be unique');
      if (scenario.git?.pipeline) {
        const pf = normalize(`${scenario.git.root}/${scenario.git.pipeline.file}`);
        const f = scenario.files?.[pf];
        if (f === undefined || (typeof f !== 'string' && f.content === undefined)) err(sFile, `pipeline file ${pf} must be listed under files with content`);
      }
      // names used in conditions must exist in this scenario
      const allExprs = [
        ...scenario.objectives.map((o) => o.done_when),
        ...(scenario.hints ?? []).map((h) => h.when),
        ...(scenario.events ?? []).map((e) => e.when),
        ...Object.values(scenario.services ?? {}).flatMap((s) => (s.restart?.succeeds_if ? [s.restart.succeeds_if] : [])),
        ...Object.values(scenario.deployments ?? {}).flatMap((d) => (d.restart?.succeeds_if ? [d.restart.succeeds_if] : [])),
      ];
      const services = Object.keys(scenario.services ?? {});
      const deployments = Object.keys(scenario.deployments ?? {});
      const flags = (scenario.events ?? []).flatMap((e) => (e.set_flag ? [e.set_flag] : []));
      flags.forEach((f) => progressFlags.add(f));
      for (const src of allExprs) {
        checkNames(sFile, src, SCENARIO_FACTS, (name, arg) => {
          if (name === 'service' && !services.includes(arg)) return `no such service in this scenario`;
          if (name === 'pods_running' && !deployments.includes(arg)) return `no such deployment in this scenario`;
          if (name === 'restarted' && !services.includes(arg) && !deployments.includes(arg)) return `no such service or deployment`;
          if (name === 'flag' && !flags.includes(arg)) return `no event in this scenario sets that flag`;
          if (name === 'ran' && !has(COMMANDS, arg.split(' ')[0] ?? '')) return `not a command of this terminal`;
          return null;
        });
      }
      // the machine must make sense: nothing below a file, home and cwd are directories
      const filePaths = new Set(Object.keys(scenario.files ?? {}));
      for (const p of [...filePaths, ...(scenario.dirs ?? []), ...scenario.mounts.map((m) => m.path), ...(scenario.git ? [scenario.git.root] : []), scenario.home, scenario.cwd ?? scenario.home]) {
        for (let a = dirnameOf(p); a !== '/'; a = dirnameOf(a)) {
          if (filePaths.has(a)) err(sFile, `"${p}" lies below the file "${a}"`);
        }
      }
      for (const p of [scenario.home, scenario.cwd]) if (p !== undefined && filePaths.has(p)) err(sFile, `"${p}" must be a directory, it is a file`);
      // the whole thing must start
      try {
        createSession(scenario, { t: (k) => k });
      } catch (e) {
        err(sFile, `cannot start: ${(e as Error).message}`);
      }
    }
    if (battle) checkBattle(bFile, id, quest, battle, need);

    if (npc) {
      if (npc.id !== quest.giver) err(join(dir, 'npc.yaml'), `a quest folder's npc must be its giver ("${quest.giver}")`);
      for (const k of checkNpc(dir, npc, loc.en, id)) used.add(k);
    }

    for (const k of Object.keys(loc.en)) if (!used.has(k)) err(join(dir, 'locales', 'en.yaml'), `unused key "${k}"`);
    for (const l of LOCALES) for (const [k, v] of Object.entries(loc[l])) questLocales[l][questKey(id, k)] = v;
    quests.push({ id, quest, ...(scenario ? { scenario } : {}), ...(battle ? { battle } : {}), ...(npc ? { npc } : {}) });
  }

  // ---- every PNG is a sprite some npc.yaml declares (with its source and licence)
  const declared = new Set(sprites.map((x) => x.file));
  for (const file of contentFiles) {
    if (file.endsWith('.png') && !declared.has(file)) err(file, 'no npc.yaml declares this image (sprite: file, source, license)');
  }

  // ---- progress conditions name real quests, items, branches and flags
  const shopIds = shop?.items.map((i) => i.id) ?? [];
  const branchIds = roadmap?.branches.map((b) => b.id as string) ?? [];
  for (const { file, src } of progressExprs) {
    checkNames(file, src, PROGRESS_FACTS, (name, arg) => {
      if (name === 'quest' && !questIds.includes(arg)) return 'no such quest';
      if (name === 'has_item' && !shopIds.includes(arg)) return 'no such shop item';
      if (name === 'xp' && !branchIds.includes(arg)) return 'no such branch';
      if (name === 'flag' && !progressFlags.has(arg)) return 'no event sets that flag';
      return null;
    });
  }

  // ---- no "requires" cycles: a cycle would lock its members forever
  const cycleCheck = (what: string, edges: Record<string, readonly string[]>) => {
    const c = findCycle(edges);
    if (c.length > 0) errors.push(`content: ${what} requirements form a cycle: ${c.join(' -> ')}`);
  };
  cycleCheck('quest', Object.fromEntries(quests.map((q) => [q.id, q.quest.requires])));
  if (roadmap) cycleCheck('roadmap node', Object.fromEntries(roadmap.nodes.map((n) => [n.id, n.requires])));
  if (shop) cycleCheck('shop item', Object.fromEntries(shop.items.map((i) => [i.id, i.requires])));

  // ---- cross-folder checks
  const npcIds = npcs.map((n) => n.npc.id);
  for (const id of new Set(npcIds)) if (npcIds.filter((x) => x === id).length > 1) errors.push(`content: npc id "${id}" is used twice`);
  const slots = npcs.map((n) => `${n.npc.spawn.map}/${n.npc.spawn.slot}`);
  for (const s of new Set(slots)) if (slots.filter((x) => x === s).length > 1) errors.push(`content: spawn slot ${s} is taken twice`);
  for (const q of quests) {
    if (!npcIds.includes(q.quest.giver)) errors.push(`content/quests/${q.id}/quest.yaml: giver "${q.quest.giver}" is not an npc`);
  }

  if (errors.length > 0 || !global || !roadmap || !shop) return { bundle: null, errors, sprites };

  // ---- credits, from author fields
  const credits = new Map<string, Credit>();
  const credit = (a: { name: string; handle?: string; url?: string }, what: string) => {
    const c = credits.get(a.name) ?? { name: a.name, ...(a.handle ? { handle: a.handle } : {}), ...(a.url ? { url: a.url } : {}), for: [] };
    c.for.push(what);
    credits.set(a.name, c);
  };
  for (const q of quests) credit(q.quest.author, `quest:${q.id}`);
  for (const n of npcs) credit(n.npc.author, `npc:${n.npc.id}`);

  const merged = {} as Record<LocaleId, LocaleMap>;
  for (const l of LOCALES) merged[l] = { ...global[l], ...npcLocales[l], ...questLocales[l] };

  return {
    bundle: { locales: merged, quests, npcs: worldNpcs, roadmap, shop, credits: [...credits.values()] },
    errors,
    sprites,
  };
}
