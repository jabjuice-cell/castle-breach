import { describe, expect, it } from 'vitest';
import { averageBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { type Ball, type Enemy, Game as RealGame, type Projectile } from '../src/sim/game';
import { applyChoices, defaultChoices, sanitizeChoices } from '../src/sim/town';
import { META_UPGRADES, applyMeta, buyMeta, metaCost, metaDepth, metaLocked, newProgress } from '../src/sim/meta';
import { type Contraption, footprint } from '../src/sim/contraptions';
import { contact } from '../src/sim/obstacles';
import { type Layout, type Placed, PIECE_IDS, PIECES, activePairs, autoPack, canPlace, effectiveMeta, pieceCells, sanitizePlot, yard } from '../src/sim/plot';
import { Tutorial } from '../src/sim/tutorial';

/** The game as most tests want it: the free starting company is cleared so the castle starts empty. */
class Game extends RealGame {
  constructor(...args: ConstructorParameters<typeof RealGame>) {
    super(...args);
    this.defenders.length = 0;
    this.soldiers = [];
  }
}
import { formation, planSize, planWave, waveBudget } from '../src/sim/waves';

function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) game.step();
}

function enemy(over: Partial<Enemy>): Enemy {
  return {
    kind: 'grunt', x: 0, y: 10, vx: 0, vy: 0, hp: 10, maxHp: 10, state: 'march', standY: 25, timer: 99, phase: 0,
    burn: 0, burnTime: 0, rally: 1, foe: null, block: null, slotX: 0, slotY: 0, goldMult: 1, lastBall: -1, stagger: 0, blasted: false, shielded: false, bowl: null, pinned: 0,
    ...over,
  };
}

function boulder(over: Partial<Projectile> = {}): Projectile {
  return { kind: 'boulder', x: 0, y: 8, vx: 0, vy: -13, friendly: false, travelled: 0, flight: 30, damage: 25, hitsLeft: 1, hit: new Set(), ...over };
}

/** No defenders fire and no catapults come, so tests control every hit. */
const quiet = () => makeConfig({
  crossbow: { range: -100 }, archers: { range: -100 },
  waves: { orcCatapultsBase: 0, orcCatapultsPerWave: 0, towerWaves: [], warlordWaves: [] },
  capsules: { chance: 0 },
  fieldTrees: { counts: [0] },
  contraptions: { enabled: false },
});

/** Every defender for sale, as once the town has unlocked them. */
const veteran = (cfg = makeConfig()) => {
  cfg.unlocks.defenders = ['crossbow', 'archers', 'catapult', 'soldiers'];
  return cfg;
};

/** Towers on the old joint spots (the wall itself starts level). */
function towers(game: Game, xs = [-20, -12, -4, 4, 12, 20], storeys = 1) {
  for (const x of xs) game.stacks.push({ x, storeys, hp: game.cfg.towers.storeyHp });
}

/** A game in battle with an empty field: no blocks coming and the Royal Ball put away. */
function battle(seed = 1, cfg = quiet()) {
  const game = new Game(seed, cfg);
  game.endSetup();
  game.plan.groups = [];
  game.skipPreview();
  game.balls = [];
  game.royalDue = Infinity;
  game.royalDue = Infinity;
  // Something on the field so the wave doesn't end at once.
  game.enemies.push(enemy({ x: 0, y: 60, state: 'stand', hp: 1e9 }));
  return game;
}

function ball(game: Game, over: Partial<Ball>): Ball {
  const b: Ball = {
    id: 999, kind: 'claimed', x: 0, y: 10, vx: 0, vy: -20, primary: false, power: 1, combo: 0, behind: false, heaved: false, perfect: false,
    stuck: false, stuckOffset: 0, stuckAt: 0, hitShieldAt: -99, born: 0, passing: null, lines: 0, milestone: 0, banked: false, spin: 0, ...over,
  };
  game.balls.push(b);
  return b;
}

describe('waves', () => {
  it('plans the same wave for the same seed', () => {
    const cfg = makeConfig();
    expect(planWave(4, 7, cfg)).toEqual(planWave(4, 7, cfg));
  });

  it('follows the threat budget, in 2 to 6 marching blocks', () => {
    const cfg = makeConfig();
    const w1 = planWave(1, 1, cfg);
    expect(w1.totals).toMatchObject({ grunt: 45, chucker: 5, rider: 0, orcCatapult: cfg.waves.orcCatapultsBase });
    expect(w1.groups).toHaveLength(3);
    expect(Math.round(waveBudget(10, cfg))).toBe(583);
    const blocks = (n: number) => planWave(n, 1, cfg).groups.filter((g) => g.members.some((m) => m.kind === 'grunt')).length;
    expect(blocks(25)).toBe(6);
    for (const n of [5, 12, 19]) {
      const t = planWave(n, 2, cfg).totals;
      const threat = (t.grunt + t.barrel + t.runner + t.shieldOrc) * 1 + t.chucker * 2 + t.rider * 2 + t.ogre * 12;
      expect(threat).toBeCloseTo(Math.round(waveBudget(n, cfg)), 0);
    }
  });

  it('brings catapults every wave, barrels from wave 5, the siege tower on 10 and the warlord riding it on 15', () => {
    const cfg = makeConfig();
    const w = cfg.waves;
    const cats = (n: number) => Math.min(w.orcCatapultsMax, Math.floor(w.orcCatapultsBase + w.orcCatapultsPerWave * (n - 1)));
    expect(planWave(1, 1, cfg).totals.orcCatapult).toBe(5);
    expect(planWave(15, 1, cfg).totals.orcCatapult).toBe(cats(15));
    expect(planWave(4, 1, cfg).totals.barrel).toBe(0);
    expect(planWave(5, 1, cfg).totals.barrel).toBe(3);
    expect(planWave(10, 1, cfg)).toMatchObject({ tower: true, totals: { warlord: 0 } });
    expect(planWave(14, 1, cfg).boss).toBe(false);
    expect(planWave(15, 1, cfg)).toMatchObject({ tower: true, totals: { warlord: 1 } });
  });

  it('formations put the front rank first', () => {
    const slots = formation('wedge', 9, 1);
    expect(slots[0]).toEqual({ dx: 0, dy: 0 });
    expect(slots.filter((s) => s.dy === 0)).toHaveLength(1);
    expect(formation('rect', 20, 1).every((s) => s.dy >= 0)).toBe(true);
  });

  it('pins formations are triangles, point leading', () => {
    const slots = formation('pins', 10, 1);
    const rows = [0, 1, 2, 3].map((r) => slots.filter((s) => Math.abs(s.dy - r * 1.4 * 0.9) < 1e-9).length);
    expect(rows).toEqual([1, 2, 3, 4]);
  });

  it('plans shield orcs and drummers from wave 3 with consistent totals', () => {
    const cfg = makeConfig();
    let shields = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = planWave(6, seed, cfg);
      const listed = p.groups.reduce((s, g) => s + g.members.reduce((t, m) => t + m.count, 0), 0);
      expect(listed).toBe(planSize(p));
      shields += p.totals.shieldOrc;
    }
    expect(shields).toBeGreaterThan(0);
    expect(planWave(2, 1, cfg).totals.shieldOrc).toBe(0);
  });

  it('spawns exactly the previewed enemies', () => {
    const game = new Game(3, quiet());
    game.endSetup();
    const total = planSize(game.plan);
    game.skipPreview();
    run(game, 30);
    expect(game.kills + game.enemies.length).toBe(total);
  });
});

