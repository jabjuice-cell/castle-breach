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
  // Grunts and riders come in big crowds: each is a fraction of a grunt-equivalent (threat),
  // with HP, gold and damage cut to match, so a wave has far more of them on screen.
  grunt: { hp: 2.5, speed: 2.2, radius: 0.45, mass: 1, wallDps: 0.25, meleeDps: 0.5, climbSeconds: 3, gold: 0.25, threat: 0.25 },
  /** Grunt variant that stops up the field and lobs rocks at the battlements. */
  chucker: {
    hp: 10, speed: 2.2, radius: 0.5, mass: 1, wallDps: 1, meleeDps: 2, climbSeconds: 3, gold: 2, threat: 2,
    standMinY: 22, standMaxY: 30, throwInterval: 3,
  },
  /** Fast and zig-zags, so straight crossbow bolts tend to miss. */
  rider: { hp: 4, speed: 4.8, radius: 0.55, mass: 1.2, wallDps: 1, meleeDps: 1.5, climbSeconds: 2, gold: 1, threat: 1, zigSpeed: 4, zigRate: 1.6 },
  /** Parks far up the field and lobs boulders at the wall. They come every wave, so the shield stays busy. */
  orcCatapult: {
    hp: 40, speed: 1.1, radius: 1, mass: 6, wallDps: 5, meleeDps: 5, climbSeconds: 0, gold: 10, threat: 15,
    standMinY: 44, standMaxY: 54, throwInterval: 4.5,
  },
  ogre: { hp: 150, speed: 1.3, radius: 1.2, mass: 4, wallDps: 10, meleeDps: 30, climbSeconds: 0, gold: 12, threat: 12 },
  /** Boss on waves 10, 20 and the last. Speeds up orcs around it. */
  warlord: {
    hp: 2000, speed: 0.9, radius: 1.6, mass: 10, wallDps: 25, meleeDps: 60, climbSeconds: 0, gold: 100, threat: 0,
    auraRadius: 7, auraSpeed: 1.3,
  },

  rock: { speed: 12, wallDamage: 5, radius: 0.4, deflectDamage: 10 },
  boulder: { speed: 14, wallDamage: 10, radius: 0.7, deflectDamage: 30 },

  // ---- defenders --------------------------------------------------------------
  /**
   * Archers, crossbows and catapults can be placed anywhere on the castle grounds:
   * on the wall, the towers or in the courtyard behind (y from minY up to the wall's front face).
   */
  castle: {
    minY: -14,
    maxY: 0,
    /** Defenders keep this far from the side edges of the field. */
    edge: 1,
    maxDefenders: 20,
    /** Each extra defender of the same kind costs this much more than the last. */
    priceGrowth: 1.3,
    /** Seconds a defender moved mid-battle spends packing up before it fires again. */
    packSeconds: 2,
    /** Where the free crossbow starts: on the wall, left of the gate. */
    start: { x: -4, y: -1 },
  },
  /** footprint is the radius a defender occupies; two can't overlap. */
  crossbow: { cost: 100, interval: 2.5, boltSpeed: 45, damage: 40, pierce: 5, pierceFalloff: 0.2, knockback: 5, range: 75, footprint: 1.4 },
  /**
   * A squad of archers looses a volley together at the thickest crowd in range.
   * Arrows arc high and rain down around the target; each one hits whoever it lands on.
   */
  archers: {
    cost: 80, archers: 30, interval: 4, damage: 2.4, range: 66, flightTime: 1.7, spread: 2.6, hitRadius: 0.75,
    burnSeconds: 3, footprint: 2.6,
  },
  catapult: { cost: 150, interval: 5, damage: 30, splash: 3.3, range: 66, flightTime: 1.6, knockback: 6, footprint: 1.8 },
  /**
   * The soldiers are the last line of defence: companies spread along the foot of the wall
   * and rush any orc that gets close to it. The fallen return each wave.
   */
  soldiers: { cost: 60, count: 40, maxCompanies: 3, hp: 16, dps: 1.6, reach: 1.1, y: 2.2, guard: 4.5, heavyGuard: 2.5, speed: 4 },
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
  /** A massive royal shield, wide enough to catch a battery's worth of boulders. */
  shield: {
    y: 4, halfWidth: 5.5, maxEnergy: 100, drainPerSec: 16, regenPerSec: 12,
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
    chuckersFromWave: 2,
    chuckerShare: 0.12,
    ridersFromWave: 6,
    riderShare: 0.15,
    /** Orc catapults come every wave on top of the budget: base + perWave * (n - 1). */
    orcCatapultsBase: 2,
    orcCatapultsPerWave: 0.3,
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
