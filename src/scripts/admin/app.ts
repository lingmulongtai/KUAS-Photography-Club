/*
 * The admin panel in the browser. Photos stay on this computer until publishing; then each one is
 * resized (long side 2000 px), given the club watermark if chosen, and re-encoded as JPEG, which
 * also drops EXIF data such as GPS location.
 */
import {
  WATERMARK_POSITIONS,
  cleanWatermark,
  decodePhoto,
  loadWatermarkAssets,
  paint,
  renderPhoto,
  type WatermarkAssets,
  type WatermarkSettings,
} from './watermark';

interface Session {
  signedIn: boolean;
  configured: boolean;
  missing: string[];
  demo: boolean;
  canPublish: boolean;
}

interface PublishResult {
  ok?: boolean;
  demo?: boolean;
  markdown?: string;
  path?: string;
  commit?: string;
  page?: string;
  sha?: string;
}

interface TripRef {
  slug: string;
  title: string;
  date: string;
  photos: number;
  sample: boolean;
  spot: string;
  cover: string;
}

interface EventData {
  date: string;
  title: string;
  titleEn?: string;
  kind: string;
  time?: string;
  place?: string;
  note?: string;
  noteEn?: string;
  link?: string;
}

interface MonthData {
  month: string;
  weeklyMeeting: boolean;
  noMeeting: string[];
  events: EventData[];
  notes: string;
}

interface PickedPhoto {
  id: string;
  file: File;
  /** a small copy for previews (long side 900 px) */
  preview: ImageBitmap;
  /** the size it will be published at */
  width: number;
  height: number;
  alt: string;
  by: string;
  caption: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const WATERMARK_KEY = 'kuas-admin-watermark';
const DRAFT_KEY = 'kuas-admin-draft-new';
const DRAFT_FIELDS = ['title', 'date', 'place', 'members', 'summary', 'spot', 'body', 'slug'] as const;

const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => { throw new Error('サーバーの応答を確認できませんでした。入力を残したまま、もう一度お試しください。'); });
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
  return data as T;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A message box: info, a success or an error. */
function notice(el: HTMLElement, html: string, kind: 'info' | 'ok' | 'error' = 'info') {
  el.hidden = !html;
  el.classList.toggle('is-ok', kind === 'ok');
  el.classList.toggle('is-error', kind === 'error');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = html;
}

async function toBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------- the club watermark, shared by both photo lists ---------- */

const watermark = {
  settings: cleanWatermark(JSON.parse(store.get(WATERMARK_KEY) ?? 'null')),
  art: { mark: null } as WatermarkAssets,
  listeners: new Set<() => void>(),
  set(next: Partial<WatermarkSettings>) {
    this.settings = cleanWatermark({ ...this.settings, ...next });
    store.set(WATERMARK_KEY, JSON.stringify(this.settings));
    this.listeners.forEach((fn) => fn());
  },
};
void loadWatermarkAssets().then((art) => { watermark.art = art; watermark.listeners.forEach((fn) => fn()); });

const POSITION_NAMES: Record<string, string> = {
  'top-left': '左上', 'top-center': '上', 'top-right': '右上',
  'middle-left': '左', 'middle-center': '中央', 'middle-right': '右',
  'bottom-left': '左下', 'bottom-center': '下', 'bottom-right': '右下',
};

