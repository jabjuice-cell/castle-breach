import * as THREE from 'three';
import { atRes, jitter, seeded, Vox, VoxBatch } from './voxels';

/**
 * The royal shield as a voxel metal shield: a giant steel-rimmed heater shield of royal-blue enamel,
 * its crest (a gold crown over a sword) on both faces, standing in front of the wall. From the castle
 * we see its back, which also has the bearers' leather grip. It is only a look: the collision is still
 * the flat line the sim uses, and the drawn size is set by the scene.
 *
 * Built one unit wide (x from -0.5 to 0.5), standing on y = 0, its back toward +z.
 * It never shows damage; the heave recharge lights it up from bottom to top (shade).
 */

const NX = 24;
const NY = 15;
const S = 1 / NX;
/** Height for a width of one. */
export const SHIELD_SHAPE_H = NY * S;
const STEEL = '#c9d0d6';
const STEEL_BRIGHT = '#eef2f5';
const BLUE = '#2f56b3';
const GOLD = '#f2c230';
const GOLD_DARK = '#c9921c';
const RED = '#d23a3a';
const LEATHER = '#6a4020';

/** The royal crest: a crown over a sword, 11 cells wide, top row first. */
const CREST = [
  'G...G.G...G',
  'GG.GGGGG.GG',
  'GGGGGGGGGGG',
  'GRGGGRGGGRG',
  'DDDDDDDDDDD',
  '.....G.....',
  '...GGGGG...',
  '.....G.....',
  '.....G.....',
];
const CREST_X0 = Math.floor((NX - 11) / 2);
const CREST_Y0 = 4;

function crestAt(x: number, y: number): string | null {
  const row = CREST[CREST.length - 1 - (y - CREST_Y0)];
  if (!row) return null;
  const ch = row[x - CREST_X0];
  return ch && ch !== '.' ? ch : null;
}

/** True for a point (in cells) inside the heater shape: square shoulders with an arched top, narrowing to a rounded point. */
function inside(px: number, py: number): boolean {
  if (px < 0 || px >= NX || py < 0 || py >= NY) return false;
  const cx = px - NX / 2;
  const cy = py;
  if (cy > 14.2 + 1.2 * (1 - (cx / (NX / 2)) ** 2)) return false;
  const half = NX / 2;
  if (cy >= 8) return Math.abs(cx) <= half;
  const t = (8 - cy) / 8;
  return Math.abs(cx) <= half * Math.sqrt(Math.max(0, 1 - t ** 1.7));
}

/** True for a cell of the heater shape. */
const inShape = (x: number, y: number) => inside(x + 0.5, y + 0.5);

const isRim = (x: number, y: number) => inShape(x, y) && !(inShape(x - 1, y) && inShape(x + 1, y) && inShape(x, y - 1) && inShape(x, y + 1));

/** The shield's cells. Cells run x 0..23, y 0..14, z -1 (front lip) to 2 (back lip). */
export function buildShieldVox(): Vox {
  const rnd = seeded(23);
  const v = new Vox();
  if (v.res > 1) return fineShield(v, rnd);
  for (let x = 0; x < NX; x++) {
    for (let y = 0; y < NY; y++) {
      if (!inShape(x, y)) continue;
      const rim = isRim(x, y);
      const crest = crestAt(x, y);
      let c: THREE.Color;
      if (crest) c = new THREE.Color(crest === 'R' ? RED : crest === 'D' ? GOLD_DARK : GOLD);
      else c = jitter(rim ? STEEL : BLUE, rim ? 0.05 : 0.07, rnd);
      for (const z of [0, 1]) v.set(x, y, z, c);
      if (rim) {
        // The raised steel lip on both faces, with a rivet every third block.
        const lip = jitter(STEEL, 0.04, rnd);
        const rivet = (x + y) % 3 === 0 ? new THREE.Color(STEEL_BRIGHT) : lip;
        v.set(x, y, -1, rivet);
        v.set(x, y, 2, rivet);
      }
    }
  }
  // The bearers' grip on the back: a leather bar low down, with two posts.
  for (let x = 8; x <= 15; x++) {
    for (const y of [2, 3]) if (v.has(x, y, 1)) v.set(x, y, 2, jitter(LEATHER, 0.1, rnd));
  }
  return v;
}

/**
 * The finer shield (High detail), on a grid of half cells: the outline traced smoothly, the steel lip
 * bevelled (a step down from its outer edge), round rivets standing proud of it, and the crest raised
 * off the enamel with a darker lower edge, on both faces.
 */
