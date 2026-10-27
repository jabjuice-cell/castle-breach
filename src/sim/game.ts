import { type Config, makeConfig } from './config';
import {
  type Defender, type DefenderKind, type Levels, type PlacedKind, type Track,
  type Stack, emptyLevels, groundAt, jointStacks, onWall, stackAt, trackMult, upgradeCost,
} from './defenders';
import { type Contraption, footprint } from './contraptions';
import { type Obstacle, contact, needsHeave, nearestOn, plantTrees } from './obstacles';
import { Rng } from './rng';
import { type EnemyKind, type Shape, type WavePlan, formation, planSize, planWave } from './waves';

/**
 * The whole run simulation. It has no rendering or DOM code, so it runs
 * the same in the browser and headless (tests and balance sims).
 * Advance it with step(); the renderer only reads its state.
 *
 * Hold the Wall! is Breakout with additions: the shield is the paddle, blocked
 * boulders become balls, and the bricks are blocks of orcs marching on the wall.
 */

export type EnemyState = 'march' | 'climb' | 'wall' | 'stand' | 'fight';

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number; // knockback velocity, decays with friction
  vy: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  /** Catapults: the y they park at to throw. */
  standY: number;
  /** Throw countdown for throwers, climb countdown at the wall. */
  timer: number;
  /** Fixed random number per enemy, for animation phase and drift. */
  phase: number;
  /** Fire-arrow burn: damage per second while burnTime lasts. */
  burn: number;
  burnTime: number;
  /** Speed multiplier from a nearby warlord this step. */
  rally: number;
  /** The soldier it is brawling with. */
  foe: Soldier | null;
  /** The marching block it belongs to, and its slot in it. Null once it breaks away. */
  block: Block | null;
  slotX: number;
  slotY: number;
  /** Gold multiplier from the last ball that hit it (combo and behind-the-lines). */
  goldMult: number;
  /** The last ball that hit it (by id), which gets the combo for whatever its death sets off. -1 if none. */
  lastBall: number;
  /** Seconds left knocked off its feet by a falling ogre. */
  stagger: number;
  /** Caught in a barrel blast: if it is a barrel too, it goes off after the chain delay. */
  blasted: boolean;
  /** Shield orcs: front hits clang off while their block's drummer lives. */
  shielded: boolean;
  /** Orc Bowling: tumbling along a shot's chain, in place of marching or fighting. Null when upright. */
  bowl: Bowl | null;
}

/** One orc's tumble in a bowling chain: slides along (dx, dy), slowing steadily to a stop over dur seconds. */
export interface Bowl {
  chain: Chain;
  dx: number;
  dy: number;
  /** Opening speed; it falls to nothing by the end. */
  speed: number;
  t: number;
  dur: number;
  /** 1 for the first victim, then 0.7 of that for each transfer. */
  strength: number;
  /** Transfers since the shot. */
  depth: number;
  hits: number;
}

/** Everything one empowered shot sets tumbling. Each orc is in it at most once, and the bonus is paid once when it ends. */
export interface Chain {
  id: number;
  members: Set<Enemy>;
  /** Shield-team members still to topple, in order. */
  pending: { e: Enemy; at: number; strength: number; depth: number }[];
  x: number;
  y: number;
}

/** Units that march behind the foot formation and are not part of its shape. */
const REAR_KINDS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['orcCatapult', 'drummer']);

/** The siege tower boss: floors of plank bricks, bottom floor first. */
export interface SiegeTower {
  x: number;
  /** Its front face (toward the wall). */
  y: number;
  /** Plank hits left, per floor (0 = bottom) and plank. */
  floors: number[][];
  timer: number;
  /** At the wall with its ramp down. */
  ramp: boolean;
}

/** A formation of orcs that marches as one and closes ranks as it loses orcs: a Breakout brick wall. */
export interface Block {
  id: number;
  x: number;
  y: number;
  shape: Shape;
  members: Enemy[];
  /** How many orcs it started with; it marches faster as it shrinks. */
  start: number;
  spacing: number;
  speed: number;
  /** Riders zig-zag around this x. */
  homeX: number;
  zig: boolean;
  phase: number;
  dirty: boolean;
  regroupAt: number;
  /** Spawned with a drummer that is still alive. */
  drummed: boolean;
}

export interface Soldier {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The spot on the wall's foot it guards and returns to. */
  postX: number;
  postY: number;
}

export type ProjectileKind = 'rock' | 'boulder' | 'enemyBolt' | 'bolt' | 'arrow' | 'stone';

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Friendly projectiles hurt enemies; hostile ones hurt the wall. */
  friendly: boolean;
  /** For drawing arcs: distance travelled and total flight distance. */
  travelled: number;
  flight: number;
  damage: number;
  /** Enemies it can still pass through (bolts pierce). */
  hitsLeft: number;
  hit: Set<Enemy>;
  /** Fire-arrow burn applied on hit. */
  burn?: number;
  /** Catapult stones: splash radius where they land. */
  splash?: number;
  /** A ballista bolt: wider, heavier, smashes siege tower planks. falloff is the damage lost per orc pierced. */
  big?: boolean;
  falloff?: number;
}

/** royal: the gold ball served each wave (and the castle catapult's). claimed: a blocked boulder. pebble: a blocked rock. */
export type BallKind = 'royal' | 'claimed' | 'pebble';

export interface Ball {
  id: number;
  kind: BallKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The one Royal Ball served from the shield each wave. */
  primary: boolean;
  /** Damage multiplier (pebbles are half-strength). */
  power: number;
  /** Orcs hit since it last touched the shield. */
  combo: number;
  /** True after it bounces off the top edge, until it next touches the shield: hits pay double. */
  behind: boolean;
  heaved: boolean;
  /**
   * Empowered by a Perfect Return: the next damaging impact is harder and may start Orc Bowling.
   * Kept through scenery rebounds; cleared by that impact, an ordinary shield return, or losing the ball.
   */
  perfect: boolean;
  /** Riding on the shield (being served, or caught by the sticky gauntlet). */
  stuck: boolean;
  stuckOffset: number;
  stuckAt: number;
  hitShieldAt: number;
  born: number;
  /** The orc it is passing through, so it isn't hit twice in a row. */
  passing: Enemy | null;
  /** Orc lines a heave can still smash through. */
  lines: number;
  /** The next combo milestone index it hasn't reached yet. */
  milestone: number;
  /** It just banked off a bumper: the next orc hit does extra damage. */
  banked: boolean;
  /** Curve from the shield's movement: how fast its path bends (radians per second, + is anticlockwise). */
  spin: number;
  /** Flying over a ramp: ignores orcs and scenery until it passes landY (or the time runs out). */
  air?: { fromY: number; landY: number; until: number };
}

/** A tower turret jutting out in front of the shield: a round bumper for bank shots. */
export interface Bumper {
  x: number;
  y: number;
  r: number;
  /** A defender stands on this tower. */
  manned: boolean;
}

export const CAPSULE_KINDS = ['grog', 'banner', 'flask', 'sticky', 'trick'] as const;
export type CapsuleKind = (typeof CAPSULE_KINDS)[number];

export interface Capsule {
  kind: CapsuleKind;
  x: number;
  y: number;
}

