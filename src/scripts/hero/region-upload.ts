import * as THREE from 'three';

/** Populate the real geometry buffers before swapping a whole Kyoto district into the visible scene. */
export async function prepareRegionBuffers(renderer:THREE.WebGLRenderer,camera:THREE.Camera,group:THREE.Group,current:()=>boolean){
  group.updateMatrixWorld();
  camera.updateMatrixWorld();
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const geometries=new Set<THREE.BufferGeometry>();
  group.traverseVisible(object=>{
    const mesh=object as THREE.Mesh;
    if(mesh.geometry && (!mesh.frustumCulled||!mesh.geometry.boundingSphere||frustum.intersectsObject(mesh)))geometries.add(mesh.geometry);
  });
  if(!geometries.size)return;
  const scratch=new THREE.Scene(),target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false});
  const material=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,toneMapped:false});
  const probe=new THREE.Mesh(new THREE.BufferGeometry(),material),empty=probe.geometry;
  probe.frustumCulled=false;
  scratch.add(probe);
  const uploaded=new Set<THREE.BufferAttribute | THREE.InterleavedBuffer>();
  try{
    let budget=0,deadline=0;
    for(const geometry of geometries){
      if(budget<=0||performance.now()>=deadline){
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        if(!current())return;
        budget=1024*1024;deadline=performance.now()+3;
      }
      const attributes=[...Object.values(geometry.attributes),geometry.index];
      for(const attribute of attributes){
        if(!attribute)continue;
        const data=attribute instanceof THREE.InterleavedBufferAttribute?attribute.data:attribute;
        if(!uploaded.has(data)){uploaded.add(data);budget-=data.array.byteLength;}
      }
      const range={...geometry.drawRange},instances=geometry instanceof THREE.InstancedBufferGeometry?geometry.instanceCount:null;
      const previous=renderer.getRenderTarget();
      try{
        // Three uploads the attributes shared with the final draw. Only one triangle is submitted here.
        probe.geometry=geometry;geometry.setDrawRange(0,3);
        if(geometry instanceof THREE.InstancedBufferGeometry)geometry.instanceCount=Math.min(1,geometry.instanceCount);
        renderer.setRenderTarget(target);
        renderer.render(scratch,camera);
      }finally{
        renderer.setRenderTarget(previous);
        geometry.setDrawRange(range.start,range.count);
        if(instances!==null && geometry instanceof THREE.InstancedBufferGeometry)geometry.instanceCount=instances;
      }
    }
  }finally{target.dispose();material.dispose();empty.dispose();}
}
