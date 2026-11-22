import sharp from 'sharp';

// One course of flat pan tiles between barrel caps, in tangent-space relief.
// The shared repeat is filtered by the normal-map mip chain as the roofs recede.
const side=64,raw=Buffer.alloc(side*side*3);
function relief(u,v){
  const cap=.065*Math.exp(-((Math.sin(Math.PI*u)/.48)**2));
  const lip=.013*(1-Math.cos(2*Math.PI*v))*.5+.007*Math.sin(2*Math.PI*v)**3;
  return cap+lip;
}
for(let j=0;j<side;j++)for(let i=0;i<side;i++){
  const u=(i+.5)/side,v=(j+.5)/side,h=.5/side;
  const x=-(relief(u+h,v)-relief(u-h,v))/(2*h*.44);
  const y=(relief(u,v+h)-relief(u,v-h))/(2*h*.32);
  const length=Math.hypot(x,y,1),k=3*(j*side+i);
  raw[k]=Math.round(127.5*(1+x/length));raw[k+1]=Math.round(127.5*(1+y/length));
  raw[k+2]=Math.round(127.5*(1+1/length));
}
const png=await sharp(raw,{raw:{width:side,height:side,channels:3}}).png().toBuffer();
export const roofNormalUri='data:image/png;base64,'+png.toString('base64');

export function tileCoordinates(v,n){
  // Course direction follows the gutter, while tile rows follow the fall of each roof plane.
  const alongZ=Math.abs(n[2])>=Math.abs(n[0]);
  return [(alongZ?v[0]:v[2])/.44,((alongZ?v[2]*Math.sign(n[2]):v[0]*Math.sign(n[0]))-v[1]*Math.hypot(n[0],n[2])/Math.max(.05,n[1]))*n[1]/.32];
}