describe('the shield and the balls', () => {
  it('follows the mouse at a capped speed', () => {
    const game = battle();
    game.setShield(15);
    run(game, 0.05);
    expect(game.shield.x).toBeGreaterThan(0);
    expect(game.shield.x).toBeLessThan(15);
    run(game, 0.5);
    expect(game.shield.x).toBeCloseTo(15, 5);
    // The shield runs right up to the edge of the wall, half of it overhanging.
    game.setShield(100);
    run(game, 0.5);
    expect(game.shield.x).toBeCloseTo(game.cfg.field.halfWidth - game.shieldHalfWidth() * 0.5, 5);
  });

  it('serves the Royal Ball from the shield at the start of a wave, and again after it is lost', () => {
    const game = new Game(1, quiet());
    game.endSetup();
    game.skipPreview();
    const royal = game.balls.find((b) => b.primary)!;
    expect(royal.stuck).toBe(true);
    expect(game.heave()).toBe(true);
    expect(royal.stuck).toBe(false);
    expect(royal.vy).toBeGreaterThan(0);
    // Lost past the shield: 10 wall damage, then re-served after the short reserve delay.
    royal.x = 15;
    royal.y = 2;
    royal.vy = -20;
    royal.vx = 0;
    run(game, 0.2);
    expect(game.balls.some((b) => b.primary)).toBe(false);
    expect(game.wallDamage['missed royal']).toBe(10);
    run(game, game.cfg.balls.reserveSeconds + 0.1);
    expect(game.balls.some((b) => b.primary && b.stuck)).toBe(true);
  });

  it('blocking a boulder turns it into a ball, and a missed one hits the wall for 25', () => {
    const game = battle();
    game.projectiles.push(boulder());
    run(game, 0.5);
    expect(game.balls).toHaveLength(1);
    expect(game.balls[0]).toMatchObject({ kind: 'claimed' });
    expect(game.balls[0].vy).toBeGreaterThan(0);
    expect(game.blocked).toBe(1);
    game.projectiles.push(boulder({ x: 15 }));
    run(game, 1);
    expect(game.segmentHp[game.segmentAt(15)]).toBe(400 - 25);
  });

  it('hybrid bounce: the flat middle mirrors the ball, the edges kick it wide as a trick shot', () => {
    const game = new Game(1);
    expect(game.bounceAngle(0, 0.3)).toBe(0.3);
    expect(game.bounceAngle(0.7, -0.4)).toBe(-0.4);
    expect(game.bounceAngle(1, -0.4)).toBeCloseTo(1.309);
    expect(game.bounceAngle(-1, 0.4)).toBeCloseTo(-1.309);
    expect(game.bounceAngle(0.9)).toBeGreaterThan(1.134);
    // A ball coming in at an angle leaves at the same angle off the middle.
    const m = battle();
    m.setShield(-6);
    run(m, 0.2);
    const mb = ball(m, { x: -6, y: 3.2, vx: 6, vy: -18 });
    run(m, 0.05);
    expect(mb.vy).toBeGreaterThan(0);
    expect(mb.vx / mb.vy).toBeCloseTo(6 / 18, 1);
    // A trick shot off the edge starts its combo at 1.
    // Clear of the tower turrets, which would bank it.
    const g = battle();
    g.setShield(-6);
    run(g, 0.2);
    const b = ball(g, { x: -6 + g.shieldHalfWidth() * 0.97, y: 2.9 });
    run(g, 0.05);
    expect(b.vy).toBeGreaterThan(0);
    expect(Math.abs(b.vx)).toBeGreaterThan(Math.abs(b.vy) * 2);
    expect(b.combo).toBe(1);
  });

  it('a shield orc shrugs off front hits but not back hits, and its drummer holds the formation', () => {
    const front = battle();
    const s1 = enemy({ kind: 'shieldOrc', x: 5, y: 30, hp: 14, maxHp: 14, shielded: true });
    front.enemies.push(s1);
    const fb = ball(front, { x: 5, y: 29.2, vx: 0, vy: 20 });
    const events: string[] = [];
    front.step();
    events.push(...front.events.map((e) => e.type));
    expect(s1.hp).toBe(14);
    expect(events).toContain('clang');
    expect(fb.vy).toBeLessThan(0);

    const back = battle();
    const s2 = enemy({ kind: 'shieldOrc', x: 5, y: 30, hp: 14, maxHp: 14, shielded: true });
    back.enemies.push(s2);
    ball(back, { x: 5, y: 30.8, vx: 0, vy: -20 });
    back.step();
    expect(s2.hp).toBeLessThan(14);
  });

  it('killing the drummer drops shields and frees the block', () => {
    const game = battle();
    game.plan.groups = [{ time: 0, lane: 2, x: 0, shape: 'rect', members: [{ kind: 'shieldOrc', count: 3 }, { kind: 'drummer', count: 1 }] }];
    game.step();
    const block = game.blocks[0];
    const shields = game.enemies.filter((e) => e.kind === 'shieldOrc');
    expect(shields).toHaveLength(3);
    expect(shields.every((e) => e.shielded && e.block === block)).toBe(true);
    game.enemies.find((e) => e.kind === 'drummer')!.hp = 0;
    game.step();
    expect(shields.every((e) => !e.shielded && e.block === null && e.hp > 0)).toBe(true);
    expect(game.events.some((e) => e.type === 'formationBreak')).toBe(true);
  });

  it('the Royal Ball rebounds off the tree lines and the top edge, and pays double behind the lines', () => {
    const game = battle();
    const b = ball(game, { kind: 'royal', x: 18, y: 66, vx: 20, vy: 20 });
    run(game, 0.15);
    expect(b.vx).toBeLessThan(0);
    expect(b.vy).toBeLessThan(0);
    expect(b.behind).toBe(true);
    expect(game.ballGoldMult(b)).toBe(2);
  });

  it('a caught boulder sails off the top of the field instead of rebounding', () => {
    const game = battle();
    ball(game, { x: 0, y: 66, vx: 0, vy: 20 });
    run(game, 0.2);
    expect(game.balls).toHaveLength(0);
    expect(game.ballsLost).toBe(0);
  });

  it('the Royal Ball flattens any orc but a boss in one hit', () => {
    const game = battle();
    const ogre = enemy({ kind: 'ogre', x: 0, y: 20, hp: 50, maxHp: 50, state: 'stand' });
    game.enemies.push(ogre);
    ball(game, { kind: 'royal', x: 0, y: 16, vx: 0, vy: 20 });
    run(game, 0.3);
    expect(ogre.hp).toBeLessThanOrEqual(0);
  });

  it('balls knock into each other', () => {
    const game = battle();
    const a = ball(game, { id: 1, x: -2, y: 30, vx: 20, vy: 0.1 });
    const b = ball(game, { id: 2, x: 2, y: 30, vx: -20, vy: 0.1 });
    run(game, 0.15);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('moving the shield as it hits curves the ball', () => {
    const game = battle();
    game.shield.x = -8;
    game.setShield(8);
    const b = ball(game, { x: -7, y: 2.9, vx: 0, vy: -20 });
    run(game, 0.02);
    expect(b.spin).not.toBe(0);
  });

  it('balls never skate sideways flatter than 75 degrees', () => {
    const game = battle();
    const b = ball(game, { x: 0, y: 30, vx: 20, vy: 0.5 });
    run(game, 1.5);
    expect(Math.abs(b.vy) / Math.hypot(b.vx, b.vy)).toBeGreaterThanOrEqual(0.258);
  });

  it('a ball kills a grunt, knocks its neighbours, bounces and builds a combo', () => {
    const game = battle();
    game.enemies.push(enemy({ x: 0, y: 20, state: 'stand' }), enemy({ x: 0.9, y: 20.3, state: 'stand' }), enemy({ x: 8, y: 20, state: 'stand' }));
    const b = ball(game, { x: 0, y: 16, vx: 0, vy: 20 });
    run(game, 0.25);
    expect(game.kills).toBe(1);
    expect(game.enemies.find((e) => e.x > 0.5 && e.x < 4)!.hp).toBe(5);
    expect(b.vy).toBeLessThan(0);
    expect(b.combo).toBe(1);
    expect(game.enemies.find((e) => e.x > 7)!.hp).toBe(10);
  });

  it('combo multiplies kill gold and resets on the shield', () => {
    const game = battle();
    game.enemies.push(enemy({ x: 0, y: 20, state: 'stand' }));
    const b = ball(game, { x: 0, y: 16, vx: 0, vy: 20, combo: 20 });
    const gold = game.gold;
    run(game, 0.25);
    expect(game.gold - gold).toBeCloseTo(1 * 3); // combo 20 -> x3
    run(game, 1.5);
    expect(b.combo).toBe(0);
  });

  it('a heave just before impact is a power shot that smashes through a whole orc line', () => {
    const game = battle();
    const block = { id: 1, x: 0, y: 20, shape: 'line' as const, members: [] as Enemy[], start: 8, spacing: 1, speed: 0, homeX: 0, zig: false, phase: 0, dirty: false, regroupAt: 99, drummed: false, haltUntil: 0 };
    for (let i = 0; i < 8; i++) {
      const e = enemy({ x: -3.5 + i, y: 20, block, slotX: -3.5 + i, slotY: 0, hp: 20, maxHp: 20 });
      block.members.push(e);
      game.enemies.push(e);
    }
    // Another row behind it stays standing.
    const back = enemy({ x: 0.5, y: 25, hp: 20, maxHp: 20, state: 'stand' });
    game.enemies.push(back);
    game.blocks.push(block);
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    game.heave();
    run(game, 0.05);
    expect(b.heaved).toBe(true);
    expect(game.parries).toBe(1);
    run(game, 1);
    expect(block.members.every((e) => e.hp <= 0)).toBe(true);
    expect(game.kills).toBeGreaterThanOrEqual(8);
    // It ploughs on through the next line too, rather than bouncing.
    expect(back.hp).toBeLessThanOrEqual(0);
    // The shield needs 3 s to recover.
    expect(game.canHeave).toBe(false);
    run(game, 2);
    expect(game.canHeave).toBe(true);
  });

  it('a heave too early is just a normal hit, and the shield needs 3 s to recover', () => {
    const game = battle();
    expect(game.heave()).toBe(true);
    expect(game.canHeave).toBe(false);
    run(game, 0.5);
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    run(game, 0.05);
    expect(b.heaved).toBe(false);
    run(game, 0.6);
    expect(game.canHeave).toBe(false);
    run(game, 2);
    expect(game.canHeave).toBe(true);
  });

  it('a heave pressed just before the ball lands is a Perfect Return', () => {
    const game = battle();
    game.events = [];
    expect(game.heave()).toBe(true);
    run(game, 0.05);
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    run(game, 0.05);
    expect(b.perfect).toBe(true);
    expect(b.heaved).toBe(true);
    expect(game.perfects).toBe(1);
    expect(game.events.some((e) => e.type === 'perfect')).toBe(true);
  });

  it('a heave pressed too early, or after the ball landed, is not perfect', () => {
    const early = battle();
    early.heave();
    run(early, 0.5);
    const e = ball(early, { x: 0, y: 2.9, vy: -20 });
    run(early, 0.05);
    expect(e.perfect).toBe(false);
    expect(early.perfects).toBe(0);
    const late = battle();
    const l = ball(late, { x: 0, y: 2.9, vy: -20 });
    run(late, 0.05);
    late.events = [];
    expect(late.heave()).toBe(true);
    expect(l.heaved).toBe(true);
    expect(l.perfect).toBe(false);
    expect(late.perfects).toBe(0);
    expect(late.events.some((ev) => ev.type === 'perfect')).toBe(false);
  });

  it('one press makes only one ball perfect', () => {
    const game = battle();
    game.heave();
    run(game, 0.05);
    ball(game, { id: 1, x: -2, y: 2.9, vy: -20 });
    ball(game, { id: 2, x: 2, y: 2.9, vy: -20 });
    run(game, 0.1);
    expect(game.perfects).toBe(1);
    expect(game.balls.filter((b) => b.perfect)).toHaveLength(1);
  });

  it('a perfect ball hits an orc for 1.5x, once, and an ordinary return is never perfect', () => {
    const hpLoss = (press: boolean) => {
      const cfg = quiet();
      cfg.shield.heaveLines = 0;
      const game = battle(1, cfg);
      const orc = enemy({ x: 0, y: 20, hp: 100, maxHp: 100, state: 'stand' });
      game.enemies.push(orc);
      if (press) game.heave();
      const b = ball(game, { x: 0, y: 2.9, vy: -20 });
      run(game, 0.05);
      expect(b.perfect).toBe(press);
      for (let i = 0; i < 90 && orc.hp === 100; i++) game.step();
      expect(orc.hp).toBeLessThan(100);
      expect(b.perfect).toBe(false);
      return 100 - orc.hp;
    };
    expect(hpLoss(true)).toBeCloseTo(hpLoss(false) * makeConfig().shield.perfectDamage, 5);
  });

  it('a perfect ball that returns to the shield unpressed is no longer perfect', () => {
    const game = battle();
    game.heave();
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    run(game, 0.05);
    expect(b.perfect).toBe(true);
    // Back down onto the shield with no press in the window.
    game.shield.heaveAt = -99;
    b.x = 0;
    b.y = 2.9;
    b.vx = 0;
    b.vy = -20;
    run(game, 0.05);
    expect(b.perfect).toBe(false);
    expect(game.perfects).toBe(1);
  });

  it('the bash rests 0.65 s after a press: presses in the rest are ignored, then it re-arms', () => {
    const game = battle();
    game.heave();
    const first = game.shield.bashAt;
    run(game, 0.5);
    game.heave();
    expect(game.shield.bashAt).toBe(first);
    run(game, 0.2);
    game.heave();
    expect(game.shield.bashAt).toBeGreaterThan(first + 0.6);
    expect(game.shield.bashAt).toBeCloseTo(game.time, 5);
  });

  it('a press during the bash rest cannot make a Perfect Return, and the ball still rebounds', () => {
    const game = battle();
    game.heave();
    run(game, 0.4);
    game.heave();
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    run(game, 0.05);
    expect(b.perfect).toBe(false);
    expect(game.perfects).toBe(0);
    expect(b.vy).toBeGreaterThan(0);
  });

  it('a Perfect Return leaves 1.3x faster than an ordinary return, never past maxSpeed * heaveSpeed', () => {
    const speedAfter = (press: boolean, vy: number) => {
      const game = battle();
      game.heave();
      run(game, 0.7);
      expect(game.canHeave).toBe(false);
      if (press) game.heave();
      const b = ball(game, { x: 0, y: 2.9, vy });
      run(game, 0.05);
      expect(b.perfect).toBe(press);
      return Math.hypot(b.vx, b.vy);
    };
    const cfg = makeConfig();
    expect(speedAfter(true, -20) / speedAfter(false, -20)).toBeCloseTo(cfg.shield.perfectSpeed, 3);
    expect(speedAfter(true, -60)).toBeLessThanOrEqual(cfg.balls.maxSpeed * cfg.shield.heaveSpeed + 1e-9);
  });

  it('with the heave cooling but the bash ready, a press is perfect without a plough', () => {
    const game = battle();
    game.heave();
    run(game, 0.7);
    expect(game.canHeave).toBe(false);
    expect(game.heave()).toBe(true);
    const b = ball(game, { x: 0, y: 2.9, vy: -20 });
    run(game, 0.05);
    expect(b.perfect).toBe(true);
    expect(b.heaved).toBe(false);
    expect(b.lines).toBe(0);
  });

  it('a perfect ball keeps its bonus off a raised shield front, then spends it for 1.5x on an ordinary orc', () => {
    const dmg = (perfect: boolean) => {
      const game = battle();
      const front = enemy({ kind: 'shieldOrc', x: 5, y: 30, hp: 14, maxHp: 14, shielded: true });
      const orc = enemy({ x: -8, y: 30, hp: 100, maxHp: 100, state: 'stand' });
      game.enemies.push(front, orc);
      const b = ball(game, { x: 5, y: 29.2, vx: 0, vy: 20, perfect });
      game.step();
      expect(game.events.some((e) => e.type === 'clang')).toBe(true);
      expect(front.hp).toBe(14);
      expect(b.perfect).toBe(perfect);
      b.x = -8;
      b.y = 29.2;
      b.vx = 0;
      b.vy = 20;
      b.passing = null;
      for (let i = 0; i < 30 && orc.hp === 100; i++) game.step();
      expect(orc.hp).toBeLessThan(100);
      expect(b.perfect).toBe(false);
      return 100 - orc.hp;
    };
    expect(dmg(true)).toBeCloseTo(dmg(false) * makeConfig().shield.perfectDamage, 5);
  });

  it('the perfect event names the ball and the contact time', () => {
    const game = battle();
    game.heave();
    run(game, 0.05);
    ball(game, { id: 7, x: 0, y: 2.9, vy: -20 });
    game.events = [];
    let ev: { type: string; ball?: number; at?: number } | undefined;
    for (let i = 0; i < 10 && !ev; i++) {
      game.step();
      ev = game.events.find((e) => e.type === 'perfect');
    }
    expect(ev).toMatchObject({ ball: 7 });
    expect(ev!.at).toBe(game.time);
    expect(game.events.find((e) => e.type === 'deflect')).toMatchObject({ perfect: true });
  });

  it('a perfect ball stays perfect through a bumper rebound', () => {
    const cfg = quiet();
    cfg.bumpers.enabled = true;
    const game = battle(1, cfg);
    const t = game.bumpers()[2];
    game.setShield(-15);
    run(game, 0.5);
    const b = ball(game, { x: t.x + 0.3, y: t.y + 2, vy: -20, perfect: true });
    run(game, 0.15);
    expect(b.banked).toBe(true);
    expect(b.perfect).toBe(true);
  });

  it('practiceBall lobs a ball down at the shield', () => {
    const game = battle();
    game.practiceBall(3);
    expect(game.balls).toHaveLength(1);
    const b = game.balls[0];
    expect(b.x).toBeCloseTo(game.shield.x + 3, 5);
    expect(b.y).toBeGreaterThan(game.cfg.shield.y);
    expect(b.vy).toBeLessThan(0);
  });

  it('bank shots: tower turrets (when switched on) bounce balls back up for +2 combo', () => {
    expect(battle().bumpers()).toHaveLength(0);
    const on = () => {
      const cfg = quiet();
      cfg.bumpers.enabled = true;
      return cfg;
    };
    const game = battle(1, on());
    const bumpers = game.bumpers();
    expect(bumpers).toHaveLength(6);
    const t = bumpers[2];
    game.setShield(-15);
    run(game, 0.5);
    const b = ball(game, { x: t.x + 0.3, y: t.y + 2, vy: -20 });
    run(game, 0.15);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.combo).toBe(2);
    expect(b.banked).toBe(true);
    // A defender on the tower makes the bumper bigger.
    const g = new Game(1, veteran(on()));
    g.gold = 1000;
    expect(g.place('archers', t.x, -1)).toBe(true);
    expect(g.bumpers()[2].r).toBeGreaterThan(t.r);
  });

  it('barrel orcs blow up the cluster around them, and set off other barrels', () => {
    const game = battle();
    game.enemies.push(
      enemy({ kind: 'barrel', x: 0, y: 30, state: 'stand' }),
      enemy({ x: 2, y: 30, hp: 30, maxHp: 30, state: 'stand' }),
      enemy({ kind: 'barrel', x: 3.5, y: 30, state: 'stand' }),
      enemy({ x: 7, y: 30, hp: 30, maxHp: 30, state: 'stand' }),
    );
    ball(game, { x: 0, y: 27, vy: 20 });
    run(game, 0.6);
    expect(game.enemies.filter((e) => e.hp < 1e8)).toHaveLength(0);
  });

  it('a barrel that reaches the wall blows a 60 HP hole', () => {
    const game = battle();
    game.enemies.push(enemy({ kind: 'barrel', x: 0, y: 1 }));
    run(game, 2);
    expect(game.segmentHp[2]).toBe(400 - 60);
  });

  it('a falling ogre staggers its row', () => {
    const game = battle();
    game.enemies.push(enemy({ kind: 'ogre', x: 0, y: 30, hp: 1, maxHp: 50, state: 'stand' }), enemy({ x: 5, y: 30, hp: 20 }), enemy({ x: 5, y: 40, hp: 20 }));
    ball(game, { x: 0, y: 27, vy: 20 });
    run(game, 0.3);
    const [row, behind] = [game.enemies.find((e) => e.y < 35 && e.hp < 1e8)!, game.enemies.find((e) => e.y > 35 && e.hp < 1e8)!];
    expect(row.stagger).toBeGreaterThan(0);
    expect(row.hp).toBe(15);
    expect(behind.stagger).toBe(0);
  });

  it('caught capsules: grog splits every ball into three, the banner widens the shield', () => {
    const game = battle();
    ball(game, { x: 10, y: 30, vy: 20 });
    game.capsules.push({ kind: 'grog', x: 0, y: 3 });
    run(game, 0.3);
    expect(game.balls).toHaveLength(3);
    const w = game.shieldHalfWidth();
    game.capsules.push({ kind: 'banner', x: 0, y: 3 });
    run(game, 0.3);
    expect(game.shieldHalfWidth()).toBeCloseTo(w * 1.5);
    // A missed capsule just falls away.
    game.capsules.push({ kind: 'grog', x: 18, y: 5 });
    run(game, 2);
    expect(game.capsules).toHaveLength(0);
  });

  it('the siege tower is chipped apart floor by floor, tipping out orcs', () => {
    const game = new Game(1, makeConfig({ ...quiet(), waves: { ...quiet().waves, towerWaves: [1] } }));
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    const tw = game.tower!;
    expect(tw.floors).toHaveLength(4);
    const plank = (game.cfg.siegeTower.halfWidth * 2) / game.cfg.siegeTower.planks;
    for (let i = 0; i < 12; i++) ball(game, { id: 100 + i, x: tw.x - game.cfg.siegeTower.halfWidth + ((i % 6) + 0.5) * plank, y: tw.y - 1.5, vy: 20 });
    run(game, 0.1);
    expect(game.tower!.floors).toHaveLength(3);
    // Its orcs tumble out (and the balls coming back down may already be into them).
    expect(game.enemies.length + game.kills).toBe(game.cfg.siegeTower.floorOrcs);
  });
});

describe('game', () => {
  it('is deterministic for a seed', () => {
    const a = new Game(42);
    const b = new Game(42);
    const botA = averageBot();
    const botB = averageBot();
    for (let i = 0; i < 60 * 60; i++) {
      botA(a);
      a.step();
      botB(b);
      b.step();
    }
    expect(a.kills).toBe(b.kills);
    expect(a.segmentHp).toEqual(b.segmentHp);
  });

  it('ends the run as soon as any one wall segment falls', () => {
    const game = battle();
    game.segmentHp[2] = 0.1;
    game.enemies.push(enemy({ x: 0, y: 0.5, state: 'wall' }));
    run(game, 1);
    expect(game.phase).toBe('lost');
    expect(game.segmentHp.filter((hp) => hp === 0)).toHaveLength(1);
  });

  it('grunts climb before they start hacking at the wall', () => {
    const game = battle();
    game.enemies.push(enemy({ x: 0, y: 1 }));
    run(game, 2);
    expect(game.segmentHp[2]).toBe(400);
    run(game, 3);
    expect(game.segmentHp[2]).toBeLessThan(400);
  });

  it('blocks march in formation and close ranks when orcs fall', () => {
    const game = new Game(1, quiet());
    game.endSetup();
    game.skipPreview();
    run(game, 0.1);
    const block = game.blocks[0];
    const n = block.members.length;
    const y0 = block.y;
    run(game, 2);
    expect(block.y).toBeLessThan(y0);
    const front = Math.min(...block.members.map((e) => e.slotY));
    const rank = block.members.filter((m) => m.slotY === front);
    const killed = Math.min(2, rank.length - 1);
    for (const e of rank.slice(0, killed)) e.hp = 0;
    run(game, 1);
    expect(block.members).toHaveLength(n - killed);
    // Orcs from behind step up into the gaps: the front rank is full again for the smaller block.
    const full = formation(block.shape, n - killed, block.spacing).filter((s) => s.dy === 0).length;
    expect(block.members.filter((e) => e.slotY === front)).toHaveLength(full);
  });

  it('wins the level after its last wave, for the level-clear Renown', () => {
    const cfg = quiet();
    cfg.levels.waves = 1;
    const game = new Game(1, cfg, 1);
    expect([game.firstWave, game.lastWave]).toEqual([2, 2]);
    game.endSetup();
    game.skipPreview();
    const total = planSize(game.plan);
    for (let i = 0; i < 60 * 120 && !game.over; i++) {
      for (const e of game.enemies) e.hp = 0;
      game.step();
    }
    expect(game.kills).toBe(total);
    expect(game.phase).toBe('won');
    expect(game.wavesSurvived).toBe(1);
    expect(game.renown).toBeGreaterThanOrEqual(cfg.renown.levelClear[1]);
  });
});

describe('run loop', () => {
  it('opens each level with a paused setup and its war chest', () => {
    const game = new Game(1, makeConfig(), 1);
    expect(game.phase).toBe('setup');
    expect(game.gold).toBe(game.cfg.economy.warChest);
    expect(game.plan.number).toBe(6);
    expect(game.levelWave).toBe(1);
    run(game, 5);
    expect(game.time).toBe(0);
    game.endSetup();
    expect(game.phase).toBe('preview');
  });

  it('sells the crossbow only until the town unlocks the rest', () => {
    const first = new Game(1, applyMeta({}, 0));
    expect(first.defenders).toHaveLength(0);
    first.gold = 1000;
    expect(first.place('archers', -4, -1)).toBe(false);
    expect(first.place('catapult', -4, -1)).toBe(false);
    expect(first.place('crossbow', -4, -1)).toBe(true);
    const later = new Game(1, applyMeta({ archers: 1 }, 0));
    later.gold = 1000;
    expect(later.place('archers', -4, -1)).toBe(true);
    expect(later.place('mage', 8, -1)).toBe(false);
  });

  it('town upgrades cost Renown, max out, and carry into every level', () => {
    const p = newProgress();
    p.renown = 1000;
    expect(metaCost(p.meta, 'width')).toBe(15);
    expect(buyMeta(p, 'width')).toBe(true);
    expect(p.renown).toBe(985);
    expect(buyMeta(p, 'power') && buyMeta(p, 'power')).toBe(true);
    expect(buyMeta(p, 'power')).toBe(false);
    for (let i = 0; i < 3; i++) buyMeta(p, 'recovery');
    buyMeta(p, 'masonry');
    buyMeta(p, 'archers');
    buyMeta(p, 'fletching');
    buyMeta(p, 'treasury');
    const plain = new Game(1, applyMeta({}, 2), 2);
    const game = new Game(1, applyMeta(p.meta, 2), 2);
    expect(game.shieldHalfWidth()).toBeCloseTo(plain.shieldHalfWidth() + 0.42);
    expect(game.heaveLines()).toBe(plain.heaveLines() + 2);
    expect(game.heaveCooldown()).toBeCloseTo(plain.heaveCooldown() - 1.2);
    expect(game.segmentHp[0]).toBe(plain.segmentHp[0] * 1.2);
    expect(game.mult('crossbow', 'damage')).toBeCloseTo(1.15);
    expect(game.gold).toBe(plain.gold + 60);
    expect(plain.gold).toBe(750);
  });

  it('the research tree gates upgrades behind their prerequisites, and capstones pay off', () => {
    const p = newProgress();
    p.renown = 5000;
    expect(buyMeta(p, 'fletching')).toBe(false);
    expect(metaLocked(p.meta, 'fletching')).toMatch(/Archery/);
    expect(p.renown).toBe(5000);
    expect(buyMeta(p, 'archers') && buyMeta(p, 'fletching')).toBe(true);
    expect(metaLocked(p.meta, 'fletching')).toBe('');
    expect(metaDepth('archers')).toBe(0);
    // Every prerequisite names a real upgrade, and the tree has no cycles.
    for (const u of META_UPGRADES) expect(metaDepth(u.id)).toBeLessThan(META_UPGRADES.length);
  });

  it('sells defenders back: in full during the setup, at half price once the level is under way', () => {
    const game = new Game(1, quiet());
    game.gold = 1000;
    game.place('crossbow', -4, -1);
    game.place('crossbow', 4, -1);
    const [a, b] = game.defenders;
    expect([a.paid, b.paid]).toEqual([100, 125]);
    expect(game.sell(a.id)).toBe(true);
    expect(game.gold).toBe(1000 - 125);
    game.endSetup();
    expect(game.sellValue(b.id)).toBe(Math.floor(b.paid / 2));
    // A saved load-out goes back down as far as the gold allows.
    const next = new Game(2, quiet());
    expect(next.restoreLoadout([{ kind: 'crossbow', x: -4, y: -1 }, { kind: 'crossbow', x: 4, y: -1 }, { kind: 'crossbow', x: 0, y: -1 }, { kind: 'crossbow', x: 8, y: -1 }, { kind: 'archers', x: 12, y: -1 }])).toBe(3);
  });

  it('defenders go exactly where they are put on the castle, clear of each other', () => {
    const game = new Game(1, veteran());
    towers(game);
    game.gold = 1000;
    expect(game.place('catapult', 0, 20)).toBe(false); // out on the battlefield
    expect(game.place('crossbow', -3.5, -0.5)).toBe(true); // no snapping: it stands where it was put
    expect(game.defenders[0]).toMatchObject({ x: -3.5, y: -0.5, ground: 'tower' });
    expect(game.place('catapult', -2, -1)).toBe(false); // too close: they would overlap
    expect(game.place('catapult', -12, -6.3)).toBe(true);
    expect(game.defenders[1].ground).toBe('courtyard');
    expect(game.place('soldiers', 1, -1.2)).toBe(true);
    expect(game.defenders[2].ground).toBe('wall');
    // Each extra one of a kind costs more.
    expect(game.defenderCost('crossbow')).toBe(Math.round(100 * game.cfg.castle.priceGrowth));
    game.endSetup();
    game.skipPreview();
    expect(game.place('archers', 12, -1)).toBe(false); // the shop is shut mid-battle
  });

  it('coverage: crossbows shoot up a lane, tower tops angle wider, catapults have a blind spot', () => {
    const game = new Game(1, veteran());
    towers(game);
    game.gold = 2000;
    game.place('crossbow', -1.8, -1); // a wall spot
    game.place('crossbow', 4, -1); // a tower top
    game.place('catapult', 1.8, -6); // the courtyard
    const [wall, tower, cat] = game.defenders;
    expect(game.covers(wall, -1.8, 50)).toBe(true);
    expect(game.covers(wall, 6, 50)).toBe(false);
    expect(game.covers(tower, 14, 50)).toBe(true);
    expect(game.covers(tower, 18, 20)).toBe(false);
    expect(game.covers(cat, 1.8, 5)).toBe(false); // too close to the wall
    expect(game.covers(cat, 1.8, 30)).toBe(true);
    expect(game.sectionCover(2)).toBeGreaterThan(game.sectionCover(0));
  });

  it('aims crossbows, archers and catapults in the setup, further round from a tower top', () => {
    const game = new Game(1, veteran(quiet()));
    towers(game);
    game.gold = 2000;
    game.place('crossbow', -1.8, -1); // the wall walk
    game.place('crossbow', 4, -1); // a tower top
    game.place('soldiers', -12, -6);
    const [wall, tower, men] = game.defenders;
    expect(game.covers(wall, 10, 30)).toBe(false);
    expect(game.aim(wall.id, { x: 10, y: 30 })).toBe(true);
    expect(wall.heading).toBeCloseTo(Math.atan2(11.8, 31));
    expect(game.covers(wall, 10, 30)).toBe(true);
    expect(game.covers(wall, -1.8, 30)).toBe(false); // the old lane is no longer covered
    // A hard turn is clamped: about 26 degrees from the wall, 46 from a tower.
    game.aim(wall.id, { x: 40, y: 1 });
    game.aim(tower.id, { x: 40, y: 1 });
    expect(wall.heading).toBeCloseTo(0.45);
    expect(tower.heading).toBeCloseTo(0.8);
    expect(game.aim(men.id, { x: 0, y: 10 })).toBe(false);
    game.aim(wall.id, null);
    expect(game.covers(wall, -1.8, 30)).toBe(true);
    game.endSetup();
    game.skipPreview();
    expect(game.aim(tower.id, { x: 0, y: 30 })).toBe(false); // not mid-battle
  });

  it('the wall starts level; towers cost 40, 70, 120 and reach 1.3, 1.55, 1.75', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 2000;
    expect(game.stacks).toHaveLength(0);
    game.place('archers', -12, -1); // a former joint: just the wall now
    const squad = game.defenders[0];
    expect(squad.ground).toBe('wall');
    expect(game.rangeMult(squad)).toBe(1);
    expect(game.storeyCost()).toBe(40);
    expect(game.buildTower(-12, -1)).toBe(true); // a new tower, under the squad
    expect(squad.ground).toBe('tower');
    expect(game.rangeMult(squad)).toBeCloseTo(1.3);
    const stack = game.stacks[0];
    expect(game.storeyCost(stack)).toBe(70);
    expect(game.buildTower(-11.5, -1)).toBe(true); // stacks on the same tower
    expect(game.rangeMult(squad)).toBeCloseTo(1.55);
    expect(game.storeyCost(stack)).toBe(120);
    expect(game.buildTower(-12, -1)).toBe(true);
    expect(game.rangeMult(squad)).toBeCloseTo(1.75);
    expect(game.storeyCost(stack)).toBe(Infinity);
    expect(game.towerPlan(-12, -1)).toEqual({ ok: false, why: 'As tall as it goes' });
    expect(game.towerPlan(-10, -1).ok).toBe(false); // too close to it
    expect(game.towerPlan(10, -6).ok).toBe(false); // the courtyard
    // Other towers start at 40 each: no price growth across the wall.
    const gold = game.gold;
    expect(game.buildTower(0, -1)).toBe(true);
    expect(game.buildTower(12, -1)).toBe(true);
    expect(gold - game.gold).toBe(80);
    expect(game.stacks.map((t) => t.storeys)).toEqual([3, 1, 1]);
  });

  it('the wall starts level: no towers until the player builds them', () => {
    const cfg = quiet();
    cfg.unlocks.defenders = ['crossbow', 'mage'];
    const game = new Game(1, cfg, 0);
    game.gold = 1000;
    expect(game.stacks).toHaveLength(0);
    expect(game.canPlace('mage', 4, -1)).toBe(false);
    expect(game.buildTower(4, -1)).toBe(true);
    expect(game.canPlace('mage', 4, -1)).toBe(true);
  });

  it('enemy shots that land on a tower hit it, not the wall; its top storey falls and the tower shrinks', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 2000;
    game.buildTower(0, -1);
    game.buildTower(0, -1);
    expect(game.place('crossbow', 0, -1)).toBe(true);
    const cb = game.defenders[0];
    expect(game.rangeMult(cb)).toBeCloseTo(1.55);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 0, y: 60, state: 'stand', hp: 1e9 }));
    const seg = game.segmentAt(0);
    const before = game.segmentHp[seg];
    game.events = [];
    const shot = () => game.projectiles.push(boulder({ y: 0.5, flight: 1 }));
    shot();
    shot();
    run(game, 0.5);
    expect(game.segmentHp[seg]).toBe(before);
    expect(game.stacks[0].storeys).toBe(1);
    expect(game.events.some((e) => e.type === 'storeyLost')).toBe(true);
    expect(game.rangeMult(cb)).toBeCloseTo(1.3);
    shot();
    shot();
    run(game, 0.5);
    expect(game.stacks).toHaveLength(0);
    expect(cb.ground).toBe('wall');
    expect(game.segmentHp[seg]).toBe(before);
  });

  it('a taller tower is a wider target', () => {
    const game = new Game(1, quiet());
    towers(game, [0]);
    expect(game.towerHitAt(1.8)).toBeUndefined();
    game.stacks[0].storeys = 2;
    expect(game.towerHitAt(1.8)).toBe(game.stacks[0]);
  });

  it('tall towers draw fire', () => {
    const landed = (game: Game) => {
      let hits = 0;
      for (let i = 0; i < 200; i++) {
        game.projectiles = [];
        (game as any).throwAtWall(-6 + (i % 13), 40, 'rock', 6);
        const p = game.projectiles[game.projectiles.length - 1];
        if (Math.abs(p.x + p.vx * (p.y / -p.vy)) < 0.01) hits++;
      }
      return hits;
    };
    const bare = new Game(1, quiet());
    expect(landed(bare)).toBe(0);
    const game = new Game(1, quiet());
    towers(game, [0], 3);
    const hits = landed(game);
    expect(hits).toBeGreaterThan(50);
    expect(hits).toBeLessThan(94);
  });

  it('standing towers mend when a wave is cleared', () => {
    const game = battle();
    towers(game, [0], 2);
    game.stacks[0].hp = 7;
    game.enemies = [];
    (game as any).clearWave(game.wave);
    expect(game.stacks[0].hp).toBe(game.cfg.towers.storeyHp);
  });

  it('moves defenders for free between waves; mid-battle costs gold and a pack-up', () => {
    const game = new Game(1, quiet());
    game.place('crossbow', -4, -1);
    const cb = game.defenders[0];
    expect(game.move(cb.id, 4, -1)).toBe(true);
    expect([cb.x, cb.y]).toEqual([4, -1]);
    expect(game.defenderAt(4.5, -1)).toBe(cb);
    game.endSetup();
    game.skipPreview();
    game.wave = 10;
    game.gold = 100;
    expect(game.moveCost()).toBe(20);
    expect(game.move(cb.id, 12, -1)).toBe(true);
    expect(game.gold).toBe(80);
    expect(cb.timer).toBe(game.cfg.castle.packSeconds);
    expect(game.move(cb.id, 0, 30)).toBe(false);
  });

  it('upgrade costs grow by 15% a level and each level adds 10%', () => {
    const game = new Game(1);
    game.gold = 1e6;
    game.place('crossbow', -4, -1);
    const first = game.upgradeCost('crossbow', 'damage');
    expect(first).toBe(40);
    expect(game.upgrade('crossbow', 'damage')).toBe(true);
    expect(game.upgradeCost('crossbow', 'damage')).toBe(Math.round(40 * 1.15));
    expect(game.mult('crossbow', 'damage')).toBeCloseTo(1.1);
    for (let i = 1; i < 10; i++) game.upgrade('crossbow', 'damage');
    expect(game.mult('crossbow', 'damage')).toBeCloseTo(4); // 1 + 10 x 0.1, doubled at the level 10 milestone
    expect(game.upgrade('archers', 'damage')).toBe(false); // nothing to upgrade yet
  });

  it('repairs walls at 1 gold per 2 HP between waves, but not mid-battle', () => {
    const game = new Game(1);
    game.segmentHp[0] = 300;
    game.gold = 20;
    expect(game.repairCost(0)).toBe(50);
    expect(game.repair(0)).toBe(40);
    expect(game.gold).toBe(0);
    expect(game.segmentHp[0]).toBe(340);
    game.endSetup();
    game.gold = 10;
    expect(game.repair(0)).toBe(20);
    game.skipPreview();
    game.gold = 100;
    expect(game.repair(0)).toBe(0);
  });

  it('pays kill gold, wave-clear gold and Renown', () => {
    const game = new Game(1, quiet());
    game.endSetup();
    game.plan.groups = [];
    game.callEarly();
    game.balls = [];
    const afterCall = game.gold;
    game.enemies.push(enemy({ x: 0, y: 30, hp: 0 }));
    run(game, 0.1);
    expect(game.wavesSurvived).toBe(1);
    expect(game.gold - afterCall).toBeCloseTo(game.cfg.grunt.gold + 12); // grunt + 10 + 2 x wave
    expect(game.renownEarned).toBe(Math.round(6 * (1 + 0.02 * (game.cfg.waves.previewSeconds - 4))));
  });

  it('calling a wave early from its tail pays a bonus and starts the next wave', () => {
    const game = battle();
    game.enemies = [enemy({ y: 40 })];
    run(game, 0.05);
    expect(game.canCallEarly()).toBe(true);
    const gold = game.gold;
    expect(game.callEarly()).toBe(true);
    expect(game.wave).toBe(2);
    expect(game.cleared).toBe(1);
    expect(game.gold).toBeGreaterThan(gold + 12);
    expect(game.enemies.length).toBeGreaterThanOrEqual(1);
  });

  it('starts the 30 s break only once the last enemy is dead, and Ready skips it for gold', () => {
    const game = battle();
    (game as unknown as { nextGroup: number }).nextGroup = game.plan.groups.length;
    game.enemies = [enemy({ y: 40 })];
    run(game, 40);
    expect(game.phase).toBe('battle');
    game.enemies = [];
    run(game, 0.1);
    expect(game.phase).toBe('preview');
    expect(game.phaseTimer).toBeGreaterThan(game.cfg.waves.previewSeconds - 1);
    expect(game.cfg.waves.previewSeconds).toBe(30);
    run(game, 10);
    expect(game.phase).toBe('preview');
    const gold = game.gold;
    expect(game.callEarly()).toBe(true);
    expect(game.phase).toBe('battle');
    expect(game.gold).toBeGreaterThan(gold);
  });

  it('opens the shop over the battlefield in the lull between waves, and the level ends after five', () => {
    const game = new Game(1, quiet());
    game.endSetup();
    for (let w = 1; w <= 4; w++) {
      game.plan.groups = [];
      game.skipPreview();
      run(game, 0.05);
      expect(game.phase).toBe('preview');
      expect(game.shopOpen).toBe(true);
    }
    expect(game.cleared).toBe(4);
    expect(game.levelWave).toBe(5);
    game.plan.groups = [];
    game.skipPreview();
    expect(game.canCallEarly()).toBe(false); // nothing after the last wave to call
    run(game, 0.05);
    expect(game.phase).toBe('won');
  });

  it('soldiers hold the stretch of wall below their spot and rush orcs that get close', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 1000;
    expect(game.place('soldiers', 4, -1)).toBe(true);
    expect(game.soldiers).toHaveLength(game.cfg.soldiers.count);
    // They hold their section (x 4 to 12) and spill half into each neighbour.
    const xs = game.soldiers.map((s) => s.x);
    expect(Math.min(...xs)).toBeLessThan(4);
    expect(Math.min(...xs)).toBeGreaterThan(-1);
    expect(Math.max(...xs)).toBeGreaterThan(12);
    expect(Math.max(...xs)).toBeLessThan(17);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 12, y: 5, hp: 1000, maxHp: 1000 }));
    run(game, 2);
    expect(game.enemies[0].hp).toBeLessThan(1000);
  });

  it('soldiers with nothing to do walk slowly along the wall to orcs climbing elsewhere', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 1000;
    game.place('soldiers', 16, -1);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    const climber = enemy({ x: -16, y: 0.6, state: 'wall', hp: 1e6, maxHp: 1e6, timer: 0 });
    game.enemies.push(climber);
    run(game, 3);
    // Still on their way after 3 seconds: they walk, they don't run.
    expect(climber.hp).toBe(1e6);
    expect(Math.min(...game.soldiers.map((s) => s.x))).toBeLessThan(10);
    run(game, 30);
    expect(climber.hp).toBeLessThan(1e6);
  });

  it('the castle catapult lobs fresh Royal Balls up the field', () => {
    const game = new Game(1, veteran(quiet()));
    towers(game);
    game.gold = 150;
    expect(game.place('catapult', 4, -1)).toBe(true);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 5, y: 50, state: 'stand', hp: 1e9 }));
    run(game, 0.1);
    expect(game.balls).toHaveLength(1);
    expect(game.balls[0]).toMatchObject({ kind: 'royal', primary: false });
    expect(game.balls[0].vy).toBeGreaterThan(0);
  });

  it('archers loose a whole volley high into the air onto the thickest crowd', () => {
    const game = new Game(1, veteran(makeConfig({ crossbow: { range: -100 }, waves: { orcCatapultsBase: 0, orcCatapultsPerWave: 0 } })));
    towers(game);
    game.gold = 80;
    expect(game.place('archers', -12, -1)).toBe(true);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    for (let i = 0; i < 30; i++) game.enemies.push(enemy({ x: -10 + (i % 6) * 0.9, y: 50 + Math.floor(i / 6) * 0.9, state: 'stand', hp: 100, maxHp: 100 }));
    game.enemies.push(enemy({ x: 15, y: 20, state: 'stand', hp: 100, maxHp: 100 }));
    run(game, 0.05);
    expect(game.projectiles.filter((p) => p.kind === 'arrow')).toHaveLength(game.cfg.archers.archers);
    run(game, 2.2);
    expect(game.enemies.filter((e) => e.hp < 100).length).toBeGreaterThanOrEqual(10);
    expect(game.enemies[30].hp).toBe(100); // the lone orc nearer the wall is not the target
  });

  it('crossbows hunt orc catapults before the crowd', () => {
    const game = new Game(1, makeConfig({ archers: { range: -100 } }));
    towers(game);
    game.place('crossbow', -4, -1);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.enemies.push(enemy({ x: 0, y: 10, state: 'stand' }), enemy({ kind: 'orcCatapult', x: 5, y: 50, state: 'stand', hp: 60, maxHp: 60 }));
    run(game, 0.05);
    expect(game.defenders[0].aimY).toBeCloseTo(50, 0);
  });

  it('a standing orc catapult keeps creeping toward the wall', () => {
    const game = new Game(1, makeConfig({ archers: { range: -100 } }));
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    const cat = enemy({ kind: 'orcCatapult', x: 5, y: 50, state: 'stand', hp: 60, maxHp: 60, timer: 99 });
    game.enemies.push(cat);
    run(game, 5);
    expect(cat.y).toBeLessThan(49);
    expect(cat.y).toBeGreaterThan(44);
  });


  const town = (...kinds: string[]) => {
    const cfg = veteran(quiet());
    cfg.unlocks.buildings = ['keep', ...kinds] as typeof cfg.unlocks.buildings;
    return cfg;
  };

  it('the tavern makes soldiers hit harder', () => {
    const dealt = (cfg = veteran(quiet())) => {
      const game = new Game(1, cfg);
      game.gold = 1000;
      game.place('soldiers', 0, -1.2);
      game.endSetup();
      game.plan.groups = [];
      game.skipPreview();
      const grunt = enemy({ x: game.soldiers[0].x, y: game.soldiers[0].y + 0.5, state: 'march', hp: 1e9, maxHp: 1e9 });
      game.enemies.push(grunt, enemy({ x: 0, y: 60, state: 'stand', hp: 1e9 }));
      run(game, 0.5);
      return 1e9 - grunt.hp;
    };
    expect(dealt(town('tavern'))).toBeGreaterThan(dealt() * 1.2);
  });

  it('the alchemist makes every ball burn like a flask with no power used', () => {
    const splashed = (cfg = quiet()) => {
      const game = battle(1, cfg);
      game.enemies.push(enemy({ x: 0, y: 20, hp: 1e9, state: 'stand' }));
      ball(game, { x: 0, y: 16, vx: 0, vy: 20 });
      run(game, 0.3);
      return game.events.some((e) => e.type === 'splash');
    };
    expect(splashed()).toBe(false);
    expect(splashed(town('alchemist'))).toBe(true);
  });

  it('the blacksmith sharpens crossbows and archers, not soldiers', () => {
    const plain = new Game(1, veteran(quiet()));
    const smith = new Game(1, town('blacksmith'));
    for (const k of ['crossbow', 'archers'] as const) expect(smith.mult(k, 'damage')).toBeCloseTo(plain.mult(k, 'damage') * 1.25);
    expect(smith.mult('soldiers', 'damage')).toBe(plain.mult('soldiers', 'damage'));
    expect(smith.mult('catapult', 'damage')).toBe(plain.mult('catapult', 'damage'));
  });

  it('the forge hits the catapult 40% harder', () => {
    const plain = new Game(1, veteran(quiet()));
    const forge = new Game(1, town('forge'));
    expect(forge.mult('catapult', 'damage')).toBeCloseTo(plain.mult('catapult', 'damage') * 1.4);
    expect(forge.mult('crossbow', 'damage')).toBe(plain.mult('crossbow', 'damage'));
  });

  it('the chapel mends damaged wall segments in battle but not destroyed ones', () => {
    const game = battle(1, town('chapel'));
    game.segmentHp[0] = 300;
    game.segmentHp[1] = 0;
    const mend = (game as unknown as { healWall(dt: number): void }).healWall.bind(game);
    mend(1);
    expect(game.segmentHp[0]).toBeCloseTo(300 + game.cfg.buildings.chapel.healPerSec, 5);
    expect(game.segmentHp[1]).toBe(0);
    mend(60);
    expect(game.segmentHp[0]).toBe(game.cfg.wall.segmentHp);
  });

  it('the town\'s buildings come from its upgrades', () => {
    expect(applyMeta({}, 0).unlocks.buildings).toEqual(['keep']);
    const all = { tavern: 1, alchemist: 1, blacksmith: 1, chapel: 1, forge: 1 };
    expect(applyMeta(all, 0).unlocks.buildings).toEqual(['keep', 'tavern', 'alchemist', 'blacksmith', 'chapel', 'forge']);
  });

  it('killing a warlord pays boss Renown', () => {
    const game = battle();
    game.enemies.push(enemy({ kind: 'warlord', y: 40, hp: 0, maxHp: 2000 }));
    const before = game.renown;
    run(game, 0.05);
    expect(game.renown - before).toBe(game.cfg.renown.bossKill);
  });

  it('an average paddle bot gets through the opening waves headlessly', () => {
    const game = new Game(5);
    const bot = averageBot();
    // The game is meant to be hard without meta upgrades: a first run should hold the
    // opening waves and then fall.
    for (let i = 0; i < 60 * 60 * 10 && !game.over && game.cleared < 2; i++) {
      bot(game);
      game.step();
    }
    expect(game.cleared).toBeGreaterThanOrEqual(2);
    expect(game.kills).toBeGreaterThan(50);
  });
});

