/** Share a texture slot between disjoint areas without late loads replacing the current area. */
export function createSharedPhotoSlot<T>(load:()=>Promise<T>,apply:(photo:T|null)=>void,onError:(error:unknown)=>void) {
  let selected=false;
  let fallback:T|null=null;
  let pending:Promise<T>|undefined;
  let chosen:T|null=null,override:T|null=null;
  const applyCurrent=()=>apply(override??(selected?chosen??fallback:fallback));
  return {
    setFallback(photo:T) {
      fallback=photo;
      if(!selected)applyCurrent();
    },
    setOverride(photo:T|null) {override=photo;applyCurrent();},
    select(next:boolean) {
      if(selected===next&&(!next||pending))return;
      selected=next;
      if(!selected){applyCurrent();return;}
      const request=pending??=load();
      void request.then(photo=>{if(pending===request){chosen=photo;if(selected)applyCurrent();}})
        .catch(error=>{if(pending===request)pending=undefined;onError(error);});
    },
  };
}
