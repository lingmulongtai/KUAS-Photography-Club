/** A verified, continuous southern section of the actual footway; no guessed northern link.
 * OSM ways 1338584977, 593317511 (OSM contributors, ODbL), simplified within 5 m.
 * Seasonal cherry scenery: https://ja.kyoto.travel/flower/sakura/single.php?flower_id=1104
 * Individual tree placements are illustrative, not an inventory. */
const PATH=[[3201.3,-1689],[3288.2,-1567.4],[3327.9,-1545],[3339.2,-1527],[3307.5,-1315.4]];
export function philosopherCherries(ground:(x:number,z:number)=>number,blocked:(x:number,z:number)=>boolean){
  const trees:{x:number;y:number;z:number;cherry:true}[]=[];
  for(let i=1;i<PATH.length;i++){
    const a=PATH[i-1],b=PATH[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(length/13);
    for(let j=0;j<n;j++)for(const side of [-1,1]){
      const x=a[0]+(b[0]-a[0])*(j+.5)/n-(b[1]-a[1])/length*side*6;
      const z=a[1]+(b[1]-a[1])*(j+.5)/n+(b[0]-a[0])/length*side*6;
      if([[0,0],[-3,0],[3,0],[0,-3],[0,3]].some(([dx,dz])=>blocked(x+dx,z+dz)))continue;
      trees.push({x,z,y:ground(x,z),cherry:true});
    }
  }return trees;
}
