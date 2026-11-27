// What content may ask about. Each table is a list of signatures only; the implementations
// live next to the state they read (src/sim/facts.ts, src/core/progress.ts). The content
// validator type-checks every expression against these tables at build time.
//
// Adding a fact = one line here + its implementation + a test. Nothing else.

import type { Registry } from './expr';

export const SERVICE_STATES = ['active', 'inactive', 'failed'] as const;
export const PIPELINE_STATUSES = ['none', 'passed', 'failed'] as const;
export const QUEST_STATES = ['locked', 'available', 'active', 'done'] as const;

/** Facts about the simulated machine inside a terminal scenario. */
export const SCENARIO_FACTS: Registry = {
  vars: {
    pipeline_valid: { args: [], returns: 'boolean' },
    pipeline_status: { args: [], returns: 'string', values: PIPELINE_STATUSES },
    git_clean: { args: [], returns: 'boolean' },
    commits: { args: [], returns: 'number' },
    fails: { args: [], returns: 'number' },
    commands: { args: [], returns: 'number' },
  },
  funcs: {
    disk_usage: { args: ['string'], returns: 'number', pathArgs: [0] },
    size: { args: ['string'], returns: 'number', pathArgs: [0] },
    exists: { args: ['string'], returns: 'boolean', pathArgs: [0] },
    removed: { args: ['string'], returns: 'boolean', pathArgs: [0] },
    file_contains: { args: ['string', 'string'], returns: 'boolean', pathArgs: [0] },
    /** the cluster's copy of an object ("configmap/shop/shop-api-config") contains the text */
    applied_contains: { args: ['string', 'string'], returns: 'boolean' },
    /** the value of a `key: value` line in the cluster's copy of an object, or "" */
    applied_value: { args: ['string', 'string'], returns: 'string' },
    service: { args: ['string'], returns: 'string', values: SERVICE_STATES },
    restarted: { args: ['string'], returns: 'boolean' },
    pods_running: { args: ['string'], returns: 'boolean' },
    ran: { args: ['string'], returns: 'boolean' },
    flag: { args: ['string'], returns: 'boolean' },
    /** a command named this path, or something inside it, as an operand (cd, cat, ls, edit...),
     *  or swept over it recursively (grep -r, du, rm -r on a folder above it) */
    touched: { args: ['string'], returns: 'boolean', pathArgs: [0] },
  },
};

/** Facts about the player's progress: dialogue, unlocks, world events. */
export const PROGRESS_FACTS: Registry = {
  vars: {
    money: { args: [], returns: 'number' },
    tech_debt: { args: [], returns: 'number' },
    /** -100..100, starts at 0 (core/karma.ts) */
    karma: { args: [], returns: 'number' },
    /** arrested or questioned by the agency: clearance jobs stay shut until community service */
    probation: { args: [], returns: 'boolean' },
    /** times caught since the last community service */
    strikes: { args: [], returns: 'number' },
    /** working as an independent contractor */
    contractor: { args: [], returns: 'boolean' },
  },
  funcs: {
    quest: { args: ['string'], returns: 'string', values: QUEST_STATES },
    xp: { args: ['string'], returns: 'number' },
    has_item: { args: ['string'], returns: 'boolean' },
    flag: { args: ['string'], returns: 'boolean' },
  },
};

/** Facts about a battle in progress: its hints use these (src/battle/engine.ts). */
export const BATTLE_FACTS: Registry = {
  vars: {
    attempts: { args: [], returns: 'number' },
    misses: { args: [], returns: 'number' },
    round: { args: [], returns: 'number' },
    confidence: { args: [], returns: 'number' },
    pressure: { args: [], returns: 'number' },
  },
  funcs: {},
};
