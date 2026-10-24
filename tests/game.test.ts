import { describe, expect, it } from 'vitest';
import { makeConfig } from '../src/sim/config';
import { type Enemy, Game, type Projectile } from '../src/sim/game';
import { builderBot } from '../src/sim/bot';
import { planSize, planWave, waveBudget } from '../src/sim/waves';

function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) game.step();
}

function enemy(over: Partial<Enemy>): Enemy {
  return {
    kind: 'grunt', x: 0, y: 10, vx: 0, vy: 0, hp: 10, maxHp: 10, state: 'march', standY: 25, timer: 99, phase: 0,
    burn: 0, burnTime: 0, rally: 1, foe: null, ...over,
  };
}

/** A game past the opening War Council, in the wave 1 preview. */
function fighting(seed = 1, cfg = makeConfig()) {
  const game = new Game(seed, cfg);
  game.closeCouncil();
  return game;
}

function rock(over: Partial<Projectile> = {}): Projectile {
  return { kind: 'rock', x: 0, y: 6, vx: 0, vy: -12, friendly: false, travelled: 0, flight: 30, damage: 5, hitsLeft: 1, hit: new Set(), parried: false, ...over };
}

/** No defenders fire, so tests control every hit. */
const quiet = () => makeConfig({ crossbow: { range: -100 }, archers: { range: -100 }, catapult: { range: -100 } });

describe('waves', () => {
  it('plans the same wave for the same seed', () => {
    const cfg = makeConfig();
    expect(planWave(4, 7, cfg)).toEqual(planWave(4, 7, cfg));
  });

  it('follows the threat budget, with chuckers from the configured wave', () => {
    const cfg = makeConfig();
    expect(planWave(1, 1, cfg).totals).toMatchObject({ grunt: 20, chucker: 0, rider: 0 });
    expect(Math.round(waveBudget(10, cfg))).toBe(82);
    const w = planWave(5, 1, cfg).totals;
    expect(w.grunt + w.chucker * cfg.chucker.threat).toBe(Math.round(waveBudget(5, cfg)));
    expect(planWave(cfg.waves.chuckersFromWave, 1, cfg).totals.chucker).toBeGreaterThan(0);
  });

  it('spends the budget on unlocked specialists and adds bosses on boss waves', () => {
    const cfg = makeConfig();
    for (const n of [5, 12, 19]) {
      const t = planWave(n, 2, cfg).totals;
      const threat = t.grunt + t.chucker * 2 + t.rider * 2 + t.orcCatapult * 15 + t.ogre * 12;
      expect(threat).toBe(Math.round(waveBudget(n, cfg)));
    }
    expect(planWave(5, 1, cfg).totals.rider).toBe(0);
    expect(planWave(6, 1, cfg).totals.rider).toBeGreaterThan(0);
    expect(planWave(12, 1, cfg).totals.ogre).toBeGreaterThan(0);
    expect(planWave(10, 1, cfg).totals.warlord).toBe(1);
    expect(planWave(11, 1, cfg).totals.warlord).toBe(0);
  });

  it('spawns exactly the previewed enemies', () => {
    const game = fighting(3, quiet());
    const total = planSize(game.plan);
    game.skipPreview();
    run(game, 12);
    expect(game.kills + game.enemies.length).toBe(total);
  });
});

