/*
 * main.js – Einstiegspunkt. Verbindet alle Module:
 *   World (Umgebung), Effects (Bloom/Partikel), AudioManager (Sound),
 *   Online (Supabase), UI (Menüs/HUD) und Game (Spielmechanik).
 * Hier liegen Game-Loop, Kamera, Eingabe, Menü-Ablauf, Spielstand und Party.
 */
import * as THREE from 'three';
import { CONFIG, SUPABASE, CARS, PERKS, WORLDS, POWERUPS, carById, VERSION } from './config.js';
import {
  loadProfile, saveProfile, buyCar, selectCar, setCarColor, colorOf, applyRun, selectedCarOf,
  snapshotOf, adoptSnapshot, progressOf,
} from './storage.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { AudioManager } from './audio.js';
import {
  Online, partyCodeFromUrl, partyShareUrl, normalizePartyCode, generatePartyCode,
  dailyKey, dailyRaceId, makeRecoveryCode, parseRecoveryCode,
} from './online.js';
import { updateBend } from './bend.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const smoothing = (rate, dt) => 1 - Math.exp(-rate * dt);
const TOP_SPEED = CONFIG.maxBaseSpeed * CONFIG.boostFactor * 1.18; // für Kamera/Sound-Skalierung

// ===========================================================================
// Zustand der App (alles außerhalb der eigentlichen Spielrunde)
// ===========================================================================
const profile = loadProfile();
const app = {
  screen: 'loading',
  paused: false,
  previewCar: profile.selectedCar,
  leaderboardKind: 'global',
  party: null,          // Party-Objekt aus online.js
  partyCode: null,
  partyBoard: [],
  partyError: null,
  pendingParty: partyCodeFromUrl(), // ?party=XXXXX aus dem Einladungslink
  race: null,           // { raceId, results: Map<id, {score, alive}> }
  gameOverAt: 0,
  knownMembers: new Set(),
  runId: null,          // vom Server ausgegebene Runden-ID (siehe beginRun) – ohne sie wird kein Score angenommen
  runPromise: null,
  runToken: 0,
  runSeed: null,
  lastStart: null,      // { seed, raceId, challenge }: "Nochmal" wiederholt Tagesrennen und Herausforderungen
  challenge: null,      // Herausforderung aus einem Link: { seed, score, name }
  activeChallenge: null,
  lastRun: null,        // { seed, distance } der letzten Runde (für "Herausfordern")
  cloud: { savedAt: null, timer: 0 },
};
app.challenge = readChallengeFromUrl();

let renderer;
let scene;
let camera;
let world;
let effects;
let game;
const audio = new AudioManager();
const online = new Online({ url: SUPABASE.url, key: SUPABASE.key });
const isTouch = matchMedia('(pointer: coarse)').matches;

// ===========================================================================
// UI mit allen Rückrufen
// ===========================================================================
const ui = new UI({
  root: document.getElementById('ui'),
  callbacks: {
    onPlay: () => playPressed(),
    onOpenDaily: () => startDaily(),
    onChallenge: () => shareChallenge(),
    onCopyRecovery: () => copyRecovery(),
    onRestoreCode: (code) => restoreFromCode(code),
    onOpenGarage: () => openGarage(),
    onOpenLeaderboard: () => openLeaderboard(),
    onOpenParty: () => openParty(),
    onOpenMissions: () => openMissions(),
    onOpenSettings: () => openSettings(),
    onBack: () => toMenu(),
    onPreviewCar: (carId) => previewCar(carId),
    onBuyCar: (carId) => purchaseCar(carId),
    onSelectCar: (carId) => chooseCar(carId),
    onSelectColor: (carId, color) => chooseColor(carId, color),
    onSubmitName: (name) => submitName(name),
    onRename: () => ui.askName({ initial: profile.name, mode: 'rename' }),
    onLeaderboardTab: (kind) => loadLeaderboard(kind),
    onCreateParty: () => joinParty(generatePartyCode()),
    onJoinParty: (code) => joinParty(code),
    onLeaveParty: () => leaveParty(),
    onStartRace: () => app.party?.isHost && app.party.startRace(),
    onCopyInvite: () => copyInvite(),
    onShareInvite: () => shareInvite(),
    onEmote: (emoji) => app.party?.sendEmote(emoji),
    onSettingsChange: (partial) => changeSettings(partial),
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    onRestart: () => restartRun(),
    onToMenu: () => toMenu(),
    onTouch: (action) => handleTouch(action),
    onUiSound: (name) => audio.play(name || 'click'),
  },
});

// ===========================================================================
// Start
// ===========================================================================
function detectQuality() {
  const small = Math.min(screen.width, screen.height) < 820;
  const cores = navigator.hardwareConcurrency || 4;
  if (isTouch && small) return 'low';
  if (isTouch || cores <= 4) return 'medium';
  return 'high';
}
const quality = profile.settings.quality === 'auto' ? detectQuality() : profile.settings.quality;
const MAX_PIXEL_RATIO = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2;
let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

function boot() {
  ui.showScreen('loading');
  ui.setLoading('Motor wird vorgeglüht …');

  try {
    renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
  } catch (err) {
    ui.showFatal('WebGL nicht verfügbar', 'Dein Browser oder Gerät unterstützt kein WebGL. Probier einen aktuellen Chrome, Edge, Firefox oder Safari.');
    return;
  }
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality !== 'low';
  // PCFSoftShadowMap gibt es seit three r186 nicht mehr
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('scene').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CONFIG.fov, window.innerWidth / window.innerHeight, 0.15, 1400);
  camera.position.set(6, 3, 8);

  world = new World({ scene, renderer, quality });
  world.setWorld(0, true);
  effects = new Effects({ renderer, scene, camera, quality });
  effects.setSize(window.innerWidth, window.innerHeight);

  game = new Game({ scene, effects, audio, events: gameEvents });
  game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  game.idle();

  audio.setSettings(profile.settings);
  applyCameraLayout();

  // Online-Verbindung im Hintergrund aufbauen – das Spiel läuft auch offline
  online.onStatus(() => {
    renderTopBar();
    if (app.screen === 'settings') refreshRecoveryUi();
  });
  online.init().then(async (ok) => {
    renderTopBar();
    if (ok && profile.name) {
      await ensureRegistered();
      await pullCloud();
      if (app.pendingParty) joinParty(app.pendingParty);
    }
  });

  renderTopBar();
  renderMenu();
  if (!profile.name) {
    setScreen('menu');
    ui.askName({ initial: '', mode: 'first' });
  } else if (app.pendingParty) {
    openParty();
  } else {
    setScreen('menu');
  }

  requestAnimationFrame(frame);
  announceChallenge();
  registerServiceWorker();

  // Für Neugierige in der Browser-Konsole
  window.laneRacer = { VERSION, app, profile, game, world, effects, audio, online, ui, camera, renderer, frame };
}

