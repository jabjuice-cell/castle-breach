import type { Config } from './config';
import type { MetaLevels } from './meta';

/**
 * The town's choices for a level, made in the setup by clicking its buildings (not a menu), and only
 * from what the town has unlocked. They last the level; the meta-upgrades stay separate and permanent.
 * War room: one battle tactic, each with a trade-off. Barracks: archer and soldier roles.
 * Blacksmith: the shield and the Royal Ball. Watchtower: shows the next level's orcs (no choice).
 * Every number is under `town` in config.ts; applyChoices folds the plain stat changes into the
 * level's config, and the sim reads cfg.choices for the rest (pinning, repairing, sallying, powder).
 */

export const TACTICS = ['holdGate', 'rainOfArrows', 'sallyForth'] as const;
export type TacticId = (typeof TACTICS)[number];
export const ARCHER_ROLES = ['fire', 'pin'] as const;
export type ArcherRole = (typeof ARCHER_ROLES)[number];
export const SOLDIER_ROLES = ['hold', 'repair'] as const;
export type SoldierRole = (typeof SOLDIER_ROLES)[number];
export const SHIELD_KITS = ['kite', 'tower', 'buckler', 'spiked'] as const;
export type ShieldKit = (typeof SHIELD_KITS)[number];
export const BALL_KITS = ['royal', 'iron', 'jester', 'powder'] as const;
export type BallKit = (typeof BALL_KITS)[number];

export interface Choices {
  tactic: TacticId | null;
  archers: ArcherRole;
  soldiers: SoldierRole;
  shield: ShieldKit;
  ball: BallKit;
}

export function defaultChoices(): Choices {
  return { tactic: null, archers: 'fire', soldiers: 'hold', shield: 'kite', ball: 'royal' };
}

/** The town buildings the choices live in, and the meta-upgrade that builds each. */
export type ChoiceBuilding = 'warroom' | 'barracks' | 'blacksmith' | 'watchtower';
export const CHOICE_BUILDING_META: Record<ChoiceBuilding, string> = {
  warroom: 'warroom',
  barracks: 'soldiers',
  blacksmith: 'blacksmith',
  watchtower: 'watchtower',
};

export interface Option<T extends string> {
  id: T;
  name: string;
  /** What you get. */
  good: string;
  /** What it costs (empty for the defaults). */
  bad: string;
  /** Meta-upgrades needed, as [id, level]. */
  needs: [string, number][];
}

export const TACTIC_INFO: Option<TacticId>[] = [
  { id: 'holdGate', name: 'Hold the Gate', good: 'Wall sections +40% strength, soldiers +50% toughness.', bad: 'Every defender shoots 20% slower; no reward for calling waves early.', needs: [] },
  { id: 'rainOfArrows', name: 'Rain of Arrows', good: 'Archers and crossbows shoot 35% faster; volleys down twice the boulders; fire burns 5 s.', bad: 'Soldier companies muster 20 men, not 40; repairs cost 50% more.', needs: [['archers', 1]] },
  { id: 'sallyForth', name: 'Sally Forth', good: 'Soldiers march out to hold a line up the field: +30% damage, +50% speed, their kills pay +50% gold.', bad: 'Nobody guards the foot of the wall; only 20 of each company come back each wave.', needs: [['soldiers', 1]] },
];

export const ARCHER_ROLE_INFO: Option<ArcherRole>[] = [
  { id: 'fire', name: 'Fire', good: 'Full volleys at the thickest crowd.', bad: '', needs: [['archers', 1]] },
  { id: 'pin', name: 'Pin', good: 'Orcs hit walk at half speed for 2 s; a block that is hit stops marching for 1 s.', bad: 'Arrows do 40% damage.', needs: [['archers', 1]] },
];

export const SOLDIER_ROLE_INFO: Option<SoldierRole>[] = [
  { id: 'hold', name: 'Hold the line', good: 'Rush any orc at the foot of the wall.', bad: '', needs: [] },
  { id: 'repair', name: 'Repair', good: 'Each company mends its nearest wall section, 4 HP a second, while no orc is close.', bad: 'Fights at half damage.', needs: [] },
];

export const SHIELD_KIT_INFO: Option<ShieldKit>[] = [
  { id: 'kite', name: 'Kite shield', good: 'The royal shield as you know it.', bad: '', needs: [] },
  { id: 'tower', name: 'Tower shield', good: '35% wider.', bad: 'Moves 30% slower; heave every 4 s.', needs: [['width', 2]] },
  { id: 'buckler', name: 'Buckler', good: 'Quicker, a wider heave window, bash every 0.45 s, Perfect Returns fly faster.', bad: '30% narrower.', needs: [['window', 1]] },
  { id: 'spiked', name: 'Spiked boss', good: 'The heave slam hits 45, reaches 3 tiles and kills shield orcs outright.', bad: 'Plain returns go 15% slower.', needs: [['power', 1]] },
];