describe('the field\'s structures', () => {
  it('finds the contact between a circle and a round or turned box obstacle', () => {
    expect(contact({ look: 'boulder', x: 0, y: 0, r: 1 }, 1.3, 0, 0.5)).toMatchObject({ nx: 1, ny: 0 });
    expect(contact({ look: 'boulder', x: 0, y: 0, r: 1 }, 2, 0, 0.5)).toBeNull();
    const box = { look: 'ruin' as const, x: 0, y: 0, hw: 2, hh: 0.5, angle: Math.PI / 2 };
    // Turned a quarter, the box runs along y: a circle beside it at x 0.8 is pushed out along +x.
    const hit = contact(box, 0.8, 1, 0.5)!;
    expect(hit.nx).toBeCloseTo(1);
    expect(hit.depth).toBeCloseTo(0.2);
    expect(contact(box, 0, 3, 0.5)).toBeNull();
  });

  it('balls bank off a boulder, and orcs are pushed round it', () => {
    const cfg = quiet();
    cfg.obstacles.levels = [[{ look: 'stone', x: 0, y: 30, r: 1.5 }]];
    const game = battle(1, cfg);
    const b = ball(game, { x: 0, y: 25, vx: 0, vy: 20 });
    run(game, 0.3);
    expect(b.vy).toBeLessThan(0);
    expect(b.combo).toBe(cfg.bumpers.bankCombo);
    const orc = enemy({ x: 0.2, y: 30 });
    game.enemies.push(orc);
    run(game, 0.05);
    expect(Math.hypot(orc.x, orc.y - 30)).toBeGreaterThanOrEqual(1.5 + cfg.grunt.radius - 0.01);
  });

  it('every obstacle breaks to a plain hit, except stone, which needs a heaved ball', () => {
    const cfg = quiet();
    cfg.obstacles.levels = [[{ look: 'boulder', x: 0, y: 30, r: 1.5 }, { look: 'stone', x: -10, y: 30, r: 1 }]];
    const game = battle(1, cfg);
    const a = ball(game, { x: 0, y: 25, vx: 0, vy: 20 });
    const s = ball(game, { id: 1000, x: -10, y: 25, vx: 0, vy: 20 });
    run(game, 0.3);
    expect(a.vy).toBeLessThan(0);
    expect(s.vy).toBeLessThan(0);
    expect(game.obstacles[0].down).toBe(true);
    expect(game.obstacles[1].down).toBeFalsy();
    game.balls.splice(game.balls.indexOf(s), 1);
    const h = ball(game, { id: 1001, x: -10, y: 25, vx: 0, vy: 20, heaved: true });
    run(game, 0.3);
    expect(h.vy).toBeLessThan(0);
    expect(game.obstacles[1].down).toBe(true);
  });

  it('a slanted wall throws a straight ball off sideways', () => {
    const cfg = quiet();
    cfg.obstacles.levels = [[{ look: 'ruin', x: 0, y: 30, hw: 3, hh: 0.6, angle: 0.6 }]];
    const game = battle(1, cfg);
    const b = ball(game, { x: 0, y: 24, vx: 0, vy: 20 });
    run(game, 0.4);
    expect(Math.abs(b.vx)).toBeGreaterThan(5);
  });

  it('a ball off the tree line says where, so the trees can lose some leaves', () => {
    const game = battle();
    ball(game, { x: 18, y: 30, vx: 20, vy: 10 });
    game.events = [];
    run(game, 0.2);
    expect(game.events.some((e) => e.type === 'edge' && e.side === 1)).toBe(true);
  });
});