// ===========================================================================
// Game-Loop
// ===========================================================================
let lastTime = performance.now();
let worldDistance = 0;
let liveCache = null;
let liveCacheAt = 0;
const perf = { sum: 0, frames: 0, slowFor: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  // Zeitschritt in Sekunden: nie negativ (falls die Zeitachse springt) und höchstens 50 ms (nach Rucklern)
  const dt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;

  const running = !app.paused;
  if (running) {
    if (app.party) game.setGhosts(ghostMembers());
    game.update(dt);
  }

  const speed = running ? game.worldSpeed : 0;
  worldDistance += speed * dt;
  world.update(running ? dt : 0, { speed, distance: worldDistance, camera });
  if (world.isNight !== game.night) game.setNight(world.isNight);

  // Kurven und Hügel: im Rennen aus der gefahrenen Strecke (für alle Party-Fahrer gleich), im Menü gemächlich
  const driving = game.state === 'playing' || game.state === 'countdown' || game.state === 'crashed';
  updateBend(driving ? game.distance : worldDistance * 0.4, world.worldIndex, running ? dt : 0);

  const speedRatio = clamp(game.player.speed / TOP_SPEED, 0, 1);
  const inRun = game.state === 'playing' || game.state === 'countdown';
  effects.setBloom(world.bloom);
  effects.setSpeedLines(game.nitroActive ? 1 : Math.max(0, speedRatio - 0.62) * 1.6);
  effects.update(running ? dt : 0, { worldSpeed: speed, speedRatio, nitro: game.nitroActive });

  updateCamera(dt);

  audio.setEngine({
    active: running && (inRun || game.state === 'idle'),
    speed: game.player.speed,
    maxSpeed: TOP_SPEED,
    throttle: game.state === 'countdown' ? 0.35 : game.player.gas ? 1 : game.player.brake ? 0 : 0.5,
    nitro: game.nitroActive,
  });

  if (inRun || game.state === 'crashed') {
    ui.updateHud({ ...game.hud(), live: liveList(now), race: Boolean(app.race && app.race.raceId === game.raceId) });
    if (app.party && running) app.party.sendState(game.liveState());
  }

  effects.render(dt);
  governPerformance(dt, inRun);
}

/** Senkt die Auflösung, wenn das Gerät dauerhaft nicht mitkommt. */
function governPerformance(dt, inRun) {
  if (!inRun || app.paused) return;
  perf.sum += dt;
  perf.frames += 1;
  if (perf.sum < 2) return;
  const avg = perf.sum / perf.frames;
  perf.sum = 0;
  perf.frames = 0;
  if (avg > 1 / 42 && pixelRatio > 0.75) {
    perf.slowFor += 1;
    if (perf.slowFor >= 2) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      effects.setSize(window.innerWidth, window.innerHeight);
      perf.slowFor = 0;
    }
  } else {
    perf.slowFor = 0;
  }
}

// ===========================================================================
// Kamera: Menü-Orbit, Garagen-Drehteller, Verfolgerkamera
// ===========================================================================
const rig = {
  mode: 'menu',
  base: new THREE.Vector3(6, 3, 8),
  look: new THREE.Vector3(0, 0.8, 0),
  goal: new THREE.Vector3(),
  lookGoal: new THREE.Vector3(),
  angle: 0.6,
};

function baseFov() {
  const minH = THREE.MathUtils.degToRad(CONFIG.minHorizontalFov);
  const vertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minH / 2) / camera.aspect));
  return Math.max(CONFIG.fov, vertical);
}

function updateCamera(dt) {
  const px = game.player.x;
  let targetFov = baseFov();

  if (rig.mode === 'follow') {
    const speedRatio = clamp((game.player.speed - CONFIG.startSpeed) / (TOP_SPEED - CONFIG.startSpeed), 0, 1);
    rig.goal.set(px * 0.6, CONFIG.cameraHeight - speedRatio * 0.2, CONFIG.cameraDistance + speedRatio * 1.4);
    rig.lookGoal.set(px * 0.85, 0.9, -CONFIG.lookAhead);
    targetFov += speedRatio * CONFIG.fovBoost + (game.nitroActive ? CONFIG.fovNitro : 0);
    rig.base.lerp(rig.goal, smoothing(5, dt));
    rig.look.lerp(rig.lookGoal, smoothing(8, dt));
  } else {
    // Menü: langsames Pendeln um das Auto; Garage: näher, dreht sich stetig
    const garage = rig.mode === 'garage';
    rig.angle += dt * (garage ? 0.35 : 0.1);
    const a = garage ? rig.angle : 0.9 + Math.sin(rig.angle) * 0.9;
    const radius = garage ? 6.4 : 8.8;
    rig.goal.set(px + Math.sin(a) * radius, garage ? 1.7 : 2.6, Math.cos(a) * radius);
    rig.lookGoal.set(px, garage ? 0.75 : 0.9, 0);
    rig.base.lerp(rig.goal, smoothing(2.2, dt));
    rig.look.lerp(rig.lookGoal, smoothing(3, dt));
  }

  camera.position.copy(rig.base);
  const shake = game.shake * 0.45 + (game.nitroActive ? 0.05 : 0);
  if (shake > 0 && !app.paused) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }
  camera.lookAt(rig.look);
  if (rig.mode === 'follow') camera.rotateZ(-game.player.vx * 0.003);

  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * smoothing(4, dt);
    camera.updateProjectionMatrix();
  }
}

