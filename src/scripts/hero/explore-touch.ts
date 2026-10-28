export type ExploreDirection = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';
export type ExploreMovement = { forward: number; side: number; up: number };

/** Independent pointers can hold different directions without releasing one another. */
export function createExploreButtons(root: HTMLElement, onMove: (movement: ExploreMovement) => void) {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-direction]')];
  const held = new Map<string, { button: HTMLButtonElement; direction: ExploreDirection }>();
  let activationTimer = 0;
  const update = () => {
    const directions = new Set([...held.values()].map(value => value.direction));
    buttons.forEach(button => button.classList.toggle('is-held', [...held.values()].some(value => value.button === button)));
    const value = (direction: ExploreDirection) => Number(directions.has(direction));
    onMove({ forward: value('forward') - value('back'), side: value('right') - value('left'), up: value('up') - value('down') });
  };
  const reset = () => { clearTimeout(activationTimer); activationTimer = 0; held.clear(); update(); };
  buttons.forEach(button => {
    const direction = button.dataset.direction as ExploreDirection;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      held.set(`pointer:${event.pointerId}`, { button, direction });
      button.setPointerCapture(event.pointerId);
      update();
    });
    const release = (event: PointerEvent) => {
      event.stopPropagation();
      if (held.delete(`pointer:${event.pointerId}`)) update();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      held.set(`key:${event.key}`, { button, direction });
      update();
    });
    button.addEventListener('keyup', event => {
      if (held.delete(`key:${event.key}`)) { event.preventDefault(); update(); }
    });
    // Screen-reader activation has no press/release pair; move a short, bounded step.
    button.addEventListener('click', event => {
      if (event.detail !== 0) return;
      clearTimeout(activationTimer);
      held.set('activation', { button, direction });
      update();
      activationTimer = window.setTimeout(() => { activationTimer = 0; held.delete('activation'); update(); }, 400);
    });
    button.addEventListener('blur', () => {
      let changed = false;
      for (const [key, value] of held) if (key.startsWith('key:') && value.button === button) { held.delete(key); changed = true; }
      if (changed) update();
    });
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return { reset };
}
