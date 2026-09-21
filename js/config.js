/*
 * config.js – alle Stellschrauben und Kataloge an einem Ort.
 * Einheiten: Meter, Sekunden, m/s (× 3,6 = km/h). Fahrtrichtung = -z.
 */

export const VERSION = '2.1.0';

// Öffentliche Supabase-Zugangsdaten (Publishable Key darf im Browser stehen –
// geschützt wird über Row Level Security und geprüfte Server-Funktionen).
export const SUPABASE = {
  url: 'https://lqiogfahydzgydiyalpp.supabase.co',
  key: 'sb_publishable_NbGjB3FtbqU_c_x5eHJXOw_35eIjDmM',
};

// ---------------------------------------------------------------------------
// Straße
// ---------------------------------------------------------------------------
export const LANE_COUNT = 3;
export const LANE_WIDTH = 4;
export const LANE_X = Array.from({ length: LANE_COUNT }, (_, i) => (i - (LANE_COUNT - 1) / 2) * LANE_WIDTH); // [-4, 0, 4]
export const SHOULDER_WIDTH = 1.2;
export const ROAD_WIDTH = LANE_COUNT * LANE_WIDTH + 2 * SHOULDER_WIDTH; // 14.4

// ---------------------------------------------------------------------------
// Spielmechanik
// ---------------------------------------------------------------------------
export const CONFIG = {
  // Welt / Sichtweite
  fogNear: 60,
  fogFar: 215,
  spawnZ: -235,          // Gegner entstehen hier – jenseits von fogFar + Kameraabstand
  despawnZ: 25,
  firstRowZ: -80,
  sceneryBackZ: 30,      // Deko hinter der Kamera springt nach vorne ...
  scenerySpan: 290,      // ... um diese Strecke

  // Tempo (m/s)
  startSpeed: 25,        // 90 km/h
  maxBaseSpeed: 72,      // 259 km/h bei maximaler Schwierigkeit
  boostFactor: 1.4,      // ↑: bis Grundtempo × 1,4 (× Auto-Wert "speed")
  brakeFactor: 0.8,      // ↓: bis Grundtempo × 0,8
  acceleration: 18,
  braking: 35,
  coastRate: 8,
  trafficFactor: 0.35,   // Verkehr fährt mit Grundtempo × 0,35

  // Schwierigkeit (über die Zeit)
  difficultyTime: 180,   // Sekunden bis zur maximalen Schwierigkeit
  levelTime: 12,         // alle 12 s ein Level ...
  maxLevel: 15,          // ... bis Level 15
  rowSpacingStart: 36,
  rowSpacingEnd: 24,
  rowSpacingJitter: 0.35,
  doubleChanceStart: 0.15,
  doubleChanceEnd: 0.6,

  // Spieler
  steerStiffness: 14,
  hitboxScale: 0.88,
  crashDuration: 1.6,
  countdownSolo: 3,      // Sekunden Countdown vor einer normalen Runde
  countdownRace: 5,      // ... vor einem Party-Rennen

  // Nitro
  nitroMinToStart: 0.3,  // mind. 30 % Füllung zum Zünden
  nitroDuration: 3.2,    // Sekunden bei voller Leiste (× Auto-Wert "nitro")
  nitroSpeedFactor: 1.3, // Zusatztempo während Nitro
  nitroFillNearMiss: 0.25,
  nitroFillPassive: 0.012, // pro Sekunde
  nitroGrace: 0.6,       // Sekunden Unverwundbarkeit nach Nitro-Ende

  // Beinahe-Unfälle
  nearMissClearance: 1.0,  // sichtbarer Seitenabstand in m, der als "knapp" zählt
                           // (normal auf der Nachbarspur: 2,1 m → nur späte Ausweichmanöver zählen)
  comboWindow: 3,          // Sekunden bis die Kombo verfällt
  maxCombo: 5,

  // Münzen / Belohnungen
  coinsPer100m: 1,
  nearMissCoins: 2,      // × Kombo
  smashCoins: 5,
  coinLineChance: 0.45,  // Anteil der Reihen mit Münzlinie in der freien Spur
  powerupChance: 0.07,   // Anteil der Reihen mit Power-up
  coinsPerLine: 5,
  coinSpacing: 3,

  // Ereignisse (zählen in Reihen, nicht in Sekunden – so erleben alle Party-Spieler dasselbe)
  eventFirstRows: [16, 24],    // erstes Ereignis nach so vielen Reihen (min, max)
  eventGapRows: [22, 34],      // Pause zwischen zwei Ereignissen
  eventLengthRows: [7, 10],    // Dauer eines Ereignisses
  rushSpacingFactor: 0.82,     // Stoßverkehr: Reihen rücken enger zusammen ...
  rushDoubleBonus: 0.15,       // ... und öfter zwei Autos nebeneinander
  rushNearMissFactor: 2,       // dafür doppelte Münzen für Beinahe-Unfälle
  goldCoinsPerLine: 9,         // Goldrausch: längere Münzlinien
  bossFirstRow: 58,            // Schwerlast-Konvoi: erste Reihe ...
  bossGapRows: [80, 110],      // ... und Abstand dazwischen
  bossExtraSpacing: 14,        // zusätzlicher Platz vor und hinter dem Konvoi (Fairness)
  bossPassCoins: 25,           // Belohnung fürs Überholen
  bossSmashCoins: 15,          // Belohnung fürs Rammen

  // Straßenverlauf (Kurven und Hügel, rein optisch – gefahren wird immer geradeaus)
  bendRampDistance: 500,       // so viele Meter bleibt die Straße am Anfang gerade
  bendWaveX: 1100,             // Länge einer Kurven-Welle in Metern
  bendWaveY: 830,              // Länge einer Hügel-Welle in Metern

  // Power-ups
  magnetTime: 10,
  magnetRange: 4.6,      // seitliche Reichweite (eine Spur weit)
  doubleCoinsTime: 15,
  shieldGrace: 1.0,

  // Kamera
  fov: 62,
  fovBoost: 12,
  fovNitro: 10,
  minHorizontalFov: 55,
  cameraHeight: 3.6,
  cameraDistance: 8.8,
  lookAhead: 12,
};

