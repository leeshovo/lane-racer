/*
 * cars.js – prozedurale Fahrzeuge (Spielerautos, Verkehr, Geister, Namensschilder).
 *
 * Aufbau eines Fahrzeugs:
 *   object (THREE.Group, Ursprung = Bodenmitte, Front zeigt nach -Z)
 *     ├── body (THREE.Group)   – alles, was federt/wippt
 *     │     ├── Karosserie-Meshes (pro Material-Rolle zu EINEM Mesh verschmolzen)
 *     │     └── Sonderteile (Blaulicht, Nitro-Flammen, Scheinwerferkegel …)
 *     ├── Räder (direkt an der Wurzel, drehen um ihre lokale X-Achse)
 *     └── Unterbodenlicht (bleibt am Boden, wippt nicht mit)
 *
 * Performance: Geometrien werden pro Modell EINMAL gebaut ("Blueprint") und nach
 * Material-Rolle verschmolzen, Materialien pro Farbe gecacht. Das Erzeugen eines
 * Verkehrsfahrzeugs besteht danach nur noch aus ein paar `new THREE.Mesh(...)`.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAFFIC, carById } from './config.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ===========================================================================
// 1 – Geometrie-Cache (Bausteine)
// ===========================================================================

const geoCache = new Map();

/**
 * Alle Bausteine werden ohne Index abgelegt: RoundedBoxGeometry liefert
 * nicht-indizierte Daten, alle anderen Primitive indizierte – `mergeGeometries`
 * verlangt aber einheitliche Attribute. Deshalb hier einmalig vereinheitlichen.
 */
function cachedGeo(key, factory) {
  let g = geoCache.get(key);
  if (g === undefined) {
    g = factory();
    if (g.index !== null) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    geoCache.set(key, g);
  }
  return g;
}

/** Abgerundeter Quader – die Grundform aller Karosserien. */
const RB = (w, h, d, r = 0.12, s = 2) =>
  cachedGeo(`rb|${w}|${h}|${d}|${r}|${s}`, () => new RoundedBoxGeometry(w, h, d, s, r));
const BX = (w, h, d) => cachedGeo(`bx|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const CY = (rt, rb, h, s, open = false) =>
  cachedGeo(`cy|${rt}|${rb}|${h}|${s}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
const CN = (r, h, s, open = true) =>
  cachedGeo(`cn|${r}|${h}|${s}|${open}`, () => new THREE.ConeGeometry(r, h, s, 1, open));
const SP = (r, s) => cachedGeo(`sp|${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.max(4, s >> 1)));
const PL = (w, h) => cachedGeo(`pl|${w}|${h}`, () => new THREE.PlaneGeometry(w, h));
const TO = (r, t, rs, ts) => cachedGeo(`to|${r}|${t}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));

// Wiederverwendete Temporärobjekte – keine Allokationen im Bau-/Frame-Pfad.
const _mtx = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _eul = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

/** Geometrie klonen und an ihren Platz schieben/drehen/skalieren. */
function xf(geometry, pos, rot, scale) {
  const g = new THREE.BufferGeometry().copy(geometry);
  _pos.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
  _eul.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  _quat.setFromEuler(_eul);
  _scl.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
  g.applyMatrix4(_mtx.compose(_pos, _quat, _scl));
  return g;
}

function mergeList(list) {
  if (list.length === 1) return list[0];
  return mergeGeometries(list, false) || list[0];
}

// ===========================================================================
// 2 – Material-Cache
// ===========================================================================

