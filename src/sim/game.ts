import { type Config, makeConfig } from './config';
import { Rng } from './rng';
import { type EnemyKind, type WavePlan, planWave } from './waves';

/**
 * The whole combat simulation. It has no rendering or DOM code, so it runs
 * the same in the browser and headless (tests and balance sims).
 * Advance it with step(); the renderer only reads its state.
 */

export type EnemyState = 'march' | 'climb' | 'wall' | 'stand';

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number; // knockback velocity, decays with friction
  vy: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  /** Chuckers: the y they stop at to throw. */
  standY: number;
  /** Throw countdown for chuckers, climb countdown at the wall. */
  timer: number;
  /** Fixed random number per enemy, for animation phase and drift. */
  phase: number;
}

export interface Projectile {
  kind: 'rock' | 'bolt';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Friendly projectiles hurt enemies; hostile ones hurt the wall. */
  friendly: boolean;
  /** For drawing the rock's arc: distance travelled and total flight distance. */
  travelled: number;
  flight: number;
  damage: number;
  /** Enemies it can still pass through (bolts pierce). */
  hitsLeft: number;
  hit: Set<Enemy>;
  parried: boolean;
}

export type GameEvent =
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  | { type: 'slap'; x: number; y: number }
  | { type: 'deflect'; x: number; y: number; parry: boolean }
  | { type: 'boltFired'; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'wallHit'; x: number; y: number; segment: number }
  | { type: 'segmentDestroyed'; segment: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'lost'; segment: number }
  | { type: 'won' };

export type Phase = 'preview' | 'battle' | 'lost' | 'won';

export const STEP = 1 / 60;

export class Game {
  readonly cfg: Config;
  readonly seed: number;
  time = 0;
  phase: Phase = 'preview';
  phaseTimer: number;
  wave = 0;
  plan: WavePlan;
  private nextGroup = 0;

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  segmentHp: number[];
  gold = 0;
  kills = 0;
  parries = 0;
  events: GameEvent[] = [];

  shield = { x: 0, wantRaised: false, raised: false, raisedAt: -1, energy: 0, locked: false };
  vigor: number;
  crossbowTimer = 0;

  private rng: Rng;
  private grid = new Map<number, Enemy[]>();

  constructor(seed = 1, cfg: Config = makeConfig()) {
    this.cfg = cfg;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.segmentHp = new Array(cfg.wall.segments).fill(cfg.wall.segmentHp);
    this.shield.energy = cfg.shield.maxEnergy;
    this.vigor = cfg.slap.vigorMax;
    this.plan = planWave(1, seed, cfg);
    this.phaseTimer = cfg.waves.previewSeconds;
  }

  get over(): boolean {
    return this.phase === 'lost' || this.phase === 'won';
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
    if (this.over || this.vigor < vigorCost) return false;
    this.vigor -= vigorCost;
    for (const e of this.enemies) {
      const dx = e.x - x;
      const dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const nx = d > 1e-3 ? dx / d : 0;
      const ny = d > 1e-3 ? dy / d : 1;
      // Push outward, biased away from the castle.
      e.vx += nx * impulse;
      e.vy += (ny * 0.5 + 0.8) * impulse;
      e.hp -= damage;
      if (e.state === 'wall' || e.state === 'climb') e.state = 'march';
    }
    this.events.push({ type: 'slap', x, y });
    return true;
  }

  /** Starts the next wave without waiting for the preview countdown. */
  skipPreview(): void {
    if (this.phase === 'preview') this.phaseTimer = 0;
  }

  // ---- queries ------------------------------------------------------------

  segmentWidth(): number {
    return (this.cfg.field.halfWidth * 2) / this.cfg.wall.segments;
  }

  segmentAt(x: number): number {
    const i = Math.floor((x + this.cfg.field.halfWidth) / this.segmentWidth());
    return Math.max(0, Math.min(this.cfg.wall.segments - 1, i));
  }

  get wavesSurvived(): number {
    return this.phase === 'preview' || this.phase === 'won' ? this.wave : this.wave - 1;
  }

  // ---- simulation ---------------------------------------------------------

  step(dt = STEP): void {
    if (this.over) return;
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
    this.updateCrossbow(dt);
    this.updateProjectiles(dt);
    this.removeDead();

    const broken = this.segmentHp.findIndex((hp) => hp <= 0);
    if (broken >= 0) {
      this.phase = 'lost';
      this.events.push({ type: 'lost', segment: broken });
      return;
    }
    if (this.phase === 'battle' && this.nextGroup >= this.plan.groups.length && this.enemies.length === 0) {
      this.events.push({ type: 'waveCleared', wave: this.wave });
      this.projectiles = this.projectiles.filter((p) => p.friendly);
      if (this.wave >= this.cfg.waves.finalWave) {
        this.phase = 'won';
        this.events.push({ type: 'won' });
        return;
      }
      this.plan = planWave(this.wave + 1, this.seed, this.cfg);
      this.phase = 'preview';
      this.phaseTimer = this.cfg.waves.previewSeconds;
    }
  }

  private startWave(): void {
    this.wave = this.plan.number;
    this.phase = 'battle';
    this.phaseTimer = 0;
    this.nextGroup = 0;
    this.events.push({ type: 'waveStart', wave: this.wave });
  }

  private spawnDue(): void {
    const groups = this.plan.groups;
    while (this.nextGroup < groups.length && groups[this.nextGroup].time <= this.phaseTimer) {
      const g = groups[this.nextGroup++];
      const perRow = 4;
      const spacing = 1.1;
      for (let i = 0; i < g.count; i++) {
        const row = Math.floor(i / perRow);
        const col = (i % perRow) - (Math.min(g.count, perRow) - 1) / 2;
        this.spawn(g.kind, g.x + col * spacing, this.cfg.field.spawnY + row * spacing);
      }
    }
  }