function fineShield(v: Vox, rnd: () => number): Vox {
  const h = 1 / v.res;
  const near = (px: number, py: number, d: number) => !(inside(px - d, py) && inside(px + d, py) && inside(px, py - d) && inside(px, py + d));
  let rivets = 0;
  for (let x = 0; x < NX; x += h) {
    for (let y = 0; y < NY; y += h) {
      const [px, py] = [x + h / 2, y + h / 2];
      if (!inside(px, py)) continue;
      const rim = near(px, py, 1);
      const crest = crestAt(Math.floor(x), Math.floor(y));
      let c: THREE.Color;
      if (crest) c = new THREE.Color(crest === 'R' ? RED : crest === 'D' ? GOLD_DARK : GOLD);
      else c = jitter(rim ? STEEL : BLUE, rim ? 0.05 : 0.07, rnd);
      for (let z = 0; z < 2; z += h) v.dot(x, y, z, c);
      if (rim) {
        const outer = near(px, py, h);
        const lip = jitter(outer ? STEEL : '#aeb6be', 0.04, rnd);
        v.dot(x, y, -h, lip);
        v.dot(x, y, 2, lip);
        if (near(px, py, 0.5)) {
          v.dot(x, y, -1, lip);
          v.dot(x, y, 2 + h, lip);
        }
      } else if (crest) {
        // The crest stands out of the enamel, its lower edge in shadow.
        const raised = crestAt(Math.floor(x), Math.floor(y - h)) === null ? new THREE.Color(GOLD_DARK) : c;
        v.dot(x, y, -h, raised);
        v.dot(x, y, 2, raised);
      }
    }
  }
  // Rivets round the lip: a bright stud standing out of the outer step, one every two cells or so.
  for (let x = 0; x < NX; x += h) {
    for (let y = 0; y < NY; y += h) {
      const [px, py] = [x + h / 2, y + h / 2];
      if (!inside(px, py) || !near(px, py, 0.5) || near(px, py, h)) continue;
      if ((Math.round(px * 3) + Math.round(py * 3)) % 7 !== 0 || rivets++ % 2) continue;
      v.dot(x, y, -1, STEEL_BRIGHT);
      v.dot(x, y, -1 - h, STEEL_BRIGHT);
      v.dot(x, y, 2 + h, STEEL_BRIGHT);
      v.dot(x, y, 2 + 2 * h, STEEL_BRIGHT);
    }
  }
  // The bearers' grip on the back: a stitched leather bar low down.
  for (let x = 8; x < 16; x += h) {
    for (let y = 2; y < 4; y += h) if (v.hasDot(x, y, 2 - h)) v.dot(x, y, 2, (x * 4) % 2 === 0 && y === 3 ? '#c8a070' : jitter(LEATHER, 0.1, rnd));
  }
  return v;
}

export class ShieldModel {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private mat: THREE.MeshLambertMaterial;
  private charge = { value: 1 };

  constructor(res = 1) {
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // While the heave recharges, the shield lights up from the bottom to the top: below the charge line it
    // glows (brightest right at the line), above it stays dim.
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCharge = this.charge;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vShieldY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShieldY = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShieldY;\nuniform float uCharge;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
if (uCharge < 0.999) {
  float f = vShieldY / ${SHIELD_SHAPE_H.toFixed(4)};
  if (f > uCharge) gl_FragColor.rgb *= 0.4;
  else gl_FragColor.rgb += vec3(0.55, 0.4, 0.1) * smoothstep(0.14, 0.0, uCharge - f);
}`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.group.add(this.mesh);
    this.setRes(res);
  }

  /** Rebuilds the shield at a resolution (2 on High detail). */
  setRes(res: number): void {
    const batch = new VoxBatch();
    atRes(res, buildShieldVox).meshInto(batch, S, new THREE.Vector3(-0.5, 0, 0));
    this.mesh.geometry.dispose();
    this.mesh.geometry = batch.geometries().solid ?? new THREE.BufferGeometry();
  }

  /** A hit glint (0 to 1) and how bright it is (1 normally), and how far the heave has recharged (0 to 1). */
  shade(glint: number, light: number, charge = 1): void {
    this.charge.value = charge;
    this.mat.emissive.setRGB(glint * 0.7, glint * 0.65, glint * 0.45);
    this.mat.color.setScalar(light);
  }
}
