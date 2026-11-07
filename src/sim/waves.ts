import type { Config } from './config';
import { Rng } from './rng';

export const ENEMY_KINDS = ['grunt', 'chucker', 'barrel', 'runner', 'rider', 'orcCatapult', 'ogre', 'warlord', 'shieldOrc', 'drummer'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** The outline a block of orcs keeps as it marches: the bricks of the Breakout wall. */
export const SHAPES = ['rect', 'wedge', 'column', 'line', 'pins', 'bricks', 'diamond', 'vee', 'checker'] as const;
export type Shape = (typeof SHAPES)[number];

/**
 * How a block moves down the field (Jonny, 7 Nov: attack patterns like Space Invaders groups).
 * march: straight down. invader: sweeps side to side and steps down at each end. weave: snakes
 * from side to side as it marches. surge: rushes forward, stops, rushes again.
 */
export const MOVES = ['march', 'invader', 'weave', 'surge'] as const;
export type Move = (typeof MOVES)[number];

/**
 * A wave's attack pattern, picked per wave so no two feel the same.
 * staggered: blocks arrive one by one down the lanes. fleet: the blocks line up side by side and sweep
 * across together like an invader fleet. snakes: narrow columns weave down. rush: the blocks surge in bursts.
 * pincer: two blocks come down the sides while the rest follow up the middle.
 */
export const PATTERNS = ['staggered', 'fleet', 'snakes', 'rush', 'pincer'] as const;
export type Pattern = (typeof PATTERNS)[number];

/** One marching block: a formation of orcs that arrives together and keeps its shape. */
export interface SpawnGroup {
  time: number;
  /** The lane it comes down: one per wall section, 0 = far left. */
  lane: number;
  x: number;
  shape: Shape;
  /** Front ranks first: catapults always go at the back. */
  members: { kind: EnemyKind; count: number }[];
  /** A brick wall: orcs per row (its rows are count / cols). */
  cols?: number;
  /** How it moves (march when left out). */
  move?: Move;
  /** An invader or weave block swings this far either side of where it came in. */
  sweep?: number;
}

export interface WavePlan {
  number: number;
  groups: SpawnGroup[];
  totals: Record<EnemyKind, number>;
  boss: boolean;
  /** A siege tower rolls down the middle this wave. */
  tower: boolean;
  /** The wave's attack pattern. */
  pattern: Pattern;
}

/** The attack pattern of wave n: wave 1 is always staggered; after that each wave picks a fresh one. */
export function wavePattern(n: number, seed: number): Pattern {
  if (n <= 1) return 'staggered';
  const rng = new Rng(seed * 4513 + n * 6151 + 11);
  // Never the same pattern twice in a row.
  const prev = n > 2 ? wavePattern(n - 1, seed) : 'staggered';
  const options = PATTERNS.filter((p) => p !== prev);
  return options[rng.int(0, options.length - 1)];
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

/** Gap between orcs in a brick wall: shoulder to shoulder, too tight for a ball to slip through. */
export const BRICK_SPACING = 1.05;

/** A brick-wall wave: every brickWall.every-th wave from brickWall.fromWave. */
export function isBrickWave(n: number, cfg: Config): boolean {
  const b = cfg.brickWall;
  return n >= b.fromWave && (n - b.fromWave) % b.every === 0;
}

/** Helmet layers for a brick-wall row (0 = front): bare at the front, helmets behind, iron at the back. */
export function brickHelmet(row: number, rows: number): number {
  return Math.min(2, Math.floor((row * 3) / Math.max(1, rows)));
}

/** Formation offsets for n orcs, front rank first: dy grows away from the wall. cols: a brick wall's row length. */
export function formation(shape: Shape, n: number, spacing: number, cols = 0): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  if (n <= 0) return out;
  if (shape === 'bricks') {
    // Straight rows, shoulder to shoulder; a short last row is centred.
    const per = Math.max(1, cols || Math.ceil(Math.sqrt(n * 4)));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / per);
      const inRow = Math.min(per, n - row * per);
      out.push({ dx: ((i % per) - (inRow - 1) / 2) * BRICK_SPACING, dy: row * BRICK_SPACING });
    }
    return out;
  }
  if (shape === 'wedge') {
    // The point leads: row r holds 2r + 1 orcs.
    for (let r = 0; out.length < n; r++) {
      const inRow = Math.min(2 * r + 1, n - out.length);
      for (let i = 0; i < inRow; i++) out.push({ dx: (i - (inRow - 1) / 2) * spacing, dy: r * spacing * 0.9 });
    }
    return out;
  }
  if (shape === 'pins') {
    // A triangle, point leading: row r holds r + 1 orcs.
    const sp = spacing * 1.4;
    for (let r = 0; out.length < n; r++) {
      const inRow = Math.min(r + 1, n - out.length);
      for (let i = 0; i < inRow; i++) out.push({ dx: (i - (inRow - 1) / 2) * sp, dy: r * sp * 0.9 });
    }
    return out;
  }
  if (shape === 'diamond') {
    // Widening to the middle row, then narrowing again.
    const mid = Math.max(1, Math.ceil(Math.sqrt(n)));
    for (let r = 0; out.length < n; r++) {
      const want = r < mid ? 2 * r + 1 : Math.max(1, 2 * (2 * mid - 2 - r) + 1);
      const inRow = Math.min(want, n - out.length);
      for (let i = 0; i < inRow; i++) out.push({ dx: (i - (inRow - 1) / 2) * spacing, dy: r * spacing * 0.8 });
    }
    return out;
  }
  if (shape === 'vee') {
    // Two arms reaching forward, the middle hanging back: a ball gets into the pocket.
    const arm = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(i / 2);
      const side = i % 2 ? 1 : -1;
      out.push({ dx: side * (k + 0.5) * spacing * 0.9, dy: (arm - k) * spacing * 0.7 });
    }
    return out;
  }
  if (shape === 'checker') {
    // A chequerboard: every other slot empty, so balls rattle through the gaps.
    const across = Math.max(3, Math.ceil(Math.sqrt(n * 2)));
    for (let i = 0; out.length < n; i++) {
      const row = Math.floor(i / across);
      const col = i % across;
      if ((row + col) % 2) continue;
      out.push({ dx: (col - (across - 1) / 2) * spacing, dy: row * spacing * 0.9 });
    }
    return out;
  }
  const across = shape === 'column'
    ? Math.max(2, Math.ceil(Math.sqrt(n / 2.5)))
    : shape === 'line'
      ? Math.max(3, Math.ceil(n / 2))
      : Math.max(3, Math.ceil(Math.sqrt(n * 2.2)));
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / across);
    const inRow = Math.min(across, n - row * across);
    out.push({ dx: ((i % across) - (inRow - 1) / 2) * spacing, dy: row * spacing * 0.9 });
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
  const totals: Record<EnemyKind, number> = { grunt: 0, chucker: 0, barrel: 0, runner: 0, rider: 0, orcCatapult: 0, ogre: 0, warlord: 0, shieldOrc: 0, drummer: 0 };

  // Specialists take a share of the budget each (at least one once unlocked); grunts fill the rest.
  const shares: [EnemyKind, number, number][] = [
    ['chucker', w.chuckersFromWave, w.chuckerShare],
    ['runner', w.runnersFromWave, w.runnerShare],
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
  const groups: SpawnGroup[] = [];
  const pattern = wavePattern(n, seed);
  // The pattern's own stream, so the rest of the plan is the same whatever pattern it gets.
  const prng = new Rng(seed * 613 + n * 7393 + 3);
  // A brick-wall wave: a wide wall of grunts leads, made from the wave's grunts plus a few extra.
  // The rest of the blocks keep at least a handful each. Its own rng stream, so other waves are unchanged.
  if (isBrickWave(n, cfg)) {
    const bw = cfg.brickWall;
    const rows = Math.min(bw.maxRows, bw.minRows + Math.floor((n - bw.fromWave) / bw.every));
    const maxCols = Math.floor((cfg.field.halfWidth * 2 * bw.width) / BRICK_SPACING);
    const spare = Math.max(0, totals.grunt - 4 * blocks) + bw.extraGrunts;
    const cols = Math.min(maxCols, Math.floor(spare / rows));
    if (cols >= 6) {
      const count = cols * rows;
      const taken = Math.min(count, Math.max(0, totals.grunt - 4 * blocks));
      totals.grunt -= taken;
      groups.push({ time: 0, lane: Math.floor(cfg.wall.segments / 2), x: 0, shape: 'bricks', members: [{ kind: 'grunt', count }], cols });
    }
  }
  // Foot orcs are split across the blocks; catapults stand at the back of them.
  const split = (total: number, i: number) => Math.floor((total * (i + 1)) / blocks) - Math.floor((total * i) / blocks);
  // Five lanes, one per wall section. Foot blocks keep to the path down the middle three;
  // the riders come through the sides.
  const segs = cfg.wall.segments;
  const laneX = (lane: number) => -cfg.field.halfWidth + ((lane + 0.5) / segs) * cfg.field.halfWidth * 2;
  const path = [...Array(segs).keys()].slice(1, segs - 1);
  const lanes = rng.shuffle([...path]);
  while (lanes.length < blocks) lanes.push(path[rng.int(0, path.length - 1)]);
  // Pins blocks and shield guards are decided on their own stream, so earlier waves and streams are unchanged.
  const cfgGrunt = totals.grunt;
  const srng = new Rng(seed * 31 + n * 977 + 5);
  const pins: boolean[] = [];
  const shields: number[] = [];
  const guard = Math.min(w.shieldsMax, 3 + Math.floor((n - w.shieldsFromWave) / w.shieldsEvery));
  for (let i = 0; i < blocks; i++) {
    const isPins = n >= w.pinsFromWave && srng.next() < w.pinsChance;
    pins.push(isPins);
    shields.push(!isPins && n >= w.shieldsFromWave ? Math.min(guard, split(totals.grunt, i)) : 0);
  }
  totals.shieldOrc = shields.reduce((s, c) => s + c, 0);
  totals.drummer = shields.filter((c) => c >= 3).length;
  totals.grunt -= totals.shieldOrc;
  for (let i = 0; i < blocks; i++) {
    const members = [
      { kind: 'grunt' as const, count: Math.floor((cfgGrunt * (i + 1)) / blocks) - Math.floor((cfgGrunt * i) / blocks) - shields[i] },
      { kind: 'shieldOrc' as const, count: shields[i] },
      { kind: 'chucker' as const, count: split(totals.chucker, i) },
      { kind: 'barrel' as const, count: split(totals.barrel, i) },
      { kind: 'drummer' as const, count: shields[i] >= 3 ? 1 : 0 },
      { kind: 'orcCatapult' as const, count: split(totals.orcCatapult, i) },
    ].filter((m) => m.count > 0);
    if (members.length === 0) continue;
    const picked = (['rect', 'wedge', 'column'] as const)[rng.int(0, 2)];
    const time = i === 0 && groups.length === 0 ? 0 : rng.range(i === 0 ? 3 : 0, duration);
    groups.push({ time, lane: lanes[i], x: laneX(lanes[i]) + rng.range(-1.5, 1.5), shape: pins[i] ? 'pins' : picked, members });
  }
  shapeWave(pattern, groups.filter((g) => g.shape !== 'bricks' && g.shape !== 'pins'), cfg, prng, duration);
  // Goblin runners sprint down the side lanes in small loose packs.
  let runners = totals.runner;
  while (runners > 0) {
    const count = Math.min(runners, rng.int(3, 6));
    const lane = rng.next() < 0.5 ? 0 : segs - 1;
    groups.push({ time: rng.range(1, duration), lane, x: laneX(lane) + rng.range(-1, 1), shape: 'wedge', members: [{ kind: 'runner', count }] });
    runners -= count;
  }
  // Riders come as a skirmish line that zig-zags across the field.
  let riders = totals.rider;
  while (riders > 0) {
    const count = Math.min(riders, rng.int(5, 10));
    // Riders take the edge lanes.
    const lane = rng.next() < 0.5 ? 0 : segs - 1;
    groups.push({ time: rng.range(2, duration), lane, x: laneX(lane), shape: 'line', members: [{ kind: 'rider', count }] });
    riders -= count;
  }
  for (let i = 0; i < totals.ogre; i++) {
    const lane = rng.int(0, segs - 1);
    groups.push({ time: rng.range(2, duration), lane, x: laneX(lane), shape: 'rect', members: [{ kind: 'ogre', count: 1 }] });
  }
  if (totals.warlord && !tower) groups.push({ time: duration * 0.4, lane: Math.floor(segs / 2), x: 0, shape: 'rect', members: [{ kind: 'warlord', count: 1 }] });
  groups.sort((a, b) => a.time - b.time);
  totals.grunt = groups.reduce((s, g) => s + g.members.reduce((t, m) => t + (m.kind === 'grunt' ? m.count : 0), 0), 0);
  return { number: n, groups, totals, boss, tower, pattern };
}

