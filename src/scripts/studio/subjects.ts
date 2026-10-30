import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture, loadGltf } from './assets';
import { heroFlower } from './flowers';
import type { Text } from './i18n';

export type SubjectId = 'bust' | 'mannequin' | 'horse' | 'stilllife' | 'camera' | 'chess' | 'flower' | 'tree';

export interface Subject {
  id: SubjectId;
  group: THREE.Group;
  /** Where autofocus lands: the eyes, the lens, the cup. */
  focus: THREE.Vector3;
  /** Where the camera points, when it is not the focus point. */
  aim?: THREE.Vector3;
  /** Height (m) that fills the frame by default. */
  frame: number;
  /** Default camera pitch (radians, positive looks down). */
  pitch: number;
}

/** What each subject is called: in full, and short for the picker and the floor plan. */
export const SUBJECT_NAMES: Record<SubjectId, { name: Text; short: Text }> = {
  bust: { name: { ja: '大理石の胸像', en: 'Marble bust' }, short: { ja: '大理石の胸像', en: 'Marble bust' } },
  mannequin: { name: { ja: '等身大のデッサン人形', en: 'Life-size drawing mannequin' }, short: { ja: 'デッサン人形', en: 'Mannequin' } },
  horse: { name: { ja: '白磁の馬', en: 'Porcelain horse' }, short: { ja: '白磁の馬', en: 'Porcelain horse' } },
  stilllife: { name: { ja: 'ティーセットと果物', en: 'Tea set and fruit' }, short: { ja: 'ティーセット', en: 'Tea set' } },
  camera: { name: { ja: 'クラシックカメラ', en: 'Classic camera' }, short: { ja: 'クラシックカメラ', en: 'Classic camera' } },
  chess: { name: { ja: 'チェス盤', en: 'Chess set' }, short: { ja: 'チェス盤', en: 'Chess set' } },
  flower: { name: { ja: 'コスモスの花', en: 'Cosmos flower' }, short: { ja: 'コスモス', en: 'Cosmos' } },
  tree: { name: { ja: '一本の木', en: 'Lone tree' }, short: { ja: '一本の木', en: 'Lone tree' } },
};

const PEDESTAL_TOP = 1.08;

function shadowed<T extends THREE.Object3D>(o: T) {
  o.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return o;
}

/** Scale `obj` to `height` and stand it on `base` (its footprint centred on x/z). */
function standOn(obj: THREE.Object3D, height: number, base: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = height / size.y;
  obj.scale.multiplyScalar(s);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x += base.x - c.x;
  obj.position.z += base.z - c.z;
  obj.position.y += base.y - box.min.y;
  return new THREE.Box3().setFromObject(obj);
}

let plasterTex: THREE.Texture | null = null;
/** A plinth of pale cast stone. */
function pedestal(top = PEDESTAL_TOP, w = 0.36) {
  plasterTex ??= canvasTexture(256, 512, (g) => {
    g.fillStyle = '#d8d2c8';
    g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 2200; i++) {
      const v = 190 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},.35)`;
      g.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  });
  const mat = new THREE.MeshStandardMaterial({ color: '#e9e4dc', map: plasterTex, roughness: 0.82 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, top - 0.08, w, 3, 0.012), mat);
  body.position.y = (top - 0.08) / 2 + 0.04;
  const cap = new THREE.Mesh(new RoundedBoxGeometry(w + 0.06, 0.04, w + 0.06, 3, 0.01), mat);
  cap.position.y = top - 0.02;
  const foot = new THREE.Mesh(new RoundedBoxGeometry(w + 0.08, 0.05, w + 0.08, 3, 0.01), mat);
  foot.position.y = 0.025;
  g.add(body, cap, foot);
  return shadowed(g);
}

let woodTex: THREE.Texture | null = null;
function wood(color = '#c99a66', roughness = 0.5) {
  woodTex ??= canvasTexture(512, 512, (g) => {
    g.fillStyle = '#d0a36e';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * 512;
      g.strokeStyle = `rgba(${110 + Math.random() * 40},${70 + Math.random() * 30},${40},${0.08 + Math.random() * 0.14})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y / 60 + i) * 6, y);
      g.stroke();
    }
  });
  const t = woodTex.clone();
  t.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({ color, map: t, roughness, clearcoat: 0.25, clearcoatRoughness: 0.5 });
}

async function bust(): Promise<Subject> {
  const gltf = await loadGltf('marble_bust_01');
  const g = new THREE.Group();
  const model = gltf.scene.clone(true);
  model.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.envMapIntensity = 1;
      m.material = mat;
    }
  });
  const box = standOn(model, 0.62, new THREE.Vector3(0, PEDESTAL_TOP, 0));
  g.add(shadowed(model), pedestal());
  const h = box.max.y - box.min.y;
  return { id: 'bust', group: g, focus: new THREE.Vector3(0, box.min.y + h * 0.7, box.max.z - 0.07), frame: 0.5, pitch: 0.04 };
}

