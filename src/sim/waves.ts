import type { Config } from './config';
import { Rng } from './rng';

export type EnemyKind = 'grunt' | 'chucker';

/** A battalion: a tight group of one enemy kind that marches in together. */
export interface SpawnGroup {
  time: number;
  x: number;
  kind: EnemyKind;
  count: number;
}

export interface WavePlan {
  number: number;
  groups: SpawnGroup[];
  totals: Record<EnemyKind, number>;
}

/** The wave's threat budget in grunt-equivalents. */
export function waveBudget(n: number, cfg: Config): number {
  return cfg.waves.budgetBase * cfg.waves.budgetGrowth ** (n - 1);
}

/**
 * Plans a whole wave up front, so the preview shows exactly what will come
 * and from where. Randomised per wave from the run seed.
 */
export function planWave(n: number, seed: number, cfg: Config): WavePlan {
  const rng = new Rng(seed * 7919 + n * 104729);
  const budget = Math.round(waveBudget(n, cfg));
  const chuckerBudget = n >= cfg.waves.chuckersFromWave ? Math.round(budget * cfg.waves.chuckerShare) : 0;
  const chuckers = Math.max(n >= cfg.waves.chuckersFromWave ? 1 : 0, Math.floor(chuckerBudget / cfg.chucker.threat));
  const grunts = Math.max(0, budget - chuckers * cfg.chucker.threat) / cfg.grunt.threat;
  const duration = 8 + n;
  const edge = cfg.field.halfWidth - 2;
  const groups: SpawnGroup[] = [];

  let left = Math.round(grunts);
  const totalGrunts = left;
  while (left > 0) {
    const count = Math.min(left, rng.int(6, 12));
    groups.push({ time: rng.range(0, duration), x: rng.range(-edge, edge), kind: 'grunt', count });
    left -= count;
  }
  left = chuckers;
  while (left > 0) {
    const count = Math.min(left, rng.int(1, 3));
    groups.push({ time: rng.range(1, duration), x: rng.range(-edge, edge), kind: 'chucker', count });
    left -= count;
  }
  groups.sort((a, b) => a.time - b.time);
  return { number: n, groups, totals: { grunt: totalGrunts, chucker: chuckers } };
}