/** Reshapes the wave's foot blocks for its attack pattern. */
function shapeWave(pattern: Pattern, blocks: SpawnGroup[], cfg: Config, rng: Rng, duration: number): void {
  if (!blocks.length) return;
  const hw = cfg.field.halfWidth;
  if (pattern === 'fleet') {
    // Side by side across the field, arriving together, sweeping across and stepping down in step.
    // A big wave sends its fleet in two ranks.
    const ranks = blocks.length > 3 ? 2 : 1;
    const per = Math.ceil(blocks.length / ranks);
    const t0 = rng.range(0, 2);
    blocks.forEach((g, i) => {
      const rank = Math.floor(i / per);
      const inRank = Math.min(per, blocks.length - rank * per);
      const col = i - rank * per;
      g.x = ((col + 0.5) / inRank - 0.5) * hw * 1.3;
      g.time = t0 + rank * duration * 0.35;
      g.shape = (['rect', 'checker', 'diamond'] as const)[rng.int(0, 2)];
      g.move = 'invader';
      g.sweep = Math.min(6, hw * 0.35 / inRank + 2);
    });
  } else if (pattern === 'snakes') {
    for (const g of blocks) {
      g.shape = 'column';
      g.move = 'weave';
      g.sweep = rng.range(3, 6);
    }
  } else if (pattern === 'rush') {
    for (const g of blocks) {
      g.shape = (['wedge', 'vee', 'diamond'] as const)[rng.int(0, 2)];
      g.move = 'surge';
    }
  } else if (pattern === 'pincer') {
    // The first two blocks come down the flanks together; the rest follow up the middle a little later.
    blocks.forEach((g, i) => {
      if (i < 2) {
        g.x = (i ? 1 : -1) * hw * 0.62;
        g.time = 0;
        g.shape = 'column';
      } else {
        g.x = rng.range(-3, 3);
        g.time = Math.max(g.time, 6);
        g.shape = (['vee', 'wedge'] as const)[rng.int(0, 1)];
      }
    });
  }
}

/** Enemies the wave sends (a siege tower counts as one, plus the orcs on its floors). */
export function planSize(plan: WavePlan): number {
  return ENEMY_KINDS.reduce((s, k) => s + plan.totals[k], 0);
}
