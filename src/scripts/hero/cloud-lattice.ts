import * as THREE from 'three';
import { NOISE_GLSL } from './env.ts';

// A texel holds the four original scalar hashes for one noise cell. Interpolation
// stays in the cloud shader, with the same precision and pixel coordinates.
const TILE = 192, PAGES = 11;
export const CLOUD_LATTICE_GLSL = /* glsl */ `
  #ifdef FIELD_LATTICE
  uniform highp sampler2D uCloudLattice;
  uniform vec2 uLatticeOrigins[${PAGES}];
  uniform bool uLatticeOn;
  float fieldNoise(vec2 p, int page) {
    vec2 cell = floor(p), local = cell - uLatticeOrigins[page];
    ivec2 texel = ivec2(local) + ivec2(page % 4, page / 4) * ${TILE};
    vec4 h = texelFetch(uCloudLattice, texel, 0);
    vec2 f = fract(p), u = f*f*(3.-2.*f);
    return mix(mix(h.x,h.y,u.x),mix(h.z,h.w,u.x),u.y);
  }
  float wideFieldNoise(vec2 p, int page) {
    vec2 local = floor(p) - uLatticeOrigins[page];
    if (!uLatticeOn || any(lessThan(local,vec2(0.))) || any(greaterThanEqual(local,vec2(${TILE}.)))) return vnoise(p);
    return fieldNoise(p,page);
  }
  #else
  #define fieldNoise(p, page) vnoise(p)
  #define wideFieldNoise(p, page) vnoise(p)
  #endif
`;

export function createCloudLattice() {
  const origins = Array.from({length:PAGES}, () => new THREE.Vector2());
  const uniforms = {
    uCloudLattice: { value: null as THREE.Texture | null }, uLatticeOrigins: { value: origins }, uLatticeOn: { value: false },
  };
  const target = new THREE.WebGLRenderTarget(TILE*4, TILE*3, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { uLatticeOrigins: uniforms.uLatticeOrigins }, depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec2 uLatticeOrigins[${PAGES}];
      void main(){
        ivec2 texel = ivec2(gl_FragCoord.xy), tile = texel / ${TILE};
        vec2 p = vec2(texel - tile * ${TILE}) + uLatticeOrigins[min(tile.x + 4*tile.y, ${PAGES-1})];
        gl_FragColor = vec4(hash12(p), hash12(p + vec2(1,0)), hash12(p + vec2(0,1)), hash12(p + vec2(1,1)));
      }
    `,
  });
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), material);
  quad.frustumCulled = false; scene.add(quad);
  let anchorX = NaN, anchorZ = NaN, style = -1, failed = false;
  return {
    uniforms,
    restored() { failed = uniforms.uLatticeOn.value = false; style = -1; },
    update(renderer: THREE.WebGLRenderer, x: number, z: number, nextStyle: number) {
      // A 44 km ray spans at most 4.84 weather units. Including light probes,
      // shape warping and anchor drift the low octaves fit in 96 cells on either
      // side. Only the three higher frequencies need the analytic edge fallback.
      if (failed || (style === nextStyle && Math.max(Math.abs(x-anchorX), Math.abs(z-anchorZ)) < .5)) return;
      const f = nextStyle === 1 ? 1.7 : nextStyle === 3 ? .7 : nextStyle === 4 ? .26 : 1;
      const page = (i: number, scale: number, add: number) => origins[i].set(
        Math.floor(x*scale+add)-TILE/2, Math.floor(z*scale+add)-TILE/2);
      page(0,1.7,0); page(1,.8,7.3); page(2,.45,-3.9);
      if (nextStyle === 2 || nextStyle === 5) {
        const scale = nextStyle === 5 ? .7 : 1;
        origins[3].set(Math.floor((.87*x+.5*z)*2.6*scale)-TILE/2,Math.floor((-.5*x+.87*z)*7*scale)-TILE/2);
        page(4,13,3.1); page(5,31,-1.7);
      } else { page(3,4.2*f,5.5); page(4,9*f,-2.2); page(5,9.5*f,0); }
      page(6,21*f,3.1); page(7,43*f,-1.7); page(8,1.3,-9.7);
      page(9,nextStyle === 4 ? 6 : 3.3,1.9); page(10,15,-6.1);
      anchorX = x; anchorZ = z; style = nextStyle;
      const previous = renderer.getRenderTarget(), oldHandler = renderer.debug.onShaderError;
      try {
        if (!renderer.extensions.has('EXT_color_buffer_float')) { failed = true; return; }
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { failed = true; return; }
        renderer.debug.onShaderError = (...args) => { failed = true; oldHandler?.(...args); };
        renderer.render(scene,camera);
        if (!failed) { uniforms.uCloudLattice.value = target.texture; uniforms.uLatticeOn.value = true; }
      } catch {
        failed = true;
      } finally {
        if (failed) { uniforms.uLatticeOn.value = false; target.dispose(); }
        renderer.debug.onShaderError = oldHandler;
        renderer.setRenderTarget(previous);
      }
    },
  };
}
