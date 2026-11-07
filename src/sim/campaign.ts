import { type Config, makeConfig } from './config';
import type { LayoutCounts } from './contraptions';
import type { Obstacle } from './obstacles';

/**
 * The campaign (Jonny, 7 Nov): an overmap of acts, each a road of stages of a few waves.
 * Every stage has its own battlefield (structures, width, trees) and its own pinball features,
 * so no two play alike and the bells are not on every field. The last stage of an act is a boss.
 *
 * A stage's difficulty is set by firstWave: the wave number its first wave plays as (the old
 * 15-wave run spread over the acts), so the wave planner and its tuning are unchanged.
 * No rendering in here: the overmap (main.ts) draws from these definitions.
 */

/** The pinball features on a stage's field: the per-wave contraptions, plus fixed rails and drop-target banks. */
export interface StageFeatures extends LayoutCounts {
  /** Orbit rails: 1 enters on the left, 2 adds a mirrored one entering on the right. */
  rail: number;
}

export interface StageDef {
  /** Stable id for the save, e.g. '1-3'. */
  id: string;
  act: number;
  /** Position within the act, from 0. */
  index: number;
  name: string;
  /** One line for the overmap card. */
  blurb: string;
  waves: number;
  /** The difficulty wave number its first wave plays as. */
  firstWave: number;
  boss?: 'tower' | 'warlord';
  halfWidth: number;
  segments: number;
  trees: number;
  features: StageFeatures;
  obstacles: Obstacle[];
  warChest: number;
  /** Renown for clearing it. */
  renown: number;
  /** Where it sits on the act's overmap (0 to 1 across, 0 at the top). */
  map: { x: number; y: number };
}

export interface ActDef {
  name: string;
  blurb: string;
}

export const ACTS: ActDef[] = [
  { name: 'Act I: The Old Road', blurb: 'The orcs come down the old road through the farms. Their plan is mostly shouting.' },
  { name: 'Act II: Mill Ford', blurb: 'Wider fields by the river and the mill. They have brought a siege tower. Somebody drew it for them.' },
  { name: 'Act III: The Black Gate', blurb: 'Standing stones, ash and ruins at the edge of orc country. The Warlord has dressed up.' },
];

const f = (bumper: number, bell: number, ramp: number, rail: number, target: number): StageFeatures => ({ bumper, bell, ramp, rail, target });

const NARROW = { halfWidth: 20, segments: 5 };
const WIDE = { halfWidth: 28, segments: 7 };