describe('batch D', () => {
  it('a heave slams the orcs at the wall: light ones fly off dead, heavy ones are shoved back and hurt', () => {
    const game = battle();
    game.setShield(0);
    run(game, 0.3);
    const grunt = enemy({ x: 0.5, y: 0.45, state: 'wall' });
    const ogre = enemy({ kind: 'ogre', x: -1.5, y: 1.2, hp: 50, maxHp: 50, state: 'wall' });
    const far = enemy({ x: 0, y: 20 });
    game.enemies.push(grunt, ogre, far);
    game.events = [];
    expect(game.heave()).toBe(true);
    expect(grunt.hp).toBeLessThanOrEqual(0);
    expect(game.events.some((e) => e.type === 'flung' && e.kind === 'grunt')).toBe(true);
    expect(ogre.hp).toBe(50 - game.cfg.shield.slamDamage);
    expect(ogre.vy).toBeGreaterThan(5);
    expect(far.hp).toBe(10);
    run(game, 0.5);
    expect(ogre.y).toBeGreaterThan(1.5);
  });

  it('trees on the field come down to one hit, and the ball still bounces off', () => {
    const cfg = quiet();
    cfg.obstacles.levels = [[{ look: 'tree', x: 0, y: 30, r: 0.75, breakable: true }]];
    const game = battle(1, cfg);
    const b = ball(game, { x: 0, y: 26, vx: 0, vy: 20 });
    game.events = [];
    run(game, 0.3);
    expect(b.vy).toBeLessThan(0);
    expect(game.obstacles[0].down).toBe(true);
    expect(game.events.some((e) => e.type === 'treeDown')).toBe(true);
    // Gone: the next ball goes straight through.
    const c = ball(game, { id: 1000, x: 0, y: 26, vx: 0, vy: 20 });
    run(game, 0.3);
    expect(c.vy).toBeGreaterThan(0);
  });

  it('plants trees off the road on every level', () => {
    for (const level of [0, 1, 2]) {
      const game = new Game(3, applyMeta({}, level), level);
      const trees = game.obstacles.filter((o) => o.look === 'tree');
      expect(trees.length).toBe(game.cfg.fieldTrees.counts[level]);
      expect(trees.every((t) => Math.abs(t.x) >= game.cfg.fieldTrees.roadHalf && Math.abs(t.x) < game.cfg.field.halfWidth)).toBe(true);
    }
  });

  it('keeps level 1 narrow; later levels are wider behind a longer wall', () => {
    const one = new Game(1, applyMeta({}, 0), 0);
    const two = new Game(1, applyMeta({}, 1), 1);
    expect(one.segmentHp).toHaveLength(5);
    expect(two.segmentHp).toHaveLength(7);
    expect(two.cfg.field.halfWidth).toBeGreaterThan(one.cfg.field.halfWidth);
    // Sections stay about the same width.
    expect(two.segmentWidth()).toBeCloseTo(one.segmentWidth(), 0);
  });
});

