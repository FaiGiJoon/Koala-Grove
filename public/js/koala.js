// A koala: smooth body parts, each wrapped in shell fur (instanced shells cut by a strand
// texture), with a muzzle and glossy nose, eyes with catch-lights, big fluffy ears, claws and a
// prop each. The parts are modelled in Blender (koala-parts.js); if that file did not load they
// are plain ellipsoids. Posed and walked in code: the scene says where to be and what to do.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { furMaterial } from './gfx/materials.js';
import { koalaPart } from './koala-parts.js';
import { glide } from './view.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const angleTo = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

const CREAM = '#efe7da';
const WALK = 2.1;
const CLIMB = 1.5;
const MAX_SHELLS = 6;

// An ellipsoid with its poles pointing sideways, so the fur texture's seams and pinch points
// end up under the arms and ears instead of on top of the head.
function ellipsoid(r, sx = 1, sy = 1, sz = 1, seg = 28) {
  const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.72));
  g.rotateZ(Math.PI / 2);
  g.scale(sx, sy, sz);
  return g;
}

export class Koala {
  constructor({ id, name, color }, { tex, groundY = () => 0 } = {}) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.seed = id === 'crystal' ? 0.3 : 2.1;
    this.pos = new THREE.Vector3();
    this.goal = { x: 0, y: 0, z: 0 };
    this.path = [];
    this.anim = 'idle';
    this.heading = 0;
    this.speed = 0; // walking speed, eased (glide in view.js)
    this.climbSpeed = 0;
    this.turnV = 0; // turning speed of the heading spring
    this.stride = 0;
    this.face = null;
    this.moving = false;
    this.blink = 2 + Math.random() * 3;
    this.thinking = false;
    this.groundY = groundY;
    this.stepped = false;
    this.lastW = 0;
    this.furMats = [];
    this.furMeshes = [];
    // Both start as babies: the server says how big (0.5 to 1) and the model grows to it.
    this.size = 1;
    this.sizeGoal = 1;
    this.sized = false;

    const root = (this.root = new THREE.Group());
    const rig = (this.rig = new THREE.Group());
    root.add(rig);
    // the server's colour is a cool grey for the name tag; the fur is warmed a little
    const base = new THREE.Color(color).lerp(new THREE.Color('#b9a68e'), 0.3);
    const cream = new THREE.Color(CREAM);

    // The Blender part of that name (origin on the joint it turns about), or the ellipsoid it replaces.
    const part = (name, fallback) => koalaPart(name) ?? fallback();

