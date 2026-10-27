import * as THREE from 'three';
import type { ObstacleLook } from '../sim/obstacles';
import { Vox, jitter, seeded } from './voxels';

/**
 * The voxel models: the town's buildings, the trees, the structures on the field and the
 * orc camp beyond it. Built from the art thread's voxel references (the keep, tavern and
 * alchemist paintings, ref-voxel-trees, ref-voxel-tower-modules). Every model is in voxel
 * units with x across, y up and z toward the camera, standing on y = 0 round x = z = 0.
 * Each one hides a small surprise (a squirrel, a sleeping cat, a frog), so no two corners
 * of the map look like a stock asset.
 */

export const PAL = {
  cream: '#e7d8b4',
  creamDark: '#cdbb92',
  stone: '#8f8a82',
  stoneDark: '#6e6a64',
  blue: '#2a4fb0',
  blueLight: '#3d66d6',
  gold: '#e8b730',
  wood: '#7a4a24',
  woodDark: '#4f2e15',
  plaster: '#f0e4c6',
  timber: '#6b3f1e',
  tile: '#d9572b',
  tileLight: '#ec7440',
  slate: '#4a5878',
  glow: '#ffcc4a',
  iron: '#4a4a52',
};

/** Cream ashlar: rows of blocks two voxels high with staggered joints, each block its own shade. */
function brick(base: string, rnd: () => number, joints = 0.82): (x: number, y: number, z: number) => THREE.Color {
  const shades = new Map<string, number>();
  return (x, y, z) => {
    const row = Math.floor(y / 2);
    const along = (x + z + (row % 2) * 2) / 4;
    const block = `${row}:${Math.floor(along)}`;
    if (!shades.has(block)) shades.set(block, 0.9 + rnd() * 0.18);
    const c = new THREE.Color(base).multiplyScalar(shades.get(block)!);
    // A darker mortar line under each row and at each joint.
    if (y % 2 === 0 || (x + z + (row % 2) * 2) % 4 === 0) c.multiplyScalar(joints + rnd() * 0.06);
    return c;
  };
}

/** Roof tiles: rows that alternate light and dark, each tile a little different. */
function tiles(base: string, rnd: () => number): (x: number, y: number, z: number) => THREE.Color {
  return (x, y) => jitter(base, 0.08, rnd).multiplyScalar(y % 2 === 0 ? 1 : 0.86).multiplyScalar((x % 3 === 0) ? 0.94 : 1);
}

/** Battlements round the top of a box: a merlon every other voxel along the edge. */
function crenellate(v: Vox, x0: number, z0: number, x1: number, z1: number, y: number, p: (x: number, y: number, z: number) => THREE.ColorRepresentation): void {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (!edge) continue;
      v.set(x, y, z, p(x, y, z));
      if ((x + z) % 3 !== 0) v.set(x, y + 1, z, p(x, y + 1, z));
    }
  }
}

/** A round tower: plinth, wall with a darker band, battlements or a cone roof with a gold finial. */
function roundTower(v: Vox, cx: number, cz: number, r: number, top: number, roof: boolean, rnd: () => number): void {
  const wall = brick(PAL.cream, rnd);
  v.cyl(cx, cz, r + 1, 0, 2, () => jitter(PAL.stone, 0.1, rnd));
  v.cyl(cx, cz, r, 3, top, (x, y, z) => (y % 9 === 0 ? jitter(PAL.creamDark, 0.05, rnd) : wall(x, y, z)));
  // Glowing slit windows facing the camera and the sides.
  for (const wy of [Math.round(top * 0.45), Math.round(top * 0.75)]) {
    v.set(cx, wy, cz + Math.round(r), PAL.glow, true);
    v.set(cx, wy + 1, cz + Math.round(r), PAL.glow, true);
    v.set(cx + Math.round(r), wy, cz, PAL.glow, true);
    v.set(cx - Math.round(r), wy, cz, PAL.glow, true);
  }
  if (roof) {
    const h = Math.round(r * 2.6);
    v.cone(cx, cz, r + 1.4, top + 1, h, tiles(PAL.blue, rnd));
    v.set(cx, top + h + 1, cz, PAL.gold);
    v.set(cx, top + h + 2, cz, PAL.gold);
  } else {
    v.cyl(cx, cz, r - 1, top, top, PAL.wood, false);
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      if (a % 2) continue;
      v.set(cx + Math.round(Math.cos(ang) * r), top + 1, cz + Math.round(Math.sin(ang) * r), jitter(PAL.cream, 0.06, rnd));
    }
  }
}

/** A flag on a pole: blue with a gold tower, its tail kinked as if it were flapping. */
function flag(v: Vox, x: number, y: number, z: number, h: number): void {
  v.box(x, y, z, x, y + h, z, PAL.woodDark);
  v.set(x, y + h + 1, z, PAL.gold);
  for (let i = 1; i <= 5; i++) {
    for (let j = 0; j < 3; j++) {
      const kink = i > 3 ? 1 : 0;
      v.set(x + i, y + h - j - kink, z, i === 3 && j === 1 ? PAL.gold : i > 4 ? PAL.blueLight : PAL.blue);
    }
  }
}

/** The royal banner: blue with a gold border, a gold tower and crossed arrows, cut to a point. */
function banner(v: Vox, cx: number, y0: number, y1: number, z: number, halfW: number): void {
  const crest = [
    '.x.x.x.',
    '.xxxxx.',
    '..xxx..',
    '..x.x..',
    '..xxx..',
    '..xxx..',
    '.xxxxx.',
    'x.....x',
  ];
  for (let y = y0; y <= y1; y++) {
    for (let x = -halfW; x <= halfW; x++) {
      // A point at the bottom.
      if (y - y0 < Math.abs(x) - halfW + 3) continue;
      const border = Math.abs(x) === halfW || y === y1 || y - y0 === Math.abs(x) - halfW + 3;
      let col = border ? PAL.gold : PAL.blue;
      const cy = y1 - 3 - y;
      if (cy >= 0 && cy < crest.length) {
        const ch = crest[cy][x + 3];
        if (ch === 'x') col = PAL.gold;
      }
      v.set(cx + x, y, z, col);
    }
  }
  // The rod it hangs from.
  v.box(cx - halfW - 1, y1 + 1, z, cx + halfW + 1, y1 + 1, z, PAL.gold);
}

/** A torch on a bracket: an iron cup with a glowing flame. */
function torch(v: Vox, x: number, y: number, z: number): void {
  v.set(x, y, z, PAL.iron);
  v.set(x, y + 1, z, '#ff8a2a', true);
  v.set(x, y + 2, z, '#ffd24a', true);
}

/**
 * The keep: a square keep with a wooden roof deck and flags, four round towers with blue
 * cone roofs, two smaller towers at the front, the royal banner and a studded oak door.
 * About 30 x 30 voxels across.
 */
