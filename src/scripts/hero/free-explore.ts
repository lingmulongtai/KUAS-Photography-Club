import type {Box} from './geo';

/** User-driven desktop travel, bounded by the supplied terrain (metres, east/south). */
export function moveExplorer(p:{x:number;y:number;z:number},yaw:number,forward:number,side:number,up:number,seconds:number,fast:boolean,ground:(x:number,z:number)=>number,bounds:Box=[-34000,-19000,13000,20000]){
  const speed=fast?650:180,a=yaw*Math.PI/180,n=Math.max(1,Math.hypot(forward,side,up)),step=Math.min(.1,Math.max(0,seconds))*speed/n;
  p.x=Math.max(bounds[0]+500,Math.min(bounds[2]-500,p.x+(Math.sin(a)*forward+Math.cos(a)*side)*step));
  p.z=Math.max(bounds[1]+500,Math.min(bounds[3]-500,p.z+(-Math.cos(a)*forward+Math.sin(a)*side)*step));
  p.y=Math.max(ground(p.x,p.z)+25,Math.min(3000,p.y+up*step));
  return p;
}
