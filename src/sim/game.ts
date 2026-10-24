import { type Config, makeConfig } from './config';
import {
  type DefenderKind, type Levels, type Slot, type Track,
  SLOT_ACCEPTS, emptyLevels, makeSlots, trackMult, upgradeCost,
} from './defenders';
import { Rng } from './rng';
import { type EnemyKind, type WavePlan, planSize, planWave } from './waves';

/**
 * The whole run simulation. It has no rendering or DOM code, so it runs
 * the same in the browser and headless (tests and balance sims).
 * Advance it with step(); the renderer only reads its state.
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
  /** Throwers: the y they stop at to throw. */
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
}

export interface Soldier {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
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
  parried: boolean;
  /** Arrows home in on this enemy. */
  target?: Enemy;
  /** Fire-arrow burn applied on hit. */
  burn?: number;
  /** Catapult stones: splash radius where they land. */
  splash?: number;
}

export type GameEvent =
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  | { type: 'slap'; x: number; y: number }
  | { type: 'deflect'; x: number; y: number; parry: boolean }
  | { type: 'boltFired'; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'splash'; x: number; y: number; radius: number }
  | { type: 'wallHit'; x: number; y: number; segment: number }
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

/** Enemies that stop up the field and throw things at the wall. */
const THROWERS: Partial<Record<EnemyKind, 'rock' | 'boulder'>> = { chucker: 'rock', orcCatapult: 'boulder' };
const MAX_RADIUS = 1.6;

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
  projectiles: Projectile[] = [];
  soldiers: Soldier[] = [];
  slots: Slot[];
  levels: Levels = emptyLevels();
  segmentHp: number[];
  gold: number;
  goldEarned = 0;
  renown = 0;
  kills = 0;
  parries = 0;
  earlyCalls = 0;
  events: GameEvent[] = [];

  shield = { x: 0, wantRaised: false, raised: false, raisedAt: -1, energy: 0, locked: false };
  vigor: number;

  /** Renown bonus for each wave called early, by wave number. */
  private earlyBonus = new Map<number, number>();
  private rng: Rng;
  private grid = new Map<number, Enemy[]>();

  constructor(seed = 1, cfg: Config = makeConfig()) {
    this.cfg = cfg;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.segmentHp = new Array(cfg.wall.segments).fill(cfg.wall.segmentHp);
    this.shield.energy = cfg.shield.maxEnergy;
    this.vigor = cfg.slap.vigorMax;
    this.gold = cfg.economy.startGold;
    this.slots = makeSlots(cfg);
    this.plan = planWave(1, seed, cfg);
  }

  get over(): boolean {
    return this.phase === 'lost' || this.phase === 'won';
  }

  get wavesSurvived(): number {
    return this.cleared;
  }

  // ---- player input -------------------------------------------------------

  /** Moves the shield along the battlements; raised while the player holds it up. */
  setShield(x: number, raised: boolean): void {
    const limit = this.cfg.field.halfWidth - this.cfg.shield.halfWidth;
    this.shield.x = Math.max(-limit, Math.min(limit, x));
    this.shield.wantRaised = raised;
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
    if (this.phase !== 'battle' || this.nextGroup < this.plan.groups.length) return false;
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

  defenderCost(kind: DefenderKind): number {
    return this.cfg[kind].cost;
  }

  /** Buys a defender into an empty slot. */
  buy(slotId: number, kind: DefenderKind): boolean {
    const slot = this.slots[slotId];
    const cost = this.defenderCost(kind);
    if (!this.shopOpen || !slot || slot.defender || !SLOT_ACCEPTS[slot.kind].includes(kind) || this.gold < cost) return false;
    this.gold -= cost;
    slot.defender = kind;
    slot.timer = 0;
    if (kind === 'soldiers') this.musterSoldiers();
    return true;
  }

  owns(kind: DefenderKind): boolean {
    return this.slots.some((s) => s.defender === kind);
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

  /** Leaves the War Council; the next wave's preview starts. */
  closeCouncil(): void {
    if (this.phase !== 'council') return;
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

  catapultSplash(): number {
    return this.cfg.catapult.splash * this.mult('catapult', 'special');
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

  // ---- simulation ---------------------------------------------------------

  step(dt = STEP): void {
    if (this.over || this.phase === 'council') return;
    this.time += dt;
    this.vigor = Math.min(this.cfg.slap.vigorMax, this.vigor + this.cfg.slap.vigorRegen * dt);
    this.updateShield(dt);

    if (this.phase === 'preview') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.startWave();
    } else {
      this.phaseTimer += dt;
      this.spawnDue();
    }

    this.rebuildGrid();
    this.updateEnemies(dt);
    this.updateSoldiers(dt);
    this.updateDefenders(dt);
    this.updateProjectiles(dt);
    this.removeDead();

    const broken = this.segmentHp.findIndex((hp) => hp <= 0);
    if (broken >= 0) {
      this.phase = 'lost';
      this.events.push({ type: 'lost', segment: broken });
      return;
    }
    if (this.phase === 'battle' && this.nextGroup >= this.plan.groups.length && this.enemies.length === 0) {
      this.clearWave(this.wave);
      this.projectiles = this.projectiles.filter((p) => p.friendly);
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

  private startWave(): void {
    this.wave = this.plan.number;
    this.phase = 'battle';
    this.phaseTimer = 0;
    this.nextGroup = 0;
    this.musterSoldiers();
    this.events.push({ type: 'waveStart', wave: this.wave });
  }

  /** Fills the soldier line back up at full health (dead soldiers return each wave). */
  private musterSoldiers(): void {
    const line = this.slots.find((s) => s.kind === 'line');
    if (!line || line.defender !== 'soldiers') {
      this.soldiers = [];
      return;
    }
    const c = this.cfg.soldiers;
    const hp = this.soldierHp();
    this.soldiers = Array.from({ length: c.count }, (_, i) => ({
      x: line.x + (i - (c.count - 1) / 2) * c.spacing,
      y: line.y,
      hp,
      maxHp: hp,
    }));
  }

  private spawnDue(): void {
    const groups = this.plan.groups;
    while (this.nextGroup < groups.length && groups[this.nextGroup].time <= this.phaseTimer) {
      const g = groups[this.nextGroup++];
      const perRow = 4;
      const spacing = this.cfg[g.kind].radius * 2.2;
      for (let i = 0; i < g.count; i++) {
        const row = Math.floor(i / perRow);
        const col = (i % perRow) - (Math.min(g.count, perRow) - 1) / 2;
        this.spawn(g.kind, g.x + col * spacing, this.cfg.field.spawnY + row * spacing);
      }
    }
  }

  private spawn(kind: EnemyKind, x: number, y: number): void {
    const stats = this.cfg[kind];
    const hp = kind === 'warlord' ? stats.hp : stats.hp * this.cfg.waves.hpGrowth ** (this.wave - 1);
    const thrower = kind === 'orcCatapult' ? this.cfg.orcCatapult : this.cfg.chucker;
    this.enemies.push({
      kind, x, y, vx: 0, vy: 0, hp, maxHp: hp, state: 'march',
      standY: this.rng.range(thrower.standMinY, thrower.standMaxY),
      timer: this.rng.range(0, thrower.throwInterval),
      phase: this.rng.next(),
      burn: 0, burnTime: 0, rally: 1, foe: null,
    });
  }

  private updateShield(dt: number): void {
    const s = this.shield;
    const c = this.cfg.shield;
    const was = s.raised;
    s.raised = s.wantRaised && !s.locked && s.energy > 0;
    if (s.raised && !was) s.raisedAt = this.time;
    if (s.raised) {
      s.energy = Math.max(0, s.energy - c.drainPerSec * dt);
      if (s.energy === 0) s.locked = true;
    } else {
      s.energy = Math.min(c.maxEnergy, s.energy + c.regenPerSec * dt);
      if (s.locked && s.energy >= c.recoverAt) s.locked = false;
    }
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

  private updateEnemies(dt: number): void {
    const { friction, separation } = this.cfg.physics;
    const hw = this.cfg.field.halfWidth;

    // Warlords rally the orcs around them.
    const lords = this.enemies.filter((e) => e.kind === 'warlord');
    const aura = this.cfg.warlord;
    for (const e of this.enemies) {
      e.rally = 1;
      for (const l of lords) if (l !== e && Math.hypot(e.x - l.x, e.y - l.y) < aura.auraRadius) e.rally = aura.auraSpeed;
    }

    for (const e of this.enemies) {
      const stats = this.cfg[e.kind];
      // Push neighbours apart so battalions read as crowds, not one stacked sprite.
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

      let mx = Math.sin(this.time * 0.7 + e.phase * 6.28) * 0.15;
      if (e.kind === 'rider') mx = Math.sin(this.time * this.cfg.rider.zigRate + e.phase * 6.28) * this.cfg.rider.zigSpeed;
      let my = 0;
      const front = stats.radius;

      if (e.burnTime > 0) {
        e.burnTime -= dt;
        e.hp -= e.burn * dt;
      }

      switch (e.state) {
        case 'march': {
          my = -stats.speed * e.rally;
          const foe = this.soldiers.find((s) => s.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < stats.radius + 0.6);
          if (foe) {
            e.state = 'fight';
            e.foe = foe;
          } else if (THROWERS[e.kind] && e.y <= e.standY) {
            e.state = 'stand';
          } else if (e.y <= front) {
            e.state = stats.climbSeconds > 0 ? 'climb' : 'wall';
            e.timer = stats.climbSeconds;
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
          mx = 0;
          e.timer -= dt;
          if (e.timer <= 0) {
            const kind = THROWERS[e.kind]!;
            e.timer = kind === 'boulder' ? this.cfg.orcCatapult.throwInterval : this.cfg.chucker.throwInterval;
            this.throwAtWall(e, kind);
          }
          break;
        case 'climb':
          e.y = Math.min(e.y, front);
          e.timer -= dt;
          if (e.timer <= 0) e.state = 'wall';
          break;
        case 'wall':
          mx *= 0.2;
          e.y = Math.min(e.y, front);
          this.damageSegment(this.segmentAt(e.x), stats.wallDps * dt, e.x);
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

  private updateSoldiers(dt: number): void {
    if (this.soldiers.length === 0) return;
    const c = this.cfg.soldiers;
    const dps = c.dps * this.mult('soldiers', 'damage') * this.mult('soldiers', 'rate');
    for (const s of this.soldiers) {
      if (s.hp <= 0) continue;
      let target: Enemy | undefined;
      let best = Infinity;
      this.within(s.x, s.y, c.reach + MAX_RADIUS, (e) => {
        const d = Math.hypot(e.x - s.x, e.y - s.y) - this.cfg[e.kind].radius;
        if (e.hp > 0 && d < c.reach && d < best) {
          best = d;
          target = e;
        }
      });
      if (target) target.hp -= dps * dt;
    }
  }

  private damageSegment(seg: number, amount: number, x: number): void {
    if (this.segmentHp[seg] <= 0) return;
    this.segmentHp[seg] = Math.max(0, this.segmentHp[seg] - amount);
    if (this.rng.next() < 0.03) this.events.push({ type: 'wallHit', x, y: 0, segment: seg });
    if (this.segmentHp[seg] === 0) this.events.push({ type: 'segmentDestroyed', segment: seg });
  }

  private throwAtWall(e: Enemy, kind: 'rock' | 'boulder'): void {
    const hw = this.cfg.field.halfWidth;
    const spread = kind === 'boulder' ? 5 : 8;
    const tx = Math.max(-hw + 1, Math.min(hw - 1, e.x + this.rng.range(-spread, spread)));
    const dx = tx - e.x;
    const dy = 0 - e.y;
    const d = Math.hypot(dx, dy);
    const c = this.cfg[kind];
    this.projectiles.push({
      kind, x: e.x, y: e.y, vx: (dx / d) * c.speed, vy: (dy / d) * c.speed,
      friendly: false, travelled: 0, flight: d, damage: c.wallDamage,
      hitsLeft: 1, hit: new Set(), parried: false,
    });
  }

  // ---- defenders ----------------------------------------------------------

  private updateDefenders(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.defender || slot.defender === 'soldiers') continue;
      slot.timer -= dt;
      if (slot.timer > 0) continue;
      if (slot.defender === 'crossbow') this.fireCrossbow(slot);
      else if (slot.defender === 'archers') this.fireArrow(slot);
      else this.fireCatapult(slot);
    }
  }

  private fireCrossbow(slot: Slot): void {
    const cb = this.cfg.crossbow;
    let target: Enemy | undefined;
    for (const e of this.enemies) {
      if (e.y > cb.range) continue;
      if (!target || e.y < target.y) target = e;
    }
    if (!target) return;
    slot.timer = cb.interval / this.mult('crossbow', 'rate');
    const dx = target.x - slot.x;
    const dy = target.y - slot.y;
    const d = Math.hypot(dx, dy) || 1;
    slot.aimX = target.x;
    slot.aimY = target.y;
    this.projectiles.push({
      kind: 'bolt', x: slot.x, y: slot.y, vx: (dx / d) * cb.boltSpeed, vy: (dy / d) * cb.boltSpeed,
      friendly: true, travelled: 0, flight: cb.range, damage: cb.damage * this.mult('crossbow', 'damage'),
      hitsLeft: this.crossbowPierce(), hit: new Set(), parried: false,
    });
    this.events.push({ type: 'boltFired', x: slot.x, y: slot.y });
  }

  private fireArrow(slot: Slot): void {
    const a = this.cfg.archers;
    let target: Enemy | undefined;
    let best = a.range;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - slot.x, e.y - slot.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (!target) return;
    // One squad looses its arrows one after another.
    slot.timer = a.interval / (a.archers * this.mult('archers', 'rate'));
    slot.aimX = target.x;
    slot.aimY = target.y;
    const dx = target.x - slot.x;
    const dy = target.y - slot.y;
    this.projectiles.push({
      kind: 'arrow', x: slot.x + this.rng.range(-0.8, 0.8), y: slot.y, vx: (dx / best) * a.arrowSpeed, vy: (dy / best) * a.arrowSpeed,
      friendly: true, travelled: 0, flight: a.range + 8, damage: a.damage * this.mult('archers', 'damage'),
      hitsLeft: 1, hit: new Set(), parried: false, target, burn: this.arrowBurn(),
    });
  }

  /** Lobs a stone at the densest cluster in range, leading it a little. */
  private fireCatapult(slot: Slot): void {
    const c = this.cfg.catapult;
    const size = 4;
    // Bucket enemies into squares; heavies count extra when choosing, so big targets draw fire.
    const buckets = new Map<number, { weight: number; n: number; x: number; y: number }>();
    let best: { weight: number; n: number; x: number; y: number } | undefined;
    for (const e of this.enemies) {
      if (e.y > c.range || e.y < 2) continue;
      const k = Math.floor(e.y / size) * 1000 + Math.floor(e.x / size + 100);
      const b = buckets.get(k) ?? { weight: 0, n: 0, x: 0, y: 0 };
      b.weight += e.kind === 'warlord' || e.kind === 'ogre' ? 4 : 1;
      b.n++;
      b.x += e.x;
      b.y += e.y;
      buckets.set(k, b);
      if (!best || b.weight > best.weight) best = b;
    }
    if (!best) return;
    const cx = best.x / best.n;
    const cy = best.y / best.n - this.cfg.grunt.speed * c.flightTime * 0.6;
    slot.timer = c.interval / this.mult('catapult', 'rate');
    slot.aimX = cx;
    slot.aimY = cy;
    const dx = cx - slot.x;
    const dy = cy - slot.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = d / c.flightTime;
    this.projectiles.push({
      kind: 'stone', x: slot.x, y: slot.y, vx: (dx / d) * sp, vy: (dy / d) * sp,
      friendly: true, travelled: 0, flight: d, damage: c.damage * this.mult('catapult', 'damage'),
      hitsLeft: 1, hit: new Set(), parried: false, splash: this.catapultSplash(),
    });
  }

  private splash(p: Projectile): void {
    const r = p.splash ?? 1;
    const kb = this.cfg.catapult.knockback;
    this.within(p.x, p.y, r + MAX_RADIUS, (e) => {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (e.hp <= 0 || d > r + this.cfg[e.kind].radius * 0.5) return;
      e.hp -= p.damage;
      const mass = this.cfg[e.kind].mass;
      e.vx += ((d > 1e-3 ? dx / d : 0) * kb) / mass;
      e.vy += ((d > 1e-3 ? dy / d : 1) * kb) / mass;
      if (e.state === 'wall' || e.state === 'climb' || e.state === 'fight') e.state = 'march';
    });
    this.events.push({ type: 'splash', x: p.x, y: p.y, radius: r });
  }

  private updateProjectiles(dt: number): void {
    const sh = this.cfg.shield;
    const hw = this.cfg.field.halfWidth;
    const keep: Projectile[] = [];

    for (const p of this.projectiles) {
      // Arrows steer toward their target while it lives.
      if (p.kind === 'arrow' && p.target && p.target.hp > 0) {
        const dx = p.target.x - p.x;
        const dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = this.cfg.archers.arrowSpeed;
        p.vx = (dx / d) * sp;
        p.vy = (dy / d) * sp;
      }
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.travelled += Math.hypot(p.vx, p.vy) * dt;
      let alive = true;

      if (!p.friendly) {
        // Breakout-style deflection: where the rock hits the shield sets its new angle.
        const s = this.shield;
        if (s.raised && prevY > sh.y && p.y <= sh.y && Math.abs(p.x - s.x) <= sh.halfWidth) {
          const parry = this.time - s.raisedAt <= sh.parryWindow;
          const offset = (p.x - s.x) / sh.halfWidth;
          const sp = Math.hypot(p.vx, p.vy) * (parry ? 1.8 : 1.3);
          const angle = offset * 0.9; // up to ~50 degrees off straight back
          const proj = p.kind === 'boulder' ? this.cfg.boulder : this.cfg.rock;
          p.vx = Math.sin(angle) * sp;
          p.vy = Math.cos(angle) * sp;
          p.y = sh.y + 0.01;
          p.friendly = true;
          p.parried = parry;
          p.damage = proj.deflectDamage * (parry ? sh.parryMultiplier : 1);
          p.hitsLeft = parry ? 3 : 1;
          p.travelled = 0;
          p.flight = 80;
          if (parry) this.parries++;
          this.events.push({ type: 'deflect', x: p.x, y: sh.y, parry });
        } else if (p.y <= 0) {
          const seg = this.segmentAt(p.x);
          this.damageSegment(seg, p.damage, p.x);
          this.events.push({ type: 'wallHit', x: p.x, y: 0, segment: seg });
          alive = false;
        }
      } else if (p.kind === 'stone') {
        if (p.travelled >= p.flight) {
          this.splash(p);
          alive = false;
        }
      } else {
        const r = p.kind === 'bolt' ? 0.6 : p.kind === 'arrow' ? 0.4 : (p.kind === 'boulder' ? this.cfg.boulder.radius : this.cfg.rock.radius) + 0.4;
        this.within(p.x, p.y, r + MAX_RADIUS, (e) => {
          if (e.hp <= 0 || p.hit.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > r + this.cfg[e.kind].radius * 0.6) return;
          p.hit.add(e);
          e.hp -= p.damage;
          if (p.burn) {
            e.burn = Math.max(e.burn, p.burn);
            e.burnTime = this.cfg.archers.burnSeconds;
          }
          if (p.kind !== 'arrow') {
            const sp = Math.hypot(p.vx, p.vy) || 1;
            const kb = this.cfg.crossbow.knockback / this.cfg[e.kind].mass;
            e.vx += (p.vx / sp) * kb;
            e.vy += (p.vy / sp) * kb;
            if (e.state === 'wall' || e.state === 'climb') e.state = 'march';
          }
          this.events.push({ type: 'hit', x: e.x, y: e.y });
          if (p.kind === 'bolt') p.damage *= 1 - this.cfg.crossbow.pierceFalloff;
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

  private removeDead(): void {
    const alive: Enemy[] = [];
    const growth = this.cfg.economy.killGoldGrowth ** Math.max(0, this.wave - 1);
    for (const e of this.enemies) {
      if (e.hp > 0) {
        alive.push(e);
        continue;
      }
      this.addGold(this.cfg[e.kind].gold * growth);
      this.kills++;
      this.events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
      if (e.kind === 'warlord') {
        this.renown += this.cfg.renown.bossKill;
        this.events.push({ type: 'bossKilled', x: e.x, y: e.y });
      }
    }
    this.enemies = alive;
  }
}
