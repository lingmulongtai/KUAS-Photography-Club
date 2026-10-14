import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { toLocal } from './geo';

export interface LabelDef {
  id: string;
  /** lower numbers win when pins would overlap */
  rank: number;
  ja: string;
  en: string;
  lat: number;
  lon: number;
  /** metres above the ground where the pin points */
  above: number;
  /** a button rather than a plain label */
  action?: boolean;
}

/** Places worth naming in the view west from Shogunzuka. Coordinates from OpenStreetMap. */
export const LABELS: LabelDef[] = [
  { id: 'tower', rank: 1, ja: '京都タワー', en: 'Kyoto Tower', lat: 34.9875524, lon: 135.7593295, above: 140 },
  { id: 'station', rank: 4, ja: '京都駅', en: 'Kyoto Station', lat: 34.9858, lon: 135.7588, above: 72 },
  { id: 'toji', rank: 2, ja: '東寺', en: 'Toji', lat: 34.98016, lon: 135.74757, above: 64 },
  { id: 'yasaka', rank: 3, ja: '八坂の塔', en: 'Yasaka Pagoda', lat: 34.99823, lon: 135.77905, above: 52 },
  { id: 'kiyomizu', rank: 3, ja: '清水寺', en: 'Kiyomizu-dera', lat: 34.9950586, lon: 135.7838348, above: 40 },
  { id: 'gion', rank: 2, ja: '祇園', en: 'Gion', lat: 35.0036027, lon: 135.7782611, above: 28 },
  { id: 'kawaramachi', rank: 1, ja: '四条河原町', en: 'Shijo-Kawaramachi', lat: 35.0037796, lon: 135.76932, above: 46 },
  { id: 'sanjo', rank: 2, ja: '三条大橋', en: 'Sanjo Bridge', lat: 35.0090445, lon: 135.7717206, above: 26 },
  { id: 'gojo', rank: 2, ja: '五条大橋', en: 'Gojo Bridge', lat: 34.9956954, lon: 135.767913, above: 26 },
  { id: 'kamo', rank: 3, ja: '鴨川', en: 'Kamo River', lat: 35.0185, lon: 135.7716, above: 18 },
  { id: 'nijo', rank: 1, ja: '二条城', en: 'Nijo Castle', lat: 35.0140076, lon: 135.7485369, above: 34 },
  { id: 'gosho', rank: 2, ja: '京都御所', en: 'Imperial Palace', lat: 35.0252635, lon: 135.7623445, above: 30 },
  { id: 'heian', rank: 3, ja: '平安神宮', en: 'Heian Shrine', lat: 35.0125663, lon: 135.7826821, above: 36 },
  { id: 'kinkaku', rank: 2, ja: '金閣寺', en: 'Kinkaku-ji', lat: 35.0395293, lon: 135.7295373, above: 36 },
  { id: 'arashiyama', rank: 2, ja: '嵐山', en: 'Arashiyama', lat: 35.0128713, lon: 135.6777623, above: 80 },
  { id: 'atago', rank: 3, ja: '愛宕山', en: 'Mt. Atago', lat: 35.0600453, lon: 135.6342851, above: 60 },
  { id: 'kuas', rank: 0, ja: '太秦キャンパス', en: 'KUAS Uzumasa Campus', lat: 35.0099245, lon: 135.7184382, above: 48, action: true },
];

/**
 * Pins that follow their places on screen. They hide when off screen or behind a ridge
 * (checked by stepping along the line of sight over the terrain).
 */
export function createLabels(el: HTMLElement, hf: Heightfield, onAction: (id: string) => void, avoid?: () => { x: number; y: number; w: number; h: number }[]) {
  const layer = document.createElement('div');
  layer.className = 'hero-labels';
  el.appendChild(layer);
  const items = LABELS.map((d, i) => {
    const p = toLocal(d.lat, d.lon);
    const ground = hf.height(p.x, p.z);
    const node = document.createElement(d.action ? 'button' : 'div');
    node.className = `hero-pin${d.action ? ' is-action' : ''}`;
    node.style.setProperty('--i', String(i));
    node.innerHTML = `<span class="pin-dot" aria-hidden="true"></span><span class="pin-text">${d.ja}<small>${d.en}</small></span>`;
    if (d.action) {
      (node as HTMLButtonElement).type = 'button';
      node.setAttribute('aria-label', `${d.ja}へ近づく`);
      node.addEventListener('click', () => onAction(d.id));
    } else node.setAttribute('aria-hidden', 'true');
    layer.appendChild(node);
    return { def: d, node, anchor: new THREE.Vector3(p.x, ground + d.above, p.z), ground: new THREE.Vector3(p.x, ground, p.z), shown: false, x: 0, y: 0 };
  });
  const byRank = [...items].sort((a, b) => a.def.rank - b.def.rank);
  const placed: { x: number; y: number; w: number }[] = [];
  let blocks: { x: number; y: number; w: number; h: number }[] = [];
  let frame = 0;
  const v = new THREE.Vector3();
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  const occluded = new Map<string, boolean>();

  /** Is the line from the camera to the place blocked by the terrain? */
  function blocked(cam: THREE.Vector3, target: THREE.Vector3) {
    const steps = 24;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = cam.x + (target.x - cam.x) * t;
      const z = cam.z + (target.z - cam.z) * t;
      const y = cam.y + (target.y - cam.y) * t;
      if (hf.height(x, z) > y + 4) return true;
    }
    return false;
  }

  return {
    layer,
    /** Show only some pins (for the campus view). */
    filter(ids: string[] | null) {
      for (const it of items) it.node.classList.toggle('is-muted', !!ids && !ids.includes(it.def.id));
    },
    update(camera: THREE.PerspectiveCamera, width: number, height: number) {
      const moved = lastCam.distanceToSquared(camera.position) > 1;
      if (moved) lastCam.copy(camera.position);
      placed.length = 0;
      // re-measure the areas to keep clear now and then (they only move on resize and scroll-in)
      if (avoid && (frame++ % 30 === 0 || moved)) blocks = avoid();
      for (const it of byRank) {
        if (moved) occluded.set(it.def.id, blocked(camera.position, it.ground.clone().setY(it.ground.y + 6)));
        // a place you are standing on (Kyoto Tower from its own deck) needs no pin
        const here = Math.hypot(it.ground.x - camera.position.x, it.ground.z - camera.position.z) < 350;
        v.copy(it.anchor).project(camera);
        const onScreen = !here && v.z < 1 && Math.abs(v.x) < 0.95 && v.y < 0.9 && v.y > -0.98;
        let show = onScreen && !occluded.get(it.def.id);
        if (show) {
          // keep pins from piling up: a lower-ranked pin gives way
          const px = ((v.x + 1) / 2) * width;
          const py = ((1 - v.y) / 2) * height;
          const w = it.def.action ? 150 : 96;
          const clash =
            placed.some((p) => Math.abs(p.x - px) < (p.w + w) / 2 && Math.abs(p.y - py) < 34) ||
            blocks.some((b) => px + w / 2 > b.x - 8 && px - w / 2 < b.x + b.w + 8 && py > b.y - 12 && py - 40 < b.y + b.h);
          if (clash) show = false;
          else placed.push({ x: px, y: py, w });
        }
        if (show !== it.shown) {
          it.shown = show;
          it.node.classList.toggle('is-shown', show);
        }
        if (!show) continue;
        const x = Math.round(((v.x + 1) / 2) * width);
        const y = Math.round(((1 - v.y) / 2) * height);
        if (x !== it.x || y !== it.y) {
          it.x = x;
          it.y = y;
          it.node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
      }
    },
  };
}