describe('pinball contraptions', () => {
  /** A quiet battle with contraptions on and a hand-placed layout. */
  function pin(layout: Contraption[]) {
    const cfg = quiet();
    cfg.contraptions.enabled = true;
    cfg.contraptions.levels = [layout];
    return battle(1, cfg);
  }
  const bell = (x: number, y: number): Contraption => ({ kind: 'bell', x, y, group: 0 });

  it('a bumper kicks the ball away faster, flashes and pays combo', () => {
    const game = pin([{ kind: 'bumper', x: 0, y: 30 }]);
    const b = ball(game, { x: 0.2, y: 26, vx: 0, vy: 20 });
    game.events = [];
    run(game, 0.3);
    expect(b.vy).toBeLessThan(0);
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThanOrEqual(20);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(game.cfg.balls.maxSpeed + 1e-6);
    expect(b.combo).toBe(game.cfg.contraptions.bumper.combo);
    expect(game.events.filter((e) => e.type === 'bumper')).toHaveLength(1);
  });

  it('three bells rung fire one volley, then reset', () => {
    const game = pin([bell(-10, 30), bell(-7, 30), bell(-4, 30)]);
    game.enemies.push(enemy({ x: 0, y: 40 }));
    game.events = [];
    [-10, -7, -4].forEach((x, i) => ball(game, { id: 10 + i, x, y: 25 - i * 4, vx: 0, vy: 20 }));
    run(game, 1);
    const rungEvents = game.events.filter((e) => e.type === 'bell');
    expect(rungEvents).toHaveLength(3);
    expect(game.events.filter((e) => e.type === 'bellVolley')).toHaveLength(1);
    expect(game.projectiles.some((p) => p.kind === 'arrow') || game.events.some((e) => e.type === 'hit')).toBe(true);
    expect(game.bellRung.every((t) => t >= 0)).toBe(true);
    run(game, game.cfg.contraptions.bell.resetSeconds);
    expect(game.bellRung.every((t) => t < 0)).toBe(true);
    expect(game.events.filter((e) => e.type === 'bellVolley')).toHaveLength(1);
  });

  it('a ball over a ramp flies past an orc, lands about 14 up and splashes', () => {
    const game = pin([{ kind: 'ramp', x: -9, y: 22, hw: 2.2, hh: 1.6, angle: 0 }]);
    const blocker = enemy({ x: -9, y: 26, hp: 10 });
    const target = enemy({ x: -9, y: 20.4 + game.cfg.contraptions.ramp.distance, hp: 50, maxHp: 50 });
    game.enemies.push(blocker, target);
    const b = ball(game, { x: -9, y: 18, vx: 0, vy: 20 });
    game.events = [];
    let airborne = false;
    for (let i = 0; i < 90; i++) {
      game.step();
      if (b.air) airborne = true;
      if (game.events.some((e) => e.type === 'rampLand')) break;
    }
    expect(airborne).toBe(true);
    expect(blocker.hp).toBe(10);
    const land = game.events.find((e) => e.type === 'rampLand');
    expect(land).toBeDefined();
    if (land?.type === 'rampLand') {
      expect(Math.abs(land.y - 34.4)).toBeLessThan(1);
      expect(land.hits).toBeGreaterThanOrEqual(1);
    }
    expect(game.events.some((e) => e.type === 'rampLaunch')).toBe(true);
    expect(target.hp).toBeLessThan(50);
    expect(b.air).toBeUndefined();
  });

  it('a ramp near the top lands at the top and the ball is not stuck', () => {
    const game = pin([{ kind: 'ramp', x: 0, y: 60, hw: 2, hh: 1.5, angle: 0 }]);
    const b = ball(game, { id: 5, kind: 'royal', x: 0, y: 56, vx: 0, vy: 30 });
    game.events = [];
    run(game, 1.5);
    expect(b.air).toBeUndefined();
    expect(b.y).toBeLessThan(game.cfg.field.topY);
    expect(game.events.some((e) => e.type === 'rampLand')).toBe(true);
    expect(game.events.some((e) => e.type === 'rebound')).toBe(true);
  });

  const bound = (o: { r?: number; hw?: number; hh?: number }) => o.r ?? Math.hypot(o.hw ?? 1, o.hh ?? 1);

  /** Checks a game's current layout against the rules: mirrored, at the back, apart, in bounds, off the routes and the structures. */
  function checkLayout(game: Game) {
    const k = game.cfg.contraptions;
    const L = k.layout;
    const hw = game.cfg.field.halfWidth;
    const cs = game.contraptions;
    const routes = game.plannedRoutes();
    const centre = cs.filter((c) => c.x === 0);
    // One centre piece per kind at most; everything else has its mirror twin.
    expect(new Set(centre.map((c) => c.kind)).size).toBe(centre.length);
    for (const c of cs) {
      if (c.x === 0) continue;
      expect(cs.some((o) => o.kind === c.kind && Math.abs(o.x + c.x) < 1e-9 && Math.abs(o.y - c.y) < 1e-9)).toBe(true);
    }
    cs.forEach((c, i) => {
      const a = footprint(c, k);
      expect(Math.abs(a.x) + bound(a)).toBeLessThanOrEqual(hw);
      if (c.kind === 'ramp') {
        expect(c.angle).toBe(0);
        expect(c.y).toBeGreaterThanOrEqual(L.rampMinY);
        expect(c.y).toBeLessThanOrEqual(L.rampMaxY);
      } else {
        expect(c.y).toBeGreaterThanOrEqual(L.minY);
        expect(c.y).toBeLessThanOrEqual(L.maxY);
        // Never on or next to an orc route.
        for (const pts of routes) for (const p of pts) if (Math.abs(p.y - c.y) < 4) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThanOrEqual(bound(a) + L.routeClear);
      }
      cs.slice(i + 1).forEach((o) => expect(Math.hypot(c.x - o.x, c.y - o.y)).toBeGreaterThanOrEqual(L.apart));
      for (const o of game.obstacles) if (!o.removed) expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThan(bound(a) + bound(o));
    });
  }

  it('50 seeds give mirrored layouts at the back of the field, clear of the routes', () => {
    for (const level of [0, 1, 2]) {
      for (let seed = 1; seed <= 50; seed++) {
        const game = new Game(seed, applyMeta({}, level), level);
        checkLayout(game);
        const n = (kind: string) => game.contraptions.filter((c) => c.kind === kind).length;
        const want = game.cfg.contraptions.layout.counts[level];
        // Pairs always fit; only an odd piece can miss out, when the middle is an orc route.
        expect(n('bell')).toBe(want.bell);
        expect(n('ramp')).toBe(want.ramp);
        expect(n('bumper')).toBeGreaterThanOrEqual(want.bumper - (want.bumper % 2));
      }
    }
  });

  it('the layout changes in the wave break, from the seed, and stays the same within a wave', () => {
    const game = new Game(4, applyMeta({}, 0), 0);
    const first = JSON.stringify(game.contraptions);
    expect(JSON.stringify(new Game(4, applyMeta({}, 0), 0).contraptions)).toBe(first);
    game.endSetup();
    game.skipPreview();
    expect(game.phase).toBe('battle');
    game.events = [];
    for (let i = 0; i < 60 * 240 && game.phase === 'battle'; i++) {
      for (const e of game.enemies) e.hp = 0;
      game.step();
      if (game.phase === 'battle') expect(JSON.stringify(game.contraptions)).toBe(first);
    }
    expect(game.phase).toBe('preview');
    expect(game.events.some((e) => e.type === 'contraptionsSwapped')).toBe(true);
    expect(JSON.stringify(game.contraptions)).not.toBe(first);
    expect(game.bellRung.every((t) => t < 0)).toBe(true);
    checkLayout(game);
  });

  it('every level has two or three kinds of contraption', () => {
    for (const level of [0, 1, 2]) {
      const kinds = new Set(new Game(1, applyMeta({}, level), level).contraptions.map((c) => c.kind));
      expect(kinds.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('two balls hit contraptions in the same step', () => {
    const game = pin([{ kind: 'bumper', x: -8, y: 30 }, { kind: 'ramp', x: 8, y: 30, hw: 2, hh: 1.5, angle: 0 }]);
    const a = ball(game, { id: 1, x: -8, y: 28.9, vx: 0, vy: 20 });
    const b = ball(game, { id: 2, kind: 'pebble', x: 8, y: 28.6, vx: 0, vy: 20 });
    game.events = [];
    game.step();
    expect(game.events.some((e) => e.type === 'bumper')).toBe(true);
    expect(game.events.some((e) => e.type === 'rampLaunch')).toBe(true);
    expect(a.vy).toBeLessThan(0);
    expect(b.air).toBeDefined();
  });
});

describe('the guided first wave', () => {
  it('takes the orc catapults out and keeps the wall standing', () => {
    const game = new Game(3);
    const t = Tutorial.begin(game);
    expect(game.plan.totals.orcCatapult).toBe(0);
    expect(game.plan.groups.some((g) => g.members.some((m) => m.kind === 'orcCatapult'))).toBe(false);
    game.endSetup();
    game.skipPreview();
    game.segmentHp[0] = 0;
    run(game, 0.1);
    expect(game.phase).toBe('battle');
    expect(game.segmentHp[0]).toBeGreaterThan(0);
    expect(t.done).toBe(false);
  });

  it('moves from serving to heaving to a Perfect Return, then lets go of the wall', () => {
    const game = new Game(3);
    const t = Tutorial.begin(game);
    game.endSetup();
    game.skipPreview();
    expect(t.step).toBe('serve');
    game.balls.forEach((b) => (b.stuck = true));
    t.update(game);
    expect(t.step).toBe('serve');
    game.balls.forEach((b) => (b.stuck = false));
    t.update(game);
    expect(t.step).toBe('heave');
    game.parries = 1;
    t.update(game);
    expect(t.step).toBe('perfect');
    game.perfects = 1;
    expect(t.update(game)).toBe(true);
    expect(game.forgiving).toBe(false);
  });

  it('gives up waiting on a step after a while', () => {
    const game = new Game(3);
    const t = Tutorial.begin(game);
    game.endSetup();
    game.skipPreview();
    game.parries = 1;
    t.update(game);
    t.update(game);
    expect(t.step).toBe('perfect');
    game.time += 31;
    t.update(game);
    expect(t.done).toBe(true);
  });
});

describe('orc bowling', () => {
  /** A column of grunts up the field, an empowered ball just below the first. */
  function lineup(ys: number[], over: Partial<Enemy> = {}, perfect = true) {
    const game = battle();
    const orcs = ys.map((y) => enemy({ x: 0, y, hp: 400, maxHp: 400, ...over }));
    game.enemies.push(...orcs);
    ball(game, { x: 0, y: 8.5, vy: 20, perfect });
    game.events = [];
    return { game, orcs };
  }
  /** Lets the shot land, then takes the ball away so only the bowling is left to measure. */
  const shoot = (game: Game, seconds: number) => {
    run(game, 0.1);
    game.balls = [];
    run(game, seconds);
  };
  const ends = (g: Game) => g.events.filter((e) => e.type === 'bowlEnd');

  it('a Perfect Return knocks a grunt into a tumble, and into the next one', () => {
    const { game, orcs } = lineup([10, 11.7, 13.4]);
    run(game, 0.1);
    expect(orcs[0].bowl).not.toBeNull();
    run(game, 2);
    const end = ends(game);
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ count: 3, bonus: 3 });
    expect(orcs.every((o) => o.bowl === null)).toBe(true);
    expect(game.chains).toHaveLength(0);
  });

  it('keeps 70% of the strength each transfer and damages each orc once', () => {
    const { game, orcs } = lineup([10, 11.7, 13.4]);
    shoot(game, 2);
    const c = game.cfg.bowling;
    expect(orcs[1].hp).toBeCloseTo(400 - c.damage * c.transfer, 5);
    expect(orcs[2].hp).toBeCloseTo(400 - c.damage * c.transfer ** 2, 5);
  });

  it('pays the bonus once, when the chain ends, on top of normal gold', () => {
    const { game } = lineup([10, 11.7, 13.4]);
    const before = game.gold;
    run(game, 0.3);
    expect(game.gold).toBe(before);
    run(game, 2);
    expect(game.gold).toBe(before + 3);
    run(game, 2);
    expect(game.gold).toBe(before + 3);
    expect(game.events.filter((e) => e.type === 'bowl').map((e) => (e as { count: number }).count)).toEqual([1, 2, 3]);
  });

  it('an ordinary ball does not start one', () => {
    const { game, orcs } = lineup([10, 11.7], {}, false);
    run(game, 0.5);
    expect(orcs[0].bowl).toBeNull();
    expect(game.events.some((e) => e.type === 'bowl')).toBe(false);
  });

  it('stops after five transfers', () => {
    const { game } = lineup([10, 11.4, 12.8, 14.2, 15.6, 17, 18.4, 19.8, 21.2]);
    run(game, 3);
    expect(ends(game)[0]).toMatchObject({ count: 6, bonus: 8 });
  });

  it('a heavy orc takes a little damage, stops the chain and never tumbles', () => {
    const { game, orcs } = lineup([10, 12], {});
    orcs[1].kind = 'ogre';
    shoot(game, 2);
    expect(orcs[1].bowl).toBeNull();
    expect(orcs[1].hp).toBeCloseTo(400 - game.cfg.bowling.heavyDamage, 5);
    expect(ends(game)[0]).toMatchObject({ count: 1, bonus: 0 });
  });

  it('an empowered hit on a heavy orc starts nothing', () => {
    const { game, orcs } = lineup([10]);
    orcs[0].kind = 'ogre';
    run(game, 0.5);
    expect(orcs[0].bowl).toBeNull();
    expect(game.events.some((e) => e.type === 'bowl')).toBe(false);
  });

  it('armour stops a tumbler first: a raised shield takes no damage and does not tumble', () => {
    const { game, orcs } = lineup([10, 11.7]);
    orcs[1].kind = 'shieldOrc';
    orcs[1].shielded = true;
    shoot(game, 2);
    expect(orcs[1].bowl).toBeNull();
    expect(orcs[1].hp).toBe(400);
    expect(ends(game)[0]).toMatchObject({ count: 1, bonus: 0 });
  });

  it('a felled orc finishes its tumble, still passes the chain on, and pays its kill once', () => {
    const { game, orcs } = lineup([10, 11.7]);
    orcs[0].hp = 5;
    orcs[0].maxHp = 5;
    const kills = () => game.events.filter((e) => e.type === 'kill').length;
    run(game, 0.2);
    expect(game.enemies).toContain(orcs[0]);
    run(game, 2);
    expect(game.enemies).not.toContain(orcs[0]);
    expect(kills()).toBe(1);
    expect(ends(game)[0]).toMatchObject({ count: 2, bonus: 1 });
  });

  it('a knocked rider keeps travelling as the bowling body', () => {
    const { game, orcs } = lineup([10, 11.7], { hp: 400 });
    orcs[0].kind = 'rider';
    orcs[0].hp = 5;
    run(game, 2);
    expect(orcs[1].hp).toBeLessThan(400);
    expect(ends(game)[0]).toMatchObject({ count: 2 });
    expect(game.kills).toBe(1);
  });

  it('tumblers neither march nor hit the wall, and the tumble always ends', () => {
    const { game, orcs } = lineup([10]);
    run(game, 0.1);
    game.balls = [];
    expect(orcs[0].bowl).not.toBeNull();
    const at = orcs[0].y;
    run(game, 0.2);
    expect(orcs[0].y).toBeGreaterThan(at);
    run(game, 1);
    expect(orcs[0].bowl).toBeNull();
    expect(orcs[0].stagger).toBeGreaterThan(0);
  });

  it('shield team: the drum falling topples the exposed members in sequence', () => {
    const game = battle();
    const block = {
      id: 77, x: 0, y: 10, shape: 'rect' as const, members: [] as Enemy[], start: 4, spacing: 1.6, speed: 0, homeX: 0, zig: false, phase: 0,
      dirty: false, regroupAt: 0, drummed: true, haltUntil: 0,
    };
    const slots = [[0, 0, 'drummer'], [-1.5, 1.8, 'shieldOrc'], [0, 1.8, 'shieldOrc'], [1.5, 1.8, 'shieldOrc']] as const;
    for (const [sx, sy, kind] of slots) {
      const e = enemy({ kind, x: sx, y: 10 + sy, block, slotX: sx, slotY: sy, shielded: kind === 'shieldOrc', hp: kind === 'drummer' ? 5 : 400, maxHp: 400 });
      block.members.push(e);
      game.enemies.push(e);
    }
    game.blocks.push(block);
    ball(game, { x: 0, y: 8.5, vy: 20, perfect: true });
    game.events = [];
    run(game, 3);
    expect(ends(game)).toHaveLength(1);
    expect(ends(game)[0]).toMatchObject({ count: 4 });
    expect(game.enemies.filter((e) => e.kind === 'shieldOrc' && e.hp < 400)).toHaveLength(3);
  });

  it('the dev lineup sets up a working chain', () => {
    const game = battle();
    game.practiceBowling(4);
    game.events = [];
    run(game, 4);
    expect(game.bowlBest).toBeGreaterThanOrEqual(2);
  });
});

describe('battalion spacing', () => {
  it('keeps every orc slot in a block at least 1.8 units from its neighbours, so voxel orcs read one by one', () => {
    const cfg = makeConfig();
    expect(cfg.march.spacing).toBeGreaterThanOrEqual(2);
    for (const shape of ['rect', 'wedge', 'pins'] as const) {
      const slots = formation(shape, 20, cfg.march.spacing);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(Math.hypot(slots[i].dx - slots[j].dx, slots[i].dy - slots[j].dy)).toBeGreaterThanOrEqual(1.8);
        }
      }
    }
  });
});

