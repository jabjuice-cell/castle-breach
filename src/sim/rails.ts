/**
 * Orbit rails (Jonny, 7 Nov: "a ramp and rail that goes out round the trees"): a raised track a ball can be
 * shot into. It runs out over the tree line, up the outside of the field, across behind the orc camp and back
 * in on the far side, where it drops the ball heading down at the orcs' backs. Pure geometry, no rendering.
 */

export interface Rail {
  /** -1 enters on the left, +1 on the right. */
  side: number;
  /** Points along the track (x across the field, y up it), from the mouth to the exit. */
  pts: { x: number; y: number }[];
  /** Distance along the track at each point. */
  at: number[];
  length: number;
  /** Height of the track above the ground (the second rail rides a little higher, to cross over the first). */
  height: number;
}

export interface RailRules { count: number; entryY: number; inset: number; outside: number; height: number }

/** A smooth curve through the control points (Catmull-Rom), steps samples per span. */
function smooth(ctrl: { x: number; y: number }[], steps: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const p = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (u: number, v: number, w: number, z: number) => 0.5 * (2 * v + (-u + w) * t + (2 * u - 5 * v + 4 * w - z) * t2 + (-u + 3 * v - 3 * w + z) * t3);
      out.push({ x: f(a.x, b.x, c.x, d.x), y: f(a.y, b.y, c.y, d.y) });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** The field's rails: none, the left one, or both. */
export function buildRails(rules: RailRules, halfWidth: number, topY: number): Rail[] {
  const rails: Rail[] = [];
  for (let i = 0; i < Math.min(2, rules.count); i++) {
    const side = i === 0 ? -1 : 1;
    const hw = halfWidth;
    const out = hw + rules.outside;
    const ctrl = [
      { x: side * (hw - rules.inset), y: rules.entryY },
      { x: side * (hw + 0.6), y: rules.entryY + 5 },
      { x: side * out, y: rules.entryY + 12 },
      { x: side * out, y: topY - 2 },
      { x: side * hw * 0.55, y: topY + 3 + i },
      { x: -side * hw * 0.55, y: topY + 3 + i },
      { x: -side * out, y: topY - 4 },
      { x: -side * (hw + 0.4), y: topY - 9 },
      { x: -side * (hw - rules.inset - 1.5), y: topY - 14 },
    ];
    const pts = smooth(ctrl, 10);
    const at = [0];
    for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    rails.push({ side, pts, at, length: at[at.length - 1], height: rules.height + i * 0.9 });
  }
  return rails;
}

/** The point s along a rail, and the unit direction of travel there. */
export function railAt(r: Rail, s: number): { x: number; y: number; dx: number; dy: number } {
  const d = Math.max(0, Math.min(r.length, s));
  let k = 1;
  while (k < r.at.length - 1 && r.at[k] < d) k++;
  const a = r.pts[k - 1];
  const b = r.pts[k];
  const span = r.at[k] - r.at[k - 1] || 1;
  const t = (d - r.at[k - 1]) / span;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
}
