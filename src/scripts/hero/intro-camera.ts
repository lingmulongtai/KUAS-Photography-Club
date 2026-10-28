/** A short, restrained look around after the first scene is visible. Angles are degrees. */
export function createIntroCameraMotion() {
  const duration = 30;
  let elapsed = 0;
  let stopped = false;
  const offset = { yaw: 0, pitch: 0 };
  return {
    offset,
    step(dt: number, visible: boolean, reduced: boolean) {
      if (stopped || !visible || reduced || !Number.isFinite(dt) || dt <= 0) return;
      elapsed = Math.min(duration, elapsed + dt);
      const p = elapsed / duration;
      const eased = p * p * (3 - 2 * p);
      const envelope = Math.sin(Math.PI * p);
      offset.yaw = 5 * Math.sin(Math.PI * eased) + envelope * .045 * Math.sin(elapsed * 1.8);
      offset.pitch = envelope * .035 * (Math.sin(elapsed * 1.3) + .35 * Math.sin(elapsed * 2.4));
      if (elapsed === duration) { offset.yaw = offset.pitch = 0; stopped = true; }
    },
    /** Hand the current angle to manual controls without moving the view. */
    stop() {
      const current = { ...offset };
      offset.yaw = offset.pitch = 0;
      stopped = true;
      return current;
    },
  };
}
