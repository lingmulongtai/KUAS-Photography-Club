export type Season='auto'|'spring'|'summer'|'autumn'|'winter';

/** Seasonal scenery only, never a live-weather or flowering forecast. */
export function seasonWeights(season:Season,month:number){
  if(season==='spring')return {spring:1,autumn:0,snow:0};
  if(season==='autumn')return {spring:0,autumn:1,snow:0};
  if(season==='winter')return {spring:0,autumn:0,snow:1};
  if(season==='summer')return {spring:0,autumn:0,snow:0};
  return {spring:month===3||month===4?1:0,autumn:month===10?.45:month===11?1:month===12?.3:0,snow:month===1||month===2?.55:month===12?.25:0};
}