export function keepModel(): Vox {
  const v = new Vox();
  const rnd = seeded(11);
  const wall = brick(PAL.cream, rnd);
  v.box(-14, 0, -12, 14, 2, 12, () => jitter(PAL.stone, 0.12, rnd));
  v.shell(-10, 3, -9, 10, 28, 9, wall);
  v.box(-9, 28, -8, 9, 28, 8, (x) => jitter(x % 3 === 0 ? PAL.woodDark : PAL.wood, 0.08, rnd));
  crenellate(v, -10, -9, 10, 9, 29, wall);
  // The lookout on the deck, with a gold ball on top.
  v.box(-2, 29, -2, 2, 35, 2, wall);
  v.box(-1, 36, -1, 1, 37, 1, PAL.gold);
  flag(v, -6, 29, 5, 7);
  flag(v, 5, 29, 5, 7);
  for (const [x, z] of [[-11, -10], [11, -10], [-11, 9], [11, 9]]) roundTower(v, x, z, 4.5, 31, true, rnd);
  for (const x of [-8, 8]) roundTower(v, x, 12, 3.4, 17, true, rnd);
  // The banner down the front.
  banner(v, 0, 11, 25, 10, 4);
  // The door: a stone arch round studded oak, and steps down.
  v.box(-4, 3, 10, 4, 10, 10, () => jitter(PAL.stone, 0.1, rnd));
  v.box(-3, 3, 11, 3, 8, 11, (x, y) => (y === 5 || (x === 0 && y > 3) ? PAL.iron : jitter(PAL.wood, 0.1, rnd)));
  v.box(-2, 9, 11, 2, 9, 11, () => jitter(PAL.stone, 0.1, rnd));
  v.set(-1, 6, 12, PAL.gold);
  v.set(1, 6, 12, PAL.gold);
  for (let i = 0; i < 3; i++) v.box(-4 + i, 0, 13 + i, 4 - i, 2 - i, 13 + i, () => jitter(PAL.creamDark, 0.06, rnd));
  torch(v, -6, 8, 12);
  torch(v, 6, 8, 12);
  // Glowing windows up the front of the keep.
  for (const x of [-7, 7]) for (const y of [14, 20]) v.box(x, y, 10, x, y + 1, 10, PAL.glow);
  v.each((_x, _y, _z, c) => {
    if (c.c.equals(new THREE.Color(PAL.glow))) c.glow = true;
  });
  // A crow on the lookout, eyeing the battlefield.
  v.set(2, 38 - 2, 3, '#1e1e24');
  v.set(2, 37, 3, '#1e1e24');
  v.set(2, 37, 4, '#f0b020');
  return v;
}

/** Half-timbering on a plastered wall: posts at the corners and every few voxels, beams at each floor, a brace or two. */
function halfTimber(x0: number, z0: number, x1: number, z1: number, floors: number[], rnd: () => number): (x: number, y: number, z: number) => THREE.ColorRepresentation {
  return (x, y, z) => {
    const along = x === x0 || x === x1 ? z - z0 : x - x0;
    const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
    if (corner || floors.includes(y) || along % 6 === 0) return jitter(PAL.timber, 0.08, rnd);
    // A diagonal brace in every other panel.
    const panel = Math.floor(along / 6);
    const fy = floors.filter((f) => f < y).pop() ?? floors[0];
    if (panel % 2 === 0 && (along % 6) === (y - fy) % 6) return jitter(PAL.timber, 0.08, rnd);
    return jitter(PAL.plaster, 0.04, rnd);
  };
}

/** A window: a glowing 2 x 2 pane in a wooden frame, with shutters either side, on the +z face. */
function windowZ(v: Vox, x: number, y: number, z: number): void {
  v.box(x - 1, y - 1, z, x + 2, y + 2, z, PAL.timber);
  v.box(x, y, z, x + 1, y + 1, z, PAL.glow);
  v.set(x - 2, y, z, PAL.woodDark);
  v.set(x - 2, y + 1, z, PAL.woodDark);
  v.set(x + 3, y, z, PAL.woodDark);
  v.set(x + 3, y + 1, z, PAL.woodDark);
}

function markGlow(v: Vox, ...colors: string[]): void {
  const cs = colors.map((c) => new THREE.Color(c));
  v.each((_x, _y, _z, c) => {
    if (cs.some((k) => k.equals(c.c))) c.glow = true;
  });
}

/** An empty plot waiting for the town to pay: a stone footing, scaffold poles, planks and a sign. */
export function plotModel(): Vox {
  const v = new Vox();
  const rnd = seeded(51);
  v.shell(-8, 0, -6, 8, 1, 6, () => jitter(PAL.stone, 0.14, rnd));
  for (const [x, z] of [[-8, -6], [8, -6], [-8, 6], [8, 6], [0, 6], [0, -6]]) v.box(x, 2, z, x, 12, z, PAL.wood);
  v.box(-8, 8, 6, 8, 8, 6, PAL.wood);
  v.box(-8, 8, -6, 8, 8, -6, PAL.wood);
  v.box(-8, 12, 6, 8, 12, 6, PAL.woodDark);
  // Stacked stone and a sign.
  v.box(-4, 0, -2, -1, 2, 1, () => jitter(PAL.cream, 0.1, rnd));
  v.box(2, 0, 0, 4, 1, 2, () => jitter(PAL.cream, 0.1, rnd));
  v.box(5, 0, 9, 5, 4, 9, PAL.wood);
  v.box(3, 4, 9, 7, 6, 9, '#d8b878');
  return v;
}

/** The War Room (placeholder until it has art): a stone hall with a red tiled roof and a banner pole. */
export function warRoomModel(): Vox {
  const v = new Vox();
  const rnd = seeded(71);
  v.box(-8, 0, -6, 8, 1, 6, () => jitter(PAL.stone, 0.12, rnd));
  v.shell(-7, 2, -5, 7, 10, 5, brick(PAL.stone, rnd));
  v.box(-1, 2, 5, 1, 6, 5, PAL.woodDark);
  windowZ(v, -5, 5, 5);
  windowZ(v, 5, 5, 5);
  v.gable(-8, 8, -7, 7, 11, tiles('#b8322a', rnd), PAL.stone);
  v.box(10, 0, 4, 10, 22, 4, PAL.wood);
  v.box(11, 16, 4, 14, 21, 4, '#b8322a');
  v.box(11, 18, 4, 12, 19, 4, PAL.gold);
  return v;
}

