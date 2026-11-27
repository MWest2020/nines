// TypeScript shapes of the content files. They mirror /schemas/*.schema.json; the schemas are
// the source of truth and the validator enforces them before anything reaches these types.

export type LocaleId = 'en' | 'nl';
export const LOCALES: readonly LocaleId[] = ['en', 'nl'];

export type Stage = 'junior' | 'medior' | 'senior';
/** A career path (content/roadmap.yaml paths): swe, sre, devops, platform, systems, ethical. */
export type PathId = string;
export type BranchId =
  | 'linux'
  | 'networking'
  | 'git'
  | 'cicd'
  | 'containers'
  | 'iac'
  | 'observability'
  | 'incident'
  | 'design'
  | 'kubernetes';

/** A size: bytes as a number, or a string such as "4.2G", "120M", "512K". */
export type Size = number | string;

export interface Author {
  name: string;
  handle?: string;
  url?: string;
}

/** DESIGN.md, Karma: legit work, a shady side job, or community service. */
export type QuestKind = 'job' | 'hustle' | 'service';

export interface QuestSpec {
  schema: 1;
  id: string;
  author: Author;
  title: string;
  summary: string;
  stage: Stage;
  branch: BranchId;
  /** the career paths this quest counts towards (DESIGN.md, Career paths) */
  paths: PathId[];
  roadmap_node: string;
  requires: string[];
  /** job (default), hustle (a shady side job with a risk roll) or service (community service) */
  kind?: QuestKind;
  /** a progress condition that must hold before the quest is offered (karma gates) */
  available_when?: string;
  giver: string;
  start: { map: string; object: string };
  reward: { money: number; xp: number; tech_debt?: number; karma?: number };
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
  /** shown by kubectl describe pod */
  image?: string;
  /** the ConfigMap the container reads its environment from (envFrom), for kubectl describe */
  config_map?: string;
}

export interface ScenarioEventSpec {
  id: string;
  when: string;
  say: string;
  money?: number;
  /** a loss costs every time, a gain counts once per quest and event */
  karma?: number;
  reset?: boolean;
  set_flag?: string;
}

/** A hustle's chance of getting caught (DESIGN.md, Side hustles). */
export interface RiskSpec {
  /** percent */
  base: number;
  /** percentage points added while `when` holds */
  factors: { id: string; when: string; add: number; text: string }[];
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
  /** manifests (files above) the cluster already runs at the start; kubectl apply -f adds more */
  cluster?: string[];
  git?: { root: string; branch?: string; pipeline?: { file: string; validator: 'nines-ci' } };
  /** `procedure`: a change ticket or review that an independent contractor may skip */
  objectives: { id: string; text: string; done_when: string; procedure?: boolean }[];
  hints?: { id: string; when: string; text: string }[];
  events?: ScenarioEventSpec[];
  /** only a hustle has one */
  risk?: RiskSpec;
  /** suggested command lines for the terminal's quick-command strip */
  quick?: string[];
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
  /** `map`: the town's map; a map named here that content/maps does not have yet is planned */
  towns: { id: string; stage: Stage; title: string; map?: string }[];
  branches: { id: BranchId; title: string }[];
  /** the six career paths chosen at Medior City: title and a one-line pitch (locale keys) */
  paths: { id: PathId; title: string; pitch: string }[];
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
    /** bought again and again, never owned: its effects apply once per purchase (AI credits) */
    consumable?: boolean;
    effects: { income_per_quest?: number; hint_boost?: number; tokens?: number };
  }[];
}

// ---- battles (schemas/battle.schema.json): an encounter in which someone questions the player

export type BattleKind = 'design' | 'incident' | 'stakeholder';
/** best = full credit, fair = half, weak = none. */
export type Grade = 'best' | 'fair' | 'weak';

export interface BattleOption {
  id: string;
  text: string;
  grade: Grade;
  why: string;
}

interface RoundBase {
  id: string;
  /** what the attacker says before the question: context, then the question */
  prompt: string[];
  /** pressure a perfect answer removes */
  stakes: number;
  /** confidence a fully wrong answer costs (default: stakes) */
  cost?: number;
}

