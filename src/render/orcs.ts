import * as THREE from 'three';
import type { EnemyKind } from '../sim/waves';
import { Vox, VoxBatch } from './voxels';

/**
 * The orcs as voxel models (Jonny is trying them against the painted sprites): one small
 * model per kind, drawn as instances. Each stands on y = 0 facing +z, toward the wall,
 * so from the castle we see their faces and the tops of their helmets. The colours are
 * picked to stand out on grass: dark leather, red and iron helmets, bright yellow eyes.
 */

const SKIN = '#9cc63a';
const SKIN_DARK = '#6f9628';
const LEATHER = '#5e3a1e';
const BELT = '#2e1c10';
const BONE = '#f0e8d0';
const BOOT = '#2a1a0e';
const EYE = '#ffe14a';
const IRON = '#6e6c68';
const RED = '#cc2e24';
const WOOD = '#7a4a24';

interface BodyLook {
  x?: number;
  y?: number;
  z?: number;
  skin?: string;
  cloth?: string;
  helm: string | null;
  trim?: string;
  ears?: number;
  /** Raise the right arm (a thrower). */
  armUp?: boolean;
}

/** An orc's body, 15 voxels to the top of its helmet, feet on y (+ look.y), facing +z. */
function body(v: Vox, o: BodyLook): void {
  const X = o.x ?? 0;
  const Y = o.y ?? 0;
  const Z = o.z ?? 0;
  const skin = o.skin ?? SKIN;
  const cloth = o.cloth ?? LEATHER;
  // Boots and legs.
  for (const sx of [-2, 1]) {
    v.box(X + sx, Y, Z - 1, X + sx + 1, Y + 1, Z + 1, BOOT);
    v.box(X + sx, Y + 2, Z - 1, X + sx + 1, Y + 3, Z, '#3e2a18');
  }
  // A leather jerkin over a green belly, a dark belt with a bone skull buckle.
  v.box(X - 3, Y + 4, Z - 2, X + 3, Y + 8, Z + 1, cloth);
  v.box(X - 1, Y + 5, Z + 1, X + 1, Y + 7, Z + 1, skin);
  v.box(X - 3, Y + 4, Z - 2, X + 3, Y + 4, Z + 1, BELT);
  v.set(X, Y + 4, Z + 2, BONE);
  // Arms and fists.
  v.box(X - 4, Y + 5, Z - 1, X - 4, Y + 8, Z, skin);
  v.set(X - 4, Y + 4, Z, SKIN_DARK);
  if (o.armUp) {
    v.box(X + 4, Y + 8, Z - 1, X + 4, Y + 12, Z, skin);
    v.set(X + 4, Y + 13, Z, SKIN_DARK);
  } else {
    v.box(X + 4, Y + 5, Z - 1, X + 4, Y + 8, Z, skin);
    v.set(X + 4, Y + 4, Z, SKIN_DARK);
  }
  // The head: a broad jaw, glowing eyes under a heavy brow, tusks and a snub nose.
  v.box(X - 2, Y + 9, Z - 2, X + 2, Y + 12, Z + 2, skin);
  v.box(X - 3, Y + 9, Z - 1, X + 3, Y + 10, Z + 1, skin);
  v.box(X - 2, Y + 12, Z + 2, X + 2, Y + 12, Z + 2, SKIN_DARK);
  v.set(X - 1, Y + 11, Z + 2, EYE);
  v.set(X + 1, Y + 11, Z + 2, EYE);
  v.set(X, Y + 10, Z + 3, SKIN_DARK);
  v.box(X - 1, Y + 9, Z + 2, X + 1, Y + 9, Z + 2, '#3a1010');
  v.set(X - 2, Y + 10, Z + 2, BONE);
  v.set(X + 2, Y + 10, Z + 2, BONE);
  // Pointed ears out to the sides.
  const ears = o.ears ?? 2;
  for (let k = 0; k < ears; k++) {
    v.set(X - 3 - k, Y + 11 + Math.floor(k / 2), Z, skin);
    v.set(X + 3 + k, Y + 11 + Math.floor(k / 2), Z, skin);
  }
  if (o.helm) {
    v.box(X - 3, Y + 13, Z - 3, X + 3, Y + 13, Z + 2, o.helm);
    v.box(X - 2, Y + 14, Z - 2, X + 2, Y + 14, Z + 1, o.helm);
    if (o.trim) v.box(X, Y + 13, Z - 3, X, Y + 15, Z + 2, o.trim);
  } else {
    v.box(X - 2, Y + 13, Z - 2, X + 2, Y + 13, Z + 1, skin);
  }
}

