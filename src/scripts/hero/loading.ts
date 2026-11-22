export interface HeroLoadingCallbacks {
  onProgress?: (progress: number) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

/** Count completed startup jobs, reserving the last step for cleanly rendered scene frames. */
export function createHeroLoading(callbacks: HeroLoadingCallbacks, jobs: number, requiredFrames = 1) {
  let completed = 0;
  let built = false;
  let rendered = 0;
  let settled = false;
  const advance = () => {
    if (settled) return;
    completed = Math.min(jobs, completed + 1);
    callbacks.onProgress?.(completed / (jobs + 1));
  };
  return {
    /** A complete scene can be drawn for the first-frame readiness check. */
    get canDraw() { return built; },
    async track<T>(job: Promise<T>): Promise<T> {
      const value = await job;
      advance();
      return value;
    },
    /** Report completion of a synchronous or grouped build milestone. */
    step() { advance(); },
    built() { built = true; },
    frame() {
      if (!built || settled) return;
      if (++rendered < requiredFrames) return;
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
