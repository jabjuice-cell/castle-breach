import * as THREE from 'three';
import type { Enemy, Game, GameEvent } from '../sim/game';
import { GroundCanvas, blobTexture, handTexture, orcTexture } from './textures';

/**
 * Draws the sim in 2.5D: voxel castle and terrain under a tilted camera,
 * flat sprite enemies. Sim (x, y) maps to world (x, 0, -y); the castle sits
 * near z = 0 and the enemies march in from negative z.
 */

const VOXEL = 0.5;
const MAX_ENEMIES = 4000;
const MAX_PROJECTILES = 1500;
const MAX_DEBRIS = 1500;

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
  kind: 'hand' | 'ring' | 'flash' | 'parry';
  x: number;
  z: number;
  t: number;
  duration: number;
  obj: THREE.Object3D;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
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

  private sprites: Record<Enemy['kind'], THREE.InstancedMesh>;
  private shadows: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private bolts: THREE.InstancedMesh;
  private debrisMesh: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private effects: Effect[] = [];
  private handTex = handTexture();

  private shieldMesh: THREE.Mesh;
  private shieldBase: THREE.Mesh;
  private crossbow: THREE.Group;
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
    this.ground = new GroundCanvas(hw * 2 + 8, maxZ - minZ, minZ);
    const groundGeo = new THREE.PlaneGeometry(this.ground.worldW, this.ground.worldH);
    groundGeo.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: this.ground.texture }));
    this.groundMesh.position.set(0, 0, (minZ + maxZ) / 2);
    this.scene.add(this.groundMesh);
    this.addHills(minZ);

    this.buildCastle();

    const spriteGeo = new THREE.PlaneGeometry(1.6, 2);
    spriteGeo.translate(0, 1, 0);
    const makeSprites = (kind: Enemy['kind']) => {
      const mat = new THREE.MeshBasicMaterial({ map: orcTexture(kind), alphaTest: 0.5 });
      const mesh = new THREE.InstancedMesh(spriteGeo, mat, MAX_ENEMIES);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMIES * 3).fill(1), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.sprites = { grunt: makeSprites('grunt'), chucker: makeSprites('chucker') };

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

    this.rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.32),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      MAX_PROJECTILES,
    );
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJECTILES * 3), 3);
    this.rocks.frustumCulled = false;
    this.scene.add(this.rocks);

    const boltGeo = new THREE.BoxGeometry(0.12, 0.12, 1.6);
    this.bolts = new THREE.InstancedMesh(boltGeo, new THREE.MeshLambertMaterial({ color: '#5a3d22' }), MAX_PROJECTILES);
    this.bolts.frustumCulled = false;
    this.scene.add(this.bolts);

    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL * 0.8, VOXEL * 0.8, VOXEL * 0.8),
      new THREE.MeshLambertMaterial(),
      MAX_DEBRIS,
    );
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);

    const sh = game.cfg.shield;
    this.shieldMesh = new THREE.Mesh(
      new THREE.BoxGeometry(sh.halfWidth * 2, 2.2, 0.15),
      new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.shieldMesh.position.set(0, 1.1, -sh.y);
    this.scene.add(this.shieldMesh);
    this.shieldBase = new THREE.Mesh(
      new THREE.PlaneGeometry(sh.halfWidth * 2, 0.25).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#c9eeff', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.shieldBase.position.set(0, 0.04, -sh.y);
    this.scene.add(this.shieldBase);

    this.crossbow = this.buildCrossbow();
    this.scene.add(this.crossbow);

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
    this.debris = [];
    for (const fx of this.effects) this.scene.remove(fx.obj);
    this.effects = [];
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
        case 'kill':
          this.ground.stamp(ev.x, -ev.y, 0.9, 'rgba(60,70,20,0.5)');
          this.burst(ev.x, 0.6, -ev.y, 4, ev.kind === 'grunt' ? '#6f9a3c' : '#8a9a42', 4);
          break;
        case 'deflect':
          this.spawnEffect(ev.parry ? 'parry' : 'flash', ev.x, -ev.y, ev.parry ? 0.35 : 0.2);
          if (ev.parry) this.shake = Math.max(this.shake, 0.35);
          break;
        case 'hit':
          this.burst(ev.x, 0.8, -ev.y, 2, '#d9d0b0', 3);
          break;
        case 'wallHit':
          this.burst(ev.x, 2.5, 0, 3, '#8c8a80', 5);
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
    this.updateCastle();
    this.updateEnemies(time);
    this.updateProjectiles();
    this.updateDebris(dt);
    this.updateEffects(dt);

    const s = g.shield;
    this.shieldMesh.position.x = s.x;
    this.shieldBase.position.x = s.x;
    const mat = this.shieldMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = s.raised ? 0.5 + Math.sin(time * 30) * 0.05 : 0;
    this.shieldMesh.scale.y = s.raised ? 1 : 0.01;
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

  private buildCrossbow(): THREE.Group {
    const group = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 2.4), wood);
    stock.position.z = -0.6;
    const arms = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 0.3), wood);
    arms.position.z = -1.6;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.6, 8), new THREE.MeshLambertMaterial({ color: '#4d4a44' }));
    base.position.y = -0.4;
    group.add(stock, arms, base);
    group.position.set(this.game.cfg.crossbow.x, 4.9, 0.9);
    return group;
  }

  // ---- units ---------------------------------------------------------------

  private updateEnemies(time: number) {
    const camQ = this.camera.quaternion;
    const counts = { grunt: 0, chucker: 0 };
    let shadowN = 0;
    let target: Enemy | undefined;
    for (const e of this.game.enemies) {
      if (!target || e.y < target.y) target = e;
      const mesh = this.sprites[e.kind];
      const i = counts[e.kind]++;
      if (i >= MAX_ENEMIES) continue;
      const moving = e.state === 'march';
      const bob = moving ? Math.abs(Math.sin(time * 9 + e.phase * 20)) * 0.18 : 0;
      // Orcs at the wall scramble up the stones, then hack away at the top.
      const c = this.game.cfg[e.kind];
      const climb =
        e.state === 'climb' ? (1 - e.timer / c.climbSeconds) * 3 + Math.sin(time * 12 + e.phase * 9) * 0.1
        : e.state === 'wall' ? 3 + Math.abs(Math.sin(time * 6 + e.phase * 9)) * 0.25
        : 0;
      const hurt = e.hp < e.maxHp ? 0.75 : 1;
      tmpV.set(e.x, bob + climb, -e.y);
      tmpS.set(e.kind === 'grunt' ? 1 : 0.9, 1, 1);
      mesh.setMatrixAt(i, tmpM.compose(tmpV, camQ, tmpS));
      mesh.setColorAt(i, tmpC.setRGB(1, hurt, hurt));
      this.shadows.setMatrixAt(shadowN++, tmpM.makeTranslation(e.x, 0, -e.y + 0.1));
    }
    for (const kind of ['grunt', 'chucker'] as const) {
      const mesh = this.sprites[kind];
      mesh.count = Math.min(counts[kind], MAX_ENEMIES);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;

    if (target) {
      const dx = target.x - this.crossbow.position.x;
      const dz = -target.y - this.crossbow.position.z;
      this.crossbow.rotation.y = Math.atan2(-dx, -dz);
    }
  }

  private updateProjectiles() {
    let r = 0;
    let b = 0;
    for (const p of this.game.projectiles) {
      if (p.kind === 'rock') {
        if (r >= MAX_PROJECTILES) continue;
        // Hostile rocks fly in an arc; deflected ones skim back low and fast.
        const t = Math.min(1, p.travelled / p.flight);
        const h = p.friendly ? 1 : 1.2 + 4 * (p.flight * 0.12) * t * (1 - t);
        this.rocks.setMatrixAt(r, tmpM.makeTranslation(p.x, h, -p.y));
        this.rocks.setColorAt(r, tmpC.set(p.friendly ? '#9fe0ff' : '#8a857a'));
        r++;
      } else {
        if (b >= MAX_PROJECTILES) continue;
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-p.vx, p.vy));
        this.bolts.setMatrixAt(b++, tmpM.compose(tmpV.set(p.x, 1.6, -p.y), tmpQ, tmpS.set(1, 1, 1)));
      }
    }
    this.rocks.count = r;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
    this.bolts.count = b;
    this.bolts.instanceMatrix.needsUpdate = true;
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

  private spawnEffect(kind: Effect['kind'], x: number, z: number, duration: number) {
    let obj: THREE.Object3D;
    if (kind === 'hand') {
      const geo = new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2);
      obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.handTex, alphaTest: 0.5, side: THREE.DoubleSide }));
    } else if (kind === 'ring') {
      obj = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#fff1c7', transparent: true, depthWrite: false }),
      );
    } else {
      obj = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 8),
        new THREE.MeshBasicMaterial({ color: kind === 'parry' ? '#ffd76a' : '#d8f4ff', transparent: true, depthWrite: false }),
      );
    }
    obj.position.set(x, kind === 'hand' ? 8 : 0.1, z);
    this.scene.add(obj);
    this.effects.push({ kind, x, z, t: 0, duration, obj });
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
        const r = 0.5 + u * this.game.cfg.slap.radius * 1.1;
        fx.obj.scale.set(r, 1, r);
        mat.opacity = 1 - u;
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
