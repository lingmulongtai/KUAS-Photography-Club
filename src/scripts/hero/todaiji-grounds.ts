import {toLocal} from './geo.ts';

// Ground plan traced on the same GSI orthophoto as the Nara Park inset.
// In metres about Nandaimon, north is negative Z. Trees still line both sides of the approach.
const gate=toLocal(34.68579835,135.83987561);
export function todaijiClearing(x:number,z:number){
  const dx=x-gate.x,dz=z-gate.z;
  if(Math.abs(dx)>88 || dz< -404 || dz>119)return false;
  if(dz>=-10 && dz<=11 && Math.abs(dx)<21)return true;
  if(dz< -315 && dz> -394 && Math.abs(dx+1)<40)return true;
  // South gate of the cloister, its covered walks and the two lawns flanking the stone approach.
  if(dz>=-334 && dz<=-219 && Math.abs(dx)<81)return true;
  const centre=dz>0?-dz*.025:dz*-.012;
  const halfWidth=dz< -195?12:dz< -105?8:5.5;
  return Math.abs(dx-centre)<halfWidth;
}
