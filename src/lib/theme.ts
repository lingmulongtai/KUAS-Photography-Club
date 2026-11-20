export const THEME_KEY = 'kuas-theme';
export const THEMES = ['light', 'dark', 'black'] as const;
export type Theme = typeof THEMES[number];

/** Light is the default, regardless of the device's colour preference. */
export function preferredTheme(saved: unknown): Theme {
  return THEMES.includes(saved as Theme) ? saved as Theme : 'light';
}

export const THEME_COLORS: Record<Theme, string> = {
  light: '#f7fbfb', dark: '#101b2b', black: '#000000',
};

/**
 * The InstaFrame theme closest to each site theme, for the embedded tool:
 * the light site, the navy dark site (InstaFrame's blue-grey dark) and the black site.
 */
export const INSTAFRAME_THEMES: Record<Theme, string> = {
  light: 'light', dark: 'blue-grey-dark', black: 'dark',
};
export const instaFrameTheme = (theme: unknown) => INSTAFRAME_THEMES[preferredTheme(theme)];
