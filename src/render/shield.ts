import * as THREE from 'three';
import { jitter, seeded, Vox, VoxBatch } from './voxels';

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

/** True for a cell of the heater shape: square shoulders with an arched top, narrowing to a rounded point. */
function inShape(x: number, y: number): boolean {
  if (x < 0 || x >= NX || y < 0 || y >= NY) return false;
  const cx = x + 0.5 - NX / 2;
  const cy = y + 0.5;
  if (cy > 14.2 + 1.2 * (1 - (cx / (NX / 2)) ** 2)) return false;
  const half = NX / 2;
  if (cy >= 8) return Math.abs(cx) <= half;
  const t = (8 - cy) / 8;
  return Math.abs(cx) <= half * Math.sqrt(Math.max(0, 1 - t ** 1.7));
}

const isRim = (x: number, y: number) => inShape(x, y) && !(inShape(x - 1, y) && inShape(x + 1, y) && inShape(x, y - 1) && inShape(x, y + 1));

/** The shield's cells. Cells run x 0..23, y 0..14, z -1 (front lip) to 2 (back lip). */
export function buildShieldVox(): Vox {
  const rnd = seeded(23);
  const v = new Vox();
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

export class ShieldModel {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private mat: THREE.MeshLambertMaterial;
  private charge = { value: 1 };

  constructor() {
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
    const batch = new VoxBatch();
    buildShieldVox().meshInto(batch, S, new THREE.Vector3(-0.5, 0, 0));
    this.mesh.geometry = batch.geometries().solid ?? new THREE.BufferGeometry();
  }

  /** A hit glint (0 to 1) and how bright it is (1 normally), and how far the heave has recharged (0 to 1). */
  shade(glint: number, light: number, charge = 1): void {
    this.charge.value = charge;
    this.mat.emissive.setRGB(glint * 0.7, glint * 0.65, glint * 0.45);
    this.mat.color.setScalar(light);
  }
}
