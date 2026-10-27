import * as THREE from 'three';
import type { EnemyKind } from '../sim/waves';
import { Vox, VoxBatch } from './voxels';

/**
 * The regular orcs as cartoony voxel models (Jonny, 27 Oct: smaller enemies are voxels,
 * bosses stay painted). From the castle we mostly see heads, helmets and shoulders, so
 * the models are chunky with big heads, and each kind has one bold colour that names it:
 * grunts red, chuckers blue, barrel orcs orange, goblins yellow-orange, shield orcs steel,
 * drummers gold, the ogre a yellow-green brute in red pauldrons. Every model also gets a dark hull one voxel
 * bigger all round, drawn inside out: a cartoon outline that lifts it off the grass.
 * Each stands on y = 0 facing +z, toward the wall.
 */

const SKIN = '#86d12e';
const SKIN_DARK = '#4f9a1c';
const BOOT = '#3a2414';
const PANTS = '#5a3a22';
const BELT = '#2a180c';
const BONE = '#fff4d6';
const EYE = '#ffe628';
const PUPIL = '#141008';
const MOUTH = '#3a0e0e';
const IRON = '#a4aab2';
const IRON_DARK = '#5e646c';
const RED = '#e8322a';
const WOOD = '#8a5228';
const STEEL = '#eef3f8';
const GOLD = '#ffc928';
const OUTLINE = '#1c120a';

interface BodyLook {
  x?: number;
  y?: number;
  z?: number;
  skin?: string;
  skinDark?: string;
  /** The jerkin or tabard: the kind's colour. */
  cloth: string;
  helm: string | null;
  /** A stripe along the helmet's brim. */
  trim?: string;
  horns?: boolean;
  /** Ear length in voxels past the head (goblins have big ones). */
  ears?: number;
  /** Raise the right arm (a thrower). */
  armUp?: boolean;
}

/** An orc: stubby legs, a barrel chest, a big head under a big helmet. 15 voxels tall, feet on y. */
function body(v: Vox, o: BodyLook): void {
  const X = o.x ?? 0;
  const Y = o.y ?? 0;
  const Z = o.z ?? 0;
  const skin = o.skin ?? SKIN;
  const dark = o.skinDark ?? SKIN_DARK;
  // Big boots, toes forward, and stubby legs.
  for (const sx of [-3, 1]) {
    v.box(X + sx, Y, Z - 1, X + sx + 1, Y, Z + 2, BOOT);
    v.box(X + sx, Y + 1, Z - 1, X + sx + 1, Y + 2, Z + 1, PANTS);
  }
  // The chest in the kind's colour, a dark belt with a bone buckle, a V of green at the neck.
  v.box(X - 3, Y + 3, Z - 2, X + 3, Y + 7, Z + 1, o.cloth);
  v.box(X - 3, Y + 3, Z - 2, X + 3, Y + 3, Z + 1, BELT);
  v.set(X, Y + 3, Z + 2, BONE);
  v.box(X - 1, Y + 7, Z + 1, X + 1, Y + 7, Z + 1, skin);
  // Arms down at the sides with big fists; the right one raised for a thrower.
  v.box(X - 5, Y + 5, Z - 1, X - 4, Y + 7, Z, skin);
  v.box(X - 5, Y + 3, Z - 1, X - 4, Y + 4, Z + 1, dark);
  if (o.armUp) {
    v.box(X + 4, Y + 7, Z - 1, X + 5, Y + 10, Z, skin);
    v.box(X + 4, Y + 11, Z - 1, X + 5, Y + 12, Z + 1, dark);
  } else {
    v.box(X + 4, Y + 5, Z - 1, X + 5, Y + 7, Z, skin);
    v.box(X + 4, Y + 3, Z - 1, X + 5, Y + 4, Z + 1, dark);
  }
  // The head: wide, with an underbite, two tusks, a snub nose and big yellow eyes.
  v.box(X - 3, Y + 8, Z - 3, X + 3, Y + 12, Z + 2, skin);
  v.box(X - 2, Y + 8, Z + 3, X + 2, Y + 9, Z + 3, skin);
  v.box(X - 1, Y + 9, Z + 3, X + 1, Y + 9, Z + 3, MOUTH);
  v.box(X - 2, Y + 9, Z + 3, X - 2, Y + 10, Z + 3, BONE);
  v.box(X + 2, Y + 9, Z + 3, X + 2, Y + 10, Z + 3, BONE);
  v.set(X, Y + 10, Z + 3, dark);
  v.set(X - 2, Y + 11, Z + 3, EYE);
  v.set(X - 1, Y + 11, Z + 3, PUPIL);
  v.set(X + 2, Y + 11, Z + 3, EYE);
  v.set(X + 1, Y + 11, Z + 3, PUPIL);
  // Pointed ears out to the sides.
  const ears = o.ears ?? 2;
  for (const s of [-1, 1]) {
    v.box(X + s * 4, Y + 10, Z - 1, X + s * 4, Y + 11, Z, skin);
    for (let k = 1; k < ears; k++) v.set(X + s * (4 + k), Y + 11 + Math.floor(k / 2), Z - (k > 1 ? 1 : 0), skin);
  }
  if (o.helm) {
    // A bowl helmet with a wide brim that doubles as an angry brow.
    v.box(X - 4, Y + 12, Z - 4, X + 4, Y + 12, Z + 3, o.helm);
    v.box(X - 3, Y + 13, Z - 3, X + 3, Y + 13, Z + 2, o.helm);
    v.box(X - 2, Y + 14, Z - 2, X + 2, Y + 14, Z + 1, o.helm);
    if (o.trim) v.box(X - 4, Y + 12, Z + 3, X + 4, Y + 12, Z + 3, o.trim);
    if (o.horns) {
      for (const s of [-1, 1]) {
        v.box(X + s * 5, Y + 13, Z - 1, X + s * 5, Y + 13, Z, BONE);
        v.box(X + s * 6, Y + 14, Z - 1, X + s * 6, Y + 16, Z - 1, BONE);
      }
    }
  } else {
    v.box(X - 3, Y + 12, Z - 3, X + 3, Y + 12, Z + 2, skin);
    v.box(X - 2, Y + 12, Z + 3, X + 2, Y + 12, Z + 3, dark);
  }
}

