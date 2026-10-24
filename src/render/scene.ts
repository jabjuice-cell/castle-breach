import * as THREE from 'three';
import type { Defender, PlacedKind } from '../sim/defenders';
import type { Game, GameEvent } from '../sim/game';
import { ENEMY_KINDS, type EnemyKind } from '../sim/waves';
import aspects from '../assets/aspects.json';
import keepUrl from '../assets/castle/keep.png';
import tavernUrl from '../assets/castle/tavern.png';
import towerUrl from '../assets/castle/tower-crossbow.png';
import arrowUrl from '../assets/fx/arrow.png';
import boulderUrl from '../assets/fx/boulder.png';
import explosionUrl from '../assets/fx/explosion.png';
import impactUrl from '../assets/fx/impact.png';
import rockUrl from '../assets/fx/rock.png';
import stoneUrl from '../assets/fx/stone.png';
import craterUrl from '../assets/maps/crater.png';
import forestUrl from '../assets/maps/forest.jpg';
import scorchUrl from '../assets/maps/scorch.png';
import archerUrl from '../assets/sprites/defender-archer.png';
import defCatapultUrl from '../assets/sprites/defender-catapult.png';
import soldierUrl from '../assets/sprites/defender-soldier.png';
import catapultUrl from '../assets/sprites/enemy-catapult.png';
import chuckerUrl from '../assets/sprites/enemy-chucker.png';
import gruntUrl from '../assets/sprites/enemy-grunt.png';
import ogreUrl from '../assets/sprites/enemy-ogre.png';
import riderUrl from '../assets/sprites/enemy-rider.png';
import warlordUrl from '../assets/sprites/enemy-warlord.png';
import { Terrain } from './terrain';
import { GroundCanvas, type SpriteArt, blobTexture, detailTexture, handTexture, imageSprite, loadImage, metalShieldTexture } from './textures';

/**
 * Draws the sim in 2.5D: a voxel castle on a 3D battlefield under a tilted
 * camera, with flat sprite units. Sim (x, y) maps to world (x, 0, -y); the
 * castle sits at z 0 and above (its courtyard runs toward the camera), and
 * the enemies march in from negative z.
 */

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

/** What each quality level costs: render resolution, ground texture width, terrain grid spacing, debris cap. */
const QUALITY: Record<Quality, { pixelRatio: number; groundWidth: number; cell: number; debris: number; upload: number }> = {
  low: { pixelRatio: 1, groundWidth: 768, cell: 1, debris: 400, upload: 0.5 },
  medium: { pixelRatio: 1.5, groundWidth: 1280, cell: 0.6, debris: 900, upload: 0.25 },
  high: { pixelRatio: 2, groundWidth: 2048, cell: 0.4, debris: 1500, upload: 0.15 },
};

const VOXEL = 0.5;
const MAX_ENEMIES = 4000;
const MAX_PROJECTILES = 2500;
const MAX_DEBRIS = 1500;
const MAX_ARCHERS = 20 * 30;

/** Sprite height relative to the orc grunt (and defenders), from the art guide. */
const SIZE: Record<EnemyKind, number> = { grunt: 1, chucker: 1, rider: 1.4, orcCatapult: 2, ogre: 2.5, warlord: 3 };
const KILL_COLOR: Record<EnemyKind, string> = {
  grunt: '#6f9a3c', chucker: '#8a9a42', rider: '#6d4a32', orcCatapult: '#7a5530', ogre: '#8d9a6a', warlord: '#5d8a34',
};
/** Kinds that climb the wall before hacking at it (the rest smash it from the ground). */
const CLIMBERS = new Set<EnemyKind>(['grunt', 'chucker', 'rider']);

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