export const STAGES: StageDef[] = [
  // ---- Act I: a narrow road, five wall sections ----------------------------------------
  {
    id: '1-1', act: 0, index: 0, name: 'Turnip Fields', blurb: 'Open fields and a couple of boulders. Two spring shields to bank off.',
    waves: 3, firstWave: 1, ...NARROW, trees: 6, features: f(2, 0, 0, 0, 0), warChest: 400, renown: 30, map: { x: 0.12, y: 0.78 },
    obstacles: [
      { look: 'boulder', x: -12.5, y: 34, r: 1.6 },
      { look: 'boulder', x: 12, y: 25, r: 1.3 },
    ],
  },
  {
    id: '1-2', act: 0, index: 1, name: 'The Old Road', blurb: 'An old milestone and a set of bells: ring all four for a free volley.',
    waves: 3, firstWave: 2, ...NARROW, trees: 8, features: f(0, 4, 0, 0, 0), warChest: 420, renown: 35, map: { x: 0.34, y: 0.55 },
    obstacles: [
      { look: 'milestone', x: 4.5, y: 46, r: 0.6 },
      { look: 'boulder', x: -15, y: 22, r: 1.2 },
      { look: 'fence', x: 13, y: 38, hw: 2.2, hh: 0.3, angle: 0.4 },
    ],
  },
  {
    id: '1-3', act: 0, index: 2, name: "Hob's Orchard", blurb: 'A ramp to fling the ball over the front ranks, and straw targets to knock down for a bonus ball.',
    waves: 3, firstWave: 3, ...NARROW, trees: 12, features: f(0, 0, 1, 0, 1), warChest: 450, renown: 40, map: { x: 0.6, y: 0.66 },
    obstacles: [
      { look: 'well', x: -9, y: 40, r: 1.1 },
      { look: 'boulder', x: 14, y: 50, r: 1.4 },
    ],
  },
  {
    id: '1-4', act: 0, index: 3, name: 'Goblin Bridge', blurb: 'Boss: the siege tower rolls down the road. An orbit rail runs out round the trees.',
    waves: 4, firstWave: 3, boss: 'tower', ...NARROW, trees: 8, features: f(2, 0, 0, 1, 0), warChest: 500, renown: 80, map: { x: 0.86, y: 0.32 },
    obstacles: [
      { look: 'fence', x: -12, y: 30, hw: 2.4, hh: 0.3, angle: -0.5 },
      { look: 'fence', x: 12, y: 30, hw: 2.4, hh: 0.3, angle: 0.5 },
    ],
  },
  // ---- Act II: wider fields by the river, seven wall sections ---------------------------
  {
    id: '2-1', act: 1, index: 0, name: 'Mill Ford', blurb: 'The ruined mill, a well and a broken fence. An orbit rail and two bumpers.',
    waves: 3, firstWave: 5, ...WIDE, trees: 9, features: f(2, 0, 0, 1, 0), warChest: 550, renown: 60, map: { x: 0.1, y: 0.4 },
    obstacles: [
      { look: 'mill', x: -16, y: 40, hw: 2.6, hh: 1.6, angle: 0.3 },
      { look: 'well', x: 6.5, y: 30, r: 1.1 },
      { look: 'fence', x: 18, y: 20, hw: 2.4, hh: 0.3, angle: -0.5 },
      { look: 'boulder', x: -6.5, y: 51, r: 1.2 },
    ],
  },
  {
    id: '2-2', act: 1, index: 1, name: 'Windmill Hill', blurb: 'Two banks of drop targets and a ramp up the hill.',
    waves: 3, firstWave: 6, ...WIDE, trees: 10, features: f(0, 0, 1, 0, 2), warChest: 580, renown: 65, map: { x: 0.36, y: 0.7 },
    obstacles: [
      { look: 'mill', x: 15, y: 46, hw: 2.6, hh: 1.6, angle: -0.4 },
      { look: 'boulder', x: -18, y: 30, r: 1.5 },
      { look: 'boulder', x: -4, y: 52, r: 1 },
      { look: 'fence', x: -10, y: 18, hw: 2, hh: 0.3, angle: 0.2 },
    ],
  },
  {
    id: '2-3', act: 1, index: 2, name: 'The Drowned Meadow', blurb: 'Bells in the reeds and rails out round both tree lines.',
    waves: 3, firstWave: 7, ...WIDE, trees: 14, features: f(0, 4, 0, 2, 0), warChest: 600, renown: 70, map: { x: 0.62, y: 0.46 },
    obstacles: [
      { look: 'well', x: 0, y: 44, r: 1.3 },
      { look: 'stone', x: -14, y: 26, r: 0.9 },
      { look: 'stone', x: 14, y: 26, r: 0.9 },
    ],
  },
  {
    id: '2-4', act: 1, index: 3, name: 'Siege of the Ford', blurb: 'Boss: the siege tower, with bumpers and a ramp to get over its escort.',
    waves: 4, firstWave: 7, boss: 'tower', ...WIDE, trees: 9, features: f(3, 0, 1, 0, 0), warChest: 650, renown: 140, map: { x: 0.88, y: 0.22 },
    obstacles: [
      { look: 'mill', x: -18, y: 42, hw: 2.6, hh: 1.6, angle: 0.25 },
      { look: 'fence', x: 17, y: 22, hw: 2.4, hh: 0.3, angle: -0.4 },
      { look: 'boulder', x: 20, y: 48, r: 1 },
    ],
  },
  // ---- Act III: the Black Gate, standing stones and slanted ruins -----------------------
  {
    id: '3-1', act: 2, index: 0, name: 'Ash Road', blurb: 'Ruined walls that throw the ball about, a rail and a target bank.',
    waves: 3, firstWave: 10, ...WIDE, trees: 6, features: f(0, 0, 0, 1, 1), warChest: 700, renown: 100, map: { x: 0.14, y: 0.66 },
    obstacles: [
      { look: 'ruin', x: -17, y: 33, hw: 3, hh: 0.6, angle: 0.6 },
      { look: 'ruin', x: 17, y: 33, hw: 3, hh: 0.6, angle: -0.6 },
      { look: 'stone', x: -21, y: 52, r: 1.1 },
      { look: 'stone', x: 21, y: 54, r: 1.1 },
    ],
  },
  {
    id: '3-2', act: 2, index: 1, name: 'Spike Gully', blurb: 'Spikes and standing stones, three bumpers and a set of bells.',
    waves: 3, firstWave: 11, ...WIDE, trees: 7, features: f(3, 4, 0, 0, 0), warChest: 720, renown: 110, map: { x: 0.4, y: 0.4 },
    obstacles: [
      { look: 'spikes', x: -8, y: 45, hw: 1.8, hh: 0.5, angle: -0.35 },
      { look: 'spikes', x: 8, y: 45, hw: 1.8, hh: 0.5, angle: 0.35 },
      { look: 'stone', x: -5, y: 22, r: 0.8 },
      { look: 'stone', x: 5, y: 22, r: 0.8 },
    ],
  },
  {
    id: '3-3', act: 2, index: 2, name: 'The Black Gate', blurb: 'Both orbit rails, two ramps and the slanted ruins.',
    waves: 3, firstWave: 12, ...WIDE, trees: 8, features: f(0, 0, 2, 2, 0), warChest: 750, renown: 120, map: { x: 0.66, y: 0.7 },
    obstacles: [
      { look: 'stone', x: -5, y: 22, r: 0.8 },
      { look: 'stone', x: 5, y: 22, r: 0.8 },
      { look: 'ruin', x: -17, y: 33, hw: 3, hh: 0.6, angle: 0.6 },
      { look: 'ruin', x: 17, y: 33, hw: 3, hh: 0.6, angle: -0.6 },
      { look: 'spikes', x: -8, y: 45, hw: 1.8, hh: 0.5, angle: -0.35 },
      { look: 'spikes', x: 8, y: 45, hw: 1.8, hh: 0.5, angle: 0.35 },
    ],
  },
  {
    id: '3-4', act: 2, index: 3, name: "The Warlord's March", blurb: 'Boss: the Warlord in his armour, riding behind the siege tower.',
    waves: 4, firstWave: 12, boss: 'warlord', ...WIDE, trees: 6, features: f(2, 0, 0, 1, 1), warChest: 800, renown: 300, map: { x: 0.9, y: 0.28 },
    obstacles: [
      { look: 'ruin', x: -19, y: 40, hw: 3, hh: 0.6, angle: 0.5 },
      { look: 'ruin', x: 19, y: 40, hw: 3, hh: 0.6, angle: -0.5 },
      { look: 'stone', x: -21, y: 54, r: 1.1 },
      { look: 'stone', x: 21, y: 54, r: 1.1 },
    ],
  },
];

