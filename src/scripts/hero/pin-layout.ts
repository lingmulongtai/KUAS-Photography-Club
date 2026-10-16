export interface ScreenRect { x: number; y: number; w: number; h: number; }

/** Include the 44 px tap target and the full label above its map anchor. */
export function pinBounds(x: number, y: number, labelWidth: number, labelHeight: number): ScreenRect {
  const half=Math.max(22,labelWidth/2), top=Math.max(22,12+labelHeight), gap=4;
  return {x:x-half-gap,y:y-top-gap,w:half*2+gap*2,h:top+22+gap*2};
}

export function overlaps(a: ScreenRect, b: ScreenRect) {
  return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
}
