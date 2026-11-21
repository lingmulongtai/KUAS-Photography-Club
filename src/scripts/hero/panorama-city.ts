import * as THREE from 'three';
import type { CitySurface, Eye, PanoramaTerrain, VisibleSurface } from './panorama-visibility';

type BuildingMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const perHouse = ['iPos', 'iSize', 'iRot', 'iMeta'];

function snapshot(mesh: BuildingMesh): CitySurface {
  const geometry = mesh.geometry;
  const array = (name: string) => geometry.getAttribute(name).array as Float32Array;
  if (!geometry.hasAttribute('iPos')) return { positions: array('position'), info: array('aInfo') };
  return {
    shape: {
      positions: array('position'), normals: array('normal'), roles: array('aRole'),
      levels: geometry.getAttribute('aLevel')?.array as Float32Array | undefined,
      indices: geometry.index!.array as Uint16Array,
      stepped: !!mesh.material.defines.STEPPED, overview: !!mesh.material.defines.BLOCK_OVERVIEW,
    },
    pos: array('iPos'), size: array('iSize'), rot: array('iRot'), meta: array('iMeta'),
  };
}

function visibleMeshes(mesh: BuildingMesh, surface: VisibleSurface): THREE.Mesh[] {
  function bind(geometry: THREE.BufferGeometry, indices: Uint32Array | Uint16Array) {
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      if (!perHouse.includes(name)) geometry.setAttribute(name, attribute);
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = mesh.geometry.boundingSphere;
    geometry.boundingBox = mesh.geometry.boundingBox;
    return new THREE.Mesh(geometry, mesh.material);
  }
  if ('indices' in surface) return surface.indices.length ? [bind(new THREE.BufferGeometry(), surface.indices)] : [];
  return surface.batches.map(batch => {
    const geometry = new THREE.InstancedBufferGeometry();
    for (const name of perHouse) {
      const { array, itemSize } = mesh.geometry.getAttribute(name);
      const values = new Float32Array(batch.houses.length * itemSize);
      for (let i = 0; i < batch.houses.length; i++) {
        const k = batch.houses[i] * itemSize;
        for (let j = 0; j < itemSize; j++) values[i * itemSize + j] = array[k + j];
      }
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(values, itemSize));
    }
    geometry.instanceCount = batch.houses.length;
    const part = bind(geometry, batch.indices);
    if (batch.bounds) {
      part.userData.sector = new THREE.Box3(new THREE.Vector3().fromArray(batch.bounds), new THREE.Vector3().fromArray(batch.bounds, 3));
    }
    return part;
  });
}

/** Reuse original building shaders and roof shapes. Only the colour pass from this eye
 * may omit hidden faces. Flights, exploration and the sun's shadow map use the full city. */
export function createPanoramaCity(roots: THREE.Group[], origin: Eye, terrain?: { position: THREE.BufferAttribute; river: readonly number[] }) {
  const group = new THREE.Group();
  const projection = new THREE.Matrix4(), frustum = new THREE.Frustum();
  group.name = 'Shogunzuka visible city';
  group.visible = false;
  const entries: { mesh: BuildingMesh; ancestors: THREE.Object3D[] }[] = [];
  for (const root of roots) root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const g = object.geometry;
    if (!(g.hasAttribute('iPos') && g.hasAttribute('aRole')) &&
        !(g.hasAttribute('aWall') && g.hasAttribute('aInfo') && !g.index)) return;
    const ancestors: THREE.Object3D[] = [];
    for (let parent = object.parent; parent; parent = parent.parent) {
      ancestors.push(parent);
      if (parent === root) break;
    }
    entries.push({ mesh: object as BuildingMesh, ancestors });
  });
  let signature: BuildingMesh[] = [], ready = false, worker: Worker | undefined;
  let terrainPositions: Float32Array | undefined;
  const clear = () => {
    for (const child of group.children) {
      const g = (child as THREE.Mesh).geometry;
      // The original city owns the shared vertex buffers, including after a zoom or resize.
      for (const name of Object.keys(g.attributes)) if (!perHouse.includes(name)) g.deleteAttribute(name);
      g.dispose();
    }
    group.clear();
    ready = false;
  };
  function prepare(active: BuildingMesh[]) {
    worker?.terminate();
    worker = undefined;
    clear();
    signature = active;
    terrainPositions = terrain?.position.array as Float32Array | undefined;
    if (!active.length || typeof Worker === 'undefined') return;
    try {
      const job = new Worker(new URL('./panorama-visibility.worker.ts', import.meta.url), { type: 'module' });
      worker = job;
      job.onmessage = ({ data }: MessageEvent<VisibleSurface[]>) => {
        if (worker !== job) return;
        job.terminate(); worker = undefined;
        for (let i = 0; i < data.length; i++) {
          for (const mesh of visibleMeshes(active[i], data[i])) group.add(mesh);
        }
        ready = true;
      };
      job.onerror = () => { job.terminate(); if (worker === job) worker = undefined; };
      // Clone the inputs. Their GPU buffers remain live while the worker builds the colour mesh.
      const ground: PanoramaTerrain | undefined = terrain && terrainPositions ? { positions: terrainPositions, river: terrain.river } : undefined;
      job.postMessage({ eye: { x: origin.x, y: origin.y, z: origin.z }, sources: active.map(snapshot), terrain: ground });
    } catch {
      worker?.terminate(); worker = undefined;
    }
  }
  function prepareVisible(){
    const active: BuildingMesh[] = [];
    for (const { mesh, ancestors } of entries) {
      if (mesh.visible && mesh.layers.isEnabled(0) && ancestors.every(parent => parent.visible)) active.push(mesh);
    }
    if (terrain?.position.array !== terrainPositions || active.length !== signature.length ||
        active.some((mesh, i) => mesh !== signature[i])) prepare(active);
    return active;
  }
  return { group, prepare:prepareVisible, render(camera: THREE.PerspectiveCamera, draw: () => void) {
    const eye = camera.position;
    if (eye.x !== origin.x || eye.y !== origin.y || eye.z !== origin.z) { draw(); return; }
    const active=prepareVisible();
    if (!ready) { draw(); return; }
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    for (const part of group.children) part.visible = !part.userData.sector || frustum.intersectsBox(part.userData.sector);
    for (const mesh of active) mesh.visible = false;
    group.visible = true;
    try { draw(); } finally {
      group.visible = false;
      for (const mesh of active) mesh.visible = true;
    }
  } };
}
