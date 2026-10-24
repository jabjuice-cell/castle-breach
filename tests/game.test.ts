import { describe, expect, it } from 'vitest';
import { makeConfig } from '../src/sim/config';
import { type Enemy, Game, type Projectile } from '../src/sim/game';
import { planWave, waveBudget } from '../src/sim/waves';

function run(game: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) game.step();
}

function enemy(over: Partial<Enemy>): Enemy {
  return { kind: 'grunt', x: 0, y: 10, vx: 0, vy: 0, hp: 10, maxHp: 10, state: 'march', standY: 25, timer: 99, phase: 0, ...over };
}

function rock(over: Partial<Projectile> = {}): Projectile {
  return { kind: 'rock', x: 0, y: 6, vx: 0, vy: -12, friendly: false, travelled: 0, flight: 30, damage: 5, hitsLeft: 1, hit: new Set(), parried: false, ...over };
}

/** Crossbow can't target anything, so tests control every hit. */
const quiet = () => makeConfig({ crossbow: { range: -100 } });

describe('waves', () => {
  it('plans the same wave for the same seed', () => {
    const cfg = makeConfig();
    expect(planWave(4, 7, cfg)).toEqual(planWave(4, 7, cfg));
  });

  it('follows the threat budget, with chuckers from the configured wave', () => {
    const cfg = makeConfig();
    expect(planWave(1, 1, cfg).totals).toEqual({ grunt: 20, chucker: 0 });
    expect(Math.round(waveBudget(10, cfg))).toBe(82);
    const w = planWave(5, 1, cfg).totals;
    expect(w.grunt + w.chucker * cfg.chucker.threat).toBe(Math.round(waveBudget(5, cfg)));
    expect(planWave(cfg.waves.chuckersFromWave, 1, cfg).totals.chucker).toBeGreaterThan(0);
  });

  it('spawns exactly the previewed enemies', () => {
    const game = new Game(3, quiet());
    const total = game.plan.totals.grunt + game.plan.totals.chucker;
    game.skipPreview();
    run(game, 12);
    expect(game.kills + game.enemies.length).toBe(total);
  });
});

describe('game', () => {
  it('is deterministic for a seed', () => {
    const a = new Game(42);
    const b = new Game(42);
    run(a, 60);
    run(b, 60);
    expect(a.kills).toBe(b.kills);
    expect(a.segmentHp).toEqual(b.segmentHp);
  });

  it('ends the run as soon as any one wall segment falls', () => {
    const game = new Game(1, quiet());
    game.segmentHp[2] = 0.5;
    game.enemies.push(enemy({ x: 0, y: 0.5, state: 'wall' }));
    run(game, 1);
    expect(game.phase).toBe('lost');
    expect(game.segmentHp.filter((hp) => hp === 0)).toHaveLength(1);
  });

  it('grunts climb before they start hacking at the wall', () => {
    const game = new Game(1, quiet());
    game.enemies.push(enemy({ x: 0, y: 1 }));
    run(game, 2);
    expect(game.segmentHp[2]).toBe(game.cfg.wall.segmentHp);
    run(game, 3);
    expect(game.segmentHp[2]).toBeLessThan(game.cfg.wall.segmentHp);
  });

  it('a held shield sends a rock back as a friendly projectile', () => {
    const game = new Game(1);
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
    const game = new Game(1);
    game.projectiles.push(rock({ y: 4.9 }));
    game.setShield(0, true);
    run(game, 0.12);
    const r = game.projectiles.find((p) => p.kind === 'rock');
    expect(r?.parried).toBe(true);
    expect(r?.damage).toBe(game.cfg.rock.deflectDamage * game.cfg.shield.parryMultiplier);
    expect(game.parries).toBe(1);
  });

  it('a lowered shield lets the rock hit the wall', () => {
    const game = new Game(1);
    game.projectiles.push(rock());
    run(game, 1);
    expect(game.segmentHp[game.segmentAt(0)]).toBe(game.cfg.wall.segmentHp - game.cfg.rock.wallDamage);
  });

  it('the shield runs out and must recover before rising again', () => {
    const game = new Game(1);
    game.setShield(0, true);
    run(game, game.cfg.shield.maxEnergy / game.cfg.shield.drainPerSec + 0.1);
    expect(game.shield.locked).toBe(true);
    expect(game.shield.raised).toBe(false);
  });

  it('slap spends Vigor, damages and knocks back enemies under the cursor', () => {
    const game = new Game(1);
    game.enemies.push(enemy({ x: 0.5, y: 2 }), enemy({ x: 10, y: 2 }));
    expect(game.slap(0, 2)).toBe(true);
    expect(game.vigor).toBe(game.cfg.slap.vigorMax - game.cfg.slap.vigorCost);
    expect(game.enemies[0].hp).toBe(10 - game.cfg.slap.damage);
    expect(game.enemies[0].vy).toBeGreaterThan(0);
    expect(game.enemies[1].hp).toBe(10);
  });

  it('slap is refused once Vigor runs out', () => {
    const game = new Game(1);
    for (let i = 0; i < game.cfg.slap.vigorMax; i++) expect(game.slap(0, 50)).toBe(true);
    expect(game.slap(0, 50)).toBe(false);
  });

  it('crossbow bolts pierce a column of enemies', () => {
    const game = new Game(1, makeConfig({ crossbow: { damage: 5 } }));
    for (let i = 0; i < 4; i++) game.enemies.push(enemy({ x: 0, y: 20 + i * 1.2, state: 'stand' }));
    run(game, 1);
    expect(game.enemies.filter((e) => e.hp < 10).length).toBeGreaterThanOrEqual(3);
  });

  it('wins after the final wave', () => {
    const game = new Game(1, makeConfig({ waves: { finalWave: 1 } }));
    game.skipPreview();
    run(game, 120);
    expect(game.phase).toBe('won');
    expect(game.wavesSurvived).toBe(1);
  });
});
