/*
 * online.js – Online-Funktionen über Supabase: Ranglisten und Party-Modus.
 *
 * Aufbau:
 *  - Hilfsfunktionen für Party-Codes und Einladungslinks.
 *  - class Online: Datenbank-Funktionen (RPCs) mit 8-s-Timeout, deutschen
 *    Fehlermeldungen und einem Verbindungsstatus ('connecting' | 'online' | 'offline').
 *  - class Party: ein Realtime-Kanal pro Party-Code.
 *      Presence  → wer ist da (Name, Auto, Farbe, Rekord, Status, Beitrittszeit)
 *      Broadcast → 'pos' (Live-Position), 'race' (Rennstart), 'raceEnd' (Ergebnis),
 *                  'emote' (Schnell-Emotes)
 *
 * Grundregeln:
 *  - Keine Methode wirft Fehler nach außen. Probleme kommen als { error: 'Text' }
 *    zurück, zusätzlich mit code: 'network' | 'timeout' | 'auth' | 'rate' | 'invalid' | 'server'.
 *  - Alles, was andere Spieler senden, ist nicht vertrauenswürdig: Jede Nachricht
 *    wird geprüft und bereinigt, Ungültiges wird kommentarlos verworfen.
 *  - supabase-js wird erst bei Bedarf per dynamischem import() geladen (Import-Map),
 *    damit das Spiel auch ohne Internet bzw. ohne CDN startet.
 */
import { CARS, EMOTES } from './config.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------
const RPC_TIMEOUT_MS = 8000;          // Datenbank-Aufrufe brechen nach 8 s ab
const IMPORT_TIMEOUT_MS = 12000;      // Laden der Supabase-Bibliothek vom CDN
const RETRY_MIN_MS = 15000;           // offline: neuer Verbindungsversuch nach 15 s …
const RETRY_MAX_MS = 60000;           // … mit Verdopplung bis höchstens 60 s

const JOIN_TIMEOUT_MS = 10000;        // so lange warten wir auf den Party-Beitritt
const FIRST_SYNC_WAIT_MS = 1500;      // danach kurz auf die erste Mitgliederliste warten
const LEAVE_TIMEOUT_MS = 3000;        // Verlassen darf die UI nie lange blockieren
const REJOIN_ERROR_MS = 20000;        // so lange ohne Verbindung → Status 'error' + Neuaufbau
const REOPEN_MIN_MS = 1000;           // Neuaufbau eines geschlossenen Kanals: Backoff …
const REOPEN_MAX_MS = 15000;          // … bis höchstens 15 s

const PRESENCE_THROTTLE_MS = 500;     // Presence-Updates höchstens alle 0,5 s
const POS_MIN_INTERVAL_MS = 100;      // Positionen höchstens 10× pro Sekunde …
const POS_MAX_INTERVAL_MS = 500;      // … bei vielen gleichzeitigen Fahrern bis runter auf 2×/s
const POS_MSG_BUDGET = 90;            // angepeilte Realtime-Nachrichten pro Sekunde für die ganze Party
const POS_FLOOD_MS = 35;              // eingehend: schneller als ~28 Hz pro Sender wird verworfen
const STALE_MS = 5000;                // "fährt", aber > 5 s nichts gehört → als veraltet markieren
const STALE_CHECK_MS = 1000;
const EMOTE_COOLDOWN_MS = 600;        // eigene Emotes höchstens alle 0,6 s
const EMOTE_FLOOD_MS = 350;           // fremde Emotes pro Sender höchstens alle 0,35 s
const RACE_DELAY_MS = 5000;           // Countdown-Vorlauf eines Party-Rennens
const RACE_COOLDOWN_MS = 3000;        // Host kann nicht im Sekundentakt neue Rennen starten
const RACE_END_QUEUE_MS = 60000;      // verpasstes raceEnd wird nach Reconnect bis zu 60 s nachgereicht
const MAX_MEMBERS = 16;               // Schutz vor Presence-Flut
const MAX_REMEMBERED = 64;            // Größe der Merklisten (bekannte Spieler, gesehene Rennen)

const LEADERBOARD_LIMIT = 50;
const MAX_DISTANCE = 10_000_000;      // Plausibilitätsgrenzen für fremde Daten
const MAX_SPEED = 250;                // m/s
const MAX_X = 12;                     // m seitlich (die Straße ist ±7,2 m breit)
const MAX_LEVEL = 99;
const MAX_RUNS = 1_000_000_000;

const PARTY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1 (Verwechslungsgefahr)
const PARTY_CODE_LENGTH = 5;

// Formate laut Datenbank-Constraints (siehe SPEC §3.5)
const RE_PARTY = /^[A-Z0-9]{4,8}$/;
const RE_RACE = /^[A-Za-z0-9_-]{4,40}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;
const RE_ID = /^[A-Za-z0-9_-]{4,64}$/; // UUID aus der Datenbank oder lokale Gast-ID

// Unsichtbare bzw. steuernde Zeichen: C0/C1-Steuerzeichen, weiches Trennzeichen,
// Zero-Width-Zeichen, Zeilen-/Absatztrenner, Bidi-Overrides/-Isolates, BOM.
const RE_INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

const CAR_IDS = new Set(CARS.map((c) => c.id));
const MEMBER_STATUSES = new Set(['menu', 'garage', 'lobby', 'countdown', 'driving', 'crashed']);
const RUNNING_STATUSES = new Set(['countdown', 'driving']);
const DEFAULT_COLOR = '#95a0b3';

// Deutsche Fehlertexte für die UI
const MSG = {
  network: 'Keine Verbindung zum Server.',
  timeout: 'Der Server antwortet nicht – bitte später nochmal versuchen.',
  server: 'Serverfehler – bitte später nochmal versuchen.',
  denied: 'Der Server hat den Zugriff verweigert.',
  auth: 'Dein Online-Profil ist ungültig.',
  rate: 'Zu schnell hintereinander – bitte kurz warten.',
  invalid: 'Ungültige Eingabe.',
  nameTaken: 'Dieser Name ist schon vergeben.',
  unexpected: 'Unerwarteter Fehler.',
  badResponse: 'Unerwartete Antwort vom Server.',
  noIdentity: 'Kein Online-Profil vorhanden.',
  badParty: 'Ungültiger Party-Code.',
  noParty: 'Du bist in keiner Party.',
  partyJoin: 'Party konnte nicht betreten werden – bitte nochmal versuchen.',
  partyOffline: 'Du bist offline – Party nicht verfügbar.',
  notHost: 'Nur der Host kann das Rennen starten.',
  notConnected: 'Keine Verbindung zur Party.',
  raceCooldown: 'Das Rennen startet gerade …',
  badRace: 'Ungültige Renn-ID.',
  shortRun: 'Runde zu kurz für die Rangliste.',
  implausible: 'Ergebnis nicht plausibel – wird nicht gewertet.',
  unknownBoard: 'Unbekannte Rangliste.',
  nameMissing: 'Bitte gib einen Namen ein.',
  nameChars: 'Der Name darf kein < oder > enthalten.',
  nameShort: 'Der Name braucht mindestens 2 Zeichen.',
  nameLong: 'Der Name darf höchstens 16 Zeichen lang sein.',
};

// SQLSTATE-Codes, bei denen die Datenbank-Funktion selbst eine (deutsche) Meldung liefert
const RAISE_CODES = new Set(['P0001', '22023', '22000', '28000', '54000']);

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

