/** Share a texture slot between disjoint areas without late loads replacing the current area. */
export function createSharedPhotoSlot<T>(load:()=>Promise<T>,apply:(photo:T|null)=>void,onError:(error:unknown)=>void) {
  let selected=false;
  let fallback:T|null=null;
  let pending:Promise<T>|undefined;
  return {
    setFallback(photo:T) {
      fallback=photo;
      if(!selected)apply(fallback);
    },
    select(next:boolean) {
      if(selected===next&&(!next||pending))return;
      selected=next;
      if(!selected){apply(fallback);return;}
      const request=pending??=load();
      void request.then(photo=>{if(selected&&pending===request)apply(photo);})
        .catch(error=>{if(pending===request)pending=undefined;onError(error);});
    },
  };
}
