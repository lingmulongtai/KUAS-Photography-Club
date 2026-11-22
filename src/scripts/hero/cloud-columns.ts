import * as THREE from 'three';
import { NOISE_GLSL } from './env.ts';

export const WEATHER_SCALE = .00011;
const SIZE = 1024, CELL_METRES = 96;
const GRID = 1 / (CELL_METRES * WEATHER_SCALE);
const RECENTER = 16; // outer texels; leaves room for storm overhangs and light probes.
const BLOCK = 8;

export const CLOUD_COLUMN_GLSL = /* glsl */ `
  uniform float uStyle, uCover, uClear;
  // characters (cloud-weather.ts): 0 cumulus, 1 fair, 2 stratocumulus, 3 congestus,
  // 4 cumulonimbus, 5 snow deck
  bool isStyle(float s){ return abs(uStyle - s) < .5; }
  bool deck(){ return isStyle(2.) || isStyle(5.); }

  /**
   * The low clouds seen from above: x is how cloudy the sky is at p, y the level above which
   * it is cloud, z how tall the cloud there grows (0..1).
   */
  vec3 field(vec2 p){
    // Multi-scale domain warp breaks cell alignment and prevents smooth oval blobs.
    vec2 w1 = vec2(vnoise(p * 1.6 + 2.3), vnoise(p * 1.6 - 4.1)) - .5;
    vec2 w2 = vec2(vnoise(p * 4.7 - 7.1), vnoise(p * 4.7 + 5.9)) - .5;
    p += w1 * .46 + w2 * .14;
    // a regional swell, so some parts of the sky are busier than others
    float region = vnoise(p * .8 + 7.3);
    // and wide clear stretches between groups of clouds: these take whole clouds away (the
    // ones at the edge of a group come out smaller) rather than thinning every cloud
    float clear = smoothstep(.35, .7, vnoise(p * .45 - 3.9)) * uClear;
    float th = 1. - uCover * (.7 + .6 * region) + clear * .4;
    // Value noise lies in [0,1]. An upper bound below the threshold proves a ray
    // sample contributes zero, including the wider anvil at the top of a storm.
    float emptyBelow = th - (isStyle(4.) ? .07 : 0.) - .00001;
    const vec3 emptyField = vec3(0., 1., 0.);
    if (emptyBelow > 1.) return emptyField;
    float n;
    float sizeScale = 1.;
    if (deck()){
      // long rolls broken into cells
      vec2 q = mat2(.87, -.5, .5, .87) * p * (isStyle(5.) ? .7 : 1.);
      n = vnoise(q * vec2(2.6, 7.)) * .45 + vnoise(p * 13. + 3.1) * .35;
      if (n + .2 < emptyBelow) return emptyField;
      n += vnoise(p * 31. - 1.7) * .2;
    } else {
      // Keep towering clouds horizontally broad yet well-populated across the summer horizon.
      float f = isStyle(1.) ? 1.55 : isStyle(3.) ? .52 : isStyle(4.) ? .36 : .92;
      // Clustered multi-lobe cumulus footprints with smaller satellite puffs.
      float big = vnoise(p * 3.6 * f + 5.5) * .52 + vnoise(p * 8.2 * f - 2.2) * .32 + vnoise(p * 18. * f + 6.7) * .16;
      n = big;
      if (!isStyle(4.)) {
        float blend = smoothstep(.26, .74, vnoise(p * 1.35 - 9.7));
        float small = vnoise(p * 7.8 * f) * .52;
        if (mix(small + .48, big, blend) < emptyBelow) return emptyField;
        small += vnoise(p * 17.5 * f + 3.1) * .30;
        small += vnoise(p * 38. * f - 1.7) * .18;
        n = mix(small, big, blend);
        // Smaller horizontal puffs stay proportionally shallower so they read as broad clouds, never cones.
        sizeScale = mix(isStyle(3.) ? .58 : .42, 1.0, blend);
      }
    }
    if (n < emptyBelow) return emptyField;
    // Thunderheads rise in tiered cauliflower turrets from a broad base.
    float tall = deck() ? 1. : isStyle(4.) ? mix(.62, 1., smoothstep(.18, .82, vnoise(p * 3.6 + 1.9)))
      : isStyle(3.) ? mix(.58, 1., vnoise(p * 3.8 + 1.9)) * sizeScale
      : mix(.48, 1., vnoise(p * 3.2 + 1.9)) * sizeScale;
    if (isStyle(3.) || isStyle(4.)) tall *= mix(.78, 1., smoothstep(.15, .85, vnoise(p * 9.5 - 6.1)));
    return vec3(n, th, tall);
  }

  /** 0 clear sky, 1 the thickest part of a cloud; spread lets the cloud reach further out. */
  float cover(vec3 f, float spread){
    return clamp((f.x - f.y + spread) / max(1. - f.y, .05), 0., 1.);
  }

  /** How high a cloud with this coverage grows, as a share of the slab (broad-shouldered towers & domes). */
  float crown(float c){
    if (deck()) return .55 + .45 * sqrt(c);
    // Smooth multi-tiered cumulus/thunderhead profile with soft margins so edges never form vertical walls.
    float dome = smoothstep(0., .82, c);
    if (isStyle(4.)) return mix(.18, 1.0, smoothstep(.06, .66, c)) * (.38 + .62 * pow(dome, .62));
    if (isStyle(3.)) return mix(.20, 1.0, smoothstep(.06, .64, c)) * (.40 + .60 * pow(dome, .62));
    return .22 + .78 * pow(dome, .65);
  }


  vec3 cloudColumn(vec2 p){
    vec3 f = field(p);
    if (f.z == 0.) return vec3(0.);
    float c = cover(f, 0.);
    // Keep coverage gradient broad on towers so 3D Worley noise sculpts deep cauliflower sides all the way out.
    return vec3(crown(c) * f.z, smoothstep(0., isStyle(4.) ? .56 : isStyle(3.) ? .52 : .42, c),
      isStyle(4.) ? smoothstep(0., .42, cover(f, .07)) : 0.);
  }
`;

