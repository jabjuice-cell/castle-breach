import { describe, expect, it } from 'vitest';
import { ballGeometry, ballVoxels, rockGeometry, rockVoxels } from '../src/render/voxelBalls';
import { buildShieldVox, SHIELD_SHAPE_H } from '../src/render/shield';

describe('voxel shield', () => {
  it('keeps the old proportions (a bit over half as tall as wide)', () => {
    expect(SHIELD_SHAPE_H).toBeGreaterThan(0.6);
    expect(SHIELD_SHAPE_H).toBeLessThan(0.65);
  });

  it('has its gold crest', () => {
    let n = 0;
    buildShieldVox().each((_x, _y, _z, c) => {
      if (c.c.r > 0.5 && c.c.g > 0.25 && c.c.b < 0.2) n++;
    });
    expect(n).toBeGreaterThan(20);
  });

  it('is the same every time it is built', () => {
    expect(buildShieldVox().size).toBe(buildShieldVox().size);
  });
});

describe('voxel balls and rocks', () => {
  it('draws the ball as a round blob of cubes that fits its physics radius', () => {
    const r = 0.5;
    const geo = ballGeometry(r);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(2 * r, 1);
    expect(box.max.y - box.min.y).toBeCloseTo(2 * r, 1);
    expect(ballVoxels().size).toBeGreaterThan(40);
  });

  it('makes each rock kind the height it is asked for, boulders biggest', () => {
    const height = (kind: 'rock' | 'boulder' | 'stone', h: number) => {
      const geo = rockGeometry(kind, h);
      geo.computeBoundingBox();
      return geo.boundingBox!.max.y - geo.boundingBox!.min.y;
    };
    expect(height('rock', 0.8)).toBeLessThanOrEqual(0.85);
    expect(height('boulder', 1.8)).toBeGreaterThan(height('rock', 0.8));
    expect(rockVoxels('boulder').size).toBeGreaterThan(rockVoxels('rock').size);
  });
});
