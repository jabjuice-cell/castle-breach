import * as THREE from 'three';
import { type Defender, type PlacedKind, groundAt } from '../sim/defenders';
import { type Ball, type Capsule, type CapsuleKind, type Enemy, type Game, type GameEvent, type TerrainKind } from '../sim/game';
import { ENEMY_KINDS, type EnemyKind, formation } from '../sim/waves';
import aspects from '../assets/aspects.json';
import arrowUrl from '../assets/fx/arrow.webp';
import explosionUrl from '../assets/fx/explosion.webp';
import impactUrl from '../assets/fx/impact.webp';
import fireballUrl from '../assets/fx/fireball.webp';
import enemyBoltUrl from '../assets/fx/enemy-bolt.webp';
import craterUrl from '../assets/maps/crater.webp';
import scorchUrl from '../assets/maps/scorch.webp';
import courtyardUrl from '../assets/maps/courtyard.jpg';
import catapultUrl from '../assets/sprites/enemy-catapult.webp';
import chuckerUrl from '../assets/sprites/enemy-chucker.webp';
import gruntUrl from '../assets/sprites/enemy-grunt.webp';
import ogreUrl from '../assets/sprites/enemy-ogre.webp';
import riderUrl from '../assets/sprites/enemy-rider.webp';
import runnerUrl from '../assets/sprites/enemy-runner.webp';
import warlordUrl from '../assets/sprites/enemy-warlord.webp';
import powderBarrelUrl from '../assets/sprites/powder-barrel.webp';
import barrelBlastUrl from '../assets/fx/barrel-explosion.webp';
import scorchBlastUrl from '../assets/maps/scorch-blast.webp';
import goblinPush1Url from '../assets/sprites/goblin-push-1.webp';
import goblinPush2Url from '../assets/sprites/goblin-push-2.webp';
import warlordRevealUrl from '../assets/sprites/warlord-reveal.webp';
import { type BurstOptions, Fireworks } from './fireworks';

/** Numbered art sets (tower and warlord stages, flying planks, plates and debris), in order. */
const numbered = (files: Record<string, string>) =>
  Object.entries(files)
    .map(([path, url]) => ({ n: Number(/-(?:stage)?(\d+)\.webp$/.exec(path)![1]), name: path.split('/').pop()!.replace('.webp', ''), url }))
    .sort((a, b) => a.n - b.n);
const TOWER_STAGES = numbered(import.meta.glob<string>('../assets/sprites/siege-tower-stage*.webp', { eager: true, import: 'default' }));
const WARLORD_STAGES = numbered(import.meta.glob<string>('../assets/sprites/warlord-stage*.webp', { eager: true, import: 'default' }));
const PLANKS = numbered(import.meta.glob<string>('../assets/fx/plank-*.webp', { eager: true, import: 'default' }));
const PLATES = numbered(import.meta.glob<string>('../assets/fx/plate-*.webp', { eager: true, import: 'default' }));
const TOWER_DEBRIS = numbered(import.meta.glob<string>('../assets/fx/siege-debris-*.webp', { eager: true, import: 'default' }));
const CAPSULE_ART = import.meta.glob<string>('../assets/fx/capsule-*.webp', { eager: true, import: 'default' });
import { paintGround } from './ground';
import { Terrain } from './terrain';
import { archerModel, ballistaModel, bigBallistaModel, castleCatapultModel, mageModel, obstacleModel, oilModel, soldierModel, spikeTrapModel } from './models';
import { VoxelOrcs } from './orcs';
import { VoxBatch, atRes, type Vox } from './voxels';
import { ShieldModel } from './shield';
import { ballGeometry, rockGeometry, ROCK_DEBRIS } from './voxelBalls';
import { World } from './world';
import {
  GroundCanvas, type SpriteArt, blobTexture, capsuleTexture, detailTexture, glowTexture, imageSprite, puffTexture, loadImage, setAnisotropy,
} from './textures';

/**
 * Draws the sim in 2.5D: a voxel castle on a 3D battlefield under a tilted
 * camera, with flat sprite units. Sim (x, y) maps to world (x, 0, -y); the
 * castle sits at z 0 and above (its courtyard runs toward the camera), and
 * the enemies march in from negative z.
 */

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

/**
 * What each Detail level costs: render resolution (up to the screen's own pixel density, so
 * High is pin sharp on a retina screen), ground texture width, terrain grid spacing, debris
 * cap, how often ground marks upload, how many firework particles each burst throws, and how finely the
 * voxel models are built (High builds the balls, rocks, orcs, defenders, shield, contraptions and castle
 * from voxels half the size: the same models, rounder, with rivets, faces and edges drawn in).
 */
const QUALITY: Record<Quality, { pixelRatio: number; groundWidth: number; cell: number; debris: number; upload: number; fx: number; voxelRes: number }> = {
  low: { pixelRatio: 1, groundWidth: 1280, cell: 1, debris: 400, upload: 0.5, fx: 0.35, voxelRes: 1 },
  medium: { pixelRatio: 2, groundWidth: 2048, cell: 0.6, debris: 900, upload: 0.25, fx: 0.7, voxelRes: 1 },
  high: { pixelRatio: 2, groundWidth: 2560, cell: 0.4, debris: 1500, upload: 0.15, fx: 1, voxelRes: 2 },
};
/** How tall each kind of thrown rock is drawn. */
const THROWN_HEIGHT = { rock: 0.8, boulder: 1.8, stone: 1.2 } as const;

const VOXEL = 0.5;
const MAX_ENEMIES = 4000;
const MAX_PROJECTILES = 2500;
const MAX_DEBRIS = 1500;
/** Smoke puffs over a badly damaged wall are separate sprites, so they are capped low. */
const MAX_SMOKE = 60;
/** Wall stone, for rubble. */
const STONE = ['#a3a19c', '#8b8a85', '#6e6c68', '#b4b2ac'];
const MAX_ARCHERS = 20 * 30;
const MAX_BALLS = 64;
const MAX_BARRELS = 300;

/** Firework palettes. */
const GOLD = ['#fff6c8', '#ffd34a', '#ffb43a'];
const STEEL = ['#ffffff', '#d8f4ff', '#9cc8ff'];
const ORANGE = ['#ffd08a', '#ff9a2a', '#ff7a1a'];
const FIRE = ['#fff2a8', '#ffb43a', '#ff6a2a', '#e2331f'];
const ARCANE = ['#ffffff', '#e2baff', '#b06aff', '#6a3ad8'];
const OIL = ['#fff2a8', '#ffb43a', '#ff7a2a', '#3a2a1a'];
const WOOD = ['#c8945a', '#8a5a2e', '#f2d29a'];
const ROYAL = ['#2a4fb0', '#6a8cff', '#ffd34a', '#ffffff'];
const PARTY = ['#ff5a8a', '#ffd34a', '#5ad8ff', '#8aff6a', '#c08aff', '#ffffff'];
const COMBO_COLORS: Record<number, string[]> = { 10: ['#ffb43a', '#ffd34a', '#ffffff'], 25: ['#ff5ad9', '#c08aff', '#ffffff'], 40: ['#fff6c8', '#ffd34a', '#5ad8ff', '#ffffff'] };

/** Capsule colours and placeholder emoji (until fx/capsule-<kind>.webp art arrives). */
export const CAPSULE_LOOK: Record<CapsuleKind, { color: string; emoji: string; name: string }> = {
  grog: { color: '#e0a030', emoji: '🍺', name: 'Grog: three balls' },
  banner: { color: '#3a6ad8', emoji: '🚩', name: 'Banner: wide shield' },
  flask: { color: '#4fd06a', emoji: '🧪', name: 'Flask: exploding balls' },
  sticky: { color: '#a060e0', emoji: '🧤', name: 'Gauntlet: catch and aim' },
  trick: { color: '#e2533f', emoji: '💀', name: 'Orc trick! Shield shrinks' },
};

/**
 * The siege tower art (sprites/siege-tower-stage1 to 6, each on its whole canvas): where
 * the plank grid sits on the undamaged tower, as fractions of the image (left and right
 * across, top and bottom down), and how many floors it has.
 */
const TOWER_ART = { aspect: 2 / 3, left: 0.181, right: 0.806, top: 0.33, bottom: 0.694, floors: 4 };
/** How far down each stage's canvas the bottom of its wheels is, so every stage stands on the ground. */
const TOWER_WHEELS = [1499, 1499, 1390, 1429, 1499, 1467].map((y) => y / 1536);
/** Warlord art by health: full armour, then shoulders off, chest off, sacks burst. */
const WARLORD_STAGE_AT = [0.75, 0.5, 0.25];
/** About where the bottom floor's planks are, in world height, for hit effects. */
const TOWER_PLANK_Y = 6.8;

/** The planning overlay: one cell per half unit over the field in front of the wall. */
const OVERLAY_CELL = 0.5;
const OVERLAY_MIN_Y = -2;
/** Dust puffs per drop by detail level (cheaper on Low). */
const DUST: Record<Quality, number> = { low: 2, medium: 4, high: 6 };
const COVER_COLORS: Record<PlacedKind, [number, number, number]> = {
  crossbow: [255, 120, 60], archers: [110, 255, 90], catapult: [190, 130, 255], soldiers: [80, 170, 255],
  mage: [200, 90, 255], ballista: [255, 200, 60], oil: [255, 150, 30], spiketrap: [220, 220, 220],
};

/** The shield stands in front of the wall, its top leaning out at the orcs as its bearers brace it (radians from upright), lifted a little off the ground. */
const SHIELD_LEAN = -0.62;
/** Orc sprites get a dark outline this thick (share of the art's longest side), so they stand out on grass. */
const ORC_OUTLINE = 0.045;
/** The ballista's voxel size: about 3.5 units across its bow. */
const BALLISTA_VOX = 0.116;
/** Voxel size of the newer defenders' placeholder models. */
const NEW_VOX: Partial<Record<PlacedKind, number>> = { mage: 0.1125, ballista: 0.105, oil: 0.12, spiketrap: 0.116, archers: 0.075, soldiers: 0.125, catapult: 0.14 };
const NEW_MODELS: Partial<Record<PlacedKind, () => Vox>> = { mage: mageModel, ballista: bigBallistaModel, oil: oilModel, spiketrap: spikeTrapModel, archers: archerModel, soldiers: soldierModel, catapult: castleCatapultModel };
const SHIELD_LIFT = 0.25;
/** The voxel shield is drawn this much taller and this many times thicker (collision stays flat). */
const SHIELD_TALL = 1.4;
const SHIELD_THICKNESS = 2;
const SHIELD_DEPTH_WIDTH_CAP = 5.8;
/** It is a touch wider than its bounce line, so balls never seem to miss its rim. */
const SHIELD_OVERHANG = 1.06;
/** The camera: height, distance back, and the point on the field it looks at. */
const CAM_Y = 64;
const CAM_Z = 40;
const CAM_LOOK = -38;
/** A wide lens, so the town behind the wall fits under the field. */
const CAM_FOV = 52;
/** How far up the field the camera glides to show the coming horde. */
const LOOK_AHEAD = 38;
/** A heave's shove: quick, so it feels like a punch. */
const HEAVE_SECONDS = 0.15;
/** How long the hit glint takes to fade off the shield. */
const SHIELD_FLASH_SECONDS = 0.25;
/** Balls fly at this height, and are drawn this much bigger than their hit size so they read from up here. */
const BALL_Y = 0.9;
const SHIELD_HIDE_DEPTH = 3.4; // how far past the shield a ball is still hidden by it
const PHASE_IN = 1.5; // seconds an enemy takes to phase in after spawning
const BALL_DRAW = 1.7;

/** Sprite height relative to the orc grunt (and defenders), from the art guide. */
const SIZE: Record<EnemyKind, number> = { grunt: 1, chucker: 1, barrel: 1, runner: 0.85, rider: 1.4, orcCatapult: 2, ogre: 2.5, warlord: 3, shieldOrc: 1, drummer: 1.15 };
const KILL_COLOR: Record<EnemyKind, string> = {
  grunt: '#6f9a3c', chucker: '#8a9a42', barrel: '#8a5a2e', runner: '#9ac040', rider: '#6d4a32', orcCatapult: '#7a5530', ogre: '#8d9a6a', warlord: '#5d8a34', shieldOrc: '#7a7a82', drummer: '#b8452a',
};
/** Kinds that climb the wall before hacking at it (the rest smash it from the ground). */
const CLIMBERS = new Set<EnemyKind>(['grunt', 'chucker', 'barrel', 'runner', 'rider', 'shieldOrc', 'drummer']);

/** The castle's shape: a level wall; towers the player builds stand higher. */
const WALL_H = 4;
/** The gatehouse in the middle of the wall: half its width, and how far it rises above the wall. */
const GATE_HALF = 2.6;
const GATE_RISE = 1.5;

/** The wall and towers are built of these small stones (four to a VOXEL each way). */
const WALL_VOX = 0.25;

/**
 * The gate's colour at a point (x across, y up) on the gatehouse face, or null for plain
 * stone: an arched oak door with iron bands and studs, framed by dark stone.
 */
function gateDoor(x: number, y: number): string | null {
  const ax = Math.abs(x);
  // The arch: full width up to 3 high, narrowing over the top.
  const half = y < 3 ? 1.5 : y < 3.35 ? 1.2 : y < 3.65 ? 0.85 : y < 3.9 ? 0.45 : 0;
  if (ax < half) {
    if ((y > 0.5 && y < 0.75) || (y > 2.5 && y < 2.75)) return (Math.round(x / WALL_VOX) % 3 === 0) ? '#6a6660' : '#2b2420';
    if (ax < 0.13) return '#3b2618';
    return (Math.floor(x / 0.5) + (y > 1.25 ? 1 : 0)) % 2 ? '#7a4a24' : '#8d5a2c';
  }
  if (ax < half + 0.5 && y < 4.5) return (Math.floor(y / 0.5) + Math.floor(x / 0.5)) % 2 ? '#56544f' : '#4a4844';
  return null;
}

