import * as THREE from 'three';

/**
 * A small voxel kit: build a model cell by cell (boxes, cylinders, cones, blobs), then
 * mesh it. Meshing keeps only the faces you can see, with a touch of ambient occlusion
 * in the corners, and merges many models into one draw. Cells marked glow (lit windows,
 * potions, embers) go in an unlit mesh so they shine at night and in shadow.
 */

export type Paint = THREE.ColorRepresentation | ((x: number, y: number, z: number) => THREE.ColorRepresentation | null);

interface Cell {
  c: THREE.Color;
  glow: boolean;
  /** Free for the model's own use (a tree marks its leaves, which can be knocked off). */
  tag: number;
}

const OFF = 512;
const key = (x: number, y: number, z: number) => ((x + OFF) * 1024 + (y + OFF)) * 1024 + (z + OFF);

/** A seeded random number source, so every model looks the same each time it is built. */
export function seeded(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed) % 2147483646);
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** c shaded by up to +-amount, from rnd. */
export function jitter(c: THREE.ColorRepresentation, amount: number, rnd: () => number): THREE.Color {
  const col = new THREE.Color(c);
  const k = 1 + (rnd() - 0.5) * 2 * amount;
  return col.multiplyScalar(k);
}

export class Vox {
  private cells = new Map<number, Cell & { x: number; y: number; z: number }>();
  glowNext = false;
  tagNext = 0;

  get size(): number {
    return this.cells.size;
  }

  set(x: number, y: number, z: number, color: THREE.ColorRepresentation, glow = this.glowNext, tag = this.tagNext): void {
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    this.cells.set(key(x, y, z), { x, y, z, c: new THREE.Color(color), glow, tag });
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(key(Math.round(x), Math.round(y), Math.round(z)));
  }

  del(x: number, y: number, z: number): void {
    this.cells.delete(key(Math.round(x), Math.round(y), Math.round(z)));
  }

  private paint(p: Paint, x: number, y: number, z: number): void {
    const c = typeof p === 'function' ? p(x, y, z) : p;
    if (c !== null && c !== undefined) this.set(x, y, z, c);
  }

