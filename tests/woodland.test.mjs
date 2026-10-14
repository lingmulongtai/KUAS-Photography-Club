import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createWoodlandMask } from '../src/scripts/hero/woodland.ts';

test('woodland multipolygon holes stay empty and disjoint outer rings stay wooded', () => {
  const hit=createWoodlandMask([{outer:[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[500,0],[600,0],[600,100],[500,100],[500,0]]],holes:[[[30,30],[60,30],[60,60],[30,60],[30,30]]]}]);
  assert.equal(hit(10,10),true); assert.equal(hit(40,40),false);
  assert.equal(hit(550,50),true); assert.equal(hit(300,50),false);
});
test('shipped woodland covers the Senkoji foreground and stays inside its transfer budget', () => {
  const bytes=readFileSync(new URL('../public/kyoto/woodland.json.gz',import.meta.url));
  assert.ok(bytes.length<1024*1024);
  const data=JSON.parse(gunzipSync(bytes)); const hit=createWoodlandMask(data.polygons);
  // Verified Senkoji and its eastern foreground, not the colour of a winter aerial tile.
  const x=(135.6655983-135.7595)*91284.17129262601,z=-(35.0157751-35.0036)*110940.6404266756;
  assert.equal(hit(x,z),true); assert.equal(hit(x+200,z),true); assert.equal(hit(x+600,z),true);
  assert.equal(hit(-3755,-700),false);
  // Independently tagged inner ways remain woods, rather than relation clearings.
  assert.equal(hit(-7195,-5233),true); assert.equal(hit(4155,332),true);
});
