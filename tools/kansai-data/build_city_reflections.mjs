/** Capture the regional viewer's own surroundings. Requires playwright, sharp and a running /kansai/ preview.
 * node tools/kansai-data/build_city_reflections.mjs <preview-origin>
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const base=new URL(process.argv[2]);
const probes=[['nakanoshima',135.5012,34.69345,27],['meriken',135.1907,34.6841,25],
  ['gyoen',135.76925,35.00535,31],['biwa-museum',135.8662,35.0129,23],['nara-park',135.8285,34.6832,19]];
const browser=await chromium.launch({channel:'chrome'});
const panels=[];
try{
  for(const [row,[view,lon,lat,offset]] of probes.entries()){
    const page=await browser.newPage({viewport:{width:600,height:800}});
    await page.addInitScript(()=>{
      let engine;
      Object.defineProperty(window,'Cesium',{configurable:true,get:()=>engine,set(value){
        engine=value?.CesiumWidget?{...value,CesiumWidget:class extends value.CesiumWidget{
          constructor(...args){super(...args);window.probeWidget=this;}
        }}:value;
      }});
    });
    await page.goto(new URL('/kansai/?view='+view,base).href);
    await page.waitForFunction(()=>/モデル [1-9]/.test(document.querySelector('[role=status]').textContent));
    await page.addStyleTag({content:'.globe{width:384px!important;height:384px!important}'});
    const altitude=await page.evaluate(async({lon,lat,offset})=>{
      const w=window.probeWidget;w.resize();
      // Reflections contain the surroundings on both sides of an administrative boundary.
      const cut=w.scene.postProcessStages.getStageByName('kansai-prefecture-cutout');
      if(cut)cut.enabled=false;
      const [p]=await Cesium.sampleTerrainMostDetailed(w.terrainProvider,[Cesium.Cartographic.fromDegrees(lon,lat)]);
      return p.height+offset;
    },{lon,lat,offset});
    for(let face=0;face<4;face++){
      await page.evaluate(({lon,lat,altitude,face})=>{
        const w=window.probeWidget;
        w.camera.setView({destination:Cesium.Cartesian3.fromDegrees(lon,lat,altitude),orientation:{heading:face*Math.PI/2,pitch:0,roll:0}});
        w.camera.frustum.fov=Math.PI/2;
        for(let i=0;i<w.scene.primitives.length;i++){
          const p=w.scene.primitives.get(i);if(p instanceof Cesium.LabelCollection)p.show=false;
        }
        w.scene.requestRender();
      },{lon,lat,altitude,face});
      await page.waitForTimeout(face?2600:4800);
      const data=await page.evaluate(()=>new Promise(resolve=>{
        const w=window.probeWidget,off=w.scene.postRender.addEventListener(()=>{off();resolve(w.canvas.toDataURL('image/jpeg',.93));});
        w.scene.requestRender();
      }));
      const input=await sharp(Buffer.from(data.split(',')[1],'base64')).resize(256,256).blur(.6).png().toBuffer();
      panels.push({input,left:face*256,top:row*256});
    }
    await page.close();
  }
  await sharp({create:{width:1024,height:1280,channels:3,background:'#394753'}}).composite(panels)
    .webp({quality:87,effort:6}).toFile(fileURLToPath(new URL('../../public/kansai/city-reflections.webp',import.meta.url)));
}finally{await browser.close();}