/** A small, repeatable hash in [0, 1). */
function hash3(a: number, b: number, c: number): number {
  const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * True on a mortar line: under each course of stone and at each joint. On High detail sx and sy pick the
 * small cell of the stone (0 is its left and bottom), so the lines are a single small cell thick.
 */
function mortar(ix: number, iy: number, sx = 0, sy = 0): boolean {
  const run = ix + (Math.floor(iy / 2) % 2) * 2;
  return (run % 4 === 0 && sx === 0) || (iy % 2 === 0 && sy === 0);
}

/** Grey castle stone, varying stone by stone (a few blue-grey or warm ones), with darker mortar joints. */
const STONE_GREYS = ['#a3a19c', '#94928d', '#8b8a85', '#aba9a3', '#9c9a95', '#8f959b', '#a39c90'];
function masonry(ix: number, iy: number, salt: number, sx = 0, sy = 0): THREE.Color {
  const course = Math.floor(iy / 2);
  const run = ix + (course % 2) * 2;
  const brick = Math.floor(run / 4);
  const pick = hash3(brick, course, salt);
  const c = new THREE.Color(STONE_GREYS[Math.floor(pick * STONE_GREYS.length)]);
  c.multiplyScalar(0.94 + hash3(ix + sx * 0.37, iy + sy * 0.53, salt + 3) * 0.1);
  if (run % 4 === 0 && sx === 0) c.multiplyScalar(0.78);
  else if (iy % 2 === 0 && sy === 0) c.multiplyScalar(0.88);
  return c;
}

/** A stone of the wall or a tower: its lowest corner, and the colour of each of its small cells (null leaves one out). */
interface Stone {
  o: THREE.Vector3;
  paint: (sx: number, sy: number, sz: number) => THREE.Color | null;
}

const SIDES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * The instances for some stones, each a box res times smaller than a stone, scaled by s: one per stone
 * normally. On High detail (res 2) each stone is cut into res x res x res small ones, so the mortar can sit
 * back and the gate and banners are drawn finer, except stones buried inside the wall: those stay whole
 * (they only show once it crumbles), which keeps the count down.
 */
function cutStones(stones: Stone[], res: number): { p: THREE.Vector3; c: THREE.Color; s: number }[] {
  const V = WALL_VOX;
  const f = V / res;
  const out: { p: THREE.Vector3; c: THREE.Color; s: number }[] = [];
  const grid = (o: THREE.Vector3) => [Math.round(o.x / V), Math.round(o.y / V), Math.round(o.z / V)];
  const filled = new Set(res > 1 ? stones.map((st) => grid(st.o).join()) : []);
  for (const st of stones) {
    const [x, y, z] = res > 1 ? grid(st.o) : [0, 0, 0];
    if (res === 1 || SIDES.every(([dx, dy, dz]) => filled.has([x + dx, y + dy, z + dz].join()))) {
      const c = st.paint(0, 0, 0) ?? (res > 1 ? new THREE.Color(STONE_GREYS[2]) : null);
      if (c) out.push({ p: st.o.clone().addScalar(V / 2), c, s: res });
      continue;
    }
    for (let sx = 0; sx < res; sx++) {
      for (let sy = 0; sy < res; sy++) {
        for (let sz = 0; sz < res; sz++) {
          const c = st.paint(sx, sy, sz);
          if (c) out.push({ p: st.o.clone().add(new THREE.Vector3((sx + 0.5) * f, (sy + 0.5) * f, (sz + 0.5) * f)), c, s: 1 });
        }
      }
    }
  }
  return out;
}
const TOWER_HALF = 1.5;
const TOWER_Z = 1;
/** Each storey the player stacks on a tower adds this much height. */
const STOREY_H = 2.25;
/** How high the top of a tower of n storeys is: it rises from the ground, one storey above the level wall per storey. */
const towerTop = (storeys: number) => WALL_H + storeys * STOREY_H;
/** How a squad of archers stands: columns x rows around its spot. */
const SQUAD_COLS = 6;
/** A soldier company's banner group where it was placed (the rest muster at the wall). */
const COMPANY = [[0, 0], [-0.7, 0.3], [0.7, 0.3], [-0.35, -0.4], [0.35, -0.4]];
const SQUAD_SPACING = 0.75;

interface VoxelGroup {
  /** Instance indices, in the order they crumble away. */
  order: number[];
  visible: number;
}

interface Debris {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  life: number;
  color: THREE.Color;
  /** Cube scale (default 1): rock chunks are bigger than dust. */
  size?: number;
}

interface Rocket {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds before it launches, then seconds until it bursts. */
  wait: number;
  fuse: number;
  colors: string[];
  size: number;
}

/** A defender the player is about to place, for previewing its coverage. */
export interface PlanPreview {
  kind: PlacedKind;
  x: number;
  y: number;
}

interface Effect {
  kind: 'ring' | 'flash' | 'parry' | 'explosion' | 'impact' | 'fireball' | 'barrelBlast';
  x: number;
  z: number;
  t: number;
  duration: number;
  obj: THREE.Object3D;
  /** Ring radius. */
  size: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const AHEAD = new THREE.Vector3(0, 0, -1);
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpE = new THREE.Euler();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  /** Balls and rocks, drawn over everything else (so they stay visible over orcs) with their own depth. */
  private topScene = new THREE.Scene();
  private quality: Quality;
  /** Small cells per voxel in the voxel models: 2 on High detail. */
  private voxelRes: number;
  private ground!: GroundCanvas;
  private terrain!: Terrain;
  private world!: World;
  private groundMat: THREE.MeshLambertMaterial;
  private detail = detailTexture();

  private voxels!: THREE.InstancedMesh;
  private voxelPos: THREE.Vector3[] = [];
  private voxelColor: THREE.Color[] = [];
  private segments: VoxelGroup[] = [];
  private stackMesh: THREE.InstancedMesh | null = null;
  /** The coming wave, mustered beyond the top of the field while it waits (drawn only, not in the sim). */
  private horde: Enemy[] = [];
  private firstSeen = new Map<Enemy, number>();
  private hordeFor = -1;
  /** Looking up the field at the horde: 0 is the battle view, 1 is the far end. lookAhead is where it is heading. */
  lookAhead = 0;
  private lookNow = 0;
  /** Jump the camera straight to a look (0 battle view, 1 far end) with no glide. */
  snapLook(v: number) {
    this.lookAhead = v;
    this.lookNow = v;
  }
  private aimMesh: THREE.Mesh | null = null;
  private aimKey = '';
  private stackKey = '';

  private sprites = {} as Record<EnemyKind, THREE.InstancedMesh>;
  /** The same orcs as voxel models; orcStyle picks which set is drawn. */
  private voxelOrcs: VoxelOrcs;
  orcStyle: 'voxel' | 'sprite' = 'voxel';
  /** Orcs a heave sent flying: they tumble up the field and land in a puff of dust. */
  private flung: { kind: EnemyKind; pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; life: number }[] = [];
  private soldierSprites: THREE.InstancedMesh;
  private archerSprites: THREE.InstancedMesh;
  private shadows: THREE.InstancedMesh;
  /** Ground shadows under balls flying over a ramp. */
  private ballShadows: THREE.InstancedMesh;
  /** Thrown things, as camera-facing sprites. */
  private thrown: Record<'rock' | 'boulder' | 'stone', THREE.InstancedMesh>;
  /** Bolts and arrows, as flat sprites lying along their flight. */
  private bolts: THREE.InstancedMesh;
  private enemyBolts: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private fxArt = {
    explosion: imageSprite(explosionUrl, aspects.explosion),
    impact: imageSprite(impactUrl, aspects.impact),
    fireball: imageSprite(fireballUrl, aspects.fireball),
    barrelBlast: imageSprite(barrelBlastUrl, aspects['barrel-explosion']),
  };
  /** The giant crossbow is a voxel ballista, so it sits properly on the wall walk or a tower top (built on first use). */
  private ballistaGeo: THREE.BufferGeometry | null = null;
  /** Lit and glowing geometry for the mage, ballista, cauldron and spike trap, built on first use. */
  private newGeo = new Map<PlacedKind, { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null }>();
  /** The see-through defender that follows the mouse while placing or moving one, by kind. */
  private ghosts = new Map<PlacedKind, THREE.Group>();
  private ghostShown: { kind: PlacedKind; ok: boolean } | null = null;
  private crater = loadImage(craterUrl);
  private scorch = loadImage(scorchUrl);
  private scorchBlast = loadImage(scorchBlastUrl);
  private courtyard = loadImage(courtyardUrl);
  private lastWave = -1;
  private debrisMesh: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private effects: Effect[] = [];

  private shieldModel: ShieldModel;
  /** The two soldiers bracing the shield from behind. */
  private bearers: THREE.Mesh[] = [];
  private shieldShadow: THREE.Mesh;
  private shieldJolt = 0;
  private shieldFlashT = 1;
  /** A short bright streak on the shield showing which way a ball was deflected; a small pool, fading. */
  private bounceCues: { mesh: THREE.Mesh; born: number }[] = [];
  private bounceCueNext = 0;
  /** Time since the last heave, for the shove animation. */
  private heaveT = 9;
  private puffTex = puffTexture();
  private smoke: { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; size: number }[] = [];
  private balls: THREE.InstancedMesh;
  /** Hits the shield has taken this wave: every few knock a cluster of blocks off it. */
  private halos: THREE.InstancedMesh;
  private barrels: THREE.InstancedMesh;
  private capsuleTex = {} as Record<CapsuleKind, THREE.Texture>;
  private capsuleSprites = new Map<Capsule, THREE.Sprite>();
  private towerGroup: THREE.Group;
  /** The tower as one painted billboard; its picture changes as it falls apart. */
  private towerArt: THREE.Mesh;
  private towerTex: THREE.Texture[];
  private towerStage = -1;
  private towerHoles: THREE.InstancedMesh;
  private towerCracks: THREE.InstancedMesh;
  /** A floor giving way slumps the tower; this eases it back up. */
  private towerSlump = 0;
  /** The warlord's armour stage art (sprite in both orc styles, so the boss art always shows). */
  private warlordSprites: THREE.InstancedMesh[] = [];
  private lordStage = new WeakMap<Enemy, number>();
  private chunkArt = {
    planks: PLANKS.map((p) => imageSprite(p.url, aspects[p.name as keyof typeof aspects] ?? 1)),
    plates: PLATES.map((p) => imageSprite(p.url, aspects[p.name as keyof typeof aspects] ?? 1)),
    debris: TOWER_DEBRIS.map((p) => imageSprite(p.url, aspects[p.name as keyof typeof aspects] ?? 1)),
    goblin: [imageSprite(goblinPush1Url, aspects['goblin-push-1']), imageSprite(goblinPush2Url, aspects['goblin-push-2'])],
    reveal: imageSprite(warlordRevealUrl, aspects['warlord-reveal']),
  };
  /** Painted pieces flying off: planks, armour plates, tower wreckage. */
  private chunks: { sp: THREE.Sprite; vel: THREE.Vector3; spin: number; life: number; landed: boolean }[] = [];
  /** Little scenes after a boss falls: the goblin still pushing, the warlord's stilts. */
  private cameos: { sp: THREE.Sprite; frames: THREE.Texture[]; t: number; dur: number; vel: THREE.Vector3; h: number }[] = [];
  private overlay!: THREE.Mesh;
  private overlayCtx!: CanvasRenderingContext2D;
  private overlayTex!: THREE.CanvasTexture;
  private overlayKey = '';
  /** The coverage shape's pulse: where, and seconds since (a big number is finished). */
  private pulseAt = { x: 0, y: 0, t: 99 };
  /** When each defender was set down (scene seconds), for the drop-in bounce; and dust waiting for the landing. */
  private drops = new Map<number, number>();
  private landings: { at: number; x: number; y: number }[] = [];
  /** The ghost of a barricade or rubble about to be placed. */
  private terrainGhosts = new Map<TerrainKind, THREE.Group>();
  /** How fast the camera glides up the field and back (exponential rate per second). */
  lookRate = 2.2;
  /** When above 0 the look glides over exactly this many seconds (eased) instead of at lookRate. */
  lookSeconds = 0;
  private planning = { show: false, preview: null as PlanPreview | null, lanes: false };
  readonly fireworks = new Fireworks(9000);
  private rockets: Rocket[] = [];
  /** Screen flash strength (0-1) and colour, for the HUD to draw. */
  flashLevel = 0;
  flashColor = '#fff6c8';
  /** Crossbow towers and catapults, one model per placed defender. Archers are instanced. */
  private defenderObjs = new Map<number, { kind: PlacedKind; obj: THREE.Group | null }>();
  /** Placement ghost: where a defender would go, green if it fits. */
  private shake = 0;
  /** 0 turns camera shake off (a player setting); 1 is full. */
  shakeScale = 1;
  // Steep enough (about 57 degrees at the wall) that the wall doesn't hide the fighting at its foot.
  // The wall sits low on the screen so most of it is battlefield.
  private camBase = new THREE.Vector3(0, CAM_Y, CAM_Z);
  private camLook = new THREE.Vector3(0, 0, CAM_LOOK);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private time = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private game: Game,
    quality: Quality = 'medium',
  ) {
    this.quality = quality;
    this.voxelRes = QUALITY[quality].voxelRes;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
    // Sprites seen at a slant stay crisp with the GPU's best filtering.
    setAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.fireworks.amount = QUALITY[quality].fx;
    this.scene.add(this.fireworks.points);
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color('#9cc4d8');
    // Light haze only: the far end of the field stays clear.
    this.scene.fog = new THREE.Fog('#9cc4d8', 150, 300);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 420);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    this.scene.add(new THREE.HemisphereLight('#e8f2ff', '#4a5a30', 1.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-20, 40, 15);
    this.scene.add(sun);
    this.topScene.add(new THREE.HemisphereLight('#e8f2ff', '#4a5a30', 1.5));
    const topSun = new THREE.DirectionalLight('#fff1d6', 2);
    topSun.position.copy(sun.position);
    this.topScene.add(topSun);
    this.renderer.autoClear = false;

    this.groundMat = new THREE.MeshLambertMaterial();
    this.addDetail(this.groundMat);
    this.buildGround();
    // The courtyard art arrives a moment later: repaint the ground with it then.
    if (!this.courtyard.complete) {
      this.courtyard.onload = () => {
        this.scene.remove(this.terrain.mesh);
        this.terrain.dispose();
        this.ground.texture.dispose();
        this.buildGround();
      };
    }
    this.buildCastle();
    this.world = new World(game, this.camera, {
      puff: (x, y, z, size, color, life) => this.puff(x, y, z, size, color, life),
      burst: (x, y, z, n, color, speed) => this.burst(x, y, z, n, color, speed),
    }, this.voxelRes);
    this.scene.add(this.world.root);

    const makeSprites = (art: SpriteArt, size: number, max: number, centred = false) => {
      size *= art.scale ?? 1;
      const geo = new THREE.PlaneGeometry(2 * size * art.aspect, 2 * size);
      if (!centred) geo.translate(0, size, 0);
      // Alpha to coverage: with MSAA the cut-out edges are smoothed instead of jagged.
      const mat = new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5, alphaToCoverage: true });
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    const art: Record<EnemyKind, SpriteArt> = {
      grunt: imageSprite(gruntUrl, aspects['enemy-grunt'], ORC_OUTLINE),
      // Placeholder: a grunt carrying a barrel, until sprites/enemy-barrel.webp arrives.
      barrel: imageSprite(gruntUrl, aspects['enemy-grunt'], ORC_OUTLINE),
      // Placeholders: plain grunt art for the shield orc and the drummer.
      shieldOrc: imageSprite(gruntUrl, aspects['enemy-grunt'], ORC_OUTLINE),
      drummer: imageSprite(gruntUrl, aspects['enemy-grunt'], ORC_OUTLINE),
      chucker: imageSprite(chuckerUrl, aspects['enemy-chucker'], ORC_OUTLINE),
      runner: imageSprite(runnerUrl, aspects['enemy-runner'], ORC_OUTLINE),
      rider: imageSprite(riderUrl, aspects['enemy-rider'], ORC_OUTLINE),
      orcCatapult: imageSprite(catapultUrl, aspects['enemy-catapult'], ORC_OUTLINE),
      ogre: imageSprite(ogreUrl, aspects['enemy-ogre'], ORC_OUTLINE),
      warlord: imageSprite(warlordUrl, aspects['enemy-warlord'], ORC_OUTLINE),
    };
    for (const kind of ENEMY_KINDS) this.sprites[kind] = makeSprites(art[kind], SIZE[kind], kind === 'grunt' ? MAX_ENEMIES : 800);
    this.warlordSprites = WARLORD_STAGES.map((st) => makeSprites(imageSprite(st.url, 1, ORC_OUTLINE), SIZE.warlord * 1.15, 4));
    this.voxelOrcs = new VoxelOrcs(this.scene, (kind) => (kind === 'grunt' ? MAX_ENEMIES : 800), this.voxelRes);
    // Soldiers and archers come in big crowds: small voxel figures, one instanced mesh each.
    const crowd = (kind: PlacedKind, max: number) => {
      const mesh = new THREE.InstancedMesh(this.figureGeo(kind).solid!, new THREE.MeshLambertMaterial({ vertexColors: true }), max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.soldierSprites = crowd('soldiers', 400);
    this.archerSprites = crowd('archers', MAX_ARCHERS);

    const shadowGeo = new THREE.PlaneGeometry(1.3, 0.8);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      MAX_ENEMIES,
    );
    this.shadows.frustumCulled = false;
    this.shadows.position.y = 0.04;
    this.scene.add(this.shadows);
    this.ballShadows = new THREE.InstancedMesh(shadowGeo, this.shadows.material, MAX_BALLS);
    this.ballShadows.frustumCulled = false;
    this.ballShadows.position.y = 0.05;
    this.ballShadows.count = 0;
    this.scene.add(this.ballShadows);

    // Thrown rocks are chunky voxel shapes. They are what you're trying to catch, so they draw over everything.
    const voxelThrown = (kind: 'rock' | 'boulder' | 'stone', height: number, max: number) => {
      const mesh = new THREE.InstancedMesh(rockGeometry(kind, height, this.voxelRes), new THREE.MeshLambertMaterial({ vertexColors: true }), max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.topScene.add(mesh);
      return mesh;
    };
    this.thrown = { rock: voxelThrown('rock', THROWN_HEIGHT.rock, 600), boulder: voxelThrown('boulder', THROWN_HEIGHT.boulder, 300), stone: voxelThrown('stone', THROWN_HEIGHT.stone, 200) };
    const arrowArt = imageSprite(arrowUrl, aspects.arrow);
    const makeFlat = (length: number, max: number, art = arrowArt, pointsDown = false) => {
      // Lies flat with the head pointing along -z (away from the castle), whichever way the art points.
      const geo = new THREE.PlaneGeometry(length * art.aspect, length).rotateX(-Math.PI / 2);
      if (pointsDown) geo.rotateY(Math.PI);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5, side: THREE.DoubleSide }), max);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.bolts = makeFlat(2.6, 300);
    this.enemyBolts = makeFlat(2.4, 300, imageSprite(enemyBoltUrl, aspects['enemy-bolt']), true);
    this.arrows = makeFlat(1.5, MAX_PROJECTILES);

    // Rubble and sparks fly in front of the shield, so they draw after it.
    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL * 0.8, VOXEL * 0.8, VOXEL * 0.8),
      new THREE.MeshLambertMaterial({ transparent: true }),
      MAX_DEBRIS,
    );
    this.debrisMesh.renderOrder = 9;
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);

    // The royal shield: a real steel shield standing out in front of the wall, its painted face
    // to the orcs, so from the castle we see its back. Balls are drawn over it, so none hide behind it.
    this.shieldModel = new ShieldModel(this.voxelRes);
    this.scene.add(this.shieldModel.group);
    const bearerGeo = this.figureGeo('soldiers').solid!;
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(bearerGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.bearers.push(b);
      this.scene.add(b);
    }
    this.shieldShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    this.shieldShadow.position.y = 0.05;
    this.scene.add(this.shieldShadow);
    const cueGeo = new THREE.PlaneGeometry(1, 0.3).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(cueGeo, new THREE.MeshBasicMaterial({ color: '#fff2a8', transparent: true, depthWrite: false, depthTest: false }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.bounceCues.push({ mesh, born: -99 });
      this.scene.add(mesh);
    }

    // Balls: chunky voxel spheres (round physics) drawn over the field and the orcs, each with an additive halo.
    const r = game.cfg.balls.radius;
    this.balls = new THREE.InstancedMesh(
      ballGeometry(r, this.voxelRes),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      MAX_BALLS,
    );
    this.balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BALLS * 3).fill(1), 3);
    this.balls.frustumCulled = false;
    this.balls.count = 0;
    this.topScene.add(this.balls);
    const glow = glowTexture();
    this.halos = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
      MAX_BALLS + 8,
    );
    this.halos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((MAX_BALLS + 8) * 3).fill(1), 3);
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 8;
    this.halos.count = 0;
    this.scene.add(this.halos);

    // Barrels on the barrel orcs' backs, with a glowing band.
    const keg = imageSprite(powderBarrelUrl, aspects['powder-barrel']);
    this.barrels = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.8 * keg.aspect, 0.8),
      new THREE.MeshBasicMaterial({ map: keg.texture, alphaTest: 0.5, alphaToCoverage: true }),
      MAX_BARRELS,
    );
    this.barrels.frustumCulled = false;
    this.barrels.count = 0;
    this.scene.add(this.barrels);

    for (const [kind, look] of Object.entries(CAPSULE_LOOK) as [CapsuleKind, (typeof CAPSULE_LOOK)[CapsuleKind]][]) {
      // Glass orbs with a coloured glow; the gauntlet's orb is the sticky capsule.
      const url = CAPSULE_ART[`../assets/fx/capsule-${kind === 'sticky' ? 'gauntlet' : kind}.webp`];
      this.capsuleTex[kind] = url ? imageSprite(url, 1).texture : capsuleTexture(look.color, look.emoji);
    }

    // The siege tower: one billboard showing the stage of wreck it's in, with cracked and
    // knocked-out planks marked on the undamaged stages.
    this.towerTex = TOWER_STAGES.map((st) => imageSprite(st.url, 2 / 3).texture);
    const { width: tw, height: th } = this.towerSize();
    this.towerArt = new THREE.Mesh(
      new THREE.PlaneGeometry(tw, th).translate(0, th / 2, 0),
      new THREE.MeshBasicMaterial({ map: this.towerTex[0], alphaTest: 0.5, alphaToCoverage: true }),
    );
    this.towerGroup = new THREE.Group();
    this.towerGroup.visible = false;
    this.towerGroup.add(this.towerArt);
    const cracked = this.chunkArt.planks[1];
    this.towerCracks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: cracked.texture, alphaTest: 0.5, transparent: true }),
      32,
    );
    this.towerCracks.frustumCulled = false;
    this.towerCracks.count = 0;
    this.towerGroup.add(this.towerCracks);
    this.towerHoles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 32);
    this.towerHoles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3).fill(1), 3);
    this.towerHoles.frustumCulled = false;
    this.towerHoles.count = 0;
    this.towerGroup.add(this.towerHoles);
    this.scene.add(this.towerGroup);

    this.buildOverlay();


  }

  /** The planning overlay: who covers which bit of the field, the coming lanes. */
  private buildOverlay() {
    const g = this.game;
    const hw = g.cfg.field.halfWidth;
    const cols = Math.round((hw * 2) / OVERLAY_CELL);
    const rows = Math.round((g.cfg.field.topY - OVERLAY_MIN_Y) / OVERLAY_CELL);
    const oc = document.createElement('canvas');
    oc.width = cols;
    oc.height = rows;
    this.overlayCtx = oc.getContext('2d')!;
    this.overlayTex = new THREE.CanvasTexture(oc);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, rows * OVERLAY_CELL).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.overlay.position.set(0, 0.12, -(OVERLAY_MIN_Y + (rows * OVERLAY_CELL) / 2));
    this.overlay.renderOrder = 2;
    this.scene.add(this.overlay);
  }

  /** The town plot to draw (from the meta progress). */
  setPlot(plot: import('../sim/plot').Layout, land: number) {
    this.world.setPlot(plot, land);
  }

  /** Swaps in a fresh game (after a restart or for the next level) and rebuilds the castle and ground. */
  setGame(game: Game) {
    const resized = game.cfg.field.halfWidth !== this.game.cfg.field.halfWidth;
    this.hordeFor = -1;
    this.game = game;
    this.world.setGame(game);
    this.rebuildCastle();
    if (resized) {
      // A field of another width: new ground under it and a new planning overlay over it.
      this.scene.remove(this.terrain.mesh);
      this.terrain.dispose();
      this.ground.texture.dispose();
      this.buildGround();
      this.scene.remove(this.overlay);
      this.overlay.geometry.dispose();
      (this.overlay.material as THREE.Material).dispose();
      this.overlayTex.dispose();
      this.buildOverlay();
    } else {
      this.ground.reset();
      this.terrain.reset();
    }
    this.lastWave = -1;
    this.drops.clear();
    this.landings = [];
    for (const gh of this.terrainGhosts.values()) {
      this.scene.remove(gh);
      gh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.terrainGhosts.clear();
    this.debris = [];
    for (const fx of this.effects) this.scene.remove(fx.obj);
    this.effects = [];
    for (const d of this.defenderObjs.values()) if (d.obj) this.scene.remove(d.obj);
    this.defenderObjs.clear();
    for (const sp of this.capsuleSprites.values()) this.scene.remove(sp);
    this.capsuleSprites.clear();
    this.fireworks.clear();
    this.rockets = [];
    this.towerStage = -1;
    for (const c of this.chunks) this.scene.remove(c.sp);
    for (const c of this.cameos) this.scene.remove(c.sp);
    this.chunks = [];
    this.cameos = [];
    this.overlayKey = '';
  }

  /** Changes the quality level: render resolution, ground detail, terrain smoothness and voxel model detail. Clears marks on the ground. */
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    if (QUALITY[q].voxelRes !== this.voxelRes) {
      this.voxelRes = QUALITY[q].voxelRes;
      this.rebuildVoxels();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[q].pixelRatio));
    this.fireworks.amount = QUALITY[q].fx;
    this.scene.remove(this.terrain.mesh);
    this.terrain.dispose();
    this.ground.texture.dispose();
    this.buildGround();
    const r = this.canvas.getBoundingClientRect();
    this.resize(r.width, r.height);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the whole field stays in view.
    const pull = Math.max(1, 1.3 / this.camera.aspect);
    this.camBase.set(0, CAM_Y * pull, CAM_Z * pull - (pull - 1) * 8);
    this.camera.updateProjectionMatrix();
    this.fireworks.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** The building under a screen point, if any. */
  pickBuilding(ndcX: number, ndcY: number): import('../sim/game').BuildingKind | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return this.world.pick(this.raycaster.ray);
  }

  /** Lights a building while the mouse is over it. */
  hoverBuilding(kind: import('../sim/game').BuildingKind) {
    this.world.glow(kind, 0.45);
  }

  /** The shield x under a screen point: where the mouse ray crosses the shield's line. */
  shieldX(ndcX: number, ndcY: number): number | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), this.game.cfg.shield.y);
    const hit = this.raycaster.ray.intersectPlane(plane, tmpV);
    return hit ? hit.x : null;
  }

  /**
   * Planning view: spot rings, everyone's coverage on the ground,
   * and (lanes) the lanes the next wave will march down. preview: a defender about to be placed.
   */
  setPlanning(show: boolean, preview: PlanPreview | null = null, lanes = false) {
    this.planning = { show, preview, lanes };
  }

  /** Converts a screen point to sim coordinates on the ground, or null if off the field. */
  pick(ndcX: number, ndcY: number): { x: number; y: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, tmpV);
    if (!hit) return null;
    // Clicks on the wall or a tower land on its top, not the ground behind it.
    const tops = [...new Set(this.game.stacks.map((s) => towerTop(s.storeys)))].sort((a, b) => b - a);
    for (const h of [...tops, WALL_H]) {
      this.groundPlane.constant = -h;
      const top = this.raycaster.ray.intersectPlane(this.groundPlane, tmpD);
      this.groundPlane.constant = 0;
      if (top && this.standHeight(top.x, top.z) >= h) return { x: top.x, y: -top.z };
    }
    return { x: hit.x, y: -hit.z };
  }

  /** Projects a sim point to screen pixels, for HTML labels. */
  project(x: number, y: number, height = 0): { x: number; y: number } {
    tmpV.set(x, height, -y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((tmpV.x + 1) / 2) * r.width, y: ((1 - tmpV.y) / 2) * r.height };
  }

  /** Shows where a defender would go: a ring of its footprint, green if it fits there, red if not. */
  /**
   * Shows the defender itself, see-through, standing exactly where it would go:
   * tinted green where it can stand and red where it can't.
   */
  setGhost(kind: PlacedKind, x: number, y: number, ok: boolean) {
    for (const [k, gh] of this.ghosts) if (k !== kind) gh.visible = false;
    let ghost = this.ghosts.get(kind);
    if (!ghost) {
      ghost = this.buildFigure(kind, true);
      this.scene.add(ghost);
      this.ghosts.set(kind, ghost);
    }
    ghost.visible = true;
    const h = this.standHeight(x, -y);
    ghost.position.set(x, h, -y);
    this.ghostShown = { kind, ok };
  }

  hideGhost() {
    for (const gh of this.ghosts.values()) gh.visible = false;
    this.ghostShown = null;
  }

  /** The coverage shapes pulse (a unit was placed, moved or aimed at x, y). */
  pulse(x: number, y: number) {
    this.pulseAt = { x, y, t: 0 };
  }

  /** A bumper or ramp being dragged: it follows (x, y), green where it fits, red where not; null drops it back at the sim's spot. */
  dragFixture(d: { index: number; x: number; y: number; ok: boolean } | null) {
    this.world.dragFixture(d);
  }

  /** Shows a barricade (turned to angle) or rubble pile about to go down: green where it fits, red where not. null hides it. */
  setTerrainGhost(g: { kind: TerrainKind; x: number; y: number; angle: number; ok: boolean } | null) {
    for (const [k, gh] of this.terrainGhosts) if (!g || k !== g.kind) gh.visible = false;
    if (!g) {
      return;
    }
    let ghost = this.terrainGhosts.get(g.kind);
    if (!ghost) {
      const s = this.game.cfg.shaping;
      const v = obstacleModel(g.kind, 0.3, s.rubble.r, s.barricade.hw, s.barricade.hh, 5);
      ghost = new VoxBatch().add(v, 0.3, new THREE.Vector3()).build();
      ghost.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.MeshBasicMaterial;
        m.transparent = true;
        m.depthTest = false;
        m.depthWrite = false;
        o.renderOrder = 10;
      });
      this.scene.add(ghost);
      this.terrainGhosts.set(g.kind, ghost);
    }
    ghost.visible = true;
    ghost.position.set(g.x, this.groundHeight(g.x, -g.y) + 0.05, -g.y);
    ghost.rotation.y = g.kind === 'barricade' ? g.angle : 0;
    const wob = 0.7 + Math.sin(this.time * 6) * 0.12;
    ghost.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshBasicMaterial;
      m.color.set(g.ok ? '#c8ffc8' : '#ff7a6a');
      m.opacity = g.ok ? wob : 0.55;
    });
  }

  /**
   * Paints the ground a defender's aim covers, in gold: a crossbow's lane, an archer
   * squad's cone or a catapult's band. null hides it.
   */
  showAim(d: Defender | null) {
    if (!d || d.kind === 'soldiers') {
      if (this.aimMesh) this.aimMesh.visible = false;
      return;
    }
    const g = this.game;
    const c = g.cfg.coverage;
    const h = d.heading ?? 0;
    const reach = d.kind === 'archers' ? g.cfg.field.topY * c.archerReach * g.rangeMult(d)
      : d.kind === 'catapult' ? c.catapultMax * g.rangeMult(d)
        : d.kind === 'mage' ? g.cfg.mage.range * g.rangeMult(d) : g.cfg.field.topY;
    const blast = d.kind === 'mage' ? g.mageRadius() : 0;
    const key = `${d.kind}${d.x},${d.y},${h.toFixed(3)},${reach.toFixed(2)},${blast.toFixed(2)}`;
    if (!this.aimMesh) {
      this.aimMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffd34a', transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
      this.aimMesh.renderOrder = 3;
      this.scene.add(this.aimMesh);
    }
    this.aimMesh.visible = true;
    if (key === this.aimKey) return;
    this.aimKey = key;
    // The shape in sim space, as (x, y) points around the defender; the crossbow's and ballista's lane is a long strip.
    const pts: [number, number][] = [];
    const dir = (a: number, r: number): [number, number] => [d.x + Math.sin(a) * r, d.y + Math.cos(a) * r];
    const shapes: THREE.Shape[] = [];
    const lane = d.kind === 'crossbow' ? c.crossbowLane : d.kind === 'ballista' ? c.ballistaLane : 0;
    if (lane) {
      const along = (r: number, side: number): [number, number] => [d.x + Math.sin(h) * r + Math.cos(h) * lane * side, d.y + Math.cos(h) * r - Math.sin(h) * lane * side];
      pts.push(along(1, -1), along(reach, -1), along(reach, 1), along(1, 1));
    } else if (d.kind === 'oil') {
      // The stretch of wall it pours on: its width either side, out as far as the foot of the wall.
      const o = g.cfg.oil;
      pts.push([d.x - o.halfWidth, 0], [d.x + o.halfWidth, 0], [d.x + o.halfWidth, o.reach], [d.x - o.halfWidth, o.reach]);
    } else if (d.kind === 'spiketrap') {
      for (let i = 0; i < 24; i++) pts.push(dir((i / 24) * Math.PI * 2, g.cfg.spiketrap.footprint));
    } else if (d.kind === 'mage') {
      // A sector: anywhere ahead within range, or within the aim cone once aimed.
      const half = d.heading === null ? Math.PI / 2 : c.mageAimSpread;
      pts.push([d.x, d.y]);
      for (let i = 0; i <= 20; i++) pts.push(dir(h - half + (i / 20) * half * 2, reach));
    } else {
      const half = d.kind === 'archers' ? c.archerCone : d.heading === null ? 1.2 : c.catapultAimSpread;
      const inner = d.kind === 'catapult' ? c.catapultMin : 1;
      for (let i = 0; i <= 16; i++) pts.push(dir(h - half + (i / 16) * half * 2, reach));
      for (let i = 16; i >= 0; i--) pts.push(dir(h - half + (i / 16) * half * 2, inner));
    }
    // Clip to the field, then lay it flat just above the ground.
    const hw = g.cfg.field.halfWidth;
    const clip = ([x, y]: [number, number]) => new THREE.Vector2(Math.max(-hw, Math.min(hw, x)), Math.min(g.cfg.field.topY, y));
    shapes.push(new THREE.Shape(pts.map(clip)));
    if (blast && d.heading !== null) {
      // Where an aimed mage's blast lands: a ring of its blast radius at the middle of its reach.
      const [cx, cy] = dir(h, reach * 0.6);
      const ring = new THREE.Shape();
      ring.absarc(cx, cy, blast, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(cx, cy, Math.max(0.1, blast - 0.35), 0, Math.PI * 2, true);
      ring.holes.push(hole);
      shapes.push(ring);
    }
    const geo = new THREE.ShapeGeometry(shapes);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.2, 0);
    this.aimMesh.geometry.dispose();
    this.aimMesh.geometry = geo;
  }

  /**
   * A defender's figure, in voxels: the crossbow, catapult and the rest, a squad of
   * archers in ranks, or a soldier company's banner group.
   * A ghost is see-through and drawn over everything, so it shows wherever the mouse is.
   */
  private buildFigure(kind: PlacedKind, ghost: boolean): THREE.Group {
    const group = new THREE.Group();
    if (kind === 'crossbow') {
      const mat = ghost
        ? new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false })
        : new THREE.MeshLambertMaterial({ vertexColors: true });
      const m = new THREE.Mesh(this.ballista(), mat);
      m.name = 'model';
      m.renderOrder = ghost ? 10 : 0;
      group.add(m);
      return group;
    }
    // Voxel figures: one model, or a squad of archers in ranks, or a soldier company's banner group.
    const geo = this.figureGeo(kind);
    const n = this.game.cfg.archers.archers;
    const rows = Math.ceil(n / SQUAD_COLS);
    const at: number[][] = kind === 'archers'
      ? Array.from({ length: n }, (_, i) => [(i % SQUAD_COLS - (SQUAD_COLS - 1) / 2) * SQUAD_SPACING + (Math.floor(i / SQUAD_COLS) % 2) * 0.2, (Math.floor(i / SQUAD_COLS) - (rows - 1) / 2) * SQUAD_SPACING * 0.8])
      : kind === 'soldiers' ? COMPANY : [[0, 0]];
    for (const [dx, dz] of at) {
      // The lit part first: the ghost tint reads children[0]. The glow (orb, embers) shines unlit.
      for (const [part, g] of [['solid', geo.solid], ['glow', geo.glow]] as const) {
        if (!g) continue;
        const opts = { vertexColors: true, ...(ghost ? { transparent: true, depthTest: false, depthWrite: false } : {}) };
        const m = new THREE.Mesh(g, part === 'solid' ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshBasicMaterial(opts));
        m.name = 'model';
        m.position.set(dx, 0, dz);
        m.renderOrder = ghost ? 10 : 0;
        group.add(m);
      }
    }
    return group;
  }

  /** The lit and glowing geometry of a voxel defender's model, built on first use. */
  private figureGeo(kind: PlacedKind) {
    let geo = this.newGeo.get(kind);
    if (!geo) {
      geo = new VoxBatch().add(atRes(this.voxelRes, NEW_MODELS[kind]!), NEW_VOX[kind]!, new THREE.Vector3()).geometries();
      this.newGeo.set(kind, geo);
    }
    return geo;
  }

  /** The crossbow's ballista geometry, built on first use. */
  private ballista(): THREE.BufferGeometry {
    this.ballistaGeo ??= new VoxBatch().add(atRes(this.voxelRes, ballistaModel), BALLISTA_VOX, new THREE.Vector3()).geometries().solid!;
    return this.ballistaGeo;
  }

  /**
   * Builds every voxel model again at the current resolution (after High detail is turned on or off):
   * the instanced meshes keep their instances and take the new geometry, the placed defenders and the
   * ghosts are given theirs, and the castle is rebuilt and crumbled back to where it was.
   */
  private rebuildVoxels() {
    const res = this.voxelRes;
    const swaps = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    const old = [...this.newGeo.entries()];
    this.newGeo.clear();
    for (const [kind, geo] of old) {
      const fresh = this.figureGeo(kind);
      if (geo.solid && fresh.solid) swaps.set(geo.solid, fresh.solid);
      if (geo.glow && fresh.glow) swaps.set(geo.glow, fresh.glow);
    }
    if (this.ballistaGeo) {
      const was = this.ballistaGeo;
      this.ballistaGeo = null;
      swaps.set(was, this.ballista());
    }
    swaps.set(this.balls.geometry, ballGeometry(this.game.cfg.balls.radius, res));
    for (const kind of Object.keys(this.thrown) as (keyof typeof THROWN_HEIGHT)[]) swaps.set(this.thrown[kind].geometry, rockGeometry(kind, THROWN_HEIGHT[kind], res));
    const swap = (o: THREE.Object3D) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = swaps.get(o.geometry);
      if (geo) o.geometry = geo;
    };
    this.scene.traverse(swap);
    this.topScene.traverse(swap);
    for (const ghost of this.ghosts.values()) ghost.traverse(swap);
    for (const geo of swaps.keys()) geo.dispose();
    this.voxelOrcs.setRes(res);
    this.shieldModel.setRes(res);
    this.world.setRes(res);
    this.rebuildCastle();
    this.stackKey = '';
    this.game.segmentHp.forEach((hp, i) => this.crumble(this.segments[i], hp / this.game.cfg.wall.segmentHp, true));
  }

  /** Pulses the ghost and tints it by whether it fits. */
  private updateGhost(time: number) {
    const shown = this.ghostShown;
    if (!shown) return;
    const ghost = this.ghosts.get(shown.kind)!;
    for (const child of ghost.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.set(shown.ok ? '#c8ffc8' : '#ff7a6a');
      mat.opacity = shown.ok ? 0.75 + Math.sin(time * 6) * 0.15 : 0.6;
    }
  }

  handleEvents(events: GameEvent[]) {
    const g = this.game;
    const fw = this.fireworks;
    const sy = g.cfg.shield.y;
    for (const ev of events) {
      switch (ev.type) {
        case 'kill': {
          const big = SIZE[ev.kind];
          if (ev.kind === 'warlord') {
            // Out of the last of his armour steps a scrawny orc on stilts, and legs it.
            for (let i = 0; i < 5; i++) this.chunk(this.chunkArt.plates[(Math.random() * this.chunkArt.plates.length) | 0], ev.x, 3, -ev.y + 0.5, 1.3, 14);
            this.cameo([this.chunkArt.reveal.texture], ev.x, -ev.y, 4.2, 4.5, new THREE.Vector3(1.5, 0, -6), this.chunkArt.reveal.aspect);
          }
          if (big >= 2) {
            this.ground.decal(ev.x, -ev.y, big, this.scorch, 0.75);
            this.terrain.crater(ev.x, -ev.y, big * 0.8, 0.4);
            fw.burst(ev.x, big, -ev.y, { count: 40 * big, colors: [...GOLD, KILL_COLOR[ev.kind]], speed: 8 + big * 2, life: 1, size: 0.45, up: 0.4, twinkle: true });
          } else if (Math.random() < 0.5) {
            this.ground.stamp(ev.x, -ev.y, 0.9 * big, 'rgba(60,70,20,0.5)');
          }
          if (this.orcStyle === 'voxel' && ev.kind !== 'warlord') this.breakOrc(ev.kind, ev.x, -ev.y);
          else this.burst(ev.x, 0.6 * big, -ev.y, big >= 2 ? Math.round(4 * big) : 2, KILL_COLOR[ev.kind], 4 + big);
          // A pop of gold glints: every kill pays.
          fw.burst(ev.x, 0.9, -ev.y, { count: 6, colors: GOLD, speed: 4, life: 0.5, size: 0.3, up: 0.7, gravity: 8 });
          break;
        }
        case 'splash':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.45, ev.radius);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.6, this.crater, 0.8);
          this.terrain.crater(ev.x, -ev.y, ev.radius * 0.55, 0.55);
          this.burst(ev.x, 0.4, -ev.y, 6, '#9a8f78', 6);
          fw.burst(ev.x, 0.6, -ev.y, { count: 40, colors: FIRE, speed: 9, life: 0.6, size: 0.45, up: 0.5 });
          this.shake = Math.max(this.shake, 0.2);
          break;
        case 'blast':
          // A barrel goes up: fireball, shockwave ring, embers and a crater.
          this.spawnEffect('fireball', ev.x, -ev.y, 0.55, ev.radius * 1.1);
          this.spawnEffect('barrelBlast', ev.x, -ev.y, 0.6, ev.radius * 1.2);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.8, this.scorchBlast, 0.95);
          this.terrain.crater(ev.x, -ev.y, ev.radius * 0.6, 0.7);
          fw.burst(ev.x, 0.5, -ev.y, { count: 120, colors: FIRE, speed: 16, life: 0.9, size: 0.6, up: 0.45, gravity: 9, twinkle: true });
          fw.burst(ev.x, 0.3, -ev.y, { count: 60, colors: ['#fff2a8', '#ffb43a'], speed: 20, life: 0.4, size: 0.5, ring: true, gravity: 0, drag: 5 });
          this.burst(ev.x, 0.6, -ev.y, 10, '#5a3a1e', 10);
          this.flash(0.35, '#ffb43a');
          this.shake = Math.max(this.shake, 0.6);
          break;
        case 'powderBlast': {
          const r = g.cfg.town.powder.radius;
          this.spawnEffect('fireball', ev.x, -ev.y, 0.55, r * 1.6);
          this.ground.decal(ev.x, -ev.y, r * 0.8, this.scorchBlast, 0.8);
          fw.burst(ev.x, 0.5, -ev.y, { count: 70, colors: FIRE, speed: 12, life: 0.7, size: 0.5, up: 0.45, gravity: 9, twinkle: true });
          this.burst(ev.x, 0.6, -ev.y, 6, '#5a3a1e', 8);
          this.shake = Math.max(this.shake, 0.3);
          break;
        }
        case 'soldierDown':
          this.burst(ev.x, 0.6, -ev.y, 3, '#2f56b0', 4);
          break;
        case 'bossKilled':
          // The tower's gone, but one goblin hasn't noticed and keeps on pushing.
          this.cameo(this.chunkArt.goblin, ev.x + 1.5, -ev.y + 1, 2.4, 5, new THREE.Vector3(0, 0, 0.9));
          for (let i = 0; i < 8; i++) this.chunk(this.chunkArt.debris[i % this.chunkArt.debris.length], ev.x + (Math.random() - 0.5) * 6, 3, -ev.y + 0.5, 1.6, 15);
          this.spawnEffect('explosion', ev.x, -ev.y, 0.8, 6);
          this.terrain.crater(ev.x, -ev.y, 4, 1);
          this.shake = Math.max(this.shake, 1);
          this.flash(0.7, '#fff6c8');
          // The grand finale: a volley of rockets over the field.
          for (let i = 0; i < 14; i++) this.rocket(ev.x + (Math.random() - 0.5) * 24, -ev.y + (Math.random() - 0.5) * 10, PARTY, i * 0.12, 1.4);
          break;
        case 'deflect': {
          // Clang: a fan of sparks off the steel, bigger for a heave, pink for a trick shot.
          const colors = ev.trick ? ['#ff5ad9', '#ffffff', '#c08aff'] : ev.parry ? GOLD : STEEL;
          this.spawnEffect(ev.parry ? 'parry' : 'flash', ev.x, -sy, ev.parry ? 0.3 : 0.15);
          fw.burst(ev.x, BALL_Y + 0.4, -sy - 0.3, { count: ev.parry ? 70 : 26, colors, speed: ev.parry ? 14 : 9, life: 0.5, size: 0.38, up: 0.5, gravity: 14 });
          if (ev.parry) fw.burst(ev.x, 0.4, -sy, { count: 40, colors: GOLD, speed: 14, life: 0.35, size: 0.4, ring: true, gravity: 0, drag: 6 });
          this.sparks(ev.x, BALL_Y + 0.4, -sy - 0.3, ev.parry ? 18 : 8);
          this.shieldJolt = ev.parry ? 1 : 0.7;
          this.shieldFlashT = 0;
          this.shake = Math.max(this.shake, ev.parry ? 0.5 : 0.25);
          if (ev.parry) this.flash(0.18, '#fff6c8');
          break;
        }
        case 'shieldBounce': {
          const cue = this.bounceCues[this.bounceCueNext++ % this.bounceCues.length];
          cue.born = this.time;
          cue.mesh.position.set(ev.x, 0.6, -ev.y);
          cue.mesh.rotation.y = Math.atan2(ev.vy, ev.vx);
          cue.mesh.scale.set(1.2, 1, 1);
          cue.mesh.visible = true;
          break;
        }
        case 'perfect':
          // A perfectly timed heave: a compact extra burst of orange on top of the parry.
          fw.burst(ev.x, BALL_Y + 0.4, -sy - 0.3, { count: 36, colors: ORANGE, speed: 12, life: 0.4, size: 0.36, up: 0.5, gravity: 14 });
          this.shieldJolt = Math.max(this.shieldJolt, 1.2);
          this.shake = Math.max(this.shake, 0.35);
          break;
        case 'bowlHit':
          // Placeholder fx (fx-orc-bowling.png later): yellow impact stars and a flying helmet or two.
          fw.burst(ev.x, 1.4, -ev.y, { count: 10, colors: ['#fff6c8', '#ffd34a', '#ffffff'], speed: 6, life: 0.35, size: 0.35, up: 0.6, gravity: 6 });
          if (!ev.armoured) fw.burst(ev.x, 1.8, -ev.y, { count: 3, colors: ['#8a8f99', '#5a5f6a', '#b0b5bd'], speed: 7, life: 0.8, size: 0.5, up: 1.4, gravity: 16 });
          break;
        case 'edge':
          this.world.chipTree(ev.side, -ev.y);
          break;
        case 'obstacle':
          this.world.chipObstacle(ev.index, ev.x, -ev.y);
          break;
        case 'bumper':
          fw.burst(ev.x, 1.4, -ev.y, { count: 26, colors: ['#ffd34a', '#ffffff', '#5ad8ff'], speed: 9, life: 0.45, size: 0.4, up: 0.4, gravity: 6 });
          this.shake = Math.max(this.shake, 0.12);
          break;
        case 'bell':
          fw.burst(ev.x, 2.2, -ev.y, { count: 14, colors: ['#ffd34a', '#fff2a8'], speed: 5, life: 0.5, size: 0.3, up: 0.5, gravity: 2, twinkle: true });
          break;
        case 'bellVolley':
          this.flash(0.12, '#ffd34a');
          fw.burst(ev.x, 2, -2, { count: 40, colors: ['#ffd34a', '#ffffff'], speed: 8, life: 0.6, size: 0.4, up: 0.8, gravity: 4 });
          break;
        case 'rampLaunch':
          this.burst(ev.x, 0.6, -ev.y, 5, '#a8783f', 7);
          break;
        case 'rampLand':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.35, ev.radius * 0.8);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.5, this.crater, 0.7);
          this.burst(ev.x, 0.4, -ev.y, 8, '#9a8f78', 7);
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'defenderPlaced': {
          const fx = g.cfg.setupFx;
          this.drops.set(ev.id, this.time);
          this.landings.push({ at: this.time + fx.dropSeconds, x: ev.x, y: ev.y });
          this.pulse(ev.x, ev.y);
          break;
        }
        case 'terrainPlaced': {
          const wood = ev.kind === 'barricade';
          this.world.addObstacle(ev.index);
          this.dust(ev.x, 0.3, -ev.y, wood ? '#a88858' : '#b8b0a0', wood ? '#7a4a24' : '#8c877c');
          if (g.cfg.setupFx.shake > 0) this.shake = Math.max(this.shake, g.cfg.setupFx.shake * 0.6);
          break;
        }
        case 'terrainRemoved':
          this.world.removeObstacle(ev.index);
          break;
        case 'terrainRebuilt':
          this.world.rebuildTerrain();
          break;
        case 'contraptionMoved':
          this.world.moveFixture(ev.index, ev.x, ev.y);
          break;
        case 'contraptionsSwapped':
          this.world.swapFixtures();
          break;
        case 'treeDown':
          this.world.fellTree(ev.index);
          this.shake = Math.max(this.shake, 0.25);
          break;
        case 'flung':
          this.flung.push({
            kind: ev.kind,
            pos: new THREE.Vector3(ev.x, 1, -ev.y),
            vel: new THREE.Vector3(ev.vx, 11 + Math.random() * 5, -ev.vy),
            spin: new THREE.Vector3(-8 - Math.random() * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10),
            rot: new THREE.Euler(),
            life: 3,
          });
          fw.burst(ev.x, 1, -ev.y, { count: 10, colors: ['#ffffff', '#ffd34a'], speed: 6, life: 0.3, size: 0.35, gravity: 6 });
          break;
        case 'slam':
          if (ev.hits > 0) {
            // The shield bash lands: a shockwave along the wall's foot and a jolt.
            fw.burst(ev.x, 0.4, -sy + 1.5, { count: 30 + ev.hits * 6, colors: ['#e8d8b0', '#ffffff', '#c0a878'], speed: 12, life: 0.4, size: 0.5, ring: true, gravity: 0, drag: 5 });
            this.shake = Math.max(this.shake, Math.min(0.9, 0.3 + ev.hits * 0.06));
            this.shieldJolt = 1;
          }
          break;
        case 'heave':
          this.heaveT = 0;
          fw.burst(ev.x, 0.2, -sy, { count: 14, colors: ['#e8d8b0', '#c0a878'], speed: 5, life: 0.4, size: 0.4, ring: true, gravity: 0, drag: 5 });
          break;
        case 'line':
          // A heave smashing through an orc line: a streak of gold sparks along it.
          fw.streak(ev.x0, ev.x1, 1, -ev.y, GOLD, 3);
          fw.burst((ev.x0 + ev.x1) / 2, 1, -ev.y, { count: 50, colors: GOLD, speed: 10, life: 0.7, size: 0.45, up: 0.6, twinkle: true });
          this.flash(0.2, '#ffd34a');
          this.shake = Math.max(this.shake, 0.35);
          break;
        case 'bank':
          fw.burst(ev.x, 0.9, -ev.y, { count: 30, colors: ['#ffffff', '#5ad8ff', '#ffd34a'], speed: 9, life: 0.45, size: 0.35, up: 0.3, gravity: 6 });
          break;
        case 'shotDown':
          // Archers shoot a boulder out of the sky: it bursts into rubble mid-air.
          fw.burst(ev.x, 5, -ev.y, { count: 40, colors: ['#ffb43a', '#fff2a8', '#c8b898'], speed: 9, life: 0.6, size: 0.45, gravity: 10 });
          this.burst(ev.x, 5, -ev.y, 6, '#8c8070', 8);
          this.rockBurst(ev.x, 5, -ev.y, 10, 9);
          break;
        case 'combo': {
          const colors = COMBO_COLORS[ev.combo] ?? GOLD;
          const tier = ev.combo >= 40 ? 3 : ev.combo >= 25 ? 2 : 1;
          fw.burst(ev.x, 1.2, -ev.y, { count: 60 * tier, colors, speed: 10 + tier * 3, life: 1.1, size: 0.5, up: 0.6, gravity: 4, twinkle: true });
          for (let i = 0; i < tier * 2; i++) this.rocket(ev.x + (Math.random() - 0.5) * 8, -ev.y + (Math.random() - 0.5) * 4, colors, i * 0.15, 0.8 + tier * 0.2);
          this.flash(0.12 + tier * 0.1, colors[0]);
          break;
        }
        case 'plank':
          this.chunk(this.chunkArt.planks[2 + (Math.random() < 0.3 ? 3 : 0)], ev.x, TOWER_PLANK_Y, -ev.y + 0.5, 1.1, 9);
          this.burst(ev.x, TOWER_PLANK_Y, -ev.y, 4, '#a8783f', 7);
          fw.burst(ev.x, TOWER_PLANK_Y, -ev.y + 0.3, { count: 22, colors: WOOD, speed: 8, life: 0.5, size: 0.35, gravity: 14 });
          this.shake = Math.max(this.shake, 0.15);
          break;
        case 'floorDown':
          // A storey gives way: wreckage everywhere, a ring of dust, and the tower slumps.
          for (let i = 0; i < 7; i++) {
            const art = Math.random() < 0.5 ? this.chunkArt.debris[(Math.random() * this.chunkArt.debris.length) | 0] : this.chunkArt.planks[(Math.random() * 6) | 0];
            this.chunk(art, ev.x + (Math.random() - 0.5) * 6, TOWER_PLANK_Y, -ev.y + 0.5, 1.4 + Math.random() * 0.8, 13);
          }
          for (let i = 0; i < 6; i++) this.puff(ev.x + (Math.random() - 0.5) * 8, 1 + Math.random() * 3, -ev.y + 1, 4, '#c8b898', 1.6);
          this.towerSlump = 1;
          this.burst(ev.x, TOWER_PLANK_Y, -ev.y, 24, '#8a5a2e', 12);
          fw.burst(ev.x, 0.4, -ev.y, { count: 90, colors: ['#c8b898', '#a89070', '#e8d8b0'], speed: 14, life: 0.8, size: 0.7, ring: true, gravity: 0, drag: 3 });
          fw.burst(ev.x, TOWER_PLANK_Y, -ev.y, { count: 80, colors: [...WOOD, ...GOLD], speed: 12, life: 0.9, size: 0.45, up: 0.5, twinkle: true });
          this.flash(0.3, '#ffd34a');
          this.shake = Math.max(this.shake, 0.8);
          break;
        case 'mageBlast': {
          // A violet bolt streaks from the caster, then a ring and flash where it lands.
          const top = this.standHeight(ev.fromX, -ev.fromY) + 3.5;
          for (let i = 1; i <= 8; i++) {
            const t = i / 8;
            fw.burst(ev.fromX + (ev.x - ev.fromX) * t, top * (1 - t) + 0.8 * t, -(ev.fromY + (ev.y - ev.fromY) * t), { count: 6, colors: ARCANE, speed: 1.5, life: 0.3, size: 0.45, gravity: 0, drag: 4 });
          }
          this.spawnEffect('ring', ev.x, -ev.y, 0.5, ev.radius);
          this.spawnEffect('flash', ev.x, -ev.y, 0.2);
          fw.burst(ev.x, 0.8, -ev.y, { count: 70, colors: ARCANE, speed: 12, life: 0.6, size: 0.5, up: 0.4, twinkle: true });
          fw.burst(ev.x, 0.4, -ev.y, { count: 60, colors: ARCANE, speed: ev.radius * 3.2, life: 0.4, size: 0.4, ring: true, gravity: 0, drag: 5 });
          fw.burst(ev.fromX, top, -ev.fromY, { count: 16, colors: ARCANE, speed: 5, life: 0.4, size: 0.4 });
          this.flash(0.12, '#c07aff');
          this.shake = Math.max(this.shake, 0.2);
          break;
        }
        case 'ballistaFired': {
          // A heavy thunk of the arms: smoke and splinters at the muzzle.
          const top = this.standHeight(ev.x, -ev.y) + 2.5;
          fw.burst(ev.x, top, -ev.y - 1, { count: 30, colors: [...WOOD, ...STEEL], speed: 9, life: 0.4, size: 0.4, gravity: 8 });
          this.puff(ev.x, top, -ev.y - 1, 2.4, '#d8ccb0', 0.9);
          this.shake = Math.max(this.shake, 0.25);
          break;
        }
        case 'oilPour': {
          // A stream of oil down the wall face, then a hot splash with steam at the foot.
          const top = this.standHeight(ev.x, -ev.y);
          const w = ev.width / 2;
          for (let i = 0; i < 14; i++) {
            const x = ev.x + (Math.random() * 2 - 1) * w;
            fw.burst(x, top - Math.random() * top, -(ev.y + 0.4), { count: 5, colors: OIL, speed: 1.5, life: 0.5, size: 0.4, gravity: 12 });
          }
          fw.burst(ev.x, 0.6, -2, { count: 90, colors: OIL, speed: 9, life: 0.7, size: 0.5, up: 0.5, gravity: 9, twinkle: true });
          for (let i = 0; i < 6; i++) this.puff(ev.x + (Math.random() * 2 - 1) * w, 0.8 + Math.random() * 1.5, -(1 + Math.random() * 2), 3 + Math.random() * 2, '#e8e0d0', 1.6);
          this.spawnEffect('ring', ev.x, -1.5, 0.45, ev.width * 0.6);
          this.flash(0.1, '#ff9a2a');
          break;
        }
        case 'spikeHit':
          fw.burst(ev.x, 0.6, -ev.y, { count: 14, colors: STEEL, speed: 7, life: 0.3, size: 0.3, up: 0.5, gravity: 8 });
          this.sparks(ev.x, 0.6, -ev.y, 6);
          break;
        case 'bounce':
          if (Math.random() < 0.6) fw.burst(ev.x, 0.9, -ev.y, { count: 8, colors: STEEL, speed: 6, life: 0.3, size: 0.3, gravity: 6 });
          break;
        case 'clang':
          fw.burst(ev.x, 0.9, -ev.y, { count: 12, colors: STEEL, speed: 7, life: 0.3, size: 0.3, gravity: 6 });
          this.spawnEffect('impact', ev.x, -ev.y, 0.2, 0.9);
          break;
        case 'formationBreak':
          fw.burst(ev.x, 1, -ev.y, { count: 40, colors: [...WOOD, ...STEEL], speed: 9, life: 0.6, size: 0.4, up: 0.5 });
          this.spawnEffect('impact', ev.x, -ev.y, 0.2, 1.8);
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'ballLost':
          fw.burst(ev.x, 1.5, -0.2, { count: 30, colors: ['#ff6a5a', '#ffb43a', '#8c8a80'], speed: 7, life: 0.5, size: 0.4, up: 0.5 });
          this.burst(ev.x, 2.5, 0, 5, '#8c8a80', 6);
          this.flash(0.15, '#ff6a5a');
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'caught': {
          const look = CAPSULE_LOOK[ev.kind];
          fw.burst(ev.x, BALL_Y + 0.6, -sy - 0.3, { count: 50, colors: [look.color, '#ffffff'], speed: 10, life: 0.7, size: 0.45, up: 0.7, twinkle: true });
          this.flash(0.15, look.color);
          break;
        }
        case 'waveCleared':
          // Fireworks over the castle for every wave held.
          for (let i = 0; i < 6; i++) this.rocket(-14 + Math.random() * 28, 2 + Math.random() * 6, i % 2 ? ROYAL : PARTY, i * 0.25, 1);
          break;
        case 'hit':
          if (Math.random() < 0.3) this.burst(ev.x, 0.8, -ev.y, 1, '#d9d0b0', 3);
          fw.burst(ev.x, 0.9, -ev.y, { count: 5, colors: ['#ffffff', '#ffd34a'], speed: 5, life: 0.25, size: 0.3, gravity: 4 });
          if (this.effects.length < 30 && Math.random() < 0.3) this.spawnEffect('impact', ev.x, -ev.y, 0.2, 0.9);
          break;
        case 'storeyLost': {
          // A storey is knocked off a tower: stone and dust fly from where its top was.
          const top = towerTop(ev.storeys + 1);
          for (let i = 0; i < 6; i++) this.burst(ev.x + (Math.random() - 0.5) * 2.5, top, TOWER_Z, 3, STONE[i % STONE.length], 10);
          this.rockBurst(ev.x, top, TOWER_Z, 10, 9);
          for (let i = 0; i < 4; i++) this.puff(ev.x + (Math.random() - 0.5) * 3, top - Math.random(), TOWER_Z, 3, '#d8ccb0', 1);
          this.shake = Math.max(this.shake, 0.4);
          break;
        }
        case 'wallHit': {
          // Rock on stone: blocks of the wall fly, more and further for a bigger hit, with a puff of dust.
          const k = Math.min(1, ev.damage / 25);
          for (let i = 0; i < 3 + k * 4; i++) this.burst(ev.x + (Math.random() - 0.5) * 1.5, WALL_H * 0.8, 0.3, 2 + Math.round(k * 2), STONE[i % STONE.length], 6 + k * 10);
          this.rockBurst(ev.x, WALL_H * 0.7, 0.3, 4 + Math.round(k * 8), 7 + k * 8);
          fw.burst(ev.x, WALL_H * 0.65, -0.2, { count: 10 + k * 40, colors: ['#e8d8b0', '#ffb43a', '#ffffff'], speed: 6 + k * 8, life: 0.45, size: 0.4, up: 0.5 });
          for (let i = 0; i < 1 + k * 4; i++) this.puff(ev.x + (Math.random() - 0.5) * 2, WALL_H * 0.65 + Math.random(), 0.5, 2 + k * 2.5, '#d8ccb0', 0.8 + k * 0.6);
          if (this.effects.length < 40) this.spawnEffect('impact', ev.x, 0.5, 0.25, 1.6 + k * 1.6);
          if (ev.damage >= 3) this.shake = Math.max(this.shake, 0.15 + k * 0.45);
          if (k >= 0.8) this.flash(0.15, '#ffb43a');
          break;
        }
        case 'segmentDestroyed': {
          // The breach: the whole section blows apart in fire, stone and smoke.
          const sx = -g.cfg.field.halfWidth + (ev.segment + 0.5) * g.segmentWidth();
          this.spawnEffect('fireball', sx, 0.5, 0.8, 7);
          this.spawnEffect('explosion', sx, 0.5, 0.7, 6);
          for (let i = 0; i < 16; i++) this.burst(sx + (Math.random() - 0.5) * g.segmentWidth(), WALL_H * 0.5 + Math.random() * 1.5, 0.5, 4, STONE[i % STONE.length], 18);
          fw.burst(sx, WALL_H * 0.65, 0, { count: 260, colors: FIRE, speed: 22, life: 1.2, size: 0.7, up: 0.6, gravity: 8, twinkle: true });
          fw.burst(sx, 0.5, 0, { count: 120, colors: ['#e8d8b0', '#c8b898', '#ffffff'], speed: 26, life: 0.6, size: 0.6, ring: true, gravity: 0, drag: 4 });
          for (let i = 0; i < 14; i++) this.puff(sx + (Math.random() - 0.5) * g.segmentWidth(), 1 + Math.random() * WALL_H, Math.random() * 2, 4 + Math.random() * 4, '#5a524a', 2.5);
          this.flash(0.8, '#ff5a3c');
          this.shake = Math.max(this.shake, 1.4);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Dust puffs and chips at a spot, fewer on Low detail. */
  private dust(x: number, y: number, z: number, puff: string, chip: string) {
    const n = DUST[this.quality];
    for (let i = 0; i < n; i++) this.puff(x + (Math.random() - 0.5) * 1.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 1.6, 1.6 + Math.random() * 1.2, puff, 0.7);
    this.burst(x, y + 0.2, z, n, chip, 4);
  }

  private flash(level: number, color: string) {
    if (level >= this.flashLevel) this.flashColor = color;
    this.flashLevel = Math.min(0.8, Math.max(this.flashLevel, level));
  }

  /** Queues a firework rocket: it climbs from (x, z), trailing sparks, and bursts. */
  private rocket(x: number, z: number, colors: string[], wait: number, size: number) {
    if (this.rockets.length > 40) return;
    this.rockets.push({
      x, y: 0.5, z, vx: (Math.random() - 0.5) * 3, vy: 15 + Math.random() * 6, vz: (Math.random() - 0.5) * 3,
      wait, fuse: 0.75 + Math.random() * 0.35, colors, size,
    });
  }

  private updateRockets(dt: number) {
    const fw = this.fireworks;
    this.rockets = this.rockets.filter((r) => {
      if (r.wait > 0) {
        r.wait -= dt;
        return true;
      }
      r.fuse -= dt;
      r.vy -= 9 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      fw.burst(r.x, r.y, r.z, { count: 2, colors: ['#fff2a8', '#ffb43a'], speed: 1.5, life: 0.4, size: 0.3, gravity: 3 });
      if (r.fuse > 0) return true;
      const o: BurstOptions = { count: 110 * r.size, colors: r.colors, speed: 12 * r.size, life: 1.4, size: 0.5 * r.size, gravity: 3, drag: 1.6, twinkle: true };
      fw.burst(r.x, r.y, r.z, o);
      fw.burst(r.x, r.y, r.z, { count: 20, colors: ['#ffffff'], speed: 4, life: 0.25, size: 0.9 * r.size, gravity: 0 });
      return false;
    });
  }

  render(dt: number, time: number) {
    const g = this.game;
    this.time = time;
    // The field gets more trampled with every wave.
    if (g.wave !== this.lastWave) {
      if (this.lastWave >= 0 && g.wave > 0) this.ground.wear(g.cfg.field.halfWidth, -g.cfg.field.spawnY, -2);
      this.lastWave = g.wave;
    }
    this.ground.flush(time, QUALITY[this.quality].upload);
    this.updateCastle(dt);
    this.updateSmoke(dt);
    this.updateEnemies(time);
    this.updateSoldiers(time);
    this.updateDefenders();
    this.updateProjectiles();
    this.updateDebris(dt);
    this.updateFlung(dt);
    this.updateChunks(dt);
    this.updateEffects(dt);
    this.updateShield(dt);
    this.updateBalls();
    this.updateCapsules(time);
    this.updateTower(dt);
    this.updatePlanning();
    this.updateSetupFx(dt);
    this.updateRockets(dt);
    this.world.update(dt, time);
    this.fireworks.update(dt);
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.2);

    this.updateGhost(time);

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const k = this.shake * this.shake * this.shakeScale;
    // Looking ahead glides the camera up the field and down closer to the horde (eased), and back.
    if (this.lookSeconds > 0) {
      const step = dt / this.lookSeconds;
      this.lookNow += Math.max(-step, Math.min(step, this.lookAhead - this.lookNow));
    } else this.lookNow += (this.lookAhead - this.lookNow) * Math.min(1, dt * this.lookRate);
    const ahead = this.lookNow * this.lookNow * (3 - 2 * this.lookNow) * LOOK_AHEAD;
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * k * 1.2,
      this.camBase.y + (Math.random() - 0.5) * k * 1.2 - ahead * 0.6,
      this.camBase.z - ahead,
    );
    this.camera.lookAt(tmpD.copy(this.camLook).setZ(this.camLook.z - ahead));
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.topScene, this.camera);
  }

  // ---- the shield, balls and capsules ---------------------------------------

  private updateShield(dt: number) {
    const g = this.game;
    const w = g.shieldHalfWidth() * 2 * SHIELD_OVERHANG;
    // A heave shoves the shield out at the orcs and tips it forward, then it settles back.
    this.heaveT += dt;
    const shove = this.heaveT < HEAVE_SECONDS * 2 ? Math.sin((this.heaveT / (HEAVE_SECONDS * 2)) * Math.PI) : 0;
    this.shieldJolt = Math.max(0, this.shieldJolt - dt * 6);
    const m = this.shieldModel.group;
    // Taller and thicker than the flat collision line; the thickness stops growing with the width so the back never reaches the wall.
    const depth = SHIELD_THICKNESS * Math.min(w, SHIELD_DEPTH_WIDTH_CAP);
    m.scale.set(w, w * SHIELD_TALL, depth);
    // The front face sits on the collision line and the thickness grows back toward the wall.
    m.position.set(g.shield.x, SHIELD_LIFT + shove * 0.4 + this.shieldJolt * 0.15, -g.cfg.shield.y + depth / 24 - shove * 1.6 + this.shieldJolt * 0.2);
    m.rotation.set(SHIELD_LEAN - shove * 0.3 + this.shieldJolt * 0.04, 0, this.shieldJolt * 0.03 * Math.sin(this.time * 60));
    for (const cue of this.bounceCues) {
      const k = 1 - (this.time - cue.born) / 0.35;
      cue.mesh.visible = k > 0;
      if (k > 0) (cue.mesh.material as THREE.MeshBasicMaterial).opacity = k;
    }
    this.shieldFlashT += dt;
    const glint = Math.max(0, 1 - this.shieldFlashT / SHIELD_FLASH_SECONDS);
    // A ball about to land lights the shield dimly, then brightly inside the heave window: click now.
    let cue = 0;
    if (g.phase === 'battle' && g.canHeave) {
      const win = g.heaveWindow();
      for (const b of g.balls) {
        if (b.stuck || b.vy >= 0) continue;
        const eta = (b.y - g.cfg.shield.y) / -b.vy;
        if (eta > 0 && eta <= win * 3) cue = Math.max(cue, eta <= win ? 0.9 : 0.35);
      }
    }
    // Dimmed while it recovers from a heave.
    this.shieldModel.shade(Math.max(glint * glint, cue), 1, g.canHeave ? 1 : Math.max(0, 1 - (g.shield.readyAt - g.time) / g.heaveCooldown()));
    // Dragged hard along the ground, its point throws a spray of sparks behind it.
    const drag = g.phase === 'battle' ? g.shield.vx / g.cfg.shield.speed : 0;
    if (Math.abs(drag) > 0.2) {
      this.scrapeSparks(g.shield.x - Math.sign(drag) * w * 0.05, 0.3, -g.cfg.shield.y + 0.2, Math.sign(drag), Math.abs(drag) * 3 * Math.min(2, dt * 60));
    }
    // Its bearers dig in behind it and lunge with every heave.
    this.bearers.forEach((b, i) => {
      const side = i ? 1 : -1;
      b.position.set(g.shield.x + side * w * 0.2, Math.abs(Math.sin(this.time * 9 + i)) * Math.min(1, Math.abs(drag) * 4) * 0.15, -g.cfg.shield.y + 1.1 - shove * 1.2);
      b.quaternion.setFromAxisAngle(FORWARD, -side * 0.12 - shove * 0.2 * side);
    });
    this.shieldShadow.position.x = g.shield.x;
    this.shieldShadow.position.z = -g.cfg.shield.y + 0.6;
    this.shieldShadow.scale.set(w * 1.05, 1, w * 0.5);
  }

  /** A ball's colour: by kind, then hotter as its combo climbs. */
  private ballColor(b: Ball): string {
    if (b.combo >= 40) return '#fff6c8';
    if (b.combo >= 25) return '#ff7ad9';
    if (b.combo >= 10) return '#ffa040';
    if (b.kind === 'royal') return '#ffd34a';
    if (b.kind === 'pebble') return '#b08a5a';
    return '#9cc8ff';
  }

  private updateBalls() {
    const g = this.game;
    const camQ = this.camera.quaternion;
    const r = g.cfg.balls.radius;
    let n = 0;
    let h = 0;
    let sh = 0;
    for (const b of g.balls) {
      if (n >= MAX_BALLS) break;
      // A ball just beyond the shield (from the castle's view) is hidden by it.
      if (!b.air && Math.abs(b.x - g.shield.x) < g.shieldHalfWidth() * SHIELD_OVERHANG && b.y > g.cfg.shield.y - 0.2 && b.y < g.cfg.shield.y + SHIELD_HIDE_DEPTH) continue;
      const color = this.ballColor(b);
      let size = (b.kind === 'pebble' ? 0.75 : b.kind === 'royal' ? 1.25 : 1) * BALL_DRAW;
      let y = BALL_Y;
      if (b.air) {
        // Over a ramp: up in an arc, bigger, with its shadow left on the ground.
        const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, (b.y - b.air.fromY) / Math.max(0.1, b.air.landY - b.air.fromY))));
        y += arc * 4;
        size *= 1 + arc * 0.6;
        this.ballShadows.setMatrixAt(sh++, tmpM.compose(tmpV.set(b.x, 0, -b.y), tmpQ.identity(), tmpS.setScalar(1.6 - arc * 0.5)));
      }
      tmpV.set(b.x, y, -b.y);
      this.balls.setMatrixAt(n, tmpM.compose(tmpV, tmpQ.setFromEuler(tmpE.set(this.time * 2.2 + b.id, this.time * 3 + b.id * 1.7, this.time * 1.3)), tmpS.setScalar(size)));
      this.balls.setColorAt(n++, tmpC.set(color));
      const glow = (b.perfect ? 6.5 : b.heaved && b.lines > 0 ? 6 : b.combo >= 10 ? 5 : 3.5) * r * size;
      this.halos.setMatrixAt(h, tmpM.compose(tmpV, camQ, tmpS.set(glow, glow, 1)));
      this.halos.setColorAt(h++, tmpC.set(color).multiplyScalar(b.kind === 'pebble' ? 0.4 : 0.8));
      // A comet trail, longer and hotter with the combo.
      if (!b.stuck) {
        const hot = b.perfect || b.combo >= 10 || (b.heaved && b.lines > 0);
        // A Perfect Return burns an orange trail until it lands its hit.
        this.fireworks.burst(b.x, BALL_Y, -b.y, {
          count: hot ? 3 : 1.2, colors: b.perfect ? ORANGE : [color, '#ffffff'], speed: 0.8, life: hot ? 0.45 : 0.3, size: r * size * (hot ? 1.8 : 1.3), gravity: 0, drag: 4,
        });
      }
    }
    for (const c of g.capsules) {
      if (h >= MAX_BALLS + 8) break;
      tmpV.set(c.x, 1.4, -c.y);
      this.halos.setMatrixAt(h, tmpM.compose(tmpV, camQ, tmpS.set(3.2, 3.2, 1)));
      this.halos.setColorAt(h++, tmpC.set(CAPSULE_LOOK[c.kind].color).multiplyScalar(0.6));
    }
    this.balls.count = n;
    this.halos.count = h;
    this.ballShadows.count = sh;
    this.ballShadows.instanceMatrix.needsUpdate = true;
    for (const m of [this.balls, this.halos]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private updateCapsules(time: number) {
    const seen = new Set<Capsule>();
    for (const c of this.game.capsules) {
      seen.add(c);
      let sp = this.capsuleSprites.get(c);
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.capsuleTex[c.kind], depthTest: false }));
        sp.renderOrder = 9;
        this.capsuleSprites.set(c, sp);
        this.scene.add(sp);
      }
      const wob = Math.sin(time * 5 + c.x) * 0.15;
      sp.position.set(c.x, 1.4 + wob * 0.5, -c.y);
      sp.material.rotation = wob;
      sp.scale.set(2.4, 2.4, 1);
      if (Math.random() < 0.3) this.fireworks.burst(c.x, 1.4, -c.y, { count: 1, colors: [CAPSULE_LOOK[c.kind].color, '#ffffff'], speed: 1, life: 0.4, size: 0.3, gravity: -1 });
    }
    for (const [c, sp] of this.capsuleSprites) {
      if (seen.has(c)) continue;
      this.scene.remove(sp);
      sp.material.dispose();
      this.capsuleSprites.delete(c);
    }
  }

  // ---- the siege tower ------------------------------------------------------

  private updateTower(dt: number) {
    const tw = this.game.tower;
    const group = this.towerGroup;
    if (!tw) {
      group.visible = false;
      this.towerStage = -1;
      return;
    }
    const t = this.game.cfg.siegeTower;
    const { width: w, height: h, base, floor } = this.towerSize();
    const standing = tw.floors.length;
    // Its picture by floors left: whole, then battered once a plank is gone, then each storey lost.
    const battered = tw.floors.some((planks) => planks.some((p) => p < t.plankHits));
    const stage = Math.min(TOWER_STAGES.length - 1, standing >= TOWER_ART.floors ? (battered ? 1 : 0) : TOWER_ART.floors + 1 - standing);
    const mat = this.towerArt.material as THREE.MeshBasicMaterial;
    if (stage !== this.towerStage) {
      this.towerStage = stage;
      mat.map = this.towerTex[stage];
      mat.needsUpdate = true;
    }
    // Every stage stands on its wheels, however its canvas is laid out.
    this.towerSlump = Math.max(0, this.towerSlump - dt * 2.5);
    const slump = Math.sin(this.towerSlump * Math.PI) * 0.08;
    this.towerArt.position.y = -h * (1 - TOWER_WHEELS[stage]);
    this.towerArt.scale.set(1 + slump * 0.5, 1 - slump, 1);
    const rumble = tw.ramp ? Math.sin(this.time * 30) * 0.04 : 0;
    group.visible = true;
    group.position.set(tw.x + rumble, 0, -(tw.y + t.depth / 2));
    group.quaternion.copy(this.camera.quaternion);
    // On the whole tower, cracked planks show cracks and knocked-out ones leave a dark hole.
    const holes = this.towerHoles;
    const cracks = this.towerCracks;
    let n = 0;
    let k = 0;
    if (standing >= TOWER_ART.floors) {
      const cellW = (w * (TOWER_ART.right - TOWER_ART.left)) / t.planks;
      tw.floors.forEach((planks, f) => {
        planks.forEach((hits, i) => {
          if (hits >= t.plankHits) return;
          const x = (TOWER_ART.left - 0.5) * w + (i + 0.5) * cellW;
          const y = base + f * floor + floor / 2;
          if (hits <= 0 && n < holes.instanceMatrix.count) {
            holes.setMatrixAt(n, tmpM.compose(tmpV.set(x, y, 0.02), tmpQ.identity(), tmpS.set(cellW * 0.8, floor * 0.7, 1)));
            holes.setColorAt(n++, tmpC.set('#140c06'));
          } else if (hits > 0 && k < cracks.instanceMatrix.count) {
            cracks.setMatrixAt(k++, tmpM.compose(tmpV.set(x, y, 0.03), tmpQ.identity(), tmpS.set(cellW * 0.95, floor * 0.85, 1)));
          }
        });
      });
    }
    holes.count = n;
    cracks.count = k;
    holes.instanceMatrix.needsUpdate = true;
    cracks.instanceMatrix.needsUpdate = true;
    if (holes.instanceColor) holes.instanceColor.needsUpdate = true;
  }

  /** The siege tower art's size on screen: its plank grid matches the sim's plank row; base and floor heights follow the art. */
  private towerSize() {
    const t = this.game.cfg.siegeTower;
    const width = (t.halfWidth * 2) / (TOWER_ART.right - TOWER_ART.left);
    const height = width / TOWER_ART.aspect;
    const floor = height * ((TOWER_ART.bottom - TOWER_ART.top) / TOWER_ART.floors);
    return { width, height, base: height * (TOWER_WHEELS[0] - TOWER_ART.bottom), floor };
  }

  // ---- painted pieces and cameos --------------------------------------------

  /** Throws a painted piece (a plank, an armour plate, a bit of tower) up and out toward the camera. */
  private chunk(art: SpriteArt, x: number, y: number, z: number, size: number, speed: number) {
    if (this.chunks.length > 80) return;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: art.texture, transparent: true }));
    sp.scale.set(size * Math.max(1, art.aspect), size / Math.min(1, art.aspect), 1);
    sp.position.set(x, y, z);
    sp.renderOrder = 7;
    this.scene.add(sp);
    const a = Math.random() * Math.PI * 2;
    const vel = new THREE.Vector3(Math.cos(a) * speed * 0.6, speed * (0.5 + Math.random() * 0.5), Math.abs(Math.sin(a)) * speed * 0.5 + 2);
    this.chunks.push({ sp, vel, spin: (Math.random() - 0.5) * 14, life: 2.5 + Math.random(), landed: false });
  }

  /** A little painted scene: frames that alternate as it moves, then fade. */
  private cameo(frames: SpriteArt[] | THREE.Texture[], x: number, z: number, h: number, dur: number, vel: THREE.Vector3, aspect = 0.78) {
    const tex = frames.map((f) => ('texture' in f ? f.texture : f));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex[0], transparent: true }));
    sp.center.set(0.5, 0);
    sp.scale.set(h * aspect, h, 1);
    sp.position.set(x, this.groundHeight(x, z), z);
    sp.renderOrder = 7;
    this.scene.add(sp);
    this.cameos.push({ sp, frames: tex, t: 0, dur, vel, h });
  }

  private updateChunks(dt: number) {
    this.chunks = this.chunks.filter((c) => {
      c.life -= dt;
      const mat = c.sp.material;
      if (!c.landed) {
        c.vel.y -= 26 * dt;
        c.sp.position.addScaledVector(c.vel, dt);
        mat.rotation += c.spin * dt;
        const floor = this.groundHeight(c.sp.position.x, c.sp.position.z) + c.sp.scale.y * 0.3;
        if (c.sp.position.y < floor && c.vel.y < 0) {
          // A bounce, then it lies there a moment.
          c.sp.position.y = floor;
          if (c.vel.y > -6) c.landed = true;
          c.vel.set(c.vel.x * 0.4, -c.vel.y * 0.3, c.vel.z * 0.4);
          c.spin *= 0.3;
        }
      }
      mat.opacity = Math.min(1, c.life * 2);
      if (c.life > 0) return true;
      this.scene.remove(c.sp);
      mat.dispose();
      return false;
    });
    this.cameos = this.cameos.filter((c) => {
      c.t += dt;
      const mat = c.sp.material;
      c.sp.position.addScaledVector(c.vel, dt);
      c.sp.position.y = this.groundHeight(c.sp.position.x, c.sp.position.z) + Math.abs(Math.sin(c.t * 9)) * 0.15;
      mat.map = c.frames[Math.floor(c.t * 3) % c.frames.length];
      mat.opacity = Math.min(1, (c.dur - c.t) * 2, c.t * 4);
      if (c.t < c.dur) return true;
      this.scene.remove(c.sp);
      mat.dispose();
      return false;
    });
  }

  // ---- planning view --------------------------------------------------------

  /** A defender's drop-in: height above its spot, and the squash (stretch) as it lands. */
  private dropOf(id: number): { y: number; sy: number; sxz: number } {
    const at = this.drops.get(id);
    if (at === undefined) return { y: 0, sy: 1, sxz: 1 };
    const fx = this.game.cfg.setupFx;
    const age = this.time - at;
    if (age < fx.dropSeconds) {
      const u = Math.max(0, age / fx.dropSeconds);
      return { y: fx.dropHeight * (1 - u * u), sy: 1 + 0.12 * u, sxz: 1 - 0.05 * u };
    }
    if (age < fx.dropSeconds + fx.squashSeconds) {
      const k = Math.sin(((age - fx.dropSeconds) / fx.squashSeconds) * Math.PI);
      return { y: 0, sy: 1 - 0.3 * k, sxz: 1 + 0.18 * k };
    }
    this.drops.delete(id);
    return { y: 0, sy: 1, sxz: 1 };
  }

  /** Landing dust (when a dropped unit touches down) and the coverage shapes' pulse. */
  private updateSetupFx(dt: number) {
    const fx = this.game.cfg.setupFx;
    this.landings = this.landings.filter((l) => {
      if (this.time < l.at) return true;
      this.dust(l.x, this.standHeight(l.x, -l.y) + 0.1, -l.y, '#c8b898', '#8c7a58');
      if (fx.shake > 0) this.shake = Math.max(this.shake, fx.shake);
      return false;
    });
    this.pulseAt.t += dt;
    const k = Math.max(0, 1 - this.pulseAt.t / fx.pulseSeconds);
    const s = 1 + (fx.pulseScale - 1) * k * k;
    // Scale about the unit's spot, so the shape settles onto it.
    const px = this.pulseAt.x;
    const pz = -this.pulseAt.y;
    const h = (this.overlay.geometry as THREE.PlaneGeometry).parameters.height;
    const cz = -(OVERLAY_MIN_Y + h / 2);
    this.overlay.scale.set(s, 1, s);
    this.overlay.position.set(px * (1 - s), 0.12, cz * s + pz * (1 - s));
    (this.overlay.material as THREE.MeshBasicMaterial).color.setScalar(1 + 0.8 * k);
    if (this.aimMesh) {
      this.aimMesh.scale.set(s, 1, s);
      this.aimMesh.position.set(px * (1 - s), 0, pz * (1 - s));
      (this.aimMesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * k;
    }
  }

  private updatePlanning() {
    const g = this.game;
    const { show, preview } = this.planning;
    const mat = this.overlay.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, Math.min(1, mat.opacity + (show ? 0.08 : -0.08)));
    this.overlay.visible = mat.opacity > 0;
    if (!show) return;
    // The preview is rounded to the overlay's cells, so moving the mouse within one doesn't repaint.
    const cell = (v: number) => Math.round(v / OVERLAY_CELL);
    const key = `${g.defenders.map((d) => `${d.kind}${d.x},${d.y},${d.heading?.toFixed(2) ?? ''}`).join(';')}|${preview ? `${preview.kind}${cell(preview.x)},${cell(preview.y)}` : ''}|${this.planning.lanes ? g.plan.number : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.drawOverlay();
  }

  /** Paints who covers what: a tint per defender kind, the coming lanes. */
  private drawOverlay() {
    const g = this.game;
    const ctx = this.overlayCtx;
    const { width: cols, height: rows } = ctx.canvas;
    const hw = g.cfg.field.halfWidth;
    const img = ctx.createImageData(cols, rows);
    const data = img.data;
    const defs: Defender[] = [...g.defenders];
    const { preview, lanes } = this.planning;
    if (preview) {
      const { kind, x, y } = preview;
      defs.push({ id: -1, kind, ground: groundAt(g.cfg, x, y, g.stacks), x, y, paid: 0, heading: null, timer: 0, aimX: x, aimY: 30, firedAt: -99 });
    }
    const laneSet = new Set(lanes ? g.plan.groups.map((gr) => gr.lane) : []);
    for (let row = 0; row < rows; row++) {
      const y = g.cfg.field.topY - (row + 0.5) * OVERLAY_CELL;
      for (let col = 0; col < cols; col++) {
        const x = -hw + (col + 0.5) * OVERLAY_CELL;
        // Each source adds its colour with a weight; the cell shows their blend.
        let r = 0;
        let gg = 0;
        let b = 0;
        let w = 0;
        let a = 0;
        const add = (c: [number, number, number], weight: number, alpha: number) => {
          r += c[0] * weight;
          gg += c[1] * weight;
          b += c[2] * weight;
          w += weight;
          a += alpha;
        };
        for (const d of defs) if (g.covers(d, x, y)) add(COVER_COLORS[d.kind], d.id === -1 ? 2 : 1, d.id === -1 ? 0.3 : 0.17);
        const s = g.segmentAt(x);
        // The lanes the next wave marches down, fading toward the wall.
        if (lanes && laneSet.has(s) && y > 30) add([255, 70, 50], 0.5, Math.min(1, (y - 30) / 20) * 0.2);
        if (w <= 0) continue;
        const k = (row * cols + col) * 4;
        data[k] = r / w;
        data[k + 1] = gg / w;
        data[k + 2] = b / w;
        data[k + 3] = Math.min(160, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    this.overlayTex.needsUpdate = true;
  }

  // ---- ground ---------------------------------------------------------------

  private buildGround() {
    const q = QUALITY[this.quality];
    const hw = this.game.cfg.field.halfWidth;
    // The painted ground runs from past the orc camp to behind the town, and well out under the trees.
    const minZ = -(this.game.cfg.field.spawnY + 60);
    const maxZ = 28;
    const worldW = 84;
    this.ground = new GroundCanvas(worldW, maxZ - minZ, minZ, (ctx, w, h) => paintGround(ctx, w, h, { worldW, worldH: maxZ - minZ, minZ, halfWidth: hw, courtyard: this.courtyard }), q.groundWidth);
    this.groundMat.map = this.ground.texture;
    this.groundMat.needsUpdate = true;
    this.terrain = new Terrain(this.ground.worldW, this.ground.worldH, (minZ + maxZ) / 2, q.cell, this.groundMat, -1.5);
    this.scene.add(this.terrain.mesh);
  }

  /** Multiplies a fine tiling grit texture over the map so the ground stays crisp up close. */
  private addDetail(mat: THREE.MeshLambertMaterial) {
    const detail = this.detail;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.detailMap = { value: detail };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb *= mix(vec3(1.0), texture2D(detailMap, vMapUv * vec2(18.0, 38.0)).rgb * 2.0, 0.55);\n#endif',
        );
    };
  }

  /** Ground height under a world point (craters), 0 off the field. */
  private groundHeight(x: number, z: number) {
    return this.terrain.heightAt(x, z);
  }

  /** How high a defender at world (x, z) stands: on a tower, on the wall, or on the ground. */
  standHeight(x: number, z: number): number {
    for (const s of this.game.stacks) if (Math.abs(x - s.x) <= TOWER_HALF && Math.abs(z - TOWER_Z) <= TOWER_HALF) return towerTop(s.storeys);
    if (z >= 0 && z <= this.game.cfg.wall.depth && Math.abs(x) <= this.game.cfg.field.halfWidth) return WALL_H;
    return Math.max(0, this.groundHeight(x, z));
  }

  // ---- castle ---------------------------------------------------------------

  private rebuildCastle() {
    this.scene.remove(this.voxels);
    this.voxels.dispose();
    this.voxelPos = [];
    this.voxelColor = [];
    this.segments = [];
    this.buildCastle();
  }

  /**
   * A grey stone wall of small voxels, one crumbling group per section, with crenellations,
   * a gatehouse in the middle. The wall starts level; the player builds the towers. The stones are laid in courses
   * with darker mortar, a little moss at the foot. On High detail each stone is cut finer (see cutStones).
   */
  private buildCastle() {
    const cfg = this.game.cfg;
    const hw = cfg.field.halfWidth;
    const V = WALL_VOX;
    const n = this.voxelRes;
    const segW = (hw * 2) / cfg.wall.segments;
    const nx = Math.round(segW / V);
    const nz = Math.round(cfg.wall.depth / V);
    const ny = Math.round(WALL_H / V);
    const rise = Math.round(GATE_RISE / V);
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const scales: number[] = [];

    const addGroup = (stones: Stone[]): VoxelGroup => {
      const cells = cutStones(stones, n);
      const start = this.voxelPos.length;
      // Crumble from the top down, with noise so the damage looks ragged.
      const order = cells
        .map((cell, i) => ({ i: start + i, key: -cell.p.y + rnd() * 2.5 }))
        .sort((a, b) => a.key - b.key)
        .map((o) => o.i);
      for (const cell of cells) {
        this.voxelPos.push(cell.p);
        this.voxelColor.push(cell.c);
        scales.push(cell.s);
      }
      return { order, visible: cells.length };
    };
    // The stone at a cell: a darker footing, coursed masonry, moss low on the outer face, flagstones on top.
    // sx, sy, sz pick a small cell of the stone on High detail, so joints come out a single small cell thick.
    const stoneAt = (gx: number, iy: number, iz: number, top: number, salt: number, sx = 0, sy = 0, sz = 0): THREE.Color => {
      if (iy === top - 1 && iz > 0 && iz < nz - 1) {
        const c = new THREE.Color(hash3(Math.floor(gx / 3), Math.floor(iz / 3), salt) < 0.5 ? '#b1afa9' : '#a6a49e');
        return ((gx % 3 === 0 && sx === 0) || (iz % 3 === 0 && sz === 0)) ? c.multiplyScalar(0.85) : c;
      }
      if (iz === 0 && iy < 3 && hash3(gx, iy, 7) < 0.22 - iy * 0.06) return new THREE.Color(hash3(gx, iy, 8) < 0.5 ? '#5f7a3a' : '#6d8a40');
      const c = masonry(gx + (iz === 0 || iz === nz - 1 ? 0 : iz), iy, salt, sx, sy);
      return iy < 3 ? c.multiplyScalar(0.8) : c;
    };

    for (let seg = 0; seg < cfg.wall.segments; seg++) {
      const x0 = -hw + seg * segW;
      const gate = seg === Math.floor(cfg.wall.segments / 2);
      const stones: Stone[] = [];
      for (let ix = 0; ix < nx; ix++) {
        const gx = seg * nx + ix;
        const cx = x0 + (ix + 0.5) * V;
        // The gatehouse: the middle of the gate section stands taller than the wall.
        const house = gate && Math.abs(cx) < GATE_HALF;
        const top = house ? ny + rise : ny;
        for (let iz = 0; iz < nz; iz++) {
          const face = iz === 0 || iz === nz - 1;
          for (let iy = 0; iy < top; iy++) {
            // Arrow slits along the outer face.
            const slit = iz === 0 && iy >= 8 && iy <= 10 && gx % 14 === 7;
            stones.push({
              o: new THREE.Vector3(x0 + ix * V, iy * V, iz * V),
              paint: (sx, sy, sz) => {
                const door = house && face && gateDoor(x0 + (ix + (sx + 0.5) / n) * V, (iy + (sy + 0.5) / n) * V);
                if (door) return new THREE.Color(door);
                // On High detail the outer small cells of the mortar joints and the slits are left out, so they sit back.
                const outer = n > 1 && ((iz === 0 && sz === 0) || (iz === nz - 1 && sz === n - 1));
                if (slit) return outer ? null : new THREE.Color('#2a2622');
                if (outer && iy < top - 1 && mortar(gx, iy, sx, sy)) return null;
                if (n > 1 && iy === top - 1 && sy === n - 1 && !face && ((gx % 3 === 0 && sx === 0) || (iz % 3 === 0 && sz === 0))) return null;
                return stoneAt(gx, iy, iz, top, house ? 5 : 1, sx, sy, sz);
              },
            });
          }
          // Crenellations along the front edge (and both edges of the gatehouse): merlons 3 stones wide, 3 high.
          const edge = iz <= 1 || (house && iz >= nz - 2);
          if (edge && gx % 5 < 3) {
            for (let k = 0; k < 3; k++) {
              stones.push({
                o: new THREE.Vector3(x0 + ix * V, (top + k) * V, iz * V),
                paint: (sx, sy) => {
                  // High detail chamfers the merlon tops' outer corners.
                  if (n > 1 && k === 2 && sy === n - 1 && ((gx % 5 === 0 && sx === 0) || (gx % 5 === 2 && sx === n - 1))) return null;
                  return masonry(gx, top + k, 9, sx, sy).multiplyScalar(k === 2 ? 1.1 : 1);
                },
              });
            }
          }
        }
      }
      this.segments.push(addGroup(stones));
    }

    this.voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(V / n, V / n, V / n), new THREE.MeshLambertMaterial(), this.voxelPos.length);
    this.voxels.frustumCulled = false;
    for (let i = 0; i < this.voxelPos.length; i++) {
      this.voxels.setMatrixAt(i, tmpM.makeScale(scales[i], scales[i], scales[i]).setPosition(this.voxelPos[i]));
      this.voxels.setColorAt(i, this.voxelColor[i]);
    }
    this.scene.add(this.voxels);
  }

  /**
   * One tower's stones, from the ground up to row `th` (in wall voxels), n stones square, centred on x:
   * a hollow shell with a floor at the top, merlons round it, and the royal banner on the front.
   * A darker band marks each storey line above the wall.
   */
  private towerCells(out: Stone[], tx: number, th: number, n: number, salt: number) {
    const V = WALL_VOX;
    const r = this.voxelRes;
    const x0 = tx - TOWER_HALF;
    const z0 = TOWER_Z - TOWER_HALF;
    const storey = Math.round(STOREY_H / V);
    const base = Math.round(WALL_H / V);
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const edge = ix === 0 || iz === 0 || ix === n - 1 || iz === n - 1;
        const o = (iy: number) => new THREE.Vector3(x0 + ix * V, iy * V, z0 + iz * V);
        const alongX = iz === 0 || iz === n - 1;
        const around = alongX ? ix : iz;
        for (let iy = 0; iy < th; iy++) {
          if (!edge && iy < th - 1) continue;
          // A blue-and-gold banner hangs on the front face.
          const banner = iz === 0 && ix >= 3 && ix <= n - 4 && iy >= th - 11 && iy <= th - 3;
          const trim = banner && (iy === th - 11 || ix === 3 || ix === n - 4);
          const crest = banner && !trim && iy >= th - 8 && iy <= th - 6 && Math.abs(ix - (n - 1) / 2) < 1;
          out.push({
            o: o(iy),
            paint: (sx, sy, sz) => {
              const sa = alongX ? sx : sz;
              if (banner) return new THREE.Color(trim || crest ? '#e8b730' : '#2a4fb0');
              if (!edge) return new THREE.Color('#9a968e');
              // High detail sets the mortar back by a small cell on the outside faces.
              const outer = r > 1 && ((ix === 0 && sx === 0) || (ix === n - 1 && sx === r - 1) || (iz === 0 && sz === 0) || (iz === n - 1 && sz === r - 1));
              if (outer && iy < th - 1 && mortar(around, iy, sa, sy)) return null;
              return iy < 3 ? masonry(around + salt * 7, iy, salt, sa, sy).multiplyScalar(0.8)
                : iy >= base && (iy - base) % storey === 0 ? masonry(around, iy, salt, sa, sy).multiplyScalar(0.75)
                : masonry(around + salt * 7, iy, salt + 11, sa, sy).multiplyScalar(1.06);
            },
          });
        }
        if (edge && (ix + iz) % 5 < 3) for (let k = 0; k < 2; k++) out.push({ o: o(th + k), paint: (sx, sy, sz) => masonry(around, th + k, salt, alongX ? sx : sz, sy).multiplyScalar(1.1) });
      }
    }
  }

  /**
   * The towers the player has built, 1-3 storeys, each rising from the ground: the same grey
   * shells, rebuilt whenever one goes up or loses a storey.
   */
  private updateStacks() {
    const stacks = this.game.stacks;
    const key = stacks.map((s) => `${s.x}:${s.storeys}`).join(';');
    if (key === this.stackKey) return;
    this.stackKey = key;
    if (this.stackMesh) {
      this.scene.remove(this.stackMesh);
      this.stackMesh.dispose();
      this.stackMesh = null;
    }
    const V = WALL_VOX;
    const stones: Stone[] = [];
    const n = Math.round((TOWER_HALF * 2) / V);
    stacks.forEach((st, i) => this.towerCells(stones, st.x, Math.round(towerTop(st.storeys) / V), n, 40 + i));
    if (!stones.length) return;
    const cells = cutStones(stones, this.voxelRes);
    const f = V / this.voxelRes;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(f, f, f), new THREE.MeshLambertMaterial(), cells.length);
    cells.forEach((c, i) => {
      mesh.setMatrixAt(i, tmpM.makeScale(c.s, c.s, c.s).setPosition(c.p));
      mesh.setColorAt(i, c.c);
    });
    this.stackMesh = mesh;
    this.scene.add(mesh);
  }

  private crumble(group: VoxelGroup, fraction: number, quiet = false) {
    const target = Math.ceil(group.order.length * Math.max(0, Math.min(1, fraction)));
    if (target >= group.visible) return;
    // Voxels already gone are the first `removed` entries of the crumble order; hide the next ones.
    const removed = group.order.length - group.visible;
    const toRemove = group.visible - target;
    for (let n = 0; n < toRemove; n++) {
      const idx = group.order[removed + n];
      this.voxels.setMatrixAt(idx, hidden);
      if (n < 20 && !quiet) {
        const p = this.voxelPos[idx];
        this.burst(p.x, p.y, p.z, 1, '#' + this.voxelColor[idx].getHexString(), 6);
      }
    }
    group.visible = target;
    this.voxels.instanceMatrix.needsUpdate = true;
  }

  private updateCastle(dt: number) {
    const g = this.game;
    this.updateStacks();
    const segW = g.segmentWidth();
    g.segmentHp.forEach((hp, i) => {
      const frac = hp / g.cfg.wall.segmentHp;
      this.crumble(this.segments[i], frac);
      // A hurt section smokes; a nearly broken one burns, with embers going up.
      if (frac >= 0.5 || g.phase === 'setup') return;
      const x = -g.cfg.field.halfWidth + (Math.random() * 0.8 + 0.1) * segW + i * segW;
      const burning = frac < g.cfg.wall.warnBelow;
      if (Math.random() < dt * (burning ? 7 : 2)) this.puff(x, 2.2, 0.8, burning ? 3 : 2, burning ? '#3a3430' : '#8a8278', burning ? 2.2 : 1.6);
      if (burning && Math.random() < dt * 14) {
        this.fireworks.burst(x, 2.2, 0.6, { count: 3, colors: FIRE, speed: 2, life: 0.8, size: 0.55, up: 1, gravity: -4, drag: 1 });
      }
    });
  }

  /** A puff of smoke or dust that rises, swells and fades. */
  private puff(x: number, y: number, z: number, size: number, color: string, life: number) {
    let p = this.smoke.find((s) => s.life <= 0);
    if (!p) {
      if (this.smoke.length >= MAX_SMOKE) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false }));
      sprite.renderOrder = 9;
      this.scene.add(sprite);
      p = { sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 1 };
      this.smoke.push(p);
    }
    p.sprite.visible = true;
    p.sprite.position.set(x, y, z);
    p.sprite.material.color.set(color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.vel.set((Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5);
    p.life = p.max = life * (0.8 + Math.random() * 0.4);
    p.size = size;
  }

  private updateSmoke(dt: number) {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const u = 1 - p.life / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.sprite.scale.setScalar(p.size * (0.5 + u));
      p.sprite.material.opacity = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    }
  }

  // ---- defenders -------------------------------------------------------------

  /** A placed defender's model. Archer squads are drawn with the instanced archer figures instead. */
  private buildDefender(kind: PlacedKind): THREE.Group | null {
    return kind === 'archers' ? null : this.buildFigure(kind, false);
  }

  /** Where a defender's model stands. Crossbow towers rise out of whatever they stand on. */
  private defenderBase(d: Defender): THREE.Vector3 {
    const h = this.standHeight(d.x, -d.y);
    return tmpV.set(d.x, h, -d.y);
  }

  private updateDefenders() {
    const g = this.game;
    const seen = new Set<number>();
    let archers = 0;
    for (const d of g.defenders) {
      seen.add(d.id);
      let entry = this.defenderObjs.get(d.id);
      if (!entry) {
        entry = { kind: d.kind, obj: this.buildDefender(d.kind) };
        if (entry.obj) this.scene.add(entry.obj);
        this.defenderObjs.set(d.id, entry);
      }
      const since = g.time - d.firedAt;
      if (entry.obj) {
        entry.obj.position.copy(this.defenderBase(d));
        const drop = this.dropOf(d.id);
        entry.obj.position.y += drop.y;
        // The ballista swings round to where it is aimed (straight up its lane if it isn't).
        for (const child of entry.obj.children) if (child.name === 'model') child.rotation.y = -(d.heading ?? 0);
        // Recoil when it fires: a quick squash that springs back.
        const kick = since >= 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) : 0;
        entry.obj.scale.set((1 + kick * 0.08) * drop.sxz, (1 - kick * 0.1) * drop.sy, drop.sxz);
        continue;
      }
      // Archers: the whole squad in ranks, each standing on whatever is under them, all drawing together.
      const n = g.cfg.archers.archers;
      const rows = Math.ceil(n / SQUAD_COLS);
      for (let i = 0; i < n && archers < MAX_ARCHERS; i++) {
        const col = i % SQUAD_COLS;
        const row = Math.floor(i / SQUAD_COLS);
        const x = d.x + (col - (SQUAD_COLS - 1) / 2) * SQUAD_SPACING + (row % 2) * 0.2;
        const z = -d.y + (row - (rows - 1) / 2) * SQUAD_SPACING * 0.8;
        const draw = since >= 0 && since < 0.5 ? Math.sin((since / 0.5) * Math.PI) : 0;
        const drop = this.dropOf(d.id);
        tmpV.set(x, this.standHeight(x, z) + draw * 0.15 + drop.y, z);
        tmpQ.setFromAxisAngle(UP, -(d.heading ?? 0));
        this.archerSprites.setMatrixAt(archers, tmpM.compose(tmpV, tmpQ, tmpS.set(drop.sxz, (1 + draw * 0.06) * drop.sy, drop.sxz)));
        archers++;
      }
    }
    this.archerSprites.count = archers;
    this.archerSprites.instanceMatrix.needsUpdate = true;
    for (const [id, entry] of this.defenderObjs) {
      if (seen.has(id)) continue;
      if (entry.obj) this.scene.remove(entry.obj);
      this.defenderObjs.delete(id);
    }
  }

  private updateSoldiers(time: number) {
    let n = 0;
    for (const s of this.game.soldiers) {
      if (s.hp <= 0 || n >= this.soldierSprites.instanceMatrix.count) continue;
      // Marching in place, with a little jab when they're stuck in.
      const jab = Math.abs(Math.sin(time * 7 + s.postX)) * 0.08;
      tmpV.set(s.x, this.groundHeight(s.x, -s.y) + jab, -s.y);
      tmpQ.setFromAxisAngle(FORWARD, Math.sin(time * 3 + s.postX) * 0.04);
      this.soldierSprites.setMatrixAt(n, tmpM.compose(tmpV, tmpQ, tmpS.set(1, 1, 1)));
      const hurt = s.hp < s.maxHp * 0.5 ? 0.7 : 1;
      this.soldierSprites.setColorAt(n, tmpC.setRGB(1, hurt, hurt));
      n++;
    }
    this.soldierSprites.count = n;
    this.soldierSprites.instanceMatrix.needsUpdate = true;
    if (this.soldierSprites.instanceColor) this.soldierSprites.instanceColor.needsUpdate = true;
  }

  // ---- units ---------------------------------------------------------------

  /**
   * The next wave standing in its blocks past the spawn line, lane by lane, so the player
   * can look up the field and see what is coming. Later blocks in a lane stand further back.
   */
  private musterHorde(): Enemy[] {
    const g = this.game;
    const waiting = g.phase === 'setup' || g.phase === 'preview';
    if (!waiting) return [];
    if (this.hordeFor === g.plan.number) return this.horde;
    this.hordeFor = g.plan.number;
    const depth: Record<number, number> = {};
    const far = g.cfg.field.spawnY + 13;
    this.horde = [];
    for (const grp of g.plan.groups) {
      const kinds: EnemyKind[] = [];
      for (const m of grp.members) for (let i = 0; i < m.count; i++) kinds.push(m.kind);
      const spacing = 0.45 * 2 * g.cfg.march.spacing;
      const slots = formation(grp.shape, kinds.length, spacing);
      const back = depth[grp.lane] ?? 0;
      let deepest = 0;
      kinds.forEach((kind, i) => {
        const s = slots[i] ?? { dx: 0, dy: 0 };
        const y = Math.min(far, g.cfg.field.spawnY + 1 + back + (kind === 'orcCatapult' ? deepest + 2.5 : s.dy));
        if (kind !== 'orcCatapult') deepest = Math.max(deepest, s.dy);
        const x = Math.max(-g.cfg.field.halfWidth + 0.5, Math.min(g.cfg.field.halfWidth - 0.5, grp.x + (kind === 'orcCatapult' ? (i % 3 - 1) * 3 : s.dx)));
        this.horde.push({
          kind, x, y, vx: 0, vy: 0, hp: 1, maxHp: 1, state: 'stand', standY: y, timer: 0, phase: (i * 0.618) % 1,
          burn: 0, burnTime: 0, rally: 1, foe: null, block: null, slotX: 0, slotY: 0, goldMult: 1, lastBall: -1, stagger: 0, blasted: false, pinned: 0, shielded: kind === 'shieldOrc', bowl: null,
        });
      });
      depth[grp.lane] = back + deepest + 4;
    }
    return this.horde;
  }

  private updateEnemies(time: number) {
    const camQ = this.camera.quaternion;
    const counts = Object.fromEntries(ENEMY_KINDS.map((k) => [k, 0])) as Record<EnemyKind, number>;
    let shadowN = 0;
    let barrels = 0;
    const horde = this.musterHorde();
    const voxel = this.orcStyle === 'voxel';
    const sets = voxel ? this.voxelOrcs.meshes : this.sprites;
    const lordCounts = this.warlordSprites.map(() => 0);
    const alive = horde.length ? [...this.game.enemies, ...horde] : this.game.enemies;
    for (const k of this.firstSeen.keys()) if (!alive.includes(k)) this.firstSeen.delete(k);
    for (const e of alive) {
      let born = this.firstSeen.get(e);
      if (born === undefined) this.firstSeen.set(e, (born = time));
      const t = Math.min(1, (time - born) / PHASE_IN);
      const phase = t >= 1 ? 1 : Math.max(0.05, 1 - (1 - t) * (1 - t));
      // The warlord is always his painted art, which loses armour as he loses health.
      const lord = e.kind === 'warlord';
      const stage = lord ? this.warlordStage(e) : 0;
      // A shield orc whose shield is down is drawn as a plain grunt-model orc.
      const mk: EnemyKind = e.kind === 'shieldOrc' && !e.shielded ? 'grunt' : e.kind;
      const mesh = lord ? this.warlordSprites[stage] : sets[mk];
      const i = lord ? lordCounts[stage]++ : counts[mk]++;
      if (i >= mesh.instanceMatrix.count) continue;
      const size = SIZE[e.kind];
      const moving = e.state === 'march';
      // Walk cycle in code: a hop on each step, a side-to-side waddle and a squash on landing.
      // Heavier units step slower; riders gallop with less sway; catapults just trundle.
      const pace = e.kind === 'rider' || e.kind === 'runner' ? 14 : e.kind === 'orcCatapult' ? 5 : 9 / Math.sqrt(size);
      const step = time * pace + e.phase * 20;
      const hop = moving ? Math.abs(Math.sin(step)) : 0;
      // Orc Bowling: a bowled orc hops through the air and spins end over end until it stops (code placeholder for fx-orc-bowling.png).
      const bp = e.bowl ? 1 - e.bowl.t / e.bowl.dur : 0;
      const bowlHop = e.bowl ? Math.sin(bp * Math.PI) * 1.1 * size : 0;
      const bob = hop * 0.18 * size * (e.kind === 'orcCatapult' ? 0.3 : 1) + bowlHop;
      const sway = e.kind === 'rider' ? 0.04 : e.kind === 'orcCatapult' ? 0.02 : 0.12;
      const roll = e.bowl ? bp * Math.PI * 4 : moving ? Math.sin(step) * sway : 0;
      const squash = moving ? 1 - (1 - hop) * 0.08 : 1;
      // Small orcs at the wall scramble up the stones, then hack away at the top; big ones pound it from below.
      const c = this.game.cfg[e.kind];
      const climbs = CLIMBERS.has(e.kind);
      const climb =
        climbs && e.state === 'climb' ? (1 - e.timer / c.climbSeconds) * WALL_H + Math.sin(time * 12 + e.phase * 9) * 0.1
        : climbs && e.state === 'wall' ? WALL_H + Math.abs(Math.sin(time * 6 + e.phase * 9)) * 0.25
        : 0;
      const pound = !climbs && (e.state === 'wall' || e.state === 'fight') ? Math.abs(Math.sin(time * 5 + e.phase * 9)) * 0.3 : 0;
      const brawl = e.state === 'fight' ? Math.abs(Math.sin(time * 10 + e.phase * 9)) * 0.15 : 0;
      const hurt = e.hp < e.maxHp ? 0.75 : 1;
      const burning = e.burnTime > 0;
      const ground = this.groundHeight(e.x, -e.y);
      tmpV.set(e.x, ground + bob + climb + pound + brawl, -e.y);
      if (voxel && !lord) {
        // Models face the wall, turning a little as they waddle (and toward the side they're knocked).
        const yaw = Math.sin(step * 0.5) * 0.12 + Math.max(-0.6, Math.min(0.6, e.vx * 0.05));
        tmpQ.setFromAxisAngle(UP, yaw).multiply(tmpQ2.setFromAxisAngle(FORWARD, roll * 0.7));
        tmpS.set(1.5 - squash * 0.5, squash, 1.5 - squash * 0.5);
      } else {
        tmpS.set(2 - squash, squash, 1);
        tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, roll));
      }
      tmpS.multiplyScalar(phase);
      mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
      // Orcs attacking the wall pulse red, with now and then a puff of dust and sparks at the stones.
      const atWall = e.state === 'wall';
      const rage = atWall ? 0.55 + 0.25 * Math.sin(time * 8 + e.phase * 9) : 1;
      mesh.setColorAt(i, burning ? tmpC.setRGB(1, 0.6, 0.3) : e.stagger > 0 ? tmpC.setRGB(0.7, 0.7, 1) : tmpC.setRGB(1, hurt * rage, hurt * rage));
      if (atWall && Math.random() < 0.05) this.fireworks.burst(e.x, tmpV.y + 1.2, -e.y - 0.6, { count: 3, colors: ['#ff7a3a', '#c9b79a'], speed: 3, life: 0.35, size: 0.3, gravity: 6 });
      if (e.kind === 'barrel' && voxel) {
        if (Math.random() < 0.35) this.fireworks.burst(e.x, tmpV.y + 1.8, -e.y - 0.55, { count: 1, colors: FIRE, speed: 1.5, life: 0.3, size: 0.25, gravity: -2 });
      } else if (e.kind === 'barrel' && barrels < MAX_BARRELS) {
        // The barrel rides on its back, toward the camera so it shows, with a fizzing fuse.
        const bx = e.x + 0.25;
        const by = tmpV.y + 0.75;
        const bz = -e.y + 0.35;
        tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, 0.3 + roll));
        this.barrels.setMatrixAt(barrels++, tmpM.compose(tmpD.set(bx, by, bz), tmpQ, tmpS.set(1, 1, 1)));
        if (Math.random() < 0.35) this.fireworks.burst(bx + 0.1, by + 0.35, bz, { count: 1, colors: FIRE, speed: 1.5, life: 0.3, size: 0.25, gravity: -2 });
      }
      if (shadowN < MAX_ENEMIES) {
        tmpS.set(size, 1, size);
        this.shadows.setMatrixAt(shadowN++, tmpM.compose(tmpV.set(e.x, ground, -e.y + 0.1), tmpQ.identity(), tmpS));
      }
    }
    // Orcs a heave sent flying, tumbling end over end.
    for (const f of this.flung) {
      const mesh = sets[f.kind];
      const i = counts[f.kind]++;
      if (i >= mesh.instanceMatrix.count) continue;
      // A model tumbles freely; a sprite keeps facing the camera and spins in its plane.
      if (voxel) tmpQ.setFromEuler(f.rot);
      else tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, f.rot.x));
      mesh.setMatrixAt(i, tmpM.compose(f.pos, tmpQ, tmpS.setScalar(1)));
      mesh.setColorAt(i, tmpC.setRGB(1, 0.85, 0.85));
    }
    for (const kind of ENEMY_KINDS) {
      const mesh = sets[kind];
      mesh.count = Math.min(counts[kind], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      (voxel ? this.sprites : this.voxelOrcs.meshes)[kind].count = 0;
    }
    this.voxelOrcs.sync();
    this.warlordSprites.forEach((mesh, s) => {
      mesh.count = Math.min(lordCounts[s], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.barrels.count = barrels;
    this.barrels.instanceMatrix.needsUpdate = true;
  }

  /** Which armour stage a warlord is in; plates fly off as he passes each one. */
  private warlordStage(e: Enemy): number {
    const frac = e.hp / e.maxHp;
    const stage = Math.min(this.warlordSprites.length - 1, WARLORD_STAGE_AT.filter((at) => frac <= at).length);
    const was = this.lordStage.get(e) ?? 0;
    if (stage > was) {
      for (let i = 0; i < 4 * (stage - was); i++) {
        const plate = this.chunkArt.plates[(Math.random() * this.chunkArt.plates.length) | 0];
        this.chunk(plate, e.x + (Math.random() - 0.5) * 2, 3 + Math.random() * 2, -e.y + 0.5, 1 + Math.random() * 0.5, 12);
      }
      this.fireworks.burst(e.x, 3, -e.y, { count: 40, colors: STEEL, speed: 10, life: 0.5, size: 0.4, up: 0.6, gravity: 12 });
      this.shake = Math.max(this.shake, 0.4);
    }
    this.lordStage.set(e, stage);
    return stage;
  }

  private updateProjectiles() {
    const counts = { rock: 0, boulder: 0, stone: 0 };
    let b = 0;
    let eb = 0;
    let a = 0;
    for (const p of this.game.projectiles) {
      if (p.kind === 'rock' || p.kind === 'boulder' || p.kind === 'stone') {
        const mesh = this.thrown[p.kind];
        const i = counts[p.kind];
        if (i >= mesh.instanceMatrix.count) continue;
        counts[p.kind]++;
        // Thrown things fly in an arc and tumble; deflected ones skim back low, fast and glowing.
        const t = Math.min(1, p.travelled / p.flight);
        const arc = p.kind === 'stone' ? 0.25 : 0.12;
        const h = p.friendly && p.kind !== 'stone' ? 1.2 : 1.2 + 4 * (p.flight * arc) * t * (1 - t);
        tmpQ.setFromEuler(tmpE.set(p.travelled * 0.45 + p.x, p.travelled * 0.3, p.travelled * 0.2));
        mesh.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
        mesh.setColorAt(i, p.friendly && p.kind !== 'stone' ? tmpC.setRGB(1, 0.9, 0.55) : tmpC.setRGB(1, 1, 1));
      } else if (p.kind === 'arrow') {
        if (a >= this.arrows.instanceMatrix.count) continue;
        // Volley arrows go up high and come down steeply; each points along its flight.
        const t = Math.min(1, p.travelled / p.flight);
        const apex = 0.3 * p.flight + 3;
        const h = WALL_H + apex * 4 * t * (1 - t) - 2.4 * t;
        const slope = (apex * 4 * (1 - 2 * t) - 2.4) / Math.max(1, p.flight);
        const sp = Math.hypot(p.vx, p.vy) || 1;
        tmpD.set(p.vx / sp, slope, -p.vy / sp).normalize();
        tmpQ.setFromUnitVectors(AHEAD, tmpD);
        this.arrows.setMatrixAt(a++, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
      } else {
        const orc = p.kind === 'enemyBolt';
        const mesh = orc ? this.enemyBolts : this.bolts;
        if ((orc ? eb : b) >= mesh.instanceMatrix.count) continue;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        tmpQ.setFromUnitVectors(AHEAD, tmpD.set(p.vx / sp, 0, -p.vy / sp));
        mesh.setMatrixAt(orc ? eb++ : b++, tmpM.compose(tmpV.set(p.x, 1.8, -p.y), tmpQ, p.big ? tmpS.set(2.2, 2.2, 2.2) : tmpS.set(1, 1, 1)));
        // Orc bolts streak red, so they read as a threat at a glance.
        if (p.kind === 'enemyBolt') this.fireworks.burst(p.x, 1.8, -p.y, { count: 2, colors: ['#ff5a3c', '#ffb43a'], speed: 0.4, life: 0.22, size: 0.4, gravity: 0, drag: 6 });
      }
    }
    for (const kind of ['rock', 'boulder', 'stone'] as const) {
      const mesh = this.thrown[kind];
      mesh.count = Math.min(counts[kind], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.bolts.count = b;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.enemyBolts.count = eb;
    this.enemyBolts.instanceMatrix.needsUpdate = true;
    this.arrows.count = a;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  // ---- effects -------------------------------------------------------------

  /** A killed voxel orc bursts into chunks of itself, in its own colours, that bounce and fade. */
  private breakOrc(kind: EnemyKind, x: number, z: number) {
    const all = this.voxelOrcs.pieces[kind];
    const cap = QUALITY[this.quality].debris;
    const n = Math.min(all.length, kind === 'ogre' || kind === 'orcCatapult' ? 36 : 14);
    const size = (2 * this.voxelOrcs.voxelSize[kind]) / (VOXEL * 0.8);
    const ground = this.groundHeight(x, z);
    const mid = all.reduce((h, p) => Math.max(h, p.y), 0) / 2;
    for (let i = 0; i < n && this.debris.length < cap; i++) {
      const p = all[(Math.random() * all.length) | 0];
      const out = new THREE.Vector3(p.x, p.y - mid, p.z).normalize().multiplyScalar(3 + Math.random() * 3);
      this.debris.push({
        pos: new THREE.Vector3(x + p.x, ground + p.y, z + p.z),
        vel: out.add(tmpD.set(0, 4 + Math.random() * 3, 1.5)),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        rot: new THREE.Euler(),
        life: 0.9 + Math.random() * 0.6,
        color: p.color.clone(),
        size,
      });
    }
  }

  private burst(x: number, y: number, z: number, n: number, color: string, speed: number) {
    const cap = QUALITY[this.quality].debris;
    for (let i = 0; i < n && this.debris.length < cap; i++) {
      this.debris.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        rot: new THREE.Euler(),
        life: 1.2 + Math.random() * 0.8,
        color: new THREE.Color(color),
      });
    }
  }

  /** A rock bursting into voxel chunks: a few big cubes in rock colours. */
  private rockBurst(x: number, y: number, z: number, n: number, speed: number) {
    const cap = QUALITY[this.quality].debris;
    for (let i = 0; i < n && this.debris.length < cap; i++) {
      this.debris.push({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.8, y, z),
        vel: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9, (Math.random() - 0.3) * speed),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        rot: new THREE.Euler(),
        life: 1.2 + Math.random() * 0.8,
        color: new THREE.Color(ROCK_DEBRIS[i % ROCK_DEBRIS.length]),
        size: 1 + Math.random() * 0.9,
      });
    }
  }

  /** Hot sparks that fly off the shield when something hits it. */
  private sparks(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n && this.debris.length < MAX_DEBRIS; i++) {
      this.debris.push({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 1.5, y + Math.random(), z),
        vel: new THREE.Vector3((Math.random() - 0.5) * 16, 4 + Math.random() * 8, -4 - Math.random() * 8),
        spin: new THREE.Vector3(20, 20, 20),
        rot: new THREE.Euler(),
        life: 0.25 + Math.random() * 0.3,
        color: new THREE.Color(Math.random() < 0.5 ? '#fff2a8' : '#ffb43a'),
      });
    }
  }

  /** Sparks scraped off the shield's rim as it moves (dir: which way it moves), thrown back the other way. */
  private scrapeSparks(x: number, y: number, z: number, dir: number, n: number) {
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    for (let i = 0; i < count && this.debris.length < MAX_DEBRIS; i++) {
      this.debris.push({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.6),
        vel: new THREE.Vector3(-dir * (5 + Math.random() * 10), 3 + Math.random() * 6, (Math.random() - 0.3) * 4),
        spin: new THREE.Vector3(20, 20, 20),
        rot: new THREE.Euler(),
        life: 0.2 + Math.random() * 0.25,
        color: new THREE.Color(Math.random() < 0.3 ? '#ffffff' : Math.random() < 0.6 ? '#fff2a8' : '#ffb43a'),
      });
    }
  }

  private updateFlung(dt: number) {
    this.flung = this.flung.filter((f) => {
      f.life -= dt;
      f.vel.y -= 26 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.rot.x += f.spin.x * dt;
      f.rot.y += f.spin.y * dt;
      f.rot.z += f.spin.z * dt;
      if (f.pos.y > 0 || f.vel.y > 0) return f.life > 0;
      // Down with a thump: a puff of dust and a scatter of bits.
      this.puff(f.pos.x, 0.5, f.pos.z, 1.6, '#c8b898', 0.9);
      this.burst(f.pos.x, 0.5, f.pos.z, 3, KILL_COLOR[f.kind], 5);
      return false;
    });
  }

  private updateDebris(dt: number) {
    const alive: Debris[] = [];
    for (const d of this.debris) {
      d.life -= dt;
      if (d.life <= 0) continue;
      d.vel.y -= 22 * dt;
      d.pos.addScaledVector(d.vel, dt);
      const floor = this.groundHeight(d.pos.x, d.pos.z) + 0.15;
      if (d.pos.y < floor) {
        d.pos.y = floor;
        d.vel.multiplyScalar(0.4);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      alive.push(d);
    }
    this.debris = alive;
    alive.forEach((d, i) => {
      const sc = Math.min(1, d.life * 2) * (d.spin.x === 20 ? 0.35 : 1) * (d.size ?? 1);
      this.debrisMesh.setMatrixAt(i, tmpM.compose(d.pos, tmpQ.setFromEuler(d.rot), tmpS.set(sc, sc, sc)));
      this.debrisMesh.setColorAt(i, d.color);
    });
    this.debrisMesh.count = alive.length;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  private spawnEffect(kind: Effect['kind'], x: number, z: number, duration: number, size = 3) {
    let obj: THREE.Object3D;
    if (kind === 'ring') {
      obj = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#fff1c7', transparent: true, depthWrite: false }),
      );
    } else if (kind === 'explosion' || kind === 'impact' || kind === 'fireball' || kind === 'barrelBlast') {
      const art = this.fxArt[kind];
      obj = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * art.aspect, 2),
        new THREE.MeshBasicMaterial({ map: art.texture, transparent: true, depthWrite: false }),
      );
      obj.quaternion.copy(this.camera.quaternion);
    } else {
      obj = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 8),
        new THREE.MeshBasicMaterial({ color: kind === 'parry' ? '#ffd76a' : '#d8f4ff', transparent: true, depthWrite: false }),
      );
    }
    obj.position.set(x, kind === 'explosion' || kind === 'fireball' || kind === 'barrelBlast' ? size * 0.6 : kind === 'impact' ? 1.2 : 0.1, z);
    this.scene.add(obj);
    this.effects.push({ kind, x, z, t: 0, duration, obj, size });
  }

  private updateEffects(dt: number) {
    this.effects = this.effects.filter((fx) => {
      fx.t += dt;
      const u = Math.min(1, fx.t / fx.duration);
      const mesh = fx.obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (fx.kind === 'ring') {
        const r = 0.5 + u * fx.size * 1.1;
        fx.obj.scale.set(r, 1, r);
        mat.opacity = 1 - u;
      } else if (fx.kind === 'explosion' || fx.kind === 'impact' || fx.kind === 'fireball' || fx.kind === 'barrelBlast') {
        // Pop up to full size fast, then fade.
        fx.obj.scale.setScalar(fx.size * Math.min(1, 0.4 + u * 2.5));
        mat.opacity = u < 0.5 ? 1 : 1 - (u - 0.5) * 2;
      } else {
        fx.obj.position.y = 1.2;
        fx.obj.scale.setScalar(0.5 + u * (fx.kind === 'parry' ? 3 : 1.5));
        mat.opacity = 1 - u;
      }
      if (u >= 1) {
        this.scene.remove(fx.obj);
        mesh.geometry.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

}
