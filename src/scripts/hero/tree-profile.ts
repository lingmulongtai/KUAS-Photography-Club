/** Stable, independent traits avoid correlating small trees with one species. */
export function treeProfile(x:number,z:number) {
  const hash=(salt:number)=>{const n=Math.sin(x*12.9898+z*78.233+salt*37.719)*43758.5453;return n-Math.floor(n);};
  const cedar=hash(1)<.25;
  const palettes=cedar?[[.19,.3,.22],[.25,.34,.19]]:[[.24,.35,.17],[.31,.4,.19],[.2,.32,.23],[.33,.36,.18]];
  return {
    cedar,
    width:.72+hash(2)*.65,
    height:.72+hash(3)*.5,
    aspect:.78+hash(4)*.46,
    lean:(hash(5)-.5)*.22,
    crown:.72+hash(6)*.58,
    tint:palettes[Math.floor(hash(7)*palettes.length)],
  };
}

/** Low-frequency stand density creates small clearings without removing distant coverage. */
export function standDensity(x:number,z:number) {
  const hash=(a:number,b:number)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
  const fx=x/65,fz=z/65,ix=Math.floor(fx),iz=Math.floor(fz);
  const smooth=(t:number)=>t*t*(3-2*t);
  const u=smooth(fx-ix),v=smooth(fz-iz);
  const a=hash(ix,iz)*(1-u)+hash(ix+1,iz)*u;
  const b=hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u;
  return .58+.42*(a*(1-v)+b*v);
}
