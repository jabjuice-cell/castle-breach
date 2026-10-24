import { type DefenderKind, PLACED_KINDS, type PlacedKind, TRACKS } from './defenders';
import type { Game } from './game';

/**
 * Scripted players for headless balance runs. Each one is called once per
 * step and drives the game through the same input calls a person uses.
 */
export type Bot = (game: Game) => void;

type Purchase = { cost: number; buy: () => boolean };

/** Buys a defender into the first free spot (on the wall first, then further back). */
function placeAnywhere(game: Game, kind: PlacedKind): boolean {
  const spot = game.freeSpot(kind);
  return !!spot && game.place(kind, spot.x, spot.y);
}

function ownedKinds(game: Game): DefenderKind[] {
  return (['crossbow', 'archers', 'catapult', 'soldiers'] as const).filter((k) => game.owns(k));
}

function purchases(game: Game): Purchase[] {
  const list: Purchase[] = [];
  for (const kind of PLACED_KINDS) list.push({ cost: game.defenderCost(kind), buy: () => placeAnywhere(game, kind) });
  if (game.companies < game.cfg.soldiers.maxCompanies) list.push({ cost: game.defenderCost('soldiers'), buy: () => game.buySoldiers() });
  for (const kind of ownedKinds(game)) {
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

/** What a sensible player buys, in order, and where it goes. */
const BUILD_ORDER: [DefenderKind, number, number][] = [
  ['archers', 4, -1],
  ['catapult', 0, -8],
  ['soldiers', 0, 0],
  ['archers', -12, -1],
  ['archers', 12, -1],
  ['catapult', -12, -8],
  ['crossbow', 8, -1],
  ['catapult', 12, -8],
];

/** Planned shopping: keep walls healthy, buy in a set order, then spread upgrades. */
function plannedShop(game: Game): void {
  repairBelow(game, 0.75);
  const want = new Map<DefenderKind, number>();
  let done = true;
  for (const [kind, x, y] of BUILD_ORDER) {
    const n = (want.get(kind) ?? 0) + 1;
    want.set(kind, n);
    if (game.count(kind) >= n) continue;
    const bought = kind === 'soldiers' ? game.buySoldiers() : game.place(kind, x, y) || placeAnywhere(game, kind);
    if (!bought) {
      done = false;
      break;
    }
  }
  if (!done && game.gold < 150) return;
  for (;;) {
    const options = ownedKinds(game).flatMap((kind) =>
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
