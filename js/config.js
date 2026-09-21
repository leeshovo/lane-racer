/*
 * config.js – alle Stellschrauben und Kataloge an einem Ort.
 * Einheiten: Meter, Sekunden, m/s (× 3,6 = km/h). Fahrtrichtung = -z.
 */

export const VERSION = '2.6.0';

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

// Tageszeiten, aus denen pro Runde (nach Seed, also in Party-Rennen für alle gleich) eine gewählt wird.
// 'default' = Grundstimmung der Welt (Sonnental: Tag, Canyon: Abendrot, Neon City und Vulkan: Nacht).
export const WORLD_TIMES = {
  meadow: ['default', 'dawn', 'dusk', 'night'],
  canyon: ['default', 'day', 'night'],
  neon: ['default'],
  frost: ['default', 'dawn', 'dusk', 'night'],
  inferno: ['default'],
};
export const TIME_LABELS = { default: '', day: 'Mittag', dawn: 'Morgen', dusk: 'Abend', night: 'Nacht' };

// Farbe des Hügels über Tunneln je Welt
export const WORLD_HILL_COLOR = { meadow: 0x4c7a34, canyon: 0x9a5a38, neon: 0x2a2f3c, frost: 0xe4edf6, inferno: 0x2a1512 };

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
  {
    // Nur als Preis der Wochenwertung (Platz 1) – nicht kaufbar
    id: 'apex', name: 'Apex Champion', model: 'formula', price: 0, exclusive: 'weekly',
    ability: { id: 'hop', name: 'Meistersprung', text: 'Springt in hohem Bogen über den Verkehr', cooldown: 15, duration: 1.4 },
    description: 'Der Pokal auf vier Rädern. Nur für den Sieger der Wochenwertung.',
    colors: ['#FFD24A', '#f4f6fa', '#15181d'],
    stats: { speed: 1.2, handling: 1.25, nitro: 1.3 }, perk: 'magnet',
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
  { type: 'bike',      weight: 9, size: [0.95, 1.6, 2.2] },  // Motorrad: schmal
  { type: 'roadworks', weight: 5, size: [2.1, 2.7, 5.4] },   // Baustellenfahrzeug mit Warnbake
  { type: 'ambulance', weight: 3, size: [2.0, 2.3, 5.0] },   // Krankenwagen mit Blaulicht
  { type: 'boss',   weight: 0,  size: [2.35, 3.2, 15.0] }, // Schwerlast-Konvoi (zwei Lkw), nur als Ereignis
];
export const TRAFFIC_COLORS = ['#2f7de1', '#f2c200', '#2fbf71', '#e9ecef', '#8e5bd6', '#1fb5c9', '#3a4250', '#9aa5b1', '#7a1f2b'];

/**
 * Schwierigkeit für normale Solo-Runden. Tagesrennen, Party und Herausforderungen laufen immer auf "normal",
 * damit alle denselben Verkehr sehen. Das Tempo bleibt gleich – Scores bleiben also vergleichbar und
 * die Grenze, die der Server prüft, unverändert.
 *   spacing = Reihenabstand ×, double = Aufschlag für zwei Autos nebeneinander, coins = Münz-Faktor,
 *   ranked = zählt für Rekord und Online-Rangliste
 */
export const DIFFICULTY_MODES = {
  easy:   { label: 'Entspannt', spacing: 1.2, double: -0.1,  coins: 0.75, ranked: false },
  normal: { label: 'Normal',    spacing: 1,   double: 0,     coins: 1,    ranked: true },
  hard:   { label: 'Hardcore',  spacing: 1,   double: 0.12,  coins: 1.25, ranked: true },
  campaign: { label: 'Kampagne', spacing: 1,   double: 0,     coins: 1,    ranked: false }, // feste Karten, zählt nicht für die Rangliste
};

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

