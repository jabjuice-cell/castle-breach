import * as THREE from 'three';

/**
 * The battlefield as a real 3D surface: a grid of heights that explosions
 * blow craters into. It is cosmetic only; the sim never reads it, so balance
 * runs stay the same. Units read heightAt() so they stand in the holes.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  private geo: THREE.PlaneGeometry;
  private heights: Float32Array;
  private nx: number;
  private nz: number;
  private cell: number;

  /**
   * worldW x worldH, centred at (0, centreZ). cell is the grid spacing: smaller
   * is smoother craters and more vertices. Craters are only blown north of noCraterZ (the castle).
   */
  constructor(
    readonly worldW: number,
    readonly worldH: number,
    private readonly centreZ: number,
    cell: number,
    material: THREE.Material,
    private readonly noCraterZ: number,
  ) {
    this.nx = Math.round(worldW / cell);
    this.nz = Math.round(worldH / cell);
    this.cell = worldW / this.nx;
    this.geo = new THREE.PlaneGeometry(worldW, worldH, this.nx, this.nz);
    this.geo.rotateX(-Math.PI / 2);
    this.heights = new Float32Array((this.nx + 1) * (this.nz + 1));
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.position.set(0, 0, centreZ);
  }

  dispose() {
    this.geo.dispose();
  }

  /** Flattens the field again (a new run). */
  reset() {
    this.heights.fill(0);
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0);
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  private col(x: number) {
    return (x + this.worldW / 2) / this.cell;
  }

  private row(z: number) {
    return (z - this.centreZ + this.worldH / 2) / this.cell;
  }

  /** Ground height at a world point, smoothly between grid points. */
  heightAt(x: number, z: number): number {
    const fx = this.col(x);
    const fz = this.row(z);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const w = this.nx + 1;
    const h = this.heights;
    const a = h[iz * w + ix] * (1 - tx) + h[iz * w + ix + 1] * tx;
    const b = h[(iz + 1) * w + ix] * (1 - tx) + h[(iz + 1) * w + ix + 1] * tx;
    return a * (1 - tz) + b * tz;
  }

  /** Blows a bowl of the given radius and depth into the ground, with a raised rim of thrown-up dirt. */
  crater(x: number, z: number, radius: number, depth: number) {
    if (z > this.noCraterZ) return;
    const outer = radius * 1.45;
    const c0 = Math.max(0, Math.floor(this.col(x - outer)));
    const c1 = Math.min(this.nx, Math.ceil(this.col(x + outer)));
    const r0 = Math.max(0, Math.floor(this.row(z - outer)));
    const r1 = Math.min(this.nz, Math.ceil(this.row(z + outer)));
    if (c0 > c1 || r0 > r1) return;
    const w = this.nx + 1;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const vx = -this.worldW / 2 + c * this.cell;
        const vz = this.centreZ - this.worldH / 2 + r * this.cell;
        const d = Math.hypot(vx - x, vz - z) / radius;
        let dh = 0;
        if (d < 1) dh = -depth * (1 - d * d);
        else if (d < 1.45) dh = depth * 0.35 * Math.sin(((d - 1) / 0.45) * Math.PI);
        if (dh === 0) continue;
        const i = r * w + c;
        // Holes can't get deeper than a few blasts' worth.
        this.heights[i] = Math.max(-depth * 2.5, Math.min(depth, this.heights[i] + dh));
        pos.setY(i, this.heights[i]);
      }
    }
    this.markRows(pos, c0, c1, r0, r1);
    this.updateNormals(c0, c1, r0, r1);
  }

  /** Recomputes normals for a patch of the grid only (the whole grid is too slow every blast). */
  private updateNormals(c0: number, c1: number, r0: number, r1: number) {
    const w = this.nx + 1;
    const h = this.heights;
    const normal = this.geo.attributes.normal as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let r = Math.max(0, r0 - 1); r <= Math.min(this.nz, r1 + 1); r++) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(this.nx, c1 + 1); c++) {
        const hl = h[r * w + Math.max(0, c - 1)];
        const hr = h[r * w + Math.min(this.nx, c + 1)];
        const hu = h[Math.max(0, r - 1) * w + c];
        const hd = h[Math.min(this.nz, r + 1) * w + c];
        n.set(hl - hr, 2 * this.cell, hu - hd).normalize();
        normal.setXYZ(r * w + c, n.x, n.y, n.z);
      }
    }
    this.markRows(normal, Math.max(0, c0 - 1), Math.min(this.nx, c1 + 1), Math.max(0, r0 - 1), Math.min(this.nz, r1 + 1));
  }

  /** Uploads only the rows of the grid that changed, not the whole mesh (a full upload cost ~100 ms per blast). */
  private markRows(attr: THREE.BufferAttribute, c0: number, c1: number, r0: number, r1: number) {
    const w = this.nx + 1;
    const start = r0 * w + c0;
    attr.addUpdateRange(start * 3, ((r1 - r0) * w + (c1 - c0) + 1) * 3);
    attr.needsUpdate = true;
  }
}
