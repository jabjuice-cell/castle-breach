import * as THREE from 'three';
import { atRes, jitter, seeded, Vox, VoxBatch } from './voxels';

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
  if (v.res > 1) return fineBall(v, rnd);
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

/**
 * The finer ball (High detail): a true sphere of small cells, the same 5 voxels across, with a thin seam
 * round its middle studded with eight rivets, and a soft bright spot up on the top left.
 */
function fineBall(v: Vox, rnd: () => number): Vox {
  const R = 2.5;
  const h = 1 / v.res;
  for (let x = -3; x < 3; x += h) {
    for (let y = -3; y < 3; y += h) {
      for (let z = -3; z < 3; z += h) {
        // This small cell's middle, from the ball's middle (the middle of voxel 0).
        const [px, py, pz] = [x + h / 2 - 0.5, y + h / 2 - 0.5, z + h / 2 - 0.5];
        const d = Math.hypot(px, py, pz);
        if (d > R - h / 2) continue;
        let k = 0.8 + 0.2 * (py / R) + (rnd() - 0.5) * 0.08;
        if (py < 0 && py > -h) k *= 0.78;
        const shine = Math.hypot(px + 1, py - 1.5, pz - 1.3);
        if (shine < 1.4) k += 0.2 * (1 - shine / 1.4);
        v.dot(x, y, z, new THREE.Color().setScalar(Math.min(1, k)));
      }
    }
  }
  // Each rivet sits in the first empty cell out from the middle along its direction, on the seam's row.
  const y = 0.5 - h;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (let d = 1; d < 4; d += h / 2) {
      const x = Math.floor((Math.cos(a) * d + 0.5) / h) * h;
      const z = Math.floor((Math.sin(a) * d + 0.5) / h) * h;
      if (v.hasDot(x, y, z)) continue;
      v.dot(x, y, z, new THREE.Color().setScalar(0.95));
      break;
    }
  }
  return v;
}

/** The ball's geometry, its outer radius r; res 2 builds it from half-size voxels (High detail). */
export function ballGeometry(r: number, res = 1): THREE.BufferGeometry {
  return centred(atRes(res, ballVoxels), 5, r * 2);
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
  // A finer rock keeps one colour per whole voxel, so it reads as the same stones, only rounder.
  const picked = new Map<string, THREE.Color>();
  v.blob(0, 0, 0, rx, ry, rz, (x, y, z) => {
    const k = `${x},${y},${z}`;
    let c = v.res > 1 ? picked.get(k) : undefined;
    if (!c) {
      c = jitter(look.colors[Math.floor(rnd() * look.colors.length)], 0.08, rnd).multiplyScalar(0.82 + 0.28 * (y / ry + 1) * 0.5);
      if (v.res > 1) picked.set(k, c);
    }
    return c;
  }, rnd, look.rough);
  if (v.res > 1) {
    // Finer rock: pale flecks in the stone and a dark crack or two across the top.
    v.each((x, y, z, c) => {
      if (rnd() < 0.06) c.c = c.c.clone().multiplyScalar(1.25);
      else if (y > 0 && Math.abs(x * 0.7 - z + 0.3) < 0.26 && rnd() < 0.7) c.c = c.c.clone().multiplyScalar(0.62);
    });
  }
  return v;
}

/** Rock geometry: `height` is how tall it is drawn in world units. */
export function rockGeometry(kind: RockKind, height: number, res = 1): THREE.BufferGeometry {
  return centred(atRes(res, () => rockVoxels(kind)), 2 * Math.ceil(ROCK_LOOK[kind].r[1]) + 1, height);
}

/** Colours for voxel debris when a rock bursts. */
export const ROCK_DEBRIS = ['#8a7a66', '#7a6c5a', '#8d8a84', '#a3a19c', '#6a5e50'];
