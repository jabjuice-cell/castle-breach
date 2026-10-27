/**
 * Real structures standing on the field: boulders, ruins, a well, standing stones.
 * Balls bounce off them (a bank shot) and orcs have to go round them. Level 1 starts
 * with a couple of simple rocks; later levels get more, and more awkward, shapes.
 *
 * A round one has r; a box has a half width hw, half height hh (along y) and an angle
 * (radians, turning x toward y).
 */

export type ObstacleLook = 'boulder' | 'milestone' | 'mill' | 'well' | 'fence' | 'stone' | 'ruin' | 'spikes' | 'tree' | 'barricade' | 'rubble';

export interface Obstacle {
  look: ObstacleLook;
  x: number;
  y: number;
  r?: number;
  hw?: number;
  hh?: number;
  angle?: number;
  /** Goes down to one hit from a ball (a tree), and is then gone for the rest of the level. Every obstacle breaks, but see needsHeave. */
  breakable?: boolean;
  down?: boolean;
  /** Player-placed terrain (War Council): takes maxHits ball hits before it goes down. */
  placed?: boolean;
  hits?: number;
  maxHits?: number;
  /** A placed piece the player took back: kept in the list (the render keys by index) but gone for good. */
  removed?: boolean;
}

/** Stone structures only break to a heaved (charged) ball; the rest go down to any hit. */
export function needsHeave(o: Obstacle): boolean {
  return o.look === 'stone' || o.look === 'ruin';
}

/** The point of o's outline nearest (px, py), and whether (px, py) is inside it. */
export function nearestOn(o: Obstacle, px: number, py: number): { x: number; y: number; inside: boolean } {
  if (o.r !== undefined) {
    const dx = px - o.x;
    const dy = py - o.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    return { x: o.x + (dx / d) * o.r, y: o.y + (dy / d) * o.r, inside: d < o.r };
  }
  const c = Math.cos(o.angle ?? 0);
  const s = Math.sin(o.angle ?? 0);
  // Into the box's own frame.
  const lx = (px - o.x) * c + (py - o.y) * s;
  const ly = -(px - o.x) * s + (py - o.y) * c;
  const hw = o.hw ?? 1;
  const hh = o.hh ?? 1;
  const inside = Math.abs(lx) < hw && Math.abs(ly) < hh;
  let qx = Math.max(-hw, Math.min(hw, lx));
  let qy = Math.max(-hh, Math.min(hh, ly));
  if (inside) {
    // Out through the nearest side.
    if (hw - Math.abs(lx) < hh - Math.abs(ly)) qx = Math.sign(lx || 1) * hw;
    else qy = Math.sign(ly || 1) * hh;
  }
  return { x: o.x + qx * c - qy * s, y: o.y + qx * s + qy * c, inside };
}

/**
 * Where a circle of radius r at (px, py) touches o: the push out (a unit normal and how deep
 * it is in), or null if it is clear.
 */
export function contact(o: Obstacle, px: number, py: number, r: number): { nx: number; ny: number; depth: number } | null {
  // A cheap reject first.
  const reach = (o.r ?? Math.hypot(o.hw ?? 1, o.hh ?? 1)) + r;
  if (Math.abs(px - o.x) > reach || Math.abs(py - o.y) > reach) return null;
  const q = nearestOn(o, px, py);
  const dx = px - q.x;
  const dy = py - q.y;
  const d = Math.hypot(dx, dy);
  if (!q.inside && d >= r) return null;
  if (d < 1e-6) {
    const ox = px - o.x;
    const oy = py - o.y;
    const od = Math.hypot(ox, oy) || 1;
    return { nx: ox / od, ny: oy / od, depth: r };
  }
  const sign = q.inside ? -1 : 1;
  return { nx: (sign * dx) / d, ny: (sign * dy) / d, depth: q.inside ? r + d : r - d };
}

/** The structures on each level's field (index = level). The siege tower comes down the middle, so x 0 stays clear on levels 2 and 3. */
export const LEVEL_OBSTACLES: Obstacle[][] = [
  // The Old Road: a couple of boulders and an old milestone, off the road.
  [
    { look: 'boulder', x: -12.5, y: 34, r: 1.6 },
    { look: 'boulder', x: 12, y: 25, r: 1.3 },
    { look: 'milestone', x: 4.5, y: 46, r: 0.6 },
  ],
  // Mill Ford (a wider field): a ruined mill, a well and a broken fence, set at angles.
  [
    { look: 'mill', x: -16, y: 40, hw: 2.6, hh: 1.6, angle: 0.3 },
    { look: 'well', x: 6.5, y: 30, r: 1.1 },
    { look: 'fence', x: 18, y: 20, hw: 2.4, hh: 0.3, angle: -0.5 },
    { look: 'boulder', x: -6.5, y: 51, r: 1.2 },
    { look: 'boulder', x: 20, y: 47, r: 1 },
  ],
  // The Black Gate (a wider field): standing stones and slanted ruined walls that throw the ball about.
  [
    { look: 'stone', x: -5, y: 22, r: 0.8 },
    { look: 'stone', x: 5, y: 22, r: 0.8 },
    { look: 'ruin', x: -17, y: 33, hw: 3, hh: 0.6, angle: 0.6 },
    { look: 'ruin', x: 17, y: 33, hw: 3, hh: 0.6, angle: -0.6 },
    { look: 'spikes', x: -8, y: 45, hw: 1.8, hh: 0.5, angle: -0.35 },
    { look: 'spikes', x: 8, y: 45, hw: 1.8, hh: 0.5, angle: 0.35 },
    { look: 'stone', x: -21, y: 52, r: 1.1 },
    { look: 'stone', x: 21, y: 54, r: 1.1 },
  ],
];

/**
 * The trees dotted over a level's field, placed by the seed: off the road, clear of the
 * level's structures and of each other. Each comes down to a single hit.
 */
export function plantTrees(
  t: { counts: number[]; radius: number; minY: number; maxY: number; roadHalf: number; apart: number },
  level: number, halfWidth: number, seed: number, around: Obstacle[],
): Obstacle[] {
  let s = Math.max(1, Math.floor(seed * 7907 + level * 104723) % 2147483646);
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const n = t.counts[Math.min(level, t.counts.length - 1)] ?? 0;
  const out: Obstacle[] = [];
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const x = (rnd() * 2 - 1) * (halfWidth - 3);
    const y = t.minY + rnd() * (t.maxY - t.minY);
    if (Math.abs(x) < t.roadHalf) continue;
    if (around.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r ?? Math.hypot(o.hw ?? 1, o.hh ?? 1)) + t.apart * 0.6)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < t.apart)) continue;
    out.push({ look: 'tree', x, y, r: t.radius, breakable: true });
  }
  return out;
}
