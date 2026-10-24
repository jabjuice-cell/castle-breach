import { type DefenderKind, SLOT_ACCEPTS, TRACKS } from './defenders';
import type { Game } from './game';

/**
 * Scripted players for headless balance runs. Each one is called once per
 * step and drives the game through the same input calls a person uses.
 */
export type Bot = (game: Game) => void;

type Purchase = { cost: number; buy: () => boolean };

function purchases(game: Game): Purchase[] {
  const list: Purchase[] = [];
  for (const slot of game.slots) {
    if (slot.defender) continue;
    for (const kind of SLOT_ACCEPTS[slot.kind]) list.push({ cost: game.defenderCost(kind), buy: () => game.buy(slot.id, kind) });
  }
  for (const kind of new Set(game.slots.map((s) => s.defender).filter((k): k is DefenderKind => !!k))) {
    for (const track of TRACKS) list.push({ cost: game.upgradeCost(kind, track), buy: () => game.upgrade(kind, track) });
  }
  return list;
}

function repairBelow(game: Game, share: number): void {
  const full = game.cfg.wall.segmentHp;
  game.segmentHp
    .map((hp, i) => ({ hp, i }))
    .sort((a, b) => a.hp - b.hp)
    .forEach(({ hp, i }) => {
      if (hp < full * share) game.repair(i);
    });
}

/** Casual shopping: patch badly hurt walls, then keep buying whatever is cheapest. */
function cheapestShop(game: Game): void {
  repairBelow(game, 0.5);
  for (;;) {
    const options = purchases(game).filter((p) => p.cost <= game.gold);
    if (options.length === 0) return;
    options.sort((a, b) => a.cost - b.cost);
    if (!options[0].buy()) return;
  }
}

/** Order a sensible player fills the empty slots in. */
const BUILD_ORDER: [number, DefenderKind][] = [
  [0, 'archers'],
  [4, 'catapult'],
  [6, 'soldiers'],
  [3, 'archers'],
  [5, 'catapult'],
  [2, 'crossbow'],
];

/** Planned shopping: keep walls healthy, fill slots in a set order, then spread upgrades. */
function plannedShop(game: Game): void {
  repairBelow(game, 0.75);
  for (const [slot, kind] of BUILD_ORDER) {
    if (game.slots[slot]?.defender) continue;
    if (!game.buy(slot, kind)) break;
  }
  if (BUILD_ORDER.some(([slot]) => !game.slots[slot]?.defender) && game.gold < 150) return;
  for (;;) {
    const owned = new Set(game.slots.map((s) => s.defender).filter((k): k is DefenderKind => !!k));
    const options = [...owned].flatMap((kind) =>
      TRACKS.filter((t) => kind !== 'soldiers' || t !== 'rate').map((track) => ({ kind, track, cost: game.upgradeCost(kind, track) })),
    );
    options.sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick || pick.cost > game.gold || !game.upgrade(pick.kind, pick.track)) return;
  }
}

function shopThenFight(game: Game, shop: (g: Game) => void): boolean {
  if (game.phase !== 'council') return false;
  shop(game);
  game.closeCouncil();
  return true;
}

/** Never touches the battle: shows what the castle does on its own with casual shopping. */
export const idleBot: Bot = (game) => {
  shopThenFight(game, cheapestShop);
};

/** Plans purchases well but never uses manual skills or calls early. */
export const builderBot: Bot = (game) => {
  shopThenFight(game, plannedShop);
};

/**
 * Plays well: planned shopping, calls every wave early, raises the shield just
 * before each rock lands (a perfect parry most of the time) and slaps orcs on the wall.
 */
export const skilledBot: Bot = (game) => {
  if (shopThenFight(game, plannedShop)) return;
  if (game.canCallEarly()) game.callEarly();

  const sh = game.cfg.shield;
  let incoming: { x: number; y: number; vy: number } | undefined;
  for (const p of game.projectiles) {
    if (p.friendly || (p.kind !== 'rock' && p.kind !== 'boulder') || p.y < sh.y) continue;
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
