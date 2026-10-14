export const stepIndex = (index: number, max: number, delta: number) => Math.max(0, Math.min(max, Math.round(index + delta)));
export const nearestStop = (stops: readonly number[], value: number) => stops.reduce((best, n, i) => Math.abs(Math.log(n / value)) < Math.abs(Math.log(stops[best] / value)) ? i : best, 0);

export function syncCameraDial(input: HTMLInputElement | null) {
  const root = input?.closest<HTMLElement>('[data-camera-dial]');
  if (!input || !root) return;
  const levels = JSON.parse(root.dataset.dialLevels ?? '[]') as string[];
  const index = stepIndex(Number(input.value), levels.length - 1, 0);
  const face = root.querySelector<HTMLElement>('[data-dial-face]')!;
  face.setAttribute('aria-valuenow', String(index));
  face.setAttribute('aria-valuetext', levels[index]);
  root.style.setProperty('--dial-angle', `${-140 + index / Math.max(1, levels.length - 1) * 280}deg`);
  root.querySelector('[data-dial-value]')!.textContent = levels[index];
}

export function mountCameraDials() {
  document.querySelectorAll<HTMLElement>('[data-camera-dial]').forEach((root) => {
    if (root.dataset.dialReady) return;
    root.dataset.dialReady = 'true';
    const input = root.querySelector<HTMLInputElement>('input')!;
    const face = root.querySelector<HTMLElement>('[data-dial-face]')!;
    const max = Number(input.max);
    const set = (index: number) => {
      const next = String(stepIndex(index, max, 0));
      if (next !== input.value) { input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); }
      syncCameraDial(input);
    };
    let drag: { id: number; x: number; y: number; index: number } | null = null;
    face.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      face.focus({ preventScroll: true });
      face.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, index: Number(input.value) };
      root.classList.add('is-turning');
    });
    face.addEventListener('pointermove', (e) => {
      if (drag?.id === e.pointerId) set(drag.index + Math.round((e.clientX - drag.x - e.clientY + drag.y) / 14));
    });
    const end = () => { drag = null; root.classList.remove('is-turning'); };
    face.addEventListener('pointerup', (e) => { end(); if (face.hasPointerCapture(e.pointerId)) face.releasePointerCapture(e.pointerId); });
    face.addEventListener('pointercancel', end);
    face.addEventListener('lostpointercapture', end);
    let wheel = 0;
    face.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const delta = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (Math.sign(delta) !== Math.sign(wheel)) wheel = 0;
      wheel += delta;
      const steps = Math.trunc(wheel / 30);
      if (steps) { set(Number(input.value) + steps); wheel -= steps * 30; }
    }, { passive: false });
    face.addEventListener('keydown', (e) => {
      const keys: Record<string, number> = { ArrowRight:1, ArrowUp:1, ArrowLeft:-1, ArrowDown:-1, PageUp:3, PageDown:-3 };
      const delta = keys[e.key];
      if (delta !== undefined || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        set(e.key === 'Home' ? 0 : e.key === 'End' ? max : Number(input.value) + delta!);
      }
    });
    input.addEventListener('input', () => syncCameraDial(input));
    syncCameraDial(input);
  });
}
