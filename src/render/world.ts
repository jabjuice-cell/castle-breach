import * as THREE from 'three';
import aspects from '../assets/aspects.json';
import tf1 from '../assets/sprites/townsfolk-1.webp';
import tf2 from '../assets/sprites/townsfolk-2.webp';
import tf3 from '../assets/sprites/townsfolk-3.webp';
import tf4 from '../assets/sprites/townsfolk-4.webp';
import tf5 from '../assets/sprites/townsfolk-5.webp';
import tf6 from '../assets/sprites/townsfolk-6.webp';
import tf7 from '../assets/sprites/townsfolk-7.webp';
import tf8 from '../assets/sprites/townsfolk-8.webp';
import { BUILDING_KINDS, type BuildingKind, type Game } from '../sim/game';
import { KEEP_CELLS, type Layout, PLOT_W, type PieceId, landBounds, pieceCells } from '../sim/plot';
import { roadAt } from './ground';
import {
  LEAF, PIECE_TILE, type RoofKind, type TreeKind, bellModel, bellPostModel, bumperShieldModel, bumperSpringModel, rampModel, campfireModel, clutterModel, cottageModel, keepModel, obstacleModel,
  palisadeModel, pieceModel, scatterModel, tentModel, totemModel, treeModel, wellModel,
} from './models';
import { type SpriteArt, imageSprite } from './textures';
import { Vox, VoxBatch, seeded } from './voxels';

/**
 * Everything round the battle that isn't fighting: the town behind the wall (the keep,
 * tavern and alchemist you click for powers, cottages, stalls and the townsfolk walking
 * between them), the tree lines that chip when a ball hits them, the deep forest
 * beyond, the structures on the field and the orc camp past its far end.
 */

/** Voxel sizes: the town's buildings, the trees by the field, the far forest, the field's structures. */
const BUILD_VOX = 0.4;
/** The keep is drawn finer, so it can be big and detailed without hiding the wall behind it. */
const KEEP_VOX = 0.34;
const TREE_VOX = 0.4;
const FAR_VOX = 0.75;
const PROP_VOX = 0.3;
/** The trees standing out on the field. */
const FIELD_TREE_VOX = 0.42;

/**
 * Where each building with a power stands (world x, z), and how high its top is, for the tag over it.
 * buildTown moves x, z and top to wherever the building stands on the town plot.
 */
export const BUILDINGS: Record<BuildingKind, { x: number; z: number; top: number; name: string; power: string }> = {
  keep: { x: 0, z: 11, top: 14.5, name: 'The keep', power: 'Call to arms' },
  tavern: { x: 0, z: 0, top: 0, name: 'The Rusty Tankard', power: 'Stand a round' },
  alchemist: { x: 0, z: 0, top: 0, name: 'The alchemist', power: 'Every ball burns' },
  blacksmith: { x: 0, z: 0, top: 0, name: 'The Blacksmith', power: 'Shield & ball' },
  chapel: { x: 0, z: 0, top: 0, name: 'The Chapel', power: 'Mends the wall' },
  forge: { x: 0, z: 0, top: 0, name: 'The Siege Forge', power: 'Catapult +40%' },
  warroom: { x: 0, z: 0, top: 0, name: 'The War Room', power: 'Battle tactic' },
  barracks: { x: 0, z: 0, top: 0, name: 'The Barracks', power: 'Unit roles' },
  watchtower: { x: 0, z: 0, top: 0, name: 'The Watchtower', power: 'Scout the horde' },
};
/** The plot piece each building with a power stands on (the barracks is the 'soldiers' upgrade). */
const PIECE_OF: Record<Exclude<BuildingKind, 'keep'>, PieceId> = {
  tavern: 'tavern', alchemist: 'alchemist', blacksmith: 'blacksmith', chapel: 'chapel', forge: 'forge', warroom: 'warroom', barracks: 'soldiers', watchtower: 'watchtower',
};

/** The town plot on the ground: world units per tile, the left edge of tile column 0 and the back edge of row 0 (by the wall). */
export const PLOT_TILE = 3;
const PLOT_X0 = -(PLOT_W / 2) * PLOT_TILE;
const PLOT_Z0 = 6.5;
const PIECE_VOX = PLOT_TILE / PIECE_TILE;

export interface WorldFx {
  puff(x: number, y: number, z: number, size: number, color: string, life: number): void;
  burst(x: number, y: number, z: number, n: number, color: string, speed: number): void;
}

interface Spot {
  kind: BuildingKind;
  group: THREE.Object3D;
  box: THREE.Box3;
  built: boolean;
  glow: number;
}

interface LeafVoxel {
  pos: THREE.Vector3;
  color: THREE.Color;
  leaf: boolean;
  alive: boolean;
}