/** A life-size wooden drawing mannequin, standing relaxed. */
function mannequin(): Subject {
  const g = new THREE.Group();
  const body = wood('#d2a26a', 0.45);
  const joint = wood('#9b6a3c', 0.4);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s: [number, number, number] = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    m.scale.set(...s);
    g.add(m);
    return m;
  };
  const ball = (p: [number, number, number], r: number) => add(new THREE.SphereGeometry(r, 24, 16), joint, p);
  const limb = (a: [number, number, number], b: [number, number, number], r0: number, r1: number) => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    const len = d.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, 20, 6);
    // swell the middle a little so limbs read as carved, not as pipes
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / len + 0.5;
      const k = 1 + Math.sin(y * Math.PI) * 0.18;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const m = add(geo, body, [0, 0, 0]);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  const lathe = (profile: [number, number][], p: [number, number, number], depth: number) => {
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    geo.computeVertexNormals();
    return add(geo, body, p, [1, 1, depth]);
  };
  // torso: ribcage, waist joint, pelvis
  lathe([[0.001, 1.08], [0.11, 1.09], [0.15, 1.18], [0.175, 1.3], [0.17, 1.38], [0.13, 1.44], [0.05, 1.47], [0.001, 1.471]], [0, 0, 0], 0.62);
  ball([0, 1.06, 0], 0.085);
  lathe([[0.001, 0.86], [0.1, 0.865], [0.155, 0.92], [0.16, 0.97], [0.12, 1.03], [0.001, 1.035]], [0, 0, 0], 0.72);
  // neck and head (turned slightly towards the camera's left)
  limb([0, 1.45, 0], [0, 1.55, 0.012], 0.04, 0.036);
  const headGeo = new THREE.LatheGeometry(
    [[0.001, -0.115], [0.035, -0.112], [0.062, -0.09], [0.078, -0.045], [0.088, 0.01], [0.09, 0.05], [0.08, 0.09], [0.055, 0.115], [0.001, 0.125]].map(([r, y]) => new THREE.Vector2(r, y)),
    48,
  );
  headGeo.computeVertexNormals();
  const head = add(headGeo, body, [0, 1.655, 0.018], [1, 1, 1.12]);
  head.rotation.set(-0.06, 0.2, 0.03);
  // arms
  for (const s of [-1, 1] as const) {
    ball([s * 0.205, 1.41, 0], 0.052);
    const elbow: [number, number, number] = [s * 0.25, 1.13, s > 0 ? 0.03 : -0.02];
    const wrist: [number, number, number] = [s * 0.235, 0.88, s > 0 ? 0.1 : 0.03];
    limb([s * 0.205, 1.4, 0], elbow, 0.045, 0.037);
    ball(elbow, 0.036);
    limb(elbow, wrist, 0.035, 0.026);
    ball(wrist, 0.026);
    add(new THREE.SphereGeometry(1, 20, 14), body, [wrist[0] - s * 0.005, wrist[1] - 0.075, wrist[2] + 0.01], [0.03, 0.07, 0.045]).rotation.z = s * 0.1;
    // legs, weight on the right leg
    const hip: [number, number, number] = [s * 0.09, 0.9, 0];
    const knee: [number, number, number] = [s * 0.1 + (s > 0 ? 0 : -0.02), 0.5, s > 0 ? 0.01 : 0.05];
    const ankle: [number, number, number] = [s * 0.11 + (s > 0 ? 0 : -0.04), 0.09, s > 0 ? 0 : 0.02];
    ball(hip, 0.07);
    limb(hip, knee, 0.068, 0.048);
    ball(knee, 0.048);
    limb(knee, ankle, 0.046, 0.032);
    ball(ankle, 0.032);
    const foot = add(new RoundedBoxGeometry(0.09, 0.06, 0.24, 3, 0.025), body, [ankle[0], 0.035, ankle[2] + 0.06]);
    foot.rotation.y = s * 0.12;
  }
  shadowed(g);
  return { id: 'mannequin', group: g, focus: new THREE.Vector3(0.02, 1.66, 0.1), aim: new THREE.Vector3(0, 1.42, 0), frame: 0.95, pitch: 0.02 };
}

async function horse(): Promise<Subject> {
  const gltf = await loadGltf('horse_statue_01');
  const g = new THREE.Group();
  const model = gltf.scene.clone(true);
  model.rotation.y = -0.5;
  const box = standOn(model, 0.4, new THREE.Vector3(0, PEDESTAL_TOP, 0));
  g.add(shadowed(model), pedestal());
  return { id: 'horse', group: g, focus: new THREE.Vector3(0.02, box.max.y - 0.08, 0.04), frame: 0.5, pitch: 0.12 };
}

/** A round walnut side table at the given height. */
function table(top = 0.74, r = 0.46) {
  const g = new THREE.Group();
  const mat = wood('#6b4128', 0.38);
  const board = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 64), mat);
  board.position.y = top - 0.0175;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, top - 0.06, 24), mat);
  leg.position.y = (top - 0.06) / 2 + 0.03;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.03, 48), mat);
  foot.position.y = 0.015;
  g.add(board, leg, foot);
  return shadowed(g);
}

