/*
 * structures.js – Tunnel und Hängebrücken entlang der Strecke.
 *
 * Beides ist reine Optik: Gefahren wird weiter auf drei geraden Spuren.
 *
 * Wo etwas steht, wird nicht "mitgezählt", sondern aus der gefahrenen Strecke
 * berechnet (Position = Strecke − Start). Dadurch sehen alle Fahrer eines
 * Party-Rennens (gleicher Seed) Tunnel und Brücken an derselben Stelle, und
 * es gibt keine Abweichungen durch unterschiedliche Bildraten.
 *
 * Es gibt nur je ein Tunnel- und ein Brücken-Objekt; sie werden wiederverwendet.
 * Koordinaten lokal: der nahe Eingang liegt bei z = 0, das Bauwerk reicht bis z = −Länge.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { createRng } from './rng.js';

const SEGMENT = 8;          // Länge eines Tunnelstücks in Metern
const MAX_SEGMENTS = 44;    // → höchstens 352 m Tunnel
const TUNNEL_HEIGHT = 7.2;
const WALL_INNER_X = 8.4;   // Innenkante der Tunnelwand (Straße + Leitplanken passen dazwischen)
const BRIDGE_LENGTH = 296;

// Wie weit voraus ein Bauwerk schon gebaut sein muss, damit es im Nebel "auftaucht"
const VISIBLE_AHEAD = CONFIG.fogFar + 90;
const VISIBLE_BEHIND = 60;

// ---------------------------------------------------------------------------
// Streckenplan (deterministisch aus dem Seed)
// ---------------------------------------------------------------------------

/**
 * Liefert die ersten `count` Bauwerke einer Strecke: [{ type: 'tunnel'|'bridge', start, length }]
 * (start und length in Metern gefahrener Strecke).
 */
