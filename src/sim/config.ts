/**
 * Every tuning number lives here, so balance sims can override any of them
 * without touching game code. First-pass values come from the "Buildable
 * design" page in Notion.
 *
 * Coordinates: x runs across the field, y runs away from the castle.
 * The wall's front face is at y = 0; enemies spawn near y = field.spawnY.
 * One design "tile" is about 2.2 units, so a grunt's 1 tile/s is speed 2.2.
 */
export const defaultConfig = {
  field: { halfWidth: 20, spawnY: 70 },
  /** The run is lost when any one segment reaches 0 HP. */
  wall: { segments: 5, segmentHp: 400, depth: 2, warnBelow: 0.25 },

  // ---- enemies --------------------------------------------------------------
  // mass divides knockback; climbSeconds 0 means it smashes the wall without climbing.
  grunt: { hp: 10, speed: 2.2, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 1, threat: 1 },
  /** Grunt variant that stops up the field and lobs rocks at the battlements. */
  chucker: {
    hp: 10, speed: 2.2, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 2, threat: 2,
    standMinY: 22, standMaxY: 30, throwInterval: 3,
  },
  /** Fast and zig-zags, so straight crossbow bolts tend to miss. */
  rider: { hp: 8, speed: 4.8, radius: 0.6, mass: 1.2, wallDps: 2, meleeDps: 3, climbSeconds: 2, gold: 2, threat: 2, zigSpeed: 4, zigRate: 1.6 },
  /** Parks 70% up the field and lobs boulders at the wall. */
  orcCatapult: {
    hp: 60, speed: 1.1, radius: 1, mass: 6, wallDps: 5, meleeDps: 5, climbSeconds: 0, gold: 15, threat: 15,
    standMinY: 46, standMaxY: 52, throwInterval: 6,
  },
  ogre: { hp: 150, speed: 1.3, radius: 1.2, mass: 4, wallDps: 10, meleeDps: 30, climbSeconds: 0, gold: 12, threat: 12 },
  /** Boss on waves 10, 20 and the last. Speeds up orcs around it. */
  warlord: {
    hp: 2000, speed: 0.9, radius: 1.6, mass: 10, wallDps: 40, meleeDps: 60, climbSeconds: 0, gold: 100, threat: 0,
    auraRadius: 7, auraSpeed: 1.3,
  },

  rock: { speed: 12, wallDamage: 5, radius: 0.4, deflectDamage: 10 },
  boulder: { speed: 14, wallDamage: 25, radius: 0.7, deflectDamage: 30 },

  // ---- defenders --------------------------------------------------------------
  /** Fixed places defenders can stand. Towers are on the wall joints, pits in the courtyard. */
  slots: {
    towers: [-12, -4, 4, 12],
    pits: [-15, 15],
    pitY: -4,
    /** The soldier line holds in front of the gate (the middle segment). */
    lineY: 7,
    /** Tower index that starts with a free crossbow. */
    startingCrossbow: 1,
  },
  crossbow: { cost: 100, interval: 2.5, boltSpeed: 45, damage: 40, pierce: 5, pierceFalloff: 0.2, knockback: 5, range: 75 },
  archers: { cost: 80, archers: 6, interval: 1, damage: 3, arrowSpeed: 32, range: 42, burnSeconds: 3 },
  catapult: { cost: 150, interval: 5, damage: 30, splash: 3.3, range: 66, flightTime: 1.6, knockback: 6 },
  soldiers: { cost: 60, count: 8, hp: 40, dps: 4, reach: 1.3, spacing: 1.1 },
  upgrades: {
    /** Each track's first level costs this share of the defender's price. */
    baseCostShare: 0.4,
    costGrowth: 1.15,
    /** Each level adds this much to the stat. */
    step: 0.1,
    /** Levels that double the stat. */
    milestones: [10, 25, 50],
  },

  // ---- player skills ----------------------------------------------------------
  shield: {
    y: 4, halfWidth: 3.5, maxEnergy: 100, drainPerSec: 20, regenPerSec: 10,
    /** Once empty, the shield can't be raised again until energy reaches this. */
    recoverAt: 30,
    /** Raising the shield this soon before a rock lands is a perfect parry. */
    parryWindow: 0.15,
    parryMultiplier: 3,
  },
  slap: { radius: 1.6, damage: 6, impulse: 7, vigorMax: 10, vigorRegen: 2, vigorCost: 1 },
  physics: { friction: 6, separation: 8 },

  // ---- run structure ----------------------------------------------------------
  waves: {
    previewSeconds: 8,
    /** Threat budget in grunt-equivalents: base * growth^(wave - 1). */
    budgetBase: 20,
    budgetGrowth: 1.17,
    /**
     * Enemy HP grows this much per wave (bosses excluded). The design draft said 1.05,
     * but kill gold grows with the crowd, and at 1.05 a planned build won every run.
     */
    hpGrowth: 1.1,
    /** Seconds over which a wave's battalions arrive: base + perWave * n, capped. */
    spawnBase: 8,
    spawnPerWave: 1,
    spawnMax: 30,
    chuckersFromWave: 3,
    chuckerShare: 0.2,
    ridersFromWave: 6,
    riderShare: 0.15,
    orcCatapultsFromWave: 8,
    orcCatapultShare: 0.08,
    ogresFromWave: 12,
    ogreShare: 0.12,
    bossWaves: [10, 20, 25],
    /** The run is won after this wave. */
    finalWave: 25,
  },
  economy: {
    startGold: 150,
    /** Kill gold grows this much per wave. */
    killGoldGrowth: 1.04,
    clearBase: 10,
    clearPerWave: 2,
    /** War Council opens before wave 1 and after every Nth wave. */
    councilEvery: 3,
    repairGoldPerHp: 0.5,
    /** The next wave can be called once this share of the current one is left on the field. */
    callEarlyAt: 0.15,
    /** Seconds credited for calling from the tail of a wave, on top of the skipped preview. */
    tailCallSeconds: 6,
  },
  renown: {
    perWaveBase: 5,
    perWave: 1,
    earlyPerSecond: 0.02,
    earlyCap: 0.5,
    bossKill: 50,
    actClear: 500,
  },
};

export type Config = typeof defaultConfig;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function makeConfig(overrides: DeepPartial<Config> = {}): Config {
  const cfg = structuredClone(defaultConfig);
  for (const [group, values] of Object.entries(overrides)) {
    Object.assign((cfg as Record<string, object>)[group], values);
  }
  return cfg;
}
