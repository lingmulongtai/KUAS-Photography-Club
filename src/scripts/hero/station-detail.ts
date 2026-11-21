import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { SHADOW_LAYER } from './shadow';

function stationMaterial(source: THREE.MeshStandardMaterial, env: Env, groundY: number) {
  const map = source.map;
  const glazing = source.name === 'Atrium glazing';
  map?.updateMatrix();
  if (map) map.anisotropy = 4;
  return new THREE.ShaderMaterial({
    side: source.side,
    transparent: glazing,
    depthWrite: !glazing,
    forceSinglePass: true,
    defines: {
      ...(map && { STATION_PHOTO: 1 }),
      ...(glazing && { ATRIUM_GLASS: 1 }),
      ...(source.name === 'KYcb0061_org.001' && { STATION_ENVELOPE: 1 }),
    },
    uniforms: {
      ...env, uPhoto: { value: map }, uUvMatrix: { value: map?.matrix ?? new THREE.Matrix3() },
      uTint: { value: source.color }, uGroundY: { value: groundY },
    },
    vertexShader: `
      uniform mat3 uUvMatrix;
      varying vec2 vUv;
      varying vec3 vWorld, vNormal;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = mat3(modelMatrix) * normal;
        vUv = (uUvMatrix * vec3(uv, 1.)).xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }`,
    fragmentShader: `
      ${ENV_GLSL}
      ${SHADOW_GLSL}
      uniform sampler2D uPhoto;
      uniform vec3 uTint;
      uniform float uGroundY;
      varying vec2 vUv;
      varying vec3 vWorld, vNormal;
      void main(){
        vec3 base = uTint;
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1. : -1.);
        #ifdef STATION_ENVELOPE
          // The survey smooths wall vertices across parapets and returns. A flat
          // curtain wall needs one lighting normal; keep the roof's curved profile.
          vec3 face = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          float slope = smoothstep(.14, .42, abs(face.y));
          n = normalize(mix(face, n, slope));
        #endif
        vec3 light = vec3(0.);
        #ifdef STATION_PHOTO
          base *= texture2D(uPhoto, vUv).rgb;
          float luminance = dot(base, vec3(.213, .715, .072));
          float vertical = 1. - n.y * n.y;
          // Use chromaticity so pale stone and neutral window frames do not
          // become luminous glass simply because the daylight photo is bright.
          float chroma = (base.b - base.r) / max(base.b + base.r, .08);
          float pane = vertical * smoothstep(.035, .22, chroma);
          vec3 eye = normalize(cameraPosition - vWorld);
          float reflectance = .045 + .12 * pow(1. - clamp(dot(eye,n), 0., 1.), 4.);
          light += skyColor(reflect(-eye, n)) * pane * reflectance;
          // Warm, bright details in the survey mark entrances and interior light.
          float warm = smoothstep(.04, .28, -chroma) * smoothstep(.09, .45, luminance);
          light += uCity * vertical * warm * base * vec3(.105, .064, .033);
          // Soft spill from the north plaza falls off up the facade.
          float plaza = max(-n.z, 0.) * exp(-max(vWorld.y-uGroundY, 0.) / 32.);
          light += uCity * plaza * base * vec3(.014, .010, .006);
        #endif
        vec3 col = shade(seasonalSurface(base,n,vWorld), n, vWorld, sunShadow(vWorld,n));
        float opacity = 1.;
        #ifdef ATRIUM_GLASS
          // Follow the vaulted section across its crown. Filter the frame lines
          // over the pixel footprint so they stay quiet at the LOD boundary.
          vec2 paneUV = vec2(vWorld.x / 2.8, atan(vWorld.y - 59., vWorld.z - 1945.) * 6.);
          vec2 pixel = max(fwidth(paneUV), vec2(.001));
          vec2 seam = abs(fract(paneUV + .5) - .5);
          vec2 frame = 1. - smoothstep(vec2(.025) - pixel*.5, vec2(.025) + pixel*.5, seam);
          float bars = max(frame.x, frame.y);
          vec3 incident = normalize(vWorld - cameraPosition);
          float grazing = pow(1. - abs(dot(incident,n)), 3.);
          col = mix(col * .36 + skyColor(reflect(incident,n)) * .22, col * .52, bars);
          opacity = mix(.16 + .34*grazing, .88, bars);
        #endif
        gl_FragColor = vec4(applyHaze(col, light, vWorld), opacity);
      }`,
  });
}

export async function loadStationDetail(env: Env, hf: Heightfield, center: THREE.Vector3) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const {scene: group} = await loader.loadAsync('/kyoto/kyoto-station-district.glb');
  const materials = new Map<THREE.MeshStandardMaterial, THREE.ShaderMaterial>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  group.updateMatrixWorld(true);
  group.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const source = obj.material as THREE.MeshStandardMaterial;
    geometries.add(obj.geometry);
    if (source.name.startsWith('Plaza-')) {
      // Quantized vertices share a scaled parent. Apply the DEM in metres,
      // then return to mesh space before drawing both the plaza and its shadows.
      const attr = obj.geometry.getAttribute('position');
      const adjusted = new Float32Array(attr.count * 3);
      const inverse = obj.matrixWorld.clone().invert();
      const point = new THREE.Vector3();
      for (let i = 0; i < attr.count; i++) {
        point.fromBufferAttribute(attr, i).applyMatrix4(obj.matrixWorld);
        point.y += hf.height(center.x + point.x, center.z + point.z) - center.y + .16;
        point.applyMatrix4(inverse).toArray(adjusted, i * 3);
      }
      obj.geometry.setAttribute('position', new THREE.BufferAttribute(adjusted, 3));
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
    }
    let material = materials.get(source);
    if (!material) {
      material = stationMaterial(source, env, center.y);
      materials.set(source, material);
      if (source.map) textures.add(source.map);
      source.dispose();
    }
    obj.material = material;
    if (!material.transparent) obj.layers.enable(SHADOW_LAYER);
  });
  group.name = 'Kyoto station detail';
  group.position.copy(center);
  return { group, dispose() {
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    const images = new Set<ImageBitmap>();
    for (const texture of textures) {
      texture.dispose();
      if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    }
    for (const image of images) image.close();
  }};
}
