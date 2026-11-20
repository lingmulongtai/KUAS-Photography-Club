import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameMeter } from '../src/scripts/hero/frame-meter.ts';
import { createFrameRecording } from '../src/scripts/hero/frame-recording.ts';

test('CSV matches live frame statistics across a pause and a render-size change', () => {
  const meter = createFrameMeter(), recording = createFrameRecording(100);
  function submit(t, width) {
    recording.frame(t, meter.frame(t), width, 600);
    return meter.read(t);
  }
  submit(120, 1200);
  submit(140, 1200);
  meter.pause();
  submit(2140, 960);
  submit(2180, 960);
  const final = submit(2220, 960);
  const [header, ...rows] = recording.csv().trim().split('\r\n');
  assert.equal(header, 'frame,elapsed_ms,active_ms,frame_time_ms,fps_1s,avg_fps,over_33_33_ms,width_px,height_px');
  assert.deepEqual(rows.map(r => r.split(',').map(Number)), [
    [1, 40, 20, 20, 50, 50, 0, 1200, 600],
    [2, 2080, 60, 40, 25, 33.33, 1, 960, 600],
    [3, 2120, 100, 40, final.fps, final.averageFps, 1, 960, 600],
  ]);
});

test('the CSV current FPS drops old frames when a visible long frame exceeds a second', () => {
  const meter = createFrameMeter(), recording = createFrameRecording(0);
  for (const t of [0, 20, 40, 1600]) recording.frame(t, meter.frame(t), 960, 600);
  const last = recording.csv().trim().split('\r\n').at(-1).split(',').map(Number);
  assert.equal(last[3], 1560);
  assert.equal(last[4], meter.read(1600).fps);
  assert.equal(last[5], Number(meter.read(1600).averageFps.toFixed(2)));
});