function grunt(): Vox {
  const v = new Vox();
  body(v, { helm: RED, trim: '#a8a8a8' });
  // A red pauldron on the left shoulder, rimmed in iron.
  v.box(-6, 8, -1, -3, 9, 1, RED);
  v.box(-6, 8, -1, -6, 8, 1, '#a8a8a8');
  // The spear, up from the right fist, with a pale steel head.
  v.box(4, 2, 1, 4, 17, 1, WOOD);
  v.box(4, 18, 1, 4, 20, 1, '#e4e4e4');
  v.set(3, 18, 1, '#c8c8c8');
  v.set(5, 18, 1, '#c8c8c8');
  return v;
}

function chucker(): Vox {
  const v = new Vox();
  body(v, { helm: '#8a5a30', trim: '#5a3418', cloth: '#4a3a2a', armUp: true });
  // A blue feather in the cap, a rock held up to throw, a sack of more on the hip.
  v.box(-2, 15, -2, -2, 18, -2, '#3a8ad8');
  v.set(-2, 19, -1, '#7ab8ff');
  v.box(3, 14, -1, 5, 15, 1, '#8a8478');
  v.set(4, 16, 0, '#a8a296');
  v.box(-6, 4, -1, -4, 6, 1, '#b08a5a');
  v.set(-5, 7, 0, '#8a8478');
  return v;
}

function barrel(): Vox {
  const v = new Vox();
  body(v, { helm: IRON, trim: '#3a3a3a' });
  // The powder barrel strapped upright on its back, iron-hooped, skull daubed on, fuse fizzing.
  v.cyl(0, -5, 2.7, 3, 13, (x, y) => (y === 4 || y === 12 ? '#3a3a3a' : x % 2 ? '#8a5a2e' : '#7a4e26'), false);
  v.box(-1, 7, -2, 1, 9, -2, '#e8e0c8');
  v.set(0, 8, -2, '#2a1a10');
  v.set(0, 14, -5, '#5a4030');
  v.set(0, 15, -5, '#ff8a1a');
  v.set(0, 16, -5, '#fff2a8');
  return v;
}

function runner(): Vox {
  const v = new Vox();
  // A goblin: a brighter skin, big ears, an orange hood and a wicked little knife.
  body(v, { helm: '#e07a1a', trim: '#ffb43a', skin: '#b8d84a', cloth: '#3a2a1a', ears: 4 });
  v.box(-2, 12, -4, 2, 12, -3, '#e07a1a');
  v.box(4, 5, 1, 4, 5, 3, '#d8d8d8');
  v.set(4, 4, 1, WOOD);
  return v;
}

function rider(): Vox {
  const v = new Vox();
  // A war boar: bristly black-brown, tusks, a pink snout.
  v.box(-3, 3, -6, 3, 7, 5, '#5a3a2a');
  v.box(-1, 8, -5, 1, 8, 4, '#2a1a10');
  v.box(-2, 3, 6, 2, 6, 8, '#4a2e20');
  v.box(-1, 3, 9, 1, 4, 9, '#d89a8a');
  v.set(-2, 5, 9, BONE);
  v.set(2, 5, 9, BONE);
  v.set(-2, 6, 8, EYE);
  v.set(2, 6, 8, EYE);
  v.box(-3, 7, 6, -3, 8, 6, '#4a2e20');
  v.box(3, 7, 6, 3, 8, 6, '#4a2e20');
  for (const [lx, lz] of [[-3, -5], [2, -5], [-3, 3], [2, 3]]) v.box(lx, 0, lz, lx + 1, 2, lz + 1, '#3a2418');
  v.box(-1, 4, -8, 1, 5, -7, '#5a3a2a');
  // Its orc in the saddle, red-helmed, with a lance.
  v.box(-4, 8, -2, 4, 8, 1, '#8a2a1a');
  body(v, { y: 5, z: -1, helm: RED, trim: '#e8b730' });
  v.box(4, 9, -4, 4, 9, 9, WOOD);
  v.box(4, 9, 10, 4, 9, 12, '#e4e4e4');
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
  // The uprights and crossbar the arm swings against.
  v.box(-4, 4, 1, -4, 9, 1, WOOD);
  v.box(4, 4, 1, 4, 9, 1, WOOD);
  v.box(-4, 9, 1, 4, 9, 1, '#5a3418');
  for (let i = 0; i <= 10; i++) v.box(-1, 4 + Math.round(i * 0.8), -i + 1, 1, 4 + Math.round(i * 0.8), -i + 1, '#8a5a30');
  v.box(-2, 12, -11, 2, 13, -8, '#5a3418');
  v.box(-1, 14, -10, 1, 15, -9, '#8a8478');
  // A counterweight of rocks in a net, and an orc skull nailed to the front.
  v.box(-2, 4, 3, 2, 6, 5, '#6e6c68');
  v.box(-1, 4, 7, 1, 5, 7, BONE);
  v.set(0, 5, 8, '#2a1a10');
  return v;
}

