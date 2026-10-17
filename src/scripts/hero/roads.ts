import * as THREE from 'three';
import { BUILDINGS_BOX, type Box } from './geo';
import { LINE, type LineFeature } from './lines-data';

/** Road widths in metres for each GSI width rank (0 under 3 m … 4 over 19.5 m). */
export const ROAD_WIDTH = [3, 4.5, 9, 16, 24];

/** How the distances are stored in the field's 8-bit channels (see ROAD_GLSL). */
const NEAR = 8;
const SPAN = 40;
const CENTRE_SPAN = 32;

/**
 * A distance field of the streets, rendered once on the GPU: every road and railway segment is
 * drawn as a quad around it, the fragment shader works out the distance to the segment, and
 * MIN blending keeps the nearest. Distances interpolate smoothly between texels, so the terrain
 * shader can draw sharp road edges, kerbs and centre lines from a texture of ~3 m texels.
 *
 *   r  signed distance to the edge of the nearest road (negative on the road)
 *   g  the same for avenues only (13 m and wider)
 *   b  distance to the centre line of the nearest avenue
 *   a  signed distance to the edge of the nearest railway
 */
export function buildRoadField(renderer: THREE.WebGLRenderer, lines: LineFeature[], size: number, box:Box=BUILDINGS_BOX) {
  const [minX, minZ, maxX, maxZ] = box;
  const segs: number[] = [];
  for (const f of lines) {
    let half: number;
    let kind: number;
    if (f.kind === LINE.road) {
      const rank = f.attr & 15;
      if (rank < 1) continue;
      half = ROAD_WIDTH[rank] / 2;
      kind = rank >= 3 ? 1 : 0;
    } else if (f.kind === LINE.rail) {
      // ballast for one or two tracks; elevated lines are drawn as structures elsewhere
      if (f.attr & 1) continue;
      half = f.attr & 2 ? 5 : 2.6;
      kind = 2;
    } else continue;
    const p = f.pts;
    for (let i = 0; i < p.length - 2; i += 2) {
      if (p[i] === p[i + 2] && p[i + 1] === p[i + 3]) continue;
      segs.push(p[i], p[i + 1], p[i + 2], p[i + 3], half, kind);
    }
  }
  const count = segs.length / 6;
  const data = new Float32Array(segs);

  // one unit quad, stretched over each segment by the vertex shader
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const inst = new THREE.InstancedInterleavedBuffer(data, 6);
  geo.setAttribute('iSeg', new THREE.InterleavedBufferAttribute(inst, 4, 0));
  geo.setAttribute('iHalf', new THREE.InterleavedBufferAttribute(inst, 1, 4));
  geo.setAttribute('iKind', new THREE.InterleavedBufferAttribute(inst, 1, 5));
  geo.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    uniforms: { uBox: { value: new THREE.Vector4(minX, minZ, maxX, maxZ) } },
    vertexShader: /* glsl */ `
      attribute vec4 iSeg;
      attribute float iHalf;
      attribute float iKind;
      uniform vec4 uBox;
      varying vec2 vP;
      varying vec4 vSeg;
      varying float vHalf;
      varying float vKind;
      void main(){
        vec2 a = iSeg.xy, b = iSeg.zw;
        vec2 u = normalize(b - a);
        vec2 n = vec2(-u.y, u.x);
        float reach = iHalf + ${SPAN - NEAR}.;
        vec2 p = (position.x < 0. ? a - u * reach : b + u * reach) + n * position.y * reach;
        vP = p;
        vSeg = iSeg;
        vHalf = iHalf;
        vKind = iKind;
        vec2 uv = (p - uBox.xy) / (uBox.zw - uBox.xy);
        // texture rows run north to south like the aerial photos
        gl_Position = vec4(uv.x * 2. - 1., 1. - uv.y * 2., 0., 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      varying vec4 vSeg;
      varying float vHalf;
      varying float vKind;
      void main(){
        vec2 a = vSeg.xy, ab = vSeg.zw - vSeg.xy;
        float t = clamp(dot(vP - a, ab) / dot(ab, ab), 0., 1.);
        float centre = length(vP - a - ab * t);
        float edge = clamp((centre - vHalf + ${NEAR}.) / ${SPAN}., 0., 1.);
        float far = 1.;
        if (vKind > 1.5) gl_FragColor = vec4(far, far, far, edge);
        else if (vKind > .5) gl_FragColor = vec4(edge, edge, clamp(centre / ${CENTRE_SPAN}., 0., 1.), far);
        else gl_FragColor = vec4(edge, far, far, far);
      }
    `,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MinEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    // texture rows run the other way from the world's z, which flips every quad's winding
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.Camera();

  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevTone = renderer.toneMapping;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0xffffff, 1);
  renderer.autoClear = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.toneMapping = prevTone;
  geo.dispose();
  material.dispose();
  return { texture: target.texture, segments: count };
}

/** GLSL to read the field: declares uRoads / uRoadBox and roadAt(). */
export const ROAD_GLSL = /* glsl */ `
uniform sampler2D uRoads;
uniform vec4 uRoadBox;
uniform float uRoadsOn;

struct Road { float edge; float avenue; float centre; float rail; };

Road roadAt(vec2 p){
  vec2 uv = (p - uRoadBox.xy) / (uRoadBox.zw - uRoadBox.xy);
  // sample first, then decide: a texture read inside a branch would have no well-defined mip level
  vec4 f = texture2D(uRoads, vec2(uv.x, 1. - uv.y));
  if (uRoadsOn < .5 || uv.x <= 0. || uv.x >= 1. || uv.y <= 0. || uv.y >= 1.) f = vec4(1.);
  Road r;
  r.edge = f.r * ${SPAN}. - ${NEAR}.;
  r.avenue = f.g * ${SPAN}. - ${NEAR}.;
  r.centre = f.b * ${CENTRE_SPAN}.;
  r.rail = f.a * ${SPAN}. - ${NEAR}.;
  return r;
}
`;
