import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

test('close Osaka imagery covers the detailed region with bounded, sharper local sheets',async()=>{
  const root=new URL('../public/kyoto/',import.meta.url);
  const {photos,source}=JSON.parse(await readFile(new URL('photos-osaka.json',root),'utf8'));
  const {regions}=JSON.parse(await readFile(new URL('regions.json',root),'utf8'));
  const osaka=regions.find(r=>r.id==='osaka');assert.ok(osaka);assert.match(source,/GSI/);
  assert.equal(photos.length,16);
  for(let row=0;row<4;row++)for(let col=0;col<4;col++){
    const box=[osaka.box[0]+col*4000,osaka.box[1]+row*4000,osaka.box[0]+(col+1)*4000,osaka.box[1]+(row+1)*4000];
    const photo=photos.find(p=>p.box.every((v,i)=>v===box[i]));assert.ok(photo,'no missing or overlapping local sheet');
    assert.ok((box[2]-box[0])/photo.size[0]<3,'close PC imagery is finer than 3 m per pixel');
    assert.ok((box[2]-box[0])/photo.mobile.size[0]<6,'mobile close imagery is finer than 6 m per pixel');
    assert.ok((await stat(new URL(photo.file,root))).size<=760000);
    assert.ok((await stat(new URL(photo.mobile.file,root))).size<=260000);
  }
});
