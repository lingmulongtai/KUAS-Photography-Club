/**
 * The studio speaks Japanese and English. Labels that belong to things (lenses, places,
 * challenges) carry both; sentences built from numbers use `picker`, with the two
 * languages written side by side.
 */

export type Lang = 'ja' | 'en';

export interface Text {
  ja: string;
  en: string;
}

export const tr = (text: Text, lang: Lang) => text[lang];

/** `t('日本語', 'English')` returns the one for `lang`. */
export const picker = (lang: Lang) => (ja: string, en: string) => (lang === 'en' ? en : ja);

export type Pick = ReturnType<typeof picker>;
