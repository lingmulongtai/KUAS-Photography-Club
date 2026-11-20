import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudLattice } from '../src/scripts/hero/cloud-lattice.ts';

test('weather lattices retain exact integer cell origins and share the original scene state on failure', () => {
  const lattice = createCloudLattice(), u = lattice.uniforms;
  const previous = {}, oldHandler = () => {};
  let target = previous, draws = 0, supported = true, simulateError = false;
  const gl = { FRAMEBUFFER:1, FRAMEBUFFER_COMPLETE:2, checkFramebufferStatus: () => 2 };
  const renderer = { extensions:{has:()=>supported}, debug:{onShaderError:oldHandler},
    getRenderTarget:()=>target, setRenderTarget:t=>{target=t;}, getContext:()=>gl,
    render() { draws++; if (simulateError) renderer.debug.onShaderError(); },
  };
  lattice.update(renderer,132.25,-20.5,1);
  assert.ok(u.uLatticeOn.value);
  assert.equal(u.uCloudLattice.value.image.width,768);
  const origin = u.uLatticeOrigins.value[7];
  assert.equal(Math.floor(132.25*43*1.7-1.7)-origin.x,96);
  assert.equal(Math.floor(-20.5*43*1.7-1.7)-origin.y,96);
  lattice.update(renderer,132.4,-20.5,1); assert.equal(draws,1);
  lattice.update(renderer,132.4,-20.5,5); assert.equal(draws,2);
  lattice.restored(); supported=false;
  lattice.update(renderer,132.4,-20.5,5); assert.equal(u.uLatticeOn.value,false);
  supported=true; simulateError=true; lattice.restored();
  lattice.update(renderer,132.4,-20.5,5); assert.equal(u.uLatticeOn.value,false);
  assert.equal(target,previous); assert.equal(renderer.debug.onShaderError,oldHandler);
  simulateError=false; lattice.restored(); lattice.update(renderer,132.4,-20.5,5);
  assert.ok(u.uLatticeOn.value);
});

test('every unguarded weather octave fits the atlas at the far ray, with wind, warping and lighting offsets', () => {
  const lattice=createCloudLattice(), x=-15.61, z=253.33;
  const renderer={getRenderTarget:()=>null,setRenderTarget(){},debug:{},extensions:{has:()=>true},render(){},
    getContext:()=>({FRAMEBUFFER:1,FRAMEBUFFER_COMPLETE:2,checkFramebufferStatus:()=>2})};
  const reach=.5 + (44000 + 960 + .5*.22*6800)*.00011 + .2;
  for(let style=0;style<6;style++){
    lattice.update(renderer,x,z,style);
    const origins=lattice.uniforms.uLatticeOrigins.value, f=style===1?1.7:style===3?.7:style===4?.26:1;
    for(const dx of [-reach,reach]) for(const dz of [-reach,reach]) {
      const a=x+dx,b=z+dz;
      const pair=(page,s,k)=>[page,a*s+k,b*s+k];
      const lookups=[pair(0,1.7,2.3),pair(0,1.7,-4.1),pair(1,.8,7.3),pair(2,.45,-3.9)];
      if(style===2||style===5){
        const scale=style===5?.7:1;
        lookups.push([3,(.87*a+.5*b)*2.6*scale,(-.5*a+.87*b)*7*scale],pair(4,13,3.1));
      } else {
        lookups.push(pair(3,4.2*f,5.5),pair(4,9*f,-2.2),pair(5,9.5*f,0),pair(8,1.3,-9.7),
          pair(9,style===4?6:3.3,1.9),pair(10,15,-6.1));
      }
      for(const [i,sx,sz] of lookups) {
        assert.ok(Math.floor(sx)-origins[i].x>=0 && Math.floor(sx)-origins[i].x<192);
        assert.ok(Math.floor(sz)-origins[i].y>=0 && Math.floor(sz)-origins[i].y<192);
      }
    }
  }
});