describe('the four new defenders', () => {
  const ALL = ['crossbow', 'archers', 'catapult', 'soldiers', 'mage', 'ballista', 'oil', 'spiketrap'];

  /** A setup game with every defender unlocked and plenty of gold. */
  function shop() {
    const cfg = quiet();
    cfg.unlocks.defenders = [...ALL];
    const game = new Game(1, cfg, 0);
    game.gold = 5000;
    return game;
  }

  /** Ends the setup into an empty battle, with a far-off decoy so the wave does not end. */
  function fight(game: Game) {
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: -19.5, y: 66, state: 'stand', hp: 1e9 }));
  }

  const grunt = (over: Partial<Enemy>) => enemy({ state: 'stand', hp: 500, maxHp: 500, ...over });

  it('each new kind buys, places and sells back', () => {
    const game = shop();
    towers(game);
    const spots = { mage: [4, -1], ballista: [-4, -1], oil: [0, -1], spiketrap: [0, 15] } as const;
    for (const kind of ['mage', 'ballista', 'oil', 'spiketrap'] as const) {
      const before = game.gold;
      const [x, y] = spots[kind];
      expect(game.defenderCost(kind)).toBe(game.cfg[kind].cost);
      expect(game.place(kind, x, y)).toBe(true);
      expect(game.gold).toBe(before - game.cfg[kind].cost);
      const d = game.defenders[game.defenders.length - 1];
      expect(game.sell(d.id)).toBe(true);
      expect(game.gold).toBe(before);
    }
    expect(game.defenders).toHaveLength(0);
  });

  it('traps and oil move and restore with a saved load-out', () => {
    const game = shop();
    game.place('spiketrap', 0, 15);
    game.place('oil', 0, -1);
    expect(game.move(game.defenders[0].id, 5, 20)).toBe(true);
    expect(game.move(game.defenders[0].id, 5, -1)).toBe(false);
    expect(game.move(game.defenders[1].id, 6, 20)).toBe(false);
    expect(shop().restoreLoadout(game.loadout())).toBe(2);
  });

  it('the mage goes only on a tower top', () => {
    const game = shop();
    towers(game);
    expect(game.canPlace('mage', 0, -1)).toBe(false); // wall walk between towers
    expect(game.canPlace('mage', 4, -6)).toBe(false); // courtyard
    expect(game.canPlace('mage', 4, -1)).toBe(true);
  });

  it('a mage blast hurts a whole crowd, less at the edge, and a taller tower reaches further', () => {
    const game = shop();
    towers(game);
    game.place('mage', 4, -1);
    const d = game.defenders[0];
    expect(game.covers(d, 4, 55)).toBe(false);
    expect(game.buildTower(4, -1)).toBe(true);
    expect(game.covers(d, 4, 55)).toBe(true);
    fight(game);
    const mid = [0, 1, 2, 3].map((i) => grunt({ x: 4 + (i - 1.5) * 0.4, y: 40 }));
    const rim = grunt({ x: 4 + game.mageRadius() * 0.95, y: 40 });
    const out = grunt({ x: 4 + game.mageRadius() + 4, y: 40 });
    game.enemies.push(...mid, rim, out);
    game.events = [];
    run(game, 0.1);
    for (const e of mid) expect(e.hp).toBeLessThan(500);
    expect(rim.hp).toBeLessThan(500);
    expect(500 - rim.hp).toBeLessThan(500 - mid[1].hp);
    expect(out.hp).toBe(500);
    expect(game.events.some((e) => e.type === 'mageBlast')).toBe(true);
  });

  it('the ballista bolt pierces every orc in its lane and hits formations harder', () => {
    const game = shop();
    game.place('ballista', -4, -1);
    fight(game);
    const line = [10, 18, 26, 34, 42, 50, 58].map((y) => grunt({ x: -4, y }));
    line[1].shielded = true;
    const off = grunt({ x: 2, y: 30 });
    game.enemies.push(...line, off);
    run(game, 3);
    for (const e of line) expect(e.hp).toBeLessThan(500);
    expect(off.hp).toBe(500);
    // The shielded orc, further down the lane, still lost more than the one in front of it.
    expect(500 - line[1].hp).toBeGreaterThan(500 - line[0].hp);
  });

  it('oil scalds orcs on the wall in its stretch, and ignores marchers and other stretches', () => {
    const game = shop();
    expect(game.canPlace('oil', 0, -6)).toBe(false);
    expect(game.canPlace('oil', 4, -1)).toBe(true); // tower tops are fine
    game.place('oil', 0, -1);
    fight(game);
    const a = grunt({ x: 1, y: 0.5, state: 'wall' });
    const b = grunt({ x: -2, y: 0.5, state: 'climb' });
    const marching = grunt({ x: 0, y: 2, state: 'march' });
    const far = grunt({ x: 9, y: 0.5, state: 'wall' });
    game.enemies.push(marching);
    game.events = [];
    run(game, 0.1);
    expect(game.events.some((e) => e.type === 'oilPour')).toBe(false);
    game.enemies.push(a, b, far);
    run(game, 0.1);
    expect(a.hp).toBeLessThan(500 - game.cfg.oil.damage * 0.9);
    expect(b.hp).toBeLessThan(500 - game.cfg.oil.damage * 0.9);
    expect(a.burn).toBeGreaterThan(0);
    expect(marching.hp).toBe(500);
    expect(far.hp).toBe(500);
    expect(game.events.some((e) => e.type === 'oilPour')).toBe(true);
  });

  it('spike traps go on the field only, and cut and slow orcs marching over them', () => {
    const game = shop();
    expect(game.canPlace('spiketrap', 0, -1)).toBe(false);
    expect(game.canPlace('spiketrap', 0, 4)).toBe(false);
    expect(game.canPlace('spiketrap', 0, 40)).toBe(false);
    expect(game.canPlace('spiketrap', 30, 15)).toBe(false);
    expect(game.place('spiketrap', 0, 15)).toBe(true);
    expect(game.canPlace('spiketrap', 1, 15)).toBe(false); // on top of the first
    fight(game);
    const caught = enemy({ x: 0, y: 15.4, hp: 100, maxHp: 100 });
    const free = enemy({ x: 10, y: 15.4, hp: 100, maxHp: 100 });
    game.enemies.push(caught, free);
    run(game, 0.5);
    expect(caught.hp).toBeLessThan(100);
    expect(free.hp).toBe(100);
    expect(15.4 - caught.y).toBeLessThan((15.4 - free.y) * 0.7);
  });

  it('the royal ball bounces off a spike trap, banks, and leaves it standing', () => {
    const game = shop();
    game.place('spiketrap', 0, 15);
    fight(game);
    const b = ball(game, { kind: 'royal', x: 0.2, y: 18, vx: 0, vy: -20 });
    game.events = [];
    run(game, 0.4);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.banked).toBe(true);
    expect(b.combo).toBeGreaterThan(0);
    expect(game.events.some((e) => e.type === 'spikeHit')).toBe(true);
    expect(game.count('spiketrap')).toBe(1);
  });

  it('aiming: mage and ballista turn, oil and traps do not', () => {
    const game = shop();
    towers(game);
    game.place('mage', 4, -1);
    game.place('ballista', -4, -1);
    game.place('oil', 0, -1);
    game.place('spiketrap', 0, 15);
    expect(game.defenders.map((d) => game.aimable(d))).toEqual([true, true, false, false]);
    expect(game.aim(game.defenders[1].id, { x: -2, y: 40 })).toBe(true);
    expect(game.covers(game.defenders[1], -2.5, 40)).toBe(true);
    expect(game.covers(game.defenders[1], -4, 40)).toBe(false);
  });

  it('the town unlocks them in order, and the old four are unchanged', () => {
    expect(applyMeta({}, 0).unlocks.defenders).toEqual(['crossbow', 'soldiers']);
    expect(applyMeta({ archers: 1, soldiers: 1, catapult: 1 }, 0).unlocks.defenders).toEqual(['crossbow', 'soldiers', 'archers', 'catapult']);
    const all = { mage: 1, ballista: 1, oil: 1, spiketrap: 1 };
    expect(applyMeta(all, 0).unlocks.defenders).toEqual(['crossbow', 'soldiers', 'mage', 'ballista', 'oil', 'spiketrap']);
    const p = newProgress();
    p.renown = 1000;
    for (const id of ['mage', 'ballista', 'oil', 'spiketrap']) {
      expect(metaLocked(p.meta, id)).not.toBe('');
      expect(buyMeta(p, id)).toBe(false);
    }
    for (const id of ['archers', 'fletching', 'mage', 'ballista', 'masonry', 'oil', 'soldiers', 'spiketrap']) expect(buyMeta(p, id)).toBe(true);
    const game = new Game(1, applyMeta(p.meta, 0), 0);
    towers(game);
    game.gold = 1000;
    expect(game.place('mage', 4, -1)).toBe(true);
    expect(game.place('crossbow', -4, -1)).toBe(true);
    expect(game.place('catapult', 0, -6)).toBe(false); // not bought
  });
});