// Power-ups in Farben, die auch bei Rot-Grün-Schwäche unterscheidbar sind (zusätzlich hat jedes eine eigene Form)
export const POWERUP_COLORBLIND = { nitro: '#00E5FF', shield: '#FFFFFF', magnet: '#FF8A00', double: '#FFE600' };

// ---------------------------------------------------------------------------
// Wochenwertung: Reset jeden Mittwoch 12:00 Uhr (Europe/Berlin), berechnet in der Datenbank (week_start).
// Die Preistabelle steht hier UND in der Datenbank (week_prize_coins) – bitte beide zusammen ändern.
// ---------------------------------------------------------------------------
export const WEEKLY_RESET = 'Mittwoch 12:00 Uhr';

/** Sonderpreise für die ersten drei Plätze (item-Kürzel wie in der Datenbank). */
export const WEEKLY_ITEMS = {
  champion: { rank: 1, medal: '🥇', title: 'Wochensieger',  name: 'Apex Champion',  text: 'Exklusives Auto „Apex Champion“, Lack „Krone“ und der Titel Wochensieger' },
  silver:   { rank: 2, medal: '🥈', title: 'Vizemeister',   name: 'Chrom-Silber',   text: 'Exklusiver Lack „Chrom-Silber“ für alle Autos und der Titel Vizemeister' },
  bronze:   { rank: 3, medal: '🥉', title: 'Podium',        name: 'Bronze-Glut',    text: 'Exklusiver Lack „Bronze-Glut“ für alle Autos und der Titel Podium' },
};

/** Münzen je Platz: 1 = 1500, 2 = 1000, 3 = 750, dann immer weniger; jeder mit Punkten bekommt mindestens 25. */
export function weeklyPrizeCoins(rank) {
  const table = { 1: 1500, 2: 1000, 3: 750, 4: 500, 5: 400, 6: 320, 7: 260, 8: 210, 9: 170, 10: 140 };
  const r = Math.floor(Number(rank));
  if (!(r >= 1)) return 0;
  if (table[r]) return table[r];
  if (r <= 15) return 100;
  if (r <= 25) return 70;
  if (r <= 50) return 40;
  return 25;
}

/** Sonderpreis-Kürzel für einen Platz (oder null). */
export const weeklyItemForRank = (rank) => ({ 1: 'champion', 2: 'silver', 3: 'bronze' }[rank] || null);

export const EMOTES = ['👍', '🔥', '😂', '😱', '🏁', '💀'];

// Schnellnachrichten für die Party: feste Sätze statt freiem Chat (kein Missbrauch, keine Moderation nötig)
export const QUICK_CHAT = [
  { id: 'gg',      text: 'Gut gefahren!' },
  { id: 'again',   text: 'Nochmal?' },
  { id: 'ready',   text: 'Bin bereit' },
  { id: 'wait',    text: 'Moment noch' },
  { id: 'nice',    text: 'Starker Move!' },
  { id: 'unlucky', text: 'Pech gehabt' },
];

// ---------------------------------------------------------------------------
// Tagesserie: Wer an aufeinanderfolgenden Tagen fährt, bekommt beim ersten Rennen des Tages einen Bonus.
// Tag 1 = 20 Münzen, Tag 2 = 40 … ab Tag 7 = 140 (Höchstwert).
// ---------------------------------------------------------------------------
export const STREAK = { perDay: 20, maxDays: 7 };
export const streakBonus = (days) => Math.min(Math.max(0, Math.floor(days)), STREAK.maxDays) * STREAK.perDay;