function grunt(): Vox {
  const v = new Vox();
  body(v, { cloth: '#6a4024', helm: RED, trim: IRON, horns: true });
  // A red pauldron on the left shoulder.
  v.box(-6, 7, -2, -3, 8, 1, RED);
  // A big cleaver held up in the right fist.
  v.box(5, 2, 2, 5, 8, 2, WOOD);
  v.box(6, 6, 2, 8, 11, 2, STEEL);
  v.box(8, 6, 2, 8, 11, 2, '#c4ccd6');
  return v;
}

function chucker(): Vox {
  const v = new Vox();
  body(v, { cloth: '#2f78e0', helm: '#8a5a30', trim: '#2f78e0', armUp: true });
  // A big blue feather in the cap, a rock held up to throw, a sack of more on the hip.
  v.box(-2, 15, -2, -2, 18, -2, '#4aa0ff');
  v.box(-3, 18, -2, -3, 19, -2, '#9ad0ff');
  v.box(3, 13, -2, 6, 15, 1, '#8a8478');
  v.box(4, 16, -1, 5, 16, 0, '#aaa496');
  v.box(-7, 3, -1, -6, 5, 1, '#c09a62');
  v.set(-6, 6, 0, '#8a8478');
  return v;
}

function barrel(): Vox {
  const v = new Vox();
  body(v, { cloth: '#ff8a1a', helm: IRON_DARK, trim: '#ff8a1a' });
  // The powder barrel strapped upright on its back, iron-hooped, a skull daubed on, fuse fizzing.
  v.cyl(0, -6, 3, 2, 14, (x, y) => (y === 4 || y === 12 ? '#2a2a2a' : x % 2 ? '#9a6232' : '#84522a'), false);
  v.box(-1, 8, -3, 1, 10, -3, BONE);
  v.set(-1, 9, -3, PUPIL);
  v.set(1, 9, -3, PUPIL);
  v.set(0, 15, -6, '#5a4030');
  v.set(0, 16, -6, '#ff8a1a');
  v.set(0, 17, -6, '#fff2a8');
  return v;
}

function runner(): Vox {
  const v = new Vox();
  // A goblin: a sharper yellow-green, huge ears, an orange hood with a long tail and a wicked knife.
  body(v, { cloth: '#3a2a1a', helm: '#ff9a1a', trim: '#ffd23a', skin: '#c6e64a', skinDark: '#8ab02a', ears: 4 });
  v.box(-1, 13, -5, 1, 13, -4, '#ff9a1a');
  v.box(0, 12, -6, 0, 12, -6, '#ffd23a');
  v.box(5, 4, 2, 5, 4, 4, STEEL);
  return v;
}

