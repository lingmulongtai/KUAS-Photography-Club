/*
 * The club watermark, drawn onto photos in the browser before they are uploaded (after InstaFrame:
 * one of nine positions, a size relative to the photo's short side, and an opacity). Everything
 * scales with the picture, so a thumbnail preview and the uploaded photo look the same.
 */

export type WatermarkStyle = 'emblem' | 'text' | 'ring';
export type WatermarkColor = 'white' | 'black' | 'teal';
export type WatermarkPosition = `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;

export interface WatermarkSettings {
  enabled: boolean;
  style: WatermarkStyle;
  position: WatermarkPosition;
  /** percent of the photo's short side */
  size: number;
  /** percent */
  opacity: number;
  color: WatermarkColor;
}

export const WATERMARK_DEFAULTS: WatermarkSettings = {
  enabled: true,
  style: 'emblem',
  position: 'bottom-right',
  size: 12,
  opacity: 85,
  color: 'white',
};

export const WATERMARK_POSITIONS: WatermarkPosition[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const STYLES: WatermarkStyle[] = ['emblem', 'text', 'ring'];
const COLORS: WatermarkColor[] = ['white', 'black', 'teal'];
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Settings read back from storage or a form, with anything unknown replaced by the default. */
export function cleanWatermark(raw: unknown): WatermarkSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof WatermarkSettings, unknown>>;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : WATERMARK_DEFAULTS.enabled,
    style: STYLES.includes(s.style as WatermarkStyle) ? (s.style as WatermarkStyle) : WATERMARK_DEFAULTS.style,
    position: WATERMARK_POSITIONS.includes(s.position as WatermarkPosition) ? (s.position as WatermarkPosition) : WATERMARK_DEFAULTS.position,
    size: clamp(s.size, 4, 30, WATERMARK_DEFAULTS.size),
    opacity: clamp(s.opacity, 20, 100, WATERMARK_DEFAULTS.opacity),
    color: COLORS.includes(s.color as WatermarkColor) ? (s.color as WatermarkColor) : WATERMARK_DEFAULTS.color,
  };
}

/** Where a box of the given size sits on the photo: a 3% margin from the chosen edges. */
export function placeBox(width: number, height: number, boxWidth: number, boxHeight: number, position: WatermarkPosition) {
  const inset = Math.min(width, height) * 0.03;
  const [row, column] = position.split('-');
  const x = column === 'left' ? inset : column === 'right' ? width - boxWidth - inset : (width - boxWidth) / 2;
  const y = row === 'top' ? inset : row === 'bottom' ? height - boxHeight - inset : (height - boxHeight) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/** The credit line for the text style. */
export const creditText = (by: string) => (by.trim() ? `© ${by.trim()} · KUAS Photography Club` : '© KUAS Photography Club');

/* ---------- drawing (browser only) ---------- */

const INK: Record<WatermarkColor, { fill: string; shadow: string }> = {
  white: { fill: '#ffffff', shadow: 'rgba(0, 0, 0, 0.45)' },
  black: { fill: '#14262b', shadow: 'rgba(255, 255, 255, 0.4)' },
  teal: { fill: '#64bec6', shadow: 'rgba(0, 0, 0, 0.45)' },
};
const JA = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif';
const LATIN = 'Quicksand, "Zen Kaku Gothic New", sans-serif';

export interface WatermarkAssets { mark: ImageBitmap | null }

let assets: Promise<WatermarkAssets> | null = null;
/** The round club mark and the fonts, loaded once. A missing mark falls back to the ring. */
export function loadWatermarkAssets(): Promise<WatermarkAssets> {
  assets ??= (async () => {
    await Promise.all([
      document.fonts?.load(`700 40px ${JA}`, '写真部'),
      document.fonts?.load(`600 40px ${LATIN}`, 'KUAS Photography Club'),
    ].map((p) => p?.catch(() => undefined)));
    try {
      const response = await fetch('/brand/mark-512.webp');
      if (!response.ok) throw new Error('mark unavailable');
      return { mark: await createImageBitmap(await response.blob()) };
    } catch {
      return { mark: null };
    }
  })();
  return assets;
}

/** Draw the watermark onto a canvas already holding the photo. */
export function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, s: WatermarkSettings, art: WatermarkAssets, by = '') {
  if (!s.enabled) return;
  const unit = Math.min(width, height) * (s.size / 100);
  const ink = INK[s.color];
  ctx.save();
  ctx.globalAlpha = s.opacity / 100;
  ctx.shadowColor = ink.shadow;
  ctx.shadowBlur = unit * 0.08;
  ctx.fillStyle = ink.fill;
  ctx.strokeStyle = ink.fill;
  ctx.textBaseline = 'alphabetic';
  const style = s.style === 'emblem' && !art.mark ? 'ring' : s.style;

  if (style === 'text') {
    const size = unit * 0.42;
    ctx.font = `700 ${size}px ${LATIN}`;
    const text = creditText(by);
    const w = ctx.measureText(text).width;
    const { x, y } = placeBox(width, height, w, size * 1.2, s.position);
    ctx.fillText(text, x, y + size * 0.95);
  } else if (style === 'emblem') {
    // the round mark, then 写真部 and the English name beside it, as in the club logo
    const title = unit * 0.42;
    const sub = unit * 0.15;
    ctx.font = `700 ${title}px ${JA}`;
    const titleWidth = ctx.measureText('写 真 部').width;
    ctx.font = `600 ${sub}px ${LATIN}`;
    const subWidth = ctx.measureText('KUAS Photography Club').width;
    const gap = unit * 0.2;
    const boxWidth = unit + gap + Math.max(titleWidth, subWidth);
    const { x, y } = placeBox(width, height, boxWidth, unit, s.position);
    ctx.save();
    ctx.shadowBlur = unit * 0.12;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.drawImage(art.mark!, x, y, unit, unit);
    ctx.restore();
    const textX = x + unit + gap;
    ctx.font = `700 ${title}px ${JA}`;
    ctx.fillText('写 真 部', textX, y + unit * 0.58);
    ctx.font = `600 ${sub}px ${LATIN}`;
    ctx.fillText('KUAS Photography Club', textX, y + unit * 0.86);
  } else {
    // the logo's open circle and dot in one colour, 写真部 inside; drawn larger, being only a line
    const ring = unit * 1.5;
    const { x, y } = placeBox(width, height, ring, ring, s.position);
    const cx = x + ring / 2;
    const cy = y + ring / 2;
    const r = ring * 0.46;
    const deg = Math.PI / 180;
    ctx.lineWidth = Math.max(1, ring * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -26 * deg, (-26 + 338) * deg);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * Math.cos(-38 * deg), cy + r * Math.sin(-38 * deg), ring * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = `700 ${ring * 0.27}px ${JA}`;
    ctx.fillText('写真部', cx, cy + ring * 0.06);
    ctx.font = `700 ${ring * 0.08}px ${LATIN}`;
    ctx.fillText('KUAS PHOTOGRAPHY CLUB', cx, cy + ring * 0.2);
  }
  ctx.restore();
}

export const MAX_SIDE = 2000;
export const QUALITY = 0.86;

/** Decode a photo the right way up, and the size it is drawn at (no longer than `maxSide`). */
export async function decodePhoto(file: Blob, maxSide = MAX_SIDE) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  return { bitmap, width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) };
}

/** Draw a decoded photo at a size, with the watermark, onto a canvas of that size. */
export function paint(canvas: HTMLCanvasElement, bitmap: ImageBitmap, width: number, height: number, s: WatermarkSettings, art: WatermarkAssets, by: string) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  drawWatermark(ctx, width, height, s, art, by);
}

/**
 * The photo as it will be published: at most 2000 px, the watermark drawn in, re-encoded as JPEG.
 * Re-encoding through a canvas also drops EXIF data such as GPS location.
 */
export async function renderPhoto(file: Blob, s: WatermarkSettings, by: string) {
  const { bitmap, width, height } = await decodePhoto(file);
  const canvas = document.createElement('canvas');
  paint(canvas, bitmap, width, height, s, s.enabled ? await loadWatermarkAssets() : { mark: null }, by);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('写真の変換に失敗しました'))), 'image/jpeg', QUALITY));
  canvas.width = canvas.height = 0;
  return { blob, width, height };
}