interface Effect {
  kind: 'hand' | 'ring' | 'flash' | 'parry' | 'explosion' | 'impact';
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
  private shieldBase: THREE.Mesh;
  private shieldLift = 0;
  private shieldJolt = 0;
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
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
      const mat = new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5 });
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    const art: Record<EnemyKind, SpriteArt> = {
      grunt: imageSprite(gruntUrl, aspects['enemy-grunt']),
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

    // The royal shield: a huge slab of steel in the castle's blue and gold, hauled up over the battlements.
    const sh = game.cfg.shield;
    const shieldArt = metalShieldTexture();
    const shieldW = sh.halfWidth * 2.1;
    const shieldGeo = new THREE.PlaneGeometry(shieldW, shieldW / shieldArt.aspect);
    shieldGeo.translate(0, shieldW / shieldArt.aspect / 2, 0);
    this.shieldMesh = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ map: shieldArt.texture, alphaTest: 0.5 }));
    this.shieldMesh.position.set(0, 0, -sh.y);
    this.scene.add(this.shieldMesh);
    this.shieldBase = new THREE.Mesh(
      new THREE.PlaneGeometry(sh.halfWidth * 2, 0.3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.shieldBase.position.set(0, 0.06, -sh.y);
    this.scene.add(this.shieldBase);

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
  }

  /** Changes the quality level: render resolution, ground detail and terrain smoothness. Clears marks on the ground. */
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[q].pixelRatio));
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
    for (const ev of events) {
      switch (ev.type) {
        case 'slap':
          this.spawnEffect('hand', ev.x, -ev.y, 0.35);
          this.spawnEffect('ring', ev.x, -ev.y, 0.4);
          this.ground.stamp(ev.x, -ev.y, 3.2, 'rgba(70,50,25,0.45)');
          this.terrain.crater(ev.x, -ev.y, 1.4, 0.15);
          this.shake = Math.max(this.shake, 0.5);
          break;
        case 'kill': {
          const big = SIZE[ev.kind];
          if (big >= 2) {
            this.ground.decal(ev.x, -ev.y, big, this.scorch, 0.75);
            this.terrain.crater(ev.x, -ev.y, big * 0.8, 0.4);
          } else if (Math.random() < 0.5) {
            this.ground.stamp(ev.x, -ev.y, 0.9 * big, 'rgba(60,70,20,0.5)');
          }
          this.burst(ev.x, 0.6 * big, -ev.y, big >= 2 ? Math.round(4 * big) : 2, KILL_COLOR[ev.kind], 4 + big);
          break;
        }
        case 'splash':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.45, ev.radius);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.6, this.crater, 0.8);
          this.terrain.crater(ev.x, -ev.y, ev.radius * 0.55, 0.55);
          this.burst(ev.x, 0.4, -ev.y, 6, '#9a8f78', 6);
          this.shake = Math.max(this.shake, 0.2);
          break;
        case 'soldierDown':
          this.burst(ev.x, 0.6, -ev.y, 3, '#2f56b0', 4);
          break;
        case 'bossKilled':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.8, 6);
          this.terrain.crater(ev.x, -ev.y, 4, 1);
          this.shake = Math.max(this.shake, 1);
          break;
        case 'deflect':
          // Clang: sparks off the steel, a jolt and a thump of camera shake.
          this.spawnEffect(ev.parry ? 'parry' : 'flash', ev.x, -ev.y, ev.parry ? 0.3 : 0.15);
          this.sparks(ev.x, 2.6, -ev.y, ev.parry ? 18 : 10);
          this.shieldJolt = ev.parry ? 1 : 0.7;
          this.shake = Math.max(this.shake, ev.parry ? 0.5 : 0.3);
          break;
        case 'hit':
          if (Math.random() < 0.3) this.burst(ev.x, 0.8, -ev.y, 1, '#d9d0b0', 3);
          if (this.effects.length < 30 && Math.random() < 0.3) this.spawnEffect('impact', ev.x, -ev.y, 0.2, 0.9);
          break;
        case 'wallHit':
          this.burst(ev.x, 2.5, 0, 3, '#8c8a80', 5);
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

    const s = g.shield;
    this.shieldMesh.position.x = s.x;
    this.shieldBase.position.x = s.x;
    // Heaved up fast when raised, with a jolt when something clangs off it.
    this.shieldLift = s.raised ? Math.min(1, this.shieldLift + dt * 12) : Math.max(0, this.shieldLift - dt * 8);
    this.shieldJolt = Math.max(0, this.shieldJolt - dt * 6);
    this.shieldMesh.visible = this.shieldLift > 0;
    this.shieldMesh.position.y = 1.2 * this.shieldLift - 1.2 + this.shieldJolt * 0.35;
    this.shieldMesh.scale.setScalar(0.85 + this.shieldLift * 0.15);
    this.shieldMesh.quaternion.copy(this.camera.quaternion).multiply(tmpQ2.setFromAxisAngle(FORWARD, this.shieldJolt * 0.04 * Math.sin(time * 60)));
    (this.shieldBase.material as THREE.MeshBasicMaterial).color.set(s.locked ? '#ff8a7a' : '#f2c14e');

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
      mesh.setColorAt(i, burning ? tmpC.setRGB(1, 0.6, 0.3) : tmpC.setRGB(1, hurt, hurt));
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
    } else if (kind === 'explosion' || kind === 'impact') {
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
    obj.position.set(x, kind === 'hand' ? 8 : kind === 'explosion' ? size * 0.6 : kind === 'impact' ? 1.2 : 0.1, z);
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
      } else if (fx.kind === 'explosion' || fx.kind === 'impact') {
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
