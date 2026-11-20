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
  assert.equal(u.uCloudLattice.value.image.width,512);
  const origin = u.uLatticeOrigins.value[7];
  assert.equal(Math.floor(132.25*43*1.7-1.7)-origin.x,64);
  assert.equal(Math.floor(-20.5*43*1.7-1.7)-origin.y,64);
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
