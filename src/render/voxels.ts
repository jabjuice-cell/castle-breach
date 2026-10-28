import * as THREE from 'three';

/**
 * A small voxel kit: build a model cell by cell (boxes, cylinders, cones, blobs), then
 * mesh it. Meshing keeps only the faces you can see, with a touch of ambient occlusion
 * in the corners, and merges many models into one draw. Cells marked glow (lit windows,
 * potions, embers) go in an unlit mesh so they shine at night and in shadow.
 */

/**
 * A colour for a voxel, or a function of its (whole) voxel coordinates. On a finer model it is asked once per
 * small cell: `at` is that cell's centre in voxel units (the same as x, y, z on a model of resolution 1), so a
 * round or striped pattern can follow the finer grid.
 */
export type Paint = THREE.ColorRepresentation | ((x: number, y: number, z: number, at: THREE.Vector3) => THREE.ColorRepresentation | null);

interface Cell {
  c: THREE.Color;
  glow: boolean;
  /** Free for the model's own use (a tree marks its leaves, which can be knocked off). */
  tag: number;
}

const OFF = 512;
const key = (x: number, y: number, z: number) => ((x + OFF) * 1024 + (y + OFF)) * 1024 + (z + OFF);
const tmpAt = new THREE.Vector3();

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

let buildRes = 1;

/**
 * Builds models at a resolution: every Vox made inside `make` has `res` small cells per voxel along each
 * axis (2 on High detail: voxels half the size, the model the same size overall), and comes out with its
 * edges rounded off.
 */
export function atRes<T extends Vox>(res: number, make: () => T): T {
  const was = buildRes;
  buildRes = res;
  try {
    const v = make();
    return res > 1 ? (v.soften() as T) : v;
  } finally {
    buildRes = was;
  }
}

export class Vox {
  /**
   * Small cells per voxel along each axis. Models are written in whole voxels whatever this is; on a finer
   * model, boxes fill res x res x res cells, round shapes are traced on the finer grid, and dot() places
   * a single small cell (a rivet, a pupil, a blade's edge) at a half-voxel position.
   */
  readonly res: number;
  /** Cells by small-cell coordinates. */
  private cells = new Map<number, Cell & { x: number; y: number; z: number }>();
  glowNext = false;
  tagNext = 0;

  /** A model at the resolution being built (see atRes), or at res. */
  constructor(res = buildRes) {
    this.res = res;
  }

  /** How many small cells the model has. */
  get size(): number {
    return this.cells.size;
  }

  private put(x: number, y: number, z: number, c: THREE.Color, glow: boolean, tag: number): void {
    this.cells.set(key(x, y, z), { x, y, z, c, glow, tag });
  }

  private hasCell(x: number, y: number, z: number): boolean {
    return this.cells.has(key(x, y, z));
  }

