// Commands players typed that no machine has, in the order first seen (each once, at most 200).
// A local list for tests, smoke runs and the dev console: never shown to the player, never sent
// anywhere (AGENTS.md, rule 3). It tells us which basics the simulator still lacks.

const LOG: string[] = [];
const MAX = 200;

export function noteUnknown(name: string): void {
  if (LOG.includes(name)) return;
  LOG.push(name);
  if (LOG.length > MAX) LOG.shift();
}

/** The unknown command names seen since the page loaded. */
export const unknownCommands = (): readonly string[] => [...LOG];

/** For tests. */
export function clearUnknown(): void {
  LOG.length = 0;
}