    // A solid, shadow-casting body part with fur shells over it.
    const fur = (geo, tint, { length = 0.045, density = 1.3, parent = rig, tip = null } = {}) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(tint).multiplyScalar(0.88), roughness: 0.97 }));
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      if (tex) {
        const mat = furMaterial({ color: tint, tip, tex: tex.fur, shells: MAX_SHELLS, length, density });
        const shells = new THREE.InstancedMesh(geo, mat, MAX_SHELLS);
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < MAX_SHELLS; i++) shells.setMatrixAt(i, m4);
        shells.frustumCulled = false;
        shells.receiveShadow = true;
        shells.raycast = () => {};
        grp.add(shells);
        this.furMats.push(mat);
        this.furMeshes.push(shells);
      }
      parent.add(grp);
      return grp;
    };

    this.torso = fur(part('Torso', () => ellipsoid(0.6, 1, 1.12, 0.92)), base, { length: 0.05, density: 0.85 });
    this.torso.position.y = 0.68;
    const belly = fur(part('Belly', () => ellipsoid(0.44, 0.92, 1.05, 0.5)), cream, { length: 0.05, density: 0.75 });
    belly.position.set(0, 0.62, 0.3);

    const head = (this.head = new THREE.Group());
    head.position.set(0, 1.36, 0.08);
    fur(part('Head', () => ellipsoid(0.5, 1.18, 0.96, 0.96, 32)), base, { parent: head, length: 0.048, density: 0.8 });
    const muzzle = fur(part('Muzzle', () => ellipsoid(0.2, 1.25, 0.9, 0.9)), cream, { parent: head, length: 0.03, density: 0.6 });
    muzzle.position.set(0, -0.1, 0.4);
    for (const s of [-1, 1]) {
      const cheek = fur(part(s > 0 ? 'CheekL' : 'CheekR', () => ellipsoid(0.15, 1, 0.9, 0.8)), cream, { parent: head, length: 0.07, density: 0.55 });
      cheek.position.set(s * 0.42, -0.1, 0.24);
      if (!koalaPart('Head')) cheek.rotation.z = s * 0.4;
    }
    this.ears = [-1, 1].map((s) => {
      const ear = new THREE.Group();
      ear.position.set(s * 0.52, 0.28, -0.02);
      const side = s > 0 ? 'L' : 'R';
      fur(part('EarOuter' + side, () => ellipsoid(0.3, 1, 1, 0.42, 22)), base, { parent: ear, length: 0.04, density: 0.5 });
      const inner = fur(part('EarInner' + side, () => ellipsoid(0.2, 1, 1, 0.3, 20)), cream, { parent: ear, length: 0.085, density: 0.4 });
      if (!koalaPart('EarInner' + side)) inner.position.z = 0.075;   // the Blender part already carries its offset
      head.add(ear);
      return ear;
    });
    const noseMat = new THREE.MeshPhysicalMaterial({ color: '#17171b', roughness: 0.24, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const nose = new THREE.Mesh(part('Nose', () => ellipsoid(0.17, 0.82, 1.28, 0.75, 20)), noseMat);
    nose.position.set(0, 0.0, 0.56);
    nose.castShadow = true;
    head.add(nose);
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#0e0e12', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.064, 16, 12), eyeMat);
      e.position.set(s * 0.21, 0.09, 0.45);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), glint);
      g.position.set(0.022 * s + 0.01, 0.028, 0.05);
      e.add(g);
      head.add(e);
      return e;
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 6, 14, Math.PI), new THREE.MeshBasicMaterial({ color: '#2a2024' }));
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -0.19, 0.55);
    head.add(mouth);

    // Crystal (a girl) wears a woven pink scarf; Ruby (a boy) a small blue knitted hat.
    if (id === 'crystal') {
      const cloth = tex ? tex.cloth.clone() : null;
      if (cloth) {
        cloth.repeat.set(7, 1);
        cloth.needsUpdate = true;
      }
      // the scarf widens on a baby, whose big head would otherwise swallow it
      const wrap = (this.scarf = new THREE.Group());
      rig.add(wrap);
      const scarfMat = new THREE.MeshStandardMaterial({ color: '#f26fa6', roughness: 0.85, normalMap: cloth, normalScale: new THREE.Vector2(0.9, 0.9) });
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 14, 32), scarfMat);
      scarf.rotation.x = Math.PI / 2;
      scarf.position.set(0, 1.04, 0.04);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), scarfMat);
      knot.position.set(0.22, 0.98, 0.34);
      const tailGeo = new THREE.BoxGeometry(0.12, 0.34, 0.035, 2, 5, 1);
      const tp = tailGeo.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) + Math.sin(tp.getY(i) * 12) * 0.018);
      tailGeo.computeVertexNormals();
      for (const [x, rz] of [[0.2, -0.25], [0.3, 0.2]]) {
        const t = new THREE.Mesh(tailGeo, scarfMat);
        t.position.set(x, 0.78, 0.38);
        t.rotation.z = rz;
        t.castShadow = true;
        wrap.add(t);
      }
      for (const m of [scarf, knot]) m.castShadow = true;
      wrap.add(scarf, knot);
    } else if (id !== 'ruby') {
      // a baby born in the grove: a little gum blossom tucked behind one ear
      const blossom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: '#f08aa0', roughness: 0.7 }));
      blossom.position.set(0.3, 0.42, 0.05);
      head.add(blossom);
    } else {
      const knit = tex ? tex.cloth.clone() : null;
      if (knit) {
        knit.repeat.set(6, 2);
        knit.needsUpdate = true;
      }
      const wool = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, normalMap: knit, normalScale: new THREE.Vector2(1, 1) });
      const hat = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 28, 14, 0, TAU, 0, Math.PI / 2), wool('#3f78d6'));
      dome.scale.y = 0.95;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.045, 10, 30), wool('#5b93ea'));
      cuff.rotation.x = Math.PI / 2;
      const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), wool('#eef4ff'));
      bobble.position.y = 0.21 * 0.95 + 0.035;
      hat.add(dome, cuff, bobble);
      hat.position.set(0, 0.42, 0.02);
      hat.rotation.x = 0.14;
      hat.traverse((o) => { o.castShadow = true; });
      head.add(hat);
    }
    rig.add(head);

    const dark = new THREE.MeshStandardMaterial({ color: '#2c2b31', roughness: 0.7 });
    const claw = new THREE.MeshStandardMaterial({ color: '#e9dfcb', roughness: 0.5 });
    const limb = (x, y, z, len, kind) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const side = x > 0 ? 'L' : 'R';
      const geo = part(kind + 'Fur' + side, () => {
        const capsule = new THREE.CapsuleGeometry(0.135, len - 0.2, 8, 16);
        capsule.translate(0, -len / 2 + 0.07, 0);
        return capsule;
      });
      fur(geo, base, { parent: g, length: 0.04, density: 0.26 });
      const paw = new THREE.Mesh(part('Paw' + kind + side, () => ellipsoid(0.125, 1, 0.85, 1.1, 14)), dark);
      paw.position.y = -len + 0.02;
      paw.castShadow = true;
      for (let i = -1; i <= 1; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.075, 6), claw);
        c.position.set(i * 0.05, -0.04, 0.115);
        c.rotation.x = Math.PI * 0.62;
        paw.add(c);
      }
      g.add(paw);
      g.paw = paw;
      rig.add(g);
      return g;
    };
    this.arms = [limb(-0.44, 1.0, 0.18, 0.62, 'Arm'), limb(0.44, 1.0, 0.18, 0.62, 'Arm')];
    this.legs = [limb(-0.3, 0.36, 0.12, 0.46, 'Leg'), limb(0.3, 0.36, 0.12, 0.46, 'Leg')];

    // A gum leaf in the right paw while eating.
    const sg = new THREE.ShapeGeometry((() => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(0.08, 0.12, 0.07, 0.3, 0, 0.5);
      s.bezierCurveTo(-0.07, 0.3, -0.08, 0.12, 0, 0);
      return s;
    })(), 6);
    this.snack = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: '#6b917c', roughness: 0.5, side: THREE.DoubleSide }));
    this.snack.position.set(0, -0.04, 0.08);
    this.snack.rotation.set(1.2, 0, 0);
    this.arms[1].paw.add(this.snack);
    this.snack.visible = false;

    // The gumnut that circles the head while a real model call is in flight. It glows (and
    // blooms) by itself; no point light, so it costs nothing in every other material.
    this.nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#f2b441', emissiveIntensity: 3.2, roughness: 0.4 }));
    this.nut.visible = false;
    root.add(this.nut);

    root.traverse((o) => { if (o.isMesh) o.userData.koala = id; });
    this.#labels();
  }

  // How big this koala is now (0.5 of full size for a newborn baby, 1 fully grown). The first call
  // sets it at once; later ones grow into it.
  grow(size) {
    this.sizeGoal = size;
    if (!this.sized) {
      this.size = size;
      this.sized = true;
    }
  }

  // Draw n of the fur shells (0 turns the fur off and leaves the solid body).
  setShells(n) {
    for (const m of this.furMeshes) {
      m.visible = n > 0;
      m.count = Math.max(1, n);
    }
    for (const mat of this.furMats) mat.userData.fur.uShells.value = Math.max(1, n);
  }

  #labels() {
    const tag = document.createElement('button');
    tag.className = 'koala-tag';
    tag.type = 'button';
    tag.style.setProperty('--c', this.color);
    tag.innerHTML = '<i></i><span class="n"></span><svg class="ico" aria-hidden="true"><use href="#i-sit"/></svg><span class="s"></span>';
    tag.querySelector('.n').textContent = this.name;
    this.tagEl = tag;
    this.tagState = tag.querySelector('.s');
    this.tagIcon = tag.querySelector('.ico use');
    const tagObj = new CSS2DObject(tag);
    tagObj.position.y = 2.3;
    this.root.add(tagObj);

    const say = document.createElement('div');
    say.className = 'bubble say';
    const think = document.createElement('div');
    think.className = 'bubble think';
    const zzz = document.createElement('div');
    zzz.className = 'zzz';
    zzz.innerHTML = '<span>z</span><span>z</span><span>z</span>';
    const stack = document.createElement('div');
    stack.className = 'bubble-stack';
    stack.append(think, say);
    const stackObj = new CSS2DObject(stack);
    stackObj.position.y = 2.75;
    stackObj.center.set(0.5, 1);
    const zObj = new CSS2DObject(zzz);
    zObj.position.set(0.5, 1.9, 0);
    this.root.add(stackObj, zObj);
    this.sayEl = say;
    this.thinkEl = think;
    this.zEl = zzz;
    this.sayT = 0;
    this.thinkT = 0;
  }

  say(text) {
    this.sayEl.textContent = text;
    this.sayEl.classList.add('show');
    this.sayT = Math.min(11, 4 + text.length / 14);
  }

  thought(text) {
    this.thinkEl.textContent = text;
    this.thinkEl.classList.add('show');
    this.thinkT = 6;
  }

  place(x, y, z) {
    this.pos.set(x, y, z);
    this.goal = { x, y, z };
    this.path = [];
    this.root.position.set(x, y + this.groundY(x, z), z);
  }

  setGoal(goal, anim, path = [], face = null) {
    const moved = Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) > 0.05 || Math.abs(goal.y - this.goal.y) > 0.05;
    this.goal = goal;
    this.anim = anim;
    this.face = face;
    if (moved) this.path = path;
  }

  get arrived() {
    return !this.moving && Math.abs(this.pos.y - this.goal.y) < 0.02;
  }

  update(dt, t) {
    const p = this.pos;
    const next = this.path[0] ?? this.goal;
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const far = Math.hypot(dx, dz);
    let mode = this.anim;
    this.moving = false;
    this.size = damp(this.size, this.sizeGoal, 1.2, dt);
    const pace = 0.3 + 0.7 * this.size; // little legs are slower
    const baby = Math.max(0, 1 - (this.size - 0.5) / 0.5); // 1 newborn, 0 fully grown
    this.root.scale.setScalar(this.size);
    this.head.scale.setScalar(1 + 0.15 * baby); // babies have big heads for their bodies
    if (this.scarf) {
      this.scarf.scale.set(1 + 0.3 * baby, 1 + 0.1 * baby, 1 + 0.3 * baby);
      this.scarf.position.y = -0.04 * baby;
    }

    if (p.y > 0.02 && Math.hypot(this.goal.x - p.x, this.goal.z - p.z) > 0.25) {
      p.y = Math.max(0, p.y - CLIMB * pace * dt);
      mode = 'climbing';
    } else if (far > 0.06) {
      // ease in, cruise, ease out over the whole route, so it only slows down where it stops
      let left = far;
      for (let i = 0, a = next; i < this.path.length; i++) {
        const b = this.path[i + 1] ?? this.goal;
        left += Math.hypot(b.x - a.x, b.z - a.z);
        a = b;
      }
      const g = glide(this.speed, left, dt, { max: WALK * pace, accel: 3.2 * pace });
      this.speed = g.speed;
      const step = Math.min(far, g.step);
      this.stride += (step / (WALK * pace)) * 9; // the legs keep pace with the ground, no sliding
      p.x += (dx / far) * step;
      p.z += (dz / far) * step;
      this.#turn(Math.atan2(dx, dz), 10, dt);
      this.moving = true;
      mode = 'walk';
      if (far <= step + 1e-6 && this.path.length) this.path.shift();
    } else if (Math.abs(this.goal.y - p.y) > 0.02) {
      const g = glide(this.climbSpeed, Math.abs(this.goal.y - p.y), dt, { max: CLIMB * pace, accel: 2.5 });
      this.climbSpeed = g.speed;
      p.y += Math.sign(this.goal.y - p.y) * g.step;
      mode = 'climbing';
    }
    if (!this.moving) this.speed = 0;
    if (mode !== 'climbing') this.climbSpeed = 0;
    if (!this.moving && this.face != null) this.#turn(this.face, 5, dt);
    else if (!this.moving) this.turnV *= Math.exp(-8 * dt);
    this.root.position.set(p.x, p.y + this.groundY(p.x, p.z), p.z);
    this.root.rotation.y = this.heading;
    this.#pose(mode, dt, t);
    this.#bubbles(dt);
  }

  // Turn toward an angle on a critically damped spring: quick, smooth, no wobble at the end.
  #turn(to, omega, dt) {
    const err = angleTo(this.heading, to);
    this.turnV += (err * omega * omega - 2 * omega * this.turnV) * Math.min(dt, 0.05);
    this.heading += this.turnV * Math.min(dt, 0.05);
  }

  #pose(mode, dt, t) {
    const { rig, head, arms, legs } = this;
    const s = t + this.seed;
    const k = 10;
    let pitch = 0, y = 0, z = 0, headX = 0, headY = 0, breathe = 1 + Math.sin(s * 2) * 0.02;
    let aL = -0.3, aR = -0.3, aZ = 0, lL = -1.35, lR = -1.35, eyes = 1, earFlop = 0;
    let headZ = 0, sway = 0, shift = 0; // jaw/head tilt, body sway, weight shift
    this.snack.visible = false;

    switch (mode) {
      case 'walk': {
        const w = Math.sin(this.stride + this.seed);
        pitch = 1.05; y = -0.2; z = 0.15; headX = -0.95;
        aL = 0.3 + w * 0.7; aR = 0.3 - w * 0.7; lL = -0.2 - w * 0.6; lR = -0.2 + w * 0.6;
        y += Math.abs(w) * 0.05;
        earFlop = Math.abs(w) * 0.12;
        this.stepped = Math.sign(w) !== Math.sign(this.lastW) && this.lastW !== 0;
        this.lastW = w;
        break;
      }
      case 'climbing': {
        const w = Math.sin(s * 7);
        aL = -2.7 + w * 0.35; aR = -2.7 - w * 0.35; lL = -0.6 - w * 0.4; lR = -0.6 + w * 0.4; z = -0.25;
        break;
      }
      case 'cling':
        aL = -2.4; aR = -2.5 + Math.sin(s * 0.8) * 0.1; lL = lR = -0.7; z = -0.3; headY = Math.sin(s * 0.3) * 0.5; headX = 0.1;
        break;
      case 'eat': {
        // nip a leaf, then chew: the jaw slides side to side as the molars grind
        const bite = Math.sin(s * 0.9) > 0.6;
        aL = -2.3; aR = bite ? -2.45 : -2.0 + Math.sin(s * 3.2) * 0.15; lL = lR = -0.8; z = -0.25;
        headX = 0.12 + (bite ? -0.08 : Math.abs(Math.sin(s * 6)) * 0.04);
        headZ = bite ? 0 : Math.sin(s * 6.5) * 0.07;
        this.snack.visible = true;
        break;
      }
      case 'fork':
        // asleep wedged in a fork: leaning back against the trunk, arms around it, legs hanging
        pitch = -0.12; z = -0.22; headX = 0.42; headY = 0.3; headZ = 0.12;
        aL = -1.75; aR = -1.6; aZ = 0.25; lL = -0.45; lR = -0.2; eyes = 0.1;
        breathe = 1 + Math.sin(s * 0.9) * 0.05; sway = Math.sin(s * 0.4) * 0.03;
        break;
      case 'curl':
        // a ball against the night cold: head tucked to the chest, limbs drawn in
        pitch = 0.95; y = -0.3; headX = 0.95; aL = aR = -1.2; aZ = 0.65; lL = lR = -2.05; eyes = 0.1;
        breathe = 1 + Math.sin(s * 0.85) * 0.055;
        break;
      case 'hug':
        // midday heat: belly against the cool bark, limbs spread around the trunk, cheek to the wood
        pitch = -0.08; z = -0.42; headX = 0.05; headY = 0.65; aL = aR = -2.05; aZ = -0.45; lL = lR = -1.0; eyes = 0.45;
        breathe = 1 + Math.sin(s * 1.6) * 0.03;
        break;
      case 'sleep':
        pitch = 0.55; y = -0.22; headX = 0.55; aL = -0.95; aR = -0.95; aZ = 0.45; lL = lR = -1.5; eyes = 0.12;
        breathe = 1 + Math.sin(s * 1.1) * 0.045;
        break;
      case 'swing': {
        const ph = Math.sin(t * 2.2 + (this.id === 'crystal' ? 0 : 1.4));
        z = ph * 0.55; y = 0.55 + (1 - Math.cos(ph)) * 0.25; pitch = -ph * 0.25;
        aL = aR = -2.9; lL = lR = -1.3 - ph * 0.5;
        earFlop = Math.abs(ph) * 0.3;
        break;
      }
      case 'splash': {
        y = Math.abs(Math.sin(s * 5)) * 0.35; aL = -1.6 + Math.sin(s * 10) * 0.8; aR = -1.6 - Math.sin(s * 10) * 0.8; aZ = 0.4;
        headX = -0.2;
        break;
      }
      case 'ball':
        aL = aR = -1.3 + Math.sin(s * 4) * 0.6; pitch = 0.15 + Math.sin(s * 4) * 0.08; headX = -0.15;
        break;
      case 'build': {
        // hammering: the right paw comes down hard and lifts slowly, the left one steadies the work
        const hit = Math.sqrt(Math.abs(Math.sin(s * 4.5)));
        aR = -2.7 + hit * 1.5; aL = -1.15; pitch = 0.28; headX = 0.32 + (1 - hit) * 0.06; z = 0.05;
        break;
      }
      default:
        // idle: look around, shift the weight from side to side, sway a little
        headY = Math.sin(s * 0.45) * 0.45 + Math.sin(s * 1.3) * 0.08;
        headX = Math.sin(s * 0.3) * 0.08;
        headZ = Math.sin(s * 0.23) * 0.05;
        sway = Math.sin(s * 0.5) * 0.035;
        shift = Math.sin(s * 0.35) * 0.03;
        break;
    }
    if (mode !== 'walk') this.stepped = false;

    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3.5;
    if (this.blink < 0.12 && !['sleep', 'fork', 'curl'].includes(mode)) eyes = 0.1;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, eyes, 30, dt);

    rig.rotation.x = damp(rig.rotation.x, pitch, k, dt);
    rig.position.y = damp(rig.position.y, y, k, dt);
    rig.position.z = damp(rig.position.z, z, k, dt);
    head.rotation.x = damp(head.rotation.x, headX, k, dt);
    head.rotation.y = damp(head.rotation.y, headY, k, dt);
    head.rotation.z = damp(head.rotation.z, headZ, k, dt);
    rig.rotation.z = damp(rig.rotation.z, sway, 4, dt);
    rig.position.x = damp(rig.position.x, shift, 4, dt);
    this.torso.scale.y = breathe;
    arms[0].rotation.x = damp(arms[0].rotation.x, aL, k, dt);
    arms[1].rotation.x = damp(arms[1].rotation.x, aR, k, dt);
    arms[0].rotation.z = damp(arms[0].rotation.z, -aZ, k, dt);
    arms[1].rotation.z = damp(arms[1].rotation.z, aZ, k, dt);
    legs[0].rotation.x = damp(legs[0].rotation.x, lL, k, dt);
    legs[1].rotation.x = damp(legs[1].rotation.x, lR, k, dt);
    const twitch = Math.sin(s * 0.7) > 0.97 ? Math.sin(s * 40) * 0.25 : 0;
    this.ears[0].rotation.z = damp(this.ears[0].rotation.z, twitch + earFlop, 14, dt);
    this.ears[1].rotation.z = damp(this.ears[1].rotation.z, -twitch * 0.5 - earFlop, 14, dt);

    this.nut.visible = this.thinking;
    if (this.thinking) {
      this.nut.position.set(Math.cos(t * 3) * 0.75, 2.0 + Math.sin(t * 5) * 0.08, Math.sin(t * 3) * 0.75);
      this.nut.rotation.y += dt * 4;
    }
    this.zEl.classList.toggle('show', ['sleep', 'fork', 'curl'].includes(mode));
  }

  #bubbles(dt) {
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) this.sayEl.classList.remove('show');
    if (this.thinkT > 0 && (this.thinkT -= dt) <= 0) this.thinkEl.classList.remove('show');
  }
}