/** A drop zone, the watermark settings with a large preview, and an editable list of photos. */
function photoPicker(root: HTMLElement, name: string, onChange: () => void) {
  const photos: PickedPhoto[] = [];
  let focus = 0;
  const s = watermark.settings;
  root.innerHTML = `
    <div class="picker">
      <label class="drop">
        <input type="file" accept="image/*,.heic,.heif" multiple class="visually-hidden" />
        <strong>写真を選ぶ</strong>
        <span class="small">ここにドラッグしてもOK。何枚でもまとめて選べます。<br />公開するときに長い辺 2000px の JPEG にし、位置情報などは消します。</span>
      </label>
      <p class="notice is-error" data-errors hidden></p>
      <div class="wm${s.enabled ? '' : ' is-off'}">
        <div class="wm-head">
          <b>写真部のウォーターマーク</b>
          <label class="switch"><input type="checkbox" data-wm="enabled" ${s.enabled ? 'checked' : ''} />写真に入れる</label>
        </div>
        <div class="wm-controls">
          <fieldset class="plain-set"><legend class="small">デザイン</legend><div class="seg">
            ${[['emblem', 'ロゴ＋文字'], ['ring', '円のマーク'], ['text', '© 撮影者名']].map(([v, l]) => `<label><input type="radio" name="${name}-style" data-wm="style" value="${v}" ${s.style === v ? 'checked' : ''} />${l}</label>`).join('')}
          </div></fieldset>
          <fieldset class="plain-set"><legend class="small">位置</legend><div class="grid9">
            ${WATERMARK_POSITIONS.map((p) => `<label title="${POSITION_NAMES[p]}"><input type="radio" name="${name}-position" data-wm="position" value="${p}" ${s.position === p ? 'checked' : ''} aria-label="${POSITION_NAMES[p]}" /></label>`).join('')}
          </div></fieldset>
          <label class="range">大きさ<input type="range" min="4" max="30" step="1" data-wm="size" value="${s.size}" /><output data-out="size">${s.size}%</output></label>
          <label class="range">濃さ<input type="range" min="20" max="100" step="5" data-wm="opacity" value="${s.opacity}" /><output data-out="opacity">${s.opacity}%</output></label>
          <fieldset class="plain-set"><legend class="small">色</legend><div class="seg">
            ${[['white', '白', '#fff'], ['black', '黒', '#14262b'], ['teal', '部のティール', '#64bec6']].map(([v, l, c]) => `<label><input type="radio" name="${name}-color" data-wm="color" value="${v}" ${s.color === v ? 'checked' : ''} /><span class="swatch" style="background:${c}"></span>${l}</label>`).join('')}
          </div></fieldset>
          <p class="hint">設定はこのブラウザに保存され、次回も同じ設定で始まります。</p>
        </div>
        <div class="wm-stage" data-stage></div>
      </div>
      <label>撮影者（全部の写真に同じ名前を入れる）<input data-by-all placeholder="例：山田 花子" maxlength="40" /></label>
      <div class="list" data-rows></div>
    </div>`;
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  const drop = root.querySelector<HTMLElement>('.drop')!;
  const rows = root.querySelector<HTMLElement>('[data-rows]')!;
  const byAll = root.querySelector<HTMLInputElement>('[data-by-all]')!;
  const errors = root.querySelector<HTMLElement>('[data-errors]')!;
  const panel = root.querySelector<HTMLElement>('.wm')!;
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const big = document.createElement('canvas');
  big.setAttribute('aria-label', 'ウォーターマークの仕上がり');

  /** Redraw every preview with the current watermark. */
  const drawPreviews = () => {
    const set = watermark.settings;
    panel.classList.toggle('is-off', !set.enabled);
    rows.querySelectorAll<HTMLCanvasElement>('canvas.thumb').forEach((canvas) => {
      const p = photos.find((x) => x.id === canvas.closest<HTMLElement>('.photo-row')?.dataset.id);
      if (!p) return;
      const k = 300 / Math.max(p.preview.width, p.preview.height);
      paint(canvas, p.preview, Math.round(p.preview.width * k), Math.round(p.preview.height * k), set, watermark.art, p.by);
    });
    const p = photos[Math.min(focus, photos.length - 1)];
    if (!p) {
      stage.innerHTML = '<div class="empty">写真を選ぶと、ここで仕上がりを確認できます。</div>';
      return;
    }
    if (!stage.contains(big)) { stage.replaceChildren(big); stage.insertAdjacentHTML('beforeend', '<p class="hint" data-stage-note></p>'); }
    paint(big, p.preview, p.preview.width, p.preview.height, set, watermark.art, p.by);
    stage.querySelector('[data-stage-note]')!.textContent = `${photos.indexOf(p) + 1}枚目の仕上がり。一覧の写真をクリックすると切り替わります。`;
  };

  const render = () => {
    rows.innerHTML = photos
      .map(
        (p, i) => `
      <div class="photo-row${i === 0 ? ' is-cover' : ''}" data-id="${p.id}">
        <div class="thumb-wrap">
          <canvas class="thumb" role="img" aria-label="${i + 1}枚目のプレビュー"></canvas>
          ${i === 0 ? '<span class="badge">表紙</span>' : ''}
        </div>
        <div class="fields">
          <label class="wide"><span class="lbl">何が写っている？ <em>必須</em></span><input data-k="alt" value="${esc(p.alt)}" maxlength="120" placeholder="例：夕日に染まる八坂の塔" class="${p.alt.trim() ? '' : 'is-missing'}" /></label>
          <label><span class="lbl">撮影者 <em>必須</em></span><input data-k="by" value="${esc(p.by)}" maxlength="40" class="${p.by.trim() ? '' : 'is-missing'}" /></label>
          <label>ひとこと（任意）<input data-k="caption" value="${esc(p.caption)}" maxlength="200" placeholder="撮影のコツなど" /></label>
          <p class="meta">${i + 1}枚目${i === 0 ? '（一覧の表紙）' : ''} · 公開サイズ ${p.width}×${p.height}${p.height > p.width ? '（縦）' : ''}</p>
        </div>
        <div class="row-tools">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="${i + 1}枚目を前へ" title="前へ">↑</button>
          <button type="button" data-act="down" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="${i + 1}枚目を後ろへ" title="後ろへ">↓</button>
          <button type="button" data-act="remove" aria-label="${i + 1}枚目を外す" title="外す">✕</button>
        </div>
      </div>`,
      )
      .join('');
    drawPreviews();
    onChange();
  };

  rows.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.closest<HTMLElement>('.photo-row')?.dataset.id;
    const p = photos.find((x) => x.id === id);
    if (!p || !el.dataset.k) return;
    (p as unknown as Record<string, string>)[el.dataset.k] = el.value;
    if (el.dataset.k !== 'caption') el.classList.toggle('is-missing', !el.value.trim());
    if (el.dataset.k === 'by' && watermark.settings.style === 'text') drawPreviews();
    onChange();
  });
  rows.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const id = target.closest<HTMLElement>('.photo-row')?.dataset.id;
    const i = photos.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (target.closest('canvas.thumb')) { focus = i; drawPreviews(); return; }
    const b = target.closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'remove') photos.splice(i, 1)[0].preview.close();
    if (b.dataset.act === 'up' && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
    if (b.dataset.act === 'down' && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
    render();
  });
  byAll.addEventListener('input', () => {
    for (const p of photos) p.by = byAll.value;
    render();
  });

  /* watermark controls */
  panel.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.wm as keyof WatermarkSettings | undefined;
    if (!key) return;
    const value = key === 'enabled' ? el.checked : key === 'size' || key === 'opacity' ? Number(el.value) : el.value;
    if (key === 'size' || key === 'opacity') panel.querySelector(`[data-out=${key}]`)!.textContent = `${el.value}%`;
    watermark.set({ [key]: value });
  });
  // the other list keeps its controls in step
  const sync = () => {
    const set = watermark.settings;
    panel.querySelectorAll<HTMLInputElement>('[data-wm]').forEach((el) => {
      const key = el.dataset.wm as keyof WatermarkSettings;
      if (el.type === 'checkbox') el.checked = set.enabled;
      else if (el.type === 'radio') el.checked = el.value === String(set[key]);
      else { el.value = String(set[key]); panel.querySelector(`[data-out=${key}]`)!.textContent = `${set[key]}%`; }
    });
    drawPreviews();
  };
  watermark.listeners.add(sync);

  const add = async (files: FileList | File[]) => {
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) { failed.push(`${f.name}（写真ではありません）`); continue; }
      try {
        const { bitmap, width, height } = await decodePhoto(f);
        const k = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
        const preview = await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(bitmap.width * k)), resizeHeight: Math.max(1, Math.round(bitmap.height * k)), resizeQuality: 'high' })
          .catch(() => bitmap);
        if (preview !== bitmap) bitmap.close();
        photos.push({ id: Math.random().toString(36).slice(2), file: f, preview, width, height, alt: '', by: byAll.value, caption: '' });
        render();
      } catch {
        failed.push(`${f.name}（読み込めませんでした。HEIC はこのブラウザで開けない場合があります。JPEG に変換するか、iPhone の「互換性優先」で撮った写真を選んでください）`);
      }
    }
    notice(errors, failed.length ? `次の写真は追加できませんでした：<br />${failed.map(esc).join('<br />')}` : '', 'error');
  };
  input.addEventListener('change', () => input.files && add(input.files).then(() => (input.value = '')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) void add(e.dataTransfer.files);
  });
  render();

  return {
    photos,
    clear() {
      for (const p of photos) p.preview.close();
      photos.length = 0;
      focus = 0;
      byAll.value = '';
      notice(errors, '');
      render();
    },
  };
}

