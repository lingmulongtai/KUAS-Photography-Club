/** Keep the GPU busy without queuing a long series of obsolete camera poses. */
export function createFrameQueue(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const context = 'fenceSync' in gl ? gl : undefined;
  const pending: WebGLSync[] = [];
  let enabled = !!context;
  function clear() {
    for (const sync of pending) context?.deleteSync(sync);
    pending.length = 0;
  }
  return {
    available() {
      if (!context || !enabled || pending.length < 2) return true;
      // A zero timeout is a poll. Pointer handlers can run while the GPU catches up.
      const status = context.clientWaitSync(pending[0], 0, 0);
      if (status === context.TIMEOUT_EXPIRED) return false;
      if (status === context.WAIT_FAILED) {
        clear();
        enabled = false;
      } else {
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
    },
    // Context loss already destroyed the old sync objects.
    restored() { pending.length = 0; enabled = !!context; },
  };
}
