import type { Config } from './config';

/** Defenders the player buys in the setup or between waves and places on the castle grounds. */

export const DEFENDER_KINDS = ['crossbow', 'archers', 'catapult', 'soldiers', 'mage', 'ballista', 'oil', 'spiketrap'] as const;
export type DefenderKind = (typeof DEFENDER_KINDS)[number];

/** Most defenders go on the castle grounds (mages on tower tops, oil on the wall walk); spike traps go on the field. Soldiers hold the foot of the wall below theirs. */
export const PLACED_KINDS = DEFENDER_KINDS;
export type PlacedKind = DefenderKind;

/** What a defender stands on, which changes its reach: tower tops reach further, the courtyard less far. */
export type Ground = 'wall' | 'tower' | 'courtyard';

/** A tower the player has built on the wall, stacked up storey by storey. */
export interface Stack {
  x: number;
  storeys: number;
  /** What the top storey has left before it falls. */
  hp: number;
}

/** True if (x, y) is on the wall walk (towers included), not the courtyard behind. */
export function onWall(cfg: Config, y: number): boolean {
  return y >= -cfg.wall.depth - cfg.castle.wallSlack && y <= cfg.castle.maxY;
}

/** The tower whose top (x, y) is on, if any. */
export function stackAt(cfg: Config, stacks: Stack[], x: number, y: number): Stack | undefined {
  if (!onWall(cfg, y)) return undefined;
  return stacks.find((s) => Math.abs(x - s.x) <= cfg.castle.towerHalf);
}

/** The ground at (x, y): a tower top, the wall walk, or the courtyard behind. */
export function groundAt(cfg: Config, x: number, y: number, stacks: Stack[] = []): Ground {
  if (!onWall(cfg, y)) return 'courtyard';
  return stackAt(cfg, stacks, x, y) ? 'tower' : 'wall';
}

export const TRACKS = ['damage', 'rate', 'special'] as const;
export type Track = (typeof TRACKS)[number];

/** The upgrade tracks that do something for each kind (catapults only fire faster; soldiers have no rate of fire). */
export const USEFUL_TRACKS: Record<DefenderKind, readonly Track[]> = {
  crossbow: TRACKS,
  archers: TRACKS,
  catapult: ['rate'],
  soldiers: ['damage', 'special'],
  mage: TRACKS,
  ballista: TRACKS,
  oil: TRACKS,
  spiketrap: ['damage', 'special'],
};

export const SPECIAL_NAMES: Record<DefenderKind, string> = {
  crossbow: 'Pierce',
  archers: 'Fire arrows',
  catapult: 'Splash',
  soldiers: 'Shield wall',
  mage: 'Arcane blast',
  ballista: 'Pierce',
  oil: 'Burning oil',
  spiketrap: 'Barbs',
};

export interface Defender {
  id: number;
  kind: PlacedKind;
  /** What it stands on. */
  ground: Ground;
  x: number;
  y: number;
  /** Gold paid for it, for selling it back. */
  paid: number;
  /**
   * Where the player has aimed it, as an angle off straight up the field (radians, positive
   * toward +x), or null to leave it on its default facing.
   */
  heading: number | null;
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
