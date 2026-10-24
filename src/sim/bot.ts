import type { Game } from './game';

/**
 * Scripted players for headless balance runs. Each one is called once per
 * step and drives the game through the same input calls a person uses.
 */
export type Bot = (game: Game) => void;

/** Never touches anything: shows what the castle does on its own. */
export const idleBot: Bot = () => {};

/**
 * Plays the skill actions well: raises the shield just before each rock lands
 * (a perfect parry most of the time) and slaps orcs on the wall.
 */
export const skilledBot: Bot = (game) => {
  const sh = game.cfg.shield;
  let incoming: { x: number; y: number; vy: number } | undefined;
  for (const p of game.projectiles) {
    if (p.friendly || p.kind !== 'rock' || p.y < sh.y) continue;
    if (!incoming || p.y < incoming.y) incoming = p;
  }
  if (incoming) {
    const eta = (incoming.y - sh.y) / Math.max(1e-3, -incoming.vy);
    // Aim slightly off-centre so the rock bounces back into the crowd.
    const raise = eta < sh.parryWindow * 0.7 || (game.shield.raised && eta < 0.6);
    game.setShield(incoming.x - sh.halfWidth * 0.3, raise);
  } else {
    game.setShield(game.shield.x, false);
  }

  if (game.vigor < game.cfg.slap.vigorCost + 2) return;
  for (const e of game.enemies) {
    if (e.state === 'wall' || e.state === 'climb') {
      game.slap(e.x, e.y);
      return;
    }
  }
};
