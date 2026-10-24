/**
 * Every tuning number for the combat slice lives here, so balance sims can
 * override any of them without touching game code. First-pass values come
 * from the "Buildable design" page in Notion.
 *
 * Coordinates: x runs across the field, y runs away from the castle.
 * The wall's front face is at y = 0; enemies spawn near y = field.spawnY.
 */
export const defaultConfig = {
  field: { halfWidth: 20, spawnY: 70 },
  /** The run is lost when any one segment reaches 0 HP. */
  wall: { segments: 5, segmentHp: 400, depth: 2, warnBelow: 0.25 },
  grunt: { hp: 10, speed: 2.2, radius: 0.5, wallDps: 1, climbSeconds: 3, gold: 1, threat: 1 },
  /** Grunt variant that stops up the field and lobs rocks at the battlements. */
  chucker: {
    hp: 10, speed: 2.2, radius: 0.5, wallDps: 1, climbSeconds: 3, gold: 2, threat: 2,
    standMinY: 22, standMaxY: 30, throwInterval: 3,
  },
  rock: { speed: 12, wallDamage: 5, radius: 0.4, deflectDamage: 10 },
  crossbow: { x: 0, interval: 2.5, boltSpeed: 45, damage: 40, pierce: 5, pierceFalloff: 0.2, knockback: 5, range: 75 },
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
  waves: {
    previewSeconds: 8,
    /** Threat budget in grunt-equivalents: base * growth^(wave - 1). */
    budgetBase: 20,
    budgetGrowth: 1.17,
    chuckersFromWave: 3,
    chuckerShare: 0.2,
    /** The slice ends in victory after this wave. */
    finalWave: 10,
  },
};

export type Config = typeof defaultConfig;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function makeConfig(overrides: DeepPartial<Config> = {}): Config {
  const cfg = structuredClone(defaultConfig);
  for (const [group, values] of Object.entries(overrides)) {
    Object.assign((cfg as Record<string, object>)[group], values);
  }
  return cfg;
}
