import * as THREE from 'three';

// Update vertical strips so every frame gets a similar share of the expensive sky rays.
const STRIPS = 6;
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
  scene.add(proxy);
  const images = [skyImage(), skyImage(), skyImage()];
  const uniforms = {
    uCloudPast: { value: images[0].target.texture }, uCloudPresent: { value: images[0].target.texture },
    uPastClip: { value: images[0].clip }, uPresentClip: { value: images[0].clip }, uCloudMix: { value: 0 },
  };
  const composite = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform mat4 uPastClip, uPresentClip;
      varying vec3 vPast, vPresent;
      void main(){
        vec4 world = modelMatrix * vec4(position, 1.);
        vec4 ray = vec4(world.xyz - cameraPosition, 0.);
        vPast = (uPastClip * ray).xyw;
        vPresent = (uPresentClip * ray).xyw;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloudPast, uCloudPresent;
      uniform float uCloudMix;
      varying vec3 vPast, vPresent;
      void main(){
        vec2 past = vPast.xy / vPast.z;
        vec4 a = texture2D(uCloudPast, .5 + .5 * past);
        vec4 b = texture2D(uCloudPresent, .5 + .5 * vPresent.xy / vPresent.z);
        float edge = smoothstep(.96, .995, max(abs(past.x), abs(past.y)));
        vec4 c = mix(a, b, max(uCloudMix, edge));
        gl_FragColor = vec4(c.a > .00001 ? c.rgb / c.a : vec3(0.), c.a);
      }
    `,
  });
  const mapping = new THREE.Matrix4(), corner = new THREE.Vector4();
  const savedColor = new THREE.Color(), lastEye = new THREE.Vector3(), lastTurn = new THREE.Quaternion();
  let present: SkyImage | undefined, past: SkyImage | undefined, writing: SkyImage | undefined;
  let strip = 0, failed = false, verified = false;
  let weather: object | undefined, lastTravel = NaN, lastDate = NaN, lastFov = NaN, lastW = 0, lastH = 0;

  function reset() { past = present = writing = undefined; strip = 0; }

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
    if (present && coverage(present) < .84) {
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
    for (const image of images) image.target.dispose();
  }

  return {
    invalidate() { reset(); weather = undefined; },
    restored() { reset(); weather = undefined; failed = verified = false; for (const image of images) image.checked = false; },
    render(w: number, h: number, currentWeather: object, travel: number, date: number, draw: () => void) {
      if (failed) return false;
      const paddedW = w + 2 * Math.ceil(w / 8), paddedH = h + 2 * Math.ceil(h / 8);
      // Add angular samples if memory permits. Larger screens retain the direct full-resolution pass.
      const density = Math.min(1.125, Math.sqrt(MAX_TEXELS / (paddedW * paddedH)));
      const tw = Math.floor(paddedW * density), th = Math.floor(paddedH * density);
      const limit = renderer.capabilities.maxTextureSize;
      if (density < 1 || tw > limit || th > limit) { reset(); return false; }
      camera.updateMatrixWorld();
      const cut = weather !== currentWeather || travel !== lastTravel || Math.abs(date - lastDate) > 1500 ||
        lastW !== w || lastH !== h || lastFov !== camera.fov || lastEye.distanceToSquared(camera.position) > .0001 ||
        lastTurn.angleTo(camera.quaternion) > MAX_TURN;
      weather = currentWeather; lastTravel = travel; lastDate = date; lastW = w; lastH = h; lastFov = camera.fov;
      lastEye.copy(camera.position); lastTurn.copy(camera.quaternion);
      if (cut || (present && coverage(present) > .995)) { reset(); return false; }

      let shaderFailed = false;
      const oldHandler = renderer.debug.onShaderError;
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
            }
            capture(writing!, strip++, STRIPS);
          }
        } catch (error) { disable(error); return false; }
        uniforms.uCloudPast.value = past.target.texture; uniforms.uPastClip.value = past.clip;
        uniforms.uCloudPresent.value = present.target.texture; uniforms.uPresentClip.value = present.clip;
        uniforms.uCloudMix.value = strip / STRIPS;
        mesh.material = composite;
        if (!shaderFailed) draw();
        if (shaderFailed) { disable(new Error('Cloud reprojection shader failed')); return false; }
        verified = true;
        if (strip === STRIPS) { past = present; present = writing; strip = 0; }
        return true;
      } finally {
        mesh.material = original;
        renderer.debug.onShaderError = oldHandler;
      }
    },
  };
}
