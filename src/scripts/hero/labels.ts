import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { toLocal, type Box } from './geo';
import { SPOTS, type SpotId } from '../../data/spots';
import { REGIONAL_PLACES, EXTRA_LANDMARKS, spotDestination, type HeroDestination } from './views';
import {
  ACTION_SLOTS,
  DEFAULT_SLOTS,
  choosePinSlot,
  effectivePinPriority,
  maxPinDistance,
  type PinSlot,
  type ScreenRect,
} from './pin-layout';

export interface LabelDef {
  id: SpotId;
  /** lower numbers win when pins would overlap */
  rank: number;
  ja: string;
  en: string;
  lat: number;
  lon: number;
  /** metres above the ground where the pin points */
  above: number;
  /** Highlight the campus destination. */
  action?: boolean;
}

export interface MapPinDef {
  id: string;
  destination: HeroDestination;
  /** Lower numbers win when pins compete at similar distances. */
  rank: number;
  ja: string;
  en: string;
  lat: number;
  lon: number;
  /** Metres above ground where the pin points. */
  above: number;
  /** Optional spot ID for club outing records and badges. */
  spotId?: SpotId;
  /** Highlight the campus destination. */
  action?: boolean;
}

/** Places worth naming in the view west from Shogunzuka. Coordinates from OpenStreetMap. */
export const LABELS: readonly LabelDef[] = SPOTS;

interface RegionalPinStyle {
  rank: number;
  above: number;
  ja?: string;
  en?: string;
}

/** Concise map labels, hierarchy ranks and elevations for regional outings and 3D landmarks. */
const REGIONAL_PIN_STYLE: Record<string, RegionalPinStyle> = {
  // Shiga / Lake Biwa
  'biwako-fireworks': { rank: 1, above: 45, ja: '大津港・びわ湖', en: 'Otsu Port · Lake Biwa' },
  setagawa: { rank: 2, above: 24, ja: '瀬田の唐橋', en: 'Seta-no-Karahashi' },
  'biwa-museum': { rank: 2, above: 26 },
  mizunomori: { rank: 3, above: 18, ja: 'みずの森', en: 'Mizunomori Garden' },
  miyagahama: { rank: 2, above: 24, ja: '近江八幡', en: 'Ohmi-Hachiman' },
  // Osaka
  'osaka-castle': { rank: 1, above: 65 },
  'expo-2025': { rank: 1, above: 45, ja: '大阪・関西万博', en: 'Expo 2025 · Yumeshima' },
  nakanoshima: { rank: 2, above: 24 },
  tennoji: { rank: 2, above: 28 },
  senrigawa: { rank: 2, above: 20 },
  minoh: { rank: 2, above: 30 },
  // Nara
  'nara-park': { rank: 1, above: 34, ja: '奈良公園', en: 'Nara Park' },
  wakakusa: { rank: 2, above: 24 },
  ikoma: { rank: 2, above: 55 },
  // Hyogo / Kobe
  meriken: { rank: 1, above: 95, ja: 'メリケンパーク', en: 'Kobe · Meriken Park' },
  nankinmachi: { rank: 2, above: 24, ja: '南京町', en: 'Nankinmachi' },
  maya: { rank: 2, above: 45, ja: '摩耶山', en: 'Mt. Maya' },
  // Additional Kyoto outings & 3D landmarks
  aquarium: { rank: 2, above: 24 },
  botanical: { rank: 2, above: 24 },
  nanzenji: { rank: 2, above: 28, ja: '南禅寺', en: 'Nanzen-ji' },
  eikando: { rank: 3, above: 26, ja: '永観堂', en: 'Eikan-do' },
  shimogamo: { rank: 2, above: 26 },
  delta: { rank: 3, above: 16 },
  'old-office': { rank: 3, above: 24, en: 'Old Kyoto Pref. Office' },
  daikakuji: { rank: 2, above: 26 },
  hirosawa: { rank: 3, above: 14 },
  hozukyo: { rank: 2, above: 35 },
  sagano: { rank: 3, above: 24, ja: 'トロッコ保津峡', en: 'Torokko Hozukyo' },
  kifune: { rank: 2, above: 30, ja: '貴船', en: 'Kifune' },
  kurama: { rank: 2, above: 34, ja: '鞍馬寺', en: 'Kurama-dera' },
  daikichiyama: { rank: 3, above: 28, ja: '大吉山展望台', en: 'Daikichiyama' },
};

