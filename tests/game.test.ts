import { describe, expect, it } from 'vitest';
import { averageBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { type Ball, type Enemy, Game, type Projectile } from '../src/sim/game';
import { META_UPGRADES, applyMeta, buyMeta, metaCost, metaDepth, metaLocked, newProgress } from '../src/sim/meta';
import { type Contraption, footprint } from '../src/sim/contraptions';
import { LEVEL_OBSTACLES, contact } from '../src/sim/obstacles';
import { Tutorial } from '../src/sim/tutorial';
import { formation, planSize, planWave, waveBudget } from '../src/sim/waves';

function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) game.step();
}

function enemy(over: Partial<Enemy>): Enemy {
  return {
    kind: 'grunt', x: 0, y: 10, vx: 0, vy: 0, hp: 10, maxHp: 10, state: 'march', standY: 25, timer: 99, phase: 0,
    burn: 0, burnTime: 0, rally: 1, foe: null, block: null, slotX: 0, slotY: 0, goldMult: 1, lastBall: -1, stagger: 0, blasted: false, shielded: false,
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
    expect(w1.totals).toMatchObject({ grunt: 45, chucker: 5, rider: 0, orcCatapult: 3 });
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
    expect(planWave(1, 1, cfg).totals.orcCatapult).toBe(3);
    expect(planWave(15, 1, cfg).totals.orcCatapult).toBe(9);
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
    // Lost past the shield: 10 wall damage, then re-served after 3 s.
    royal.x = 15;
    royal.y = 2;
    royal.vy = -20;
    royal.vx = 0;
    run(game, 0.2);
    expect(game.balls.some((b) => b.primary)).toBe(false);
    expect(game.wallDamage['missed royal']).toBe(10);
    run(game, 3);
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
    const mb = ball(m, { x: -6, y: 5.2, vx: 6, vy: -18 });
    run(m, 0.05);
    expect(mb.vy).toBeGreaterThan(0);
    expect(mb.vx / mb.vy).toBeCloseTo(6 / 18, 1);
    // A trick shot off the edge starts its combo at 1.
    // Clear of the tower turrets, which would bank it.
    const g = battle();
    g.setShield(-6);
    run(g, 0.2);
    const b = ball(g, { x: -6 + g.shieldHalfWidth() * 0.97, y: 4.9 });
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
    const b = ball(game, { x: -7, y: 4.9, vx: 0, vy: -20 });
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
    const block = { id: 1, x: 0, y: 20, shape: 'line' as const, members: [] as Enemy[], start: 8, spacing: 1, speed: 0, homeX: 0, zig: false, phase: 0, dirty: false, regroupAt: 99, drummed: false };
    for (let i = 0; i < 8; i++) {
      const e = enemy({ x: -3.5 + i, y: 20, block, slotX: -3.5 + i, slotY: 0, hp: 20, maxHp: 20 });
      block.members.push(e);
      game.enemies.push(e);
    }
    // Another row behind it stays standing.
    const back = enemy({ x: 0.5, y: 25, hp: 20, maxHp: 20, state: 'stand' });
    game.enemies.push(back);
    game.blocks.push(block);
    const b = ball(game, { x: 0, y: 4.9, vy: -20 });
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
    const b = ball(game, { x: 0, y: 4.9, vy: -20 });
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
    const b = ball(game, { x: 0, y: 4.9, vy: -20 });
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
    const e = ball(early, { x: 0, y: 4.9, vy: -20 });
    run(early, 0.05);
    expect(e.perfect).toBe(false);
    expect(early.perfects).toBe(0);
    const late = battle();
    const l = ball(late, { x: 0, y: 4.9, vy: -20 });
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
    ball(game, { id: 1, x: -2, y: 4.9, vy: -20 });
    ball(game, { id: 2, x: 2, y: 4.9, vy: -20 });
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
      const b = ball(game, { x: 0, y: 4.9, vy: -20 });
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
    const b = ball(game, { x: 0, y: 4.9, vy: -20 });
    run(game, 0.05);
    expect(b.perfect).toBe(true);
    // Back down onto the shield with no press in the window.
    game.shield.heaveAt = -99;
    b.x = 0;
    b.y = 4.9;
    b.vx = 0;
    b.vy = -20;
    run(game, 0.05);
    expect(b.perfect).toBe(false);
    expect(game.perfects).toBe(1);
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
    game.capsules.push({ kind: 'grog', x: 0, y: 5 });
    run(game, 0.3);
    expect(game.balls).toHaveLength(3);
    const w = game.shieldHalfWidth();
    game.capsules.push({ kind: 'banner', x: 0, y: 5 });
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
    expect(first.place('soldiers', -4, -1)).toBe(false);
    expect(first.place('crossbow', -4, -1)).toBe(true);
    const later = new Game(1, applyMeta({ archers: 1 }, 0));
    later.gold = 1000;
    expect(later.place('archers', -4, -1)).toBe(true);
    expect(later.place('soldiers', 8, -1)).toBe(false);
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
    expect(metaDepth('doctrine')).toBeGreaterThan(metaDepth('drill'));
    // A capstone needs every branch leading to it.
    for (let i = 0; i < 2; i++) buyMeta(p, 'fletching');
    expect(buyMeta(p, 'doctrine')).toBe(false);
    for (let i = 0; i < 2; i++) buyMeta(p, 'drill');
    expect(buyMeta(p, 'doctrine')).toBe(true);
    const plain = applyMeta({}, 0);
    const cfg = applyMeta(p.meta, 0);
    expect(cfg.callToArms.rate).toBe(plain.callToArms.rate + 0.5);
    expect(cfg.callToArms.cooldown).toBe(plain.callToArms.cooldown - 10);
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

  it('builds towers on the wall and stacks them; each storey adds 25% reach', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 2000;
    game.place('archers', 0, -1); // the wall walk, between towers
    const squad = game.defenders[0];
    expect(game.rangeMult(squad)).toBe(1);
    expect(game.storeyCost()).toBe(50);
    expect(game.buildTower(0, -1)).toBe(true); // a new tower, under the squad
    expect(squad.ground).toBe('tower');
    expect(game.rangeMult(squad)).toBeCloseTo(1.25);
    expect(game.storeyCost()).toBe(65);
    expect(game.buildTower(0.5, -1)).toBe(true); // stacks on the same tower
    expect(game.rangeMult(squad)).toBeCloseTo(1.5);
    expect(game.buildTower(0, -1)).toBe(true);
    expect(game.towerPlan(0, -1)).toEqual({ ok: false, why: 'As tall as it goes' });
    expect(game.towerPlan(2, -1).ok).toBe(false); // too close to it and the joint's tower
    expect(game.towerPlan(10, -6).ok).toBe(false); // the courtyard
    expect(game.buildTower(-12, -1)).toBe(true); // a joint's tower goes up to two storeys
    expect(game.stacks.find((t) => t.x === -12)!.storeys).toBe(2);
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
    expect(cat.y).toBeLessThan(47);
    expect(cat.y).toBeGreaterThan(44);
  });

  it('the call to arms doubles every defender\'s rate of fire for a while, then rests', () => {
    const game = battle();
    expect(game.mult('crossbow', 'rate')).toBe(1);
    expect(game.callToArms()).toBe(true);
    expect(game.mult('crossbow', 'rate')).toBe(2);
    expect(game.callToArms()).toBe(false);
    run(game, game.cfg.callToArms.seconds + 0.1);
    expect(game.mult('crossbow', 'rate')).toBe(1);
    expect(game.canCallToArms).toBe(false);
    run(game, game.cfg.callToArms.cooldown);
    expect(game.canCallToArms).toBe(true);
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

  it('lays out cleanly: no overlaps, inside the field, off the road', () => {
    for (const level of [0, 1, 2]) {
      const game = new Game(3, applyMeta({}, level), level);
      const k = game.cfg.contraptions;
      const hw = game.cfg.field.halfWidth;
      const bound = (o: { r?: number; hw?: number; hh?: number }) => o.r ?? Math.hypot(o.hw ?? 1, o.hh ?? 1);
      const shapes = k.levels[level].map((c) => footprint(c, k));
      const solid = LEVEL_OBSTACLES[level];
      expect(game.contraptions.length).toBe(shapes.length);
      shapes.forEach((a, i) => {
        expect(Math.abs(a.x) + bound(a)).toBeLessThanOrEqual(hw);
        expect(a.y).toBeGreaterThanOrEqual(15);
        expect(a.y).toBeLessThanOrEqual(55);
        expect(a.y).toBeLessThan(game.cfg.field.topY);
        expect(Math.abs(a.x)).toBeGreaterThanOrEqual(6);
        if (level > 0) expect(Math.abs(a.x) - bound(a)).toBeGreaterThan(0);
        shapes.slice(i + 1).forEach((o) => expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThan(bound(a) + bound(o)));
        solid.forEach((o) => expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThan(bound(a) + bound(o)));
      });
      // Trees keep clear of every fixture.
      for (const seed of [1, 2, 3, 4, 5]) {
        const g = new Game(seed, applyMeta({}, level), level);
        for (const t of g.obstacles.filter((o) => o.look === 'tree')) {
          for (const a of shapes) expect(Math.hypot(a.x - t.x, a.y - t.y)).toBeGreaterThan(bound(a) + (t.r ?? 0));
        }
      }
    }
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