// ---------------------------------------------------------------------------
// Erfolge: einmalige Ziele mit Münz-Belohnung. metric wird in storage.js aus dem Spielstand berechnet.
// color = schaltet diesen Sonderlack frei (siehe SPECIAL_COLORS)
// ---------------------------------------------------------------------------
export const ACHIEVEMENTS = [
  { id: 'first_run',  name: 'Erste Fahrt',     text: 'Beende deine erste Runde',                   metric: 'runs',         target: 1,     reward: 25 },
  { id: 'runs_25',    name: 'Stammgast',       text: 'Fahre 25 Runden',                            metric: 'runs',         target: 25,    reward: 100 },
  { id: 'dist_1k',    name: 'Tausender',       text: 'Fahre 1.000 m in einer Runde',               metric: 'bestDistance', target: 1000,  reward: 50 },
  { id: 'dist_5k',    name: 'Langstrecke',     text: 'Fahre 5.000 m in einer Runde',               metric: 'bestDistance', target: 5000,  reward: 150 },
  { id: 'dist_10k',   name: 'Zehntausender',   text: 'Fahre 10.000 m in einer Runde',              metric: 'bestDistance', target: 10000, reward: 400, color: 'gold' },
  { id: 'near_50',    name: 'Nervenkitzel',    text: 'Schaffe 50 Beinahe-Unfälle',                 metric: 'nearMisses',   target: 50,    reward: 75 },
  { id: 'near_500',   name: 'Haarscharf',      text: 'Schaffe 500 Beinahe-Unfälle',                metric: 'nearMisses',   target: 500,   reward: 300, color: 'pink' },
  { id: 'smash_25',   name: 'Abrissbirne',     text: 'Zerlege 25 Autos',                           metric: 'smashed',      target: 25,    reward: 100 },
  { id: 'over_1000',  name: 'Überholspur',     text: 'Überhole 1.000 Fahrzeuge',                   metric: 'overtakes',    target: 1000,  reward: 200 },
  { id: 'coins_2k',   name: 'Sparschwein',     text: 'Verdiene insgesamt 2.000 Münzen',            metric: 'totalCoins',   target: 2000,  reward: 100 },
  { id: 'coins_20k',  name: 'Goldesel',        text: 'Verdiene insgesamt 20.000 Münzen',           metric: 'totalCoins',   target: 20000, reward: 500 },
  { id: 'garage_3',   name: 'Sammler',         text: 'Besitze 3 Autos',                            metric: 'owned',        target: 3,     reward: 150 },
  { id: 'garage_all', name: 'Fuhrpark',        text: 'Besitze alle kaufbaren Autos',               metric: 'ownedBuyable', target: CARS.filter((c) => !c.exclusive).length, reward: 1000 },
  { id: 'level_7',    name: 'Weltenbummler',   text: 'Erreiche Level 7',                           metric: 'bestLevel',    target: 7,     reward: 100 },
  { id: 'level_13',   name: 'Am Vulkan',       text: 'Erreiche Level 13',                          metric: 'bestLevel',    target: 13,    reward: 300, color: 'ice' },
  { id: 'streak_3',   name: 'Dranbleiber',     text: 'Fahre an 3 Tagen hintereinander',            metric: 'bestStreak',   target: 3,     reward: 60 },
  { id: 'streak_7',   name: 'Wochenserie',     text: 'Fahre an 7 Tagen hintereinander',            metric: 'bestStreak',   target: 7,     reward: 200, color: 'acid' },
  { id: 'daily_1',    name: 'Tagesfahrer',     text: 'Fahre ein Tagesrennen',                      metric: 'dailyRuns',    target: 1,     reward: 50 },
  { id: 'party_1',    name: 'Teamgeist',       text: 'Fahre ein Party-Rennen mit Freunden',        metric: 'partyRaces',   target: 1,     reward: 75 },
  { id: 'camp_1',     name: 'Auf der Karte',   text: 'Schaffe deine erste Kampagnen-Karte',        metric: 'campaignMaps', target: 1,     reward: 50 },
  { id: 'camp_w1',    name: 'Sonnental gemeistert', text: 'Schaffe alle 4 Karten im Sonnental',    metric: 'campaignWorld1', target: 4,   reward: 150 },
  { id: 'camp_stars_15', name: 'Sternesammler', text: 'Sammle 15 Sterne in der Kampagne',         metric: 'campaignStars', target: 15,   reward: 200 },
  { id: 'camp_stars_40', name: 'Sternenhimmel', text: 'Sammle 40 Sterne in der Kampagne',         metric: 'campaignStars', target: 40,   reward: 500 },
  { id: 'camp_lvl_10', name: 'Routinier',       text: 'Erreiche Fahrerstufe 10',                  metric: 'campaignLevel', target: 10,   reward: 300 },
  { id: 'hard_2k',    name: 'Nervenstark',     text: 'Fahre 2.000 m im Hardcore-Modus',            metric: 'bestHard',     target: 2000,  reward: 200 },
];

