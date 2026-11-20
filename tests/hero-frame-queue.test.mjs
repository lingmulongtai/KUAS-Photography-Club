import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameQueue } from '../src/scripts/hero/frame-queue.ts';

test('a full frame queue polls without blocking and resumes at the newest camera pose', () => {
  const freed = [];
  let id = 0, status = 1;
  const gl = {
    TIMEOUT_EXPIRED: 1, WAIT_FAILED: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    fenceSync: () => ++id, flush() {}, deleteSync: sync => freed.push(sync),
    clientWaitSync: (_sync, flags, timeout) => { assert.equal(flags, 0); assert.equal(timeout, 0); return status; },
  };
  const queue = createFrameQueue(gl);
  for (let i = 0; i < 2; i++) { assert.ok(queue.available()); queue.submitted(); }
  assert.equal(queue.available(), false);
  status = 0;
  assert.ok(queue.available());
  queue.submitted();
  assert.deepEqual(freed, [1]);
  status = gl.WAIT_FAILED;
  assert.ok(queue.available());
  queue.submitted();
  assert.deepEqual(freed, [1, 2, 3]);
  assert.equal(id, 3);
  queue.restored();
  queue.submitted();
  assert.equal(id, 4);
  assert.ok(createFrameQueue({}).available());
});
