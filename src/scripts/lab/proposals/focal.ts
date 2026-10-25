import * as THREE from 'three';
import { World } from '../world';
import { Rig, dragLook } from '../rig';
import { loadGltf } from '../assets';
import { diagonalDeg, distanceFor, distanceText, vfov } from '../optics';
import { bindLadders, bindSegments, eachProposal, lazyStage, setText, whenReady } from '../ui';
import type { SubjectId } from '../subjects';

const HELPERS = 1;

/** A flat wedge showing the horizontal angle of view, seen from above (layer HELPERS only). */
function viewWedge(color = '#64bec6') {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false }));
  const edge = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
  const g = new THREE.Group();
  g.add(fill, edge);
  g.renderOrder = 10;
  g.traverse((o) => o.layers.set(HELPERS));
  return {
    group: g,
    update(cam: THREE.PerspectiveCamera, length: number) {
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
      const fwd = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const p = cam.position.clone().setY(0.05);
      const a = p.clone().addScaledVector(fwd, length).addScaledVector(right, Math.tan(half) * length);
      const b = p.clone().addScaledVector(fwd, length).addScaledVector(right, -Math.tan(half) * length);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, p.x, p.y, p.z);
      pos.setXYZ(1, a.x, a.y, a.z);
      pos.setXYZ(2, b.x, b.y, b.z);
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    },
  };
}

/** A small marker for the photographer's camera in the top view. */
function cameraMarker() {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: '#efe9df', depthTest: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), m);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.22), new THREE.MeshBasicMaterial({ color: '#64bec6', depthTest: false }));
  lens.position.z = -0.26;
  g.add(body, lens);
  g.renderOrder = 11;
  g.traverse((o) => o.layers.set(HELPERS));
  return g;
}

/** A dark floor with a 1 m grid, drawn only in top views. */
function topFloor() {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1d2329' }));
  floor.position.y = -0.02;
  const grid = new THREE.GridHelper(80, 80, '#3a4650', '#2c353d');
  grid.position.y = -0.01;
  g.add(floor, grid);
  g.traverse((o) => o.layers.set(HELPERS));
  return g;
}

/* 焦点 A: dolly zoom with a live top view */
eachProposal('focal-a', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const readout = root.querySelector('[data-readout]');
  const inset = root.querySelector<HTMLElement>('[data-inset]')!;
  lazyStage(stage, (renderer) => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const world = new World(renderer, { backdrop: 'garden', subject: 'bust', torii: true });
    const rig = new Rig(renderer, world, { mm: 50, N: 5.6, autoExpose: true });
    whenReady(stage, world.ready);
    dragLook(stage, rig);
    const wedge = viewWedge();
    const marker = cameraMarker();
    world.scene.add(wedge.group, marker, topFloor());
    const top = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
    top.layers.enable(HELPERS);
    top.up.set(0, 0, -1);
    bindLadders(root, (_k, v) => rig.set({ mm: v }));
    bindSegments(root, 'subject', (v) => world.setSubject(v as SubjectId));
    let w = 2;
    let h = 2;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        rig.resize(cw, ch, dpr);
      },
      render(t, dt) {
        rig.render(t, dt);
        const s = rig.now;
        const d = rig.subjectDistance();
        setText(readout, `${Math.round(s.mm)}mm ・ 画角 ${diagonalDeg(s.mm).toFixed(s.mm > 100 ? 1 : 0)}° ・ 被写体まで ${distanceText(d)}`);
        // top view in the corner
        const iw = Math.round(Math.min(w * 0.34, 300));
        const ih = Math.round(iw * 1.15);
        const span = 6;
        top.left = -span * 0.5 * (iw / ih);
        top.right = span * 0.5 * (iw / ih);
        top.top = span * 0.62;
        top.bottom = -span * 0.38;
        top.position.set(0, 30, 1.2);
        top.lookAt(0, 0, 1.2);
        top.updateProjectionMatrix();
        marker.position.copy(rig.camera.position).setY(0.1);
        const fwd = rig.camera.getWorldDirection(new THREE.Vector3());
        marker.rotation.y = Math.atan2(-fwd.x, -fwd.z);
        wedge.update(rig.camera, 9);
        inset.style.width = `${iw}px`;
        inset.style.height = `${ih}px`;
        renderer.setViewport(w - iw - 12, 12, iw, ih);
        renderer.setScissor(w - iw - 12, 12, iw, ih);
        renderer.setScissorTest(true);
        renderer.setRenderTarget(null);
        world.skyVisible = false;
        renderer.render(world.scene, top);
        world.skyVisible = true;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
      },
    };
  });
});

