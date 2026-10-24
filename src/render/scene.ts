import * as THREE from 'three';
import type { DefenderKind, Slot } from '../sim/defenders';
import type { Game, GameEvent } from '../sim/game';
import { ENEMY_KINDS, type EnemyKind } from '../sim/waves';
import aspects from '../assets/aspects.json';
import towerUrl from '../assets/castle/tower-crossbow.png';
import arrowUrl from '../assets/fx/arrow.png';
import boulderUrl from '../assets/fx/boulder.png';
import explosionUrl from '../assets/fx/explosion.png';
import impactUrl from '../assets/fx/impact.png';
import rockUrl from '../assets/fx/rock.png';
import shieldArcUrl from '../assets/fx/shield-arc.png';
import stoneUrl from '../assets/fx/stone.png';
import craterUrl from '../assets/maps/crater.png';
import forestWornUrl from '../assets/maps/forest-worn.jpg';
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
import { GroundCanvas, type SpriteArt, blobTexture, handTexture, imageSprite, loadImage } from './textures';

/**
 * Draws the sim in 2.5D: voxel castle and terrain under a tilted camera,
 * flat sprite enemies. Sim (x, y) maps to world (x, 0, -y); the castle sits
 * near z = 0 and the enemies march in from negative z.
 */

const VOXEL = 0.5;
const MAX_ENEMIES = 4000;
const MAX_PROJECTILES = 1500;
const MAX_DEBRIS = 1500;

