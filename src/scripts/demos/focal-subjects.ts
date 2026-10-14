import * as THREE from 'three';

/** A small sculpted photographer based on the owner's KPC logo (2026-10-14). */
export function buildPhotographer() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: '#f2f6f3', roughness: .85 });
  const skin = new THREE.MeshStandardMaterial({ color: '#f0dfcc', roughness: .8 });
  const hair = new THREE.MeshStandardMaterial({ color: '#203f47', roughness: .68 });
  const glint = new THREE.MeshStandardMaterial({ color: '#376b76', roughness: .72 });
  const camera = new THREE.MeshStandardMaterial({ color: '#243b40', roughness: .5, metalness: .25 });
  const silver = new THREE.MeshStandardMaterial({ color: '#e1e9e6', roughness: .4, metalness: .55 });
  const glass = new THREE.MeshStandardMaterial({ color: '#123b46', roughness: .15, metalness: .45 });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const sphere = (r: number) => new THREE.SphereGeometry(r, 24, 16);
  const limb = (a: number[], b: number[], radius: number, mat: THREE.Material) => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const d = end.clone().sub(start);
    const m = mesh(new THREE.CylinderGeometry(radius, radius * 1.12, d.length(), 12), mat, 0, 0, 0);
    m.position.copy(start).add(end).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  mesh(new THREE.CylinderGeometry(.095, .13, .24, 16), shirt, 0, -.16, -.005);
  mesh(new THREE.CylinderGeometry(.035, .04, .055, 16), skin, 0, -.025, .005);
  mesh(sphere(.091), skin, 0, .074, .012).scale.set(.9, 1.1, .88);
  mesh(new THREE.SphereGeometry(.102, 28, 16, 0, Math.PI * 2, 0, Math.PI * .56), hair, 0, .076, .005).scale.set(1.04, 1, 1);
  // Tapered overlapping locks keep the logo's tousled silhouette in three dimensions.
  for (let i = 0; i < 18; i++) {
    const a = i * Math.PI * 2 / 18;
    const lock = mesh(new THREE.ConeGeometry(.022, .078, 7), i % 5 === 0 ? glint : hair,
      Math.sin(a) * .078, .09 + (i % 3) * .012, Math.cos(a) * .076 + .012);
    lock.rotation.z = Math.PI + Math.sin(a) * .65;
    lock.rotation.x = Math.cos(a) * .35;
    lock.scale.z = .55;
  }
  for (const side of [-1, 1]) {
    mesh(sphere(.018), skin, side * .082, .065, .005).scale.set(.65, 1, .7);
    limb([side * .092, -.055, 0], [side * .145, -.15, .05], .037, shirt);
    limb([side * .145, -.15, .05], [side * .09, .028, .155], .027, shirt);
    mesh(sphere(.03), skin, side * .088, .047, .163).scale.set(.65, 1.25, .8);
    mesh(new THREE.BoxGeometry(.018, .2, .007), hair, side * .078, -.16, .078).rotation.z = side * .12;
    const collar = mesh(new THREE.BoxGeometry(.052, .068, .009), shirt, side * .027, -.061, .083);
    collar.rotation.z = side * .45;
  }
  for (let i = 0; i < 3; i++) mesh(sphere(.004), silver, 0, -.12 - i * .047, .091);
  mesh(new THREE.BoxGeometry(.18, .10, .061), camera, 0, .043, .123);
  mesh(new THREE.BoxGeometry(.185, .018, .063), silver, 0, .089, .123);
  mesh(new THREE.BoxGeometry(.063, .042, .048), silver, 0, .112, .121);
  mesh(new THREE.CylinderGeometry(.043, .046, .072, 40), camera, 0, .044, .186).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(.037, .003, 8, 40), silver, 0, .044, .224);
  mesh(new THREE.CircleGeometry(.034, 40), glass, 0, .044, .225);
  mesh(new THREE.TorusGeometry(.025, .0015, 8, 32), glint, 0, .044, .226);
  mesh(sphere(.006), silver, -.068, .105, .122);
  return group;
}