/** Prepare (resize, watermark, re-encode) and upload every photo; return file names with their shas. */
async function upload(photos: PickedPhoto[], names: string[], status: (s: string) => void) {
  const blobs: Record<string, string> = {};
  for (let i = 0; i < photos.length; i++) {
    status(`写真を準備して送っています… ${i + 1} / ${photos.length} 枚`);
    let blob: Blob;
    try {
      ({ blob } = await renderPhoto(photos[i].file, watermark.settings, photos[i].by.trim()));
    } catch {
      throw new Error(`${i + 1}枚目の写真を変換できませんでした。外して選び直してください。`);
    }
    const { sha } = await call<{ sha: string }>('/api/admin/photo', { method: 'POST', body: JSON.stringify({ data: await toBase64(blob) }) });
    blobs[names[i]] = sha;
  }
  return blobs;
}

function photoMeta(photos: PickedPhoto[], names: string[]) {
  return photos.map((p, i) => ({ name: names[i], alt: p.alt.trim(), by: p.by.trim(), caption: p.caption.trim() || undefined, portrait: p.height > p.width }));
}

/** What still needs filling in before the photos can be published. */
function photoProblems(photos: PickedPhoto[]) {
  const problems: string[] = [];
  const noAlt = photos.map((p, i) => (p.alt.trim() ? 0 : i + 1)).filter(Boolean);
  const noBy = photos.map((p, i) => (p.by.trim() ? 0 : i + 1)).filter(Boolean);
  if (noAlt.length) problems.push(`${noAlt.join('・')}枚目の「何が写っている？」`);
  if (noBy.length) problems.push(`${noBy.join('・')}枚目の「撮影者」`);
  return problems;
}

