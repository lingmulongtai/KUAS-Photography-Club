import * as THREE from 'three';
import {lonLat,tileXY} from '../kansai/coordinates';
import expo from '../../../public/kansai/expo-imagery/index.json';
import {M_PER_DEG_LAT,M_PER_DEG_LON,ORIGIN,toLocal,type Box} from './geo';

export interface RegionalPhoto {photo:THREE.Texture;box:Box;raw?:boolean}
export type RegionalPhotoRadius = 1 | 2 | 3;
export interface RegionalPhotoOptions {
  radius?: RegionalPhotoRadius;
  maxZoom?: 16 | 17;
  /** Zoom level already covered by a harmonized local district sheet at the target. */
  coveredZoom?: number;
  /** True while flying to a destination or orbiting a fixed landmark: never drop zoom due to camera motion. */
  prefetch?: boolean;
}

const TILE_PX = 256;

/** Fetch a GSI seamlessphoto tile, falling back to cropping the parent quadrant on 404 (e.g. open water). */
function createTileCache(limit = 180) {
  const blobs = new Map<string, Blob | null>();
  function remember(key: string, value: Blob | null) {
    blobs.delete(key);
    blobs.set(key, value);
    if (blobs.size > limit) blobs.delete(blobs.keys().next().value!);
  }
  async function loadBlob(zoom: number, x: number, y: number, signal: AbortSignal): Promise<Blob | null> {
    const k = `${zoom}/${x}/${y}`;
    if (blobs.has(k)) {
      const hit = blobs.get(k)!;
      remember(k, hit);
      return hit;
    }
    const url = `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${zoom}/${x}/${y}.jpg`;
    const res = await fetch(url, { signal });
    if (res.status === 404) {
      remember(k, null);
      return null;
    }
    if (!res.ok) throw new Error('Regional aerial photo: ' + res.status);
    const blob = await res.blob();
    remember(k, blob);
    return blob;
  }
  async function drawTile(
    ctx: CanvasRenderingContext2D,
    destX: number,
    destY: number,
    zoom: number,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    let z = zoom, tx = x, ty = y;
    let sx = 0, sy = 0, sw = TILE_PX;
    while (z >= 14) {
      if (signal.aborted) return false;
      const blob = await loadBlob(z, tx, ty, signal);
      if (blob) {
        if (signal.aborted) return false;
        const bitmap = await createImageBitmap(blob);
        try {
          if (!signal.aborted) ctx.drawImage(bitmap, sx, sy, sw, sw, destX, destY, TILE_PX, TILE_PX);
        } finally {
          bitmap.close();
        }
        return !signal.aborted;
      }
      // Step up to parent tile and narrow source crop to the matching child quadrant.
      const half = sw * 0.5;
      sx = (tx & 1) * 128 + sx * 0.5;
      sy = (ty & 1) * 128 + sy * 0.5;
      sw = half;
      tx >>= 1;
      ty >>= 1;
      z--;
    }
    return false;
  }
  return { drawTile };
}

/**
 * Choose live close-up GSI orthophoto zoom from camera altitude and quality tier ceiling.
 * Keeps z16 (2.5 km wide at radius=2) across airport & landmark orbit altitudes (220–1650 m)
 * so wide sites stay sharp edge-to-edge instead of shrinking to a narrow 1.25 km z17 patch.
 */
export function selectRegionalPhotoZoom(height: number, fast: boolean, maxZoom: 16 | 17, prefetch = false): number {
  if (prefetch) return Math.min(maxZoom, 16);
  if (fast) return 15;
  if (height < 220) return maxZoom;
  if (height < 1650) return 16;
  return 15;
}

interface PhotoLayerState {
  controller?: AbortController;
  active: RegionalPhoto | null;
  activeZoom: number;
  activeCx: number;
  activeCy: number;
  inFlightKey: string;
  inFlightZoom: number;
  inFlightCx: number;
  inFlightCy: number;
  candidate: string;
  since: number;
  retryAt: number;
}

