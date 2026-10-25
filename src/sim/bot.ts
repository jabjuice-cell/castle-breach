import { type DefenderKind, PLACED_KINDS, type PlacedKind, USEFUL_TRACKS } from './defenders';
import type { Game } from './game';
import { Rng } from './rng';

/**
 * Scripted players for headless balance runs. Each one is called once per
 * step and drives the game through the same input calls a person uses.
 * Bots keep state (reaction delay, aim error), so make a fresh one per run.
 */
export type Bot = (game: Game) => void;

type Purchase = { cost: number; buy: () => boolean };

/** Puts a defender down at (x, y), unless one of that kind already stands there. */
function placeAt(game: Game, kind: PlacedKind, x: number, y: number): boolean {
  if (game.defenders.some((d) => d.kind === kind && Math.hypot(d.x - x, d.y - y) < 0.5)) return true;
  return game.place(kind, x, y);
}

/** Candidate places a casual player tries in turn: along the wall walk from the gate outward, then the courtyard. */
function casualPlaces(game: Game): { x: number; y: number }[] {
  const hw = game.cfg.field.halfWidth - 1;
  const out: { x: number; y: number }[] = [];
  for (const y of [-1, -6]) {
    for (let k = 0; k <= hw; k += 1) {
      out.push({ x: k, y });
      if (k) out.push({ x: -k, y });
    }
  }
  return out;
}

function ownedKinds(game: Game): DefenderKind[] {
  return (['crossbow', 'archers', 'catapult', 'soldiers'] as const).filter((k) => game.owns(k));
}

function upgrades(game: Game): Purchase[] {
  const list: Purchase[] = [];
  for (const kind of ownedKinds(game)) {
    for (const track of USEFUL_TRACKS[kind]) list.push({ cost: game.upgradeCost(kind, track), buy: () => game.upgrade(kind, track) });
  }
  return list;
}