// ---------------------------------------------------------------------------
// Welten: wechseln alle 3 Level. Die Optik jeder Welt definiert world.js.
// ---------------------------------------------------------------------------
export const WORLDS = [
  { id: 'meadow',  name: 'Sonnental',  tagline: 'Sonntagsausflug mit 250 Sachen' },
  { id: 'canyon',  name: 'Canyon',     tagline: 'Staub, Kakteen, Abendrot' },
  { id: 'neon',    name: 'Neon City',  tagline: 'Regen auf Asphalt, Lichter überall' },
  { id: 'frost',   name: 'Frostpass',  tagline: 'Schnee in den Kurven der Welt' },
  { id: 'inferno', name: 'Vulkan',     tagline: 'Lava links, Lava rechts' },
];
export const LEVELS_PER_WORLD = 3;

// Wie stark die Straße pro Welt kurvt (x) und über Hügel führt (y): Versatz in Metern in 215 m Entfernung.
export const WORLD_BEND = {
  meadow:  { x: 5,  y: 2.5 },
  canyon:  { x: 12, y: 3 },
  neon:    { x: 4,  y: 1.5 },
  frost:   { x: 8,  y: 6 },
  inferno: { x: 13, y: 5 },
};
export const worldIndexForLevel = (level) =>
  Math.min(WORLDS.length - 1, Math.floor((Math.max(1, level) - 1) / LEVELS_PER_WORLD));

// ---------------------------------------------------------------------------
// Fahrzeuge
// ---------------------------------------------------------------------------

// Alle Spielerautos teilen sich dieselbe Hitbox (faire Rangliste) – das Modell
// darf optisch leicht abweichen, sollte aber etwa diese Maße haben.
export const PLAYER_SIZE = [1.9, 1.5, 4.2]; // Breite, Höhe, Länge

/**
 * Autos in der Garage.
 * stats: speed = Faktor auf die Höchstgeschwindigkeit beim Gasgeben,
 *        handling = Faktor auf die Lenk-Federhärte,
 *        nitro = Faktor auf Nitro-Dauer.
 * perk: passive Sonderfähigkeit (siehe PERKS).
 * ability: aktive Fähigkeit auf Taste F/E mit Abklingzeit (siehe Game.useAbility).
 * model: welches Modell cars.js baut.
 */