function rider(): Vox {
  const v = new Vox();
  // A fat war boar: dark bristly hide, a bristle ridge, big white tusks, a pink snout, tiny red eyes.
  const hide = '#5a3424';
  v.box(-4, 3, -7, 4, 8, 5, hide);
  v.box(-1, 9, -6, 1, 9, 4, '#24140c');
  v.box(-3, 3, 6, 3, 7, 9, '#4a2a1c');
  v.box(-2, 3, 10, 2, 5, 10, '#f0a0a0');
  v.box(-3, 5, 10, -3, 7, 10, BONE);
  v.box(3, 5, 10, 3, 7, 10, BONE);
  v.set(-2, 7, 10, '#ff3a2a');
  v.set(2, 7, 10, '#ff3a2a');
  v.box(-4, 8, 7, -4, 9, 7, '#4a2a1c');
  v.box(4, 8, 7, 4, 9, 7, '#4a2a1c');
  for (const [lx, lz] of [[-4, -6], [2, -6], [-4, 3], [2, 3]]) v.box(lx, 0, lz, lx + 2, 2, lz + 1, '#2a180c');
  v.box(-1, 6, -9, 1, 7, -8, hide);
  // A red saddle cloth and its orc, red-helmed and horned, with a lance.
  v.box(-5, 8, -3, 5, 9, 2, '#c8282a');
  body(v, { y: 8, z: -1, cloth: '#6a4024', helm: RED, trim: GOLD, horns: true });
  v.box(5, 11, -5, 5, 11, 10, WOOD);
  v.box(5, 11, 11, 5, 11, 13, STEEL);
  v.box(5, 12, 10, 5, 13, 10, RED);
  return v;
}

function catapult(): Vox {
  const v = new Vox();
  // Two long rails on four wheels, a throwing arm cocked back with a boulder in its bucket.
  v.box(-6, 2, -7, -5, 3, 6, WOOD);
  v.box(5, 2, -7, 6, 3, 6, WOOD);
  v.box(-6, 3, -1, 6, 3, 0, '#6a3e1c');
  v.box(-6, 2, 5, 6, 3, 6, '#6a3e1c');
  for (const wx of [-8, 7]) {
    for (const wz of [-5, 4]) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const d = Math.hypot(dy, dz);
          if (d > 2.4) continue;
          v.set(wx, 2 + dy, wz + dz, d < 0.6 ? '#3a3a3a' : d > 1.6 ? '#2e1c10' : '#5a3a20');
        }
      }
    }
  }
  // The uprights and crossbar the arm swings against, with a red war banner.
  v.box(-4, 4, 1, -4, 9, 1, WOOD);
  v.box(4, 4, 1, 4, 9, 1, WOOD);
  v.box(-4, 9, 1, 4, 9, 1, '#5a3418');
  v.box(-4, 10, 1, -4, 13, 1, WOOD);
  v.box(-7, 11, 1, -5, 13, 1, RED);
  for (let i = 0; i <= 10; i++) v.box(-1, 4 + Math.round(i * 0.8), -i + 1, 1, 4 + Math.round(i * 0.8), -i + 1, '#8a5a30');
  v.box(-2, 12, -11, 2, 13, -8, '#5a3418');
  v.box(-1, 14, -10, 1, 15, -9, '#8a8478');
  // A counterweight of rocks in a net, and an orc skull nailed to the front.
  v.box(-2, 4, 3, 2, 6, 5, '#6e6c68');
  v.box(-1, 4, 7, 1, 5, 7, BONE);
  v.set(0, 5, 8, PUPIL);
  return v;
}