describe('war council shaping', () => {
  /** A quiet game in setup with an empty field, contraptions on and a hand-placed layout. */
  function council(layout: Contraption[] = []) {
    const cfg = quiet();
    cfg.obstacles.levels = [[]];
    cfg.contraptions.enabled = true;
    cfg.contraptions.levels = [layout];
    return new Game(1, cfg);
  }
  /** Ends the setup and starts a battle with a dummy enemy so the wave does not end. */
  function fight(game: Game) {
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 0, y: 60, state: 'stand', hp: 1e9 }));
  }

  it('respects per-level limits, bounds and spacing; removing frees a slot', () => {
    const game = council();
    expect(game.shapeLeft('barricade')).toBe(2);
    expect(game.placeTerrain('barricade', -10, 30)).toBe(true);
    expect(game.placeTerrain('barricade', -10, 40)).toBe(false); // same x: would line up
    expect(game.placeTerrain('barricade', 0, 5)).toBe(false); // below minY
    expect(game.placeTerrain('barricade', 19.5, 30)).toBe(false); // off the edge
    expect(game.placeTerrain('barricade', 10, 30, 0.4)).toBe(true);
    expect(game.shapeLeft('barricade')).toBe(0);
    expect(game.placeTerrain('barricade', 0, 30)).toBe(false); // limit
    expect(game.placeTerrain('rubble', -9.5, 30)).toBe(false); // on top of a barricade
    expect(game.placeTerrain('rubble', 0, 30)).toBe(true);
    expect(game.removeTerrain(0)).toBe(true);
    expect(game.removeTerrain(0)).toBe(false);
    expect(game.shapeLeft('barricade')).toBe(1);
    expect(game.placeTerrain('barricade', -10, 30)).toBe(true);
    expect(game.obstacles[0].removed).toBe(true);
    expect(game.obstacles).toHaveLength(4);
    expect(game.removeTerrain(99)).toBe(false);
    expect(game.events.filter((e) => e.type === 'terrainPlaced')).toHaveLength(4);
    fight(game);
    expect(game.placeTerrain('rubble', 5, 30)).toBe(false); // shop shut
    expect(game.shapeLeft('rubble')).toBe(0);
  });

  it('a barricade takes 3 ball hits, then is down; rebuilt after the wave, not if removed', () => {
    const game = council();
    game.placeTerrain('barricade', 0, 30);
    game.placeTerrain('rubble', 10, 30);
    game.removeTerrain(1);
    fight(game);
    for (let i = 0; i < 3; i++) {
      const b = ball(game, { id: 1000 + i, x: 0, y: 28, vx: 0, vy: 20 });
      game.events = [];
      run(game, 0.2);
      expect(b.vy).toBeLessThan(0);
      expect(game.obstacles[0].down === true).toBe(i === 2);
      expect(game.events.some((e) => e.type === 'treeDown')).toBe(i === 2);
      expect(game.events.some((e) => e.type === 'obstacle')).toBe(i < 2);
    }
    game.enemies = [];
    game.events = [];
    run(game, 3);
    expect(game.phase).toBe('preview');
    expect(game.obstacles[0].down).toBe(false);
    expect(game.obstacles[0].hits).toBe(3);
    expect(game.obstacles[1].down).toBe(true);
    expect(game.events.filter((e) => e.type === 'terrainRebuilt')).toHaveLength(1);
  });

  it('moves bumpers and ramps, not bells, and rejects bad spots', () => {
    const game = council([{ kind: 'bumper', x: -8, y: 30 }, { kind: 'bell', x: 12, y: 40, group: 0 }, { kind: 'ramp', x: 8, y: 20, hw: 2, hh: 1.5, angle: 0 }]);
    expect(game.moveContraption(1, 12, 45)).toBe(false); // bell
    expect(game.moveContraption(0, 1, 30)).toBe(false); // road clear
    expect(game.moveContraption(0, -8, 5)).toBe(false);
    expect(game.moveContraption(0, 12, 40)).toBe(false); // on the bell
    expect(game.moveContraption(0, 8, 21)).toBe(false); // on the ramp
    expect(game.canMoveContraption(0, -8, 50)).toBe(true);
    const v = game.shapeVersion;
    expect(game.moveContraption(0, -8, 50)).toBe(true);
    expect(game.shapeVersion).toBeGreaterThan(v);
    expect(game.contraptions[0].y).toBe(50);
    expect(game.moveContraption(2, -14, 20)).toBe(true);
    fight(game);
    // The old spot is empty; the ball bounces at the new one.
    const gone = ball(game, { x: -8, y: 26, vx: 0, vy: 20 });
    run(game, 0.2);
    expect(gone.vy).toBeGreaterThan(0);
    const b = ball(game, { id: 1000, x: -8, y: 46, vx: 0, vy: 20 });
    game.events = [];
    run(game, 0.3);
    expect(b.vy).toBeLessThan(0);
    expect(game.events.some((e) => e.type === 'bumper' && e.index === 0)).toBe(true);
  });

  it('route previews reach the wall, bend round placed barricades, show cover, and stay stable', () => {
    const game = council();
    const first = game.routePreview();
    expect(first.length).toBeGreaterThan(0);
    expect(game.routePreview()).toBe(first); // cached
    expect(first.every((r) => r.pts[r.pts.length - 1].y < 1.5)).toBe(true);
    const foot = first.find((r) => r.kind === 'foot')!;
    const at = foot.pts.find((p) => p.y <= 30)!;
    expect(foot.pts.every((p) => Math.abs(p.x - at.x) < 3)).toBe(true);
    expect(game.placeTerrain('barricade', at.x, at.y - 0.5)).toBe(true);
    const bent = game.routePreview().find((r) => r.kind === 'foot' && r.lane === foot.lane)!;
    expect(bent).not.toBe(foot);
    expect(Math.max(...bent.pts.map((p) => Math.abs(p.x - at.x)))).toBeGreaterThan(1.2);
    expect(bent.pts[bent.pts.length - 1].y).toBeLessThan(1.5);
    // A defender placed over the route shows up as cover.
    expect(bent.pts.every((p) => p.cover.length === 0)).toBe(true);
    const end = bent.pts[bent.pts.length - 1];
    expect(game.place('crossbow', end.x, -3)).toBe(true);
    const id = game.defenders[0].id;
    expect(game.routePreview().find((r) => r.lane === foot.lane && r.kind === 'foot')!.pts.some((p) => p.cover.includes(id))).toBe(true);
    // Pure: the same preview twice, and it never touches the run.
    const a = JSON.stringify(game.routePreview());
    (game as unknown as { routeCache: null }).routeCache = null;
    expect(JSON.stringify(game.routePreview())).toBe(a);
    const x = council();
    x.routePreview();
    const y = council();
    for (const g of [x, y]) { g.endSetup(); g.skipPreview(); run(g, 5); }
    expect(x.enemies.map((e) => [e.x, e.y])).toEqual(y.enemies.map((e) => [e.x, e.y]));
  });

  it('battleReady fires once from endSetup; defenders announce placing and moving', () => {
    const game = council();
    game.gold = 1000;
    game.place('crossbow', -4, -3);
    const id = game.defenders[0].id;
    game.move(id, 4, -3);
    expect(game.events.filter((e) => e.type === 'defenderPlaced')).toEqual([
      { type: 'defenderPlaced', id, kind: 'crossbow', x: -4, y: -3, moved: false },
      { type: 'defenderPlaced', id, kind: 'crossbow', x: 4, y: -3, moved: true },
    ]);
    game.endSetup();
    game.endSetup();
    expect(game.events.filter((e) => e.type === 'battleReady')).toHaveLength(1);
  });
});

describe('town choices', () => {
  const pick = (over: Partial<ReturnType<typeof defaultChoices>>) => ({ ...defaultChoices(), ...over });
  /** A quiet battle with the soldiers' company placed and the choices applied. */
  function withSoldiers(choices: ReturnType<typeof defaultChoices>) {
    const cfg = veteran(quiet());
    const game = new Game(1, cfg, 0, choices);
    game.gold = 5000;
    expect(game.place('soldiers', 1, -1.2)).toBe(true);
    game.endSetup();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 0, y: 60, state: 'stand', hp: 1e9 }));
    return game;
  }
  const priv = (g: Game) => g as unknown as { rebuildGrid(): void; landArrow(p: unknown): void; ballVsOrcs(b: Ball): void; royalHits: number };

  it('sanitizeChoices drops options whose building or upgrade is not owned', () => {
    expect(sanitizeChoices({}, pick({ tactic: 'rainOfArrows' })).tactic).toBeNull();
    expect(sanitizeChoices({ warroom: 1, archers: 1 }, pick({ tactic: 'rainOfArrows' })).tactic).toBe('rainOfArrows');
    expect(sanitizeChoices({ blacksmith: 1, width: 1 }, pick({ shield: 'tower' })).shield).toBe('kite');
    expect(sanitizeChoices({ blacksmith: 1, width: 2 }, pick({ shield: 'tower' })).shield).toBe('tower');
  });

  it('Hold the Gate: wall x1.4, rate x0.8, no early-call gold', () => {
    const base = makeConfig();
    const cfg = applyChoices(base, pick({ tactic: 'holdGate' }));
    expect(cfg.wall.segmentHp).toBe(Math.round(base.wall.segmentHp * 1.4));
    expect(cfg.bonuses.rate).toBeCloseTo(base.bonuses.rate * 0.8);
    expect(cfg.economy.earlyGoldMult).toBe(0);
    const plain = new Game(1, makeConfig());
    const hold = new Game(1, makeConfig(), 0, pick({ tactic: 'holdGate' }));
    for (const g of [plain, hold]) { g.endSetup(); run(g, 1); }
    expect(plain.earlyCallGold()).toBeGreaterThan(0);
    expect(hold.earlyCallGold()).toBe(0);
  });

  it('setChoices works in the setup only and resets the wall to the new strength', () => {
    const game = new Game(1, makeConfig());
    expect(game.setChoices(pick({ tactic: 'holdGate' }))).toBe(true);
    expect(game.choices.tactic).toBe('holdGate');
    expect(game.segmentHp.every((h) => h === Math.round(makeConfig().wall.segmentHp * 1.4))).toBe(true);
    expect(game.events.some((e) => e.type === 'choicesChanged')).toBe(true);
    expect(game.setChoices(pick({}))).toBe(true);
    expect(game.segmentHp.every((h) => h === makeConfig().wall.segmentHp)).toBe(true);
    game.endSetup();
    expect(game.setChoices(pick({ tactic: 'holdGate' }))).toBe(false);
    expect(game.choices.tactic).toBeNull();
  });

  it('the tower shield is 1.35x the kite', () => {
    const kite = new Game(1, makeConfig());
    const tower = new Game(1, makeConfig(), 0, pick({ shield: 'tower' }));
    expect(tower.shieldHalfWidth()).toBeCloseTo(kite.shieldHalfWidth() * 1.35);
  });

  it('Pin: an arrow landing on a block member halts the block for a second', () => {
    const game = battle(1, applyChoices(quiet(), pick({ archers: 'pin' })));
    const block = { id: 1, x: 0, y: 30, shape: 'rect' as const, members: [] as Enemy[], start: 1, spacing: 1, speed: 2, homeX: 0, zig: false, phase: 0, dirty: false, regroupAt: 99, drummed: false, haltUntil: 0 };
    const e = enemy({ x: 0, y: 30, block, hp: 100, maxHp: 100 });
    block.members.push(e);
    game.enemies.push(e);
    game.blocks.push(block);
    priv(game).rebuildGrid();
    priv(game).landArrow({ x: 0, y: 30, damage: 1, burn: 0 });
    expect(e.pinned).toBe(2);
    run(game, 0.5);
    expect(block.y).toBe(30);
    run(game, 1);
    expect(block.y).toBeLessThan(30);
  });

  it('Repair: idle soldiers mend a damaged wall section; on Hold they do not', () => {
    const mend = (soldiers: 'hold' | 'repair') => {
      const game = withSoldiers(pick({ soldiers }));
      const seg = game.segmentAt(game.soldiers[0].postX);
      game.segmentHp[seg] = 100;
      run(game, 3);
      return game.segmentHp[seg];
    };
    expect(mend('repair')).toBeGreaterThan(100);
    expect(mend('hold')).toBe(100);
  });

  it('Sally Forth: soldiers muster up the field', () => {
    const game = withSoldiers(pick({ tactic: 'sallyForth' }));
    expect(game.soldiers.length).toBeGreaterThan(0);
    for (const s of game.soldiers) expect(s.y).toBeGreaterThanOrEqual(10);
    for (const s of game.soldiers) expect(s.y).toBeLessThan(11.5);
  });

  it('Powder Ball: a miss hits the wall for 25 and the 4th hit blows up the neighbours', () => {
    const game = battle(1, applyChoices(quiet(), pick({ ball: 'powder' })));
    const seg = game.segmentAt(15);
    const before = game.segmentHp[seg];
    ball(game, { kind: 'royal', x: 15, y: 0.1, vy: -20 });
    run(game, 0.1);
    expect(before - game.segmentHp[seg]).toBe(25);
    const hit = enemy({ x: 0, y: 30, state: 'stand' });
    const near = enemy({ x: 1.5, y: 30, state: 'stand', hp: 500, maxHp: 500 });
    game.enemies.push(hit, near);
    priv(game).rebuildGrid();
    priv(game).royalHits = 3;
    game.events.length = 0;
    priv(game).ballVsOrcs(ball(game, { kind: 'royal', x: 0, y: 30, vy: 20 }));
    expect(game.events.some((e) => e.type === 'powderBlast')).toBe(true);
    expect(near.hp).toBeLessThanOrEqual(500 - 25 * game.cfg.bonuses.damage);
  });

  it('scoutReport lists the the waves and bosses of a level', () => {
    const cfg = makeConfig();
    const l0 = new Game(1, cfg).scoutReport();
    expect(l0).toHaveLength(cfg.levels.waves);
    expect(l0[0].wave).toBe(1);
    expect(l0[0].enemies.grunt).toBeGreaterThan(0);
    const l2 = new Game(1, cfg, 2).scoutReport();
    expect(l2[l2.length - 1].boss).toBe('warlord');
  });
});

