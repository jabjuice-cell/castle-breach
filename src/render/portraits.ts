import * as THREE from 'three';
import { DEFENDER_KINDS } from '../sim/defenders';
import { archerModel, ballistaModel, bigBallistaModel, castleCatapultModel, mageModel, oilModel, soldierModel, spikeTrapModel, towerModel } from './models';
import { VoxBatch, type Vox } from './voxels';

const MODELS: Record<string, () => Vox> = {
  crossbow: ballistaModel,
  archers: archerModel,
  catapult: castleCatapultModel,
  soldiers: soldierModel,
  mage: mageModel,
  ballista: bigBallistaModel,
  oil: oilModel,
  spiketrap: spikeTrapModel,
  tower: towerModel,
};

const SIZE = 96;

/**
 * Shop-card portraits: each defender's voxel model (and a one-storey tower) drawn once, from
 * three-quarters above and in front, as PNG data URLs keyed by kind. Empty if WebGL is missing.
 */
export function defenderPortraits(): Record<string, string> {
  const out: Record<string, string> = {};
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#e8f2ff', '#4a5a30', 1.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-4, 8, -6);
    scene.add(sun);
    for (const kind of [...DEFENDER_KINDS, 'tower']) {
      const make = MODELS[kind];
      if (!make) continue;
      const { solid, glow } = new VoxBatch().add(make(), 1, new THREE.Vector3()).geometries();
      const group = new THREE.Group();
      const box = new THREE.Box3();
      for (const [g, lit] of [[solid, true], [glow, false]] as const) {
        if (!g) continue;
        box.union(g.boundingBox!);
        group.add(new THREE.Mesh(g, lit ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshBasicMaterial({ vertexColors: true })));
      }
      scene.add(group);
      const centre = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      // Models face -z, so look from the -z side, a little to the right and well above.
      const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, r * 10);
      cam.position.copy(centre).add(new THREE.Vector3(0.55, 0.6, -1).normalize().multiplyScalar(r * 4));
      cam.lookAt(centre);
      renderer.render(scene, cam);
      out[kind] = renderer.domElement.toDataURL('image/png');
      scene.remove(group);
      for (const m of group.children as THREE.Mesh[]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
  } catch {
    return {};
  } finally {
    renderer?.dispose();
  }
  return out;
}