// Sonderlacke: gelten für alle Autos, sobald der Erfolg geschafft ist, der sie freischaltet.
export const SPECIAL_COLORS = {
  // Wochenpreise (siehe WEEKLY_PRIZES): freigeschaltet, sobald man den Pokal dazu besitzt
  crown:  { name: 'Krone',        color: '#FFB300', trophy: 'gold' },
  silver: { name: 'Chrom-Silber', color: '#D9DEE7', trophy: 'silver' },
  bronze: { name: 'Bronze-Glut',  color: '#CD7F32', trophy: 'bronze' },
  gold: { name: 'Gold',      color: '#FFD24A' },
  pink: { name: 'Neon-Pink', color: '#FF2BD6' },
  ice:  { name: 'Eisblau',   color: '#9FE8FF' },
  acid: { name: 'Säuregrün', color: '#B6FF00' },
};

// ---------------------------------------------------------------------------
// Einstellungen: EINE Liste für Oberfläche, Speicher und Spiel.
// Wer eine Option hinzufügen will, ergänzt sie hier und wertet sie in main.js aus.
//   type 'switch' = An/Aus, 'range' = Regler 0–100 % (Wert 0–1), 'seg' = Auswahl
//   requires = wird ausgegraut, solange der genannte Schalter aus ist
// ---------------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  // Ton
  music: true,
  sfx: true,
  volume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  engineVolume: 0.6,
  muteInBackground: true,
  // Grafik und Effekte
  quality: 'auto',
  bend: true,
  bloom: true,
  speedFx: true,
  shake: 'normal',
  fps: false,
  // Anzeige und Steuerung
  unit: 'kmh',
  keyHints: true,
  vibrate: true,
  autoPause: true,
  // Spiel
  difficulty: 'normal',
  hints: 'few',
  // Barrierefreiheit
  contrast: false,
  textSize: 'normal',
  reduceMotion: false,
  colorblind: false,
};

