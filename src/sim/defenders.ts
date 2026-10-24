import type { Config } from './config';

/** Defenders the player buys at the War Council and places on the castle grounds. */

export const DEFENDER_KINDS = ['crossbow', 'archers', 'catapult', 'soldiers'] as const;
export type DefenderKind = (typeof DEFENDER_KINDS)[number];

/** Kinds the player puts down anywhere on the castle. Soldiers instead hold the foot of the wall. */
export const PLACED_KINDS = ['crossbow', 'archers', 'catapult'] as const;
export type PlacedKind = (typeof PLACED_KINDS)[number];

export const TRACKS = ['damage', 'rate', 'special'] as const;
export type Track = (typeof TRACKS)[number];

export const SPECIAL_NAMES: Record<DefenderKind, string> = {
  crossbow: 'Pierce',
  archers: 'Fire arrows',
  catapult: 'Splash',
  soldiers: 'Shield wall',
};

export interface Defender {
  id: number;
  kind: PlacedKind;
  x: number;
  y: number;
  /** Countdown to the next shot. */
  timer: number;
  /** Where it last aimed, for the renderer. */
  aimX: number;
  aimY: number;
  /** When it last fired (game time), for recoil and bow animations. */
  firedAt: number;
}

export type Levels = Record<DefenderKind, Record<Track, number>>;

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
