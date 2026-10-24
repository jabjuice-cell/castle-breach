import { type DefenderKind, PLACED_KINDS, type PlacedKind, TRACKS } from './defenders';
import { type Game, SHIELD_TRACKS, type ShieldTrack } from './game';
import { Rng } from './rng';

/**
 * Scripted players for headless balance runs. Each one is called once per
 * step and drives the game through the same input calls a person uses.
 * Bots keep state (reaction delay, aim error), so make a fresh one per run.
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
  for (const kind of PLACED_KINDS) {
    if (game.unlocked(kind)) list.push({ cost: game.defenderCost(kind), buy: () => placeAnywhere(game, kind) });
  }
  if (game.unlocked('soldiers') && game.companies < game.cfg.soldiers.maxCompanies) {
    list.push({ cost: game.defenderCost('soldiers'), buy: () => game.buySoldiers() });
  }
  for (const kind of ownedKinds(game)) {
    for (const track of TRACKS) list.push({ cost: game.upgradeCost(kind, track), buy: () => game.upgrade(kind, track) });
  }
  for (const track of SHIELD_TRACKS) list.push({ cost: game.shieldCost(track), buy: () => game.upgradeShield(track) });
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

/** What a sensible player buys, in order, and where it goes. Bumpers: the towers are at x = -12, -4, 4, 12. */
const BUILD_ORDER: ([DefenderKind, number, number] | [ShieldTrack, number])[] = [
  ['width', 1],
  ['crossbow', 4, -1],
  ['archers', 12, -1],
  ['recovery', 2],
  ['catapult', 0, -8],
  ['soldiers', 0, 0],
  ['width', 3],
  ['archers', -12, -1],
  ['window', 2],
  ['crossbow', -4, -1],
  ['catapult', -12, -8],
  ['power', 1],
  ['catapult', 12, -8],
];

/** Planned shopping: keep walls healthy, buy in a set order, then spread upgrades. */
function plannedShop(game: Game): void {
  repairBelow(game, 0.75);
  const want = new Map<string, number>();
  for (const item of BUILD_ORDER) {
    if (item.length === 2) {
      const [track, level] = item;
      if (game.shieldLevels[track] >= level) continue;
      if (!game.upgradeShield(track)) return;
      continue;
    }
    const [kind, x, y] = item;
    if (!game.unlocked(kind)) continue;
    const n = (want.get(kind) ?? 0) + 1;
    want.set(kind, n);
    if (game.count(kind) >= n) continue;
    const bought = kind === 'soldiers' ? game.buySoldiers() : game.place(kind, x, y) || placeAnywhere(game, kind);
    if (!bought) return;
  }
  for (;;) {
    const options = [
      ...ownedKinds(game).flatMap((kind) =>
        TRACKS.filter((t) => kind !== 'soldiers' || t !== 'rate').map((track) => ({ cost: game.upgradeCost(kind, track), buy: () => game.upgrade(kind, track) })),
      ),
      ...SHIELD_TRACKS.filter((t) => t !== 'plating').map((t) => ({ cost: game.shieldCost(t), buy: () => game.upgradeShield(t) })),
    ];
    options.sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick || pick.cost > game.gold || !pick.buy()) return;
  }
}

/** How well a bot handles the shield. Distances are in field units (1 tile = 1.67). */
export interface PaddleSkill {
  /** Reaction time: it acts on what it saw this long ago. */
  delay: number;
  /** Aim error, uniform +-, fixed per incoming ball. */
  error: number;
  /** Share of hits it times as a heave. */
  heaveRate: number;
  /** Fastest it moves the shield (units/s). */
  speed: number;
  /** Aims the bounce angle at the biggest block instead of just catching the ball. */
  aim: boolean;
  /** Catches capsules (except the red Orc trick) when nothing else is coming. */
  capsules: boolean;
}

/** From the design brief: idle drifts with a 600 ms delay and +-1.5 tiles, never heaves. */
export const IDLE: PaddleSkill = { delay: 0.6, error: 2.5, heaveRate: 0, speed: 25, aim: false, capsules: false };
export const AVERAGE: PaddleSkill = { delay: 0.35, error: 1.33, heaveRate: 0.4, speed: 100, aim: false, capsules: true };
export const EXPERT: PaddleSkill = { delay: 0.12, error: 0.15, heaveRate: 0.9, speed: 100, aim: true, capsules: true };

type Incoming = { key: object; x: number; eta: number };

