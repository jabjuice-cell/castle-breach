import type { Config } from './config';
import { Rng } from './rng';

export const ENEMY_KINDS = ['grunt', 'chucker', 'rider', 'orcCatapult', 'ogre', 'warlord'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

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
  boss: boolean;
}

/** The wave's threat budget in grunt-equivalents. */
export function waveBudget(n: number, cfg: Config): number {
  return cfg.waves.budgetBase * cfg.waves.budgetGrowth ** (n - 1);
}

/** Battalion sizes per kind. */
const BATTALION: Record<EnemyKind, [number, number]> = {
  grunt: [18, 36],
  chucker: [1, 3],
  rider: [6, 12],
  orcCatapult: [1, 2],
  ogre: [1, 2],
  warlord: [1, 1],
};

/**
 * Plans a whole wave up front, so the preview shows exactly what will come
 * and from where. Randomised per wave from the run seed.
 */
export function planWave(n: number, seed: number, cfg: Config): WavePlan {
  const rng = new Rng(seed * 7919 + n * 104729);
  const w = cfg.waves;
  const budget = Math.round(waveBudget(n, cfg));
  const totals: Record<EnemyKind, number> = { grunt: 0, chucker: 0, rider: 0, orcCatapult: 0, ogre: 0, warlord: 0 };

  // Specialists take a share of the budget each (at least one once unlocked); grunts fill the rest.
  const shares: [EnemyKind, number, number][] = [
    ['chucker', w.chuckersFromWave, w.chuckerShare],
    ['rider', w.ridersFromWave, w.riderShare],
    ['ogre', w.ogresFromWave, w.ogreShare],
  ];
  let left = budget;
  for (const [kind, from, share] of shares) {
    if (n < from) continue;
    const threat = cfg[kind].threat;
    const count = Math.max(1, Math.floor((budget * share) / threat));
    const affordable = Math.min(count, Math.floor(left / threat));
    totals[kind] = affordable;
    left -= affordable * threat;
  }
  totals.grunt = Math.max(0, Math.round(left / cfg.grunt.threat));
  // Catapults come every wave on top of the budget, so there is always something to deflect.
  totals.orcCatapult = Math.floor(w.orcCatapultsBase + w.orcCatapultsPerWave * (n - 1));
  const boss = w.bossWaves.includes(n);
  if (boss) totals.warlord = 1;

  const duration = Math.min(w.spawnMax, w.spawnBase + w.spawnPerWave * n);
  const edge = cfg.field.halfWidth - 2;
  const groups: SpawnGroup[] = [];
  for (const kind of ENEMY_KINDS) {
    let remaining = totals[kind];
    const [lo, hi] = BATTALION[kind];
    while (remaining > 0) {
      const count = Math.min(remaining, rng.int(lo, hi));
      const time = kind === 'warlord' ? duration * 0.4 : rng.range(kind === 'grunt' ? 0 : 1, duration);
      const x = kind === 'warlord' ? 0 : rng.range(-edge, edge);
      groups.push({ time, x, kind, count });
      remaining -= count;
    }
  }
  groups.sort((a, b) => a.time - b.time);
  return { number: n, groups, totals, boss };
}

export function planSize(plan: WavePlan): number {
  return ENEMY_KINDS.reduce((s, k) => s + plan.totals[k], 0);
}