export const SETTINGS_GROUPS = [
  {
    id: 'sound',
    title: 'Ton',
    items: [
      { key: 'music', type: 'switch', label: 'Musik', desc: 'Synthwave-Soundtrack je Welt' },
      { key: 'sfx', type: 'switch', label: 'Soundeffekte', desc: 'Motor, Münzen, Crashs' },
      { key: 'volume', type: 'range', label: 'Gesamtlautstärke' },
      { key: 'musicVolume', type: 'range', label: 'Musik', requires: 'music' },
      { key: 'sfxVolume', type: 'range', label: 'Effekte', requires: 'sfx' },
      { key: 'engineVolume', type: 'range', label: 'Motorgeräusch', requires: 'sfx' },
      { key: 'muteInBackground', type: 'switch', label: 'Im Hintergrund stumm', desc: 'Der Ton stoppt, sobald du den Tab oder das Fenster wechselst' },
    ],
  },
  {
    id: 'graphics',
    title: 'Grafik und Effekte',
    items: [
      {
        key: 'quality', type: 'seg', label: 'Grafikqualität',
        desc: 'Auto passt sich deinem Gerät an. Eine Änderung lädt das Spiel kurz neu.',
        options: [['auto', 'Auto'], ['high', 'Hoch'], ['medium', 'Mittel'], ['low', 'Niedrig']],
      },
      { key: 'bend', type: 'switch', label: 'Kurven und Hügel', desc: 'Die Straße schwingt seitlich und über Kuppen' },
      { key: 'bloom', type: 'switch', label: 'Leuchteffekte', desc: 'Glühen von Lichtern, Neon und Lava' },
      { key: 'speedFx', type: 'switch', label: 'Tempo-Effekte', desc: 'Tempo-Striche und weiterer Blickwinkel bei hoher Geschwindigkeit' },
      { key: 'shake', type: 'seg', label: 'Kamerawackeln', options: [['off', 'Aus'], ['low', 'Schwach'], ['normal', 'Normal']] },
      { key: 'fps', type: 'switch', label: 'Bildrate anzeigen', desc: 'Kleiner Zähler oben in der Mitte' },
    ],
  },
  {
    id: 'gameplay',
    title: 'Spiel',
    items: [
      {
        key: 'difficulty', type: 'seg', label: 'Schwierigkeit',
        desc: 'Gilt für normale Runden. Entspannt zählt nicht für Rekord und Rangliste (Münzen ×0,75), Hardcore bringt ×1,25 Münzen. Tagesrennen, Party und Herausforderungen sind immer Normal.',
        options: [['easy', 'Entspannt'], ['normal', 'Normal'], ['hard', 'Hardcore']],
      },
      {
        key: 'hints', type: 'seg', label: 'Hinweise im Spiel',
        desc: 'Wie viele Einblendungen während der Fahrt erscheinen. Missionen und Erfolge gibt es am Rundenende.',
        options: [['off', 'Keine'], ['few', 'Wenige'], ['all', 'Alle']],
      },
      { key: 'autoPause', type: 'switch', label: 'Automatisch pausieren', desc: 'Das Spiel hält an, wenn du das Fenster verlässt' },
      { key: 'vibrate', type: 'switch', label: 'Vibration', desc: 'Handy vibriert bei Crash, Nitro und Rammen' },
    ],
  },
  {
    id: 'display',
    title: 'Anzeige',
    items: [
      { key: 'unit', type: 'seg', label: 'Tempo-Einheit', options: [['kmh', 'km/h'], ['mph', 'mph']] },
      { key: 'keyHints', type: 'switch', label: 'Tastenhinweise', desc: 'Tipps zu den Tasten im Menü und während der Fahrt' },
    ],
  },
  {
    id: 'access',
    title: 'Barrierefreiheit',
    items: [
      { key: 'textSize', type: 'seg', label: 'Textgröße', options: [['normal', 'Normal'], ['large', 'Groß'], ['xlarge', 'Sehr groß']] },
      { key: 'contrast', type: 'switch', label: 'Hoher Kontrast', desc: 'Hellere Schrift, kräftigere Rahmen, weniger Transparenz' },
      { key: 'reduceMotion', type: 'switch', label: 'Weniger Bewegung', desc: 'Schaltet Kamerawackeln, Tempo-Effekte, Kurven und Animationen ab' },
      { key: 'colorblind', type: 'switch', label: 'Farbenblind-freundlich', desc: 'Power-ups und Anzeigen in Farben, die sich auch ohne Rot-Grün-Sicht unterscheiden' },
    ],
  },
];

/** Macht aus beliebigen gespeicherten Einstellungen eine gültige Menge (fehlende Werte → Standard, Unsinn → Standard). */
export function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_SETTINGS };
  for (const group of SETTINGS_GROUPS) {
    for (const item of group.items) {
      const value = src[item.key];
      if (item.type === 'switch') {
        if (typeof value === 'boolean') out[item.key] = value;
      } else if (item.type === 'range') {
        const n = Number(value);
        if (Number.isFinite(n)) out[item.key] = Math.min(1, Math.max(0, n));
      } else if (item.type === 'seg') {
        if (item.options.some(([option]) => option === value)) out[item.key] = value;
      }
    }
  }
  return out;
}