/** Where something heading for the shield will cross its line, folding ball paths off the tree lines. */
function intercept(game: Game, x: number, y: number, vx: number, vy: number, bounces: boolean): { x: number; eta: number } | null {
  const sy = game.cfg.shield.y + game.cfg.balls.radius;
  if (vy >= 0 || y < sy) return null;
  const eta = (y - sy) / -vy;
  let ix = x + vx * eta;
  if (bounces) {
    const hw = game.cfg.field.halfWidth - game.cfg.balls.radius;
    const span = hw * 4;
    ix = ((((ix + hw) % span) + span) % span);
    ix = ix > hw * 2 ? span - ix : ix;
    ix -= hw;
  }
  return { x: ix, eta };
}

/** The offset on the shield (-0.85 to 0.85) that sends a ball from x toward (tx, ty). */
function aimOffset(game: Game, x: number, tx: number, ty: number): number {
  const want = Math.atan2(tx - x, ty - game.cfg.shield.y);
  let best = 0;
  let bestErr = Infinity;
  for (let o = -0.85; o <= 0.851; o += 0.05) {
    const err = Math.abs(game.bounceAngle(o) - want);
    if (err < bestErr) {
      bestErr = err;
      best = o;
    }
  }
  return best;
}

/**
 * A paddle bot: tracks whatever reaches the shield line soonest (balls, boulders,
 * pebbles, then capsules) with a reaction delay and aim error, and sometimes heaves.
 * strong: plans its shopping, calls waves early and slaps climbers.
 */
export function paddleBot(skill: PaddleSkill, strong: boolean): Bot {
  const history: { t: number; x: number }[] = [];
  const errors = new WeakMap<object, number>();
  const decided = new WeakSet<object>();
  let rng: Rng | null = null;

  return (game) => {
    rng ??= new Rng(game.seed * 31 + 7);
    if (game.phase === 'council') {
      (strong ? plannedShop : cheapestShop)(game);
      game.closeCouncil();
      return;
    }
    if (strong && game.canCallEarly()) game.callEarly();

    let next: Incoming | undefined;
    const consider = (key: object, hit: { x: number; eta: number } | null) => {
      if (hit && (!next || hit.eta < next.eta)) next = { key, ...hit };
    };
    for (const b of game.balls) if (!b.stuck) consider(b, intercept(game, b.x, b.y, b.vx, b.vy, true));
    for (const p of game.projectiles) if (!p.friendly) consider(p, intercept(game, p.x, p.y, p.vx, p.vy, false));
    if (skill.capsules && (!next || next.eta > 1.5)) {
      for (const c of game.capsules) if (c.kind !== 'trick') consider(c, intercept(game, c.x, c.y, 0, -game.cfg.capsules.fallSpeed, false));
    }

    // Where it wants the shield, from what it sees now.
    const half = game.shieldHalfWidth();
    let want = game.shield.x;
    if (next) {
      if (!errors.has(next.key)) errors.set(next.key, rng.range(-skill.error, skill.error));
      let offset = 0;
      if (skill.aim && !('kind' in next.key && (next.key as { kind: string }).kind === 'grog')) {
        const block = game.blocks.reduce<(typeof game.blocks)[number] | undefined>((a, b) => (!a || b.members.length > a.members.length ? b : a), undefined);
        if (block) offset = aimOffset(game, next.x, block.x, block.y);
      }
      want = next.x - offset * half * 0.9 + errors.get(next.key)!;
    }
    history.push({ t: game.time, x: want });
    while (history.length > 1 && history[1].t <= game.time - skill.delay) history.shift();
    const seen = history[0].x;
    const step = skill.speed / 60;
    game.setShield(game.shield.x + Math.max(-step, Math.min(step, seen - game.shield.x)));

    // Heave just before impact, some of the time.
    if (next && next.eta < game.heaveWindow() * 0.5 && !decided.has(next.key)) {
      decided.add(next.key);
      if (rng.next() < skill.heaveRate && game.canHeave) game.heave();
    }
    // Serve straight away when nothing is about to land.
    if (skill.heaveRate > 0 && game.balls.some((b) => b.stuck) && (!next || next.eta > 0.5)) game.heave();

    if (!strong || game.vigor < game.cfg.slap.vigorCost + 2) return;
    for (const e of game.enemies) {
      if (e.state === 'wall' || e.state === 'climb') {
        game.slap(e.x, e.y);
        return;
      }
    }
  };
}

/** The three balance archetypes from the design brief. */
export const idleBot = (): Bot => paddleBot(IDLE, false);
export const averageBot = (): Bot => paddleBot(AVERAGE, true);
export const expertBot = (): Bot => paddleBot(EXPERT, true);
