import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {loadBinary} from '../src/scripts/hero/data.ts';

test('large home surveys survive a worker interruption and an already-decoded response',async t=>{
  const raw=randomBytes(300000),packed=gzipSync(raw);
  let payload=packed,interrupt=false,requests=0;
  const originalWindow=globalThis.window,originalWorker=globalThis.Worker;
  class Worker{
    postMessage({id,bytes}){
      requests++;
      queueMicrotask(()=>{
        if(interrupt)this.onerror();
        else this.onmessage({data:{id,bytes:new Uint8Array(gunzipSync(bytes))}});
      });
    }
    terminate(){}
  }
  globalThis.window={};globalThis.Worker=Worker;
  t.after(()=>{
    if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
    if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
  });
  t.mock.method(globalThis,'fetch',async()=>new Response(payload));
  assert.deepEqual(Buffer.from(await loadBinary('height.bin')),raw);
  interrupt=true;
  const files=await Promise.all([loadBinary('height.bin'),loadBinary('canopy.bin')]);
  files.forEach(b=>assert.deepEqual(Buffer.from(b),raw));
  const calls=requests;
  payload=raw;
  assert.deepEqual(Buffer.from(await loadBinary('height.bin')),raw);
  assert.equal(requests,calls);
});
