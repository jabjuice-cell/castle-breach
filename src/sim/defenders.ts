import type { Config } from './config';

/** Defenders the player buys at the War Council and places on the castle grounds. */

export const DEFENDER_KINDS = ['crossbow', 'archers', 'catapult', 'soldiers'] as const;
export type DefenderKind = (typeof DEFENDER_KINDS)[number];

/** Every defender stands on one of the castle's fixed spots. Soldiers hold the foot of the wall below theirs. */
export const PLACED_KINDS = DEFENDER_KINDS;
export type PlacedKind = DefenderKind;

export type SpotKind = 'wall' | 'tower' | 'courtyard';

/** A fixed place a defender can stand: 2 on each wall section, the 6 tower tops and 4 in the courtyard. */
export interface Spot {
  id: number;
  x: number;
  y: number;
  kind: SpotKind;
}

/** The castle's 20 defender spots, from the castle config. Ids: walls 0-9, towers 10-15, courtyard 16-19. */
export function castleSpots(cfg: Config): Spot[] {
  const c = cfg.castle;
  const hw = cfg.field.halfWidth;
  const seg = (hw * 2) / cfg.wall.segments;
  const spots: Spot[] = [];
  for (let i = 0; i < cfg.wall.segments; i++) {
    const mid = -hw + (i + 0.5) * seg;
    for (const side of [-1, 1]) spots.push({ id: spots.length, x: mid + side * c.wallOffset, y: c.wallY, kind: 'wall' });
  }
  for (let i = 0; i <= cfg.wall.segments; i++) {
    const x = Math.max(-hw + c.edge, Math.min(hw - c.edge, -hw + i * seg));
    spots.push({ id: spots.length, x, y: c.wallY, kind: 'tower' });
  }
  for (const x of c.courtyardX) spots.push({ id: spots.length, x, y: c.courtyardY, kind: 'courtyard' });
  return spots;
}

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
  /** The spot it stands on. */
  spot: number;
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
