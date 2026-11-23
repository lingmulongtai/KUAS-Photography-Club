import * as THREE from 'three';
import { ENV_GLSL } from './env.ts';
import { HIGH_CLOUD_GLSL } from './high-clouds.ts';
import { WEATHER_SCALE } from './cloud-columns.ts';

// Update vertical strips so every frame gets a similar share of the expensive sky rays.
const MIN_STRIPS = 6, MAX_STRIPS = 12;
const MAX_TEXELS = Math.floor(64 * 1024 * 1024 / (3 * 8)); // Three RGBA16F images.
const MAX_TURN = THREE.MathUtils.degToRad(2);

function skyImage() {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  target.scissorTest = true;
  return { target, camera: new THREE.PerspectiveCamera(), clip: new THREE.Matrix4(), checked: false };
}
type SkyImage = ReturnType<typeof skyImage>;

/** Reproject two fully sampled cloud images about a fixed eye. Foreground depth and MSAA stay live. */
export function createCloudHistory(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, mesh: THREE.Mesh) {
  const original = mesh.material as THREE.ShaderMaterial;
  const frozen = original.clone();
  const scene = new THREE.Scene();
  const proxy = new THREE.Mesh(mesh.geometry, frozen);
  proxy.frustumCulled = false;
  // Match main scene light counts so Three's program cache reuses the precompiled CLOUDS program.
  scene.add(proxy, new THREE.DirectionalLight(0), new THREE.HemisphereLight(0, 0));
  const images = [skyImage(), skyImage(), skyImage()];
  const uniforms = {
    ...original.uniforms,
    uCloudPast: { value: images[0].target.texture }, uCloudPresent: { value: images[0].target.texture },
    uPastClip: { value: images[0].clip }, uPresentClip: { value: images[0].clip }, uCloudMix: { value: 0 },
  };
  const composite = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform mat4 uPastClip, uPresentClip;
      varying vec3 vPast, vPresent;
      varying vec3 vRay;
      void main(){
        vec4 world = modelMatrix * vec4(position, 1.);
        vec4 ray = vec4(world.xyz - cameraPosition, 0.);
        vRay = ray.xyz;
        vPast = (uPastClip * ray).xyw;
        vPresent = (uPresentClip * ray).xyw;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloudPast, uCloudPresent;
      uniform float uCloudMix;
      varying vec3 vPast, vPresent;
      varying vec3 vRay;
      ${ENV_GLSL}
      const float K = ${WEATHER_SCALE};
      ${HIGH_CLOUD_GLSL}
      void main(){
        vec2 past = vPast.xy / vPast.z;
        vec4 a = texture2D(uCloudPast, .5 + .5 * past);
        vec4 b = texture2D(uCloudPresent, .5 + .5 * vPresent.xy / vPresent.z);
        float edge = smoothstep(.96, .995, max(abs(past.x), abs(past.y)));
        vec4 c = mix(a, b, max(uCloudMix, edge));
        c += (1.-c.a) * highClouds(cameraPosition, normalize(vRay));
        gl_FragColor = vec4(c.a > .00001 ? c.rgb / c.a : vec3(0.), c.a);
      }
    `,
  });
  const mapping = new THREE.Matrix4(), corner = new THREE.Vector4();
  const savedColor = new THREE.Color(), lastEye = new THREE.Vector3(), lastTurn = new THREE.Quaternion();
  let present: SkyImage | undefined, past: SkyImage | undefined, writing: SkyImage | undefined;
  let strip = 0, strips = MIN_STRIPS, frameSeconds = .05, failed = false, verified = false;
  let weather: object | undefined, lastTravel = NaN, lastDate = NaN, lastFov = NaN, lastW = 0, lastH = 0;

  function reset() { past = present = writing = undefined; strip = 0; }

  function invalidate() {
    reset();
    weather = undefined;
    for (const image of images) {
      if (!image.checked) continue;
      image.target.dispose();
      image.checked = false;
    }
  }

  // All four live viewport corners must project inside the actual source image.
  function coverage(image: SkyImage) {
    mapping.multiplyMatrices(image.clip, camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    let extent = 0;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      corner.set(x, y, 0, 1).applyMatrix4(mapping);
      if (corner.w <= 0) return Infinity;
      extent = Math.max(extent, Math.abs(corner.x / corner.w), Math.abs(corner.y / corner.w));
    }
    return extent;
  }

  function begin(image: SkyImage, w: number, h: number, tw: number, th: number, paddedW: number, paddedH: number) {
    if (image.target.width !== tw || image.target.height !== th) { image.target.setSize(tw, th); image.checked = false; }
    const anchorLimit = 1 - .8 * (1 - Math.max(w / paddedW, h / paddedH));
    if (present && coverage(present) < anchorLimit) {
      // Keep identical sample positions on the cloud while the visitor slowly pans.
      image.camera.copy(present.camera, false);
      image.clip.copy(present.clip);
    } else {
      image.camera.copy(camera, false);
      const projection = image.camera.projectionMatrix;
      projection.elements[0] *= w / paddedW;
      projection.elements[5] *= h / paddedH;
      image.camera.projectionMatrixInverse.copy(projection).invert();
      image.clip.multiplyMatrices(projection, image.camera.matrixWorldInverse);
    }
    proxy.position.copy(mesh.position); proxy.quaternion.copy(mesh.quaternion); proxy.scale.copy(mesh.scale);
    // All strips of one image see one wind position, sun colour and weather.
    for (const name of Object.keys(original.uniforms)) {
      const value = original.uniforms[name].value, dest = frozen.uniforms[name];
      if (value && !value.isTexture && dest.value?.copy) dest.value.copy(value);
      else dest.value = value;
    }
    frozen.uniforms.uVolumeOnly.value = true;
  }

  function capture(image: SkyImage, part: number, count: number) {
    const target = image.target;
    const x = Math.floor(target.width * part / count);
    target.scissor.set(x, 0, Math.floor(target.width * (part + 1) / count) - x, target.height);
    const previous = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
    renderer.getClearColor(savedColor);
    try {
      renderer.setRenderTarget(target);
      if (!image.checked) {
        const gl = renderer.getContext();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete cloud framebuffer');
        image.checked = true;
      }
      renderer.autoClear = false;
      renderer.setClearColor(0, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, image.camera);
    } finally {
      renderer.autoClear = auto;
      renderer.setClearColor(savedColor, alpha);
      renderer.setRenderTarget(previous);
    }
  }

  function disable(error: unknown) {
    console.warn('Using direct cloud rendering', error);
    failed = true;
    reset();
    for (const image of images) { image.target.dispose(); image.checked = false; }
  }

  return {
    compositeMesh:new THREE.Mesh(mesh.geometry,composite),
    invalidate,
    restored() { reset(); weather = undefined; failed = verified = false; for (const image of images) image.checked = false; },
    render(w: number, h: number, currentWeather: object, travel: number, date: number, draw: () => void, elapsed = .05) {
      if (failed) return false;
      let paddedW = w + 2 * Math.ceil(w / 8), paddedH = h + 2 * Math.ceil(h / 8);
      const limit = renderer.capabilities.maxTextureSize;
      // Large buffers spend more rays beyond the viewport. Keep full sampling density,
      // use the narrower guard band, and let the coverage check re-anchor as the eye turns.
      if (w * h >= 1_000_000 || paddedW * paddedH > MAX_TEXELS || Math.max(paddedW, paddedH) > limit) {
        paddedW = w + 2 * Math.ceil(w / 16);
        paddedH = h + 2 * Math.ceil(h / 16);
      }
      const density = Math.min(1.125, limit / Math.max(paddedW, paddedH), Math.sqrt(MAX_TEXELS / (paddedW * paddedH)));
      const tw = Math.floor(paddedW * density), th = Math.floor(paddedH * density);
      if (density < 1) { invalidate(); return false; }
      camera.updateMatrixWorld();
      const turn = lastTurn.angleTo(camera.quaternion);
      const cut = weather !== currentWeather || travel !== lastTravel || Math.abs(date - lastDate) > 1500 ||
        lastW !== w || lastH !== h || lastFov !== camera.fov || lastEye.distanceToSquared(camera.position) > .0001 ||
        turn > MAX_TURN;
      if (elapsed > 0 && elapsed < .15) frameSeconds += (elapsed - frameSeconds) * .12;
      weather = currentWeather; lastTravel = travel; lastDate = date; lastW = w; lastH = h; lastFov = camera.fov;
      lastEye.copy(camera.position); lastTurn.copy(camera.quaternion);
      if (cut || (present && coverage(present) > .995)) { reset(); return false; }

      let shaderFailed = false;
      const oldHandler = renderer.debug.onShaderError,diagnostics=renderer.debug.checkShaderErrors;
      if(!verified && diagnostics!==false)renderer.debug.checkShaderErrors=true;
      if (!verified) renderer.debug.onShaderError = (...args) => { shaderFailed = true; oldHandler?.(...args); };
      try {
        try {
          if (!present || !past) {
            const first = images[0];
            begin(first, w, h, tw, th, paddedW, paddedH);
            capture(first, 0, 1);
            present = past = first;
          } else {
            if (strip === 0) {
              writing = images.find(image => image !== past && image !== present)!;
              begin(writing, w, h, tw, th, paddedW, paddedH);
              // Refresh the full-resolution field about every 0.3 s, including on faster GPUs.
              // During a faster turn, finish sooner so the source still covers the viewport.
              const margin = Math.min(paddedW / w - 1, paddedH / h - 1);
              const angle = Math.atan(margin * Math.tan(THREE.MathUtils.degToRad(camera.fov) * .5) * Math.min(1, camera.aspect));
              const turnLimit = Math.floor(.65 * angle / Math.max(turn, .0001));
              strips = THREE.MathUtils.clamp(Math.min(Math.round(.30 / frameSeconds), turnLimit), MIN_STRIPS, MAX_STRIPS);
            }
            capture(writing!, strip++, strips);
          }
        } catch (error) { disable(error); return false; }
        uniforms.uCloudPast.value = past.target.texture; uniforms.uPastClip.value = past.clip;
        uniforms.uCloudPresent.value = present.target.texture; uniforms.uPresentClip.value = present.clip;
        uniforms.uCloudMix.value = strip / strips;
        mesh.material = composite;
        if (!shaderFailed) draw();
        if (shaderFailed) { disable(new Error('Cloud reprojection shader failed')); return false; }
        verified = true;
        if (strip === strips) { past = present; present = writing; strip = 0; }
        return true;
      } finally {
        mesh.material = original;
        renderer.debug.onShaderError = oldHandler;renderer.debug.checkShaderErrors=diagnostics;
      }
    },
  };
}
