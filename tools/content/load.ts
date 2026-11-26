// Load, validate and bundle /content. Runs in Node only: at build time (the Vite plugin), in
// `npm test` and in CI. Nothing here ships to the player; the game gets the resulting JSON.
//
// Two layers of checks:
//   1. JSON Schema (ajv) per file type: shape, types, patterns, sizes.
//   2. Semantic checks the schemas cannot express: ids match folders, references resolve,
//      every condition parses and type-checks, every locale key exists in both languages
//      with the same placeholders, sprites are real PNGs of the right size, and the content
//      folder holds data files only.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import Ajv2020Import from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import {
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
import { compile, literalCalls, type Registry } from '../../src/rules/expr';
import { PROGRESS_FACTS, SCENARIO_FACTS } from '../../src/rules/registries';
import { normalize } from '../../src/sim/path';
import { createSession } from '../../src/sim/session';

// ajv is CommonJS; depending on the loader the class is the default export or its .default.
type AjvClass = typeof Ajv2020Import;
const Ajv2020: AjvClass = ((Ajv2020Import as unknown as { default?: AjvClass }).default ?? Ajv2020Import) as AjvClass;

export interface LoadResult {
  bundle: ContentBundle | null;
  errors: string[];
  /** absolute paths of sprite sheets, by quest id, for the bundler to emit as assets */
  sprites: { questId: string; file: string }[];
}

const SCHEMA_FILES = ['common', 'quest', 'scenario', 'npc', 'locale', 'roadmap', 'shop'];
const SCHEMA_BASE = 'https://nines.invalid/schemas/';

/** Words that would point at someone else's IP. Content must never need them. */
const DENYLIST = /pok[eé]\s?mon|pikachu|pok[eé]\s?dex|pok[eé]\s?ball|nintendo|game\s?freak|game\s?boy/i;

const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;
const placeholders = (s: string): string => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');

export function loadContent(contentDir: string, schemaDir: string): LoadResult {
  const errors: string[] = [];
  const sprites: { questId: string; file: string }[] = [];
  const rel = (p: string) => relative(join(contentDir, '..'), p);
  const err = (file: string, msg: string) => errors.push(`${rel(file)}: ${msg}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
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
    /^(quests|npcs)\/[^/]+\/(quest|scenario|npc)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/locales\/(en|nl)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/[a-z0-9-]+\.png$/,
    /^maps\/[a-z0-9-]+\.json$/,
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(contentDir)) {
    const r = relative(contentDir, file).split('\\').join('/');
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
    for (const k of Object.keys(maps.en)) if (!(k in maps.nl)) err(join(dir, 'nl.yaml'), `missing key "${k}"`);
    for (const k of Object.keys(maps.nl)) if (!(k in maps.en)) err(enFile, `missing key "${k}"`);
    for (const k of Object.keys(maps.en)) {
      const nl = maps.nl[k];
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
    if (global && !(key in global.en)) err(file, `unknown locale key "${key}" (content/locales)`);
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
  const checkNpc = (dir: string, npc: NpcSpec, local: LocaleMap | null, questId?: string) => {
    const file = join(dir, 'npc.yaml');
    const keys = [npc.name, ...npc.dialogue.flatMap((d) => d.lines)];
    for (const k of keys) if (local && !(k in local)) err(file, `unknown locale key "${k}"`);
    npc.dialogue.forEach((d, i) => d.when !== undefined && checkExpr(file, `dialogue[${i}].when`, d.when, PROGRESS_FACTS));
    checkMap(file, npc.spawn.map);
    if (DENYLIST.test(npc.author.name)) err(file, 'author name mentions a name we must not use');
    const sprite = checkSprite(dir, npc);
    if (sprite && questId) sprites.push({ questId, file: sprite });
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

  const quests: QuestEntry[] = [];
  const questLocales: Record<LocaleId, LocaleMap> = { en: {}, nl: {} };
  const questsDir = join(contentDir, 'quests');
  const questIds = existsSync(questsDir) ? readdirSync(questsDir).sort() : [];
  for (const id of questIds) {
    const dir = join(questsDir, id);
    const qFile = join(dir, 'quest.yaml');
    const sFile = join(dir, 'scenario.yaml');
    const quest = read<QuestSpec>(qFile, 'quest');
    const scenario = read<ScenarioSpec>(sFile, 'scenario');
    const npc = existsSync(join(dir, 'npc.yaml')) ? read<NpcSpec>(join(dir, 'npc.yaml'), 'npc') : null;
    const loc = readLocales(join(dir, 'locales'));
    if (!quest || !scenario || !loc) continue;

    const used = new Set<string>();
    const need = (file: string, key: string) => {
      used.add(key);
      if (!(key in loc.en)) err(file, `unknown locale key "${key}"`);
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
    for (const src of allExprs) {
      let calls: ReturnType<typeof literalCalls> = [];
      try {
        calls = literalCalls(compile(src, SCENARIO_FACTS).ast);
      } catch {
        continue; // already reported
      }
      for (const c of calls) {
        const arg = String(c.arg);
        if (c.name === 'service' && !services.includes(arg)) err(sFile, `service("${arg}"): no such service in this scenario`);
        if (c.name === 'pods_running' && !deployments.includes(arg)) err(sFile, `pods_running("${arg}"): no such deployment`);
        if (c.name === 'restarted' && !services.includes(arg) && !deployments.includes(arg)) err(sFile, `restarted("${arg}"): no such service or deployment`);
      }
    }
    // the whole thing must start
    try {
      createSession(scenario, { t: (k) => k });
    } catch (e) {
      err(sFile, `cannot start: ${(e as Error).message}`);
    }

    if (npc) {
      if (npc.id !== quest.giver) err(join(dir, 'npc.yaml'), `a quest folder's npc must be its giver ("${quest.giver}")`);
      for (const k of checkNpc(dir, npc, loc.en, id)) used.add(k);
    }

    for (const k of Object.keys(loc.en)) if (!used.has(k)) err(join(dir, 'locales', 'en.yaml'), `unused key "${k}"`);
    for (const l of LOCALES) for (const [k, v] of Object.entries(loc[l])) questLocales[l][questKey(id, k)] = v;
    quests.push({ id, quest, scenario, ...(npc ? { npc } : {}) });
  }

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
