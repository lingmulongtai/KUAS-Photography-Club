export interface HeroLoadingCallbacks {
  onProgress?: (progress: number) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

/** Count completed startup jobs, reserving the last step for a successfully drawn scene. */
export function createHeroLoading(callbacks: HeroLoadingCallbacks, jobs: number) {
  let completed = 0;
  let built = false;
  let settled = false;
  return {
    /** A complete scene can be drawn for the first-frame readiness check. */
    get canDraw() { return built; },
    async track<T>(job: Promise<T>): Promise<T> {
      const value = await job;
      if (!settled) callbacks.onProgress?.(++completed / (jobs + 1));
      return value;
    },
    built() { built = true; },
    frame() {
      if (!built || settled) return;
      settled = true;
      callbacks.onProgress?.(1);
      callbacks.onReady?.();
    },
    fail(error: unknown) {
      if (settled) return;
      settled = true;
      callbacks.onError?.(error);
    },
  };
}
