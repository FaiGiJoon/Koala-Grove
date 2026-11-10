// Everything that grows: blade grass, eucalypts (hero trees and a forest of instanced
// ones), ferns, bushes, flowers and the sculpted rocks. Geometry is built once at full
// capacity; the quality tier only changes how much of it is drawn.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, ridged, rng } from './noise.js';
import { applyWind } from './materials.js';
import { tube } from './terrain.js';
import { ISLAND, WATER_Y } from './terrain-math.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Double-sided foliage must light both faces the same way, so the normal is not flipped.
function noFlip(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ''}|noflip`;
  return m;
}

function shuffleCards(cards, r) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// --- blade grass ---------------------------------------------------------------------------------
export function bladeGeometry() {
  const segs = 4;
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.05 * (1 - t * 0.75); // a blunter tip, so near blades do not read as spikes
    const z = 0.18 * t * t;
    const g = 0.4 + 0.6 * t;
    if (i < segs) {
      pos.push(-w, t, z, w, t, z);
      nor.push(-0.35, 0.75, 0.55, 0.35, 0.75, 0.55);
      col.push(g, g, g, g, g, g);
    } else {
      pos.push(0, t, z);
      nor.push(0, 0.78, 0.62);
      col.push(g, g, g);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (segs - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export function buildGrass({ terrain, capacity, seed = 12 }) {
  const r = rng(seed);
  const mat = noFlip(applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }), 'clamp(transformed.y, 0.0, 1.0) * length(instanceMatrix[1].xyz)', { key: 'grass' }));
  const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, capacity);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const pond = terrain.pond;
  let n = 0;
  while (n < capacity) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * (ISLAND - 1.3);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    if (terrain.pathMask(cx, cz) > 0.4 || terrain.height(cx, cz) < WATER_Y + 0.04) continue;
    const moist = Math.max(0, 1 - Math.hypot(cx - pond.x, cz - pond.z) / 12); // lusher near the pond
    const clump = 6 + Math.floor(r() * 9);
    const base = c.setHSL(0.225 + r() * 0.07 - moist * 0.015, 0.22 + r() * 0.14, 0.34 + r() * 0.14 + moist * 0.03).clone();
    for (let k = 0; k < clump && n < capacity; k++) {
      const x = cx + (r() - 0.5) * 0.8;
      const z = cz + (r() - 0.5) * 0.8;
      if (terrain.pathMask(x, z) > 0.55 || terrain.height(x, z) < WATER_Y + 0.03) continue;
      const hgt = (0.26 + r() * 0.42) * (0.8 + 0.4 * Math.sin(x * 0.4) * Math.cos(z * 0.35));
      e.set((r() - 0.5) * 0.4, r() * TAU, (r() - 0.5) * 0.4);
      q.setFromEuler(e);
      s.set(0.9 + r() * 0.7, hgt, 0.9 + r() * 0.7);
      p.set(x, terrain.height(x, z) - 0.02, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, c.copy(base).offsetHSL((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.1));
      n++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// --- leaves and canopy -----------------------------------------------------------------------------
export function leafMaterials(tex, { alphaTest = 0.42 } = {}) {
  const leaf = noFlip(applyWind(new THREE.MeshStandardMaterial({
    map: tex.leaf, roughness: 0.58, metalness: 0, side: THREE.DoubleSide, alphaTest, alphaToCoverage: true, vertexColors: true,
  }), 'clamp(-transformed.y, 0.0, 1.4) * 0.9', { key: 'leaf' }));
  const depth = applyWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.leaf, alphaTest, side: THREE.DoubleSide }), 'clamp(-transformed.y, 0.0, 1.4) * 0.9', { key: 'leafdepth' });
  const mass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  return { leaf, depth, mass };
}

// Clusters of drooping leaf cards plus a dark inner mass, as geometry. clusters: [{ pos, size }].
function canopy(clusters, { cards = 9, seed, cardSize = 1 }) {
  const r = rng(seed);
  const list = [];
  const blobs = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  const quad = [[-0.5, 0, 0, 0, 1], [0.5, 0, 0, 1, 1], [0.5, -1, 0, 1, 0], [-0.5, -1, 0, 0, 0]];
  for (const cl of clusters) {
    for (let k = 0; k < cards; k++) {
      const off = V((r() - 0.5) * 1.7, (r() - 0.3) * 1.1, (r() - 0.5) * 1.7).multiplyScalar(cl.size);
      const centre = cl.pos.clone().add(off);
      const w = (1.15 + r() * 0.6) * cl.size * cardSize;
      const h = (1.5 + r() * 0.7) * cl.size * cardSize;
      e.set(0.15 + r() * 0.75, r() * TAU, (r() - 0.5) * 0.6);
      q.setFromEuler(e);
      m.compose(centre, q, sc);
      const outward = off.clone().add(V(0, 0.45 * cl.size, 0)).normalize();
      const shade = 0.78 + r() * 0.3;
      list.push({ m: m.clone(), w, h, outward, shade });
    }
    blobs.push(cl);
  }
  shuffleCards(list, r);
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  const v = new THREE.Vector3();
  list.forEach((c, i) => {
    for (const [x, y, z, u, vv] of quad) {
      v.set(x * c.w, y * c.h, z).applyMatrix4(c.m);
      pos.push(v.x, v.y, v.z);
      nor.push(c.outward.x, c.outward.y, c.outward.z);
      uv.push(u, vv);
      const s = c.shade * (0.82 + 0.18 * (1 + y));
      col.push(s, s, s);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.setIndex(idx);
  // dark, smooth inner mass so the canopy has body and no gaps to see through
  const parts = blobs.map((cl) => {
    const g = new THREE.IcosahedronGeometry(0.3 * cl.size, 1);
    g.deleteAttribute('uv');
    const welded = mergeVertices(g, 1e-4);
    welded.computeVertexNormals();
    welded.scale(1, 0.72, 1);
    welded.translate(cl.pos.x, cl.pos.y - 0.12 * cl.size, cl.pos.z);
    const n = welded.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lo = welded.attributes.position.getY(i) - (cl.pos.y - 0.12 * cl.size);
      const s = 0.8 + 0.2 * Math.min(1, Math.max(0, (lo / cl.size + 0.5)));
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
    }
    welded.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return welded;
  });
  const mass = mergeGeometries(parts);
  return { leaves, mass, cards: list.length };
}

// A trunk lofted along a path with a radius profile (root flare, taper, bark flutes).
function loft(points, radiusAt, radial = 12, vLen = 2.2) {
  const rows = points.length;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  let run = 0;
  const up = V(0, 1, 0);
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    if (i) run += points[i].distanceTo(points[i - 1]);
    const tan = points[Math.min(rows - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    const side = new THREE.Vector3().crossVectors(up, tan).normalize();
    const fwd = new THREE.Vector3().crossVectors(tan, side).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const rr = radiusAt(t, a, run);
      pos.push(points[i].x + (side.x * Math.cos(a) + fwd.x * Math.sin(a)) * rr, points[i].y + (side.y * Math.cos(a) + fwd.y * Math.sin(a)) * rr, points[i].z + (side.z * Math.cos(a) + fwd.z * Math.sin(a)) * rr);
      uv.push((j / radial) * 3, run / vLen);
      const ao = 0.66 + 0.34 * Math.min(1, run / 0.9);
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// One eucalypt as three geometries. trunkR is the radius at the base; the radius at 2.7 m up
// is close to 0.45 so a koala clinging there sits against the bark.
export function eucalypt({ seed, height = 7, trunkR = 0.58, lean = 0.4, branches = 8, clusters = 24, cards = 16 }) {
  const r = rng(seed);
  const lean0 = r() * TAU;
  const centre = (t) => V(Math.cos(lean0) * lean * t * t * height * 0.1 + (fbm(t * 3, seed, { octaves: 2 }) - 0.5) * 0.12 * t, t * height, Math.sin(lean0) * lean * t * t * height * 0.1);
  const path = Array.from({ length: 27 }, (_, i) => centre(i / 26));
  const radiusAt = (t, a, run) => trunkR * (1 - 0.66 * t) * (1 + 0.75 * Math.exp(-run * 1.7)) * (1 + 0.045 * Math.sin(a * 3 + t * 6) + 0.03 * Math.sin(a * 7 - t * 3));
  const parts = [loft(path, radiusAt)];
  const cl = [];
  const radiusNow = (t) => trunkR * (1 - 0.66 * t);
  for (let b = 0; b < branches; b++) {
    const t0 = 0.4 + r() * 0.45;
    const a = (b / branches) * TAU + r() * 0.7;
    const el = 0.3 + r() * 0.45;
    const len = height * (0.17 + r() * 0.16);
    const start = centre(t0).add(V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(radiusNow(t0) * 0.5));
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      pts.push(start.clone().add(V(Math.cos(a) * Math.cos(el) * len * u, Math.sin(el) * len * u * (1 - 0.35 * u) - u * u * len * 0.18, Math.sin(a) * Math.cos(el) * len * u)));
    }
    parts.push(tube(pts, Math.max(0.05, radiusNow(t0) * 0.42), 0.03, 5, len / 2.4, true));
    cl.push({ pos: pts[8].clone().add(V(0, -0.2, 0)), size: 1.15 + r() * 0.5 });
    cl.push({ pos: pts[5].clone().add(V(0, -0.1, 0)), size: 0.95 + r() * 0.4 });
    // a twig off the middle
    const tw = [];
    const ta = a + (r() - 0.5) * 1.4;
    for (let k = 0; k <= 4; k++) tw.push(pts[4].clone().add(V(Math.cos(ta) * k * 0.55, k * 0.22 - k * k * 0.04, Math.sin(ta) * k * 0.55)));
    parts.push(tube(tw, 0.045, 0.02, 4, 1, true));
    cl.push({ pos: tw[4].clone(), size: 0.85 + r() * 0.3 });
  }
  const top = centre(1);
  cl.push({ pos: top.clone().add(V(0, 0.7, 0)), size: 1.7 }, { pos: top.clone().add(V(0.9, -0.3, 0.5)), size: 1.35 }, { pos: top.clone().add(V(-0.8, -0.4, -0.5)), size: 1.3 });
  while (cl.length < clusters) cl.push({ pos: cl[Math.floor(r() * cl.length)].pos.clone().add(V((r() - 0.5) * 1.8, (r() - 0.4) * 1.2, (r() - 0.5) * 1.8)), size: 0.9 + r() * 0.4 });
  const c = canopy(cl.slice(0, clusters), { cards, seed: seed + 3 });
  return { bark: mergeGeometries(parts), leaves: c.leaves, mass: c.mass, cards: c.cards, height };
}

// Instanced trees from one eucalypt shape. instances: [{ x, y, z, yaw, scale, bark: Color, leaf: Color }].
export function treeMeshes({ shape, instances, mats, barkMat, leafFactor = 1, castLeaves = true }) {
  const group = new THREE.Group();
  const n = instances.length;
  const mk = (geo, mat) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  };
  const bark = mk(shape.bark, barkMat);
  const leaves = mk(shape.leaves, mats.leaf);
  const mass = mk(shape.mass, mats.mass);
  if (castLeaves) leaves.customDepthMaterial = mats.depth;
  else leaves.castShadow = false;
  leaves.userData.cards = shape.cards;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = V(0, 1, 0);
  instances.forEach((t, i) => {
    q.setFromAxisAngle(up, t.yaw);
    mtx.compose(V(t.x, t.y, t.z), q, V(t.scale, t.scale, t.scale));
    for (const mesh of [bark, leaves, mass]) mesh.setMatrixAt(i, mtx);
    bark.setColorAt(i, t.bark);
    leaves.setColorAt(i, t.leaf);
    mass.setColorAt(i, t.leaf.clone().multiplyScalar(0.8));
  });
  for (const mesh of [bark, leaves, mass]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
  group.add(bark, leaves, mass);
  group.userData = { leaves, setLeafFactor: (f) => leaves.geometry.setDrawRange(0, Math.max(6, Math.floor((shape.cards * f) | 0) * 6)) };
  group.userData.setLeafFactor(leafFactor);
  return group;
}

// --- rocks ------------------------------------------------------------------------------------
export function rockGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    const k = v.clone();
    const d = 1 + (fbm(k.x * 1.5 + seed, k.y * 1.4 + k.z * 1.2, { octaves: 3, seed }) - 0.5) * 0.7 + (ridged(k.x * 2.2 + seed, k.z * 2.2 + k.y, { octaves: 2, seed: seed + 9 }) - 0.5) * 0.18;
    v.multiplyScalar(d);
    v.set(v.x * 1.12, v.y * (v.y < -0.2 ? 0.5 : 0.78), v.z * 0.95);
    p.setXYZ(i, v.x, v.y, v.z);
    const ax = Math.abs(k.x);
    const ay = Math.abs(k.y);
    const az = Math.abs(k.z);
    if (ay >= ax && ay >= az) uv[i * 2] = v.x * 0.5, uv[i * 2 + 1] = v.z * 0.5;
    else if (ax >= az) uv[i * 2] = v.z * 0.5, uv[i * 2 + 1] = v.y * 0.5;
    else uv[i * 2] = v.x * 0.5, uv[i * 2 + 1] = v.y * 0.5;
    const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (k.y + 0.45) / 1.1));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function rockMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normal, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 0.92, metalness: 0 });
}

// --- ferns and bushes -------------------------------------------------------------------------------
function frondGeometry() {
  const fronds = 7;
  const geos = [];
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * TAU + (f % 2) * 0.2;
    const len = 0.75 + (f % 3) * 0.12;
    const segs = 6;
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const out = t * len;
      const y = 0.12 + Math.sin(t * Math.PI * 0.62) * 0.4 * len - t * t * 0.18;
      const w = 0.2 * (1 - t * 0.55);
      const cx = Math.cos(yaw) * out;
      const cz = Math.sin(yaw) * out;
      const sx = -Math.sin(yaw);
      const sz = Math.cos(yaw);
      pos.push(cx - sx * w, y, cz - sz * w, cx + sx * w, y, cz + sz * w);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(0, 1 - t, 1, 1 - t);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    geos.push(g);
  }
  const g = mergeGeometries(geos);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0.55 + 0.45 * Math.min(1, g.attributes.position.getY(i) / 0.5);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function fernMesh({ spots, tex, terrain, seed = 33 }) {
  const mat = noFlip(applyWind(new THREE.MeshStandardMaterial({
    map: tex.leaf, roughness: 0.6, side: THREE.DoubleSide, alphaTest: 0.42, alphaToCoverage: true, vertexColors: true,
  }), 'clamp(transformed.y, 0.0, 1.0) * 0.8', { key: 'fern' }));
  const mesh = new THREE.InstancedMesh(frondGeometry(), mat, spots.length);
  const r = rng(seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(V(0, 1, 0), r() * TAU);
    const k = 0.8 + r() * 0.8;
    m.compose(V(s.x, terrain.height(s.x, s.z) - 0.02, s.z), q, V(k, k * (0.8 + r() * 0.4), k));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHSL(0.27 + r() * 0.05, 0.4, 0.28 + r() * 0.1));
  });
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// Low shrubs: a few dark masses with cards on them, instanced.
export function bushShape(seed) {
  const r = rng(seed);
  const cl = Array.from({ length: 5 }, () => ({ pos: V((r() - 0.5) * 1.1, 0.35 + r() * 0.35, (r() - 0.5) * 1.1), size: 0.55 + r() * 0.25 }));
  return canopy(cl, { cards: 18, seed: seed + 1, cardSize: 0.95 });
}

// --- flowers -------------------------------------------------------------------------------------
function petalGeometry() {
  const geos = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const g = new THREE.BufferGeometry();
    const l = 0.11;
    const w = 0.055;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p = [[0, 0, 0], [-sa * w, 0.025, ca * w], [ca * l, 0.045, sa * l], [sa * w, 0.025, -ca * w]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

export function flowerMeshes({ spots, terrain, seed = 44, palette, size = 1 }) {
  const r = rng(seed);
  const n = spots.length;
  const petalMat = noFlip(applyWind(new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide, emissive: '#000', emissiveIntensity: 0 }), '0.45', { key: 'petal' }));
  const centreMat = applyWind(new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.6 }), '0.45', { key: 'centre' });
  const stemMat = applyWind(new THREE.MeshStandardMaterial({ color: '#5f8a3e', roughness: 0.8 }), '(transformed.y + 0.5) * length(instanceMatrix[1].xyz) * 1.7', { key: 'stem' });
  const petals = new THREE.InstancedMesh(petalGeometry(), petalMat, n);
  const centres = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 8, 6), centreMat, n);
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.016, 1, 4), stemMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    const h = (0.28 + r() * 0.34) * size;
    const y = terrain.height(s.x, s.z);
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.25, r() * TAU, (r() - 0.5) * 0.25));
    m.compose(V(s.x, y + h, s.z), q, V((0.85 + r() * 0.5) * size, size, (0.85 + r() * 0.5) * size));
    petals.setMatrixAt(i, m);
    m.compose(V(s.x, y + h + 0.02 * size, s.z), q, V(size, size, size));
    centres.setMatrixAt(i, m);
    m.compose(V(s.x, y + h / 2, s.z), q, V(1, h, 1));
    stems.setMatrixAt(i, m);
    petals.setColorAt(i, c.set(palette[Math.floor(r() * palette.length)]));
  });
  for (const mesh of [petals, centres, stems]) {
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
  }
  petals.instanceColor.needsUpdate = true;
  petals.castShadow = true;
  return [stems, petals, centres];
}
