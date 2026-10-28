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

export type ContraptionKind = 'bumper' | 'bell' | 'ramp';

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
  if (c.kind === 'ramp') return { look: 'ruin', x: c.x, y: c.y, hw: c.hw ?? 2, hh: c.hh ?? 1.5, angle: c.angle ?? 0 };
  return { look: 'stone', x: c.x, y: c.y, r: c.kind === 'bumper' ? t.bumper.radius : t.bell.radius };
}

export type LayoutCounts = Record<ContraptionKind, number>;

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

export interface LayoutField {
  halfWidth: number;
  /** The coming wave's orc routes (points down the field), traced round the field's structures. */
  routes: { x: number; y: number }[][];
  /** Everything already standing: pieces keep their own reach plus a little clear of these. */
  solid: Obstacle[];
  radius: { bumper: { radius: number }; bell: { radius: number } };
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
  const place = (kind: ContraptionKind, centre: boolean): boolean => {
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
      const a = { kind, x: -x, y, ...extra };
      const b = { kind, x, y, ...extra };
      if (!fits(a) || !fits(b)) continue;
      add([a, b]);
      return true;
    }
    return false;
  };
  // Ramps first (they have their own band), then the bells (a set needs all of them), then the bumpers.
  for (const kind of ['ramp', 'bell', 'bumper'] as const) {
    const n = counts[kind] ?? 0;
    if (n % 2) place(kind, true);
    for (let i = 0; i < Math.floor(n / 2); i++) place(kind, false);
  }
  return out;
}