/** The Barracks (placeholder): a long timber hall, a fenced yard and a weapon rack. */
export function barracksModel(): Vox {
  const v = new Vox();
  const rnd = seeded(72);
  v.box(-10, 0, -5, 10, 1, 5, () => jitter(PAL.stone, 0.12, rnd));
  v.shell(-9, 2, -4, 9, 8, 4, halfTimber(-9, -4, 9, 4, [2, 8], rnd));
  v.box(-1, 2, 4, 1, 6, 4, PAL.woodDark);
  windowZ(v, -6, 5, 4);
  windowZ(v, 6, 5, 4);
  v.gable(-10, 10, -6, 6, 9, tiles(PAL.slate, rnd), PAL.plaster);
  // The yard fence in front, with a gap at the door.
  for (let x = -10; x <= 10; x += 2) if (Math.abs(x) > 2) v.box(x, 0, 9, x, 3, 9, PAL.wood);
  v.box(-10, 2, 9, -3, 2, 9, PAL.woodDark);
  v.box(3, 2, 9, 10, 2, 9, PAL.woodDark);
  v.box(-10, 0, 6, -10, 3, 9, PAL.wood);
  v.box(10, 0, 6, 10, 3, 9, PAL.wood);
  // A weapon rack: two posts, a bar and spears.
  v.box(5, 0, 7, 5, 4, 7, PAL.wood);
  v.box(9, 0, 7, 9, 4, 7, PAL.wood);
  v.box(5, 3, 7, 9, 3, 7, PAL.woodDark);
  for (let x = 6; x <= 8; x++) v.box(x, 1, 7, x, 6, 7, PAL.iron);
  return v;
}

/** The Watchtower (placeholder): a tall narrow stone tower with a wooden lookout on top. */
export function watchtowerModel(): Vox {
  const v = new Vox();
  const rnd = seeded(73);
  v.box(-4, 0, -4, 4, 1, 4, () => jitter(PAL.stone, 0.12, rnd));
  v.shell(-3, 2, -3, 3, 28, 3, brick(PAL.stone, rnd));
  v.box(-1, 2, 3, 1, 6, 3, PAL.woodDark);
  for (const y of [12, 20]) v.box(0, y, 3, 0, y + 2, 3, PAL.woodDark);
  // The lookout: a wider wooden deck, rails, posts and a pitched roof.
  v.box(-4, 29, -4, 4, 29, 4, PAL.wood);
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) v.box(x, 30, z, x, 35, z, PAL.woodDark);
  v.box(-4, 31, 4, 4, 31, 4, PAL.wood);
  v.box(-4, 31, -4, 4, 31, -4, PAL.wood);
  v.box(-4, 31, -4, -4, 31, 4, PAL.wood);
  v.box(4, 31, -4, 4, 31, 4, PAL.wood);
  v.gable(-5, 5, -5, 5, 36, tiles(PAL.tile, rnd));
  v.box(0, 30, 0, 0, 33, 0, PAL.glow);
  markGlow(v, PAL.glow);
  return v;
}

export type RoofKind = 'tile' | 'thatch' | 'slate';

/** A townsfolk cottage: w x d voxels, one storey, with a roof of tile, thatch or slate. */
export function cottageModel(seed: number, w: number, d: number, roof: RoofKind): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const hx = Math.floor(w / 2);
  const hz = Math.floor(d / 2);
  v.box(-hx, 0, -hz, hx, 1, hz, () => jitter(PAL.stone, 0.12, rnd));
  v.shell(-hx, 2, -hz, hx, 9, hz, halfTimber(-hx, -hz, hx, hz, [2, 9], rnd));
  windowZ(v, -hx + 2, 5, hz);
  v.box(hx - 3, 2, hz, hx - 2, 6, hz, PAL.woodDark);
  const base = roof === 'tile' ? PAL.tile : roof === 'thatch' ? '#c9a24a' : PAL.slate;
  v.gable(-hx - 1, hx + 1, -hz - 2, hz + 2, 10, roof === 'thatch' ? () => jitter(base, 0.14, rnd) : tiles(base, rnd), PAL.plaster);
  if (rnd() < 0.7) v.box(hx - 2, 12, -1, hx - 1, 17, 0, () => jitter('#cfcac0', 0.1, rnd));
  // Something by the door: a flower box, a woodpile or a sleeping dog.
  const pick = rnd();
  if (pick < 0.33) v.box(-hx + 1, 3, hz + 1, -hx + 4, 3, hz + 1, (x) => (x % 2 ? '#ff6a9a' : '#ffe14a'));
  else if (pick < 0.66) v.box(hx + 1, 0, -2, hx + 2, 2, 2, (_, y, z) => ((y + z) % 2 ? '#8a5a30' : '#a8763e'));
  else {
    v.box(hx - 6, 0, hz + 2, hx - 4, 0, hz + 2, '#b08050');
    v.set(hx - 3, 1, hz + 2, '#b08050');
  }
  markGlow(v, PAL.glow);
  return v;
}

/** A market stall: four posts, a striped awning and a counter of produce. */
export function stallModel(seed: number, stripe: string): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  for (const [x, z] of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) v.box(x, 0, z, x, 6, z, PAL.wood);
  v.box(-5, 7, -3, 5, 7, 3, (x) => (Math.floor((x + 5) / 2) % 2 ? stripe : '#f4ecd8'));
  v.box(-5, 6, 3, 5, 6, 3, (x) => (Math.floor((x + 5) / 2) % 2 ? stripe : '#f4ecd8'));
  v.box(-4, 2, -1, 4, 2, 2, PAL.wood);
  const goods = ['#ff5a3a', '#ffe14a', '#7ad04a', '#d07a2a', '#c04aa0'];
  for (let x = -3; x <= 3; x++) for (let z = 0; z <= 1; z++) if (rnd() < 0.8) v.set(x, 3, z, goods[Math.floor(rnd() * goods.length)]);
  return v;
}

/** The town well: a stone ring, two posts, a little roof and a bucket on a rope. */
export function wellModel(): Vox {
  const v = new Vox();
  const rnd = seeded(61);
  v.cyl(0, 0, 3, 0, 3, () => jitter(PAL.stone, 0.14, rnd));
  v.cyl(0, 0, 1.6, 2, 2, '#2a5a8a', false);
  v.box(-3, 4, 0, -3, 9, 0, PAL.wood);
  v.box(3, 4, 0, 3, 9, 0, PAL.wood);
  v.gable(-4, 4, -2, 2, 10, tiles(PAL.tile, rnd));
  v.box(-2, 8, 0, 2, 8, 0, PAL.woodDark);
  v.box(0, 5, 0, 0, 7, 0, '#c8b890');
  v.box(0, 4, 0, 0, 4, 0, PAL.wood);
  return v;
}

