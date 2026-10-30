import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Text } from './i18n';

/**
 * Models and panoramas for the studio. All of them are CC0 assets from
 * Poly Haven (see public/studio/README.md), served from /studio/.
 */
const BASE = '/studio';

export type BackdropId = 'garden' | 'autumn' | 'night' | 'sunset' | 'flowers' | 'snow' | 'street' | 'neon' | 'stars' | 'lightroom';

export interface Backdrop {
  id: BackdropId;
  name: Text;
  /** A short label for the place picker. */
  short: Text;
  /** 'pano' is a photographed panorama; 'stars' a generated night sky; 'room' a dark studio with a paper sweep. */
  kind?: 'pano' | 'stars' | 'room';
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
  /** `auto` points the light at the brightest spot of the panorama (the sun, a street lamp). */
  sun: { dir: [number, number, number]; color: string; intensity: number; auto?: boolean };
  leaves: string | null;
  /** Falling snow instead of leaves. */
  snow?: boolean;
}

export const BACKDROPS: Record<BackdropId, Backdrop> = {
  garden: {
    id: 'garden',
    name: { ja: '日本庭園（名古屋城 二の丸庭園）', en: 'Japanese garden (Nagoya Castle Ninomaru)' },
    short: { ja: '日本庭園', en: 'Garden' },
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
    name: { ja: '晩秋の林と夕方の逆光', en: 'Late-autumn woods against the low sun' },
    short: { ja: '晩秋の林', en: 'Autumn woods' },
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
    name: { ja: '夜の街（上海・外灘）', en: 'City at night (the Bund, Shanghai)' },
    short: { ja: '夜の街', en: 'City night' },
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
  sunset: {
    id: 'sunset',
    name: { ja: '海辺の夕焼け', en: 'Sunset by the sea' },
    short: { ja: '海辺の夕焼け', en: 'Seaside sunset' },
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
  flowers: {
    id: 'flowers',
    name: { ja: '花畑（コスモス）', en: 'Cosmos field' },
    short: { ja: '花畑', en: 'Flower field' },
    file: 'flower_road',
    height: 1.7,
    center: 0.8,
    ev: 14,
    sky: 1,
    highlights: 4,
    env: 0.9,
    sun: { dir: [-0.3, 0.8, -0.3], color: '#fff3e0', intensity: 2.4, auto: true },
    leaves: null,
  },
  snow: {
    id: 'snow',
    name: { ja: '雪の森', en: 'Snowy forest' },
    short: { ja: '雪の森', en: 'Snowy forest' },
    file: 'snowy_forest_path_01',
    height: 1.7,
    center: 0.5,
    ev: 14,
    sky: 1,
    highlights: 1.2,
    env: 1,
    sun: { dir: [-0.4, 0.5, -0.5], color: '#fff6ec', intensity: 1.6, auto: true },
    leaves: null,
    snow: true,
  },
  street: {
    id: 'street',
    name: { ja: '夜の石畳の路地', en: 'Cobblestone lane at night' },
    short: { ja: '夜の路地', en: 'Night lane' },
    file: 'cobblestone_street_night',
    height: 1.7,
    center: 0.12,
    ev: 7,
    sky: 1,
    highlights: 6,
    env: 1,
    sun: { dir: [-0.5, 0.6, 0.3], color: '#ffcf9a', intensity: 0.9, auto: true },
    leaves: null,
  },
  neon: {
    id: 'neon',
    name: { ja: 'ネオン管のスタジオ', en: 'Neon studio' },
    short: { ja: 'ネオンのスタジオ', en: 'Neon studio' },
    file: 'neon_photostudio',
    height: 1.6,
    center: 0.53,
    ev: 6.5,
    sky: 1,
    highlights: 8,
    env: 1,
    sun: { dir: [0.6, 0.5, 0.4], color: '#e8eeff', intensity: 0.8 },
    leaves: null,
  },
  lightroom: {
    id: 'lightroom',
    name: { ja: 'ライティングスタジオ（暗室）', en: 'Dark lighting studio' },
    short: { ja: 'ライティング', en: 'Lighting studio' },
    kind: 'room',
    file: 'studio_small_09',
    height: 1.5,
    center: 0.19,
    ev: 4,
    sky: 0.9,
    highlights: 1,
    env: 0.06,
    sun: { dir: [-0.7, 0.6, 0.55], color: '#ffffff', intensity: 0 },
    leaves: null,
  },
  stars: {
    id: 'stars',
    name: { ja: '星空の高原', en: 'Starry highland' },
    short: { ja: '星空の高原', en: 'Starry sky' },
    kind: 'stars',
    file: '',
    height: 1.7,
    center: 0.5,
    ev: -7,
    sky: 1,
    highlights: 1,
    env: 0,
    sun: { dir: [0, 1, 0], color: '#9fb4ff', intensity: 0 },
    leaves: null,
  },
};

/** Every place in the studio, in the order of its picker. */
export const STUDIO_PLACES: BackdropId[] = ['garden', 'flowers', 'autumn', 'snow', 'sunset', 'night', 'street', 'neon', 'lightroom', 'stars'];
export const backdropThumb = (id: BackdropId) => (BACKDROPS[id].kind === 'stars' ? `${BASE}/backgrounds/stars_thumb.jpg` : `${BASE}/backgrounds/${BACKDROPS[id].file}_thumb.jpg`);

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
