import { type Config, makeConfig } from './config';
import {
  type Defender, type DefenderKind, type Levels, type PlacedKind, type Spot, type Track,
  castleSpots, emptyLevels, trackMult, upgradeCost,
} from './defenders';
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
}

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

export type ProjectileKind = 'rock' | 'boulder' | 'bolt' | 'arrow' | 'stone';

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
}

/** A tower turret jutting out in front of the shield: a round bumper for bank shots. */
export interface Bumper {
  x: number;
  y: number;
  r: number;
  /** A defender stands on this tower. */
  manned: boolean;
}

export const CAPSULE_KINDS = ['grog', 'banner', 'flask', 'sticky', 'tea', 'trick'] as const;
export type CapsuleKind = (typeof CAPSULE_KINDS)[number];

export interface Capsule {
  kind: CapsuleKind;
  x: number;
  y: number;
}

export const SHIELD_TRACKS = ['width', 'window', 'power', 'recovery', 'plating'] as const;
export type ShieldTrack = (typeof SHIELD_TRACKS)[number];

export type GameEvent =
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  | { type: 'slap'; x: number; y: number }
  /** A ball or boulder hit the shield. parry: a heave power hit. trick: an edge-zone trick shot. */
  | { type: 'deflect'; x: number; y: number; parry: boolean; trick: boolean }
  /** A heave smashed through an orc line from x0 to x1. */
  | { type: 'line'; x0: number; x1: number; y: number }
  | { type: 'bank'; x: number; y: number }
  | { type: 'shotDown'; x: number; y: number }
  | { type: 'salvo'; size: number }
  | { type: 'combo'; x: number; y: number; combo: number }
  | { type: 'blast'; x: number; y: number; radius: number }
  | { type: 'plank'; x: number; y: number }
  | { type: 'floorDown'; x: number; y: number; floorsLeft: number }
  | { type: 'heave'; x: number }
  | { type: 'boltFired'; x: number; y: number }
  | { type: 'volley'; x: number; y: number; arrows: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'splash'; x: number; y: number; radius: number }
  | { type: 'wallHit'; x: number; y: number; segment: number }
  | { type: 'ballLost'; x: number; kind: BallKind }
  | { type: 'caught'; x: number; y: number; kind: CapsuleKind }
  | { type: 'segmentDestroyed'; segment: number }
  | { type: 'soldierDown'; x: number; y: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveCleared'; wave: number; gold: number }
  | { type: 'calledEarly'; wave: number; gold: number }
  | { type: 'bossKilled'; x: number; y: number }
  | { type: 'council' }
  | { type: 'lost'; segment: number }
  | { type: 'won' };

export type Phase = 'council' | 'preview' | 'battle' | 'lost' | 'won';

export const STEP = 1 / 60;

const MAX_RADIUS = 1.6;

/** Crossbow target priority: catapults first (they make the boulders), then the other big ones. */
const CROSSBOW_PRIORITY: Partial<Record<EnemyKind, number>> = { orcCatapult: 3, warlord: 2, ogre: 2 };

export class Game {
  readonly cfg: Config;
  readonly seed: number;
  time = 0;
  phase: Phase = 'council';
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
  /** The castle's fixed defender spots, and which are open. */
  readonly spots: Spot[];
  openSpots: boolean[];
  private spotsBought = 0;
  private nextDefenderId = 0;
  private nextBallId = 0;
  private nextBlockId = 0;
  levels: Levels = emptyLevels();
  shieldLevels: Record<ShieldTrack, number> = { width: 0, window: 0, power: 0, recovery: 0, plating: 0 };
  segmentHp: number[];
  gold: number;
  goldEarned = 0;
  renown = 0;
  kills = 0;
  /** Power hits landed. */
  parries = 0;
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
  shield = { x: 0, targetX: 0, vx: 0, heaveAt: -99, readyAt: 0 };
  tower: SiegeTower | null = null;
  /** Barrel blasts waiting to go off (chain reactions run through this queue). */
  private blasts: { x: number; y: number; at: number; mult: number; ball: number }[] = [];
  vigor: number;
  /** Capsule effects: the game time each one runs out. */
  effects = { banner: 0, flask: 0, tea: 0, trick: 0 };
  stickyCatches = 0;
  /** Orc tricks the shield plating can still shrug off this wave. */
  platingLeft = 0;
  private salvoTimer = 0;
  /** When the Royal Ball is served again after being lost. */
  royalDue = 0;

  /** Renown bonus for each wave called early, by wave number. */
  private earlyBonus = new Map<number, number>();
  private rng: Rng;
  private grid = new Map<number, Enemy[]>();

  constructor(seed = 1, cfg: Config = makeConfig()) {
    this.cfg = cfg;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.segmentHp = new Array(cfg.wall.segments).fill(cfg.wall.segmentHp);
    this.vigor = cfg.slap.vigorMax;
    this.gold = cfg.economy.startGold;
    this.spots = castleSpots(cfg);
    this.openSpots = this.spots.map((s) => cfg.castle.startOpen.includes(s.id));
    this.plan = planWave(1, seed, cfg);
  }

  get over(): boolean {
    return this.phase === 'lost' || this.phase === 'won';
  }

  get wavesSurvived(): number {
    return this.cleared;
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
    if (!this.canHeave) return released;
    const s = this.shield;
    s.heaveAt = this.time;
    s.readyAt = this.time + this.heaveCooldown();
    this.events.push({ type: 'heave', x: s.x });
    // A click just after an impact still counts.
    for (const b of this.balls) {
      if (!b.stuck && !b.heaved && b.vy > 0 && this.time - b.hitShieldAt <= this.heaveWindow()) this.powerUp(b);
    }
    return true;
  }

  /** Right-click slap. Costs Vigor; returns false when there isn't enough. */
  slap(x: number, y: number): boolean {
    const { radius, damage, impulse, vigorCost } = this.cfg.slap;
    if (this.phase !== 'battle' && this.phase !== 'preview') return false;
    if (this.vigor < vigorCost) return false;
    this.vigor -= vigorCost;
    for (const e of this.enemies) {
      const dx = e.x - x;
      const dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + this.cfg[e.kind].radius * 0.5) continue;
      const nx = d > 1e-3 ? dx / d : 0;
      const ny = d > 1e-3 ? dy / d : 1;
      const mass = this.cfg[e.kind].mass;
      // Push outward, biased away from the castle.
      e.vx += (nx * impulse) / mass;
      e.vy += ((ny * 0.5 + 0.8) * impulse) / mass;
      e.hp -= damage;
      if (e.state !== 'stand' && e.state !== 'march') e.state = 'march';
      e.foe = null;
    }
    this.events.push({ type: 'slap', x, y });
    return true;
  }

  /** True when the next wave can be called now for a bonus. */
  canCallEarly(): boolean {
    if (this.phase === 'preview') return true;
    if (this.phase !== 'battle' || this.nextGroup < this.plan.groups.length || this.tower) return false;
    if (this.councilAfter(this.wave) || this.wave >= this.cfg.waves.finalWave) return false;
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

  // ---- War Council ----------------------------------------------------------

  get shopOpen(): boolean {
    return this.phase === 'council';
  }

  /** Whether the War Council sells this defender yet (run 1 has the crossbow only). */
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

  /** The open, empty spot nearest (x, y) within snapping distance, or undefined. */
  spotAt(x: number, y: number, ignoreId = -1): Spot | undefined {
    let best: Spot | undefined;
    let bestD = this.cfg.castle.snap;
    // The nearest open spot; if someone already stands there, nothing (no jumping to a neighbour).
    for (const s of this.spots) {
      if (!this.openSpots[s.id]) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (best && this.defenders.some((d) => d.spot === best!.id && d.id !== ignoreId)) return undefined;
    return best;
  }

  /** True if a defender could go at (x, y): an open, empty spot is close enough to snap to. */
  canPlace(_kind: PlacedKind, x: number, y: number, ignoreId = -1): boolean {
    return !!this.spotAt(x, y, ignoreId);
  }

  /** Buys a defender and puts it on the open spot nearest (x, y). */
  place(kind: PlacedKind, x: number, y: number): boolean {
    const cost = this.defenderCost(kind);
    if (!this.shopOpen || !this.unlocked(kind) || this.gold < cost) return false;
    const spot = this.spotAt(x, y);
    if (!spot) return false;
    this.gold -= cost;
    this.addDefender(kind, spot);
    if (kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  /** Gold a move costs right now: free in the War Council and the preview, paid mid-battle. */
  moveCost(): number {
    return this.phase === 'battle' ? Math.round((this.cfg.castle.moveGold * this.wave) / 5) : 0;
  }

  /**
   * Moves a placed defender to the open spot nearest (x, y). Free in the War Council and
   * the preview; mid-battle it costs gold and it has to pack up before it fires again.
   */
  move(id: number, x: number, y: number): boolean {
    const d = this.defenders.find((o) => o.id === id);
    if (!d || this.over) return false;
    const spot = this.spotAt(x, y, id);
    const cost = this.moveCost();
    if (!spot || this.gold < cost) return false;
    if (spot.id === d.spot) return true;
    this.gold -= cost;
    d.spot = spot.id;
    d.x = spot.x;
    d.y = spot.y;
    d.aimX = spot.x;
    d.aimY = 30;
    if (this.phase === 'battle') d.timer = Math.max(d.timer, this.cfg.castle.packSeconds);
    if (d.kind === 'soldiers') this.musterSoldiers();
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

  /** Price of opening one more spot in the War Council. */
  spotCost(): number {
    const c = this.cfg.castle;
    return Math.round(c.openCost * c.openGrowth ** this.spotsBought);
  }

  /** Opens a closed spot for gold (War Council only). */
  openSpot(id: number): boolean {
    const cost = this.spotCost();
    if (!this.shopOpen || this.openSpots[id] !== false || this.gold < cost) return false;
    this.gold -= cost;
    this.openSpots[id] = true;
    this.spotsBought++;
    return true;
  }

  owns(kind: DefenderKind): boolean {
    return this.count(kind) > 0;
  }

  /** Range multiplier from where a defender stands. */
  rangeMult(d: Defender): number {
    const kind = this.spots[d.spot]?.kind;
    return kind === 'tower' ? this.cfg.castle.towerRange : kind === 'courtyard' ? this.cfg.castle.courtyardRange : 1;
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
    switch (d.kind) {
      case 'crossbow':
        if (dy <= 0) return false;
        return Math.abs(dx) <= c.crossbowLane || (this.spots[d.spot]?.kind === 'tower' && Math.abs(Math.atan2(dx, dy)) <= c.crossbowTowerAngle);
      case 'archers':
        return dy > 0 && Math.abs(Math.atan2(dx, dy)) <= c.archerCone && y <= this.cfg.field.topY * c.archerReach * this.rangeMult(d);
      case 'catapult': {
        const dist = Math.hypot(dx, dy);
        return dy > 0 && dist >= c.catapultMin && dist <= c.catapultMax * this.rangeMult(d);
      }
      case 'soldiers': {
        const [lo, hi] = this.soldierRange(d);
        return x >= lo && x <= hi && y <= this.cfg.soldiers.y + this.cfg.soldiers.guard;
      }
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

  /** Price of the next level of a shield upgrade, or Infinity at the cap. */
  shieldCost(track: ShieldTrack): number {
    const u = this.cfg.shieldUpgrades;
    const level = this.shieldLevels[track];
    if (level >= u[track].max) return Infinity;
    return Math.round(u[track].cost * u.costGrowth ** level);
  }

  /** Buys a shield upgrade for the rest of this run. */
  upgradeShield(track: ShieldTrack): boolean {
    const cost = this.shieldCost(track);
    if (!this.shopOpen || this.gold < cost) return false;
    this.gold -= cost;
    this.shieldLevels[track]++;
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

  /** Leaves the War Council; the next wave's preview starts. */
  closeCouncil(): void {
    if (this.phase !== 'council') return;
    this.musterSoldiers();
    this.phase = 'preview';
    this.phaseTimer = this.cfg.waves.previewSeconds;
  }

  // ---- defender stats -------------------------------------------------------

  mult(kind: DefenderKind, track: Track): number {
    return trackMult(this.levels[kind][track], this.cfg);
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

  councilAfter(wave: number): boolean {
    return wave > 0 && wave % this.cfg.economy.councilEvery === 0 && wave < this.cfg.waves.finalWave;
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
    if (this.over || this.phase === 'council') return;
    this.time += dt;
    this.vigor = Math.min(this.cfg.slap.vigorMax, this.vigor + this.cfg.slap.vigorRegen * dt);
    this.updateShield(dt);
    // Queen's tea slows everything but the shield.
    const edt = this.time < this.effects.tea ? dt * this.cfg.capsules.teaSpeed : dt;

    if (this.phase === 'preview') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.startWave();
    } else {
      this.phaseTimer += edt;
      this.spawnDue();
    }

    this.rebuildGrid();
    this.updateBlocks(edt);
    this.updateEnemies(edt);
    this.updateSoldiers(edt);
    this.updateDefenders(edt);
    this.updateProjectiles(edt);
    this.updateTower(edt);
    this.updateSalvo(edt);
    this.updateBalls(edt);
    this.updateCapsules(edt);
    this.removeDead();
    this.processBlasts();

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
      if (this.wave >= this.cfg.waves.finalWave) {
        this.renown += this.cfg.renown.actClear;
        this.phase = 'won';
        this.events.push({ type: 'won' });
        return;
      }
      this.plan = planWave(this.wave + 1, this.seed, this.cfg);
      if (this.councilAfter(this.wave)) {
        this.phase = 'council';
        this.events.push({ type: 'council' });
      } else {
        this.phase = 'preview';
        this.phaseTimer = this.cfg.waves.previewSeconds;
      }
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

  private addDefender(kind: PlacedKind, spot: Spot): void {
    this.defenders.push({ id: this.nextDefenderId++, kind, spot: spot.id, x: spot.x, y: spot.y, timer: 0, aimX: spot.x, aimY: 30, firedAt: -99 });
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
      const foot = g.members.filter((m) => m.kind !== 'orcCatapult');
      const footCount = foot.reduce((s, m) => s + m.count, 0);
      const radius = Math.max(...g.members.map((m) => (m.kind === 'orcCatapult' ? 0 : this.cfg[m.kind].radius)));
      const spacing = Math.max(radius, 0.45) * 2 * this.cfg.march.spacing;
      const speed = lead === 'rider' || lead === 'ogre' || lead === 'warlord' ? this.cfg[lead].speed : this.cfg.march.speed;
      const block: Block = {
        id: this.nextBlockId++, x: g.x, y: this.cfg.field.spawnY, shape: g.shape, members: [], start: 0,
        spacing, speed, homeX: g.x, zig: lead === 'rider', phase: this.rng.next() * Math.PI * 2, dirty: false, regroupAt: 0,
      };
      // Chuckers are mixed through the block rather than all in one corner.
      const kinds: EnemyKind[] = [];
      for (const m of foot) for (let i = 0; i < m.count; i++) kinds.push(m.kind);
      this.rng.shuffle(kinds);
      const slots = formation(g.shape, footCount, spacing);
      kinds.forEach((kind, i) => this.spawn(kind, block, slots[i].dx, slots[i].dy));
      // Catapults trundle along behind.
      const back = (slots.length ? Math.max(...slots.map((s) => s.dy)) : 0) + 2.5;
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
      lastBall: -1, stagger: 0, blasted: false,
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
    const foot = b.members.filter((e) => e.kind !== 'orcCatapult');
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
      b.y -= b.speed * (1 + m.growthPerWave) ** Math.max(0, this.wave - 1) * boost * rally * dt;
      if (b.zig) b.x = b.homeX + Math.sin(this.time * this.cfg.rider.zigRate + b.phase) * (this.cfg.rider.zigSpeed / this.cfg.rider.zigRate);
      this.keepInField(b);
    }
    this.blocks = keep;
  }

  // ---- enemies ------------------------------------------------------------

  private updateShield(dt: number): void {
    const s = this.shield;
    const limit = this.cfg.field.halfWidth - this.shieldHalfWidth();
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
        }
      });

      let mx = 0;
      let my = 0;
      const front = stats.radius;

      if (e.burnTime > 0) {
        e.burnTime -= dt;
        e.hp -= e.burn * dt;
      }

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
            mx = (b.x + e.slotX - e.x) * pull;
            my = (b.y + e.slotY - e.y) * pull;
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
          } else if (e.y <= front) {
            e.state = stats.climbSeconds > 0 ? 'climb' : 'wall';
            e.timer = stats.climbSeconds;
            this.leaveBlock(e);
          }
          // Chuckers throw pebbles as their block marches.
          if (e.kind === 'chucker' && e.y < this.cfg.chucker.throwFromY && e.state === 'march') {
            e.timer -= dt;
            if (e.timer <= 0) {
              e.timer = this.cfg.chucker.throwInterval;
              this.throwAtWall(e.x, e.y, 'rock');
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
          break;
        case 'wall':
          e.y = Math.min(e.y, front);
          this.damageSegment(this.segmentAt(e.x), stats.wallDps * dt, e.x, e.kind);
          break;
      }

      e.x += (mx + e.vx) * dt + px * separation * dt;
      e.y += (my + e.vy) * dt + py * separation * dt;
      const decay = Math.exp(-friction * dt);
      e.vx *= decay;
      e.vy *= decay;
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
    const dps = c.dps * this.mult('soldiers', 'damage') * this.mult('soldiers', 'rate');
    const heavies = this.enemies.filter((e) => e.kind === 'ogre' || e.kind === 'warlord');
    // Only orcs near the wall matter; bucket them into 1-wide columns so each soldier checks its own stretch.
    const hw = this.cfg.field.halfWidth;
    const reachY = c.y + 1.2 + c.guard;
    const columns: Enemy[][] = Array.from({ length: hw * 2 + 1 }, () => []);
    for (const e of this.enemies) if (e.y < reachY) columns[Math.max(0, Math.min(hw * 2, Math.floor(e.x + hw)))].push(e);
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
      const gx = target ? target.x : s.postX;
      const gy = target ? target.y : s.postY;
      const dx = gx - s.x;
      const dy = gy - s.y;
      const dist = Math.hypot(dx, dy);
      const stopAt = target ? c.reach * 0.8 + this.cfg[target.kind].radius : 0.05;
      if (dist > stopAt) {
        const stepLen = Math.min(dist - stopAt, c.speed * dt);
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
    if (this.rng.next() < 0.03) this.events.push({ type: 'wallHit', x, y: 0, segment: seg });
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
  private throwAtWall(x: number, y: number, kind: 'rock' | 'boulder', tx?: number, flight?: number): void {
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
    }
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
    if (!target) return;
    def.timer = cb.interval / this.mult('crossbow', 'rate');
    def.firedAt = this.time;
    const dx = target.x - def.x;
    const dy = target.y - def.y;
    const d = Math.hypot(dx, dy) || 1;
    def.aimX = target.x;
    def.aimY = target.y;
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
  private densestCrowd(def: Defender): { x: number; y: number; speed: number } | undefined {
    const size = 4;
    type Bucket = { weight: number; n: number; x: number; y: number; speed: number };
    const buckets = new Map<number, Bucket>();
    let best: Bucket | undefined;
    for (const e of this.enemies) {
      if (e.y < 2 || !this.covers(def, e.x, e.y)) continue;
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
  private lob(def: Defender, kind: 'stone' | 'arrow', tx: number, ty: number, flightTime: number, damage: number, extra: Partial<Projectile>): void {
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
    def.aimX = crowd.x;
    def.aimY = crowd.y;
    // Launched from clear of the shield and the turrets.
    const y = this.cfg.bumpers.y + 2;
    const angle = Math.max(-c.spread, Math.min(c.spread, Math.atan2(crowd.x - def.x, crowd.y - y)));
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
    target.hp -= p.damage;
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
        const r = this.cfg[p.kind as 'rock' | 'boulder'].radius;
        if (prevY > sy + r && p.y <= sy + r && Math.abs(p.x - this.shield.x) <= this.shieldHalfWidth() + r) {
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
          this.events.push({ type: 'wallHit', x: p.x, y: 0, segment: seg });
          alive = false;
        }
      } else if (p.kind === 'arrow') {
        if (p.travelled >= p.flight) {
          this.landArrow(p);
          alive = false;
        }
      } else {
        const r = 0.6;
        this.within(p.x, p.y, r + MAX_RADIUS, (e) => {
          if (e.hp <= 0 || p.hit.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > r + this.cfg[e.kind].radius * 0.6) return;
          p.hit.add(e);
          e.hp -= p.damage;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const kb = this.cfg.crossbow.knockback / this.cfg[e.kind].mass;
          e.vx += (p.vx / sp) * kb;
          e.vy += (p.vy / sp) * kb;
          if (e.state === 'wall' || e.state === 'climb') e.state = 'march';
          this.events.push({ type: 'hit', x: e.x, y: e.y });
          p.damage *= 1 - this.cfg.crossbow.pierceFalloff;
          p.hitsLeft--;
          return p.hitsLeft <= 0;
        });
        if (p.hitsLeft <= 0) alive = false;
        if (p.travelled > p.flight || Math.abs(p.x) > hw + 5 || p.y > this.cfg.field.spawnY + 10) alive = false;
      }
      if (alive) keep.push(p);
    }
    this.projectiles = keep;
  }

  // ---- balls ----------------------------------------------------------------

  private addBall(kind: BallKind, x: number, y: number, vx: number, vy: number, primary = false): Ball {
    const b: Ball = {
      id: this.nextBallId++, kind, x, y, vx, vy, primary, power: 1, combo: 0, behind: false, heaved: false,
      stuck: false, stuckOffset: 0, stuckAt: 0, hitShieldAt: -99, born: this.time, passing: null, lines: 0, milestone: 0, banked: false,
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
      const offset = Math.abs(b.stuckOffset) < 0.1 ? this.rng.range(-0.35, 0.35) : b.stuckOffset / this.shieldHalfWidth();
      this.launch(b, offset, this.cfg.balls.speed);
    }
    return any;
  }

  /**
   * Angle control: where the ball meets the shield (-1 left edge to +1 right edge)
   * sets its angle off straight up. The outer edge zone is a near-flat trick shot.
   */
  bounceAngle(offset: number): number {
    const c = this.cfg.shield;
    const o = Math.max(-1, Math.min(1, offset));
    const a = Math.abs(o);
    let angle: number;
    if (a <= c.centreZone) angle = (a / c.centreZone) * c.centreAngle;
    else if (a <= c.midEnd) angle = c.centreAngle + ((a - c.centreZone) / (c.midEnd - c.centreZone)) * (c.midAngle - c.centreAngle);
    else if (a <= c.edgeZone) angle = c.midAngle + ((a - c.midEnd) / (c.edgeZone - c.midEnd)) * (c.trickMin - c.midAngle);
    else angle = c.trickMin + ((a - c.edgeZone) / (1 - c.edgeZone)) * (c.trickMax - c.trickMin);
    return Math.sign(o) * angle;
  }

  /** Sends a ball up off the shield at the angle its hit point gives, plus any English from the shield's motion. */
  private launch(b: Ball, offset: number, speed: number, english = 0): void {
    const max = this.cfg.shield.trickMax;
    const angle = Math.max(-max, Math.min(max, this.bounceAngle(offset) + english));
    b.vx = Math.sin(angle) * speed;
    b.vy = Math.cos(angle) * speed;
    b.y = this.cfg.shield.y + this.cfg.balls.radius + 0.01;
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
    const speed = Math.min(c.maxSpeed, Math.max(c.speed, Math.hypot(b.vx, b.vy) * c.speedUp));
    this.launch(b, offset, speed, (s.vx / this.cfg.shield.speed) * this.cfg.shield.english);
    const trick = Math.abs(offset) > this.cfg.shield.edgeZone;
    b.combo = trick ? c.trickCombo : 0;
    b.milestone = 0;
    b.behind = false;
    b.lines = 0;
    b.banked = false;
    b.heaved = false;
    b.hitShieldAt = this.time;
    b.passing = null;
    const heaved = this.time - s.heaveAt <= this.heaveWindow();
    if (heaved) this.powerUp(b);
    if (this.stickyCatches > 0 && !heaved) {
      this.stickyCatches--;
      b.stuck = true;
      b.stuckOffset = b.x - s.x;
      b.stuckAt = this.time;
    }
    this.events.push({ type: 'deflect', x: b.x, y: this.cfg.shield.y, parry: heaved, trick });
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

    if (this.phase === 'battle' && !this.balls.some((b) => b.primary) && this.time >= this.royalDue) this.serveRoyal();

    for (const b of this.balls) {
      if (b.stuck) {
        b.x = this.shield.x + b.stuckOffset;
        b.y = sy;
        if (this.time - b.stuckAt >= c.autoServeSeconds) {
          b.stuck = false;
          const offset = Math.abs(b.stuckOffset) < 0.1 ? this.rng.range(-0.35, 0.35) : b.stuckOffset / this.shieldHalfWidth();
          this.launch(b, offset, c.speed);
        }
        keep.push(b);
        continue;
      }
      // Substeps, so a fast ball can't tunnel through an orc.
      const sp = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil((sp * dt) / 0.3));
      const h = dt / steps;
      let alive = true;
      for (let k = 0; k < steps && alive && !b.stuck; k++) {
        const prevY = b.y;
        b.x += b.vx * h;
        b.y += b.vy * h;
        // The tree lines and the top edge are solid.
        if (b.x < -hw + r) {
          b.x = -hw + r;
          b.vx = Math.abs(b.vx);
          this.steepen(b);
        } else if (b.x > hw - r) {
          b.x = hw - r;
          b.vx = -Math.abs(b.vx);
          this.steepen(b);
        }
        if (b.y > top - r) {
          b.y = top - r;
          b.vy = -Math.abs(b.vy);
          b.behind = true;
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
        if (b.y < this.cfg.bumpers.y + 2) this.ballVsBumpers(b, bumpers);
        if (this.tower) this.ballVsTower(b);
        this.ballVsOrcs(b);
      }
      if (alive) keep.push(b);
    }
    this.balls = keep;
  }

  private loseBall(b: Ball): void {
    const damage = this.cfg.balls.missDamage * (b.kind === 'pebble' ? this.cfg.balls.pebbleShare : 1);
    const seg = this.segmentAt(b.x);
    this.damageSegment(seg, damage, b.x, `missed ${b.kind}`);
    this.ballsLost++;
    this.events.push({ type: 'ballLost', x: b.x, kind: b.kind });
    this.events.push({ type: 'wallHit', x: b.x, y: 0, segment: seg });
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
    const boost = b.banked ? this.cfg.bumpers.bankDamage : 1;
    b.banked = false;

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
      return;
    }

    const flask = this.time < this.effects.flask;
    e.hp -= c.damage * b.power * boost;
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
    this.events.push({ type: 'hit', x: e.x, y: e.y });

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
      if (sp < c.speed * 0.6) {
        b.vx *= (c.speed * 0.6) / sp;
        b.vy *= (c.speed * 0.6) / sp;
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
      spacing: 0.45 * 2 * this.cfg.march.spacing, speed: this.cfg.march.speed, homeX: tw.x, zig: false, phase: 0, dirty: false, regroupAt: 0,
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
      case 'tea':
        this.effects.tea = this.time + c.teaSeconds;
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
    const growth = this.cfg.economy.killGoldGrowth ** Math.max(0, this.wave - 1);
    for (const e of this.enemies) {
      if (e.hp > 0) {
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
