type Point = {x:number;y:number};

/** Conforming edge splits: shared edges receive the same midpoint, retaining holes/banks.
 * Sample height only after refinement so long bank-to-bank triangles cannot float over a bend.
 */
export function* refineWaterSurfaceSteps(input:Point[],faces:number[][],maxEdge:number,maxTriangles=40000,focus?:Point) {
  const points=input.map(p=>({x:p.x,y:p.y}));
  let triangles=faces;
  const key=(a:number,b:number)=>a<b?`${a},${b}`:`${b},${a}`;
  for(let pass=0;pass<12;pass++) {
    const mid=new Map<string,number>();
    let visited=0;
    for(const triangle of triangles) {
      if(++visited%256===0)yield;
      for(let i=0;i<3;i++) {
      const a=triangle[i],b=triangle[(i+1)%3],pa=points[a],pb=points[b],edge=key(a,b);
      let limit=maxEdge;
      if(focus) {
        const dx=pb.x-pa.x,dy=pb.y-pa.y;
        const t=Math.max(0,Math.min(1,((focus.x-pa.x)*dx+(focus.y-pa.y)*dy)/(dx*dx+dy*dy||1)));
        const distance=Math.hypot(pa.x+dx*t-focus.x,pa.y+dy*t-focus.y);
        limit*=1+3*Math.max(0,Math.min(1,(distance-600)/1200));
      }
      if(!mid.has(edge)&&Math.hypot(pa.x-pb.x,pa.y-pb.y)>limit) {
        mid.set(edge,points.length);points.push({x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2});
      }
      }
    }
    if(!mid.size) return {points,triangles};
    const next:number[][]=[];
    visited=0;
    for(const [a,b,c] of triangles) {
      if(++visited%256===0)yield;
      const ab=mid.get(key(a,b)),bc=mid.get(key(b,c)),ca=mid.get(key(c,a));
      const count=Number(ab!==undefined)+Number(bc!==undefined)+Number(ca!==undefined);
      if(count===0) next.push([a,b,c]);
      else if(count===3) next.push([a,ab!,ca!],[ab!,b,bc!],[ca!,bc!,c],[ab!,bc!,ca!]);
      else if(count===1) {
        if(ab!==undefined) next.push([a,ab,c],[ab,b,c]);
        else if(bc!==undefined) next.push([b,bc,a],[bc,c,a]);
        else next.push([c,ca!,b],[ca!,a,b]);
      } else {
        const [x,y,z,m,n]=ca===undefined?[a,b,c,ab!,bc!]:ab===undefined?[b,c,a,bc!,ca!]:[c,a,b,ca!,ab!];
        next.push([y,n,m],[x,m,z],[m,n,z]);
      }
    }
    if(next.length>maxTriangles) throw new Error('Regional water triangle budget exceeded');
    triangles=next;
  }
  throw new Error('Regional water refinement did not converge');
}

export function refineWaterSurface(input:Point[],faces:number[][],maxEdge:number,maxTriangles=40000,focus?:Point) {
  const steps=refineWaterSurfaceSteps(input,faces,maxEdge,maxTriangles,focus);
  for(;;){const step=steps.next();if(step.done)return step.value;}
}
