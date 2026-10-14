/*
 * The admin panel in the browser. Photos are resized here (long side 2000 px, JPEG) before they
 * leave the computer; re-encoding through a canvas also drops EXIF data such as GPS location.
 */

interface Session {
  signedIn: boolean;
  demo: boolean;
  canPublish: boolean;
}

interface TripRef {
  slug: string;
  title: string;
  date: string;
  photos: number;
  sample: boolean;
  spot: string;
}

interface EventData {
  date: string;
  title: string;
  kind: string;
  time?: string;
  place?: string;
  note?: string;
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
  blob: Blob;
  url: string;
  width: number;
  height: number;
  alt: string;
  by: string;
  caption: string;
}

const MAX_SIDE = 2000;
const QUALITY = 0.86;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
  return data as T;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Decode, turn upright, shrink and re-encode a photo as JPEG. */
async function prepare(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name} を読み込めませんでした（HEIC などは JPEG にしてから選んでください）`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('変換に失敗しました'))), 'image/jpeg', QUALITY));
  return { blob, width: w, height: h };
}

async function toBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A drop zone plus an editable list of photos. */
function photoPicker(root: HTMLElement) {
  const photos: PickedPhoto[] = [];
  root.innerHTML = `
    <label class="drop">
      <input type="file" accept="image/*" multiple hidden />
      <strong>写真を選ぶ</strong>
      <span class="small">ここにドラッグしてもOK。長い辺 2000px の JPEG に縮小し、位置情報などは消してから送ります。</span>
    </label>
    <label>撮影者（まとめて入れる場合）<input data-by-all placeholder="例：山田 花子" /></label>
    <div class="list" data-rows></div>`;
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  const drop = root.querySelector<HTMLElement>('.drop')!;
  const rows = root.querySelector<HTMLElement>('[data-rows]')!;
  const byAll = root.querySelector<HTMLInputElement>('[data-by-all]')!;

  const render = () => {
    rows.innerHTML = photos
      .map(
        (p, i) => `
      <div class="photo-row" data-id="${p.id}">
        <img src="${p.url}" alt="" />
        <div class="fields">
          <label class="wide">説明（どんな写真か）<input data-k="alt" value="${esc(p.alt)}" maxlength="120" placeholder="例：夕日に染まる八坂の塔" /></label>
          <label>撮影者<input data-k="by" value="${esc(p.by)}" maxlength="40" /></label>
          <label>キャプション（任意）<input data-k="caption" value="${esc(p.caption)}" maxlength="200" /></label>
          <p class="meta">${i + 1}枚目 · ${p.width}×${p.height}${p.height > p.width ? '（縦）' : ''} · ${Math.round(p.blob.size / 1024)} KB</p>
        </div>
        <div class="row-tools">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="前へ">↑</button>
          <button type="button" data-act="down" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="後ろへ">↓</button>
          <button type="button" data-act="remove" aria-label="外す">✕</button>
        </div>
      </div>`,
      )
      .join('');
  };

  rows.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.closest<HTMLElement>('.photo-row')?.dataset.id;
    const p = photos.find((x) => x.id === id);
    if (p && el.dataset.k) (p as unknown as Record<string, string>)[el.dataset.k] = el.value;
  });
  rows.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const id = b.closest<HTMLElement>('.photo-row')?.dataset.id;
    const i = photos.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (b.dataset.act === 'remove') URL.revokeObjectURL(photos.splice(i, 1)[0].url);
    if (b.dataset.act === 'up' && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
    if (b.dataset.act === 'down' && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
    render();
  });
  byAll.addEventListener('input', () => {
    for (const p of photos) p.by = byAll.value;
    render();
  });

  const add = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
      try {
        const { blob, width, height } = await prepare(f);
        photos.push({ id: Math.random().toString(36).slice(2), blob, url: URL.createObjectURL(blob), width, height, alt: '', by: byAll.value, caption: '' });
        render();
      } catch (err) {
        alert((err as Error).message);
      }
    }
  };
  input.addEventListener('change', () => input.files && add(input.files).then(() => (input.value = '')));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) add(e.dataTransfer.files);
  });
  render();

  return {
    photos,
    clear() {
      for (const p of photos) URL.revokeObjectURL(p.url);
      photos.length = 0;
      render();
    },
  };
}

/** Upload every photo as a blob and return file names with their shas. */
async function upload(photos: PickedPhoto[], names: string[], status: (s: string) => void) {
  const blobs: Record<string, string> = {};
  for (let i = 0; i < photos.length; i++) {
    status(`写真を送っています… ${i + 1} / ${photos.length}`);
    const { sha } = await call<{ sha: string }>('/api/admin/photo', { method: 'POST', body: JSON.stringify({ data: await toBase64(photos[i].blob) }) });
    blobs[names[i]] = sha;
  }
  return blobs;
}

function photoMeta(photos: PickedPhoto[], names: string[]) {
  return photos.map((p, i) => ({ name: names[i], alt: p.alt.trim(), by: p.by.trim(), caption: p.caption.trim() || undefined, portrait: p.height > p.width }));
}

function checkPhotos(photos: PickedPhoto[]) {
  if (!photos.length) throw new Error('写真を1枚以上選んでください');
  photos.forEach((p, i) => {
    if (!p.alt.trim()) throw new Error(`${i + 1}枚目の「説明」を入れてください`);
    if (!p.by.trim()) throw new Error(`${i + 1}枚目の「撮影者」を入れてください`);
  });
}

function result(el: HTMLElement, pre: HTMLElement, r: { demo?: boolean; markdown?: string; path?: string; commit?: string; page?: string }) {
  if (r.demo) {
    el.innerHTML = 'デモなので公開はしていません。本番ではこの内容がサイトに載ります：';
    pre.hidden = false;
    pre.textContent = `# ${r.path}\n\n${r.markdown}`;
  } else {
    pre.hidden = true;
    el.innerHTML = `公開しました。1〜2分でサイトに反映されます。<a href="${esc(r.page ?? '/')}" target="_blank" rel="noopener">ページを開く</a> · <a href="${esc(r.commit ?? '#')}" target="_blank" rel="noopener">変更履歴</a>`;
  }
}

