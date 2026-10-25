import * as THREE from 'three';
import { World } from '../world';
import { Stacker } from '../pipeline';
import { BACKDROPS, type BackdropId } from '../assets';
import { SUBJECT_NAMES, type SubjectId } from '../subjects';
import { APERTURE_STOPS, FOCAL_LADDER, ISO_LADDER, SHUTTER_FULL, apertureText, depthOfField, distanceText, nearest, shutterText } from '../optics';
import { bindSegments, drawHistogram, format, lazyStage, setText, whenReady } from '../ui';
import { StudioCamera, type Angle, type Hold } from './camera';
import { Lighting, ambientStops, type FlashMode, type LightColor, type LightKind } from './lights';
import { closestFocus, filterById, widest, type FilterId, type LensId } from './gear';
import { coach, type Advice } from './coach';
import { MISSIONS, type Mission, type Setup, type ShotFacts } from './missions';
import { FloorMap } from './map';

/**
 * Wires the studio prototype (StudioLab.astro): the 3D set, the camera, the panels,
 * the floor plan, the coach, the お題 and the contact sheet.
 */

const DIST_LADDER = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40];
const MF_LADDER = [...DIST_LADDER.slice(0, -2), 50, 1000];
const POWER_LADDER = [1 / 128, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
const FEC_LADDER = [-3, -2, -1.3, -1, -0.7, -0.3, 0, 0.3, 0.7, 1, 1.3, 2, 3];
const FRAMES_LADDER = [10, 20, 30, 60, 120, 240];
const PL_LADDER = [0, 15, 30, 45, 60, 75, 90];
const LEVEL_LADDER = [-3, -2, -1, 0, 1, 2, 3, 4];
const ISO_FULL = [...ISO_LADDER, 51200];

const SUBJECT_DIST: Record<SubjectId, number> = { bust: 1.6, mannequin: 3.4, horse: 1.4, stilllife: 1.3, camera: 0.6, chess: 1.2, flower: 0.8, tree: 15 };
const shortName: Partial<Record<SubjectId, string>> = { stilllife: 'ティーセット', flower: 'コスモス', camera: 'カメラ', tree: '木' };

const mfText = (v: number) => (v >= 999 ? '∞' : distanceText(v));
const powerText = (p: number) => (p >= 1 ? '1/1（フル）' : `1/${Math.round(1 / p)}`);

/** A range input that walks a ladder of values that can change (a zoom's range, a lens's widest aperture). */
class Ladder {
  stops: number[] = [];
  readonly wrap: HTMLElement;
  private input: HTMLInputElement;
  private out: HTMLOutputElement | null;

  constructor(root: ParentNode, ctl: string, private fmt: (v: number) => string, onChange: (v: number) => void) {
    this.wrap = root.querySelector<HTMLElement>(`[data-ctl="${ctl}"]`)!;
    this.input = this.wrap.querySelector('input')!;
    this.out = this.wrap.querySelector('output');
    this.input.addEventListener('input', () => {
      this.paint();
      onChange(this.value);
    });
  }

  get value() {
    return this.stops[Number(this.input.value)] ?? this.stops[0];
  }

  setStops(stops: number[], value: number) {
    this.stops = stops;
    this.input.max = String(Math.max(0, stops.length - 1));
    this.input.disabled = stops.length < 2;
    this.set(value);
  }

  set(value: number) {
    const linear = this.stops.some((v) => v <= 0);
    const gap = (a: number, b: number) => (linear ? Math.abs(a - b) : Math.abs(Math.log(a / b)));
    let best = 0;
    this.stops.forEach((v, i) => {
      if (gap(v, value) < gap(this.stops[best], value)) best = i;
    });
    this.input.value = String(best);
    this.paint();
  }

  private paint() {
    if (this.out) this.out.textContent = this.fmt(this.value);
    this.wrap.style.setProperty('--p', String(Number(this.input.value) / Math.max(1, this.stops.length - 1)));
  }
}

interface Photo {
  url: string;
  title: string;
  detail: string;
}

document.querySelectorAll<HTMLElement>('[data-studio-lab]').forEach((root) => {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const stage = $('.lab-stage')!;
  const af = $('[data-af]');
  const info = $('[data-info]');
  const badges = $('[data-badges]');
  const chip = $('[data-chip]');
  const meterEl = $('.sl-meter');
  const hist = $<HTMLCanvasElement>('[data-hist]');
  const adviceEl = $('[data-advice]');
  const sheet = $('[data-sheet]')!;
  const shutter = $<HTMLButtonElement>('[data-shutter]')!;
  const flashFx = $('[data-flash-fx]');
  const progress = $('[data-progress]')!;
  const toast = $('[data-toast]')!;
  const missionBar = $('[data-mission-bar]')!;

  // tabs
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  tabs.forEach((b) =>
    b.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    }),
  );

  // the lightbox
  const photos: Photo[] = [];
  const lb = $<HTMLDialogElement>('[data-lightbox]')!;
  let lbIndex = 0;
  const openPhoto = (i: number) => {
    const p = photos[i];
    if (!p) return;
    lbIndex = i;
    $<HTMLImageElement>('[data-lb-img]')!.src = p.url;
    $<HTMLImageElement>('[data-lb-img]')!.alt = p.title;
    setText($('[data-lb-title]'), p.title);
    setText($('[data-lb-detail]'), p.detail);
    const save = $<HTMLAnchorElement>('[data-lb-save]')!;
    save.href = p.url;
    save.download = `kuas-studio-${photos.length - i}.jpg`;
    if (!lb.open) lb.showModal();
  };
  $('[data-lb-prev]')?.addEventListener('click', () => openPhoto(Math.max(0, lbIndex - 1)));
  $('[data-lb-next]')?.addEventListener('click', () => openPhoto(Math.min(photos.length - 1, lbIndex + 1)));
  $('[data-lb-close]')?.addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => {
    if (e.target === lb) lb.close();
  });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') openPhoto(Math.max(0, lbIndex - 1));
    if (e.key === 'ArrowRight') openPhoto(Math.min(photos.length - 1, lbIndex + 1));
  });
  const addPhoto = (p: Photo, open = false) => {
    photos.unshift(p);
    if (photos.length > 24) photos.pop();
    sheet.querySelectorAll('button').forEach((b) => b.remove());
    photos.forEach((ph, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const img = new Image();
      img.src = ph.url;
      img.alt = ph.title;
      const cap = document.createElement('span');
      cap.textContent = ph.title;
      b.append(img, cap);
      b.addEventListener('click', () => openPhoto(i));
      sheet.append(b);
    });
    if (open) openPhoto(0);
  };

  let toastTimer = 0;
  const showToast = (html: string, ok: boolean) => {
    toast.innerHTML = html;
    toast.hidden = false;
    toast.classList.toggle('ok', ok);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), ok ? 4200 : 5200);
  };

  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', pinwheel: true });
    world.pinwheelVisible = false;
    const cam = new StudioCamera(renderer, world, { lens: 'std', mm: 50, N: 4, t: 1 / 250, iso: 100, hold: 'tripod' });
    const lighting = new Lighting(world);
    const stacker = new Stacker(renderer);
    whenReady(stage, world.ready);
    let place: BackdropId = 'garden';
    let subject: SubjectId = 'bust';
    /** Meter readings left in which to settle the exposure by itself (after a change of scene). */
    let autoExpose = 3;
    cam.place.dist = SUBJECT_DIST.bust;
    cam.snap();

    // ---------- controls ----------
    const s = cam.settings;
    const ladders = {
      mm: new Ladder(root, 'mm', (v) => `${Math.round(v)}mm`, (v) => {
        cam.set({ mm: v });
        clampAperture();
      }),
      N: new Ladder(root, 'N', apertureText, (v) => cam.set({ N: v })),
      t: new Ladder(root, 't', shutterText, (v) => cam.set({ t: v })),
      iso: new Ladder(root, 'iso', (v) => `ISO ${v}`, (v) => cam.set({ iso: v })),
      dist: new Ladder(root, 'dist', distanceText, (v) => (cam.place.dist = v)),
      mf: new Ladder(root, 'mf', mfText, (v) => cam.set({ mf: v })),
      fp: new Ladder(root, 'fp', powerText, (v) => (lighting.state.power = v)),
      fec: new Ladder(root, 'fec', (v) => format('ev', v), (v) => (lighting.state.fec = v)),
      frames: new Ladder(root, 'frames', (v) => `${v}枚`, () => updateDriveInfo()),
      pl: new Ladder(root, 'pl', (v) => `${v}°`, (v) => cam.set({ plAngle: v })),
      level: new Ladder(root, 'level', (v) => `${Math.round(1000 * 2 ** v).toLocaleString()} lx`, (v) => selected !== null && lighting.update(selected, { level: v })),
    };
    ladders.t.setStops([...SHUTTER_FULL], s.t);
    ladders.iso.setStops(ISO_FULL, s.iso);
    ladders.dist.setStops(DIST_LADDER, cam.place.dist);
    ladders.mf.setStops(MF_LADDER, s.mf);
    ladders.fp.setStops(POWER_LADDER, lighting.state.power);
    ladders.fec.setStops(FEC_LADDER, 0);
    ladders.frames.setStops(FRAMES_LADDER, 30);
    ladders.pl.setStops(PL_LADDER, 0);
    ladders.level.setStops(LEVEL_LADDER, 1);

    /** Fit the zoom and aperture sliders to the lens. */
    const fitLens = () => {
      const lens = cam.lens;
      const mms = [lens.min, ...FOCAL_LADDER.filter((v) => v > lens.min * 1.05 && v < lens.max * 0.95), lens.max].filter((v, i, a) => a.indexOf(v) === i);
      const mm = Math.min(lens.max, Math.max(lens.min, s.mm));
      cam.set({ mm: nearest(mms, mm) });
      ladders.mm.setStops(mms, s.mm);
      clampAperture();
    };
    const clampAperture = () => {
      const w = widest(cam.lens, s.mm);
      const Ns = [w, ...APERTURE_STOPS.filter((v) => v > w * 1.05)];
      if (s.N < w) cam.set({ N: w });
      ladders.N.setStops(Ns, s.N);
    };
    const selectLens = bindSegments(root, 'lens', (v) => {
      cam.set({ lens: v as LensId });
      fitLens();
    });
    fitLens();
    const syncAll = () => {
      fitLens();
      ladders.t.set(s.t);
      ladders.iso.set(s.iso);
      ladders.dist.set(cam.place.dist);
      ladders.mf.set(s.mf);
      ladders.pl.set(s.plAngle);
      selectLens(s.lens);
      selectHold(s.hold);
      selectAngle(cam.place.angle);
      selectFmode(s.focusMode);
      selectFilter(s.filter);
      selectFlash(lighting.state.mode);
      ladders.fp.set(lighting.state.power);
      ladders.fec.set(lighting.state.fec);
      setToggle('peaking', s.peaking);
      setToggle('pinwheel', pinwheelOn);
      showFilterNote();
    };

    const selectHold = bindSegments(root, 'hold', (v) => cam.set({ hold: v as Hold }));
    const selectAngle = bindSegments(root, 'angle', (v) => {
      cam.place.angle = v as Angle;
    });
    const selectFmode = bindSegments(root, 'fmode', (v) => {
      cam.set({ focusMode: v as 'af' | 'mf' });
      if (v === 'mf') {
        // start the ring where AF was, and show peaking to help
        cam.set({ mf: cam.focus, peaking: true });
        ladders.mf.set(cam.focus);
        setToggle('peaking', true);
      }
    });
    const showFilterNote = () => {
      const f = filterById(s.filter);
      setText($('[data-filter-note]'), f.note || 'レンズの前に付けるフィルター。ND は光を減らし、C-PL は反射を取って空を濃くし、ソフト・ミスト・クロスは光のにじみ方を変えます。');
      ladders.pl.wrap.hidden = !f.polarizer;
    };
    const selectFilter = bindSegments(root, 'filter', (v) => {
      cam.set({ filter: v as FilterId });
      showFilterNote();
    });
    const selectFlash = bindSegments(root, 'flash', (v) => (lighting.state.mode = v as FlashMode));
    bindSegments(root, 'curtain', (v) => (lighting.state.curtain = v as 'front' | 'rear'));
    let drive: 'single' | 'interval' = 'single';
    let blend: 'lighten' | 'average' = 'lighten';
    bindSegments(root, 'drive', (v) => {
      drive = v as typeof drive;
      updateDriveInfo();
    });
    bindSegments(root, 'blend', (v) => {
      blend = v as typeof blend;
      updateDriveInfo();
    });
    const updateDriveInfo = () => {
      const n = ladders.frames.value;
      const minutes = (n * (s.t + 1)) / 60;
      setText(
        $('[data-drive-info]'),
        drive === 'single'
          ? 'シャッターを押すたびに1枚撮ります。「インターバル撮影」にすると、決めた枚数を続けて撮り、終わったら自動で1枚に重ねます。'
          : `${n}枚 ×（${shutterText(s.t)} ＋ 間隔1秒）＝ 実際なら約 ${minutes < 1 ? Math.round(minutes * 60) + '秒' : Math.round(minutes) + '分'}。${blend === 'lighten' ? '比較明合成：各画素のいちばん明るい値を残すので、星は線（軌跡）に、流れ星は全部写ります。' : '加算平均：全部を平均するので、ノイズが減ってなめらかに。動くものは消えたり薄くなったりします。'}`,
      );
    };
    updateDriveInfo();

    const toggles = new Map<string, HTMLButtonElement>();
    root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => toggles.set(b.dataset.toggle!, b));
    const setToggle = (k: string, v: boolean) => toggles.get(k)?.setAttribute('aria-pressed', String(v));
    let pinwheelOn = false;
    toggles.get('peaking')?.addEventListener('click', () => {
      cam.set({ peaking: !s.peaking });
      setToggle('peaking', s.peaking);
    });
    toggles.get('pinwheel')?.addEventListener('click', () => {
      pinwheelOn = !pinwheelOn;
      world.pinwheelVisible = pinwheelOn;
      setToggle('pinwheel', pinwheelOn);
    });
    $('[data-recenter]')?.addEventListener('click', () => {
      cam.look.x = cam.look.y = 0;
      cam.afPoint = null;
    });

    // ---------- lights on the floor plan ----------
    let selected: number | null = null;
    const lightPanel = $('[data-light-panel]')!;
    const selectKind = bindSegments(root, 'lkind', (v) => selected !== null && lighting.update(selected, { kind: v as LightKind }));
    const selectColor = bindSegments(root, 'lcolor', (v) => selected !== null && lighting.update(selected, { color: v as LightColor }));
    const selectLight = (id: number | null) => {
      selected = id;
      const spec = lighting.lights.find((l) => l.id === id);
      lightPanel.hidden = !spec;
      if (spec) {
        selectKind(spec.kind);
        selectColor(spec.color);
        ladders.level.set(spec.level);
      }
    };
    const addLight = (x?: number, z?: number) => {
      const a = cam.aim;
      const ang = cam.place.yaw + (lighting.lights.length % 2 ? -0.9 : 0.9);
      const spec = lighting.add({ x: x ?? a.x + Math.sin(ang) * 1.5, z: z ?? a.z + Math.cos(ang) * 1.5 });
      if (spec) selectLight(spec.id);
      return spec;
    };
    $('[data-add-light]')?.addEventListener('click', () => {
      if (!addLight()) showToast('ライトは3灯までです。', false);
    });
    $('[data-remove-light]')?.addEventListener('click', () => {
      if (selected !== null) lighting.remove(selected);
      selectLight(lighting.lights[0]?.id ?? null);
    });
    const map = new FloorMap($<HTMLCanvasElement>('[data-map]')!, {
      camera: (x, z) => {
        cam.standAt(x, z);
        ladders.dist.set(cam.place.dist);
      },
      light: (id, x, z) => lighting.update(id, { x, z }),
      select: selectLight,
    });

    // ---------- places and subjects ----------
    const selectPlace = bindSegments(root, 'place', (v) => void setPlace(v as BackdropId));
    const selectSubject = bindSegments(root, 'subject', (v) => void setSubject(v as SubjectId));
    async function setSubject(id: SubjectId, move = true) {
      subject = id;
      selectSubject(id);
      await world.setSubject(id);
      cam.afPoint = null;
      cam.look.x = cam.look.y = 0;
      if (move) {
        cam.place.dist = SUBJECT_DIST[id];
        ladders.dist.set(cam.place.dist);
      }
    }
    async function setPlace(id: BackdropId, auto = true) {
      place = id;
      selectPlace(id);
      // a cosmos belongs in the flower field, a lone tree under the stars
      if (id === 'flowers' && subject !== 'flower') await setSubject('flower');
      else if (id === 'stars' && subject !== 'tree') await setSubject('tree');
      await world.setBackdrop(id);
      if (!auto) return;
      if (id === 'stars') {
        const mm = cam.lens.min <= 24 ? cam.lens.min : s.mm;
        cam.set({ mm, N: widest(cam.lens, mm), t: 20, iso: 3200, hold: 'tripod', focusMode: 'mf', mf: 1000 });
        cam.place.yaw = Math.PI;
        cam.look.y = 0.3;
      } else {
        if (s.focusMode === 'mf' && s.mf >= 999) cam.set({ focusMode: 'af' });
        if (id === 'lightroom' && !lighting.lights.length) addLight();
        // like a camera in aperture priority: start near a correct exposure
        const ev = BACKDROPS[id].ev - filterById(s.filter).stops + (id === 'lightroom' ? 4 : 0);
        cam.set({ iso: id === 'lightroom' ? 400 : ev < 9 ? 1600 : 100 });
        const evIso = ev + Math.log2(s.iso / 100);
        cam.set({ t: nearest([...SHUTTER_FULL], (s.N * s.N) / 2 ** evIso) });
        autoExpose = 3;
      }
      syncAll();
    }

    // ---------- お題 ----------
    let mission: Mission | null = null;
    const cleared = new Set<string>();
    try {
      JSON.parse(localStorage.getItem('kuas-studio-missions') ?? '[]').forEach((id: string) => cleared.add(id));
    } catch {
      /* private mode */
    }
    const paintMissions = () => {
      root.querySelectorAll<HTMLElement>('[data-mission]').forEach((li) => {
        const id = li.dataset.mission!;
        setText(li.querySelector('[data-mstate]'), cleared.has(id) ? '✓ クリア' : '');
        li.toggleAttribute('data-active', mission?.id === id);
      });
    };
    paintMissions();
    const applySetup = async (st: Setup) => {
      lighting.clear();
      selectLight(null);
      lighting.state = { mode: 'off', power: 1 / 4, fec: 0, curtain: 'front', ...st.flash };
      cam.set({ focusMode: 'af', mf: 3, filter: 'none', plAngle: 0, peaking: false, ...st.settings });
      if (st.subject !== subject) await setSubject(st.subject, false);
      await setPlace(st.place, false);
      cam.place.dist = st.dist;
      cam.place.angle = st.angle ?? 'level';
      cam.place.yaw = st.yaw ?? 0;
      cam.look.x = st.look?.x ?? 0;
      cam.look.y = st.look?.y ?? 0;
      cam.afPoint = null;
      pinwheelOn = !!st.pinwheel;
      world.pinwheelVisible = pinwheelOn;
      for (const l of st.lights ?? []) addLight(l.x, l.z);
      for (const [i, l] of (st.lights ?? []).entries()) {
        const id = lighting.lights[i]?.id;
        if (id !== undefined) lighting.update(id, l);
      }
      cam.snap();
      syncAll();
      setToggle('pinwheel', pinwheelOn);
    };
    root.querySelectorAll<HTMLButtonElement>('[data-start-mission]').forEach((b) =>
      b.addEventListener('click', async () => {
        const m = MISSIONS.find((x) => x.id === b.dataset.startMission)!;
        mission = m;
        paintMissions();
        missionBar.hidden = false;
        missionBar.innerHTML = `<b>お題：${m.title}</b><br>${m.goal}`;
        await applySetup(m.setup);
        stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast(`<b>お題：${m.title}</b><br>${m.goal}`, false);
      }),
    );
    const judge = (f: ShotFacts) => {
      if (!mission) return;
      const missing = mission.check(f);
      if (!missing.length) {
        cleared.add(mission.id);
        try {
          localStorage.setItem('kuas-studio-missions', JSON.stringify([...cleared]));
        } catch {
          /* private mode */
        }
        showToast(`🎉 クリア！「${mission.title}」`, true);
        mission = null;
        missionBar.hidden = true;
        paintMissions();
      } else showToast(`あと少し：${missing.join('・')}`, false);
    };

    // ---------- looking, tapping to focus ----------
    let down: { x: number; y: number; lx: number; ly: number } | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input')) return;
      down = { x: e.clientX, y: e.clientY, lx: cam.look.x, ly: cam.look.y };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!down) return;
      const r = stage.getBoundingClientRect();
      const k = Math.min(1, 40 / s.mm);
      cam.look.x = Math.max(-1.2, Math.min(1.2, down.lx - ((e.clientX - down.x) / r.width) * 1.6 * k));
      cam.look.y = Math.max(-0.5, Math.min(0.7, down.ly + ((e.clientY - down.y) / r.height) * 1.0 * k));
    });
    stage.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
      down = null;
      if (moved || s.focusMode === 'mf') return;
      const r = stage.getBoundingClientRect();
      cam.afPoint = { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
    });

    // ---------- shooting ----------
    let take = false;
    let run: { total: number; done: number; mode: 'lighten' | 'average'; now: number; meteors: number; target: THREE.WebGLRenderTarget } | null = null;
    let stageTime = 0;
    shutter.addEventListener('click', () => {
      if (run) {
        run.total = run.done;
        return;
      }
      if (drive === 'interval') {
        const { w, h } = cam.pipeline.size;
        run = { total: ladders.frames.value, done: 0, mode: blend, now: stageTime, meteors: 0, target: stacker.begin(w, h, blend) };
        shutter.setAttribute('data-busy', '');
        progress.hidden = false;
      } else take = true;
    });

    const meteorsInFrame = () => {
      const stars = world.stars;
      if (!stars?.group.visible) return 0;
      let n = 0;
      for (const m of stars.meteors) {
        const mid = m.a.clone().add(m.b).normalize().multiplyScalar(100).add(cam.camera.position).project(cam.camera);
        if (mid.z < 1 && Math.abs(mid.x) < 1 && Math.abs(mid.y) < 1) n++;
      }
      return n;
    };
    const facts = (stack: ShotFacts['stack'], meteors: number): ShotFacts => {
      const sh = cam.shot;
      const d = cam.subjectDistance();
      const dof = depthOfField(sh.mm, sh.N, cam.focus);
      const fl = cam.pipeline.lastFlare;
      return {
        place,
        subject,
        mm: sh.mm,
        N: sh.N,
        t: s.t,
        iso: s.iso,
        tripod: s.hold === 'tripod',
        filterStops: filterById(s.filter).stops,
        focus: cam.focus,
        distance: cam.distanceToSubject(),
        subjectSharp: !cam.tooClose && d >= dof.near * 0.98 && d <= dof.far * 1.02,
        meter: meter.stops,
        clipped: meter.clipped,
        stack,
        meteors,
        sunInFrame: !!fl && fl.x > 0 && fl.x < 1 && fl.y > 0 && fl.y < 1,
        lights: lighting.lights.length,
        flashOn: lighting.state.mode !== 'off',
        flashShort: lighting.result.short,
        pinwheel: pinwheelOn,
      };
    };
    const caption = () => {
      const sh = cam.shot;
      return `${Math.round(sh.mm)}mm ${shutterText(s.t)} ${apertureText(sh.N)} ISO${s.iso}`;
    };
    const detail = (extra = '') => {
      const parts = [
        BACKDROPS[place].name,
        SUBJECT_NAMES[subject],
        cam.lens.name,
        s.hold === 'tripod' ? '三脚' : s.hold === 'hand' ? '手持ち' : '手持ち＋手ぶれ補正',
        `ピント ${mfText(cam.focus)}`,
        s.filter !== 'none' ? `フィルター：${filterById(s.filter).name}` : '',
        lighting.state.mode !== 'off' ? `フラッシュ：${lighting.state.mode === 'ttl' ? 'TTL' : 'マニュアル'} ${powerText(lighting.result.power)}` : '',
        lighting.lights.length ? `ライト ${lighting.lights.length}灯` : '',
        extra,
      ];
      return parts.filter(Boolean).join(' ・ ');
    };
    const flashScreen = () => {
      flashFx?.classList.remove('on');
      void flashFx?.offsetWidth;
      flashFx?.classList.add('on');
    };

    // ---------- live readouts ----------
    let meter = { stops: 0, clipped: 0, crushed: 0 };
    let frame = 0;
    let lastAdvice = '';
    const subjectName = () => shortName[subject] ?? SUBJECT_NAMES[subject];
    const paintAdvice = () => {
      const sh = cam.shot;
      const list: Advice[] = coach({
        s,
        mm: sh.mm,
        N: sh.N,
        lens: cam.lens,
        filter: filterById(s.filter),
        place,
        meter,
        focus: cam.focus,
        tooClose: cam.tooClose,
        subjectDistance: cam.subjectDistance(),
        subjectName: subjectName(),
        flash: lighting.state,
        flashResult: lighting.result,
        flare: cam.pipeline.lastFlare?.amount ?? 0,
        moving: world.moving,
        pinwheel: pinwheelOn,
      });
      const key = list.map((a) => a.title + a.body).join('|');
      if (key !== lastAdvice && adviceEl) {
        lastAdvice = key;
        adviceEl.innerHTML = list
          .slice(0, 5)
          .map((a) => `<li class="${a.level}"><small>${a.topic}</small><b>${a.title}</b>${a.body}</li>`)
          .join('');
      }
      const top = list[0];
      if (chip) {
        const show = top && (top.level === 'bad' || top.level === 'warn');
        setText(chip, show ? top.title : '');
        chip.dataset.level = show ? top.level : '';
      }
    };
    const paintInfo = () => {
      const sh = cam.shot;
      setText(info, `${Math.round(sh.mm)}mm  ${shutterText(s.t)}  ${apertureText(sh.N)}  ISO ${s.iso}`);
      const b = [cam.lens.short];
      if (s.filter !== 'none') b.push(filterById(s.filter).name);
      if (lighting.state.mode !== 'off') b.push(`⚡${lighting.state.mode === 'ttl' ? 'TTL' : powerText(lighting.state.power)}`);
      b.push(s.focusMode === 'mf' ? 'MF' : 'AF');
      b.push(s.hold === 'tripod' ? '三脚' : '手持ち');
      setText(badges, b.join(' · '));
      const dof = depthOfField(sh.mm, sh.N, cam.focus);
      const closest = closestFocus(cam.lens, sh.mm);
      setText(
        $('[data-focus-info]'),
        `ピント位置 ${mfText(cam.focus)}・くっきり写る範囲 ${distanceText(dof.near)}〜${dof.far === Infinity ? '∞' : distanceText(dof.far)}・このレンズの最短撮影距離 ${distanceText(closest)}${cam.tooClose ? '（近すぎて合いません）' : ''}`,
      );
      if (lighting.state.mode !== 'off') {
        const r = lighting.result;
        setText(
          $('[data-flash-info]'),
          lighting.state.mode === 'ttl'
            ? `TTL：発光量 ${powerText(r.power)}${r.short ? '（フル発光でも足りません）' : ''}。フル発光で届くのは約 ${distanceText(r.reach)}。`
            : `マニュアル ${powerText(lighting.state.power)}：ちょうどよく写る距離は約 ${distanceText(r.reach * Math.sqrt(lighting.state.power))}（ガイドナンバー 36 ÷ F値 × √発光量）。`,
        );
      }
    };
    const paintMeter = () => {
      meterEl?.style.setProperty('--stops', String(Math.max(-3.2, Math.min(3.2, meter.stops))));
      meterEl?.classList.toggle('off', Math.abs(meter.stops) >= 0.34);
    };
    /** Where the AF frame is on the picture (0..1, y down). */
    const afUv = () => {
      if (cam.afPoint) return cam.afPoint;
      if (!world.subject) return { u: 0.5, v: 0.5 };
      const p = world.subject.focus.clone().project(cam.camera);
      return { u: Math.max(0, Math.min(1, p.x * 0.5 + 0.5)), v: Math.max(0, Math.min(1, 0.5 - p.y * 0.5)) };
    };
    const paintAf = () => {
      if (!af) return;
      af.style.display = s.focusMode === 'mf' ? 'none' : '';
      const { u, v } = afUv();
      af.style.left = `${Math.max(3, Math.min(97, u * 100))}%`;
      af.style.top = `${Math.max(4, Math.min(96, v * 100))}%`;
    };
    const paintMap = () => {
      const c = cam.camera;
      const fwd = c.getWorldDirection(new THREE.Vector3());
      const vf = THREE.MathUtils.degToRad(c.fov);
      const src = world.flareSource;
      map.draw({
        aim: { x: cam.aim.x, z: cam.aim.z },
        subject: subjectName(),
        camera: { x: c.position.x, z: c.position.z, heading: Math.atan2(fwd.x, fwd.z), hfov: 2 * Math.atan(Math.tan(vf / 2) * c.aspect) },
        lights: lighting.lights,
        selected,
        sun: src && src.dir.y > -0.05 && place !== 'lightroom' ? { x: src.dir.x, z: src.dir.z } : null,
        north: place === 'stars',
        dots: place === 'flowers' ? world.flowers?.dots ?? null : null,
      });
    };

    const prepare = () => {
      // the flash and lamps are set for the picture about to be taken
      const sh = cam.shot;
      const subj = world.subject?.focus ?? cam.aim;
      lighting.apply(cam.camera, subj, cam.distanceToSubject(), { N: sh.N, t: s.t, iso: s.iso }, ambientStops(world, { N: sh.N, t: s.t, iso: s.iso }) - filterById(s.filter).stops);
      const fwd = cam.camera.getWorldDirection(new THREE.Vector3());
      world.snowCenter.copy(cam.camera.position).addScaledVector(fwd, 2.2);
      world.snowFacing.copy(cam.camera.quaternion);
    };

    // a handle for checking the prototype from the console (?debug)
    if (location.search.includes('debug')) Object.assign(window, { studio: { cam, world, lighting, setPlace, setSubject, applySetup, meter: () => meter, missions: MISSIONS } });

    return {
      t0: 1,
      resize: (w, h, dpr) => cam.resize(w, h, dpr),
      render(t, dt) {
        stageTime = t;
        frame++;
        if (run) {
          // interval shooting: render as many frames as fit in this animation frame, then show the stack
          const started = performance.now();
          const step = s.t + 1;
          do {
            const k = run.done;
            prepare();
            cam.render(run.now + k * step, run.target);
            run.meteors += meteorsInFrame();
            stacker.add();
            run.done++;
          } while (run.done < run.total && performance.now() - started < 24);
          stacker.show();
          const mins = Math.round((run.done * step) / 60);
          setText($('[data-progress-text]'), `インターバル撮影中 ${run.done} / ${run.total} 枚（実際なら ${mins} 分経過）`);
          $('[data-progress-fill]')!.style.width = `${(run.done / Math.max(1, run.total)) * 100}%`;
          if (run.done >= run.total) {
            const r = run;
            run = null;
            shutter.removeAttribute('data-busy');
            progress.hidden = true;
            if (r.done > 0) {
              const url = stacker.toDataURL();
              if (world.stars) world.stars.epoch += r.done * step;
              const what = r.mode === 'lighten' ? '比較明合成' : '加算平均';
              addPhoto({ url, title: `${what} ${r.done}枚 ・ ${caption()}`, detail: detail(`実際の撮影時間 約${mins}分${r.meteors ? `・流れ星 ${r.meteors}個` : ''}`) }, true);
              judge(facts({ count: r.done, mode: r.mode }, r.meteors));
            }
          }
          return;
        }

        cam.update(dt);
        prepare();
        if (take && world.stars?.group.visible) {
          // a new stretch of night for every exposure, so meteors are luck, not timing
          world.stars.epoch += s.t + 1;
        }
        cam.render(t);
        if (take) {
          take = false;
          const meteors = meteorsInFrame();
          const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
          addPhoto({ url, title: caption(), detail: detail(meteors ? `流れ星 ${meteors}個` : '') });
          flashScreen();
          judge(facts(null, meteors));
        }
        if (frame % 6 === 0) {
          const m = cam.pipeline.meter(afUv());
          // a meter reads the night sky as far too dark; judge it against the sky's own brightness instead
          if (place === 'stars') m.stops = cam.pipeline.lastStops;
          const k = autoExpose || Math.abs(m.stops - meter.stops) > 2 ? 1 : 0.5;
          meter = { stops: meter.stops + (m.stops - meter.stops) * k, clipped: m.clipped, crushed: m.crushed };
          paintMeter();
          if (autoExpose > 0) {
            // after a change of scene the camera finds a good shutter speed by itself, as in aperture priority
            autoExpose--;
            const t2 = nearest([...SHUTTER_FULL], s.t / 2 ** meter.stops);
            if (t2 !== s.t) {
              cam.set({ t: t2 });
              ladders.t.set(t2);
              updateDriveInfo();
            }
          }
        }
        if (hist && frame % 12 === 3) drawHistogram(hist, cam.pipeline.histogram(48));
        if (frame % 10 === 1) {
          paintAdvice();
          paintInfo();
        }
        paintAf();
        if (frame % 2 === 0) paintMap();
      },
    };
  });
});

