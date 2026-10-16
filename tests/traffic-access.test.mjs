import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trafficSegments} from '../src/scripts/hero/traffic-access.ts';

const square=[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}];
const split=(p,b=square)=>trafficSegments(new Float32Array(p),b).map(p=>Array.from(p));
test('through roads are split into exterior pieces without bridging the forbidden interior',()=>{
  assert.deepEqual(split([-2,5,12,5]),[[-2,5,0,5],[10,5,12,5]]);
  assert.deepEqual(split([-2,2,12,2,12,8,-2,8]),[[-2,2,0,2],[10,2,12,2,12,8,10,8],[0,8,-2,8]]);
  assert.deepEqual(split([2,2,8,8]),[]);
  assert.deepEqual(split([-2,-2,0,0,12,-2]),[[-2,-2,0,0,12,-2]]);
  assert.deepEqual(split([-2,0,12,0]),[[-2,0,12,0]],'preserve tangent boundary roads');
});
test('real Gyoen paths disappear while Karasuma and Marutamachi roads remain intact',()=>{
  assert.deepEqual(trafficSegments(new Float32Array([120,-2082.5,411.5,-2083])),[]);
  for(const points of [[-15.5,-2167.5,-16.5,-1961.5,-15.5,-1929],[-5.5,-1528,57.5,-1530,121,-1529.5,263.5,-1532,402,-1532,532.5,-1534,639.5,-1533,712.5,-1533.5]]){
    const road=new Float32Array(points);assert.deepEqual(trafficSegments(road),[road]);
  }
  const crossing=trafficSegments(new Float32Array([242,-1926.5,-15.5,-1929]));
  assert.equal(crossing.length,1);
  assert.ok(crossing[0][0]<10&&crossing[0][0]>-10);
  assert.equal(crossing[0].at(-2),-15.5);
});
