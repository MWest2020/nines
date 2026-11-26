// TypeScript shapes of the content files. They mirror /schemas/*.schema.json; the schemas are
// the source of truth and the validator enforces them before anything reaches these types.

export type LocaleId = 'en' | 'nl';
export const LOCALES: readonly LocaleId[] = ['en', 'nl'];

export type Stage = 'junior' | 'medior' | 'senior';
export type Track = 'any' | 'sre' | 'platform';
export type BranchId =
  | 'linux'
  | 'networking'
  | 'git'
  | 'cicd'
  | 'containers'
  | 'iac'
  | 'observability'
  | 'incident';

/** A size: bytes as a number, or a string such as "4.2G", "120M", "512K". */
export type Size = number | string;

export interface Author {
  name: string;
  handle?: string;
  url?: string;
}

export interface QuestSpec {
  schema: 1;
  id: string;
  author: Author;
  title: string;
  summary: string;
  stage: Stage;
  branch: BranchId;
  track: Track;
  roadmap_node: string;
  requires: string[];
  giver: string;
  start: { map: string; object: string };
  reward: { money: number; xp: number; tech_debt?: number };
  dialogue: { offer: string[]; active: string[]; done: string[] };
}

export type FileSpec = string | { size?: Size; content?: string };

export interface RestartRule {
  succeeds_if?: string;
  logs_on_success?: string[];
  logs_on_failure?: string[];
}

export interface ServiceSpec {
  description: string;
  state: 'active' | 'inactive' | 'failed';
  enabled?: boolean;
  logs?: string[];
  restart?: RestartRule;
}

export type PodStatus = 'Running' | 'Pending' | 'CrashLoopBackOff' | 'Error' | 'ImagePullBackOff';

export interface DeploymentSpec {
  namespace?: string;
  replicas?: number;
  status: PodStatus;
  restarts?: number;
  logs?: string[];
  restart?: RestartRule & { status_on_failure?: PodStatus };
}

export interface ScenarioEventSpec {
  id: string;
  when: string;
  say: string;
  money?: number;
  reset?: boolean;
  set_flag?: string;
}

export interface ScenarioSpec {
  schema: 1;
  host: string;
  user: string;
  home: string;
  cwd?: string;
  motd: string;
  mounts: { path: string; device: string; size: Size; base_used?: Size }[];
  dirs?: string[];
  files?: Record<string, FileSpec>;
  services?: Record<string, ServiceSpec>;
  deployments?: Record<string, DeploymentSpec>;
  git?: { root: string; branch?: string; pipeline?: { file: string; validator: 'nines-ci' } };
  objectives: { id: string; text: string; done_when: string }[];
  hints?: { id: string; when: string; text: string }[];
  events?: ScenarioEventSpec[];
  outage?: { say?: string; money?: number };
}

export interface NpcSpec {
  schema: 1;
  id: string;
  author: Author;
  name: string;
  sprite?: { file: string; frame: 16 | 32; source: string; license: 'CC0-1.0' };
  tint?: string;
  spawn: { map: string; slot: string; facing?: 'up' | 'down' | 'left' | 'right' };
  dialogue: { when?: string; lines: string[] }[];
  /** Set by the build for a world npc with a sheet: a same-origin URL in dist/. */
  spriteUrl?: string;
}

export type LocaleMap = Record<string, string>;

export interface RoadmapSpec {
  schema: 1;
  towns: { id: string; stage: Stage; title: string }[];
  branches: { id: BranchId; title: string }[];
  nodes: { id: string; branch: BranchId; stage: Stage; title: string; requires: string[] }[];
}

export interface ShopSpec {
  schema: 1;
  items: {
    id: string;
    title: string;
    description: string;
    price: number;
    requires: string[];
    effects: { income_per_quest?: number; hint_boost?: number };
  }[];
}

export interface QuestEntry {
  id: string;
  quest: QuestSpec;
  scenario: ScenarioSpec;
  npc?: NpcSpec;
  /** Set by the build for a quest that ships its own sprite: a same-origin URL in dist/. */
  spriteUrl?: string;
}

export interface Credit {
  name: string;
  handle?: string;
  url?: string;
  for: string[];
}

/** Everything the game needs, bundled as JSON at build time (virtual:nines-content). */
export interface ContentBundle {
  /** Merged strings: global keys as written, quest keys as quest.<id>.<key>, npc keys as npc.<id>.<key>. */
  locales: Record<LocaleId, LocaleMap>;
  quests: QuestEntry[];
  npcs: NpcSpec[];
  roadmap: RoadmapSpec;
  shop: ShopSpec;
  credits: Credit[];
}

export const questKey = (questId: string, key: string): string => `quest.${questId}.${key}`;
export const npcKey = (npcId: string, key: string): string => `npc.${npcId}.${key}`;
