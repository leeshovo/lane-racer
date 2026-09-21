/*
 * storage.js – lokaler Spielstand (Münzen, Garage, Missionen, Einstellungen).
 * Liegt im localStorage dieses Browsers. Online-Identität (ID + Geheimnis) wird
 * hier ebenfalls abgelegt, damit man beim nächsten Besuch wiedererkannt wird.
 *
 * Zusätzlich gibt es einen "Snapshot" des Spielstands, der in der Cloud
 * gesichert und auf einem anderen Gerät wiederhergestellt werden kann.
 */
import { sanitizeCampaign, defaultCampaign, totalStars, levelInfo, CAMPAIGN_MAPS } from './campaign.js';
import {
  CARS, MISSION_POOL, CONFIG, DIFFICULTY_MODES, ACHIEVEMENTS, SPECIAL_COLORS, carById, DEFAULT_SETTINGS, sanitizeSettings, streakBonus,
  WEEKLY_ITEMS, RESET_EPOCH, TUNING, TUNING_MAX, tuningCost,
} from './config.js';

const KEY = 'laneRacer2.profile';
export const PARTY_MEMORY_MS = 14 * 24 * 3600 * 1000; // so lange merkt sich das Spiel die letzte Party
const ACTIVE_MISSIONS = 3;

export function defaultProfile() {
  return {
    version: 2,
    name: '',
    coins: 0,
    owned: ['blitz'],
    tuning: {},                     // { autoId: { nitro, handling, coins } } – gekaufte Tuning-Stufen
    selectedCar: 'blitz',
    colors: Object.fromEntries(CARS.map((c) => [c.id, c.colors[0]])),
    best: 0,
    stats: {
      runs: 0, totalDistance: 0, totalCoins: 0, nearMisses: 0, smashed: 0, overtakes: 0, partyRaces: 0, dailyRuns: 0, rankedRuns: 0,
      bestLevel: 0, bestHard: 0, bestStreak: 0, // Höchstwerte (für Erfolge)
    },
    streak: { last: '', count: 0 }, // letzter Fahrtag (YYYYMMDD, UTC) und Tage in Folge
    achievements: {},               // { id: true } für geschaffte Erfolge
    campaign: defaultCampaign(),    // Sterne, Bestwerte und XP der Kampagne (siehe campaign.js)
    trophies: { gold: 0, silver: 0, bronze: 0 }, // Podiumsplätze der Wochenwertung
    weekly: { applied: [] },        // Wochen, deren Belohnung schon gutgeschrieben wurde (verhindert doppelte Auszahlung)
    missions: [],
    missionTier: {},
    daily: { key: '', best: 0 }, // bester Versuch im Tagesrennen des Tages "key" (YYYYMMDD)
    settings: { ...DEFAULT_SETTINGS },
    epoch: RESET_EPOCH,  // Generation des Spielstands (siehe RESET_EPOCH in config.js)
    tutorialDone: false, // Tipps in der ersten Runde schon gesehen?
    lastParty: null,     // { code, at } – die Party, in der man zuletzt war (wird beim Start wieder betreten)
    online: null, // { id, secret } nach der Registrierung
  };
}