  set(x: number, y: number, z: number, color: THREE.ColorRepresentation, glow = this.glowNext, tag = this.tagNext): void {
    const n = this.res;
    const c = new THREE.Color(color);
    x = Math.round(x) * n;
    y = Math.round(y) * n;
    z = Math.round(z) * n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) this.put(x + i, y + j, z + k, c, glow, tag);
  }

  /**
   * One small cell at (x, y, z) in voxel units, which may be halves on a finer model: the cell whose corner
   * is there. On a model of resolution 1 it fills the whole voxel, so callers keep it to res > 1.
   */
  dot(x: number, y: number, z: number, color: THREE.ColorRepresentation, glow = this.glowNext, tag = this.tagNext): void {
    const n = this.res;
    this.put(Math.floor(x * n + 1e-6), Math.floor(y * n + 1e-6), Math.floor(z * n + 1e-6), new THREE.Color(color), glow, tag);
  }

  /** Clears one small cell (voxel units, as dot()). */
  undot(x: number, y: number, z: number): void {
    const n = this.res;
    this.cells.delete(key(Math.floor(x * n + 1e-6), Math.floor(y * n + 1e-6), Math.floor(z * n + 1e-6)));
  }

  /** True when the small cell at (x, y, z) (voxel units, as dot()) is filled. */
  hasDot(x: number, y: number, z: number): boolean {
    const n = this.res;
    return this.hasCell(Math.floor(x * n + 1e-6), Math.floor(y * n + 1e-6), Math.floor(z * n + 1e-6));
  }

  /** True when any part of the voxel is filled. */
  has(x: number, y: number, z: number): boolean {
    const n = this.res;
    x = Math.round(x) * n;
    y = Math.round(y) * n;
    z = Math.round(z) * n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (this.hasCell(x + i, y + j, z + k)) return true;
    return false;
  }

  del(x: number, y: number, z: number): void {
    const n = this.res;
    x = Math.round(x) * n;
    y = Math.round(y) * n;
    z = Math.round(z) * n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) this.cells.delete(key(x + i, y + j, z + k));
  }

  /** Paints one small cell: (x, y, z) are its small-cell coordinates. */
  private paintCell(p: Paint, x: number, y: number, z: number): void {
    const n = this.res;
    let c: THREE.ColorRepresentation | null;
    if (typeof p === 'function') {
      const at = tmpAt.set((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5, (z + 0.5) / n - 0.5);
      c = p(Math.floor(x / n), Math.floor(y / n), Math.floor(z / n), at);
    } else c = p;
    if (c !== null && c !== undefined) this.put(x, y, z, new THREE.Color(c), this.glowNext, this.tagNext);
  }

  /** Paints all the small cells of the voxel at (x, y, z). */
  private paint(p: Paint, x: number, y: number, z: number): void {
    const n = this.res;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) this.paintCell(p, x * n + i, y * n + j, z * n + k);
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

  /**
   * Round layers from small-cell row fy0 to fy1: radius r (in voxels) round the middle of voxel (cx, cz).
   * A finer model traces the circle on its own grid, out to the same edge, so it comes out rounder.
   */
  private disc(cx: number, cz: number, r: number, fy0: number, fy1: number, p: Paint, hollow: boolean): void {
    const n = this.res;
    // The circle's edge sits half a cell past r, so a finer model reaches as far as the blocky one.
    const edge = r + 0.5 - 0.5 / n + 0.01;
    const R = edge * n;
    // The middle of voxel (cx, cz) in small-cell coordinates.
    const mx = cx * n + (n - 1) / 2;
    const mz = cz * n + (n - 1) / 2;
    for (let fx = Math.ceil(mx - R); fx <= Math.floor(mx + R); fx++) {
      for (let fz = Math.ceil(mz - R); fz <= Math.floor(mz + R); fz++) {
        const d = Math.hypot(fx - mx, fz - mz) / n;
        if (d > edge) continue;
        if (hollow && d < edge - 1.21) continue;
        for (let fy = fy0; fy <= fy1; fy++) this.paintCell(p, fx, fy, fz);
      }
    }
  }

  /** An upright cylinder of radius r round (cx, cz), from y0 to y1. Hollow keeps only a 1-voxel skin. */
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, p: Paint, hollow = true): void {
    const n = this.res;
    this.disc(cx, cz, r, y0 * n, y1 * n + n - 1, p, hollow);
  }

  /** A cone roof: radius r at y0, narrowing to a point h voxels up. */
  cone(cx: number, cz: number, r: number, y0: number, h: number, p: Paint): void {
    const n = this.res;
    for (let i = 0; i < h * n; i++) {
      const rr = r * (1 - i / n / h);
      this.disc(cx, cz, Math.max(0.4, rr), y0 * n + i, y0 * n + i, p, true);
    }
  }

  /** A rounded blob (a tree crown, a boulder), with a ragged edge from rnd. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, p: Paint, rnd: () => number, rough = 0.25): void {
    const n = this.res;
    // As with disc(), a finer blob reaches out to the blocky one's edge.
    const grow = 0.5 - 0.5 / n;
    const [ex, ey, ez] = [rx + grow, ry + grow, rz + grow];
    const m = (n - 1) / 2;
    const [mx, my, mz] = [cx * n + m, cy * n + m, cz * n + m];
    // A finer blob is lumpy a whole voxel at a time rather than speckled: one random dent per voxel it covers.
    const lumps = new Map<number, number>();
    const lump = (x: number, y: number, z: number) => {
      const k = key(Math.floor(x / n), Math.floor(y / n), Math.floor(z / n));
      let r = lumps.get(k);
      if (r === undefined) lumps.set(k, (r = rnd()));
      return r;
    };
    // The same cells in the same order as ever at resolution 1, so seeded blobs keep their shape on Low and Medium.
    const [X, Y, Z] = [Math.ceil(ex * n), Math.ceil(ey * n), Math.ceil(ez * n)];
    for (let x = Math.floor(mx - X); x <= Math.ceil(mx + X); x++) {
      for (let y = Math.floor(my - Y); y <= Math.ceil(my + Y); y++) {
        for (let z = Math.floor(mz - Z); z <= Math.ceil(mz + Z); z++) {
          const d = ((x - mx) / n / ex) ** 2 + ((y - my) / n / ey) ** 2 + ((z - mz) / n / ez) ** 2;
          if (d <= 1 - rough * (n > 1 ? lump(x, y, z) : rnd())) this.paintCell(p, x, y, z);
        }
      }
    }
  }

  /** A pitched roof along x: eaves at y0 on both z sides, rising to a ridge. */
  gable(x0: number, x1: number, z0: number, z1: number, y0: number, p: Paint, gableEnds: Paint | null = null): void {
    const n = this.res;
    const fz0 = z0 * n;
    const fz1 = z1 * n + n - 1;
    const half = Math.ceil((fz1 - fz0 + 1 - n) / 2);
    for (let i = 0; i <= half + n - 1; i++) {
      if (n > 1 && fz0 + i > fz1 - i) break;
      const y = y0 * n + i;
      for (let x = x0 * n; x <= x1 * n + n - 1; x++) {
        this.paintCell(p, x, y, fz0 + i);
        this.paintCell(p, x, y, fz1 - i);
      }
      // Fill the triangle under the roof at each end.
      if (gableEnds) {
        for (let z = fz0 + i + 1; z < fz1 - i; z++) {
          for (let k = 0; k < n; k++) {
            this.paintCell(gableEnds, (x0 + 1) * n + k, y, z);
            this.paintCell(gableEnds, (x1 - 1) * n + k, y, z);
          }
        }
      }
    }
  }

  /** Every small cell, for models that are drawn voxel by voxel (trees that can be chipped): its corner in voxel units. */
  each(fn: (x: number, y: number, z: number, cell: Cell) => void): void {
    const n = this.res;
    for (const c of this.cells.values()) fn(c.x / n, c.y / n, c.z / n, c);
  }

  /** Copies another model's cells into this one (of the same resolution), moved by whole voxels. */
  paste(other: Vox, dx: number, dy: number, dz: number): void {
    const n = this.res;
    for (const c of other.cells.values()) this.put(c.x + dx * n, c.y + dy * n, c.z + dz * n, c.c, c.glow, c.tag);
  }

  /** True when all six neighbours are filled: the cell (corner in voxel units, as from each()) can never be seen. */
  buried(x: number, y: number, z: number): boolean {
    const n = this.res;
    const [fx, fy, fz] = [Math.round(x * n), Math.round(y * n), Math.round(z * n)];
    const has = (a: number, b: number, c: number) => this.hasCell(a, b, c);
    return has(fx + 1, fy, fz) && has(fx - 1, fy, fz) && has(fx, fy + 1, fz) && has(fx, fy - 1, fz) && has(fx, fy, fz + 1) && has(fx, fy, fz - 1);
  }

  /**
   * Rounds a finer model off: trims the small cells on the outside edges and corners of parts at least two
   * voxels thick, so a box reads as a rounded block rather than a blown-up one. Thin parts (a blade, a pole,
   * a plank, a rivet) are left alone.
   */
  soften(): this {
    const n = this.res;
    if (n < 2) return this;
    const has = (x: number, y: number, z: number) => this.hasCell(x, y, z);
    const trim: number[] = [];
    for (const [k, c] of this.cells) {
      if (c.glow) continue;
      let open = 0;
      let thick = true;
      for (const [dx, dy, dz] of DIRS) {
        if (has(c.x + dx, c.y + dy, c.z + dz)) continue;
        open++;
        // Solid a whole voxel back from this side: the part is more than a voxel thick here.
        if (!has(c.x - dx * n, c.y - dy * n, c.z - dz * n)) thick = false;
      }
      if (open >= 2 && thick) trim.push(k);
    }
    for (const k of trim) this.cells.delete(k);
    return this;
  }

  /** Adds this model's visible faces to a batch: voxel size, where its (0, 0, 0) goes, and a turn round y. */
  meshInto(batch: VoxBatch, size: number, at: THREE.Vector3, turn = 0): void {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    size /= this.res;
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

const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

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

  /** The lit and glowing geometry, for drawing many copies of one model as instances. */
  geometries(): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    return {
      solid: this.solid.idx.length ? VoxBatch.geometry(this.solid) : null,
      glow: this.glow.idx.length ? VoxBatch.geometry(this.glow) : null,
    };
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    if (this.solid.idx.length) group.add(new THREE.Mesh(VoxBatch.geometry(this.solid), new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (this.glow.idx.length) group.add(new THREE.Mesh(VoxBatch.geometry(this.glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
    return group;
  }
}
