import type { Config } from './config';

/** Defenders the player buys at the War Council, and the slots they stand in. */

export const DEFENDER_KINDS = ['crossbow', 'archers', 'catapult', 'soldiers'] as const;
export type DefenderKind = (typeof DEFENDER_KINDS)[number];

export type SlotKind = 'tower' | 'pit' | 'line';

export const SLOT_ACCEPTS: Record<SlotKind, readonly DefenderKind[]> = {
  tower: ['crossbow', 'archers'],
  pit: ['catapult'],
  line: ['soldiers'],
};

export const TRACKS = ['damage', 'rate', 'special'] as const;
export type Track = (typeof TRACKS)[number];

export const SPECIAL_NAMES: Record<DefenderKind, string> = {
  crossbow: 'Pierce',
  archers: 'Fire arrows',
  catapult: 'Splash',
  soldiers: 'Shield wall',
};

export interface Slot {
  id: number;
  kind: SlotKind;
  name: string;
  x: number;
  y: number;
  defender: DefenderKind | null;
  /** Countdown to the next shot. */
  timer: number;
  /** Where it last aimed, for the renderer. */
  aimX: number;
  aimY: number;
}

export type Levels = Record<DefenderKind, Record<Track, number>>;

export function makeSlots(cfg: Config): Slot[] {
  const s = cfg.slots;
  const towerNames = ['Far left tower', 'Left tower', 'Right tower', 'Far right tower'];
  const slots: Slot[] = [];
  const add = (kind: SlotKind, name: string, x: number, y: number) =>
    slots.push({ id: slots.length, kind, name, x, y, defender: null, timer: 0, aimX: x, aimY: 30 });
  s.towers.forEach((x, i) => add('tower', towerNames[i] ?? `Tower ${i + 1}`, x, 1));
  s.pits.forEach((x, i) => add('pit', i === 0 ? 'Left catapult pit' : i === 1 ? 'Right catapult pit' : `Pit ${i + 1}`, x, s.pitY));
  add('line', 'Gate line', 0, s.lineY);
  const start = slots.filter((sl) => sl.kind === 'tower')[s.startingCrossbow];
  if (start) start.defender = 'crossbow';
  return slots;
}

export function emptyLevels(): Levels {
  const levels = {} as Levels;
  for (const k of DEFENDER_KINDS) levels[k] = { damage: 0, rate: 0, special: 0 };
  return levels;
}

/** Stat multiplier for an upgrade level: +step per level, doubled at each milestone level. */
export function trackMult(level: number, cfg: Config): number {
  let m = 1 + cfg.upgrades.step * level;
  for (const ms of cfg.upgrades.milestones) if (level >= ms) m *= 2;
  return m;
}

export function upgradeCost(kind: DefenderKind, level: number, cfg: Config): number {
  const u = cfg.upgrades;
  return Math.round(cfg[kind].cost * u.baseCostShare * u.costGrowth ** level);
}