export const CARS = [
  {
    id: 'blitz', name: 'Blitz', model: 'coupe', price: 0,
    ability: { id: 'boost',     name: 'Blitzstart',   text: 'Füllt sofort die Nitro-Leiste auf 60 %',                 cooldown: 35, duration: 0 },
    description: 'Das Coupé, mit dem alles anfängt. Ausgewogen und flink.',
    colors: ['#ff5a1f', '#ffc93c', '#2ec4b6', '#f4f6fa'],
    stats: { speed: 1.0, handling: 1.0, nitro: 1.0 }, perk: null,
  },
  {
    id: 'kiwi', name: 'Kiwi', model: 'hatch', price: 300,
    ability: { id: 'pulse',     name: 'Münzsog',      text: 'Saugt alle Münzen der nächsten 50 m an',                 cooldown: 20, duration: 0 },
    description: 'Kleiner Stadtflitzer, lenkt wie auf Schienen.',
    colors: ['#8bd346', '#ff7eb6', '#4d9de0', '#f4f6fa'],
    stats: { speed: 0.97, handling: 1.18, nitro: 1.0 }, perk: 'coinBonus',
  },
  {
    id: 'bulldog', name: 'Bulldog', model: 'muscle', price: 800,
    ability: { id: 'ram',       name: 'Rammbock',     text: '3 s unverwundbar: Autos fliegen zur Seite',              cooldown: 30, duration: 3 },
    description: 'V8-Muskelpaket. Rammt mit Nitro doppelt ertragreich.',
    colors: ['#1d3fbb', '#c1121f', '#111418', '#ffc93c'],
    stats: { speed: 1.06, handling: 0.92, nitro: 1.1 }, perk: 'smashPlus',
  },
  {
    id: 'rancher', name: 'Rancher', model: 'pickup', price: 1500,
    ability: { id: 'repair',    name: 'Reparatur',    text: 'Schutzschild sofort wiederherstellen',                   cooldown: 40, duration: 0 },
    description: 'Robuster Pick-up. Startet jede Runde mit Schutzschild.',
    colors: ['#6b705c', '#b5651d', '#264653', '#e9ecef'],
    stats: { speed: 0.95, handling: 0.95, nitro: 1.0 }, perk: 'startShield',
  },
  {
    id: 'sheriff', name: 'Sheriff', model: 'police', price: 2500,
    ability: { id: 'siren',     name: 'Sirene',       text: '4 s lang macht der Verkehr Platz und fährt schneller',   cooldown: 30, duration: 4 },
    description: 'Abfangjäger mit Blaulicht. Startet mit halbem Nitro.',
    colors: ['#f4f6fa', '#111418', '#1d3fbb', '#2d6a4f'],
    stats: { speed: 1.05, handling: 1.05, nitro: 1.1 }, perk: 'nitroStart',
  },
  {
    id: 'neon', name: 'Neon GT', model: 'gt', price: 4000,
    ability: { id: 'phase',     name: 'Phasensprung', text: '1,8 s durch alles hindurch fahren',                      cooldown: 25, duration: 1.8 },
    description: 'Leuchtender Unterboden. Beinahe-Unfälle füllen mehr Nitro.',
    colors: ['#b517ff', '#00e5ff', '#ff2e88', '#1a1a2e'],
    stats: { speed: 1.1, handling: 1.05, nitro: 1.15 }, perk: 'nearMissPlus',
  },
  {
    id: 'rakete', name: 'Rakete F1', model: 'formula', price: 6500,
    ability: { id: 'overdrive', name: 'Overdrive',    text: '5 s lang +30 % Höchsttempo und Beschleunigung',          cooldown: 30, duration: 5 },
    description: 'Formelwagen. Pure Werte, keine Kompromisse.',
    colors: ['#e10600', '#00a19b', '#ff8700', '#f4f6fa'],
    stats: { speed: 1.15, handling: 1.22, nitro: 1.1 }, perk: null,
  },
  {
    id: 'phantom', name: 'Phantom X', model: 'hover', price: 10000,
    ability: { id: 'hop',       name: 'Schwebesprung', text: 'Springt in hohem Bogen über den Verkehr',               cooldown: 22, duration: 1.4 },
    description: 'Schwebt statt zu rollen. Eingebauter Münzmagnet.',
    colors: ['#c0c7d1', '#ffd700', '#00ffa3', '#ff3b4e'],
    stats: { speed: 1.18, handling: 1.15, nitro: 1.3 }, perk: 'magnet',
  },
];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

