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
    service: { args: ['string'], returns: 'string', values: SERVICE_STATES },
    restarted: { args: ['string'], returns: 'boolean' },
    pods_running: { args: ['string'], returns: 'boolean' },
    ran: { args: ['string'], returns: 'boolean' },
    flag: { args: ['string'], returns: 'boolean' },
  },
};

/** Facts about the player's progress: dialogue, unlocks, world events. */
export const PROGRESS_FACTS: Registry = {
  vars: {
    money: { args: [], returns: 'number' },
    tech_debt: { args: [], returns: 'number' },
  },
  funcs: {
    quest: { args: ['string'], returns: 'string', values: QUEST_STATES },
    xp: { args: ['string'], returns: 'number' },
    has_item: { args: ['string'], returns: 'boolean' },
    flag: { args: ['string'], returns: 'boolean' },
  },
};
