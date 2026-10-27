import * as THREE from 'three';
import { jitter, seeded, Vox, VoxBatch } from './voxels';

/**
 * Chunky voxel shapes for the balls and thrown rocks. They only change how things look:
 * the physics still treats every ball as a circle and every rock as a point.
 */

export type RockKind = 'rock' | 'boulder' | 'stone';

/** A model's geometry, centred on its middle and scaled so the whole thing is `height` tall. */
function centred(v: Vox, rowsTall: number, height: number): THREE.BufferGeometry {
  const size = height / rowsTall;
  const batch = new VoxBatch();
  // Cell (0, 0, 0) spans 0..size, so shift by half a cell to put the model's middle on the origin.
  v.meshInto(batch, size, new THREE.Vector3(-size / 2, -size / 2, -size / 2));
  return batch.geometries().solid ?? new THREE.BufferGeometry();
}

/** A ball: a lumpy sphere of cubes, pale so the instance colour tints it, with a darker band and a bright top. */
export function ballVoxels(): Vox {
  const v = new Vox();
  const rnd = seeded(41);
  const R = 2.2;
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      for (let z = -3; z <= 3; z++) {
        if (Math.hypot(x, y, z) > R + 0.15) continue;
        let k = 0.8 + 0.2 * (y / R) + (rnd() - 0.5) * 0.1;
        if (y === 0) k *= 0.82;
        if (y >= 1 && x <= 0 && z >= 1) k += 0.16;
        v.set(x, y, z, new THREE.Color().setScalar(Math.min(1, k)));
      }
    }
  }
  return v;
}

/** The ball's geometry, its outer radius r. */
export function ballGeometry(r: number): THREE.BufferGeometry {
  return centred(ballVoxels(), 5, r * 2);
}

const ROCK_LOOK: Record<RockKind, { r: [number, number, number]; colors: string[]; seed: number; rough: number }> = {
  rock: { r: [1.7, 1.4, 1.6], colors: ['#8a7a66', '#7a6c5a', '#6a5e50', '#9a8a74'], seed: 5, rough: 0.35 },
  boulder: { r: [3.6, 3, 3.4], colors: ['#8d8a84', '#7a7771', '#6a6761', '#a09d96'], seed: 9, rough: 0.3 },
  stone: { r: [2.2, 1.7, 2.2], colors: ['#a3a19c', '#8b8a85', '#6e6c68', '#b4b2ac'], seed: 13, rough: 0.5 },
};

/** A lumpy chunk of rock, with lighter tops and darker undersides. */
export function rockVoxels(kind: RockKind): Vox {
  const look = ROCK_LOOK[kind];
  const rnd = seeded(look.seed);
  const v = new Vox();
  const [rx, ry, rz] = look.r;
  v.blob(0, 0, 0, rx, ry, rz, (_x, y) => {
    const c = jitter(look.colors[Math.floor(rnd() * look.colors.length)], 0.08, rnd);
    return c.multiplyScalar(0.82 + 0.28 * (y / ry + 1) * 0.5);
  }, rnd, look.rough);
  return v;
}

/** Rock geometry: `height` is how tall it is drawn in world units. */
export function rockGeometry(kind: RockKind, height: number): THREE.BufferGeometry {
  return centred(rockVoxels(kind), 2 * Math.ceil(ROCK_LOOK[kind].r[1]) + 1, height);
}

/** Colours for voxel debris when a rock bursts. */
export const ROCK_DEBRIS = ['#8a7a66', '#7a6c5a', '#8d8a84', '#a3a19c', '#6a5e50'];