/** Hay bales, crates and a cart: clutter for the corners of the base. */
export function clutterModel(seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const kind = Math.floor(rnd() * 3);
  if (kind === 0) {
    v.box(-2, 0, -1, 2, 2, 1, () => jitter('#e2c260', 0.1, rnd));
    v.box(-1, 3, -1, 1, 3, 1, () => jitter('#e2c260', 0.1, rnd));
  } else if (kind === 1) {
    v.box(-2, 0, -2, 0, 2, 0, (x, y, z) => ((x + y + z) % 2 ? '#a8763e' : '#8a5a30'));
    v.box(1, 0, -1, 2, 1, 0, (x, y, z) => ((x + y + z) % 2 ? '#a8763e' : '#8a5a30'));
    v.set(-1, 3, -1, '#ff5a3a');
  } else {
    v.box(-3, 1, -1, 3, 2, 1, PAL.wood);
    v.box(-3, 3, -1, 3, 3, -1, PAL.woodDark);
    v.box(-3, 3, 1, 3, 3, 1, PAL.woodDark);
    v.cyl(-2, 0, 0, 0, 0, PAL.iron, false);
    for (const x of [-2, 2]) for (const z of [-2, 2]) v.box(x, 0, z, x, 1, z, '#3a2a1a');
    v.box(4, 1, 0, 6, 1, 0, PAL.wood);
    v.box(-1, 3, 0, 1, 4, 0, '#e2c260');
  }
  return v;
}

// ---- trees ------------------------------------------------------------------

/** Leaves carry tag 1 so they can be knocked off; trunks are 0. */
export const LEAF = 1;

export type TreeKind = 'pine' | 'oak' | 'birch' | 'dead' | 'bush';

/** A voxel tree, as in ref-voxel-trees: pines in tiers, round oaks (one in a few has a squirrel), birches, a dead tree or a bush. */
export function treeModel(kind: TreeKind, seed: number, details = true): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const leaf = (base: string, light: string) => (x: number, y: number, z: number) => {
    // Lighter on top, where the sun catches it.
    const top = !v.has(x, y + 1, z) && rnd() < 0.6;
    return jitter(top ? light : base, 0.1, rnd);
  };
  if (kind === 'pine') {
    const h = 3 + Math.floor(rnd() * 3);
    v.box(0, 0, 0, 0, h, 0, PAL.wood);
    v.set(1, 0, 0, PAL.wood);
    v.set(-1, 0, 0, PAL.wood);
    v.tagNext = LEAF;
    const tiers = 3 + Math.floor(rnd() * 2);
    let y = h - 1;
    for (let t = 0; t < tiers; t++) {
      const r = 3.4 - t * 0.8;
      for (let k = 0; k < 2; k++) v.cyl(0, 0, Math.max(0.6, r - k * 0.7), y + k, y + k, leaf('#1f6a2c', '#3d9a3a'), false);
      y += 2;
    }
    v.set(0, y, 0, '#3d9a3a');
  } else if (kind === 'oak' || kind === 'birch') {
    const birch = kind === 'birch';
    const h = 3 + Math.floor(rnd() * 2);
    v.box(0, 0, 0, 0, h + 2, 0, (_, y) => (birch ? (y % 3 === 1 ? '#3a3a3a' : '#ece8de') : jitter(PAL.wood, 0.1, rnd)));
    if (!birch) for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) v.set(x, 0, z, PAL.wood);
    // A heart carved into one birch in five.
    if (details && birch && rnd() < 0.2) v.set(0, 2, 1, '#a0522d');
    v.tagNext = LEAF;
    const r = birch ? 2.3 : 2.8 + rnd();
    v.blob(0, h + 3, 0, r, r * 0.85, r, leaf(birch ? '#6ab83a' : '#4f9a2a', birch ? '#a8e050' : '#8ccf3a'), rnd, 0.3);
    v.tagNext = 0;
    // The odd oak has a squirrel looking out of its nest.
    if (details && !birch && rnd() < 0.08) {
      const z = Math.ceil(r);
      v.set(0, h + 3, z, '#5a3418');
      v.set(0, h + 4, z, '#e07a2a');
      v.set(1, h + 4, z, '#e07a2a');
    }
  } else if (kind === 'dead') {
    v.box(0, 0, 0, 0, 6, 0, PAL.wood);
    v.box(1, 4, 0, 2, 5, 0, PAL.wood);
    v.box(-2, 5, 0, -1, 6, 0, PAL.wood);
    v.box(2, 6, 0, 2, 8, 0, PAL.wood);
    v.box(-2, 7, 0, -2, 8, 0, PAL.wood);
    v.box(0, 7, 0, 0, 9, 0, PAL.wood);
    // An orc helmet left hanging on a branch.
    if (details && rnd() < 0.3) {
      v.box(3, 4, 0, 4, 5, 0, '#8a3a2a');
      v.set(5, 5, 0, '#e8e0d0');
    }
  } else {
    v.tagNext = LEAF;
    v.blob(0, 1, 0, 1.8, 1.4, 1.8, leaf('#4f9a2a', '#8ccf3a'), rnd, 0.3);
    if (details && rnd() < 0.3) v.set(1, 2, 1, rnd() < 0.5 ? '#ff4a6a' : '#fff0f0');
  }
  v.tagNext = 0;
  return v;
}

/** Little things in the grass, so the field is never flat paint: tufts, flowers, pebbles, a toadstool. */
export function scatterModel(seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const pick = rnd();
  if (pick < 0.45) {
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(rnd() * 3) - 1;
      const z = Math.floor(rnd() * 3) - 1;
      const h = 1 + Math.floor(rnd() * 3);
      v.box(x, 0, z, x, h - 1, z, jitter(rnd() < 0.5 ? '#4f8a2a' : '#7fb83a', 0.12, rnd));
    }
  } else if (pick < 0.7) {
    const colors = ['#ffffff', '#ffe14a', '#ff8ab0', '#8ab4ff', '#ff6a3a'];
    const c = colors[Math.floor(rnd() * colors.length)];
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(rnd() * 3) - 1;
      const z = Math.floor(rnd() * 3) - 1;
      v.set(x, 0, z, '#4f8a2a');
      v.set(x, 1, z, c);
    }
  } else if (pick < 0.97) {
    for (let i = 0; i < 3; i++) v.set(Math.floor(rnd() * 3) - 1, 0, Math.floor(rnd() * 3) - 1, jitter('#9a958a', 0.15, rnd));
    if (rnd() < 0.4) v.set(0, 1, 0, jitter('#aaa59a', 0.1, rnd));
  } else {
    v.box(0, 0, 0, 0, 1, 0, '#f0e8d8');
    v.box(-1, 2, -1, 1, 2, 1, (x, _, z) => ((x + z) % 2 === 0 && x !== 0 ? '#ffffff' : '#d8302a'));
    v.set(0, 3, 0, '#d8302a');
  }
  return v;
}

// ---- the field's structures -------------------------------------------------

/**
 * One of the field's structures, sized to its hit shape in world units at voxel size `size`.
 * Built centred on the origin, unturned (the scene turns it to the obstacle's angle).
 */