function ogre(): Vox {
  const v = new Vox();
  // After the painted ogre: a yellow-green brute in red spiked pauldrons, a little horned
  // helmet, a skull on his belt and a spiked club raised high. Paler than the orcs, and twice as wide.
  const skin = '#bccb34';
  const dark = '#8a9a1e';
  const belly = '#dce46a';
  // Stubby legs on big bare feet.
  for (const sx of [-6, 2]) {
    v.box(sx, 0, -2, sx + 3, 1, 3, dark);
    v.box(sx, 2, -1, sx + 3, 4, 1, skin);
  }
  // A brown loincloth with a front flap, a rope belt and a skull buckle.
  v.box(-7, 4, -4, 6, 6, 3, '#6a4024');
  v.box(-3, 2, 4, 2, 5, 4, '#7a4a28');
  v.box(-7, 7, -4, 6, 7, 3, '#c8a060');
  v.box(-1, 6, 4, 0, 8, 5, BONE);
  v.set(-1, 7, 5, PUPIL);
  v.set(0, 7, 5, PUPIL);
  // The round belly, stacked in layers, paler in front.
  const layers: [number, number, number][] = [[8, 7, 4], [9, 8, 5], [10, 8, 5], [11, 8, 5], [12, 8, 5], [13, 7, 4]];
  for (const [y, w, d] of layers) {
    v.box(-w, y, -4, w - 1, y, d - 1, skin);
    v.box(-w + 2, y, d - 1, w - 3, y, d, y > 8 && y < 13 ? belly : skin);
  }
  v.set(-1, 10, 5, dark);
  // Broad shoulders and a small head sunk between them.
  v.box(-8, 14, -4, 7, 16, 2, skin);
  v.box(-3, 16, -2, 2, 20, 3, skin);
  // A heavy brow over small yellow eyes, a big nose, an underbite with two tusks.
  v.box(-3, 19, 4, 2, 19, 4, dark);
  v.box(-2, 18, 4, -2, 18, 4, EYE);
  v.box(1, 18, 4, 1, 18, 4, EYE);
  v.box(-1, 17, 4, 0, 17, 5, dark);
  v.box(-3, 15, 3, 2, 16, 4, skin);
  v.box(-2, 16, 4, 1, 16, 4, MOUTH);
  v.box(-3, 16, 5, -3, 17, 5, BONE);
  v.box(2, 16, 5, 2, 17, 5, BONE);
  for (const sx of [-4, 3]) v.box(sx, 18, -1, sx, 19, 0, skin);
  // A little dark iron helmet with bone horns.
  v.box(-3, 21, -2, 2, 21, 3, IRON_DARK);
  v.box(-2, 22, -1, 1, 22, 2, IRON_DARK);
  for (const sx of [-4, 3]) {
    v.box(sx, 22, 0, sx, 23, 0, BONE);
    v.set(sx + (sx < 0 ? -1 : 1), 24, 0, BONE);
  }
  // Big red pauldrons with steel spikes on both shoulders.
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -11 : 7;
    v.box(x0, 15, -4, x0 + 3, 17, 2, RED);
    v.box(x0, 15, -4, x0 + 3, 15, 2, '#a01818');
    v.set(x0 + 1, 18, -1, STEEL);
    v.set(x0 + (s < 0 ? 0 : 3), 17, -3, STEEL);
    v.set(x0 + (s < 0 ? 0 : 3), 17, 1, STEEL);
  }
  // Long arms with big fists and iron bracers. The left hangs; the right raises the club.
  v.box(-11, 8, -2, -9, 14, 0, skin);
  v.box(-11, 9, -2, -9, 9, 0, IRON);
  v.box(-12, 5, -2, -9, 7, 1, dark);
  v.box(8, 16, -2, 10, 20, 0, skin);
  v.box(8, 17, -2, 10, 17, 0, IRON);
  v.box(8, 21, -2, 11, 23, 1, dark);
  // The club: a thick log, fatter at the top, studded with steel.
  v.box(9, 24, -1, 10, 26, 0, WOOD);
  v.box(8, 27, -2, 11, 32, 1, '#7a4620');
  v.box(9, 33, -1, 10, 33, 0, '#7a4620');
  for (const [cx, cy, cz] of [[7, 28, 0], [12, 29, -1], [7, 31, -1], [12, 32, 0], [9, 30, 2], [10, 28, -3], [9, 34, 0]]) v.set(cx, cy, cz, STEEL);
  return v;
}

function warlord(): Vox {
  const v = new Vox();
  // Not drawn (the warlord is always his painted art), kept so every kind has a model.
  const armour = '#3a3d44';
  v.box(-5, 3, -4, 5, 14, -4, '#a01818');
  body(v, { helm: armour, trim: GOLD, cloth: armour, horns: true });
  return v;
}

function shieldOrc(): Vox {
  const v = new Vox();
  body(v, { cloth: '#5a6070', helm: IRON, trim: '#e8eef4' });
  // A big tower shield held in front, facing the wall: iron rim, red and white halves, a gold boss.
  v.box(-6, 1, 4, 6, 14, 4, (x) => (x < 0 ? RED : '#f2ece0'));
  v.box(-6, 1, 5, 6, 1, 5, IRON_DARK);
  v.box(-6, 14, 5, 6, 14, 5, IRON_DARK);
  v.box(-6, 1, 5, -6, 14, 5, IRON_DARK);
  v.box(6, 1, 5, 6, 14, 5, IRON_DARK);
  v.box(-1, 7, 5, 1, 9, 6, GOLD);
  return v;
}

