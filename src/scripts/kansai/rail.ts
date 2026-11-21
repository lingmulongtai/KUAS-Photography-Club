/** GSI RailTrCL encodes structure in the last digit, whereas RailCL carries a text attribute. */
export function railStructure(layer:string,code:number,state:string){
  if(layer==='RailTrCL'){
    const form=code%10;
    if(form===2||form===4)return 'hidden';
    if(form===3)return 'raised';
  }
  if(/地下|トンネル|遮蔽|未供用/.test(state))return 'hidden';
  return /橋|高架/.test(state)?'raised':'surface';
}
