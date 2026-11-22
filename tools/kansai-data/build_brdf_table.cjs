// Run with Node and Playwright Chromium. Capture the pinned engine's original
// integration shader before rendering any scene; no model, date or location is an input.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const path=require('node:path');
const {gzipSync}=require('node:zlib');

async function main(){
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  try{
    const page=await browser.newPage();
    await page.setContent('<canvas width="256" height="256"></canvas>');
    await page.addScriptTag({path:path.join(__dirname,'../../node_modules/cesium/Build/Cesium/Cesium.js')});
    const {bytes,version}=await page.evaluate(()=>{
      const c=new Cesium.Context(document.querySelector('canvas'),{}),generator=new Cesium.BrdfLutGenerator();
      try{
        generator.update({context:c});
        const f=new Cesium.Framebuffer({context:c,colorTextures:[generator.colorTexture],destroyAttachments:false});
        try{return {version:Cesium.VERSION,bytes:Array.from(c.readPixels({width:256,height:256,framebuffer:f}))};}
        finally{f.destroy();}
      }finally{generator.destroy();c.destroy();}
    });
    if(bytes.length!==256*256*4||!bytes.some((v,i)=>i%4===1&&v>0))throw Error('Empty BRDF integration table');
    const dir=path.join(__dirname,'../../public/kansai/lighting');
    await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'brdf-'+version+'.rgba.gz'),gzipSync(Buffer.from(bytes),{level:9}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