export const BALL_KIT_INFO: Option<BallKit>[] = [
  { id: 'royal', name: 'Royal Ball', good: 'Quick and gold.', bad: '', needs: [] },
  { id: 'iron', name: 'Iron Ball', good: 'Double damage, a bigger splash, harder knockback.', bad: 'Slow, and never speeds up off bounces.', needs: [['catapult', 1]] },
  { id: 'jester', name: "Jester's Ball", good: 'Speeds up 5% a bounce, to a higher top speed; combos build faster.', bad: '30% less damage.', needs: [['recovery', 1]] },
  { id: 'powder', name: 'Powder Ball', good: 'Every 4th hit blows up everything close by.', bad: 'Gets past the shield and it hits the wall for 25.', needs: [['alchemist', 1]] },
];

const met = (meta: MetaLevels, needs: [string, number][]) => needs.every(([id, lv]) => (meta[id] ?? 0) >= lv);

/** True if the town has built this building. */
export function hasChoiceBuilding(meta: MetaLevels, b: ChoiceBuilding): boolean {
  return (meta[CHOICE_BUILDING_META[b]] ?? 0) > 0;
}

/** Can this option be picked: its building stands and its upgrades are owned. */
export function optionOpen(meta: MetaLevels, building: ChoiceBuilding, o: Option<string>): boolean {
  return hasChoiceBuilding(meta, building) && met(meta, o.needs);
}

/** What still locks an option, as the needed upgrade ids (empty once it can be picked). */
export function optionNeeds(meta: MetaLevels, o: Option<string>): string[] {
  return o.needs.filter(([id, lv]) => (meta[id] ?? 0) < lv).map(([id]) => id);
}

/** Choices with anything no longer open put back to its default (an old save, or a missing building). */
export function sanitizeChoices(meta: MetaLevels, c: Partial<Choices> | undefined): Choices {
  const d = defaultChoices();
  const pick = <T extends string>(b: ChoiceBuilding, list: Option<T>[], id: T | null | undefined, fallback: T): T => {
    const o = list.find((x) => x.id === id);
    return o && optionOpen(meta, b, o) ? o.id : fallback;
  };
  const tactic = c?.tactic ? TACTIC_INFO.find((t) => t.id === c.tactic) : undefined;
  return {
    tactic: tactic && optionOpen(meta, 'warroom', tactic) ? tactic.id : null,
    archers: pick('barracks', ARCHER_ROLE_INFO, c?.archers, d.archers),
    soldiers: pick('barracks', SOLDIER_ROLE_INFO, c?.soldiers, d.soldiers),
    shield: pick('blacksmith', SHIELD_KIT_INFO, c?.shield, d.shield),
    ball: pick('blacksmith', BALL_KIT_INFO, c?.ball, d.ball),
  };
}

/** The level's config with the town's choices folded in. The sim reads cfg.choices for the behaviours. */
export function applyChoices(base: Config, c: Choices): Config {
  const cfg = structuredClone(base);
  cfg.choices = { ...c };
  const t = cfg.town;
  if (c.tactic === 'holdGate') {
    const h = t.holdGate;
    cfg.wall.segmentHp = Math.round(cfg.wall.segmentHp * h.wallHp);
    cfg.soldiers.hp *= h.soldierHp;
    cfg.bonuses.rate *= h.rate;
    cfg.economy.earlyGoldMult = 0;
    cfg.renown.earlyCap = 0;
    cfg.renown.earlyPerSecond = 0;
  } else if (c.tactic === 'rainOfArrows') {
    const r = t.rainOfArrows;
    cfg.archers.interval /= r.rate;
    cfg.crossbow.interval /= r.rate;
    cfg.archers.shootDown = r.shootDown;
    cfg.archers.burnSeconds = r.burnSeconds;
    cfg.soldiers.count = r.soldiers;
    cfg.economy.repairGoldPerHp *= r.repairCost;
  } else if (c.tactic === 'sallyForth') {
    const s = t.sallyForth;
    cfg.soldiers.dps *= s.dps;
    cfg.soldiers.speed *= s.speed;
    cfg.soldiers.walk *= s.speed;
    cfg.soldiers.y = s.y;
    cfg.soldiers.guard = s.guard;
  }
  if (c.archers === 'pin') cfg.archers.damage *= t.pin.damage;
  if (c.soldiers === 'repair') cfg.soldiers.dps *= t.repair.dps;
  const sk = t.shields[c.shield];
  cfg.shield.halfWidth *= sk.width;
  cfg.shield.speed *= sk.speed;
  cfg.shield.heaveCooldown += sk.heaveCooldown;
  cfg.shield.heaveWindow += sk.heaveWindow;
  if (sk.bashCooldown !== undefined) cfg.shield.bashCooldown = sk.bashCooldown;
  if (sk.perfectSpeed !== undefined) cfg.shield.perfectSpeed = sk.perfectSpeed;
  if (sk.slamDamage !== undefined) cfg.shield.slamDamage = sk.slamDamage;
  if (sk.slamReach !== undefined) cfg.shield.slamReach = sk.slamReach;
  if (sk.slamKillMass !== undefined) cfg.shield.slamKillMass = sk.slamKillMass;
  cfg.shield.returnMult = sk.returnMult;
  return cfg;
}