export function stageById(id: string): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}

export function stagesOfAct(act: number): StageDef[] {
  return STAGES.filter((s) => s.act === act);
}

/** The wave number the stage's last wave plays as. */
export function lastWaveOf(s: StageDef): number {
  return s.firstWave + s.waves - 1;
}

/**
 * The config for a stage: its waves, field, features and boss folded into the per-level tables, so the
 * game reads them as level 0 of a one-level table. Apply it before applyMeta (which adds the town's upgrades).
 */
export function applyStage(stage: StageDef, base: Config = makeConfig()): Config {
  const cfg = structuredClone(base);
  cfg.levels.waves = stage.waves;
  cfg.levels.firstWave = stage.firstWave;
  cfg.levels.names = [stage.name];
  cfg.levels.warChest = [stage.warChest];
  cfg.levels.halfWidth = [stage.halfWidth];
  cfg.levels.segments = [stage.segments];
  cfg.levels.tier = stage.act + 1;
  cfg.obstacles.levels = [stage.obstacles.map((o) => ({ ...o }))];
  cfg.fieldTrees.counts = [stage.trees];
  const { rail, ...counts } = stage.features;
  cfg.contraptions.layout.counts = [counts];
  cfg.rails.count = rail;
  cfg.shaping.levels = [cfg.shaping.levels[Math.min(stage.act, cfg.shaping.levels.length - 1)]];
  cfg.renown.levelClear = [stage.renown];
  const last = lastWaveOf(stage);
  cfg.waves.towerWaves = stage.boss ? [last] : [];
  cfg.waves.warlordWaves = stage.boss === 'warlord' ? [last] : [];
  return cfg;
}

/** What the player has done on the overmap: the best stars on each cleared stage. */
export type Cleared = Record<string, number>;

/** A stage can be played once the one before it (in the act, or the last stage of the act before) is cleared. */
export function stageOpen(cleared: Cleared, s: StageDef): boolean {
  const i = STAGES.indexOf(s);
  return i <= 0 || STAGES[i - 1].id in cleared;
}

/** The first stage not yet cleared (the one the overmap points at), or the last one when all are done. */
export function nextStage(cleared: Cleared): StageDef {
  return STAGES.find((s) => !(s.id in cleared)) ?? STAGES[STAGES.length - 1];
}

/**
 * Losing a stage: you just try that stage again (Jonny, 7 Nov). Stages already cleared stay cleared, and
 * Renown and the town's upgrades are kept. Returns the record unchanged.
 */
export function loseStage(cleared: Cleared, _s: StageDef): Cleared {
  return cleared;
}
