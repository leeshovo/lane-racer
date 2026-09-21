/*
 * world.js – die Umgebung von Lane Racer 2.0.
 *
 * Enthält alles, was nicht Fahrzeug, HUD oder Effekt ist:
 *   Himmelskuppel (Verlauf + Sonne/Mond + Sterne), Nebel, Licht, Environment-Map,
 *   Straße und Untergrund (Canvas-Texturen, die über texture.offset scrollen),
 *   Leitplanken/Pfosten/Laternen, Deko in recycelten z-Segmenten,
 *   ferne Silhouetten am Horizont und Wetterpartikel.
 *
 * Alle fünf Welten existieren gleichzeitig als Datensatz; zwischen ihnen wird in
 * setWorld() über ~3 s geblendet. Die Deko wird beim Recyceln mit der AKTUELLEN
 * Welt neu bestückt – die neue Welt rollt also aus dem Nebel heran.
 *
 * Koordinaten: -Z = Fahrtrichtung, +X = rechts, +Y = oben, Straße liegt bei y = 0.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG, ROAD_WIDTH, LANE_X, WORLDS } from './config.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const ROAD_TILE = 12;                 // 4,5 m Strich + 7,5 m Lücke
const ROAD_TILES = 46;
const ROAD_LENGTH = ROAD_TILE * ROAD_TILES;   // 552 m
const ROAD_START_Z = 40;                      // vorderste Kante (hinter der Kamera)
const ROAD_CENTER_Z = ROAD_START_Z - ROAD_LENGTH / 2;

const GROUND_TILE = 24;
const GROUND_WIDTH = 18 * GROUND_TILE;        // 432 m
const GROUND_TILES_Z = ROAD_LENGTH / GROUND_TILE; // 23

const SEG_COUNT = 10;
const SEG_LEN = CONFIG.scenerySpan / SEG_COUNT; // 29 m

const RAIL_SPACING = 20;              // Pfostenabstand
const RAIL_SLOTS = 16;                // pro Seite
const RAIL_SPAN = RAIL_SPACING * RAIL_SLOTS;  // 320 m
const RAIL_X = 8.2;
const LAMP_SLOTS = 8;                 // Laternen alle 40 m
const LAMP_SPACING = RAIL_SPAN / LAMP_SLOTS;
const LAMP_X = 8.9;

const SKY_RADIUS = 900;
const SUN_DISTANCE = 760;
const BACKDROP_Z = -620;
const BLEND_TIME = 3;                 // Sekunden für einen Weltwechsel

// Wetter-Box (lokal, die Gruppe hängt an der Kamera)
const W_HALF_X = 34;
const W_Z_BACK = 22;
const W_Z_FRONT = -86;
const W_Z_SPAN = W_Z_BACK - W_Z_FRONT;

const QUALITY_PRESETS = {
  // Schatten: nur Fahrzeuge werfen welche (Deko-Pools würden jede Instanz erneut zeichnen). Die Karte deckt nur
  // 44 × 68 m rund ums Auto ab – 1024 px reichen dafür scharf genug.
  high:   { shadow: 1024, aniso: 8, density: 0.8,  points: 700, rain: 700, stars: 700 },
  medium: { shadow: 512,  aniso: 4, density: 0.55, points: 420, rain: 380, stars: 480 },
  low:    { shadow: 0,    aniso: 1, density: 0.4,  points: 220, rain: 190, stars: 320 },
};

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;

/** Canvas + 2D-Kontext in Ein-Zeilen-Form. */
function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

/** Canvas → Textur mit sinnvollen Standardwerten. */
function canvasTexture(canvas, { repeatX = 1, repeatY = 1, aniso = 8, srgb = true, wrapX = THREE.RepeatWrapping } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrapX;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Weicher runder Punkt – Basis für Sterne, Staub, Schnee, Glut. */
function makeDotTexture(soft = 0.0) {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25 + soft * 0.2, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- Geometrie-Bausteine ---------------------------------------------------

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(rTop, rBottom, h, seg, x = 0, y = 0, z = 0, rx = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function coneGeo(r, h, seg, x = 0, y = 0, z = 0) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y, z);
  return g;
}

function plate(w, d, x = 0, y = 0, z = 0) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * Facettierter Felsbrocken. Die Verschiebung ist eine glatte Funktion der
 * Position – dadurch bleiben doppelte Vertices der nicht-indizierten
 * Ikosaeder-Geometrie deckungsgleich und das Netz reißt nicht auf.
 */
function rockGeo(r, detail, amount, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 2.7 + 1.3) * Math.cos(y * 2.1 - 0.7) * Math.sin(z * 3.1 + 2.2);
    const f = 1 + amount * n;
    p.setXYZ(i, x * f * sx, y * f * sy, z * f * sz);
  }
  g.computeVertexNormals();
  return g;
}

