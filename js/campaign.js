/*
 * campaign.js – Kampagne (Singleplayer): 20 feste Karten in den fünf Welten zum Freispielen und Grinden.
 *
 * Jede Karte hat
 *   - eine feste Strecke (immer derselbe Verkehr → man lernt sie kennen),
 *   - ein Ziel (Streckenlänge): Wer es erreicht, bekommt Stern 1,
 *   - zwei Zusatzaufgaben für Stern 2 und 3 (Münzen, Beinahe-Unfälle, Rammen, Nitro, Überholen).
 * Sterne und Erfahrung (XP) schalten neue Karten frei und zahlen Münzen. Alles läuft offline und wird im
 * Spielstand (und damit in der Cloud-Sicherung) gespeichert.
 *
 * Reine Logik ohne Oberfläche und ohne Three.js – gut testbar.
 */
import { WORLDS, WORLD_TIMES } from './config.js';
import { hashSeed } from './rng.js';

const MAPS_PER_WORLD = 4;

const MAP_NAMES = [
  ['Sonntagsfahrt', 'Windmühlenweg', 'Stoßzeit', 'Sonnenfinale'],
  ['Staubpiste', 'Kakteenpass', 'Felsenrennen', 'Abendrot'],
  ['Regenschauer', 'Leuchtreklame', 'Nachtschicht', 'Neon-Finale'],
  ['Schneeflocke', 'Eispass', 'Schneesturm', 'Gipfelrennen'],
  ['Aschepfad', 'Lavafluss', 'Glutmeer', 'Feuertaufe'],
];

/** Aufgaben-Arten: Beschriftung und wie man den Wert aus dem Rundenergebnis liest. */
export const OBJECTIVES = {
  coins:     { label: (n) => `Sammle ${n} Münzen`,            value: (r) => r.coinsCollected || 0 },
  near:      { label: (n) => `${n} Beinahe-Unfälle`,          value: (r) => r.nearMisses || 0 },
  smash:     { label: (n) => `Ramme ${n} Autos`,              value: (r) => r.smashed || 0 },
  nitro:     { label: (n) => `Zünde ${n}× Nitro`,             value: (r) => r.nitroUses || 0 },
  overtakes: { label: (n) => `Überhole ${n} Fahrzeuge`,       value: (r) => r.overtakes || 0 },
};

// Welche Aufgaben pro Kartennummer in der Welt (Stern 2, Stern 3)
const PATTERN = [
  ['coins', 'near'],
  ['overtakes', 'coins'],
  ['near', 'smash'],
  ['nitro', 'near'],
];

/** Zielwerte, abhängig von der Streckenlänge (Stern 3 ist jeweils deutlich schwerer). */
function target(type, goal, star) {
  const base = { coins: goal / 75, near: goal / 260, smash: goal / 700, nitro: goal / 1100, overtakes: goal / 55 }[type];
  const factor = star === 2 ? 1 : type === 'smash' || type === 'nitro' ? 1.6 : 1.7;
  return Math.max(2, Math.round((base * factor) / (type === 'coins' || type === 'overtakes' ? 5 : 1)) * (type === 'coins' || type === 'overtakes' ? 5 : 1));
}

function buildMaps() {
  const maps = [];
  WORLDS.forEach((world, w) => {
    for (let m = 0; m < MAPS_PER_WORLD; m++) {
      const index = w * MAPS_PER_WORLD + m;
      const t = index / (WORLDS.length * MAPS_PER_WORLD - 1);
      const goal = 1200 + 350 * index;
      const d0 = 0.02 + 0.55 * t;
      const d1 = Math.min(1, d0 + 0.22 + 0.06 * m);
      const [type2, type3] = PATTERN[m];
      const times = WORLD_TIMES[world.id] || ['default'];
      const id = `w${w + 1}m${m + 1}`;
      maps.push({
        id,
        index,
        world: w,
        worldName: world.name,
        number: m + 1,
        name: MAP_NAMES[w][m],
        seed: `campaign-${id}`,
        time: times[hashSeed(`campaign-time-${id}`) % times.length],
        goal,
        d0: +d0.toFixed(3),
        d1: +d1.toFixed(3),
        goals: [
          { star: 1, type: 'finish', target: goal, label: `Erreiche das Ziel (${goal.toLocaleString('de-DE')} m)` },
          { star: 2, type: type2, target: target(type2, goal, 2), label: OBJECTIVES[type2].label(target(type2, goal, 2)) },
          { star: 3, type: type3, target: target(type3, goal, 3), label: OBJECTIVES[type3].label(target(type3, goal, 3)) },
        ],
        // Belohnung beim ersten Mal je Stern (später kommt nichts mehr für denselben Stern)
        rewards: [40, 60, 90].map((c) => Math.round(c * (1 + w * 0.5))),
      });
    }
  });
  return maps;
}

export const CAMPAIGN_MAPS = buildMaps();
export const mapById = (id) => CAMPAIGN_MAPS.find((m) => m.id === id) || null;
export const nextMapOf = (map) => (map ? CAMPAIGN_MAPS[map.index + 1] || null : null);

// ---------------------------------------------------------------------------
// Stand des Spielers
// ---------------------------------------------------------------------------
export const defaultCampaign = () => ({ stars: {}, best: {}, xp: 0, finishes: 0 });

