import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { SiteLanguage } from './i18n.ts';

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
export type HomeField = [key: string | number, ja: string | null, en: string | null];
export interface HomeCopy { title: [string, string]; elements: HomeField[][]; }

const ignored = new Set(['script', 'style', 'noscript']);
const formatting = new Set(['b', 'br', 'em', 'i', 'small', 'span', 'strong', 'wbr']);
const children = (node: Parent) => node.childNodes.filter((n): n is Element => 'tagName' in n && !ignored.has(n.tagName));
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value ?? null;

// Text on either side of a control is translated separately, so the control keeps its listeners and value.
function textSlots(node: Element) {
  const slots = [''];
  for (const child of node.childNodes) {
    if (child.nodeName === '#text' && 'value' in child) slots[slots.length - 1] += child.value;
    else if ('tagName' in child && !ignored.has(child.tagName)) slots.push('');
  }
  return slots;
}

function onlyFormatting(node: Element): boolean {
  return children(node).every(child => formatting.has(child.tagName) && onlyFormatting(child));
}

function pageParts(html: string) {
  const root = children(parse(html, { sourceCodeLocationInfo: true }))[0];
  const head = children(root).find(el => el.tagName === 'head')!;
  const body = children(root).find(el => el.tagName === 'body')!;
  const metadata = children(head).filter(el => el.tagName === 'meta' || attr(el, 'rel') === 'canonical');
  const title = textSlots(children(head).find(el => el.tagName === 'title')!)[0];
  return { body, metadata, title };
}

/** Both Astro renders stay on the server. Ship only the fields that differ alongside the requested, fully rendered page. */
export function bilingualHome(html: string, alternate: string, language: SiteLanguage): string {
  const primary = pageParts(html), other = pageParts(alternate);
  const [ja, en] = language === 'ja' ? [primary, other] : [other, primary];
  const copy: HomeCopy = { title: [ja.title, en.title], elements: [] };
  const insertions: { at: number; text: string }[] = [];

  function compare(japanese: Element, english: Element) {
    if (japanese.tagName !== english.tagName) throw new Error('Home language elements must match: ' + japanese.tagName + ' / ' + english.tagName);
    const fields: HomeField[] = [];
    const names = new Set([...japanese.attrs, ...english.attrs].map(a => a.name));
    for (const name of names) {
      const a = attr(japanese, name), b = attr(english, name);
      if (a !== b) fields.push([name, a, b]);
    }
    const a = children(japanese), b = children(english);
    if (a.length === b.length && a.every((node, i) => node.tagName === b[i].tagName)) {
      const left = textSlots(japanese), right = textSlots(english);
      left.forEach((value, index) => {
        if (value !== right[index] && (value.trim() || right[index].trim())) fields.push([index, value, right[index]]);
      });
      a.forEach((child, i) => compare(child, b[i]));
    } else {
      if (!onlyFormatting(japanese) || !onlyFormatting(english)) {
        throw new Error('Keep interactive home elements paired across languages: ' + japanese.tagName + ' ' + (attr(japanese, 'class') ?? ''));
      }
      fields.push(['#html', serialize(japanese), serialize(english)]);
    }
    if (!fields.length) return;
    const original = language === 'ja' ? japanese : english;
    const id = copy.elements.push(fields) - 1;
    // Append the marker after the existing attributes so metadata retains its native shape.
    const end = original.sourceCodeLocation!.startTag!.endOffset - 1;
    insertions.push({ at: html[end - 1] === '/' ? end - 1 : end, text: ' data-home-copy="' + id + '"' });
  }

  for (const meta of ja.metadata) {
    const key = attr(meta, 'name') ?? attr(meta, 'property') ?? attr(meta, 'rel');
    if (!key) continue;
    const match = en.metadata.find(el => (attr(el, 'name') ?? attr(el, 'property') ?? attr(el, 'rel')) === key);
    if (match) compare(meta, match);
  }
  compare(ja.body, en.body);
  const json = JSON.stringify(copy).replaceAll('<', '\\u003c');
  insertions.push({ at: primary.body.sourceCodeLocation!.endTag!.startOffset, text: '<script type="application/json" id="home-copy">' + json + '</script>' });
  // Work with the original bytes to preserve Astro's scripts, styles and escaping.
  let cursor = 0;
  const pieces: string[] = [];
  for (const { at, text } of insertions.sort((a, b) => a.at - b.at)) {
    pieces.push(html.slice(cursor, at), text);
    cursor = at;
  }
  pieces.push(html.slice(cursor));
  return pieces.join('');
}