/** Sprite height relative to the orc grunt (and defenders), from the art guide. */
const SIZE: Record<EnemyKind, number> = { grunt: 1, chucker: 1, rider: 1.4, orcCatapult: 2, ogre: 2.5, warlord: 3 };
const KILL_COLOR: Record<EnemyKind, string> = {
  grunt: '#6f9a3c', chucker: '#8a9a42', rider: '#6d4a32', orcCatapult: '#7a5530', ogre: '#8d9a6a', warlord: '#5d8a34',
};
/** Kinds that climb the wall before hacking at it (the rest smash it from the ground). */
const CLIMBERS = new Set<EnemyKind>(['grunt', 'chucker', 'rider']);

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
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private ground: GroundCanvas;
  private groundMesh: THREE.Mesh;

  private voxels!: THREE.InstancedMesh;
  private voxelPos: THREE.Vector3[] = [];
  private voxelColor: THREE.Color[] = [];
  private segments: VoxelGroup[] = [];

  private sprites = {} as Record<EnemyKind, THREE.InstancedMesh>;
  private soldierSprites: THREE.InstancedMesh;
  private archerArt: SpriteArt;
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
  /** One model per slot, rebuilt when the slot's defender changes. */
  private defenders: { kind: DefenderKind | null; obj: THREE.Group | null; marker: THREE.Mesh }[] = [];
  private cursor: THREE.Mesh;
  private shake = 0;
  private camBase = new THREE.Vector3(0, 40, 36);
  private camLook = new THREE.Vector3(0, 0, -22);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color('#9cc4d8');
    this.scene.fog = new THREE.Fog('#9cc4d8', 70, 130);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 300);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    this.scene.add(new THREE.HemisphereLight('#e8f2ff', '#4a5a30', 1.6));
    const sun = new THREE.DirectionalLight('#fff1d6', 1.8);
    sun.position.set(-20, 40, 15);
    this.scene.add(sun);

    const hw = game.cfg.field.halfWidth;
    const minZ = -(game.cfg.field.spawnY + 12);
    const maxZ = 18;
    this.ground = new GroundCanvas(hw * 2 + 8, maxZ - minZ, minZ, forestUrl, forestWornUrl);
    const groundGeo = new THREE.PlaneGeometry(this.ground.worldW, this.ground.worldH);
    groundGeo.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: this.ground.texture }));
    this.groundMesh.position.set(0, 0, (minZ + maxZ) / 2);
    this.scene.add(this.groundMesh);
    this.addHills(minZ);

    this.buildCastle();

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
    for (const kind of ENEMY_KINDS) this.sprites[kind] = makeSprites(art[kind], SIZE[kind], kind === 'grunt' ? MAX_ENEMIES : 600);
    this.soldierSprites = makeSprites(imageSprite(soldierUrl, aspects['defender-soldier']), 1, 64);
    this.archerArt = imageSprite(archerUrl, aspects['defender-archer']);

    const shadowGeo = new THREE.PlaneGeometry(1.3, 0.8);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      MAX_ENEMIES + MAX_PROJECTILES,
    );
    this.shadows.frustumCulled = false;
    this.shadows.position.y = 0.02;
    this.scene.add(this.shadows);

    this.thrown = {
      rock: makeSprites(imageSprite(rockUrl, aspects.rock), 0.4, MAX_PROJECTILES, true),
      boulder: makeSprites(imageSprite(boulderUrl, aspects.boulder), 0.8, 200, true),
      stone: makeSprites(imageSprite(stoneUrl, aspects.stone), 0.6, 200, true),
    };
    const arrowArt = imageSprite(arrowUrl, aspects.arrow);
    const makeFlat = (length: number, max: number) => {
      // Lies on the ground plane with the arrowhead pointing along -z (away from the castle).
      const geo = new THREE.PlaneGeometry(length * arrowArt.aspect, length).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: arrowArt.texture, alphaTest: 0.5, side: THREE.DoubleSide }), max);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.bolts = makeFlat(2.6, 300);
    this.arrows = makeFlat(1.3, MAX_PROJECTILES);

    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL * 0.8, VOXEL * 0.8, VOXEL * 0.8),
      new THREE.MeshLambertMaterial(),
      MAX_DEBRIS,
    );
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);

    const sh = game.cfg.shield;
    const arc = imageSprite(shieldArcUrl, aspects['shield-arc']);
    const arcW = sh.halfWidth * 2.3;
    this.shieldMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(arcW, arcW / arc.aspect),
      new THREE.MeshBasicMaterial({ map: arc.texture, transparent: true, depthWrite: false }),
    );
    this.shieldMesh.position.set(0, 1.4, -sh.y);
    this.scene.add(this.shieldMesh);
    this.shieldBase = new THREE.Mesh(
      new THREE.PlaneGeometry(sh.halfWidth * 2, 0.25).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#c9eeff', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.shieldBase.position.set(0, 0.04, -sh.y);
    this.scene.add(this.shieldBase);

    this.buildSlots();

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(game.cfg.slap.radius - 0.15, game.cfg.slap.radius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff4c2', transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.cursor.position.y = 0.05;
    this.scene.add(this.cursor);
  }

  /** Swaps in a fresh game (after a restart) and rebuilds the castle. */
  setGame(game: Game) {
    this.game = game;
    this.scene.remove(this.voxels);
    this.voxels.dispose();
    this.voxelPos = [];
    this.voxelColor = [];
    this.segments = [];
    this.buildCastle();
    this.ground.reset();
    this.lastWave = -1;
    this.debris = [];
    for (const fx of this.effects) this.scene.remove(fx.obj);
    this.effects = [];
    for (const d of this.defenders) {
      if (d.obj) this.scene.remove(d.obj);
      this.scene.remove(d.marker);
    }
    this.defenders = [];
    this.buildSlots();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the whole field stays in view.
    const pull = Math.max(1, 1.3 / this.camera.aspect);
    this.camBase.set(0, 40 * pull, 36 * pull);
    this.camera.updateProjectionMatrix();
  }

  /** Converts a screen point to sim coordinates on the ground, or null if off the field. */
  pick(ndcX: number, ndcY: number): { x: number; y: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, tmpV);
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  /** Projects a sim point to screen pixels, for HTML labels. */
  project(x: number, y: number, height = 0): { x: number; y: number } {
    tmpV.set(x, height, -y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((tmpV.x + 1) / 2) * r.width, y: ((1 - tmpV.y) / 2) * r.height };
  }

  setCursor(x: number, y: number, ready: boolean) {
    this.cursor.position.x = x;
    this.cursor.position.z = -y;
    (this.cursor.material as THREE.MeshBasicMaterial).opacity = ready ? 0.55 : 0.15;
  }

  handleEvents(events: GameEvent[]) {
    for (const ev of events) {
      switch (ev.type) {
        case 'slap':
          this.spawnEffect('hand', ev.x, -ev.y, 0.35);
          this.spawnEffect('ring', ev.x, -ev.y, 0.4);
          this.ground.stamp(ev.x, -ev.y, 3.2, 'rgba(70,50,25,0.45)');
          this.shake = Math.max(this.shake, 0.5);
          break;
        case 'kill': {
          const big = SIZE[ev.kind];
          if (big >= 2) this.ground.decal(ev.x, -ev.y, big, this.scorch, 0.75);
          else this.ground.stamp(ev.x, -ev.y, 0.9 * big, 'rgba(60,70,20,0.5)');
          this.burst(ev.x, 0.6 * big, -ev.y, Math.round(4 * big), KILL_COLOR[ev.kind], 4 + big);
          break;
        }
        case 'splash':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.45, ev.radius);
          this.ground.decal(ev.x, -ev.y, ev.radius * 0.6, this.crater, 0.8);
          this.burst(ev.x, 0.4, -ev.y, 6, '#9a8f78', 6);
          this.shake = Math.max(this.shake, 0.2);
          break;
        case 'soldierDown':
          this.burst(ev.x, 0.6, -ev.y, 4, '#2f56b0', 4);
          break;
        case 'bossKilled':
          this.spawnEffect('explosion', ev.x, -ev.y, 0.8, 6);
          this.shake = Math.max(this.shake, 1);
          break;
        case 'deflect':
          this.spawnEffect(ev.parry ? 'parry' : 'flash', ev.x, -ev.y, ev.parry ? 0.35 : 0.2);
          if (ev.parry) this.shake = Math.max(this.shake, 0.35);
          break;
        case 'hit':
          this.burst(ev.x, 0.8, -ev.y, 2, '#d9d0b0', 3);
          if (this.effects.length < 40) this.spawnEffect('impact', ev.x, -ev.y, 0.2, 0.9);
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
    // The field gets more trampled and cratered with every wave.
    if (g.wave !== this.lastWave) {
      if (this.lastWave >= 0 && g.wave > 0) this.ground.wear(0.07);
      this.lastWave = g.wave;
    }
    this.updateCastle();
    this.updateEnemies(time);
    this.updateSoldiers(time);
    this.updateDefenders(time);
    this.updateProjectiles();
    this.updateDebris(dt);
    this.updateEffects(dt);

    const s = g.shield;
    this.shieldMesh.position.x = s.x;
    this.shieldBase.position.x = s.x;
    const mat = this.shieldMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = s.raised ? 0.85 + Math.sin(time * 30) * 0.1 : 0;
    this.shieldMesh.visible = s.raised;
    this.shieldMesh.quaternion.copy(this.camera.quaternion);
    (this.shieldBase.material as THREE.MeshBasicMaterial).color.set(s.locked ? '#ff8a7a' : '#c9eeff');

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

  // ---- castle ---------------------------------------------------------------

  private buildCastle() {
    const cfg = this.game.cfg;
    const hw = cfg.field.halfWidth;
    const segW = (hw * 2) / cfg.wall.segments;
    const nx = Math.round(segW / VOXEL);
    const nz = Math.round(cfg.wall.depth / VOXEL);
    const ny = 8;
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const stone = (base: string, v: number) => new THREE.Color(base).offsetHSL(0, 0, (rnd() - 0.5) * v);

    const addGroup = (cells: { p: THREE.Vector3; c: THREE.Color }[]): VoxelGroup => {
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
      const cells: { p: THREE.Vector3; c: THREE.Color }[] = [];
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < ny; iy++) {
            cells.push({ p: new THREE.Vector3(x0 + (ix + 0.5) * VOXEL, (iy + 0.5) * VOXEL, (iz + 0.5) * VOXEL), c: stone('#a59f8f', 0.12) });
          }
          // Crenellations along the front edge.
          if (iz === 0 && ix % 4 < 2) {
            cells.push({ p: new THREE.Vector3(x0 + (ix + 0.5) * VOXEL, (ny + 0.5) * VOXEL, 0.5 * VOXEL), c: stone('#b3ad9c', 0.1) });
          }
        }
      }
      this.segments.push(addGroup(cells));
    }

    // The keep behind the wall: a low inner rampart with a tower. Scenery only; the wall is what you defend.
    const keepZ = 8;
    const cells: { p: THREE.Vector3; c: THREE.Color }[] = [];
    for (let ix = 0; ix < (hw * 2) / VOXEL; ix++) {
      for (let iz = 0; iz < 4; iz++) {
        for (let iy = 0; iy < 6; iy++) {
          cells.push({ p: new THREE.Vector3(-hw + (ix + 0.5) * VOXEL, (iy + 0.5) * VOXEL, keepZ + (iz + 0.5) * VOXEL), c: stone('#9a937f', 0.1) });
        }
      }
    }
    for (let ix = 0; ix < 12; ix++) {
      for (let iz = 0; iz < 8; iz++) {
        for (let iy = 6; iy < 18; iy++) {
          const roof = iy >= 16;
          cells.push({
            p: new THREE.Vector3(-3 + (ix + 0.5) * VOXEL, (iy + 0.5) * VOXEL, keepZ + 1 + (iz + 0.5) * VOXEL),
            c: roof ? stone('#8e3b2e', 0.08) : stone('#aaa392', 0.1),
          });
        }
      }
    }
    addGroup(cells);

    this.voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), new THREE.MeshLambertMaterial(), this.voxelPos.length);
    this.voxels.frustumCulled = false;
    for (let i = 0; i < this.voxelPos.length; i++) {
      this.voxels.setMatrixAt(i, tmpM.makeTranslation(this.voxelPos[i]));
      this.voxels.setColorAt(i, this.voxelColor[i]);
    }
    this.scene.add(this.voxels);
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

  private buildSlots() {
    for (const slot of this.game.slots) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.8, depthWrite: false }),
      );
      const p = this.slotPosition(slot);
      marker.position.set(p.x, p.y + 0.06, p.z);
      marker.visible = false;
      this.scene.add(marker);
      this.defenders.push({ kind: null, obj: null, marker });
    }
  }

  /** Where a slot's model stands in the world. */
  private slotPosition(slot: Slot): THREE.Vector3 {
    if (slot.kind === 'tower') return new THREE.Vector3(slot.x, 4.5, 0.9);
    if (slot.kind === 'pit') return new THREE.Vector3(slot.x, 0, -slot.y);
    return new THREE.Vector3(slot.x, 0, -slot.y);
  }

  private buildDefender(kind: DefenderKind): THREE.Group {
    const group = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
    const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };
    const billboard = (art: SpriteArt, h: number, x = 0, y = 0) => {
      const geo = new THREE.PlaneGeometry(h * art.aspect, h);
      geo.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: art.texture, alphaTest: 0.5 }));
      m.name = 'billboard';
      m.position.set(x, y, 0);
      group.add(m);
      return m;
    };
    if (kind === 'crossbow') {
      // A round crossbow tower rising out of the wall.
      billboard(this.towerArt, 5.2, 0, -2.6);
    } else if (kind === 'archers') {
      // Three bowmen on a wooden platform; the squad is bigger than it looks.
      box(2.6, 0.3, 1.6, wood, 0, 0, 0);
      const h = 2; // the art guide sizes archers like a grunt
      const geo = new THREE.PlaneGeometry(h * this.archerArt.aspect, h);
      geo.translate(0, h / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ map: this.archerArt.texture, alphaTest: 0.5 });
      for (const ox of [-0.9, 0, 0.9]) {
        const archer = new THREE.Mesh(geo, mat);
        archer.name = 'billboard';
        archer.position.set(ox, 0.15, 0);
        group.add(archer);
      }
    } else if (kind === 'catapult') {
      billboard(this.catapultArt, 4); // catapult scale 2
    }
    return group;
  }

  private updateDefenders(time: number) {
    const council = this.game.phase === 'council';
    this.game.slots.forEach((slot, i) => {
      const d = this.defenders[i];
      if (!d) return;
      d.marker.visible = council && !slot.defender;
      (d.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 4) * 0.3;
      if (d.kind !== slot.defender) {
        if (d.obj) this.scene.remove(d.obj);
        d.obj = slot.defender && slot.defender !== 'soldiers' ? this.buildDefender(slot.defender) : null;
        if (d.obj) {
          d.obj.position.copy(this.slotPosition(slot));
          this.scene.add(d.obj);
        }
        d.kind = slot.defender;
      }
      if (!d.obj) return;
      // Flat sprites always face the camera, like the orcs.
      for (const child of d.obj.children) if (child.name === 'billboard') child.quaternion.copy(this.camera.quaternion);
      if (slot.defender === 'catapult' || slot.defender === 'crossbow') {
        // Recoil when it fires: a quick squash that springs back.
        const c = this.game.cfg[slot.defender];
        const interval = c.interval / this.game.mult(slot.defender, 'rate');
        const since = interval - slot.timer;
        const kick = since >= 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) : 0;
        d.obj.scale.set(1 + kick * 0.08, 1 - kick * 0.1, 1);
      }
    });
  }

  private updateSoldiers(time: number) {
    const camQ = this.camera.quaternion;
    let n = 0;
    for (const s of this.game.soldiers) {
      if (s.hp <= 0) continue;
      const jab = Math.abs(Math.sin(time * 7 + s.x)) * 0.08;
      tmpV.set(s.x, jab, -s.y);
      tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, Math.sin(time * 3 + s.x) * 0.04));
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
      tmpV.set(e.x, bob + climb + pound + brawl, -e.y);
      tmpS.set(2 - squash, squash, 1);
      tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, roll));
      mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
      mesh.setColorAt(i, burning ? tmpC.setRGB(1, 0.6, 0.3) : tmpC.setRGB(1, hurt, hurt));
      if (shadowN < MAX_ENEMIES + MAX_PROJECTILES) {
        tmpS.set(size, 1, size);
        this.shadows.setMatrixAt(shadowN++, tmpM.compose(tmpV.set(e.x, 0, -e.y + 0.1), tmpQ.identity(), tmpS));
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
        const h = p.friendly && p.kind !== 'stone' ? 1 : 1.2 + 4 * (p.flight * arc) * t * (1 - t);
        tmpQ.copy(camQ).multiply(tmpQ2.setFromAxisAngle(FORWARD, p.travelled * 0.3));
        mesh.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
        mesh.setColorAt(i, p.friendly && p.kind !== 'stone' ? tmpC.setRGB(0.7, 0.9, 1) : tmpC.setRGB(1, 1, 1));
      } else {
        const arrow = p.kind === 'arrow';
        const mesh = arrow ? this.arrows : this.bolts;
        const i = arrow ? a++ : b++;
        if (i >= mesh.instanceMatrix.count) continue;
        tmpQ.setFromAxisAngle(UP, Math.atan2(-p.vx, p.vy));
        const h = arrow ? 1.5 + Math.sin(Math.min(1, p.travelled / 30) * Math.PI) * 2 : 1.6;
        mesh.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, h, -p.y), tmpQ, tmpS.set(1, 1, 1)));
      }
    }
    for (const kind of ['rock', 'boulder', 'stone'] as const) {
      const mesh = this.thrown[kind];
      mesh.count = Math.min(counts[kind], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.bolts.count = Math.min(b, this.bolts.instanceMatrix.count);
    this.bolts.instanceMatrix.needsUpdate = true;
    this.arrows.count = Math.min(a, this.arrows.instanceMatrix.count);
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  // ---- effects -------------------------------------------------------------

  private burst(x: number, y: number, z: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n && this.debris.length < MAX_DEBRIS; i++) {
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

  private updateDebris(dt: number) {
    const alive: Debris[] = [];
    for (const d of this.debris) {
      d.life -= dt;
      if (d.life <= 0) continue;
      d.vel.y -= 22 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < 0.15) {
        d.pos.y = 0.15;
        d.vel.multiplyScalar(0.4);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      alive.push(d);
    }
    this.debris = alive;
    alive.forEach((d, i) => {
      const sc = Math.min(1, d.life * 2);
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

  private addHills(minZ: number) {
    // Voxel-ish hills behind the spawn line and along the sides, to frame the field.
    const mat = new THREE.MeshLambertMaterial({ color: '#4f7a33' });
    const tree = new THREE.MeshLambertMaterial({ color: '#2f5a28' });
    const trunk = new THREE.MeshLambertMaterial({ color: '#5a4026' });
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const hw = this.game.cfg.field.halfWidth;
    for (let i = 0; i < 60; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (hw + 7 + rnd() * 14);
      const z = minZ + rnd() * (Math.abs(minZ) - 6);
      const h = 1 + rnd() * 4;
      const box = new THREE.Mesh(new THREE.BoxGeometry(4 + rnd() * 6, h, 4 + rnd() * 6), mat);
      box.position.set(x, h / 2 - 0.2, z);
      this.scene.add(box);
      if (rnd() < 0.7) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), trunk);
        t.position.set(x + (rnd() - 0.5) * 2, h + 0.75, z);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), tree);
        c.position.set(t.position.x, h + 2.2, z);
        this.scene.add(t, c);
      }
    }
  }
}
