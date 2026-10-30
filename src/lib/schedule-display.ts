/** Use an explicitly supplied translation, otherwise keep the original event text. */
export function scheduleText(original:string,english:string|undefined,lang:'ja'|'en') {
  return lang==='en' ? (english ?? original) : original;
}
