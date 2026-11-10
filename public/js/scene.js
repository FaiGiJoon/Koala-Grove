// three.js view of the grove: a floating eucalyptus island with a forest, a pond, a rope
// swing, a ball, a mossy hollow log and a lookout rock, under a living sky. The server says
// where each koala is and what it is doing; this draws it, runs day and night, and lets
// the visitor walk around. The look lives in ./gfx/*; this file wires it together.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Koala } from './koala.js';
import { spotFor, animFor, postureFor, skyAt, landRoute, walkable, carried, RESOURCE_COLORS } from './view.js';
import { BuildLayer } from './gfx/builds.js';
import { gradeAt } from './gfx/grade.js';
import { Critters } from './gfx/critters.js';
import { buildTextures } from './gfx/textures.js';
import { CreationLayer } from './gfx/creations.js';
import { makeTerrain, bushlandSpots, ISLAND, SHORE_R, WATER_Y } from './gfx/terrain-math.js';
import { SETTINGS, pickInitialTier, parseQuality, ladder, Governor } from './gfx/quality.js';
import { shared, groundMaterial, waterMaterial, RIPPLES } from './gfx/materials.js';
import { Sky } from './gfx/sky.js';
import { buildSplat, buildLawn, buildIslet } from './gfx/terrain.js';
import { buildGrass, eucalypt, treeMeshes, leafMaterials, rockGeometry, rockMaterial, fernMesh, bushShape, flowerMeshes } from './gfx/flora.js';
import { buildProps, buildMounds, animatePond } from './gfx/props.js';
import { Effects, buildAmbient } from './gfx/particles.js';
import { Post } from './gfx/post.js';
import { rng } from './gfx/noise.js';

const DAY_MS = 20 * 60000;
const TAU = Math.PI * 2;
const HIGH = SETTINGS.high;
// Two cameras, both at ground level and neither shows a person, only the koalas: first person (the
// visitor's own eyes) and third person (behind them, never higher than a low chase angle: no bird's-eye view).
const EYE = 1.55;
const CHASE = { dist: 7.5, pitch: 0.2 };
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// smooth pale gums, and a few rough, dark stringybarks among them
const BARK = ['#e9e0d1', '#d8c8b2', '#cfc6bd', '#e4d3c0', '#c9bba6', '#8f7259', '#7d644f'].map((c) => new THREE.Color(c));
const LEAF = ['#8aa67c', '#7a9a70', '#98b085', '#8fa97a', '#86a58a', '#a1b58c', '#7d9c78'].map((c) => new THREE.Color(c));
// The three named gums keep their own look.
const HERO = {
  big_gum: { bark: '#ede4d6', leaves: ['#86a47a', '#76966c', '#94ad82'], h: 7.4, seed: 51 },
  river_gum: { bark: '#dacbb8', leaves: ['#7a9a72', '#8aa686', '#6a8c68'], h: 6.6, seed: 52 },
  blue_gum: { bark: '#cfc5bb', leaves: ['#8eab9c', '#7c9e92', '#a0bbaa'], h: 6.9, seed: 53 },
};

function readPref() {
  try { return localStorage.getItem('grove-quality'); } catch { return null; }
}

// The library bridge stands from day one: its foot is 21.5 out toward the island (grove-economy's bridgeFoot).
function libraryRoad(places) {
  const l = places.library_isle;
  if (!l) return [];
  const d = Math.hypot(l.x, l.z) || 1;
  return [{ x: (l.x / d) * 21.5, z: (l.z / d) * 21.5 }];
}