/** Pick the best trade-off, where an option is a choice together with its reason. */
export interface TradeoffRound extends RoundBase {
  type: 'tradeoff';
  options: BattleOption[];
}

/** Spot the flaw in a proposal shown on the whiteboard. */
export interface FlawRound extends RoundBase {
  type: 'flaw';
  proposal: string[];
  options: BattleOption[];
}

/** Choose what to ask first; pick is how many questions the player may ask. */
export interface ClarifyRound extends RoundBase {
  type: 'clarify';
  pick?: number;
  options: BattleOption[];
}

/** Put steps in order. Listed order is correct; equal ranks may come in either order. */
export interface OrderRound extends RoundBase {
  type: 'order';
  items: { id: string; text: string; why: string; rank?: number }[];
}

/** Back-of-envelope: pick the range that holds the estimate. Ranges ascend and touch. */
export interface EstimateRound extends RoundBase {
  type: 'estimate';
  value: number;
  working: string;
  options: (BattleOption & { min: number; max?: number })[];
}

export type BattleRound = TradeoffRound | FlawRound | ClarifyRound | OrderRound | EstimateRound;

export type BattleTrigger =
  | { kind: 'npc' }
  | { kind: 'pager'; when: string; chance: number }
  | { kind: 'gate'; town: string };

export interface BattleSpec {
  schema: 1;
  kind: BattleKind;
  attacker: string;
  intro: string[];
  trigger: BattleTrigger;
  meters?: { confidence?: number; pressure?: number };
  rounds: BattleRound[];
  hints?: { id: string; round?: string; when: string; text: string }[];
  outro: { won: string[]; lost: string[] };
}

export interface QuestEntry {
  id: string;
  quest: QuestSpec;
  /** a terminal quest has a scenario, a battle quest a battle; never both */
  scenario?: ScenarioSpec;
  battle?: BattleSpec;
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
  /** Tiled maps from content/maps (see MapEntry below). */
  maps: MapEntry[];
}

export const questKey = (questId: string, key: string): string => `quest.${questId}.${key}`;
export const npcKey = (npcId: string, key: string): string => `npc.${npcId}.${key}`;

// ---- maps (schemas/map.schema.json): Tiled maps saved as JSON, tilesets embedded

export type TileLayerName = 'ground' | 'detail' | 'props' | 'above' | 'collision';
export type MapObjectType = 'spawn' | 'terminal' | 'battle' | 'door' | 'shop';

export interface TiledProperty {
  name: string;
  type: string;
  value: string | boolean;
}

export interface TiledObject {
  id?: number;
  name: string;
  type: MapObjectType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledTileLayer {
  type: 'tilelayer';
  name: TileLayerName;
  id?: number;
  width: number;
  height: number;
  opacity?: number;
  visible?: boolean;
  x?: number;
  y?: number;
  data: number[];
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  name: 'objects';
  id?: number;
  draworder?: 'topdown' | 'index';
  opacity?: number;
  visible?: boolean;
  x?: number;
  y?: number;
  objects: TiledObject[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  /** relative to the map file in content/maps/ */
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: 16;
  tileheight: 16;
  columns: number;
  tilecount: number;
  margin?: 0;
  spacing?: 0 | 1;
  tiles?: { id: number; properties: TiledProperty[] }[];
}

export interface TiledMap {
  type: 'map';
  version?: string;
  tiledversion?: string;
  orientation: 'orthogonal';
  renderorder?: 'right-down';
  infinite: false;
  compressionlevel?: number;
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  nextlayerid?: number;
  nextobjectid?: number;
  backgroundcolor?: string;
  layers: (TiledTileLayer | TiledObjectLayer)[];
  tilesets: TiledTileset[];
}

export interface MapEntry {
  /** the file name without .json */
  id: string;
  map: TiledMap;
  /** Set by the build: tileset name -> a same-origin URL in dist/. */
  images?: Record<string, string>;
}
