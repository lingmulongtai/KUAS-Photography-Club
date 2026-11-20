const WINDOW_MS = 1000;

/** Intervals between submitted hero frames. A pause starts a fresh interval on resume. */
export function createFrameMeter() {
  let previous: number | undefined;
  let first: number | undefined;
  let intervals = 0, elapsed = 0, overBudget = 0;
  let recent: { at: number; ms: number }[] = [];

  return {
    frame(now: number) {
      if (previous === undefined) {
        first = previous = now;
        return;
      }
      const ms = now - previous;
      if (ms <= 0) return;
      previous = now;
      elapsed += ms;
      intervals++;
      if (ms > 1000 / 30) overBudget++;
      recent.push({ at: now, ms });
    },
    pause() {
      first = previous = undefined;
      recent = [];
    },
    read(now: number) {
      recent = recent.filter(frame => frame.at > now - WINDOW_MS);
      const span = first === undefined ? 0 : Math.min(now - first, WINDOW_MS);
      const sorted = recent.map(frame => frame.ms).sort((a, b) => a - b);
      return {
        fps: span > 0 ? recent.length * 1000 / span : null,
        averageFps: intervals ? intervals * 1000 / elapsed : null,
        p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
        overBudgetPercent: intervals ? overBudget * 100 / intervals : null,
      };
    },
  };
}