/**
 * Menü und Garage liegen links (Desktop) bzw. unten (Handy). Per ViewOffset
 * wird das Bild so verschoben, dass das Auto im freien Bereich steht.
 */
function applyCameraLayout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  if (rig.mode === 'follow') {
    camera.clearViewOffset();
  } else if (w >= 900) {
    camera.setViewOffset(w, h, -w * (rig.mode === 'garage' ? 0.22 : 0.18), 0, w, h);
  } else {
    camera.setViewOffset(w, h, 0, h * (rig.mode === 'garage' ? 0.24 : 0.12), w, h);
  }
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  effects.setSize(window.innerWidth, window.innerHeight);
  applyCameraLayout();
});

// ===========================================================================
// Bildschirme
// ===========================================================================
function setScreen(name) {
  app.screen = name;
  ui.showScreen(name);
  const statusByScreen = { menu: 'menu', garage: 'garage', party: 'lobby', leaderboard: 'menu', missions: 'menu', settings: 'menu', hud: 'driving', gameover: 'crashed' };
  if (app.party && statusByScreen[name]) app.party.setStatus(statusByScreen[name]);
}

function setCameraMode(mode) {
  if (rig.mode === mode) return;
  rig.mode = mode;
  applyCameraLayout();
}

function renderTopBar() {
  ui.renderTopBar({
    name: profile.name || 'Gast',
    coins: profile.coins,
    onlineStatus: online.status,
    party: app.party ? { code: app.partyCode, memberCount: app.party.members.length } : null,
  });
}

function renderMenu() {
  ui.renderMenu({
    best: profile.best,
    car: selectedCarOf(profile),
    missions: profile.missions,
    party: app.party ? { code: app.partyCode, memberCount: app.party.members.length } : null,
    daily: dailyMenuText(),
  });
}

function toMenu() {
  app.lastStart = null;
  app.challenge = null;
  app.paused = false;
  ui.showPause(false);
  audio.setPaused(false);
  ui.setTouchControls(false);
  ui.showCountdown(null);
  // Vorschau-Auto aus der Garage zurück auf das gewählte Auto setzen
  if (game.carId !== profile.selectedCar || game.carColor !== colorOf(profile, profile.selectedCar)) {
    game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  }
  if (game.state !== 'idle') game.idle();
  setCameraMode('menu');
  audio.setMusic('menu');
  renderMenu();
  renderTopBar();
  setScreen('menu');
}

function openGarage() {
  app.previewCar = profile.selectedCar;
  setCameraMode('garage');
  renderGarage();
  setScreen('garage');
}

function renderGarage() {
  ui.renderGarage({
    cars: CARS,
    perks: PERKS,
    owned: profile.owned,
    selectedCar: profile.selectedCar,
    previewCar: app.previewCar,
    colors: profile.colors,
    coins: profile.coins,
  });
}

function previewCar(carId) {
  app.previewCar = carId;
  game.setPlayerCar(carId, colorOf(profile, carId));
  renderGarage();
}

function purchaseCar(carId) {
  const result = buyCar(profile, carId);
  if (!result.ok) {
    audio.play('error');
    ui.toast('Kauf nicht möglich', result.error, 'error');
    return;
  }
  saveProfile(profile);
  audio.play('buy');
  ui.toast(`${carById(carId).name} gehört dir!`, 'Direkt ausgewählt – ab auf die Straße.', 'info');
  app.previewCar = carId;
  game.setPlayerCar(carId, colorOf(profile, carId));
  syncPlayerOnline();
  scheduleCloudSave();
  renderGarage();
  renderTopBar();
}

function chooseCar(carId) {
  if (!selectCar(profile, carId)) return;
  saveProfile(profile);
  app.previewCar = carId;
  game.setPlayerCar(carId, colorOf(profile, carId));
  syncPlayerOnline();
  scheduleCloudSave();
  renderGarage();
}

function chooseColor(carId, color) {
  if (!setCarColor(profile, carId, color)) return;
  saveProfile(profile);
  if (app.previewCar === carId) game.setPlayerCar(carId, color);
  if (profile.selectedCar === carId) syncPlayerOnline();
  scheduleCloudSave();
  renderGarage();
}

function openMissions() {
  ui.renderMissions({ missions: profile.missions, stats: profile.stats });
  setScreen('missions');
}

function openSettings() {
  ui.renderSettings(profile.settings);
  refreshRecoveryUi();
  setScreen('settings');
}

function changeSettings(partial) {
  const qualityChanged = partial.quality && partial.quality !== profile.settings.quality;
  profile.settings = { ...profile.settings, ...partial };
  saveProfile(profile);
  audio.setSettings(profile.settings);
  ui.renderSettings(profile.settings);
  if (qualityChanged) {
    ui.toast('Grafik wird umgestellt', 'Das Spiel lädt kurz neu …', 'info');
    setTimeout(() => location.reload(), 700);
  }
}

// ---------------------------------------------------------------------------
// Ranglisten
// ---------------------------------------------------------------------------
async function openLeaderboard() {
  setScreen('leaderboard');
  loadLeaderboard(app.party ? 'party' : 'global');
}

async function loadLeaderboard(kind) {
  app.leaderboardKind = kind;
  const base = { kind, meId: profile.online?.id ?? null, partyCode: app.partyCode };
  ui.renderLeaderboard({ ...base, rows: [], loading: true, error: null });
  if (online.status === 'offline') {
    ui.renderLeaderboard({ ...base, rows: [], loading: false, error: 'Keine Verbindung zur Rangliste. Prüfe deine Internetverbindung.' });
    return;
  }
  const res = await online.leaderboard(kind, kind === 'daily' ? dailyKey() : app.partyCode);
  if (app.leaderboardKind !== kind || app.screen !== 'leaderboard') return; // inzwischen anderer Tab
  ui.renderLeaderboard({ ...base, rows: res.rows || [], loading: false, error: res.error || null });
}

// ===========================================================================
// Name & Online-Identität
// ===========================================================================
let registering = null;

