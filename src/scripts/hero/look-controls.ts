/** Drag angles in degrees; velocity in degrees/second. */
export function createLookRotation() {
  const state = { yaw: 0, pitch: 0, vx: 0, vy: 0, dragging: false };
  const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    state,
    reset() {
      state.yaw = state.pitch = state.vx = state.vy = 0;
      state.dragging = false;
    },
    move(dx: number, dy: number, width: number, height: number, seconds: number) {
      const yaw = state.yaw;
      const pitch = state.pitch;
      state.yaw = yaw - dx / Math.max(1, width) * 180;
      state.pitch = limit(pitch + dy / Math.max(1, height) * 90, -75, 89);
      const dt = Math.max(1 / 120, seconds);
      state.vx = limit((state.yaw - yaw) / dt, -120, 120);
      state.vy = limit((state.pitch - pitch) / dt, -60, 60);
    },
    stop() { state.dragging = false; state.vx = state.vy = 0; },
    step(dt: number, reduced: boolean) {
      if (reduced) state.vx = state.vy = 0;
      if (state.dragging || dt <= 0) return;
      const decay = Math.exp(-6 * dt);
      const yaw = state.yaw + state.vx * (1 - decay) / 6;
      const pitch = state.pitch + state.vy * (1 - decay) / 6;
      state.yaw = yaw;
      state.pitch = limit(pitch, -75, 89);
      state.vx *= decay;
      state.vy = pitch === state.pitch ? state.vy * decay : 0;
    },
  };
}

/** Keep vertical touch scrolling native and leave controls and short taps alone. */
export function mountLookControls(el: HTMLElement, rotation: ReturnType<typeof createLookRotation>, onTap: (e: PointerEvent) => void, enabled:()=>boolean=()=>true, orbiting:()=>boolean=()=>false) {
  let drag: { id: number; x: number; y: number; lastX: number; lastY: number; time: number; touch: boolean; pin: boolean; moved: boolean } | null = null;
  let suppressClick = false;
  const interactive = (e: PointerEvent) => (e.target as Element).closest('button, a, input, select, textarea, [role="slider"]');
  el.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    const pin=!!(e.target as Element).closest('.pin-trigger');
    if (!enabled() || !e.isPrimary || e.button !== 0 || (!pin && interactive(e))) return;
    rotation.stop();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, time: e.timeStamp, touch: e.pointerType !== 'mouse', pin, moved: false };
    // Leave short pin taps with their button; a swipe takes capture after the threshold.
    if (!drag.touch && !pin) el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      if (drag.touch && Math.abs(dy) >= Math.abs(dx)) { drag = null; rotation.stop(); return; }
      drag.moved = true;
      rotation.state.dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    }
    const r = el.getBoundingClientRect();
    const horizontal = e.clientX - drag.lastX;
    // Turning at a viewpoint and moving around an object need opposite yaw to
    // keep the scenery following the hand, on both mouse and touch screens.
    rotation.move(orbiting() ? -horizontal : horizontal, drag.touch ? 0 : e.clientY - drag.lastY, r.width, r.height, (e.timeStamp - drag.time) / 1000);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.time = e.timeStamp;
  });
  const finish = (e: PointerEvent) => {
    // Touch starts with implicit capture on the canvas. Transferring capture to
    // the stage bubbles the canvas's loss here without ending the stage's drag.
    if (e.type === 'lostpointercapture' && e.target !== el) return;
    if (!drag || drag.id !== e.pointerId) return;
    const previous = drag;
    drag = null;
    rotation.state.dragging = false;
    el.classList.remove('is-dragging');
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    suppressClick = previous.moved;
    if (e.type !== 'pointerup' || e.timeStamp - previous.time > 80) rotation.stop();
    const r = el.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height;
    if (!previous.pin && inside && e.type === 'pointerup' && !previous.moved && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 6) onTap(e);
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  el.addEventListener('lostpointercapture', finish);
  el.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
  }, true);
  window.addEventListener('blur', () => { drag = null; rotation.stop(); el.classList.remove('is-dragging'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { drag = null; rotation.stop(); el.classList.remove('is-dragging'); } });
  return () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && el.hasPointerCapture(id)) el.releasePointerCapture(id);
    rotation.reset();
    el.classList.remove('is-dragging');
  };
}
