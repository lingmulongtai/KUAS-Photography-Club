import * as THREE from 'three';
import { NOISE_GLSL } from './env.ts';

export const WEATHER_SCALE = .00011;
const SIZE = 1024, CELL_METRES = 96;
const GRID = 1 / (CELL_METRES * WEATHER_SCALE);
const RECENTER = 16; // outer texels; leaves room for storm overhangs and light probes.

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
    // bend the weather map so the cells never line up in rows or repeat one size
    p += (vec2(vnoise(p * 1.7 + 2.3), vnoise(p * 1.7 - 4.1)) - .5) * .4;
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
    if (deck()){
      // long rolls broken into cells
      vec2 q = mat2(.87, -.5, .5, .87) * p * (isStyle(5.) ? .7 : 1.);
      n = vnoise(q * vec2(2.6, 7.)) * .45 + vnoise(p * 13. + 3.1) * .35;
      if (n + .2 < emptyBelow) return emptyField;
      n += vnoise(p * 31. - 1.7) * .2;
    } else {
      float f = isStyle(1.) ? 1.7 : isStyle(3.) ? .7 : isStyle(4.) ? .26 : 1.;
      // big clouds in some parts of the sky, small ones in others: two sizes of cell, blended
      // (scaling the coordinates by a varying amount would smear the cells into streaks)
      float big = vnoise(p * 4.2 * f + 5.5) * .6 + vnoise(p * 9. * f - 2.2) * .4;
      n = big;
      if (!isStyle(4.)) {
        float blend = smoothstep(.3, .7, vnoise(p * 1.3 - 9.7));
        float small = vnoise(p * 9.5 * f) * .55;
        if (mix(small + .45, big, blend) < emptyBelow) return emptyField;
        small += vnoise(p * 21. * f + 3.1) * .3;
        small += vnoise(p * 43. * f - 1.7) * .15;
        n = mix(small, big, blend);
      }
    }
    if (n < emptyBelow) return emptyField;
    // some heads stay flat while their neighbours tower; a thunderhead climbs in turrets
    float tall = deck() ? 1. : isStyle(4.) ? mix(.5, 1., vnoise(p * 6. + 1.9)) : mix(.45, 1., vnoise(p * 3.3 + 1.9));
    if (isStyle(3.) || isStyle(4.)) tall *= mix(.75, 1., vnoise(p * 15. - 6.1));
    return vec3(n, th, tall);
  }

  /** 0 clear sky, 1 the thickest part of a cloud; spread lets the cloud reach further out. */
  float cover(vec3 f, float spread){
    return clamp((f.x - f.y + spread) / max(1. - f.y, .05), 0., 1.);
  }

  /** How high a cloud with this coverage grows, as a share of the slab. */
  float crown(float c){
    // decks have flat tops; heaps grow domes over their thickest parts; thunderheads tower
    // (a thunderhead is a broad dome of cloud, widest at the base, not a column or a spire)
    return deck() ? .5 + .5 * sqrt(c) : isStyle(4.) ? sqrt(1. - (1. - c) * (1. - c)) : isStyle(3.) ? pow(c, .5) : pow(c, .6);
  }


  vec3 cloudColumn(vec2 p){
    vec3 f = field(p);
    if (f.z == 0.) return vec3(0.);
    float c = cover(f, 0.);
    return vec3(crown(c) * f.z, smoothstep(0., .25, c),
      isStyle(4.) ? smoothstep(0., .3, cover(f, .07)) : 0.);
  }
`;

export const CLOUD_COLUMN_LOOKUP = /* glsl */ `
  uniform sampler2D uCloudColumns;
  uniform vec2 uColumnAnchor, uColumnEye;
  uniform bool uColumnsReady;
  vec3 lookupColumn(vec2 p){
    vec2 local = p * ${GRID} - uColumnAnchor;
    if (uColumnsReady && max(abs(local.x), abs(local.y)) < ${SIZE / 2 - .5}) {
      vec2 fromEye = abs(local - uColumnEye);
      float farWeight = smoothstep(128., 148., max(fromEye.x, fromEye.y));
      vec2 uvScale = vec2(1./${2 * SIZE}., 1./${SIZE}.);
      vec3 nearColumn = vec3(0.);
      if (farWeight < 1.) nearColumn = texture2D(uCloudColumns, (3.*local + ${SIZE / 2}.) * uvScale).rgb;
      if (farWeight <= 0.) return nearColumn;
      vec2 outer = local + vec2(${SIZE * 1.5}., ${SIZE / 2}.);
      return mix(nearColumn, texture2D(uCloudColumns, outer * uvScale).rgb, farWeight);
    }
    return cloudColumn(p);
  }
`;

/** Store the cloud crown, edge coverage and anvil coverage in the moving weather field.
 * The volume still evaluates billows, lighting and erosion at their actual 3D positions. */
export function createCloudColumns(shape: Record<'uStyle' | 'uClear' | 'uCover', THREE.IUniform<number>>) {
  const target = new THREE.WebGLRenderTarget(2 * SIZE, SIZE, {
    type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const anchor = new THREE.Vector2();
  const uniforms = {
    uColumnAnchor: { value: anchor }, uColumnEye: { value: new THREE.Vector2() },
    uCloudColumns: { value: target.texture }, uColumnsReady: { value: false },
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
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(mesh);
  let lastWeather: object | undefined, failed = false;
  return {
    uniforms, mesh,
    restored() { uniforms.uColumnsReady.value = failed = false; lastWeather = undefined; },
    update(renderer: THREE.WebGLRenderer, x: number, z: number, weather: object) {
      const cx = x * GRID, cz = z * GRID;
      uniforms.uColumnEye.value.set(cx - anchor.x, cz - anchor.y);
      if (failed || (lastWeather === weather &&
        Math.max(Math.abs(cx - anchor.x), Math.abs(cz - anchor.y)) < RECENTER)) return;
      const previous = renderer.getRenderTarget(), onError = renderer.debug.onShaderError;
      anchor.set(Math.floor(cx), Math.floor(cz));
      uniforms.uColumnEye.value.set(cx - anchor.x, cz - anchor.y);
      try {
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { failed = true; return; }
        renderer.debug.onShaderError = (...args) => { failed = true; onError?.(...args); };
        renderer.render(scene, camera);
        lastWeather = weather;
      } catch { failed = true; }
      finally {
        renderer.debug.onShaderError = onError;
        renderer.setRenderTarget(previous);
        uniforms.uColumnsReady.value = !failed;
        if (failed) target.dispose();
      }
    },
  };
}
