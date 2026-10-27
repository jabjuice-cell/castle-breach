import { type Config, makeConfig } from './config';
import type { DefenderKind } from './defenders';
import { type Choices, defaultChoices } from './town';

/**
 * Meta-progression: permanent upgrades bought in the town with Renown, between levels.
 * They can't be undone. Four groups, as Jonny listed them: defence, wall, shield and town.
 * Each upgrade has a price per level; its effect is applied to the level's config by applyMeta.
 */

export const META_GROUPS = ['defence', 'wall', 'shield', 'town'] as const;
export type MetaGroup = (typeof META_GROUPS)[number];

export interface MetaUpgrade {
  id: string;
  group: MetaGroup;
  name: string;
  /** What each level does, for the town screen. */
  blurb: string;
  /** Renown for each level, in order; the upgrade maxes out after the last. */
  costs: number[];
}

export const META_UPGRADES: MetaUpgrade[] = [
  // Defence: new defenders, then everyone hits harder and shoots faster.
  { id: 'archers', group: 'defence', name: 'Archery butts', blurb: 'Unlocks archers: thirty bowmen who shoot boulders out of the sky.', costs: [20] },
  { id: 'soldiers', group: 'defence', name: 'Barracks', blurb: 'Unlocks soldier companies to hold the foot of the wall.', costs: [30] },
  { id: 'catapult', group: 'defence', name: 'Siege workshop', blurb: 'Unlocks the castle catapult, which lobs extra Royal Balls.', costs: [60] },
  { id: 'mage', group: 'defence', name: 'Mage college', blurb: 'Unlocks mage towers: blast the thickest crowd from a tower top.', costs: [70] },
  { id: 'ballista', group: 'defence', name: 'Ballista works', blurb: 'Unlocks the ballista: one huge bolt that skewers a whole lane.', costs: [80] },
  { id: 'oil', group: 'defence', name: 'Oil cauldrons', blurb: 'Unlocks boiling oil to pour on orcs climbing the wall.', costs: [60] },
  { id: 'spiketrap', group: 'defence', name: "Sapper's yard", blurb: 'Unlocks spike traps that hurt and slow orcs on the field, and bounce the Royal Ball.', costs: [30] },
  { id: 'fletching', group: 'defence', name: 'Fletchers', blurb: '+15% damage for every defender, per level.', costs: [40, 90, 200] },
  { id: 'drill', group: 'defence', name: 'Drill yard', blurb: 'Defenders shoot 12% faster, per level.', costs: [50, 110, 240] },
  // Wall: tougher, nastier to climb and cheaper to patch.
  { id: 'masonry', group: 'wall', name: 'Masons', blurb: '+20% wall strength, per level.', costs: [25, 60, 140] },
  { id: 'spikes', group: 'wall', name: 'Spiked battlements', blurb: 'Climbing orcs take 2 damage a second, per level.', costs: [35, 80] },
  { id: 'mortar', group: 'wall', name: 'Quick mortar', blurb: 'Repairs cost 25% less, per level.', costs: [20, 50] },
  // Shield: the royal smithy (these used to be bought during a run).
  { id: 'width', group: 'shield', name: 'Wider shield', blurb: 'The shield grows by half a tile, per level.', costs: [15, 35, 70, 140] },
  { id: 'recovery', group: 'shield', name: 'Leather grips', blurb: 'Heave again 0.4 s sooner, per level.', costs: [25, 60, 130] },
  { id: 'window', group: 'shield', name: 'Battle drums', blurb: 'A wider window to time a heave, per level.', costs: [25, 60, 130] },
  { id: 'power', group: 'shield', name: 'Iron boss', blurb: 'A heave smashes through one more orc line, per level.', costs: [80, 200] },
  { id: 'plating', group: 'shield', name: 'Plating', blurb: 'Shrugs off one orc trick a wave, per level.', costs: [60, 150] },
  // Town: money and buildings with permanent boons.
  { id: 'tavern', group: 'town', name: 'The Rusty Tankard', blurb: 'Builds the tavern. Soldiers fight 30% harder and march 50% faster.', costs: [35] },
  { id: 'alchemist', group: 'town', name: 'Alchemist\'s workshop', blurb: 'Builds the alchemist. Every ball burns like a fire flask.', costs: [50] },
  { id: 'blacksmith', group: 'town', name: 'Blacksmith', blurb: 'Builds the blacksmith. Arrows and bolts are sharpened: +25% damage.', costs: [45] },
  { id: 'chapel', group: 'town', name: 'Chapel', blurb: 'Builds the chapel. Damaged wall segments mend themselves in battle.', costs: [55] },
  { id: 'forge', group: 'town', name: 'Siege Forge', blurb: 'Builds the Siege Forge. The castle catapult hits 40% harder.', costs: [70] },
  { id: 'watchtower', group: 'town', name: 'Watchtower', blurb: 'Builds the watchtower. Scout the orcs, warlords and siege towers of the level ahead.', costs: [15] },
  { id: 'warroom', group: 'town', name: 'War room', blurb: 'Builds the war room. Pick one big battle tactic for each level.', costs: [20] },
  { id: 'treasury', group: 'town', name: 'Treasury', blurb: '+60 gold in the war chest for every level, per level.', costs: [20, 45, 100, 220] },
  { id: 'market', group: 'town', name: 'Market', blurb: '+15% gold from kills, per level.', costs: [40, 90, 200] },
  // Capstones: the far ends of the tree.
  { id: 'doctrine', group: 'defence', name: 'Volley doctrine', blurb: 'The horn lasts longer: call to arms fires 0.5 faster and rests 10 s less.', costs: [300] },
  { id: 'bastion', group: 'wall', name: 'Bastion', blurb: '+50% wall strength and climbing orcs take 3 more damage a second.', costs: [260] },
  { id: 'guild', group: 'town', name: 'Merchants\' guild', blurb: '+25% gold from kills and +100 gold in the war chest.', costs: [350] },
];

