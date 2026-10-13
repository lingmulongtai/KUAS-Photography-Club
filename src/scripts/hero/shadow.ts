import * as THREE from 'three';
import type { Env } from './env';

/** Layer for everything that casts a sun shadow. */
export const SHADOW_LAYER = 1;

/**
 * Sun shadows: a depth map rendered from the sun with an orthographic camera fitted around
 * the part of the city in view, reaching far enough toward the sun that the western mountains
 * throw their evening shadow across the basin. Re-rendered only when the sun or the region moves.
 * Objects with custom vertex shaders (the instanced buildings) bring their own depth material
 * in userData.depthMaterial.
 */
export function createSunShadow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, env: Env, size: number) {
  const target = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  camera.layers.set(SHADOW_LAYER);
  const fallback = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  env.uShadowMap.value = target.texture;
  env.uShadowTexel.value.set(1 / size, 1 / size);

  const region = new THREE.Box3(new THREE.Vector3(-7500, 0, -6000), new THREE.Vector3(3200, 450, 6000));
  const center = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const last = new THREE.Vector3(0, -1, 0);
  const white = new THREE.Color(1, 1, 1);
  const prevClear = new THREE.Color();
  let dirty = true;
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];

  function fit(sunDir: THREE.Vector3) {
    region.getCenter(center);
    camera.position.copy(center).addScaledVector(sunDir, 20000);
    camera.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.98) camera.up.set(0, 0, -1);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? region.max.x : region.min.x, i & 2 ? region.max.y : region.min.y, i & 4 ? region.max.z : region.min.z);
      corner.applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
      minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
    }
    camera.left = minX;
    camera.right = maxX;
    camera.bottom = minY;
    camera.top = maxY;
    // reach 16 km toward the sun so mountains between it and the city cast their shadows
    camera.near = Math.max(1, -maxZ - 16000);
    camera.far = -minZ + 50;
    camera.updateProjectionMatrix();
    env.uShadowMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    env.uShadowWorld.value = Math.max(maxX - minX, maxY - minY) / size;
    env.uShadowBias.value = 1.5 / (camera.far - camera.near);
  }

  return {
    /** Fit the shadow to a new part of the world (for the campus view). */
    setRegion(box: THREE.Box3) {
      region.copy(box);
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
    /** Re-render the shadow map if the sun moved; turn shadows off when the sun is down. */
    update(sunDir: THREE.Vector3) {
      const up = sunDir.y > 0.003;
      env.uShadowOn.value = up ? 1 : 0;
      if (!up) return;
      if (!dirty && last.dot(sunDir) > Math.cos(0.0012)) return;
      dirty = false;
      last.copy(sunDir);
      fit(sunDir);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !o.layers.isEnabled(SHADOW_LAYER)) return;
        swapped.push([m, m.material]);
        m.material = (o.userData.depthMaterial as THREE.Material | undefined) ?? fallback;
      });
      const prevTarget = renderer.getRenderTarget();
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(prevClear);
      const prevAutoClear = renderer.autoClear;
      renderer.setRenderTarget(target);
      renderer.setClearColor(white, 1);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(scene, camera);
      for (const [m, mat] of swapped) m.material = mat;
      swapped.length = 0;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAutoClear;
    },
  };
}
