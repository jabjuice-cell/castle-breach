import * as THREE from 'three';
import type { Defender, PlacedKind } from '../sim/defenders';
import { type Ball, type Capsule, type CapsuleKind, type Game, type GameEvent } from '../sim/game';
import { ENEMY_KINDS, type EnemyKind } from '../sim/waves';
import aspects from '../assets/aspects.json';
import keepUrl from '../assets/castle/keep.webp';
import tavernUrl from '../assets/castle/tavern.webp';
import towerUrl from '../assets/castle/tower-crossbow.webp';
import arrowUrl from '../assets/fx/arrow.webp';
import boulderUrl from '../assets/fx/boulder.webp';
import explosionUrl from '../assets/fx/explosion.webp';
import impactUrl from '../assets/fx/impact.webp';
import fireballUrl from '../assets/fx/fireball.webp';
import rockUrl from '../assets/fx/rock.webp';
import royalShieldUrl from '../assets/fx/royal-shield.webp';
import stoneUrl from '../assets/fx/stone.webp';
import craterUrl from '../assets/maps/crater.webp';
import forestUrl from '../assets/maps/forest.jpg';
import scorchUrl from '../assets/maps/scorch.webp';
import archerUrl from '../assets/sprites/defender-archer.webp';
import defCatapultUrl from '../assets/sprites/defender-catapult.webp';
import soldierUrl from '../assets/sprites/defender-soldier.webp';
import catapultUrl from '../assets/sprites/enemy-catapult.webp';
import chuckerUrl from '../assets/sprites/enemy-chucker.webp';
import gruntUrl from '../assets/sprites/enemy-grunt.webp';
import ogreUrl from '../assets/sprites/enemy-ogre.webp';
import riderUrl from '../assets/sprites/enemy-rider.webp';
import warlordUrl from '../assets/sprites/enemy-warlord.webp';
import { type BurstOptions, Fireworks } from './fireworks';
import { Terrain } from './terrain';
import {
  GroundCanvas, type SpriteArt, blobTexture, capsuleTexture, detailTexture, glowTexture, handTexture, imageSprite, loadImage, setAnisotropy,
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
 * cap, how often ground marks upload, and how many firework particles each burst throws.
 */
const QUALITY: Record<Quality, { pixelRatio: number; groundWidth: number; cell: number; debris: number; upload: number; fx: number }> = {
  low: { pixelRatio: 1, groundWidth: 1024, cell: 1, debris: 400, upload: 0.5, fx: 0.35 },
  medium: { pixelRatio: 2, groundWidth: 1536, cell: 0.6, debris: 900, upload: 0.25, fx: 0.7 },
  high: { pixelRatio: 3, groundWidth: 2048, cell: 0.4, debris: 1500, upload: 0.15, fx: 1 },
};

const VOXEL = 0.5;
const MAX_ENEMIES = 4000;
const MAX_PROJECTILES = 2500;
const MAX_DEBRIS = 1500;
const MAX_ARCHERS = 20 * 30;
const MAX_BALLS = 64;
const MAX_BARRELS = 300;

/** Firework palettes. */
const GOLD = ['#fff6c8', '#ffd34a', '#ffb43a'];
const STEEL = ['#ffffff', '#d8f4ff', '#9cc8ff'];
const FIRE = ['#fff2a8', '#ffb43a', '#ff6a2a', '#e2331f'];
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
  tea: { color: '#3ab8b0', emoji: '☕', name: "Queen's tea: slow time" },
  trick: { color: '#e2533f', emoji: '💀', name: 'Orc trick! Shield shrinks' },
};

/** The siege tower's look: storey height and colours. Placeholder voxels until boss-siege-tower art arrives. */
const FLOOR_H = 1.8;
const PLANK_COLORS = ['#3a2a1a', '#6e4a25', '#a8783f'];

/** The planning overlay: one cell per half unit over the field in front of the wall. */
const OVERLAY_CELL = 0.5;
const OVERLAY_MIN_Y = -2;
const COVER_COLORS: Record<PlacedKind, [number, number, number]> = {
  crossbow: [255, 120, 60], archers: [110, 255, 90], catapult: [190, 130, 255], soldiers: [80, 170, 255],
};

/** The shield art's body fills about this share of the image width. */
const SHIELD_ART_FILL = 0.86;
/** The shield leans back so its face points up at the incoming boulders (radians from flat). */
const SHIELD_TILT = 0.37;
const SHIELD_H = 1.2;

/** Sprite height relative to the orc grunt (and defenders), from the art guide. */
const SIZE: Record<EnemyKind, number> = { grunt: 1, chucker: 1, barrel: 1, rider: 1.4, orcCatapult: 2, ogre: 2.5, warlord: 3 };
const KILL_COLOR: Record<EnemyKind, string> = {
  grunt: '#6f9a3c', chucker: '#8a9a42', barrel: '#8a5a2e', rider: '#6d4a32', orcCatapult: '#7a5530', ogre: '#8d9a6a', warlord: '#5d8a34',
};
/** Kinds that climb the wall before hacking at it (the rest smash it from the ground). */
const CLIMBERS = new Set<EnemyKind>(['grunt', 'chucker', 'barrel', 'rider']);

/** The castle's shape. Towers stand on the wall joints; defenders on them stand higher. */
const WALL_H = 3;
const TOWER_H = 4.5;
const TOWER_HALF = 1.5;
const TOWER_Z = 1;
/** How a squad of archers stands: columns x rows around its spot. */
const SQUAD_COLS = 6;
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
  spot: number;
}

interface Effect {
  kind: 'hand' | 'ring' | 'flash' | 'parry' | 'explosion' | 'impact' | 'fireball';
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
const AHEAD = new THREE.Vector3(0, 0, -1);
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private quality: Quality;
  private ground!: GroundCanvas;
  private terrain!: Terrain;
  private groundMat: THREE.MeshLambertMaterial;
  private detail = detailTexture();

  private voxels!: THREE.InstancedMesh;
  private voxelPos: THREE.Vector3[] = [];
  private voxelColor: THREE.Color[] = [];
  private segments: VoxelGroup[] = [];
  private towerX: number[] = [];