/** Monotone Zeit in ms (gleiche Zeitachse wie requestAnimationFrame). */
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof ArrayBuffer);
/** Strikt: nur echte, endliche Zahlen (für Daten anderer Spieler – keine Umwandlung aus Strings). */
const strictNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const codePointLength = (s) => Array.from(s).length;
const failure = (code, message = MSG[code] || MSG.unexpected) => ({ error: message, code });

/** Zahl aus Datenbank-Zeilen (dort kommen Zahlen evtl. auch als String) → Ganzzahl im Bereich. */
function toInt(v, min, max, fallback) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : fallback;
}
function toNum(v, min, max, fallback) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function cleanId(v) {
  return typeof v === 'string' && RE_ID.test(v) ? v : null;
}
/** Nur bekannte Auto-IDs durchlassen (cars.js baut nur diese Modelle). */
function cleanCar(v) {
  return typeof v === 'string' && CAR_IDS.has(v) ? v : CARS[0].id;
}
function cleanColor(v, fallback = DEFAULT_COLOR) {
  return typeof v === 'string' && RE_COLOR.test(v) ? v : fallback;
}

/**
 * Bereinigt einen fremden Namen für die Anzeige: unsichtbare Zeichen und < > raus,
 * Leerraum zusammenfassen, auf 16 Zeichen kürzen. Leerer Rest → Ersatzname.
 */
function cleanName(v, fallback = 'Fahrer') {
  if (typeof v !== 'string') return fallback;
  let s = v.length > 200 ? v.slice(0, 200) : v; // Schutz vor Riesen-Strings
  s = s.replace(RE_INVISIBLE, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  if (chars.length > 16) s = chars.slice(0, 16).join('').trim();
  return s || fallback;
}

/** Zufallsbytes – kryptografisch, wenn verfügbar. */
function randomBytes(n) {
  const bytes = new Uint8Array(n);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}
function randomUint32() {
  const b = randomBytes(4);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}
function guestId() {
  let s = 'gast-';
  for (const b of randomBytes(8)) s += b.toString(36).padStart(2, '0');
  return s;
}

/** Wartet höchstens `ms` auf ein Promise; danach (oder bei Fehler) kommt `fallback`. */
function withTimeout(promise, ms, fallback = null) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

/** Merkt sich einen Schlüssel in einer begrenzten Menge (älteste Einträge fliegen raus). */
function remember(set, key) {
  if (set.size >= MAX_REMEMBERED) set.delete(set.values().next().value);
  set.add(key);
}

function firstRow(data) {
  if (Array.isArray(data)) return isObj(data[0]) ? data[0] : null;
  return isObj(data) ? data : null;
}

/** Klingt die Server-Meldung nach Klartext für Menschen (und nicht nach SQL-Interna)? */
function isHumanMessage(msg) {
  return msg.length > 0 && msg.length <= 120 &&
    !/["_{}]|relation|constraint|function|column|violates|schema|syntax|null value|permission|duplicate key|jwt|pgrst|invalid input/i.test(msg);
}

/** Übersetzt einen PostgREST-Fehler in { error, code } mit deutscher Meldung. */
function classifyError(error, httpStatus) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const human = RAISE_CODES.has(code) && isHumanMessage(message);

  if (!httpStatus || /AbortError|FetchError|Failed to fetch|NetworkError|Load failed|TypeError/i.test(message)) {
    return failure('network');
  }
  if (code === '28000') return failure('auth', human ? message : MSG.auth);
  if (httpStatus === 429 || /zu schnell|zu viele|zu oft|warte|rate limit|too many/i.test(message)) {
    return failure('rate', human ? message : MSG.rate);
  }
  if (httpStatus === 401 || code === '42501') return failure('server', MSG.denied);
  if (code === '23505') return failure('invalid', MSG.nameTaken);
  if (human) return failure('invalid', message);
  if (httpStatus === 400 || httpStatus === 409 || code.startsWith('22') || code.startsWith('23')) {
    return failure('invalid', MSG.invalid);
  }
  return failure('server');
}

function unexpected(err) {
  console.warn('[online] Unerwarteter Fehler:', err);
  return failure('server', MSG.unexpected);
}

// ---------------------------------------------------------------------------
// Party-Codes und Links
// ---------------------------------------------------------------------------

/** Neuer Party-Code: 5 Zeichen aus einem verwechslungsarmen Alphabet. */
export function generatePartyCode() {
  const bytes = randomBytes(PARTY_CODE_LENGTH);
  let code = '';
  // 256 ist durch 32 teilbar → keine Modulo-Verzerrung
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) code += PARTY_ALPHABET[bytes[i] % PARTY_ALPHABET.length];
  return code;
}

/**
 * Macht aus einer Eingabe einen gültigen Party-Code (Großbuchstaben, nur A–Z/0–9,
 * 4–8 Zeichen) oder null. Ein eingefügter kompletter Einladungslink funktioniert auch.
 */