export const PERKS = {
  coinBonus:    { name: 'Sparfuchs',    text: '+20 % Münzen pro Runde' },
  smashPlus:    { name: 'Abrissbirne',  text: 'Doppelte Münzen fürs Rammen mit Nitro' },
  startShield:  { name: 'Knautschzone', text: 'Startet mit Schutzschild' },
  nitroStart:   { name: 'Vorglühen',    text: 'Startet mit 50 % Nitro' },
  nearMissPlus: { name: 'Adrenalin',    text: 'Beinahe-Unfälle füllen 40 % mehr Nitro' },
  magnet:       { name: 'Magnetfeld',   text: 'Zieht Münzen aus der Nachbarspur an' },
};

/**
 * Verkehr. size = [Breite, Höhe, Länge] – daraus wird die Hitbox berechnet.
 * Die längste Länge beeinflusst die Fairness-Rechnung (min. Reihenabstand 23 m).
 */
export const TRAFFIC = [
  { type: 'sedan',  weight: 44, size: [1.9, 1.45, 4.3] },
  { type: 'hatch',  weight: 18, size: [1.8, 1.5, 3.8] },
  { type: 'taxi',   weight: 8,  size: [1.9, 1.7, 4.4] },
  { type: 'van',    weight: 12, size: [2.0, 2.3, 4.9] },
  { type: 'truck',  weight: 14, size: [2.35, 3.2, 7.2] },
  { type: 'police', weight: 4,  size: [1.95, 1.65, 4.6] },
  { type: 'boss',   weight: 0,  size: [2.35, 3.2, 15.0] }, // Schwerlast-Konvoi (zwei Lkw), nur als Ereignis
];
export const TRAFFIC_COLORS = ['#2f7de1', '#f2c200', '#2fbf71', '#e9ecef', '#8e5bd6', '#1fb5c9', '#3a4250', '#9aa5b1', '#7a1f2b'];

export const POWERUPS = {
  nitro:  { name: 'Nitro',       color: '#00e5ff' },
  shield: { name: 'Schild',      color: '#7cf29c' },
  magnet: { name: 'Magnet',      color: '#ff3b4e' },
  double: { name: '2× Münzen',   color: '#ffc93c' },
};

// ---------------------------------------------------------------------------
// Missionen: immer 3 aktiv; erledigte werden durch neue ersetzt.
// mode 'run' = in einer einzigen Runde, 'total' = über alle Runden.
// ---------------------------------------------------------------------------
export const MISSION_POOL = [
  { id: 'dist',     stat: 'distance',       mode: 'run',   text: 'Fahre {n} m in einer Runde',            tiers: [[1500, 100], [3000, 200], [5000, 350], [8000, 600]] },
  { id: 'near',     stat: 'nearMisses',     mode: 'run',   text: 'Schaffe {n} Beinahe-Unfälle in einer Runde', tiers: [[5, 100], [10, 200], [20, 400]] },
  { id: 'coins',    stat: 'coinsCollected', mode: 'run',   text: 'Sammle {n} Münzen in einer Runde',      tiers: [[30, 100], [60, 200], [120, 400]] },
  { id: 'smash',    stat: 'smashed',        mode: 'total', text: 'Zerlege insgesamt {n} Autos',           tiers: [[5, 150], [15, 300], [40, 600]] },
  { id: 'overtake', stat: 'overtakes',      mode: 'total', text: 'Überhole insgesamt {n} Fahrzeuge',      tiers: [[100, 100], [300, 250], [800, 500]] },
  { id: 'level',    stat: 'level',          mode: 'run',   text: 'Erreiche Level {n}',                    tiers: [[4, 150], [7, 300], [10, 500], [13, 800]] },
  { id: 'nitro',    stat: 'nitroUses',      mode: 'run',   text: 'Zünde {n}× Nitro in einer Runde',        tiers: [[2, 100], [4, 200], [7, 400]] },
  { id: 'daily',    stat: 'dailyRuns',      mode: 'total', text: 'Fahre {n} Tagesrennen',                 tiers: [[1, 150], [3, 300], [7, 600]] },
  { id: 'party',    stat: 'partyRaces',     mode: 'total', text: 'Fahre {n} Party-Rennen mit Freunden',   tiers: [[1, 200], [3, 400], [10, 1000]] },
];

export const EMOTES = ['👍', '🔥', '😂', '😱', '🏁', '💀'];
