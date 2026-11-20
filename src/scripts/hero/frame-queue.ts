/** Keep the GPU busy without queuing a long series of obsolete camera poses. */
export function createFrameQueue(gl: WebGLRenderingContext | WebGL2RenderingContext, now = () => performance.now()) {
  const context = 'fenceSync' in gl ? gl : undefined;
  const pending: WebGLSync[] = [];
  let enabled = !!context;
  let lastFrame = NaN, interval = 0;
  function clear() {
    for (const sync of pending) context?.deleteSync(sync);
    pending.length = 0;
  }
  return {
    available() {
      if (!context || !enabled || pending.length < 2) return true;
      const age = now() - lastFrame;
      // Chrome can report two completed fences together. Space their replacement poses apart.
      if (interval > 24 && age < interval * .5) return false;
      while (pending.length >= 2) {
        const status = context.clientWaitSync(pending[0], 0, 0);
        if (status === context.TIMEOUT_EXPIRED) {
          // Normally keep two frames in flight. One spare slot covers a late completion notification.
          return pending.length === 2 && interval > 0 && age >= Math.max(32, interval * 1.2);
        }
        if (status === context.WAIT_FAILED) { clear(); enabled = false; break; }
        context.deleteSync(pending.shift()!);
      }
      return true;
    },
    submitted() {
      if (!context || !enabled) return;
      const sync = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) { clear(); enabled = false; return; }
      pending.push(sync);
      context.flush();
      const t = now(), delta = t - lastFrame;
      if (delta > 0 && delta < 200) interval = interval ? interval + (delta - interval) * .125 : delta;
      else interval = 0;
      lastFrame = t;
    },
    // Context loss already destroyed the old sync objects.
    restored() { pending.length = 0; enabled = !!context; lastFrame = NaN; interval = 0; },
  };
}