export class GroveScene {
  constructor(container, { places, koalas, plots = [] }) {
    const t0 = performance.now();
    let lapAt = t0;
    this.timings = {};
    const lap = (name) => {
      const n = performance.now();
      this.timings[name] = Math.round(n - lapAt);
      lapAt = n;
    };
    this.container = container;
    this.places = places;
    this.koalas = new Map();
    this.state = null;
    this.selected = null;
    this.hover = null;
    this.cam = 'third';
    this.look = { yaw: Math.PI, pitch: 0.02 };
    this.onPick = () => {};
    this.clockFrac = 0.35;
    this.clockDay = 1;
    this.keys = new Set();
    this.fps = 60;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    shared.uWindAmp.value = this.reduced ? 0.25 : 0.55;
    const rand = (this.rand = rng(7));

    // --- quality: the starting tier, and whether the governor may change it ---
    const pref = parseQuality(readPref());
    this.pref = pref;
    const detected = pickInitialTier({
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      mobile: /iPhone|iPad|Android/i.test(navigator.userAgent),
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      width: container.clientWidth || innerWidth,
    });
    this.startTier = pref === 'auto' ? detected : pref;
    this.ladder = ladder(this.startTier);
    this.step = 0;
    this.governor = new Governor();
    this.tier = this.startTier;
    this.scale = 1;
    const S = SETTINGS[this.startTier];

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    container.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.tex = buildTextures({ size: S.texSize, maxAniso: r.capabilities.getMaxAnisotropy() });
    lap('textures');
    // build plots stay clear of trees and rocks, so what the koalas build has room
    this.terrain = makeTerrain(places, { clear: plots.filter((p) => !p.land), roads: libraryRoad(places) });
    this.terrain.pond = places.pond;
    const T = this.terrain;
    // new land and its bridges first, then the island itself
    this.groundY = (x, z) => this.buildLayer?.heightAt(x, z) ?? T.height(x, z);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xbfd0e0, 0.0068);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1600);
    this.camera.position.set(4, 3.1, 17.5);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    // third person looks across the lawn from behind the visitor, never down from above
    this.controls.maxPolarAngle = 1.5;
    this.controls.minPolarAngle = 1.1;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 11;
    this.controls.enablePan = false;
    this.controls.target.set(4, 1.5, 10);

    this.#lights();
    this.sky = new Sky({ scene: this.scene, renderer: r, settings: S });
    lap('sky');
    this.#world(rand, S, lap);
    this.buildLayer = new BuildLayer({ scene: this.scene, tex: this.tex, baseY: (x, z) => T.height(x, z), island: ISLAND });
    this.creations = new CreationLayer({ scene: this.scene });
    this.#buildKoalas(koalas);
    this.critters = new Critters({ scene: this.scene, groundY: this.groundY, places });
    lap('koalas');
    this.#effects(S);
    lap('effects');
    this.post = new Post({ renderer: r, scene: this.scene, camera: this.camera });

    this.raycaster = new THREE.Raycaster();
    let down = null;
    let drag = null;
    r.domElement.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      drag = { x: e.clientX, y: e.clientY };
    });
    r.domElement.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e);
      down = drag = null;
    });
    let lastMove = 0;
    r.domElement.addEventListener('pointermove', (e) => {
      if (drag && this.cam === 'first' && (e.buttons || e.pointerType === 'touch')) {
        this.#lookDrag(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
        return;
      }
      if (e.pointerType === 'touch' || e.buttons || performance.now() - lastMove < 70) return;
      lastMove = performance.now();
      this.#hover(e);
    });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    this.#tuneMaterials();
    this.#applyTier();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.buildMs = Math.round(performance.now() - t0);
  }

  // The baked sky is a strong light from every direction; matte surfaces take less of it so the
  // sun's colour and the shade stay in charge, while glossy parts (eyes, nose, water) keep theirs.
  #tuneMaterials() {
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m || m.isShaderMaterial || m === this.water.material || !('envMapIntensity' in m)) return;
      m.envMapIntensity = m.isMeshPhysicalMaterial ? 1 : 0.55;
    });
    // thin vegetation catches the blue sky as a milky sheen; keep it green
    this.grass.material.envMapIntensity = 0.22;
    this.leafMats.leaf.envMapIntensity = 0.38;
    this.water.material.envMapIntensity = 0.85;
  }

  // --- quality ----------------------------------------------------------------------------
  get settings() {
    const step = this.ladder?.[this.step];
    return step?.noAO ? { ...SETTINGS[this.tier], ao: false } : SETTINGS[this.tier];
  }

  // 'auto' lets the governor step the tier down and back up; a tier pins it.
  setQuality(pref) {
    pref = parseQuality(pref);
    try { localStorage.setItem('grove-quality', pref); } catch { /* private window: it just will not stick */ }
    this.pref = pref;
    const start = pref === 'auto' ? this.startTier : pref;
    this.ladder = ladder(start);
    this.step = 0;
    this.governor.reset();
    this.#applyTier();
    this.resize();
  }

  #applyTier() {
    const step = this.ladder[this.step];
    this.tier = step.tier;
    this.scale = step.scale;
    const S = this.settings;
    // shadow map
    if (this.sun.shadow.mapSize.x !== S.shadowMap) {
      this.sun.shadow.mapSize.set(S.shadowMap, S.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.post.configure(S);
    this.grass.count = Math.min(this.grass.instanceMatrix.count, S.grass);
    for (const k of this.koalas.values()) k.setShells(S.shells);
    for (const t of this.forest) {
      for (const m of t.children) m.count = Math.max(0, Math.ceil(m.instanceMatrix.count * Math.min(1, S.forest)));
      t.userData.setLeafFactor(S.leaves);
      t.userData.leaves.castShadow = S.shadowMap >= 2048;
    }
    this.islets.forEach((g, i) => (g.visible = i < S.islets));
    this.fx.setCap(S.particles / HIGH.particles);
    this.ambient.points.geometry.setDrawRange(0, Math.floor(this.ambientCount * Math.min(1, S.particles / HIGH.particles + 0.15)));
    this.butterflies.forEach((b, i) => (b.group.visible = i < S.butterflies));
    this.envEvery = this.tier === 'high' ? 2500 : this.tier === 'medium' ? 4500 : 9000;
  }

  // --- lights ------------------------------------------------------------------------------
  #lights() {
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x56633a, 0.3);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 170;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    // a soft fill from the camera's side, so faces in the sun's shadow stay readable
    this.fill = new THREE.DirectionalLight(0xfff1de, 0.4);
    this.fill.position.set(8, 22, 34);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill);
  }

  // --- the world ---------------------------------------------------------------------------------
  #world(rand, S, lap = () => {}) {
    const { places, tex, terrain: T, scene } = this;
    const group = new THREE.Group();
    scene.add(group);

    // 1. where the trees stand: three named gums, a forest, and trees on the islets
    const heroes = Object.entries(HERO).filter(([id]) => places[id]).map(([id, h]) => ({ id, ...h, x: places[id].x, z: places[id].z }));
    const forest = [];
    for (let tries = 0; tries < 4000 && forest.length < 38; tries++) {
      const a = rand() * TAU;
      const d = 7.5 + (ISLAND - 3 - 7.5) * Math.pow(rand(), 0.62);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // the south side faces the default camera: keep it open so the view over the lawn is clear
      if (z / d > 0.28 && d > 7) continue;
      if (T.blocked(x, z, 3.4) || forest.some((t) => Math.hypot(t.x - x, t.z - z) < 4.8)) continue;
      forest.push({ x, z });
    }

    lap('forest-spots');
    // paperbarks on the pond bank and termite mounds in the open (koala bushland)
    this.bush = bushlandSpots(T, places, { avoid: forest, seed: 5 });
    // 2. props, rocks, bushes, ferns, flowers: their positions also bake occlusion into the ground
    const props = buildProps({ places, terrain: T, tex, rand });
    this.props = props;
    this.seats = props.seats;
    this.ball = props.ball;
    this.ballRest = props.ballRest;
    this.shroomMat = props.shroomMat;
    group.add(props.group);

    const rockGeos = [3, 8, 13, 21].map((s) => rockGeometry(s));
    const rockMat = rockMaterial(tex);
    const rocks = [];
    for (let tries = 0; tries < 400 && rocks.length < 46; tries++) {
      const a = rand() * TAU;
      const d = 4 + rand() * (ISLAND - 6);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (T.blocked(x, z, 0.3) || forest.some((t) => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
      rocks.push({ x, z, k: 0.22 + Math.pow(rand(), 2) * 0.7, v: Math.floor(rand() * rockGeos.length), yaw: rand() * TAU });
    }
    const rockMeshes = rockGeos.map((g, v) => {
      const list = rocks.filter((q) => q.v === v);
      const m = new THREE.InstancedMesh(g, rockMat, Math.max(1, list.length));
      m.count = list.length;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach((o, i) => {
        q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, o.yaw, (rand() - 0.5) * 0.4));
        m4.compose(V(o.x, T.height(o.x, o.z) + o.k * 0.18, o.z), q, V(o.k * 1.2, o.k * 0.85, o.k));
        m.setMatrixAt(i, m4);
        m.setColorAt(i, c.set(['#d8d0c2', '#c4bbab', '#d6c9b2', '#b9b0a2'][Math.floor(rand() * 4)]));
      });
      m.castShadow = m.receiveShadow = true;
      return m;
    });
    group.add(...rockMeshes);

    const bushes = [];
    for (let tries = 0; tries < 300 && bushes.length < 26; tries++) {
      const a = rand() * TAU;
      const d = 5 + rand() * (ISLAND - 5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (T.blocked(x, z, 0.5) || forest.some((t) => Math.hypot(t.x - x, t.z - z) < 1.8)) continue;
      bushes.push({ x, z, k: 0.8 + rand() * 0.8 });
    }

    const ferns = [];
    const nearTrees = [...heroes, ...forest];
    for (const t of nearTrees) for (let i = 0; i < 3; i++) {
      const a = rand() * TAU;
      const x = t.x + Math.cos(a) * (1.1 + rand() * 1.4);
      const z = t.z + Math.sin(a) * (1.1 + rand() * 1.4);
      if (!T.blocked(x, z, -1.0) && T.pathMask(x, z) < 0.2 && T.height(x, z) > WATER_Y + 0.1) ferns.push({ x, z });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.PI * 0.6 + rand() * 2.4;
      const rr = SHORE_R + 0.7 + rand() * 1.6;
      ferns.push({ x: places.pond.x + Math.cos(a) * rr, z: places.pond.z + Math.sin(a) * rr });
    }

    const fl = places.flowers;
    const patch = [];
    for (let i = 0; i < 230; i++) {
      const a = rand() * TAU;
      const d = Math.sqrt(rand()) * 3.1;
      patch.push({ x: fl.x + Math.cos(a) * d, z: fl.z + Math.sin(a) * d });
    }
    const wild = [];
    for (let tries = 0; tries < 900 && wild.length < 150; tries++) {
      const a = rand() * TAU;
      const d = Math.sqrt(rand()) * (ISLAND - 1.5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (T.pathMask(x, z) > 0.3 || T.height(x, z) < WATER_Y + 0.08) continue;
      wild.push({ x, z });
    }

    lap('props+scatter');
    // 3. ground: splat map, lawn, cliff, roots, grass
    const blobs = [
      ...props.blobs,
      ...heroes.map((h) => ({ x: h.x, z: h.z, r: 3.2, s: 0.9 })),
      ...forest.map((t) => ({ x: t.x, z: t.z, r: 2.4, s: 0.75 })),
      ...rocks.map((o) => ({ x: o.x, z: o.z, r: o.k * 2.4 + 0.4, s: 0.5 })),
      ...props.rockSpots.map((o) => ({ x: o.x, z: o.z, r: o.r * 2.4 + 0.3, s: 0.45 })),
      ...bushes.map((b) => ({ x: b.x, z: b.z, r: b.k * 1.6 + 0.4, s: 0.5 })),
      ...this.bush.paperbarks.map((t) => ({ x: t.x, z: t.z, r: 1.8, s: 0.6 })),
      ...this.bush.mounds.map((m) => ({ x: m.x, z: m.z, r: 1.7 * m.k, s: 0.65 })),
    ];
    const splat = buildSplat({ terrain: T, size: S.texSize, blobs, caps: props.caps });
    lap('splat');
    this.splat = splat;
    const gMat = groundMaterial({ tex, splat, island: ISLAND });
    this.ground = buildLawn({ terrain: T, rings: S.terrainRings, segs: S.terrainSegs, material: gMat });
    group.add(this.ground);
    // No cliff and no hanging roots: the lawn runs out onto a wide meadow that reaches the horizon,
    // so the grove sits on the land instead of floating above it.
    const meadowMap = tex.grass.map.clone();
    meadowMap.repeat.set(160, 160);
    meadowMap.needsUpdate = true;
    const meadowNormal = tex.grass.normal.clone();
    meadowNormal.repeat.set(160, 160);
    meadowNormal.needsUpdate = true;
    const meadowMat = new THREE.MeshStandardMaterial({ map: meadowMap, normalMap: meadowNormal, color: '#7f9a5a', roughness: 0.97 });
    const meadow = new THREE.Mesh(new THREE.CircleGeometry(1400, 128), meadowMat);
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -0.95;
    meadow.receiveShadow = true;
    group.add(meadow);
    lap('lawn+meadow');
    this.grass = buildGrass({ terrain: T, capacity: HIGH.grass });
    group.add(this.grass);
    lap('grass');

    // 4. water
    const wMat = waterMaterial({ tex, splat, island: ISLAND });
    this.ripples = wMat.userData.ripples;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(SHORE_R + 1.3, 56), wMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(places.pond.x, WATER_Y + 0.015, places.pond.z);
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    group.add(this.water);

    // 5. trees
    const mats = leafMaterials(tex);
    this.leafMats = mats;
    const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, normalScale: new THREE.Vector2(1.3, 1.3), vertexColors: true, roughness: 0.9 });
    this.forest = [];
    for (const h of heroes) {
      const shape = eucalypt({ seed: h.seed, height: h.h, trunkR: 0.58, lean: 0.25 + (h.seed % 3) * 0.1, branches: 9, clusters: 28, cards: 18 });
      const leafC = h.leaves.map((c) => new THREE.Color(c));
      const g = treeMeshes({
        shape, mats, barkMat,
        instances: [{ x: h.x, y: T.height(h.x, h.z), z: h.z, yaw: h.seed, scale: 1, bark: new THREE.Color(h.bark), leaf: leafC[0] }],
      });
      group.add(g);
      this.forest.push(g);
      this.trees ??= {};
      this.trees[h.id] = g;
    }
    const shapes = [
      eucalypt({ seed: 11, height: 7.4, trunkR: 0.56, lean: 0.6, branches: 8, clusters: 24 }),
      eucalypt({ seed: 23, height: 6.2, trunkR: 0.64, lean: 1.0, branches: 9, clusters: 26 }),
      eucalypt({ seed: 37, height: 8.6, trunkR: 0.5, lean: 0.35, branches: 7, clusters: 22 }),
    ];
    // islets in the distance, each with a few trees of its own
    this.islets = [];
    this.isletMeta = [];
    const isletTrees = [];
    const isletRock = new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normal, vertexColors: true, roughness: 0.96 });
    const isletGrass = new THREE.MeshStandardMaterial({ color: '#7fa05a', map: tex.grass.map, normalMap: tex.grass.normal, roughness: 0.95 });
    const sites = [[-82, 6, -70, 9], [96, 14, -48, 7.5], [-120, -4, 40, 10.5], [72, 22, 96, 6.5], [10, 30, -140, 12]];
    sites.slice(0, HIGH.islets).forEach(([x, y, z, rad], i) => {
      const { group: ig, spots } = buildIslet({ radius: rad, seed: i + 2, rockMat: isletRock, grassMat: isletGrass });
      ig.position.set(x, y, z);
      ig.rotation.y = i * 1.3;
      this.scene.add(ig);
      this.islets.push(ig);
      const cs = Math.cos(ig.rotation.y);
      const sn = Math.sin(ig.rotation.y);
      for (const s of spots) isletTrees.push({ x: x + s.x * cs + s.z * sn, y: y + s.y, z: z - s.x * sn + s.z * cs });
    });
    const all = [...forest.map((t) => ({ x: t.x, y: T.height(t.x, t.z), z: t.z })), ...isletTrees];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    shapes.forEach((shape, v) => {
      const list = all.filter((_, i) => i % shapes.length === v).map((t) => ({
        ...t, yaw: rand() * TAU, scale: 0.85 + rand() * 0.5, bark: BARK[Math.floor(rand() * BARK.length)], leaf: LEAF[Math.floor(rand() * LEAF.length)],
      }));
      const g = treeMeshes({ shape, mats, barkMat, instances: list });
      group.add(g);
      this.forest.push(g);
    });

    // paperbarks: slender, pale papery bark, narrow grey-green leaves
    const paper = eucalypt({ seed: 71, height: 5.4, trunkR: 0.3, lean: 0.9, branches: 7, clusters: 18, cards: 14 });
    group.add(treeMeshes({
      shape: paper, mats, barkMat,
      instances: this.bush.paperbarks.map((t) => ({ x: t.x, y: T.height(t.x, t.z), z: t.z, yaw: t.yaw, scale: t.k, bark: new THREE.Color('#f6f1e6'), leaf: new THREE.Color('#90a593') })),
    }));
    group.add(buildMounds({ spots: this.bush.mounds, terrain: T, tex }));
    lap('trees+islets');
    // 6. ground cover
    group.add(fernMesh({ spots: ferns, tex, terrain: T }));
    const bs = bushShape(5);
    const bushMeshes = treeMeshes({
      shape: { bark: new THREE.BufferGeometry(), leaves: bs.leaves, mass: bs.mass, cards: bs.cards }, mats, barkMat,
      instances: bushes.map((b) => ({ x: b.x, y: T.height(b.x, b.z) - 0.05, z: b.z, yaw: rand() * TAU, scale: b.k, bark: BARK[0], leaf: LEAF[Math.floor(rand() * LEAF.length)] })),
      castLeaves: false,
    });
    bushMeshes.children[0].visible = false; // no bark
    bushMeshes.children[2].visible = false; // no inner mass: the cards alone make a shrub
    group.add(bushMeshes);
    group.add(...flowerMeshes({ spots: patch, terrain: T, palette: ['#f08aa0', '#e8584f', '#f6e7c8', '#f2c14e', '#f3b0c8', '#b9a2f0'] }));
    group.add(...flowerMeshes({ spots: wild, terrain: T, seed: 9, size: 0.55, palette: ['#ffffff', '#fff3b0', '#f6e7c8', '#e9d8ff'] }));
    this.#buildVisitor();
    this.#labelsForPlaces();
  }

  #buildVisitor() {
    const { tex } = this;
    const cloth = tex.cloth.clone();
    cloth.repeat.set(3, 3);
    cloth.needsUpdate = true;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, normalMap: cloth, normalScale: new THREE.Vector2(0.6, 0.6), ...extra });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.55, 8, 18), mat('#c9b48a'));
    body.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), new THREE.MeshStandardMaterial({ color: '#e8c4a0', roughness: 0.6 }));
    head.position.y = 1.42;
    const face = new THREE.Group();
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#2a1d14' }));
      eye.position.set(s * 0.09, 0.03, 0.245);
      face.add(eye);
    }
    head.add(face);
    const felt = mat('#6b6a3a', { roughness: 0.95 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 28), felt);
    brim.position.y = 1.58;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 20), felt);
    crown.position.y = 1.74;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.07, 20), mat('#3b3220'));
    band.position.y = 1.64;
    const pack = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.55, 0.26, 3, 0.07), mat('#8a6a4a'));
    pack.position.set(0, 0.85, -0.38);
    const lantern = new THREE.Group();
    lantern.position.set(0.5, 0.62, 0.18);
    const glass = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.24, 0.17, 2, 0.03), new THREE.MeshStandardMaterial({ color: '#ffe3a3', emissive: '#f2a541', emissiveIntensity: 0.6, roughness: 0.3 }));
    const cage = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.5, metalness: 0.6 });
    const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.08, 8), cage);
    capTop.position.y = 0.16;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 14, Math.PI), cage);
    handle.position.y = 0.2;
    this.lanternGlass = glass;
    this.lanternLight = new THREE.PointLight('#ffcf80', 0, 10, 1.7);
    lantern.add(glass, capTop, handle, this.lanternLight);
    g.add(body, head, brim, crown, band, pack, lantern);
    this.visitor = { root: g, heading: Math.PI, target: null, body, lantern, walk: 0, moving: false };
    g.position.set(4, this.groundY(4, 10), 10);
    // The visitor is only a place to stand: nothing of it is drawn in either camera, only the koalas.
    g.visible = false;
    this.scene.add(g);
  }

  #labelsForPlaces() {
    this.placeLabels = [];
    for (const [id, p] of Object.entries(this.places)) {
      const el = document.createElement('div');
      el.className = 'place-label';
      el.textContent = p.name;
      const o = new CSS2DObject(el);
      o.position.set(p.x, this.groundY(p.x, p.z) + (id === 'lookout' ? 3.6 : p.tree ? 8.8 : id === 'swing' ? 4.5 : 1.5), p.z);
      this.scene.add(o);
      this.placeLabels.push({ el, p: o.position });
    }
  }

  #buildKoalas(list) {
    for (const k of list) this.#koalaView(k);
    // soft contact shadows under everyone: cheap occlusion that sells the footing
    this.blobs = [...this.koalas.values(), this.visitor].map((who) => this.#blob(who));
    // the ring under a selected or hovered koala
    const ringGeo = new THREE.RingGeometry(0.78, 0.95, 56);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#9fd3b0', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.scene.add(this.ring);
  }

  #blob(who) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex.blob, transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    this.scene.add(m);
    return { mesh: m, who };
  }

  // One koala's view: model, tag, carried blocks. Also used when a baby is born mid-session.
  #koalaView(k) {
    {
      const view = new Koala(k, { tex: this.tex, groundY: this.groundY });
      const s = spotFor(this.places, k.place, k.id, k.activity, k.reach);
      view.grow(k.size ?? 1);
      view.place(s.x, s.y, s.z);
      view.tagEl.addEventListener('click', () => this.onPick(k.id));
      // what the koala carries: little blocks held against its chest
      view.carry = new THREE.Group();
      view.carry.position.set(0, 0.95, 0.55);
      view.rig.add(view.carry);
      this.koalas.set(k.id, view);
      this.scene.add(view.root);
      return view;
    }
  }

  #effects(S) {
    this.fx = new Effects({ scene: this.scene, atlas: this.tex.atlas, max: HIGH.particles });
    this.ambientCount = 180;
    this.ambient = buildAmbient({ scene: this.scene, count: this.ambientCount, bounds: ISLAND - 2, groundY: this.groundY });
    this.fxTimers = { leaf: 0, eat: 0, splash: 0, nut: 0, step: 0 };
    // butterflies: two wings each, flapping, drifting around the flowers and the clearing
    this.butterflies = [];
    const cols = ['#f2a541', '#7fb4f2', '#f08aa0', '#f2e06a', '#b99af2', '#ffffff'];
    const wingGeo = new THREE.PlaneGeometry(0.15, 0.11);
    wingGeo.translate(0.075, 0, 0);
    for (let i = 0; i < HIGH.butterflies; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.6, emissive: cols[i % cols.length], emissiveIntensity: 0.08 });
      const a = new THREE.Mesh(wingGeo, mat);
      const b = new THREE.Mesh(wingGeo, mat);
      b.scale.x = -1;
      group.add(a, b);
      this.scene.add(group);
      const around = i % 2 ? this.places.flowers : this.places.clearing;
      this.butterflies.push({ group, wings: [a, b], cx: around.x + (i - 3) * 0.6, cz: around.z, ph: i * 1.9, sp: 0.3 + (i % 3) * 0.08 });
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr = Math.min(devicePixelRatio, this.settings.dprMax) * this.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, dpr);
    this.labels.setSize(w, h);
    const panel = document.getElementById('panel');
    const open = panel && !panel.classList.contains('collapsed');
    const P = w > 820 && open ? panel.offsetWidth + 12 : 0;
    // on a phone the panel is a bottom sheet: centre the world in the part that stays free
    const lift = w <= 820 && open ? Math.round(h * 0.2) : 0;
    this.camera.aspect = (w + P) / h;
    if (P) this.camera.setViewOffset(w + P, h, P, 0, w, h);
    else if (lift) this.camera.setViewOffset(w, h, 0, lift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // a tall, narrow screen sees a thin slice of the world: stand further back, once
    if (!this.framed && w > 0) {
      this.framed = true;
      const aspect = w / h;
      if (aspect < 1) {
        const off = this.camera.position.clone().sub(this.controls.target);
        off.multiplyScalar(Math.min(1.45, Math.pow(1 / aspect, 0.35)));
        this.camera.position.copy(this.controls.target).add(off);
      }
    }
    this.pxScale = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  // 'first': the visitor's eyes. 'third': a chase camera behind them. The visitor is never drawn.
  setCamera(name) {
    this.cam = name;
    const first = name === 'first';
    this.controls.enabled = !first;
    this.camera.fov = first ? 72 : 60;
    this.camera.updateProjectionMatrix();
    this.resize();
    const v = this.visitor;
    if (first) {
      this.look.yaw = v.heading + Math.PI;
      this.look.pitch = 0.02;
    } else {
      // swing the chase camera round to behind wherever the visitor is facing
      const p = v.root.position;
      const target = V(p.x, p.y + 1.5, p.z);
      this.controls.target.copy(target);
      this.camera.position.copy(target).add(V(-Math.sin(v.heading) * Math.cos(CHASE.pitch) * CHASE.dist, Math.sin(CHASE.pitch) * CHASE.dist, -Math.cos(v.heading) * Math.cos(CHASE.pitch) * CHASE.dist));
    }
  }

  // Dragging looks around in first person (it grabs the world: drag right and the view turns left).
  #lookDrag(dx, dy) {
    this.look.yaw += dx * 0.0045;
    this.look.pitch = Math.max(-1.2, Math.min(1.2, this.look.pitch + dy * 0.0045));
  }

  ripple(x, z) {
    const r = this.ripples.find((q) => q.z >= 1) ?? this.ripples[0];
    r.set(x, z, 0, 1);
    this.fx.ring(x, WATER_Y + 0.06, z);
  }

  // --- following the server ------------------------------------------------------------
  // A straight walk, bent around the pond when it would cross it.
  route(from, to) {
    const c = this.places.pond;
    const R = SHORE_R;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((c.x - from.x) * dx + (c.z - from.z) * dz) / len2));
    const px = from.x + dx * u - c.x;
    const pz = from.z + dz * u - c.z;
    const d = Math.hypot(px, pz);
    if (d > R + 0.6 || u <= 0 || u >= 1) return [];
    const nx = d > 0.01 ? px / d : -dz / Math.sqrt(len2);
    const nz = d > 0.01 ? pz / d : dx / Math.sqrt(len2);
    return [{ x: c.x + nx * (R + 1.3), z: c.z + nz * (R + 1.3), y: 0 }];
  }

  // The way to walk: over a bridge when it leads to or from new land, and around the pond.
  walk(from, to) {
    const lands = [...(this.state?.lands ?? []).filter((l) => l.risen), ...(this.state?.islands ?? []).filter((i) => i.bridged)];
    const over = landRoute(from, to, lands, ISLAND);
    if (!over.length) return this.route(from, to);
    return [...this.route(from, over[0]), ...over, ...this.route(over.at(-1), to)];
  }

  sync(state) {
    const prev = this.state;
    this.state = state;
    this.places = state.places;
    this.buildLayer.sync(state);
    this.creations.sync(state.creations);
    this.#ticketBoard((state.tickets ?? []).filter((t) => t.status === 'open').length);
    this.clockFrac = state.clock.frac;
    this.clockDay = state.clock.day;
    this.clockAt = performance.now();
    for (const k of state.koalas) {
      let view = this.koalas.get(k.id);
      if (!view) {
        view = this.#koalaView(k); // a baby born while the page is open
        this.blobs.push(this.#blob(view));
        this.fx.hearts(view.pos.x, view.pos.y + this.groundY(view.pos.x, view.pos.z) + 1, view.pos.z, 6);
      }
      const before = prev?.koalas.find((q) => q.id === k.id);
      if (before && k.bond > before.bond) this.fx.hearts(view.pos.x, view.pos.y + this.groundY(view.pos.x, view.pos.z) + 2.1 * view.size, view.pos.z, Math.min(5, 2 + (k.bond - before.bond)));
      view.grow(k.size ?? 1);
      view.thinking = k.thinking;
      if (view.name !== k.name) {
        view.name = k.name; // the visitor named a baby
        view.tagEl.querySelector('.n').textContent = k.name;
      }
      this.#carry(view, carried(k));
      const spot = spotFor(this.places, k.place, k.id, k.activity, k.reach);
      const anim = postureFor({ anim: animFor(k), hour: state.clock.hour, inTree: spot.y > 0.3 });
      view.setGoal(spot, anim, this.walk(view.pos, spot), this.#faceFor(k, spot));
      view.tagState.textContent = k.thinking ? 'thinking…' : `${k.mood}`;
      view.tagIcon.setAttribute('href', `#i-${{ sleep: 'nap', eat: 'eat', swing: 'play', splash: 'play', ball: 'play', cling: 'climb', build: 'build', fork: 'nap', curl: 'nap', hug: 'climb' }[k.activity === 'gather' ? 'build' : anim] ?? 'sit'}`);
      view.tagEl.classList.toggle('thinking', k.thinking);
    }
  }

  // A little notice board by the clearing, showing how many tickets wait for the visitor.
  #ticketBoard(open) {
    if (!this.board) {
      const g = new THREE.Group();
      const x = -2.2;
      const z = 4.8;
      g.position.set(x, this.groundY(x, z), z);
      g.rotation.y = 0.5;
      const wood = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.85 });
      for (const px of [-0.45, 0.45]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6), wood);
        post.position.set(px, 0.65, 0);
        g.add(post);
      }
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.06), new THREE.MeshStandardMaterial({ color: '#c9a77c', roughness: 0.9 }));
      panel.position.y = 1.05;
      g.add(panel);
      this.boardNotes = [];
      for (let i = 0; i < 6; i++) {
        const note = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.22), new THREE.MeshStandardMaterial({ color: '#f6efd8', roughness: 1 }));
        note.position.set(-0.38 + (i % 3) * 0.38, 1.16 - Math.floor(i / 3) * 0.28, 0.035);
        note.rotation.z = (i % 2 ? 1 : -1) * 0.08;
        g.add(note);
        this.boardNotes.push(note);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const el = document.createElement('div');
      el.className = 'ticket-board';
      const label = new CSS2DObject(el);
      label.position.y = 1.75;
      g.add(label);
      this.boardEl = el;
      this.scene.add(g);
      this.board = g;
    }
    this.boardNotes.forEach((n, i) => (n.visible = i < open));
    this.boardEl.textContent = open ? `${open} ticket${open === 1 ? '' : 's'} for you` : 'Ticket board';
    this.boardEl.classList.toggle('none', !open);
  }

  #carry(view, list) {
    const key = list.join(',');
    if (view.carryKey === key) return;
    view.carryKey = key;
    view.carry.clear();
    list.slice(0, 4).forEach((r, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.18), new THREE.MeshStandardMaterial({ color: RESOURCE_COLORS[r], roughness: 0.8 }));
      m.position.set((i % 2 ? 0.12 : -0.12), Math.floor(i / 2) * 0.17, 0);
      m.castShadow = true;
      view.carry.add(m);
    });
  }

  #faceFor(k, spot) {
    const p = this.places[k.place];
    if (!p) return null;
    const toward = (x, z) => Math.atan2(x - spot.x, z - spot.z);
    if (p.tree && (k.activity === 'climb' || k.activity === 'eat' || k.activity === 'nap')) return toward(p.x, p.z);
    if (k.place === 'pond') return toward(p.x, p.z);
    if (k.place === 'swing' && k.activity === 'play') return 0;
    if (p.build && k.activity === 'build') return toward(p.x, p.z);
    return null;
  }

  onLog(e) {
    if (e.kind === 'built' || e.kind === 'land') {
      const p = this.places[e.target];
      if (p) {
        const y = this.groundY(p.x, p.z);
        this.fx.sparkle(p.x, y + 1.2, p.z, 40, e.kind === 'land' ? [0.7, 1, 0.8] : [1, 0.9, 0.5]);
        this.fx.hearts(p.x, y + 2, p.z, 4);
      }
    }
    const view = this.koalas.get(e.koala);
    if (!view) return;
    if (e.kind === 'say') view.say(e.text);
    if (e.kind === 'think') view.thought(e.text);
    const at = V(view.pos.x, view.pos.y + this.groundY(view.pos.x, view.pos.z) + 1.9 * view.size, view.pos.z);
    if (e.kind === 'grow') {
      this.fx.sparkle(at.x, at.y - 0.4, at.z, 30, [1, 0.9, 0.5]);
      this.fx.hearts(at.x, at.y, at.z, 5);
    }
    if (e.kind === 'visitor' && e.action === 'give') this.fx.sparkle(at.x, at.y - 0.3, at.z, 16);
    if (e.kind === 'visitor' && e.action === 'pet') this.fx.hearts(at.x, at.y, at.z, 4);
    if (e.kind === 'visitor' && e.action === 'say') this.fx.sparkle(at.x, at.y, at.z, 5, [0.7, 0.9, 1]);
    if (e.kind === 'act' && e.action === 'give') this.fx.sparkle(at.x, at.y - 0.4, at.z, 10, [0.7, 1, 0.8]);
  }

  select(id) {
    this.selected = id;
    for (const [kid, v] of this.koalas) v.tagEl.classList.toggle('selected', kid === id);
  }

  // Walk the visitor up to a koala (used when giving, saying or patting).
  visit(id) {
    const v = this.koalas.get(id);
    if (!v) return;
    const me = this.visitor.root.position;
    const dx = me.x - v.pos.x;
    const dz = me.z - v.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 2.6) return;
    this.visitor.target = { x: v.pos.x + (dx / d) * 1.9, z: v.pos.z + (dz / d) * 1.9 };
  }

  #ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  #koalaAt(e) {
    this.raycaster.setFromCamera(this.#ndc(e), this.camera);
    const roots = [...this.koalas.values()].map((v) => v.root);
    return this.raycaster.intersectObjects(roots, true).find((h) => h.object.userData.koala)?.object.userData.koala ?? null;
  }

  #hover(e) {
    const id = this.#koalaAt(e);
    if (id !== this.hover) {
      this.hover = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    }
  }

  pick(e) {
    const id = this.#koalaAt(e);
    if (id) return this.onPick(id);
    this.raycaster.setFromCamera(this.#ndc(e), this.camera);
    const g = this.raycaster.intersectObject(this.ground, false)[0];
    if (g) this.visitor.target = { x: g.point.x, z: g.point.z };
  }

  // --- each frame ----------------------------------------------------------------------
  update(dt, t) {
    shared.uTime.value = t;
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-3), 0.05);
    if (this.pref === 'auto') {
      const act = this.governor.sample(dt, this.step > 0);
      if (act === 'down' && this.step < this.ladder.length - 1) this.#step(1);
      else if (act === 'up') this.#step(-1);
    }
    const frac = (this.clockFrac + (this.clockAt ? (performance.now() - this.clockAt) / DAY_MS : 0)) % 1;
    this.#daylight(frac, t);
    this.#visitor_(dt, t);
    this.#koalas_(dt, t);
    this.#toys(dt, t);
    this.buildLayer.update(dt, t, this.night ?? 0);
    this.critters.update(dt, t, this.night ?? 0);
    this.#life(dt, t);
    this.#camera(dt);
    if (!this.freeCam && this.cam === 'third') this.controls.update();
    this.post.render(dt);
    this.labels.render(this.scene, this.camera);
  }

  #step(dir) {
    this.step = Math.max(0, Math.min(this.ladder.length - 1, this.step + dir));
    const before = this.tier;
    this.#applyTier();
    this.resize();
    this.onTierChange?.({ tier: this.tier, scale: this.scale, from: before });
  }

  #daylight(frac, t) {
    const pal = skyAt(frac);
    const sky = this.sky;
    sky.update({ frac, day: this.clockDay, time: t, palette: pal, quality: this.tier });
    const el = sky.sunDir.y;
    const day = 1 - pal.night;
    const sunUp = smooth(-0.07, 0.14, el);
    const moonW = 1 - sunUp;
    // one shadow-casting key light: the sun by day, the moon by night, and a brief overhead
    // twilight in between, so shadows never snap
    const kd = sky.sunDir.clone().multiplyScalar(sunUp).addScaledVector(sky.moonDir, moonW);
    kd.y += Math.sin(Math.PI * moonW) * 0.7;
    kd.y = Math.max(kd.y, 0.16);
    kd.normalize();
    this.sun.position.copy(kd).multiplyScalar(90);
    this.sun.target.position.set(0, 0, 0);
    const warm = 1 - smooth(0.0, 0.2, el);
    const sunCol = new THREE.Color().setRGB(1, lerp(0.96, 0.62, warm), lerp(0.88, 0.38, warm));
    const sunI = 4.2 * smooth(-0.02, 0.24, el) + 0.35 * smooth(-0.1, 0.0, el);
    const moonI = 0.7 * pal.night * (0.45 + 0.55 * Math.sin(this.sky.u.uPhase.value * Math.PI));
    this.sun.intensity = lerp(moonI, sunI, sunUp);
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0.62, 0.74, 1), moonW);
    this.hemi.intensity = 0.05 + 0.38 * day; // less sky fill, so the sun reads as the key light
    this.hemi.color.setRGB(...pal.top, THREE.SRGBColorSpace);
    this.fill.intensity = 0.05 + 0.55 * day;
    this.fill.color.setRGB(...pal.top.map((v) => 0.8 + v * 0.2), THREE.SRGBColorSpace);
    this.scene.fog.color.setRGB(...pal.bottom, THREE.SRGBColorSpace);
    this.scene.fog.density = 0.0066 + pal.night * 0.0016;
    this.renderer.toneMappingExposure = 0.9 + 0.38 * day;
    this.shroomMat.emissiveIntensity = pal.night * 2.2;
    this.lanternLight.intensity = pal.night * 8;
    this.lanternGlass.material.emissiveIntensity = 0.5 + pal.night * 4.5; // bright enough to bloom
    this.ambient.u.uTime.value = t;
    this.ambient.u.uNight.value = pal.night;
    this.ambient.u.uDay.value = day * smooth(0.0, 0.25, el);
    // golden hour: low warm sun, the air full of glinting dust
    this.ambient.u.uGolden.value = day * (1 - smooth(0.12, 0.45, el)) * smooth(0.0, 0.08, el);
    this.ambient.u.uScale.value = this.pxScale;
    this.night = pal.night;
    this.sunUp = sunUp;
    const tw = this.sky.u.uTwilight.value;
    this.post.look({
      tint: new THREE.Color(1, 1, 1).lerp(new THREE.Color(1.07, 0.97, 0.86), tw * 0.8).lerp(new THREE.Color(0.86, 0.93, 1.06), pal.night * 0.6),
      night: pal.night,
      grade: gradeAt(frac),
    });
    for (const b of this.blobs) b.mesh.material.opacity = 0.35 + 0.35 * day * sunUp + 0.12;
    this.sky.updateEnv(performance.now(), this.envEvery);
  }

  #visitor_(dt, t) {
    const v = this.visitor;
    const p = v.root.position;
    let mx = 0;
    let mz = 0;
    {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      if (f || s) {
        v.target = null;
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        mx = fwd.x * f + right.x * s;
        mz = fwd.z * f + right.z * s;
      }
    }
    if (v.target) {
      const dx = v.target.x - p.x;
      const dz = v.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) v.target = null;
      else {
        mx = dx / d;
        mz = dz / d;
      }
    }
    const len = Math.hypot(mx, mz);
    const before = { x: p.x, z: p.z };
    if (len > 0) {
      const speed = (this.keys.has('shift') ? 6 : 3.4) * dt;
      p.x += (mx / len) * speed;
      p.z += (mz / len) * speed;
      const want = Math.atan2(mx, mz);
      let d = want - v.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.heading += d * Math.min(1, dt * 10);
    }
    // Stay on the island, out of the pond and out of the tree trunks.
    const heightAt = (x, z) => this.buildLayer.heightAt(x, z);
    const offIsland = !walkable(p, heightAt, ISLAND);
    if (offIsland && walkable(before, heightAt, ISLAND)) {
      p.x = before.x; // the edge of the island, new land or a bridge: stay on it
      p.z = before.z;
    } else if (offIsland) {
      const r = Math.hypot(p.x, p.z);
      p.x *= (ISLAND - 1) / r;
      p.z *= (ISLAND - 1) / r;
    }
    const pushOut = (cx, cz, rad) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < rad && d > 0.001) {
        p.x = cx + (dx / d) * rad;
        p.z = cz + (dz / d) * rad;
      }
    };
    const pond = this.places.pond;
    pushOut(pond.x, pond.z, SHORE_R + 0.2);
    for (const id of Object.keys(this.trees ?? {})) pushOut(this.places[id].x, this.places[id].z, 0.95);
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    v.walk += moved * 3;
    v.moving = moved > 0.0005;
    p.y = this.groundY(p.x, p.z);
    v.body.position.y = 0.72 + (moved > 0 ? Math.abs(Math.sin(v.walk)) * 0.07 : 0);
    v.lantern.rotation.z = Math.sin(v.walk) * 0.2;
    v.root.rotation.y = v.heading;
  }

  #koalas_(dt, t) {
    const vp = this.visitor.root.position;
    const list = [...this.koalas.values()];
    const pushes = shared.uPush.value;
    list.forEach((v, i) => {
      if (v.face == null && !v.moving && v.pos.y < 0.05) {
        const f = list.find((o) => o !== v); // undefined in a solo grove
        const df = f ? Math.hypot(f.pos.x - v.pos.x, f.pos.z - v.pos.z) : Infinity;
        const dv = Math.hypot(vp.x - v.pos.x, vp.z - v.pos.z);
        const look = dv < 4 && !['sleep', 'fork', 'curl'].includes(v.anim) ? vp : df < 7 ? f.pos : { x: v.pos.x * 1.5, z: v.pos.z * 1.5 + 4 };
        const want = Math.atan2(look.x - v.pos.x, look.z - v.pos.z);
        let d = want - v.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.heading += d * Math.min(1, dt * 2.5);
      }
      v.update(dt, t);
      const gy = this.groundY(v.pos.x, v.pos.z);
      pushes[i].set(v.pos.x, 0, v.pos.z, v.pos.y < 0.3 ? 1.25 : 0);
      if (v.stepped) this.fx.dust(v.pos.x, gy, v.pos.z, 0.8);
      const head = V(v.pos.x, v.pos.y + gy + 2.0 * v.size, v.pos.z);
      if (v.anim === 'eat' && v.arrived && (this.fxTimers.eat += dt) > 0.4) {
        this.fxTimers.eat = 0;
        this.fx.crumb(v.pos.x + Math.sin(v.heading) * 0.45, v.pos.y + gy + 1.35 * v.size, v.pos.z + Math.cos(v.heading) * 0.45 * v.size);
      }
      if (v.anim === 'splash' && v.arrived) {
        if ((this.fxTimers.splash += dt) > 0.14) {
          this.fxTimers.splash = 0;
          const px = v.pos.x + Math.sin(v.heading) * 1.1;
          const pz = v.pos.z + Math.cos(v.heading) * 1.1;
          for (let k = 0; k < 3; k++) this.fx.droplet(px, WATER_Y + 0.1, pz);
        }
        if (Math.random() < dt * 1.8) this.ripple(v.pos.x + Math.sin(v.heading) * 1.2, v.pos.z + Math.cos(v.heading) * 1.2);
      }
      if (v.thinking && (this.fxTimers.nut += dt) > 0.07) {
        this.fxTimers.nut = 0;
        this.fx.gumnut(v.pos.x + Math.cos(t * 3) * 0.75, head.y + Math.sin(t * 5) * 0.08, v.pos.z + Math.sin(t * 3) * 0.75);
      }
    });
    pushes[2].set(vp.x, 0, vp.z, 0); // the visitor is not drawn, so it parts no grass either
    // contact blobs under the koalas
    const who = this.blobs;
    who.forEach(({ mesh, who: w }) => {
      const isK = w.pos !== undefined;
      const x = isK ? w.pos.x : w.root.position.x;
      const z = isK ? w.pos.z : w.root.position.z;
      const h = isK ? w.pos.y : 0;
      mesh.position.set(x, this.groundY(x, z) + 0.035, z);
      const s = (isK ? 1.7 * w.size : 1.3) * (1 + h * 0.15);
      mesh.scale.set(s, s, 1);
      mesh.visible = isK && h < 1.4 && w.anim !== 'swing';
    });
    // selection and hover ring
    const target = this.koalas.get(this.selected ?? this.hover);
    this.ring.visible = !!target;
    if (target) {
      const x = target.pos.x;
      const z = target.pos.z;
      this.ring.position.set(x, this.groundY(x, z) + 0.05, z);
      const pulse = 1 + Math.sin(t * 3.2) * 0.05;
      const sel = this.selected === target.id;
      this.ring.scale.setScalar(pulse * (sel ? 1.15 : 0.95) * (0.4 + 0.6 * target.size));
      this.ring.material.opacity = sel ? 0.95 : 0.4;
    }
  }

  #toys(dt, t) {
    this.seats.forEach((seat, i) => {
      const id = i === 0 ? 'crystal' : 'ruby';
      const v = this.koalas.get(id);
      const on = v && v.anim === 'swing' && v.arrived;
      const want = on ? Math.sin(t * 2.2 + (id === 'crystal' ? 0 : 1.4)) * 0.2 : 0;
      seat.rotation.x = damp(seat.rotation.x, want, 6, dt);
    });
    const gy = (x, z) => this.groundY(x, z);
    const players = [...this.koalas.values()].filter((v) => v.anim === 'ball' && v.arrived);
    const front = (v) => V(v.pos.x + Math.sin(v.heading) * 0.75, gy(v.pos.x, v.pos.z) + 0.3, v.pos.z + Math.cos(v.heading) * 0.75);
    const b = this.ball;
    if (players.length === 2) {
      const per = 1.6;
      const u = (t % per) / per;
      const flip = Math.floor(t / per) % 2;
      const [a, c] = flip ? [front(players[1]), front(players[0])] : [front(players[0]), front(players[1])];
      const want = a.lerp(c, u);
      want.y += Math.sin(u * Math.PI) * 1.6;
      b.position.copy(want);
    } else if (players.length === 1) {
      const want = front(players[0]);
      want.y += 0.2 + Math.abs(Math.sin(t * 3)) * 1.5;
      b.position.copy(want);
    } else {
      b.position.x = damp(b.position.x, this.ballRest.x, 2, dt);
      b.position.z = damp(b.position.z, this.ballRest.z, 2, dt);
      b.position.y = damp(b.position.y, gy(b.position.x, b.position.z) + 0.3, 6, dt);
    }
    if (players.length && b.position.y < gy(b.position.x, b.position.z) + 0.34 && Math.random() < dt * 4) this.fx.dust(b.position.x, gy(b.position.x, b.position.z), b.position.z, 0.5);
    b.rotation.x += dt * (players.length ? 6 : 0.2);
    for (const r of this.ripples) if (r.z < 1) r.z = Math.min(1, r.z + dt * 0.7);
    animatePond(this.props, t, this.terrain);
  }

  #life(dt, t) {
    this.fx.update(dt, this.pxScale);
    if (this.reduced) return;
    // gum leaves loosen and drift down from the big trees by day
    if ((this.fxTimers.leaf += dt) > 0.45 && this.night < 0.6) {
      this.fxTimers.leaf = 0;
      const ids = Object.keys(this.trees ?? {});
      const p = this.places[ids[Math.floor(Math.random() * ids.length)]];
      if (p) this.fx.leaf(p.x + (Math.random() - 0.5) * 5, 5 + Math.random() * 3, p.z + (Math.random() - 0.5) * 5, [0.38, 0.55, 0.4]);
    }
    const sunny = this.night < 0.4 && this.sky.sunDir.y > 0.05;
    this.butterflies.forEach((b, i) => {
      if (!b.group.visible) return;
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.sin(a) * 3.2 + Math.sin(a * 2.3) * 0.8;
      const z = b.cz + Math.cos(a * 0.8) * 3.0;
      const y = this.groundY(x, z) + 0.9 + Math.sin(a * 1.7) * 0.4;
      b.group.position.set(x, y, z);
      b.group.rotation.y = Math.atan2(Math.cos(a) * 3.2, -Math.sin(a * 0.8) * 2.4);
      const flap = 0.15 + Math.abs(Math.sin(t * 17 + b.ph)) * 1.0;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
      b.group.scale.setScalar(sunny ? 1 : 0.0001);
    });
  }

  #camera(dt) {
    if (this.freeCam) return; // dev capture helper: the camera is set by hand
    const v = this.visitor;
    const p = v.root.position;
    if (this.cam === 'first') {
      const bob = v.moving ? Math.sin(v.walk * 2) * 0.03 : 0;
      this.camera.position.set(p.x, p.y + EYE + bob, p.z);
      this.camera.rotation.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
      v.heading = this.look.yaw - Math.PI; // the body faces where the eyes look
    } else {
      const c = this.controls;
      const want = V(p.x, p.y + 1.5, p.z);
      const step = want.sub(c.target).multiplyScalar(1 - Math.exp(-6 * dt));
      c.target.add(step);
      this.camera.position.add(step);
      // while walking, drift round to behind the visitor, like a chase camera
      if (v.moving) {
        const off = this.camera.position.clone().sub(c.target);
        const have = Math.atan2(off.x, off.z);
        let d = v.heading + Math.PI - have;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        off.applyAxisAngle(V(0, 1, 0), d * (1 - Math.exp(-1.6 * dt)));
        this.camera.position.copy(c.target).add(off);
      }
      // never under the lawn
      const floor = this.groundY(this.camera.position.x, this.camera.position.z) + 0.5;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
    }
    // place labels fade with distance, so the view is not buried in text
    this.placeLabels.forEach(({ el, p }) => {
      const d = this.camera.position.distanceTo(p);
      el.style.opacity = String(Math.max(0, Math.min(0.85, (46 - d) / 22)));
    });
  }
}
