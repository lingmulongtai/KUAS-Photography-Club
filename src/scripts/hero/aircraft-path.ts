/** Illustrative overflights, not live flights or airport procedures. Metres in the Kyoto scene. */
export const AIRCRAFT_PATHS = [
  {from:[18000,4800,-9000],to:[-42000,4400,-4500],speed:190,phase:.15},
  {from:[-42000,6500,11000],to:[20000,6800,7000],speed:220,phase:.58},
  {from:[20000,3600,17000],to:[-42000,3000,21000],speed:170,phase:.82},
] as const;

export function aircraftPose(path:typeof AIRCRAFT_PATHS[number],seconds:number) {
  const [x,y,z]=path.from,[tx,ty,tz]=path.to,dx=tx-x,dz=tz-z;
  const length=Math.hypot(dx,ty-y,dz),p=((path.phase+seconds*path.speed/length)%1+1)%1;
  return {x:x+(tx-x)*p,y:y+(ty-y)*p,z:z+(tz-z)*p,yaw:Math.atan2(dx,dz),visible:p>.025&&p<.975};
}
