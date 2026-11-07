/**
 * Pinball fixtures on the field that a ball can be aimed into (sizes and tuning live in config.ts under contraptions):
 * - bumper: a royal shield on a spring that kicks the ball away.
 * - bell: ring all of a group (three) and the castle looses a free volley; the bells then reset.
 * - ramp: a broken siege ramp (box: hw, hh, angle as for obstacles) that flings a ball up the field.
 *
 * Orcs go round bumpers and bells. Each wave gets a fresh layout (generateLayout), mirrored about x = 0.
 */
import { type Obstacle } from './obstacles';
import { Rng } from './rng';

export type ContraptionKind = 'bumper' | 'bell' | 'ramp' | 'target';

export interface Contraption {
  kind: ContraptionKind;
  x: number;
  y: number;
  /** Bells ring together: the bells sharing a group number make one set. */
  group?: number;
  hw?: number;
  hh?: number;
  angle?: number;
}

/** What a ball and an orc bump into: a contraption's outline as an obstacle shape. */
export function footprint(c: Contraption, t: { bumper: { radius: number }; bell: { radius: number } }): Obstacle {
  if (c.kind === 'ramp' || c.kind === 'target') return { look: 'ruin', x: c.x, y: c.y, hw: c.hw ?? 2, hh: c.hh ?? 1.5, angle: c.angle ?? 0 };
  return { look: 'stone', x: c.x, y: c.y, r: c.kind === 'bumper' ? t.bumper.radius : t.bell.radius };
}

export type LayoutCounts = Record<ContraptionKind, number>;

/** A bank of drop targets: count pieces side by side, gap apart, centred on x. */
export function targetBank(x: number, y: number, group: number, t: { count: number; hw: number; hh: number; gap: number }): Contraption[] {
  return Array.from({ length: t.count }, (_, i) => ({ kind: 'target' as const, x: x + (i - (t.count - 1) / 2) * t.gap, y, group, hw: t.hw, hh: t.hh, angle: 0 }));
}

/**
 * Where the pieces may go (config contraptions.layout): bumpers and bells between minY and maxY (the back of the
 * field), apart from each other's centres, routeClear clear of an orc route beyond their own radius, edge off the
 * tree lines. Ramps sit between rampMinY and rampMaxY, pointing straight up the field.
 */
export interface LayoutRules {
  counts: LayoutCounts[];
  minY: number;
  maxY: number;
  apart: number;
  routeClear: number;
  edge: number;
  rampMinY: number;
  rampMaxY: number;
  ramp: { hw: number; hh: number };
  tries: number;
}

/** Drop-target bank sizes, for the layout (config contraptions.target). */
export interface TargetRules { count: number; hw: number; hh: number; gap: number }

export interface LayoutField {
  halfWidth: number;
  /** The coming wave's orc routes (points down the field), traced round the field's structures. */
  routes: { x: number; y: number }[][];
  /** Everything already standing: pieces keep their own reach plus a little clear of these. */
  solid: Obstacle[];
  radius: { bumper: { radius: number }; bell: { radius: number } };
  /** Drop-target banks: their size (needed only when the counts ask for targets). */
  target?: TargetRules;
  /** Rail mouths and anything else to keep clear of. */
  avoid?: Obstacle[];
}

const reach = (o: { r?: number; hw?: number; hh?: number }) => o.r ?? Math.hypot(o.hw ?? 1, o.hh ?? 1);

/** Distance from (x, y) to the nearest route point near that height. */
export function routeGap(routes: { x: number; y: number }[][], x: number, y: number): number {
  let best = Infinity;
  for (const pts of routes) for (const p of pts) if (Math.abs(p.y - y) < 4) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  return best;
}

/** The rng for a wave's layout: its own stream, so the battle's rng is untouched. */
export function layoutRng(seed: number, wave: number): Rng {
  return new Rng(seed * 7919 + wave * 131 + 3);
}

/**
 * A mirror-symmetric layout: pairs at (+-x, y), and the odd one of each kind on x = 0 (bumpers and bells only
 * when no route comes down the middle there). A piece that cannot be placed after rules.tries attempts is left out.
 */