describe('town plot', () => {
  const at = (id: Placed['id'], x: number, y: number, rot: Placed['rot'] = 0): Placed => ({ id, x, y, rot });
  const key = (cells: [number, number][]) => {
    const mx = Math.min(...cells.map((c) => c[0]));
    const my = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => `${x - mx},${y - my}`).sort().join(' ');
  };
  const all = Object.fromEntries(PIECE_IDS.map((id) => [id, 1]));

  it('keeps every piece whole when rotated, and never mirrors it', () => {
    for (const id of PIECE_IDS) {
      for (const rot of [0, 1, 2, 3] as const) expect(pieceCells(at(id, 0, 0, rot))).toHaveLength(PIECES[id].cells.length);
    }
    for (const id of ['soldiers', 'masonry', 'blacksmith', 'spiketrap', 'alchemist', 'guild'] as const) {
      const turns = new Set([0, 1, 2, 3].map((rot) => key(pieceCells(at(id, 0, 0, rot as Placed['rot'])))));
      const mirrored = key(PIECES[id].cells.map(([x, y]) => [-x, y] as [number, number]));
      expect(turns.has(mirrored)).toBe(false);
    }
    // Rotated shapes sit with their top-left corner on the anchor.
    const bar = pieceCells(at('archers', 2, 1, 1));
    expect(bar).toEqual([[2, 1], [2, 2], [2, 3], [2, 4]]);
  });

  it('rejects overlaps with the keep and other pieces, and anything off the open land', () => {
    expect(canPlace([], at('archers', 5, 1), 3)).toBe(false); // runs into the keep
    expect(canPlace([], at('archers', 9, 0), 3)).toBe(true);
    expect(canPlace([at('drill', 0, 0)], at('oil', 1, 1), 3)).toBe(false);
    expect(canPlace([at('drill', 0, 0)], at('oil', 2, 1), 3)).toBe(true);
    // The same piece never blocks itself.
    expect(canPlace([at('drill', 0, 0)], at('drill', 1, 0), 3)).toBe(true);
    expect(canPlace([], at('oil', 2, 3), 0)).toBe(false);
    expect(canPlace([], at('oil', 3, 3), 0)).toBe(true);
    expect(canPlace([], at('oil', 3, 5), 0)).toBe(false);
    expect(canPlace([], at('oil', 3, 5), 2)).toBe(true);
    expect(canPlace([], at('oil', 13, 0), 3)).toBe(true);
    expect(canPlace([], at('oil', 14, 0), 3)).toBe(false);
  });

  it('counts neighbours by shared edge only, and each pair once', () => {
    const touching: Layout = [at('archers', 0, 3), at('fletching', 0, 4)];
    const pairs = activePairs(touching);
    expect(pairs.map((p) => p.id)).toEqual(['fletchingArchers']);
    expect(pairs[0].edges).toHaveLength(2);
    expect(activePairs([at('archers', 0, 3), at('fletching', 4, 4)])).toEqual([]); // diagonal only
    // The keep is a neighbour too.
    expect(activePairs([at('masonry', 5, 0)]).map((p) => p.id)).toEqual(['masonryKeep']);
  });

  it('applies bonuses and clashes only for placed, touching buildings', () => {
    const meta = { archers: 1, fletching: 1 };
    const base = applyMeta(meta, 0);
    expect(applyMeta(meta, 0, undefined, [at('archers', 0, 3), at('fletching', 0, 4)]).archers.damage).toBeCloseTo(base.archers.damage * 1.15);
    expect(applyMeta(meta, 0, undefined, [at('archers', 0, 3), at('fletching', 4, 4)]).archers.damage).toBeCloseTo(base.archers.damage);
    const m2 = { alchemist: 1, treasury: 1 };
    const chest = applyMeta(m2, 0).economy.warChest;
    expect(applyMeta(m2, 0, undefined, [at('alchemist', 0, 3), at('treasury', 2, 3)]).economy.warChest).toBe(chest - 30);
    expect(applyMeta(m2, 0, undefined, [at('alchemist', 0, 3), at('treasury', 3, 3)]).economy.warChest).toBe(chest);
  });

  it('gives a building waiting in the yard no effect', () => {
    const meta = { treasury: 2, tavern: 1 };
    const chest = applyMeta({}, 0).economy.warChest;
    const cfg = applyMeta(meta, 0, undefined, []);
    expect(cfg.economy.warChest).toBe(chest);
    expect(cfg.unlocks.buildings).not.toContain('tavern');
    expect(yard(meta, [])).toEqual(['tavern', 'treasury']);
    expect(effectiveMeta(meta, [at('treasury', 0, 0)])).toEqual({ treasury: 2, tavern: 0 });
    expect(applyMeta(meta, 0, undefined, [at('treasury', 0, 0)]).economy.warChest).toBe(chest + 120);
  });

  it('sanitizePlot drops junk, unowned, duplicate, off-land and overlapping entries', () => {
    const meta = { archers: 1, oil: 1, drill: 1 };
    expect(sanitizePlot(meta, 'junk')).toEqual([]);
    expect(sanitizePlot(meta, null)).toEqual([]);
    const messy = [
      null, 7, { id: 'bogus', x: 3, y: 0, rot: 0 }, { id: 'archers', x: 'a', y: 0, rot: 0 }, { id: 'archers', x: 3, y: 0, rot: 9 },
      at('forge', 3, 0), // not owned
      at('archers', 3, 3),
      at('archers', 3, 2), // duplicate
      at('oil', 4, 3), // overlaps archers
      at('drill', 0, 0), // off the starting land
      at('oil', 3, 1),
    ];
    expect(sanitizePlot(meta, messy)).toEqual([at('archers', 3, 3), at('oil', 3, 1)]);
    expect(sanitizePlot({ ...meta, land: 3 }, messy)).toContainEqual(at('drill', 0, 0));
  });

  it('auto-packs the whole town at full land and the early buildings on the starting land', () => {
    const full = autoPack({ ...all, land: 3 });
    expect(full.land).toBe(3);
    expect(full.layout).toHaveLength(20);
    for (const p of full.layout) expect(canPlace(full.layout, p, 3)).toBe(true);
    const early = Object.fromEntries(['archers', 'soldiers', 'watchtower', 'warroom', 'treasury', 'masonry', 'fletching', 'tavern'].map((id) => [id, 1]));
    const small = autoPack(early);
    expect(small.land).toBe(0);
    expect(small.layout).toHaveLength(8);
    for (const p of small.layout) expect(canPlace(small.layout, p, 0)).toBe(true);
    // Existing placements are kept, and a growing town asks for more land only when it must.
    const again = autoPack({ ...early, oil: 1 }, small.layout);
    for (const p of small.layout) expect(again.layout).toContainEqual(p);
  });
});

describe('town plot packing', () => {
  it('keeps clashing neighbours apart when it packs a whole town', () => {
    const meta: Record<string, number> = { land: 3 };
    for (const id of PIECE_IDS) meta[id] = 1;
    const { layout } = autoPack(meta);
    expect(layout).toHaveLength(PIECE_IDS.length);
    expect(activePairs(layout).filter((p) => p.kind === 'clash')).toEqual([]);
  });
});

describe('royal ball speed (31 Oct)', () => {
  it('the Royal Ball comes off the shield twice as fast as before, past the common cap', () => {
    const game = battle();
    const b = ball(game, { kind: 'royal', x: 0, y: 6, vy: -30 });
    run(game, 0.15);
    const sp = Math.hypot(b.vx, b.vy);
    expect(b.vy).toBeGreaterThan(0);
    expect(sp).toBeGreaterThanOrEqual(game.cfg.balls.royalSpeed - 1e-6);
    expect(sp).toBeGreaterThan(game.cfg.balls.maxSpeed);
    expect(sp).toBeLessThanOrEqual(game.cfg.balls.royalMaxSpeed + 1e-6);
  });

  it('other balls keep the common top speed', () => {
    const game = battle();
    const b = ball(game, { x: 0, y: 6, vy: -50 });
    run(game, 0.15);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(game.cfg.balls.maxSpeed + 1e-6);
  });
});

describe('shield teams and the armoured warlord (31 Oct)', () => {
  function teamGame(count: number, cfg = quiet()) {
    const game = battle(1, cfg);
    game.plan.groups = [{ time: 0, lane: 2, x: 0, shape: 'line', members: [{ kind: 'shieldOrc', count }] }];
    game.step();
    bringDown(game);
    return game;
  }

  /** Moves the blocks that just came on down into the ball's reach. */
  function bringDown(game: Game, y = 20) {
    for (const b of game.blocks) {
      b.y += y - game.cfg.field.spawnY;
      for (const e of b.members) {
        e.x = b.x + e.slotX;
        e.y = b.y + e.slotY;
      }
    }
  }

  /** Fires a ball straight at an orc from the wall side and lets it bounce off. */
  function shoot(game: Game, e: Enemy, over: Partial<Ball> = {}): Ball {
    game.balls = [];
    const b = ball(game, { x: e.x, y: e.y - game.cfg[e.kind].radius - 0.6, vx: 0, vy: 20, ...over });
    run(game, 0.05);
    return b;
  }

  it("a block's shield orcs share big shields, in even teams of 3 (5 later on)", () => {
    const three = teamGame(3).enemies.filter((e) => e.kind === 'shieldOrc');
    expect(three).toHaveLength(3);
    expect(three.every((e) => e.shielded && e.team === three[0].team)).toBe(true);
    const four = teamGame(4).enemies.filter((e) => e.kind === 'shieldOrc');
    expect(new Set(four.map((e) => e.team)).size).toBe(2);
    const cfg = quiet();
    cfg.shieldTeam.bigFromWave = 1;
    const five = teamGame(5, cfg).enemies.filter((e) => e.kind === 'shieldOrc');
    expect(new Set(five.map((e) => e.team)).size).toBe(1);
  });

  it('front hits crack the shield without hurting anyone, and the fifth splinters it', () => {
    const game = teamGame(3);
    const team = game.enemies.filter((e) => e.kind === 'shieldOrc');
    const mid = team.sort((p, q) => p.x - q.x)[1];
    for (let i = 1; i <= 4; i++) {
      const b = shoot(game, mid);
      expect(b.vy).toBeLessThan(0);
      expect(mid.team!.hits).toBe(i);
      expect(game.events.some((ev) => ev.type === 'clang' && ev.cracked === i / 5)).toBe(true);
    }
    expect(team.every((e) => e.hp === e.maxHp && e.shielded)).toBe(true);
    const b = shoot(game, mid);
    expect(mid.team!.broken).toBe(true);
    expect(team.every((e) => !e.shielded)).toBe(true);
    expect(b.combo).toBe(game.cfg.shieldTeam.breakCombo);
    expect(game.events.some((ev) => ev.type === 'shieldBreak')).toBe(true);
    // Now they're plain bricks.
    shoot(game, mid);
    expect(mid.hp).toBeLessThan(mid.maxHp);
  });

  it("two heaves break it, and a heave doesn't go through", () => {
    const game = teamGame(3);
    const mid = game.enemies.filter((e) => e.kind === 'shieldOrc').sort((p, q) => p.x - q.x)[1];
    const b = shoot(game, mid, { lines: 1, heaved: true });
    expect(b.lines).toBe(0);
    expect(b.vy).toBeLessThan(0);
    expect(mid.team!.broken).toBe(false);
    shoot(game, mid, { lines: 1, heaved: true });
    expect(mid.team!.broken).toBe(true);
  });

  it('a carrier knocked flat by a falling ogre has its shield down', () => {
    const game = teamGame(3);
    const mid = game.enemies.filter((e) => e.kind === 'shieldOrc').sort((p, q) => p.x - q.x)[1];
    mid.stagger = 2;
    shoot(game, mid);
    expect(mid.hp).toBeLessThan(mid.maxHp);
    expect(mid.team!.hits).toBe(0);
  });

  function lordGame() {
    const game = battle();
    game.plan.groups = [{ time: 0, lane: 2, x: 0, shape: 'rect', members: [{ kind: 'warlord', count: 1 }] }];
    game.step();
    bringDown(game, 30);
    const lord = game.enemies.find((e) => e.kind === 'warlord')!;
    return { game, lord };
  }

  it('comes with 14 plates and an honour guard of two shield teams', () => {
    const { game, lord } = lordGame();
    expect(lord.armour!.plates).toEqual(new Array(14).fill(3));
    const guard = game.enemies.filter((e) => e.kind === 'shieldOrc');
    expect(guard).toHaveLength(6);
    expect(new Set(guard.map((e) => e.team)).size).toBe(2);
    expect(guard.every((e) => e.y < lord.y)).toBe(true);
  });

  it('only a bare column lets a ball through to his core, for its damage times the combo multiplier', () => {
    const { game, lord } = lordGame();
    game.enemies = game.enemies.filter((e) => e === lord || e.hp > 1e6);
    const a = lord.armour!;
    a.clubAt = Infinity;
    const col = game.armourColumn(lord, lord.x);
    for (let i = 0; i < 6; i++) {
      shoot(game, lord);
      expect(lord.hp).toBe(lord.maxHp);
    }
    expect(a.plates[col]).toBe(0);
    expect(a.plates[a.cols + col]).toBe(0);
    expect(a.plates.filter((p) => p === 3)).toHaveLength(12);
    shoot(game, lord, { combo: 10 });
    // 10 damage at 2x for a combo of 10 (11 after this hit counts, but the multiplier is read before it lands).
    expect(lord.maxHp - lord.hp).toBeCloseTo(game.cfg.balls.damage * (1 + 11 * game.cfg.balls.comboStep), 5);
  });

  it('a heave knocks a plate clean off, and it lands in front of him as a bumper', () => {
    const { game, lord } = lordGame();
    game.enemies = game.enemies.filter((e) => e === lord || e.hp > 1e6);
    lord.armour!.clubAt = Infinity;
    shoot(game, lord, { lines: 1, heaved: true });
    expect(lord.armour!.plates.filter((p) => p === 0)).toHaveLength(1);
    expect(game.debris).toHaveLength(1);
    const d = game.debris[0];
    expect(d.y).toBeLessThan(lord.y);
    game.balls = [];
    const b = ball(game, { x: d.x, y: d.y - d.r - 0.6, vx: 0, vy: 20 });
    run(game, 0.05);
    expect(b.vy).toBeLessThan(0);
    expect(b.banked).toBe(true);
    // It crumbles after a while.
    run(game, game.cfg.warlord.debrisSeconds);
    expect(game.debris).toHaveLength(0);
  });

  it('his club bats one ball back every 4 s, not every ball', () => {
    const { game, lord } = lordGame();
    game.enemies = game.enemies.filter((e) => e === lord || e.hp > 1e6);
    lord.armour!.clubAt = 0;
    shoot(game, lord);
    expect(game.events.filter((ev) => ev.type === 'club')).toHaveLength(1);
    expect(lord.armour!.clubAt).toBeCloseTo(game.time + game.cfg.warlord.clubSeconds, 0);
    game.events.length = 0;
    shoot(game, lord);
    expect(game.events.some((ev) => ev.type === 'club')).toBe(false);
  });

  it('plates soak other damage; at half health he roars, and then his back takes double', () => {
    const { game, lord } = lordGame();
    game.enemies = game.enemies.filter((e) => e === lord || e.hp > 1e6);
    const a = lord.armour!;
    a.clubAt = Infinity;
    lord.hp -= 100;
    game.step();
    expect(lord.maxHp - lord.hp).toBeCloseTo(100 * (1 - game.cfg.warlord.plateCover), 5);
    a.plates.fill(0);
    lord.hp = lord.maxHp * 0.49;
    game.step();
    expect(a.roared).toBe(true);
    const before = lord.hp;
    game.balls = [];
    ball(game, { x: lord.x, y: lord.y + game.cfg.warlord.radius + 0.6, vx: 0, vy: -20 });
    run(game, 0.05);
    expect(before - lord.hp).toBeCloseTo(game.cfg.balls.damage * game.cfg.warlord.backMult * (1 + game.cfg.balls.comboStep), 5);
  });
});
