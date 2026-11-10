// The koalas' free creations, drawn from the parts the server keeps for each one: every part is a
// real three.js primitive, sized, placed, coloured and turned as the koala described it. Each
// creation stands on the open meadow around the island, at the spot the server gave it.

import * as THREE from 'three';

const MEADOW_Y = -0.95; // the meadow's height outside the island (see scene.js)
const SHARED = new Map(); // shape -> one geometry, reused by every part of that shape

function geometryFor(shape) {
  if (!SHARED.has(shape)) {
    const g = {
      box: () => new THREE.BoxGeometry(1, 1, 1),
      cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
      sphere: () => new THREE.SphereGeometry(0.5, 20, 14),
      cone: () => new THREE.ConeGeometry(0.5, 1, 20),
      torus: () => new THREE.TorusGeometry(0.5, 0.18, 12, 28),
    }[shape];
    SHARED.set(shape, g ? g() : new THREE.BoxGeometry(1, 1, 1));
  }
  return SHARED.get(shape);
}

// One creation as a group: parts placed from the creation's centre, on the ground.
export function buildCreation(c) {
  const group = new THREE.Group();
  group.name = `creation-${c.id}`;
  group.position.set(c.x, MEADOW_Y, c.z);
  for (const p of c.parts) {
    const m = new THREE.Mesh(
      geometryFor(p.shape),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.7, metalness: 0.02 }),
    );
    m.scale.set(p.size[0], p.size[1], p.size[2]);
    m.position.set(p.at[0], p.at[1] + p.size[1] / 2, p.at[2]);
    m.rotation.y = THREE.MathUtils.degToRad(p.rotY);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// Adds each creation the server knows about, once.
export class CreationLayer {
  constructor({ scene }) {
    this.group = new THREE.Group();
    this.group.name = 'creations';
    this.seen = new Set();
    scene.add(this.group);
  }

  sync(list) {
    for (const c of list ?? []) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      this.group.add(buildCreation(c));
    }
  }
}