async function stillLife(): Promise<Subject> {
  const [tea, apple, pom] = await Promise.all([loadGltf('tea_set_01'), loadGltf('food_apple_01'), loadGltf('food_pomegranate_01')]);
  const g = new THREE.Group();
  const top = 0.74;
  g.add(table(top));
  const set = tea.scene.clone(true);
  const part = (name: string) => set.getObjectByName(name)!;
  // the scan lays the pieces out on a grid; arrange the teapot behind, a cup on its saucer in the middle
  const place: [string, number, number][] = [
    ['tea_set_01_teapot_01', -0.1, -0.16],
    ['tea_set_01_teapot_01_lid', -0.1, -0.16],
    ['tea_set_01_saucer_circular_03', 0.02, 0.04],
    ['tea_set_01_sugar_cup_01', 0.19, -0.1],
    ['tea_set_01_sugar_cup_01_lid', 0.19, -0.1],
  ];
  const keep = new Set(place.map(([n]) => n).concat('tea_set_01_cup_small_01'));
  set.children.slice().forEach((c) => { if (!keep.has(c.name)) set.remove(c); });
  for (const [name, x, z] of place) part(name).position.set(x, part(name).position.y, z);
  const saucerTop = new THREE.Box3().setFromObject(part('tea_set_01_saucer_circular_03')).max.y;
  part('tea_set_01_cup_small_01').position.set(0.02, saucerTop - 0.004, 0.04);
  set.position.y = top;
  g.add(shadowed(set));
  const a = apple.scene.clone(true);
  standOn(a, 0.075, new THREE.Vector3(0.17, top, 0.2));
  const p = pom.scene.clone(true);
  standOn(p, 0.085, new THREE.Vector3(-0.16, top, 0.12));
  g.add(shadowed(a), shadowed(p));
  return { id: 'stilllife', group: g, focus: new THREE.Vector3(0.02, top + 0.06, 0.04), frame: 0.4, pitch: 0.3 };
}

async function camera(): Promise<Subject> {
  const gltf = await loadGltf('Camera_01');
  const g = new THREE.Group();
  const model = gltf.scene.clone(true);
  model.children.slice().forEach((c) => { if (/strap/i.test(c.name)) model.remove(c); });
  model.rotation.y = -0.6;
  const box = standOn(model, 0.085, new THREE.Vector3(0, PEDESTAL_TOP, 0));
  g.add(shadowed(model), pedestal(PEDESTAL_TOP, 0.3));
  return { id: 'camera', group: g, focus: new THREE.Vector3(0.03, (box.min.y + box.max.y) / 2, box.max.z - 0.01), frame: 0.2, pitch: 0.2 };
}

async function chess(): Promise<Subject> {
  const gltf = await loadGltf('chess_set');
  const g = new THREE.Group();
  const top = 0.74;
  g.add(table(top, 0.5));
  const model = gltf.scene.clone(true);
  model.rotation.y = Math.PI / 2 + 0.25;
  const box = new THREE.Box3().setFromObject(model);
  const s = 0.48 / Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  model.scale.setScalar(s);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, top - box.min.y, -c.z);
  g.add(shadowed(model));
  return { id: 'chess', group: g, focus: new THREE.Vector3(0, top + 0.05, 0.12), frame: 0.34, pitch: 0.32 };
}

/** A lone broad-leaved tree, about 5 m tall: a foreground for the night sky. */
function tree(): Subject {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#2f4a24', roughness: 0.9, flatShading: true });
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const geo = new THREE.CylinderGeometry(r * 0.7, r, len, 7, 1);
    const m = new THREE.Mesh(geo, bark);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(m);
    if (depth === 0) {
      // small clumps of leaves round the tip, loose enough for the sky to show through
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(leafGeo, leaf);
        c.position.copy(to).add(new THREE.Vector3((rnd() - 0.5) * 0.9, (rnd() - 0.3) * 0.6, (rnd() - 0.5) * 0.9));
        c.scale.setScalar(0.12 + rnd() * 0.16).multiply(new THREE.Vector3(1, 0.6, 1));
        c.rotation.set(rnd() * 3, rnd() * 3, 0);
        g.add(c);
      }
      return;
    }
    const kids = depth === 4 ? 4 : 3;
    for (let i = 0; i < kids; i++) {
      const a = (i / kids) * Math.PI * 2 + rnd();
      const d = dir.clone().multiplyScalar(0.55).add(new THREE.Vector3(Math.cos(a), 0.45 + rnd() * 0.3, Math.sin(a)).multiplyScalar(0.7)).normalize();
      branch(to, d, len * (0.6 + rnd() * 0.15), r * 0.6, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 1, 0).normalize(), 1.7, 0.2, 4);
  shadowed(g);
  return { id: 'tree', group: g, focus: new THREE.Vector3(0, 1.6, 0.2), aim: new THREE.Vector3(0, 2.6, 0), frame: 5, pitch: -0.05 };
}

const builders: Record<SubjectId, () => Subject | Promise<Subject>> = { bust, mannequin, horse, stilllife: stillLife, camera, chess, flower: heroFlower, tree };
export const buildSubject = async (id: SubjectId) => builders[id]();
