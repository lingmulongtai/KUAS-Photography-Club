type Path={pts:Float32Array};
export type Connection={path:number;end:0|1;dx:number;dz:number};

/** Join only endpoints that share the source geometry; never invent a long road connection. */
export function trafficJunctions(paths:readonly Path[]) {
  const buckets=new Map<string,Connection[]>(),links:Connection[][][]=paths.map(()=>[[],[]]);
  for(let path=0;path<paths.length;path++)for(const end of [0,1] as const){
    const p=paths[path].pts,i=end?p.length-2:0,j=end?p.length-4:2;
    const x=p[i],z=p[i+1],dx=p[j]-x,dz=p[j+1]-z,len=Math.hypot(dx,dz);
    if(!len)continue;
    const entry={path,end,dx:dx/len,dz:dz/len},bx=Math.floor(x),bz=Math.floor(z);
    for(let xx=bx-1;xx<=bx+1;xx++)for(let zz=bz-1;zz<=bz+1;zz++)for(const other of buckets.get(`${xx},${zz}`)??[]){
      if(other.path===path)continue;
      const q=paths[other.path].pts,k=other.end?q.length-2:0;
      if(Math.hypot(x-q[k],z-q[k+1])>.6)continue;
      links[path][end].push(other);links[other.path][other.end].push(entry);
    }
    const key=`${bx},${bz}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key)!.push(entry);
  }
  return links;
}

/** Prefer continuing straight while allowing turns; never immediately reverse. */
export function chooseConnection(options:readonly Connection[],dx:number,dz:number,random:number) {
  const choices=options.map(option=>({option,dot:option.dx*dx+option.dz*dz})).filter(item=>item.dot>-.3);
  const total=choices.reduce((sum,item)=>sum+1+2*Math.max(0,item.dot),0);
  let pick=Math.max(0,Math.min(.999999,random))*total;
  for(const item of choices){pick-=1+2*Math.max(0,item.dot);if(pick<0)return item.option;}
  return null;
}