export function startAdmin(root: HTMLElement) {
  const trips = JSON.parse(root.dataset.trips ?? '[]') as TripRef[];
  const months = JSON.parse(root.dataset.months ?? '[]') as MonthData[];
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const views = { login: $('[data-view=login]'), app: $('[data-view=app]') };
  const modeNote = $('[data-mode]');

  const show = (s: Session) => {
    views.login.hidden = s.signedIn;
    views.app.hidden = !s.signedIn;
    $('[data-demo-hint]').hidden = !s.demo;
    modeNote.hidden = false;
    modeNote.classList.toggle('live', s.canPublish);
    modeNote.innerHTML = s.canPublish
      ? '本番モード：公開するとサイトに載ります。'
      : s.demo
        ? 'デモモード：試せますが、サイトには公開されません。本番にするには Vercel の環境変数に <code>ADMIN_PASSWORD</code> と <code>GITHUB_TOKEN</code> を設定してください。'
        : 'パスワードは設定済みですが <code>GITHUB_TOKEN</code> がないため、公開はできません（内容の確認だけできます）。';
  };

  call<Session>('/api/admin/session').then(show, () => {
    modeNote.hidden = false;
    modeNote.textContent = '管理用のサーバーにつながりません。Vercel に公開されたサイトで開いてください。';
  });

  /* sign in / out */
  $('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const err = $('[data-login-error]');
    err.hidden = true;
    try {
      await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: new FormData(form).get('password') }) });
      form.reset();
      show(await call<Session>('/api/admin/session'));
    } catch (x) {
      err.hidden = false;
      err.textContent = (x as Error).message;
    }
  });
  $('[data-logout]').addEventListener('click', async () => {
    await call('/api/admin/login', { method: 'DELETE' }).catch(() => {});
    show(await call<Session>('/api/admin/session'));
  });

  /* tabs */
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    }),
  );

  /* new trip */
  const newForm = $<HTMLFormElement>('[data-panel=new]');
  const newPhotos = photoPicker($('[data-photos=new]'));
  const newStatus = $('[data-status=new]');
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(newForm);
    const status = (s: string) => (newStatus.textContent = s);
    try {
      checkPhotos(newPhotos.photos);
      const slug = String(f.get('slug'));
      if (trips.some((t) => t.slug === slug)) throw new Error('その URL 用の名前はもう使われています');
      const names = newPhotos.photos.map((_, i) => `${String(i + 1).padStart(2, '0')}.jpg`);
      const blobs = await upload(newPhotos.photos, names, status);
      status('公開しています…');
      const r = await call<{ demo?: boolean; markdown?: string; path?: string; commit?: string; page?: string }>('/api/admin/trip', {
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
            photos: photoMeta(newPhotos.photos, names),
          },
        }),
      });
      result(newStatus, $('[data-preview=new]'), r);
      if (!r.demo) {
        newForm.reset();
        newPhotos.clear();
      }
    } catch (x) {
      status(`⚠ ${(x as Error).message}`);
    }
  });

  /* add photos to a trip */
  const select = $<HTMLSelectElement>('[data-trip-select]');
  select.innerHTML = trips.map((t) => `<option value="${esc(t.slug)}">${esc(t.date)} ${esc(t.title)}（${t.photos}枚${t.sample ? '・サンプル' : ''}）</option>`).join('');
  const addForm = $<HTMLFormElement>('[data-panel=add]');
  const addPhotos = photoPicker($('[data-photos=add]'));
  const addStatus = $('[data-status=add]');
  const spotSelect = $<HTMLSelectElement>('[data-trip-spot]');
  const syncSpot = () => { spotSelect.value = trips.find((t) => t.slug === select.value)?.spot ?? ''; };
  select.addEventListener('change', syncSpot);
  syncSpot();
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = (s: string) => (addStatus.textContent = s);
    try {
      const slug = select.value;
      if (addPhotos.photos.length) checkPhotos(addPhotos.photos);
      else if (spotSelect.value === (trips.find((t) => t.slug === slug)?.spot ?? '')) throw new Error('写真を追加するか場所のピンを変更してください');
      const stamp = Date.now().toString(36);
      const names = addPhotos.photos.map((_, i) => `p${stamp}-${String(i + 1).padStart(2, '0')}.jpg`);
      const blobs = await upload(addPhotos.photos, names, status);
      status('公開しています…');
      const r = await call<{ demo?: boolean; markdown?: string; path?: string; commit?: string; page?: string }>('/api/admin/trip', {
        method: 'POST',
        body: JSON.stringify({ mode: 'append', slug, spot: spotSelect.value, blobs, photos: photoMeta(addPhotos.photos, names) }),
      });
      result(addStatus, $('[data-preview=add]'), r);
      if (!r.demo) {
        addPhotos.clear();
        const ref = trips.find((t) => t.slug === slug);
        if (ref) ref.spot = spotSelect.value;
      }
    } catch (x) {
      status(`⚠ ${(x as Error).message}`);
    }
  });

  /* schedule */
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
      <input class="note" data-k="link" value="${esc(ev.link ?? '')}" placeholder="リンク（任意：/trips/... や https://...）" aria-label="リンク" />`;
    row.querySelector('button')!.addEventListener('click', () => row.remove());
    evList.appendChild(row);
  };
  const loadMonth = () => {
    offList.innerHTML = '';
    evList.innerHTML = '';
    const m = months.find((x) => x.month === monthInput.value);
    weekly.checked = m ? m.weeklyMeeting : true;
    notes.value = m?.notes ?? '';
    (m?.noMeeting ?? []).forEach((d) => addOff(d));
    (m?.events ?? []).forEach((ev) => addEvent(ev));
    if (!m) addEvent({ date: `${monthInput.value}-01` });
    sStatus.textContent = m ? 'この月の予定を読み込みました。' : '新しい月です。';
  };
  const now = new Date(Date.now() + 9 * 3600_000);
  monthInput.value = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  monthInput.addEventListener('change', loadMonth);
  loadMonth();
  $('[data-add-off]').addEventListener('click', () => addOff(nextFriday()));
  $('[data-add-event]').addEventListener('click', () => addEvent({ date: `${monthInput.value}-01` }));
  sForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const events = Array.from(evList.querySelectorAll<HTMLElement>('.event-row'))
        .map((row) => {
          const ev: Record<string, string> = {};
          row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => (ev[el.dataset.k!] = el.value.trim()));
          return ev;
        })
        .filter((ev) => ev.title);
      const noMeeting = Array.from(offList.querySelectorAll<HTMLInputElement>('input')).map((i) => i.value).filter(Boolean);
      sStatus.textContent = '公開しています…';
      const r = await call<{ demo?: boolean; markdown?: string; path?: string; commit?: string; page?: string }>('/api/admin/schedule', {
        method: 'POST',
        body: JSON.stringify({ month: monthInput.value, weeklyMeeting: weekly.checked, noMeeting, events, notes: notes.value }),
      });
      result(sStatus, $('[data-preview=schedule]'), r);
    } catch (x) {
      sStatus.textContent = `⚠ ${(x as Error).message}`;
    }
  });
}
