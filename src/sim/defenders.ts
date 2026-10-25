import type { Config } from './config';

/** Defenders the player buys at the War Council and places on the castle grounds. */

export const DEFENDER_KINDS = ['crossbow', 'archers', 'catapult', 'soldiers'] as const;
export type DefenderKind = (typeof DEFENDER_KINDS)[number];

/** Defenders go anywhere on the castle grounds. Soldiers hold the foot of the wall below theirs. */
export const PLACED_KINDS = DEFENDER_KINDS;
export type PlacedKind = DefenderKind;

/** What a defender stands on, which changes its reach: tower tops reach further, the courtyard less far. */
export type Ground = 'wall' | 'tower' | 'courtyard';

/** The x of each tower: one on every joint of the wall, the ends included. */
export function towerXs(cfg: Config): number[] {
  const hw = cfg.field.halfWidth;
  const seg = (hw * 2) / cfg.wall.segments;
  return Array.from({ length: cfg.wall.segments + 1 }, (_, i) => -hw + i * seg);
}

/** The ground at (x, y): a tower top, the wall walk, or the courtyard behind. */
export function groundAt(cfg: Config, x: number, y: number): Ground {
  const c = cfg.castle;
  if (y < -cfg.wall.depth - c.wallSlack) return 'courtyard';
  return towerXs(cfg).some((tx) => Math.abs(x - tx) <= c.towerHalf) ? 'tower' : 'wall';
}

export const TRACKS = ['damage', 'rate', 'special'] as const;
export type Track = (typeof TRACKS)[number];

/** The upgrade tracks that do something for each kind (catapults only fire faster; soldiers have no rate of fire). */
export const USEFUL_TRACKS: Record<DefenderKind, readonly Track[]> = {
  crossbow: TRACKS,
  archers: TRACKS,
  catapult: ['rate'],
  soldiers: ['damage', 'special'],
};

export const SPECIAL_NAMES: Record<DefenderKind, string> = {
  crossbow: 'Pierce',
  archers: 'Fire arrows',
  catapult: 'Splash',
  soldiers: 'Shield wall',
};

export interface Defender {
  id: number;
  kind: PlacedKind;
  /** What it stands on. */
  ground: Ground;
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