export function generateLayout(rng: Rng, counts: LayoutCounts, rules: LayoutRules, field: LayoutField): Contraption[] {
  const out: Contraption[] = [];
  const shapes: Obstacle[] = [];
  const hw = field.halfWidth;
  const fits = (c: Contraption): boolean => {
    const s = footprint(c, field.radius);
    const r = reach(s);
    if (Math.abs(c.x) + r > hw - rules.edge) return false;
    if (field.solid.some((o) => !o.removed && Math.hypot(o.x - c.x, o.y - c.y) < reach(o) + r + 0.5)) return false;
    if (field.avoid?.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < reach(o) + r + 1)) return false;
    if (shapes.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < Math.max(rules.apart, reach(o) + r + 0.5))) return false;
    // Orcs walk over a ramp, so only bumpers and bells keep off the routes.
    return c.kind === 'ramp' || routeGap(field.routes, c.x, c.y) >= r + rules.routeClear;
  };
  const add = (cs: Contraption[]) => {
    for (const c of cs) {
      out.push(c);
      shapes.push(footprint(c, field.radius));
    }
  };
  /** Tries to put down a mirrored pair (or one piece on x = 0); false if nothing fits. */
  const place = (kind: ContraptionKind, centre: boolean, single = false): boolean => {
    const ramp = kind === 'ramp';
    const [lo, hi] = ramp ? [rules.rampMinY, rules.rampMaxY] : [rules.minY, rules.maxY];
    const extra: Partial<Contraption> = ramp ? { hw: rules.ramp.hw, hh: rules.ramp.hh, angle: 0 } : kind === 'bell' ? { group: 0 } : {};
    for (let t = 0; t < rules.tries; t++) {
      const y = rng.range(lo, hi);
      if (centre) {
        const c = { kind, x: 0, y, ...extra };
        if (!fits(c)) continue;
        add([c]);
        return true;
      }
      const x = rng.range(rules.apart / 2, hw - rules.edge);
      if (single) {
        // A lone piece the middle road won't take: one side, picked at random.
        const c = { kind, x: rng.range(0, 1) < 0.5 ? -x : x, y, ...extra };
        if (!fits(c)) continue;
        add([c]);
        return true;
      }
      const a = { kind, x: -x, y, ...extra };
      const b = { kind, x, y, ...extra };
      if (!fits(a) || !fits(b)) continue;
      add([a, b]);
      return true;
    }
    return false;
  };
  /** A bank of drop targets (or a mirrored pair of banks): every piece of a bank has to fit. */
  const bank = (centre: boolean, group: number, single = false): boolean => {
    const t = field.target;
    if (!t) return false;
    const halfSpan = ((t.count - 1) / 2) * t.gap + t.hw;
    for (let tries = 0; tries < rules.tries; tries++) {
      const y = rng.range(rules.minY, rules.maxY);
      const x = centre ? 0 : rng.range(halfSpan + rules.apart / 2, hw - rules.edge - halfSpan);
      // A lone bank that can't sit on the road in the middle goes to one side.
      const side = single && rng.range(0, 1) < 0.5 ? -1 : 1;
      const a = targetBank(centre ? 0 : single ? side * x : -x, y, group, t);
      const b = centre || single ? [] : targetBank(x, y, group + 1, t);
      if (![...a, ...b].every(fits)) continue;
      add([...a, ...b]);
      return true;
    }
    return false;
  };
  // Target banks (wide, so first), ramps (their own band), then the bells (a set needs all of them), then the bumpers.
  const banks = counts.target ?? 0;
  let group = 100;
  // Where a mirrored pair won't fit, two lone pieces are tried; where the middle won't take one, a side does.
  if (banks % 2 && !bank(true, (group += 2))) bank(false, group, true);
  for (let i = 0; i < Math.floor(banks / 2); i++) {
    if (bank(false, (group += 2))) continue;
    bank(false, group, true);
    bank(false, group + 1, true);
  }
  for (const kind of ['ramp', 'bell', 'bumper'] as const) {
    const n = counts[kind] ?? 0;
    if (n % 2 && !place(kind, true) && kind !== 'bell') place(kind, false, true);
    for (let i = 0; i < Math.floor(n / 2); i++) {
      if (place(kind, false) || kind === 'bell') continue;
      place(kind, false, true);
      place(kind, false, true);
    }
  }
  return out;
}
