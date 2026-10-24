import { describe, expect, it } from 'vitest';
import { averageBot, expertBot } from '../src/sim/bot';
import { makeConfig } from '../src/sim/config';
import { type Ball, type Enemy, Game, type Projectile } from '../src/sim/game';
import { formation, planSize, planWave, waveBudget } from '../src/sim/waves';

function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) game.step();
}

function enemy(over: Partial<Enemy>): Enemy {
  return {
    kind: 'grunt', x: 0, y: 10, vx: 0, vy: 0, hp: 10, maxHp: 10, state: 'march', standY: 25, timer: 99, phase: 0,
    burn: 0, burnTime: 0, rally: 1, foe: null, block: null, slotX: 0, slotY: 0, goldMult: 1, lastBall: -1, stagger: 0, blasted: false,
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
});

/** Every defender for sale, as in a later run. */
const veteran = (cfg = makeConfig()) => {
  cfg.unlocks.defenders = ['crossbow', 'archers', 'catapult', 'soldiers'];
  return cfg;
};

/** A game in battle with an empty field: no blocks coming and the Royal Ball put away. */
function battle(seed = 1, cfg = quiet()) {
  const game = new Game(seed, cfg);
  game.closeCouncil();
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
    id: 999, kind: 'claimed', x: 0, y: 10, vx: 0, vy: -20, primary: false, power: 1, combo: 0, behind: false, heaved: false,
    stuck: false, stuckOffset: 0, stuckAt: 0, hitShieldAt: -99, born: 0, passing: null, lines: 0, milestone: 0, banked: false, ...over,
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
    expect(w1.totals).toMatchObject({ grunt: 20, chucker: 0, rider: 0, orcCatapult: 2 });
    expect(w1.groups).toHaveLength(2);
    expect(Math.round(waveBudget(10, cfg))).toBe(82);
    const blocks = (n: number) => planWave(n, 1, cfg).groups.filter((g) => g.members.some((m) => m.kind === 'grunt')).length;
    expect(blocks(25)).toBe(6);
    for (const n of [5, 12, 19]) {
      const t = planWave(n, 2, cfg).totals;
      const threat = (t.grunt + t.barrel) * 1 + t.chucker * 2 + t.rider * 2 + t.ogre * 12;
      expect(threat).toBeCloseTo(Math.round(waveBudget(n, cfg)), 0);
    }
  });

  it('brings catapults every wave, barrels from wave 5 and bosses on 10, 20 and 25', () => {
    const cfg = makeConfig();
    expect(planWave(1, 1, cfg).totals.orcCatapult).toBe(2);
    expect(planWave(25, 1, cfg).totals.orcCatapult).toBe(9);
    expect(planWave(4, 1, cfg).totals.barrel).toBe(0);
    expect(planWave(5, 1, cfg).totals.barrel).toBe(2);
    expect(planWave(10, 1, cfg).tower).toBe(true);
    expect(planWave(20, 1, cfg).totals.warlord).toBe(1);
    expect(planWave(20, 1, cfg).tower).toBe(false);
    expect(planWave(25, 1, cfg)).toMatchObject({ tower: true, totals: { warlord: 1 } });
  });

  it('formations put the front rank first', () => {
    const slots = formation('wedge', 9, 1);
    expect(slots[0]).toEqual({ dx: 0, dy: 0 });
    expect(slots.filter((s) => s.dy === 0)).toHaveLength(1);
    expect(formation('rect', 20, 1).every((s) => s.dy >= 0)).toBe(true);
  });

  it('spawns exactly the previewed enemies', () => {
    const game = new Game(3, quiet());
    game.closeCouncil();
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
    game.setShield(100);
    run(game, 0.5);
    expect(game.shield.x).toBeCloseTo(game.cfg.field.halfWidth - game.shieldHalfWidth(), 5);
  });

  it('serves the Royal Ball from the shield at the start of a wave, and again after it is lost', () => {
    const game = new Game(1, quiet());
    game.closeCouncil();
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

  it('angle control: the centre goes straight up, edges go wide, the edge zone is a trick shot', () => {
    const game = new Game(1);
    expect(game.bounceAngle(0)).toBe(0);
    expect(Math.abs(game.bounceAngle(0.2))).toBeCloseTo(0.1745);
    expect(game.bounceAngle(0.8)).toBeCloseTo(0.96);
    expect(game.bounceAngle(-0.8)).toBeCloseTo(-0.96);
    expect(game.bounceAngle(1)).toBeCloseTo(1.309);
    expect(game.bounceAngle(0.95)).toBeGreaterThan(1.134);
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

  it('balls bounce off the tree lines and the top edge, and pay double behind the lines', () => {
    const game = battle();
    const b = ball(game, { x: 18, y: 66, vx: 20, vy: 20 });
    run(game, 0.15);
    expect(b.vx).toBeLessThan(0);
    expect(b.vy).toBeLessThan(0);
    expect(b.behind).toBe(true);
    expect(game.ballGoldMult(b)).toBe(2);
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
    const block = { id: 1, x: 0, y: 20, shape: 'line' as const, members: [] as Enemy[], start: 8, spacing: 1, speed: 0, homeX: 0, zig: false, phase: 0, dirty: false, regroupAt: 99 };
    for (let i = 0; i < 8; i++) {
      const e = enemy({ x: -3.5 + i, y: 20, block, slotX: -3.5 + i, slotY: 0, hp: 20, maxHp: 20 });
      block.members.push(e);
      game.enemies.push(e);
    }
    // Another row behind it stays standing.
    const back = enemy({ x: 0.5, y: 22, hp: 20, maxHp: 20, state: 'stand' });
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
    expect(back.hp).toBeGreaterThan(0);
    // The shield needs a moment to recover.
    expect(game.canHeave).toBe(true);
  });

  it('a heave too early is just a normal hit, and the shield needs 1 s to recover', () => {
    const game = battle();
    expect(game.heave()).toBe(true);
    expect(game.canHeave).toBe(false);
    run(game, 0.5);
    const b = ball(game, { x: 0, y: 4.9, vy: -20 });
    run(game, 0.05);
    expect(b.heaved).toBe(false);
    run(game, 0.6);
    expect(game.canHeave).toBe(true);
  });

  it('bank shots: tower turrets bounce balls back up for +2 combo', () => {
    const game = battle();
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
    const g = new Game(1, veteran());
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
    game.capsules.push({ kind: 'tea', x: 18, y: 5 });
    run(game, 2);
    expect(game.capsules).toHaveLength(0);
    expect(game.effects.tea).toBe(0);
  });

  it('the siege tower is chipped apart floor by floor, tipping out orcs', () => {
    const game = new Game(1, makeConfig({ ...quiet(), waves: { ...quiet().waves, towerWaves: [1] } }));
    game.closeCouncil();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    const tw = game.tower!;
    expect(tw.floors).toHaveLength(5);
    for (let i = 0; i < 12; i++) ball(game, { id: 100 + i, x: -4.5 + (i % 6) * 1.67, y: tw.y - 1.5, vy: 20 });
    run(game, 0.1);
    expect(game.tower!.floors).toHaveLength(4);
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
    game.closeCouncil();
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
    // Orcs from behind step up into the gaps in the front rank.
    expect(block.members.filter((e) => e.slotY === front)).toHaveLength(rank.length);
  });

  it('slap spends Vigor, damages and knocks back enemies under the cursor', () => {
    const game = battle();
    game.enemies.push(enemy({ x: 0.5, y: 2 }), enemy({ x: 10, y: 2 }));
    expect(game.slap(0, 2)).toBe(true);
    expect(game.vigor).toBe(game.cfg.slap.vigorMax - game.cfg.slap.vigorCost);
    expect(game.enemies[1].hp).toBe(10 - game.cfg.slap.damage);
    expect(game.enemies[1].vy).toBeGreaterThan(0);
    expect(game.enemies[2].hp).toBe(10);
  });

  it('wins after the final wave', () => {
    const cfg = quiet();
    cfg.waves.finalWave = 1;
    const game = new Game(1, cfg);
    const bot = expertBot();
    for (let i = 0; i < 60 * 300 && !game.over; i++) {
      bot(game);
      game.step();
    }
    expect(game.phase).toBe('won');
    expect(game.wavesSurvived).toBe(1);
  });
});

describe('run loop', () => {
  it('opens with a War Council and stays paused until it closes', () => {
    const game = new Game(1);
    expect(game.phase).toBe('council');
    expect(game.gold).toBe(game.cfg.economy.startGold);
    run(game, 5);
    expect(game.time).toBe(0);
    game.closeCouncil();
    expect(game.phase).toBe('preview');
  });

  it('run 1 sells the crossbow only; later runs place defenders anywhere on the castle grounds', () => {
    const first = new Game(1);
    expect(first.defenders).toHaveLength(0);
    first.gold = 1000;
    expect(first.place('archers', 0, -6)).toBe(false);
    expect(first.buySoldiers()).toBe(false);
    expect(first.place('crossbow', -4, -1)).toBe(true);

    const game = new Game(1, veteran());
    game.gold = 149;
    expect(game.place('catapult', 10, -8)).toBe(false); // can't afford it
    game.gold = 1000;
    expect(game.place('catapult', 10, 20)).toBe(false); // out on the battlefield
    expect(game.place('crossbow', -4, -1)).toBe(true);
    expect(game.place('catapult', -4.5, -1)).toBe(false); // on top of the crossbow
    expect(game.place('catapult', 10, -8)).toBe(true);
    expect(game.gold).toBe(750);
    // Each extra one of a kind costs more.
    expect(game.defenderCost('catapult')).toBe(Math.round(150 * game.cfg.castle.priceGrowth));
    expect(game.place('archers', -15, -10)).toBe(true);
    expect(game.defenders).toHaveLength(3);
    game.closeCouncil();
    expect(game.place('archers', 15, -10)).toBe(false); // the shop is shut
  });

  it('moves defenders for free between waves and with a pack-up mid-battle', () => {
    const game = new Game(1, quiet());
    game.place('crossbow', -4, -1);
    const cb = game.defenders[0];
    expect(game.move(cb.id, 10, -5)).toBe(true);
    expect([cb.x, cb.y]).toEqual([10, -5]);
    expect(game.defenderAt(10.5, -5)).toBe(cb);
    game.closeCouncil();
    game.skipPreview();
    expect(game.move(cb.id, 0, -2)).toBe(true);
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

  it('sells shield upgrades for the run, up to their caps', () => {
    const game = new Game(1);
    game.gold = 1e6;
    const w = game.shieldHalfWidth();
    expect(game.shieldCost('width')).toBe(60);
    expect(game.upgradeShield('width')).toBe(true);
    expect(game.shieldCost('width')).toBe(Math.round(60 * 1.15));
    expect(game.shieldHalfWidth()).toBeCloseTo(w + 0.42);
    expect(game.upgradeShield('power')).toBe(true);
    expect(game.upgradeShield('power')).toBe(true);
    expect(game.upgradeShield('power')).toBe(false);
    expect(game.heaveLines()).toBe(3);
    for (let i = 0; i < 10; i++) game.upgradeShield('recovery');
    expect(game.heaveCooldown()).toBeCloseTo(0.4);
  });

  it('repairs walls at 1 gold per 2 HP, only during the council', () => {
    const game = new Game(1);
    game.segmentHp[0] = 300;
    game.gold = 20;
    expect(game.repairCost(0)).toBe(50);
    expect(game.repair(0)).toBe(40);
    expect(game.gold).toBe(0);
    expect(game.segmentHp[0]).toBe(340);
    game.closeCouncil();
    game.gold = 100;
    expect(game.repair(0)).toBe(0);
  });

  it('pays kill gold, wave-clear gold and Renown', () => {
    const game = new Game(1, quiet());
    game.closeCouncil();
    game.plan.groups = [];
    game.callEarly();
    game.balls = [];
    const afterCall = game.gold;
    game.enemies.push(enemy({ x: 0, y: 30, hp: 0.1 }));
    game.slap(0, 30);
    run(game, 0.1);
    expect(game.wavesSurvived).toBe(1);
    expect(game.gold - afterCall).toBeCloseTo(game.cfg.grunt.gold + 12); // grunt + 10 + 2 x wave
    expect(game.renownEarned).toBe(Math.round(6 * (1 + 0.02 * 8)));
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

  it('opens the War Council after every third wave', () => {
    const game = new Game(1, quiet());
    game.closeCouncil();
    for (let w = 1; w <= 3; w++) {
      game.plan.groups = [];
      game.skipPreview();
      run(game, 0.05);
    }
    expect(game.cleared).toBe(3);
    expect(game.phase).toBe('council');
    expect(game.plan.number).toBe(4);
  });

  it('soldiers spread along the wall and rush orcs that get close', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 1000;
    expect(game.buySoldiers()).toBe(true);
    expect(game.soldiers).toHaveLength(game.cfg.soldiers.count);
    const xs = game.soldiers.map((s) => s.x);
    expect(Math.min(...xs)).toBeLessThan(-15);
    expect(Math.max(...xs)).toBeGreaterThan(15);
    game.closeCouncil();
    game.plan.groups = [];
    game.skipPreview();
    game.balls = [];
    game.royalDue = Infinity;
    game.enemies.push(enemy({ x: 12, y: 5, hp: 1000, maxHp: 1000 }));
    run(game, 2);
    expect(game.enemies[0].hp).toBeLessThan(1000);
  });

  it('the castle catapult lobs fresh Royal Balls up the field', () => {
    const game = new Game(1, veteran(quiet()));
    game.gold = 150;
    expect(game.place('catapult', 0, -8)).toBe(true);
    game.closeCouncil();
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
    expect(game.place('archers', 0, -6)).toBe(true);
    game.closeCouncil();
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
    game.closeCouncil();
    game.plan.groups = [];
    game.skipPreview();
    game.enemies.push(enemy({ x: 0, y: 10, state: 'stand' }), enemy({ kind: 'orcCatapult', x: 5, y: 50, state: 'stand', hp: 60, maxHp: 60 }));
    run(game, 0.05);
    expect(game.defenders[0].aimY).toBe(50);
  });

  it('killing a warlord pays boss Renown', () => {
    const game = battle();
    game.enemies.push(enemy({ kind: 'warlord', y: 40, hp: 1, maxHp: 2000 }));
    const before = game.renown;
    game.slap(0, 40);
    run(game, 0.05);
    expect(game.renown - before).toBe(game.cfg.renown.bossKill);
  });

  it('an average paddle bot gets through the opening waves headlessly', () => {
    const game = new Game(5);
    const bot = averageBot();
    for (let i = 0; i < 60 * 60 * 10 && !game.over && game.cleared < 6; i++) {
      bot(game);
      game.step();
    }
    expect(game.cleared).toBeGreaterThanOrEqual(6);
    expect(game.blocked).toBeGreaterThan(0);
  });
});