export function planStructures(seed, count = 60) {
  const rng = createRng(`${seed}:structures`);
  const plan = [];
  let cursor = rng.range(1400, 1900);
  for (let i = 0; i < count; i++) {
    const type = i === 0 ? 'tunnel' : rng.chance(0.55) ? 'tunnel' : 'bridge';
    const length = type === 'bridge' ? BRIDGE_LENGTH : SEGMENT * rng.int(28, 40); // Tunnel: 224–320 m
    plan.push({ type, start: Math.round(cursor), length });
    cursor += length + rng.range(1500, 2800);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Geometrien
// ---------------------------------------------------------------------------
function boxAt(list, w, h, l, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  list.push(g);
}

/** Dreht die Umlaufrichtung aller Dreiecke um (außen wird innen), damit der Hügel von außen sichtbar und von innen unsichtbar ist. */
function flipWinding(geometry) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i + 2 < position.count; i += 3) {
    const ax = position.getX(i + 1), ay = position.getY(i + 1), az = position.getZ(i + 1);
    position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    position.setXYZ(i + 2, ax, ay, az);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
}

/** Ein 8-m-Stück Tunnel: Decke, zwei Wände und ein Rippenring am nahen Ende. */
function tunnelSegmentGeometry() {
  const parts = [];
  const wallX = WALL_INNER_X + 0.45;
  boxAt(parts, 19.2, 0.7, SEGMENT, 0, TUNNEL_HEIGHT + 0.35, -SEGMENT / 2);            // Decke
  boxAt(parts, 0.9, TUNNEL_HEIGHT + 0.7, SEGMENT, -wallX, (TUNNEL_HEIGHT + 0.7) / 2, -SEGMENT / 2); // Wand links
  boxAt(parts, 0.9, TUNNEL_HEIGHT + 0.7, SEGMENT, wallX, (TUNNEL_HEIGHT + 0.7) / 2, -SEGMENT / 2);  // Wand rechts
  // Rippe: springt etwas nach innen vor und gliedert den Tunnel
  boxAt(parts, 19.2, 0.9, 0.7, 0, TUNNEL_HEIGHT - 0.1, -0.35);
  boxAt(parts, 1.3, TUNNEL_HEIGHT + 0.4, 0.7, -(WALL_INNER_X + 0.1), (TUNNEL_HEIGHT + 0.4) / 2, -0.35);
  boxAt(parts, 1.3, TUNNEL_HEIGHT + 0.4, 0.7, WALL_INNER_X + 0.1, (TUNNEL_HEIGHT + 0.4) / 2, -0.35);
  return mergeGeometries(parts);
}

/** Leuchtbänder unter der Decke (eins über jeder Spur). */
function tunnelLightGeometry() {
  const parts = [];
  for (const x of [-4, 0, 4]) boxAt(parts, 0.5, 0.14, 3.4, x, TUNNEL_HEIGHT - 0.07, -SEGMENT / 2);
  return mergeGeometries(parts);
}

/** Portal: Rahmen um die Tunnelöffnung. */
function portalGeometry() {
  const parts = [];
  const x = WALL_INNER_X + 1.0;
  boxAt(parts, 1.8, TUNNEL_HEIGHT + 1.8, 1.4, -x, (TUNNEL_HEIGHT + 1.8) / 2, 0);
  boxAt(parts, 1.8, TUNNEL_HEIGHT + 1.8, 1.4, x, (TUNNEL_HEIGHT + 1.8) / 2, 0);
  boxAt(parts, 21.2, 1.6, 1.4, 0, TUNNEL_HEIGHT + 1.0, 0);
  return mergeGeometries(parts);
}

/** Hängebrücke: Pylone, Tragseile, Hänger, Brüstung. Liefert getrennte Geometrien für Stahl und Leuchtpunkte. */
function bridgeGeometries() {
  const steel = [];
  const cables = [];
  const glow = [];
  const towerTop = 20;
  const deckY = 1.5;
  const pylonZ = [-30, -110, -190, -266];
  const cableX = 8.5;

  // Brüstung
  for (const side of [-1, 1]) boxAt(steel, 0.22, 1.3, BRIDGE_LENGTH, side * 8.0, 0.65, -BRIDGE_LENGTH / 2);

  // Pylone: zwei Beine, zwei Querträger
  for (const z of pylonZ) {
    for (const side of [-1, 1]) boxAt(steel, 1.1, towerTop + 1, 1.1, side * cableX, (towerTop + 1) / 2, z);
    boxAt(steel, cableX * 2 + 1.1, 1.0, 1.1, 0, towerTop + 0.4, z);
    boxAt(steel, cableX * 2 + 1.1, 0.8, 1.0, 0, 11.5, z);
    for (const side of [-1, 1]) boxAt(glow, 0.5, 0.5, 0.5, side * cableX, towerTop + 1.3, z); // Positionslicht
  }

  // Seile: Punkte (z, y) je Seite. Zwischen den Pylonen hängen sie durch (quadratische Kurve, Durchhang 14 m).
  const spans = [
    [new THREE.Vector3(0, deckY, 0), new THREE.Vector3(0, towerTop, pylonZ[0]), 'line'],
    ...pylonZ.slice(1).map((z, i) => [new THREE.Vector3(0, towerTop, pylonZ[i]), new THREE.Vector3(0, towerTop, z), 'sag']),
    [new THREE.Vector3(0, towerTop, pylonZ[pylonZ.length - 1]), new THREE.Vector3(0, deckY, -BRIDGE_LENGTH), 'line'],
  ];
  for (const side of [-1, 1]) {
    for (const [a, b, kind] of spans) {
      const p0 = a.clone().setX(side * cableX);
      const p2 = b.clone().setX(side * cableX);
      let curve;
      if (kind === 'sag') {
        const control = new THREE.Vector3(side * cableX, towerTop - 28, (p0.z + p2.z) / 2);
        curve = new THREE.QuadraticBezierCurve3(p0, control, p2);
      } else {
        curve = new THREE.LineCurve3(p0, p2);
      }
      cables.push(new THREE.TubeGeometry(curve, kind === 'sag' ? 20 : 4, 0.16, 5, false));

      // Hänger alle 8 m senkrecht vom Seil zur Brüstung
      const length = Math.abs(p2.z - p0.z);
      const n = Math.floor(length / 8);
      for (let i = 1; i < n; i++) {
        const point = curve.getPoint(i / n);
        if (point.y < deckY + 1) continue;
        boxAt(steel, 0.07, point.y - deckY, 0.07, side * cableX, deckY + (point.y - deckY) / 2, point.z);
        if (kind === 'sag' && i % 2 === 0) boxAt(glow, 0.16, 0.16, 0.16, side * cableX, point.y, point.z);
      }
    }
  }
  return {
    steel: mergeGeometries(steel),
    cables: mergeGeometries(cables),
    glow: mergeGeometries(glow),
  };
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------
export class Structures {
  constructor({ scene, quality = 'high' }) {
    this.scene = scene;
    this.quality = quality;
    this.enabled = true;
    this.plan = planStructures('start');
    this.night = false;
    this.inside = false;     // steckt das Auto gerade in einem Tunnel?
    this.current = null;     // aktives Bauwerk aus dem Plan

    this.root = new THREE.Group();
    this.root.name = 'structures';
    this.root.visible = false;
    scene.add(this.root);

    const concrete = new THREE.MeshStandardMaterial({ color: 0x545a66, roughness: 0.9, metalness: 0.05 });
    this.hillMaterial = new THREE.MeshStandardMaterial({ color: 0x4c7a34, roughness: 1, metalness: 0, flatShading: true });
    this.lightMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 3.6, roughness: 0.4 });
    this.steelMaterial = new THREE.MeshStandardMaterial({ color: 0x5c6573, roughness: 0.6, metalness: 0.2 });
    this.cableMaterial = new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.5, metalness: 0.6 });
    this.glowMaterial = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff3b3b, emissiveIntensity: 1.2, roughness: 0.4 });

    // --- Tunnel ---
    this.tunnel = new THREE.Group();
    this.tunnelSegments = new THREE.InstancedMesh(tunnelSegmentGeometry(), concrete, MAX_SEGMENTS);
    this.tunnelLights = new THREE.InstancedMesh(tunnelLightGeometry(), this.lightMaterial, MAX_SEGMENTS);
    const m = new THREE.Matrix4();
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      m.makeTranslation(0, 0, -i * SEGMENT);
      this.tunnelSegments.setMatrixAt(i, m);
      this.tunnelLights.setMatrixAt(i, m);
    }
    this.tunnelSegments.castShadow = quality !== 'low';
    for (const mesh of [this.tunnelSegments, this.tunnelLights]) mesh.frustumCulled = false;

    this.portalGeometry = portalGeometry();
    this.portalNear = new THREE.Mesh(this.portalGeometry, concrete);
    this.portalFar = new THREE.Mesh(this.portalGeometry, concrete);
    this.portalNear.castShadow = this.portalFar.castShadow = quality !== 'low';

    // Hügel über dem Tunnel: langer Halbrund-Körper (Querschnitt = obere Hälfte einer Ellipse), Länge 1 von z = 0 bis z = −1.
    // Er ist überall höher als die Tunneldecke und endet bündig an den Portalen – so bleibt die Straße davor frei.
    // Die Stirnflächen haben ein Loch in Größe der Tunnelöffnung, sonst wäre der Eingang zugemauert.
    const profile = new THREE.Shape();
    profile.moveTo(-1, -0.03);
    profile.lineTo(1, -0.03);
    profile.lineTo(1, 0);
    profile.absarc(0, 0, 1, 0, Math.PI, false);
    profile.lineTo(-1, -0.03);
    const opening = new THREE.Path();
    opening.moveTo(-WALL_INNER_X / 13, 0);
    opening.lineTo(-WALL_INNER_X / 13, TUNNEL_HEIGHT / 13);
    opening.lineTo(WALL_INNER_X / 13, TUNNEL_HEIGHT / 13);
    opening.lineTo(WALL_INNER_X / 13, 0);
    opening.lineTo(-WALL_INNER_X / 13, 0);
    profile.holes.push(opening);
    const hillGeometry = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments: 20 });
    hillGeometry.translate(0, 0, -1);
    flipWinding(hillGeometry);
    this.hill = new THREE.Mesh(hillGeometry, this.hillMaterial);
    this.hill.frustumCulled = false;

    // Abdunklung der Fahrbahn im Tunnel: schwarze, durchscheinende Fläche knapp über dem Asphalt
    this.shade = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.shade.position.y = 0.035;
    this.shade.renderOrder = 2;
    this.shade.frustumCulled = false;

    this.tunnel.add(this.tunnelSegments, this.tunnelLights, this.portalNear, this.portalFar, this.hill, this.shade);
    this.tunnel.visible = false;
    this.root.add(this.tunnel);

    // --- Brücke ---
    const bridge = bridgeGeometries();
    this.bridge = new THREE.Group();
    const steel = new THREE.Mesh(bridge.steel, this.steelMaterial);
    const cables = new THREE.Mesh(bridge.cables, this.cableMaterial);
    const glow = new THREE.Mesh(bridge.glow, this.glowMaterial);
    for (const mesh of [steel, cables, glow]) mesh.frustumCulled = false;
    steel.castShadow = cables.castShadow = quality !== 'low';
    this.bridge.add(steel, cables, glow);
    this.bridge.visible = false;
    this.root.add(this.bridge);
  }

  /** Neue Strecke (Seed) – Bauwerke stehen für alle Fahrer mit demselben Seed an derselben Stelle. */
  reset(seed) {
    this.plan = planStructures(seed);
    this.current = null;
    this.inside = false;
    this.tunnel.visible = false;
    this.bridge.visible = false;
    this.root.visible = false;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) {
      this.root.visible = false;
      this.inside = false;
    }
  }

  /** Farbe des Hügels über dem Tunnel und Beleuchtung nach Welt und Tageszeit. */
  setStyle({ hillColor, night }) {
    if (hillColor !== undefined) this.hillMaterial.color.set(hillColor);
    this.night = Boolean(night);
    this.glowMaterial.emissiveIntensity = this.night ? 3.2 : 0.9;
    this.lightMaterial.emissiveIntensity = this.night ? 4.2 : 3.2;
  }

  /**
   * Bauwerke an die richtige Stelle schieben.
   * @param distance gefahrene Strecke in Metern
   */
  update(distance) {
    if (!this.enabled) return;

    // Aktives Bauwerk finden (es gibt nie zwei gleichzeitig: der Plan lässt Lücken von > 1,5 km)
    let active = null;
    for (const item of this.plan) {
      if (item.start - distance > VISIBLE_AHEAD) break; // noch nicht im Nebel sichtbar – und alles Weitere liegt noch weiter voraus
      if (distance - (item.start + item.length) < VISIBLE_BEHIND) {
        active = item;
        break;
      }
    }

    if (active !== this.current) this.#activate(active);
    if (!active) {
      this.inside = false;
      return;
    }

    // Lokaler Ursprung = naher Eingang. Er liegt bei z = distance − start (negativ = voraus).
    const z = distance - active.start;
    const object = active.type === 'tunnel' ? this.tunnel : this.bridge;
    object.position.z = z;
    // Im Tunnel, sobald die Front des Autos (z ≈ 0) zwischen Eingang (lokal 0) und Ausgang (lokal −Länge) liegt
    this.inside = active.type === 'tunnel' && z > 0 && z < active.length;
  }

  #activate(item) {
    this.current = item;
    this.tunnel.visible = Boolean(item && item.type === 'tunnel');
    this.bridge.visible = Boolean(item && item.type === 'bridge');
    this.root.visible = Boolean(item);
    if (!item || item.type !== 'tunnel') return;

    const segments = Math.min(MAX_SEGMENTS, Math.round(item.length / SEGMENT));
    const length = segments * SEGMENT;
    this.tunnelSegments.count = segments;
    this.tunnelLights.count = segments;
    this.portalNear.position.set(0, 0, 0.7);
    this.portalFar.position.set(0, 0, -length - 0.7);
    // Halbrund-Hügel: 13 m Halbbreite, 13 m Höhe (Tunnel samt Portal ist 9,7 m hoch)
    this.hill.scale.set(13, 13, length);
    this.hill.position.set(0, 0, 0);
    this.shade.scale.set(18.4, 1, length);
    this.shade.position.z = -length / 2;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