export function obstacleModel(look: ObstacleLook, size: number, r: number, hw: number, hh: number, seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const R = r / size;
  const W = Math.round(hw / size);
  const D = Math.round(hh / size);
  const moss = (base: string) => (x: number, y: number, z: number) => (!v.has(x, y + 1, z) && rnd() < 0.2 ? jitter('#5a9a30', 0.15, rnd) : jitter(base, 0.12, rnd));
  switch (look) {
    case 'boulder': {
      v.blob(0, R * 0.55, 0, R, R * 0.8, R, (_, y) => jitter(y > R * 0.9 ? '#a8a49a' : '#8c877c', 0.1, rnd), rnd, 0.15);
      v.each((x, y, z, c) => {
        if (!v.has(x, y + 1, z) && rnd() < 0.35) c.c = jitter('#5a9a30', 0.15, rnd);
      });
      // A broken orc arrow stuck in it.
      v.box(0, Math.round(R * 1.2), Math.round(R * 0.4), 0, Math.round(R * 1.2) + 2, Math.round(R * 0.4), '#6a3a1a');
      v.set(0, Math.round(R * 1.2) + 3, Math.round(R * 0.4), '#c02a2a');
      break;
    }
    case 'milestone': {
      v.box(-Math.round(R), 0, -1, Math.round(R), Math.round(R * 4), 1, moss('#a09a8c'));
      // XII, carved.
      for (let y = 3; y < Math.round(R * 3); y += 1) v.set(0, y, 2, '#5a564e');
      break;
    }
    case 'well': {
      const w = wellModel();
      w.each((x, y, z, c) => v.set(Math.round(x * 1.2), y, Math.round(z * 1.2), c.c));
      v.cyl(0, 0, R, 0, 3, () => jitter(PAL.stone, 0.14, rnd));
      break;
    }
    case 'mill': {
      // Ruined stone walls round a broken floor, a toppled waterwheel against one side.
      v.shell(-W, 0, -D, W, 3, D, () => jitter('#a09a8c', 0.12, rnd));
      const footing: [number, number][] = [];
      v.each((x, y, z) => {
        if (y === 3) footing.push([x, z]);
      });
      for (const [x, z] of footing) {
        const h = 3 + Math.round(Math.abs(Math.sin(x * 0.7 + z)) * 7);
        for (let yy = 4; yy < h; yy++) if (rnd() < 0.92) v.set(x, yy, z, jitter('#a09a8c', 0.12, rnd));
      }
      v.box(-W + 1, 0, -D + 1, W - 1, 0, D - 1, (x) => jitter(x % 2 ? PAL.wood : PAL.woodDark, 0.1, rnd));
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        v.set(W + 1, 5 + Math.round(Math.sin(ang) * 5), Math.round(Math.cos(ang) * 5), PAL.wood);
      }
      v.box(W + 1, 0, 0, W + 1, 10, 0, PAL.woodDark);
      v.box(W + 1, 5, -5, W + 1, 5, 5, PAL.woodDark);
      break;
    }
    case 'fence': {
      for (let x = -W; x <= W; x++) {
        if (x % 3 === 0) v.box(x, 0, 0, x, 4, 0, PAL.woodDark);
        // Broken in the middle, where something big came through.
        if (Math.abs(x) > 1 || rnd() < 0.3) {
          v.set(x, 2, 0, PAL.wood);
          v.set(x, 3 + (x > 1 ? 1 : 0), 0, PAL.wood);
        }
      }
      break;
    }
    case 'stone': {
      // A standing stone with a rune that glows.
      const h = Math.round(R * 5);
      v.box(-Math.round(R * 0.8), 0, -Math.round(R * 0.6), Math.round(R * 0.8), h, Math.round(R * 0.6), (_, y) => jitter(y > h - 2 ? '#5a5866' : '#4a4856', 0.1, rnd));
      const z = Math.round(R * 0.6) + 1;
      v.glowNext = true;
      for (const [x, y] of [[0, h - 3], [0, h - 4], [0, h - 5], [-1, h - 4], [1, h - 5], [0, h - 6]]) v.set(x, y, z, '#b46aff');
      v.glowNext = false;
      v.box(-Math.round(R), 0, -Math.round(R), Math.round(R), 0, Math.round(R), moss('#4a4856'));
      break;
    }
    case 'ruin': {
      // A slab of black wall, broken off along the top, with a torn orc banner.
      v.box(-W, 0, -D, W, 2, D, () => jitter('#3e3a40', 0.12, rnd));
      for (let x = -W; x <= W; x++) {
        const h = 4 + Math.round((Math.sin(x * 0.9) + 1) * 3 + rnd() * 2);
        v.box(x, 3, -D, x, h, D, () => jitter('#4a4650', 0.12, rnd));
      }
      v.box(-1, 4, D + 1, 1, 8, D + 1, (x, y) => (y === 8 ? '#2a2a2a' : (x + y) % 3 === 0 ? '#2a2a2a' : '#a02a2a'));
      v.set(0, 6, D + 1, '#e8e0d0');
      break;
    }
    case 'barricade': {
      // Crossed stakes lashed to a plank, rotated by the scene to the piece's angle.
      v.box(-W, 2, -1, W, 2, 1, () => jitter(PAL.wood, 0.12, rnd));
      v.box(-W, 4, -1, W, 4, 1, () => jitter(PAL.woodDark, 0.12, rnd));
      for (const cx of [-W + 2, 0, W - 2]) {
        for (let t = 0; t <= 7; t++) {
          const dx = Math.round((t - 3.5) * 0.6);
          const c = t > 5 ? '#3a2a1a' : jitter(PAL.wood, 0.12, rnd);
          v.set(cx + dx, t, 0, c);
          v.set(cx - dx, t, 0, c);
        }
      }
      break;
    }
    case 'rubble': {
      // A heap of broken wall stone.
      v.blob(0, R * 0.35, 0, R, R * 0.55, R, (_, y) => jitter(y > R * 0.4 ? '#a8a49a' : '#8c877c', 0.12, rnd), rnd, 0.35);
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.28;
        v.blob(Math.cos(a) * R * 0.6, 1, Math.sin(a) * R * 0.6, 1.3, 1, 1.3, () => jitter('#9a968c', 0.15, rnd), rnd, 0.3);
      }
      break;
    }
    case 'spikes': {
      // An orc barricade: sharpened stakes leaning out.
      for (let x = -W; x <= W; x += 2) {
        for (let y = 0; y < 6; y++) v.set(x, y, Math.round(-D + y * 0.4), y > 4 ? '#3a2a1a' : jitter(PAL.wood, 0.12, rnd));
      }
      v.box(-W, 1, -D, W, 1, -D, PAL.woodDark);
      // A skull on one stake.
      v.box(W - 1, 6, 1, W, 7, 1, '#ece4d4');
      break;
    }
  }
  return v;
}

// ---- beyond the field: the orc camp ------------------------------------------

/** A hide tent on poles, a spiky top, maybe a red war banner. */
export function tentModel(seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const r = 4 + Math.floor(rnd() * 3);
  v.cone(0, 0, r, 0, r + 3, () => jitter(rnd() < 0.5 ? '#8a6a44' : '#7a5a3a', 0.12, rnd));
  v.box(0, r + 3, 0, 0, r + 6, 0, PAL.woodDark);
  v.box(-1, r, Math.round(r * 0.6), 1, r + 1, Math.round(r * 0.6), '#e8e0d0');
  if (rnd() < 0.5) {
    v.box(2, r + 2, 0, 2, r + 9, 0, PAL.woodDark);
    v.box(3, r + 6, 0, 5, r + 9, 0, '#a82a2a');
  }
  return v;
}