export const CLOUD_COLUMN_LOOKUP = /* glsl */ `
  uniform float uStyle, uCover, uClear;
  uniform sampler2D uCloudColumns;
  uniform sampler2D uColumnCeilings;
  uniform vec2 uColumnAnchor, uColumnEye;
  uniform bool uColumnsReady;
  const float outerColumnMetres = ${CELL_METRES}.;
  bool isStyle(float s){ return abs(uStyle - s) < .5; }
  vec3 lookupColumn(vec2 p){
    vec2 local = p * ${GRID} - uColumnAnchor;
    if (uColumnsReady && max(abs(local.x), abs(local.y)) < ${SIZE / 2 - .5}) {
      vec2 fromEye = abs(local - uColumnEye);
      float farWeight = smoothstep(128., 148., max(fromEye.x, fromEye.y));
      vec2 uvScale = vec2(1./${2 * SIZE}., 1./${SIZE}.);
      vec3 nearColumn = vec3(0.);
      if (farWeight < 1.) nearColumn = textureLod(uCloudColumns, (3.*local + ${SIZE / 2}.) * uvScale, 0.).rgb;
      if (farWeight <= 0.) return nearColumn;
      vec2 outer = local + vec2(${SIZE * 1.5}., ${SIZE / 2}.);
      return mix(nearColumn, textureLod(uCloudColumns, outer * uvScale, 0.).rgb, farWeight);
    }
    // Lightweight emergency fallback only if render-to-texture failed; avoids inlining 15-noise bake code into raymarch.
    float n = vnoise(p * 3.8 + 5.5) * .65 + vnoise(p * 9.5 - 2.2) * .35;
    float th = 1. - uCover * .95 + uClear * .25;
    float c = clamp((n - th) / max(1. - th, .05), 0., 1.);
    return c > 0. ? vec3(.25 + .75 * sqrt(c), smoothstep(0., .45, c), isStyle(4.) ? smoothstep(0., .5, c) : 0.) : vec3(0.);
  }
  // The maximum includes the bilinear footprint on all four sides of the block.
  // Use only unmixed pages. Towers displace their sample coordinates with height.
  bool emptyColumnRun(vec2 local, vec2 dir, float height, float slope, float remaining, out float run){
    vec2 fromEye = abs(local-uColumnEye);
    float r = max(fromEye.x, fromEye.y);
    run = min(remaining, 384.);
    bool nearPage = r < 128. - ${BLOCK}./3.;
    if ((!nearPage && r < 148. + ${BLOCK}.) || max(abs(local.x),abs(local.y)) >= ${SIZE / 2 - BLOCK - 1}.) return false;
    float scale = nearPage ? 3. : 1.;
    vec2 blockPos = (local * scale + ${SIZE / 2}.) / ${BLOCK}.;
    vec2 cell = floor(blockPos), f = fract(blockPos);
    vec2 edge = mix(f, 1.-f, step(vec2(0.), dir));
    vec2 metres = edge * ${CELL_METRES * BLOCK}. / (scale * max(abs(dir), vec2(1e-9)));
    run = min(remaining, min(dir.x == 0. ? remaining : metres.x, dir.y == 0. ? remaining : metres.y));
    ivec2 tile = ivec2(cell) + ivec2(nearPage ? 0 : ${SIZE / BLOCK}, 0);
    float ceiling = texelFetch(uColumnCeilings, tile, 0).r;
    return ceiling == 0. || min(height, height + slope*run) > ceiling + 1./255.;
  }
`;