/** Vertex-Farbe auf eine Geometrie brennen (nach toNonIndexed). */
function tintGeo(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Mehrere Teile zu einer Geometrie verschmelzen; jedes Teil bekommt seine
 * Farbe als Vertex-Farbe. So reicht eine InstancedMesh für ein ganzes Objekt.
 * parts = [[geometry, colorHex], ...]
 */
function mergeParts(parts) {
  const list = parts.map(([g, hex]) => tintGeo(g.index ? g.toNonIndexed() : g, hex));
  const merged = mergeGeometries(list, false);
  merged.computeBoundingSphere();
  return merged;
}

/** Geometrien ohne Vertex-Farben verschmelzen (für Materialien mit Textur). */
function mergePlain(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(list, false);
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Canvas-Maler: Straße
// ---------------------------------------------------------------------------

const LANE_EDGES = LANE_X.slice(0, -1).map((x, i) => (x + LANE_X[i + 1]) / 2); // [-2, 2]
const ROAD_HALF = ROAD_WIDTH / 2;      // 7,2
const EDGE_LINE_X = ROAD_HALF - 1.2;   // 6,0

/**
 * Eine Straßenkachel (14,4 m × 12 m) malen. Welt-spezifische Extras hängen an `id`.
 */
function paintRoad(id) {
  const W = 512, H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const X = (m) => (m + ROAD_HALF) / ROAD_WIDTH * W;   // Meter → Pixel (quer)
  const Y = (m) => m / ROAD_TILE * H;                  // Meter → Pixel (längs)
  const sx = W / ROAD_WIDTH, sy = H / ROAD_TILE;

  const style = {
    // Linien bewusst nicht reinweiß: bei Tageslicht (dirI 2.6–3.0) würden sie
    // sonst überstrahlen und durch den Bloom wie Leuchtstäbe aussehen.
    meadow:  { base: '#4c515a', dark: '#3f444c', line: '#c2c8d2', center: '#c2c8d2', grain: 0.10 },
    canyon:  { base: '#5b544c', dark: '#4b453e', line: '#c9c0aa', center: '#bf9630', grain: 0.14 },
    neon:    { base: '#191d25', dark: '#12151b', line: '#cfe4ff', center: '#cfe4ff', grain: 0.07 },
    frost:   { base: '#575d66', dark: '#4a4f58', line: '#ccd3dd', center: '#ccd3dd', grain: 0.09 },
    inferno: { base: '#1d1b1c', dark: '#151314', line: '#d7b48a', center: '#e08a3c', grain: 0.12 },
  }[id];

  // Grundfläche
  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, W, H);

  // Asphaltkörnung: viele winzige helle/dunkle Tupfer
  for (let i = 0; i < 5200; i++) {
    const a = Math.random() * style.grain;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`;
    const s = 1 + Math.random() * 2.2;
    ctx.fillRect(Math.random() * W, Math.random() * H, s, s);
  }

  // Längsstreifen (Fahrspuren-Politur)
  ctx.globalAlpha = 0.16;
  for (const lx of LANE_X) {
    const g = ctx.createLinearGradient(X(lx - 1.5), 0, X(lx + 1.5), 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, style.dark);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(X(lx - 1.5), 0, 3 * sx, H);
  }
  ctx.globalAlpha = 1;

  // Risse
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    ctx.beginPath();
    let px = Math.random() * W, py = Math.random() * H;
    ctx.moveTo(px, py);
    for (let s = 0; s < 5; s++) { px += rand(-26, 26); py += rand(10, 42); ctx.lineTo(px, py); }
    ctx.stroke();
  }

  // Schulter (zwischen Randlinie und Fahrbahnrand) etwas dunkler
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, X(-EDGE_LINE_X) - 0.12 * sx, H);
  ctx.fillRect(X(EDGE_LINE_X) + 0.12 * sx, 0, W - X(EDGE_LINE_X), H);

  // Mittelstriche: 4,5 m Strich, 7,5 m Lücke
  ctx.fillStyle = style.center;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  for (const ex of LANE_EDGES) {
    ctx.fillRect(X(ex) - 0.07 * sx, Y(0), 0.14 * sx, Y(4.5));
  }

  // Durchgezogene Randlinien
  ctx.fillStyle = style.line;
  ctx.fillRect(X(-EDGE_LINE_X) - 0.08 * sx, 0, 0.16 * sx, H);
  ctx.fillRect(X(EDGE_LINE_X) - 0.08 * sx, 0, 0.16 * sx, H);

  // Linien leicht abnutzen
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 900; i++) {
    const px = Math.random() * W;
    const near = Math.min(
      Math.abs(px - X(EDGE_LINE_X)), Math.abs(px - X(-EDGE_LINE_X)),
      Math.abs(px - X(LANE_EDGES[0])), Math.abs(px - X(LANE_EDGES[1])),
    );
    if (near > 0.16 * sx) continue;
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
    ctx.fillRect(px, Math.random() * H, 2, 2 + Math.random() * 5);
  }
  ctx.globalAlpha = 1;

  // ---- welt-spezifische Extras ----
  if (id === 'canyon') {
    // Sandverwehungen vom Rand her
    for (let i = 0; i < 140; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const depth = rand(0.1, 2.6);
      ctx.fillStyle = `rgba(206,168,110,${rand(0.05, 0.3)})`;
      const x0 = side < 0 ? 0 : X(ROAD_HALF - depth);
      ctx.fillRect(side < 0 ? 0 : x0, Math.random() * H, depth * sx, rand(6, 40));
    }
  } else if (id === 'frost') {
    // Schnee an den Rändern, Reifenspuren bleiben frei
    for (const side of [-1, 1]) {
      const g = ctx.createLinearGradient(X(side * ROAD_HALF), 0, X(side * (ROAD_HALF - 3.4)), 0);
      g.addColorStop(0, 'rgba(238,246,255,0.95)');
      g.addColorStop(0.55, 'rgba(232,242,255,0.55)');
      g.addColorStop(1, 'rgba(232,242,255,0)');
      ctx.fillStyle = g;
      const x0 = side < 0 ? 0 : X(ROAD_HALF - 3.4);
      ctx.fillRect(x0, 0, 3.4 * sx, H);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(245,250,255,${rand(0.1, 0.55)})`;
      const px = Math.random() < 0.5 ? rand(0, X(-ROAD_HALF + 4.6)) : rand(X(ROAD_HALF - 4.6), W);
      ctx.fillRect(px, Math.random() * H, rand(2, 9), rand(2, 7));
    }
    // festgefahrener Schneematsch in der Spurmitte
    ctx.globalAlpha = 0.25;
    for (const lx of LANE_X) {
      ctx.fillStyle = '#dfe8f2';
      ctx.fillRect(X(lx - 0.35), 0, 0.7 * sx, H);
    }
    ctx.globalAlpha = 1;
  } else if (id === 'neon') {
    // nasser Asphalt: gedehnte, farbige Lichtschlieren
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const px = Math.random() * W;
      const col = pick(['255,60,170', '60,220,255', '255,180,60', '150,90,255']);
      const g = ctx.createLinearGradient(px, 0, px, H);
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(0.5, `rgba(${col},${rand(0.05, 0.16)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - rand(6, 26), 0, rand(12, 52), H);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Pfützen
    for (let i = 0; i < 16; i++) {
      const px = Math.random() * W, py = Math.random() * H;
      const r = rand(14, 46);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(120,160,210,0.16)');
      g.addColorStop(1, 'rgba(120,160,210,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (id === 'inferno') {
    // Glutrisse an den Schultern (der Leuchtanteil kommt aus dem Overlay)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = `rgba(255,${randInt(90, 150)},40,${rand(0.25, 0.6)})`;
        ctx.lineWidth = rand(1, 3.4);
        ctx.beginPath();
        let px = X(side * rand(ROAD_HALF - 1.1, ROAD_HALF - 0.1)), py = rand(-20, H);
        ctx.moveTo(px, py);
        for (let s = 0; s < 6; s++) { px += rand(-9, 9); py += H / 5; ctx.lineTo(px, py); }
        ctx.stroke();
      }
    }
  } else {
    // Sonnental: ein paar geflickte Stellen
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0.07, 0.16)})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * W, Math.random() * H, rand(14, 44), rand(10, 30), Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/** Zusatzschicht über der Straße: nasse Reflexe (neon) bzw. glühende Risse (inferno). */
function paintRoadOverlay(id) {
  const W = 512, H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const X = (m) => (m + ROAD_HALF) / ROAD_WIDTH * W;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  if (id === 'neon') {
    // vertikal verschmierte Spiegelungen der Leuchtreklame
    for (let i = 0; i < 34; i++) {
      const px = Math.random() < 0.5 ? rand(X(-ROAD_HALF), X(-1)) : rand(X(1), X(ROAD_HALF));
      const col = pick(['255,40,150', '40,220,255', '255,170,40', '140,80,255', '80,255,190']);
      const g = ctx.createLinearGradient(px, 0, px, H);
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(rand(0.3, 0.5), `rgba(${col},${rand(0.25, 0.7)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      const w = rand(4, 16);
      ctx.fillRect(px - w / 2, 0, w, H);
    }
    // kleine Lichtpunkte in Pfützen
    for (let i = 0; i < 90; i++) {
      const px = Math.random() * W, py = Math.random() * H, r = rand(2, 11);
      const col = pick(['255,90,180', '90,220,255', '255,200,90']);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${col},0.55)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  } else if (id === 'inferno') {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const baseX = X(side * rand(ROAD_HALF - 1.3, ROAD_HALF - 0.05));
        ctx.strokeStyle = `rgba(255,${randInt(110, 190)},${randInt(30, 70)},${rand(0.5, 0.95)})`;
        ctx.lineWidth = rand(1.5, 4.5);
        ctx.beginPath();
        let px = baseX, py = rand(-40, H);
        ctx.moveTo(px, py);
        for (let s = 0; s < 7; s++) { px += rand(-10, 10); py += H / 6; ctx.lineTo(px, py); }
        ctx.stroke();
        // weicher Schein um den Riss
        ctx.strokeStyle = `rgba(255,90,20,${rand(0.12, 0.26)})`;
        ctx.lineWidth = rand(10, 22);
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// ---------------------------------------------------------------------------
// Canvas-Maler: Untergrund
// ---------------------------------------------------------------------------

function paintGround(id) {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const speckle = (n, colors, min, max, alpha = [0.2, 0.7]) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(colors);
      ctx.globalAlpha = rand(alpha[0], alpha[1]);
      const s = rand(min, max);
      ctx.fillRect(Math.random() * S, Math.random() * S, s, s * rand(0.6, 1.6));
    }
    ctx.globalAlpha = 1;
  };
  const blobs = (n, colors, min, max, alpha = [0.08, 0.22]) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = pick(colors);
      ctx.globalAlpha = rand(alpha[0], alpha[1]);
      ctx.beginPath();
      ctx.ellipse(Math.random() * S, Math.random() * S, rand(min, max), rand(min, max) * 0.7, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  if (id === 'meadow') {
    ctx.fillStyle = '#4c7a33'; ctx.fillRect(0, 0, S, S);
    blobs(26, ['#5b8c3c', '#416b2b', '#63964a'], 16, 52);
    speckle(2600, ['#6ba045', '#3d6428', '#78ad4e'], 1, 3);
    speckle(70, ['#e8e06a', '#f0f4f8', '#e78fb0'], 1.5, 3, [0.5, 0.95]); // Blumen
  } else if (id === 'canyon') {
    ctx.fillStyle = '#b2764a'; ctx.fillRect(0, 0, S, S);
    blobs(30, ['#c2875a', '#9a6238', '#d09a68'], 18, 60);
    speckle(2200, ['#8f5c33', '#d6a578', '#7a4e2c'], 1, 3.2);
    // Windrippel
    ctx.strokeStyle = 'rgba(120,76,42,0.22)';
    for (let i = 0; i < 40; i++) {
      ctx.lineWidth = rand(0.6, 2);
      ctx.beginPath();
      const y = Math.random() * S;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(S * 0.3, y + rand(-9, 9), S * 0.7, y + rand(-9, 9), S, y + rand(-6, 6));
      ctx.stroke();
    }
  } else if (id === 'neon') {
    ctx.fillStyle = '#1b1e26'; ctx.fillRect(0, 0, S, S);
    // Gehwegplatten
    ctx.strokeStyle = 'rgba(120,140,175,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = i * S / 4;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    }
    blobs(18, ['#2a3040', '#141821'], 20, 56, [0.25, 0.5]);
    // nasse Reflexe
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const px = Math.random() * S, py = Math.random() * S, r = rand(6, 30);
      const col = pick(['70,170,255', '255,70,150', '255,190,80']);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${col},0.18)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    speckle(900, ['#0f1218', '#262d3a'], 1, 3);
  } else if (id === 'frost') {
    ctx.fillStyle = '#e6eef8'; ctx.fillRect(0, 0, S, S);
    blobs(30, ['#f4f9ff', '#cfdced', '#dbe6f4'], 16, 58, [0.2, 0.5]);
    speckle(1500, ['#ffffff', '#c6d5e8'], 1, 3, [0.25, 0.8]);
    // Verwehungskanten
    ctx.strokeStyle = 'rgba(176,196,220,0.4)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      const y = Math.random() * S;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(S * 0.35, y + rand(-14, 14), S * 0.7, y + rand(-14, 14), S, y + rand(-8, 8));
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#1a1617'; ctx.fillRect(0, 0, S, S);
    blobs(26, ['#241d1e', '#100d0e', '#2c2324'], 14, 50, [0.3, 0.6]);
    speckle(1800, ['#0d0a0b', '#33292a'], 1, 3.4);
    // Lavaadern
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(255,${randInt(70, 140)},20,${rand(0.3, 0.8)})`;
      ctx.lineWidth = rand(1, 3.5);
      ctx.beginPath();
      let px = Math.random() * S, py = Math.random() * S;
      ctx.moveTo(px, py);
      for (let s = 0; s < 5; s++) { px += rand(-40, 40); py += rand(-40, 40); ctx.lineTo(px, py); }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,60,10,${rand(0.08, 0.18)})`;
      ctx.lineWidth = rand(8, 18);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Canvas-Maler: ferne Silhouetten
// ---------------------------------------------------------------------------

/**
 * Horizont-Panorama. Unterkante des Bildes = y -40 m, Oberkante = y 260 m.
 * Alles wird halbtransparent und kontrastarm gemalt, damit es "unendlich weit"
 * wirkt (die Meshes liegen außerhalb des Nebels).
 */
function paintBackdrop(id) {
  const W = 1024, H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const HORIZON = 222;

  const ridge = (opts) => {
    const { color, alpha, peakMin, peakMax, steps, jag, base = HORIZON } = opts;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, base + 40);
    ctx.lineTo(-10, base - rand(peakMin, peakMax));
    let x = -10;
    const dx = (W + 20) / steps;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const h = rand(peakMin, peakMax) * (0.55 + 0.45 * Math.sin(t * Math.PI * rand(0.8, 2.4) + rand(0, 6)));
      x += dx;
      if (jag) {
        ctx.lineTo(x - dx * 0.5, base - h * rand(1.0, 1.35));
        ctx.lineTo(x, base - h * rand(0.35, 0.8));
      } else {
        ctx.quadraticCurveTo(x - dx * 0.5, base - h * 1.25, x, base - h * rand(0.5, 0.95));
      }
    }
    ctx.lineTo(W + 10, base + 40);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  if (id === 'meadow') {
    ridge({ color: '#7fa8c9', alpha: 0.55, peakMin: 40, peakMax: 105, steps: 9, jag: false });
    ridge({ color: '#5f89a8', alpha: 0.6, peakMin: 24, peakMax: 60, steps: 13, jag: false, base: HORIZON + 6 });
    ridge({ color: '#4d6e55', alpha: 0.75, peakMin: 10, peakMax: 30, steps: 20, jag: false, base: HORIZON + 12 });
  } else if (id === 'canyon') {
    // Tafelberge: flache Kronen
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#8d5a41';
    for (let i = 0; i < 16; i++) {
      const x = rand(-40, W), w = rand(60, 210), h = rand(30, 95);
      ctx.fillRect(x, HORIZON - h, w, h + 40);
      ctx.fillRect(x - rand(4, 20), HORIZON - h * 0.55, w + rand(8, 40), h * 0.55 + 40);
    }
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#6d4130';
    for (let i = 0; i < 12; i++) {
      const x = rand(-40, W), w = rand(50, 160), h = rand(14, 52);
      ctx.fillRect(x, HORIZON + 6 - h, w, h + 40);
    }
    ctx.globalAlpha = 1;
  } else if (id === 'neon') {
    // Skyline mit Fensterpunkten
    const towers = [];
    let x = -30;
    while (x < W + 30) {
      const w = rand(26, 74), h = rand(35, 165);
      towers.push({ x, w, h });
      x += w + rand(2, 14);
    }
    ctx.globalAlpha = 0.85;
    for (const t of towers) {
      ctx.fillStyle = Math.random() < 0.5 ? '#151a2a' : '#1d2238';
      ctx.fillRect(t.x, HORIZON - t.h, t.w, t.h + 40);
      if (chance(0.3)) ctx.fillRect(t.x + t.w * 0.45, HORIZON - t.h - rand(8, 26), 2.5, rand(8, 26));
    }
    ctx.globalAlpha = 1;
    // Fenster
    for (const t of towers) {
      for (let wy = HORIZON - t.h + 5; wy < HORIZON - 4; wy += 6) {
        for (let wx = t.x + 3; wx < t.x + t.w - 3; wx += 5) {
          if (!chance(0.32)) continue;
          ctx.fillStyle = pick(['rgba(255,214,140,0.85)', 'rgba(150,220,255,0.8)', 'rgba(255,140,200,0.7)']);
          ctx.fillRect(wx, wy, 2, 2.6);
        }
      }
    }
    // Lichtdunst über der Stadt
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, HORIZON - 60, 0, HORIZON + 10);
    g.addColorStop(0, 'rgba(120,60,180,0)');
    g.addColorStop(1, 'rgba(190,70,180,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, HORIZON - 60, W, 70);
    ctx.globalCompositeOperation = 'source-over';
  } else if (id === 'frost') {
    ridge({ color: '#b9cfe6', alpha: 0.5, peakMin: 60, peakMax: 150, steps: 8, jag: true });
    ridge({ color: '#8fb0cd', alpha: 0.6, peakMin: 34, peakMax: 90, steps: 12, jag: true, base: HORIZON + 5 });
    ridge({ color: '#e8f1fb', alpha: 0.45, peakMin: 12, peakMax: 36, steps: 18, jag: true, base: HORIZON + 12 });
  } else {
    ridge({ color: '#2a1d1f', alpha: 0.85, peakMin: 18, peakMax: 60, steps: 14, jag: true, base: HORIZON + 8 });
    // Vulkankegel
    const cx = W * 0.62, h = 178, halfW = 190;
    ctx.globalAlpha = 0.95; ctx.fillStyle = '#1e1416';
    ctx.beginPath();
    ctx.moveTo(cx - halfW, HORIZON + 40);
    ctx.lineTo(cx - 26, HORIZON - h);
    ctx.lineTo(cx + 26, HORIZON - h);
    ctx.lineTo(cx + halfW, HORIZON + 40);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // glühender Krater + Lavaströme
    ctx.globalCompositeOperation = 'lighter';
    let g = ctx.createRadialGradient(cx, HORIZON - h, 0, cx, HORIZON - h, 60);
    g.addColorStop(0, 'rgba(255,190,90,0.9)');
    g.addColorStop(0.3, 'rgba(255,90,20,0.5)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 70, HORIZON - h - 70, 140, 140);
    ctx.strokeStyle = 'rgba(255,120,40,0.55)';
    for (let i = 0; i < 5; i++) {
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      let px = cx + rand(-22, 22), py = HORIZON - h + 4;
      ctx.moveTo(px, py);
      for (let s = 0; s < 5; s++) { px += rand(-16, 16); py += rand(20, 38); ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // Rauchfahne
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#3b3033';
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      ctx.beginPath();
      ctx.ellipse(cx + t * 60 + rand(-10, 10), HORIZON - h - t * 90, 16 + t * 42, 11 + t * 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Canvas-Maler: Sonne, Mond, Neonfassaden, Schilder
// ---------------------------------------------------------------------------

function paintSun() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,248,222,1)');
  g.addColorStop(0.2, 'rgba(255,224,160,0.78)');
  g.addColorStop(0.42, 'rgba(255,176,90,0.26)');
  g.addColorStop(0.72, 'rgba(255,140,70,0.07)');
  g.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return canvas;
}

function paintMoon() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(210,228,255,0.25)');
  g.addColorStop(0.3, 'rgba(180,205,245,0.12)');
  g.addColorStop(1, 'rgba(150,180,230,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // Scheibe
  ctx.save();
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#e8eefc'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(160,178,205,0.55)';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(S / 2 + rand(-42, 42), S / 2 + rand(-42, 42), rand(3, 13), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return canvas;
}

/** Fassade + Fenster-Emissionskarte für Neon-City-Hochhäuser. */
function paintFacade() {
  const W = 128, H = 256;
  const base = makeCanvas(W, H);
  const glow = makeCanvas(W, H);
  base.ctx.fillStyle = '#23283a'; base.ctx.fillRect(0, 0, W, H);
  glow.ctx.fillStyle = '#000000'; glow.ctx.fillRect(0, 0, W, H);
  // Betonstruktur
  for (let i = 0; i < 1400; i++) {
    base.ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    base.ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const cols = 6, rows = 16;
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.22, y = r * rh + rh * 0.2;
      const w = cw * 0.56, h = rh * 0.5;
      base.ctx.fillStyle = '#12141d';
      base.ctx.fillRect(x, y, w, h);
      if (chance(0.42)) {
        const col = pick(['#ffd79a', '#a9e6ff', '#ff9ad2', '#d8ffd0']);
        glow.ctx.fillStyle = col;
        glow.ctx.globalAlpha = rand(0.5, 1);
        glow.ctx.fillRect(x, y, w, h);
        glow.ctx.globalAlpha = 1;
      }
    }
    // Geschossband
    base.ctx.fillStyle = 'rgba(0,0,0,0.35)';
    base.ctx.fillRect(0, r * rh + rh * 0.78, W, rh * 0.1);
  }
  return { base: base.canvas, glow: glow.canvas };
}

/** Leuchtreklame – abstrakte Schriftbänder und Rahmen. */
function paintSign(hue) {
  const W = 256, H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = hue; ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.fillStyle = hue;
  // "Schrift" als Balkenmuster
  let x = 28;
  while (x < W - 40) {
    const w = rand(6, 22), h = rand(16, 46);
    ctx.globalAlpha = rand(0.6, 1);
    ctx.fillRect(x, H / 2 - h / 2, w, h);
    x += w + rand(7, 18);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

// ---------------------------------------------------------------------------
// Welt-Paletten
// ---------------------------------------------------------------------------

/*
 * Farben in sRGB-Hex, Zahlen in linearen Einheiten. `prepare()` macht daraus
 * THREE.Color/Vector3, damit pro Frame nur noch gelerpt werden muss.
 */
const RAW_PRESETS = [
  {
    id: 'meadow', night: false, weather: 'pollen',
    sunDir: [0.42, 0.66, -0.62],
    colors: {
      fog: 0xbcd6ee, zenith: 0x2f6fc8, horizon: 0xc3dcf1, sunGlow: 0xffe6b0, ambient: 0xbcd6f0,
      hemiSky: 0xa6cdf2, hemiGround: 0x527a34, dirColor: 0xfff1d2,
      road: 0xffffff, ground: 0xffffff, rail: 0xd9dfe6, lamp: 0xfff0c8,
    },
    nums: {
      ambI: 0.45, hemiI: 0.85, dirI: 2.6, env: 0.95, exposure: 1.02,
      bloomS: 0.35, bloomR: 0.55, bloomT: 0.82,
      roadRough: 0.9, roadMetal: 0.0, roadEnv: 0.5,
      groundRough: 0.97, groundEnv: 0.45,
      railRough: 0.42, railMetal: 0.65, lampI: 0.04,
      overlay: 0, stars: 0, sunOp: 0.95, moonOp: 0, weatherAmt: 0.35,
    },
  },
  {
    id: 'canyon', night: false, weather: 'dust',
    sunDir: [-0.58, 0.26, -0.77],
    colors: {
      fog: 0xe0a071, zenith: 0x2a4a86, horizon: 0xf0b478, sunGlow: 0xff9a45, ambient: 0xe8b184,
      hemiSky: 0xf2b07a, hemiGround: 0x7a4527, dirColor: 0xffb268,
      road: 0xfff0e0, ground: 0xffe9d6, rail: 0xc9a487, lamp: 0xffd9a0,
    },
    nums: {
      ambI: 0.5, hemiI: 0.8, dirI: 3.0, env: 0.8, exposure: 1.0,
      bloomS: 0.55, bloomR: 0.6, bloomT: 0.78,
      roadRough: 0.95, roadMetal: 0.0, roadEnv: 0.4,
      groundRough: 1.0, groundEnv: 0.4,
      railRough: 0.75, railMetal: 0.3, lampI: 0.05,
      overlay: 0, stars: 0, sunOp: 1.0, moonOp: 0, weatherAmt: 0.85,
    },
  },
  {
    id: 'neon', night: true, weather: 'rain',
    sunDir: [-0.40, 0.44, -0.80],
    colors: {
      fog: 0x14182a, zenith: 0x070a18, horizon: 0x2b1f4a, sunGlow: 0x6e7cff, ambient: 0x3b4a7a,
      hemiSky: 0x33406e, hemiGround: 0x120f1c, dirColor: 0x9fb4ff,
      road: 0xdfe6f5, ground: 0xc9d4e8, rail: 0x6e7c96, lamp: 0xffd9a8,
    },
    nums: {
      ambI: 0.5, hemiI: 0.5, dirI: 0.75, env: 0.45, exposure: 1.18,
      bloomS: 1.1, bloomR: 0.68, bloomT: 0.7,
      roadRough: 0.14, roadMetal: 0.55, roadEnv: 1.7,
      groundRough: 0.42, groundEnv: 1.1,
      railRough: 0.3, railMetal: 0.8, lampI: 3.4,
      overlay: 0.85, stars: 0.55, sunOp: 0, moonOp: 0.9, weatherAmt: 1.0,
    },
  },
  {
    id: 'frost', night: false, weather: 'snow',
    sunDir: [0.30, 0.52, -0.80],
    colors: {
      fog: 0xd3e2f2, zenith: 0x4c7fb8, horizon: 0xdfeaf7, sunGlow: 0xdff0ff, ambient: 0xcfe1f5,
      hemiSky: 0xcfe3f8, hemiGround: 0x9fb2c6, dirColor: 0xf0f6ff,
      road: 0xf2f6fb, ground: 0xffffff, rail: 0xe4ecf6, lamp: 0xdcefff,
    },
    nums: {
      ambI: 0.72, hemiI: 1.0, dirI: 1.9, env: 1.15, exposure: 0.98,
      bloomS: 0.4, bloomR: 0.5, bloomT: 0.85,
      roadRough: 0.5, roadMetal: 0.12, roadEnv: 0.8,
      groundRough: 0.78, groundEnv: 0.8,
      railRough: 0.35, railMetal: 0.45, lampI: 0.35,
      overlay: 0, stars: 0, sunOp: 0.55, moonOp: 0, weatherAmt: 1.0,
    },
  },
  {
    id: 'inferno', night: true, weather: 'ember',
    sunDir: [0.55, 0.30, -0.78],
    colors: {
      fog: 0x3a1410, zenith: 0x160709, horizon: 0x7a1e0c, sunGlow: 0xff5a1e, ambient: 0x6b2414,
      hemiSky: 0x7a2a14, hemiGround: 0x2a0d08, dirColor: 0xff9b55,
      road: 0xf0d8c8, ground: 0xffe0cc, rail: 0x50393a, lamp: 0xff9a40,
    },
    nums: {
      ambI: 0.55, hemiI: 0.7, dirI: 1.25, env: 0.4, exposure: 1.12,
      bloomS: 0.95, bloomR: 0.62, bloomT: 0.74,
      roadRough: 0.72, roadMetal: 0.1, roadEnv: 0.6,
      groundRough: 0.85, groundEnv: 0.5,
      railRough: 0.6, railMetal: 0.5, lampI: 1.6,
      overlay: 0.9, stars: 0.22, sunOp: 0.5, moonOp: 0, weatherAmt: 1.0,
    },
  },
];

const COLOR_KEYS = Object.keys(RAW_PRESETS[0].colors);
const NUM_KEYS = Object.keys(RAW_PRESETS[0].nums);

function preparePreset(raw) {
  const colors = {};
  for (const k of COLOR_KEYS) colors[k] = new THREE.Color(raw.colors[k]);
  return {
    id: raw.id, night: raw.night, weather: raw.weather,
    sunDir: new THREE.Vector3(...raw.sunDir).normalize(),
    colors, nums: { ...raw.nums },
  };
}

const PRESETS = RAW_PRESETS.map(preparePreset);
const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/*
 * Tageszeiten: Aus jeder Welt lassen sich Varianten ableiten (Morgen, Abend, Nacht, Mittag).
 * tint  = Farbe → [Zielfarbe, Anteil 0–1], mit dem die Grundfarbe gemischt wird
 * mul   = Zahlen, die mit einem Faktor multipliziert werden
 * set   = Zahlen, die fest gesetzt werden
 * Welche Welt welche Zeiten kennt, steht in WORLD_TIMES (config.js).
 */
const TIME_OF_DAY = {
  dawn: {
    sunDir: [0.62, 0.2, -0.75],
    tint: {
      fog: [0xf2c8b8, 0.55], zenith: [0x5c6fb4, 0.5], horizon: [0xffc59f, 0.75], sunGlow: [0xffb070, 1],
      ambient: [0xe9c1b8, 0.5], hemiSky: [0xe8b9b0, 0.5], dirColor: [0xffc190, 0.75],
    },
    mul: { dirI: 0.85 },
    set: { sunOp: 1 },
  },
  dusk: {
    sunDir: [-0.66, 0.16, -0.73],
    tint: {
      fog: [0xf0b184, 0.6], zenith: [0x39447e, 0.55], horizon: [0xffa257, 0.8], sunGlow: [0xff8a3a, 1],
      ambient: [0xe7a888, 0.5], hemiSky: [0xe8a878, 0.5], dirColor: [0xffa050, 0.85],
    },
    mul: { dirI: 0.95, exposure: 0.98 },
    set: { sunOp: 1 },
  },
  day: {
    sunDir: [0.2, 0.92, -0.35],
    tint: {
      fog: [0xc8dff5, 0.6], zenith: [0x2b6cc9, 0.6], horizon: [0xcfe4f6, 0.6], sunGlow: [0xfff2c8, 1], dirColor: [0xfff6e0, 0.85],
    },
    mul: { dirI: 1.05 },
    set: { sunOp: 0.95 },
  },
  night: {
    night: true,
    sunDir: [-0.35, 0.5, -0.8],
    tint: {
      fog: [0x0e1424, 0.92], zenith: [0x040814, 0.95], horizon: [0x1a2448, 0.9], sunGlow: [0x6070ff, 1],
      ambient: [0x2b3860, 0.85], hemiSky: [0x28345c, 0.85], hemiGround: [0x0e0d18, 0.7], dirColor: [0x9fb4ff, 0.9],
      road: [0xa9b4cc, 0.7], ground: [0x8f9cb8, 0.65], rail: [0x6e7c96, 0.5], lamp: [0xffd9a8, 1],
    },
    mul: {},
    set: {
      ambI: 0.3, hemiI: 0.35, dirI: 0.55, env: 0.35, exposure: 1.15, bloomS: 0.9, bloomT: 0.72,
      lampI: 2.6, stars: 0.9, sunOp: 0, moonOp: 0.9, overlay: 0,
    },
  },
};

const TIME_VARIANTS = new Map();

/** Leitet aus einem Welt-Preset eine Tageszeit-Variante ab (einmal berechnet, danach aus dem Zwischenspeicher). */
function makeTimeVariant(base, time) {
  const def = TIME_OF_DAY[time];
  if (!def) return base;
  const key = base.id + ':' + time;
  if (TIME_VARIANTS.has(key)) return TIME_VARIANTS.get(key);

  const colors = {};
  for (const k of COLOR_KEYS) {
    colors[k] = base.colors[k].clone();
    if (def.tint[k]) colors[k].lerp(new THREE.Color(def.tint[k][0]), def.tint[k][1]);
  }
  const nums = { ...base.nums };
  for (const k of Object.keys(def.mul || {})) nums[k] *= def.mul[k];
  for (const k of Object.keys(def.set || {})) nums[k] = def.set[k];
  const variant = {
    id: base.id,
    night: def.night ?? base.night,
    weather: base.weather,
    sunDir: new THREE.Vector3(...def.sunDir).normalize(),
    colors,
    nums,
    base, // Texturen und Szenerie richten sich nach der Grundwelt
    time,
  };
  TIME_VARIANTS.set(key, variant);
  return variant;
}

/** Leere Live-Struktur (wird pro Frame befüllt). */
function makeLive() {
  const colors = {};
  for (const k of COLOR_KEYS) colors[k] = new THREE.Color();
  const nums = {};
  for (const k of NUM_KEYS) nums[k] = 0;
  return { colors, nums, sunDir: new THREE.Vector3(0, 1, 0) };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  constructor({ scene, renderer, quality = 'high' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'high';
    this.q = QUALITY_PRESETS[this.quality];

    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);

    // Blend-Zustand
    this._index = 0;
    this._target = PRESETS[0];
    this._from = makeLive();
    this._live = makeLive();
    this._t = 1;
    this._blending = false;
    this._texFrom = 0;
    this._texSwapped = true;
    this._bloom = { strength: 0.35, radius: 0.55, threshold: 0.82 };

    // Wiederverwendete Rechenobjekte (keine Allokation pro Frame)
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();

    this._disposables = [];   // Texturen/Geometrien/Materialien, die uns gehören
    this._elapsed = 0;

    this._buildTextures();
    this._initSky();
    this._initLights();
    this._initEnvironment();
    this._initRoad();
    this._initRoadside();
    this._initPools();
    this._initSegments();
    this._initBackdrop();
    this._initWeather();

    this.setWorld(0, true);
  }

  // -- Aufbau --------------------------------------------------------------

  _buildTextures() {
    const aniso = Math.min(this.q.aniso, this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
    this.roadTex = [];
    this.groundTex = [];
    this.overlayTex = [];
    for (const p of PRESETS) {
      const rt = canvasTexture(paintRoad(p.id), {
        repeatX: 1, repeatY: ROAD_TILES, aniso, wrapX: THREE.ClampToEdgeWrapping,
      });
      const gt = canvasTexture(paintGround(p.id), {
        repeatX: GROUND_WIDTH / GROUND_TILE, repeatY: GROUND_TILES_Z, aniso,
      });
      const ot = canvasTexture(paintRoadOverlay(p.id), {
        repeatX: 1, repeatY: ROAD_TILES, aniso, wrapX: THREE.ClampToEdgeWrapping,
      });
      this.roadTex.push(rt); this.groundTex.push(gt); this.overlayTex.push(ot);
      this._disposables.push(rt, gt, ot);
    }
  }

  _initSky() {
    this.sky = new THREE.Group();
    this.sky.name = 'sky';
    this.root.add(this.sky);

    this.skyUniforms = {
      uZenith: { value: new THREE.Color(0x2f6fc8) },
      uHorizon: { value: new THREE.Color(0xc3dcf1) },
      uHaze: { value: new THREE.Color(0xbcd6ee) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunGlow: { value: new THREE.Color(0xffe6b0) },
      uGlowAmount: { value: 1 },
    };

    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uHaze;
        uniform vec3 uSunDir;
        uniform vec3 uSunGlow;
        uniform float uGlowAmount;
        varying vec3 vDir;

        // Hinweis: tonemapping_pars / colorspace_pars stecken bereits im
        // Shader-Prefix, das three jedem ShaderMaterial voranstellt – hier
        // dürfen nur die beiden Anwendungs-Chunks in main() stehen.

        void main() {
          vec3 dir = normalize( vDir );
          float h = dir.y;
          // Horizont → Zenit
          float t = smoothstep( 0.0, 0.46, h );
          vec3 col = mix( uHorizon, uZenith, pow( t, 0.85 ) );
          // unterhalb des Horizonts in den Nebeldunst überblenden
          col = mix( col, uHaze, smoothstep( 0.02, -0.14, h ) );
          // Sonnen-/Mondhof
          float d = max( dot( dir, normalize( uSunDir ) ), 0.0 );
          col += uSunGlow * ( pow( d, 48.0 ) * 0.9 + pow( d, 6.0 ) * 0.16 + pow( d, 2.0 ) * 0.05 ) * uGlowAmount;
          gl_FragColor = vec4( col, 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -1000;
    this.sky.add(this.skyDome);
    this._disposables.push(skyGeo, skyMat);

    // Sterne
    const starCount = QUALITY_PRESETS.high.stars;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.pow(Math.random(), 0.65);          // Richtung Zenit verdichten
      const y = 0.02 + v * 0.98;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      starPos[i * 3] = Math.cos(u) * r * 860;
      starPos[i * 3 + 1] = y * 860;
      starPos[i * 3 + 2] = Math.sin(u) * r * 860;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starTex = makeDotTexture(0.3);
    const starMat = new THREE.PointsMaterial({
      map: this.starTex, size: 2.6, sizeAttenuation: false, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0,
      color: 0xdfe9ff,
    });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    this.sky.add(this.stars);
    this._disposables.push(starGeo, starMat, this.starTex);

    // Sonne und Mond (Sprites, additiv – die Bloom-Pass greift sie auf)
    const sunTex = new THREE.CanvasTexture(paintSun());
    sunTex.colorSpace = THREE.SRGBColorSpace;
    const moonTex = new THREE.CanvasTexture(paintMoon());
    moonTex.colorSpace = THREE.SRGBColorSpace;
    const mkDisc = (tex, size) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(size, size, 1);
      this.sky.add(sp);
      this._disposables.push(mat);
      return sp;
    };
    this.sunDisc = mkDisc(sunTex, 190);
    this.moonDisc = mkDisc(moonTex, 150);
    this._disposables.push(sunTex, moonTex);
  }

  _initLights() {
    // Alle Lichter werden genau einmal erzeugt – zur Laufzeit ändern sich nur
    // Farbe, Intensität und Position (sonst würden Shader neu kompiliert).
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    this.hemi.position.set(0, 60, 0);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunTarget = new THREE.Object3D();
    this.sunTarget.position.set(0, 0, -15);
    this.sun.target = this.sunTarget;

    const sh = this.sun.shadow;
    sh.camera.left = -22; sh.camera.right = 22;
    sh.camera.top = 34; sh.camera.bottom = -34;
    sh.camera.near = 20; sh.camera.far = 270;
    // Bias großzügig: Die Straße liegt fast parallel zum flachen Sonnenlicht,
    // mit kleineren Werten entsteht ein dunkles Streifenmuster (Shadow Acne).
    sh.bias = -0.0008;
    sh.normalBias = 0.08;
    sh.radius = 2;
    this._applyShadowQuality();

    this.root.add(this.ambient, this.hemi, this.sun, this.sunTarget);
  }

  /** Schatten der Sonne ein-/ausschalten (für die automatische Leistungsanpassung; kein Shader-Neubau nötig). */
  setShadowsEnabled(on) {
    this._shadowsWanted = Boolean(on);
    this.sun.castShadow = this._shadowsWanted && this.q.shadow > 0;
  }

  _applyShadowQuality() {
    const size = this.q.shadow;
    this.sun.castShadow = size > 0 && this._shadowsWanted !== false;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map && this.sun.shadow.map.width !== size) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  _initEnvironment() {
    if (!this.renderer) return;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    this.pmrem.dispose();
    this.pmrem = null;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 1;
  }

  _initRoad() {
    // Nebel: bei fogFar = 215 ist der Spawnpunkt z = -235 vollständig verschluckt.
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0xbcd6ee, CONFIG.fogNear, CONFIG.fogFar);
    else { this.scene.fog.near = CONFIG.fogNear; this.scene.fog.far = CONFIG.fogFar; }

    // -- Fahrbahn --
    this.roadBlend = { uMapB: { value: this.roadTex[0] }, uBlend: { value: 0 } };
    this.roadMat = this._makeBlendMaterial(this.roadTex[0], this.roadBlend, {
      roughness: 0.9, metalness: 0, envMapIntensity: 0.5,
    });
    const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH, 1, 24);
    roadGeo.rotateX(-Math.PI / 2);
    this.road = new THREE.Mesh(roadGeo, this.roadMat);
    this.road.position.set(0, 0, ROAD_CENTER_Z);
    this.road.receiveShadow = true;
    this.road.frustumCulled = false;
    this.road.renderOrder = -2;
    this.root.add(this.road);
    this._disposables.push(roadGeo, this.roadMat);

    // -- Untergrund --
    this.groundBlend = { uMapB: { value: this.groundTex[0] }, uBlend: { value: 0 } };
    this.groundMat = this._makeBlendMaterial(this.groundTex[0], this.groundBlend, {
      roughness: 0.97, metalness: 0, envMapIntensity: 0.45,
    });
    const groundGeo = new THREE.PlaneGeometry(GROUND_WIDTH, ROAD_LENGTH, 8, 48);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.position.set(0, -0.045, ROAD_CENTER_Z);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -3;
    this.root.add(this.ground);
    this._disposables.push(groundGeo, this.groundMat);

    // -- Reflex-/Glut-Overlay über der Fahrbahn --
    this.overlayMat = new THREE.MeshBasicMaterial({
      map: this.overlayTex[0], transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    });
    const ovGeo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH, 1, 24);
    ovGeo.rotateX(-Math.PI / 2);
    this.overlay = new THREE.Mesh(ovGeo, this.overlayMat);
    this.overlay.position.set(0, 0.02, ROAD_CENTER_Z);
    this.overlay.frustumCulled = false;
    this.overlay.visible = false;
    this.overlay.renderOrder = -1;
    this.root.add(this.overlay);
    this._disposables.push(ovGeo, this.overlayMat);
  }

  /**
   * MeshStandardMaterial, das zwei Texturen überblenden kann. Der zweite
   * Sampler wird per onBeforeCompile eingehängt; die Uniform-Objekte gehören
   * uns, damit sie auch vor der ersten Kompilierung gesetzt werden können.
   */
  _makeBlendMaterial(mapA, blend, params) {
    const mat = new THREE.MeshStandardMaterial({ map: mapA, color: 0xffffff, ...params });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMapB = blend.uMapB;
      shader.uniforms.uBlend = blend.uBlend;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uMapB;\nuniform float uBlend;')
        .replace('#include <map_fragment>', /* glsl */`
          #ifdef USE_MAP
            vec4 texA = texture2D( map, vMapUv );
            vec4 texB = texture2D( uMapB, vMapUv );
            diffuseColor *= mix( texA, texB, uBlend );
          #endif
        `);
    };
    mat.customProgramCacheKey = () => 'lr2-dualmap';
    return mat;
  }

  _initRoadside() {
    // Leitplanke (20 m Balken + Pfosten) – als eine Instanz pro Abschnitt.
    const railGeo = mergeParts([
      [box(0.12, 0.36, 19.4, 0, 0.82, 0), 0xd7dde6],
      [box(0.12, 0.10, 19.4, 0, 0.60, 0), 0x9aa4b2],
      [box(0.18, 0.95, 0.18, 0, 0.475, -9.6), 0x8b95a5],
      [box(0.22, 0.14, 0.06, 0.09, 0.86, -9.6), 0xff8c2a],
    ]);
    this.railMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0.6, envMapIntensity: 1,
    });
    this.rails = new THREE.InstancedMesh(railGeo, this.railMat, RAIL_SLOTS * 2);
    this.rails.frustumCulled = false;
    this.rails.castShadow = false;
    this.rails.receiveShadow = false;
    this.rails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.rails);
    this._disposables.push(railGeo, this.railMat);

    // Laternenmast (der Ausleger hängt über y > 7 in Richtung Fahrbahn)
    const mastGeo = mergeParts([
      [cyl(0.11, 0.16, 7.6, 8, 0, 3.8, 0), 0x3d4652],
      [cyl(0.3, 0.38, 0.3, 8, 0, 0.15, 0), 0x2f3640],
      [box(0.13, 0.13, 2.4, -1.2, 7.45, 0, Math.PI / 2), 0x3d4652],
    ]);
    this.mastMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.7, envMapIntensity: 1,
    });
    this.lampMasts = new THREE.InstancedMesh(mastGeo, this.mastMat, LAMP_SLOTS * 2);
    this.lampMasts.frustumCulled = false;
    this.lampMasts.castShadow = false;
    this.lampMasts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.lampMasts);
    this._disposables.push(mastGeo, this.mastMat);

    // Leuchtkopf – eigenes emissives Material (kein echtes Licht!)
    const headGeo = mergePlain([box(0.5, 0.18, 1.0, 0, 0, 0)]);
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0x14171d, emissive: 0xffd9a8, emissiveIntensity: 0, roughness: 0.4, metalness: 0.2,
    });
    this.lampHeads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, LAMP_SLOTS * 2);
    this.lampHeads.frustumCulled = false;
    this.lampHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.lampHeads);
    this._disposables.push(headGeo, this.lampHeadMat);

    // Feste Grundmatrizen: nur z wird pro Frame nachgezogen.
    this._railZ = new Float32Array(RAIL_SLOTS);
    for (let i = 0; i < RAIL_SLOTS; i++) this._railZ[i] = CONFIG.sceneryBackZ - i * RAIL_SPACING;
    this._lampZ = new Float32Array(LAMP_SLOTS);
    for (let i = 0; i < LAMP_SLOTS; i++) this._lampZ[i] = CONFIG.sceneryBackZ - i * LAMP_SPACING;

    const setBase = (mesh, idx, x, y, z, ry) => {
      this._e.set(0, ry, 0);
      this._q.setFromEuler(this._e);
      this._v.set(x, y, z);
      this._s.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._s);
      this._m.toArray(mesh.instanceMatrix.array, idx * 16);
    };
    for (let i = 0; i < RAIL_SLOTS; i++) {
      setBase(this.rails, i, -RAIL_X, 0, this._railZ[i], 0);
      setBase(this.rails, RAIL_SLOTS + i, RAIL_X, 0, this._railZ[i], Math.PI);
    }
    for (let i = 0; i < LAMP_SLOTS; i++) {
      setBase(this.lampMasts, i, -LAMP_X, 0, this._lampZ[i], 0);
      setBase(this.lampMasts, LAMP_SLOTS + i, LAMP_X, 0, this._lampZ[i], Math.PI);
      setBase(this.lampHeads, i, -LAMP_X + 2.3, 7.36, this._lampZ[i], 0);
      setBase(this.lampHeads, LAMP_SLOTS + i, LAMP_X - 2.3, 7.36, this._lampZ[i], 0);
    }
    this.rails.instanceMatrix.needsUpdate = true;
    this.lampMasts.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
  }

  // -- Deko-Pools ----------------------------------------------------------

  _addPool(key, geometry, material, capacity, { shadow = false } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    mesh.castShadow = false; // Deko wirft keinen Schatten (siehe QUALITY_PRESETS)
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instanzfarben einmalig anlegen, damit sich die Shader-Defines nie ändern.
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, white);
    mesh.instanceColor.needsUpdate = true;
    // Alle Slots zunächst auf Skalierung 0 (unsichtbar)
    mesh.instanceMatrix.array.fill(0);
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);

    const free = new Array(capacity);
    for (let i = 0; i < capacity; i++) free[i] = capacity - 1 - i;
    const pool = { key, mesh, capacity, free, used: 0, dirty: false, wantsShadow: shadow };
    this.pools.set(key, pool);
    this._disposables.push(geometry, material);
    return pool;
  }

  _initPools() {
    this.pools = new Map();
    const std = (params) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...params });

    // ---------------- Sonnental ----------------
    this._addPool('meadow:tree', mergeParts([
      [cyl(0.2, 0.34, 2.6, 6, 0, 1.3, 0), 0x6b4a2c],
      [rockGeo(1.5, 1, 0.16, 1, 1.15, 1), 0x3f7a30],
      [rockGeo(1.15, 1, 0.2, 1, 1.0, 1).translate(0.35, 1.2, 0.2), 0x4c8f39],
    ].map(([g, c], i) => (i === 1 ? [g.translate(0, 3.5, 0), c] : [g, c]))), std({ flatShading: true }), 92, { shadow: true });

    this._addPool('meadow:bush', mergeParts([
      [rockGeo(0.75, 1, 0.24), 0x4a8a37],
      [rockGeo(0.55, 1, 0.28).translate(0.6, -0.1, 0.25), 0x3d7a2e],
    ]), std({ flatShading: true }), 64);

    this._addPool('meadow:hill', mergeParts([
      [rockGeo(3.0, 1, 0.14, 1.6, 0.42, 1.4), 0x548a3c],
    ]), std({ flatShading: true, roughness: 0.95 }), 34);

    this._addPool('meadow:fence', mergeParts([
      [box(0.1, 1.0, 0.1, 0, 0.5, -3.6), 0x8a6a45],
      [box(0.1, 1.0, 0.1, 0, 0.5, 0), 0x8a6a45],
      [box(0.1, 1.0, 0.1, 0, 0.5, 3.6), 0x8a6a45],
      [box(0.06, 0.12, 7.4, 0, 0.82, 0), 0x9b7a52],
      [box(0.06, 0.12, 7.4, 0, 0.48, 0), 0x9b7a52],
    ]), std({ roughness: 0.9 }), 44);

    this._addPool('meadow:mill', mergeParts([
      [cyl(1.5, 2.4, 9, 10, 0, 4.5, 0), 0xe8e2d4],
      [coneGeo(2.7, 2.2, 10, 0, 10.1, 0), 0x9a3b2e],
      [box(0.5, 9.5, 0.28, 0, 8.4, -2.5), 0xf0ead8],
      [box(9.5, 0.5, 0.28, 0, 8.4, -2.5), 0xf0ead8],
      [box(0.7, 0.7, 0.8, 0, 8.4, -2.7), 0x6a5237],
    ]), std({ roughness: 0.85 }), 5, { shadow: true });

    // ---------------- Canyon ----------------
    this._addPool('canyon:pillar', mergeParts([
      [rockGeo(2.2, 1, 0.2, 1, 3.4, 1).translate(0, 7.2, 0), 0xa85f37],
      [rockGeo(2.8, 1, 0.22, 1, 0.55, 1).translate(0, 1.3, 0), 0x8e4f2e],
    ]), std({ flatShading: true, roughness: 0.95 }), 48, { shadow: true });

    this._addPool('canyon:mesa', mergeParts([
      [box(14, 7, 12, 0, 3.5, 0), 0x9c5b36],
      [box(15.4, 0.9, 13.4, 0, 7.3, 0), 0xb06c41],
      [box(9, 3.4, 8, 2, 9.4, 1), 0xa05f38],
    ]), std({ roughness: 0.98, flatShading: true }), 22);

    this._addPool('canyon:cactus', mergeParts([
      [cyl(0.32, 0.38, 3.4, 8, 0, 1.7, 0), 0x4e7a43],
      [cyl(0.2, 0.22, 1.5, 6, 0.75, 2.5, 0), 0x57854a],
      [cyl(0.2, 0.22, 0.9, 6, 0.75, 3.2, 0, Math.PI / 2), 0x57854a],
      [cyl(0.2, 0.22, 1.2, 6, -0.7, 2.0, 0), 0x4a7440],
    ]), std({ roughness: 0.85, flatShading: true }), 44);

    this._addPool('canyon:boulder', mergeParts([
      [rockGeo(1.5, 1, 0.26, 1.3, 0.85, 1.1), 0x94542f],
    ]), std({ flatShading: true, roughness: 0.96 }), 46);

    this._addPool('canyon:arch', mergeParts([
      [box(3.2, 11, 4, -11.6, 5.5, 0), 0x9c5b36],
      [box(3.2, 11, 4, 11.6, 5.5, 0), 0x9c5b36],
      [box(26.6, 3.2, 4.4, 0, 12.4, 0), 0xa9653c],
      [rockGeo(2.6, 1, 0.3, 1.6, 0.7, 1.2).translate(0, 14.2, 0), 0x8e4f2e],
    ]), std({ flatShading: true, roughness: 0.96 }), 4);

    // ---------------- Neon City ----------------
    const facade = paintFacade();
    this.facadeMap = canvasTexture(facade.base, { repeatX: 1, repeatY: 1, aniso: this.q.aniso });
    this.facadeGlow = canvasTexture(facade.glow, { repeatX: 1, repeatY: 1, aniso: this.q.aniso });
    this._disposables.push(this.facadeMap, this.facadeGlow);
    const buildingMat = new THREE.MeshStandardMaterial({
      map: this.facadeMap, emissiveMap: this.facadeGlow, emissive: 0xffffff,
      emissiveIntensity: 1.6, roughness: 0.62, metalness: 0.15, envMapIntensity: 1.1,
    });
    // Einheitswürfel mit Ursprung unten – die Instanzskalierung macht daraus Türme.
    this._addPool('neon:building', mergePlain([box(1, 1, 1, 0, 0.5, 0)]), buildingMat, 72);

    this._addPool('neon:block', mergeParts([
      [box(1, 1, 1, 0, 0.5, 0), 0x2a3044],
      [box(1.06, 0.06, 1.06, 0, 1.0, 0), 0x3b4252],
    ]), std({ roughness: 0.75, metalness: 0.2 }), 44);

    const signMatA = new THREE.MeshStandardMaterial({
      map: canvasTexture(paintSign('#ff2e88'), { aniso: 4 }),
      emissiveMap: null, color: 0x101015, emissive: 0xff2e88, emissiveIntensity: 3.0,
      roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide,
    });
    const signMatB = new THREE.MeshStandardMaterial({
      map: canvasTexture(paintSign('#00e5ff'), { aniso: 4 }),
      color: 0x101015, emissive: 0x00e5ff, emissiveIntensity: 3.0,
      roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide,
    });
    this._disposables.push(signMatA.map, signMatB.map);
    const signGeo = () => mergePlain([new THREE.PlaneGeometry(1, 1)]);
    this._addPool('neon:signA', signGeo(), signMatA, 26);
    this._addPool('neon:signB', signGeo(), signMatB, 26);

    this._addPool('neon:gantry', mergeParts([
      [box(0.55, 9.4, 0.55, -9.7, 4.7, 0), 0x2b3142],
      [box(0.55, 9.4, 0.55, 9.7, 4.7, 0), 0x2b3142],
      [box(20.4, 0.7, 0.8, 0, 9.7, 0), 0x333a4d],
      [box(20.4, 0.25, 0.25, 0, 9.0, 0), 0x333a4d],
      [box(0.3, 1.1, 0.3, -6, 8.6, 0), 0x2b3142],
      [box(0.3, 1.1, 0.3, 6, 8.6, 0), 0x2b3142],
    ]), std({ roughness: 0.55, metalness: 0.65 }), 5);

    const gantrySignMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d14, emissive: 0x39ffd0, emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.1,
    });
    this._addPool('neon:gantrySign', mergePlain([box(7.4, 1.5, 0.16, 0, 0, 0)]), gantrySignMat, 5);

    // ---------------- Frostpass ----------------
    this._addPool('frost:pine', mergeParts([
      [cyl(0.16, 0.26, 1.6, 6, 0, 0.8, 0), 0x4a3728],
      [coneGeo(1.5, 2.8, 8, 0, 2.6, 0), 0x2d4f3c],
      [coneGeo(1.15, 2.4, 8, 0, 4.2, 0), 0x35583f],
      [coneGeo(0.8, 2.0, 8, 0, 5.7, 0), 0xdfeaf6],
    ]), std({ flatShading: true, roughness: 0.8 }), 92, { shadow: true });

    this._addPool('frost:rock', mergeParts([
      [rockGeo(1.4, 1, 0.28, 1.2, 0.9, 1.1), 0x8fa3b8],
      [rockGeo(1.05, 0, 0.22, 1.3, 0.35, 1.2).translate(0, 0.9, 0), 0xeaf2fb],
    ]), std({ flatShading: true, roughness: 0.65, metalness: 0.05 }), 44);

    this._addPool('frost:drift', mergeParts([
      [rockGeo(2.6, 1, 0.16, 1.5, 0.28, 1.2), 0xf1f7ff],
    ]), std({ flatShading: true, roughness: 0.7 }), 46);

    this._addPool('frost:ice', mergeParts([
      [plate(1, 1, 0, 0, 0), 0xbcd8ef],
    ]), std({ roughness: 0.12, metalness: 0.25, envMapIntensity: 1.6 }), 24);

    // ---------------- Vulkan ----------------
    this._addPool('inferno:spike', mergeParts([
      [rockGeo(1.5, 1, 0.24, 0.8, 3.0, 0.8).translate(0, 4.4, 0), 0x241b1c],
      [rockGeo(2.2, 1, 0.2, 1.1, 0.4, 1.1).translate(0, 0.7, 0), 0x1a1314],
    ]), std({ flatShading: true, roughness: 0.92 }), 62, { shadow: true });

    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0x180a06, emissive: 0xff6a18, emissiveIntensity: 2.4, roughness: 0.75, metalness: 0,
    });
    this._addPool('inferno:lava', mergePlain([plate(1, 1, 0, 0, 0)]), lavaMat, 34);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x2a0d08, emissive: 0xff9a2e, emissiveIntensity: 2.0, roughness: 0.35, metalness: 0.2,
      flatShading: true,
    });
    this._addPool('inferno:crystal', mergePlain([
      coneGeo(0.6, 3.4, 5, 0, 1.7, 0),
      coneGeo(0.4, 2.2, 5, 0.75, 1.1, 0.3),
    ]), crystalMat, 42);

    this._addPool('inferno:arch', mergeParts([
      [box(3.4, 10.5, 3.6, -11.4, 5.2, 0), 0x211819],
      [box(3.4, 10.5, 3.6, 11.4, 5.2, 0), 0x211819],
      [box(26.2, 2.8, 3.8, 0, 11.8, 0), 0x2a1f20],
    ]), std({ flatShading: true, roughness: 0.94 }), 4);
  }

  _initSegments() {
    this.segments = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      this.segments.push({ z: CONFIG.sceneryBackZ - i * SEG_LEN, items: [] });
    }
  }

  _initBackdrop() {
    this.backdrops = [];
    const geo = new THREE.PlaneGeometry(1700, 300);
    this._disposables.push(geo);
    for (const p of PRESETS) {
      const tex = canvasTexture(paintBackdrop(p.id), { repeatX: 1, repeatY: 1, aniso: 4, wrapX: THREE.ClampToEdgeWrapping });
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 110, BACKDROP_Z);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = -800;
      this.root.add(mesh);
      this.backdrops.push(mesh);
      this._disposables.push(tex, mat);
    }
  }

  _initWeather() {
    this.weatherGroup = new THREE.Group();
    this.root.add(this.weatherGroup);

    const maxP = QUALITY_PRESETS.high.points;
    const maxR = QUALITY_PRESETS.high.rain;

    // Zwei Punktsysteme mit festen Blend-Modi (kein Shader-Wechsel zur Laufzeit).
    const mkPoints = (blending, size, color) => {
      const pos = new Float32Array(maxP * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({
        map: this.particleTex, size, sizeAttenuation: true, transparent: true,
        depthWrite: false, blending, opacity: 0, color, fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      this.weatherGroup.add(pts);
      this._disposables.push(geo, mat);
      return { obj: pts, geo, mat, pos, vel: new Float32Array(maxP * 3), phase: new Float32Array(maxP) };
    };

    this.particleTex = makeDotTexture(0.1);
    this._disposables.push(this.particleTex);
    this.softPoints = mkPoints(THREE.NormalBlending, 0.32, 0xffffff);
    this.glowPoints = mkPoints(THREE.AdditiveBlending, 0.42, 0xffffff);
    this.softPoints.mat.map = this.particleTex;
    this.glowPoints.mat.map = this.particleTex;

    // Regen als Striche
    const rainPos = new Float32Array(maxR * 6);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    rainGeo.setDrawRange(0, 0);
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xbcd4f2, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.rain = {
      obj: new THREE.LineSegments(rainGeo, rainMat), geo: rainGeo, mat: rainMat,
      pos: rainPos, head: new Float32Array(maxR * 3), speed: new Float32Array(maxR),
    };
    this.rain.obj.frustumCulled = false;
    this.rain.obj.visible = false;
    this.weatherGroup.add(this.rain.obj);
    this._disposables.push(rainGeo, rainMat);

    this._weatherKind = 'none';
    this._weatherFade = 0;
    this._seedWeather('none');
  }

  // -- Wetter --------------------------------------------------------------

  _seedWeather(kind) {
    this._weatherKind = kind;
    const n = this.q.points;
    const sys = (kind === 'ember' || kind === 'pollen') ? this.glowPoints : this.softPoints;
    this.softPoints.geo.setDrawRange(0, 0);
    this.glowPoints.geo.setDrawRange(0, 0);
    this.rain.geo.setDrawRange(0, 0);

    if (kind === 'rain') {
      const count = this.q.rain;
      for (let i = 0; i < count; i++) {
        this.rain.head[i * 3] = rand(-W_HALF_X, W_HALF_X);
        this.rain.head[i * 3 + 1] = rand(0, 30);
        this.rain.head[i * 3 + 2] = rand(W_Z_FRONT, W_Z_BACK);
        this.rain.speed[i] = rand(26, 40);
      }
      this.rain.geo.setDrawRange(0, count * 2);
      this._rainCount = count;
      return;
    }
    if (kind === 'none') { this._pointCount = 0; return; }

    for (let i = 0; i < n; i++) {
      sys.pos[i * 3] = rand(-W_HALF_X, W_HALF_X);
      sys.pos[i * 3 + 2] = rand(W_Z_FRONT, W_Z_BACK);
      sys.phase[i] = rand(0, Math.PI * 2);
      if (kind === 'snow') {
        sys.pos[i * 3 + 1] = rand(0, 26);
        sys.vel[i * 3] = rand(-0.7, 0.7);
        sys.vel[i * 3 + 1] = -rand(1.6, 3.2);
        sys.vel[i * 3 + 2] = 0;
      } else if (kind === 'dust') {
        sys.pos[i * 3 + 1] = rand(0.2, 7);
        sys.vel[i * 3] = rand(-2.2, 2.2);
        sys.vel[i * 3 + 1] = rand(-0.3, 0.9);
        sys.vel[i * 3 + 2] = rand(-2, 2);
      } else if (kind === 'ember') {
        sys.pos[i * 3 + 1] = rand(0.2, 22);
        sys.vel[i * 3] = rand(-1.1, 1.1);
        sys.vel[i * 3 + 1] = rand(2.0, 5.0);
        sys.vel[i * 3 + 2] = rand(-1, 1);
      } else { // pollen
        sys.pos[i * 3 + 1] = rand(0.6, 9);
        sys.vel[i * 3] = rand(-0.5, 0.5);
        sys.vel[i * 3 + 1] = rand(-0.15, 0.35);
        sys.vel[i * 3 + 2] = rand(-0.5, 0.5);
      }
    }
    sys.geo.setDrawRange(0, n);
    sys.geo.attributes.position.needsUpdate = true;
    this._pointCount = n;

    // Aussehen je Niederschlagsart
    if (kind === 'snow') { this.softPoints.mat.color.set(0xffffff); this.softPoints.mat.size = 0.34; }
    if (kind === 'dust') { this.softPoints.mat.color.set(0xdcb282); this.softPoints.mat.size = 0.5; }
    if (kind === 'ember') { this.glowPoints.mat.color.set(0xff7a22); this.glowPoints.mat.size = 0.34; }
    if (kind === 'pollen') { this.glowPoints.mat.color.set(0xfff0b8); this.glowPoints.mat.size = 0.26; }
  }

  _updateWeather(dt, speed) {
    const kind = this._weatherKind;
    const amount = this._live.nums.weatherAmt * this._weatherFade;

    this.softPoints.obj.visible = false;
    this.glowPoints.obj.visible = false;
    this.rain.obj.visible = false;
    if (kind === 'none' || amount < 0.01) return;

    if (kind === 'rain') {
      const n = this._rainCount | 0;
      const head = this.rain.head, out = this.rain.pos;
      const streak = 0.5 + Math.min(speed, 90) * 0.02;   // bei Tempo länger gezogen
      const dz = speed * 0.96;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const fall = this.rain.speed[i];
        head[o + 1] -= fall * dt;
        head[o + 2] += dz * dt;
        if (head[o + 1] < 0) {
          head[o + 1] = rand(24, 32);
          head[o] = rand(-W_HALF_X, W_HALF_X);
          head[o + 2] = rand(W_Z_FRONT, W_Z_BACK);
        }
        if (head[o + 2] > W_Z_BACK) { head[o + 2] -= W_Z_SPAN; head[o] = rand(-W_HALF_X, W_HALF_X); }
        const x = head[o], y = head[o + 1], z = head[o + 2];
        const v = i * 6;
        out[v] = x; out[v + 1] = y; out[v + 2] = z;
        out[v + 3] = x; out[v + 4] = y + fall * 0.055 * streak; out[v + 5] = z - dz * 0.055 * streak;
      }
      this.rain.geo.attributes.position.needsUpdate = true;
      this.rain.mat.opacity = 0.55 * amount;
      this.rain.obj.visible = true;
      return;
    }

    const glow = (kind === 'ember' || kind === 'pollen');
    const sys = glow ? this.glowPoints : this.softPoints;
    const n = this._pointCount | 0;
    const pos = sys.pos, vel = sys.vel, ph = sys.phase;
    const dz = speed * (kind === 'dust' ? 0.95 : kind === 'snow' ? 0.85 : 0.65);
    const t = this._elapsed;

    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const sway = Math.sin(t * 1.6 + ph[i]);
      pos[o] += (vel[o] + sway * (kind === 'snow' ? 0.55 : 0.2)) * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += (vel[o + 2] + dz) * dt;

      if (pos[o + 2] > W_Z_BACK) { pos[o + 2] -= W_Z_SPAN; pos[o] = rand(-W_HALF_X, W_HALF_X); }
      else if (pos[o + 2] < W_Z_FRONT) pos[o + 2] += W_Z_SPAN;
      if (pos[o] > W_HALF_X) pos[o] -= W_HALF_X * 2;
      else if (pos[o] < -W_HALF_X) pos[o] += W_HALF_X * 2;

      if (kind === 'snow') {
        if (pos[o + 1] < 0) { pos[o + 1] = 26; pos[o] = rand(-W_HALF_X, W_HALF_X); }
      } else if (kind === 'ember') {
        if (pos[o + 1] > 24) { pos[o + 1] = rand(0, 1.5); pos[o] = rand(-W_HALF_X, W_HALF_X); pos[o + 2] = rand(W_Z_FRONT, W_Z_BACK); }
      } else {
        if (pos[o + 1] < 0.15) { pos[o + 1] = 0.15; vel[o + 1] = Math.abs(vel[o + 1]); }
        else if (pos[o + 1] > (kind === 'dust' ? 8 : 10)) vel[o + 1] = -Math.abs(vel[o + 1]);
      }
    }
    sys.geo.attributes.position.needsUpdate = true;
    const base = kind === 'dust' ? 0.5 : kind === 'snow' ? 0.85 : kind === 'ember' ? 0.9 : 0.6;
    const flicker = glow ? 0.86 + 0.14 * Math.sin(t * 7.3) : 1;
    sys.mat.opacity = base * amount * flicker;
    sys.obj.visible = true;
  }

  // -- Deko bestücken ------------------------------------------------------

  _acquire(key) {
    const pool = this.pools.get(key);
    if (!pool || pool.free.length === 0) return null;
    const idx = pool.free.pop();
    pool.used++;
    return { pool, idx };
  }

  _releaseItem(item) {
    const arr = item.pool.mesh.instanceMatrix.array;
    const off = item.idx * 16;
    for (let i = 0; i < 16; i++) arr[off + i] = 0;
    item.pool.free.push(item.idx);
    item.pool.used--;
    item.pool.dirty = true;
  }

  /**
   * Objekt in ein Segment setzen. z ist relativ zum Segmentanker (≤ 0).
   * Die Basismatrix wird einmal geschrieben; pro Frame wandert nur noch
   * Element 14 (die z-Verschiebung) mit.
   */
  _place(seg, key, x, z, opts = {}) {
    const slot = this._acquire(key);
    if (!slot) return;
    const { y = 0, ry = 0, rx = 0, s = 1 } = opts;
    const sx = Array.isArray(s) ? s[0] : s;
    const sy = Array.isArray(s) ? s[1] : s;
    const sz = Array.isArray(s) ? s[2] : s;
    this._e.set(rx, ry, 0);
    this._q.setFromEuler(this._e);
    this._v.set(x, y, z);
    this._s.set(sx, sy, sz);
    this._m.compose(this._v, this._q, this._s);
    this._m.toArray(slot.pool.mesh.instanceMatrix.array, slot.idx * 16);
    if (opts.color !== undefined) {
      this._c.set(opts.color);
      slot.pool.mesh.setColorAt(slot.idx, this._c);
      slot.pool.mesh.instanceColor.needsUpdate = true;
    }
    slot.pool.dirty = true;
    seg.items.push({ pool: slot.pool, idx: slot.idx, off: slot.idx * 16, z });
  }

  _populate(seg) {
    for (let i = 0; i < seg.items.length; i++) this._releaseItem(seg.items[i]);
    seg.items.length = 0;
    const den = this.q.density;
    const gen = this._generators[this._target.id];
    if (gen) gen.call(this, seg, den);
  }

  _repopulateAll() {
    for (const seg of this.segments) this._populate(seg);
  }

  /** Zufällige Seite und Abstand zur Fahrbahn (|x| ≥ 9). */
  _sideX(min, max) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return side * rand(min, max);
  }

  get _generators() {
    if (!this.__gens) {
      this.__gens = {
        meadow: this._popMeadow,
        canyon: this._popCanyon,
        neon: this._popNeon,
        frost: this._popFrost,
        inferno: this._popInferno,
      };
    }
    return this.__gens;
  }

  _popMeadow(seg, den) {
    const zr = () => -Math.random() * SEG_LEN;
    const trees = Math.round(6 * den);
    for (let i = 0; i < trees; i++) {
      const s = rand(0.75, 1.45);
      this._place(seg, 'meadow:tree', this._sideX(10, 58), zr(), {
        ry: rand(0, 6.28), s: [s, s * rand(0.9, 1.3), s],
        color: new THREE.Color().setHSL(rand(0.22, 0.32), rand(0.35, 0.6), rand(0.4, 0.58)).getHex(),
      });
    }
    const bushes = Math.round(5 * den);
    for (let i = 0; i < bushes; i++) {
      this._place(seg, 'meadow:bush', this._sideX(9.2, 40), zr(), { ry: rand(0, 6.28), s: rand(0.7, 1.5) });
    }
    const hills = Math.round(2 * den);
    for (let i = 0; i < hills; i++) {
      this._place(seg, 'meadow:hill', this._sideX(26, 110), zr(), {
        y: -1.1, ry: rand(0, 6.28), s: rand(1.4, 4.5),
      });
    }
    if (chance(0.5 * den)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 4; i++) {
        this._place(seg, 'meadow:fence', side * rand(11, 15), -i * 7.3 - rand(0, 1), { s: 1 });
      }
    }
    if (chance(0.09 * den)) {
      this._place(seg, 'meadow:mill', this._sideX(34, 62), zr(), { ry: rand(0, 6.28), s: rand(0.9, 1.3) });
    }
  }

  _popCanyon(seg, den) {
    const zr = () => -Math.random() * SEG_LEN;
    const pillars = Math.round(3.4 * den);
    for (let i = 0; i < pillars; i++) {
      const s = rand(0.7, 1.7);
      this._place(seg, 'canyon:pillar', this._sideX(12, 70), zr(), {
        ry: rand(0, 6.28), s: [s, s * rand(0.7, 1.9), s],
        color: new THREE.Color().setHSL(rand(0.04, 0.08), rand(0.4, 0.62), rand(0.36, 0.52)).getHex(),
      });
    }
    const mesas = Math.round(1.1 * den);
    for (let i = 0; i < mesas; i++) {
      this._place(seg, 'canyon:mesa', this._sideX(45, 140), zr(), {
        ry: rand(0, 6.28), s: [rand(1, 3.2), rand(0.8, 2.6), rand(1, 3)],
      });
    }
    const cacti = Math.round(3.2 * den);
    for (let i = 0; i < cacti; i++) {
      this._place(seg, 'canyon:cactus', this._sideX(9.3, 46), zr(), { ry: rand(0, 6.28), s: rand(0.7, 1.5) });
    }
    const rocks = Math.round(3.6 * den);
    for (let i = 0; i < rocks; i++) {
      this._place(seg, 'canyon:boulder', this._sideX(9.2, 60), zr(), {
        y: rand(-0.4, 0), ry: rand(0, 6.28), s: rand(0.5, 2.2),
      });
    }
    if (chance(0.1 * den)) this._place(seg, 'canyon:arch', 0, zr(), { s: rand(0.95, 1.15) });
  }

  _popNeon(seg, den) {
    const zr = () => -Math.random() * SEG_LEN;
    const towers = Math.round(5.4 * den);
    for (let i = 0; i < towers; i++) {
      const w = rand(7, 17), d = rand(7, 16), h = rand(14, 58);
      const x = this._sideX(12, 80);
      this._place(seg, 'neon:building', x, zr(), {
        ry: rand(-0.35, 0.35), s: [w, h, d],
        color: new THREE.Color().setHSL(rand(0.58, 0.75), rand(0.15, 0.4), rand(0.16, 0.3)).getHex(),
      });
    }
    const blocks = Math.round(3.2 * den);
    for (let i = 0; i < blocks; i++) {
      this._place(seg, 'neon:block', this._sideX(9.4, 34), zr(), {
        ry: rand(-0.3, 0.3), s: [rand(4, 11), rand(2.5, 7), rand(4, 10)],
      });
    }
    const signs = Math.round(2.4 * den);
    for (let i = 0; i < signs; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const key = chance(0.5) ? 'neon:signA' : 'neon:signB';
      this._place(seg, key, side * rand(10.5, 26), zr(), {
        y: rand(5, 22), ry: side < 0 ? rand(0.9, 1.5) : rand(-1.5, -0.9),
        s: [rand(4, 9), rand(2, 4.6), 1],
      });
    }
    if (chance(0.34 * den)) {
      const z = zr();
      this._place(seg, 'neon:gantry', 0, z, { s: rand(0.96, 1.06) });
      this._place(seg, 'neon:gantrySign', 0, z + 0.05, { y: 8.5, s: rand(0.9, 1.1) });
    }
  }

  _popFrost(seg, den) {
    const zr = () => -Math.random() * SEG_LEN;
    const pines = Math.round(6.2 * den);
    for (let i = 0; i < pines; i++) {
      const s = rand(0.7, 1.6);
      this._place(seg, 'frost:pine', this._sideX(9.6, 62), zr(), {
        ry: rand(0, 6.28), s: [s, s * rand(0.85, 1.4), s],
        color: new THREE.Color().setHSL(rand(0.32, 0.42), rand(0.1, 0.3), rand(0.55, 0.8)).getHex(),
      });
    }
    const rocks = Math.round(3.2 * den);
    for (let i = 0; i < rocks; i++) {
      this._place(seg, 'frost:rock', this._sideX(9.3, 50), zr(), {
        y: rand(-0.4, 0), ry: rand(0, 6.28), s: rand(0.6, 2.1),
      });
    }
    const drifts = Math.round(3.4 * den);
    for (let i = 0; i < drifts; i++) {
      this._place(seg, 'frost:drift', this._sideX(9.1, 44), zr(), {
        y: -0.7, ry: rand(0, 6.28), s: [rand(1, 2.6), rand(0.6, 1.4), rand(1, 2.2)],
      });
    }
    if (chance(0.55 * den)) {
      this._place(seg, 'frost:ice', this._sideX(18, 70), zr(), {
        y: 0.02, ry: rand(0, 6.28), s: [rand(12, 34), 1, rand(10, 26)],
      });
    }
  }

  _popInferno(seg, den) {
    const zr = () => -Math.random() * SEG_LEN;
    const spikes = Math.round(4.4 * den);
    for (let i = 0; i < spikes; i++) {
      const s = rand(0.6, 1.6);
      this._place(seg, 'inferno:spike', this._sideX(9.6, 66), zr(), {
        ry: rand(0, 6.28), rx: rand(-0.12, 0.12), s: [s, s * rand(0.7, 1.8), s],
      });
    }
    const pools = Math.round(2.2 * den);
    for (let i = 0; i < pools; i++) {
      this._place(seg, 'inferno:lava', this._sideX(11, 70), zr(), {
        y: 0.03, ry: rand(0, 6.28), s: [rand(6, 26), 1, rand(6, 20)],
      });
    }
    const crystals = Math.round(2.8 * den);
    for (let i = 0; i < crystals; i++) {
      this._place(seg, 'inferno:crystal', this._sideX(9.2, 48), zr(), {
        ry: rand(0, 6.28), s: rand(0.6, 1.8),
      });
    }
    if (chance(0.12 * den)) this._place(seg, 'inferno:arch', 0, zr(), { s: rand(0.95, 1.1) });
  }

  // -- Öffentliche API -----------------------------------------------------

  setQuality(quality) {
    if (!QUALITY_PRESETS[quality] || quality === this.quality) return;
    this.quality = quality;
    this.q = QUALITY_PRESETS[quality];

    this._applyShadowQuality();
    const shadows = this.q.shadow > 0;
    this.rails.castShadow = false;
    this.lampMasts.castShadow = false;
    for (const pool of this.pools.values()) pool.mesh.castShadow = false;

    const aniso = Math.min(this.q.aniso, this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
    for (const t of [...this.roadTex, ...this.groundTex, ...this.overlayTex]) {
      t.anisotropy = aniso; t.needsUpdate = true;
    }
    this.stars.geometry.setDrawRange(0, this.q.stars);
    this._repopulateAll();
    this._seedWeather(this._weatherKind);
  }

  /**
   * @param index Index in WORLDS
   * @param instant true = ohne Überblendung
   * @param time 'default' (Grundstimmung der Welt) | 'dawn' | 'dusk' | 'day' | 'night'
   */
  setWorld(index, instant = false, time = 'default') {
    const i = Math.max(0, Math.min(WORLDS.length - 1, index | 0));
    const base = PRESET_BY_ID.get(WORLDS[i].id) || PRESETS[i] || PRESETS[0];
    const preset = time && time !== 'default' ? makeTimeVariant(base, time) : base;
    if (this._target === preset && !instant && this._t >= 1) return;

    // Laufende Texturüberblendung zuerst sauber abschließen.
    this._finishTextureBlend();

    // Von den aktuellen Live-Werten aus starten (auch mitten im Blenden).
    this._snapshotLive();
    this._index = i;
    this._target = preset;
    this._texFrom = this.roadTex.indexOf(this.roadTex[this._texIndex ?? 0]) >= 0 ? (this._texIndex ?? 0) : 0;
    this._texSwapped = false;

    // Zieltexturen als zweiten Sampler einhängen
    const ti = PRESETS.indexOf(preset.base || preset);
    this._texTarget = ti;
    this.roadBlend.uMapB.value = this.roadTex[ti];
    this.groundBlend.uMapB.value = this.groundTex[ti];

    if (instant) {
      this._t = 1;
      this._blending = false;
      this._copyPreset(this._from, preset);
      this._applyBlend(1);
      this._finishTextureBlend();
      this._weatherFade = 1;
      this._seedWeather(preset.weather);
      this._repopulateAll();
    } else {
      this._t = 0;
      this._blending = true;
    }
  }

  update(dt, { speed = 0, distance = 0, camera = null } = {}) {
    const d = Math.min(Math.max(dt, 0), 0.1);
    this._elapsed += d;

    // 1. Weltwechsel weiterblenden
    if (this._blending) {
      this._t = Math.min(1, this._t + d / BLEND_TIME);
      this._applyBlend(smoothstep(this._t));
      if (this._t >= 0.5 && !this._texSwapped) {
        // Wetter in der Mitte der Blende umschalten
        if (this._weatherKind !== this._target.weather) this._seedWeather(this._target.weather);
      }
      if (this._t >= 1) {
        this._blending = false;
        this._finishTextureBlend();
      }
    } else {
      // Nachziehen (z. B. Belichtung, falls jemand anders daran gedreht hat)
      this._applyLive();
    }

    // Wetter-Überblendung (in der Mitte umschalten → beidseitig weich)
    const fadeTarget = this._blending ? Math.abs(this._t - 0.5) * 2 : 1;
    this._weatherFade += (fadeTarget - this._weatherFade) * Math.min(1, d * 6);

    // 2. Texturen scrollen
    const roadOff = (distance / ROAD_TILE) % 1;
    const groundOff = (distance / GROUND_TILE) % 1;
    for (const t of this.roadTex) t.offset.y = roadOff;
    for (const t of this.overlayTex) t.offset.y = roadOff;
    for (const t of this.groundTex) t.offset.y = groundOff;

    // 3. Straßenrand bewegen
    this._updateRoadside(d, speed);

    // 4. Deko-Segmente bewegen und ggf. neu bestücken
    this._updateScenery(d, speed);

    // 5. Wetter
    this._updateWeather(d, speed);

    // 6. Himmel/Wetter an die Kamera hängen
    if (camera) {
      this.sky.position.copy(camera.position);
      this.weatherGroup.position.set(camera.position.x, 0, camera.position.z);
    }

    // sanftes Funkeln der Sterne
    if (this.stars.material.opacity > 0) {
      this.stars.material.opacity = this._live.nums.stars * (0.88 + 0.12 * Math.sin(this._elapsed * 1.7));
    }
  }

  _updateRoadside(dt, speed) {
    const dz = speed * dt;
    const railArr = this.rails.instanceMatrix.array;
    for (let i = 0; i < RAIL_SLOTS; i++) {
      let z = this._railZ[i] + dz;
      if (z > CONFIG.sceneryBackZ) z -= RAIL_SPAN;
      this._railZ[i] = z;
      railArr[i * 16 + 14] = z;
      railArr[(RAIL_SLOTS + i) * 16 + 14] = z;
    }
    this.rails.instanceMatrix.needsUpdate = true;

    const mastArr = this.lampMasts.instanceMatrix.array;
    const headArr = this.lampHeads.instanceMatrix.array;
    for (let i = 0; i < LAMP_SLOTS; i++) {
      let z = this._lampZ[i] + dz;
      if (z > CONFIG.sceneryBackZ) z -= RAIL_SPAN;
      this._lampZ[i] = z;
      mastArr[i * 16 + 14] = z;
      mastArr[(LAMP_SLOTS + i) * 16 + 14] = z;
      headArr[i * 16 + 14] = z;
      headArr[(LAMP_SLOTS + i) * 16 + 14] = z;
    }
    this.lampMasts.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
  }

  _updateScenery(dt, speed) {
    const dz = speed * dt;
    const back = CONFIG.sceneryBackZ;
    const span = CONFIG.scenerySpan;
    for (const seg of this.segments) {
      seg.z += dz;
      if (seg.z > back) {
        seg.z -= span;
        this._populate(seg);       // mit der AKTUELLEN Welt neu bestücken
      }
      const items = seg.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.pool.mesh.instanceMatrix.array[it.off + 14] = seg.z + it.z;
        it.pool.dirty = true;
      }
    }
    for (const pool of this.pools.values()) {
      if (pool.dirty) { pool.mesh.instanceMatrix.needsUpdate = true; pool.dirty = false; }
      const vis = pool.used > 0;
      if (pool.mesh.visible !== vis) pool.mesh.visible = vis;
    }
  }

  get worldIndex() { return this._index; }

  get isNight() { return !!this._target.night; }

  get bloom() { return this._bloom; }

  dispose() {
    for (const res of this._disposables) {
      if (res && typeof res.dispose === 'function') {
        try { res.dispose(); } catch { /* egal */ }
      }
    }
    this._disposables.length = 0;
    for (const pool of this.pools.values()) pool.mesh.dispose?.();
    this.rails.dispose?.();
    this.lampMasts.dispose?.();
    this.lampHeads.dispose?.();
    if (this.envTexture) { this.envTexture.dispose(); this.envTexture = null; }
    if (this.scene.environment) this.scene.environment = null;
    this.scene.fog = null;
    this.root.parent?.remove(this.root);
    this.pools.clear();
    this.segments.length = 0;
  }

  // -- Blenden -------------------------------------------------------------

  _copyPreset(live, preset) {
    for (const k of COLOR_KEYS) live.colors[k].copy(preset.colors[k]);
    for (const k of NUM_KEYS) live.nums[k] = preset.nums[k];
    live.sunDir.copy(preset.sunDir);
  }

  _snapshotLive() {
    if (this._t >= 1 && !this._blending) {
      // steht still → einfach den aktuellen Zustand sichern
      for (const k of COLOR_KEYS) this._from.colors[k].copy(this._live.colors[k]);
      for (const k of NUM_KEYS) this._from.nums[k] = this._live.nums[k];
      this._from.sunDir.copy(this._live.sunDir);
    } else {
      for (const k of COLOR_KEYS) this._from.colors[k].copy(this._live.colors[k]);
      for (const k of NUM_KEYS) this._from.nums[k] = this._live.nums[k];
      this._from.sunDir.copy(this._live.sunDir);
    }
  }

  _applyBlend(t) {
    const from = this._from, to = this._target, live = this._live;
    for (const k of COLOR_KEYS) live.colors[k].lerpColors(from.colors[k], to.colors[k], t);
    for (const k of NUM_KEYS) live.nums[k] = from.nums[k] + (to.nums[k] - from.nums[k]) * t;
    live.sunDir.lerpVectors(from.sunDir, to.sunDir, t).normalize();
    this.roadBlend.uBlend.value = t;
    this.groundBlend.uBlend.value = t;
    this._applyLive(t);
  }

  /** Live-Werte in Szene, Lichter, Materialien und Uniforms schreiben. */
  _applyLive(t = 1) {
    const c = this._live.colors, n = this._live.nums;

    if (this.scene.fog) this.scene.fog.color.copy(c.fog);

    this.skyUniforms.uZenith.value.copy(c.zenith);
    this.skyUniforms.uHorizon.value.copy(c.horizon);
    this.skyUniforms.uHaze.value.copy(c.fog);
    this.skyUniforms.uSunGlow.value.copy(c.sunGlow);
    this.skyUniforms.uSunDir.value.copy(this._live.sunDir);

    this.ambient.color.copy(c.ambient); this.ambient.intensity = n.ambI;
    this.hemi.color.copy(c.hemiSky); this.hemi.groundColor.copy(c.hemiGround); this.hemi.intensity = n.hemiI;
    this.sun.color.copy(c.dirColor); this.sun.intensity = n.dirI;
    this.sun.position.copy(this._live.sunDir).multiplyScalar(120).add(this.sunTarget.position);

    this.scene.environmentIntensity = n.env;
    if (this.renderer) this.renderer.toneMappingExposure = n.exposure;

    this._bloom.strength = n.bloomS;
    this._bloom.radius = n.bloomR;
    this._bloom.threshold = n.bloomT;

    this.roadMat.color.copy(c.road);
    this.roadMat.roughness = n.roadRough;
    this.roadMat.metalness = n.roadMetal;
    this.roadMat.envMapIntensity = n.roadEnv;

    this.groundMat.color.copy(c.ground);
    this.groundMat.roughness = n.groundRough;
    this.groundMat.envMapIntensity = n.groundEnv;

    this.railMat.color.copy(c.rail);
    this.railMat.roughness = n.railRough;
    this.railMat.metalness = n.railMetal;
    this.mastMat.color.copy(c.rail);
    this.lampHeadMat.emissive.copy(c.lamp);
    this.lampHeadMat.emissiveIntensity = n.lampI;

    // Sonne / Mond / Sterne
    this.sunDisc.position.copy(this._live.sunDir).multiplyScalar(SUN_DISTANCE);
    this.moonDisc.position.copy(this.sunDisc.position);
    this.sunDisc.material.color.copy(c.sunGlow);
    this.sunDisc.material.opacity = n.sunOp;
    this.sunDisc.visible = n.sunOp > 0.01;
    this.moonDisc.material.opacity = n.moonOp;
    this.moonDisc.visible = n.moonOp > 0.01;
    this.stars.material.opacity = n.stars;
    this.stars.visible = n.stars > 0.01;

    // Straßen-Overlay (nasse Reflexe / Glutrisse)
    const toIdx = this._texTarget ?? 0;
    const fromIdx = this._texFrom ?? 0;
    const fromOp = this._from.nums.overlay;
    const toOp = this._target.nums.overlay;
    let op, mapIdx;
    if (t < 0.5) { op = fromOp * (1 - t * 2); mapIdx = fromIdx; }
    else { op = toOp * (t - 0.5) * 2; mapIdx = toIdx; }
    if (this.overlayMat.map !== this.overlayTex[mapIdx]) this.overlayMat.map = this.overlayTex[mapIdx];
    this.overlayMat.opacity = op;
    this.overlay.visible = op > 0.01;

    // Horizont-Silhouetten überblenden
    for (let i = 0; i < this.backdrops.length; i++) {
      const m = this.backdrops[i];
      let o = 0;
      if (i === toIdx) o = t;
      else if (i === fromIdx) o = 1 - t;
      if (fromIdx === toIdx && i === toIdx) o = 1;
      m.material.opacity = o;
      m.visible = o > 0.01;
    }
  }

  /** Texturen endgültig auf die Zielwelt setzen (Blend-Uniform wieder auf 0). */
  _finishTextureBlend() {
    const ti = this._texTarget ?? 0;
    this.roadMat.map = this.roadTex[ti];
    this.groundMat.map = this.groundTex[ti];
    this.roadBlend.uMapB.value = this.roadTex[ti];
    this.groundBlend.uMapB.value = this.groundTex[ti];
    this.roadBlend.uBlend.value = 0;
    this.groundBlend.uBlend.value = 0;
    this.overlayMat.map = this.overlayTex[ti];
    this._texIndex = ti;
    this._texFrom = ti;
    this._texSwapped = true;
  }
}

export default World;