/** A campfire: ring of stones, glowing embers. */
export function campfireModel(): Vox {
  const v = new Vox();
  const rnd = seeded(77);
  v.cyl(0, 0, 2, 0, 0, () => jitter('#6e6a64', 0.12, rnd));
  v.glowNext = true;
  v.box(-1, 1, -1, 1, 1, 1, '#ff6a1a');
  v.set(0, 2, 0, '#ffd24a');
  v.glowNext = false;
  return v;
}

/** A crude orc totem of skulls and planks. */
export function totemModel(): Vox {
  const v = new Vox();
  v.box(0, 0, 0, 1, 16, 1, '#4f2e15');
  for (const y of [5, 10, 15]) {
    v.box(-1, y, 2, 2, y + 2, 2, '#ece4d4');
    v.set(0, y + 1, 3, '#2a2a2a');
    v.set(1, y + 1, 3, '#2a2a2a');
  }
  v.box(-4, 13, 0, 5, 13, 0, '#4f2e15');
  v.box(-4, 8, 0, -4, 12, 0, '#a82a2a');
  v.box(5, 8, 0, 5, 12, 0, '#a82a2a');
  return v;
}

/** A section of spiked log palisade. */
export function palisadeModel(len: number, seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  for (let x = 0; x < len; x++) {
    const h = 6 + Math.floor(rnd() * 3);
    v.box(x, 0, 0, x, h, 0, () => jitter('#6a4628', 0.12, rnd));
    v.set(x, h + 1, 0, '#3a2a1a');
  }
  v.box(0, 3, 1, len - 1, 3, 1, PAL.woodDark);
  return v;
}

/**
 * The giant crossbow: a ballista on a turntable, built to sit on the wall walk or a tower top.
 * Steel bow arms swept back, a bolt in the groove, a winch at the back, a bucket of spare bolts
 * and a little royal pennant. It points along -z (at the orcs); the scene turns it to its aim.
 */
export function ballistaModel(): Vox {
  const v = new Vox();
  // The turntable: oak planks in an iron ring, on a stone footing.
  v.cyl(0, 0, 6.5, 0, 0, PAL.stoneDark, false);
  v.cyl(0, 0, 6, 1, 1, (x, _y, z) => (Math.hypot(x, z) > 5 ? PAL.iron : (x + 20) % 3 === 0 ? '#5a3a1c' : '#7a5230'), false);
  // The post and the stock along it, with a dark groove for the bolt.
  v.box(-1, 2, -1, 1, 5, 1, PAL.woodDark);
  v.box(-2, 6, -9, 2, 6, 6, '#8a5a30');
  v.box(0, 6, -9, 0, 6, 4, '#3a2412');
  // Steel bow arms, swept back toward their tips.
  for (let x = -11; x <= 11; x++) {
    const z = -8 + Math.round((x * x) / 30);
    const tip = Math.abs(x) >= 10;
    v.set(x, 7, z, tip ? '#2a2c30' : Math.abs(x) < 2 ? PAL.iron : '#b8bec4');
    if (!tip && Math.abs(x) > 1) v.set(x, 7, z - 1, '#8f969d');
  }
  // The string, drawn back to the trigger.
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    for (const side of [-1, 1]) v.set(side * Math.round(11 * (1 - t)), 8, Math.round(-4 + t * 7), '#e8e0c8');
  }
  // The bolt: a dark shaft with a steel head out front and red fletching behind.
  v.box(0, 7, -14, 0, 7, 2, '#5a3418');
  v.box(0, 7, -16, 0, 7, -15, '#e4e4e4');
  v.set(-1, 7, -15, '#c8c8c8');
  v.set(1, 7, -15, '#c8c8c8');
  v.box(-1, 7, 1, 1, 7, 2, '#c8322a');
  // The winch at the back: two spoked wheels and their crank.
  for (const side of [-3, 3]) {
    for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(Math.hypot(dy, dz) - 1.8) < 0.6 || dy === 0 || dz === 0) v.set(side, 6 + dy, 5 + dz, '#4a2e18');
  }
  v.box(-3, 6, 5, 3, 6, 5, PAL.iron);
  // A bucket of spare bolts, and the royal pennant on a pole.
  v.cyl(5, 3, 1.6, 2, 4, '#6b4424', true);
  for (const [bx, bz] of [[5, 3], [4, 3], [5, 2]]) v.box(bx, 5, bz, bx, 7, bz, '#5a3418');
  v.box(-5, 2, 4, -5, 13, 4, PAL.woodDark);
  v.box(-5, 11, 0, -5, 13, 3, PAL.blue);
  v.box(-5, 12, 1, -5, 12, 2, PAL.gold);
  return v;
}

// ---- pinball contraptions ------------------------------------------------------

/** The coiled spring of a bumper, standing on a stone plate (r voxels wide). */
export function bumperSpringModel(r: number): Vox {
  const v = new Vox();
  v.cyl(0, 0, r - 0.5, 0, 0, PAL.stoneDark, false);
  for (let y = 1; y <= 6; y++) v.cyl(0, 0, y % 2 ? 1.8 : 1.2, y, y, y % 2 ? '#d4d9e0' : '#8a909a', false);
  return v;
}

/** A chunky round royal shield, gold rim, blue face with a red cross: built flat, y 0 at its underside. */
export function bumperShieldModel(r: number): Vox {
  const v = new Vox();
  v.cyl(0, 0, r, 0, 1, (x, _, z) => {
    const d = Math.hypot(x, z);
    if (d > r - 1 || d < 1) return PAL.gold;
    return Math.abs(x) < 1 || Math.abs(z) < 1 ? '#d8302a' : PAL.blueLight;
  }, false);
  v.set(0, 2, 0, PAL.gold);
  return v;
}

/** Two wooden posts and a crossbeam (the beam at y = 10, the bell hangs from the middle). */
export function bellPostModel(): Vox {
  const v = new Vox();
  v.box(-4, 0, -1, -3, 10, 0, PAL.wood);
  v.box(3, 0, -1, 4, 10, 0, PAL.wood);
  v.box(-4, 10, -1, 4, 11, 0, PAL.woodDark);
  v.box(-5, 0, -2, 5, 0, 1, PAL.stoneDark);
  return v;
}

/** A small bell with its top at y = 0, hanging down. */
export function bellModel(): Vox {
  const v = new Vox();
  const radii = [1.2, 2, 2, 2.5, 3, 3.5];
  radii.forEach((r, i) => v.cyl(0, 0, r, -1 - i, -1 - i, i === 5 ? '#c9981c' : PAL.gold, false));
  v.cyl(0, 0, 3.5, -7, -7, '#c9981c', false);
  v.box(0, -9, 0, 0, -8, 0, PAL.woodDark);
  v.set(0, 0, 0, PAL.woodDark);
  return v;
}