/** Stellt sicher, dass es eine Online-Identität gibt (einmalig pro Browser). */
function ensureRegistered() {
  if (profile.online) return Promise.resolve(true);
  if (!profile.name || online.status !== 'online') return Promise.resolve(false);
  if (!registering) {
    registering = online.register(profile.name, profile.selectedCar, colorOf(profile, profile.selectedCar)).then((res) => {
      registering = null;
      if (res && res.id && res.secret) {
        profile.online = { id: res.id, secret: res.secret };
        saveProfile(profile);
        return true;
      }
      return false;
    });
  }
  return registering;
}

let syncTimer = 0;
/** Name/Auto/Farbe an Server und Party melden (gebündelt). */
function syncPlayerOnline() {
  app.party?.updateMe(me());
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (profile.online) online.updatePlayer(profile.online, { name: profile.name, car: profile.selectedCar, color: colorOf(profile, profile.selectedCar) });
  }, 800);
}

async function submitName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  const mode = profile.name ? 'rename' : 'first';
  if (name.length < 2 || name.length > 16 || /[<>]/.test(name)) {
    ui.askName({ initial: raw, error: 'Bitte 2 bis 16 Zeichen, ohne < und >.', mode });
    return;
  }
  profile.name = name;
  saveProfile(profile);
  ui.closeName();
  renderTopBar();
  renderMenu();
  if (profile.online) {
    syncPlayerOnline();
  } else {
    await ensureRegistered();
  }
  if (app.pendingParty && !app.party) joinParty(app.pendingParty);
}

function me() {
  return {
    id: profile.online?.id,
    name: profile.name || 'Gast',
    car: profile.selectedCar,
    color: colorOf(profile, profile.selectedCar),
    best: profile.best,
  };
}

// ===========================================================================
// Party
// ===========================================================================
function openParty() {
  setScreen('party');
  renderParty();
  if (app.party) refreshPartyBoard();
}

function renderParty(extra = {}) {
  const party = app.party;
  ui.renderParty({
    phase: party ? 'joined' : 'none',
    code: app.partyCode,
    shareUrl: app.partyCode ? partyShareUrl(app.partyCode) : null,
    members: party ? party.members : [],
    isHost: party ? party.isHost : false,
    board: app.partyBoard,
    race: raceView(),
    error: app.partyError,
    ...extra,
  });
}

async function joinParty(rawCode) {
  const code = normalizePartyCode(rawCode);
  app.pendingParty = null;
  if (!code) {
    app.partyError = 'Der Code ist ungültig. Er besteht aus 4 bis 8 Buchstaben oder Ziffern.';
    renderParty();
    return;
  }
  if (app.party) {
    if (app.partyCode === code) return openParty();
    await leaveParty();
  }
  if (!profile.name) {
    app.pendingParty = code;
    ui.askName({ initial: '', mode: 'first' });
    return;
  }
  if (online.status !== 'online' || !(await ensureRegistered())) {
    app.partyError = 'Für die Party brauchst du eine Internetverbindung. Versuch es gleich noch mal.';
    app.pendingParty = code;
    if (app.screen === 'party') renderParty();
    else ui.toast('Party nicht erreichbar', 'Keine Verbindung zum Server.', 'error');
    return;
  }

  app.partyError = null;
  if (app.screen === 'party') renderParty({ phase: 'joining', code });
  const party = await online.joinParty(code, me());
  if (!party || party.error) {
    app.partyError = party?.error || 'Beitritt fehlgeschlagen.';
    renderParty();
    return;
  }

  app.party = party;
  app.partyCode = code;
  app.knownMembers = new Set([profile.online.id]);
  try {
    history.replaceState(null, '', partyShareUrl(code));
  } catch (err) { /* z. B. file:// – egal */ }

  party.on('members', (members) => onPartyMembers(members));
  party.on('race', (race) => onRaceAnnounced(race));
  party.on('raceEnd', (end) => onRaceEnd(end));
  party.on('emote', ({ id, emoji }) => {
    const m = app.party?.members.find((x) => x.id === id);
    ui.showEmote({ name: m ? m.name : 'Jemand', color: m ? m.color : '#2ec4b6', emoji });
    audio.play('emote');
  });
  party.on('status', (status) => {
    if (status === 'reconnecting') ui.toast('Verbindung wackelt', 'Party verbindet sich neu …', 'info');
    if (status === 'error') ui.toast('Party-Verbindung verloren', 'Wir versuchen es weiter.', 'error');
  });

  setScreen(app.screen); // Status an die Party melden
  audio.play('join');
  ui.toast('Party beigetreten', `Code ${code} – schick den Link an deine Freunde!`, 'party');
  renderTopBar();
  renderMenu();
  if (app.screen === 'party' || app.screen === 'menu') openParty();
}

function onPartyMembers(members) {
  // Neue Mitglieder ankündigen
  for (const m of members) {
    if (!app.knownMembers.has(m.id)) {
      app.knownMembers.add(m.id);
      if (!m.isMe) {
        ui.toast(`${m.name} ist da`, 'Neues Party-Mitglied', 'party');
        audio.play('join');
      }
    }
  }
  renderTopBar();
  if (app.screen === 'party') renderParty();
  if (app.screen === 'menu') renderMenu();
  if (app.screen === 'gameover' && app.race) ui.updateGameOver({ race: raceView() });
}

async function leaveParty() {
  const party = app.party;
  app.party = null;
  app.partyCode = null;
  app.partyBoard = [];
  app.race = null;
  game.setGhosts([]);
  if (party) await party.leave();
  try {
    history.replaceState(null, '', location.pathname);
  } catch (err) { /* egal */ }
  renderTopBar();
  renderMenu();
  if (app.screen === 'party') renderParty();
}

async function refreshPartyBoard() {
  if (!app.partyCode) return;
  const res = await online.leaderboard('party', app.partyCode);
  if (res.rows) {
    app.partyBoard = res.rows;
    if (app.screen === 'party') renderParty();
  }
}

function copyInvite() {
  if (!app.partyCode) return;
  const url = partyShareUrl(app.partyCode);
  const done = () => ui.toast('Link kopiert', 'Schick ihn an deine Freunde.', 'party');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url) && done());
  } else if (fallbackCopy(url)) {
    done();
  }
}