/** Bringt beliebige gespeicherte Daten in die aktuelle Form (fehlende Felder ergänzen, Unsinn entfernen). */
function normalize(stored) {
  const base = defaultProfile();
  if (!stored || typeof stored !== 'object') return ensureMissions(base);
  if (stored.epoch !== RESET_EPOCH) {
    // Neustart aller Spielstände: alles verwerfen, nur die Geräte-Einstellungen bleiben
    base.settings = sanitizeSettings(stored.settings);
    return ensureMissions(base);
  }

  const p = { ...base, ...stored };
  p.stats = { ...base.stats, ...(stored.stats || {}) };
  for (const k of Object.keys(base.stats)) p.stats[k] = Math.max(0, Math.floor(Number(p.stats[k]) || 0));
  p.settings = sanitizeSettings(stored.settings);
  // Wer schon gespielt hat, braucht kein Tutorial mehr
  p.tutorialDone = typeof stored.tutorialDone === 'boolean' ? stored.tutorialDone : Number(stored.stats && stored.stats.runs) > 0;
  const lp = stored.lastParty;
  p.lastParty = lp && typeof lp.code === 'string' && /^[A-Z0-9]{4,8}$/.test(lp.code) && Number.isFinite(lp.at) && Date.now() - lp.at < PARTY_MEMORY_MS
    ? { code: lp.code, at: lp.at }
    : null;
  p.colors = { ...base.colors, ...(stored.colors || {}) };
  p.campaign = sanitizeCampaign(stored.campaign);
  p.trophies = { gold: 0, silver: 0, bronze: 0 };
  for (const k of Object.keys(p.trophies)) p.trophies[k] = Math.max(0, Math.min(9999, Math.floor(Number(stored.trophies && stored.trophies[k]) || 0)));
  const applied = stored.weekly && Array.isArray(stored.weekly.applied) ? stored.weekly.applied : [];
  p.weekly = { applied: applied.filter((w) => typeof w === 'string' && w.length <= 40).slice(-40) };
  p.achievements = {};
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  const storedAch = stored.achievements && typeof stored.achievements === 'object' ? stored.achievements : {};
  for (const id of Object.keys(storedAch)) if (known.has(id) && storedAch[id]) p.achievements[id] = true;
  const st = stored.streak;
  p.streak = st && /^[0-9]{8}$/.test(String(st.last)) ? { last: String(st.last), count: Math.max(0, Math.floor(Number(st.count) || 0)) } : { ...base.streak };
  // Nur erlaubte Lackfarben übernehmen: die des Autos oder freigeschaltete Sonderlacke
  for (const car of CARS) if (!car.colors.includes(p.colors[car.id]) && !isColorUnlocked(p, p.colors[car.id])) p.colors[car.id] = car.colors[0];
  p.missionTier = { ...(stored.missionTier || {}) };
  p.tuning = sanitizeTuning(stored.tuning);
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
    epoch: RESET_EPOCH,
    coins: profile.coins,
    owned: [...profile.owned],
    tuning: sanitizeTuning(profile.tuning),
    selectedCar: profile.selectedCar,
    colors: { ...profile.colors },
    best: profile.best,
    stats: { ...profile.stats },
    missions: profile.missions.map((m) => ({ ...m })),
    missionTier: { ...profile.missionTier },
    streak: { ...profile.streak },
    achievements: { ...profile.achievements },
    campaign: sanitizeCampaign(profile.campaign),
    trophies: { ...profile.trophies },
    weekly: { applied: [...profile.weekly.applied] },
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
  // Cloud-Stände aus einer früheren Generation (vor einem Neustart aller Spielstände) werden nicht mehr übernommen
  if (!data || data.epoch !== RESET_EPOCH) return profile;
  const merged = normalize({
    ...data,
    epoch: RESET_EPOCH,
    name: profile.name,
    settings: profile.settings,
    online: profile.online,
    daily: profile.daily,
    tutorialDone: profile.tutorialDone,
    lastParty: profile.lastParty,
  });
  Object.assign(profile, merged);
  return profile;
}

// ---------------------------------------------------------------------------
// Erfolge, Tagesserie, Sonderlacke
// ---------------------------------------------------------------------------