  private sprites = {} as Record<EnemyKind, THREE.InstancedMesh>;
  private soldierSprites: THREE.InstancedMesh;
  private archerSprites: THREE.InstancedMesh;
  private shadows: THREE.InstancedMesh;
  /** Thrown things, as camera-facing sprites. */
  private thrown: Record<'rock' | 'boulder' | 'stone', THREE.InstancedMesh>;
  /** Bolts and arrows, as flat sprites lying along their flight. */
  private bolts: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private fxArt = {
    explosion: imageSprite(explosionUrl, aspects.explosion),
    impact: imageSprite(impactUrl, aspects.impact),
    fireball: imageSprite(fireballUrl, aspects.fireball),
  };
  private towerArt = imageSprite(towerUrl, aspects['tower-crossbow']);
  private catapultArt = imageSprite(defCatapultUrl, aspects['defender-catapult']);
  private crater = loadImage(craterUrl);
  private scorch = loadImage(scorchUrl);
  private lastWave = -1;
  private debrisMesh: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private effects: Effect[] = [];
  private handTex = handTexture();

  private shieldMesh: THREE.Mesh;
  private shieldShadow: THREE.Mesh;
  private shieldJolt = 0;
  /** Time since the last heave, for the shove animation. */
  private heaveT = 9;
  private balls: THREE.InstancedMesh;
  private halos: THREE.InstancedMesh;
  private barrels: THREE.InstancedMesh;
  private capsuleTex = {} as Record<CapsuleKind, THREE.Texture>;
  private capsuleSprites = new Map<Capsule, THREE.Sprite>();
  private bumperMeshes: THREE.Mesh[] = [];
  private bumperRings: THREE.Mesh[] = [];
  private towerMesh: THREE.InstancedMesh;
  private towerTop: THREE.Mesh;
  private towerFloors = 0;
  /** The tower drops a storey when its bottom floor gives way; this eases the drop. */
  private towerDrop = 0;
  private spotRings: THREE.Mesh[] = [];
  private overlay: THREE.Mesh;
  private overlayCtx: CanvasRenderingContext2D;
  private overlayTex: THREE.CanvasTexture;
  private overlayKey = '';
  private planning = { show: false, preview: null as PlanPreview | null, lanes: false };
  readonly fireworks = new Fireworks(9000);
  private rockets: Rocket[] = [];
  /** Screen flash strength (0-1) and colour, for the HUD to draw. */
  flashLevel = 0;
  flashColor = '#fff6c8';
  /** Crossbow towers and catapults, one model per placed defender. Archers are instanced. */
  private defenderObjs = new Map<number, { kind: PlacedKind; obj: THREE.Group | null }>();
  /** Placement ghost: where a defender would go, green if it fits. */
  private ghost: THREE.Mesh;
  private ghostVisible = false;
  private cursor: THREE.Mesh;
  private shake = 0;
  // Steep enough (about 57 degrees at the wall) that the wall doesn't hide the fighting at its foot.
  private camBase = new THREE.Vector3(0, 52, 34);
  private camLook = new THREE.Vector3(0, 0, -16);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private time = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private game: Game,
    quality: Quality = 'medium',
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
    // Sprites seen at a slant stay crisp with the GPU's best filtering.
    setAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.fireworks.amount = QUALITY[quality].fx;
    this.scene.add(this.fireworks.points);
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color('#9cc4d8');
    this.scene.fog = new THREE.Fog('#9cc4d8', 80, 140);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 300);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    this.scene.add(new THREE.HemisphereLight('#e8f2ff', '#4a5a30', 1.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-20, 40, 15);
    this.scene.add(sun);

    this.groundMat = new THREE.MeshLambertMaterial();
    this.addDetail(this.groundMat);
    this.buildGround();
    this.addHills();
    this.buildCastle();
    this.addTown();

    const makeSprites = (art: SpriteArt, size: number, max: number, centred = false) => {
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
      grunt: imageSprite(gruntUrl, aspects['enemy-grunt']),
      // Placeholder: a grunt carrying a barrel, until sprites/enemy-barrel.webp arrives.
      barrel: imageSprite(gruntUrl, aspects['enemy-grunt']),
      chucker: imageSprite(chuckerUrl, aspects['enemy-chucker']),
      rider: imageSprite(riderUrl, aspects['enemy-rider']),
      orcCatapult: imageSprite(catapultUrl, aspects['enemy-catapult']),
      ogre: imageSprite(ogreUrl, aspects['enemy-ogre']),
      warlord: imageSprite(warlordUrl, aspects['enemy-warlord']),
    };
    for (const kind of ENEMY_KINDS) this.sprites[kind] = makeSprites(art[kind], SIZE[kind], kind === 'grunt' ? MAX_ENEMIES : 800);
    // Soldiers and archers come in big crowds, so they are drawn a little smaller than a grunt.
    this.soldierSprites = makeSprites(imageSprite(soldierUrl, aspects['defender-soldier']), 0.85, 400);
    this.archerSprites = makeSprites(imageSprite(archerUrl, aspects['defender-archer']), 0.8, MAX_ARCHERS);

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

    this.thrown = {
      rock: makeSprites(imageSprite(rockUrl, aspects.rock), 0.4, 600, true),
      boulder: makeSprites(imageSprite(boulderUrl, aspects.boulder), 0.9, 300, true),
      stone: makeSprites(imageSprite(stoneUrl, aspects.stone), 0.6, 200, true),
    };
    // Incoming boulders and rocks are what you're trying to catch, so the shield never hides them.
    for (const m of Object.values(this.thrown)) {
      (m.material as THREE.MeshBasicMaterial).depthTest = false;
      m.renderOrder = 7;
    }
    const arrowArt = imageSprite(arrowUrl, aspects.arrow);
    const makeFlat = (length: number, max: number) => {
      // Lies flat with the arrowhead pointing along -z (away from the castle).
      const geo = new THREE.PlaneGeometry(length * arrowArt.aspect, length).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: arrowArt.texture, alphaTest: 0.5, side: THREE.DoubleSide }), max);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.bolts = makeFlat(2.6, 300);
    this.arrows = makeFlat(1.5, MAX_PROJECTILES);

    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL * 0.8, VOXEL * 0.8, VOXEL * 0.8),
      new THREE.MeshLambertMaterial(),
      MAX_DEBRIS,
    );
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);

    // The royal shield: the painted shield, leaning back so its face catches the boulders.
    const shieldArt = imageSprite(royalShieldUrl, aspects['royal-shield']);
    this.shieldMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1 / shieldArt.aspect),
      new THREE.MeshBasicMaterial({ map: shieldArt.texture, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide }),
    );
    this.shieldMesh.renderOrder = 3;
    this.scene.add(this.shieldMesh);
    this.shieldShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    this.shieldShadow.position.y = 0.05;
    this.scene.add(this.shieldShadow);

    // Balls: shiny spheres drawn over everything (so the shield never hides one), each with an additive halo.
    const r = game.cfg.balls.radius;
    this.balls = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(r, 3),
      new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.55, depthTest: false }),
      MAX_BALLS,
    );
    this.balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BALLS * 3).fill(1), 3);
    this.balls.frustumCulled = false;
    this.balls.renderOrder = 9;
    this.balls.count = 0;
    this.scene.add(this.balls);
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
    this.barrels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 12), new THREE.MeshLambertMaterial({ color: '#7a4a22' }), MAX_BARRELS);
    this.barrels.frustumCulled = false;
    this.barrels.count = 0;
    this.scene.add(this.barrels);

    for (const [kind, look] of Object.entries(CAPSULE_LOOK) as [CapsuleKind, (typeof CAPSULE_LOOK)[CapsuleKind]][]) {
      this.capsuleTex[kind] = capsuleTexture(look.color, look.emoji);
    }

    // The tower turrets out in front of the wall: round stone bumpers for bank shots.
    for (let i = 0; i <= game.cfg.wall.segments; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.12, 0.5, 24), new THREE.MeshLambertMaterial({ color: '#cdbd98' }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd34a' }));
      this.bumperMeshes.push(m);
      this.bumperRings.push(ring);
      this.scene.add(m, ring);
    }

    // The siege tower: storeys of plank bricks with a catapult on top.
    this.towerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 96);
    this.towerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(96 * 3).fill(1), 3);
    this.towerMesh.frustumCulled = false;
    this.towerMesh.count = 0;
    this.scene.add(this.towerMesh);
    const topArt = imageSprite(catapultUrl, aspects['enemy-catapult']);
    const topGeo = new THREE.PlaneGeometry(3.6 * topArt.aspect, 3.6).translate(0, 1.8, 0);
    this.towerTop = new THREE.Mesh(topGeo, new THREE.MeshBasicMaterial({ map: topArt.texture, alphaTest: 0.5, alphaToCoverage: true }));
    this.towerTop.visible = false;
    this.scene.add(this.towerTop);

    // Defender spots: a ring on each, shown while planning.
    const ringGeo = new THREE.RingGeometry(0.62, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < game.spots.length; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffd34a', transparent: true, depthWrite: false, depthTest: false }));
      m.renderOrder = 6;
      m.visible = false;
      this.spotRings.push(m);
      this.scene.add(m);
    }

    // The planning overlay: who covers which bit of the field, blind spots in red, the coming lanes.
    const hw = game.cfg.field.halfWidth;
    const cols = Math.round((hw * 2) / OVERLAY_CELL);
    const rows = Math.round((game.cfg.field.topY - OVERLAY_MIN_Y) / OVERLAY_CELL);
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

    this.ghost = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#7dff8a', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }),
    );
    this.ghost.renderOrder = 10;
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(game.cfg.slap.radius - 0.15, game.cfg.slap.radius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff4c2', transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.scene.add(this.cursor);
  }

  /** Swaps in a fresh game (after a restart) and rebuilds the castle and ground. */
  setGame(game: Game) {
    this.game = game;
    this.rebuildCastle();
    this.ground.reset();
    this.terrain.reset();
    this.lastWave = -1;
    this.debris = [];
    for (const fx of this.effects) this.scene.remove(fx.obj);
    this.effects = [];
    for (const d of this.defenderObjs.values()) if (d.obj) this.scene.remove(d.obj);
    this.defenderObjs.clear();
    for (const sp of this.capsuleSprites.values()) this.scene.remove(sp);
    this.capsuleSprites.clear();
    this.fireworks.clear();
    this.rockets = [];
    this.towerFloors = 0;
    this.overlayKey = '';
  }

  /** Changes the quality level: render resolution, ground detail and terrain smoothness. Clears marks on the ground. */
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
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
    this.camBase.set(0, 52 * pull, 34 * pull - (pull - 1) * 8);
    this.camera.updateProjectionMatrix();
    this.fireworks.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** The shield x under a screen point: where the mouse ray crosses the shield's line. */
  shieldX(ndcX: number, ndcY: number): number | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), this.game.cfg.shield.y);
    const hit = this.raycaster.ray.intersectPlane(plane, tmpV);
    return hit ? hit.x : null;
  }

  /**
   * Planning view: spot rings, everyone's coverage on the ground with blind spots in red,
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
    for (const h of [TOWER_H, WALL_H]) {
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

  setCursor(x: number, y: number, ready: boolean, visible = true) {
    this.cursor.visible = visible;
    this.cursor.position.set(x, this.groundHeight(x, -y) + 0.08, -y);
    (this.cursor.material as THREE.MeshBasicMaterial).opacity = ready ? 0.55 : 0.15;
  }

  /** Shows where a defender would go: a ring of its footprint, green if it fits there, red if not. */
  setGhost(x: number, y: number, radius: number, ok: boolean) {
    this.ghostVisible = true;
    this.ghost.position.set(x, this.standHeight(x, -y) + 0.1, -y);
    this.ghost.scale.setScalar(radius);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(ok ? '#7dff8a' : '#ff6a5a');
  }

  hideGhost() {
    this.ghostVisible = false;
  }

  handleEvents(events: GameEvent[]) {
    const g = this.game;
    const fw = this.fireworks;
    const sy = g.cfg.shield.y;
    for (const ev of events) {
      switch (ev.type) {
        case 'slap':
          this.spawnEffect('hand', ev.x, -ev.y, 0.35);
          this.spawnEffect('ring', ev.x, -ev.y, 0.4);
          this.ground.stamp(ev.x, -ev.y, 3.2, 'rgba(70,50,25,0.45)');
          this.terrain.crater(ev.x, -ev.y, 1.4, 0.15);
          fw.burst(ev.x, 0.3, -ev.y, { count: 30, colors: ['#e8d8b0', '#b09870', '#ffffff'], speed: 9, life: 0.5, size: 0.35, ring: true, gravity: 0, drag: 4 });
          this.shake = Math.max(this.shake, 0.5);
          break;
        case 'kill': {
          const big = SIZE[ev.kind];
          if (big >= 2) {
            this.ground.decal(ev.x, -ev.y, big, this.scorch, 0.75);
            this.terrain.crater(ev.x, -ev.y, big * 0.8, 0.4);
            fw.burst(ev.x, big, -ev.y, { count: 40 * big, colors: [...GOLD, KILL_COLOR[ev.kind]], speed: 8 + big * 2, life: 1, size: 0.45, up: 0.4, twinkle: true });
          } else if (Math.random() < 0.5) {
            this.ground.stamp(ev.x, -ev.y, 0.9 * big, 'rgba(60,70,20,0.5)');
          }
          this.burst(ev.x, 0.6 * big, -ev.y, big >= 2 ? Math.round(4 * big) : 2, KILL_COLOR[ev.kind], 4 + big);
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
          this.spawnEffect('explosion', ev.x, -ev.y, 0.5, ev.radius);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.7, this.scorch, 0.9);
          this.terrain.crater(ev.x, -ev.y, ev.radius * 0.6, 0.7);
          fw.burst(ev.x, 0.5, -ev.y, { count: 120, colors: FIRE, speed: 16, life: 0.9, size: 0.6, up: 0.45, gravity: 9, twinkle: true });
          fw.burst(ev.x, 0.3, -ev.y, { count: 60, colors: ['#fff2a8', '#ffb43a'], speed: 20, life: 0.4, size: 0.5, ring: true, gravity: 0, drag: 5 });
          this.burst(ev.x, 0.6, -ev.y, 10, '#5a3a1e', 10);
          this.flash(0.35, '#ffb43a');
          this.shake = Math.max(this.shake, 0.6);
          break;
        case 'soldierDown':
          this.burst(ev.x, 0.6, -ev.y, 3, '#2f56b0', 4);
          break;
        case 'bossKilled':
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
          fw.burst(ev.x, SHIELD_H + 0.6, -sy - 0.5, { count: ev.parry ? 70 : 26, colors, speed: ev.parry ? 14 : 9, life: 0.5, size: 0.38, up: 0.5, gravity: 14 });
          if (ev.parry) fw.burst(ev.x, 0.4, -sy, { count: 40, colors: GOLD, speed: 14, life: 0.35, size: 0.4, ring: true, gravity: 0, drag: 6 });
          this.sparks(ev.x, 2.2, -sy, ev.parry ? 18 : 8);
          this.shieldJolt = ev.parry ? 1 : 0.7;
          this.shake = Math.max(this.shake, ev.parry ? 0.5 : 0.25);
          if (ev.parry) this.flash(0.18, '#fff6c8');
          break;
        }
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
          this.burst(ev.x, FLOOR_H * 0.5, -ev.y, 4, '#a8783f', 7);
          fw.burst(ev.x, FLOOR_H * 0.5, -ev.y + 0.3, { count: 22, colors: WOOD, speed: 8, life: 0.5, size: 0.35, gravity: 14 });
          this.shake = Math.max(this.shake, 0.15);
          break;
        case 'floorDown':
          // A storey gives way: planks everywhere, a ring of dust, and the tower drops.
          this.burst(ev.x, FLOOR_H, -ev.y, 24, '#8a5a2e', 12);
          fw.burst(ev.x, 0.4, -ev.y, { count: 90, colors: ['#c8b898', '#a89070', '#e8d8b0'], speed: 14, life: 0.8, size: 0.7, ring: true, gravity: 0, drag: 3 });
          fw.burst(ev.x, FLOOR_H, -ev.y, { count: 80, colors: [...WOOD, ...GOLD], speed: 12, life: 0.9, size: 0.45, up: 0.5, twinkle: true });
          this.flash(0.3, '#ffd34a');
          this.shake = Math.max(this.shake, 0.8);
          break;
        case 'bounce':
          if (Math.random() < 0.6) fw.burst(ev.x, 0.9, -ev.y, { count: 8, colors: STEEL, speed: 6, life: 0.3, size: 0.3, gravity: 6 });
          break;
        case 'ballLost':
          fw.burst(ev.x, 1.5, -0.2, { count: 30, colors: ['#ff6a5a', '#ffb43a', '#8c8a80'], speed: 7, life: 0.5, size: 0.4, up: 0.5 });
          this.burst(ev.x, 2.5, 0, 5, '#8c8a80', 6);
          this.flash(0.15, '#ff6a5a');
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'caught': {
          const look = CAPSULE_LOOK[ev.kind];
          fw.burst(ev.x, SHIELD_H + 0.8, -sy, { count: 50, colors: [look.color, '#ffffff'], speed: 10, life: 0.7, size: 0.45, up: 0.7, twinkle: true });
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
        case 'wallHit':
          this.burst(ev.x, 2.5, 0, 3, '#8c8a80', 5);
          fw.burst(ev.x, 2, -0.2, { count: 10, colors: ['#e8d8b0', '#ffb43a'], speed: 6, life: 0.4, size: 0.35, up: 0.4 });
          if (this.effects.length < 40) this.spawnEffect('impact', ev.x, 0.5, 0.25, 1.6);
          break;
        case 'segmentDestroyed':
          this.shake = Math.max(this.shake, 0.9);
          break;
        default:
          break;
      }
    }
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
    this.updateCastle();
    this.updateEnemies(time);
    this.updateSoldiers(time);
    this.updateDefenders();
    this.updateProjectiles();
    this.updateDebris(dt);
    this.updateEffects(dt);
    this.updateShield(dt);
    this.updateBalls();
    this.updateCapsules(time);
    this.updateBumpers();
    this.updateTower(dt);
    this.updatePlanning(time);
    this.updateRockets(dt);
    this.fireworks.update(dt);
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.2);

    this.ghost.visible = this.ghostVisible;
    (this.ghost.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 6) * 0.25;

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const k = this.shake * this.shake;
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * k * 1.2,
      this.camBase.y + (Math.random() - 0.5) * k * 1.2,
      this.camBase.z,
    );
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }

  // ---- the shield, balls and capsules ---------------------------------------

  private updateShield(dt: number) {
    const g = this.game;
    const hw = g.shieldHalfWidth();
    const w = (hw * 2) / SHIELD_ART_FILL;
    // A heave shoves the shield up and forward and stands it up a little, then it settles back.
    this.heaveT += dt;
    const shove = this.heaveT < 0.3 ? Math.sin((this.heaveT / 0.3) * Math.PI) : 0;
    this.shieldJolt = Math.max(0, this.shieldJolt - dt * 6);
    const m = this.shieldMesh;
    m.scale.set(w, w, 1);
    m.position.set(g.shield.x, SHIELD_H + shove * 0.7 + this.shieldJolt * 0.25, -g.cfg.shield.y - shove * 0.9);
    m.rotation.set(-Math.PI / 2 + SHIELD_TILT + shove * 0.35, 0, this.shieldJolt * 0.05 * Math.sin(this.time * 60));
    // Dimmed while it recovers from a heave.
    (m.material as THREE.MeshBasicMaterial).color.setScalar(g.canHeave ? 1 : 0.72);
    this.shieldShadow.position.x = g.shield.x;
    this.shieldShadow.position.z = -g.cfg.shield.y + 0.4;
    this.shieldShadow.scale.set(w * 1.05, 1, w * 0.9);
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
    for (const b of g.balls) {
      if (n >= MAX_BALLS) break;
      const color = this.ballColor(b);
      const y = b.stuck ? SHIELD_H + 1 : 0.9;
      // Drawn bigger than its hit size so it reads at a glance from up here.
      const size = (b.kind === 'pebble' ? 0.75 : b.kind === 'royal' ? 1.25 : 1) * 1.7;
      tmpV.set(b.x, y, -b.y);
      this.balls.setMatrixAt(n, tmpM.compose(tmpV, tmpQ.setFromAxisAngle(FORWARD, this.time * 3 + b.id), tmpS.setScalar(size)));
      this.balls.setColorAt(n++, tmpC.set(color));
      const glow = (b.heaved && b.lines > 0 ? 6 : b.combo >= 10 ? 5 : 3.5) * r * size;
      this.halos.setMatrixAt(h, tmpM.compose(tmpV, camQ, tmpS.set(glow, glow, 1)));
      this.halos.setColorAt(h++, tmpC.set(color).multiplyScalar(b.kind === 'pebble' ? 0.4 : 0.8));
      // A comet trail, longer and hotter with the combo.
      if (!b.stuck) {
        const hot = b.combo >= 10 || (b.heaved && b.lines > 0);
        this.fireworks.burst(b.x, y, -b.y, {
          count: hot ? 3 : 1.2, colors: [color, '#ffffff'], speed: 0.8, life: hot ? 0.45 : 0.3, size: r * size * (hot ? 1.8 : 1.3), gravity: 0, drag: 4,
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
      sp.scale.set(2.2, 1.1, 1);
      if (Math.random() < 0.3) this.fireworks.burst(c.x, 1.4, -c.y, { count: 1, colors: [CAPSULE_LOOK[c.kind].color, '#ffffff'], speed: 1, life: 0.4, size: 0.3, gravity: -1 });
    }
    for (const [c, sp] of this.capsuleSprites) {
      if (seen.has(c)) continue;
      this.scene.remove(sp);
      sp.material.dispose();
      this.capsuleSprites.delete(c);
    }
  }

  private updateBumpers() {
    this.game.bumpers().forEach((b, i) => {
      const m = this.bumperMeshes[i];
      const ring = this.bumperRings[i];
      if (!m) return;
      m.position.set(b.x, 0.25, -b.y);
      m.scale.set(b.r, 1, b.r);
      // A manned turret is bigger and ringed in gold.
      ring.visible = b.manned;
      ring.position.set(b.x, 0.52, -b.y);
      ring.scale.setScalar(b.r * 0.92);
    });
  }

  // ---- the siege tower ------------------------------------------------------

  private updateTower(dt: number) {
    const tw = this.game.tower;
    const mesh = this.towerMesh;
    if (!tw) {
      mesh.count = 0;
      this.towerTop.visible = false;
      this.towerFloors = 0;
      return;
    }
    const t = this.game.cfg.siegeTower;
    if (this.towerFloors && tw.floors.length < this.towerFloors) this.towerDrop += FLOOR_H * (this.towerFloors - tw.floors.length);
    this.towerFloors = tw.floors.length;
    this.towerDrop = Math.max(0, this.towerDrop - dt * 9);
    const plankW = (t.halfWidth * 2) / t.planks;
    const front = -tw.y;
    const back = -(tw.y + t.depth);
    const rumble = tw.ramp ? Math.sin(this.time * 30) * 0.04 : 0;
    let n = 0;
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) => {
      if (n >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(n, tmpM.compose(tmpV.set(x + rumble, y, z), tmpQ.identity(), tmpS.set(sx, sy, sz)));
      mesh.setColorAt(n++, tmpC.set(color));
    };
    tw.floors.forEach((planks, f) => {
      const y0 = f * FLOOR_H + this.towerDrop;
      // The storey's frame: dark timbers behind the planks, corner posts in front.
      box(tw.x, y0 + FLOOR_H / 2, (front + back) / 2, t.halfWidth * 2 - 0.2, FLOOR_H - 0.05, t.depth - 0.4, '#3a2a1a');
      for (const side of [-1, 1]) box(tw.x + side * t.halfWidth, y0 + FLOOR_H / 2, front - 0.1, 0.35, FLOOR_H, 0.45, '#4a3420');
      box(tw.x, y0 + FLOOR_H - 0.08, front - 0.1, t.halfWidth * 2 + 0.3, 0.16, 0.5, '#4a3420');
      planks.forEach((hits, i) => {
        if (hits <= 0) return;
        const x = tw.x - t.halfWidth + (i + 0.5) * plankW;
        // Cracked planks sag and darken.
        const sag = hits < t.plankHits ? 0.12 : 0;
        box(x, y0 + FLOOR_H / 2 - sag, front - 0.25, plankW * 0.9, FLOOR_H * 0.8, 0.3, PLANK_COLORS[Math.min(2, hits)] ?? PLANK_COLORS[2]);
      });
    });
    // The ramp drops onto the wall when it arrives.
    if (tw.ramp) box(tw.x, 1.2, front + 0.6, 3, 0.2, 1.6, '#6e4a25');
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.towerTop.visible = tw.floors.length >= 2;
    this.towerTop.position.set(tw.x + rumble, tw.floors.length * FLOOR_H + this.towerDrop, (front + back) / 2);
    this.towerTop.quaternion.copy(this.camera.quaternion);
  }

  // ---- planning view --------------------------------------------------------

  private updatePlanning(time: number) {
    const g = this.game;
    const { show, preview } = this.planning;
    const taken = new Set(g.defenders.map((d) => d.spot));
    g.spots.forEach((spot, i) => {
      const ring = this.spotRings[i];
      const open = g.openSpots[i];
      ring.visible = show && !taken.has(spot.id);
      if (!ring.visible) return;
      ring.position.set(spot.x, this.standHeight(spot.x, -spot.y) + 0.12, -spot.y);
      const mat = ring.material as THREE.MeshBasicMaterial;
      // Open spots pulse gold; closed ones sit grey until bought.
      mat.color.set(open ? '#ffd34a' : '#9a9080');
      mat.opacity = open ? 0.65 + Math.sin(time * 4 + i) * 0.25 : 0.45;
      ring.scale.setScalar(open ? 1.1 : 0.9);
    });

    const mat = this.overlay.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, Math.min(1, mat.opacity + (show ? 0.08 : -0.08)));
    this.overlay.visible = mat.opacity > 0;
    if (!show) return;
    const key = `${g.defenders.map((d) => `${d.kind}${d.spot}`).join(',')}|${preview ? `${preview.kind}${preview.spot}` : ''}|${this.planning.lanes ? g.plan.number : ''}|${g.unlocked('archers')}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.drawOverlay();
  }

  /** Paints who covers what: a tint per defender kind, red hatching on wall sections nothing guards, the coming lanes. */
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
      const spot = g.spots[preview.spot];
      defs.push({ id: -1, kind: preview.kind, spot: spot.id, x: spot.x, y: spot.y, timer: 0, aimX: spot.x, aimY: 30, firedAt: -99 });
    }
    // A wall section is a blind spot if no archer cone reaches out in front of it and no crossbow lane runs up it.
    const seg = g.segmentWidth();
    const blind = Array.from({ length: g.cfg.wall.segments }, (_, i) => {
      const lo = -hw + i * seg;
      return !defs.some(
        (d) => (d.kind === 'archers' && g.covers(d, lo + seg / 2, g.cfg.coverage.sectionCheckY))
          || (d.kind === 'crossbow' && [0.1, 0.3, 0.5, 0.7, 0.9].some((f) => g.covers(d, lo + seg * f, 40))),
      );
    });
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
        if (blind[s] && y >= 0 && y <= g.cfg.coverage.sectionCheckY && (col + row) % 6 < 3) add([255, 40, 30], 3, 0.5);
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
    const minZ = -(this.game.cfg.field.spawnY + 14);
    const maxZ = 22;
    this.ground = new GroundCanvas(hw * 2 + 8, maxZ - minZ, minZ, forestUrl, q.groundWidth);
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
    for (const tx of this.towerX) if (Math.abs(x - tx) <= TOWER_HALF && Math.abs(z - TOWER_Z) <= TOWER_HALF) return TOWER_H;
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
   * A cream-stone voxel wall in five segments that crumble with their HP, with
   * crenellated towers on every joint and a wooden gate in the middle.
   */
  private buildCastle() {
    const cfg = this.game.cfg;
    const hw = cfg.field.halfWidth;
    const segW = (hw * 2) / cfg.wall.segments;
    const nx = Math.round(segW / VOXEL);
    const nz = Math.round(cfg.wall.depth / VOXEL);
    const ny = WALL_H / VOXEL;
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const stone = (base: string, v: number) => new THREE.Color(base).offsetHSL(0, 0, (rnd() - 0.5) * v);
    // Grey footing, cream stone above, like the castle art.
    const wallStone = (iy: number) => (iy < 2 ? stone('#8f8a82', 0.1) : stone('#e2d2ad', 0.08));
    type Cell = { p: THREE.Vector3; c: THREE.Color };

    const addGroup = (cells: Cell[]): VoxelGroup => {
      const start = this.voxelPos.length;
      // Crumble from the top down, with noise so the damage looks ragged.
      const order = cells
        .map((cell, i) => ({ i: start + i, key: -cell.p.y + rnd() * 2.5 }))
        .sort((a, b) => a.key - b.key)
        .map((o) => o.i);
      for (const cell of cells) {
        this.voxelPos.push(cell.p);
        this.voxelColor.push(cell.c);
      }
      return { order, visible: cells.length };
    };

    for (let seg = 0; seg < cfg.wall.segments; seg++) {
      const x0 = -hw + seg * segW;
      const gate = seg === Math.floor(cfg.wall.segments / 2);
      const cells: Cell[] = [];
      for (let ix = 0; ix < nx; ix++) {
        const cx = x0 + (ix + 0.5) * VOXEL;
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < ny; iy++) {
            // The gate: a tall wooden door in the middle of the front face.
            const door = gate && iz === 0 && Math.abs(cx) < 1.6 && iy < 6;
            const slit = iz === 0 && iy === 5 && ix % 6 === 3;
            cells.push({
              p: new THREE.Vector3(cx, (iy + 0.5) * VOXEL, (iz + 0.5) * VOXEL),
              c: door ? stone('#6b4528', 0.06) : slit ? new THREE.Color('#3a2e22') : wallStone(iy),
            });
          }
          // Crenellations along the front edge.
          if (iz === 0 && ix % 4 < 2) cells.push({ p: new THREE.Vector3(cx, (ny + 0.5) * VOXEL, 0.5 * VOXEL), c: stone('#efe1bf', 0.06) });
        }
      }
      this.segments.push(addGroup(cells));
    }

    // Towers on every joint: hollow cream shells with a grey base, crenellated tops and a royal banner.
    const towers: Cell[] = [];
    this.towerX = [];
    const n = Math.round((TOWER_HALF * 2) / VOXEL);
    for (let t = 0; t <= cfg.wall.segments; t++) {
      const tx = -hw + t * segW;
      this.towerX.push(tx);
      const x0 = tx - TOWER_HALF;
      const z0 = TOWER_Z - TOWER_HALF;
      const th = TOWER_H / VOXEL;
      for (let ix = 0; ix < n; ix++) {
        for (let iz = 0; iz < n; iz++) {
          const edge = ix === 0 || iz === 0 || ix === n - 1 || iz === n - 1;
          const p = (iy: number) => new THREE.Vector3(x0 + (ix + 0.5) * VOXEL, (iy + 0.5) * VOXEL, z0 + (iz + 0.5) * VOXEL);
          for (let iy = 0; iy < th; iy++) {
            if (!edge && iy < th - 1) continue;
            // A blue-and-gold banner hangs on the front face.
            const banner = iz === 0 && ix >= 2 && ix <= n - 3 && iy >= th - 6 && iy <= th - 2;
            const trim = banner && (iy === th - 6 || ix === 2 || ix === n - 3);
            towers.push({ p: p(iy), c: banner ? new THREE.Color(trim ? '#e8b730' : '#2a4fb0') : iy < 2 ? stone('#8f8a82', 0.1) : stone('#e7d8b4', 0.08) });
          }
          if (edge && (ix + iz) % 2 === 0) towers.push({ p: p(th), c: stone('#efe1bf', 0.06) });
        }
      }
    }
    addGroup(towers);

    this.voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), new THREE.MeshLambertMaterial(), this.voxelPos.length);
    this.voxels.frustumCulled = false;
    for (let i = 0; i < this.voxelPos.length; i++) {
      this.voxels.setMatrixAt(i, tmpM.makeTranslation(this.voxelPos[i]));
      this.voxels.setColorAt(i, this.voxelColor[i]);
    }
    this.scene.add(this.voxels);
  }

  /** The keep and the tavern behind the courtyard. Scenery; the wall is what you defend. */
  private addTown() {
    const billboard = (art: SpriteArt, h: number, x: number, z: number) => {
      const geo = new THREE.PlaneGeometry(h * art.aspect, h);
      geo.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5 }));
      m.position.set(x, 0, z);
      m.onBeforeRender = () => m.quaternion.copy(this.camera.quaternion);
      this.scene.add(m);
    };
    billboard(imageSprite(keepUrl, aspects.keep), 7, 0, 13.5);
    billboard(imageSprite(tavernUrl, aspects.tavern), 4.2, -14, 12.5);
  }

  private crumble(group: VoxelGroup, fraction: number) {
    const target = Math.ceil(group.order.length * Math.max(0, Math.min(1, fraction)));
    if (target >= group.visible) return;
    // Voxels already gone are the first `removed` entries of the crumble order; hide the next ones.
    const removed = group.order.length - group.visible;
    const toRemove = group.visible - target;
    for (let n = 0; n < toRemove; n++) {
      const idx = group.order[removed + n];
      this.voxels.setMatrixAt(idx, hidden);
      if (n < 20) {
        const p = this.voxelPos[idx];
        this.burst(p.x, p.y, p.z, 1, '#' + this.voxelColor[idx].getHexString(), 6);
      }
    }
    group.visible = target;
    this.voxels.instanceMatrix.needsUpdate = true;
  }

  private updateCastle() {
    const g = this.game;
    g.segmentHp.forEach((hp, i) => this.crumble(this.segments[i], hp / g.cfg.wall.segmentHp));
  }

  // ---- defenders -------------------------------------------------------------

  private buildDefender(kind: PlacedKind): THREE.Group | null {
    if (kind === 'archers') return null;
    const group = new THREE.Group();
    const art = kind === 'crossbow' ? this.towerArt : this.catapultArt;
    const h = kind === 'crossbow' ? 5.2 : 4; // catapult scale 2
    const geo = new THREE.PlaneGeometry(h * art.aspect, h);
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5 }));
    m.name = 'billboard';
    group.add(m);
    return group;
  }

  /** Where a defender's model stands. Crossbow towers rise out of whatever they stand on. */
  private defenderBase(d: Defender): THREE.Vector3 {
    const h = this.standHeight(d.x, -d.y);
    return tmpV.set(d.x, d.kind === 'crossbow' ? Math.max(0, h - 2.2) : h, -d.y);
  }

  private updateDefenders() {
    const g = this.game;
    const seen = new Set<number>();
    const camQ = this.camera.quaternion;
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
        for (const child of entry.obj.children) if (child.name === 'billboard') child.quaternion.copy(camQ);
        // Recoil when it fires: a quick squash that springs back.
        const kick = since >= 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) : 0;
        entry.obj.scale.set(1 + kick * 0.08, 1 - kick * 0.1, 1);
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
        tmpV.set(x, this.standHeight(x, z) + draw * 0.15, z);
        tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, Math.sin(this.time * 2 + i) * 0.03));
        this.archerSprites.setMatrixAt(archers, tmpM.compose(tmpV, tmpQ, tmpS.set(1, 1 + draw * 0.06, 1)));
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
    const camQ = this.camera.quaternion;
    let n = 0;
    for (const s of this.game.soldiers) {
      if (s.hp <= 0 || n >= this.soldierSprites.instanceMatrix.count) continue;
      // Marching in place, with a little jab when they're stuck in.
      const jab = Math.abs(Math.sin(time * 7 + s.postX)) * 0.08;
      tmpV.set(s.x, this.groundHeight(s.x, -s.y) + jab, -s.y);
      tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, Math.sin(time * 3 + s.postX) * 0.04));
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

  private updateEnemies(time: number) {
    const camQ = this.camera.quaternion;
    const counts = Object.fromEntries(ENEMY_KINDS.map((k) => [k, 0])) as Record<EnemyKind, number>;
    let shadowN = 0;
    let barrels = 0;
    for (const e of this.game.enemies) {
      const mesh = this.sprites[e.kind];
      const i = counts[e.kind]++;
      if (i >= mesh.instanceMatrix.count) continue;
      const size = SIZE[e.kind];
      const moving = e.state === 'march';
      // Walk cycle in code: a hop on each step, a side-to-side waddle and a squash on landing.
      // Heavier units step slower; riders gallop with less sway; catapults just trundle.
      const pace = e.kind === 'rider' ? 14 : e.kind === 'orcCatapult' ? 5 : 9 / Math.sqrt(size);
      const step = time * pace + e.phase * 20;
      const hop = moving ? Math.abs(Math.sin(step)) : 0;
      const bob = hop * 0.18 * size * (e.kind === 'orcCatapult' ? 0.3 : 1);
      const sway = e.kind === 'rider' ? 0.04 : e.kind === 'orcCatapult' ? 0.02 : 0.12;
      const roll = moving ? Math.sin(step) * sway : 0;
      const squash = moving ? 1 - (1 - hop) * 0.08 : 1;
      // Small orcs at the wall scramble up the stones, then hack away at the top; big ones pound it from below.
      const c = this.game.cfg[e.kind];
      const climbs = CLIMBERS.has(e.kind);
      const climb =
        climbs && e.state === 'climb' ? (1 - e.timer / c.climbSeconds) * 3 + Math.sin(time * 12 + e.phase * 9) * 0.1
        : climbs && e.state === 'wall' ? 3 + Math.abs(Math.sin(time * 6 + e.phase * 9)) * 0.25
        : 0;
      const pound = !climbs && (e.state === 'wall' || e.state === 'fight') ? Math.abs(Math.sin(time * 5 + e.phase * 9)) * 0.3 : 0;
      const brawl = e.state === 'fight' ? Math.abs(Math.sin(time * 10 + e.phase * 9)) * 0.15 : 0;
      const hurt = e.hp < e.maxHp ? 0.75 : 1;
      const burning = e.burnTime > 0;
      const ground = this.groundHeight(e.x, -e.y);
      tmpV.set(e.x, ground + bob + climb + pound + brawl, -e.y);
      tmpS.set(2 - squash, squash, 1);
      tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, roll));
      mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
      mesh.setColorAt(i, burning ? tmpC.setRGB(1, 0.6, 0.3) : e.stagger > 0 ? tmpC.setRGB(0.7, 0.7, 1) : tmpC.setRGB(1, hurt, hurt));
      if (e.kind === 'barrel' && barrels < MAX_BARRELS) {
        // The barrel rides on its back, toward the camera so it shows, with a fizzing fuse.
        const bx = e.x + 0.25;
        const by = tmpV.y + 0.75;
        const bz = -e.y + 0.35;
        this.barrels.setMatrixAt(barrels++, tmpM.compose(tmpD.set(bx, by, bz), tmpQ.setFromAxisAngle(FORWARD, 0.3 + roll), tmpS.set(1, 1, 1)));
        if (Math.random() < 0.35) this.fireworks.burst(bx + 0.1, by + 0.35, bz, { count: 1, colors: FIRE, speed: 1.5, life: 0.3, size: 0.25, gravity: -2 });
      }
      if (shadowN < MAX_ENEMIES) {
        tmpS.set(size, 1, size);
        this.shadows.setMatrixAt(shadowN++, tmpM.compose(tmpV.set(e.x, ground, -e.y + 0.1), tmpQ.identity(), tmpS));
      }
    }
    for (const kind of ENEMY_KINDS) {
      const mesh = this.sprites[kind];
      mesh.count = Math.min(counts[kind], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.barrels.count = barrels;
    this.barrels.instanceMatrix.needsUpdate = true;
  }

  private updateProjectiles() {
    const camQ = this.camera.quaternion;
    const counts = { rock: 0, boulder: 0, stone: 0 };
    let b = 0;
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
        tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, p.travelled * 0.3));
        mesh.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
        mesh.setColorAt(i, p.friendly && p.kind !== 'stone' ? tmpC.setRGB(1, 0.9, 0.55) : tmpC.setRGB(1, 1, 1));
      } else if (p.kind === 'arrow') {
        if (a >= this.arrows.instanceMatrix.count) continue;
        // Volley arrows go up high and come down steeply; each points along its flight.
        const t = Math.min(1, p.travelled / p.flight);
        const apex = 0.3 * p.flight + 3;
        const h = 3 + apex * 4 * t * (1 - t) - 2.4 * t;
        const slope = (apex * 4 * (1 - 2 * t) - 2.4) / Math.max(1, p.flight);
        const sp = Math.hypot(p.vx, p.vy) || 1;
        tmpD.set(p.vx / sp, slope, -p.vy / sp).normalize();
        tmpQ.setFromUnitVectors(AHEAD, tmpD);
        this.arrows.setMatrixAt(a++, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
      } else {
        if (b >= this.bolts.instanceMatrix.count) continue;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        tmpQ.setFromUnitVectors(AHEAD, tmpD.set(p.vx / sp, 0, -p.vy / sp));
        this.bolts.setMatrixAt(b++, tmpM.compose(tmpV.set(p.x, 1.8, -p.y), tmpQ, tmpS.set(1, 1, 1)));
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
    this.arrows.count = a;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  // ---- effects -------------------------------------------------------------

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
      const sc = Math.min(1, d.life * 2) * (d.spin.x === 20 ? 0.35 : 1);
      this.debrisMesh.setMatrixAt(i, tmpM.compose(d.pos, tmpQ.setFromEuler(d.rot), tmpS.set(sc, sc, sc)));
      this.debrisMesh.setColorAt(i, d.color);
    });
    this.debrisMesh.count = alive.length;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  private spawnEffect(kind: Effect['kind'], x: number, z: number, duration: number, size = this.game.cfg.slap.radius) {
    let obj: THREE.Object3D;
    if (kind === 'hand') {
      const geo = new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2);
      obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.handTex, alphaTest: 0.5, side: THREE.DoubleSide }));
    } else if (kind === 'ring') {
      obj = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#fff1c7', transparent: true, depthWrite: false }),
      );
    } else if (kind === 'explosion' || kind === 'impact' || kind === 'fireball') {
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
    obj.position.set(x, kind === 'hand' ? 8 : kind === 'explosion' || kind === 'fireball' ? size * 0.6 : kind === 'impact' ? 1.2 : 0.1, z);
    this.scene.add(obj);
    this.effects.push({ kind, x, z, t: 0, duration, obj, size });
  }

  private updateEffects(dt: number) {
    this.effects = this.effects.filter((fx) => {
      fx.t += dt;
      const u = Math.min(1, fx.t / fx.duration);
      const mesh = fx.obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (fx.kind === 'hand') {
        // Slam down fast, hold, then lift away.
        const down = Math.min(1, u * 4);
        fx.obj.position.y = 8 * (1 - down) + 0.2 + Math.max(0, u - 0.6) * 12;
      } else if (fx.kind === 'ring') {
        const r = 0.5 + u * fx.size * 1.1;
        fx.obj.scale.set(r, 1, r);
        mat.opacity = 1 - u;
      } else if (fx.kind === 'explosion' || fx.kind === 'impact' || fx.kind === 'fireball') {
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

  private addHills() {
    // Voxel-ish hills and woods behind the spawn line and along the sides, to frame the field.
    const minZ = -(this.game.cfg.field.spawnY + 14);
    const mat = new THREE.MeshLambertMaterial({ color: '#4f7a33' });
    const tree = new THREE.MeshLambertMaterial({ color: '#2f5a28' });
    const tree2 = new THREE.MeshLambertMaterial({ color: '#7fb33a' });
    const trunk = new THREE.MeshLambertMaterial({ color: '#5a4026' });
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const hw = this.game.cfg.field.halfWidth;
    for (let i = 0; i < 70; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (hw + 7 + rnd() * 14);
      const z = minZ + rnd() * (Math.abs(minZ) + 20);
      const h = 1 + rnd() * 4;
      const box = new THREE.Mesh(new THREE.BoxGeometry(4 + rnd() * 6, h, 4 + rnd() * 6), mat);
      box.position.set(x, h / 2 - 0.2, z);
      this.scene.add(box);
      if (rnd() < 0.7) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), trunk);
        t.position.set(x + (rnd() - 0.5) * 2, h + 0.75, z);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), rnd() < 0.5 ? tree : tree2);
        c.position.set(t.position.x, h + 2.2, z);
        this.scene.add(t, c);
      }
    }
  }
}