/** A broken siege ramp built flat: the front (nearest the castle) is +z and low, the far end -z and high. */
export function rampModel(size: number, hw: number, hh: number, seed: number): Vox {
  const v = new Vox();
  const rnd = seeded(seed);
  const W = Math.max(2, Math.round(hw / size));
  const D = Math.max(2, Math.round(hh / size));
  const rise = (z: number) => 6 - Math.round(((D - z) / (2 * D)) * 6);
  for (let z = -D; z <= D; z++) {
    const top = rise(z);
    // Planks across, a gap or two where they have broken, timber trestles underneath.
    for (let x = -W; x <= W; x++) {
      if (rnd() < 0.04) continue;
      v.set(x, top, z, jitter((x + z) % 3 ? PAL.wood : '#8a5a2e', 0.1, rnd));
    }
    v.box(-W, top, z, -W, top + 1, z, PAL.woodDark);
    v.box(W, top, z, W, top + 1, z, PAL.woodDark);
    if (z % 3 === 0) for (const x of [-W + 1, 0, W - 1]) v.box(x, 0, z, x, top - 1, z, PAL.timber);
  }
  // Cross battens nailed on the slope, and a torn orc banner on the high end.
  for (let z = -D + 1; z <= D; z += 3) v.box(-W + 1, rise(z) + 1, z, W - 1, rise(z) + 1, z, PAL.woodDark);
  v.box(0, 7, -D, 0, 12, -D, PAL.woodDark);
  v.box(1, 9, -D, 3, 12, -D, '#a02a2a');
  return v;
}

// ---- the four newer defenders (placeholder voxel art) ----------------------------

/** A mage: blue robe and pointed hat, a staff topped with a glowing orb (the orb is glow voxels). Faces -z. */
export function mageModel(): Vox {
  const v = new Vox();
  // Robe: a cone widening to the hem, a belt, arms, head and a floppy hat.
  v.cone(0, 0, 4, 0, 9, '#3a3fa8');
  v.cyl(0, 0, 4, 0, 0, '#262a78', false);
  v.cyl(0, 0, 2.2, 9, 12, '#3a3fa8', false);
  v.cyl(0, 0, 2.3, 7, 7, PAL.gold, false);
  v.box(-3, 9, -1, -3, 11, 0, '#3a3fa8');
  v.box(3, 9, -2, 3, 11, -1, '#3a3fa8');
  v.cyl(0, 0, 1.8, 13, 15, '#e8c9a0', false);
  v.set(-1, 14, -2, '#222');
  v.set(1, 14, -2, '#222');
  v.cyl(0, 0, 2, 16, 16, '#4a2a8a', false);
  v.cone(0, 0, 3.2, 16, 7, '#4a2a8a');
  v.set(0, 21, 0, PAL.gold);
  // Beard.
  v.box(-1, 11, -2, 1, 12, -2, '#e8e8e8');
  // The staff in the right hand, with the orb on top.
  v.box(4, 0, -2, 4, 19, -2, PAL.woodDark);
  v.glowNext = true;
  v.blob(4, 22, -2, 2, 2, 2, '#c07aff', () => 0, 0);
  v.set(4, 22, -2, '#ffffff');
  v.glowNext = false;
  return v;
}

/** The siege ballista: the giant crossbow lifted on a wheeled wooden stand. Points along -z. */
export function bigBallistaModel(): Vox {
  const v = new Vox();
  const lift = 5;
  ballistaModel().each((x, y, z, c) => v.set(x, y + lift, z, c.c));
  // Four stout legs braced on a base frame, and two cart wheels.
  for (const [x, z] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) v.box(x, 0, z, x, lift, z, PAL.woodDark);
  v.box(-6, 1, -5, 6, 1, -5, PAL.wood);
  v.box(-6, 1, 5, 6, 1, 5, PAL.wood);
  v.box(-6, 2, -5, -6, 2, 5, PAL.wood);
  v.box(6, 2, -5, 6, 2, 5, PAL.wood);
  for (const x of [-8, 8]) v.cyl(x, 0, 3.2, 3, 3, '#4a2e18', false);
  return v;
}

/** A boiling-oil cauldron on an iron tripod over embers, with a spout tipping toward the wall face (-z). */
export function oilModel(): Vox {
  const v = new Vox();
  // Stone hearth with glowing embers.
  v.cyl(0, 0, 5, 0, 1, PAL.stoneDark, false);
  v.glowNext = true;
  v.cyl(0, 0, 3, 1, 1, '#ff7a2a', false);
  v.glowNext = false;
  // Cauldron body, rim, and the bubbling oil.
  v.cyl(0, 0, 4.5, 3, 7, '#26282c', true);
  v.cyl(0, 0, 3.5, 2, 2, '#26282c', false);
  v.cyl(0, 0, 5, 8, 8, '#3a3d44', false);
  v.glowNext = true;
  v.cyl(0, 0, 4, 7, 7, '#ff9a2a', false);
  v.set(1, 8, 1, '#ffd34a');
  v.set(-2, 8, 0, '#ffd34a');
  v.glowNext = false;
  // Spout lip pointing at the wall face, and a pole to tip it.
  v.box(-1, 6, -7, 1, 8, -5, '#26282c');
  v.box(-1, 5, -7, 1, 5, -6, '#26282c');
  v.box(5, 4, 0, 9, 4, 0, PAL.woodDark);
  return v;
}

/** A flat iron plate bristling with spikes, built to sit on the grass (about 7 voxels radius). */
export function spikeTrapModel(): Vox {
  const v = new Vox();
  v.cyl(0, 0, 7, 0, 0, (x, _y, z) => ((x + z) % 2 ? '#5a5d64' : '#4a4d54'), false);
  v.cyl(0, 0, 7, 1, 1, '#6f737b', true);
  for (let x = -5; x <= 5; x += 2) {
    for (let z = -5; z <= 5; z += 2) {
      if (Math.hypot(x, z) > 5.4) continue;
      v.box(x, 1, z, x, 2, z, '#c8ccd2');
      v.set(x, 3, z, '#ffffff');
    }
  }
  return v;
}

// ---- the castle's own defenders, as small voxel figures -----------------------------

const SKIN = '#e8c9a0';
const STEEL = '#8a8f99';