interface Walker {
  mesh: THREE.Mesh;
  /** Natural facing of the art: 1 if it faces right. */
  faces: number;
  node: number;
  path: number[];
  x: number;
  z: number;
  speed: number;
  pause: number;
  hop: number;
  phase: number;
}

/** The streets the townsfolk walk: nodes (world x, z) and the links between them. */
const NODES: [number, number][] = [
  // 0-8: the street in front of the town plot.
  [-32, 26.5], [-23, 26.5], [-15.5, 26.5], [-8.5, 26.5], [0, 26.5], [8.5, 26.5], [15.5, 26.5], [23, 26.5], [32, 26.5],
  // 9-10: lanes down either end of the plot; 11-13: the back lane under the wall, 11 by the gate.
  [-24.5, 15], [24.5, 15], [0, 4.5], [-24.5, 4.5], [24.5, 4.5],
  // 14-17: cottage doors.
  [-30, 15.5], [30, 15.5], [-31.5, 25], [33.5, 23],
];
const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
  [1, 9], [7, 10], [9, 12], [10, 13], [12, 11], [11, 13],
  [9, 14], [10, 15], [0, 16], [8, 17],
];
/** Where people go: doors, the street, the gate. */
const DESTINATIONS = [4, 11, 9, 10, 14, 15, 16, 17, 0, 8, 2, 6];

/** Natural facing of each townsfolk sprite (1 = right): farmer, baker, boy, fletcher, monk, old man, water carrier, merchant. */
const FOLK = [tf1, tf2, tf3, tf4, tf5, tf6, tf7, tf8];
const FOLK_FACES = [-1, 1, 1, -1, 1, 1, 1, 1];
const FOLK_HEIGHT = 1.7;