function createLayerState(): PhotoLayerState {
  return {
    active: null,
    activeZoom: 0,
    activeCx: NaN,
    activeCy: NaN,
    inFlightKey: '',
    inFlightZoom: 0,
    inFlightCx: NaN,
    inFlightCy: NaN,
    candidate: '',
    since: 0,
    retryAt: 0,
  };
}

/**
 * Two-tier live orthophoto pyramid following the camera's sightline or active orbit target:
 * - `mid` (z15, 5×5 tiles ≈ 5 km × 5 km) provides wide, rock-solid regional coverage across entire
 *   airports, bays and mountain valleys without dropping to coarse base imagery while orbiting.
 * - `close` (z16/z17, 5×5 or 3×3 tiles) sharpens the foreground focus area on top of `mid`.
 */
export function regionalPhoto(
  aniso: number,
  onCloseChange: (sheet: RegionalPhoto | null) => void,
  onMidChange?: (sheet: RegionalPhoto | null) => void,
) {
  const tileCache = createTileCache(320);
  const close = createLayerState();
  const mid = createLayerState();
  let lastX = NaN, lastZ = NaN, lastTime = 0, fastUntil = 0;

  function install(state: PhotoLayerState, sheet: RegionalPhoto | null, notify: (s: RegionalPhoto | null) => void, zoom = 0, cx = NaN, cy = NaN) {
    const previous = state.active;
    state.active = sheet;
    state.activeZoom = sheet ? zoom : 0;
    state.activeCx = sheet ? cx : NaN;
    state.activeCy = sheet ? cy : NaN;
    notify(sheet);
    previous?.photo.dispose();
  }

  function clearLayer(state: PhotoLayerState, notify: (s: RegionalPhoto | null) => void) {
    state.controller?.abort();
    state.controller = undefined;
    state.inFlightKey = state.candidate = '';
    state.inFlightZoom = 0;
    state.inFlightCx = state.inFlightCy = NaN;
    if (state.active) install(state, null, notify);
  }

  async function prepare(
    state: PhotoLayerState,
    notify: (s: RegionalPhoto | null) => void,
    cx: number,
    cy: number,
    zoom: number,
    radius: RegionalPhotoRadius,
    signal: AbortSignal,
  ) {
    const grid = radius * 2 + 1;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = grid * TILE_PX;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const west = cx - radius, north = cy - radius;
    const tiles: { x: number; y: number }[] = [];
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) tiles.push({ x, y });
    tiles.sort((a, b) => Math.hypot(a.x - radius, a.y - radius) - Math.hypot(b.x - radius, b.y - radius));
    let count = 0;
    async function read() {
      while (!signal.aborted && tiles.length) {
        const { x, y } = tiles.shift()!;
        if (await tileCache.drawTile(context, x * TILE_PX, y * TILE_PX, zoom, west + x, north + y, signal)) count++;
      }
    }
    const workerCount = radius >= 3 ? 6 : radius >= 2 ? 5 : 3;
    const workers = Array.from({ length: workerCount }, () => read());
    await Promise.all(workers);
    if (signal.aborted) return;
    state.inFlightKey = '';
    state.inFlightZoom = 0;
    if (!count) return;
    const photo = new THREE.CanvasTexture(canvas);
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = aniso;
    const a = lonLat(west, north, zoom), b = lonLat(west + grid, north + grid, zoom);
    const nw = toLocal(a[1], a[0]), se = toLocal(b[1], b[0]);
    install(state, { photo, box: [nw.x, nw.z, se.x, se.z], raw: true }, notify, zoom, cx, cy);
  }

  function requestLayer(
    state: PhotoLayerState,
    notify: (s: RegionalPhoto | null) => void,
    lon: number,
    lat: number,
    zoom: number,
    radius: RegionalPhotoRadius,
    now: number,
    recenterThreshold: number,
    abortThreshold: number,
  ) {
    const [cx, cy] = tileXY(lon, lat, zoom).map(Math.floor);
    // Keep existing crisp coverage if target is still well inside the active sheet at the same zoom.
    if (
      state.active &&
      state.activeZoom === zoom &&
      Math.max(Math.abs(cx - state.activeCx), Math.abs(cy - state.activeCy)) < recenterThreshold
    ) {
      return;
    }
    // Never abort a nearly-compatible in-flight fetch while orbiting or gently turning.
    if (
      state.inFlightKey &&
      state.inFlightZoom === zoom &&
      Math.max(Math.abs(cx - state.inFlightCx), Math.abs(cy - state.inFlightCy)) < abortThreshold
    ) {
      return;
    }
    const key = `${zoom}/${radius}/${cx}/${cy}`;
    if (state.candidate !== key) {
      state.candidate = key;
      state.since = now;
    }
    if (state.inFlightKey === key || now - state.since < 0.12 || now < state.retryAt) return;
    state.controller?.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;
    state.inFlightKey = key;
    state.inFlightZoom = zoom;
    state.inFlightCx = cx;
    state.inFlightCy = cy;
    void prepare(state, notify, cx, cy, zoom, radius, signal).catch(() => {
      if (!signal.aborted) {
        state.inFlightKey = '';
        state.inFlightZoom = 0;
        state.retryAt = performance.now() / 1000 + 6;
      }
    });
  }

  return (x: number, z: number, height: number, now: number, enabled: boolean, options: RegionalPhotoOptions = {}) => {
    if (!enabled) {
      lastX = NaN;
      clearLayer(close, onCloseChange);
      if (onMidChange) clearLayer(mid, onMidChange);
      return;
    }
    const lon = ORIGIN.lon + x / M_PER_DEG_LON, lat = ORIGIN.lat - z / M_PER_DEG_LAT;
    const radius: RegionalPhotoRadius = options.radius ?? 2;
    const midRadius: RegionalPhotoRadius = radius >= 3 ? 3 : 2;
    const [w, s, e, n] = expo.bounds;
    if (lon >= w && lon <= e && lat >= s && lat <= n) {
      if (onMidChange) requestLayer(mid, onMidChange, lon, lat, 15, midRadius, now, midRadius, midRadius + 1);
      if (close.inFlightKey === 'expo' || (close.active && close.activeZoom === 99) || now < close.retryAt) return;
      close.controller?.abort();
      close.inFlightKey = close.candidate = 'expo';
      void new THREE.TextureLoader().loadAsync('/kansai/expo-imagery/home.webp').then((photo) => {
        if (close.inFlightKey !== 'expo') { photo.dispose(); return; }
        close.inFlightKey = '';
        photo.colorSpace = THREE.SRGBColorSpace;
        photo.anisotropy = aniso;
        const nw = toLocal(n, w), se = toLocal(s, e);
        install(close, { photo, box: [nw.x, nw.z, se.x, se.z] }, onCloseChange, 99, 0, 0);
      }).catch(() => {
        if (close.inFlightKey === 'expo') {
          close.inFlightKey = '';
          close.retryAt = performance.now() / 1000 + 8;
        }
      });
      return;
    }
    if (now > lastTime && !options.prefetch && Math.hypot(x - lastX, z - lastZ) > (now - lastTime) * 750) {
      fastUntil = now + 0.7;
    }
    lastX = x; lastZ = z; lastTime = now;
    const maxZoom = options.maxZoom ?? 17;
    const closeZoom = selectRegionalPhotoZoom(height, now < fastUntil, maxZoom, !!options.prefetch);
    const coveredZoom = options.coveredZoom ?? 0;

    // 1. Always maintain a wide 5–7 km z15 mid-range backdrop unless a local district covers z15+.
    if (onMidChange) {
      if (coveredZoom >= 15) clearLayer(mid, onMidChange);
      else requestLayer(mid, onMidChange, lon, lat, 15, midRadius, now, midRadius, midRadius + 1);
    }

    // 2. Load the sharper close-up sheet (z16 or z17, up to 3.5 km wide) right over the active focus area.
    if (coveredZoom >= closeZoom || (onMidChange && closeZoom <= 15)) {
      clearLayer(close, onCloseChange);
      return;
    }
    requestLayer(close, onCloseChange, lon, lat, closeZoom, radius, now, Math.max(1, radius - 1), radius);
  };
}