/** A small royal archer: blue tunic with gold trim, brown hood, a bow in the left hand. Faces -z, about 16 voxels tall. */
export function archerModel(): Vox {
  const v = new Vox();
  v.box(-2, 0, -1, -1, 3, 0, '#5a3a22');
  v.box(1, 0, -1, 2, 3, 0, '#5a3a22');
  v.box(-2, 0, -1, -1, 0, -1, '#3a2414');
  v.box(1, 0, -1, 2, 0, -1, '#3a2414');
  v.box(-2, 4, -1, 2, 9, 0, PAL.blue);
  v.box(-2, 4, -1, 2, 4, 0, PAL.gold);
  v.box(-2, 6, -1, 2, 6, 0, PAL.gold);
  v.box(-1, 9, -1, 1, 9, 0, PAL.gold);
  // Arms: the right one by the side, the left one reaching out with the bow.
  v.box(3, 6, -1, 3, 9, 0, PAL.blue);
  v.set(3, 5, -1, SKIN);
  v.box(-3, 7, -2, -3, 9, -1, PAL.blue);
  v.set(-4, 7, -2, SKIN);
  v.box(-4, 4, -3, -4, 10, -3, PAL.woodDark);
  v.set(-4, 3, -2, PAL.woodDark);
  v.set(-4, 11, -2, PAL.woodDark);
  v.box(-4, 4, -1, -4, 10, -1, '#e8e0d0');
  // Head, eyes, hood and cap with a gold feather; a quiver on the back.
  v.box(-1, 10, -1, 1, 13, 0, SKIN);
  v.set(-1, 12, -1, '#222');
  v.set(1, 12, -1, '#222');
  v.box(-2, 13, -2, 2, 14, 1, '#6b4423');
  v.box(-1, 15, -1, 1, 15, 0, '#6b4423');
  v.set(2, 15, 0, PAL.gold);
  v.box(-1, 9, 1, 1, 12, 1, '#6b4423');
  v.box(1, 6, 1, 1, 10, 1, PAL.wood);
  v.set(1, 11, 1, '#ffffff');
  return v;
}

/** A footman: steel helmet with a gold plume, blue-and-gold tabard, round shield, spear. Faces -z, about 17 voxels tall. */
export function soldierModel(): Vox {
  const v = new Vox();
  v.box(-2, 0, -1, -1, 4, 0, STEEL);
  v.box(1, 0, -1, 2, 4, 0, STEEL);
  v.box(-2, 0, -1, -1, 1, -1, '#3a2414');
  v.box(1, 0, -1, 2, 1, -1, '#3a2414');
  v.box(-2, 5, -1, 2, 10, 0, PAL.blue);
  v.box(0, 5, -1, 0, 10, -1, PAL.gold);
  v.box(-2, 6, -1, 2, 6, 0, '#3a2a1a');
  v.box(-3, 7, -1, -3, 10, 0, STEEL);
  v.box(3, 7, -1, 3, 10, 0, STEEL);
  // Head, eyes, helmet with cheek guards and a plume.
  v.box(-1, 11, -1, 1, 13, 0, SKIN);
  v.set(-1, 12, -1, '#222');
  v.set(1, 12, -1, '#222');
  v.box(-2, 11, -1, -2, 13, 0, STEEL);
  v.box(2, 11, -1, 2, 13, 0, STEEL);
  v.box(-2, 14, -2, 2, 15, 1, STEEL);
  v.box(-1, 16, -1, 1, 16, 0, STEEL);
  v.box(0, 17, -1, 0, 17, 0, PAL.gold);
  // Round shield on the left arm.
  for (let x = -7; x <= -1; x++) {
    for (let y = 4; y <= 10; y++) {
      const d = Math.hypot(x + 4, y - 7);
      if (d > 2.6) continue;
      v.set(x, y, -2, d > 1.8 ? STEEL : d < 0.8 ? PAL.gold : PAL.blue);
    }
  }
  // Spear in the right hand.
  v.box(4, 0, -1, 4, 20, -1, PAL.wood);
  v.box(4, 21, -1, 4, 23, -1, '#c8ccd2');
  v.set(4, 7, -1, SKIN);
  v.set(4, 8, -1, SKIN);
  return v;
}

/** The castle's wooden catapult: wheeled frame, throwing arm with a bucket holding a gold royal ball. Throws toward -z. */
export function castleCatapultModel(): Vox {
  const v = new Vox();
  // Frame: side beams with cross beams, an axle at each end and big wheels.
  v.box(-4, 3, -8, -3, 4, 8, PAL.wood);
  v.box(3, 3, -8, 4, 4, 8, PAL.wood);
  for (const z of [-7, 0, 7]) v.box(-4, 3, z, 4, 4, z, PAL.woodDark);
  for (const z of [-5, 5]) {
    v.box(-6, 3, z, 6, 3, z, PAL.woodDark);
    for (const x of [-6, 5]) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          const d = Math.hypot(dy, dz);
          if (d > 3.3) continue;
          v.box(x, 3 + dy, z + dz, x + 1, 3 + dy, z + dz, d < 1.1 ? PAL.gold : d > 2.4 ? '#5a3a1a' : '#8a5a2e');
        }
      }
    }
  }
  // Two uprights carrying the pivot.
  v.box(-4, 5, -1, -3, 11, 0, PAL.woodDark);
  v.box(3, 5, -1, 4, 11, 0, PAL.woodDark);
  v.box(-4, 10, -1, 4, 10, 0, PAL.iron);
  // The arm: rising from a counterweight at the back, over the pivot, to the bucket.
  for (let z = 6; z >= -8; z--) {
    const y = Math.round(10 - z * 0.5);
    v.box(-1, y, z, 0, y + 1, z, PAL.wood);
  }
  v.box(-2, 3, 5, 1, 6, 7, PAL.iron);
  v.cyl(0, -9, 2, 13, 13, PAL.woodDark, false);
  v.cyl(0, -9, 2.4, 14, 14, PAL.woodDark, true);
  v.blob(0, 16, -9, 2, 2, 2, '#e8b730', () => 0, 0);
  v.set(-1, 17, -10, '#fff2a8');
  // A royal pennant on the front beam.
  v.box(-1, 5, -8, 1, 7, -8, PAL.blue);
  v.set(0, 6, -8, PAL.gold);
  return v;
}

/** A one-storey stone tower with crenellations and the blue-and-gold banner on the front (-z). */
export function towerModel(): Vox {
  const v = new Vox();
  const rnd = seeded(11);
  const stone = brick(PAL.stone, rnd);
  v.box(-6, 0, -6, 6, 19, 6, stone);
  for (let x = -6; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) {
      if ((Math.abs(x) !== 6 && Math.abs(z) !== 6) || (x + z + 100) % 4 >= 2) continue;
      v.box(x, 20, z, x, 21, z, stone);
    }
  }
  v.box(-2, 0, -7, 2, 3, -7, '#3b2618');
  v.box(-1, 4, -7, 1, 4, -7, '#3b2618');
  v.box(-2, 9, -7, 2, 16, -7, PAL.blue);
  v.box(-2, 9, -7, 2, 9, -7, PAL.gold);
  v.box(-2, 9, -7, -2, 16, -7, PAL.gold);
  v.box(2, 9, -7, 2, 16, -7, PAL.gold);
  v.box(0, 12, -7, 0, 14, -7, PAL.gold);
  return v;
}
