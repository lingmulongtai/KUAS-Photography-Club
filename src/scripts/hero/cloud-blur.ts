import * as THREE from 'three';

/** Render only the moving cloud layer at reduced resolution, then blur it in screen space. */
export function createCloudBlur(renderer: THREE.WebGLRenderer, camera: THREE.Camera, clouds: THREE.Mesh) {
  const original = clouds.material as THREE.Material;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  const isolated = new THREE.Scene();
  const proxy = new THREE.Mesh(clouds.geometry, original);
  proxy.frustumCulled = false;
  isolated.add(proxy);
  const uniforms = {
    uCloud: { value: target.texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStep: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloud;
      uniform vec2 uResolution;
      uniform vec2 uStep;
      void main(){
        vec2 uv = gl_FragCoord.xy / uResolution;
        vec4 c = texture2D(uCloud, uv) * .375;
        c += (texture2D(uCloud, uv + uStep) + texture2D(uCloud, uv - uStep)) * .25;
        c += (texture2D(uCloud, uv + 2. * uStep) + texture2D(uCloud, uv - 2. * uStep)) * .0625;
        gl_FragColor = vec4(c.a > .0005 ? c.rgb / c.a : vec3(0.), c.a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const clearColor = new THREE.Color();
  const localWind = new THREE.Vector3();
  const viewRotation = new THREE.Matrix3();
  let failed = false, verified = false;
  return {
    render(blur: readonly [number, number], width: number, height: number, dpr: number, draw: () => void) {
      const strength = Math.hypot(...blur);
      if (failed || !Number.isFinite(strength) || strength < .0015) { draw(); return; }
      camera.updateMatrixWorld();
      viewRotation.setFromMatrix4(camera.matrixWorldInverse);
      localWind.set(blur[0], 0, blur[1]).applyMatrix3(viewRotation);
      const screenLength = Math.hypot(localWind.x, localWind.y);
      // A wind parallel to the view has no single screen-space direction.
      const lateral = Math.min(1, screenLength / strength * 2);
      if (lateral < .05) { draw(); return; }
      const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
      const scale = Math.min(.75, Math.sqrt(1_000_000 / (w * h)));
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      const resized = target.width !== tw || target.height !== th;
      if (resized) target.setSize(tw, th);
      proxy.position.copy(clouds.position); proxy.quaternion.copy(clouds.quaternion); proxy.scale.copy(clouds.scale);
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const clearAlpha = renderer.getClearAlpha();
      try {
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if ((!verified || resized) && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Cloud framebuffer is incomplete');
        renderer.setClearColor(0, 0);
        renderer.clear(true, false, false);
        renderer.render(isolated, camera);
        const dx = localWind.x / screenLength, dy = localWind.y / screenLength;
        const pixels = Math.min(1, (strength - .0015) / .0285) * lateral * 4 * dpr;
        uniforms.uResolution.value.set(w, h);
        uniforms.uStep.value.set(dx * pixels / w, dy * pixels / h);
      } catch (error) {
        failed = true;
        console.warn('Cloud motion blur unavailable', error);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, clearAlpha);
      }
      if (failed) { draw(); return; }
      clouds.material = material;
      const previousShaderError = renderer.debug.onShaderError;
      let shaderFailed = false;
      if (!verified) renderer.debug.onShaderError = (...args) => {
        shaderFailed = true;
        if (previousShaderError) previousShaderError(...args);
        else console.warn('Cloud motion blur shader unavailable');
      };
      try { draw(); }
      catch (error) { if (!shaderFailed) throw error; }
      finally { renderer.debug.onShaderError = previousShaderError; clouds.material = original; }
      if (shaderFailed) { failed = true; draw(); } else verified = true;
    },
    dispose() { target.dispose(); material.dispose(); },
  };
}