  /** Fills a box, both corners included. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, p: Paint): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.paint(p, x, y, z);
      }
    }
  }

  /** Only the outside of a box: four walls (and a floor and lid if asked). */
  shell(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, p: Paint): void {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (x === x0 || x === x1 || z === z0 || z === z1) this.paint(p, x, y, z);
        }
      }
    }
  }

  /** An upright cylinder of radius r round (cx, cz), from y0 to y1. Hollow keeps only a 1-voxel skin. */
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, p: Paint, hollow = true): void {
    const R = Math.ceil(r);
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, z);
        if (d > r + 0.01) continue;
        if (hollow && d < r - 1.2) continue;
        for (let y = y0; y <= y1; y++) this.paint(p, cx + x, y, cz + z);
      }
    }
  }

  /** A cone roof: radius r at y0, narrowing to a point h voxels up. */
  cone(cx: number, cz: number, r: number, y0: number, h: number, p: Paint): void {
    for (let i = 0; i < h; i++) {
      const rr = r * (1 - i / h);
      this.cyl(cx, cz, Math.max(0.4, rr), y0 + i, y0 + i, p, true);
    }
  }

  /** A rounded blob (a tree crown, a boulder), with a ragged edge from rnd. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, p: Paint, rnd: () => number, rough = 0.25): void {
    const X = Math.ceil(rx);
    const Y = Math.ceil(ry);
    const Z = Math.ceil(rz);
    for (let x = -X; x <= X; x++) {
      for (let y = -Y; y <= Y; y++) {
        for (let z = -Z; z <= Z; z++) {
          const d = (x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2;
          if (d <= 1 - rough * rnd()) this.paint(p, cx + x, cy + y, cz + z);
        }
      }
    }
  }

  /** A pitched roof along x: eaves at y0 on both z sides, rising to a ridge. */
  gable(x0: number, x1: number, z0: number, z1: number, y0: number, p: Paint, gableEnds: Paint | null = null): void {
    const half = Math.ceil((z1 - z0) / 2);
    for (let i = 0; i <= half; i++) {
      const y = y0 + i;
      for (let x = x0; x <= x1; x++) {
        this.paint(p, x, y, z0 + i);
        this.paint(p, x, y, z1 - i);
      }
      // Fill the triangle under the roof at each end.
      if (gableEnds) {
        for (let z = z0 + i + 1; z < z1 - i; z++) {
          this.paint(gableEnds, x0 + 1, y, z);
          this.paint(gableEnds, x1 - 1, y, z);
        }
      }
    }
  }

  /** Every cell, for models that are drawn voxel by voxel (trees that can be chipped). */
  each(fn: (x: number, y: number, z: number, cell: Cell) => void): void {
    for (const c of this.cells.values()) fn(c.x, c.y, c.z, c);
  }

  /** True when all six neighbours are filled: the cell can never be seen. */
  buried(x: number, y: number, z: number): boolean {
    return this.has(x + 1, y, z) && this.has(x - 1, y, z) && this.has(x, y + 1, z) && this.has(x, y - 1, z) && this.has(x, y, z + 1) && this.has(x, y, z - 1);
  }

  /** Adds this model's visible faces to a batch: voxel size, where its (0, 0, 0) goes, and a turn round y. */
  meshInto(batch: VoxBatch, size: number, at: THREE.Vector3, turn = 0): void {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const has = (x: number, y: number, z: number) => this.cells.has(key(x, y, z));
    for (const cell of this.cells.values()) {
      const { x, y, z } = cell;
      for (const f of FACES) {
        if (has(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
        const out = cell.glow ? batch.glow : batch.solid;
        const base = out.pos.length / 3;
        for (const v of f.v) {
          // Ambient occlusion: darken a corner by how many of the three cells round it (outside the face) are filled.
          const s1 = has(x + f.n[0] + v.a[0], y + f.n[1] + v.a[1], z + f.n[2] + v.a[2]);
          const s2 = has(x + f.n[0] + v.b[0], y + f.n[1] + v.b[1], z + f.n[2] + v.b[2]);
          const cr = has(x + f.n[0] + v.a[0] + v.b[0], y + f.n[1] + v.a[1] + v.b[1], z + f.n[2] + v.a[2] + v.b[2]);
          const occ = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (cr ? 1 : 0);
          const shade = cell.glow ? 1 : 1 - occ * 0.14;
          const lx = (x + v.p[0]) * size;
          const ly = (y + v.p[1]) * size;
          const lz = (z + v.p[2]) * size;
          out.pos.push(at.x + lx * cs + lz * sn, at.y + ly, at.z - lx * sn + lz * cs);
          out.nor.push(f.n[0] * cs + f.n[2] * sn, f.n[1], -f.n[0] * sn + f.n[2] * cs);
          out.col.push(cell.c.r * shade, cell.c.g * shade, cell.c.b * shade);
        }
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
}

/** The six faces of a unit cube: outward normal, then its four corners (with the two in-plane neighbours of each corner, for occlusion). */
type V3 = [number, number, number];
const FACES: { n: V3; v: { p: V3; a: V3; b: V3 }[] }[] = (() => {
  const faces: { n: V3; v: { p: V3; a: V3; b: V3 }[] }[] = [];
  const dirs: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of dirs) {
    const axis = n.findIndex((v) => v !== 0);
    const [u, w] = [0, 1, 2].filter((i) => i !== axis);
    const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // Wind the corners counter-clockwise seen from outside.
    if ((n[axis] > 0) === (axis === 1)) corners.reverse();
    const v = corners.map(([cu, cw]) => {
      const p: V3 = [0, 0, 0];
      p[axis] = n[axis] > 0 ? 1 : 0;
      p[u] = cu;
      p[w] = cw;
      const a: V3 = [0, 0, 0];
      a[u] = cu ? 1 : -1;
      const b: V3 = [0, 0, 0];
      b[w] = cw ? 1 : -1;
      return { p, a, b };
    });
    faces.push({ n, v });
  }
  return faces;
})();

interface Buffers {
  pos: number[];
  nor: number[];
  col: number[];
  idx: number[];
}

/** Collects many models into one lit mesh and one glowing mesh. */
export class VoxBatch {
  solid: Buffers = { pos: [], nor: [], col: [], idx: [] };
  glow: Buffers = { pos: [], nor: [], col: [], idx: [] };

  add(v: Vox, size: number, at: THREE.Vector3, turn = 0): this {
    v.meshInto(this, size, at, turn);
    return this;
  }

  private static geometry(b: Buffers): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    if (this.solid.idx.length) group.add(new THREE.Mesh(VoxBatch.geometry(this.solid), new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (this.glow.idx.length) group.add(new THREE.Mesh(VoxBatch.geometry(this.glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
    return group;
  }
}