/** Bringt gespeicherte Kampagnendaten in eine gültige Form. */
export function sanitizeCampaign(raw) {
  const out = defaultCampaign();
  if (!raw || typeof raw !== 'object') return out;
  for (const map of CAMPAIGN_MAPS) {
    const s = Math.floor(Number(raw.stars && raw.stars[map.id]) || 0);
    if (s > 0) out.stars[map.id] = Math.min(3, s);
    const b = Math.floor(Number(raw.best && raw.best[map.id]) || 0);
    if (b > 0) out.best[map.id] = Math.min(map.goal * 2, b);
  }
  out.xp = Math.max(0, Math.floor(Number(raw.xp) || 0));
  out.finishes = Math.max(0, Math.floor(Number(raw.finishes) || 0));
  return out;
}

export const totalStars = (campaign) => Object.values(campaign.stars).reduce((a, b) => a + b, 0);
export const starsOf = (campaign, map) => campaign.stars[map.id] || 0;

/** Sterne, die man insgesamt für eine Karte braucht (Karte 1 ist offen). */
export const starsNeeded = (map) => Math.floor(map.index * 1.5);

/** Karte frei? Die vorherige muss geschafft sein und es müssen genug Sterne gesammelt sein. */
export function isMapUnlocked(campaign, map) {
  if (map.index === 0) return true;
  const prev = CAMPAIGN_MAPS[map.index - 1];
  return starsOf(campaign, prev) >= 1 && totalStars(campaign) >= starsNeeded(map);
}

/** Was fehlt noch? { needStars, needPrev } (leer = frei) */
export function unlockHint(campaign, map) {
  if (isMapUnlocked(campaign, map)) return null;
  const prev = CAMPAIGN_MAPS[map.index - 1];
  const needPrev = starsOf(campaign, prev) < 1 ? prev : null;
  const needStars = Math.max(0, starsNeeded(map) - totalStars(campaign));
  return { needPrev, needStars };
}

// ---------------------------------------------------------------------------
// Erfahrung und Stufe
// ---------------------------------------------------------------------------
/** XP, die man von Stufe l auf l+1 braucht. */
export const xpForNext = (level) => 100 + 50 * level;

export function levelInfo(xp) {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (left >= xpForNext(level)) {
    left -= xpForNext(level);
    level += 1;
  }
  return { level, into: left, need: xpForNext(level), frac: left / xpForNext(level) };
}

/** Münzen bei Erreichen einer neuen Stufe. */
export const levelReward = (level) => 50 * level;

// ---------------------------------------------------------------------------
// Auswertung einer Runde
// ---------------------------------------------------------------------------
/** Welche Sterne hat diese Runde gebracht? (Ohne Ziel keine Sterne.) */
export function evaluateMap(map, result) {
  const finished = Boolean(result && result.finished && result.mapId === map.id);
  const goals = map.goals.map((g) => {
    if (g.type === 'finish') return { ...g, value: Math.min(g.target, Math.floor((result && result.distance) || 0)), done: finished };
    const value = OBJECTIVES[g.type].value(result || {});
    return { ...g, value: Math.min(value, g.target), done: finished && value >= g.target };
  });
  const stars = goals.filter((g) => g.done).length;
  return { finished, stars, goals };
}

/**
 * Schreibt das Ergebnis in den Spielstand: Sterne (nur Verbesserungen), Münzen für neue Sterne, XP, Stufenaufstiege.
 * @returns {{ evaluation, newStars, coins, xp, levelUps: number[], levelCoins, unlockedNext: object|null, firstClear: boolean }}
 */
export function applyCampaignResult(profile, map, result) {
  const c = profile.campaign;
  const evaluation = evaluateMap(map, result);
  const before = starsOf(c, map);
  const after = Math.max(before, evaluation.stars);
  const wasUnlocked = nextMapOf(map) ? isMapUnlocked(c, nextMapOf(map)) : false;

  let coins = 0;
  for (let star = before + 1; star <= after; star++) coins += map.rewards[star - 1];
  if (after > 0) c.stars[map.id] = after;
  const distance = Math.floor((result && result.distance) || 0);
  if (distance > (c.best[map.id] || 0)) c.best[map.id] = Math.min(distance, map.goal * 2);

  let xp = 0;
  if (evaluation.finished) {
    c.finishes += 1;
    xp = Math.round(map.goal / (after > before ? 40 : 100)) + (after - before) * 30;
  } else {
    xp = Math.round(Math.min(distance, map.goal) / 400); // auch ein Fehlversuch bringt ein bisschen
  }
  const levelBefore = levelInfo(c.xp).level;
  c.xp += xp;
  const levelAfter = levelInfo(c.xp).level;
  const levelUps = [];
  let levelCoins = 0;
  for (let l = levelBefore + 1; l <= levelAfter; l++) {
    levelUps.push(l);
    levelCoins += levelReward(l);
  }

  const total = coins + levelCoins;
  profile.coins += total;
  profile.stats.totalCoins += total;

  const next = nextMapOf(map);
  return {
    evaluation,
    newStars: after - before,
    coins,
    xp,
    levelUps,
    levelCoins,
    unlockedNext: next && !wasUnlocked && isMapUnlocked(c, next) ? next : null,
    firstClear: before === 0 && after > 0,
  };
}
