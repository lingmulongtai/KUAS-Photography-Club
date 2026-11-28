import * as THREE from 'three';
import { ENV_GLSL } from './env.ts';
import { CLOUD_DEPTH_GLSL, HIGH_CLOUD_GLSL } from './high-clouds.ts';
import { WEATHER_SCALE } from './cloud-columns.ts';

export const cloudVolumeScale = (quality: number) => quality > .75 ? .625 : .5;

/** Filter cloud samples independently of the foreground, including time-lapse motion. */
export function createCloudBlur(renderer: THREE.WebGLRenderer, camera: THREE.Camera, clouds: THREE.Mesh, quality = 1) {
  const original = clouds.material as THREE.ShaderMaterial;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  const isolated = new THREE.Scene();
  const proxy = new THREE.Mesh(clouds.geometry, original);
  proxy.frustumCulled = false;
  // Match main scene light counts so Three's program cache reuses the precompiled CLOUDS program.
  isolated.add(proxy, new THREE.DirectionalLight(0), new THREE.HemisphereLight(0, 0));
  const uniforms = {
    uSceneDepth: { value: null as THREE.Texture | null },
    uViewFromClip: { value: new THREE.Matrix4() },
    uDepthRes: { value: new THREE.Vector2(1, 1) },
    uUseDepth: { value: false },
    uBase: { value: 850 },
    uTop: { value: 2600 },
    ...original.uniforms,
    uCloud: { value: target.texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStep: { value: new THREE.Vector2() },
    uFullResHigh: { value: false },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: original.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloud;
      uniform vec2 uResolution;
      uniform vec2 uStep;
      uniform float uBase;
      uniform float uTop;
      ${ENV_GLSL}
      ${CLOUD_DEPTH_GLSL}
      const float K = ${WEATHER_SCALE};
      ${HIGH_CLOUD_GLSL}
      uniform bool uFullResHigh;
      varying vec3 vWorld;
      void main(){
        vec2 uv = gl_FragCoord.xy / uResolution;
        vec3 rd = normalize(vWorld - cameraPosition);
        float sceneDist = cloudSceneDist();
        float t0 = cloudSlabEntry(cameraPosition, rd, uBase, uTop);
        float slabVis = uUseDepth ? smoothstep(t0, t0 + 40., sceneDist) : 1.;
        vec4 c;
        if (uFullResHigh) {
          c = texture2D(uCloud, uv) * slabVis;
          vec4 high = highClouds(cameraPosition, rd, sceneDist);
          c += (1.-c.a)*high;
        } else {
          c = texture2D(uCloud, uv) * .375;
          c += (texture2D(uCloud, uv + uStep) + texture2D(uCloud, uv - uStep)) * .25;
          c += (texture2D(uCloud, uv + 2. * uStep) + texture2D(uCloud, uv - 2. * uStep)) * .0625;
          c *= slabVis;
        }
        gl_FragColor = vec4(c.a > .0005 ? c.rgb / c.a : vec3(0.), c.a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const clearColor = new THREE.Color();
  const localWind = new THREE.Vector3();
  const viewRotation = new THREE.Matrix3();
  const savedDepthRes = new THREE.Vector2();
  let failed = false, verified = false;
  return {
    compositeMesh:new THREE.Mesh(clouds.geometry,material),
    restored() { failed = verified = false; },
    render(blur: readonly [number, number], width: number, height: number, dpr: number, draw: () => void) {
      const strength = Math.hypot(...blur);
      if (failed || !Number.isFinite(strength)) { draw(); return; }
      camera.updateMatrixWorld();
      viewRotation.setFromMatrix4(camera.matrixWorldInverse);
      localWind.set(blur[0], 0, blur[1]).applyMatrix3(viewRotation);
      const screenLength = Math.hypot(localWind.x, localWind.y);
      // A wind parallel to the view has no single screen-space blur direction.
      const lateral = strength > 0 ? Math.min(1, screenLength / strength * 2) : 0;
      const moving = strength >= .0015 && lateral >= .05;
      const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
      // The integrated volume is smooth. Keep thin high-cloud features at output resolution.
      const scale = moving ? Math.min(.75, Math.sqrt(1_000_000 / (w * h)))
        : Math.min(cloudVolumeScale(quality), Math.sqrt(1_000_000 / (w * h)));
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      const resized = target.width !== tw || target.height !== th;
      if (resized) target.setSize(tw, th);
      proxy.position.copy(clouds.position); proxy.quaternion.copy(clouds.quaternion); proxy.scale.copy(clouds.scale);
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const clearAlpha = renderer.getClearAlpha();
      const depthRes = original.uniforms.uDepthRes?.value as THREE.Vector2 | undefined;
      if (depthRes) savedDepthRes.copy(depthRes);
      try {
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if ((!verified || resized) && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Cloud framebuffer is incomplete');
        renderer.setClearColor(0, 0);
        renderer.clear(true, false, false);
        original.uniforms.uVolumeOnly.value = !moving;
        depthRes?.set(tw, th);
        renderer.render(isolated, camera);
        const pixels = moving ? Math.min(1, (strength - .0015) / .0285) * lateral * 4 * dpr / screenLength : 0;
        uniforms.uFullResHigh.value = !moving;
        uniforms.uResolution.value.set(w, h);
        uniforms.uStep.value.set(localWind.x * pixels / w, localWind.y * pixels / h);
      } catch (error) {
        failed = true;
        console.warn('Cloud motion blur unavailable', error);
      } finally {
        original.uniforms.uVolumeOnly.value = false;
        if (depthRes) depthRes.copy(savedDepthRes);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, clearAlpha);
      }
      if (failed) { draw(); return; }
      clouds.material = material;
      const previousShaderError = renderer.debug.onShaderError;
      const diagnostics=renderer.debug.checkShaderErrors;
      if(!verified && diagnostics!==false)renderer.debug.checkShaderErrors=true;
      let shaderFailed = false;
      if (!verified) renderer.debug.onShaderError = (...args) => {
        shaderFailed = true;
        if (previousShaderError) previousShaderError(...args);
        else console.warn('Cloud motion blur shader unavailable');
      };
      try { draw(); }
      catch (error) { if (!shaderFailed) throw error; }
      finally { renderer.debug.checkShaderErrors=diagnostics;renderer.debug.onShaderError = previousShaderError; clouds.material = original; }
      if (shaderFailed) { failed = true; draw(); } else verified = true;
    },
    dispose() { target.dispose(); material.dispose(); },
  };
}