function ogre(): Vox {
  const v = new Vox();
  const skin = '#8f8c62';
  // Tree-trunk legs, a huge belly over a loincloth, a small bald head with a topknot.
  for (const sx of [-4, 2]) v.box(sx, 0, -2, sx + 2, 5, 1, skin);
  v.box(-5, 5, -3, 5, 7, 2, '#5e3a1e');
  v.box(-6, 8, -4, 6, 15, 3, skin);
  v.box(-4, 9, 4, 4, 13, 4, '#a3a070');
  v.box(-6, 8, -4, 6, 8, 3, '#3a2414');
  v.box(-8, 9, -2, -7, 15, 0, skin);
  v.box(8, 14, -2, 9, 18, 0, skin);
  v.box(-2, 16, -2, 2, 19, 2, skin);
  v.set(-1, 18, 3, EYE);
  v.set(1, 18, 3, EYE);
  v.box(-1, 16, 3, 1, 16, 3, '#3a1010');
  v.set(-1, 17, 3, BONE);
  v.box(0, 20, 0, 0, 21, 0, '#1a1a1a');
  // A bird has nested in the topknot, with one blue egg.
  v.box(-1, 22, -1, 1, 22, 1, '#8a6a3a');
  v.set(0, 22, 0, '#7ab8e8');
  // The club: a log with iron spikes, raised over the right shoulder.
  v.box(8, 18, -1, 9, 24, 0, WOOD);
  v.box(7, 24, -2, 10, 28, 1, '#6a3e1c');
  for (const [cx, cy, cz] of [[6, 26, 0], [11, 25, -1], [8, 29, 0], [9, 27, 2], [8, 26, -3]]) v.set(cx, cy, cz, '#d8d8d8');
  return v;
}

function warlord(): Vox {
  const v = new Vox();
  const armour = '#3a3d44';
  const gold = '#e8b730';
  // A red cape down his back.
  v.box(-5, 3, -4, 5, 14, -4, '#a01818');
  body(v, { helm: armour, trim: gold, cloth: armour, skin: '#6f9a34' });
  // Gold-trimmed pauldrons and breastplate.
  v.box(-6, 8, -2, -3, 9, 1, armour);
  v.box(3, 8, -2, 6, 9, 1, armour);
  v.box(-6, 9, -2, -3, 9, 1, gold);
  v.box(3, 9, -2, 6, 9, 1, gold);
  v.box(-2, 5, 2, 2, 7, 2, gold);
  v.box(-1, 6, 2, 1, 6, 2, '#c8322a');
  // Bone horns curling up off the helm.
  v.box(-4, 14, 0, -4, 15, 0, BONE);
  v.box(-5, 16, 0, -5, 17, 0, BONE);
  v.box(4, 14, 0, 4, 15, 0, BONE);
  v.box(5, 16, 0, 5, 17, 0, BONE);
  // A great axe.
  v.box(5, 3, 1, 5, 18, 1, '#3a2414');
  v.box(6, 15, 1, 8, 19, 1, '#c8ccd2');
  v.box(9, 16, 1, 9, 18, 1, '#e8ecf0');
  return v;
}

const MODELS: Record<EnemyKind, () => Vox> = { grunt, chucker, barrel, runner, rider, orcCatapult: catapult, ogre, warlord };
/** Voxel size per kind: how big each model stands on the field. */
const SCALE: Record<EnemyKind, number> = { grunt: 0.11, chucker: 0.11, barrel: 0.11, runner: 0.09, rider: 0.12, orcCatapult: 0.15, ogre: 0.17, warlord: 0.2 };

export class VoxelOrcs {
  readonly meshes = {} as Record<EnemyKind, THREE.InstancedMesh>;

  constructor(scene: THREE.Scene, max: (kind: EnemyKind) => number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const kind of Object.keys(MODELS) as EnemyKind[]) {
      const geo = new VoxBatch().add(MODELS[kind](), SCALE[kind], new THREE.Vector3()).geometries().solid!;
      const n = max(kind);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes[kind] = mesh;
    }
  }
}
