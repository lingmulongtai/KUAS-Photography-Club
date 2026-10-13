import * as THREE from 'three';
import type { Env } from './env';
import { CITY } from './layout';

/** Layer used by everything that casts a sun shadow. */
export const SHADOW_LAYER = 1;

/**
 * Sun shadows for the city: a depth map rendered from the sun with an orthographic
 * camera fitted tightly around the basin, re-rendered only when the sun has moved.
 */
export function createSunShadow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, env: Env, size: number) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  camera.layers.set(SHADOW_LAYER);
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  env.uShadowMap.value = target.texture;
  env.uShadowTexel.value.set(1 / size, 1 / size);

  const center = new THREE.Vector3((CITY.minX + CITY.maxX) / 2 - 40, 0, (CITY.minZ + CITY.maxZ) / 2);
  const corners: THREE.Vector3[] = [];
  for (const x of [CITY.minX - 120, CITY.maxX + 110]) for (const y of [0, 70]) for (const z of [CITY.minZ - 60, CITY.maxZ + 60]) corners.push(new THREE.Vector3(x, y, z));
  const last = new THREE.Vector3(0, -1, 0);
  const v = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  const prevClear = new THREE.Color();

  function fit(sunDir: THREE.Vector3) {
    camera.position.copy(center).addScaledVector(sunDir, 1800);
    camera.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.98) camera.up.set(0, 0, -1);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of corners) {
      v.copy(c).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    camera.left = minX;
    camera.right = maxX;
    camera.bottom = minY;
    camera.top = maxY;
    // include tall terrain between the sun and the city
    camera.near = Math.max(1, -maxZ - 900);
    camera.far = -minZ + 20;
    camera.updateProjectionMatrix();
    env.uShadowMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    env.uShadowBias.value = 0.25 / (camera.far - camera.near);
  }

  return {
    /** Re-render the shadow map if the sun moved; turn shadows off when the sun is down. */
    update(sunDir: THREE.Vector3, force = false) {
      const up = sunDir.y > 0.003;
      env.uShadowOn.value = up ? 1 : 0;
      if (!up) return;
      if (!force && last.dot(sunDir) > Math.cos(0.0012)) return;
      last.copy(sunDir);
      fit(sunDir);
      const prevTarget = renderer.getRenderTarget();
      const prevOverride = scene.overrideMaterial;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(prevClear);
      const prevAutoClear = renderer.autoClear;
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(target);
      renderer.setClearColor(white, 1);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(scene, camera);
      scene.overrideMaterial = prevOverride;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAutoClear;
    },
  };
}