const publicationWatchers = new WeakMap<HTMLElement, AbortController>();

function stopPublicationWatch(el: HTMLElement) {
  publicationWatchers.get(el)?.abort();
  publicationWatchers.delete(el);
}

function result(el: HTMLElement, pre: HTMLElement, r: PublishResult) {
  stopPublicationWatch(el);
  if (r.demo) {
    notice(el, 'ローカルデモのため保存・公開していません。保存される内容は下で確認できます。');
    pre.hidden = false;
    pre.textContent = `# ${r.path}\n\n${r.markdown}`;
    return;
  }
  if (!r.ok || !r.commit) throw new Error('保存の完了を確認できませんでした。入力を残したまま、変更履歴を確認してください。');
  pre.hidden = true;
  const links = `<a href="${esc(r.page ?? '/')}" target="_blank" rel="noopener">ページを開く ↗</a> · <a href="${esc(r.commit)}" target="_blank" rel="noopener">変更履歴</a>`;
  notice(el, `<b>保存しました。</b>サイトに反映されるのを待っています（ふつう1〜2分）… <br />${links}`, 'ok');
  if (!r.sha) {
    notice(el, `<b>保存しました。</b>サイトへの反映はまだ確認できていません。<br />${links}`, 'ok');
    return;
  }
  const controller = new AbortController();
  publicationWatchers.set(el, controller);
  const abortOnLeave = () => controller.abort();
  const release = () => {
    window.removeEventListener('pagehide', abortOnLeave);
    if (publicationWatchers.get(el) === controller) publicationWatchers.delete(el);
  };
  window.addEventListener('pagehide', abortOnLeave, { once: true });
  controller.signal.addEventListener('abort', release, { once: true });
  const deadline = Date.now() + 120_000;
  void (async () => {
    while (!controller.signal.aborted && Date.now() < deadline) {
      const check = new AbortController();
      const cancel = () => check.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      const timeout = window.setTimeout(cancel, Math.min(10_000, deadline - Date.now()));
      try {
        const response = await fetch(`/admin-build.json?publication=${encodeURIComponent(r.sha!)}&t=${Date.now()}`, { cache: 'no-store', signal: check.signal });
        if (response.ok) {
          const build = await response.json() as { commit?: string | null };
          if (build.commit === r.sha) {
            if (controller.signal.aborted || publicationWatchers.get(el) !== controller) return;
            notice(el, `<b>公開しました。</b>サイトに反映されています。<br />${links}`, 'ok');
            release();
            return;
          }
        }
      } catch {
        // A deployment or network interruption can temporarily prevent a status check.
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener('abort', cancel);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    if (!controller.signal.aborted) {
      notice(el, `<b>保存済みです。</b>サイトへの反映はまだ確認できていません。少し時間をおいてページを開いてみてください。反映されない場合は Vercel のデプロイ結果を確認してください。<br />${links}`, 'ok');
      release();
    }
  })();
}

/** A URL name from the date and the map pin: 2026-11-29-arashiyama. */
export function suggestSlug(date: string, spot: string) {
  return [date, spot].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function startAdmin(root: HTMLElement) {
  const trips = JSON.parse(root.dataset.trips ?? '[]') as TripRef[];
  const months = JSON.parse(root.dataset.months ?? '[]') as MonthData[];
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const views = { login: $('[data-view=login]'), app: $('[data-view=app]') };
  const modeNote = $('[data-mode]');
  const setup = $('[data-setup]');
  const logout = $('[data-logout]');
  let session: Session | null = null;
  const busyForms = new Set<HTMLFormElement>();
  /** per form: is everything needed filled in? */
  const ready = new Map<HTMLFormElement, () => boolean>();
  const updatePublishButtons = () => {
    root.querySelectorAll<HTMLFormElement>('[data-panel]').forEach((form) => {
      const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
      if (button) button.disabled = busyForms.has(form) || !(session?.canPublish || session?.demo) || !(ready.get(form)?.() ?? true);
    });
  };
  const beginSubmission = (form: HTMLFormElement, status: HTMLElement) => {
    if (busyForms.has(form)) return false;
    if (!(session?.canPublish || session?.demo)) {
      notice(status, '公開の準備ができていません。画面上部の案内を確認してください。', 'error');
      return false;
    }
    stopPublicationWatch(status);
    busyForms.add(form);
    form.setAttribute('aria-busy', 'true');
    updatePublishButtons();
    return true;
  };
  const endSubmission = (form: HTMLFormElement) => {
    busyForms.delete(form);
    form.removeAttribute('aria-busy');
    updatePublishButtons();
  };

  const show = (s: Session) => {
    session = s;
    views.login.hidden = s.signedIn || !s.configured;
    views.app.hidden = !s.signedIn;
    logout.hidden = !s.signedIn;
    $('[data-demo-hint]').hidden = !s.demo;
    const missing = (s.missing ?? []).map((name) => `<code>${esc(name)}</code>`).join('、');
    modeNote.dataset.state = s.demo ? 'demo' : s.canPublish ? 'live' : 'setup';
    modeNote.textContent = s.demo ? 'ローカルデモ（公開しません）' : !s.signedIn ? 'ログインしていません' : s.canPublish ? 'ログイン中・公開できます' : '公開の設定が未完了';
    setup.hidden = s.demo || s.canPublish;
    setup.innerHTML = `公開の設定が完了していないため、保存・公開できません。${missing ? `${missing} を ` : ''}Vercel の Production 環境に設定し、再デプロイしてください。設定済みなら、対象プロジェクトと環境を確認してください。`;
    updatePublishButtons();
  };

  updatePublishButtons();
  call<Session>('/api/admin/session').then(show, () => {
    modeNote.dataset.state = 'setup';
    modeNote.textContent = 'サーバーにつながりません';
    setup.hidden = false;
    setup.textContent = '管理用のサーバーにつながりません。Vercel に公開されたサイトで開いてください。';
  });

  /* sign in / out */
  $('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const err = $('[data-login-error]');
    err.hidden = true;
    try {
      const credentials = new FormData(form);
      await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: credentials.get('username'), password: credentials.get('password') }) });
      form.reset();
      show(await call<Session>('/api/admin/session'));
    } catch (x) {
      err.hidden = false;
      err.textContent = (x as Error).message;
    }
  });
  logout.addEventListener('click', async () => {
    await call('/api/admin/login', { method: 'DELETE' }).catch(() => {});
    show(await call<Session>('/api/admin/session'));
  });

  /* what to do */
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const select = (tab: HTMLButtonElement) => {
    tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === tab)); x.tabIndex = x === tab ? 0 : -1; });
    root.querySelectorAll<HTMLElement>('[role=tabpanel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
  };
  tabs.forEach((t, i) => {
    t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });

  /* ---------- new trip ---------- */
  const newForm = $<HTMLFormElement>('[data-panel=new]');
  const field = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name: string) => newForm.elements.namedItem(name) as T;
  const newStatus = $('[data-status=new]');
  const draftNote = $('[data-draft-note]');
  const checklist = $('[data-checklist]');
  const slugInput = field<HTMLInputElement>('slug');
  const slugHint = $('[data-slug-hint]');
  let slugTouched = false;
  let published = false;
  // set just below; the picker reports changes while it is being built
  let newPhotos: ReturnType<typeof photoPicker> | undefined;

  const card = {
    cover: $('[data-card-cover]'), date: $('[data-card-date]'), title: $('[data-card-title]'),
    place: $('[data-card-place]'), summary: $('[data-card-summary]'),
  };
  let coverUrl = '';
  const updateCard = () => {
    const v = (n: string) => field<HTMLInputElement>(n).value.trim();
    card.title.textContent = v('title') || 'タイトル';
    card.place.textContent = v('place') || '場所';
    card.summary.textContent = v('summary') || 'ひとこと紹介';
    card.date.textContent = v('date') ? v('date').replaceAll('-', '.') : '----.--.--';
    const first = newPhotos?.photos[0];
    if (first) {
      const canvas = document.createElement('canvas');
      paint(canvas, first.preview, first.preview.width, first.preview.height, watermark.settings, watermark.art, first.by);
      canvas.toBlob((blob) => {
        if (!blob) return;
        if (coverUrl) URL.revokeObjectURL(coverUrl);
        coverUrl = URL.createObjectURL(blob);
        card.cover.style.backgroundImage = `url("${coverUrl}")`;
        card.cover.querySelector('span')!.hidden = true;
      }, 'image/jpeg', 0.8);
    } else {
      card.cover.style.backgroundImage = '';
      card.cover.querySelector('span')!.hidden = false;
    }
  };

  const checks = () => {
    const v = (n: string) => field<HTMLInputElement>(n).value.trim();
    const slug = slugInput.value.trim();
    const photos = newPhotos?.photos ?? [];
    const problems = photoProblems(photos);
    return [
      { ok: !!v('title'), text: 'タイトル', target: 'title' },
      { ok: !!v('date'), text: '日付', target: 'date' },
      { ok: !!v('place'), text: '場所', target: 'place' },
      { ok: !!v('summary'), text: 'ひとこと紹介', target: 'summary' },
      { ok: photos.length > 0, text: photos.length ? `写真 ${photos.length}枚` : '写真を1枚以上' },
      { ok: photos.length > 0 && !problems.length, text: problems.length ? `${problems.join('、')}を入れる` : 'すべての写真に説明と撮影者' },
      { ok: SLUG.test(slug) && !trips.some((t) => t.slug === slug), text: !slug ? 'ページのアドレス' : trips.some((t) => t.slug === slug) ? 'ページのアドレス（もう使われています。変えてください）' : SLUG.test(slug) ? `ページのアドレス /trips/${slug}/` : 'ページのアドレス（半角の英小文字・数字・ハイフンで）', target: 'slug' },
    ];
  };
  const refresh = () => {
    if (!slugTouched) slugInput.value = suggestSlug(field<HTMLInputElement>('date').value, field<HTMLSelectElement>('spot').value);
    const list = checks();
    checklist.innerHTML = list.map((c) => `<li class="${c.ok ? 'done' : ''}">${esc(c.text)}</li>`).join('');
    slugHint.textContent = slugTouched ? '半角の英小文字・数字・ハイフンだけ使えます。' : '日付とピンから自動で入ります。変えたいときは書き換えてください。';
    updateCard();
    updatePublishButtons();
  };
  ready.set(newForm, () => checks().every((c) => c.ok));

  newPhotos = photoPicker($('[data-photos=new]'), 'new', () => refresh());
  const picked = newPhotos;
  watermark.listeners.add(updateCard);

  /* drafts: the words are kept in this browser until published (photos must be chosen again) */
  const saveDraft = () => {
    const draft = Object.fromEntries(DRAFT_FIELDS.map((n) => [n, field<HTMLInputElement>(n).value]));
    if (Object.values(draft).some((x) => x)) store.set(DRAFT_KEY, JSON.stringify({ ...draft, slugTouched }));
    else store.remove(DRAFT_KEY);
  };
  try {
    const draft = JSON.parse(store.get(DRAFT_KEY) ?? 'null') as Record<string, string | boolean> | null;
    if (draft && DRAFT_FIELDS.some((n) => draft[n])) {
      DRAFT_FIELDS.forEach((n) => { if (typeof draft[n] === 'string') field<HTMLInputElement>(n).value = draft[n] as string; });
      slugTouched = draft.slugTouched === true;
      notice(draftNote, '前回の入力を復元しました。写真は選び直してください。');
    }
  } catch { store.remove(DRAFT_KEY); }

  newForm.addEventListener('input', (e) => {
    const el = e.target as HTMLElement;
    if (el === slugInput) slugTouched = slugInput.value.trim() !== '';
    if (el.matches('[name]')) el.classList.remove('is-missing');
    published = false;
    saveDraft();
    refresh();
  });
  $('[data-clear-draft]').addEventListener('click', () => {
    if (!window.confirm('入力した文章と選んだ写真をすべて消します。よろしいですか？')) return;
    newForm.reset();
    picked.clear();
    slugTouched = false;
    store.remove(DRAFT_KEY);
    notice(draftNote, '');
    notice(newStatus, '');
    refresh();
  });

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = checks().find((c) => !c.ok);
    if (missing) {
      notice(newStatus, `まだ入っていない項目があります：${esc(missing.text)}`, 'error');
      const target = missing.target ? field<HTMLInputElement>(missing.target) : newForm.querySelector<HTMLElement>('.is-missing, .drop input');
      target?.classList.add('is-missing');
      target?.focus();
      return;
    }
    if (!beginSubmission(newForm, newStatus)) return;
    const f = new FormData(newForm);
    const status = (s: string) => notice(newStatus, esc(s));
    try {
      const slug = String(f.get('slug'));
      const names = picked.photos.map((_, i) => `${String(i + 1).padStart(2, '0')}.jpg`);
      const blobs = await upload(picked.photos, names, status);
      status('ページを公開しています…');
      const r = await call<PublishResult>('/api/admin/trip', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'new',
          blobs,
          trip: {
            slug,
            title: f.get('title'),
            date: f.get('date'),
            place: f.get('place'),
            spot: f.get('spot'),
            members: f.get('members') ? Number(f.get('members')) : null,
            summary: f.get('summary'),
            body: f.get('body'),
            photos: photoMeta(picked.photos, names),
          },
        }),
      });
      result(newStatus, $('[data-preview=new]'), r);
      if (!r.demo) {
        trips.unshift({ slug, title: String(f.get('title')), date: String(f.get('date')), photos: names.length, sample: false, spot: String(f.get('spot') ?? ''), cover: '' });
        fillTrips();
        newForm.reset();
        picked.clear();
        slugTouched = false;
        store.remove(DRAFT_KEY);
        notice(draftNote, '');
        published = true;
        refresh();
      }
    } catch (x) {
      notice(newStatus, `${esc((x as Error).message)}<br />入力と写真はそのまま残っています。`, 'error');
    } finally {
      endSubmission(newForm);
    }
  });

  /* ---------- add photos to a trip ---------- */
  const tripSelect = $<HTMLSelectElement>('[data-trip-select]');
  const addForm = $<HTMLFormElement>('[data-panel=add]');
  const addStatus = $('[data-status=add]');
  const spotSelect = $<HTMLSelectElement>('[data-trip-spot]');
  const tripCover = $<HTMLImageElement>('[data-trip-cover]');
  const fillTrips = () => {
    tripSelect.innerHTML = trips.map((t) => `<option value="${esc(t.slug)}">${esc(t.date)} ${esc(t.title)}（${t.photos}枚）</option>`).join('');
    $('[data-no-trips]').hidden = trips.length > 0;
    syncTrip();
  };
  const syncTrip = () => {
    const trip = trips.find((t) => t.slug === tripSelect.value);
    spotSelect.value = trip?.spot ?? '';
    tripCover.hidden = !trip?.cover;
    if (trip?.cover) tripCover.src = trip.cover;
    updatePublishButtons();
  };
  tripSelect.addEventListener('change', syncTrip);
  const addPhotos = photoPicker($('[data-photos=add]'), 'add', () => updatePublishButtons());
  ready.set(addForm, () => {
    const trip = trips.find((t) => t.slug === tripSelect.value);
    if (!trip) return false;
    if (addPhotos.photos.length) return !photoProblems(addPhotos.photos).length;
    return spotSelect.value !== trip.spot;
  });
  spotSelect.addEventListener('change', updatePublishButtons);
  fillTrips();
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!beginSubmission(addForm, addStatus)) return;
    const status = (s: string) => notice(addStatus, esc(s));
    try {
      const slug = tripSelect.value;
      const requestedSpot = spotSelect.value;
      const spotChanged = requestedSpot !== (trips.find((t) => t.slug === slug)?.spot ?? '');
      const problems = photoProblems(addPhotos.photos);
      if (problems.length) throw new Error(`${problems.join('、')}を入れてください`);
      if (!addPhotos.photos.length && !spotChanged) throw new Error('写真を追加するか、地図のピンを変えてください');
      const stamp = Date.now().toString(36);
      const names = addPhotos.photos.map((_, i) => `p${stamp}-${String(i + 1).padStart(2, '0')}.jpg`);
      const blobs = await upload(addPhotos.photos, names, status);
      status('公開しています…');
      const r = await call<PublishResult>('/api/admin/trip', {
        method: 'POST',
        body: JSON.stringify({ mode: 'append', slug, ...(spotChanged ? { spot: requestedSpot } : {}), blobs, photos: photoMeta(addPhotos.photos, names) }),
      });
      result(addStatus, $('[data-preview=add]'), r);
      if (!r.demo) {
        const ref = trips.find((t) => t.slug === slug);
        if (ref) { ref.photos += names.length; if (spotChanged) ref.spot = requestedSpot; }
        addPhotos.clear();
        fillTrips();
        tripSelect.value = slug;
        syncTrip();
      }
    } catch (x) {
      notice(addStatus, `${esc((x as Error).message)}<br />選んだ写真はそのまま残っています。`, 'error');
    } finally {
      endSubmission(addForm);
    }
  });

  /* leaving with unsent work */
  window.addEventListener('beforeunload', (e) => {
    const unsent = picked.photos.length || addPhotos.photos.length || (!published && DRAFT_FIELDS.some((n) => n !== 'date' && n !== 'slug' && field<HTMLInputElement>(n).value.trim()));
    if (unsent || busyForms.size) { e.preventDefault(); e.returnValue = ''; }
  });

  refresh();

  /* ---------- fallback schedule ---------- */
  const sForm = $<HTMLFormElement>('[data-panel=schedule]');
  const offList = $('[data-nomeeting]');
  const evList = $('[data-events]');
  const sStatus = $('[data-status=schedule]');
  const monthInput = sForm.querySelector<HTMLInputElement>('input[name=month]')!;
  const weekly = sForm.querySelector<HTMLInputElement>('input[name=weeklyMeeting]')!;
  const notes = sForm.querySelector<HTMLTextAreaElement>('textarea[name=notes]')!;
  /** The month's first Friday that isn't already marked as a day off. */
  const nextFriday = () => {
    const [y, m] = monthInput.value.split('-').map(Number);
    const taken = new Set(Array.from(offList.querySelectorAll<HTMLInputElement>('input')).map((i) => i.value));
    for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
      const date = `${monthInput.value}-${String(d).padStart(2, '0')}`;
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 5 && !taken.has(date)) return date;
    }
    return `${monthInput.value}-01`;
  };
  const kinds: [string, string][] = [
    ['meeting', 'ミーティング'],
    ['trip', '撮影会'],
    ['event', 'イベント'],
    ['deadline', '締め切り'],
    ['other', 'その他'],
  ];
  const addOff = (date = '') => {
    const row = document.createElement('div');
    row.className = 'off-row';
    row.innerHTML = `<input type="date" value="${esc(date)}" /><button type="button" aria-label="消す">✕</button>`;
    row.querySelector('button')!.addEventListener('click', () => row.remove());
    offList.appendChild(row);
  };
  const addEvent = (ev: Partial<EventData> = {}) => {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.innerHTML = `
      <input type="date" data-k="date" value="${esc(ev.date ?? '')}" aria-label="日付" />
      <input data-k="title" value="${esc(ev.title ?? '')}" placeholder="内容（例：撮影会：東山の紅葉）" aria-label="内容" />
      <select data-k="kind" aria-label="種類">${kinds.map(([v, l]) => `<option value="${v}" ${v === (ev.kind ?? 'event') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input data-k="time" value="${esc(ev.time ?? '')}" placeholder="時間" aria-label="時間" />
      <input data-k="place" value="${esc(ev.place ?? '')}" placeholder="場所" aria-label="場所" />
      <button type="button" aria-label="消す">✕</button>
      <input class="note" data-k="note" value="${esc(ev.note ?? '')}" placeholder="メモ（任意）" aria-label="メモ" />
      <input class="note" data-k="titleEn" value="${esc(ev.titleEn ?? '')}" placeholder="English title（任意）" aria-label="英語の内容" />
      <input class="note" data-k="noteEn" value="${esc(ev.noteEn ?? '')}" placeholder="English note（任意）" aria-label="英語のメモ" />
      <input class="note" data-k="link" value="${esc(ev.link ?? '')}" placeholder="リンク（任意：/trips/... や https://...）" aria-label="リンク" />`;
    row.querySelector('button')!.addEventListener('click', () => row.remove());
    evList.appendChild(row);
  };
  const loadMonth = () => {
    offList.innerHTML = '';
    evList.innerHTML = '';
    const m = months.find((x) => x.month === monthInput.value);
    weekly.checked = false;
    notes.value = m?.notes ?? '';
    (m?.noMeeting ?? []).forEach((d) => addOff(d));
    (m?.events ?? []).forEach((ev) => addEvent(ev));
    if (!m) addEvent({ date: `${monthInput.value}-01` });
    notice(sStatus, m ? 'この月の予定を読み込みました。' : '新しい月です。');
  };
  const now = new Date(Date.now() + 9 * 3600_000);
  monthInput.value = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  monthInput.addEventListener('change', loadMonth);
  loadMonth();
  $('[data-add-off]').addEventListener('click', () => addOff(nextFriday()));
  $('[data-add-event]').addEventListener('click', () => addEvent({ date: `${monthInput.value}-01` }));
  sForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!beginSubmission(sForm, sStatus)) return;
    try {
      const events = Array.from(evList.querySelectorAll<HTMLElement>('.event-row'))
        .map((row) => {
          const ev: Record<string, string> = {};
          row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => (ev[el.dataset.k!] = el.value.trim()));
          return ev;
        })
        .filter((ev) => ev.title);
      const noMeeting = Array.from(offList.querySelectorAll<HTMLInputElement>('input')).map((i) => i.value).filter(Boolean);
      notice(sStatus, '公開しています…');
      const r = await call<PublishResult>('/api/admin/schedule', {
        method: 'POST',
        body: JSON.stringify({ month: monthInput.value, weeklyMeeting: weekly.checked, noMeeting, events, notes: notes.value }),
      });
      result(sStatus, $('[data-preview=schedule]'), r);
    } catch (x) {
      notice(sStatus, esc((x as Error).message), 'error');
    } finally {
      endSubmission(sForm);
    }
  });
}
