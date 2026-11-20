interface RecordedFrame {
  elapsedMs: number;
  segmentStartMs: number;
  intervalMs: number;
  width: number;
  height: number;
}

/** Keep the render callback numeric; format the CSV only after the user stops. */
export function createFrameRecording(startedAt: number) {
  const frames: RecordedFrame[] = [];
  let segmentStartMs = 0;
  return {
    frame(now: number, intervalMs: number | undefined, width: number, height: number) {
      const elapsedMs = now - startedAt;
      if (intervalMs === undefined) segmentStartMs = elapsedMs;
      else frames.push({ elapsedMs, segmentStartMs, intervalMs, width, height });
    },
    csv() {
      const rows = ['frame,elapsed_ms,active_ms,frame_time_ms,fps_1s,avg_fps,over_33_33_ms,width_px,height_px'];
      let activeMs = 0, oldest = 0;
      for (const [index, frame] of frames.entries()) {
        activeMs += frame.intervalMs;
        while (oldest < index && (frames[oldest].segmentStartMs !== frame.segmentStartMs ||
            frames[oldest].elapsedMs <= frame.elapsedMs - 1000)) oldest++;
        const windowMs = Math.min(1000, frame.elapsedMs - frame.segmentStartMs);
        rows.push([
          index + 1, frame.elapsedMs.toFixed(3), activeMs.toFixed(3), frame.intervalMs.toFixed(3),
          ((index - oldest + 1) * 1000 / windowMs).toFixed(2), ((index + 1) * 1000 / activeMs).toFixed(2),
          Number(frame.intervalMs > 1000 / 30), frame.width, frame.height,
        ].join(','));
      }
      return rows.join('\r\n') + '\r\n';
    },
  };
}