describe('game', () => {
  it('is deterministic for a seed', () => {
    const a = fighting(42);
    const b = fighting(42);
    run(a, 60);
    run(b, 60);
    expect(a.kills).toBe(b.kills);
    expect(a.segmentHp).toEqual(b.segmentHp);
  });

  it('ends the run as soon as any one wall segment falls', () => {
    const game = fighting(1, quiet());
    game.segmentHp[2] = 0.5;
    game.enemies.push(enemy({ x: 0, y: 0.5, state: 'wall' }));
    run(game, 1);
    expect(game.phase).toBe('lost');
    expect(game.segmentHp.filter((hp) => hp === 0)).toHaveLength(1);
  });

  it('grunts climb before they start hacking at the wall', () => {
    const game = fighting(1, quiet());
    game.enemies.push(enemy({ x: 0, y: 1 }));
    run(game, 2);
    expect(game.segmentHp[2]).toBe(game.cfg.wall.segmentHp);
    run(game, 3);
    expect(game.segmentHp[2]).toBeLessThan(game.cfg.wall.segmentHp);
  });

  it('a held shield sends a rock back as a friendly projectile', () => {
    const game = fighting(1);
    game.setShield(0, true);
    run(game, 1);
    game.projectiles.push(rock());
    run(game, 0.3);
    const r = game.projectiles.find((p) => p.kind === 'rock');
    expect(r?.friendly).toBe(true);
    expect(r?.parried).toBe(false);
    expect(r!.vy).toBeGreaterThan(0);
    expect(game.segmentHp.every((hp) => hp === game.cfg.wall.segmentHp)).toBe(true);
  });

  it('raising the shield just before impact is a perfect parry', () => {
    const game = fighting(1);
    game.projectiles.push(rock({ y: 4.9 }));
    game.setShield(0, true);
    run(game, 0.12);
    const r = game.projectiles.find((p) => p.kind === 'rock');
    expect(r?.parried).toBe(true);
    expect(r?.damage).toBe(game.cfg.rock.deflectDamage * game.cfg.shield.parryMultiplier);
    expect(game.parries).toBe(1);
  });

  it('a lowered shield lets the rock hit the wall', () => {
    const game = fighting(1);
    game.projectiles.push(rock());
    run(game, 1);
    expect(game.segmentHp[game.segmentAt(0)]).toBe(game.cfg.wall.segmentHp - game.cfg.rock.wallDamage);
  });

  it('the shield runs out and must recover before rising again', () => {
    const game = fighting(1);
    game.setShield(0, true);
    run(game, game.cfg.shield.maxEnergy / game.cfg.shield.drainPerSec + 0.1);
    expect(game.shield.locked).toBe(true);
    expect(game.shield.raised).toBe(false);
  });

  it('slap spends Vigor, damages and knocks back enemies under the cursor', () => {
    const game = fighting(1);
    game.enemies.push(enemy({ x: 0.5, y: 2 }), enemy({ x: 10, y: 2 }));
    expect(game.slap(0, 2)).toBe(true);
    expect(game.vigor).toBe(game.cfg.slap.vigorMax - game.cfg.slap.vigorCost);
    expect(game.enemies[0].hp).toBe(10 - game.cfg.slap.damage);
    expect(game.enemies[0].vy).toBeGreaterThan(0);
    expect(game.enemies[1].hp).toBe(10);
  });

  it('slap is refused once Vigor runs out', () => {
    const game = fighting(1);
    for (let i = 0; i < game.cfg.slap.vigorMax; i++) expect(game.slap(0, 50)).toBe(true);
    expect(game.slap(0, 50)).toBe(false);
  });

  it('crossbow bolts pierce a column of enemies', () => {
    const game = fighting(1, makeConfig({ crossbow: { damage: 5 } }));
    for (let i = 0; i < 4; i++) game.enemies.push(enemy({ x: 0, y: 20 + i * 1.2, state: 'stand' }));
    run(game, 1);
    expect(game.enemies.filter((e) => e.hp < 10).length).toBeGreaterThanOrEqual(3);
  });

  it('wins after the final wave', () => {
    const game = fighting(1, makeConfig({ waves: { finalWave: 1 } }));
    game.skipPreview();
    run(game, 120);
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

  it('starts with one crossbow and sells defenders only into matching empty slots', () => {
    const game = new Game(1);
    const towers = game.slots.filter((s) => s.kind === 'tower');
    expect(towers.filter((s) => s.defender === 'crossbow')).toHaveLength(1);
    const pit = game.slots.find((s) => s.kind === 'pit')!;
    expect(game.buy(pit.id, 'archers')).toBe(false);
    game.gold = 149;
    expect(game.buy(pit.id, 'catapult')).toBe(false);
    game.gold = 150;
    expect(game.buy(pit.id, 'catapult')).toBe(true);
    expect(game.gold).toBe(0);
    expect(game.buy(pit.id, 'catapult')).toBe(false);
  });

  it('upgrade costs grow by 15% a level and each level adds 10%', () => {
    const game = new Game(1);
    game.gold = 1e6;
    const first = game.upgradeCost('crossbow', 'damage');
    expect(first).toBe(40);
    expect(game.upgrade('crossbow', 'damage')).toBe(true);
    expect(game.upgradeCost('crossbow', 'damage')).toBe(Math.round(40 * 1.15));
    expect(game.mult('crossbow', 'damage')).toBeCloseTo(1.1);
    for (let i = 1; i < 10; i++) game.upgrade('crossbow', 'damage');
    expect(game.mult('crossbow', 'damage')).toBeCloseTo(4); // 1 + 10 x 0.1, doubled at the level 10 milestone
    expect(game.upgrade('archers', 'damage')).toBe(false); // nothing to upgrade yet
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
    const game = fighting(1, quiet());
    game.callEarly();
    const afterCall = game.gold;
    game.enemies = [];
    game.plan.groups = [];
    game.enemies.push(enemy({ x: 0, y: 30, hp: 0.1 }));
    game.slap(0, 30);
    run(game, 0.1);
    expect(game.wavesSurvived).toBe(1);
    expect(game.gold - afterCall).toBeCloseTo(1 + 12); // grunt + 10 + 2 x wave
    expect(game.renownEarned).toBe(Math.round(6 * (1 + 0.02 * 8)));
  });

  it('calling a wave early from its tail pays a bonus and starts the next wave', () => {
    const game = fighting(1, quiet());
    game.skipPreview();
    game.plan.groups = [];
    game.enemies = [enemy({ y: 40 })];
    run(game, 0.05);
    expect(game.canCallEarly()).toBe(true);
    const gold = game.gold;
    expect(game.callEarly()).toBe(true);
    expect(game.wave).toBe(2);
    expect(game.cleared).toBe(1);
    expect(game.gold).toBeGreaterThan(gold + 12);
    expect(game.enemies).toHaveLength(1);
  });

  it('opens the War Council after every third wave', () => {
    const game = fighting(1, quiet());
    for (let w = 1; w <= 3; w++) {
      game.skipPreview();
      game.plan.groups = [];
      game.enemies = [];
      run(game, 0.05);
    }
    expect(game.cleared).toBe(3);
    expect(game.phase).toBe('council');
    expect(game.plan.number).toBe(4);
  });

  it('the soldier line holds orcs at the gate and returns the next wave', () => {
    const game = new Game(1, quiet());
    game.gold = 100;
    const line = game.slots.find((s) => s.kind === 'line')!;
    expect(game.buy(line.id, 'soldiers')).toBe(true);
    expect(game.soldiers).toHaveLength(game.cfg.soldiers.count);
    game.closeCouncil();
    game.enemies.push(enemy({ x: 0, y: line.y + 0.8, hp: 1000, maxHp: 1000 }));
    run(game, 1);
    expect(game.enemies[0].state).toBe('fight');
    expect(game.enemies[0].y).toBeGreaterThan(line.y);
    expect(game.enemies[0].hp).toBeLessThan(1000);
  });

  it('catapult stones splash a crowd', () => {
    const game = new Game(1, makeConfig({ crossbow: { range: -100 } }));
    game.gold = 150;
    game.buy(game.slots.find((s) => s.kind === 'pit')!.id, 'catapult');
    game.closeCouncil();
    for (let i = 0; i < 6; i++) game.enemies.push(enemy({ x: (i % 3) - 1, y: 30 + Math.floor(i / 3), state: 'stand', hp: 100, maxHp: 100 }));
    run(game, 2);
    expect(game.enemies.filter((e) => e.hp < 100).length).toBeGreaterThanOrEqual(4);
  });

  it('archer arrows home in on zig-zagging riders', () => {
    const game = new Game(1, makeConfig({ crossbow: { range: -100 } }));
    game.gold = 80;
    game.buy(0, 'archers');
    game.closeCouncil();
    game.enemies.push(enemy({ kind: 'rider', x: -10, y: 25, hp: 8, maxHp: 8 }));
    run(game, 3);
    expect(game.kills).toBe(1);
  });

  it('killing a warlord pays boss Renown', () => {
    const game = fighting(1, quiet());
    game.skipPreview();
    game.enemies.push(enemy({ kind: 'warlord', y: 40, hp: 1, maxHp: 2000 }));
    const before = game.renown;
    game.slap(0, 40);
    run(game, 0.05);
    expect(game.renown - before).toBe(game.cfg.renown.bossKill);
  });

  it('a planned build reaches the first boss headlessly', () => {
    const game = new Game(5);
    for (let i = 0; i < 60 * 60 * 10 && !game.over && game.cleared < 10; i++) {
      builderBot(game);
      game.step();
    }
    expect(game.cleared).toBeGreaterThanOrEqual(9);
    expect(game.slots.filter((s) => s.defender).length).toBeGreaterThan(2);
  });
});
