export const SHUTTERS = [1/4000, 1/2000, 1/1000, 1/500, 1/250, 1/125, 1/60, 1/30, 1/15, 1/8, 1/4, 1/2, 1, 2, 4, 8, 15, 30] as const;
export const APERTURES = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22] as const;
export const ISO_STOPS = [100, 200, 400, 800, 1600, 3200, 6400, 12800] as const;
export const FOCAL_STOPS = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300] as const;
export const FOCUS_STOPS = [.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 25, 40, 60] as const;
export const shutterLabel = (t: number) => t >= 1 ? `${t}″` : `1/${Math.round(1/t)}`;
