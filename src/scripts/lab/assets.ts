import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Models and panoramas for the learning-lab proposals. All of them are CC0 assets from
 * Poly Haven (see public/learn-lab/README.md), served from /learn-lab/.
 */
const BASE = '/learn-lab';

export type BackdropId = 'garden' | 'autumn' | 'night' | 'studio' | 'sunset';

export interface Backdrop {
  id: BackdropId;
  name: string;
  file: string;
  /** How high the panorama was shot (m); sets the scale of the projected ground. */
  height: number;
  /** Horizontal position (0..1 across the panorama) that sits behind the subject. */
  center: number;
  /** Scene brightness, EV100. */
  ev: number;
  /** Panorama brightness relative to the lit subject. */
  sky: number;
  /** Lift for the brightest parts of the tone-mapped panorama, so lights turn into bokeh. */
  highlights: number;
  env: number;
  sun: { dir: [number, number, number]; color: string; intensity: number };
  leaves: string | null;
}

export const BACKDROPS: Record<BackdropId, Backdrop> = {
  garden: {
    id: 'garden',
    name: '日本庭園（名古屋城 二の丸庭園）',
    file: 'ninomaru_teien',
    height: 1.7,
    center: 0.5,
    ev: 13,
    sky: 1,
    highlights: 1.5,
    env: 0.9,
    sun: { dir: [-0.5, 0.75, 0.45], color: '#fff2dd', intensity: 2.2 },
    leaves: '#c8432a',
  },
  autumn: {
    id: 'autumn',
    name: '晩秋の林と夕方の逆光',
    file: 'autumn_forest_04',
    height: 1.7,
    center: 0.55,
    ev: 13,
    sky: 1,
    highlights: 3,
    env: 0.8,
    sun: { dir: [0.15, 0.35, -0.9], color: '#ffd6a0', intensity: 2.6 },
    leaves: '#b7672a',
  },
  night: {
    id: 'night',
    name: '夜の街（上海・外灘）',
    file: 'shanghai_bund',
    height: 1.6,
    center: 0.4,
    ev: 6,
    sky: 1,
    highlights: 24,
    env: 1,
    sun: { dir: [-0.6, 0.5, 0.6], color: '#ffd9b0', intensity: 1.1 },
    leaves: null,
  },
  studio: {
    id: 'studio',
    name: '撮影スタジオ（白ホリ）',
    file: 'studio_small_09',
    height: 1.5,
    center: 0.19,
    ev: 10,
    sky: 0.9,
    highlights: 2,
    env: 1,
    sun: { dir: [-0.7, 0.6, 0.55], color: '#ffffff', intensity: 2.2 },
    leaves: null,
  },
  sunset: {
    id: 'sunset',
    name: '海辺の夕焼け',
    file: 'the_sky_is_on_fire',
    height: 1.6,
    center: 0.6,
    ev: 11,
    sky: 1,
    highlights: 5,
    env: 1,
    sun: { dir: [0.05, 0.25, -1], color: '#ffb47a', intensity: 2.4 },
    leaves: null,
  },
};

export const BACKDROP_ORDER: BackdropId[] = ['garden', 'autumn', 'night', 'studio', 'sunset'];
export const backdropThumb = (id: BackdropId) => `${BASE}/backgrounds/${BACKDROPS[id].file}_thumb.jpg`;

const gltfCache = new Map<string, Promise<GLTF>>();
export function loadGltf(name: string) {
  let p = gltfCache.get(name);
  if (!p) {
    p = import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
      new GLTFLoader().loadAsync(`${BASE}/models/${name}/${name}_1k.gltf`),
    );
    p.catch(() => gltfCache.delete(name));
    gltfCache.set(name, p);
  }
  return p;
}

const panoCache = new Map<string, Promise<THREE.Texture>>();
/** The tone-mapped panorama that is seen behind the subject. */
export function loadPanorama(id: BackdropId) {
  const file = BACKDROPS[id].file;
  let p = panoCache.get(file);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(`${BASE}/backgrounds/${file}.jpg`).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      return tex;
    });
    p.catch(() => panoCache.delete(file));
    panoCache.set(file, p);
  }
  return p;
}

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
/** The small HDR panorama that lights the scene. */
export function loadHdr(id: BackdropId) {
  const file = BACKDROPS[id].file;
  let p = hdrCache.get(file);
  if (!p) {
    p = import('three/addons/loaders/HDRLoader.js')
      .then(({ HDRLoader }) => new HDRLoader().loadAsync(`${BASE}/backgrounds/${file}_1k.hdr`))
      .then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      });
    p.catch(() => hdrCache.delete(file));
    hdrCache.set(file, p);
  }
  return p;
}

/** Canvas texture helper for procedural materials. */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