const matCache = new Map();
function cachedMat(key, factory) {
  let m = matCache.get(key);
  if (m === undefined) { m = factory(); matCache.set(key, m); }
  return m;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function safeColor(value, fallback) {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : fallback;
}

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

/** Relative Helligkeit (linear) – entscheidet über hellen/dunklen Kontrast. */
function luminance(hex) {
  _c.set(hex);
  return 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b;
}

/** Kontrastfarbe für Rennstreifen & Zierteile. */
function contrastColor(hex) {
  return luminance(hex) > 0.16 ? '#12161d' : '#eef2f8';
}

/** Leuchtfähige Variante einer Lackfarbe (dunkle Lacke würden sonst nicht glühen). */
function neonColor(hex) {
  _c.set(hex);
  _c.getHSL(_hsl);
  _c.setHSL(_hsl.h, Math.max(0.75, _hsl.s), Math.max(0.55, Math.min(0.72, _hsl.l)));
  return '#' + _c.getHexString();
}

/** Klarlack-Optik: PBR-Lack mit Clearcoat. */
const matPaint = (hex) => cachedMat(`paint|${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(hex), metalness: 0.42, roughness: 0.30,
  clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 1.15,
}));

/** Mattes Zierteil (Streifen, Aufkleber, Ladefläche). */
const matTrim = (hex) => cachedMat(`trim|${hex}`, () => new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(hex), metalness: 0.25, roughness: 0.42,
  clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 1.0,
}));

/** Leuchtender Zierstreifen (Neon GT, Schwebe-Triebwerke). */
const matNeon = (hex) => cachedMat(`neon|${hex}`, () => new THREE.MeshStandardMaterial({
  color: new THREE.Color(hex), emissive: new THREE.Color(hex), emissiveIntensity: 3.0,
  metalness: 0.2, roughness: 0.3, toneMapped: true,
}));

/** Additives Leuchten (Unterboden, Triebwerke, Nitro-Flammen, Lichtkegel). */
const matGlow = (hex, opacity) => cachedMat(`glow|${hex}|${opacity}`, () => new THREE.MeshBasicMaterial({
  color: new THREE.Color(hex), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
}));

/** Durchscheinendes Geisterauto (Party-Freunde). */
const matGhost = (hex) => cachedMat(`ghost|${hex}`, () => new THREE.MeshStandardMaterial({
  color: new THREE.Color(hex), emissive: new THREE.Color(hex), emissiveIntensity: 0.55,
  metalness: 0.1, roughness: 0.45, transparent: true, opacity: 0.4,
  depthWrite: false, side: THREE.DoubleSide,
}));

// Geteilte Einzelmaterialien (lazy, damit nichts beim Import entsteht).
const MAT = {
  dark: () => cachedMat('dark', () => new THREE.MeshStandardMaterial({ color: 0x141821, metalness: 0.55, roughness: 0.55 })),
  chrome: () => cachedMat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xd3d9e2, metalness: 1, roughness: 0.16, envMapIntensity: 1.5 })),
  glass: () => cachedMat('glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x0c1520, metalness: 0.2, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04,
    transparent: true, opacity: 0.62, envMapIntensity: 2.0,
  })),
  tire: () => cachedMat('tire', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.0, roughness: 0.92 })),
  rim: () => cachedMat('rim', () => new THREE.MeshStandardMaterial({ color: 0xb6bdc9, metalness: 0.95, roughness: 0.26, envMapIntensity: 1.4 })),
  headOff: () => cachedMat('headOff', () => new THREE.MeshStandardMaterial({
    color: 0xdfeaff, emissive: 0x9dc6ff, emissiveIntensity: 0.5, metalness: 0.1, roughness: 0.12,
  })),
  headOn: () => cachedMat('headOn', () => new THREE.MeshStandardMaterial({
    color: 0xdfeaff, emissive: 0xcfe4ff, emissiveIntensity: 4.2, metalness: 0.1, roughness: 0.12,
  })),
  tail: () => cachedMat('tail', () => new THREE.MeshStandardMaterial({
    color: 0x3a060b, emissive: 0xff1b26, emissiveIntensity: 2.0, metalness: 0.1, roughness: 0.3,
  })),
  tailNight: () => cachedMat('tailNight', () => new THREE.MeshStandardMaterial({
    color: 0x3a060b, emissive: 0xff1b26, emissiveIntensity: 3.2, metalness: 0.1, roughness: 0.3,
  })),
  tailBrake: () => cachedMat('tailBrake', () => new THREE.MeshStandardMaterial({
    color: 0x5a0a10, emissive: 0xff2a1c, emissiveIntensity: 6.0, metalness: 0.1, roughness: 0.3,
  })),
  beam: () => cachedMat('beam', () => new THREE.MeshBasicMaterial({
    color: 0xbcdcff, transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })),
  barRedOff: () => cachedMat('barRedOff', () => new THREE.MeshStandardMaterial({ color: 0x4d0a10, emissive: 0xff1424, emissiveIntensity: 0.3, roughness: 0.3 })),
  barRedOn: () => cachedMat('barRedOn', () => new THREE.MeshStandardMaterial({ color: 0x4d0a10, emissive: 0xff1424, emissiveIntensity: 6.5, roughness: 0.3 })),
  barBlueOff: () => cachedMat('barBlueOff', () => new THREE.MeshStandardMaterial({ color: 0x0b1550, emissive: 0x3466ff, emissiveIntensity: 0.3, roughness: 0.3 })),
  barBlueOn: () => cachedMat('barBlueOn', () => new THREE.MeshStandardMaterial({ color: 0x0b1550, emissive: 0x3466ff, emissiveIntensity: 6.5, roughness: 0.3 })),
  sign: () => cachedMat('sign', () => new THREE.MeshStandardMaterial({ color: 0xffd45a, emissive: 0xffb300, emissiveIntensity: 2.4, roughness: 0.35 })),
};

// Rollen, die über den Lack eingefärbt werden.
const ROLE_ORDER = ['paint', 'accent', 'dark', 'chrome', 'neon', 'head', 'tail', 'glass'];
const ROLE_FLAGS = {
  glass: { cast: false, renderOrder: 1 },
};

/** Material für eine Rolle im Kontext eines konkreten Fahrzeugs. */
function resolveMaterial(role, ctx) {
  if (ctx.ghost) return matGhost(ctx.ghostColor);
  switch (role) {
    case 'paint': return matPaint(ctx.paint);
    case 'accent': return matTrim(ctx.accent);
    case 'dark': return MAT.dark();
    case 'chrome': return MAT.chrome();
    case 'glass': return MAT.glass();
    case 'neon': return matNeon(ctx.neon);
    case 'head': return MAT.headOff();
    case 'tail': return MAT.tail();
    case 'beam': return MAT.beam();
    case 'glow': return matGlow(ctx.neon, 0.55);
    case 'flame': return matGlow('#6fd6ff', 0.75);
    case 'barRed': return MAT.barRedOff();
    case 'barBlue': return MAT.barBlueOff();
    case 'sign': return MAT.sign();
    default: return MAT.dark();
  }
}

// ===========================================================================
// 3 – Bau-Helfer
// ===========================================================================

/** Detailstufen je Qualität (fließt in den Blueprint-Cache-Key ein). */
function detailFor(quality) {
  if (quality === 'low') return { key: 'low', round: 1, radial: 8, spokes: 0, extra: false };
  if (quality === 'medium') return { key: 'medium', round: 2, radial: 12, spokes: 4, extra: true };
  return { key: 'high', round: 2, radial: 16, spokes: 5, extra: true };
}

/** Sammelt alle Teile eines Modells und verschmilzt sie am Ende pro Rolle. */
class Bag {
  constructor(D) {
    this.D = D;
    this.roles = new Map();
    this.named = [];
    this.wheels = [];
  }

  /** Teil zu einer Rolle hinzufügen (wird später verschmolzen). */
  add(role, geometry, pos, rot, scale) {
    let arr = this.roles.get(role);
    if (arr === undefined) { arr = []; this.roles.set(role, arr); }
    arr.push(xf(geometry, pos, rot, scale));
    return this;
  }

  /** Spiegelpaar links/rechts (x wird gespiegelt). */
  pair(role, geometry, pos, rot, scale) {
    this.add(role, geometry, pos, rot, scale);
    const mirrored = [-pos[0], pos[1], pos[2]];
    const mrot = rot ? [rot[0], -rot[1], -rot[2]] : undefined;
    this.add(role, geometry, mirrored, mrot, scale);
    return this;
  }

  /** Eigenständiges, benanntes Mesh (animierbar: Blaulicht, Flammen, Kegel …). */
  part(name, role, geometry, opts = {}) {
    this.named.push({ name, role, geometry, ...opts });
    return this;
  }

  /** Rad an die Wurzel (dreht später um die lokale X-Achse). */
  wheel(x, y, z, radius, width, opts = {}) {
    this.wheels.push({ geometry: wheelGeometry(radius, width, this.D, opts), x, y, z, radius });
    return this;
  }

  /** Achse mit zwei Rädern als EIN Mesh (spart Draw Calls beim Verkehr). */
  axle(halfTrack, y, z, radius, width, opts = {}) {
    this.wheels.push({ geometry: axleGeometry(halfTrack, radius, width, this.D, opts), x: 0, y, z, radius });
    return this;
  }

  bake(size, extra = {}) {
    const parts = [];
    for (const role of ROLE_ORDER) {
      const arr = this.roles.get(role);
      if (!arr || arr.length === 0) continue;
      parts.push({ role, geometry: mergeList(arr), ...(ROLE_FLAGS[role] || {}) });
    }
    for (const n of this.named) parts.push(n);
    return { size, parts, wheels: this.wheels, bodyY: 0, ...extra };
  }
}

/** Reifen + Felge als eine Geometrie mit zwei Material-Gruppen. */
function tireAndRim(radius, width, D, opts) {
  const seg = D.radial;
  const tires = [xf(CY(radius, radius, width, seg), [0, 0, 0], [0, 0, HALF_PI])];
  if (opts.tread && D.extra) {
    // Grobstollen für Geländereifen
    const lugs = 10;
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * TAU;
      tires.push(xf(BX(width * 1.04, 0.07, radius * 0.5), [0, Math.cos(a) * radius, Math.sin(a) * radius], [-a, 0, 0]));
    }
  }
  const rims = [
    xf(CY(radius * 0.60, radius * 0.60, width * 1.04, seg), [0, 0, 0], [0, 0, HALF_PI]),
    xf(CY(radius * 0.22, radius * 0.22, width * 1.16, Math.max(6, seg >> 1)), [0, 0, 0], [0, 0, HALF_PI]),
  ];
  for (let i = 0; i < D.spokes; i++) {
    const a = (i / D.spokes) * Math.PI;
    rims.push(xf(BX(width * 0.62, radius * 1.16, radius * 0.16), [0, 0, 0], [a, 0, 0]));
  }
  return [mergeList(tires), mergeList(rims)];
}

function wheelGeometry(radius, width, D, opts = {}) {
  const key = `wheel|${radius}|${width}|${D.key}|${opts.tread ? 1 : 0}`;
  return cachedGeo(key, () => mergeGeometries(tireAndRim(radius, width, D, opts), true));
}

function axleGeometry(halfTrack, radius, width, D, opts = {}) {
  const key = `axle|${halfTrack}|${radius}|${width}|${D.key}|${opts.tread ? 1 : 0}`;
  return cachedGeo(key, () => {
    const [tire, rim] = tireAndRim(radius, width, D, opts);
    const tires = mergeList([xf(tire, [-halfTrack, 0, 0]), xf(tire, [halfTrack, 0, 0])]);
    const rims = mergeList([xf(rim, [-halfTrack, 0, 0]), xf(rim, [halfTrack, 0, 0])]);
    return mergeGeometries([tires, rims], true);
  });
}

/**
 * Scheinwerferkegel: additive, offene Kegel. Die Spitze sitzt an der Lampe,
 * die Öffnung zeigt nach -Z (leicht nach unten geneigt).
 */
function beamPart(origins, length, radius, D) {
  const seg = Math.max(8, D.radial >> 1);
  const list = origins.map((o) =>
    xf(CN(radius, length, seg, true), [o[0], o[1], o[2] - length / 2], [HALF_PI - 0.028, 0, 0]));
  return { name: 'beams', role: 'beam', geometry: mergeList(list), cast: false, hidden: true, renderOrder: 3 };
}

/** Nitro-Flamme: heißer Kern + weite Fahne in einer Geometrie (additiv = glühender Kern). */
function flameGeometry(radius, length, D) {
  const seg = Math.max(6, D.radial >> 1);
  return mergeList([
    xf(CN(radius, length, seg, true), [0, 0, length / 2], [HALF_PI, 0, 0]),
    xf(CN(radius * 0.52, length * 0.55, seg, true), [0, 0, length * 0.28], [HALF_PI, 0, 0]),
  ]);
}

// ===========================================================================
// 4 – Spielermodelle
// ===========================================================================

/** Standard-Glashaus: Glasblock + schwebendes Dach darüber. */
function greenhouse(b, D, { w, h, l, y, z, roofW, roofL, roofY }) {
  b.add('glass', RB(w, h, l, 0.16, D.round), [0, y, z]);
  b.add('paint', RB(roofW, 0.13, roofL, 0.09, D.round), [0, roofY, z + 0.1]);
}

/** Blitz – schlankes Sportcoupé mit Spoiler und Rennstreifen. */
function buildCoupe(b, D) {
  // Hauptkörper + Keilnase + breiteres Heck
  b.add('paint', RB(1.86, 0.72, 4.10, 0.26, D.round), [0, 0.66, 0]);
  b.add('paint', RB(1.70, 0.36, 0.72, 0.16, D.round), [0, 0.50, -1.74]);
  b.add('paint', RB(1.90, 0.50, 1.30, 0.22, D.round), [0, 0.70, 1.32]);
  greenhouse(b, D, { w: 1.52, h: 0.46, l: 1.90, y: 1.16, z: 0.22, roofW: 1.56, roofL: 1.42, roofY: 1.37 });

  // Rennstreifen (Motorhaube, Dach, Heckdeckel)
  b.pair('accent', BX(0.20, 0.04, 1.30), [0.23, 1.02, -1.38]);
  b.pair('accent', BX(0.20, 0.04, 1.36), [0.23, 1.445, 0.32]);
  b.pair('accent', BX(0.20, 0.04, 0.66), [0.23, 1.02, 1.66]);

  // Heckflügel
  b.add('paint', RB(1.56, 0.07, 0.32, 0.03, 1), [0, 1.16, 1.90]);
  b.pair('dark', BX(0.07, 0.26, 0.10), [0.58, 1.02, 1.90]);

  // Stoßfänger, Diffusor, Schweller, Spiegel
  b.add('dark', RB(1.62, 0.16, 0.14, 0.05, 1), [0, 0.44, -2.05]);
  b.add('dark', RB(1.56, 0.20, 0.18, 0.06, 1), [0, 0.40, 2.00]);
  b.pair('dark', BX(0.08, 0.14, 2.10), [0.92, 0.42, 0.05]);
  if (D.extra) {
    b.pair('dark', RB(0.16, 0.09, 0.12, 0.03, 1), [0.94, 1.02, -0.48]);
    b.pair('chrome', CY(0.07, 0.07, 0.18, Math.max(6, D.radial >> 1)), [0.44, 0.40, 2.06], [HALF_PI, 0, 0]);
  }

  // Leuchten
  b.pair('head', RB(0.44, 0.13, 0.12, 0.04, 1), [0.60, 0.68, -2.03]);
  b.pair('tail', RB(0.42, 0.12, 0.10, 0.04, 1), [0.62, 0.84, 2.02]);
  b.add('tail', BX(0.70, 0.05, 0.08), [0, 0.84, 2.03]);

  b.wheel(-0.80, 0.34, -1.34, 0.34, 0.28);
  b.wheel(0.80, 0.34, -1.34, 0.34, 0.28);
  b.wheel(-0.80, 0.34, 1.38, 0.34, 0.30);
  b.wheel(0.80, 0.34, 1.38, 0.34, 0.30);

  b.named.push(beamPart([[-0.60, 0.68, -2.03], [0.60, 0.68, -2.03]], 15, 1.5, D));
  addExhaustFlames(b, D, [[-0.44, 0.40, 2.12], [0.44, 0.40, 2.12]]);

  return b.bake([1.90, 1.46, 4.20]);
}

/** Kiwi – kleiner, runder Stadtflitzer. */
function buildHatch(b, D) {
  b.add('paint', RB(1.84, 0.88, 3.92, 0.34, D.round), [0, 0.74, 0]);
  b.add('paint', RB(1.66, 0.44, 0.80, 0.22, D.round), [0, 0.60, -1.72]);
  greenhouse(b, D, { w: 1.56, h: 0.50, l: 2.00, y: 1.24, z: 0.06, roofW: 1.62, roofL: 2.02, roofY: 1.44 });

  // Dachreling + kleiner Dachspoiler
  b.pair('dark', BX(0.07, 0.06, 1.50), [0.66, 1.53, 0.10]);
  b.add('paint', RB(1.52, 0.10, 0.26, 0.04, 1), [0, 1.46, 1.16]);

  // Stoßfänger, Schweller, Radhäuser
  b.add('dark', RB(1.70, 0.24, 0.16, 0.07, 1), [0, 0.42, -1.92]);
  b.add('dark', RB(1.70, 0.24, 0.16, 0.07, 1), [0, 0.42, 1.92]);
  b.pair('dark', BX(0.09, 0.16, 1.90), [0.90, 0.40, 0.05]);
  if (D.extra) b.pair('dark', RB(0.15, 0.09, 0.12, 0.03, 1), [0.93, 1.06, -0.62]);

  // Runde Scheinwerfer, hohe Rückleuchten
  const rs = Math.max(6, D.radial >> 1);
  b.pair('head', CY(0.16, 0.16, 0.10, rs), [0.58, 0.82, -1.92], [HALF_PI, 0, 0]);
  b.pair('tail', RB(0.16, 0.44, 0.10, 0.04, 1), [0.76, 1.06, 1.93]);

  b.wheel(-0.79, 0.30, -1.24, 0.30, 0.26);
  b.wheel(0.79, 0.30, -1.24, 0.30, 0.26);
  b.wheel(-0.79, 0.30, 1.28, 0.30, 0.26);
  b.wheel(0.79, 0.30, 1.28, 0.30, 0.26);

  b.named.push(beamPart([[-0.58, 0.82, -1.95], [0.58, 0.82, -1.95]], 14, 1.4, D));
  addExhaustFlames(b, D, [[0.0, 0.36, 1.98]], 0.18, 1.0);

  return b.bake([1.86, 1.52, 4.05]);
}

/** Bulldog – Muscle-Car: lange Haube, Hutze, breites Heck, Doppelstreifen. */
function buildMuscle(b, D) {
  b.add('paint', RB(1.90, 0.78, 4.18, 0.14, D.round), [0, 0.66, 0]);
  b.add('paint', RB(1.96, 0.56, 1.60, 0.16, D.round), [0, 0.72, 1.22]);   // breite Hüfte
  b.add('paint', RB(1.80, 0.34, 1.00, 0.10, D.round), [0, 0.92, -1.50]);  // erhöhte Haube
  greenhouse(b, D, { w: 1.52, h: 0.44, l: 1.46, y: 1.16, z: 0.74, roofW: 1.58, roofL: 1.34, roofY: 1.36 });

  // Hutze auf der Haube
  b.add('dark', RB(0.60, 0.20, 0.86, 0.05, 1), [0, 1.16, -1.16]);
  b.add('dark', BX(0.44, 0.10, 0.30), [0, 1.22, -1.52]);

  // Doppelstreifen über Haube, Dach und Heckdeckel
  b.pair('accent', BX(0.24, 0.04, 1.90), [0.25, 1.10, -1.16]);
  b.pair('accent', BX(0.24, 0.04, 1.26), [0.25, 1.435, 0.84]);
  b.pair('accent', BX(0.24, 0.04, 0.52), [0.25, 1.055, 1.80]);

  // Entenbürzel, Chromstoßstangen, Seitenauspuff
  b.add('paint', RB(1.72, 0.10, 0.34, 0.04, 1), [0, 1.10, 1.92]);
  b.add('chrome', RB(1.80, 0.16, 0.14, 0.05, 1), [0, 0.44, -2.06]);
  b.add('chrome', RB(1.80, 0.16, 0.14, 0.05, 1), [0, 0.44, 2.04]);
  b.add('dark', BX(1.46, 0.30, 0.10), [0, 0.66, -2.06]); // Kühlergrill
  if (D.extra) {
    b.pair('chrome', CY(0.075, 0.075, 1.20, Math.max(6, D.radial >> 1)), [0.94, 0.30, 0.90], [HALF_PI, 0, 0]);
    b.pair('dark', RB(0.17, 0.10, 0.12, 0.03, 1), [0.96, 1.04, 0.05]);
  }

  // Doppelscheinwerfer, vier runde Rückleuchten
  const rs = Math.max(6, D.radial >> 1);
  b.pair('head', CY(0.13, 0.13, 0.09, rs), [0.46, 0.76, -2.07], [HALF_PI, 0, 0]);
  b.pair('head', CY(0.13, 0.13, 0.09, rs), [0.74, 0.76, -2.07], [HALF_PI, 0, 0]);
  b.pair('tail', CY(0.12, 0.12, 0.08, rs), [0.44, 0.82, 2.06], [HALF_PI, 0, 0]);
  b.pair('tail', CY(0.12, 0.12, 0.08, rs), [0.70, 0.82, 2.06], [HALF_PI, 0, 0]);

  b.wheel(-0.79, 0.34, -1.40, 0.34, 0.28);
  b.wheel(0.79, 0.34, -1.40, 0.34, 0.28);
  b.wheel(-0.78, 0.37, 1.38, 0.37, 0.34);
  b.wheel(0.78, 0.37, 1.38, 0.37, 0.34);

  b.named.push(beamPart([[-0.60, 0.76, -2.08], [0.60, 0.76, -2.08]], 15, 1.6, D));
  addExhaustFlames(b, D, [[-0.52, 0.38, 2.10], [0.52, 0.38, 2.10]], 0.19, 1.25);

  return b.bake([1.96, 1.44, 4.25]);
}

/** Rancher – höhergelegter Pick-up mit offener Ladefläche und Überrollbügel. */
function buildPickup(b, D) {
  const rs = Math.max(6, D.radial >> 1);
  b.add('dark', BX(1.68, 0.16, 3.96), [0, 0.42, 0]);                       // Leiterrahmen
  b.add('paint', RB(1.90, 0.60, 1.94, 0.12, D.round), [0, 0.80, -0.52]);   // Kabine
  b.add('paint', RB(1.90, 0.48, 1.34, 0.12, D.round), [0, 0.76, -1.78]);   // Motorhaube
  greenhouse(b, D, { w: 1.60, h: 0.40, l: 1.06, y: 1.16, z: -0.30, roofW: 1.72, roofL: 1.20, roofY: 1.38 });

  // Ladefläche
  b.add('paint', BX(1.86, 0.30, 0.12), [0, 0.86, 0.50]);
  b.pair('paint', BX(0.13, 0.42, 1.62), [0.87, 0.92, 1.28]);
  b.add('paint', BX(1.86, 0.40, 0.11), [0, 0.91, 2.06]);
  b.add('dark', BX(1.72, 0.08, 1.60), [0, 0.72, 1.28]);

  // Überrollbügel mit Zusatzscheinwerfern
  b.pair('chrome', CY(0.05, 0.05, 0.60, rs), [0.68, 1.16, 0.44]);
  b.add('chrome', CY(0.05, 0.05, 1.42, rs), [0, 1.45, 0.44], [0, 0, HALF_PI]);
  b.pair('head', RB(0.18, 0.11, 0.11, 0.04, 1), [0.28, 1.50, 0.44]);

  // Rammschutz, Trittbretter, Grill
  b.add('dark', RB(1.86, 0.26, 0.18, 0.06, 1), [0, 0.60, -2.10]);
  b.pair('dark', BX(0.10, 0.06, 0.52), [0.56, 0.84, -2.12]);
  b.pair('dark', BX(0.22, 0.08, 1.10), [0.92, 0.52, -0.10]);
  b.add('dark', BX(1.50, 0.26, 0.10), [0, 0.86, -2.10]);
  b.add('dark', RB(1.76, 0.22, 0.16, 0.06, 1), [0, 0.60, 2.13]);

  b.pair('head', RB(0.34, 0.24, 0.12, 0.05, 1), [0.62, 1.00, -2.10]);
  b.pair('tail', RB(0.20, 0.40, 0.10, 0.04, 1), [0.80, 1.00, 2.12]);
  if (D.extra) b.pair('dark', RB(0.16, 0.10, 0.12, 0.03, 1), [0.96, 1.16, -0.86]);

  b.wheel(-0.78, 0.41, -1.42, 0.41, 0.34, { tread: true });
  b.wheel(0.78, 0.41, -1.42, 0.41, 0.34, { tread: true });
  b.wheel(-0.78, 0.41, 1.44, 0.41, 0.34, { tread: true });
  b.wheel(0.78, 0.41, 1.44, 0.41, 0.34, { tread: true });

  b.named.push(beamPart([[-0.62, 1.00, -2.14], [0.62, 1.00, -2.14], [0, 1.50, 0.40]], 16, 1.8, D));
  addExhaustFlames(b, D, [[-0.62, 0.42, 2.16]], 0.20, 1.1);

  return b.bake([1.94, 1.56, 4.28]);
}

/** Sheriff – Abfangjäger mit strobendem Lichtbalken. */
function buildPoliceCar(b, D) {
  const rs = Math.max(6, D.radial >> 1);
  b.add('paint', RB(1.88, 0.76, 4.16, 0.20, D.round), [0, 0.66, 0]);
  b.add('paint', RB(1.72, 0.34, 0.80, 0.14, D.round), [0, 0.52, -1.80]);
  greenhouse(b, D, { w: 1.54, h: 0.46, l: 1.96, y: 1.12, z: 0.26, roofW: 1.60, roofL: 1.92, roofY: 1.34 });

  // Türdekor (dunkel/hell abgesetzt) + Schriftbalken
  b.pair('accent', BX(0.03, 0.34, 1.70), [0.945, 0.74, 0.20]);
  b.pair('accent', BX(0.03, 0.10, 1.30), [0.945, 1.00, 0.20]);

  // Lichtbalken: dunkles Gehäuse, rote und blaue Hälfte (animiert)
  b.add('dark', RB(1.14, 0.08, 0.26, 0.03, 1), [0, 1.43, 0.24]);
  b.part('barRed', 'barRed', xf(RB(0.48, 0.12, 0.22, 0.04, 1), [-0.29, 1.50, 0.24]));
  b.part('barBlue', 'barBlue', xf(RB(0.48, 0.12, 0.22, 0.04, 1), [0.29, 1.50, 0.24]));
  b.pair('dark', BX(0.07, 0.08, 0.20), [0.52, 1.47, 0.24]);

  // Rammbügel, Suchscheinwerfer, Stoßfänger
  b.add('dark', RB(1.66, 0.42, 0.14, 0.05, 1), [0, 0.60, -2.12]);
  b.pair('dark', BX(0.09, 0.44, 0.09), [0.40, 0.62, -2.14]);
  b.add('dark', RB(1.60, 0.18, 0.14, 0.05, 1), [0, 0.42, 2.06]);
  if (D.extra) {
    b.add('chrome', CY(0.06, 0.06, 0.20, rs), [-0.72, 1.14, -0.60], [HALF_PI, 0, 0]);
    b.pair('dark', RB(0.15, 0.09, 0.12, 0.03, 1), [0.94, 1.00, -0.54]);
  }

  b.pair('head', RB(0.40, 0.14, 0.12, 0.04, 1), [0.58, 0.70, -2.06]);
  b.pair('tail', RB(0.36, 0.30, 0.10, 0.04, 1), [0.66, 0.84, 2.05]);

  b.wheel(-0.80, 0.34, -1.36, 0.34, 0.28);
  b.wheel(0.80, 0.34, -1.36, 0.34, 0.28);
  b.wheel(-0.80, 0.34, 1.40, 0.34, 0.28);
  b.wheel(0.80, 0.34, 1.40, 0.34, 0.28);

  b.named.push(beamPart([[-0.58, 0.70, -2.10], [0.58, 0.70, -2.10]], 15, 1.5, D));
  addExhaustFlames(b, D, [[-0.46, 0.38, 2.10], [0.46, 0.38, 2.10]]);

  return b.bake([1.92, 1.55, 4.24], { police: true });
}

/** Neon GT – flacher Keil mit Leuchtleisten und Unterbodenlicht. */
function buildGt(b, D) {
  b.add('paint', RB(1.92, 0.56, 4.14, 0.14, D.round), [0, 0.54, 0]);
  b.add('paint', RB(1.80, 0.28, 1.30, 0.10, D.round), [0, 0.40, -1.44]);   // Keilnase
  b.add('paint', RB(1.90, 0.44, 1.40, 0.12, D.round), [0, 0.66, 1.30]);    // Heckmassiv
  b.add('glass', RB(1.40, 0.38, 1.54, 0.14, D.round), [0, 0.94, 0.24]);
  b.add('paint', RB(1.44, 0.10, 1.20, 0.05, D.round), [0, 1.14, 0.44]);

  // Lufthutzen hinter den Türen
  b.pair('dark', RB(0.30, 0.22, 0.60, 0.06, 1), [0.82, 0.78, 0.92]);

  // Heckflügel (hoch) + Diffusor + Frontsplitter
  b.add('paint', RB(1.78, 0.07, 0.46, 0.03, 1), [0, 1.40, 1.86]);
  b.pair('dark', BX(0.05, 0.40, 0.52), [0.86, 1.20, 1.86]);
  b.pair('dark', BX(0.08, 0.36, 0.10), [0.40, 1.22, 1.90]);
  b.add('dark', RB(1.86, 0.08, 0.60, 0.03, 1), [0, 0.28, -1.92]);
  b.add('dark', RB(1.70, 0.24, 0.46, 0.06, 1), [0, 0.34, 1.94]);
  b.pair('dark', BX(0.10, 0.16, 2.20), [0.94, 0.32, 0.10]);

  // Neon-Zierleisten in Lackfarbe
  b.pair('neon', BX(0.05, 0.06, 2.40), [0.955, 0.42, 0.05]);
  b.add('neon', BX(1.30, 0.05, 0.06), [0, 0.30, -2.04]);
  b.add('neon', BX(1.20, 0.06, 0.05), [0, 0.86, 2.02]);

  b.pair('head', RB(0.46, 0.09, 0.12, 0.03, 1), [0.58, 0.48, -2.02]);
  b.add('tail', BX(1.30, 0.07, 0.08), [0, 0.86, 2.03]);
  b.pair('tail', RB(0.22, 0.16, 0.10, 0.04, 1), [0.72, 0.86, 2.03]);

  b.wheel(-0.79, 0.35, -1.36, 0.35, 0.30);
  b.wheel(0.79, 0.35, -1.36, 0.35, 0.30);
  b.wheel(-0.78, 0.37, 1.34, 0.37, 0.34);
  b.wheel(0.78, 0.37, 1.34, 0.37, 0.34);

  // Unterbodenlicht bleibt am Boden (hängt an der Wurzel, wippt nicht mit)
  b.part('underglow', 'glow', xf(PL(3.0, 5.2), [0, 0.035, 0.1], [-HALF_PI, 0, 0]), {
    cast: false, root: true, dyn: true, renderOrder: 2,
  });
  b.named.push(beamPart([[-0.58, 0.48, -2.04], [0.58, 0.48, -2.04]], 15, 1.5, D));
  addExhaustFlames(b, D, [[-0.34, 0.40, 2.16], [0.34, 0.40, 2.16]], 0.17, 1.2);

  return b.bake([1.95, 1.47, 4.22], { underglow: true });
}

/** Rakete F1 – Formelwagen mit freistehenden Rädern, Flügeln und Halo. */
function buildFormula(b, D) {
  const rs = Math.max(6, D.radial >> 1);
  // Monocoque, Nase, Seitenkästen
  b.add('paint', RB(0.70, 0.40, 2.40, 0.16, D.round), [0, 0.46, 0.15]);
  b.add('paint', RB(0.34, 0.24, 1.44, 0.10, D.round), [0, 0.42, -1.36]);
  b.pair('paint', RB(0.52, 0.42, 1.50, 0.16, D.round), [0.62, 0.42, 0.36]);
  b.add('paint', RB(0.52, 0.50, 1.22, 0.18, D.round), [0, 0.68, 1.02]);   // Motorabdeckung
  b.add('paint', RB(0.10, 0.34, 1.10, 0.04, 1), [0, 1.04, 1.20]);        // Haifischflosse

  // Airbox über dem Cockpit
  b.add('dark', CY(0.16, 0.20, 0.30, rs), [0, 0.94, 0.42], [0.35, 0, 0]);
  b.add('glass', RB(0.46, 0.16, 0.34, 0.06, 1), [0, 0.76, -0.28]);

  // Halo
  b.add('dark', TO(0.34, 0.035, 5, Math.max(10, D.radial)), [0, 0.80, -0.12], [HALF_PI, 0, 0]);
  b.add('dark', BX(0.05, 0.22, 0.06), [0, 0.78, -0.46]);

  // Frontflügel
  b.add('accent', RB(1.56, 0.05, 0.40, 0.02, 1), [0, 0.19, -2.00]);
  b.add('accent', RB(1.40, 0.04, 0.26, 0.02, 1), [0, 0.29, -1.94]);
  b.pair('dark', BX(0.06, 0.28, 0.46), [0.78, 0.30, -2.00]);

  // Heckflügel
  b.add('accent', RB(1.06, 0.06, 0.44, 0.02, 1), [0, 1.30, 1.88]);
  b.add('accent', RB(1.00, 0.05, 0.26, 0.02, 1), [0, 1.40, 1.96]);
  b.pair('dark', BX(0.05, 0.44, 0.52), [0.52, 1.22, 1.90]);
  b.add('dark', BX(0.10, 0.50, 0.16), [0, 1.06, 1.92]);
  b.add('dark', RB(0.90, 0.10, 0.60, 0.04, 1), [0, 0.22, 1.60]); // Diffusor

  // Querlenker
  if (D.extra) {
    for (const z of [-1.52, 1.46]) {
      b.pair('dark', CY(0.035, 0.035, 0.62, 6), [0.46, 0.34, z], [0, 0, HALF_PI + 0.12]);
      b.pair('dark', CY(0.03, 0.03, 0.60, 6), [0.46, 0.52, z], [0, 0, HALF_PI - 0.10]);
    }
  }

  b.pair('head', RB(0.14, 0.08, 0.08, 0.02, 1), [0.14, 0.48, -1.96]);
  b.add('tail', RB(0.16, 0.10, 0.08, 0.03, 1), [0, 1.06, 2.02]);
  b.pair('tail', RB(0.10, 0.08, 0.06, 0.02, 1), [0.30, 0.30, 1.86]);

  b.wheel(-0.76, 0.36, -1.52, 0.36, 0.36);
  b.wheel(0.76, 0.36, -1.52, 0.36, 0.36);
  b.wheel(-0.74, 0.39, 1.46, 0.39, 0.42);
  b.wheel(0.74, 0.39, 1.46, 0.39, 0.42);

  b.named.push(beamPart([[-0.14, 0.48, -1.98], [0.14, 0.48, -1.98]], 13, 1.2, D));
  addExhaustFlames(b, D, [[0, 0.72, 1.70]], 0.16, 1.3);

  return b.bake([1.92, 1.46, 4.24]);
}

/** Phantom X – Schwebegleiter ohne Räder, Rumpf liegt 0,35 m über der Straße. */
function buildHover(b, D) {
  const rs = Math.max(6, D.radial >> 1);
  b.add('paint', RB(1.82, 0.54, 4.06, 0.28, D.round), [0, 0.40, 0]);
  b.add('dark', RB(1.56, 0.20, 3.50, 0.10, D.round), [0, 0.12, 0.05]);      // Unterschale
  b.add('paint', RB(1.30, 0.22, 1.40, 0.12, D.round), [0, 0.58, -1.32]);    // Bugspitze
  b.add('glass', RB(1.30, 0.40, 1.70, 0.18, D.round), [0, 0.74, 0.02]);
  b.add('paint', RB(0.94, 0.12, 2.10, 0.06, D.round), [0, 0.96, 0.52]);     // Rückenkiel
  b.add('paint', RB(0.10, 0.28, 0.88, 0.04, 1), [0, 1.02, 1.56]);           // Heckfinne
  b.pair('paint', RB(0.16, 0.12, 2.20, 0.05, D.round), [0.88, 0.30, 0.10]); // Seitenstreben

  // Triebwerksringe
  b.pair('dark', CY(0.23, 0.23, 0.32, rs, true), [0.50, 0.42, 1.92], [HALF_PI, 0, 0]);
  b.pair('chrome', TO(0.23, 0.03, 5, Math.max(10, rs)), [0.50, 0.42, 1.78]);

  // Leuchten
  b.add('head', BX(1.00, 0.06, 0.08), [0, 0.52, -2.00]);
  b.add('tail', BX(1.10, 0.07, 0.07), [0, 0.62, 2.00]);
  b.add('neon', BX(0.06, 0.05, 2.60), [0.905, 0.32, 0.10]);
  b.add('neon', BX(0.06, 0.05, 2.60), [-0.905, 0.32, 0.10]);

  // Animierte Triebwerksglut + Schwebefeld unter dem Rumpf
  const thrust = mergeList([
    xf(CY(0.17, 0.17, 0.16, rs), [-0.50, 0.42, 1.98], [HALF_PI, 0, 0]),
    xf(CY(0.17, 0.17, 0.16, rs), [0.50, 0.42, 1.98], [HALF_PI, 0, 0]),
    xf(CN(0.19, 0.70, rs, true), [-0.50, 0.42, 2.38], [HALF_PI, 0, 0]),
    xf(CN(0.19, 0.70, rs, true), [0.50, 0.42, 2.38], [HALF_PI, 0, 0]),
  ]);
  b.part('thrusters', 'glow', thrust, { cast: false, dyn: true, renderOrder: 2 });

  const pads = mergeList([
    xf(PL(0.86, 0.86), [-0.60, 0.02, -1.32], [HALF_PI, 0, 0]),
    xf(PL(0.86, 0.86), [0.60, 0.02, -1.32], [HALF_PI, 0, 0]),
    xf(PL(0.96, 0.96), [-0.60, 0.02, 1.30], [HALF_PI, 0, 0]),
    xf(PL(0.96, 0.96), [0.60, 0.02, 1.30], [HALF_PI, 0, 0]),
  ]);
  b.part('pads', 'glow', pads, { cast: false, dyn: true, renderOrder: 2 });

  b.named.push(beamPart([[-0.40, 0.52, -2.02], [0.40, 0.52, -2.02]], 15, 1.6, D));

  return b.bake([1.88, 1.50, 4.15], { bodyY: 0.35, hover: true });
}

/** Nitro-Flammen an die Auspuffposition(en) hängen. */
function addExhaustFlames(b, D, origins, radius = 0.17, length = 1.15) {
  const geo = flameGeometry(radius, length, D);
  origins.forEach((o, i) => {
    b.part(`flame${i}`, 'flame', xf(geo, o), { cast: false, hidden: true, dyn: true, flame: true, renderOrder: 4 });
  });
}

// ===========================================================================
// 5 – Verkehrsmodelle (max. 10 Meshes pro Fahrzeug)
// ===========================================================================

function buildTrafficSedan(b, D) {
  b.add('paint', RB(1.86, 0.74, 4.24, 0.24, D.round), [0, 0.62, 0]);
  b.add('paint', RB(1.70, 0.34, 0.80, 0.16, D.round), [0, 0.48, -1.86]);
  greenhouse(b, D, { w: 1.52, h: 0.46, l: 1.96, y: 1.10, z: 0.18, roofW: 1.58, roofL: 1.88, roofY: 1.32 });
  b.add('dark', RB(1.66, 0.20, 0.14, 0.06, 1), [0, 0.40, -2.10]);
  b.add('dark', RB(1.62, 0.20, 0.14, 0.06, 1), [0, 0.40, 2.08]);
  b.add('dark', BX(1.30, 0.16, 0.10), [0, 0.62, -2.12]);
  b.pair('dark', BX(0.08, 0.13, 2.00), [0.90, 0.38, 0.05]);
  b.pair('head', RB(0.42, 0.13, 0.12, 0.04, 1), [0.58, 0.66, -2.09]);
  b.pair('tail', RB(0.40, 0.14, 0.10, 0.04, 1), [0.60, 0.80, 2.08]);
  b.axle(0.80, 0.33, -1.38, 0.33, 0.26);
  b.axle(0.80, 0.33, 1.40, 0.33, 0.26);
  return b.bake([1.90, 1.45, 4.30]);
}

function buildTrafficHatch(b, D) {
  b.add('paint', RB(1.76, 0.86, 3.72, 0.32, D.round), [0, 0.70, 0]);
  b.add('paint', RB(1.62, 0.40, 0.72, 0.20, D.round), [0, 0.56, -1.62]);
  greenhouse(b, D, { w: 1.48, h: 0.48, l: 1.90, y: 1.20, z: 0.04, roofW: 1.54, roofL: 1.94, roofY: 1.40 });
  b.add('paint', RB(1.44, 0.10, 0.24, 0.04, 1), [0, 1.42, 1.10]);
  b.add('dark', RB(1.62, 0.22, 0.14, 0.06, 1), [0, 0.40, -1.82]);
  b.add('dark', RB(1.62, 0.22, 0.14, 0.06, 1), [0, 0.40, 1.82]);
  b.pair('dark', BX(0.08, 0.13, 1.80), [0.86, 0.36, 0.05]);
  b.pair('head', RB(0.38, 0.14, 0.12, 0.04, 1), [0.54, 0.76, -1.83]);
  b.pair('tail', RB(0.16, 0.42, 0.10, 0.04, 1), [0.72, 1.02, 1.84]);
  b.axle(0.76, 0.31, -1.18, 0.31, 0.26);
  b.axle(0.76, 0.31, 1.22, 0.31, 0.26);
  return b.bake([1.80, 1.50, 3.80]);
}

function buildTrafficTaxi(b, D) {
  b.add('paint', RB(1.86, 0.78, 4.32, 0.24, D.round), [0, 0.64, 0]);
  b.add('paint', RB(1.70, 0.36, 0.82, 0.16, D.round), [0, 0.50, -1.90]);
  greenhouse(b, D, { w: 1.54, h: 0.52, l: 2.00, y: 1.16, z: 0.16, roofW: 1.60, roofL: 1.94, roofY: 1.42 });
  // Schachbrettband an den Türen
  b.pair('accent', BX(0.03, 0.12, 1.80), [0.945, 0.76, 0.20]);
  b.add('dark', RB(1.66, 0.20, 0.14, 0.06, 1), [0, 0.42, -2.14]);
  b.add('dark', RB(1.62, 0.20, 0.14, 0.06, 1), [0, 0.42, 2.12]);
  b.pair('dark', BX(0.08, 0.13, 2.00), [0.90, 0.40, 0.05]);
  b.pair('head', RB(0.42, 0.13, 0.12, 0.04, 1), [0.58, 0.68, -2.13]);
  b.pair('tail', RB(0.40, 0.14, 0.10, 0.04, 1), [0.60, 0.84, 2.12]);
  // Dachschild (leuchtet)
  b.part('sign', 'sign', mergeList([
    xf(RB(0.72, 0.20, 0.22, 0.05, 1), [0, 1.58, 0.10]),
    xf(BX(0.14, 0.08, 0.20), [0, 1.46, 0.10]),
  ]));
  b.axle(0.80, 0.34, -1.42, 0.34, 0.26);
  b.axle(0.80, 0.34, 1.44, 0.34, 0.26);
  return b.bake([1.90, 1.70, 4.40], { forcePaint: '#f2c200', forceAccent: '#14181f' });
}

function buildTrafficVan(b, D) {
  b.add('paint', RB(1.96, 1.16, 4.80, 0.30, D.round), [0, 0.86, 0]);
  b.add('paint', RB(1.90, 0.80, 3.10, 0.20, D.round), [0, 1.78, 0.62]);   // Hochdach-Kasten
  b.add('paint', RB(1.80, 0.50, 0.90, 0.20, D.round), [0, 0.70, -2.10]);  // Schnauze
  b.add('glass', RB(1.66, 0.54, 0.30, 0.10, D.round), [0, 1.34, -1.70], [0.26, 0, 0]);
  b.pair('glass', BX(0.03, 0.44, 0.90), [0.965, 1.30, -1.10]);
  b.add('accent', BX(1.98, 0.16, 3.40), [0, 1.30, 0.60]);                 // Zierband
  b.add('accent', RB(1.92, 0.10, 2.90, 0.06, 1), [0, 2.20, 0.62]);        // Dach
  b.add('dark', RB(1.86, 0.26, 0.16, 0.06, 1), [0, 0.46, -2.42]);
  b.add('dark', RB(1.82, 0.24, 0.16, 0.06, 1), [0, 0.46, 2.38]);
  b.pair('dark', BX(0.09, 0.14, 2.40), [0.95, 0.42, 0.20]);
  b.add('dark', BX(1.40, 0.18, 0.10), [0, 0.74, -2.44]);
  b.pair('head', RB(0.40, 0.18, 0.12, 0.04, 1), [0.62, 0.94, -2.40]);
  b.pair('tail', RB(0.18, 0.56, 0.10, 0.04, 1), [0.82, 1.26, 2.40]);
  b.axle(0.82, 0.36, -1.58, 0.36, 0.28);
  b.axle(0.82, 0.36, 1.62, 0.36, 0.28);
  return b.bake([2.00, 2.30, 4.90]);
}

function buildTrafficTruck(b, D) {
  // Fahrerhaus
  b.add('paint', RB(2.28, 1.56, 2.10, 0.22, D.round), [0, 1.36, -2.42]);
  b.add('paint', RB(2.20, 0.46, 0.44, 0.14, D.round), [0, 2.36, -2.20]);  // Dachspoiler
  b.add('glass', RB(1.94, 0.62, 0.24, 0.10, D.round), [0, 1.86, -3.40], [0.18, 0, 0]);
  b.pair('glass', BX(0.03, 0.50, 0.70), [1.145, 1.80, -2.70]);
  // Auflieger
  b.add('accent', RB(2.28, 1.96, 4.50, 0.10, D.round), [0, 1.92, 0.94]);
  b.add('accent', RB(2.20, 0.12, 4.30, 0.05, 1), [0, 2.94, 0.94]);
  b.pair('dark', BX(0.06, 1.70, 0.10), [1.15, 1.92, -1.26]);
  // Rahmen, Tank, Stoßfänger, Grill
  b.add('dark', BX(1.90, 0.24, 6.90), [0, 0.74, 0.06]);
  b.add('dark', RB(2.24, 0.34, 0.20, 0.06, 1), [0, 0.66, -3.56]);
  b.add('dark', BX(1.70, 0.60, 0.12), [0, 1.30, -3.50]);
  b.pair('chrome', CY(0.24, 0.24, 0.90, Math.max(8, D.radial)), [1.02, 0.78, -1.30], [HALF_PI, 0, 0]);
  b.pair('chrome', CY(0.09, 0.09, 1.70, Math.max(6, D.radial >> 1)), [1.12, 2.10, -1.50]);
  b.add('dark', RB(2.20, 0.22, 0.18, 0.06, 1), [0, 0.70, 3.24]);
  b.pair('head', RB(0.46, 0.26, 0.14, 0.05, 1), [0.72, 0.96, -3.52]);
  b.pair('tail', RB(0.22, 0.44, 0.10, 0.04, 1), [0.86, 0.96, 3.26]);
  b.add('tail', BX(1.90, 0.08, 0.08), [0, 2.90, 3.20]);
  b.axle(0.98, 0.50, -2.58, 0.50, 0.32);
  b.axle(0.98, 0.50, 1.32, 0.50, 0.34);
  b.axle(0.98, 0.50, 2.50, 0.50, 0.34);
  return b.bake([2.35, 3.20, 7.20]);
}

/** Streifenwagen im Verkehr: weiß/schwarz, Lichtbalken – genau 10 Meshes. */
function buildTrafficPolice(b, D) {
  b.add('paint', RB(1.90, 0.80, 4.52, 0.22, D.round), [0, 0.66, 0]);
  b.add('paint', RB(1.74, 0.36, 0.80, 0.16, D.round), [0, 0.52, -2.00]);
  greenhouse(b, D, { w: 1.56, h: 0.50, l: 2.06, y: 1.18, z: 0.22, roofW: 1.62, roofL: 1.98, roofY: 1.42 });

  // Schwarze Türfelder und Front-/Heckklappe
  b.pair('accent', BX(0.03, 0.42, 1.90), [0.955, 0.74, 0.22]);
  b.add('accent', RB(1.70, 0.06, 1.10, 0.03, 1), [0, 1.07, -1.42]);
  b.add('accent', RB(1.66, 0.06, 0.80, 0.03, 1), [0, 1.07, 1.72]);

  // Lichtbalken
  b.add('dark', RB(1.16, 0.09, 0.26, 0.03, 1), [0, 1.52, 0.24]);
  b.part('barRed', 'barRed', xf(RB(0.48, 0.12, 0.22, 0.04, 1), [-0.29, 1.59, 0.24]));
  b.part('barBlue', 'barBlue', xf(RB(0.48, 0.12, 0.22, 0.04, 1), [0.29, 1.59, 0.24]));

  // Rammbügel, Stoßfänger, Schweller
  b.add('dark', RB(1.68, 0.44, 0.14, 0.05, 1), [0, 0.60, -2.30]);
  b.pair('dark', BX(0.09, 0.46, 0.09), [0.40, 0.62, -2.32]);
  b.add('dark', RB(1.66, 0.20, 0.14, 0.06, 1), [0, 0.42, 2.26]);
  b.pair('dark', BX(0.08, 0.14, 2.10), [0.92, 0.38, 0.10]);
  b.pair('dark', BX(0.07, 0.09, 0.20), [0.53, 1.56, 0.24]);

  b.pair('head', RB(0.42, 0.14, 0.12, 0.04, 1), [0.60, 0.72, -2.24]);
  b.pair('tail', RB(0.38, 0.30, 0.10, 0.04, 1), [0.66, 0.86, 2.25]);

  b.axle(0.80, 0.35, -1.50, 0.35, 0.28);
  b.axle(0.80, 0.35, 1.52, 0.35, 0.28);

  return b.bake([1.95, 1.65, 4.60], { police: true, forcePaint: '#eef1f6', forceAccent: '#14181f' });
}

// ===========================================================================
// 6 – Blueprints
// ===========================================================================

const PLAYER_BUILDERS = {
  coupe: buildCoupe,
  hatch: buildHatch,
  muscle: buildMuscle,
  pickup: buildPickup,
  police: buildPoliceCar,
  gt: buildGt,
  formula: buildFormula,
  hover: buildHover,
};

const TRAFFIC_BUILDERS = {
  sedan: buildTrafficSedan,
  hatch: buildTrafficHatch,
  taxi: buildTrafficTaxi,
  van: buildTrafficVan,
  truck: buildTrafficTruck,
  police: buildTrafficPolice,
};

const TRAFFIC_TYPES = new Set(TRAFFIC.map((t) => t.type));
const blueprintCache = new Map();

function getBlueprint(kind, name, D) {
  const key = `${kind}:${name}:${D.key}`;
  let bp = blueprintCache.get(key);
  if (bp === undefined) {
    const builder = (kind === 'p' ? PLAYER_BUILDERS : TRAFFIC_BUILDERS)[name];
    bp = builder(new Bag(D), D);
    blueprintCache.set(key, bp);
  }
  return bp;
}

// ===========================================================================
// 7 – Fahrzeug-Instanz
// ===========================================================================

class Vehicle {
  constructor(blueprint, ctx) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = blueprint.bodyY || 0;
    root.add(body);

    this.object = root;
    this.body = body;
    this.size = new THREE.Vector3(blueprint.size[0], blueprint.size[1], blueprint.size[2]);

    this._t = Math.random() * 8;          // Phasenversatz, damit nicht alle synchron zittern
    this._bodyY = blueprint.bodyY || 0;
    this._hover = !!blueprint.hover;
    this._ghost = !!ctx.ghost;
    this._nitro = false;
    this._brake = false;
    this._night = false;
    this._disposables = [];
    this._wheels = [];
    this._flames = [];
    this._named = Object.create(null);
    this._beams = null;
    this._tailMeshes = [];
    this._headMeshes = [];
    this._redOn = null;
    this._blueOn = null;
    this._police = (blueprint.police && !this._ghost) ? { red: null, blue: null } : null;

    for (const part of blueprint.parts) {
      // Geister bekommen keine additiven Effekte
      if (this._ghost && (part.role === 'glow' || part.role === 'flame' || part.role === 'beam')) continue;

      let material = resolveMaterial(part.role, ctx);
      if (part.dyn && !this._ghost) {
        material = material.clone();
        this._disposables.push(material);
      }
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.castShadow = !this._ghost && part.cast !== false;
      mesh.receiveShadow = false;
      if (part.renderOrder) mesh.renderOrder = part.renderOrder;
      if (part.hidden) mesh.visible = false;
      (part.root ? root : body).add(mesh);

      if (part.name) this._named[part.name] = mesh;
      if (part.flame) this._flames.push(mesh);
      if (part.role === 'tail') this._tailMeshes.push(mesh);
      if (part.role === 'head') this._headMeshes.push(mesh);
      if (part.role === 'beam') this._beams = mesh;
      if (this._police && part.role === 'barRed') this._police.red = mesh;
      if (this._police && part.role === 'barBlue') this._police.blue = mesh;
    }

    // Räder hängen an der WURZEL, damit die Federung sie nicht mitnimmt.
    const wheelMats = this._ghost
      ? [matGhost(ctx.ghostColor), matGhost(ctx.ghostColor)]
      : [MAT.tire(), MAT.rim()];
    for (const w of blueprint.wheels) {
      const mesh = new THREE.Mesh(w.geometry, wheelMats);
      mesh.position.set(w.x, w.y, w.z);
      mesh.castShadow = !this._ghost;
      root.add(mesh);
      this._wheels.push({ mesh, inv: 1 / w.radius });
    }

    if (this._police) this.#setPolice(false, false);
  }

  // ---- Zustand -----------------------------------------------------------

  /** Nitro-Flammen an/aus (nur Spielerautos haben welche). */
  setNitro(on) {
    const want = !!on;
    if (want === this._nitro) return;
    this._nitro = want;
    for (const f of this._flames) f.visible = want;
  }

  /** Bremslicht: Rückleuchten deutlich heller. */
  setBrake(on) {
    const want = !!on;
    if (want === this._brake) return;
    this._brake = want;
    this.#applyTail();
  }

  /** Nachtmodus: hellere Lampen + sichtbare Lichtkegel. */
  setHeadlights(on) {
    const want = !!on;
    if (want === this._night) return;
    this._night = want;
    if (!this._ghost) {
      const m = want ? MAT.headOn() : MAT.headOff();
      for (const h of this._headMeshes) h.material = m;
      if (this._beams) this._beams.visible = want;
    }
    this.#applyTail();
  }

  #applyTail() {
    if (this._ghost) return;
    const m = this._brake ? MAT.tailBrake() : (this._night ? MAT.tailNight() : MAT.tail());
    for (const t of this._tailMeshes) if (t.material !== m) t.material = m;
  }

  #setPolice(red, blue) {
    if (this._redOn !== red) {
      this._redOn = red;
      if (this._police.red) this._police.red.material = red ? MAT.barRedOn() : MAT.barRedOff();
    }
    if (this._blueOn !== blue) {
      this._blueOn = blue;
      if (this._police.blue) this._police.blue.material = blue ? MAT.barBlueOn() : MAT.barBlueOff();
    }
  }

  // ---- Animation ---------------------------------------------------------

  update(dt, speed) {
    if (!(dt > 0)) dt = 0;
    const t = (this._t += dt);
    const v = Number.isFinite(speed) ? speed : 0;

    // Räder drehen (Umfangsgeschwindigkeit), Vorzeichen: Fahrt nach -Z
    for (let i = 0; i < this._wheels.length; i++) {
      const w = this._wheels[i];
      let r = w.mesh.rotation.x - v * w.inv * dt;
      if (r < -1e5 || r > 1e5) r %= TAU;
      w.mesh.rotation.x = r;
    }

    // Federung / Motorvibration
    const shake = Math.min(1, v / 55);
    if (this._hover) {
      this.body.position.y = this._bodyY + Math.sin(t * 1.7) * 0.055 + Math.sin(t * 2.9 + 1.1) * 0.022;
      this.body.rotation.z = Math.sin(t * 1.15) * 0.026;
      this.body.rotation.x = Math.sin(t * 0.9 + 0.6) * 0.018;
    } else {
      this.body.position.y = this._bodyY + (Math.sin(t * 26) * 0.007 + Math.sin(t * 13.3) * 0.004) * shake;
      this.body.rotation.x = Math.sin(t * 9.1) * 0.0045 * shake;
    }

    if (this._ghost) return;

    // Nitro-Flammen flackern
    if (this._nitro) {
      for (let i = 0; i < this._flames.length; i++) {
        const f = this._flames[i];
        const p = t + i * 0.41;
        const n = 0.82 + Math.sin(p * 43) * 0.15 + Math.sin(p * 71.7) * 0.07;
        f.scale.set(0.85 + n * 0.2, 0.85 + n * 0.2, n);
        f.material.opacity = 0.5 + n * 0.38;
      }
    }

    // Blaulicht: zwei kurze Doppelblitze pro Sekunde, Rot und Blau versetzt
    if (this._police) {
      const p = (t % 0.9) / 0.9;
      const red = p < 0.075 || (p > 0.14 && p < 0.215);
      const blue = (p > 0.5 && p < 0.575) || (p > 0.64 && p < 0.715);
      this.#setPolice(red, blue);
    }

    // Unterbodenlicht (GT) pulsiert
    const glow = this._named.underglow;
    if (glow) glow.material.opacity = 0.22 + 0.10 * Math.sin(t * 3.1);

    // Schwebetriebwerke / Schwebefeld
    const th = this._named.thrusters;
    if (th) {
      const pulse = 0.55 + 0.25 * Math.sin(t * 6.3) + (this._nitro ? 0.3 : 0);
      th.material.opacity = Math.min(1, pulse);
      th.scale.z = 1 + Math.sin(t * 8.1) * 0.12 + (this._nitro ? 0.5 : 0);
    }
    const pads = this._named.pads;
    if (pads) pads.material.opacity = 0.28 + 0.12 * Math.sin(t * 2.4 + 0.8);
  }

  /** Nur instanz-eigene Ressourcen freigeben – Caches bleiben bestehen. */
  dispose() {
    for (const m of this._disposables) m.dispose();
    this._disposables.length = 0;
    this.object.clear();
    this.body.clear();
    this._wheels.length = 0;
    this._flames.length = 0;
    this._tailMeshes.length = 0;
    this._headMeshes.length = 0;
    this._named = Object.create(null);
    this._beams = null;
    this._police = null;
  }
}

// ===========================================================================
// 8 – Öffentliche API
// ===========================================================================

/**
 * Spielerauto bauen.
 * @param {string} carId  – ID aus CARS (config.js)
 * @param {string} color  – '#rrggbb'
 * @param {{quality?: 'high'|'medium'|'low'}} [options]
 */
export function createPlayerCar(carId, color, options = {}) {
  const car = carById(typeof carId === 'string' ? carId : '');
  const D = detailFor(options.quality);
  const bp = getBlueprint('p', PLAYER_BUILDERS[car.model] ? car.model : 'coupe', D);
  const paint = safeColor(color, car.colors[0]);
  return new Vehicle(bp, {
    paint: bp.forcePaint || paint,
    accent: bp.forceAccent || contrastColor(paint),
    neon: neonColor(paint),
    ghost: false,
  });
}

/**
 * Verkehrsfahrzeug bauen – bewusst günstig (gecachte Geometrien & Materialien).
 * @param {'sedan'|'hatch'|'taxi'|'van'|'truck'|'police'} type
 * @param {string} color – '#rrggbb'
 */
export function createTrafficVehicle(type, color, options = {}) {
  const t = TRAFFIC_TYPES.has(type) ? type : 'sedan';
  const D = detailFor(options.quality);
  const bp = getBlueprint('t', t, D);
  const paint = safeColor(color, '#8e97a6');
  return new Vehicle(bp, {
    paint: bp.forcePaint || paint,
    accent: bp.forceAccent || contrastColor(paint),
    neon: neonColor(paint),
    ghost: false,
  });
}

/**
 * Geisterauto eines Party-Freundes: durchscheinend, eingefärbt, ohne Schatten.
 */
export function createGhostCar(carId, color) {
  const car = carById(typeof carId === 'string' ? carId : '');
  const D = detailFor('medium');
  const bp = getBlueprint('p', PLAYER_BUILDERS[car.model] ? car.model : 'coupe', D);
  const tint = safeColor(color, '#2ec4b6');
  return new Vehicle(bp, { paint: tint, accent: tint, neon: tint, ghost: true, ghostColor: tint });
}

/**
 * Namensschild als Sprite (~2,4 m breit). Der Text kommt von anderen Spielern
 * und wird deshalb gekürzt/gefiltert und ausschließlich über Canvas gezeichnet.
 */
export function createNameTag(text, color) {
  const name = String(text == null ? '' : text)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .slice(0, 16)
    .trim() || 'Fahrer';
  const tint = safeColor(color, '#2ec4b6');

  const W = 512;
  const H = 144;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Abgeschrägte Broadcast-Plakette
  const skew = 14;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(skew, 22);
  ctx.lineTo(W - 8, 22);
  ctx.lineTo(W - 8 - skew, H - 22);
  ctx.lineTo(8, H - 22);
  ctx.closePath();
  ctx.fillStyle = 'rgba(14, 17, 23, 0.82)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = tint;
  ctx.stroke();

  // Farbbalken links
  ctx.beginPath();
  ctx.moveTo(skew + 6, 28);
  ctx.lineTo(skew + 34, 28);
  ctx.lineTo(skew + 34 - 10, H - 28);
  ctx.lineTo(skew - 4, H - 28);
  ctx.closePath();
  ctx.fillStyle = tint;
  ctx.fill();

  // Text, bei Bedarf verkleinert
  let size = 70;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `700 ${size}px "Saira Condensed", "Saira", system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(name).width > W - 130 && size > 26);

  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(6, 8, 12, 0.95)';
  ctx.strokeText(name, W / 2 + 12, H / 2);
  ctx.fillStyle = '#f3f5f9';
  ctx.fillText(name, W / 2 + 12, H / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
  }));
  sprite.scale.set(2.4, 2.4 * (H / W), 1);
  sprite.renderOrder = 12;
  return sprite;
}

/** Alle geteilten Geometrien/Materialien freigeben (z. B. beim Verlassen der Seite). */
export function disposeSharedVehicleAssets() {
  for (const bp of blueprintCache.values()) {
    for (const p of bp.parts) p.geometry.dispose();
    for (const w of bp.wheels) w.geometry.dispose();
  }
  blueprintCache.clear();
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}
