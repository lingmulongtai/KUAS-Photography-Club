import { createFrameMeter } from './frame-meter';
import { createFrameRecording } from './frame-recording';

/** Mounted on demand, with no clock or DOM updates while the panel is closed. */
export function observeFramePanel(panel: HTMLElement, stage: HTMLElement, subscribe: (frame?: () => void) => void) {
  let meter = createFrameMeter();
  const canvas = stage.querySelector('canvas')!;
  const find = (name: string) => panel.querySelector<HTMLElement>(`[data-frame-${name}]`)!;
  const fps = find('fps'), average = find('avg'), p95 = find('p95'), slow = find('slow'), size = find('size');
  const record = panel.querySelector<HTMLButtonElement>('[data-frame-record]')!;
  let recording: ReturnType<typeof createFrameRecording> | undefined;
  const format = (value: number | null, unit = '') => value === null ? '—' : value.toFixed(1) + unit;
  let inView = false, contextLost = false;
  function refresh() {
    const stats = meter.read(performance.now());
    fps.textContent = format(stats.fps);
    average.textContent = format(stats.averageFps);
    p95.textContent = format(stats.p95Ms, ' ms');
    slow.textContent = format(stats.overBudgetPercent, '%');
    size.textContent = `${canvas.width} × ${canvas.height}`;
    record.disabled = !recording && stats.fps === null;
  }
  const frame = () => {
    const now = performance.now();
    const ms = meter.frame(now);
    recording?.frame(now, ms, canvas.width, canvas.height);
  };
  function stopAndSave() {
    if (!recording) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', recording.csv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kuas-hero-fps-${new Date().toISOString().replace(/:/g, '-')}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    recording = undefined;
    record.textContent = record.dataset.start!;
    record.setAttribute('aria-pressed', 'false');
  }
  function updateActivity() {
    const active = inView && !document.hidden && !contextLost;
    if (!active) meter.pause();
    subscribe(active ? frame : undefined);
    refresh();
  }
  const abort = new AbortController();
  const options = { signal: abort.signal };
  record.addEventListener('click', () => {
    if (recording) stopAndSave();
    else {
      meter = createFrameMeter();
      recording = createFrameRecording(performance.now());
      record.textContent = record.dataset.stop!;
      record.setAttribute('aria-pressed', 'true');
    }
    refresh();
  }, options);
  document.addEventListener('visibilitychange', updateActivity, options);
  canvas.addEventListener('webglcontextlost', () => { contextLost = true; updateActivity(); }, options);
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; updateActivity(); }, options);
  const observer = new IntersectionObserver(([entry]) => {
    if (abort.signal.aborted) return;
    inView = entry.isIntersecting;
    updateActivity();
  }, { rootMargin: '160px 0px' }); // Match the stage render loop.
  observer.observe(stage);
  refresh();
  const timer = window.setInterval(refresh, 500);
  return () => {
    subscribe(undefined);
    abort.abort();
    observer.disconnect();
    window.clearInterval(timer);
    stopAndSave();
  };
}