const EXTRA_PIN_STYLE: Record<(typeof EXTRA_LANDMARKS)[number]['id'], { rank: number; above: number }> = {
  hikone: { rank: 1, above: 42 },
  yogo: { rank: 2, above: 24 },
  hiei: { rank: 2, above: 45 },
  todaiji: { rank: 2, above: 54 },
  kasuga: { rank: 3, above: 24 },
  kix: { rank: 1, above: 86 },
  itami: { rank: 1, above: 54 },
  kobeAirport: { rank: 1, above: 52 },
  osakaStation: { rank: 1, above: 76 },
  usj: { rank: 1, above: 58 },
  abenoHarukas: { rank: 1, above: 306 },
  umedaSky: { rank: 1, above: 178 },
  tsutenkaku: { rank: 2, above: 112 },
};

export const ALL_PINS: readonly MapPinDef[] = [
  ...SPOTS.map((s): MapPinDef => ({
    id: s.id,
    destination: spotDestination(s.id),
    rank: s.rank,
    ja: s.ja,
    en: s.en,
    lat: s.lat,
    lon: s.lon,
    above: s.above,
    spotId: s.id,
    action: 'action' in s ? s.action : undefined,
  })),
  ...REGIONAL_PLACES.map((p): MapPinDef => {
    const style = REGIONAL_PIN_STYLE[p.id] ?? { rank: 2, above: 28 };
    return {
      id: `region-${p.id}`,
      destination: `region-${p.id}` as HeroDestination,
      rank: style.rank,
      ja: style.ja ?? p.ja,
      en: style.en ?? p.en,
      lat: p.lat,
      lon: p.lon,
      above: style.above,
    };
  }),
  ...EXTRA_LANDMARKS.map((m): MapPinDef => ({
    id: m.id,
    destination: m.id,
    rank: EXTRA_PIN_STYLE[m.id].rank,
    ja: m.ja,
    en: m.en,
    lat: m.lat,
    lon: m.lon,
    above: EXTRA_PIN_STYLE[m.id].above,
  })),
];

export interface HeroTrip {
  spot: string;
  title: string;
  href: string;
  src: string;
  alt: string;
  credit: string;
  sample: boolean;
}

/** Check whether the terrain blocks the sightline from the camera to a visible upper landmark point. */
export function isSightlineBlocked(
  cam: { x: number; y: number; z: number },
  ground: { x: number; y: number; z: number },
  above: number,
  heightAt: (x: number, z: number) => number,
): boolean {
  const targetY = ground.y + Math.max(14, Math.min(above, 48));
  const dx = ground.x - cam.x;
  const dz = ground.z - cam.z;
  const dy = targetY - cam.y;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 160) return false;
  // Skip ~60 m around the camera and around the landmark's own sloped terrace/hillside base.
  const endSkip = Math.min(0.25, 60 / dist);
  const span = 1 - endSkip * 2;
  if (span <= 0.05) return false;
  const steps = Math.min(48, Math.max(14, Math.ceil(dist / 350)));
  const clearance = 6 + Math.min(18, dist * 0.0012);
  for (let s = 1; s < steps; s++) {
    const t = endSkip + (span * s) / steps;
    const x = cam.x + dx * t;
    const z = cam.z + dz * t;
    const y = cam.y + dy * t;
    if (heightAt(x, z) > y + clearance) return true;
  }
  return false;
}

function insideBox(x: number, z: number, box: Box) {
  return x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
}

const SLOT_CLASSES: Record<PinSlot, string> = {
  top: '',
  right: 'pin-slot-right',
  left: 'pin-slot-left',
  bottom: 'pin-slot-bottom',
};

/**
 * Pins that follow their places on screen. They adaptively place labels without overlapping
 * each other or UI controls, prioritize nearby landmarks over distant ones, and update ground
 * elevations once the five-prefecture Kansai survey loads.
 */