function drummer(): Vox {
  const v = new Vox();
  body(v, { cloth: '#b01c18', helm: GOLD, trim: RED, horns: true, skin: '#7cc22a' });
  // A big war drum strapped in front: a wooden barrel, pale skin head, red rope lacing.
  v.cyl(0, 4, 4, 2, 9, (x, y) => (y === 3 || y === 8 ? '#2a2a2a' : x % 2 ? RED : '#9a6232'), false);
  v.box(-4, 9, 1, 4, 9, 7, '#f2e6c4');
  v.box(-1, 9, 3, 1, 9, 5, '#d8c89e');
  // Two sticks raised, and a tall red plume on the helm.
  v.box(-5, 10, 4, -5, 13, 4, BONE);
  v.box(5, 10, 4, 5, 13, 4, BONE);
  v.box(0, 15, -1, 0, 19, -1, RED);
  v.box(0, 19, -2, 0, 19, -3, RED);
  return v;
}

const MODELS: Record<EnemyKind, () => Vox> = { grunt, chucker, barrel, runner, rider, orcCatapult: catapult, ogre, warlord, shieldOrc, drummer };
/** Voxel size per kind: how big each model stands on the field. */
const SCALE: Record<EnemyKind, number> = { grunt: 0.125, chucker: 0.125, barrel: 0.125, runner: 0.105, rider: 0.13, orcCatapult: 0.15, ogre: 0.16, warlord: 0.2, shieldOrc: 0.125, drummer: 0.135 };

/** The model grown by one voxel in the six directions: drawn inside out in dark brown, it is the outline. */
function hull(v: Vox): Vox {
  const h = new Vox();
  v.each((x, y, z) => {
    h.set(x, y, z, OUTLINE);
    h.set(x + 1, y, z, OUTLINE);
    h.set(x - 1, y, z, OUTLINE);
    h.set(x, y + 1, z, OUTLINE);
    h.set(x, y - 1, z, OUTLINE);
    h.set(x, y, z + 1, OUTLINE);
    h.set(x, y, z - 1, OUTLINE);
  });
  return h;
}

/** A chunk a killed orc breaks into: where it sits on the model (in world units) and its colour. */
export interface OrcPiece {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
}

/** Splits a model into 2x2x2 chunks, each the colour most of its voxels have. */
function pieces(v: Vox, size: number): OrcPiece[] {
  const groups = new Map<string, { x: number; y: number; z: number; n: number; colors: Map<number, number> }>();
  v.each((x, y, z, cell) => {
    const k = `${Math.floor(x / 2)},${Math.floor(y / 2)},${Math.floor(z / 2)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { x: 0, y: 0, z: 0, n: 0, colors: new Map() }));
    g.x += x + 0.5;
    g.y += y + 0.5;
    g.z += z + 0.5;
    g.n++;
    const hex = cell.c.getHex();
    g.colors.set(hex, (g.colors.get(hex) ?? 0) + 1);
  });
  const out: OrcPiece[] = [];
  for (const g of groups.values()) {
    if (g.n < 3) continue;
    const hex = [...g.colors.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ x: (g.x / g.n) * size, y: (g.y / g.n) * size, z: (g.z / g.n) * size, color: new THREE.Color(hex) });
  }
  return out;
}

export class VoxelOrcs {
  readonly meshes = {} as Record<EnemyKind, THREE.InstancedMesh>;
  /** The outline hulls, sharing each model's instance matrices. */
  private outlines = {} as Record<EnemyKind, THREE.InstancedMesh>;
  /** What each kind breaks into when killed. */
  readonly pieces = {} as Record<EnemyKind, OrcPiece[]>;
  /** World size of one voxel, per kind (a death chunk is two of these across). */
  readonly voxelSize = SCALE;

  constructor(scene: THREE.Scene, max: (kind: EnemyKind) => number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const edge = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    for (const kind of Object.keys(MODELS) as EnemyKind[]) {
      const model = MODELS[kind]();
      const geo = new VoxBatch().add(model, SCALE[kind], new THREE.Vector3()).geometries().solid!;
      const n = max(kind);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes[kind] = mesh;
      const hullGeo = new VoxBatch().add(hull(model), SCALE[kind], new THREE.Vector3()).geometries().solid!;
      const outline = new THREE.InstancedMesh(hullGeo, edge, n);
      outline.instanceMatrix = mesh.instanceMatrix;
      outline.frustumCulled = false;
      outline.count = 0;
      scene.add(outline);
      this.outlines[kind] = outline;
      this.pieces[kind] = pieces(model, SCALE[kind]);
    }
  }

  /** Call after setting the models' instances: the outlines follow their counts. */
  sync(): void {
    for (const kind of Object.keys(this.meshes) as EnemyKind[]) this.outlines[kind].count = this.meshes[kind].count;
  }
}