/* 焦点 B: stay put and zoom; the frames of longer lenses drawn on the wide view */
eachProposal('focal-b', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-frame]'));
  const readout = root.querySelector('[data-readout]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'mannequin', torii: true });
    const rig = new Rig(renderer, world, { mm: 16, N: 8, mode: 'fixed', distance: 4.2, autoExpose: true });
    whenReady(stage, world.ready);
    dragLook(stage, rig, { x: 0.3, y: 0.1 });
    const choose = (mm: number) => {
      rig.set({ mm });
      frames.forEach((f) => f.setAttribute('aria-pressed', String(Number(f.dataset.frame) === mm)));
    };
    frames.forEach((f) => f.addEventListener('click', () => choose(Number(f.dataset.frame))));
    root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.zoom))));
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const now = rig.now.mm;
        const base = Math.tan(vfov(now) / 2);
        frames.forEach((f) => {
          const mm = Number(f.dataset.frame);
          const k = Math.tan(vfov(mm) / 2) / base;
          f.style.setProperty('--k', String(k));
          f.hidden = k > 1.01;
        });
        setText(readout, `${Math.round(now)}mm ・ 立ち位置はずっと ${distanceText(4.2)}`);
      },
    };
  });
});

/* 焦点 C: four lenses side by side */
eachProposal('focal-c', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-quad]'));
  const lenses = [16, 35, 85, 200];
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'autumn', subject: 'bust' });
    const rigs = lenses.map((mm) => new Rig(renderer, world, { mm, N: 8, autoExpose: true }, { maxCoc: 10, maxSubframes: 1 }));
    whenReady(stage, world.ready);
    const look = { x: 0, y: 0 };
    dragLook(stage, { look } as unknown as Rig, { x: 0.7, y: 0.25 });
    bindSegments(root, 'subject', (v) => world.setSubject(v as SubjectId));
    bindSegments(root, 'bg', (v) => world.setBackdrop(v as never));
    let w = 2;
    let h = 2;
    let narrow = false;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        h = ch;
        narrow = cw < 560;
        rigs.forEach((r) => r.resize(cw / 2, ch / 2, dpr));
      },
      render(t, dt) {
        rigs.forEach((r, i) => {
          r.look.x = look.x + Math.sin(t * 0.3) * 0.15;
          r.look.y = look.y;
          const x = (i % 2) * (w / 2);
          const y = (1 - Math.floor(i / 2)) * (h / 2);
          r.render(t, dt, { x, y, w: w / 2, h: h / 2 });
          setText(labels[i].querySelector('b'), `${lenses[i]}mm`);
          setText(labels[i].querySelector('span'), `${narrow ? '' : '被写体まで '}${distanceText(r.subjectDistance())}`);
        });
      },
    };
  });
});

