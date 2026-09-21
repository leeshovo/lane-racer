/*
 * storage.js – lokaler Spielstand (Münzen, Garage, Missionen, Einstellungen).
 * Liegt im localStorage dieses Browsers. Online-Identität (ID + Geheimnis) wird
 * hier ebenfalls abgelegt, damit man beim nächsten Besuch wiedererkannt wird.
 *
 * Zusätzlich gibt es einen "Snapshot" des Spielstands, der in der Cloud
 * gesichert und auf einem anderen Gerät wiederhergestellt werden kann.
 */
import { CARS, MISSION_POOL, CONFIG, DIFFICULTY_MODES, carById, DEFAULT_SETTINGS, sanitizeSettings } from './config.js';

const KEY = 'laneRacer2.profile';
const ACTIVE_MISSIONS = 3;

export function defaultProfile() {
  return {
    version: 2,
    name: '',
    coins: 0,
    owned: ['blitz'],
    selectedCar: 'blitz',
    colors: Object.fromEntries(CARS.map((c) => [c.id, c.colors[0]])),
    best: 0,
    stats: { runs: 0, totalDistance: 0, totalCoins: 0, nearMisses: 0, smashed: 0, overtakes: 0, partyRaces: 0, dailyRuns: 0 },
    missions: [],
    missionTier: {},
    daily: { key: '', best: 0 }, // bester Versuch im Tagesrennen des Tages "key" (YYYYMMDD)
    settings: { ...DEFAULT_SETTINGS },
    tutorialDone: false, // Tipps in der ersten Runde schon gesehen?
    online: null, // { id, secret } nach der Registrierung
  };
}

/** Bringt beliebige gespeicherte Daten in die aktuelle Form (fehlende Felder ergänzen, Unsinn entfernen). */
function normalize(stored) {
  const base = defaultProfile();
  if (!stored || typeof stored !== 'object') return ensureMissions(base);

  const p = { ...base, ...stored };
  p.stats = { ...base.stats, ...(stored.stats || {}) };
  for (const k of Object.keys(base.stats)) p.stats[k] = Math.max(0, Math.floor(Number(p.stats[k]) || 0));
  p.settings = sanitizeSettings(stored.settings);
  // Wer schon gespielt hat, braucht kein Tutorial mehr
  p.tutorialDone = typeof stored.tutorialDone === 'boolean' ? stored.tutorialDone : Number(stored.stats && stored.stats.runs) > 0;
  p.colors = { ...base.colors, ...(stored.colors || {}) };
  // Nur erlaubte Lackfarben der jeweiligen Autos übernehmen
  for (const car of CARS) if (!car.colors.includes(p.colors[car.id])) p.colors[car.id] = car.colors[0];
  p.missionTier = { ...(stored.missionTier || {}) };
  p.owned = Array.isArray(stored.owned) ? stored.owned.filter((id) => CARS.some((c) => c.id === id)) : ['blitz'];
  if (!p.owned.includes('blitz')) p.owned.unshift('blitz');
  if (!p.owned.includes(p.selectedCar)) p.selectedCar = 'blitz';
  p.coins = Math.max(0, Math.floor(Number(p.coins) || 0));
  p.best = Math.max(0, Math.floor(Number(p.best) || 0));
  p.missions = Array.isArray(stored.missions) ? stored.missions.filter((m) => MISSION_POOL.some((d) => d.id === m.id)) : [];
  if (p.online && !(p.online.id && p.online.secret)) p.online = null;
  const d = stored.daily;
  p.daily = d && typeof d.key === 'string' && /^[0-9]{8}$/.test(d.key)
    ? { key: d.key, best: Math.max(0, Math.floor(Number(d.best) || 0)) }
    : base.daily;
  return ensureMissions(p);
}

/** Lädt den Spielstand aus dem Browser. */
export function loadProfile() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (err) {
    stored = null;
  }
  return normalize(stored);
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
    return true;
  } catch (err) {
    return false; // z. B. privater Modus – Spiel läuft trotzdem
  }
}

// ---------------------------------------------------------------------------
// Cloud-Snapshot
// ---------------------------------------------------------------------------

/** Der Teil des Spielstands, der in die Cloud wandert (ohne Name, Geheimnis und Geräte-Einstellungen). */
export function snapshotOf(profile) {
  return {
    v: 2,
    coins: profile.coins,
    owned: [...profile.owned],
    selectedCar: profile.selectedCar,
    colors: { ...profile.colors },
    best: profile.best,
    stats: { ...profile.stats },
    missions: profile.missions.map((m) => ({ ...m })),
    missionTier: { ...profile.missionTier },
  };
}

/**
 * Wie weit ist dieser Spielstand? Lebenslang verdiente Münzen wachsen nie zurück
 * (anders als das Guthaben nach einem Autokauf) – damit lässt sich "neuer" eindeutig erkennen.
 */
export function progressOf(data) {
  const s = data && data.stats ? data.stats : {};
  return (Number(s.totalCoins) || 0) * 1000 + (Number(s.runs) || 0);
}

/** Übernimmt einen Cloud-Snapshot in das lokale Profil (Name, Einstellungen und Online-ID bleiben). */
export function adoptSnapshot(profile, data) {
  const merged = normalize({
    ...data,
    name: profile.name,
    settings: profile.settings,
    online: profile.online,
    daily: profile.daily,
    tutorialDone: profile.tutorialDone,
  });
  Object.assign(profile, merged);
  return profile;
}

