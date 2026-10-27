/**
 * Pinball fixtures on the field that a ball can be aimed into (the layout; sizes and tuning
 * live in config.ts under contraptions):
 * - bumper: a royal shield on a spring that kicks the ball away.
 * - bell: ring all of a group (three) and the castle looses a free volley; the bells then reset.
 * - ramp: a broken siege ramp (box: hw, hh, angle as for obstacles) that flings a ball up the field.
 *
 * Orcs go round bumpers and bells. Everything stays off the road down the middle
 * (|x| >= 6, and x = 0 stays clear on levels 2 and 3) and clear of the level's obstacles.
 */
import type { Obstacle } from './obstacles';

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

/** The fixtures on each level's field (index = level). */
export const LEVEL_CONTRAPTIONS: Contraption[][] = [
  // The Old Road: two bumpers and a trio of bells in the far right corner.
  [
    { kind: 'bumper', x: -7.5, y: 26 },
    { kind: 'bumper', x: 8, y: 40 },
    { kind: 'bell', x: 12, y: 50, group: 0 },
    { kind: 'bell', x: 15, y: 52, group: 0 },
    { kind: 'bell', x: 18, y: 50, group: 0 },
  ],
  // Mill Ford: a broken ramp to the left of the road, a bell trio to the right, a bumper pair out wide.
  [
    { kind: 'ramp', x: -9, y: 22, hw: 2.2, hh: 1.6, angle: 0 },
    { kind: 'bell', x: 10, y: 44, group: 0 },
    { kind: 'bell', x: 13.5, y: 46, group: 0 },
    { kind: 'bell', x: 17, y: 44, group: 0 },
    { kind: 'bumper', x: -22, y: 30 },
    { kind: 'bumper', x: -19, y: 34 },
  ],
  // The Black Gate: everything, in awkward spots; the bells hug the left tree line.
  [
    { kind: 'ramp', x: 11, y: 26, hw: 2, hh: 1.5, angle: -0.25 },
    { kind: 'bumper', x: -11, y: 29 },
    { kind: 'bumper', x: 23, y: 40 },
    { kind: 'bumper', x: 15, y: 49 },
    { kind: 'bell', x: -24.5, y: 40, group: 0 },
    { kind: 'bell', x: -22.5, y: 46, group: 0 },
    { kind: 'bell', x: -25, y: 52, group: 0 },
  ],
];
