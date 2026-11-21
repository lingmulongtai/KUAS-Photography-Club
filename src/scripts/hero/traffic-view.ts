import type {Matrix4,PerspectiveCamera} from 'three';

/** The four padded frustum rays projected onto the map. This accepts a car at any elevation
 * in the horizontal cone, before its expensive ground and bridge-deck samples are needed. */
export function createTrafficView(){
  let leftX=0,leftZ=0,rightX=0,rightZ=0,ox=0,oz=0,active=false;
  return {
    update(camera:PerspectiveCamera,projection:Matrix4){
      const m=camera.matrixWorld.elements,p=projection.elements;
      const fx=-m[8],fz=-m[10],length=Math.hypot(fx,fz);
      active=false;
      if(length<1e-8)return;
      const ax=fx/length,az=fz/length,sx=-az,sz=ax;
      let left=Infinity,right=-Infinity;
      for(const u of [-1,1])for(const v of [-1,1]){
        const x=fx+m[0]*(u+p[8])/p[0]+m[4]*(v+p[9])/p[5];
        const z=fz+m[2]*(u+p[8])/p[0]+m[6]*(v+p[9])/p[5];
        const ahead=x*ax+z*az;
        if(ahead<=1e-8)return; // Looking almost straight down can include all compass bearings.
        const sine=(x*sx+z*sz)/ahead;
        left=Math.min(left,sine);right=Math.max(right,sine);
      }
      const a=Math.hypot(1,left),b=Math.hypot(1,right);
      leftX=(sx-left*ax)/a;leftZ=(sz-left*az)/a;
      rightX=(right*ax-sx)/b;rightZ=(right*az-sz)/b;
      ox=m[12];oz=m[14];active=true;
    },
    contains(x:number,z:number,margin:number){
      if(!active)return true;
      const dx=x-ox,dz=z-oz;
      return dx*leftX+dz*leftZ>=-margin && dx*rightX+dz*rightZ>=-margin;
    },
  };
}
