/** Time of day and the corresponding accumulated cloud movement, in minutes. */
export const wrapDay = (minutes: number) => ((minutes % 1440) + 1440) % 1440;
// Slow departure, a decisive middle, then a gentle arrival.
const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

export function createSkyTime() {
  let live = true;
  let from = 0, delta = 0, start = 0, duration = 0;
  let cloudFrom = 0, cloudDelta = 0;
  const progress = (now: number) => duration ? ease(Math.min(1, Math.max(0, (now - start) / duration))) : 1;
  const clouds = (now: number) => cloudFrom + cloudDelta * progress(now);
  const shown = (real: number, now: number) => {
    if (!duration) return live ? real : from + delta;
    const p = progress(now);
    const value = from + delta * p;
    if (p >= 1) { duration = 0; from = value; delta = 0; }
    return value;
  };
  return {
    get live() { return live; },
    get transitioning() { return duration > 0; },
    shown,
    clouds,
    select(target: number, followLive: boolean, real: number, now: number, reducedMotion: boolean) {
      const beforeClouds = clouds(now);
      const before = shown(real, now);
      const change = wrapDay(target - before + 720) - 720;
      cloudFrom = beforeClouds; cloudDelta = change;
      live = followLive; from = before; delta = change; start = now;
      duration = reducedMotion || !change ? 0 : 4200;
      if (!duration) { from += delta; delta = 0; }
    },
    scrub(target: number, real: number, now: number) {
      const beforeClouds = clouds(now);
      const before = shown(real, now);
      cloudFrom = beforeClouds + target - wrapDay(before);
      cloudDelta = 0; live = false; from = target; delta = 0; duration = 0;
    },
  };
}
