import {inflate} from './sources';

type Variant={night:boolean;vertex:number[];fragment:number[]};
type Catalogue={chunks:string[];attributes:Record<string,number>;programs:Variant[]};

/** Prime the driver's own shader cache while terrain and imagery are streaming.
 * Never bind a program, draw, or wait on a synchronous link-status query here. */
export function primeTerrainPrograms(canvas:HTMLCanvasElement){
  const gl=canvas.getContext('webgl2');
  const parallel=gl?.getExtension('KHR_parallel_shader_compile');
  if(!gl||!parallel||typeof DecompressionStream==='undefined')return {select(_:boolean){},dispose(){}};

  const shaders=new Map<string,WebGLShader>(),pending=new Set<WebGLProgram>();
  const started=new Set<Variant>(),controller=new AbortController();
  let catalogue:Catalogue|undefined,mode=false,disposed=false,timer=0;
  const linear=!!gl.getExtension('OES_texture_float_linear');
  function shader(chunks:number[],type:number){
    const key=chunks.join(',');
    let shader=shaders.get(key);
    if(shader)return shader;
    shader=gl!.createShader(type)??undefined;
    if(!shader)return;
    let source=chunks.map(i=>catalogue!.chunks[i]).join('#line 0');
    if(!linear)source=source.replace('#define OES_texture_float_linear\n\n','');
    gl!.shaderSource(shader,source);gl!.compileShader(shader);shaders.set(key,shader);
    return shader;
  }
  function releaseShaders(){
    for(const item of shaders.values())gl!.deleteShader(item);
    shaders.clear();
  }
  function schedule(){
    if(!disposed&&!timer)timer=window.setTimeout(tick,24);
  }
  function tick(){
    timer=0;
    if(!catalogue||disposed||gl!.isContextLost())return;
    for(const program of pending){
      if(gl!.getProgramParameter(program,parallel!.COMPLETION_STATUS_KHR)){
        gl!.deleteProgram(program);pending.delete(program);
      }
    }
    const next=catalogue.programs.find(p=>p.night===mode&&!started.has(p));
    if(next&&pending.size<3){
      started.add(next);
      const vs=shader(next.vertex,gl!.VERTEX_SHADER),fs=shader(next.fragment,gl!.FRAGMENT_SHADER);
      if(vs&&fs){
        const pr=gl!.createProgram();
        if(pr){
          gl!.attachShader(pr,vs);gl!.attachShader(pr,fs);
          for(const [name,index] of Object.entries(catalogue.attributes))gl!.bindAttribLocation(pr,index,name);
          gl!.linkProgram(pr);pending.add(pr);
        }
      }
    }
    if(next||pending.size)schedule();else releaseShaders();
  }
  void fetch('/kansai-engine/terrain-programs.json.gz',{signal:controller.signal}).then(async response=>{
    if(!response.ok||disposed)return;
    const bytes=new Uint8Array(await response.arrayBuffer());
    catalogue=JSON.parse(new TextDecoder().decode(await inflate(bytes))) as Catalogue;
    schedule();
  }).catch(()=>{/* Cesium can always compile on first use. */});
  return {
    select(night:boolean){mode=night;schedule();},
    dispose(){
      disposed=true;controller.abort();window.clearTimeout(timer);
      for(const program of pending)gl.deleteProgram(program);
      pending.clear();releaseShaders();
    }
  };
}