  private spawn(kind: EnemyKind, x: number, y: number): void {
    const hp = this.cfg[kind].hp;
    const c = this.cfg.chucker;
    this.enemies.push({
      kind, x, y, vx: 0, vy: 0, hp, maxHp: hp, state: 'march',
      standY: this.rng.range(c.standMinY, c.standMaxY),
      timer: this.rng.range(0, c.throwInterval),
      phase: this.rng.next(),
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

  /** Calls fn for enemies in the grid cells around (x, y); return true to stop. */
  private near(x: number, y: number, fn: (e: Enemy) => boolean | void): void {
    for (let gy = -1; gy <= 1; gy++) {
      for (let gx = -1; gx <= 1; gx++) {
        const cell = this.grid.get(this.cellKey(x + gx, y + gy));
        if (!cell) continue;
        for (const e of cell) if (fn(e) === true) return;
      }
    }
  }

  private updateEnemies(dt: number): void {
    const { friction, separation } = this.cfg.physics;
    const hw = this.cfg.field.halfWidth;

    for (const e of this.enemies) {
      const stats = this.cfg[e.kind];
      // Push neighbours apart so battalions read as crowds, not one stacked sprite.
      let px = 0;
      let py = 0;
      this.near(e.x, e.y, (o) => {
        if (o === e) return;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        const min = stats.radius * 2;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (min - d);
          py += (dy / d) * (min - d);
        }
      });

      const mx = Math.sin(this.time * 0.7 + e.phase * 6.28) * 0.15;
      let my = 0;
      const front = stats.radius;

      switch (e.state) {
        case 'march':
          my = -stats.speed;
          if (e.kind === 'chucker' && e.y <= e.standY) {
            e.state = 'stand';
          } else if (e.y <= front) {
            e.state = 'climb';
            e.timer = stats.climbSeconds;
          }
          break;
        case 'stand':
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = this.cfg.chucker.throwInterval;
            this.throwRock(e);
          }
          break;
        case 'climb':
          e.y = Math.min(e.y, front);
          e.timer -= dt;
          if (e.timer <= 0) e.state = 'wall';
          break;
        case 'wall':
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

  private damageSegment(seg: number, amount: number, x: number): void {
    if (this.segmentHp[seg] <= 0) return;
    this.segmentHp[seg] = Math.max(0, this.segmentHp[seg] - amount);
    if (this.rng.next() < 0.03) this.events.push({ type: 'wallHit', x, y: 0, segment: seg });
    if (this.segmentHp[seg] === 0) this.events.push({ type: 'segmentDestroyed', segment: seg });
  }

  private throwRock(e: Enemy): void {
    const hw = this.cfg.field.halfWidth;
    const tx = Math.max(-hw + 1, Math.min(hw - 1, e.x + this.rng.range(-8, 8)));
    const dx = tx - e.x;
    const dy = 0 - e.y;
    const d = Math.hypot(dx, dy);
    const sp = this.cfg.rock.speed;
    this.projectiles.push({
      kind: 'rock', x: e.x, y: e.y, vx: (dx / d) * sp, vy: (dy / d) * sp,
      friendly: false, travelled: 0, flight: d, damage: this.cfg.rock.wallDamage,
      hitsLeft: 1, hit: new Set(), parried: false,
    });
  }

  private updateCrossbow(dt: number): void {
    const cb = this.cfg.crossbow;
    this.crossbowTimer -= dt;
    if (this.crossbowTimer > 0) return;
    let target: Enemy | undefined;
    for (const e of this.enemies) {
      if (e.y > cb.range) continue;
      if (!target || e.y < target.y) target = e;
    }
    if (!target) return;
    this.crossbowTimer = cb.interval;
    const ox = cb.x;
    const oy = 1;
    const dx = target.x - ox;
    const dy = target.y - oy;
    const d = Math.hypot(dx, dy) || 1;
    this.projectiles.push({
      kind: 'bolt', x: ox, y: oy, vx: (dx / d) * cb.boltSpeed, vy: (dy / d) * cb.boltSpeed,
      friendly: true, travelled: 0, flight: cb.range, damage: cb.damage,
      hitsLeft: cb.pierce, hit: new Set(), parried: false,
    });
    this.events.push({ type: 'boltFired', x: ox, y: oy });
  }

  private updateProjectiles(dt: number): void {
    const sh = this.cfg.shield;
    const hw = this.cfg.field.halfWidth;
    const keep: Projectile[] = [];

    for (const p of this.projectiles) {
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
          p.vx = Math.sin(angle) * sp;
          p.vy = Math.cos(angle) * sp;
          p.y = sh.y + 0.01;
          p.friendly = true;
          p.parried = parry;
          p.damage = this.cfg.rock.deflectDamage * (parry ? sh.parryMultiplier : 1);
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
      } else {
        const r = p.kind === 'bolt' ? 0.6 : this.cfg.rock.radius + 0.4;
        this.near(p.x, p.y, (e) => {
          if (e.hp <= 0 || p.hit.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > r) return;
          p.hit.add(e);
          e.hp -= p.damage;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const kb = this.cfg.crossbow.knockback;
          e.vx += (p.vx / sp) * kb;
          e.vy += (p.vy / sp) * kb;
          if (e.state === 'wall' || e.state === 'climb') e.state = 'march';
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
    for (const e of this.enemies) {
      if (e.hp > 0) {
        alive.push(e);
        continue;
      }
      this.gold += this.cfg[e.kind].gold;
      this.kills++;
      this.events.push({ type: 'kill', x: e.x, y: e.y, kind: e.kind });
    }
    this.enemies = alive;
  }
}