export function normalizePartyCode(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return null;
  let s = String(str).slice(0, 300);
  const fromLink = s.match(/[?&#]party=([^&#\s]+)/i);
  if (fromLink) s = fromLink[1];
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return RE_PARTY.test(s) ? s : null;
}

/** Liest ?party=XXXX aus der aktuellen Adresse (normalisiert) oder null. */
export function partyCodeFromUrl() {
  try {
    if (typeof location === 'undefined') return null;
    const raw = new URLSearchParams(location.search).get('party');
    return raw ? normalizePartyCode(raw) : null;
  } catch {
    return null;
  }
}

/** Einladungslink zum Teilen: aktuelle Seite + ?party=CODE. */
export function partyShareUrl(code) {
  const c = normalizePartyCode(code) || '';
  try {
    return location.origin + location.pathname + '?party=' + c;
  } catch {
    return '?party=' + c;
  }
}

/**
 * Prüft einen selbst eingegebenen Namen nach den Server-Regeln
 * (2–16 Zeichen, keine < > und keine Steuerzeichen).
 * @returns {{ name: string } | { error: string }}
 */
export function validateName(input) {
  if (typeof input !== 'string') return { error: MSG.nameMissing };
  const name = input.slice(0, 200).replace(RE_INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: MSG.nameMissing };
  if (/[<>]/.test(name)) return { error: MSG.nameChars };
  const len = codePointLength(name);
  if (len < 2) return { error: MSG.nameShort };
  if (len > 16) return { error: MSG.nameLong };
  return { name };
}

// ---------------------------------------------------------------------------
// Mini-Eventsystem
// ---------------------------------------------------------------------------
class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(event, arg) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      // Ein Fehler im Handler des Spiels darf die Netzwerklogik nicht aus dem Tritt bringen
      try {
        fn(arg);
      } catch (err) {
        console.error(`[online] Fehler im '${event}'-Handler:`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Online: Datenbank-Zugriff + Verbindungsstatus
// ---------------------------------------------------------------------------
export class Online {
  /** @param {{ url: string, key: string }} options – SUPABASE aus config.js (Publishable Key) */
  constructor({ url, key } = {}) {
    this._url = typeof url === 'string' ? url.trim() : '';
    this._key = typeof key === 'string' ? key.trim() : '';
    this._client = null;
    this._clientPromise = null;
    this._status = 'connecting';
    this._statusFns = new Set();
    this._pingPromise = null;
    this._retryTimer = null;
    this._retryDelay = RETRY_MIN_MS;
    this._party = null;
    this._joinChain = Promise.resolve();

    // Meldet der Browser einen Netzwechsel, reagieren wir sofort statt auf den Timer zu warten
    this._handleBrowserOnline = () => this._ping();
    this._handleBrowserOffline = () => this._setStatus('offline');
    try {
      window.addEventListener('online', this._handleBrowserOnline);
      window.addEventListener('offline', this._handleBrowserOffline);
    } catch {
      /* kein Browser (z. B. Test in Node) */
    }
  }

  /**
   * Lädt supabase-js, erstellt den Client und prüft die Erreichbarkeit.
   * Darf erneut aufgerufen werden (z. B. "Nochmal versuchen").
   * @returns {Promise<boolean>} true = Server erreichbar
   */
  async init() {
    try {
      if (!this._url || !this._key) {
        this._setStatus('offline', false);
        return false;
      }
      if (this._status !== 'online') this._setStatus('connecting');
      return await this._ping();
    } catch (err) {
      console.warn('[online] init fehlgeschlagen:', err);
      this._setStatus('offline');
      return false;
    }
  }

  /** 'connecting' | 'online' | 'offline' */
  get status() {
    return this._status;
  }

  /** Aktive Party (oder null). */
  get party() {
    return this._party && !this._party._leaving ? this._party : null;
  }

  /**
   * Status-Änderungen abonnieren. Wird nur bei Änderungen aufgerufen (nicht sofort).
   * @returns {() => void} Abmelden
   */
  onStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    this._statusFns.add(fn);
    return () => this._statusFns.delete(fn);
  }

  /**
   * Legt ein Online-Profil an.
   * @returns {Promise<{ id: string, secret: string, name: string } | { error: string, code: string }>}
   */
  async register(name, car, color) {
    try {
      const v = validateName(name);
      if (v.error) return failure('invalid', v.error);
      const carId = cleanCar(car);
      const res = await this._rpc('register_player', {
        p_name: v.name,
        p_car: carId,
        p_color: cleanColor(color, CARS.find((c) => c.id === carId).colors[0]),
      });
      if (res.error) return res;
      const row = firstRow(res.data);
      const id = cleanId(row?.id);
      const secret = typeof row?.secret === 'string' && row.secret.length > 0 ? row.secret : null;
      if (!id || !secret) return failure('server', MSG.badResponse);
      return { id, secret, name: v.name };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Ändert Name/Auto/Farbe des Online-Profils.
   * @param identity { id, secret }
   * @returns {Promise<{ ok: true } | { error: string, code: string }>}
   */
  async updatePlayer(identity, { name, car, color } = {}) {
    try {
      if (!validIdentity(identity)) return failure('auth', MSG.noIdentity);
      const v = validateName(name);
      if (v.error) return failure('invalid', v.error);
      const carId = cleanCar(car);
      const res = await this._rpc('update_player', {
        p_player: identity.id,
        p_secret: identity.secret,
        p_name: v.name,
        p_car: carId,
        p_color: cleanColor(color, CARS.find((c) => c.id === carId).colors[0]),
      });
      if (res.error) return res;
      return { ok: true };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Reicht eine Runde für die Rangliste ein.
   * @param run { score, duration, coins, nearMisses, overtakes, smashed, level, car, party, raceId }
   * @returns {Promise<{ rank: number|null, best: number, isRecord: boolean } | { error: string, code: string }>}
   */
  async submitScore(identity, run) {
    try {
      if (!validIdentity(identity)) return failure('auth', MSG.noIdentity);
      if (!isObj(run)) return failure('invalid');
      const score = toInt(run.score, 0, MAX_DISTANCE, 0);
      const duration = Math.round(toNum(run.duration, 0, 86400, 0) * 100) / 100;
      // Dieselben Regeln wie auf dem Server – spart eine sinnlose Anfrage
      if (duration < 1) return failure('invalid', MSG.shortRun);
      if (score > duration * 170 + 50) return failure('invalid', MSG.implausible);
      const raceId = typeof run.raceId === 'string' && RE_RACE.test(run.raceId) ? run.raceId : null;

      const res = await this._rpc('submit_score', {
        p_player: identity.id,
        p_secret: identity.secret,
        p_score: score,
        p_duration: duration,
        p_coins: toInt(run.coins, 0, MAX_DISTANCE, 0),
        p_near: toInt(run.nearMisses, 0, MAX_DISTANCE, 0),
        p_overtakes: toInt(run.overtakes, 0, MAX_DISTANCE, 0),
        p_smashed: toInt(run.smashed, 0, MAX_DISTANCE, 0),
        p_level: toInt(run.level, 1, MAX_LEVEL, 1),
        p_car: cleanCar(run.car),
        p_party: normalizePartyCode(run.party),
        p_race: raceId,
      });
      if (res.error) return res;
      const row = firstRow(res.data);
      if (!row) return failure('server', MSG.badResponse);
      return {
        rank: toInt(row.rank, 1, MAX_RUNS, null),
        best: toInt(row.best, 0, MAX_DISTANCE, score),
        isRecord: row.is_record === true,
      };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Rangliste laden.
   * @param kind 'global' | 'weekly' | 'party'
   * @param partyCode nur für 'party'
   * @param limit optional, Standard 50
   * @returns {Promise<{ rows: Array<{ rank, player_id, id, name, car, color, best, runs }> } | { error, code }>}
   */
  async leaderboard(kind, partyCode, limit = LEADERBOARD_LIMIT) {
    try {
      const pLimit = toInt(limit, 1, 200, LEADERBOARD_LIMIT);
      let res;
      if (kind === 'global') res = await this._rpc('leaderboard_global', { p_limit: pLimit });
      else if (kind === 'weekly') res = await this._rpc('leaderboard_weekly', { p_limit: pLimit });
      else if (kind === 'party') {
        const code = normalizePartyCode(partyCode);
        if (!code) return failure('invalid', MSG.noParty);
        res = await this._rpc('leaderboard_party', { p_party: code, p_limit: pLimit });
      } else {
        return failure('invalid', MSG.unknownBoard);
      }
      if (res.error) return res;
      return { rows: sanitizeBoardRows(res.data, pLimit) };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Ergebnisse eines Party-Rennens (sortiert nach Score, bester Lauf pro Spieler).
   * @returns {Promise<{ rows: Array<{ rank, player_id, id, name, car, color, score, duration, created_at }> } | { error, code }>}
   */
  async raceResults(raceId) {
    try {
      if (typeof raceId !== 'string' || !RE_RACE.test(raceId)) return failure('invalid', MSG.badRace);
      const res = await this._rpc('race_results', { p_race: raceId });
      if (res.error) return res;
      return { rows: sanitizeRaceRows(res.data) };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Party beitreten (bzw. eine neue Party unter diesem Code eröffnen – das ist dasselbe).
   * Löst erst auf, wenn der Kanal verbunden ist und die erste Mitgliederliste da ist.
   * @param me { id, name, car, color, best } (optional status)
   * @returns {Promise<Party | { error: string, code: string }>}
   */
  joinParty(code, me) {
    // Beitritte nacheinander abarbeiten: zwei gleichzeitige Beitritte (Doppelklick, Link + Button)
    // würden sich sonst gegenseitig den Kanal wegräumen.
    const run = () => this._joinParty(code, me);
    const result = this._joinChain.then(run, run);
    this._joinChain = result.catch(() => {});
    return result;
  }

  async _joinParty(code, me) {
    try {
      const c = normalizePartyCode(code);
      if (!c) return failure('invalid', MSG.badParty);

      // Nur eine Party gleichzeitig. Gleicher Code nochmal → bestehende Party zurückgeben.
      if (this._party && !this._party._leaving) {
        if (this._party.code === c) {
          if (isObj(me)) this._party.updateMe(me);
          return this._party;
        }
        await this._party.leave();
      }

      const client = await this._loadClient();
      if (!client) {
        this._setStatus('offline');
        return failure('network');
      }
      const party = new Party(this, client, c, me);
      const result = await party._start();
      if (result.error) return result;
      this._party = party;
      return party;
    } catch (err) {
      return unexpected(err);
    }
  }

  /** Aufräumen (Listener, Timer, Party). Normalerweise nicht nötig. */
  async dispose() {
    try {
      window.removeEventListener('online', this._handleBrowserOnline);
      window.removeEventListener('offline', this._handleBrowserOffline);
    } catch {
      /* kein Browser */
    }
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._statusFns.clear();
    if (this._party) await this._party.leave();
  }

  // --- intern ----------------------------------------------------------------

  /** supabase-js laden und Client erstellen (einmalig; nach Fehlschlag erneut versuchbar). */
  _loadClient() {
    if (this._client) return Promise.resolve(this._client);
    if (!this._url || !this._key) return Promise.resolve(null);
    if (!this._clientPromise) {
      this._clientPromise = import('@supabase/supabase-js')
        .then((mod) => {
          const createClient = mod.createClient || mod.default?.createClient;
          if (typeof createClient !== 'function') throw new Error('createClient fehlt');
          this._client = createClient(this._url, this._key, {
            // Wir nutzen kein Supabase-Login: keine Sitzung speichern, nichts aus der URL lesen
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
          return this._client;
        })
        .catch((err) => {
          console.warn('[online] Supabase konnte nicht geladen werden:', err);
          this._clientPromise = null; // nächster Versuch lädt neu
          return null;
        });
    }
    // Hängt das CDN, wird die Anfrage nicht blockiert – der Import läuft im Hintergrund weiter
    return withTimeout(this._clientPromise, IMPORT_TIMEOUT_MS, null);
  }

  /**
   * Ruft eine Datenbank-Funktion auf. Nie ein throw; Ergebnis ist { data } oder { error, code }.
   * Setzt nebenbei den Verbindungsstatus.
   */
  async _rpc(fn, args) {
    let timer = null;
    try {
      const client = await this._loadClient();
      if (!client) {
        this._setStatus('offline');
        return failure('network');
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const TIMEOUT = Symbol('timeout');
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          try {
            controller?.abort();
          } catch {
            /* egal */
          }
          resolve(TIMEOUT);
        }, RPC_TIMEOUT_MS);
      });
      let query = client.rpc(fn, args);
      if (controller && typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);

      const res = await Promise.race([query, timeout]);
      if (res === TIMEOUT) {
        this._setStatus('offline');
        return failure('timeout');
      }
      if (!isObj(res)) {
        this._setStatus('online');
        return failure('server', MSG.badResponse);
      }
      if (res.error) {
        const err = classifyError(res.error, res.status);
        this._setStatus(err.code === 'network' ? 'offline' : 'online');
        if (err.code === 'server') console.warn(`[online] ${fn}:`, res.error);
        return err;
      }
      this._setStatus('online');
      return { data: res.data };
    } catch (err) {
      console.warn(`[online] ${fn} fehlgeschlagen:`, err);
      this._setStatus('offline');
      return failure('network');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Leichter Erreichbarkeitstest (eine Zeile der Rangliste). */
  _ping() {
    if (!this._pingPromise) {
      this._pingPromise = this._rpc('leaderboard_global', { p_limit: 1 })
        .then((res) => !res.error || (res.code !== 'network' && res.code !== 'timeout'))
        .catch(() => false)
        .finally(() => {
          this._pingPromise = null;
        });
    }
    return this._pingPromise;
  }

  _setStatus(status, retry = true) {
    if (status === 'online') {
      this._retryDelay = RETRY_MIN_MS;
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    } else if (status === 'offline' && retry && this._url && this._key) {
      this._scheduleRetry();
    }
    if (status === this._status) return;
    this._status = status;
    for (const fn of this._statusFns) {
      try {
        fn(status);
      } catch (err) {
        console.error('[online] Fehler im Status-Handler:', err);
      }
    }
  }

  /** Offline: in wachsenden Abständen erneut prüfen, damit die Anzeige von selbst wieder "online" wird. */
  _scheduleRetry() {
    if (this._retryTimer) return;
    const delay = this._retryDelay;
    this._retryDelay = Math.min(RETRY_MAX_MS, delay * 2);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._ping();
    }, delay);
  }
}

function validIdentity(identity) {
  return isObj(identity) && cleanId(identity.id) !== null &&
    typeof identity.secret === 'string' && identity.secret.length > 0 && identity.secret.length <= 200;
}

/** Ranglisten-Zeilen prüfen; Feldnamen wie in der Datenbank + Alias id + Platz. */
function sanitizeBoardRows(data, limit) {
  if (!Array.isArray(data)) return [];
  const rows = [];
  for (const r of data.slice(0, limit)) {
    if (!isObj(r)) continue;
    const id = cleanId(r.player_id);
    if (!id) continue;
    rows.push({
      rank: 0,
      player_id: id,
      id,
      name: cleanName(r.name),
      car: cleanCar(r.car),
      color: cleanColor(r.color),
      best: toInt(r.best, 0, MAX_DISTANCE, 0),
      runs: toInt(r.runs, 0, MAX_RUNS, 0),
    });
  }
  rows.sort((a, b) => b.best - a.best); // stabil: Server-Reihenfolge bei Gleichstand bleibt
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

function sanitizeRaceRows(data) {
  if (!Array.isArray(data)) return [];
  const best = new Map(); // pro Spieler nur der beste Lauf
  for (const r of data.slice(0, 200)) {
    if (!isObj(r)) continue;
    const id = cleanId(r.player_id);
    if (!id) continue;
    const row = {
      rank: 0,
      player_id: id,
      id,
      name: cleanName(r.name),
      car: cleanCar(r.car),
      color: cleanColor(r.color),
      score: toInt(r.score, 0, MAX_DISTANCE, 0),
      duration: Math.round(toNum(r.duration, 0, 86400, 0) * 100) / 100,
      created_at: typeof r.created_at === 'string' ? r.created_at.slice(0, 40) : null,
    };
    const prev = best.get(id);
    if (!prev || row.score > prev.score) best.set(id, row);
  }
  const rows = [...best.values()];
  rows.sort((a, b) => b.score - a.score || String(a.created_at).localeCompare(String(b.created_at)));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Party: Realtime-Kanal mit Presence + Broadcast
// ---------------------------------------------------------------------------

/** Neuer Mitglieds-Datensatz (wird über die Lebenszeit der Party wiederverwendet). */
function makeMember(p, isMe) {
  return {
    id: p.id,
    name: p.name,
    car: p.car,
    color: p.color,
    best: p.best,
    status: p.status,
    joinedAt: p.joinedAt,
    isHost: false,
    isMe,
    // Live-Werte (aus 'pos'-Nachrichten bzw. eigenem sendState)
    distance: 0,
    x: 0,
    speed: 0,
    level: 1,
    alive: true,
    nitro: false,
    lastSeen: now(),
    stale: false,
  };
}

function resetLive(m) {
  m.distance = 0;
  m.x = 0;
  m.speed = 0;
  m.level = 1;
  m.alive = true;
  m.nitro = false;
  m.stale = false;
}

/** Presence-Eintrag eines anderen Spielers prüfen. Der Presence-Key muss zur id passen. */
function sanitizePresence(key, raw) {
  if (!isObj(raw)) return null;
  const id = cleanId(key);
  if (!id || raw.id !== id) return null;
  const joinedAt = strictNum(raw.joinedAt);
  return {
    id,
    name: cleanName(raw.name),
    car: cleanCar(raw.car),
    color: cleanColor(raw.color),
    best: clamp(Math.round(strictNum(raw.best) ?? 0), 0, MAX_DISTANCE),
    status: typeof raw.status === 'string' && MEMBER_STATUSES.has(raw.status) ? raw.status : 'menu',
    // Ungültige Beitrittszeit → ganz hinten einsortieren (kann so nie Host werden)
    joinedAt: joinedAt !== null && joinedAt > 1e12 && joinedAt < 1e13 ? joinedAt : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Eine Party. Wird nur von Online.joinParty() erzeugt.
 *
 * Öffentliche Felder: code, shareUrl
 * Events (on): 'members' | 'state' | 'race' | 'raceEnd' | 'emote' | 'status'
 */
class Party {
  constructor(online, client, code, me) {
    this.code = code;
    this.shareUrl = partyShareUrl(code);

    this._online = online;
    this._client = client;
    this._topic = 'party-' + code;
    this._events = new Emitter();

    const src = isObj(me) ? me : {};
    const id = cleanId(src.id) || guestId();
    this._me = makeMember({
      id,
      name: cleanName(src.name),
      car: cleanCar(src.car),
      color: cleanColor(src.color, CARS[0].colors[0]),
      best: toInt(src.best, 0, MAX_DISTANCE, 0),
      status: MEMBER_STATUSES.has(src.status) ? src.status : 'menu',
      joinedAt: Date.now(), // bleibt auch bei Reconnects gleich → Host wechselt nicht grundlos
    }, true);

    this._others = new Map();   // id → Mitglied (nur andere Spieler)
    this._meta = new Map();     // id → { seq, lastPosAt, statusSince, lastEmoteAt } (intern)
    this._known = new Map();    // id → { name, car, color } – auch nach dem Verlassen (für raceEnd)
    this._members = [this._me]; // zwischengespeicherte, sortierte Liste inkl. mir
    this._hostId = id;
    this._activeSenders = 1;

    this._channel = null;
    this._gen = 0;              // Generation des Kanals: Callbacks alter Kanäle werden ignoriert
    this._joined = false;
    this._everJoined = false;
    this._synced = false;
    this._leaving = false;
    this._leavePromise = null;
    this._connection = 'joining';
    this._reopenDelay = REOPEN_MIN_MS;
    this._reopening = false;

    this._lastTrackAt = -Infinity;
    this._lastPosAt = -Infinity;
    this._lastSentAlive = true;
    this._posSeq = 0;
    this._lastRaceAt = 0;
    this._lastEmoteAt = -Infinity;
    this._pendingRaceEnd = null;
    this._seenRaces = new Set();
    this._raceEnds = new Set();

    this._trackTimer = null;
    this._posTimer = null;
    this._staleTimer = null;
    this._rejoinWatchdog = null;
    this._reopenTimer = null;
    this._joinWaiter = null;
    this._syncWaiter = null;

    // Tab wieder sichtbar und Verbindung weg → sofort neu aufbauen statt auf Timer zu warten
    this._handleVisibility = () => {
      if (!this._leaving && !this._joined && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this._reopen();
      }
    };

    this._rebuildMembers(); // setzt isHost für mich, solange noch niemand anderes bekannt ist
  }

  // --- öffentliche API --------------------------------------------------------

  /**
   * Alle Mitglieder inkl. mir, sortiert nach Beitritt (Host zuerst). Die Objekte sind
   * Live-Datensätze, die laufend aktualisiert werden – bitte nur lesen, nicht verändern.
   * Felder: id, name, car, color, best, status, joinedAt, isHost, isMe,
   *         distance, x, speed, level, alive, nitro, lastSeen, stale
   */
  get members() {
    return this._members;
  }

  /** Bin ich Host? Host = kleinste joinedAt (bei Gleichstand kleinste id) – überall gleich berechnet. */
  get isHost() {
    return this._hostId === this._me.id;
  }

  /** Verbindungszustand: 'joining' | 'joined' | 'reconnecting' | 'error' | 'left' */
  get connection() {
    return this._connection;
  }

  /** @returns {() => void} Abmelden */
  on(event, fn) {
    return this._events.on(event, fn);
  }

  /** Eigener Status ('menu'|'garage'|'lobby'|'countdown'|'driving'|'crashed') → Presence (gedrosselt). */
  setStatus(status) {
    try {
      if (this._leaving || !MEMBER_STATUSES.has(status) || this._me.status === status) return;
      if (RUNNING_STATUSES.has(status) && !RUNNING_STATUSES.has(this._me.status)) {
        resetLive(this._me);
        this._lastSentAlive = true;
      }
      this._me.status = status;
      this._countActiveSenders();
      this._scheduleTrack();
      this._emitMembers();
    } catch (err) {
      console.warn('[online] setStatus:', err);
    }
  }

  /** Name/Auto/Farbe/Rekord geändert → Presence (gedrosselt). */
  updateMe(partial) {
    try {
      if (this._leaving || !isObj(partial)) return;
      const m = this._me;
      if (partial.name !== undefined) m.name = cleanName(partial.name, m.name);
      if (partial.car !== undefined) m.car = cleanCar(partial.car);
      if (partial.color !== undefined) m.color = cleanColor(partial.color, m.color);
      if (partial.best !== undefined) m.best = toInt(partial.best, 0, MAX_DISTANCE, m.best);
      this._scheduleTrack();
      this._emitMembers();
    } catch (err) {
      console.warn('[online] updateMe:', err);
    }
  }

  /**
   * Eigene Live-Position (jeden Frame aufrufen ist ok): { distance, x, speed, level, alive, nitro }.
   * nitro = true, solange Nitro aktiv ist. Gesendet wird höchstens 10×/s – bei vielen
   * gleichzeitigen Fahrern automatisch seltener (Nachrichten-Budget), ein Crash sofort.
   */
  sendState(state) {
    try {
      if (this._leaving || !isObj(state)) return;
      const m = this._me;
      m.distance = toNum(state.distance, 0, MAX_DISTANCE, m.distance);
      m.x = toNum(state.x, -MAX_X, MAX_X, m.x);
      m.speed = toNum(state.speed, 0, MAX_SPEED, m.speed);
      m.level = toInt(state.level, 1, MAX_LEVEL, m.level);
      m.nitro = state.nitro === true;
      const alive = state.alive !== false;
      const aliveChanged = alive !== m.alive;
      m.alive = alive;
      const t = now();
      m.lastSeen = t;
      if (aliveChanged) this._emitMembers();

      const interval = this._posInterval();
      const since = t - this._lastPosAt;
      if (alive !== this._lastSentAlive || since >= interval) {
        this._flushPos();
      } else if (!this._posTimer) {
        // Nachzügler-Timer: der letzte Stand geht garantiert raus, auch wenn danach nichts mehr kommt
        this._posTimer = setTimeout(() => {
          this._posTimer = null;
          this._flushPos();
        }, interval - since);
      }
    } catch (err) {
      console.warn('[online] sendState:', err);
    }
  }

  /**
   * Host startet ein Rennen: alle bekommen dieselbe raceId + denselben Seed.
   * Das 'race'-Event feuert auch lokal beim Host.
   * @returns {{ raceId, seed, delayMs, hostId } | { error: string, code: string }}
   */
  startRace() {
    try {
      if (this._leaving) return failure('invalid', MSG.noParty);
      if (!this.isHost) return failure('invalid', MSG.notHost);
      if (!this._canBroadcast()) return failure('network', MSG.notConnected);
      const t = Date.now();
      if (t - this._lastRaceAt < RACE_COOLDOWN_MS) return failure('rate', MSG.raceCooldown);
      this._lastRaceAt = t;

      const race = {
        raceId: this.code + '-' + t.toString(36),
        seed: randomUint32(),
        delayMs: RACE_DELAY_MS,
        hostId: this._me.id,
      };
      remember(this._seenRaces, race.raceId);
      this._broadcast('race', race);
      this._events.emit('race', { ...race });
      return race;
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Eigenes Rennergebnis an die anderen melden (bei Crash). Feuert NICHT lokal.
   * Ohne Verbindung wird es nach dem Wiederverbinden nachgereicht (bis 60 s).
   * @returns {{ ok: true } | { error: string, code: string }}
   */
  sendRaceEnd(raceId, score) {
    try {
      if (this._leaving) return failure('invalid', MSG.noParty);
      if (typeof raceId !== 'string' || !RE_RACE.test(raceId)) return failure('invalid', MSG.badRace);
      const payload = { id: this._me.id, raceId, score: toInt(score, 0, MAX_DISTANCE, 0) };
      if (this._broadcast('raceEnd', payload)) this._pendingRaceEnd = null;
      else this._pendingRaceEnd = { payload, at: now() };
      return { ok: true };
    } catch (err) {
      return unexpected(err);
    }
  }

  /**
   * Schnell-Emote (nur Emojis aus EMOTES). Feuert auch lokal ('emote' mit isMe: true).
   * @returns {boolean} false bei ungültigem Emoji oder zu schnellem Wiederholen
   */
  sendEmote(emoji) {
    try {
      if (this._leaving || !EMOTES.includes(emoji)) return false;
      const t = now();
      if (t - this._lastEmoteAt < EMOTE_COOLDOWN_MS) return false;
      this._lastEmoteAt = t;
      const me = this._me;
      this._broadcast('emote', { id: me.id, emoji });
      this._events.emit('emote', { id: me.id, emoji, name: me.name, color: me.color, isMe: true });
      return true;
    } catch (err) {
      console.warn('[online] sendEmote:', err);
      return false;
    }
  }

  /** Party verlassen: Kanal abmelden, Timer stoppen, 'status' → 'left'. Mehrfachaufruf ist ok. */
  leave() {
    if (this._leavePromise) return this._leavePromise;
    this._leavePromise = (async () => {
      try {
        this._leaving = true;
        this._gen++; // Callbacks des Kanals ab jetzt ignorieren
        this._clearTimers();
        this._removePageListeners();
        const channel = this._channel;
        this._channel = null;
        this._joined = false;
        if (channel) {
          // removeChannel meldet den Kanal ab – Presence verschwindet damit auch bei den anderen
          await withTimeout(this._client.removeChannel(channel), LEAVE_TIMEOUT_MS, 'timed out');
        }
      } catch (err) {
        console.warn('[online] Fehler beim Verlassen der Party:', err);
      }
      if (this._online._party === this) this._online._party = null;
      this._setConnection('left');
      this._events.clear();
      return { ok: true };
    })();
    return this._leavePromise;
  }

  // --- Verbindungsaufbau ------------------------------------------------------

  /** Erster Beitritt (von Online.joinParty). */
  async _start() {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return failure('network', MSG.partyOffline);
    } catch {
      /* egal */
    }
    this._addPageListeners();
    await this._openChannel();
    const joined = await this._waitFor('_joinWaiter', () => this._everJoined, JOIN_TIMEOUT_MS);
    if (!joined || this._leaving) {
      await this.leave();
      return failure('network', MSG.partyJoin);
    }
    // Kurz auf die erste Mitgliederliste warten, damit isHost/members sofort stimmen
    await this._waitFor('_syncWaiter', () => this._synced, FIRST_SYNC_WAIT_MS);
    this._staleTimer = setInterval(() => {
      try {
        this._checkStale();
      } catch (err) {
        console.warn('[online] Stale-Prüfung:', err);
      }
    }, STALE_CHECK_MS);
    return { ok: true };
  }

  _waitFor(slot, isDone, ms) {
    if (isDone()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this[slot] = null;
        resolve(isDone());
      }, ms);
      this[slot] = () => {
        clearTimeout(timer);
        this[slot] = null;
        resolve(true);
      };
    });
  }

  /** Erstellt den Realtime-Kanal, registriert alle Listener und abonniert ihn. */
  async _openChannel() {
    const gen = ++this._gen;
    await this._removeTopicLeftovers();
    if (gen !== this._gen || this._leaving) return;

    let channel = null;
    try {
      channel = this._client.channel(this._topic, {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: this._me.id, enabled: true },
        },
      });
      // Jede Nachricht nur verarbeiten, wenn sie vom aktuellen Kanal stammt; Fehler abfangen
      const guard = (fn) => (arg) => {
        if (gen !== this._gen || this._leaving) return;
        try {
          fn(arg);
        } catch (err) {
          console.warn('[online] Party-Nachricht verworfen:', err);
        }
      };
      channel
        .on('presence', { event: 'sync' }, guard(() => this._handlePresenceSync(channel)))
        .on('broadcast', { event: 'pos' }, guard((msg) => this._handlePos(msg?.payload)))
        .on('broadcast', { event: 'race' }, guard((msg) => this._handleRace(msg?.payload)))
        .on('broadcast', { event: 'raceEnd' }, guard((msg) => this._handleRaceEnd(msg?.payload)))
        .on('broadcast', { event: 'emote' }, guard((msg) => this._handleEmote(msg?.payload)));
      this._channel = channel;
      channel.subscribe(guard((status) => this._handleChannelStatus(status)));
    } catch (err) {
      console.warn('[online] Party-Kanal konnte nicht geöffnet werden:', err);
      if (channel) withTimeout(this._client.removeChannel(channel), LEAVE_TIMEOUT_MS);
      if (this._channel === channel) this._channel = null;
      this._scheduleReopen();
    }
  }

  /**
   * client.channel() gibt einen noch existierenden Kanal gleichen Namens zurück (z. B. von einem
   * gerade verlassenen Beitritt). Den räumen wir vorher weg, sonst hingen wir am alten Kanal.
   */
  async _removeTopicLeftovers() {
    const fullTopic = 'realtime:' + this._topic;
    let leftovers = [];
    try {
      leftovers = this._client.getChannels().filter((ch) => ch && ch.topic === fullTopic);
    } catch {
      return;
    }
    for (const ch of leftovers) {
      await withTimeout(this._client.removeChannel(ch), LEAVE_TIMEOUT_MS, 'timed out');
      try {
        if (this._client.getChannels().includes(ch)) {
          ch.teardown(); // Bindungen + Timer des alten Kanals lösen
          if (typeof this._client.realtime?._remove === 'function') this._client.realtime._remove(ch);
        }
      } catch {
        /* ignorieren */
      }
    }
  }

  /** Status-Callback von channel.subscribe(). */
  _handleChannelStatus(status) {
    if (status === 'SUBSCRIBED') {
      this._joined = true;
      this._everJoined = true;
      this._reopenDelay = REOPEN_MIN_MS;
      clearTimeout(this._rejoinWatchdog);
      this._rejoinWatchdog = null;
      this._trackNow(); // Presence nach jedem (Wieder-)Beitritt neu setzen
      this._flushPendingRaceEnd();
      this._online._setStatus('online');
      this._setConnection('joined');
      if (this._joinWaiter) this._joinWaiter();
      return;
    }
    // CHANNEL_ERROR / TIMED_OUT: supabase-js versucht selbst erneut beizutreten.
    // CLOSED (ohne dass wir gehen): Kanal ist tot → selbst neu aufbauen.
    this._joined = false;
    if (status === 'CLOSED') this._scheduleReopen();
    if (!this._everJoined) return; // beim ersten Beitritt entscheidet _start() über Erfolg
    if (this._connection !== 'error') this._setConnection('reconnecting');
    this._startRejoinWatchdog();
  }

  /** Wenn es zu lange nicht klappt: Status 'error' melden und den Kanal komplett neu aufbauen. */
  _startRejoinWatchdog() {
    if (this._rejoinWatchdog || this._leaving) return;
    this._rejoinWatchdog = setTimeout(() => {
      this._rejoinWatchdog = null;
      if (this._leaving || this._joined) return;
      this._setConnection('error');
      this._reopen();
      this._startRejoinWatchdog(); // weiter probieren, bis es wieder klappt
    }, REJOIN_ERROR_MS);
  }

  _scheduleReopen() {
    if (this._reopenTimer || this._leaving) return;
    const delay = this._reopenDelay;
    this._reopenDelay = Math.min(REOPEN_MAX_MS, delay * 2);
    this._reopenTimer = setTimeout(() => {
      this._reopenTimer = null;
      this._reopen();
    }, delay);
  }

  /** Alten Kanal abbauen und einen frischen öffnen. */
  async _reopen() {
    if (this._leaving || this._reopening) return;
    this._reopening = true;
    try {
      const old = this._channel;
      this._channel = null;
      this._joined = false;
      this._gen++; // Callbacks des alten Kanals ignorieren (auch sein CLOSED)
      if (old) await withTimeout(this._client.removeChannel(old), LEAVE_TIMEOUT_MS, 'timed out');
      if (!this._leaving) await this._openChannel();
    } catch (err) {
      console.warn('[online] Neuaufbau der Party-Verbindung fehlgeschlagen:', err);
      this._scheduleReopen();
    } finally {
      this._reopening = false;
    }
  }

  _setConnection(state) {
    if (this._connection === state) return;
    this._connection = state;
    if (state !== 'joining') this._events.emit('status', state);
  }

  _canBroadcast() {
    const ch = this._channel;
    if (!ch || !this._joined || ch.state !== 'joined') return false;
    try {
      // Ohne offene Verbindung würde supabase-js auf REST ausweichen (mit Warnung) – das wollen wir nicht
      return this._client.realtime.isConnected();
    } catch {
      return false;
    }
  }

  /** Broadcast senden; false, wenn gerade keine Verbindung besteht. */
  _broadcast(event, payload) {
    if (!this._canBroadcast()) return false;
    try {
      const p = this._channel.send({ type: 'broadcast', event, payload });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  // --- Presence (eigener Eintrag) ---------------------------------------------

  _presencePayload() {
    const m = this._me;
    return { id: m.id, name: m.name, car: m.car, color: m.color, best: m.best, status: m.status, joinedAt: m.joinedAt };
  }

  _trackNow() {
    clearTimeout(this._trackTimer);
    this._trackTimer = null;
    this._lastTrackAt = now();
    // Ohne Verbindung nichts tun: beim nächsten SUBSCRIBED wird ohnehin frisch getrackt
    if (!this._canBroadcast()) return;
    try {
      const p = this._channel.track(this._presencePayload());
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* nächster Versuch beim nächsten Update */
    }
  }

  /** Presence-Update mit mindestens 500 ms Abstand; der letzte Stand geht immer raus. */
  _scheduleTrack() {
    if (this._leaving) return;
    const wait = PRESENCE_THROTTLE_MS - (now() - this._lastTrackAt);
    if (wait <= 0) this._trackNow();
    else if (!this._trackTimer) this._trackTimer = setTimeout(() => this._trackNow(), wait);
  }

  // --- Eingehende Nachrichten (alle ungeprüft → validieren!) -----------------

  _handlePresenceSync(channel) {
    const state = channel.presenceState();
    if (!isObj(state)) return;
    const t = now();

    // Gültige Einträge sammeln (pro Key der neueste), eigenen Key überspringen
    const entries = [];
    for (const key of Object.keys(state)) {
      if (entries.length >= MAX_MEMBERS * 4) break;
      const metas = state[key];
      if (!Array.isArray(metas) || metas.length === 0) continue;
      const p = sanitizePresence(key, metas[metas.length - 1]);
      if (p && p.id !== this._me.id) entries.push(p);
    }
    entries.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (entries.length > MAX_MEMBERS - 1) entries.length = MAX_MEMBERS - 1;

    const present = new Set();
    for (const p of entries) {
      present.add(p.id);
      let m = this._others.get(p.id);
      if (!m) {
        m = makeMember(p, false);
        this._others.set(p.id, m);
        this._meta.set(p.id, { seq: -1, lastPosAt: -Infinity, statusSince: t, lastEmoteAt: -Infinity });
      } else {
        if (m.status !== p.status) {
          // Neue Runde beginnt → alte Live-Werte verwerfen
          if (RUNNING_STATUSES.has(p.status) && !RUNNING_STATUSES.has(m.status)) resetLive(m);
          this._meta.get(p.id).statusSince = t;
        }
        m.name = p.name;
        m.car = p.car;
        m.color = p.color;
        m.best = p.best;
        m.status = p.status;
        m.joinedAt = p.joinedAt;
      }
      this._rememberPlayer(m);
    }
    for (const id of [...this._others.keys()]) {
      if (!present.has(id)) {
        this._others.delete(id);
        this._meta.delete(id);
      }
    }

    this._synced = true;
    this._rebuildMembers();
    this._emitMembers();
    if (this._syncWaiter) this._syncWaiter();
  }

  _handlePos(p) {
    if (!isObj(p)) return;
    const id = cleanId(p.id);
    if (!id || id === this._me.id) return;
    const m = this._others.get(id);
    const meta = this._meta.get(id);
    if (!m || !meta) return; // nur bekannte Mitglieder

    const q = strictNum(p.q);
    const d = strictNum(p.d);
    const x = strictNum(p.x);
    const v = strictNum(p.v);
    const l = strictNum(p.l);
    if (q === null || d === null || x === null || v === null || l === null) return;

    const t = now();
    // Veraltete/doppelte Pakete verwerfen (neu gestarteter Sender fängt wieder bei 1 an)
    if (q <= meta.seq && t - meta.lastPosAt < 3000) return;
    if (t - meta.lastPosAt < POS_FLOOD_MS) return;
    meta.seq = q;
    meta.lastPosAt = t;

    const alive = p.a === 1 || p.a === true;
    const changed = alive !== m.alive || m.stale;
    m.distance = clamp(d, 0, MAX_DISTANCE);
    m.x = clamp(x, -MAX_X, MAX_X);
    m.speed = clamp(v, 0, MAX_SPEED);
    m.level = clamp(Math.round(l), 1, MAX_LEVEL);
    m.alive = alive;
    m.nitro = p.n === 1 || p.n === true;
    m.lastSeen = t;
    m.stale = false;

    this._events.emit('state', {
      id, distance: m.distance, x: m.x, speed: m.speed, level: m.level, alive: m.alive, nitro: m.nitro, t,
    });
    if (changed) this._emitMembers();
  }

  _handleRace(p) {
    if (!isObj(p)) return;
    const raceId = this._cleanRaceId(p.raceId);
    const seed = strictNum(p.seed);
    const delay = strictNum(p.delayMs);
    const hostId = cleanId(p.hostId);
    if (!raceId || seed === null || delay === null || !hostId || hostId === this._me.id) return;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return;
    if (this._seenRaces.has(raceId)) return;
    // Nur der Host darf starten. Solange die Liste noch nicht synchron ist, reicht ein bekanntes Mitglied.
    if (!this._others.has(hostId) || (this._synced && hostId !== this._hostId)) return;
    remember(this._seenRaces, raceId);
    this._events.emit('race', { raceId, seed, delayMs: clamp(Math.round(delay), 1000, 10000), hostId });
  }

  _handleRaceEnd(p) {
    if (!isObj(p)) return;
    const id = cleanId(p.id);
    if (!id || id === this._me.id) return;
    const info = this._others.get(id) || this._known.get(id);
    if (!info) return;
    const raceId = this._cleanRaceId(p.raceId);
    const score = strictNum(p.score);
    if (!raceId || score === null) return;
    const key = id + '|' + raceId;
    if (this._raceEnds.has(key)) return;
    remember(this._raceEnds, key);

    const m = this._others.get(id);
    if (m && m.alive) {
      m.alive = false;
      this._emitMembers();
    }
    this._events.emit('raceEnd', {
      id, raceId, score: clamp(Math.round(score), 0, MAX_DISTANCE), name: info.name, car: info.car, color: info.color,
    });
  }

  _handleEmote(p) {
    if (!isObj(p)) return;
    const id = cleanId(p.id);
    if (!id || id === this._me.id || !EMOTES.includes(p.emoji)) return;
    const m = this._others.get(id);
    const meta = this._meta.get(id);
    if (!m || !meta) return;
    const t = now();
    if (t - meta.lastEmoteAt < EMOTE_FLOOD_MS) return;
    meta.lastEmoteAt = t;
    this._events.emit('emote', { id, emoji: p.emoji, name: m.name, color: m.color, isMe: false });
  }

  /** Renn-IDs dieser Party haben die Form CODE-zeitstempel. */
  _cleanRaceId(v) {
    return typeof v === 'string' && RE_RACE.test(v) && v.startsWith(this.code + '-') ? v : null;
  }

  // --- Mitgliederliste --------------------------------------------------------

  _rememberPlayer(m) {
    if (!this._known.has(m.id) && this._known.size >= MAX_REMEMBERED) {
      this._known.delete(this._known.keys().next().value);
    }
    this._known.set(m.id, { name: m.name, car: m.car, color: m.color });
  }

  /** Sortierte Liste neu aufbauen und den Host bestimmen (deterministisch auf allen Geräten). */
  _rebuildMembers() {
    const list = [this._me, ...this._others.values()];
    list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this._hostId = list[0].id;
    for (const m of list) m.isHost = m.id === this._hostId;
    this._members = list;
    this._countActiveSenders();
  }

  _countActiveSenders() {
    let n = 1; // ich
    for (const m of this._others.values()) if (RUNNING_STATUSES.has(m.status)) n++;
    this._activeSenders = n;
  }

  /**
   * Sendeabstand für Positionen: Bei N gleichzeitigen Fahrern entstehen ~N² Nachrichten pro Takt
   * (jeder sendet, alle anderen empfangen). Damit die Party unter dem Realtime-Budget bleibt,
   * wird der Takt bei vielen Fahrern gesenkt: 2–3 Fahrer 10 Hz, 4 ≈ 6 Hz, 6+ ≈ 2–3 Hz.
   */
  _posInterval() {
    const n = Math.max(2, this._activeSenders);
    return clamp((1000 * n * n) / POS_MSG_BUDGET, POS_MIN_INTERVAL_MS, POS_MAX_INTERVAL_MS);
  }

  _flushPos() {
    clearTimeout(this._posTimer);
    this._posTimer = null;
    const m = this._me;
    this._lastPosAt = now();
    if (!this._canBroadcast()) return;
    this._lastSentAlive = m.alive;
    // Kurze Feldnamen halten die Nachricht klein (wird bis zu 10×/s gesendet)
    this._broadcast('pos', {
      id: m.id,
      q: ++this._posSeq,
      d: Math.round(m.distance * 10) / 10,
      x: Math.round(m.x * 100) / 100,
      v: Math.round(m.speed * 10) / 10,
      l: m.level,
      a: m.alive ? 1 : 0,
      n: m.nitro ? 1 : 0,
    });
  }

  _flushPendingRaceEnd() {
    const pending = this._pendingRaceEnd;
    if (!pending) return;
    this._pendingRaceEnd = null;
    if (now() - pending.at < RACE_END_QUEUE_MS) this._broadcast('raceEnd', pending.payload);
  }

  /** "Fährt", aber seit > 5 s keine Position → stale (bleibt in der Liste). */
  _checkStale() {
    if (this._leaving) return;
    const t = now();
    let changed = false;
    for (const m of this._others.values()) {
      const meta = this._meta.get(m.id);
      const since = Math.max(m.lastSeen, meta ? meta.statusSince : 0);
      const stale = m.status === 'driving' && t - since > STALE_MS;
      if (stale !== m.stale) {
        m.stale = stale;
        changed = true;
      }
    }
    if (changed) this._emitMembers();
  }

  _emitMembers() {
    if (!this._leaving) this._events.emit('members', this._members);
  }

  // --- Aufräumen --------------------------------------------------------------

  _addPageListeners() {
    try {
      document.addEventListener('visibilitychange', this._handleVisibility);
    } catch {
      /* kein Browser */
    }
  }

  _removePageListeners() {
    try {
      document.removeEventListener('visibilitychange', this._handleVisibility);
    } catch {
      /* kein Browser */
    }
  }

  _clearTimers() {
    clearTimeout(this._trackTimer);
    clearTimeout(this._posTimer);
    clearInterval(this._staleTimer);
    clearTimeout(this._rejoinWatchdog);
    clearTimeout(this._reopenTimer);
    this._trackTimer = this._posTimer = this._staleTimer = this._rejoinWatchdog = this._reopenTimer = null;
  }
}