function fallbackCopy(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  field.remove();
  if (!ok) ui.toast('Kopieren nicht möglich', url, 'error');
  return ok;
}

function shareInvite() {
  if (!app.partyCode) return;
  const url = partyShareUrl(app.partyCode);
  if (navigator.share) {
    navigator.share({ title: 'Lane Racer', text: `Fahr mit mir Lane Racer! Party-Code ${app.partyCode}`, url }).catch(() => {});
  } else {
    copyInvite();
  }
}

/** Ein Rennen wurde (vom Host) gestartet. */
function onRaceAnnounced({ raceId, seed, delayMs }) {
  const busy = game.state === 'playing' || game.state === 'countdown' || game.state === 'crashed';
  if (busy) {
    ui.toast('Party-Rennen gestartet', 'Du bist gerade in einer Runde – beim nächsten Mal!', 'party');
    return;
  }
  app.race = { raceId, results: new Map() };
  startRun({ seed, raceId, countdown: Math.max(2, Math.min(8, (delayMs || 5000) / 1000)) });
  ui.toast('Party-Rennen!', 'Alle starten gleichzeitig mit demselben Verkehr.', 'party');
}

function onRaceEnd({ id, raceId, score }) {
  if (!app.race || app.race.raceId !== raceId) return;
  app.race.results.set(id, { score, alive: false });
  if (app.screen === 'gameover') ui.updateGameOver({ race: raceView() });
  if (app.screen === 'party') renderParty();
}

/** Rennstand: fertige Ergebnisse + wer noch fährt (mit Live-Distanz). */
function raceView() {
  if (!app.race || !app.party) return null;
  const results = app.party.members.map((m) => {
    const done = app.race.results.get(m.id);
    const alive = !done && (m.status === 'driving' || m.status === 'countdown');
    return {
      name: m.name,
      color: m.color,
      score: Math.floor(done ? done.score : m.distance || 0),
      alive,
      isMe: m.isMe,
    };
  });
  // Eigenes Ergebnis steht evtl. noch nicht in members
  results.sort((a, b) => b.score - a.score);
  const running = results.some((r) => r.alive);
  const phase = game.raceId === app.race.raceId && (game.state === 'playing' || game.state === 'countdown') ? 'running' : running ? 'running' : 'results';
  return { phase, results };
}

/** Andere Party-Mitglieder als Geisterautos. */
function ghostMembers() {
  if (!app.party) return [];
  const nowPerf = performance.now();
  const nowWall = Date.now();
  return app.party.members
    .filter((m) => !m.isMe && (m.status === 'driving' || m.status === 'countdown'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      car: m.car,
      color: m.color,
      distance: m.distance || 0,
      x: m.x || 0,
      speed: m.speed || 0,
      alive: m.alive !== false,
      // lastSeen kann Wanduhr- (Date.now) oder performance.now-basiert sein
      lastSeen: m.lastSeen > 1e12 ? nowPerf - (nowWall - m.lastSeen) : m.lastSeen || nowPerf,
    }));
}

/** Live-Rangliste fürs HUD (höchstens 4× pro Sekunde neu berechnet). */
function liveList(now) {
  const challenge = app.activeChallenge;
  if (!app.party && !challenge) return null;
  if (liveCache && now - liveCacheAt < 250) return liveCache;
  liveCacheAt = now;
  const list = app.party
    ? app.party.members
      .filter((m) => !m.isMe && ['driving', 'countdown', 'crashed'].includes(m.status))
      .map((m) => ({ name: m.name, color: m.color, distance: Math.floor(m.distance || 0), alive: m.status !== 'crashed' && m.alive !== false, isMe: false }))
    : [];
  // Herausforderung: der Score des Freundes steht als feste "Ziellinie" in der Liste
  if (challenge) list.push({ name: `${challenge.name.slice(0, 9)} Ziel`, color: '#FFC93C', distance: challenge.score, alive: true, isMe: false });
  list.push({ name: profile.name, color: colorOf(profile, profile.selectedCar), distance: Math.floor(game.distance), alive: game.state !== 'crashed', isMe: true });
  list.sort((a, b) => b.distance - a.distance);
  liveCache = list;
  return list;
}

// ===========================================================================
// Start-Varianten: Fahren, Tagesrennen, Herausforderung
// ===========================================================================

/** "Fahren": normale Runde – oder die Herausforderung eines Freunden, falls ein Link offen ist. */
function playPressed() {
  if (app.challenge) {
    startRun({ seed: app.challenge.seed, challenge: app.challenge, remember: true });
  } else {
    startRun({});
  }
}

/** "Nochmal": Tagesrennen und Herausforderungen wiederholen dieselbe Strecke, alles andere startet neu. */
function restartRun() {
  if (app.lastStart) startRun({ ...app.lastStart, remember: true });
  else startRun({});
}

/** Tagesrennen: heute für alle Spieler weltweit derselbe Seed, also dieselbe Strecke. */
function startDaily() {
  startRun({ seed: `daily-${dailyKey()}`, raceId: dailyRaceId(), remember: true });
  ui.toast('Tagesrennen', 'Heute für alle dieselbe Strecke – dein bester Versuch zählt.', 'party');
}

function dailyMenuText() {
  const d = profile.daily;
  if (d && d.key === dailyKey() && d.best > 0) return `Heute: ${d.best.toLocaleString('de-DE')} m`;
  return 'Neue Strecke jeden Tag';
}

/** Platz im heutigen Tagesrennen ermitteln und einblenden. */
async function announceDailyPlace() {
  const res = await online.leaderboard('daily', dailyKey());
  if (!res.rows || app.screen !== 'gameover') return;
  const id = profile.online?.id;
  const index = res.rows.findIndex((r) => r.id === id || r.player_id === id);
  if (index >= 0) ui.toast(`Tagesrennen: Platz ${index + 1}`, `Von ${res.rows.length} ${res.rows.length === 1 ? 'Fahrer' : 'Fahrern'} heute`, index === 0 ? 'mission' : 'info');
}

