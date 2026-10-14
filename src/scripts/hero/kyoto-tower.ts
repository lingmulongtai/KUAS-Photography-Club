import * as THREE from 'three';
import type { Part } from './landmarks';

const ivory: Part['color'] = [.73, .75, .72];
const orange: Part['color'] = [.64, .065, .018];
const glass: Part['color'] = [.022, .065, .095];

/** Photo-based silhouette; only the 131 m tip and 100 m observation level are surveyed facts.
 * https://www.kyoto-tower.jp/about/ (photo_tower.png and feature01.png).
 * Remaining dimensions are visual estimates, not a measured architectural model.
 */
export function kyotoTower(): Part[] {
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, color = ivory, glow = .45) => parts.push({geo, color, glow});
  const lathe = (profile: [number, number][], color = ivory, glow = .45) => {
    add(new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)),64),color,glow);
  };
  const ring = (r: number, y: number, thickness: number, color = orange, glow = .65) => {
    const geo = new THREE.TorusGeometry(r, thickness, 5, 64);
    geo.rotateX(Math.PI/2); geo.translate(0,y,0); add(geo,color,glow);
  };
  const box = (w:number,h:number,d:number,x:number,y:number,z:number,color:Part['color'],glow=.2) => {
    const geo = new THREE.BoxGeometry(w,h,d); geo.translate(x,y,z); add(geo,color,glow);
  };
  const ribs = (profile: [number,number][], count:number, thickness:number, color:Part['color'],glow:number) => {
    for(let i=0;i<count;i++) {
      const a=i*Math.PI*2/count;
      const curve=new THREE.CatmullRomCurve3(profile.map(([r,y])=>new THREE.Vector3(Math.sin(a)*r,y,Math.cos(a)*r)));
      add(new THREE.TubeGeometry(curve,10,thickness,5,false),color,glow);
    }
  };

  // Keep the white monocoque shell below the glass. The former continuous lathe
  // enclosed the windows and incorrectly tapered the entire head to a cone.
  lathe([[0,38.8],[6.8,38.8],[6.3,42],[5.7,47],[5.2,54],[4.8,63],
    [4.5,73],[4.25,84],[4.1,92],[4.1,96],[0,96]]);
  // Two curved glazed levels inside the separate red-orange elliptical cage.
  lathe([[7.3,96],[9.2,97.2],[10.45,98.7],[10.85,100],[10.6,101.5],
    [9.5,103],[7,104.3]],glass,.72);
  lathe([[4.05,95.4],[7.3,95.4],[9.2,96],[10.5,97.2]],orange,.55);
  lathe([[10.6,103],[9.5,104.2],[6.3,105.1],[3.95,105.1]],ivory,.65);
  ring(10.9,100,.18,ivory,.7);
  ring(10.55,97.25,.17,ivory,.6);
  const cage: [number,number][] = [[5,95.5],[9.7,96.3],[12.3,98.3],[12.8,100],
    [12.3,101.7],[10.5,103.6],[6.8,105],[4.2,105.3]];
  ribs(cage,36,.12,orange,.7);
  for(const [r,y] of [[9.7,96.3],[12.3,98.3],[12.8,100],[12.3,101.7],[10.5,103.6]]) ring(r,y,.12);
  // Recessed panes stay readable between the structural ribs from all azimuths.
  ribs([[7.35,96.1],[9.25,97.3],[10.5,98.7],[10.9,100],[10.65,101.5],[9.55,103],[7.05,104.3]],36,.045,ivory,.65);

  // Cylindrical white neck, square red/white mast, maintenance rail and needle.
  lathe([[0,104.5],[3.95,104.5],[3.95,111.9],[3.6,112.6],[0,112.6]],ivory,.6);
  ring(3.75,112.7,.12);
  for(let i=0;i<16;i++) {
    const a=i*Math.PI/8;
    box(.09,.65,.09,Math.sin(a)*3.75,112.4,Math.cos(a)*3.75,orange,.55);
  }
  box(2.05,4.9,2.05,0,115.05,0,orange,.7);
  box(2.05,8.1,2.05,0,121.55,0,ivory,.6);
  // The ladder is visible on the neck and upper equipment housing in the photos.
  for(const [bottom,top,z] of [[105,112.5,4.04],[113,125.6,1.07]]) {
    for(const x of [-.34,.34]) box(.065,top-bottom,.065,x,(top+bottom)/2,z,ivory,.45);
    for(let y=bottom;y<top;y+=.55) box(.75,.055,.07,0,y,z,ivory,.4);
  }
  const needle=new THREE.CylinderGeometry(.07,.16,5.4,8);
  needle.translate(0,128.3,0); add(needle,ivory,.5);
  box(.14,2.5,.14,0,129.75,0,orange,.65);

  // The roof lounge flares outward: a blue glazed bowl, not a flat concrete roof.
  lathe([[9.7,31.1],[10.8,32],[13,34],[15,36.3],[16.5,38.5],[17,39]],glass,.65);
  ribs([[9.75,31.2],[10.85,32],[13.05,34],[15.05,36.3],[16.55,38.5],[17.05,39]],48,.07,[.45,.32,.13],.5);
  for(const [r,y] of [[10.8,32],[13,34],[15,36.3],[17,39]]) ring(r,y,.09,[.45,.32,.13],.5);
  lathe([[17,39],[17,39.3],[6.8,39.3]],ivory,.35);

  // Existing podium retained while the distinctive tower silhouette is replaced.
  box(49,30,36,0,15,0,[.32,.3,.27]);
  box(51,1.2,38,0,30.4,0,[.14,.15,.15]);
  for(let floor=0;floor<7;floor++) {
    const y=3.8+floor*3.7;
    for(const side of [-1,1]) {
      box(49.2,.24,.3,0,y-1.5,side*18.1,[.12,.11,.1]);
      for(let x=-21;x<=21;x+=3.5) box(2.35,1.85,.3,x,y,side*18.2,glass,.7);
      for(let z=-14;z<=14;z+=3.5) box(.3,1.85,2.35,side*24.7,y,z,glass,.7);
    }
  }
  return parts;
}