export function createLabels(
  el: HTMLElement,
  hf: Heightfield,
  onAction: (destination: HeroDestination) => void,
  avoid?: () => ScreenRect[],
  trips: HeroTrip[] = [],
  lang: 'ja' | 'en' = 'ja',
) {
  const layer = document.createElement('div');
  layer.className = 'hero-labels';
  el.appendChild(layer);

  let groundFn = (x: number, z: number) => hf.height(x, z);
  let activeBounds: Box = hf.bounds;

  const items = ALL_PINS.map((d, i) => {
    const p = toLocal(d.lat, d.lon);
    const inBounds = insideBox(p.x, p.z, activeBounds);
    const groundY = inBounds ? groundFn(p.x, p.z) : 0;
    const related = d.spotId ? trips.filter((t) => t.spot === d.spotId).slice(0, 3) : [];
    const outings = d.spotId ? trips.filter((t) => t.spot === d.spotId && !t.sample).length : 0;
    const node = document.createElement('div');
    node.className = `hero-pin is-linked${d.action ? ' is-action' : ''}${outings ? ' is-visited' : ''}`;
    node.dataset.spot = d.id;
    node.style.setProperty('--i', String(i));
    node.setAttribute('aria-hidden', 'true');
    node.inert = true;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.tabIndex = -1;
    trigger.className = 'pin-trigger';
    trigger.innerHTML = '<span class="pin-dot" aria-hidden="true"></span><span class="pin-text"></span>';
    const text = trigger.querySelector<HTMLElement>('.pin-text')!;
    const badge = outings ? document.createElement('span') : null;
    if (badge) {
      badge.className = 'pin-visited';
      text.append(badge);
    }
    const name = document.createTextNode('');
    const subtitle = document.createElement('small');
    text.append(name, subtitle);
    node.appendChild(trigger);
    const popup = document.createElement('div');
    popup.className = 'pin-trips';
    popup.id = `hero-trips-${d.id}`;
    popup.hidden = true;
    let leaveTimer: ReturnType<typeof setTimeout>;
    const close = () => {
      clearTimeout(leaveTimer);
      if (popup.hidden) return;
      popup.hidden = true;
      node.classList.remove('is-open');
    };
    const open = () => {
      clearTimeout(leaveTimer);
      layer.querySelectorAll<HTMLElement>('.is-open').forEach((other) => {
        if (other !== node) other.dispatchEvent(new Event('close-pin'));
      });
      popup.hidden = false;
      node.classList.add('is-open');
    };
    trigger.addEventListener('click', () => { close(); onAction(d.destination); });
    const records = related.map((trip) => {
      const link = document.createElement('a');
      if (trip.src) {
        const img = document.createElement('img');
        img.src = trip.src; img.alt = trip.alt; img.width = 240; img.height = 135; img.loading = 'lazy';
        link.append(img);
      }
      const title = document.createElement('strong'), credit = document.createElement('small');
      link.append(title, credit);
      popup.appendChild(link);
      return { trip, link, title, credit };
    });
    function translate(language: 'ja' | 'en') {
      const en = language === 'en';
      name.data = d[language];
      subtitle.textContent = en ? d.ja : d.en;
      if (badge) badge.textContent = (en ? 'Outing' : '撮影会') + (outings > 1 ? ` ×${outings}` : '');
      trigger.setAttribute('aria-label', en
        ? `Explore ${d.en} in 3D${outings ? ' (club outing here)' : ''}`
        : `${d.ja}へ近づく${outings ? '（撮影会の記録あり）' : ''}`);
      if (records.length) popup.setAttribute('aria-label', en ? `Outing records near ${d.en}` : `${d.ja}の撮影会`);
      for (const { trip, link, title, credit } of records) {
        const englishPreview = en && trip.sample;
        link.href = englishPreview ? '/en/trips/' : trip.href;
        title.textContent = englishPreview ? 'Activity records' : trip.title;
        credit.textContent = englishPreview ? 'Records are being prepared' : trip.credit;
      }
    }
    translate(lang);
    if (records.length) {
      popup.setAttribute('role', 'region');
      node.appendChild(popup);
      node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(); });
      node.addEventListener('pointerleave', () => { leaveTimer = setTimeout(close, 180); });
      node.addEventListener('focusin', open);
      node.addEventListener('focusout', (e) => { if (!node.contains(e.relatedTarget as Node | null)) close(); });
      node.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); trigger.focus(); close(); } });
      node.addEventListener('close-pin', close);
    }
    layer.appendChild(node);
    return {
      def: d,
      node,
      trigger,
      close,
      text,
      translate,
      inBounds,
      labelWidth: 0,
      labelHeight: 0,
      anchor: new THREE.Vector3(p.x, groundY + d.above, p.z),
      ground: new THREE.Vector3(p.x, groundY, p.z),
      shown: false,
      slot: 'top' as PinSlot,
      far: false,
      x: 0,
      y: 0,
      dist: 0,
      priority: d.rank,
    };
  });

  el.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest('.hero-pin')) items.forEach((it) => it.close());
  });

  const order = [...items];
  const placed: ScreenRect[] = [];
  let blocks: ScreenRect[] = [];
  let frame = 0;
  let forceAvoid = true;
  let forceMeasure = true;
  const v = new THREE.Vector3();
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  const occluded = new Map<string, boolean>();

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => { forceMeasure = true; });
  }

  function applySlot(it: (typeof items)[number], slot: PinSlot) {
    if (it.slot === slot) return;
    const prev = SLOT_CLASSES[it.slot];
    if (prev) it.node.classList.remove(prev);
    const next = SLOT_CLASSES[slot];
    if (next) it.node.classList.add(next);
    it.slot = slot;
  }

  return {
    layer,
    setLanguage(language: 'ja' | 'en') {
      items.forEach((item) => item.translate(language));
      forceMeasure = true;
    },
    /** Upgrade ground elevations and occlusion sampling once the Kansai survey finishes loading. */
    setGround(nextGround: (x: number, z: number) => number, bounds: Box) {
      groundFn = nextGround;
      activeBounds = bounds;
      for (const it of items) {
        it.inBounds = insideBox(it.ground.x, it.ground.z, activeBounds);
        if (!it.inBounds) continue;
        const h = groundFn(it.ground.x, it.ground.z);
        it.ground.y = h;
        it.anchor.y = h + it.def.above;
      }
      occluded.clear();
      lastCam.set(Infinity, 0, 0);
    },
    invalidateLayout() {
      forceAvoid = true;
    },
    /** Show only some pins (for the campus view). */
    filter(ids: string[] | null) {
      for (const it of items) it.node.classList.toggle('is-muted', !!ids && !ids.includes(it.def.id));
      forceAvoid = true;
    },
    update(camera: THREE.PerspectiveCamera, width: number, height: number) {
      const moved = lastCam.distanceToSquared(camera.position) > 1;
      if (moved) lastCam.copy(camera.position);
      placed.length = 0;
      const periodic = frame++ % 20 === 0;
      if (avoid && (forceAvoid || periodic || moved)) {
        blocks = avoid();
        forceAvoid = false;
      }
      if (forceMeasure || frame % 30 === 1) {
        forceMeasure = false;
        for (const it of items) {
          it.labelWidth = it.text.offsetWidth;
          it.labelHeight = it.text.offsetHeight;
        }
      }

      const cam = camera.position;
      for (const it of order) {
        it.dist = it.anchor.distanceTo(cam);
        it.priority = effectivePinPriority(it.def.rank, it.dist, it.shown);
      }
      order.sort((a, b) => a.priority - b.priority);

      const maxVisible = width < 900 ? 7 : 12;
      let visibleCount = 0;

      for (const it of order) {
        const muted = it.node.classList.contains('is-muted');
        const horiz = Math.hypot(it.ground.x - cam.x, it.ground.z - cam.z);
        // Only suppress when practically standing inside the anchor itself, not when orbiting or approaching nearby.
        const here = horiz < 65 || it.dist < 95;
        const inRange = it.inBounds && !here && it.dist <= maxPinDistance(it.def.rank);

        let show = false;
        let px = 0;
        let py = 0;
        let chosenSlot: PinSlot = it.slot;

        if (inRange && !muted && visibleCount < maxVisible) {
          v.copy(it.anchor).project(camera);
          const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.96 && v.y < 0.92 && v.y > -0.96;
          if (onScreen) {
            let blocked = occluded.get(it.def.id);
            if (moved || blocked === undefined) {
              blocked = isSightlineBlocked(cam, it.ground, it.def.above, groundFn);
              occluded.set(it.def.id, blocked);
            }
            if (!blocked) {
              if (!it.labelWidth) {
                it.labelWidth = it.text.offsetWidth;
                it.labelHeight = it.text.offsetHeight;
              }
              px = ((v.x + 1) / 2) * width;
              py = ((1 - v.y) / 2) * height;
              const choice = choosePinSlot(
                px,
                py,
                it.labelWidth,
                it.labelHeight,
                width,
                height,
                placed,
                blocks,
                it.shown ? it.slot : null,
                it.def.action ? ACTION_SLOTS : DEFAULT_SLOTS,
              );
              if (choice) {
                show = true;
                chosenSlot = choice.slot;
                placed.push(choice.rects[0], choice.rects[1]);
                visibleCount++;
              }
            }
          }
        }

        if (!show && it.node.contains(document.activeElement)) {
          el.querySelector<HTMLElement>('.spot-select, .views [aria-pressed="true"]')?.focus({ preventScroll: true });
        }

        if (show) {
          const x = Math.round(px);
          const y = Math.round(py);
          applySlot(it, chosenSlot);
          const isFar = it.dist > 9500 && !it.def.action;
          if (isFar !== it.far) {
            it.far = isFar;
            it.node.classList.toggle('is-far', isFar);
          }
          // Position before toggling .is-shown so newly revealed pins fade in cleanly in place.
          if (x !== it.x || y !== it.y || !it.shown) {
            it.x = x;
            it.y = y;
            it.node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            it.node.style.setProperty('--pin-x', `${x}px`);
            it.node.style.setProperty('--stage-w', `${width}px`);
            it.node.classList.toggle('opens-below', y < 240);
          }
        }

        if (show !== it.shown) {
          it.shown = show;
          it.node.classList.toggle('is-shown', show);
          it.node.inert = !show;
          it.trigger.tabIndex = show ? 0 : -1;
          it.node.setAttribute('aria-hidden', String(!show));
        }
        if (!show) it.close();
      }
    },
  };
}