/** Store the cloud crown, edge coverage and anvil coverage in the moving weather field.
 * The volume still evaluates billows, lighting and erosion at their actual 3D positions. */
export function createCloudColumns(shape: Record<'uStyle' | 'uClear' | 'uCover', THREE.IUniform<number>>) {
  // Half-float precision prevents 8-bit elevation staircasing across cloud crowns and undersides.
  const target = new THREE.WebGLRenderTarget(2 * SIZE, SIZE, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const anchor = new THREE.Vector2();
  const ceilings = new THREE.WebGLRenderTarget(2 * SIZE / BLOCK, SIZE / BLOCK, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
  });
  const uniforms = {
    uColumnAnchor: { value: anchor }, uColumnEye: { value: new THREE.Vector2() },
    uCloudColumns: { value: null as THREE.Texture | null }, uColumnCeilings: { value: null as THREE.Texture | null },
    uColumnsReady: { value: false },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: { uStyle: shape.uStyle, uClear: shape.uClear, uCover: shape.uCover, uColumnAnchor: uniforms.uColumnAnchor },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${CLOUD_COLUMN_GLSL}
      uniform vec2 uColumnAnchor;
      void main(){
        bool nearPage = gl_FragCoord.x < ${SIZE}.;
        vec2 texel = gl_FragCoord.xy - vec2(nearPage ? 0. : ${SIZE}., 0.) - ${SIZE / 2}.;
        // Always evaluate the same integer world cell at its centre, including after a recenter.
        float scale = nearPage ? 3. : 1.;
        gl_FragColor = vec4(cloudColumn((uColumnAnchor * scale + texel) / (${GRID} * scale)), 1.);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const maxMaterial = new THREE.ShaderMaterial({
    uniforms: { uCloudColumns: {value:target.texture} }, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloudColumns;
      void main(){
        ivec2 first = ivec2(gl_FragCoord.xy) * ${BLOCK};
        int page = first.x / ${SIZE} * ${SIZE};
        float top = 0.;
        for (int y=-1; y<=${BLOCK}; ++y) for (int x=-1; x<=${BLOCK}; ++x) {
          ivec2 p = clamp(first + ivec2(x,y), ivec2(page,0), ivec2(page+${SIZE-1},${SIZE-1}));
          top = max(top, texelFetch(uCloudColumns, p, 0).r);
        }
        gl_FragColor = vec4(top,0.,0.,1.);
      }
    `,
  });
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(mesh);
  let lastWeather: object | undefined, failed = false;
  return {
    uniforms, mesh,
    restored() {
      uniforms.uColumnsReady.value = failed = false;
      uniforms.uCloudColumns.value = uniforms.uColumnCeilings.value = null;
      lastWeather = undefined;
    },
    update(renderer: THREE.WebGLRenderer, x: number, z: number, weather: object) {
      const cx = x * GRID, cz = z * GRID;
      uniforms.uColumnEye.value.set(cx - anchor.x, cz - anchor.y);
      if (failed || (lastWeather === weather &&
        Math.max(Math.abs(cx - anchor.x), Math.abs(cz - anchor.y)) < RECENTER)) return;
      const previous = renderer.getRenderTarget(), onError = renderer.debug.onShaderError, diagnostics=renderer.debug.checkShaderErrors;
      anchor.set(Math.floor(cx), Math.floor(cz));
      uniforms.uColumnEye.value.set(cx - anchor.x, cz - anchor.y);
      try {
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if (!uniforms.uColumnsReady.value && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { failed = true; return; }
        if(!uniforms.uColumnsReady.value)renderer.debug.checkShaderErrors=true;
        renderer.debug.onShaderError = (...args) => { failed = true; onError?.(...args); };
        renderer.render(scene, camera);
        if (failed) return;
        renderer.setRenderTarget(ceilings);
        if (!uniforms.uColumnsReady.value && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { failed = true; return; }
        mesh.material = maxMaterial;
        renderer.render(scene, camera);
        lastWeather = weather;
      } catch { failed = true; }
      finally {
        mesh.material = material;
        renderer.debug.onShaderError = onError;renderer.debug.checkShaderErrors=diagnostics;
        renderer.setRenderTarget(previous);
        uniforms.uColumnsReady.value = !failed;
        uniforms.uCloudColumns.value = failed ? null : target.texture;
        uniforms.uColumnCeilings.value = failed ? null : ceilings.texture;
        if (failed) { target.dispose(); ceilings.dispose(); }
      }
    },
  };
}
