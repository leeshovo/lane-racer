/*
 * storage.js – lokaler Spielstand (Münzen, Garage, Missionen, Einstellungen).
 * Liegt im localStorage dieses Browsers. Online-Identität (Name, Token) wird
 * hier ebenfalls abgelegt, damit man beim nächsten Besuch wiedererkannt wird.
 */
import { CARS, MISSION_POOL, CONFIG, carById } from './config.js';

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
    stats: { runs: 0, totalDistance: 0, totalCoins: 0, nearMisses: 0, smashed: 0, overtakes: 0, partyRaces: 0 },
    missions: [],
    missionTier: {},
    settings: { music: true, sfx: true, volume: 0.8, quality: 'auto' },
    online: null, // { id, secret } nach der Registrierung
  };
}

/** Lädt den Spielstand und ergänzt fehlende Felder (z. B. nach Updates). */
export function loadProfile() {
  const base = defaultProfile();
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (err) {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') return ensureMissions(base);

  const p = { ...base, ...stored };
  p.stats = { ...base.stats, ...(stored.stats || {}) };
  p.settings = { ...base.settings, ...(stored.settings || {}) };
  p.colors = { ...base.colors, ...(stored.colors || {}) };
  p.missionTier = { ...(stored.missionTier || {}) };
  p.owned = Array.isArray(stored.owned) ? stored.owned.filter((id) => CARS.some((c) => c.id === id)) : ['blitz'];
  if (!p.owned.includes('blitz')) p.owned.unshift('blitz');
  if (!p.owned.includes(p.selectedCar)) p.selectedCar = 'blitz';
  p.coins = Math.max(0, Math.floor(Number(p.coins) || 0));
  p.best = Math.max(0, Math.floor(Number(p.best) || 0));
  p.missions = Array.isArray(stored.missions) ? stored.missions.filter((m) => MISSION_POOL.some((d) => d.id === m.id)) : [];
  if (p.online && !(p.online.id && p.online.secret)) p.online = null;
  return ensureMissions(p);
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
 *             smashCoins, overtakes, level, nitroUses, isPartyRace}
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

  const newBest = distance > profile.best;
  if (newBest) profile.best = distance;

  return { breakdown, total, completed, newBest };
}
