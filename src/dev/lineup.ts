// Dev-only comparison page (lineup.html, not part of the build): the orcs as they were,
// beside their painted sprites, seen from the play camera's angle.
//   ?kinds=grunt,ogre   which kinds (default: all regular ones)
//   ?far=1              a marching block of each style at the real play distance
import * as THREE from 'three';
import type { EnemyKind } from '../sim/waves';
import { VoxelOrcs } from '../render/orcs';
import chuckerUrl from '../assets/sprites/enemy-chucker.webp';
import gruntUrl from '../assets/sprites/enemy-grunt.webp';
import ogreUrl from '../assets/sprites/enemy-ogre.webp';
import riderUrl from '../assets/sprites/enemy-rider.webp';
import runnerUrl from '../assets/sprites/enemy-runner.webp';

const params = new URLSearchParams(location.search);
const far = params.has('far');
const kinds = (params.get('kinds') ?? 'grunt,chucker,runner,barrel,rider,shieldOrc,drummer,orcCatapult,ogre').split(',') as EnemyKind[];
const SPRITES: Partial<Record<EnemyKind, string>> = { grunt: gruntUrl, chucker: chuckerUrl, ogre: ogreUrl, rider: riderUrl, runner: runnerUrl };
const SIZE: Partial<Record<EnemyKind, number>> = { grunt: 1, chucker: 1, barrel: 1, runner: 0.85, rider: 1.4, orcCatapult: 2, ogre: 2.5, shieldOrc: 1, drummer: 1.15 };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#87b8e0');
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6a2a, 1.4));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
sun.position.set(20, 50, 30);
scene.add(sun);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: '#5f9a3a' }));
grass.rotation.x = -Math.PI / 2;
scene.add(grass);

const newOrcs = new VoxelOrcs(scene, () => 64);
const m = new THREE.Matrix4();
const place = (mesh: THREE.InstancedMesh, x: number, z: number) => {
  mesh.setMatrixAt(mesh.count++, m.makeTranslation(x, 0, z));
  mesh.instanceMatrix.needsUpdate = true;
};
const loader = new THREE.TextureLoader();
const sprite = (kind: EnemyKind, x: number, z: number) => {
  const url = SPRITES[kind];
  if (!url) return;
  const tex = loader.load(url, (t) => {
    const img = t.image as HTMLImageElement;
    s.scale.set((h * img.width) / img.height, h, 1);
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  const h = 1.8 * (SIZE[kind] ?? 1);
  s.center.set(0.5, 0);
  s.position.set(x, 0, z);
  scene.add(s);
};

const labels: { text: string; at: THREE.Vector3 }[] = [];
let target: THREE.Vector3;
let dist: number;
if (far) {
  // One block each, as in a wave: the voxel models and the sprites.
  const styles = ['voxel', 'sprite'];
  const spacing = Number(params.get('spacing') ?? 2.1);
  styles.forEach((style, si) => {
    const cx = (si - 0.5) * 13;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const x = cx + (c - 2) * spacing;
        const z = r * spacing * 0.9;
        if (style === 'sprite') sprite('grunt', x, z);
        else place(newOrcs.meshes.grunt, x, z);
      }
    }
    if (style === 'sprite') sprite('ogre', cx, -4);
    else place(newOrcs.meshes.ogre, cx, -4);
    labels.push({ text: style, at: new THREE.Vector3(cx, 0, 6) });
  });
  target = new THREE.Vector3(0, 0, 0);
  dist = 70;
} else {
  // A pair per kind: the voxel model, then its sprite.
  let x = 0;
  for (const kind of kinds) {
    const w = kind === 'ogre' || kind === 'orcCatapult' ? 4.5 : kind === 'rider' ? 3.2 : 2.4;
    place(newOrcs.meshes[kind], x, 0);
    sprite(kind, x + w, 0);
    labels.push({ text: `${kind}${SPRITES[kind] ? ': voxel / sprite' : ''}`, at: new THREE.Vector3(x + w / 2, 0, 2.5) });
    x += 2 * w + 1.5;
  }
  target = new THREE.Vector3(x / 2 - 1, 1.2, 0);
  dist = Math.max(12, x * 1.05);
}
newOrcs.sync();

// The play camera looks down from (0, 64, 40) at (0, 0, -18).
const dir = new THREE.Vector3(0, 64, 58).normalize();
const camera = new THREE.PerspectiveCamera(far ? 52 : 40, innerWidth / innerHeight, 0.5, 600);
camera.position.copy(target).addScaledVector(dir, dist);
camera.lookAt(target);

const tags = labels.map((l) => {
  const d = document.createElement('div');
  d.className = 'label';
  d.textContent = l.text;
  document.body.appendChild(d);
  return d;
});
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  labels.forEach((l, i) => {
    const p = l.at.clone().project(camera);
    tags[i].style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    tags[i].style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  });
});