/** Tagesschlüssel YYYYMMDD in UTC (derselbe Tag wie beim Tagesrennen). */
export function dayKeyOf(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Der Tag davor (YYYYMMDD). */
export function previousDayKey(key) {
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
  return dayKeyOf(new Date(t - 86400000));
}

/** Aktueller Wert einer Erfolgs-Kennzahl. */
export function metricValue(profile, metric) {
  const s = profile.stats;
  switch (metric) {
    case 'runs': return s.runs;
    case 'bestDistance': return profile.best;
    case 'nearMisses': return s.nearMisses;
    case 'smashed': return s.smashed;
    case 'overtakes': return s.overtakes;
    case 'totalCoins': return s.totalCoins;
    case 'owned': return profile.owned.length;
    case 'ownedBuyable': return profile.owned.filter((id) => !carById(id).exclusive).length;
    case 'bestLevel': return s.bestLevel;
    case 'bestStreak': return s.bestStreak;
    case 'dailyRuns': return s.dailyRuns;
    case 'rankedRuns': return s.rankedRuns;
    case 'tuningTotal': return Object.values(profile.tuning || {}).reduce((n, t) => n + TUNING.reduce((m, tr) => m + (t[tr.id] || 0), 0), 0);
    case 'tuningMaxCar': return Math.max(0, ...Object.values(profile.tuning || {}).map((t) => (TUNING.every((tr) => (t[tr.id] || 0) >= TUNING_MAX) ? TUNING.length * TUNING_MAX : 0)));
    case 'partyRaces': return s.partyRaces;
    case 'bestHard': return s.bestHard;
    case 'campaignStars': return totalStars(profile.campaign);
    case 'campaignMaps': return Object.keys(profile.campaign.stars).length;
    case 'campaignWorld1': return CAMPAIGN_MAPS.filter((m) => m.world === 0 && profile.campaign.stars[m.id]).length;
    case 'campaignLevel': return levelInfo(profile.campaign.xp).level;
    default: return 0;
  }
}

/** Ist dieser Sonderlack (Farbwert) freigeschaltet? */
export function isColorUnlocked(profile, color) {
  const key = Object.keys(SPECIAL_COLORS).find((k) => SPECIAL_COLORS[k].color === color);
  if (!key) return false;
  const trophy = SPECIAL_COLORS[key].trophy;
  if (trophy && profile.trophies && profile.trophies[trophy] > 0) return true;
  return ACHIEVEMENTS.some((a) => a.color === key && profile.achievements && profile.achievements[a.id]);
}

/** Alle freigeschalteten Sonderlacke: [{ key, name, color }]. */
export function unlockedColors(profile) {
  return Object.entries(SPECIAL_COLORS)
    .filter(([, def]) => isColorUnlocked(profile, def.color))
    .map(([key, def]) => ({ key, ...def }));
}

/**
 * Prüft alle Erfolge und schreibt die Belohnung gut.
 * @returns {{unlocked: Array<{id,name,text,reward,color?}>, coins: number}}
 */
export function checkAchievements(profile) {
  const unlocked = [];
  let coins = 0;
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements[a.id] || metricValue(profile, a.metric) < a.target) continue;
    profile.achievements[a.id] = true;
    profile.coins += a.reward;
    profile.stats.totalCoins += a.reward;
    coins += a.reward;
    unlocked.push({ ...a });
  }
  return { unlocked, coins };
}

/** Für die Anzeige: jeder Erfolg mit Fortschritt (0–1) und Status. */
export function achievementViews(profile) {
  return ACHIEVEMENTS.map((a) => {
    const value = metricValue(profile, a.metric);
    return {
      id: a.id,
      name: a.name,
      text: a.text,
      reward: a.reward,
      color: a.color ? { key: a.color, ...SPECIAL_COLORS[a.color] } : null,
      done: Boolean(profile.achievements[a.id]),
      progress: Math.min(1, value / a.target),
      value: Math.min(value, a.target),
      target: a.target,
    };
  });
}

/**
 * Tagesserie fortschreiben (einmal pro Tag). Gibt die Serie und den Bonus zurück;
 * bonus ist nur beim ersten Rennen eines neuen Tages größer als 0.
 */
