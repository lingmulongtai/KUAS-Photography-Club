import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { toLocal } from './geo';
import { SPOTS, type SpotId } from '../../data/spots';
import { pinBounds, overlaps, type ScreenRect } from './pin-layout';

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

/** Places worth naming in the view west from Shogunzuka. Coordinates from OpenStreetMap. */
export const LABELS: readonly LabelDef[] = SPOTS;

export interface HeroTrip {
  spot: string;
  title: string;
  href: string;
  src: string;
  alt: string;
  credit: string;
  sample: boolean;
}

/**
 * Pins that follow their places on screen. They hide when off screen or behind a ridge
 * (checked by stepping along the line of sight over the terrain).
 */
export function createLabels(el: HTMLElement, hf: Heightfield, onAction: (id: SpotId) => void, avoid?: () => { x: number; y: number; w: number; h: number }[], trips: HeroTrip[] = [], lang: 'ja' | 'en' = 'ja') {
  const layer = document.createElement('div');
  layer.className = 'hero-labels';
  el.appendChild(layer);
  const items = LABELS.map((d, i) => {
    const p = toLocal(d.lat, d.lon);
    const ground = hf.height(p.x, p.z);
    const related = trips.filter((t) => t.spot === d.id).slice(0, 3);
    // the club has a published outing here (not just the neutral spot page)
    const outings = trips.filter((t) => t.spot === d.id && !t.sample).length;
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
    trigger.addEventListener('click', () => { close(); onAction(d.id); });
    const records = related.map(trip => {
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
    return { def: d, node, trigger, close, text, translate, labelWidth: 0, labelHeight: 0, anchor: new THREE.Vector3(p.x, ground + d.above, p.z), ground: new THREE.Vector3(p.x, ground, p.z), shown: false, x: 0, y: 0 };
  });
  el.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('.hero-pin')) items.forEach((it) => it.close()); });
  const byRank = [...items].sort((a, b) => a.def.rank - b.def.rank);
  const placed: ScreenRect[] = [];
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
    setLanguage(language: 'ja' | 'en') {
      items.forEach(item => item.translate(language));
      frame = 0; // Re-measure translated labels before placing them.
    },
    /** Show only some pins (for the campus view). */
    filter(ids: string[] | null) {
      for (const it of items) it.node.classList.toggle('is-muted', !!ids && !ids.includes(it.def.id));
    },
    update(camera: THREE.PerspectiveCamera, width: number, height: number) {
      const moved = lastCam.distanceToSquared(camera.position) > 1;
      if (moved) lastCam.copy(camera.position);
      placed.length = 0;
      // re-measure the areas to keep clear now and then (they only move on resize and scroll-in)
      const measure=frame++ % 30===0;
      if (avoid && (measure || moved)) blocks = avoid();
      if (measure) for (const it of items) {
        it.labelWidth=it.text.offsetWidth;
        it.labelHeight=it.text.offsetHeight;
      }
      for (const it of byRank) {
        if (moved) occluded.set(it.def.id, blocked(camera.position, it.ground.clone().setY(it.ground.y + 6)));
        // a place you are standing on (Kyoto Tower from its own deck) needs no pin
        const here = Math.hypot(it.ground.x - camera.position.x, it.ground.z - camera.position.z) < 350;
        v.copy(it.anchor).project(camera);
        const onScreen = !here && v.z < 1 && Math.abs(v.x) < 0.95 && v.y < 0.9 && v.y > -0.98;
        let show = onScreen && !occluded.get(it.def.id) && !it.node.classList.contains('is-muted');
        if (show) {
          // keep pins from piling up: a lower-ranked pin gives way
          const px = ((v.x + 1) / 2) * width;
          const py = ((1 - v.y) / 2) * height;
          const box=pinBounds(px,py,it.labelWidth,it.labelHeight);
          const clash =
            box.x < 8 || box.x+box.w > width-8 || box.y < 8 || box.y+box.h > height-8 ||
            placed.some((p) => overlaps(box,p)) ||
            blocks.some((b) => overlaps(box,{x:b.x-8,y:b.y-8,w:b.w+16,h:b.h+16}));
          if (clash) show = false;
          else placed.push(box);
        }
        // Move focus before inert can remove the disappearing pin from navigation.
        if (!show && it.node.contains(document.activeElement)) el.querySelector<HTMLElement>('.spot-select, .views [aria-pressed="true"]')?.focus({ preventScroll: true });
        if (show !== it.shown) {
          it.shown = show;
          it.node.classList.toggle('is-shown', show);
          it.node.inert = !show;
          it.trigger.tabIndex = show ? 0 : -1;
          it.node.setAttribute('aria-hidden', String(!show));
        }
        if (!show) { it.close(); continue; }
        const x = Math.round(((v.x + 1) / 2) * width);
        const y = Math.round(((1 - v.y) / 2) * height);
        if (x !== it.x || y !== it.y) {
          it.x = x;
          it.y = y;
          it.node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          it.node.style.setProperty('--pin-x', `${x}px`);
          it.node.style.setProperty('--stage-w', `${width}px`);
          it.node.classList.toggle('opens-below', y < 240);
        }
      }
    },
  };
}