/** Herausforderungs-Link aus der Adresse lesen (?c=…). Alles wird geprüft, der Link ist nicht vertrauenswürdig. */
function readChallengeFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get('c');
    if (!raw || raw.length > 400) return null;
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const seed = typeof data.s === 'string' && /^[A-Za-z0-9._:-]{4,60}$/.test(data.s) ? data.s : null;
    const score = Number.isFinite(data.d) ? Math.floor(data.d) : 0;
    if (!seed || score < 1 || score > 10_000_000) return null;
    // Steuerzeichen und spitze Klammern aus dem Namen entfernen (der Link ist nicht vertrauenswürdig)
    const name = Array.from(String(data.n ?? '')).filter((c) => { const n = c.charCodeAt(0); return n > 31 && !(n >= 127 && n <= 159) && c !== '<' && c !== '>'; }).join('').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Ein Freund';
    return { seed, score, name };
  } catch (err) {
    return null;
  }
}

function announceChallenge() {
  const ch = app.challenge;
  if (!ch) return;
  setTimeout(() => ui.toast(`${ch.name} fordert dich heraus`, `${ch.score.toLocaleString('de-DE')} m auf derselben Strecke – drück „Fahren“!`, 'party'), 1200);
}

/** Link zur letzten Runde: gleiche Strecke (Seed) plus der Score als Ziel. */
function buildChallengeUrl() {
  const run = app.lastRun;
  if (!run || !run.seed) return null;
  const payload = JSON.stringify({ s: run.seed, d: run.distance, n: profile.name || 'Ein Freund' });
  let bin = '';
  for (const b of new TextEncoder().encode(payload)) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}?c=${b64}`;
}

function shareChallenge() {
  const url = buildChallengeUrl();
  if (!url) {
    ui.toast('Noch keine Runde', 'Fahr zuerst eine Runde, dann kannst du Freunde herausfordern.', 'info');
    return;
  }
  const text = `Schlag meine ${app.lastRun.distance.toLocaleString('de-DE')} m in Lane Racer – gleiche Strecke, gleicher Verkehr!`;
  if (navigator.share) {
    navigator.share({ title: 'Lane Racer – Herausforderung', text, url }).catch(() => {});
  } else {
    copyText(`${text} ${url}`, 'Herausforderung kopiert');
  }
}

// ===========================================================================
// Server-gemessene Runden
// ===========================================================================

/** Meldet den Rundenstart beim Server an; die Runden-ID wird beim Score mitgeschickt. */
function registerRunOnServer() {
  app.runId = null;
  const token = ++app.runToken;
  if (!profile.online || online.status === 'offline') {
    app.runPromise = Promise.resolve();
    return;
  }
  app.runPromise = online.beginRun(profile.online).then((res) => {
    if (token === app.runToken && res.runId) app.runId = res.runId;
  });
}

// ===========================================================================
// Cloud-Spielstand und Sicherungscode
// ===========================================================================

function scheduleCloudSave(delay = 2500) {
  clearTimeout(app.cloud.timer);
  app.cloud.timer = setTimeout(pushCloud, delay);
}

async function pushCloud() {
  if (!profile.online || online.status !== 'online') return false;
  const res = await online.saveProfile(profile.online, snapshotOf(profile));
  if (!res.savedAt) return false;
  app.cloud.savedAt = res.savedAt;
  if (app.screen === 'settings') refreshRecoveryUi();
  return true;
}

/** Beim Start: Ist in der Cloud ein weiterer Spielstand als auf diesem Gerät? Dann den übernehmen. */
async function pullCloud() {
  if (!profile.online || online.status !== 'online') return;
  const res = await online.loadProfile(profile.online);
  if (res.error) return;
  app.cloud.savedAt = res.updatedAt;
  const cloudProgress = progressOf(res.data);
  const localProgress = progressOf(profile);
  if (res.data && cloudProgress > localProgress) {
    adoptSnapshot(profile, res.data);
    saveProfile(profile);
    ui.toast('Spielstand geladen', 'Ein weiterer Stand aus der Cloud wurde übernommen.', 'info');
    afterProfileChanged();
  } else if (localProgress > cloudProgress) {
    pushCloud();
  }
  if (app.screen === 'settings') refreshRecoveryUi();
}

/** Nach dem Laden/Wiederherstellen alles auffrischen, was den Spielstand zeigt. */
function afterProfileChanged() {
  if (game.state === 'idle') game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  renderTopBar();
  renderMenu();
  if (app.screen === 'garage') renderGarage();
  if (app.screen === 'missions') openMissions();
}

function refreshRecoveryUi() {
  let status;
  if (!profile.online) status = 'Melde dich mit einem Namen an – dann wird dein Spielstand gesichert.';
  else if (online.status !== 'online') status = 'Offline – gesichert wird, sobald du wieder online bist.';
  else if (app.cloud.savedAt) status = `Zuletzt gesichert: ${new Date(app.cloud.savedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr`;
  else status = 'Wird nach deiner nächsten Runde gesichert.';
  ui.setRecoveryCode({
    code: makeRecoveryCode(profile.online),
    hasProgress: profile.stats.runs > 0 || profile.stats.totalCoins > 0,
    status,
  });
}

function copyRecovery() {
  const code = makeRecoveryCode(profile.online);
  if (code) copyText(code, 'Sicherungscode kopiert');
}

/** Stellt einen Spielstand auf diesem Gerät wieder her (Code stammt von einem anderen Gerät). */
async function restoreFromCode(text) {
  const identity = parseRecoveryCode(text);
  if (!identity) {
    ui.setRestoreResult({ ok: false, message: 'Dieser Sicherungscode ist ungültig. Kopiere ihn vollständig, er beginnt mit LR1-.' });
    return;
  }
  const res = await online.loadProfile(identity);
  if (res.error) {
    ui.setRestoreResult({ ok: false, message: res.code === 'auth' ? 'Zu diesem Code gibt es keinen Spieler. Prüfe, ob du ihn richtig kopiert hast.' : res.error });
    return;
  }
  if (app.party) await leaveParty();
  profile.online = identity;
  profile.name = res.name;
  if (res.data) adoptSnapshot(profile, res.data);
  else profile.best = Math.max(profile.best, res.best);
  saveProfile(profile);
  app.cloud.savedAt = res.updatedAt;
  afterProfileChanged();
  refreshRecoveryUi();
  ui.setRestoreResult({ ok: true, message: `Willkommen zurück, ${res.name}! Dein Spielstand ist wiederhergestellt.` });
  audio.play('buy');
}

/** Text in die Zwischenablage kopieren (mit Rückmeldung). */
function copyText(text, doneMessage) {
  const done = () => ui.toast(doneMessage, 'In der Zwischenablage', 'info');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => { if (fallbackCopy(text)) done(); });
  } else if (fallbackCopy(text)) {
    done();
  }
}

// ===========================================================================
// Offline-Fähigkeit: Service Worker
// ===========================================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.info('[sw] nicht registriert:', err?.message || err));
}

// ===========================================================================
// Runde starten / beenden
// ===========================================================================
function startRun({ seed, raceId = null, countdown, challenge = null, remember = false }) {
  unlockAudio();
  app.paused = false;
  ui.showPause(false);
  audio.setPaused(false);
  if (!raceId || String(raceId).startsWith('daily-')) app.race = null;

  if (game.carId !== profile.selectedCar || game.carColor !== colorOf(profile, profile.selectedCar)) {
    game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  }
  world.setWorld(0);
  audio.setMusic(WORLDS[0].id);
  audio.setMusicIntensity(0.5);
  const runSeed = seed ?? `${Date.now()}-${Math.random()}`;
  app.runSeed = runSeed;
  app.activeChallenge = challenge;
  app.lastStart = remember ? { seed: runSeed, raceId, challenge } : null;
  liveCache = null;
  registerRunOnServer();
  game.start({
    seed: runSeed,
    raceId,
    party: app.partyCode,
    countdown: countdown ?? CONFIG.countdownSolo,
  });

  setCameraMode('follow');
  setScreen('hud');
  if (app.party) app.party.setStatus('countdown');
  ui.setTouchControls(isTouch);
}

const gameEvents = {
  onCountdown(value) {
    ui.showCountdown(value);
    if (value === 'LOS!') setTimeout(() => ui.showCountdown(null), 700);
  },
  onStart() {
    app.party?.setStatus('driving');
  },
  onLevel(level) {
    if (level > 1) {
      ui.toast(`Level ${level}`, WORLDS[game.worldIndex].name, 'level');
      audio.play('levelUp');
    }
  },
  onWorld(index) {
    world.setWorld(index);
    audio.setMusic(WORLDS[index].id);
    ui.toast(WORLDS[index].name, WORLDS[index].tagline, 'world');
    audio.play('world');
  },
  onNearMiss({ combo, coins }) {
    ui.popup(combo > 1 ? `KNAPP! ×${combo}  +${coins}` : `KNAPP!  +${coins}`, combo > 1 ? 'combo' : 'near');
  },
  onSmash({ coins }) {
    ui.popup(`BOOM!  +${coins}`, 'smash');
  },
  onPowerup(type) {
    ui.popup(POWERUPS[type].name, 'power');
    ui.flash(POWERUPS[type].color);
  },
  onShieldBreak() {
    ui.flash('#7cf29c');
    ui.popup('Schild zerstört!', 'power');
  },
  onNitro(active) {
    if (active) ui.flash('#00e5ff');
    audio.setMusicIntensity(active ? 1 : 0.5);
  },
  onAbility(ability) {
    ui.popup(ability.name, 'power');
    ui.flash('#ffc93c');
  },
  onEvent({ type, phase }) {
    if (type === 'boss') {
      ui.toast('Achtung, Konvoi!', 'Zwei Lkw hintereinander – weich aus oder ramm sie mit Nitro', 'error');
      audio.play('shieldBreak');
    } else if (phase === 'start' && type === 'gold') {
      ui.toast('Goldrausch!', 'Lange Münzlinien auf der freien Spur', 'mission');
      ui.flash('#ffc93c');
      audio.play('levelUp');
    } else if (phase === 'start' && type === 'rush') {
      ui.toast('Stoßverkehr!', 'Dichter Verkehr – Beinahe-Unfälle zählen doppelt', 'error');
      audio.play('levelUp');
    }
  },
  onBoss({ coins }) {
    ui.popup(`KONVOI ÜBERHOLT  +${coins}`, 'combo');
  },
  onCrash() {
    ui.flash('#ff3b4e');
    ui.setTouchControls(false);
    app.party?.setStatus('crashed');
  },
  onOver(result) {
    finishRun(result);
  },
};

async function finishRun(result) {
  const summary = applyRun(profile, result);
  const distance = Math.floor(result.distance);
  if (result.isDaily) {
    const key = dailyKey();
    if (!profile.daily || profile.daily.key !== key) profile.daily = { key, best: 0 };
    profile.daily.best = Math.max(profile.daily.best, distance);
  }
  saveProfile(profile);
  scheduleCloudSave(1500);
  app.gameOverAt = performance.now();
  app.lastRun = { seed: result.seed, distance };

  if (app.activeChallenge) {
    const ch = app.activeChallenge;
    if (distance > ch.score) ui.toast('Herausforderung geschafft!', `Du hast ${ch.name} geschlagen: ${distance.toLocaleString('de-DE')} m gegen ${ch.score.toLocaleString('de-DE')} m`, 'mission');
    else ui.toast('Knapp daneben', `${ch.name} hat ${ch.score.toLocaleString('de-DE')} m – dir fehlen ${(ch.score - distance + 1).toLocaleString('de-DE')} m`, 'info');
  }

  if (app.party && result.isPartyRace) {
    app.party.sendRaceEnd(result.raceId, distance);
    app.race?.results.set(profile.online?.id, { score: distance, alive: false });
  }

  const canSubmit = Boolean(profile.online) && online.status === 'online' && result.duration >= 1;
  setScreen('gameover');
  ui.showGameOver({
    distance,
    best: profile.best,
    isRecord: summary.newBest,
    rank: null,
    coins: { breakdown: summary.breakdown, total: summary.total },
    completed: summary.completed,
    stats: {
      overtakes: result.overtakes,
      nearMisses: result.nearMisses,
      smashed: result.smashed,
      level: result.level,
      time: result.duration,
    },
    race: result.isPartyRace ? raceView() : null,
    online: canSubmit ? 'pending' : 'offline',
  });
  renderTopBar();
  audio.setMusicIntensity(0.25);
  if (summary.newBest && profile.stats.runs > 1) audio.play('record');
  for (const m of summary.completed) {
    ui.toast('Mission erfüllt!', `${m.text}  +${m.reward} Münzen`, 'mission');
    audio.play('mission');
  }

  if (!canSubmit) {
    // Später erneut versuchen, falls die Registrierung noch fehlt
    ensureRegistered();
    return;
  }
  await app.runPromise;
  if (!app.runId) {
    if (app.screen === 'gameover') ui.updateGameOver({ online: 'error' });
    return;
  }
  const res = await online.submitScore(profile.online, {
    runId: app.runId,
    score: distance,
    duration: Math.max(1, result.duration),
    coins: summary.total,
    nearMisses: result.nearMisses,
    overtakes: result.overtakes,
    smashed: result.smashed,
    level: result.level,
    car: result.car,
    party: app.partyCode,
    raceId: result.raceId,
  });
  if (app.screen !== 'gameover') return;
  if (res && !res.error) {
    ui.updateGameOver({ rank: res.rank, online: 'submitted' });
    if (app.partyCode) refreshPartyBoard();
    if (result.isDaily) announceDailyPlace();
  } else {
    ui.updateGameOver({ online: 'error' });
  }
}

function setPaused(paused) {
  const inRun = game.state === 'playing' || game.state === 'countdown';
  if (paused && (!inRun || app.paused)) return;
  if (!paused && !app.paused) return;
  app.paused = paused;
  if (paused) {
    game.setGas(false);
    game.setBrake(false);
  }
  ui.showPause(paused);
  audio.setPaused(paused);
}

// ===========================================================================
// Eingabe
// ===========================================================================

/** Erste Nutzeraktion: AudioContext freischalten und passende Musik starten. */
function unlockAudio() {
  audio.unlock();
  if (app.audioReady) return;
  app.audioReady = true;
  const inRun = game && game.state !== 'idle';
  audio.setMusic(inRun ? WORLDS[game.worldIndex].id : 'menu');
}

/** Einheitlicher Tastenname; manche Umgebungen liefern event.code leer. */
function keyName(event) {
  if (event.code) return event.code;
  const key = event.key || '';
  if (key === ' ') return 'Space';
  if (key.length === 1) return `Key${key.toUpperCase()}`;
  return key;
}

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
  if (!game) return;
  unlockAudio();
  const code = keyName(event);
  const inRun = game.state === 'playing' || game.state === 'countdown';

  if (code === 'KeyM' && !event.repeat) {
    const muted = profile.settings.music || profile.settings.sfx;
    changeSettings({ music: !muted, sfx: !muted });
    ui.toast(muted ? 'Ton aus' : 'Ton an', 'Taste M schaltet um', 'info');
    return;
  }

  if (inRun && !app.paused) {
    if (GAME_KEYS.has(code)) event.preventDefault();
    switch (code) {
      case 'ArrowLeft': case 'KeyA':
        if (!event.repeat) game.changeLane(-1);
        break;
      case 'ArrowRight': case 'KeyD':
        if (!event.repeat) game.changeLane(1);
        break;
      case 'ArrowUp': case 'KeyW':
        game.setGas(true);
        break;
      case 'ArrowDown': case 'KeyS':
        game.setBrake(true);
        break;
      case 'Space': case 'ShiftLeft': case 'ShiftRight': case 'KeyN':
        if (!event.repeat) game.triggerNitro();
        break;
      case 'KeyF': case 'KeyE':
        if (!event.repeat) game.useAbility();
        break;
      case 'KeyP': case 'Escape':
        if (!event.repeat) setPaused(true);
        break;
      case 'KeyH':
        if (!event.repeat) game.setDebugHitboxes(!game.debugHitboxes);
        break;
      default:
        break;
    }
    return;
  }

  if (app.paused) {
    if (!event.repeat && ['KeyP', 'Escape', 'Enter'].includes(code)) {
      event.preventDefault();
      setPaused(false);
    }
    return;
  }

  // Menüs: Enter/Leertaste nur, wenn kein Button den Fokus hat (sonst doppelt)
  const onButton = event.target instanceof Element && event.target.closest('button, a, [role="button"]');
  if (app.screen === 'gameover' && !event.repeat) {
    if ((code === 'Enter' || code === 'Space') && !onButton && performance.now() - app.gameOverAt > 700) {
      event.preventDefault();
      startRun({});
    } else if (code === 'Escape') {
      toMenu();
    }
  } else if (app.screen === 'menu' && !event.repeat && (code === 'Enter' || code === 'Space') && !onButton) {
    event.preventDefault();
    startRun({});
  } else if (app.screen !== 'menu' && app.screen !== 'hud' && code === 'Escape' && !event.repeat) {
    toMenu();
  }
});

window.addEventListener('keyup', (event) => {
  if (!game) return;
  switch (keyName(event)) {
    case 'ArrowUp': case 'KeyW':
      game.setGas(false);
      break;
    case 'ArrowDown': case 'KeyS':
      game.setBrake(false);
      break;
    default:
      break;
  }
});

function handleTouch(action) {
  unlockAudio();
  if (app.paused) return;
  switch (action) {
    case 'left': game.changeLane(-1); break;
    case 'right': game.changeLane(1); break;
    case 'nitro': game.triggerNitro(); break;
    case 'ability': game.useAbility(); break;
    case 'gas:down': game.setGas(true); break;
    case 'gas:up': game.setGas(false); break;
    case 'brake:down': game.setBrake(true); break;
    case 'brake:up': game.setBrake(false); break;
    default: break;
  }
}

// Fokus weg (anderes Fenster) oder Tab im Hintergrund → Pause
window.addEventListener('blur', () => {
  game?.setGas(false);
  game?.setBrake(false);
  if (game) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game) setPaused(true);
});

// Audio darf erst nach einer Nutzeraktion starten
window.addEventListener('pointerdown', () => unlockAudio(), { passive: true });

// Party sauber verlassen, wenn die Seite geschlossen wird
window.addEventListener('pagehide', () => {
  app.party?.leave();
});

boot();