export function updateStreak(profile, today = dayKeyOf()) {
  const s = profile.streak;
  if (s.last === today) return { count: s.count, bonus: 0, isNewDay: false };
  s.count = s.last && s.last === previousDayKey(today) ? s.count + 1 : 1;
  s.last = today;
  profile.stats.bestStreak = Math.max(profile.stats.bestStreak, s.count);
  return { count: s.count, bonus: streakBonus(s.count), isNewDay: true };
}

/**
 * Für die Anzeige: wie lang ist die Serie heute wirklich? (Eine Serie, die gestern nicht fortgesetzt wurde, ist gerissen.)
 * @returns {{count: number, playedToday: boolean, next: number}} next = Bonus für das nächste Rennen an einem neuen Tag
 */
export function streakView(profile, today = dayKeyOf()) {
  const s = profile.streak;
  const playedToday = s.last === today;
  const alive = playedToday || (s.last !== '' && s.last === previousDayKey(today));
  const count = alive ? s.count : 0;
  return { count, playedToday, next: streakBonus(count + 1) };
}

// ---------------------------------------------------------------------------
// Wochenwertung: Belohnungen gutschreiben
// ---------------------------------------------------------------------------

/**
 * Schreibt abgeholte Wochenbelohnungen gut. Jede Woche zählt nur einmal (weekly.applied), auch wenn der Server
 * sie mehrfach meldet (z. B. nach einem Abbruch vor der Bestätigung).
 * @param rewards [{ week: string (ISO), rank, score, coins, item: 'champion'|'silver'|'bronze'|null }]
 * @returns [{ week, rank, score, coins, item, bonus, newCar }] – nur die tatsächlich neu gutgeschriebenen
 */
export function applyWeeklyRewards(profile, rewards) {
  const done = [];
  for (const r of Array.isArray(rewards) ? rewards : []) {
    if (!r || typeof r !== 'object') continue;
    const week = String(r.week || '');
    if (!week || profile.weekly.applied.includes(week)) continue;
    const rank = Math.floor(Number(r.rank)) || 0;
    const coins = Math.max(0, Math.min(5000, Math.floor(Number(r.coins)) || 0));
    if (rank < 1) continue;
    let bonus = 0;
    let newCar = false;
    const item = WEEKLY_ITEMS[r.item] ? r.item : null;
    if (item === 'champion') {
      profile.trophies.gold += 1;
      if (profile.owned.includes('apex')) bonus = 1000; // Auto schon da → Extra-Münzen für jeden weiteren Sieg
      else { profile.owned.push('apex'); newCar = true; }
    } else if (item === 'silver') {
      profile.trophies.silver += 1;
    } else if (item === 'bronze') {
      profile.trophies.bronze += 1;
    }
    profile.coins += coins + bonus;
    profile.stats.totalCoins += coins + bonus;
    profile.weekly.applied.push(week);
    profile.weekly.applied = profile.weekly.applied.slice(-40);
    done.push({ week, rank, score: Math.floor(Number(r.score)) || 0, coins, item, bonus, newCar });
  }
  return done;
}

// ---------------------------------------------------------------------------
// Garage
// ---------------------------------------------------------------------------
export const selectedCarOf = (profile) => carById(profile.selectedCar);
export const colorOf = (profile, carId) => profile.colors[carId] || carById(carId).colors[0];

export function buyCar(profile, carId) {
  const car = carById(carId);
  if (car.exclusive) return { ok: false, error: 'Dieses Auto gibt es nur als Preis der Wochenwertung.' };
  if (profile.owned.includes(car.id)) return { ok: false, error: 'Schon in deiner Garage.' };
  if (profile.coins < car.price) {
    return { ok: false, error: `Dir fehlen noch ${(car.price - profile.coins).toLocaleString('de-DE')} Münzen.` };
  }
  profile.coins -= car.price;
  profile.owned.push(car.id);
  profile.selectedCar = car.id;
  return { ok: true };
}

