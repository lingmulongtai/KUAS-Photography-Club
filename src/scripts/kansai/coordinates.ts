export type Point = [number, number];
export type Box = [number, number, number, number];
export type Ring = Point[];
export interface Boundary {
  bbox: Box;
  properties: {code:string; name:string};
  geometry: {type:'MultiPolygon'; coordinates:Ring[][]};
}

export function tileXY(lon:number, lat:number, zoom:number): Point {
  const n=2**zoom;
  return [(lon+180)/360*n,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*n/2];
}
export function lonLat(x:number, y:number, zoom:number): Point {
  const n=2**zoom;
  return [x/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI];
}
export function inBox([x,y]:Point, b:Box) {
  return x>=b[0] && y>=b[1] && x<=b[2] && y<=b[3];
}
export function inRing([x,y]:Point, ring:Ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[i],[c,d]=ring[j];
    if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) inside=!inside;
  }
  return inside;
}
export function inPolygon(p:Point,rings:Ring[]) {
  return inRing(p,rings[0]) && !rings.slice(1).some(r=>inRing(p,r));
}

// Index only the short coastline and boundary segments crossing this latitude.
// Inland queries then cost a few comparisons, including around islands and holes.
export function prefectureLookup(features:Boundary[]) {
  const buckets=new Map<number,{code:string; a:Point; b:Point}[]>();
  for(const feature of features) for(const polygon of feature.geometry.coordinates) for(const ring of polygon){
    for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i];
      if(a[1]===b[1])continue;
      const edge={code:feature.properties.code,a,b};
      for(let j=Math.floor(Math.min(a[1],b[1])*500);j<=Math.floor(Math.max(a[1],b[1])*500);j++){
        if(!buckets.has(j))buckets.set(j,[]);
        buckets.get(j)!.push(edge);
      }
    }
  }
  return (p:Point) => {
    const matches=new Set<string>();
    for(const {a,b,code} of buckets.get(Math.floor(p[1]*500))??[]){
      if((a[1]>p[1])===(b[1]>p[1]) || p[0]>=(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])continue;
      if(matches.has(code))matches.delete(code);else matches.add(code);
    }
    return matches.values().next().value as string|undefined;
  };
}