/**
 * The research tree: what must be owned (upgrade, level) before an upgrade can be bought.
 * Upgrades with no entry are roots. Owned levels are never taken away, so these only gate buying.
 */
const PREREQS: Record<string, [id: string, level: number][]> = {
  catapult: [['archers', 1]],
  fletching: [['archers', 1]],
  mage: [['archers', 1]],
  ballista: [['fletching', 1]],
  oil: [['masonry', 1]],
  spiketrap: [['soldiers', 1]],
  drill: [['fletching', 1]],
  doctrine: [['fletching', 3], ['drill', 2]],
  spikes: [['masonry', 1]],
  mortar: [['masonry', 1]],
  bastion: [['masonry', 3], ['spikes', 2]],
  recovery: [['width', 1]],
  power: [['width', 1]],
  window: [['recovery', 1]],
  plating: [['power', 1]],
  market: [['treasury', 1]],
  guild: [['market', 3], ['treasury', 3]],
  tavern: [['soldiers', 1]],
  alchemist: [['catapult', 1]],
  blacksmith: [['fletching', 1]],
  chapel: [['masonry', 1]],
  forge: [['blacksmith', 1], ['catapult', 1]],
};

/** What an upgrade needs first, as [upgrade, level] pairs. */
export function metaNeeds(id: string): readonly [string, number][] {
  return PREREQS[id] ?? [];
}

/** How far down the tree an upgrade sits: roots are 0. */
export function metaDepth(id: string): number {
  return metaNeeds(id).reduce((d, [need]) => Math.max(d, metaDepth(need) + 1), 0);
}

/** The prerequisites not yet met, as text for the town screen; empty once the upgrade can be bought. */
export function metaLocked(meta: MetaLevels, id: string): string {
  return metaNeeds(id)
    .filter(([need, level]) => (meta[need] ?? 0) < level)
    .map(([need, level]) => `${metaUpgrade(need).name}${metaUpgrade(need).costs.length > 1 ? ` ${level}` : ''}`)
    .join(', ');
}

