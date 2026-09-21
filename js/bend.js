/*
 * bend.js – Kurven und Hügel durch "gebogene Welt".
 *
 * Das Spiel selbst läuft immer geradeaus (Verkehr, Kollisionen, Spuren).
 * Optisch wird jedes Bauteil im Vertex-Shader abhängig von seiner Entfernung
 * zur Kamera seitlich (Kurve) und nach oben/unten (Hügel) verschoben:
 *
 *      Versatz = Krümmung × Entfernung²
 *
 * Direkt am Auto ist der Versatz praktisch null (bei 9 m: ca. 2 cm),
 * in 200 m Entfernung sind es einige Meter – die Straße scheint zu kurven.
 * Deshalb reicht ein einziger, gemeinsamer Wert für alle Objekte.
 *
 * Wichtig: Dieses Modul muss vor dem ersten Rendern geladen werden, denn es
 * hängt sich global in die Shader-Erzeugung von three.js ein.
 */
import * as THREE from 'three';
import { CONFIG, WORLDS, WORLD_BEND } from './config.js';

/** Gemeinsame Uniform: x = seitliche Krümmung, y = vertikale Krümmung (Meter pro Meter²). */
export const bendUniform = { value: new THREE.Vector2(0, 0) };

const MAX_BEND_DISTANCE = 320; // ab hier bleibt der Versatz konstant (Nebel verdeckt alles)

// Ausgangsfunktion merken (in three ist sie leer)
const originalOnBeforeCompile = THREE.Material.prototype.onBeforeCompile;

THREE.Material.prototype.onBeforeCompile = function onBeforeCompileWithBend(shader, renderer) {
  originalOnBeforeCompile.call(this, shader, renderer);

  // Ausnahmen: Schatten-Tiefenmaterialien (Licht-Perspektive), Himmel und Kulissen
  // (fog: false), Materialien mit eigenem Shader ohne project_vertex.
  if (this.isMeshDepthMaterial || this.isMeshDistanceMaterial) return;
  if (this.fog === false || (this.userData && this.userData.noBend)) return;
  const chunk = '#include <project_vertex>';
  if (!shader.vertexShader.includes(chunk)) return;

  shader.uniforms.uBend = bendUniform;
  shader.vertexShader = 'uniform vec2 uBend;\n' + shader.vertexShader.replace(
    chunk,
    chunk + `
    {
      float bendDist = min(max(-mvPosition.z, 0.0), ${MAX_BEND_DISTANCE.toFixed(1)});
      float bendSq = bendDist * bendDist;
      mvPosition.x += uBend.x * bendSq;
      mvPosition.y += uBend.y * bendSq;
      gl_Position = projectionMatrix * mvPosition;
    }`,
  );
};

// ---------------------------------------------------------------------------
// Steuerung des Straßenverlaufs
// ---------------------------------------------------------------------------
const FOG_FAR_SQ = CONFIG.fogFar * CONFIG.fogFar;
const target = new THREE.Vector2();
let enabled = true;

/** Kurven und Hügel ein-/ausschalten (z. B. für die Geräte-Einstellung "Niedrig"). */
export function setBendEnabled(on) {
  enabled = Boolean(on);
}

/**
 * Berechnet den Straßenverlauf aus der gefahrenen Strecke.
 * Am Anfang bleibt die Straße gerade, danach schwingen Kurve und Hügel
 * mit unterschiedlicher Wellenlänge (sieht nie gleich aus).
 *
 * @param distance gefahrene Meter (bei Party-Rennen: gleicher Verlauf für alle)
 * @param worldIndex Index in WORLDS – jede Welt hat eigene Stärken (WORLD_BEND)
 * @param dt Sekunden seit dem letzten Frame (für das weiche Nachführen)
 * @param instant true = ohne Übergang setzen
 */
export function updateBend(distance, worldIndex, dt, instant = false) {
  if (!enabled) {
    target.set(0, 0);
  } else {
    const world = WORLD_BEND[WORLDS[worldIndex]?.id] || { x: 0, y: 0 };
    // Sanfter Einstieg: in den ersten bendRampDistance Metern wächst die Stärke von 0 auf 1
    const ramp = Math.min(1, Math.max(0, distance / CONFIG.bendRampDistance));
    const eased = ramp * ramp * (3 - 2 * ramp);
    const swingX = Math.sin(distance / CONFIG.bendWaveX * Math.PI * 2) * 0.75 + Math.sin(distance / (CONFIG.bendWaveX * 0.37) * Math.PI * 2 + 1.3) * 0.25;
    const swingY = Math.sin(distance / CONFIG.bendWaveY * Math.PI * 2 + 0.8) * 0.7 + Math.sin(distance / (CONFIG.bendWaveY * 0.43) * Math.PI * 2) * 0.3;
    target.set(
      (world.x * eased * swingX) / FOG_FAR_SQ,
      (world.y * eased * swingY) / FOG_FAR_SQ,
    );
  }
  if (instant) bendUniform.value.copy(target);
  else bendUniform.value.lerp(target, 1 - Math.exp(-1.6 * dt));
}