/* 焦点 D: a diorama seen from above, with the photographer's camera and its cone of view */
eachProposal('focal-d', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const readout = root.querySelector('[data-readout]');
  lazyStage(stage, (renderer) => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const world = new World(renderer, { backdrop: 'studio', subject: 'bust', cyclorama: true });
    const rig = new Rig(renderer, world, { mm: 35, N: 4, mode: 'fixed', distance: 1.6, autoExpose: true });
    whenReady(stage, world.ready);
    // a big version of the classic camera stands where the photographer is
    const body = new THREE.Group();
    loadGltf('Camera_01').then((g) => {
      const m = g.scene.clone(true);
      m.children.slice().forEach((c) => { if (/strap/i.test(c.name)) m.remove(c); });
      const box = new THREE.Box3().setFromObject(m);
      m.scale.setScalar(0.32 / (box.max.x - box.min.x));
      const b2 = new THREE.Box3().setFromObject(m);
      m.position.sub(b2.getCenter(new THREE.Vector3()));
      // the lens points along +z in the model; the rig camera looks along −z
      m.rotation.y = Math.PI;
      m.traverse((o) => o.layers.set(HELPERS));
      body.add(m);
    });
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, -0.5, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#64bec6', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    const coneEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cone.geometry), new THREE.LineBasicMaterial({ color: '#64bec6' }));
    cone.add(coneEdges);
    cone.traverse((o) => o.layers.set(HELPERS));
    world.scene.add(body, cone);
    const overview = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    overview.layers.enable(HELPERS);
    const orbit = { yaw: 0.9, pitch: 0.55 };
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input')) return;
      drag = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
      orbit.pitch = Math.max(0.12, Math.min(1.3, drag.pitch + (e.clientY - drag.y) * 0.004));
    });
    stage.addEventListener('pointerup', () => (drag = null));
    stage.addEventListener('pointercancel', () => (drag = null));
    bindLadders(root, (k, v) => rig.set(k === 'mm' ? { mm: v } : { distance: v }));
    let w = 2;
    return {
      t0: 1,
      resize(cw, ch, dpr) {
        w = cw;
        overview.aspect = cw / ch;
        overview.updateProjectionMatrix();
        rig.resize(Math.min(cw * 0.36, 340), Math.min(cw * 0.36, 340) / 1.5, dpr);
      },
      render(t, dt) {
        rig.update(dt);
        const cam = rig.camera;
        body.position.copy(cam.position);
        body.quaternion.copy(cam.quaternion);
        const len = rig.subjectDistance() + 0.6;
        const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        cone.position.copy(cam.position);
        cone.quaternion.copy(cam.quaternion);
        cone.scale.set(half * len * cam.aspect * Math.SQRT2, half * len * Math.SQRT2, len);
        const target = world.subject?.focus ?? new THREE.Vector3(0, 1.3, 0);
        const r = 4.6;
        overview.position.set(
          target.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * r,
          target.y + Math.sin(orbit.pitch) * r,
          target.z + 0.9 + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * r,
        );
        overview.lookAt(target.x, target.y - 0.3, target.z + 0.9);
        renderer.setRenderTarget(null);
        renderer.render(world.scene, overview);
        const iw = Math.round(Math.min(w * 0.36, 340));
        const ih = Math.round(iw / 1.5);
        rig.pipeline.render(world, cam, rig.shot, t, { x: w - iw - 12, y: 12, w: iw, h: ih });
        setText(readout, `${Math.round(rig.now.mm)}mm ・ 距離 ${distanceText(rig.now.distance)}`);
      },
    };
  });
});

/* 焦点 E: the torii tunnel, and how much the gates bunch up */
eachProposal('focal-e', (root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const ratio = root.querySelector('[data-ratio]');
  const readout = root.querySelector('[data-readout]');
  const bar = root.querySelector<HTMLElement>('[data-ratio-bar]');
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop: 'garden', subject: 'mannequin', torii: true });
    const rig = new Rig(renderer, world, { mm: 24, N: 5.6, autoExpose: true, frame: 1.1 });
    whenReady(stage, world.ready);
    dragLook(stage, rig, { x: 0.25, y: 0.1 });
    const setLadder = bindLadders(root, (_k, v) => rig.set({ mm: v }));
    root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const mm = Number(b.dataset.preset);
        rig.set({ mm });
        setLadder('mm', mm);
      }),
    );
    return {
      t0: 1,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        rig.render(t, dt);
        const d = distanceFor(rig.now.mm, 1.1);
        // first gate is 2.2 m behind the subject, the tenth 8.1 m further
        const near = d + 2.2;
        const far = near + 0.9 * 9;
        const r = far / near;
        setText(ratio, `1 : ${(1 / r).toFixed(2)}`);
        bar?.style.setProperty('--r', String(1 / r));
        setText(readout, `${Math.round(rig.now.mm)}mm ・ 人物まで ${distanceText(d)}`);
      },
    };
  });
});