/** The town's buildings behind the wall: the keep has a power, the rest are passive boons. */
export const BUILDING_KINDS = ['keep', 'tavern', 'alchemist', 'blacksmith', 'chapel', 'forge'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
/** Buildings with a click power. */
export type PowerKind = 'keep';

export const SHIELD_TRACKS = ['width', 'window', 'power', 'recovery', 'plating'] as const;
export type ShieldTrack = (typeof SHIELD_TRACKS)[number];

export type GameEvent =
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  /** An orc joins a bowling chain: count is how many are in it so far (1 is the first victim). */
  | { type: 'bowl'; chain: number; count: number; x: number; y: number }
  /** A tumbling orc smacks into another (armoured: it thudded into a heavy or clanged off a shield). */
  | { type: 'bowlHit'; x: number; y: number; armoured: boolean }
  /** All motion in the chain has stopped: its bonus coins are paid. */
  | { type: 'bowlEnd'; chain: number; count: number; bonus: number; x: number; y: number }
  /** A ball or boulder hit the shield. parry: a heave power hit. trick: an edge-zone trick shot. */
  | { type: 'deflect'; x: number; y: number; parry: boolean; trick: boolean; perfect?: boolean }
  /** A ball left the shield at (x, y) with this velocity: the render shows the outgoing angle. */
  | { type: 'shieldBounce'; x: number; y: number; vx: number; vy: number }
  /** A heave smashed through an orc line from x0 to x1. */
  | { type: 'line'; x0: number; x1: number; y: number }
  | { type: 'bank'; x: number; y: number }
  /** The Royal Ball rebounded off the back of the field. */
  | { type: 'rebound'; x: number; y: number }
  /** A caught boulder sailed off the top of the field. */
  | { type: 'flyOff'; x: number; y: number }
  | { type: 'shotDown'; x: number; y: number }
  | { type: 'salvo'; size: number }
  | { type: 'combo'; x: number; y: number; combo: number }
  | { type: 'blast'; x: number; y: number; radius: number }
  | { type: 'plank'; x: number; y: number }
  | { type: 'floorDown'; x: number; y: number; floorsLeft: number }
  | { type: 'heave'; x: number }
  /** A heave pressed just before contact: the ball is empowered (a Perfect Return). */
  | { type: 'perfect'; x: number; y: number; at: number; ball: number }
  /** The keep's call to arms. */
  | { type: 'power'; kind: PowerKind }
  /** A ball bounced off a tree line (side: -1 left, 1 right), or off one of the field's structures. */
  | { type: 'edge'; x: number; y: number; side: number }
  | { type: 'obstacle'; x: number; y: number; index: number }
  /** A ball hit a spring bumper (contraption index). */
  | { type: 'bumper'; x: number; y: number; index: number }
  /** A ball rang a bell: rung is how many of its set are now ringing. */
  | { type: 'bell'; x: number; y: number; index: number; rung: number }
  /** A whole set of bells rang: the castle looses a free volley from the wall at x. */
  | { type: 'bellVolley'; x: number; y: number; arrows: number }
  | { type: 'rampLaunch'; x: number; y: number; index: number }
  /** A ball dropped off a ramp: hits orcs were struck within radius. */
  | { type: 'rampLand'; x: number; y: number; radius: number; hits: number }
  /** A ball smashed one of the trees on the field (obstacle index). */
  | { type: 'treeDown'; x: number; y: number; index: number }
  /** A heave slammed the shield into the orcs at the wall: hits orcs struck. */
  | { type: 'slam'; x: number; hits: number }
  /** A light orc the slam killed, sent flying (velocity in field units per second, up the field). */
  | { type: 'flung'; x: number; y: number; kind: EnemyKind; vx: number; vy: number }
  | { type: 'boltFired'; x: number; y: number }
  /** A ballista loosed its great bolt. */
  | { type: 'ballistaFired'; x: number; y: number; aimX: number; aimY: number }
  /** A mage tower blasted the ground at (x, y) from (fromX, fromY). */
  | { type: 'mageBlast'; x: number; y: number; fromX: number; fromY: number; radius: number }
  /** Boiling oil poured down the wall at (x, y), width wide. */
  | { type: 'oilPour'; x: number; y: number; width: number }
  /** A ball glanced off a spike trap (defender id). */
  | { type: 'spikeHit'; x: number; y: number; id: number }
  | { type: 'volley'; x: number; y: number; arrows: number }
  /** combo: the ball's combo after this hit (only for ball hits). */
  | { type: 'hit'; x: number; y: number; combo?: number }
  | { type: 'bounce'; x: number; y: number }
  /** A ball struck a shield orc's raised shield: no damage. */
  | { type: 'clang'; x: number; y: number }
  /** A block's drummer fell and the formation scattered. */
  | { type: 'formationBreak'; x: number; y: number }
  | { type: 'splash'; x: number; y: number; radius: number }
  /** damage: how hard, so a boulder can throw more stone about than a pebble. */
  | { type: 'wallHit'; x: number; y: number; segment: number; damage: number }
  | { type: 'ballLost'; x: number; kind: BallKind }
  | { type: 'caught'; x: number; y: number; kind: CapsuleKind }
  | { type: 'segmentDestroyed'; segment: number }
  | { type: 'soldierDown'; x: number; y: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveCleared'; wave: number; gold: number }
  | { type: 'calledEarly'; wave: number; gold: number }
  | { type: 'bossKilled'; x: number; y: number }
  | { type: 'lost'; segment: number }
  | { type: 'won' };

/**
 * setup: before the level's first wave, buying and placing the load-out (the game is paused).
 * preview: the lull before each wave, when the shop is open over the battlefield.
 * won and lost end the level.
 */
export type Phase = 'setup' | 'preview' | 'battle' | 'lost' | 'won';

export const STEP = 1 / 60;

const MAX_RADIUS = 1.6;

/** Crossbow target priority: catapults first (they make the boulders), then the other big ones. */
const CROSSBOW_PRIORITY: Partial<Record<EnemyKind, number>> = { orcCatapult: 3, warlord: 2, ogre: 2 };

export class Game {
  readonly cfg: Config;
  readonly seed: number;
  time = 0;
  phase: Phase = 'setup';
  /** The level being played (0-based); it is waves firstWave to lastWave. */
  readonly level: number;
  phaseTimer = 0;
  /** The wave in progress (or the last one fought). 0 before the first. */
  wave = 0;
  /** The highest wave fully beaten back. */
  cleared = 0;
  plan: WavePlan;
  private nextGroup = 0;

  enemies: Enemy[] = [];
  blocks: Block[] = [];
  projectiles: Projectile[] = [];
  balls: Ball[] = [];
  capsules: Capsule[] = [];
  soldiers: Soldier[] = [];
  /** Archers, crossbows and catapults the player has placed. */
  defenders: Defender[] = [];
  /** Towers on the wall: the joints' own, plus any the player builds or stacks higher. */
  stacks: Stack[];
  /** Tower storeys bought this level (each costs more). */
  storeysBuilt = 0;
  private nextDefenderId = 0;
  private nextBallId = 0;
  private nextBlockId = 0;
  levels: Levels = emptyLevels();
  /** Shield upgrades, from the town. */
  shieldLevels: Record<ShieldTrack, number>;
  segmentHp: number[];
  gold: number;
  goldEarned = 0;
  renown = 0;
  kills = 0;
  /** Power hits landed. */
  parries = 0;
  /** Perfect Returns this run. */
  perfects = 0;
  /** Bowling chains still moving, and the biggest finished one this run. */
  chains: Chain[] = [];
  private nextChainId = 1;
  bowlBest = 0;
  /** Enemy boulders and rocks the shield blocked, and those that got through. */
  blocked = 0;
  missed = 0;
  ballsLost = 0;
  bestCombo = 0;
  earlyCalls = 0;
  /** Wall damage taken this run, by source, for balance work. */
  wallDamage: Record<string, number> = {};
  events: GameEvent[] = [];

  /** The paddle. targetX is where the mouse is; x chases it at the speed cap. */
  shield = { x: 0, targetX: 0, vx: 0, heaveAt: -99, readyAt: 0, bashAt: -99, bashReadyAt: 0 };
  tower: SiegeTower | null = null;
  /** Barrel blasts waiting to go off (chain reactions run through this queue). */
  private blasts: { x: number; y: number; at: number; mult: number; ball: number }[] = [];
  /** Capsule effects: the game time each one runs out. */
  effects = { banner: 0, flask: 0, trick: 0 };
  stickyCatches = 0;
  /** Orc tricks the shield plating can still shrug off this wave. */
  platingLeft = 0;
  private salvoTimer = 0;
  /** When the Royal Ball is served again after being lost. */
  royalDue = 0;
  /** While true no wall segment can fall (the tutorial wave sets it). */
  forgiving = false;

  /** Renown bonus for each wave called early, by wave number. */
  private earlyBonus = new Map<number, number>();
  /** The structures standing on this level's field. */
  readonly obstacles: Obstacle[];
  /** The pinball fixtures on this level's field, and each one's outline (same index). */
  readonly contraptions: Contraption[];
  private readonly shapes: Obstacle[];
  /** When each bell was rung (-1: not ringing), by contraption index, and when each ringing set resets (by group). */
  readonly bellRung: number[];
  private bellReset = new Map<number, number>();
  /** When each bumper was last hit, by contraption index, so the render can squash it. */
  readonly bumperHit: number[];
  private rng: Rng;
  private grid = new Map<number, Enemy[]>();

  /** cfg normally comes from applyMeta, with the town's upgrades in it. */
  constructor(seed = 1, cfg: Config = makeConfig(), level = 0) {
    this.cfg = cfg;
    this.seed = seed;
    this.level = level;
    this.rng = new Rng(seed);
    this.segmentHp = new Array(cfg.wall.segments).fill(cfg.wall.segmentHp);
    this.gold = cfg.economy.warChest;
    this.shieldLevels = { ...cfg.bonuses.shield };
    this.stacks = jointStacks(cfg);
    // Copies: trees come down during the level, and the next level starts with its own.
    const fixed = (cfg.obstacles.levels[Math.min(level, cfg.obstacles.levels.length - 1)] ?? []).map((o) => ({ ...o }));
    const k = cfg.contraptions;
    this.contraptions = k.enabled ? (k.levels[Math.min(level, k.levels.length - 1)] ?? []).map((c) => ({ ...c })) : [];
    this.shapes = this.contraptions.map((c) => footprint(c, k));
    this.bellRung = this.contraptions.map(() => -1);
    this.bumperHit = this.contraptions.map(() => -99);
    this.obstacles = [...fixed, ...plantTrees(cfg.fieldTrees, level, cfg.field.halfWidth, seed, [...fixed, ...this.shapes])];
    this.wave = this.cleared = this.firstWave - 1;
    this.plan = planWave(this.firstWave, seed, cfg);
  }

  get firstWave(): number {
    return this.level * this.cfg.levels.waves + 1;
  }

  get lastWave(): number {
    return this.firstWave + this.cfg.levels.waves - 1;
  }

  /** The wave on show (the one fighting, or the one coming), counted from 1 within the level. */
  get levelWave(): number {
    const n = this.phase === 'battle' || this.over ? this.wave : this.plan.number;
    return Math.max(1, n - this.firstWave + 1);
  }

  get over(): boolean {
    return this.phase === 'lost' || this.phase === 'won';
  }

  /** Waves of this level beaten back. */
  get wavesSurvived(): number {
    return this.cleared - this.firstWave + 1;
  }

  // ---- player input -------------------------------------------------------

  /** Points the shield at x (the mouse). It slides there at the speed cap. */
  setShield(x: number): void {
    this.shield.targetX = x;
  }

  /** The shield's current half width, with upgrades and capsules. */
  shieldHalfWidth(): number {
    const c = this.cfg;
    let w = c.shield.halfWidth + this.shieldLevels.width * c.shieldUpgrades.width.step;
    if (this.time < this.effects.banner) w *= c.capsules.bannerWidth;
    if (this.time < this.effects.trick) w *= c.capsules.trickWidth;
    return w;
  }

  heaveWindow(): number {
    return this.cfg.shield.heaveWindow + this.shieldLevels.window * this.cfg.shieldUpgrades.window.step;
  }

  heaveCooldown(): number {
    return Math.max(0.4, this.cfg.shield.heaveCooldown - this.shieldLevels.recovery * this.cfg.shieldUpgrades.recovery.step);
  }

  /** Orc lines a heave smashes through. */
  heaveLines(): number {
    return this.cfg.shield.heaveLines + this.shieldLevels.power * this.cfg.shieldUpgrades.power.step;
  }

  /**
   * The tower turrets along the wall, as bank-shot bumpers. One at each wall joint;
   * a defender standing on that tower makes it bigger.
   */
  bumpers(): Bumper[] {
    const c = this.cfg.bumpers;
    const out: Bumper[] = [];
    if (!c.enabled) return out;
    const w = this.segmentWidth();
    for (let i = 0; i <= this.cfg.wall.segments; i++) {
      const x = -this.cfg.field.halfWidth + i * w;
      const manned = this.defenders.some((d) => Math.hypot(d.x - x, d.y - this.cfg.castle.start.y) < c.mannedDistance);
      out.push({ x, y: c.y, r: manned ? c.mannedRadius : c.radius, manned });
    }
    return out;
  }

  /** True when the shield has recovered and can heave again. */
  get canHeave(): boolean {
    return this.time >= this.shield.readyAt;
  }

  /**
   * Left click: heave the shield. Within the heave window of an impact (either
   * side of it) the ball leaves as a power hit. Also launches any ball riding on
   * the shield. Returns false while the shield is still recovering.
   */
  heave(): boolean {
    if (this.phase !== 'battle' && this.phase !== 'preview') return false;
    const released = this.releaseStuck();
    const s = this.shield;
    // The bash: every fresh press (never a held one, the input layer drops key repeats) arms a Perfect Return
    // for the window, then rests for bashCooldown. Pressing during the rest does nothing, so it can't refresh early.
    if (this.time < s.bashReadyAt) return released;
    s.bashAt = this.time;
    s.bashReadyAt = this.time + this.cfg.shield.bashCooldown;
    if (!this.canHeave) return true;
    s.heaveAt = this.time;
    s.readyAt = this.time + this.heaveCooldown();
    this.events.push({ type: 'heave', x: s.x });
    if (this.phase === 'battle') this.slam();
    // A click just after an impact still counts.
    for (const b of this.balls) {
      if (!b.stuck && !b.heaved && b.vy > 0 && this.time - b.hitShieldAt <= this.heaveWindow()) this.powerUp(b);
    }
    return true;
  }

  /** Dev aid: lobs a practice boulder down at the shield from up the field, to try Perfect Returns without a run. */
  practiceBall(offset = 0): void {
    const sy = this.cfg.shield.y;
    const b = this.addBall('claimed', this.shield.x + offset, sy + 16, 0, -this.cfg.balls.speed);
    b.primary = false;
  }

  /** Dev aid: a column of grunts up the field and an empowered ball heading for the front one, to try Orc Bowling without a run. */
  practiceBowling(count = 4, kind: EnemyKind = 'grunt'): void {
    const x = this.shield.x;
    const block: Block = {
      id: this.nextBlockId++, x, y: 14, shape: 'column', members: [], start: 0, spacing: 0.9, speed: 0, homeX: x,
      zig: false, phase: 0, dirty: false, regroupAt: 0, drummed: false,
    };
    for (let i = 0; i < count; i++) this.spawn(kind, block, 0, i * 0.95);
    block.start = block.members.length;
    this.blocks.push(block);
    for (const e of block.members) {
      e.x = x;
      e.y = 14 + e.slotY;
    }
    const b = this.addBall('claimed', x, this.cfg.shield.y + 2, 0, this.cfg.balls.speed);
    b.primary = false;
    b.perfect = true;
  }

  /**
   * The heave's shield bash: every orc across the shield's width, from the wall to just in
   * front of it. Light ones die and go flying up the field; heavy ones are hurt and shoved back.
   */
  private slam(): void {
    const c = this.cfg.shield;
    const s = this.shield;
    const half = this.shieldHalfWidth();
    let hits = 0;
    for (const e of this.enemies) {
      const stats = this.cfg[e.kind];
      if (e.hp <= 0 || e.y > c.y + c.slamReach + stats.radius || Math.abs(e.x - s.x) > half + stats.radius) continue;
      hits++;
      const side = (e.x - s.x) / half;
      this.leaveBlock(e);
      e.foe = null;
      if (stats.mass <= c.slamKillMass) {
        e.hp = 0;
        this.events.push({ type: 'flung', x: e.x, y: e.y, kind: e.kind, vx: side * 6 + this.rng.range(-3, 3), vy: this.rng.range(14, 22) });
      } else {
        e.hp -= c.slamDamage * this.cfg.bonuses.damage;
        e.vy += c.slamKnock / stats.mass;
        e.vx += side * 4 / stats.mass;
        // Off the wall (or out of a brawl): it has to march back in.
        if (e.state !== 'march' && e.state !== 'stand') e.state = 'march';
      }
    }
    this.events.push({ type: 'slam', x: s.x, hits });
  }

  /** The buildings' powers: when each can be used again, and until when it lasts. */
  powers: Record<PowerKind, { readyAt: number; until: number }> = {
    keep: { readyAt: 0, until: 0 },
  };

  /** The keep's call to arms. */
  get arms(): { readyAt: number; until: number } {
    return this.powers.keep;
  }

  get armsActive(): boolean {
    return this.powerActive('keep');
  }

  get canCallToArms(): boolean {
    return this.canUse('keep');
  }

  /** The town has built this one. */
  hasBuilding(kind: BuildingKind): boolean {
    return this.cfg.unlocks.buildings.includes(kind);
  }

  powerActive(kind: PowerKind): boolean {
    return this.time < this.powers[kind].until;
  }

  /** The power's length and rest, in seconds. */
  powerTiming(_kind: PowerKind): { seconds: number; cooldown: number } {
    return this.cfg.callToArms;
  }

  /** Why the power can't be used right now, or '' if it can. */
  whyNotPower(kind: PowerKind): string {
    if (!this.hasBuilding(kind)) return 'build it in the town';
    if (this.phase !== 'battle') return 'ready when the battle starts';
    if (this.time < this.powers[kind].readyAt) return `resting, ${Math.ceil(this.powers[kind].readyAt - this.time)} s`;
    return '';
  }

  canUse(kind: PowerKind): boolean {
    return this.whyNotPower(kind) === '';
  }

  /**
   * Sounds the keep's horn: for a few seconds every defender shoots twice
   * as fast and the soldiers run. Then the keep needs a long rest.
   */
  usePower(kind: PowerKind): boolean {
    if (!this.canUse(kind)) return false;
    const t = this.powerTiming(kind);
    this.powers[kind] = { readyAt: this.time + t.cooldown, until: this.time + t.seconds };
    if (kind === 'keep') {
      // Everyone fires at once as the horn sounds.
      for (const d of this.defenders) d.timer = Math.min(d.timer, 0.1);
    }
    this.events.push({ type: 'power', kind });
    return true;
  }

  callToArms(): boolean {
    return this.usePower('keep');
  }

  /** True when the next wave can be called now for a bonus. */
  canCallEarly(): boolean {
    if (this.phase === 'preview') return true;
    if (this.phase !== 'battle' || this.nextGroup < this.plan.groups.length || this.tower) return false;
    if (this.wave >= this.lastWave) return false;
    return this.enemies.length <= Math.max(2, Math.ceil(planSize(this.plan) * this.cfg.economy.callEarlyAt));
  }

  /** Bonus gold for calling the next wave right now. */
  earlyCallGold(): number {
    const next = this.phase === 'preview' ? this.plan.number : this.wave + 1;
    return Math.round(this.secondsSkipped() * Math.max(1, next / 5));
  }

  /**
   * Calls the next wave now: during the preview, or once the current wave is
   * nearly dead. Pays gold and Renown in proportion to the time skipped.
   */
  callEarly(): boolean {
    if (!this.canCallEarly()) return false;
    const seconds = this.secondsSkipped();
    const gold = this.earlyCallGold();
    if (this.phase === 'battle') {
      this.clearWave(this.wave);
      this.plan = planWave(this.wave + 1, this.seed, this.cfg);
    }
    const r = this.cfg.renown;
    this.earlyBonus.set(this.plan.number, Math.min(r.earlyCap, r.earlyPerSecond * seconds));
    this.addGold(gold);
    this.earlyCalls++;
    this.events.push({ type: 'calledEarly', wave: this.plan.number, gold });
    this.startWave();
    return true;
  }

  /** Starts the next wave without waiting for the preview countdown. */
  skipPreview(): void {
    if (this.phase === 'preview') this.callEarly();
  }

  // ---- the shop: the load-out in the setup, then upgrades and repairs between waves ----

  /** The shop is open in the setup and in the lull before each wave, over the battlefield. */
  get shopOpen(): boolean {
    return this.phase === 'setup' || this.phase === 'preview';
  }

  /** Whether this defender is on sale yet (the town unlocks all but the crossbow). */
  unlocked(kind: DefenderKind): boolean {
    return this.cfg.unlocks.defenders.includes(kind);
  }

  count(kind: DefenderKind): number {
    return this.defenders.filter((d) => d.kind === kind).length;
  }

  /** Soldier companies on the wall. */
  get companies(): number {
    return this.count('soldiers');
  }

  /** Price of the next defender of a kind: each extra one costs more. */
  defenderCost(kind: DefenderKind): number {
    return Math.round(this.cfg[kind].cost * this.cfg.castle.priceGrowth ** this.count(kind));
  }

  /**
   * True if a defender could stand at (x, y): on the castle grounds (the wall, a tower
   * top or the courtyard), clear of the field's edges and of every other defender.
   */
  canPlace(kind: PlacedKind, x: number, y: number, ignoreId = -1): boolean {
    const c = this.cfg.castle;
    const hw = this.cfg.field.halfWidth - c.edge;
    const r = this.cfg[kind].footprint;
    if (kind === 'spiketrap') {
      const t = this.cfg.spiketrap;
      if (x < -hw || x > hw || y < t.minY || y > t.maxY) return false;
      if (this.obstacles.some((o) => !o.down && contact(o, x, y, r))) return false;
      if (this.shapes.some((o) => contact(o, x, y, r))) return false;
    } else {
      if (x < -hw || x > hw || y < c.minY || y > c.maxY) return false;
      const ground = groundAt(this.cfg, x, y, this.stacks);
      if (kind === 'mage' && ground !== 'tower') return false;
      if (kind === 'oil' && ground === 'courtyard') return false;
    }
    return this.defenders.every((d) => d.id === ignoreId || Math.hypot(d.x - x, d.y - y) >= r + this.cfg[d.kind].footprint);
  }

  /** Buys a defender and puts it down exactly at (x, y) on the castle grounds. */
  place(kind: PlacedKind, x: number, y: number): boolean {
    const cost = this.defenderCost(kind);
    if (!this.shopOpen || !this.unlocked(kind) || this.gold < cost) return false;
    if (!this.canPlace(kind, x, y)) return false;
    this.gold -= cost;
    this.addDefender(kind, x, y, cost);
    if (kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  /** Gold back for selling a defender: all of it in the setup, half once the level is under way. */
  sellValue(id: number): number {
    const d = this.defenders.find((o) => o.id === id);
    if (!d) return 0;
    return this.phase === 'setup' ? d.paid : Math.floor(d.paid / 2);
  }

  /** Sells a defender (and its share of nothing else: upgrades stay with the kind). */
  sell(id: number): boolean {
    if (!this.shopOpen) return false;
    const i = this.defenders.findIndex((o) => o.id === id);
    if (i < 0) return false;
    this.gold += this.sellValue(id);
    const [d] = this.defenders.splice(i, 1);
    if (d.kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  /** Where each defender stands, to put the same load-out back next level. */
  loadout(): { kind: PlacedKind; x: number; y: number }[] {
    return this.defenders.map((d) => ({ kind: d.kind, x: d.x, y: d.y }));
  }

  /** Buys and places a saved load-out, in order, as far as the war chest goes. Returns how many went down. */
  restoreLoadout(list: { kind: PlacedKind; x: number; y: number }[]): number {
    let n = 0;
    for (const d of list) if (this.unlocked(d.kind) && this.place(d.kind, d.x, d.y)) n++;
    return n;
  }

  /** Gold a move costs right now: free in the setup and the lull between waves, paid mid-battle. */
  moveCost(): number {
    return this.phase === 'battle' ? Math.round((this.cfg.castle.moveGold * this.wave) / 5) : 0;
  }

  /**
   * Moves a placed defender to (x, y). Free in the setup and between waves;
   * mid-battle it costs gold and it has to pack up before it fires again.
   */
  move(id: number, x: number, y: number): boolean {
    const d = this.defenders.find((o) => o.id === id);
    if (!d || this.over || !this.canPlace(d.kind, x, y, id)) return false;
    if (d.x === x && d.y === y) return true;
    const cost = this.moveCost();
    if (this.gold < cost) return false;
    this.gold -= cost;
    d.x = x;
    d.y = y;
    d.ground = groundAt(this.cfg, x, y, this.stacks);
    // An aim keeps its angle, within what the new ground allows.
    if (d.heading !== null) d.heading = Math.max(-this.aimLimit(d), Math.min(this.aimLimit(d), d.heading));
    d.aimX = d.heading === null ? x : x + Math.sin(d.heading) * 30;
    d.aimY = d.heading === null ? 30 : y + Math.cos(d.heading) * 30;
    if (this.phase === 'battle') d.timer = Math.max(d.timer, this.cfg.castle.packSeconds);
    if (d.kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  /** How far off straight ahead a defender can be aimed: further from a tower top. */
  aimLimit(d: Defender): number {
    return d.ground === 'tower' ? this.cfg.coverage.aimTower : this.cfg.coverage.aimWall;
  }

  /** Whether a defender kind can be aimed (soldiers can't: they hold their stretch of wall). */
  aimable(d: Defender): boolean {
    return d.kind !== 'soldiers' && d.kind !== 'oil' && d.kind !== 'spiketrap';
  }

  /**
   * Aims a crossbow, an archer squad or a catapult at (x, y), as far round as it can turn.
   * Only in the setup and between waves. null clears it back to its default facing.
   */
  aim(id: number, at: { x: number; y: number } | null): boolean {
    const d = this.defenders.find((o) => o.id === id);
    if (!d || !this.shopOpen || !this.aimable(d)) return false;
    if (!at) {
      d.heading = null;
      d.aimX = d.x;
      d.aimY = 30;
      return true;
    }
    const lim = this.aimLimit(d);
    d.heading = Math.max(-lim, Math.min(lim, Math.atan2(at.x - d.x, Math.max(0.1, at.y - d.y))));
    d.aimX = d.x + Math.sin(d.heading) * 30;
    d.aimY = d.y + Math.cos(d.heading) * 30;
    return true;
  }

  /** The placed defender at (x, y), if any (for picking it up with the mouse). */
  defenderAt(x: number, y: number): Defender | undefined {
    let best: Defender | undefined;
    let bestD = 2;
    for (const d of this.defenders) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best;
  }

  owns(kind: DefenderKind): boolean {
    return this.count(kind) > 0;
  }

  /** Range multiplier from where a defender stands: each storey of tower under it adds to its reach. */
  rangeMult(d: Defender): number {
    const c = this.cfg.castle;
    if (d.ground === 'tower') return 1 + (c.towerRange - 1) * (stackAt(this.cfg, this.stacks, d.x, d.y)?.storeys ?? 1);
    return d.ground === 'courtyard' ? c.courtyardRange : 1;
  }

  // ---- towers: built on the wall and stacked like blocks ---------------------

  /** Price of the next tower storey. */
  storeyCost(): number {
    const t = this.cfg.towers;
    return Math.round(t.cost * t.costGrowth ** this.storeysBuilt);
  }

  /**
   * What building at (x, y) would do: raise the tower there by a storey, put up a new
   * one-storey tower on a clear stretch of the wall walk, or nothing (and why not).
   */
  towerPlan(x: number, y: number): { ok: true; stack: Stack | null } | { ok: false; why: string } {
    const c = this.cfg.castle;
    const hw = this.cfg.field.halfWidth - c.towerHalf;
    if (!onWall(this.cfg, y) || Math.abs(x) > hw + c.towerHalf) return { ok: false, why: 'Towers go on the wall' };
    const stack = stackAt(this.cfg, this.stacks, x, y);
    if (stack) return stack.storeys >= this.cfg.towers.maxStoreys ? { ok: false, why: 'As tall as it goes' } : { ok: true, stack };
    if (Math.abs(x) > hw) return { ok: false, why: 'Too close to the end of the wall' };
    if (this.stacks.some((s) => Math.abs(s.x - x) < c.towerHalf * 2)) return { ok: false, why: 'Too close to another tower' };
    return { ok: true, stack: null };
  }

  /** Builds a tower storey at (x, y): stacks it on the tower there, or starts a new tower. */
  buildTower(x: number, y: number): boolean {
    const plan = this.towerPlan(x, y);
    const cost = this.storeyCost();
    if (!this.shopOpen || !plan.ok || this.gold < cost) return false;
    this.gold -= cost;
    this.storeysBuilt++;
    if (plan.stack) plan.stack.storeys++;
    else this.stacks.push({ x, storeys: 1 });
    // Defenders standing there are now up on the tower.
    for (const d of this.defenders) d.ground = groundAt(this.cfg, d.x, d.y, this.stacks);
    return true;
  }

  /** The stretch of wall a soldier company holds: its section plus a spill into each neighbour. */
  soldierRange(d: Defender): [number, number] {
    const w = this.segmentWidth();
    const seg = this.segmentAt(d.x);
    const lo = -this.cfg.field.halfWidth + seg * w;
    const spill = this.cfg.coverage.soldierSpill;
    return [Math.max(-this.cfg.field.halfWidth, lo - spill), Math.min(this.cfg.field.halfWidth, lo + w + spill)];
  }

  /** Whether a defender can reach a point on the field: its coverage, with blind spots. */
  covers(d: Defender, x: number, y: number): boolean {
    const c = this.cfg.coverage;
    const dx = x - d.x;
    const dy = y - d.y;
    if (y > this.cfg.field.topY) return false;
    const h = d.heading;
    // The angle of the point off the way the defender faces.
    const off = Math.abs(Math.atan2(dx, dy) - (h ?? 0));
    switch (d.kind) {
      case 'crossbow':
        if (dy <= 0) return false;
        if (h !== null) {
          // Aimed: a lane the same width, running out along the aim.
          const along = dx * Math.sin(h) + dy * Math.cos(h);
          return along > 0 && Math.abs(dx * Math.cos(h) - dy * Math.sin(h)) <= c.crossbowLane;
        }
        return Math.abs(dx) <= c.crossbowLane || (d.ground === 'tower' && off <= c.crossbowTowerAngle);
      case 'archers':
        return dy > 0 && off <= c.archerCone && y <= this.cfg.field.topY * c.archerReach * this.rangeMult(d);
      case 'catapult': {
        const dist = Math.hypot(dx, dy);
        return dy > 0 && dist >= c.catapultMin && dist <= c.catapultMax * this.rangeMult(d) && (h === null || off <= c.catapultAimSpread);
      }
      case 'soldiers': {
        const [lo, hi] = this.soldierRange(d);
        return x >= lo && x <= hi && y <= this.cfg.soldiers.y + this.cfg.soldiers.guard;
      }
      case 'mage':
        return dy > 0 && Math.hypot(dx, dy) <= this.cfg.mage.range * this.rangeMult(d) && (h === null || off <= c.mageAimSpread);
      case 'ballista':
        if (dy <= 0) return false;
        if (h !== null) {
          const along = dx * Math.sin(h) + dy * Math.cos(h);
          return along > 0 && Math.abs(dx * Math.cos(h) - dy * Math.sin(h)) <= c.ballistaLane;
        }
        return Math.abs(dx) <= c.ballistaLane;
      case 'oil':
        return Math.abs(dx) <= this.cfg.oil.halfWidth && y >= 0 && y <= this.cfg.oil.reach;
      case 'spiketrap':
        return Math.hypot(dx, dy) <= this.cfg.spiketrap.footprint;
    }
  }

  /**
   * How well a wall section is defended against boulders: archers whose cone reaches
   * out in front of it, and crossbows whose lane runs up it (they kill its catapults).
   */
  sectionCover(seg: number): number {
    const w = this.segmentWidth();
    const lo = -this.cfg.field.halfWidth + seg * w;
    const y = this.cfg.coverage.sectionCheckY;
    let n = 0;
    for (const d of this.defenders) {
      if (d.kind === 'archers' && this.covers(d, lo + w / 2, y)) n++;
      if (d.kind === 'crossbow' && [0.1, 0.3, 0.5, 0.7, 0.9].some((f) => this.covers(d, lo + w * f, 40))) n++;
    }
    return n;
  }

  upgradeCost(kind: DefenderKind, track: Track): number {
    return upgradeCost(kind, this.levels[kind][track], this.cfg);
  }

  /** Raises one upgrade track for every defender of that kind. */
  upgrade(kind: DefenderKind, track: Track): boolean {
    const cost = this.upgradeCost(kind, track);
    if (!this.shopOpen || !this.owns(kind) || this.gold < cost) return false;
    this.gold -= cost;
    this.levels[kind][track]++;
    if (kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  repairCost(segment: number): number {
    const missing = this.cfg.wall.segmentHp - this.segmentHp[segment];
    return Math.ceil(missing * this.cfg.economy.repairGoldPerHp);
  }

  /** Repairs a wall segment as far as the gold allows. Returns HP restored. */
  repair(segment: number): number {
    if (!this.shopOpen) return 0;
    const perHp = this.cfg.economy.repairGoldPerHp;
    const missing = this.cfg.wall.segmentHp - this.segmentHp[segment];
    const hp = Math.min(missing, Math.floor(this.gold / perHp));
    if (hp <= 0) return 0;
    this.gold -= hp * perHp;
    this.segmentHp[segment] += hp;
    return hp;
  }

  /** Ends the setup; the first wave's preview starts. */
  endSetup(): void {
    if (this.phase !== 'setup') return;
    this.musterSoldiers();
    this.phase = 'preview';
    this.phaseTimer = this.cfg.waves.previewSeconds;
  }

  // ---- defender stats -------------------------------------------------------

  /** A defender stat's multiplier: its upgrade track, times the town's bonus for damage and rate of fire. */
  mult(kind: DefenderKind, track: Track): number {
    const b = this.cfg.bonuses;
    const arms = track === 'rate' && this.armsActive ? this.cfg.callToArms.rate : 1;
    const bc = this.cfg.buildings;
    let town = 1;
    if (track === 'damage') {
      if ((kind === 'crossbow' || kind === 'archers') && this.hasBuilding('blacksmith')) town = bc.blacksmith.arrowDamage;
      else if (kind === 'catapult' && this.hasBuilding('forge')) town = bc.forge.catapultDamage;
    }
    return trackMult(this.levels[kind][track], this.cfg) * (track === 'damage' ? b.damage * town : track === 'rate' ? b.rate * arms : 1);
  }

  /** The chapel mends damaged (not destroyed) wall segments during battle. */
  private healWall(dt: number): void {
    if (this.phase !== 'battle' || !this.hasBuilding('chapel')) return;
    const max = this.cfg.wall.segmentHp;
    this.segmentHp = this.segmentHp.map((hp) => (hp > 0 && hp < max ? Math.min(max, hp + this.cfg.buildings.chapel.healPerSec * dt) : hp));
  }

  private get hasTraps(): boolean {
    return this.defenders.some((d) => d.kind === 'spiketrap');
  }

  /** An orc in a spike trap takes damage; with barbs the wounds keep bleeding after it leaves. */
  private trapHurt(e: Enemy, dt: number): void {
    const t = this.cfg.spiketrap;
    const barbs = this.levels.spiketrap.special;
    e.hp -= t.dps * this.mult('spiketrap', 'damage') * dt;
    if (barbs > 0) {
      e.burn = Math.max(e.burn, t.bleed * barbs);
      e.burnTime = Math.max(e.burnTime, t.bleedSeconds * barbs);
    }
  }

  /** A ballista bolt's damage lost per orc pierced, shrinking with the Pierce track. */
  ballistaFalloff(): number {
    const b = this.cfg.ballista;
    return Math.max(0, b.pierceFalloff - b.falloffStep * this.levels.ballista.special);
  }

  /** The mage blast's radius, grown by the Arcane blast track. */
  mageRadius(): number {
    return this.cfg.mage.radius + this.cfg.mage.radiusPerLevel * this.levels.mage.special;
  }

  /** Speed multiplier a spike trap gives an orc standing at (x, y): 1 clear of every trap. */
  trapSlow(x: number, y: number): number {
    const t = this.cfg.spiketrap;
    if (y > t.maxY + t.footprint) return 1;
    const slow = Math.max(t.slowMin, t.slow - t.slowStep * this.levels.spiketrap.special);
    return this.defenders.some((d) => d.kind === 'spiketrap' && Math.hypot(d.x - x, d.y - y) <= t.footprint) ? slow : 1;
  }

  crossbowPierce(): number {
    return this.cfg.crossbow.pierce + this.levels.crossbow.special;
  }

  /** Fire-arrow burn per second (0 until the track is bought). */
  arrowBurn(): number {
    return this.levels.archers.special * this.mult('archers', 'damage');
  }

  soldierHp(): number {
    return this.cfg.soldiers.hp * this.mult('soldiers', 'special');
  }

  // ---- queries ------------------------------------------------------------

  segmentWidth(): number {
    return (this.cfg.field.halfWidth * 2) / this.cfg.wall.segments;
  }

  segmentAt(x: number): number {
    const i = Math.floor((x + this.cfg.field.halfWidth) / this.segmentWidth());
    return Math.max(0, Math.min(this.cfg.wall.segments - 1, i));
  }

  /** Renown the run has earned so far, rounded. Breach keeps everything. */
  get renownEarned(): number {
    return Math.round(this.renown);
  }

  /** The player's balls in play (not counting enemy boulders). */
  get ballCount(): number {
    return this.balls.length;
  }

  /** Gold multiplier a ball's next hit earns. */
  ballGoldMult(b: Ball): number {
    const c = this.cfg.balls;
    return Math.min(c.comboMax, 1 + b.combo * c.comboStep) * (b.behind ? c.behindMult : 1);
  }

  // ---- simulation ---------------------------------------------------------

  step(dt = STEP): void {
    if (this.over || this.phase === 'setup') return;
    this.time += dt;
    this.updateShield(dt);

    if (this.phase === 'preview') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.startWave();
    } else {
      this.phaseTimer += dt;
      this.spawnDue();
    }

    this.rebuildGrid();
    this.updateBlocks(dt);
    this.updateEnemies(dt);
    this.updateBowling();
    this.updateSoldiers(dt);
    this.updateDefenders(dt);
    this.updateProjectiles(dt);
    this.updateTower(dt);
    this.updateSalvo(dt);
    this.updateBalls(dt);
    this.updateCapsules(dt);
    this.removeDead();
    this.processBlasts();
    this.healWall(dt);

    // The guided first wave: the wall bends but cannot break.
    if (this.forgiving) this.segmentHp.forEach((hp, i) => (this.segmentHp[i] = Math.max(hp, 1)));
    const broken = this.segmentHp.findIndex((hp) => hp <= 0);
    if (broken >= 0) {
      this.phase = 'lost';
      this.events.push({ type: 'lost', segment: broken });
      return;
    }
    if (this.phase === 'battle' && this.nextGroup >= this.plan.groups.length && this.enemies.length === 0 && !this.tower && this.blasts.length === 0) {
      this.clearWave(this.wave);
      this.projectiles = this.projectiles.filter((p) => p.friendly);
      this.balls = [];
      this.capsules = [];
      if (this.wave >= this.lastWave) {
        const clear = this.cfg.renown.levelClear;
        this.renown += clear[Math.min(this.level, clear.length - 1)];
        this.phase = 'won';
        this.events.push({ type: 'won' });
        return;
      }
      this.plan = planWave(this.wave + 1, this.seed, this.cfg);
      this.phase = 'preview';
      this.phaseTimer = this.cfg.waves.previewSeconds;
    }
  }

  private secondsSkipped(): number {
    return this.phase === 'preview'
      ? Math.max(0, this.phaseTimer)
      : this.cfg.waves.previewSeconds + this.cfg.economy.tailCallSeconds;
  }

  private addGold(amount: number): void {
    this.gold += amount;
    this.goldEarned += amount;
  }

  private clearWave(w: number): void {
    if (w <= this.cleared) return;
    this.cleared = w;
    const e = this.cfg.economy;
    const r = this.cfg.renown;
    const gold = e.clearBase + e.clearPerWave * w;
    this.addGold(gold);
    this.renown += (r.perWaveBase + r.perWave * w) * (1 + (this.earlyBonus.get(w) ?? 0));
    this.events.push({ type: 'waveCleared', wave: w, gold });
  }

  private addDefender(kind: PlacedKind, x: number, y: number, paid = 0): void {
    this.defenders.push({ id: this.nextDefenderId++, kind, ground: groundAt(this.cfg, x, y, this.stacks), x, y, paid, heading: null, timer: 0, aimX: x, aimY: 30, firedAt: -99 });
  }

  private startWave(): void {
    this.wave = this.plan.number;
    this.phase = 'battle';
    this.phaseTimer = 0;
    this.nextGroup = 0;
    this.platingLeft = this.shieldLevels.plating;
    this.salvoTimer = this.cfg.waves.salvoInterval;
    this.musterSoldiers();
    if (!this.balls.some((b) => b.primary)) this.serveRoyal();
    if (this.plan.tower && !this.tower) this.spawnTower();
    this.events.push({ type: 'waveStart', wave: this.wave });
  }

  /** Lines every company up along the stretch of wall it holds, at full health (the fallen return each wave). */
  private musterSoldiers(): void {
    const c = this.cfg.soldiers;
    const hp = this.soldierHp();
    this.soldiers = [];
    this.defenders.filter((d) => d.kind === 'soldiers').forEach((d, row) => {
      const [lo, hi] = this.soldierRange(d);
      for (let i = 0; i < c.count; i++) {
        // Two ranks, so a company reads as a crowd.
        const x = lo + 0.3 + ((i + 0.5) / c.count) * (hi - lo - 0.6);
        const y = c.y + (i % 2) * 0.7 + (row % 2) * 0.35;
        this.soldiers.push({ x, y, hp, maxHp: hp, postX: x, postY: y });
      }
    });
  }

  // ---- marching blocks ------------------------------------------------------

  private spawnDue(): void {
    const groups = this.plan.groups;
    while (this.nextGroup < groups.length && groups[this.nextGroup].time <= this.phaseTimer) {
      const g = groups[this.nextGroup++];
      const lead = g.members[0].kind;
      const foot = g.members.filter((m) => !REAR_KINDS.has(m.kind));
      const footCount = foot.reduce((s, m) => s + m.count, 0);
      const radius = Math.max(...g.members.map((m) => (REAR_KINDS.has(m.kind) ? 0 : this.cfg[m.kind].radius)));
      const spacing = Math.max(radius, 0.45) * 2 * this.cfg.march.spacing;
      const speed = lead === 'runner' || lead === 'rider' || lead === 'ogre' || lead === 'warlord' ? this.cfg[lead].speed : this.cfg.march.speed;
      const block: Block = {
        id: this.nextBlockId++, x: g.x, y: this.cfg.field.spawnY, shape: g.shape, members: [], start: 0,
        spacing, speed, homeX: g.x, zig: lead === 'rider', phase: this.rng.next() * Math.PI * 2, dirty: false, regroupAt: 0, drummed: false,
      };
      // Chuckers are mixed through the block rather than all in one corner; shield orcs take the front.
      const shieldCount = foot.find((m) => m.kind === 'shieldOrc')?.count ?? 0;
      const kinds: EnemyKind[] = [];
      for (const m of foot) if (m.kind !== 'shieldOrc') for (let i = 0; i < m.count; i++) kinds.push(m.kind);
      this.rng.shuffle(kinds);
      kinds.unshift(...Array<EnemyKind>(shieldCount).fill('shieldOrc'));
      const slots = formation(g.shape, footCount, spacing);
      const drummers = g.members.find((m) => m.kind === 'drummer')?.count ?? 0;
      block.drummed = drummers > 0;
      kinds.forEach((kind, i) => this.spawn(kind, block, slots[i].dx, slots[i].dy));
      // The drummer follows the foot; catapults trundle along behind.
      const footBack = slots.length ? Math.max(...slots.map((s) => s.dy)) : 0;
      if (drummers > 0) this.spawn('drummer', block, 0, footBack + 1.2);
      const back = footBack + 2.5 + (drummers > 0 ? 1.2 : 0);
      const cats = g.members.find((m) => m.kind === 'orcCatapult')?.count ?? 0;
      for (let i = 0; i < cats; i++) this.spawn('orcCatapult', block, (i - (cats - 1) / 2) * 3, back);
      block.start = block.members.length;
      this.keepInField(block);
      for (const e of block.members) {
        e.x = block.x + e.slotX;
        e.y = block.y + e.slotY;
      }
      this.blocks.push(block);
    }
  }

  private spawn(kind: EnemyKind, block: Block, slotX: number, slotY: number): void {
    const stats = this.cfg[kind];
    const hp = kind === 'warlord' ? stats.hp : stats.hp * this.cfg.waves.hpGrowth ** (this.wave - 1);
    const cat = this.cfg.orcCatapult;
    const e: Enemy = {
      kind, x: block.x + slotX, y: block.y + slotY, vx: 0, vy: 0, hp, maxHp: hp, state: 'march',
      standY: this.rng.range(cat.standMinY, cat.standMaxY),
      timer: this.rng.range(0, kind === 'orcCatapult' ? cat.throwInterval : this.cfg.chucker.throwInterval),
      phase: this.rng.next(),
      burn: 0, burnTime: 0, rally: 1, foe: null, block, slotX, slotY, goldMult: 1,
      lastBall: -1, stagger: 0, blasted: false, shielded: kind === 'shieldOrc' && block.drummed, bowl: null,
    };
    this.enemies.push(e);
    block.members.push(e);
  }

  /** Shifts a block sideways so its whole formation stays between the tree lines. */
  private keepInField(b: Block): void {
    if (b.members.length === 0) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of b.members) {
      lo = Math.min(lo, e.slotX - this.cfg[e.kind].radius);
      hi = Math.max(hi, e.slotX + this.cfg[e.kind].radius);
    }
    const hw = this.cfg.field.halfWidth - 0.5;
    if (hi - lo > hw * 2) b.x = -(lo + hi) / 2;
    else b.x = Math.max(-hw - lo, Math.min(hw - hi, b.x));
  }

  /** Closes ranks: re-packs the block's foot orcs into its shape, front rank first. */
  private regroup(b: Block): void {
    const foot = b.members.filter((e) => !REAR_KINDS.has(e.kind));
    const slots = formation(b.shape, foot.length, b.spacing);
    // Orcs nearest the wall take the front slots, so nobody runs through the block.
    foot.sort((p, q) => p.y - q.y || p.x - q.x);
    const order = slots.map((s, i) => ({ s, i })).sort((p, q) => p.s.dy - q.s.dy || p.s.dx - q.s.dx);
    // The front of the block stays put: the old front rank's y becomes the new front.
    const shift = foot.length ? Math.min(...foot.map((e) => e.slotY)) : 0;
    order.forEach(({ s }, i) => {
      foot[i].slotX = s.dx;
      foot[i].slotY = s.dy + shift;
    });
    b.dirty = false;
    b.regroupAt = this.time + this.cfg.march.regroupSeconds;
  }

  private updateBlocks(dt: number): void {
    const m = this.cfg.march;
    const keep: Block[] = [];
    for (const b of this.blocks) {
      if (b.drummed && !b.members.some((e) => e.kind === 'drummer' && e.hp > 0)) {
        // The drum falls silent: shields drop and the formation scatters.
        b.drummed = false;
        const drum = b.members.find((e) => e.kind === 'drummer' && e.bowl);
        if (drum) this.toppleShieldTeam(drum, b);
        for (const e of b.members) {
          e.shielded = false;
          e.block = null;
        }
        this.events.push({ type: 'formationBreak', x: b.x, y: b.y });
      }
      const before = b.members.length;
      b.members = b.members.filter((e) => e.hp > 0 && e.block === b);
      if (b.members.length === 0) continue;
      if (b.members.length !== before) b.dirty = true;
      if (b.dirty && this.time >= b.regroupAt) this.regroup(b);
      keep.push(b);
      // Space Invaders: a block marches faster the more of it is gone.
      const lost = 1 - b.members.length / b.start;
      const boost = 1 + m.shrinkBoost * Math.min(1, lost / (1 - m.shrinkAt));
      const rally = Math.max(...b.members.map((e) => e.rally));
      // Spike traps slow a block in step with the share of it caught in them.
      const slow = this.hasTraps ? b.members.reduce((n, e) => n + this.trapSlow(e.x, e.y), 0) / b.members.length : 1;
      b.y -= b.speed * (1 + m.growthPerWave) ** Math.max(0, this.wave - 1) * boost * rally * slow * dt;
      if (b.zig) b.x = b.homeX + Math.sin(this.time * this.cfg.rider.zigRate + b.phase) * (this.cfg.rider.zigSpeed / this.cfg.rider.zigRate);
      this.keepInField(b);
    }
    this.blocks = keep;
  }

  // ---- enemies ------------------------------------------------------------

  private updateShield(dt: number): void {
    const s = this.shield;
    // It can run right out to the ends of the wall, half over the tree line.
    const limit = this.cfg.field.halfWidth - this.shieldHalfWidth() * 0.5;
    const target = Math.max(-limit, Math.min(limit, s.targetX));
    const maxStep = this.cfg.shield.speed * dt;
    const before = s.x;
    s.x += Math.max(-maxStep, Math.min(maxStep, target - s.x));
    s.x = Math.max(-limit, Math.min(limit, s.x));
    s.vx = dt > 0 ? (s.x - before) / dt : 0;
  }

  private cellKey(x: number, y: number): number {
    return (Math.floor(y) + 100) * 1000 + (Math.floor(x) + 500);
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const e of this.enemies) {
      const k = this.cellKey(e.x, e.y);
      const cell = this.grid.get(k);
      if (cell) cell.push(e);
      else this.grid.set(k, [e]);
    }
  }

  /** Calls fn for enemies in grid cells within r of (x, y); return true to stop. */
  private within(x: number, y: number, r: number, fn: (e: Enemy) => boolean | void): void {
    const c = Math.ceil(r);
    for (let gy = -c; gy <= c; gy++) {
      for (let gx = -c; gx <= c; gx++) {
        const cell = this.grid.get(this.cellKey(x + gx, y + gy));
        if (!cell) continue;
        for (const e of cell) if (fn(e) === true) return;
      }
    }
  }

  /** Takes an orc out of its block (it reached the wall, or a soldier). The block closes ranks. */
  private leaveBlock(e: Enemy): void {
    if (e.block) e.block.dirty = true;
    e.block = null;
  }

  private updateEnemies(dt: number): void {
    const { friction, separation } = this.cfg.physics;
    const hw = this.cfg.field.halfWidth;
    const pull = this.cfg.march.pull;

    // Warlords rally the orcs around them.
    const lords = this.enemies.filter((e) => e.kind === 'warlord');
    const aura = this.cfg.warlord;
    for (const e of this.enemies) {
      e.rally = 1;
      for (const l of lords) if (l !== e && Math.hypot(e.x - l.x, e.y - l.y) < aura.auraRadius) e.rally = aura.auraSpeed;
    }

    // Soldiers never stray further from the wall than this, so orcs beyond it needn't look for one.
    const sc = this.cfg.soldiers;
    const soldierReach = this.soldiers.length ? sc.y + 1.2 + sc.guard * sc.heavyGuard + 2 : -Infinity;

    for (const e of this.enemies) {
      const stats = this.cfg[e.kind];
      // Push neighbours apart so knocked orcs don't pile into one sprite.
      let px = 0;
      let py = 0;
      this.within(e.x, e.y, 1, (o) => {
        if (o === e) return;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        const min = stats.radius + this.cfg[o.kind].radius;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          // Big enemies shove small ones, not the other way round.
          const share = this.cfg[o.kind].mass / (stats.mass + this.cfg[o.kind].mass);
          px += (dx / d) * (min - d) * share * 2;
          py += (dy / d) * (min - d) * share * 2;
          // A knocked orc bowls into the ones it hits, passing on some of its momentum.
          const v2 = e.vx * e.vx + e.vy * e.vy;
          if (v2 > 9 && (e.vx * -dx + e.vy * -dy) > 0) {
            const give = 0.35 * (stats.mass / this.cfg[o.kind].mass);
            o.vx += e.vx * give;
            o.vy += e.vy * give;
            e.vx *= 0.75;
            e.vy *= 0.75;
          }
        }
      });

      let mx = 0;
      let my = 0;
      const front = stats.radius;

      if (e.bowl) {
        const w = e.bowl;
        const k = Math.max(0, w.t / w.dur);
        e.x = Math.max(-hw + 0.3, Math.min(hw - 0.3, e.x + w.dx * w.speed * k * dt));
        e.y = Math.max(front, e.y + w.dy * w.speed * k * dt);
        e.vx = 0;
        e.vy = 0;
        w.t -= dt;
        if (w.t <= 0) {
          e.bowl = null;
          e.stagger = this.cfg.bowling.recoverSeconds;
        }
        continue;
      }

      if (e.burnTime > 0) {
        e.burnTime -= dt;
        e.hp -= e.burn * dt;
      }

      // Orcs marching through a spike trap are cut and slowed.
      const trap = this.hasTraps && e.state === 'march' ? this.trapSlow(e.x, e.y) : 1;
      if (trap < 1) this.trapHurt(e, dt);

      switch (e.state) {
        case 'march': {
          if (e.stagger > 0) {
            // Knocked flat by a falling ogre: no marching for a moment.
            e.stagger -= dt;
          } else if (e.block && e.kind === 'barrel' && e.y < this.cfg.waves.barrelSeekY) {
            // Close in, a barrel orc breaks away for the weakest section.
            this.leaveBlock(e);
          } else if (e.block) {
            // Hold the slot in the block: chase it, and keep up with the march.
            const b = e.block;
            const cap = b.speed * 3 + 3;
            // A rabble, not a parade: each stands a little off its slot and sways about.
            const off = this.cfg.march.jitter * b.spacing;
            const sway = this.cfg.march.sway;
            const jx = Math.sin(e.phase * 91.7) * off + Math.sin(this.time * 1.3 + e.phase * 40) * sway;
            const jy = Math.cos(e.phase * 53.3) * off + Math.cos(this.time * 1.1 + e.phase * 23) * sway;
            mx = (b.x + e.slotX + jx - e.x) * pull;
            my = (b.y + e.slotY + jy - e.y) * pull;
            const len = Math.hypot(mx, my);
            if (len > cap) {
              mx *= cap / len;
              my *= cap / len;
            }
          } else {
            mx = Math.sin(this.time * 0.7 + e.phase * 6.28) * 0.15;
            if (e.kind === 'rider') mx = Math.sin(this.time * this.cfg.rider.zigRate + e.phase * 6.28) * this.cfg.rider.zigSpeed;
            if (e.kind === 'barrel') {
              const weakest = this.segmentHp.indexOf(Math.min(...this.segmentHp));
              const tx = -hw + (weakest + 0.5) * this.segmentWidth();
              mx = Math.max(-2, Math.min(2, tx - e.x));
            }
            my = -stats.speed * e.rally;
          }
          const foe = e.y < soldierReach ? this.soldiers.find((s) => s.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < stats.radius + 0.6) : undefined;
          if (foe) {
            e.state = 'fight';
            e.foe = foe;
            this.leaveBlock(e);
          } else if (e.kind === 'orcCatapult' && e.y <= e.standY) {
            e.state = 'stand';
            this.leaveBlock(e);
          } else if (e.y <= front && e.kind === 'barrel') {
            // A powder barrel at the foot of the wall: it blows a hole in that section.
            this.leaveBlock(e);
            e.state = 'wall';
            e.hp = 0;
            this.damageSegment(this.segmentAt(e.x), this.cfg.barrel.wallDamage, e.x, 'barrel');
            this.events.push({ type: 'blast', x: e.x, y: e.y, radius: this.cfg.barrel.blastRadius * 0.6 });
          } else if (e.y <= front && e.vy < 1) {
            // (Not while it is being knocked back off the wall.)
            e.state = stats.climbSeconds > 0 ? 'climb' : 'wall';
            e.timer = stats.climbSeconds;
            this.leaveBlock(e);
          }
          // Chuckers throw pebbles as their block marches.
          if (e.kind === 'chucker' && e.y < this.cfg.chucker.throwFromY && e.state === 'march') {
            e.timer -= dt;
            if (e.timer <= 0) {
              e.timer = this.cfg.chucker.throwInterval;
              this.throwAtWall(e.x, e.y, e.phase < this.cfg.chucker.boltShare ? 'enemyBolt' : 'rock');
            }
          }
          break;
        }
        case 'fight':
          if (!e.foe || e.foe.hp <= 0) {
            e.state = 'march';
            e.foe = null;
            break;
          }
          e.foe.hp -= stats.meleeDps * dt;
          if (e.foe.hp <= 0) this.events.push({ type: 'soldierDown', x: e.foe.x, y: e.foe.y });
          break;
        case 'stand':
          if (e.y > this.cfg.orcCatapult.creepMinY) my = -this.cfg.orcCatapult.standCreep;
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = this.cfg.orcCatapult.throwInterval;
            this.throwAtWall(e.x, e.y, 'boulder');
          }
          break;
        case 'climb':
          e.y = Math.min(e.y, front);
          e.timer -= dt;
          if (e.timer <= 0) e.state = 'wall';
          e.hp -= this.cfg.bonuses.spikesDps * dt;
          break;
        case 'wall':
          e.y = Math.min(e.y, front);
          this.damageSegment(this.segmentAt(e.x), stats.wallDps * dt, e.x, e.kind);
          e.hp -= this.cfg.bonuses.spikesDps * dt;
          break;
      }

      mx *= trap;
      my *= trap;
      e.x += (mx + e.vx) * dt + px * separation * dt;
      e.y += (my + e.vy) * dt + py * separation * dt;
      const decay = Math.exp(-friction * dt);
      e.vx *= decay;
      e.vy *= decay;
      // Round the field's structures, not through them.
      for (const o of this.obstacles) {
        if (o.down) continue;
        const hit = contact(o, e.x, e.y, stats.radius);
        if (hit) {
          e.x += hit.nx * hit.depth;
          e.y += hit.ny * hit.depth;
        }
      }
      this.shapes.forEach((o, i) => {
        if (this.contraptions[i].kind === 'ramp') return;
        const hit = contact(o, e.x, e.y, stats.radius);
        if (hit) {
          e.x += hit.nx * hit.depth;
          e.y += hit.ny * hit.depth;
        }
      });
      e.x = Math.max(-hw + 0.3, Math.min(hw - 0.3, e.x));
      e.y = Math.max(front, e.y);
      // Knocked back off the wall: start marching again.
      if ((e.state === 'wall' || e.state === 'climb') && e.y > front + 0.6) e.state = 'march';
    }
  }

  /** Soldiers rush orcs that come near their stretch of wall, then go back to their posts. */
  private updateSoldiers(dt: number): void {
    if (this.soldiers.length === 0) return;
    const c = this.cfg.soldiers;
    const tavern = this.hasBuilding('tavern');
    const dps = c.dps * this.mult('soldiers', 'damage') * this.mult('soldiers', 'rate') * (tavern ? this.cfg.buildings.tavern.dps : 1);
    const heavies = this.enemies.filter((e) => e.kind === 'ogre' || e.kind === 'warlord');
    // Only orcs near the wall matter; bucket them into 1-wide columns so each soldier checks its own stretch.
    const hw = this.cfg.field.halfWidth;
    const reachY = c.y + 1.2 + c.guard;
    const columns: Enemy[][] = Array.from({ length: hw * 2 + 1 }, () => []);
    for (const e of this.enemies) if (e.y < reachY) columns[Math.max(0, Math.min(hw * 2, Math.floor(e.x + hw)))].push(e);
    // Orcs on the wall anywhere: soldiers with nothing to do at their post trudge over to them.
    const breachers = this.enemies.filter((e) => e.hp > 0 && (e.state === 'climb' || e.state === 'wall'));
    for (const s of this.soldiers) {
      if (s.hp <= 0) continue;
      let target: Enemy | undefined;
      let best = Infinity;
      const consider = (e: Enemy, guard: number) => {
        if (e.hp <= 0 || e.state === 'stand' || Math.hypot(e.x - s.postX, e.y - s.postY) > guard) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y) - this.cfg[e.kind].radius;
        if (d < best) {
          best = d;
          target = e;
        }
      };
      const col = Math.floor(s.postX + hw);
      for (let i = Math.max(0, col - Math.ceil(c.guard)); i <= Math.min(hw * 2, col + Math.ceil(c.guard)); i++) {
        for (const e of columns[i]) consider(e, c.guard);
      }
      // Everyone piles onto ogres and warlords from further along the wall.
      for (const e of heavies) consider(e, c.guard * c.heavyGuard);
      // Nothing near their post: walk (slowly) to the nearest orc on the wall, wherever it is.
      if (!target) {
        for (const e of breachers) {
          const d = Math.hypot(e.x - s.x, e.y - s.y) - this.cfg[e.kind].radius;
          if (d < best) {
            best = d;
            target = e;
          }
        }
      }
      const gx = target ? target.x : s.postX;
      const gy = target ? target.y : s.postY;
      const dx = gx - s.x;
      const dy = gy - s.y;
      const dist = Math.hypot(dx, dy);
      const stopAt = target ? c.reach * 0.8 + this.cfg[target.kind].radius : 0.05;
      // They rush what is close to their post, but trudge along the wall to anything further.
      const near = Math.hypot(gx - s.postX, gy - s.postY) <= c.guard * (target && heavies.includes(target) ? c.heavyGuard : 1);
      if (dist > stopAt) {
        const rush = Math.max(this.armsActive ? this.cfg.callToArms.run : 1, tavern ? this.cfg.buildings.tavern.run : 1);
        const stepLen = Math.min(dist - stopAt, (near ? c.speed : c.walk) * rush * dt);
        s.x += (dx / dist) * stepLen;
        s.y += (dy / dist) * stepLen;
      }
      if (target && best < c.reach) target.hp -= dps * dt;
    }
  }

  private damageSegment(seg: number, amount: number, x: number, source: string): void {
    if (this.segmentHp[seg] <= 0) return;
    this.wallDamage[source] = (this.wallDamage[source] ?? 0) + Math.min(amount, this.segmentHp[seg]);
    this.segmentHp[seg] = Math.max(0, this.segmentHp[seg] - amount);
    if (this.rng.next() < 0.03) this.events.push({ type: 'wallHit', x, y: 0, segment: seg, damage: amount });
    if (this.segmentHp[seg] === 0) this.events.push({ type: 'segmentDestroyed', segment: seg });
  }

  /**
   * Where a catapult aims: near its own lane early on; from seekGapsFromWave, the
   * wall section with the least boulder cover, so a gap in the defence gets found.
   */
  private boulderTarget(fromX: number, avoid: Set<number> = new Set()): number {
    const hw = this.cfg.field.halfWidth;
    if (this.wave >= this.cfg.waves.seekGapsFromWave) {
      const order = [...Array(this.cfg.wall.segments).keys()]
        .filter((i) => !avoid.has(i))
        .map((i) => ({ i, cover: this.sectionCover(i) + this.rng.next() * 0.5 }))
        .sort((a, b) => a.cover - b.cover);
      if (order.length) {
        const w = this.segmentWidth();
        return -hw + (order[0].i + 0.2 + this.rng.next() * 0.6) * w;
      }
    }
    return Math.max(-hw + 1, Math.min(hw - 1, fromX + this.rng.range(-6, 6)));
  }

  /** Throws a rock or boulder at the wall at tx, landing after flight seconds (default: its normal speed). */
  private throwAtWall(x: number, y: number, kind: 'rock' | 'boulder' | 'enemyBolt', tx?: number, flight?: number): void {
    const hw = this.cfg.field.halfWidth;
    const target = tx ?? (kind === 'boulder' ? this.boulderTarget(x) : Math.max(-hw + 1, Math.min(hw - 1, x + this.rng.range(-8, 8))));
    const dx = target - x;
    const dy = 0 - y;
    const d = Math.hypot(dx, dy);
    const c = this.cfg[kind];
    const sp = flight ? d / flight : c.speed;
    this.projectiles.push({
      kind, x, y, vx: (dx / d) * sp, vy: (dy / d) * sp,
      friendly: false, travelled: 0, flight: d, damage: c.wallDamage,
      hitsLeft: 1, hit: new Set(),
    });
  }

  /**
   * Salvos: the catapults loose 2 to 5 boulders together, landing within half a second
   * of each other on different sections. The shield can catch one or two; the rest are
   * the defences' job.
   */
  private updateSalvo(dt: number): void {
    const w = this.cfg.waves;
    if (this.phase !== 'battle' || this.wave < w.salvoFromWave) return;
    this.salvoTimer -= dt;
    if (this.salvoTimer > 0) return;
    const cats = this.enemies.filter((e) => e.kind === 'orcCatapult' && e.state === 'stand');
    if (cats.length === 0) return;
    this.salvoTimer = w.salvoInterval;
    const size = Math.min(w.salvoMax, w.salvoBase + Math.floor((this.wave - w.salvoFromWave) / w.salvoEvery));
    const used = new Set<number>();
    for (let k = 0; k < size && used.size < this.cfg.wall.segments; k++) {
      const cat = cats[k % cats.length];
      let tx = this.boulderTarget(cat.x, used);
      // Each boulder of the salvo goes at a different section.
      for (let tries = 0; used.has(this.segmentAt(tx)) && tries < 10; tries++) tx = this.boulderTarget(this.rng.range(-20, 20), used);
      used.add(this.segmentAt(tx));
      this.throwAtWall(cat.x, cat.y, 'boulder', tx, w.salvoFlight + this.rng.next() * w.salvoSpread);
      cat.timer = Math.max(cat.timer, this.cfg.orcCatapult.throwInterval * 0.5);
    }
    this.events.push({ type: 'salvo', size });
  }

  // ---- defenders ----------------------------------------------------------

  private updateDefenders(dt: number): void {
    if (this.phase !== 'battle') return;
    for (const d of this.defenders) {
      d.timer -= dt;
      if (d.timer > 0) continue;
      if (d.kind === 'crossbow') this.fireCrossbow(d);
      else if (d.kind === 'archers') this.fireVolley(d);
      else if (d.kind === 'catapult') this.fireCatapult(d);
      else if (d.kind === 'mage') this.fireMage(d);
      else if (d.kind === 'ballista') this.fireBallista(d);
      else if (d.kind === 'oil') this.fireOil(d);
    }
  }

  /** The mage blasts the thickest crowd it covers: damage falls off toward the rim of the blast. */
  private fireMage(def: Defender): void {
    const m = this.cfg.mage;
    const crowd = this.densestCrowd(def);
    if (!crowd) return;
    def.timer = m.interval / this.mult('mage', 'rate');
    def.firedAt = this.time;
    def.aimX = crowd.x;
    def.aimY = crowd.y;
    const radius = this.mageRadius();
    const damage = m.damage * this.mult('mage', 'damage');
    this.within(crowd.x, crowd.y, radius + MAX_RADIUS, (e) => {
      const dx = e.x - crowd.x;
      const dy = e.y - crowd.y;
      const d = Math.hypot(dx, dy);
      if (e.hp <= 0 || d > radius + this.cfg[e.kind].radius * 0.5) return;
      e.hp -= damage * (1 - (1 - m.edgeShare) * Math.min(1, d / radius));
      const kb = m.knockback / this.cfg[e.kind].mass;
      e.vx += (dx / (d || 1)) * kb;
      e.vy += (dy / (d || 1)) * kb;
      this.events.push({ type: 'hit', x: e.x, y: e.y });
    });
    this.events.push({ type: 'mageBlast', x: crowd.x, y: crowd.y, fromX: def.x, fromY: def.y, radius });
  }

  /** The ballista looses at the siege tower if it is in the lane, otherwise along the line with the most orcs in it. */
  private fireBallista(def: Defender): void {
    const b = this.cfg.ballista;
    const lane = this.cfg.coverage.ballistaLane;
    const covered = this.enemies.filter((e) => e.hp > 0 && this.covers(def, e.x, e.y));
    const tw = this.tower;
    let aim: { x: number; y: number } | undefined = tw && this.covers(def, tw.x, tw.y + 1) ? { x: tw.x, y: tw.y + 1 } : undefined;
    if (!aim) {
      let best = 0;
      for (const t of covered) {
        const dx = t.x - def.x;
        const dy = t.y - def.y;
        const len = Math.hypot(dx, dy) || 1;
        let n = 0;
        for (const e of covered) {
          const along = ((e.x - def.x) * dx + (e.y - def.y) * dy) / len;
          if (along > 0 && Math.abs((e.x - def.x) * dy - (e.y - def.y) * dx) / len <= lane) n++;
        }
        if (n > best) {
          best = n;
          aim = t;
        }
      }
    }
    if (!aim) return;
    def.timer = b.interval / this.mult('ballista', 'rate');
    def.firedAt = this.time;
    def.aimX = aim.x;
    def.aimY = aim.y;
    const dx = aim.x - def.x;
    const dy = aim.y - def.y;
    const d = Math.hypot(dx, dy) || 1;
    this.projectiles.push({
      kind: 'bolt', x: def.x, y: def.y, vx: (dx / d) * b.boltSpeed, vy: (dy / d) * b.boltSpeed,
      friendly: true, travelled: 0, flight: b.range, damage: b.damage * this.mult('ballista', 'damage'),
      hitsLeft: b.pierce, hit: new Set(), big: true, falloff: this.ballistaFalloff(),
    });
    this.events.push({ type: 'ballistaFired', x: def.x, y: def.y, aimX: aim.x, aimY: aim.y });
  }

  /** Boiling oil: only orcs on the wall or climbing it, in the stretch below the cauldron. */
  private fireOil(def: Defender): void {
    const o = this.cfg.oil;
    const victims = this.enemies.filter((e) => e.hp > 0 && (e.state === 'wall' || e.state === 'climb') && this.covers(def, e.x, e.y));
    if (victims.length === 0) return;
    def.timer = o.interval / this.mult('oil', 'rate');
    def.firedAt = this.time;
    const lv = this.levels.oil.special;
    const damage = o.damage * this.mult('oil', 'damage');
    for (const e of victims) {
      e.hp -= damage;
      e.burn = Math.max(e.burn, o.burn + o.burnStep * lv);
      e.burnTime = Math.max(e.burnTime, o.burnSeconds + o.burnSecondsStep * lv);
      this.events.push({ type: 'hit', x: e.x, y: e.y });
    }
    this.events.push({ type: 'oilPour', x: def.x, y: def.y, width: o.halfWidth * 2 });
  }

  private fireCrossbow(def: Defender): void {
    const cb = this.cfg.crossbow;
    // Catapults first (fewer boulders), then ogres and warlords, nearest first; otherwise the nearest orc.
    let target: Enemy | undefined;
    let rank = -1;
    for (const e of this.enemies) {
      if (!this.covers(def, e.x, e.y)) continue;
      const r = CROSSBOW_PRIORITY[e.kind] ?? 0;
      if (!target || r > rank || (r === rank && e.y < target.y)) {
        target = e;
        rank = r;
      }
    }
    // A siege tower in its lane comes after catapults: heavy bolts knock its planks out.
    const tw = this.tower;
    const aim = tw && rank < 3 && this.covers(def, tw.x, tw.y + 1) ? { x: tw.x, y: tw.y + 1 } : target;
    if (!aim) return;
    def.timer = cb.interval / this.mult('crossbow', 'rate');
    def.firedAt = this.time;
    const dx = aim.x - def.x;
    const dy = aim.y - def.y;
    const d = Math.hypot(dx, dy) || 1;
    def.aimX = aim.x;
    def.aimY = aim.y;
    this.projectiles.push({
      kind: 'bolt', x: def.x, y: def.y, vx: (dx / d) * cb.boltSpeed, vy: (dy / d) * cb.boltSpeed,
      friendly: true, travelled: 0, flight: cb.range, damage: cb.damage * this.mult('crossbow', 'damage'),
      hitsLeft: this.crossbowPierce(), hit: new Set(),
    });
    this.events.push({ type: 'boltFired', x: def.x, y: def.y });
  }

  /**
   * The middle of the thickest crowd within range of a defender, or undefined.
   * Heavies and throwers count extra, so big targets and rock chuckers draw fire.
   */
  private densestCrowd(def: Defender | null): { x: number; y: number; speed: number } | undefined {
    const size = 4;
    type Bucket = { weight: number; n: number; x: number; y: number; speed: number };
    const buckets = new Map<number, Bucket>();
    let best: Bucket | undefined;
    for (const e of this.enemies) {
      if (e.y < 2 || (def ? !this.covers(def, e.x, e.y) : e.y > this.cfg.field.topY)) continue;
      const k = Math.floor(e.y / size) * 1000 + Math.floor(e.x / size + 100);
      const b = buckets.get(k) ?? { weight: 0, n: 0, x: 0, y: 0, speed: 0 };
      b.weight += e.kind === 'warlord' || e.kind === 'ogre' ? 4 : e.kind === 'chucker' || e.state === 'stand' ? 3 : 1;
      b.n++;
      b.x += e.x;
      b.y += e.y;
      if (e.state === 'march') b.speed += e.block ? e.block.speed : this.cfg[e.kind].speed * e.rally;
      buckets.set(k, b);
      if (!best || b.weight > best.weight) best = b;
    }
    // speed is how fast the crowd is coming on, so shots can lead it.
    return best && { x: best.x / best.n, y: best.y / best.n, speed: best.speed / best.n };
  }

  /** Lobs a projectile from a defender to land at (tx, ty) after a set flight time. */
  private lob(def: { x: number; y: number }, kind: 'stone' | 'arrow', tx: number, ty: number, flightTime: number, damage: number, extra: Partial<Projectile>): void {
    const dx = tx - def.x;
    const dy = ty - def.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = d / flightTime;
    this.projectiles.push({
      kind, x: def.x, y: def.y, vx: (dx / d) * sp, vy: (dy / d) * sp,
      friendly: true, travelled: 0, flight: d, damage, hitsLeft: 1, hit: new Set(), ...extra,
    });
  }

  /** The whole squad looses at once: arrows arc high and rain down around the thickest crowd. */
  private fireVolley(def: Defender): void {
    const a = this.cfg.archers;
    // First, any boulder flying through the squad's cover may be shot down.
    let shot = false;
    this.projectiles = this.projectiles.filter((p) => {
      if (p.friendly || p.kind !== 'boulder' || !this.covers(def, p.x, p.y)) return true;
      shot = true;
      if (this.rng.next() >= a.shootDown) return true;
      this.events.push({ type: 'shotDown', x: p.x, y: p.y });
      return false;
    });
    const crowd = this.densestCrowd(def);
    if (shot && !crowd) {
      def.timer = a.interval / this.mult('archers', 'rate');
      def.firedAt = this.time;
    }
    if (!crowd) return;
    // Lead the target: aim where the crowd will be when the arrows come down.
    const ty = crowd.y - crowd.speed * a.flightTime;
    def.timer = a.interval / this.mult('archers', 'rate');
    def.firedAt = this.time;
    def.aimX = crowd.x;
    def.aimY = ty;
    const damage = a.damage * this.mult('archers', 'damage');
    const burn = this.arrowBurn();
    for (let i = 0; i < a.archers; i++) {
      const r = a.spread * Math.sqrt(this.rng.next());
      const t = this.rng.next() * Math.PI * 2;
      // Arrows don't all leave and land together: a little spread in flight time too.
      this.lob(def, 'arrow', crowd.x + Math.cos(t) * r, ty + Math.sin(t) * r, a.flightTime * this.rng.range(0.9, 1.1), damage, { burn });
    }
    this.events.push({ type: 'volley', x: def.x, y: def.y, arrows: a.archers });
  }

  /** The castle catapult lobs a fresh Royal Ball over the wall toward the thickest crowd. */
  private fireCatapult(def: Defender): void {
    const c = this.cfg.catapult;
    const crowd = this.densestCrowd(def);
    if (!crowd) return;
    def.timer = c.interval / this.mult('catapult', 'rate');
    def.firedAt = this.time;
    if (def.heading === null) {
      def.aimX = crowd.x;
      def.aimY = crowd.y;
    }
    // Launched from clear of the shield and the turrets: along its aim, or at the crowd.
    const y = this.cfg.bumpers.y + 2;
    const angle = def.heading ?? Math.max(-c.spread, Math.min(c.spread, Math.atan2(crowd.x - def.x, crowd.y - y)));
    const sp = this.cfg.balls.speed;
    const b = this.addBall('royal', def.x, y, Math.sin(angle) * sp, Math.cos(angle) * sp);
    b.power = this.mult('catapult', 'damage');
  }

  /** A volley arrow comes down and hits whoever is closest to where it lands. */
  private landArrow(p: Projectile): void {
    const r = this.cfg.archers.hitRadius;
    let target: Enemy | undefined;
    let best = Infinity;
    this.within(p.x, p.y, r + MAX_RADIUS, (e) => {
      const d = Math.hypot(e.x - p.x, e.y - p.y) - this.cfg[e.kind].radius;
      if (e.hp > 0 && d < r && d < best) {
        best = d;
        target = e;
      }
    });
    if (!target) return;
    // Shooting straight down the face of their own wall, archers mostly miss: soldiers are the answer there.
    const onWall = target.state === 'climb' || target.state === 'wall';
    target.hp -= p.damage * (onWall ? this.cfg.archers.wallShare : 1);
    if (p.burn) {
      target.burn = Math.max(target.burn, p.burn);
      target.burnTime = this.cfg.archers.burnSeconds;
    }
    this.events.push({ type: 'hit', x: target.x, y: target.y });
  }

  private updateProjectiles(dt: number): void {
    const hw = this.cfg.field.halfWidth;
    const sy = this.cfg.shield.y;
    const keep: Projectile[] = [];

    for (const p of this.projectiles) {
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.travelled += Math.hypot(p.vx, p.vy) * dt;
      let alive = true;

      if (!p.friendly) {
        const r = this.cfg[p.kind as 'rock' | 'boulder' | 'enemyBolt'].radius;
        if (prevY > sy + r && p.y <= sy + r && Math.abs(p.x - this.shield.x) <= this.shieldHalfWidth() + r && p.kind === 'enemyBolt') {
          // A bolt just splinters on the steel.
          this.blocked++;
          this.events.push({ type: 'deflect', x: p.x, y: sy, parry: false, trick: false });
          alive = false;
        } else if (prevY > sy + r && p.y <= sy + r && Math.abs(p.x - this.shield.x) <= this.shieldHalfWidth() + r) {
          // Blocked: the boulder is ours now, and becomes a ball.
          this.blocked++;
          const b = this.addBall(p.kind === 'boulder' ? 'claimed' : 'pebble', p.x, sy + r, p.vx, p.vy);
          if (b.kind === 'pebble') b.power = this.cfg.balls.pebbleShare;
          this.shieldHit(b);
          alive = false;
        } else if (p.y <= 0) {
          const seg = this.segmentAt(p.x);
          this.missed++;
          this.damageSegment(seg, p.damage, p.x, p.kind);
          this.events.push({ type: 'wallHit', x: p.x, y: 0, segment: seg, damage: p.damage });
          alive = false;
        }
      } else if (p.kind === 'arrow') {
        if (p.travelled >= p.flight) {
          this.landArrow(p);
          alive = false;
        }
      } else {
        const r = p.big ? this.cfg.ballista.hitRadius : 0.6;
        this.within(p.x, p.y, r + MAX_RADIUS, (e) => {
          if (e.hp <= 0 || p.hit.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > r + this.cfg[e.kind].radius * 0.6) return;
          p.hit.add(e);
          e.hp -= p.damage * (p.big && (e.shielded || e.block?.drummed) ? this.cfg.ballista.formationMult : 1);
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const kb = (p.big ? this.cfg.ballista.knockback : this.cfg.crossbow.knockback) / this.cfg[e.kind].mass;
          e.vx += (p.vx / sp) * kb;
          e.vy += (p.vy / sp) * kb;
          if (e.state === 'wall' || e.state === 'climb') e.state = 'march';
          this.events.push({ type: 'hit', x: e.x, y: e.y });
          p.damage *= 1 - (p.falloff ?? this.cfg.crossbow.pierceFalloff);
          p.hitsLeft--;
          return p.hitsLeft <= 0;
        });
        if (p.hitsLeft <= 0) alive = false;
        // A crossbow bolt that reaches the siege tower thuds into its bottom floor.
        const tw = this.tower;
        const st = this.cfg.siegeTower;
        if (alive && p.kind === 'bolt' && tw && Math.abs(p.x - tw.x) <= st.halfWidth && p.y >= tw.y && p.y <= tw.y + st.depth) {
          this.hitPlank(0, p.x, p.big ? this.cfg.ballista.plankHits : 1);
          alive = false;
        }
        if (p.travelled > p.flight || Math.abs(p.x) > hw + 5 || p.y > this.cfg.field.spawnY + 10) alive = false;
      }
      if (alive) keep.push(p);
    }
    this.projectiles = keep;
  }

  // ---- balls ----------------------------------------------------------------

  private addBall(kind: BallKind, x: number, y: number, vx: number, vy: number, primary = false): Ball {
    const b: Ball = {
      id: this.nextBallId++, kind, x, y, vx, vy, primary, power: 1, combo: 0, behind: false, heaved: false, perfect: false,
      stuck: false, stuckOffset: 0, stuckAt: 0, hitShieldAt: -99, born: this.time, passing: null, lines: 0, milestone: 0, banked: false, spin: 0,
    };
    this.balls.push(b);
    this.enforceCap();
    return b;
  }

  /** Over the cap, the oldest claimed boulder crumbles. The served Royal Ball never does. */
  private enforceCap(): void {
    while (this.balls.length > this.cfg.balls.cap) {
      let oldest = -1;
      for (let i = 0; i < this.balls.length; i++) {
        const b = this.balls[i];
        if (b.primary || b.stuck) continue;
        if (oldest < 0 || (b.kind !== 'royal' && this.balls[oldest].kind === 'royal') || (b.kind === this.balls[oldest].kind && b.born < this.balls[oldest].born)) oldest = i;
      }
      if (oldest < 0) return;
      this.balls.splice(oldest, 1);
    }
  }

  /** Puts the Royal Ball on the shield, ready to serve. */
  private serveRoyal(): void {
    const b = this.addBall('royal', this.shield.x, this.cfg.shield.y + this.cfg.balls.radius, 0, 0, true);
    b.stuck = true;
    b.stuckOffset = 0;
    b.stuckAt = this.time;
  }

  /** Launches every ball riding on the shield. */
  private releaseStuck(): boolean {
    let any = false;
    for (const b of this.balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      any = true;
      // A centred serve still gets a little angle, so it doesn't go straight up and down forever.
      this.serve(b);
    }
    return any;
  }

  /**
   * The Hybrid bounce: the angle off straight up a ball leaves the shield at. Across the
   * middle the shield is a flat mirror, so it leaves at the angle it came in (inAngle,
   * measured the same way: + heading right). The edges (offset beyond edgeZone, -1 is the
   * left edge) kick it wide outward, a trick shot.
   */
  bounceAngle(offset: number, inAngle = 0): number {
    const c = this.cfg.shield;
    const o = Math.max(-1, Math.min(1, offset));
    const a = Math.abs(o);
    if (a <= c.edgeZone) return inAngle;
    return Math.sign(o) * (c.trickMin + ((a - c.edgeZone) / (1 - c.edgeZone)) * (c.trickMax - c.trickMin));
  }

  /** Sends a ball up off the shield at an angle off straight up, at a speed. */
  private launch(b: Ball, angle: number, speed: number): void {
    const max = this.cfg.shield.trickMax;
    const a = Math.max(-max, Math.min(max, angle));
    b.vx = Math.sin(a) * speed;
    b.vy = Math.cos(a) * speed;
    b.y = this.cfg.shield.y + this.cfg.balls.radius + 0.01;
  }

  /** Serves a ball riding on the shield: it goes up at an angle set by where it sits (a centred one gets a little nudge). */
  private serve(b: Ball): void {
    const off = Math.abs(b.stuckOffset) < 0.1 ? this.rng.range(-0.35, 0.35) : b.stuckOffset / this.shieldHalfWidth();
    b.spin = 0;
    this.launch(b, off * this.cfg.shield.serveAngle, b.kind === 'royal' ? this.cfg.balls.royalSpeed : this.cfg.balls.speed);
  }

  private powerUp(b: Ball): void {
    const sp = Math.hypot(b.vx, b.vy);
    const target = Math.min(this.cfg.balls.maxSpeed * this.cfg.shield.heaveSpeed, sp * this.cfg.shield.heaveSpeed);
    b.vx *= target / sp;
    b.vy *= target / sp;
    b.lines = this.heaveLines();
    b.heaved = true;
    this.parries++;
  }

  /** A ball (or a boulder being claimed) meets the shield: Arkanoid bounce, clang. */
  private shieldHit(b: Ball): void {
    const c = this.cfg.balls;
    const s = this.shield;
    const half = this.shieldHalfWidth();
    const offset = (b.x - s.x) / half;
    const base = b.kind === 'royal' ? c.royalSpeed : c.speed;
    const speed = Math.min(c.maxSpeed, Math.max(base, Math.hypot(b.vx, b.vy) * c.speedUp));
    // Hybrid bounce: mirror off the flat middle, kick off the edges, plus English and curve from the shield's movement.
    const move = s.vx / this.cfg.shield.speed;
    this.launch(b, this.bounceAngle(offset, Math.atan2(b.vx, -b.vy)) + move * this.cfg.shield.english, speed);
    b.spin = -move * this.cfg.shield.curve;
    const trick = Math.abs(offset) > this.cfg.shield.edgeZone;
    b.combo = trick ? c.trickCombo : 0;
    b.milestone = 0;
    b.behind = false;
    b.lines = 0;
    b.banked = false;
    b.heaved = false;
    b.perfect = false;
    b.hitShieldAt = this.time;
    b.passing = null;
    // Judged on the sim clock at contact, so frame rate can't change the result.
    const heaved = this.time - s.heaveAt <= this.heaveWindow();
    const perfect = this.time - s.bashAt <= this.heaveWindow();
    if (heaved) {
      this.powerUp(b);
      s.heaveAt = -99;
    }
    if (perfect) {
      // A Perfect Return: a fresh press just before contact. The first ball to land spends it, and a
      // ball that was already perfect is only refreshed (the flag is set again, nothing multiplies twice).
      const cap = c.maxSpeed * this.cfg.shield.heaveSpeed;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const out = Math.min(cap, sp * this.cfg.shield.perfectSpeed);
      b.vx *= out / sp;
      b.vy *= out / sp;
      b.perfect = true;
      s.bashAt = -99;
      this.perfects++;
      this.events.push({ type: 'perfect', x: b.x, y: this.cfg.shield.y, at: this.time, ball: b.id });
    }
    if (this.stickyCatches > 0 && !heaved && !perfect) {
      this.stickyCatches--;
      b.stuck = true;
      b.stuckOffset = b.x - s.x;
      b.stuckAt = this.time;
    }
    this.events.push({ type: 'deflect', x: b.x, y: this.cfg.shield.y, parry: heaved, trick, perfect });
    this.events.push({ type: 'shieldBounce', x: b.x, y: this.cfg.shield.y, vx: b.vx, vy: b.vy });
  }

  /** Keeps a ball from skating sideways forever. */
  private steepen(b: Ball): void {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const min = sp * this.cfg.balls.minVertical;
    if (Math.abs(b.vy) >= min) return;
    b.vy = (b.vy < 0 ? -1 : 1) * min;
    b.vx = Math.sign(b.vx || 1) * Math.sqrt(sp * sp - min * min);
  }

  private updateBalls(dt: number): void {
    const c = this.cfg.balls;
    const hw = this.cfg.field.halfWidth;
    const top = this.cfg.field.topY;
    const sy = this.cfg.shield.y + c.radius;
    const r = c.radius;
    const keep: Ball[] = [];
    const bumpers = this.bumpers();
    this.updateBells();

    if (this.phase === 'battle' && !this.balls.some((b) => b.primary) && this.time >= this.royalDue) this.serveRoyal();

    for (const b of this.balls) {
      if (b.stuck) {
        b.x = this.shield.x + b.stuckOffset;
        b.y = sy;
        if (this.time - b.stuckAt >= c.autoServeSeconds) {
          b.stuck = false;
          this.serve(b);
        }
        keep.push(b);
        continue;
      }
      // Substeps, so a fast ball can't tunnel through an orc.
      const sp = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil((sp * dt) / 0.3));
      const h = dt / steps;
      let alive = true;
      // Curve: the path bends while the spin lasts.
      if (b.spin !== 0) {
        const turn = b.spin * dt;
        const cs = Math.cos(turn);
        const sn = Math.sin(turn);
        [b.vx, b.vy] = [b.vx * cs - b.vy * sn, b.vx * sn + b.vy * cs];
        b.spin *= Math.exp(-dt / this.cfg.shield.curveSeconds);
        if (Math.abs(b.spin) < 0.01) b.spin = 0;
        this.steepen(b);
      }
      for (let k = 0; k < steps && alive && !b.stuck; k++) {
        const prevY = b.y;
        b.x += b.vx * h;
        b.y += b.vy * h;
        // The tree lines and the top edge are solid.
        if (b.x < -hw + r) {
          b.x = -hw + r;
          b.vx = Math.abs(b.vx);
          this.steepen(b);
          this.events.push({ type: 'edge', x: -hw, y: b.y, side: -1 });
        } else if (b.x > hw - r) {
          b.x = hw - r;
          b.vx = -Math.abs(b.vx);
          this.steepen(b);
          this.events.push({ type: 'edge', x: hw, y: b.y, side: 1 });
        }
        if (b.y > top - r) {
          // Only the Royal Ball rebounds off the back; a caught boulder sails away over the horde.
          if (b.kind !== 'royal') {
            this.events.push({ type: 'flyOff', x: b.x, y: top });
            alive = false;
            break;
          }
          b.y = top - r;
          b.vy = -Math.abs(b.vy);
          b.behind = true;
          this.events.push({ type: 'rebound', x: b.x, y: top });
        }
        if (b.vy < 0 && prevY >= sy && b.y < sy && Math.abs(b.x - this.shield.x) <= this.shieldHalfWidth() + r) {
          this.shieldHit(b);
          continue;
        }
        if (b.y <= 0) {
          this.loseBall(b);
          alive = false;
          break;
        }
        if (b.air) {
          // Over the ramp: nothing on the ground touches it until it drops.
          if (b.y >= b.air.landY || b.vy <= 0 || this.time >= b.air.until) this.rampLand(b);
          continue;
        }
        if (bumpers.length && b.y < this.cfg.bumpers.y + 2) this.ballVsBumpers(b, bumpers);
        if (this.tower) this.ballVsTower(b);
        if (this.obstacles.length) this.ballVsObstacles(b);
        if (this.contraptions.length) this.ballVsContraptions(b);
        this.ballVsTraps(b);
        this.ballVsOrcs(b);
      }
      if (alive) keep.push(b);
    }
    this.balls = keep;
    this.ballVsBalls();
  }

  /** Balls knock into each other: an equal-mass elastic bounce, with a hit size a touch smaller than they look. */
  private ballVsBalls(): void {
    const min = this.cfg.balls.radius * 2;
    const free = this.balls.filter((b) => !b.stuck && !b.air);
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i];
        const b = free[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // Push apart, and swap the velocity along the line between them if they're closing.
        const push = (min - d) / 2 + 0.01;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        if (rel <= 0) continue;
        a.vx -= rel * nx;
        a.vy -= rel * ny;
        b.vx += rel * nx;
        b.vy += rel * ny;
        this.steepen(a);
        this.steepen(b);
        this.events.push({ type: 'bounce', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
  }

  private loseBall(b: Ball): void {
    const damage = this.cfg.balls.missDamage * (b.kind === 'pebble' ? this.cfg.balls.pebbleShare : 1);
    const seg = this.segmentAt(b.x);
    this.damageSegment(seg, damage, b.x, `missed ${b.kind}`);
    this.ballsLost++;
    this.events.push({ type: 'ballLost', x: b.x, kind: b.kind });
    this.events.push({ type: 'wallHit', x: b.x, y: 0, segment: seg, damage });
    if (b.primary) this.royalDue = this.time + this.cfg.balls.reserveSeconds;
  }

  /** Adds to a ball's combo, with an event at each milestone (a bell, "Glorious!", a golden ball). */
  private addCombo(b: Ball, n: number): void {
    b.combo += n;
    this.bestCombo = Math.max(this.bestCombo, b.combo);
    const marks = this.cfg.balls.comboMilestones;
    while (b.milestone < marks.length && b.combo >= marks[b.milestone]) {
      this.events.push({ type: 'combo', x: b.x, y: b.y, combo: marks[b.milestone] });
      b.milestone++;
    }
  }

  /** Mirrors a ball's velocity about a surface normal if it is heading into the surface. */
  private reflect(b: Ball, nx: number, ny: number): void {
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 2 * vn * nx;
      b.vy -= 2 * vn * ny;
    }
    this.steepen(b);
  }

  /** The field's structures are bank shots too: the ball glances off at whatever angle the stone gives it. */
  private ballVsObstacles(b: Ball): void {
    const r = this.cfg.balls.radius;
    this.obstacles.forEach((o, index) => {
      if (o.down) return;
      const hit = contact(o, b.x, b.y, r);
      if (!hit || b.vx * hit.nx + b.vy * hit.ny >= 0) return;
      this.reflect(b, hit.nx, hit.ny);
      b.x += hit.nx * (hit.depth + 0.01);
      b.y += hit.ny * (hit.depth + 0.01);
      b.banked = true;
      this.addCombo(b, this.cfg.bumpers.bankCombo);
      if (!needsHeave(o) || b.heaved) {
        // One hit and it comes crashing down (stone needs a heaved ball) and is gone.
        o.down = true;
        this.events.push({ type: 'treeDown', x: o.x, y: o.y, index });
        return;
      }
      this.events.push({ type: 'obstacle', x: b.x - hit.nx * r, y: b.y - hit.ny * r, index });
    });
  }

  /** Bumpers kick, bells ring (and bounce lightly), ramps launch. A ball in the air touches none of them. */
  private ballVsContraptions(b: Ball): void {
    const r = this.cfg.balls.radius;
    const k = this.cfg.contraptions;
    this.contraptions.forEach((c, index) => {
      const o = this.shapes[index];
      if (b.air) return;
      if (c.kind === 'ramp') {
        if (b.vy > 0 && nearestOn(o, b.x, b.y).inside) {
          const landY = Math.min(b.y + k.ramp.distance, this.cfg.field.topY - r);
          b.air = { fromY: b.y, landY, until: this.time + ((landY - b.y) / b.vy) * 1.5 + 0.2 };
          b.passing = null;
          this.events.push({ type: 'rampLaunch', x: b.x, y: b.y, index });
        }
        return;
      }
      const hit = contact(o, b.x, b.y, r);
      if (!hit || b.vx * hit.nx + b.vy * hit.ny >= 0) return;
      this.reflect(b, hit.nx, hit.ny);
      b.x += hit.nx * (hit.depth + 0.01);
      b.y += hit.ny * (hit.depth + 0.01);
      if (c.kind === 'bumper') {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const kicked = Math.max(sp, Math.min(this.cfg.balls.maxSpeed, sp * k.bumper.kick));
        b.vx *= kicked / sp;
        b.vy *= kicked / sp;
        b.banked = true;
        this.bumperHit[index] = this.time;
        this.addCombo(b, k.bumper.combo);
        this.events.push({ type: 'bumper', x: c.x, y: c.y, index });
      } else if (this.bellRung[index] < 0) {
        this.ringBell(b, index);
      }
    });
  }

  /** Spike traps are round posts to the ball: it glances off, counts as a bank, and the trap stays. */
  private ballVsTraps(b: Ball): void {
    const r = this.cfg.balls.radius;
    for (const d of this.defenders) {
      if (d.kind !== 'spiketrap') continue;
      const dx = b.x - d.x;
      const dy = b.y - d.y;
      const dist = Math.hypot(dx, dy);
      const reach = r + this.cfg.spiketrap.footprint;
      if (dist >= reach || dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      if (b.vx * nx + b.vy * ny >= 0) continue;
      this.reflect(b, nx, ny);
      b.x = d.x + nx * (reach + 0.01);
      b.y = d.y + ny * (reach + 0.01);
      b.banked = true;
      this.addCombo(b, this.cfg.bumpers.bankCombo);
      this.events.push({ type: 'spikeHit', x: b.x, y: b.y, id: d.id });
      return;
    }
  }

  private ringBell(b: Ball, index: number): void {
    const k = this.cfg.contraptions.bell;
    const c = this.contraptions[index];
    const set = this.contraptions.flatMap((o, i) => (o.kind === 'bell' && (o.group ?? 0) === (c.group ?? 0) ? [i] : []));
    this.bellRung[index] = this.time;
    this.addCombo(b, k.combo);
    const rung = set.filter((i) => this.bellRung[i] >= 0).length;
    this.events.push({ type: 'bell', x: c.x, y: c.y, index, rung });
    if (rung < Math.min(k.count, set.length)) return;
    // The whole set rang: a free volley from the wall below the bells, then the bells reset.
    this.bellReset.set(c.group ?? 0, this.time + k.resetSeconds);
    const x = set.reduce((n, i) => n + this.contraptions[i].x, 0) / set.length;
    const crowd = this.densestCrowd(null);
    let arrows = 0;
    if (crowd) {
      const ty = crowd.y - crowd.speed * k.flightTime;
      arrows = k.arrows;
      for (let i = 0; i < arrows; i++) {
        const r = k.spread * Math.sqrt(this.rng.next());
        const t = this.rng.next() * Math.PI * 2;
        this.lob({ x, y: 0 }, 'arrow', crowd.x + Math.cos(t) * r, ty + Math.sin(t) * r, k.flightTime * this.rng.range(0.9, 1.1), k.damage, {});
      }
    }
    this.events.push({ type: 'bellVolley', x, y: 0, arrows });
  }

  /** Rung bells hang there swinging until their set's reset time. */
  private updateBells(): void {
    for (const [group, at] of this.bellReset) {
      if (this.time < at) continue;
      this.bellReset.delete(group);
      this.contraptions.forEach((c, i) => {
        if (c.kind === 'bell' && (c.group ?? 0) === group) this.bellRung[i] = -1;
      });
    }
  }

  /** A ball drops off a ramp: a boulder-drop splash hurts every orc around the landing spot. */
  private rampLand(b: Ball): void {
    const k = this.cfg.contraptions.ramp;
    const mult = this.ballGoldMult(b);
    const dmg = k.damage * b.power;
    let hits = 0;
    b.air = undefined;
    this.within(b.x, b.y, k.splashRadius + MAX_RADIUS, (o) => {
      if (o.hp <= 0) return;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > k.splashRadius + this.cfg[o.kind].radius * 0.5) return;
      hits++;
      o.hp -= dmg;
      o.goldMult = mult;
      o.lastBall = b.id;
      const kb = k.knockback / this.cfg[o.kind].mass;
      o.vx += (dx / (d || 1)) * kb;
      o.vy += (dy / (d || 1)) * kb;
      if (o.state === 'wall' || o.state === 'climb' || o.state === 'fight') {
        o.state = 'march';
        o.foe = null;
      }
    });
    if (hits) this.addCombo(b, k.combo * hits);
    this.events.push({ type: 'rampLand', x: b.x, y: b.y, radius: k.splashRadius, hits });
  }

  /** Bank shots off the tower turrets: a free save, +2 combo and a harder next hit. */
  private ballVsBumpers(b: Ball, bumpers: Bumper[]): void {
    const r = this.cfg.balls.radius;
    for (const p of bumpers) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= r + p.r || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      if (b.vx * nx + b.vy * ny >= 0) continue;
      this.reflect(b, nx, ny);
      b.x = p.x + nx * (r + p.r + 0.01);
      b.y = p.y + ny * (r + p.r + 0.01);
      b.banked = true;
      this.addCombo(b, this.cfg.bumpers.bankCombo);
      this.events.push({ type: 'bank', x: b.x, y: b.y });
      return;
    }
  }

  /** The orcs a heave smashes through when it meets e: e's whole row in its block, nearest first. */
  private lineOf(e: Enemy): Enemy[] {
    const max = this.cfg.shield.lineMax;
    const row = e.block
      ? e.block.members.filter((o) => o.hp > 0 && Math.abs(o.slotY - e.slotY) < e.block!.spacing * 0.45)
      : this.enemies.filter((o) => o.hp > 0 && Math.abs(o.y - e.y) < 0.6 && Math.abs(o.x - e.x) < 10);
    if (!row.includes(e)) row.push(e);
    return row.sort((p, q) => Math.abs(p.x - e.x) - Math.abs(q.x - e.x)).slice(0, max);
  }

  /** Smashes the first orc the ball overlaps: damage, bowling-pin knockback around it, then a bounce. */
  private ballVsOrcs(b: Ball): void {
    const c = this.cfg.balls;
    const r = c.radius;
    let hit: Enemy | undefined;
    let still = false;
    this.within(b.x, b.y, r + MAX_RADIUS, (e) => {
      if (e.hp <= 0 || e.y > this.cfg.field.topY) return;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d > r + this.cfg[e.kind].radius) return;
      if (e === b.passing) {
        still = true;
        return;
      }
      hit = e;
      return true;
    });
    if (!still) b.passing = null;
    if (!hit) return;
    const e: Enemy = hit;
    const mult = this.ballGoldMult(b);
    const boost = (b.banked ? this.cfg.bumpers.bankDamage : 1) * (b.perfect ? this.cfg.shield.perfectDamage : 1);
    const empowered = b.perfect;
    b.banked = false;

    // A raised shield: front hits do nothing at all, not even to a heave or the Royal Ball.
    // They do no damage, so a Perfect Return survives the bounce.
    if (e.shielded) {
      const cd = Math.hypot(b.x - e.x, b.y - e.y) || 1;
      if ((b.y - e.y) / cd < -this.cfg.shieldOrc.shieldArc) {
        const nx = (b.x - e.x) / cd;
        const ny = (b.y - e.y) / cd;
        this.reflect(b, nx, ny);
        const min = r + this.cfg[e.kind].radius + 0.01;
        b.x = e.x + nx * min;
        b.y = e.y + ny * min;
        b.passing = e;
        this.events.push({ type: 'clang', x: b.x, y: b.y });
        return;
      }
    }

    // This is the damaging impact: the Perfect Return's 1.5x (in boost) is spent here.
    b.perfect = false;

    if (b.lines > 0 && e.kind !== 'warlord') {
      // Heave power shot: smash through the whole line without bouncing.
      b.lines--;
      const line = this.lineOf(e);
      const dmg = this.cfg.shield.heaveDamage * b.power * boost;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      let x0 = e.x;
      let x1 = e.x;
      for (const o of line) {
        o.hp -= dmg;
        o.goldMult = mult;
        o.lastBall = b.id;
        const kb = c.knockback / this.cfg[o.kind].mass;
        o.vx += (b.vx / sp) * kb * 0.5;
        o.vy += kb;
        x0 = Math.min(x0, o.x);
        x1 = Math.max(x1, o.x);
      }
      this.addCombo(b, line.length);
      b.passing = e;
      this.events.push({ type: 'line', x0, x1, y: e.y });
      if (empowered) this.startBowling(b, e);
      return;
    }

    const flask = this.time < this.effects.flask || this.hasBuilding('alchemist');
    const pinBlock = e.block?.shape === 'pins' ? e.block : null;
    // The Royal Ball flattens anything but a boss.
    e.hp -= b.kind === 'royal' && e.kind !== 'warlord' ? Math.max(e.hp, c.damage) : c.damage * b.power * boost;
    e.goldMult = mult;
    e.lastBall = b.id;
    this.addCombo(b, 1);
    // The orcs around it go flying like bowling pins.
    const sr = flask ? this.cfg.capsules.flaskRadius : c.splashRadius;
    const sd = flask ? c.damage * b.power : c.splashDamage * b.power;
    this.within(e.x, e.y, sr + MAX_RADIUS, (o) => {
      if (o.hp <= 0) return;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      const d = Math.hypot(dx, dy);
      if (o !== e && d > sr + this.cfg[o.kind].radius * 0.5) return;
      if (o !== e) {
        o.hp -= sd;
        o.goldMult = mult;
        o.lastBall = b.id;
      }
      const kb = c.knockback / this.cfg[o.kind].mass;
      const nx = o === e ? b.vx / (Math.hypot(b.vx, b.vy) || 1) : dx / (d || 1);
      const ny = o === e ? b.vy / (Math.hypot(b.vx, b.vy) || 1) : dy / (d || 1);
      o.vx += nx * kb;
      o.vy += ny * kb;
      if (o.state === 'wall' || o.state === 'climb' || o.state === 'fight') {
        o.state = 'march';
        o.foe = null;
      }
    });
    if (flask) this.events.push({ type: 'splash', x: e.x, y: e.y, radius: sr });
    this.events.push({ type: 'hit', x: e.x, y: e.y, combo: b.combo });
    if (pinBlock) this.topplePins(b, e, pinBlock, mult);
    if (empowered) this.startBowling(b, e);

    if (e.kind === 'warlord') {
      // The Warlord bats it back down at the wall with his club.
      const sp = Math.hypot(b.vx, b.vy);
      const a = this.rng.range(-0.6, 0.6);
      b.vx = Math.sin(a) * sp;
      b.vy = -Math.cos(a) * sp;
      b.behind = false;
      b.lines = 0;
      b.passing = e;
      return;
    }
    if (e.kind === 'ogre') {
      const slow = this.cfg.ogre.ballSlow;
      b.vx *= slow;
      b.vy *= slow;
      const sp = Math.hypot(b.vx, b.vy);
      const floor = b.kind === 'royal' ? c.royalSpeed : c.speed;
      if (sp < floor) {
        b.vx *= floor / sp;
        b.vy *= floor / sp;
      }
    }
    // Bounce off it like a brick: mirror the velocity about the line between centres.
    let nx = b.x - e.x;
    let ny = b.y - e.y;
    const d = Math.hypot(nx, ny) || 1;
    nx /= d;
    ny /= d;
    this.reflect(b, nx, ny);
    const min = r + this.cfg[e.kind].radius + 0.01;
    b.x = e.x + nx * min;
    b.y = e.y + ny * min;
    b.passing = e;
    this.events.push({ type: 'bounce', x: b.x, y: b.y });
  }

  // ---- orc bowling -------------------------------------------------------------

  /** Light and medium orcs can tumble; heavy ones, and shield orcs with their shield still up, stop a tumbler. */
  private bowlClass(e: Enemy): 'light' | 'medium' | 'heavy' | 'armoured' {
    const c = this.cfg.bowling;
    if (e.kind === 'shieldOrc' && e.shielded) return 'armoured';
    if (c.light.includes(e.kind)) return 'light';
    if (c.medium.includes(e.kind)) return 'medium';
    return 'heavy';
  }

  /** An empowered hit on e: it tumbles in the direction of the shot and a new chain begins. */
  private startBowling(b: Ball, e: Enemy): void {
    const cls = this.bowlClass(e);
    if (cls === 'heavy' || cls === 'armoured' || e.bowl) return;
    const chain: Chain = { id: this.nextChainId++, members: new Set(), pending: [], x: e.x, y: e.y };
    this.chains.push(chain);
    const sp = Math.hypot(b.vx, b.vy) || 1;
    this.tumble(chain, e, b.vx / sp, b.vy / sp, 1, 0);
  }

  /** Sets e tumbling along (dx, dy) tipped a little away from the castle, and adds it to the chain. */
  private tumble(chain: Chain, e: Enemy, dx: number, dy: number, strength: number, depth: number): void {
    const c = this.cfg.bowling;
    const ny = dy + c.awayBias;
    const len = Math.hypot(dx, ny) || 1;
    const share = this.bowlClass(e) === 'medium' ? c.mediumTravel : 1;
    const dist = c.travelWidths * this.cfg.grunt.radius * 2 * share * strength;
    e.bowl = { chain, dx: dx / len, dy: ny / len, speed: (2 * dist) / c.tumbleSeconds, t: c.tumbleSeconds, dur: c.tumbleSeconds, strength, depth, hits: 0 };
    e.vx = 0;
    e.vy = 0;
    if (e.state === 'wall' || e.state === 'climb' || e.state === 'fight') {
      e.state = 'march';
      e.foe = null;
    }
    chain.members.add(e);
    chain.x = e.x;
    chain.y = e.y;
    this.events.push({ type: 'bowl', chain: chain.id, count: chain.members.size, x: e.x, y: e.y });
  }

  /** The drum fell silent in a chain: the exposed shield orcs are knocked backwards one after another. */
  private toppleShieldTeam(drum: Enemy, block: Block): void {
    const w = drum.bowl!;
    const c = this.cfg.bowling;
    const exposed = block.members
      .filter((o) => o.kind === 'shieldOrc' && o.hp > 0 && !o.bowl && !w.chain.members.has(o))
      .sort((p, q) => Math.hypot(p.x - drum.x, p.y - drum.y) - Math.hypot(q.x - drum.x, q.y - drum.y));
    exposed.forEach((o, i) => {
      w.chain.pending.push({ e: o, at: this.time + (i + 1) * c.dominoDelay, strength: w.strength * c.dominoStrength, depth: w.depth + 1 });
    });
  }

  /** Tumblers run into things; chains with nothing left moving pay out. */
  private updateBowling(): void {
    if (this.chains.length === 0) return;
    const c = this.cfg.bowling;
    const live: Chain[] = [];
    for (const ch of this.chains) {
      ch.pending = ch.pending.filter((p) => {
        if (p.at > this.time) return true;
        if (p.e.hp > 0 && !p.e.bowl && !ch.members.has(p.e)) {
          p.e.hp -= c.damage * p.strength;
          this.tumble(ch, p.e, 0, 1, p.strength, p.depth);
        }
        return false;
      });
      for (const e of [...ch.members]) {
        const w = e.bowl;
        if (!w || w.hits >= c.hitsPerBody || w.t <= 0) continue;
        const reach = this.cfg[e.kind].radius;
        this.within(e.x, e.y, reach + MAX_RADIUS, (o) => {
          if (o === e || o.hp <= 0 || o.bowl || ch.members.has(o)) return;
          if (Math.hypot(o.x - e.x, o.y - e.y) > reach + this.cfg[o.kind].radius) return;
          const cls = this.bowlClass(o);
          if (cls === 'heavy' || cls === 'armoured') {
            // A satisfying thud: a heavy orc takes a little damage (a shield takes none), and the tumbler stops dead.
            if (cls === 'heavy') {
              o.hp -= c.heavyDamage * w.strength;
              o.goldMult = e.goldMult;
              o.lastBall = e.lastBall;
            }
            this.events.push({ type: 'bowlHit', x: o.x, y: o.y, armoured: true });
            w.speed = 0;
            w.t = Math.min(w.t, 0.1);
            w.hits = c.hitsPerBody;
            return true;
          }
          const strength = w.strength * c.transfer;
          if (w.depth + 1 > c.maxTransfers || strength < c.minStrength) {
            w.hits = c.hitsPerBody;
            return true;
          }
          o.hp -= c.damage * strength;
          o.goldMult = e.goldMult;
          o.lastBall = e.lastBall;
          const dx = o.x - e.x;
          const dy = o.y - e.y;
          const d = Math.hypot(dx, dy) || 1;
          // Carry on mostly the way the tumbler was heading, nudged towards the orc it hit.
          this.tumble(ch, o, w.dx + (dx / d) * 0.5, w.dy + (dy / d) * 0.5 - c.awayBias, strength, w.depth + 1);
          this.events.push({ type: 'bowlHit', x: o.x, y: o.y, armoured: false });
          w.hits++;
          if (w.hits >= c.hitsPerBody) {
            w.speed = 0;
            w.t = Math.min(w.t, 0.1);
            return true;
          }
        });
      }
      if (ch.pending.length === 0 && ![...ch.members].some((m) => m.bowl)) {
        const n = ch.members.size;
        const bonus = c.bonus[Math.min(n, c.bonus.length) - 1] ?? 0;
        if (bonus > 0) this.addGold(bonus);
        this.bowlBest = Math.max(this.bowlBest, n);
        this.events.push({ type: 'bowlEnd', chain: ch.id, count: n, bonus, x: ch.x, y: ch.y });
      } else {
        live.push(ch);
      }
    }
    this.chains = live;
  }

  /** Bowling pins: a hit orc topples its neighbours in a chain, each at most once. */
  private topplePins(b: Ball, first: Enemy, block: Block, mult: number): void {
    const w = this.cfg.waves;
    const reach = block.spacing * 1.8;
    const down = new Set<Enemy>([first]);
    let frontier = [first];
    for (let depth = 0; depth < w.pinChainDepth && frontier.length; depth++) {
      const next: Enemy[] = [];
      for (const from of frontier) {
        for (const o of block.members) {
          if (down.has(o) || o.hp <= 0) continue;
          const dx = o.x - from.x;
          const dy = o.y - from.y;
          const d = Math.hypot(dx, dy);
          if (d > reach) continue;
          down.add(o);
          next.push(o);
          o.hp -= w.pinChainDamage;
          o.goldMult = mult;
          o.lastBall = b.id;
          const kb = (this.cfg.balls.knockback * w.pinChainKnock) / this.cfg[o.kind].mass;
          o.vx += (dx / (d || 1)) * kb;
          o.vy += (dy / (d || 1)) * kb;
          this.events.push({ type: 'hit', x: o.x, y: o.y });
        }
      }
      frontier = next;
    }
    if (down.size > 1) this.addCombo(b, down.size - 1);
  }

  // ---- the siege tower ------------------------------------------------------

  /** Floors still standing. */
  towerFloors(): number {
    return this.tower ? this.tower.floors.length : 0;
  }

  private spawnTower(): void {
    const t = this.cfg.siegeTower;
    this.tower = {
      x: 0, y: this.cfg.field.topY - t.depth - 1, timer: t.throwInterval, ramp: false,
      floors: Array.from({ length: t.floors }, () => new Array(t.planks).fill(t.plankHits)),
    };
  }

  private updateTower(dt: number): void {
    const tw = this.tower;
    if (!tw) return;
    const t = this.cfg.siegeTower;
    if (tw.y > 1) tw.y = Math.max(1, tw.y - t.speed * dt);
    else tw.ramp = true;
    // With its ramp down, orcs pour onto that stretch of wall until it falls.
    if (tw.ramp) this.damageSegment(this.segmentAt(tw.x), t.rampDps * dt, tw.x, 'tower');
    // The catapult on top keeps feeding boulders until it's nearly gone.
    if (tw.floors.length >= 2) {
      tw.timer -= dt;
      if (tw.timer <= 0) {
        tw.timer = t.throwInterval;
        this.throwAtWall(tw.x + this.rng.range(-2, 2), tw.y + t.depth, 'boulder');
      }
    }
  }

  /** Knocks one plank off a floor (the nearest standing plank to x). */
  private hitPlank(floor: number, x: number, hits = 1): void {
    const tw = this.tower!;
    const t = this.cfg.siegeTower;
    const planks = tw.floors[floor];
    const width = (t.halfWidth * 2) / t.planks;
    let i = Math.max(0, Math.min(t.planks - 1, Math.floor((x - (tw.x - t.halfWidth)) / width)));
    if (planks[i] <= 0) {
      let best = -1;
      for (let j = 0; j < planks.length; j++) if (planks[j] > 0 && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) best = j;
      i = best;
    }
    if (i < 0) return;
    planks[i] = Math.max(0, planks[i] - hits);
    this.events.push({ type: 'plank', x: tw.x - t.halfWidth + (i + 0.5) * width, y: tw.y });
    if (floor === 0 && planks.every((p) => p <= 0)) this.collapseFloor();
  }

  /** The bottom floor gives way: the tower drops a level and its orcs tumble out as a new block. */
  private collapseFloor(): void {
    const tw = this.tower!;
    const t = this.cfg.siegeTower;
    tw.floors.shift();
    this.events.push({ type: 'floorDown', x: tw.x, y: tw.y, floorsLeft: tw.floors.length });
    const block: Block = {
      id: this.nextBlockId++, x: tw.x, y: Math.max(2, tw.y - 2), shape: 'rect', members: [], start: 0,
      spacing: 0.45 * 2 * this.cfg.march.spacing, speed: this.cfg.march.speed, homeX: tw.x, zig: false, phase: 0, dirty: false, regroupAt: 0, drummed: false,
    };
    const slots = formation('rect', t.floorOrcs, block.spacing);
    for (const s of slots) this.spawn('grunt', block, s.dx, s.dy);
    block.start = block.members.length;
    this.blocks.push(block);
    if (tw.floors.length > 0) return;
    // Down it comes.
    this.tower = null;
    this.addGold(t.gold);
    this.renown += this.cfg.renown.bossKill;
    this.events.push({ type: 'bossKilled', x: tw.x, y: tw.y });
    // On the final wave the warlord rode it down: now he walks.
    if (this.plan.totals.warlord > 0 && this.plan.tower) {
      const lord: Block = { ...block, id: this.nextBlockId++, members: [], speed: this.cfg.warlord.speed, y: tw.y + 1 };
      this.spawn('warlord', lord, 0, 0);
      lord.start = 1;
      this.blocks.push(lord);
    }
  }

  /** Balls chip the bottom floor from the front; a bank or a ball behind the lines reaches the floor above. */
  private ballVsTower(b: Ball): void {
    const tw = this.tower!;
    const t = this.cfg.siegeTower;
    const r = this.cfg.balls.radius;
    const cx = Math.max(tw.x - t.halfWidth, Math.min(tw.x + t.halfWidth, b.x));
    const cy = Math.max(tw.y, Math.min(tw.y + t.depth, b.y));
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= r) return;
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      // Centre inside the box: push out the nearest face.
      nx = 0;
      ny = b.vy > 0 ? -1 : 1;
    }
    if (b.vx * nx + b.vy * ny >= 0) return;
    const front = ny < -0.5;
    const floor = front || tw.floors.length < 2 ? 0 : 1;
    this.hitPlank(floor, b.x, b.heaved && b.lines > 0 ? 2 : 1);
    if (b.lines > 0) b.lines--;
    this.addCombo(b, 1);
    this.reflect(b, nx, ny);
    b.x = cx + nx * (r + 0.01);
    b.y = cy + ny * (r + 0.01);
  }

  // ---- barrels and staggers --------------------------------------------------

  private processBlasts(): void {
    if (this.blasts.length === 0) return;
    const c = this.cfg.barrel;
    const due = this.blasts.filter((x) => x.at <= this.time);
    this.blasts = this.blasts.filter((x) => x.at > this.time);
    for (const bl of due) {
      this.within(bl.x, bl.y, c.blastRadius + MAX_RADIUS, (o) => {
        if (o.hp <= 0) return;
        const dx = o.x - bl.x;
        const dy = o.y - bl.y;
        const d = Math.hypot(dx, dy);
        if (d > c.blastRadius + this.cfg[o.kind].radius * 0.5) return;
        o.hp -= c.blastDamage;
        o.goldMult = Math.max(o.goldMult, bl.mult * c.blastGold);
        o.lastBall = bl.ball;
        o.blasted = true;
        const kb = 10 / this.cfg[o.kind].mass;
        o.vx += (d > 1e-3 ? dx / d : 0) * kb;
        o.vy += (d > 1e-3 ? dy / d : 1) * kb;
      });
      const ball = this.balls.find((x) => x.id === bl.ball);
      if (ball) this.addCombo(ball, c.blastCombo);
      this.events.push({ type: 'blast', x: bl.x, y: bl.y, radius: c.blastRadius });
    }
  }

  /** A falling ogre topples into its row: everyone near it is staggered, hurt and knocked back. */
  private ogreFalls(e: Enemy): void {
    const o = this.cfg.ogre;
    for (const n of this.enemies) {
      if (n === e || n.hp <= 0 || Math.abs(n.y - e.y) > 1.5 || Math.abs(n.x - e.x) > o.staggerRadius) continue;
      n.stagger = o.staggerSeconds;
      n.hp -= o.staggerDamage;
      n.vy += o.staggerKnock * 6;
      n.goldMult = e.goldMult;
      n.lastBall = e.lastBall;
    }
    const ball = this.balls.find((x) => x.id === e.lastBall);
    if (ball) this.addCombo(ball, o.killCombo);
  }

  // ---- capsules ---------------------------------------------------------------

  private dropCapsule(x: number, y: number): void {
    const c = this.cfg.capsules;
    if (this.phase !== 'battle' || this.capsules.length >= c.maxFalling || y > this.cfg.field.topY) return;
    if (this.rng.next() >= c.chance) return;
    this.capsules.push({ kind: this.rng.weighted(c.weights), x, y });
  }

  private updateCapsules(dt: number): void {
    const c = this.cfg.capsules;
    const sy = this.cfg.shield.y;
    const keep: Capsule[] = [];
    for (const k of this.capsules) {
      const prevY = k.y;
      k.y -= c.fallSpeed * dt;
      if (prevY >= sy && k.y < sy && Math.abs(k.x - this.shield.x) <= this.shieldHalfWidth() + c.radius) {
        this.catchCapsule(k);
        continue;
      }
      if (k.y > 0) keep.push(k);
    }
    this.capsules = keep;
  }

  private catchCapsule(k: Capsule): void {
    const c = this.cfg.capsules;
    switch (k.kind) {
      case 'grog':
        // Every ball in flight splits into three.
        for (const b of this.balls.slice()) {
          if (b.stuck) continue;
          for (const turn of [-c.grogSpread, c.grogSpread]) {
            const cos = Math.cos(turn);
            const sin = Math.sin(turn);
            const n = this.addBall(b.kind === 'pebble' ? 'pebble' : b.kind === 'royal' ? 'royal' : 'claimed', b.x, b.y, b.vx * cos - b.vy * sin, b.vx * sin + b.vy * cos);
            n.power = b.power;
            n.behind = b.behind;
            this.steepen(n);
          }
        }
        break;
      case 'banner':
        this.effects.banner = this.time + c.bannerSeconds;
        break;
      case 'flask':
        this.effects.flask = this.time + c.flaskSeconds;
        break;
      case 'sticky':
        this.stickyCatches += c.stickyCatches;
        break;
      case 'trick':
        if (this.platingLeft > 0) this.platingLeft--;
        else this.effects.trick = this.time + c.trickSeconds;
        break;
    }
    this.events.push({ type: 'caught', x: k.x, y: k.y, kind: k.kind });
  }

  private removeDead(): void {
    const alive: Enemy[] = [];
    const growth = this.cfg.economy.killGoldGrowth ** Math.max(0, this.wave - 1) * this.cfg.bonuses.killGold;
    for (const e of this.enemies) {
      // A felled orc finishes its tumble first (so the chain it carries goes on), then pays out once.
      if (e.hp > 0 || e.bowl) {
        alive.push(e);
        continue;
      }
      if (e.block) e.block.dirty = true;
      // A barrel that reached the wall went off there: no gold, no second blast.
      if (e.kind === 'barrel' && e.state === 'wall') continue;
      this.addGold(this.cfg[e.kind].gold * growth * e.goldMult);
      this.kills++;
      this.events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
      this.dropCapsule(e.x, e.y);
      if (e.kind === 'barrel') {
        this.blasts.push({ x: e.x, y: e.y, at: this.time + (e.blasted ? this.cfg.barrel.chainDelay : 0), mult: e.goldMult, ball: e.lastBall });
      }
      if (e.kind === 'ogre') this.ogreFalls(e);
      if (e.kind === 'warlord') {
        this.renown += this.cfg.renown.bossKill;
        this.events.push({ type: 'bossKilled', x: e.x, y: e.y });
      }
    }
    this.enemies = alive;
  }
}