function buyCheapest(game: Game, list: () => Purchase[]): void {
  for (;;) {
    const options = list().filter((p) => p.cost <= game.gold);
    if (options.length === 0) return;
    options.sort((a, b) => a.cost - b.cost);
    if (!options[0].buy()) return;
  }
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

/** Casual shopping: patch badly hurt walls, then keep buying whatever is cheapest, in the first place it fits. */
function cheapestShop(game: Game): void {
  repairBelow(game, 0.5);
  const places = casualPlaces(game);
  buyCheapest(game, () => {
    const list = upgrades(game);
    for (const kind of PLACED_KINDS) {
      if (!game.unlocked(kind)) continue;
      const at = places.find((p) => game.canPlace(kind, p.x, p.y));
      if (at) list.push({ cost: game.defenderCost(kind), buy: () => game.place(kind, at.x, at.y) });
    }
    return list;
  });
}

/** Random placement: the same budget, but defenders dropped at random places on the castle. */
function randomShop(game: Game, rng: Rng): void {
  repairBelow(game, 0.75);
  const c = game.cfg.castle;
  const hw = game.cfg.field.halfWidth - c.edge;
  for (let tries = 0; tries < 80; tries++) {
    const kinds = PLACED_KINDS.filter((k) => game.unlocked(k));
    const kind = kinds[rng.int(0, kinds.length - 1)];
    if (game.gold < game.defenderCost(kind)) break;
    game.place(kind, rng.range(-hw, hw), rng.range(c.minY, c.maxY));
  }
  buyCheapest(game, () => upgrades(game));
}

/**
 * What a sensible player buys, in order, and where it goes (x, y on the castle; the wall
 * walk is y -2 to 0, the courtyard behind it). Crossbows go on the inner tower tops
 * (x -4, 4, -12, 12), where they can angle across lanes at the catapults; archers spread
 * between them so their cones cover every section against boulders; soldiers and
 * catapults stand back in the courtyard.
 */
const BUILD_ORDER: [DefenderKind, number, number][] = [
  ['crossbow', -4, -1],
  ['archers', 0, -1],
  ['crossbow', 4, -1],
  ['archers', -8, -1],
  ['archers', 8, -1],
  ['soldiers', 0, -5.5],
  ['crossbow', -12, -1],
  ['crossbow', 12, -1],
  ['catapult', -8, -8],
  ['soldiers', -16, -5.5],
  ['soldiers', 16, -5.5],
  ['catapult', 8, -8],
];

/** Planned shopping: keep walls healthy, buy in a set order, then spread upgrades. */
function plannedShop(game: Game): void {
  repairBelow(game, 0.75);
  for (const [kind, x, y] of BUILD_ORDER) {
    if (!game.unlocked(kind)) continue;
    if (!placeAt(game, kind, x, y)) return;
  }
  buyCheapest(game, () => upgrades(game));
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

/** How long before impact a sweeping shield starts its run, and at what share of its top speed. */
const SWEEP_SECONDS = 0.08;
const SWEEP_SHARE = 0.85;

/**
 * The offset on the shield (-1 to 1) and the sweep (-1, 0 or 1: moving the shield at full
 * speed through the hit, for English) that best send a ball arriving at inAngle from x toward (tx, ty).
 */
function aimShot(game: Game, x: number, inAngle: number, tx: number, ty: number): { offset: number; sweep: number } {
  const want = Math.atan2(tx - x, ty - game.cfg.shield.y);
  const c = game.cfg.shield;
  // English, plus about half the curve on the way up.
  const turn = SWEEP_SHARE * (c.english + 0.5 * c.curve * c.curveSeconds);
  let best = { offset: 0, sweep: 0 };
  let bestErr = Math.abs(game.bounceAngle(0, inAngle) - want);
  for (const sweep of [0, -1, 1]) {
    // A moving shield is harder to put in the right place, so stay off its edges.
    const reach = sweep ? 0.6 : 0.95;
    for (let o = -reach; o <= reach + 0.001; o += 0.05) {
      const err = Math.abs(game.bounceAngle(o, inAngle) + sweep * turn - want);
      // A sweep is riskier than standing still, so it has to be clearly better.
      if (err < bestErr - (sweep ? 0.02 : 0)) {
        bestErr = err;
        best = { offset: o, sweep };
      }
    }
  }
  return best;
}


/**
 * A paddle bot: tracks whatever reaches the shield line soonest (balls, boulders,
 * pebbles, then capsules) with a reaction delay and aim error, and sometimes heaves.
 * strong: plans its shopping and calls waves early.
 */
export type Placement = 'planned' | 'cheapest' | 'random';

export function paddleBot(skill: PaddleSkill, strong: boolean, placement: Placement = strong ? 'planned' : 'cheapest'): Bot {
  const history: { t: number; x: number }[] = [];
  const errors = new WeakMap<object, number>();
  const decided = new WeakSet<object>();
  let rng: Rng | null = null;
  let shoppedFor = -1;

  return (game) => {
    rng ??= new Rng(game.seed * 31 + 7);
    // Shop once in the setup and once in each lull between waves.
    if (game.shopOpen && shoppedFor !== game.plan.number) {
      shoppedFor = game.plan.number;
      if (placement === 'planned') plannedShop(game);
      else if (placement === 'random') randomShop(game, rng);
      else cheapestShop(game);
    }
    if (game.phase === 'setup') {
      game.endSetup();
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
      let shot = { offset: 0, sweep: 0 };
      if (skill.aim && !('kind' in next.key && (next.key as { kind: string }).kind === 'grog')) {
        // The siege tower first, when there is one; otherwise the biggest block.
        const block = game.blocks.reduce<(typeof game.blocks)[number] | undefined>((a, b) => (!a || b.members.length > a.members.length ? b : a), undefined);
        const aim = game.tower ?? block;
        const k = next.key as { vx: number; vy: number };
        if (aim) shot = aimShot(game, next.x, Math.atan2(k.vx, -k.vy), aim.x, aim.y);
      }
      want = next.x - shot.offset * half * 0.9 + errors.get(next.key)!;
      // For English, wait to one side and run through the hit at full speed, allowing for the delay.
      if (shot.sweep) want -= shot.sweep * SWEEP_SHARE * skill.speed * Math.max(0, Math.min(SWEEP_SECONDS, next.eta - skill.delay));
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
  };
}

/** The three balance archetypes from the design brief. */
export const idleBot = (): Bot => paddleBot(IDLE, false);
export const averageBot = (): Bot => paddleBot(AVERAGE, true);
export const expertBot = (): Bot => paddleBot(EXPERT, true);
/** The placement pillar's test: expert shield play with defenders dropped anywhere. */
export const expertRandomBot = (): Bot => paddleBot(EXPERT, true, 'random');
