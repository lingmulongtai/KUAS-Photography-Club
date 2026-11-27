import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ENV_GLSL, SHADOW_GLSL, type Env } from './env';
import type { Heightfield } from './heightfield';
import { SHADOW_LAYER } from './shadow';
import { plazaSurface } from './kyoto-station';

function stationMaterial(source: THREE.MeshStandardMaterial, env: Env, groundY: number) {
  const map = source.map;
  const glazing = source.name === 'Atrium glazing';
  const district = source.name.startsWith('District ');
  const plaza = plazaSurface(source);
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
      ...((source.name === 'KYcb0061_org.001' || district) && { STATION_ENVELOPE: 1 }),
      ...(district && { DISTRICT_BUILDING: 1 }),
      ...(plaza && { PLAZA: plaza }),
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
        #ifdef PLAZA
          // Match terrain.ts: worn asphalt and grey paving, varied over tens of
          // metres up close and averaged once a texel spans several metres.
          float fp = length(fwidth(vWorld.xz));
          float patchy = mix(.5, vnoise(vWorld.xz * .07), 1. - smoothstep(4., 12., fp));
          #if PLAZA == 1
            base = vec3(.085, .088, .094) * (.85 + .3 * patchy);
            vec3 lamp = vec3(1., .66, .36) * .03;
          #elif PLAZA == 2
            base = vec3(.22, .212, .195) * (.9 + .2 * patchy);
            vec3 lamp = vec3(1., .85, .66) * .03;
          #else
            base = vec3(.055, .072, .032) * (.85 + .3 * patchy);
            vec3 lamp = vec3(1., .85, .66) * .006;
          #endif
          light += lamp * uCity * cityLightShimmer(vWorld);
        #endif
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
          if (uCity > .001) {
            float height = vWorld.y - uGroundY;
            // Resolve groups of occupied rooms behind glazed or moderately dark
            // panes. Fade the individual frames towards their average in the distance.
            float along = abs(n.z) >= abs(n.x) ? vWorld.x : vWorld.z;
            vec2 rooms = vec2(along / 2.7, height / 3.7);
            vec2 pixel = max(fwidth(rooms), vec2(.001));
            vec2 inset = .5 - abs(fract(rooms) - .5);
            vec2 frame = smoothstep(vec2(.14,.21)-.5*pixel, vec2(.14,.21)+.5*pixel, inset);
            float occupancy = .18+.44*uLit;
            float cells = max(pixel.x,pixel.y);
            float detail = 1. - smoothstep(.22,.67,cells);
            float occupied = step(hash12(floor(rooms / vec2(2.,1.))), occupancy);
            // Like the rest of the city, keep small groups of windows resolved
            // until an entire group falls below a pixel.
            float groupLit = step(hash12(floor(rooms / vec2(4.,2.))), occupancy*.55);
            float lit = mix(groupLit, occupied, detail);
            float lamp = mix(.72,1.,hash12(floor(rooms)+vec2(9.,47.)));
            float gray = 1.-smoothstep(.08,.24,abs(chroma));
            float darkGlass = gray * smoothstep(.018,.09,luminance) * (1.-smoothstep(.20,.42,luminance));
            // A darker pane surrounded by lighter framing in the survey photo
            // is a better emitter than a blank, uniformly coloured stone panel.
            float neighborhood = dot(textureLod(uPhoto,vUv,4.).rgb*uTint,vec3(.213,.715,.072));
            float recess = smoothstep(.10,.48,(neighborhood-luminance)/(neighborhood+.015));
            float photoPane = vertical*recess*smoothstep(.001,.014,luminance);
            float transmission = max(photoPane, max(pane, vertical*darkGlass*.85));
            float levels = smoothstep(1.,4.,height);
            // The fixture occupies a narrow band behind the glass. A close
            // curtain wall can cover most of the screen; keep the rest of
            // each pane softly lit even when its fixture reaches city radiance.
            float fixture = abs(fract(rooms.y)-.65);
            float band = 1.-smoothstep(.075-.5*pixel.y,.075+.5*pixel.y,fixture);
            float resolved = mix(frame.x,1.,photoPane) * (.14*frame.y + .86*band);
            float aperture = mix(.20, resolved, detail);
            float interior = lit * mix(.85,lamp,detail) * aperture;
            interior = mix(interior, occupancy*.18, smoothstep(1.4,2.8,cells));
            light += cityWindowRadiance(.34, false) * interior * transmission * levels;
            #ifdef DISTRICT_BUILDING
              float street = vertical * exp(-abs(height-3.)/9.);
              light += uCity * street * (.08+base) * vec3(.047,.035,.024);
            #else
              #ifdef STATION_ENVELOPE
                // A continuous curtain wall shows reflected ceilings and deeper
                // rooms along a floor, with the photo retaining its actual mullions.
                float floorSeed = hash12(vec2(floor(rooms.y), 23.));
                float bays = .5+.5*cos(along*.085 + floorSeed*6.);
                float ceiling = 1.-smoothstep(.06,.54,abs(fract(rooms.y)-.68));
                float floorLight = mix(.30, (.14+.86*ceiling)*(.22+.78*bays), detail);
                light += uCity * levels * transmission * floorLight * vec3(.064,.045,.028);
              #endif
              // Pools of warm light at the entrance continue softly up the north wall.
              float pool = .72+.28*cos((vWorld.x+45.)*.13);
              light += uCity * plaza * pool * (.22+base) * vec3(.092,.065,.042);
            #endif
          }
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
          float grazing = pow(max(0., 1. - abs(dot(incident,n))), 3.);
          col = mix(col * .36 + skyColor(reflect(incident,n)) * .22, col * .52, bars);
          opacity = mix(.16 + .34*grazing, .88, bars);
          light += uCity * mix(vec3(.055,.036,.021),vec3(.018,.014,.009),bars);
        #endif
        gl_FragColor = vec4(applyHaze(col, light, vWorld), opacity);
      }`,
  });
}

/** `far` is derived from the full survey by tools/kyoto-data/build-station-far.mjs. */
export type StationProfile = 'full' | 'compact' | 'far';
const stationFile = (profile: StationProfile) =>
  `kyoto-station-district${profile === 'full' ? '' : '-' + profile}.glb`;

export async function loadStationDetail(env: Env, hf: Heightfield, center: THREE.Vector3, profile: StationProfile, bytes?: Uint8Array) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const {scene: group} = bytes
    ? await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
    : await loader.loadAsync('/kyoto/' + stationFile(profile));
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
  group.name = profile === 'far' ? 'Kyoto station distant' : 'Kyoto station detail';
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