const tmpM = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class World {
  readonly root = new THREE.Group();
  private spots: Spot[] = [];
  private base = new THREE.Group();
  private props = new THREE.Group();
  /** Everything that depends on the field's width: the tree lines, the deep forest, the camp, the scatter. */
  private field = new THREE.Group();
  /** The trees standing on the field, by obstacle index, each its own model so it can come down. */
  private fieldTrees = new Map<number, THREE.Object3D>();
  /** The pinball fixtures on the field, by contraption index; the bumpers squash and the bells swing. */
  private fixtures = new THREE.Group();
  /** Each contraption's group, by contraption index, so it can be moved or dragged. */
  private fixtureGroups: THREE.Group[] = [];
  /** A fixture being dragged to a new spot (it follows the mouse, tinted by whether it fits). */
  private drag: { index: number; ok: boolean } | null = null;
  /** Placed pieces a ball just hit: seconds of shake left, by obstacle index. */
  private shaking = new Map<number, number>();
  private fixtureParts: { kind: 'bumper' | 'bell' | 'ramp'; spring?: THREE.Object3D; pivot?: THREE.Object3D; phase: number }[] = [];
  private treeMesh!: THREE.InstancedMesh;
  private treeVoxels: LeafVoxel[] = [];
  /** Leaf voxel ids by side and 2-unit slice of z, for finding the ones a ball hits. */
  private treeBuckets = new Map<number, number[]>();
  private walkers: Walker[] = [];
  private chimneys: { x: number; y: number; z: number; color: string; rate: number }[] = [];
  private campfires: { x: number; y: number; z: number; color: string; rate: number }[] = [];
  private folkArt: SpriteArt[];
  private adj: number[][];
  private rnd = seeded(5);
  private hw: number;
  /** The town plot as laid out in the town, and how much land is open. */
  private plot: Layout = [];
  private land = 0;

  constructor(
    private game: Game,
    private readonly camera: THREE.Camera,
    private readonly fx: WorldFx,
  ) {
    this.hw = game.cfg.field.halfWidth;
    this.adj = NODES.map(() => []);
    for (const [a, b] of LINKS) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
    this.folkArt = FOLK.map((url, i) => imageSprite(url, (aspects as Record<string, number>)[`townsfolk-${i + 1}`] ?? 1));
    this.root.add(this.base, this.props, this.field, this.fixtures);
    this.buildField();
    this.buildTown();
    this.buildProps();
    this.spawnWalkers();
  }

  /** A new level: the town shows what has been built, the field gets its structures, the trees grow back. */
  setGame(game: Game): void {
    this.game = game;
    this.buildTown();
    this.buildProps();
    if (game.cfg.field.halfWidth !== this.hw) {
      // A wider (or narrower) field: the tree lines, forest and camp move out to its edges.
      this.hw = game.cfg.field.halfWidth;
      this.buildField();
      return;
    }
    for (let i = 0; i < this.treeVoxels.length; i++) {
      const v = this.treeVoxels[i];
      if (v.alive) continue;
      v.alive = true;
      this.treeMesh.setMatrixAt(i, tmpM.makeTranslation(v.pos));
    }
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }

  /** The town's layout changed (or a level starts with it): the pieces are rebuilt where they stand. */
  setPlot(plot: Layout, land: number): void {
    this.plot = plot.map((p) => ({ ...p }));
    this.land = land;
    this.buildTown();
  }

  // ---- the town -------------------------------------------------------------

  private buildTown(): void {
    for (const c of [...this.base.children]) {
      this.base.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.spots = [];
    this.chimneys = [];
    const place = (v: Vox, x: number, z: number, turn = 0, size = BUILD_VOX) => {
      const g = new VoxBatch().add(v, size, new THREE.Vector3(x, 0, z), turn).build();
      this.base.add(g);
      return g;
    };
    // The keep stands fixed, front and centre on the plot, by the wall.
    const keepX = PLOT_X0 + (KEEP_CELLS[0][0] + 1.5) * PLOT_TILE;
    const keepZ = PLOT_Z0 + 1.5 * PLOT_TILE;
    Object.assign(BUILDINGS.keep, { x: keepX, z: keepZ });
    const keep = place(keepModel(), keepX, keepZ, 0, KEEP_VOX);
    this.spots.push({ kind: 'keep', group: keep, box: new THREE.Box3().setFromObject(keep), built: true, glow: 0 });
    // Every placed building is a voxel piece on its tiles; one waiting in the builders' yard isn't drawn.
    const groups = new Map<PieceId, THREE.Group>();
    this.plot.forEach((p, i) => {
      const cells = pieceCells(p);
      const mx = Math.min(...cells.map((c) => c[0]));
      const my = Math.min(...cells.map((c) => c[1]));
      const local = cells.map(([x, y]) => [x - mx, y - my] as [number, number]);
      const at = new THREE.Vector3(PLOT_X0 + mx * PLOT_TILE + PIECE_VOX / 2, 0, PLOT_Z0 + my * PLOT_TILE + PIECE_VOX / 2);
      const g = new VoxBatch().add(pieceModel(p.id, local, 600 + i), PIECE_VOX, at).build();
      this.base.add(g);
      groups.set(p.id, g);
    });
    for (const kind of BUILDING_KINDS) {
      if (kind === 'keep') continue;
      const g = groups.get(PIECE_OF[kind]);
      if (!g || !this.game.hasBuilding(kind)) continue;
      const box = new THREE.Box3().setFromObject(g);
      const c = box.getCenter(new THREE.Vector3());
      Object.assign(BUILDINGS[kind], { x: c.x, z: c.z, top: box.max.y + 1 });
      this.spots.push({ kind, group: g, box, built: true, glow: 0 });
    }
    // A low fence round the open land; the closed land beyond it waits for a land grant.
    const lb = landBounds(this.land);
    const fence = new Vox();
    const fx0 = lb.x0 * PIECE_TILE - 1;
    const fx1 = (lb.x1 + 1) * PIECE_TILE;
    const fz1 = (lb.y1 + 1) * PIECE_TILE;
    for (let x = fx0; x <= fx1; x++) {
      if (x % 4 === 0) fence.box(x, 0, fz1, x, 3, fz1, '#7a4a24');
      fence.set(x, 2, fz1, '#9a6a3a');
    }
    for (const x of [fx0, fx1]) {
      for (let z = 0; z <= fz1; z++) {
        if (z % 4 === 0) fence.box(x, 0, z, x, 3, z, '#7a4a24');
        fence.set(x, 2, z, '#9a6a3a');
      }
    }
    this.base.add(new VoxBatch().add(fence, PIECE_VOX, new THREE.Vector3(PLOT_X0 + PIECE_VOX / 2, 0, PLOT_Z0 + PIECE_VOX / 2)).build());
    // Cottages beyond the plot's ends, a well and clutter.
    const cottages: [number, number, number, number, RoofKind][] = [
      [-30, 12, 11, 9, 'thatch'], [30, 12, 11, 9, 'thatch'], [33.5, 20, 11, 9, 'slate'], [-31.5, 22, 11, 9, 'thatch'],
    ];
    cottages.forEach(([x, z, w, d, roof], i) => {
      place(cottageModel(100 + i, w, d, roof), x, z);
      if (i % 2 === 0) this.chimneys.push({ x: x + (Math.floor(w / 2) - 1.5) * BUILD_VOX, y: 7.2, z: z - 0.2, color: '#cfcac0', rate: 0.8 });
    });
    place(wellModel(), -27, 28);
    const clutter: [number, number][] = [[-12, 28], [11.5, 28.5], [-26, 6], [26, 6.5], [-36, 17], [37, 16]];
    clutter.forEach(([x, z], i) => place(clutterModel(300 + i), x, z, (i * 1.3) % Math.PI));
    // Trees round the town's edge, and a line of them outside the wall's ends.
    const tb = new VoxBatch();
    const r = seeded(77);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (38 + r() * 10);
      const z = 3 + r() * 26;
      tb.add(treeModel(r() < 0.5 ? 'oak' : 'pine', 400 + i), TREE_VOX, new THREE.Vector3(x, 0, z));
    }
    this.base.add(tb.build());
  }

  /** The building under a ray, if any (only built ones have powers). */
  pick(ray: THREE.Ray): BuildingKind | null {
    let best: BuildingKind | null = null;
    let bestD = Infinity;
    const hit = new THREE.Vector3();
    for (const s of this.spots) {
      if (!ray.intersectBox(s.box, hit)) continue;
      const d = hit.distanceToSquared(ray.origin);
      if (d < bestD) {
        bestD = d;
        best = s.kind;
      }
    }
    return best;
  }

  /** Lights a building up: the one under the mouse, or one whose power just went off. */
  glow(kind: BuildingKind, amount: number): void {
    const s = this.spots.find((o) => o.kind === kind);
    if (s) s.glow = Math.max(s.glow, amount);
  }

  /** The townsfolk cheer (a little hop) when a power goes off. */
  cheer(): void {
    for (const w of this.walkers) w.hop = 0.6 + Math.random() * 0.4;
  }

  // ---- tree lines -----------------------------------------------------------

  private buildField(): void {
    for (const c of [...this.field.children]) {
      this.field.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.treeBuckets.clear();
    this.campfires = [];
    this.buildTreeLines();
    this.buildBackFence();
    this.buildFarForest();
    this.buildCamp();
    this.buildScatter();
  }

  /** A chunky stone wall along the back edge (field.topY) where the ball bounces; orcs march in from behind it. */
  private buildBackFence(): void {
    const hw = this.hw;
    const z = -this.game.cfg.field.topY;
    const stone = new THREE.MeshLambertMaterial({ color: '#7d7a72' });
    const cap = new THREE.MeshLambertMaterial({ color: '#d8d2c0' });
    const post = new THREE.MeshLambertMaterial({ color: '#b2432c' });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 1, 1.8, 0.7), stone);
    wall.position.set(0, 0.9, z - 0.35);
    this.field.add(wall);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 1.2, 0.3, 1), cap);
    top.position.set(0, 1.95, z - 0.35);
    this.field.add(top);
    const n = Math.max(2, Math.round((2 * hw) / 4) + 1);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 2.6, 0.9), post, n);
    for (let i = 0; i < n; i++) posts.setMatrixAt(i, tmpM.makeTranslation(-hw + (2 * hw * i) / (n - 1), 1.3, z - 0.35));
    this.field.add(posts);
  }

  /** Three staggered rows of voxel trees down each side of the field, their crowns just over its edge. */
  private buildTreeLines(): void {
    const r = seeded(31);
    const hw = this.hw;
    const minZ = -(this.game.cfg.field.spawnY + 26);
    const kinds: TreeKind[] = ['oak', 'oak', 'pine', 'pine', 'birch', 'oak', 'bush', 'dead'];
    const voxels: LeafVoxel[] = [];
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const step = row === 0 ? 2.3 : 2.8;
        for (let z = minZ + r() * 2; z < -0.5; z += step + r() * 0.8) {
          const kind = row === 0 ? (r() < 0.1 ? 'bush' : r() < 0.55 ? 'oak' : r() < 0.75 ? 'birch' : 'pine') : kinds[Math.floor(r() * kinds.length)];
          // The first row's crowns reach just over the field's edge, where the ball bounces.
          const x = side * (hw + (row === 0 ? 1 : row === 1 ? 3.6 : 6.4) + r() * 0.8);
          const v = treeModel(kind, Math.floor(r() * 1e6));
          const at = new THREE.Vector3(x, 0, z);
          v.each((vx, vy, vz, cell) => {
            if (v.buried(vx, vy, vz)) return;
            voxels.push({ pos: new THREE.Vector3(at.x + (vx + 0.5) * TREE_VOX, (vy + 0.5) * TREE_VOX, at.z + (vz + 0.5) * TREE_VOX), color: cell.c.clone(), leaf: cell.tag === LEAF, alive: true });
          });
        }
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TREE_VOX, TREE_VOX, TREE_VOX), new THREE.MeshLambertMaterial(), voxels.length);
    voxels.forEach((v, i) => {
      mesh.setMatrixAt(i, tmpM.makeTranslation(v.pos));
      mesh.setColorAt(i, v.color);
      if (!v.leaf) return;
      const key = this.bucket(Math.sign(v.pos.x), v.pos.z);
      let list = this.treeBuckets.get(key);
      if (!list) this.treeBuckets.set(key, (list = []));
      list.push(i);
    });
    mesh.frustumCulled = false;
    this.treeMesh = mesh;
    this.treeVoxels = voxels;
    this.field.add(mesh);
  }

  private bucket(side: number, z: number): number {
    return side * 10000 + Math.floor(z / 2);
  }

  /** A ball hit the tree line at world z: a few of the nearest leaves fly off. */
  chipTree(side: number, z: number): void {
    const near: number[] = [];
    for (const k of [-1, 0, 1]) for (const i of this.treeBuckets.get(this.bucket(side, z + k * 2)) ?? []) if (this.treeVoxels[i].alive) near.push(i);
    const edge = this.hw;
    const score = (i: number) => {
      const p = this.treeVoxels[i].pos;
      return Math.abs(p.z - z) * 0.8 + Math.abs(Math.abs(p.x) - edge) * 1.2 + Math.abs(p.y - 1.6) * 0.5;
    };
    near.sort((a, b) => score(a) - score(b));
    for (const i of near.slice(0, 6)) {
      const v = this.treeVoxels[i];
      if (score(i) > 4) break;
      v.alive = false;
      this.treeMesh.setMatrixAt(i, hidden);
      this.fx.burst(v.pos.x, v.pos.y, v.pos.z, 1, '#' + v.color.getHexString(), 5);
    }
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }

  /** The deep forest beyond the tree lines and round the far end: big voxels, one merged mesh. */
  private buildFarForest(): void {
    const r = seeded(91);
    const hw = this.hw;
    const batch = new VoxBatch();
    const kinds: TreeKind[] = ['oak', 'pine', 'pine', 'oak', 'birch'];
    const far = -(this.game.cfg.field.spawnY + 26);
    for (let z = -190; z < 60; z += 6) {
      for (let x = hw + 10; x < 80; x += 6 + r() * 1.5) {
        for (const side of [-1, 1]) {
          const wx = side * (x + r() * 2);
          const wz = z + r() * 3;
          // Leave the town and its edges clear, and the orc camp's clearing past the far end.
          if (wz > -2 && Math.abs(wx) < 46) continue;
          if (wz < far + 2 && Math.abs(wx) < 34) continue;
          batch.add(treeModel(kinds[Math.floor(r() * kinds.length)], Math.floor(r() * 1e6), false), FAR_VOX * (0.8 + r() * 0.4), new THREE.Vector3(wx, 0, wz));
        }
      }
    }
    // A screen of trees across the far end, behind the camp.
    for (let x = -34; x < 34; x += 4.5) batch.add(treeModel(r() < 0.6 ? 'pine' : 'oak', Math.floor(r() * 1e6), false), FAR_VOX, new THREE.Vector3(x + r() * 2, 0, far - 52 - r() * 8));
    const g = batch.build();
    this.field.add(g);
    // The land under it all, out to the horizon.
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#4f7a2e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(110,150,60,0.5)' : 'rgba(50,80,30,0.5)';
      ctx.fillRect(r() * size, r() * size, 2, 2 + r() * 3);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    plane.position.set(0, -0.05, -60);
    this.field.add(plane);
  }

  /** The orc camp past the far end of the field: tents, a palisade, campfires and a skull totem. */
  private buildCamp(): void {
    const r = seeded(13);
    const far = -(this.game.cfg.field.spawnY + 14);
    const batch = new VoxBatch();
    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (8 + r() * 22);
      const z = far - 10 - r() * 34;
      if (Math.abs(x - roadAt(z).x) < 8) continue;
      batch.add(tentModel(500 + i), PROP_VOX * 1.4, new THREE.Vector3(x, 0, z), r() * 3);
    }
    for (let i = 0; i < 5; i++) {
      const x = (r() * 2 - 1) * 20;
      const z = far - 14 - r() * 26;
      batch.add(campfireModel(), PROP_VOX * 1.3, new THREE.Vector3(x, 0, z));
      this.campfires.push({ x, y: 0.8, z, color: '#6a6460', rate: 1.2 });
    }
    batch.add(totemModel(), PROP_VOX * 1.4, new THREE.Vector3(roadAt(far - 8).x + 9, 0, far - 8));
    for (const side of [-1, 1]) {
      for (let x = 10; x < 34; x += 6) batch.add(palisadeModel(18, 600 + x), PROP_VOX * 1.2, new THREE.Vector3(side * x, 0, far - 4 - r() * 2), side * 0.1);
    }
    this.field.add(batch.build());
  }

  /** Tufts, flowers, pebbles and toadstools over the field and the land beyond it. */
  private buildScatter(): void {
    const r = seeded(17);
    const batch = new VoxBatch();
    const hw = this.hw;
    const minZ = -(this.game.cfg.field.spawnY + 50);
    for (let i = 0; i < 1100; i++) {
      const x = (r() * 2 - 1) * (hw + 2);
      const z = minZ + r() * (-1.5 - minZ);
      const road = roadAt(z);
      // Mostly off the road; a few pebbles on it.
      const onRoad = Math.abs(x - road.x) < road.half;
      const seed = Math.floor(r() * 1e6);
      if (onRoad && r() < 0.85) continue;
      batch.add(scatterModel(seed), 0.16 + r() * 0.06, new THREE.Vector3(x, 0, z), r() * 6);
    }
    this.field.add(batch.build());
  }

  // ---- the field's structures -----------------------------------------------

  private buildProps(): void {
    for (const c of [...this.props.children]) {
      this.props.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.fieldTrees.clear();
    this.buildFixtures();
    const r = seeded(4100 + this.game.level * 17 + this.game.seed % 1000);
    const kinds: TreeKind[] = ['oak', 'oak', 'pine', 'birch', 'oak', 'pine'];
    this.shaking.clear();
    this.game.obstacles.forEach((o, i) => {
      if (o.removed || (o.placed && o.down)) return;
      if (o.look === 'tree') {
        // Each tree on the field is its own model, so a ball can bring it down.
        const tree = new VoxBatch().add(treeModel(kinds[Math.floor(r() * kinds.length)], Math.floor(r() * 1e6)), FIELD_TREE_VOX, new THREE.Vector3(o.x, 0, -o.y), r() * 6).build();
        this.fieldTrees.set(i, tree);
        this.props.add(tree);
        return;
      }
      this.addObstacle(i);
    });
  }

  /** Each structure is its own model, so a ball can smash it. Also stands up a piece the player just placed. */
  addObstacle(i: number): void {
    const o = this.game.obstacles[i];
    if (!o || o.look === 'tree' || this.fieldTrees.has(i)) return;
    const v = obstacleModel(o.look, PROP_VOX, o.r ?? 1, o.hw ?? 1, o.hh ?? 1, 700 + i + this.game.level * 31);
    const prop = new VoxBatch().add(v, PROP_VOX, new THREE.Vector3(o.x, 0, -o.y), o.angle ?? 0).build();
    this.fieldTrees.set(i, prop);
    this.props.add(prop);
  }

  private dropMesh(index: number): THREE.Object3D | undefined {
    const m = this.fieldTrees.get(index);
    if (!m) return undefined;
    this.fieldTrees.delete(index);
    this.shaking.delete(index);
    this.props.remove(m);
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    return m;
  }

  /** The player took a placed piece back: its model goes, with a little dust. */
  removeObstacle(index: number): void {
    const o = this.game.obstacles[index];
    if (!this.dropMesh(index) || !o) return;
    this.fx.puff(o.x, 0.5, -o.y, 2.2, '#b8a888', 0.9);
    for (let i = 0; i < 3; i++) this.fx.burst(o.x, 0.5, -o.y, 1, o.look === 'rubble' ? '#8c877c' : '#7a4a24', 5);
  }

  /** Placed pieces that fell in the wave stand again (and any that are missing a model get one). */
  rebuildTerrain(): void {
    this.game.obstacles.forEach((o, i) => {
      if (!o.placed || o.removed || o.down || this.fieldTrees.has(i)) return;
      this.addObstacle(i);
      this.fx.puff(o.x, 0.6, -o.y, 2.4, '#c8b898', 1);
    });
  }

  /** A bumper or ramp was moved: its model goes to the new spot. */
  moveFixture(index: number, x: number, y: number): void {
    this.fixtureGroups[index]?.position.set(x, 0, -y);
    this.fx.puff(x, 0.4, -y, 2.4, '#c8b898', 0.9);
    this.fx.burst(x, 0.4, -y, 4, '#9a8f78', 5);
  }

  /** While dragging: the fixture follows (x, y) tinted green or red; null drops it back where the sim has it. */
  dragFixture(d: { index: number; x: number; y: number; ok: boolean } | null): void {
    const prev = this.drag;
    if (prev && (!d || d.index !== prev.index)) this.placeFixture(prev.index);
    if (!d) {
      this.drag = null;
      return;
    }
    this.drag = { index: d.index, ok: d.ok };
    this.fixtureGroups[d.index]?.position.set(d.x, 0.35, -d.y);
  }

  private placeFixture(index: number): void {
    const c = this.game.contraptions[index];
    const g = this.fixtureGroups[index];
    if (!c || !g) return;
    g.position.set(c.x, 0, -c.y);
    this.tint(g, 0, 0, 0);
  }

  private tint(g: THREE.Object3D, r: number, gr: number, b: number): void {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) o.material.emissive.setRGB(r, gr, b);
    });
  }

  /** The bumpers, bells and ramps of this level (rebuilt with the props). */
  private buildFixtures(): void {
    for (const c of [...this.fixtures.children]) {
      this.fixtures.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.fixtureParts = [];
    this.fixtureGroups = [];
    this.drag = null;
    const k = this.game.cfg.contraptions;
    const one = (v: Vox, size: number) => new VoxBatch().add(v, size, new THREE.Vector3()).build();
    const bells = this.game.contraptions.flatMap((c, i) => (c.kind === 'bell' ? [i] : []));
    this.game.contraptions.forEach((c, i) => {
      const g = new THREE.Group();
      g.position.set(c.x, 0, -c.y);
      this.fixtures.add(g);
      this.fixtureGroups[i] = g;
      if (c.kind === 'bumper') {
        const size = 0.3;
        const R = k.bumper.radius / size;
        const spring = one(bumperSpringModel(R), size);
        const shield = one(bumperShieldModel(R), size);
        // The shield rides the top of the spring, so squashing the spring's group squashes both.
        shield.position.y = 7 * size;
        spring.add(shield);
        g.add(spring);
        this.fixtureParts[i] = { kind: 'bumper', spring, phase: 0 };
      } else if (c.kind === 'bell') {
        const size = 0.2;
        g.add(one(bellPostModel(), size));
        const pivot = new THREE.Group();
        pivot.position.y = 10 * size;
        pivot.add(one(bellModel(), size));
        g.add(pivot);
        this.fixtureParts[i] = { kind: 'bell', pivot, phase: i * 1.7 };
      } else {
        const size = 0.3;
        g.add(new VoxBatch().add(rampModel(size, c.hw ?? 2, c.hh ?? 1.5, 90 + i), size, new THREE.Vector3(), c.angle ?? 0).build());
        this.fixtureParts[i] = { kind: 'ramp', phase: 0 };
      }
    });
    // The trio is strung together with a rope along the crossbeams.
    for (let j = 1; j < bells.length; j++) {
      const a = this.game.contraptions[bells[j - 1]];
      const b = this.game.contraptions[bells[j]];
      const rope = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b.x - a.x, b.y - a.y), 0.08, 0.08), new THREE.MeshLambertMaterial({ color: '#c8a868' }));
      rope.position.set((a.x + b.x) / 2, 10 * 0.2 + 0.1, -(a.y + b.y) / 2);
      rope.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
      this.fixtures.add(rope);
    }
  }

  /** Squashes struck bumpers (from the sim's hit time) and swings rung bells until their set resets. */
  private animateFixtures(): void {
    const g = this.game;
    const sq = g.cfg.contraptions.bumper.squashSeconds;
    this.fixtureParts.forEach((p, i) => {
      if (p.kind === 'bumper' && p.spring) {
        const age = g.time - g.bumperHit[i];
        const k = age >= 0 && age < sq ? Math.sin((Math.PI * age) / sq) : 0;
        p.spring.scale.y = 1 - 0.5 * k;
        p.spring.traverse((o) => {
          if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) o.material.emissive.setRGB(k * 0.5, k * 0.4, k * 0.1);
        });
      } else if (p.kind === 'bell' && p.pivot) {
        const at = g.bellRung[i];
        const amp = at < 0 ? 0 : 0.25 + 0.5 * Math.exp(-(g.time - at) * 1.2);
        p.pivot.rotation.z = amp * Math.sin(g.time * 9 + p.phase);
      }
    });
    if (this.drag) {
      const grp = this.fixtureGroups[this.drag.index];
      if (grp) this.tint(grp, ...(this.drag.ok ? [0.05, 0.4, 0.05] : [0.5, 0.05, 0.03]) as [number, number, number]);
    }
  }

  /** Placed pieces a ball hit jitter for a moment. */
  private animateShakes(dt: number): void {
    for (const [i, t] of this.shaking) {
      const m = this.fieldTrees.get(i);
      const left = t - dt;
      if (!m || left <= 0) {
        m?.position.set(0, 0, 0);
        this.shaking.delete(i);
        continue;
      }
      this.shaking.set(i, left);
      const k = left / 0.35;
      m.position.set(Math.sin(left * 90) * 0.12 * k, Math.abs(Math.sin(left * 50)) * 0.08 * k, Math.cos(left * 70) * 0.08 * k);
    }
  }

  /** A ball smashed a tree on the field: it bursts into leaves and splinters and is gone. */
  fellTree(index: number): void {
    const o = this.game.obstacles[index];
    if (!o || !this.dropMesh(index)) return;
    const x = o.x;
    const z = -o.y;
    const leafy = o.look === 'tree';
    const stone = o.look === 'boulder' || o.look === 'milestone' || o.look === 'stone' || o.look === 'ruin' || o.look === 'well' || o.look === 'rubble';
    for (let i = 0; i < 6; i++) this.fx.burst(x + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, z + (Math.random() - 0.5) * 2, 2, leafy ? (i % 3 ? '#5a9a32' : '#7ab83e') : stone ? '#a8a49a' : '#7a4a24', 9);
    this.fx.burst(x, 0.8, z, 6, stone ? '#8c877c' : '#6b4424', 8);
    this.fx.puff(x, 1.5, z, 3, '#8a7a5a', 1.4);
    if (leafy) this.fx.puff(x, 3, z, 3.5, '#7aa848', 1.2);
  }

  /** A ball glanced off one of the field's structures: chips of stone (or wood) fly. */
  chipObstacle(index: number, x: number, z: number): void {
    const o = this.game.obstacles[index];
    if (!o) return;
    const wood = o.look === 'fence' || o.look === 'spikes' || o.look === 'barricade';
    // A placed piece with hits left also shakes and sheds more chips.
    if (o.placed) {
      this.shaking.set(index, 0.35);
      this.fx.puff(x, 0.6, z, 1.6, wood ? '#a88858' : '#b8b0a0', 0.7);
    }
    for (let i = 0; i < (o.placed ? 8 : 4); i++) this.fx.burst(x, 0.8, z, 1, wood ? '#7a4a24' : i % 2 ? '#8c877c' : '#a8a49a', 6);
  }

  // ---- townsfolk ------------------------------------------------------------

  private spawnWalkers(): void {
    for (let i = 0; i < 16; i++) {
      const k = i % FOLK.length;
      const art = this.folkArt[k];
      const geo = new THREE.PlaneGeometry(FOLK_HEIGHT * art.aspect, FOLK_HEIGHT).translate(0, FOLK_HEIGHT / 2, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5, side: THREE.DoubleSide }));
      mesh.onBeforeRender = () => mesh.quaternion.copy(this.camera.quaternion);
      const node = DESTINATIONS[Math.floor(this.rnd() * DESTINATIONS.length)];
      const [x, z] = NODES[node];
      this.root.add(mesh);
      this.walkers.push({ mesh, faces: FOLK_FACES[k], node, path: [], x, z, speed: 1.1 + this.rnd() * 0.8, pause: this.rnd() * 4, hop: 0, phase: this.rnd() * 6 });
    }
  }

  /** The nodes from a to b along the streets (breadth first). */
  private route(a: number, b: number): number[] {
    const prev = new Map<number, number>([[a, a]]);
    const queue = [a];
    while (queue.length) {
      const n = queue.shift()!;
      if (n === b) break;
      for (const m of this.adj[n]) {
        if (prev.has(m)) continue;
        prev.set(m, n);
        queue.push(m);
      }
    }
    const path: number[] = [];
    for (let n = b; n !== a; n = prev.get(n)!) path.unshift(n);
    return path;
  }

  update(dt: number, time: number): void {
    this.animateFixtures();
    this.animateShakes(dt);
    // Smoke from the chimneys and campfires.
    for (const c of [...this.chimneys, ...this.campfires]) if (Math.random() < dt * c.rate) this.fx.puff(c.x, c.y, c.z, 1.4, c.color, 2.4);
    // Buildings glow while hovered or just used, and the ones ready to use breathe gently in battle.
    for (const s of this.spots) {
      s.glow = Math.max(0, s.glow - dt * 1.5);
      const k = s.glow;
      s.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o.material instanceof THREE.MeshLambertMaterial) o.material.emissive.setRGB(k * 0.16, k * 0.13, k * 0.04);
        else if (o.material instanceof THREE.MeshBasicMaterial) o.material.color.setRGB(1 + k * 0.3, 1 + k * 0.25, 1 + k * 0.1);
      });
    }
    // The townsfolk wander from door to stall to gate.
    for (const w of this.walkers) {
      w.hop = Math.max(0, w.hop - dt);
      if (w.pause > 0) {
        w.pause -= dt;
      } else if (!w.path.length) {
        const to = DESTINATIONS[Math.floor(this.rnd() * DESTINATIONS.length)];
        w.path = to === w.node ? [] : this.route(w.node, to);
        w.pause = 1 + this.rnd() * 5;
      } else {
        const [tx, tz] = NODES[w.path[0]];
        const dx = tx - w.x;
        const dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        const step = w.speed * dt;
        if (d <= step) {
          w.x = tx;
          w.z = tz;
          w.node = w.path.shift()!;
        } else {
          w.x += (dx / d) * step;
          w.z += (dz / d) * step;
          if (Math.abs(dx) > 0.05) w.mesh.scale.x = Math.sign(dx) === w.faces ? 1 : -1;
        }
      }
      const walking = w.pause <= 0 && w.path.length > 0;
      const bob = walking ? Math.abs(Math.sin(time * 9 + w.phase)) * 0.12 : 0;
      const hop = w.hop > 0 ? Math.sin((1 - w.hop) * Math.PI * 3) * 0.5 : 0;
      w.mesh.position.set(w.x, bob + Math.max(0, hop), w.z);
    }
  }
}