// ---------------------------------------------------------------------------
// Garage
// ---------------------------------------------------------------------------
export const selectedCarOf = (profile) => carById(profile.selectedCar);
export const colorOf = (profile, carId) => profile.colors[carId] || carById(carId).colors[0];

export function buyCar(profile, carId) {
  const car = carById(carId);
  if (profile.owned.includes(car.id)) return { ok: false, error: 'Schon in deiner Garage.' };
  if (profile.coins < car.price) {
    return { ok: false, error: `Dir fehlen noch ${(car.price - profile.coins).toLocaleString('de-DE')} Münzen.` };
  }
  profile.coins -= car.price;
  profile.owned.push(car.id);
  profile.selectedCar = car.id;
  return { ok: true };
}

export function selectCar(profile, carId) {
  if (!profile.owned.includes(carId)) return false;
  profile.selectedCar = carId;
  return true;
}

export function setCarColor(profile, carId, color) {
  const car = carById(carId);
  if (!car.colors.includes(color)) return false;
  profile.colors[car.id] = color;
  return true;
}

// ---------------------------------------------------------------------------
// Missionen
// ---------------------------------------------------------------------------
function makeMission(profile, def) {
  const tierIndex = profile.missionTier[def.id] || 0;
  const last = def.tiers[def.tiers.length - 1];
  let target;
  let reward;
  if (tierIndex < def.tiers.length) {
    [target, reward] = def.tiers[tierIndex];
  } else {
    // Alle Stufen geschafft → die letzte Stufe wird schrittweise härter
    const extra = tierIndex - def.tiers.length + 1;
    target = Math.round(last[0] * (1 + 0.5 * extra));
    reward = Math.round(last[1] * (1 + 0.3 * extra));
  }
  return {
    id: def.id,
    tier: tierIndex,
    target,
    reward,
    progress: 0,
    text: def.text.replace('{n}', target.toLocaleString('de-DE')),
  };
}

/** Füllt die aktiven Missionen auf 3 auf (ohne doppelte Typen). */
export function ensureMissions(profile) {
  const active = new Set(profile.missions.map((m) => m.id));
  const candidates = MISSION_POOL.filter((d) => !active.has(d.id));
  while (profile.missions.length < ACTIVE_MISSIONS && candidates.length) {
    const i = Math.floor(Math.random() * candidates.length);
    const [def] = candidates.splice(i, 1);
    profile.missions.push(makeMission(profile, def));
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Rundenende: Münzen gutschreiben, Statistiken und Missionen fortschreiben
// ---------------------------------------------------------------------------

/**
 * @param run {distance, coinsCollected, nearMisses, nearMissCoins, smashed,
 *             smashCoins, overtakes, level, nitroUses, isPartyRace, isDaily}
 * @returns {{breakdown, total, completed: Array<mission>, newBest: boolean}}
 */
export function applyRun(profile, run) {
  const car = selectedCarOf(profile);
  const distance = Math.floor(run.distance);

  const breakdown = {
    collected: run.coinsCollected || 0,
    nearMiss: run.nearMissCoins || 0,
    smash: run.smashCoins || 0,
    distance: Math.floor(distance / 100) * CONFIG.coinsPer100m,
    perk: 0,
    missions: 0,
  };
  const modeDef = DIFFICULTY_MODES[run.mode] || DIFFICULTY_MODES.normal;
  if (modeDef.coins !== 1) {
    // Schwierigkeit wirkt auf jede Zeile, damit die Summe in der Anzeige stimmt
    for (const key of ['collected', 'nearMiss', 'smash', 'distance']) breakdown[key] = Math.round(breakdown[key] * modeDef.coins);
  }
  const subtotal = breakdown.collected + breakdown.nearMiss + breakdown.smash + breakdown.distance;
  if (car.perk === 'coinBonus') breakdown.perk = Math.round(subtotal * 0.2);

  // Statistiken
  const s = profile.stats;
  s.runs += 1;
  s.totalDistance += distance;
  s.nearMisses += run.nearMisses || 0;
  s.smashed += run.smashed || 0;
  s.overtakes += run.overtakes || 0;
  if (run.isPartyRace) s.partyRaces += 1;
  if (run.isDaily) s.dailyRuns += 1;

  // Missionen
  const runValues = {
    distance,
    nearMisses: run.nearMisses || 0,
    coinsCollected: run.coinsCollected || 0,
    level: run.level || 1,
    nitroUses: run.nitroUses || 0,
  };
  const totalValues = {
    smashed: run.smashed || 0,
    overtakes: run.overtakes || 0,
    partyRaces: run.isPartyRace ? 1 : 0,
    dailyRuns: run.isDaily ? 1 : 0,
  };
  const completed = [];
  profile.missions = profile.missions.filter((m) => {
    const def = MISSION_POOL.find((d) => d.id === m.id);
    if (!def) return false;
    if (def.mode === 'run') m.progress = Math.max(m.progress, runValues[def.stat] || 0);
    else m.progress += totalValues[def.stat] || 0;
    if (m.progress >= m.target) {
      completed.push({ ...m });
      breakdown.missions += m.reward;
      profile.missionTier[m.id] = (profile.missionTier[m.id] || 0) + 1;
      return false;
    }
    return true;
  });
  ensureMissions(profile);

  const total = subtotal + breakdown.perk + breakdown.missions;
  profile.coins += total;
  s.totalCoins += total;

  const newBest = modeDef.ranked && distance > profile.best;
  if (newBest) profile.best = distance;

  return { breakdown, total, completed, newBest, ranked: modeDef.ranked, mode: run.mode || 'normal' };
}
