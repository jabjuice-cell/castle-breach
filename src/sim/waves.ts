import type { Config } from './config';
import { Rng } from './rng';

export const ENEMY_KINDS = ['grunt', 'chucker', 'barrel', 'rider', 'orcCatapult', 'ogre', 'warlord'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** The outline a block of orcs keeps as it marches: the bricks of the Breakout wall. */
export const SHAPES = ['rect', 'wedge', 'column', 'line'] as const;
export type Shape = (typeof SHAPES)[number];

/** One marching block: a formation of orcs that arrives together and keeps its shape. */
export interface SpawnGroup {
  time: number;
  x: number;
  shape: Shape;
  /** Front ranks first: catapults always go at the back. */
  members: { kind: EnemyKind; count: number }[];
}

export interface WavePlan {
  number: number;
  groups: SpawnGroup[];
  totals: Record<EnemyKind, number>;
  boss: boolean;
  /** A siege tower rolls down the middle this wave. */
  tower: boolean;
}

/** The wave's threat budget in grunt-equivalents. */
export function waveBudget(n: number, cfg: Config): number {
  return cfg.waves.budgetBase * cfg.waves.budgetGrowth ** (n - 1);
}

/** How many blocks of foot orcs (grunts and chuckers) a wave sends. */
export function blockCount(n: number, cfg: Config): number {
  const w = cfg.waves;
  return Math.min(w.blocksMax, w.blocksBase + Math.floor((n - 1) / w.blocksEvery));
}

/** Formation offsets for n orcs, front rank first: dy grows away from the wall. */
export function formation(shape: Shape, n: number, spacing: number): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  if (n <= 0) return out;
  if (shape === 'wedge') {
    // The point leads: row r holds 2r + 1 orcs.
    for (let r = 0; out.length < n; r++) {
      const inRow = Math.min(2 * r + 1, n - out.length);
      for (let i = 0; i < inRow; i++) out.push({ dx: (i - (inRow - 1) / 2) * spacing, dy: r * spacing * 0.9 });
    }
    return out;
  }
  const cols = shape === 'column'
    ? Math.max(2, Math.ceil(Math.sqrt(n / 2.5)))
    : shape === 'line'
      ? Math.max(3, Math.ceil(n / 2))
      : Math.max(3, Math.ceil(Math.sqrt(n * 2.2)));
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    out.push({ dx: ((i % cols) - (inRow - 1) / 2) * spacing, dy: row * spacing * 0.9 });
  }
  return out;
}

/**
 * Plans a whole wave up front, so the preview shows exactly what will come
 * and from where. Randomised per wave from the run seed.
 */
export function planWave(n: number, seed: number, cfg: Config): WavePlan {
  const rng = new Rng(seed * 7919 + n * 104729);
  const w = cfg.waves;
  const budget = Math.round(waveBudget(n, cfg));
  const totals: Record<EnemyKind, number> = { grunt: 0, chucker: 0, barrel: 0, rider: 0, orcCatapult: 0, ogre: 0, warlord: 0 };

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
  // Catapults come every wave on top of the budget: they are where the balls come from.
  totals.orcCatapult = Math.min(w.orcCatapultsMax, Math.floor(w.orcCatapultsBase + w.orcCatapultsPerWave * (n - 1)));
  const tower = w.towerWaves.includes(n);
  if (w.warlordWaves.includes(n)) totals.warlord = 1;
  const boss = tower || totals.warlord > 0;
  const blocks = blockCount(n, cfg);
  // Barrel orcs replace grunts, a few per block.
  if (n >= w.barrelsFromWave) {
    const per = Math.min(w.barrelsMax, 1 + Math.floor((n - w.barrelsFromWave) / w.barrelsEvery));
    totals.barrel = Math.min(totals.grunt, per * blocks);
    totals.grunt -= totals.barrel;
  }

  const duration = Math.min(w.spawnMax, w.spawnBase + w.spawnPerWave * n);
  const edge = cfg.field.halfWidth - 5;
  const groups: SpawnGroup[] = [];
  // Foot orcs are split across the blocks; catapults stand at the back of them.
  const split = (total: number, i: number) => Math.floor((total * (i + 1)) / blocks) - Math.floor((total * i) / blocks);
  const lanes = Array.from({ length: blocks }, (_, i) => -edge + ((i + 0.5) / blocks) * edge * 2);
  rng.shuffle(lanes);
  for (let i = 0; i < blocks; i++) {
    const members = [
      { kind: 'grunt' as const, count: split(totals.grunt, i) },
      { kind: 'chucker' as const, count: split(totals.chucker, i) },
      { kind: 'barrel' as const, count: split(totals.barrel, i) },
      { kind: 'orcCatapult' as const, count: split(totals.orcCatapult, i) },
    ].filter((m) => m.count > 0);
    if (members.length === 0) continue;
    const shape = (['rect', 'wedge', 'column'] as const)[rng.int(0, 2)];
    const time = i === 0 ? 0 : rng.range(0, duration);
    groups.push({ time, x: lanes[i] + rng.range(-2, 2), shape, members });
  }
  // Riders come as a skirmish line that zig-zags across the field.
  let riders = totals.rider;
  while (riders > 0) {
    const count = Math.min(riders, rng.int(5, 10));
    groups.push({ time: rng.range(2, duration), x: rng.range(-edge, edge), shape: 'line', members: [{ kind: 'rider', count }] });
    riders -= count;
  }
  for (let i = 0; i < totals.ogre; i++) {
    groups.push({ time: rng.range(2, duration), x: rng.range(-edge, edge), shape: 'rect', members: [{ kind: 'ogre', count: 1 }] });
  }
  if (totals.warlord) groups.push({ time: tower ? 0 : duration * 0.4, x: 0, shape: 'rect', members: [{ kind: 'warlord', count: 1 }] });
  groups.sort((a, b) => a.time - b.time);
  return { number: n, groups, totals, boss, tower };
}

/** Enemies the wave sends (a siege tower counts as one, plus the orcs on its floors). */
export function planSize(plan: WavePlan): number {
  return ENEMY_KINDS.reduce((s, k) => s + plan.totals[k], 0);
}
