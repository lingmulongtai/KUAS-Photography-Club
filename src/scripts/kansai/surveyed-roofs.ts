import {cache,inflate,json} from './sources';
import {tileXY,lonLat,type Point,type Ring} from './coordinates';
import {building,type Mesh} from './mesh';

type Terrace=[halfMetres:number,polygons:number[][][]];
type Pitch=[shape:0|1,angle:number,eaves:number,rise:number];
export type RoofRecord=[cx:number,cy:number,width:number,depth:number,base:number,upper:number,terraces:Terrace[],pitch?:Pitch];
const extent=16384;
export function roofFootprints(rows:RoofRecord[]){
  const slots=new Map<number,RoofRecord[]>();
  const cell=(x:number,y:number)=>Math.floor(x/32)+1024*Math.floor(y/32);
  for(const row of rows){
    const key=cell(row[0],row[1]),bucket=slots.get(key);
    if(bucket)bucket.push(row);else slots.set(key,[row]);
  }
  return (west:number,north:number,east:number,south:number)=>{
    const cx=(west+east)/2,cy=(north+south)/2,width=east-west,depth=south-north;
    let closest:RoofRecord|undefined,best=Infinity;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const row of slots.get(cell(cx+32*dx,cy+32*dy))??[]){
        const offset=Math.hypot(row[0]-cx,row[1]-cy);
        if(offset>3 || Math.abs(width-row[2])>4 || Math.abs(depth-row[3])>4)continue;
        const error=offset+Math.abs(width-row[2])+Math.abs(depth-row[3]);
        if(error<best){closest=row;best=error;}
      }
    }
    return closest;
  };
}
let catalogue:Promise<Record<string,number>>|undefined;
const read=cache(5,async key=>{
  const res=await fetch('/kansai/kobe-roofs/'+key+'.json.gz');
  if(!res.ok)throw new Error('Roof survey '+res.status);
  return roofFootprints(JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(await res.arrayBuffer())))));
});
export async function roofSurvey(x:number,y:number){
  // Quick rejection of cells wholly outside Kobe. Inside, the survey uses the municipal boundary.
  if(x<3582||x>3587||y<1623||y>1627)return;
  try{
    catalogue??=json<Record<string,number>>('kobe-roofs/index.json').catch(error=>{catalogue=undefined;throw error;});
    const key=x+'-'+y;
    return (await catalogue)[key]?await read(key):undefined;
  }catch{return undefined;}
}

export function matchRoof(find:ReturnType<typeof roofFootprints>,ring:Ring,x:number,y:number){
  let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
  for(const [lon,lat] of ring){
    const [tx,ty]=tileXY(lon,lat,12),u=(tx-x)*extent,v=(ty-y)*extent;
    w=Math.min(w,u);e=Math.max(e,u);n=Math.min(n,v);s=Math.max(s,v);
  }
  return find(w,n,e,s);
}

export function surveyFits(row:RoofRecord,preferredHeight?:number){
  const peak=row[7]?row[7][2]+row[7][3]:0;
  const top=Math.max(row[5],peak,...row[6].map(t=>t[0]))*.5;
  return !preferredHeight || (preferredHeight<=top*1.4+4 && preferredHeight>=top*.6-4);
}

/** The lowest measured roof spans the building. Higher surfaces retain their surveyed outlines and courtyards. */
export function drawSurveyedRoof(mesh:Mesh,rings:Ring[],row:RoofRecord,base:number,low:number,style:number,
  x:number,y:number,local:(p:Point)=>Point,shape:string,preferredHeight?:number){
  const terraces=row[6],measuredTop=Math.max(row[5],row[7]?row[7][2]+row[7][3]:0,...terraces.map(t=>t[0]))*.5;
  // A newer mapped tower or an elevated building part can postdate the airborne survey.
  if(!surveyFits(row,preferredHeight))return false;
  const raised=terraces.length>0;
  const simpleRise=raised||shape==='flat'?0:Math.min((row[5]-row[4])*.5,row[4]*.16);
  // Store a facade family in the existing material byte and align floors to the actual footing.
  // Stepped towers retain one floor datum across the podium and all upper masses.
  const previousCode=mesh.wallCode,previousDatum=mesh.wallDatum;
  mesh.wallDatum=base;
  mesh.wallCode=measuredTop>=30?174:measuredTop>=13?154:104;
  const pitch=row[7];
  if(pitch){
    const [kind,angle,eaves,rise]=pitch;
    building(mesh,rings,base,base+eaves*.5,rise*.5,style,kind===0?'gabled':'hipped',low,angle*Math.PI/256);
  }else{
    building(mesh,rings,base,base+row[4]*.5,simpleRise,style,shape,low);
  }
  let floor=row[4]*.5;
  for(const [height,polygons] of terraces){
    for(const polygon of polygons){
      const rings=polygon.map(points=>{
        const ring:Point[]=[];
        for(let k=0;k<points.length;k+=2)ring.push(local(lonLat(x+(row[0]+points[k])/extent,y+(row[1]+points[k+1])/extent,12)));
        return ring;
      });
      if(rings[0].length>=3)building(mesh,rings,base+floor,base+height*.5,0,style,'flat');
    }
    floor=height*.5;
  }
  mesh.wallCode=previousCode;mesh.wallDatum=previousDatum;
  return true;
}