export type MetaLevels = Record<string, number>;

export function metaUpgrade(id: string): MetaUpgrade {
  const u = META_UPGRADES.find((m) => m.id === id);
  if (!u) throw new Error(`no meta upgrade ${id}`);
  return u;
}

/** Renown the next level of an upgrade costs, or Infinity once it is maxed. */
export function metaCost(meta: MetaLevels, id: string): number {
  const level = meta[id] ?? 0;
  return metaUpgrade(id).costs[level] ?? Infinity;
}

/** Everything the player keeps between levels and runs. */
export interface Progress {
  renown: number;
  meta: MetaLevels;
  /** Levels beaten so far; the next one to play is this (0-based). */
  levelsBeaten: number;
  /** The last level's defenders, so the setup can put them back in one click. */
  lastLoadout: { kind: DefenderKind; x: number; y: number }[];
  /** True once the guided first wave has been played (or skipped by an older save). */
  tutorialDone: boolean;
  /** The town choices last made (sanitised against the meta-upgrades when a level is set up). */
  choices: Choices;
}

export function newProgress(): Progress {
  return { renown: 0, meta: {}, levelsBeaten: 0, lastLoadout: [], tutorialDone: false, choices: defaultChoices() };
}

/** Spends Renown on the next level of an upgrade. */
export function buyMeta(p: Progress, id: string): boolean {
  const cost = metaCost(p.meta, id);
  if (p.renown < cost || metaLocked(p.meta, id)) return false;
  p.renown -= cost;
  p.meta[id] = (p.meta[id] ?? 0) + 1;
  return true;
}

/** Shield upgrades, as the levels the game starts with. */
export const SHIELD_META = ['width', 'window', 'power', 'recovery', 'plating'] as const;

/** The config for a level with the town's permanent upgrades applied. */
export function applyMeta(meta: MetaLevels, level: number, base: Config = makeConfig()): Config {
  const cfg = structuredClone(base);
  const lv = (id: string) => meta[id] ?? 0;
  cfg.unlocks.defenders = ['crossbow', ...(['archers', 'soldiers', 'catapult', 'mage', 'ballista', 'oil', 'spiketrap'] as const).filter((k) => lv(k) > 0)];
  cfg.unlocks.buildings = ['keep', ...(['tavern', 'alchemist', 'blacksmith', 'chapel', 'forge', 'warroom', 'watchtower'] as const).filter((k) => lv(k) > 0), ...(lv('soldiers') >= 1 ? (['barracks'] as const) : [])];
  cfg.bonuses.damage *= 1 + 0.15 * lv('fletching');
  cfg.bonuses.rate *= 1 + 0.12 * lv('drill');
  cfg.wall.segmentHp = Math.round(cfg.wall.segmentHp * (1 + 0.2 * lv('masonry') + 0.5 * lv('bastion')));
  cfg.bonuses.spikesDps += 2 * lv('spikes') + 3 * lv('bastion');
  cfg.economy.repairGoldPerHp *= 1 - 0.25 * lv('mortar');
  cfg.bonuses.killGold *= (1 + 0.15 * lv('market')) * (1 + 0.25 * lv('guild'));
  cfg.economy.warChest = cfg.levels.warChest[Math.min(level, cfg.levels.warChest.length - 1)] + 60 * lv('treasury') + 100 * lv('guild');
  cfg.callToArms.rate += 0.5 * lv('doctrine');
  cfg.callToArms.cooldown -= 10 * lv('doctrine');
  // Each level's own field: the first is narrow, later ones wider behind a longer wall.
  const at = <T>(list: T[]) => list[Math.min(level, list.length - 1)];
  cfg.field.halfWidth = at(cfg.levels.halfWidth);
  cfg.wall.segments = at(cfg.levels.segments);
  for (const t of SHIELD_META) cfg.bonuses.shield[t] = lv(t);
  return cfg;
}