/** Gekaufte Tuning-Stufen eines Autos: { nitro, handling, coins } (je 0–5). */
export function tuningOf(profile, carId) {
  const t = (profile.tuning && profile.tuning[carId]) || {};
  return Object.fromEntries(TUNING.map((tr) => [tr.id, Math.min(TUNING_MAX, Math.max(0, Math.floor(Number(t[tr.id]) || 0)))]));
}

/** Nächste Tuning-Stufe eines Werts kaufen (das Auto muss in der Garage stehen). */
export function buyTuning(profile, carId, trackId) {
  const track = TUNING.find((t) => t.id === trackId);
  if (!track || !profile.owned.includes(carId)) return { ok: false, error: 'Dieses Auto gehört dir noch nicht.' };
  const level = tuningOf(profile, carId)[trackId];
  const cost = tuningCost(level);
  if (cost === null) return { ok: false, error: 'Schon voll ausgebaut.' };
  if (profile.coins < cost) return { ok: false, error: `Dir fehlen noch ${(cost - profile.coins).toLocaleString('de-DE')} Münzen.` };
  profile.coins -= cost;
  profile.tuning = { ...(profile.tuning || {}), [carId]: { ...tuningOf(profile, carId), [trackId]: level + 1 } };
  return { ok: true, level: level + 1, cost };
}

/** Wandelt beliebige gespeicherte Tuning-Daten in { autoId: { nitro, handling, coins } } um (nur bekannte Autos, Stufen 0–5). */
export function sanitizeTuning(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const car of CARS) {
    const t = raw[car.id];
    if (!t || typeof t !== 'object') continue;
    const levels = Object.fromEntries(TUNING.map((tr) => [tr.id, Math.min(TUNING_MAX, Math.max(0, Math.floor(Number(t[tr.id]) || 0)))]));
    if (Object.values(levels).some((v) => v > 0)) out[car.id] = levels;
  }
  return out;
}

export function selectCar(profile, carId) {
  if (!profile.owned.includes(carId)) return false;
  profile.selectedCar = carId;
  return true;
}

export function setCarColor(profile, carId, color) {
  const car = carById(carId);
  if (!car.colors.includes(color) && !isColorUnlocked(profile, color)) return false;
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
  const tuned = tuningOf(profile, car.id);
  breakdown.perk = Math.round(subtotal * ((car.perk === 'coinBonus' ? 0.2 : 0) + tuned.coins * TUNING.find((t) => t.id === 'coins').per));

  // Statistiken
  const s = profile.stats;
  s.runs += 1;
  s.totalDistance += distance;
  s.nearMisses += run.nearMisses || 0;
  s.smashed += run.smashed || 0;
  s.overtakes += run.overtakes || 0;
  if (run.isPartyRace) s.partyRaces += 1;
  if (run.isDaily) s.dailyRuns += 1;
  if (run.isRanked) s.rankedRuns += 1;

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

  // Tagesserie: Bonus beim ersten Rennen eines Tages
  const streak = updateStreak(profile, run.dayKey || dayKeyOf());
  breakdown.streak = streak.bonus;

  s.bestLevel = Math.max(s.bestLevel, run.level || 0);
  if (run.mode === 'hard') s.bestHard = Math.max(s.bestHard, distance);

  let total = subtotal + breakdown.perk + breakdown.missions + breakdown.streak;
  profile.coins += total;
  s.totalCoins += total;

  const newBest = modeDef.ranked && distance > profile.best;
  if (newBest) profile.best = distance;

  // Erfolge nach den aktualisierten Zahlen prüfen; ihre Belohnung kommt oben drauf
  const achieved = checkAchievements(profile);
  breakdown.achievements = achieved.coins;
  total += achieved.coins;

  return {
    breakdown, total, completed, newBest, ranked: modeDef.ranked, mode: run.mode || 'normal',
    streak, achievements: achieved.unlocked,
  };
}
