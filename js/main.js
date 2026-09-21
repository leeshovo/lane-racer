/*
 * main.js – Einstiegspunkt. Verbindet alle Module:
 *   World (Umgebung), Effects (Bloom/Partikel), AudioManager (Sound),
 *   Online (Supabase), UI (Menüs/HUD) und Game (Spielmechanik).
 * Hier liegen Game-Loop, Kamera, Eingabe, Menü-Ablauf, Spielstand und Party.
 */
import * as THREE from 'three';
import {
  CONFIG, SUPABASE, CARS, PERKS, WORLDS, POWERUPS, SPECIAL_COLORS, carById, VERSION, DEFAULT_SETTINGS, sanitizeSettings,
  WORLD_TIMES, TIME_LABELS, WORLD_HILL_COLOR,
} from './config.js';
import {
  loadProfile, saveProfile, buyCar, selectCar, setCarColor, colorOf, applyRun, selectedCarOf,
  checkAchievements, achievementViews, unlockedColors, streakView,
} from './storage.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { AudioManager } from './audio.js';
import {
  Online, partyCodeFromUrl, partyShareUrl, normalizePartyCode, generatePartyCode,
  friendCodeFromUrl,
  dailyKey, dailyRaceId,
} from './online.js';
import { updateBend, setBendEnabled } from './bend.js';
import { Structures } from './structures.js';
import { Tutorial } from './tutorial.js';
import { createFriends } from './friends.js';
import { createCloud } from './cloud.js';
import { copyToClipboard } from './clipboard.js';
import { createInput } from './input.js';
import { CAMPAIGN_MAPS, mapById, nextMapOf, isMapUnlocked, unlockHint, starsOf, totalStars, levelInfo, applyCampaignResult, levelReward, OBJECTIVES } from './campaign.js';
import { hashSeed } from './rng.js';
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
  tutorial: null,       // Tipps der ersten Runde (null = keine)
  activeMap: null,      // Kampagnenkarte der laufenden Runde
  resumeAt: 0,          // Zeitpunkt (ms), an dem es nach der Pause weitergeht (0 = kein Rückwärtszählen läuft)
  resumeShown: 0,       // zuletzt angezeigte Zahl des Rückwärtszählens
  settingsFromPause: false, // Einstellungen wurden aus der Pause geöffnet (Zurück führt zur Pause)
  friendCode: null,     // eigener Freundescode (vom Server, wird beim ersten Öffnen der Freunde-Liste geholt)
  pendingFriend: friendCodeFromUrl(), // ?friend=CODE aus dem Einladungslink
};
app.challenge = readChallengeFromUrl();

let renderer;
let scene;
let camera;
let world;
let effects;
let structures;
let game;
const audio = new AudioManager();
const online = new Online({ url: SUPABASE.url, key: SUPABASE.key });
const isTouch = matchMedia('(pointer: coarse)').matches;

// Aus main.js ausgelagerte Bereiche. Sie greifen über ctx auf den Zustand zu (game gibt es erst nach boot()).
const ctx = {
  profile,
  app,
  online,
  audio,
  get ui() { return ui; },
  get game() { return game; },
  ensureRegistered: () => ensureRegistered(),
  leaveParty: () => leaveParty({ forget: true }),
  refreshScreens: () => {
    renderTopBar();
    renderMenu();
    if (app.screen === 'garage') renderGarage();
    if (app.screen === 'missions') openMissions();
  },
};
const friends = createFriends(ctx);
const cloud = createCloud(ctx);
const input = createInput({
  app,
  profile,
  get ui() { return ui; },
  get game() { return game; },
  unlockAudio: () => unlockAudio(),
  changeSettings: (partial) => changeSettings(partial),
  setPaused: (paused) => setPaused(paused),
  startRun: (options) => startRun(options),
  toMenu: () => toMenu(),
  goBack: () => goBack(),
});

// ===========================================================================
// UI mit allen Rückrufen
// ===========================================================================
const ui = new UI({
  root: document.getElementById('ui'),
  callbacks: {
    onPlay: () => playPressed(),
    onOpenDaily: () => startDaily(),
    onChallenge: () => shareChallenge(),
    onCopyRecovery: () => cloud.copyRecovery(),
    onRestoreCode: (code) => cloud.restoreFromCode(code),
    onOpenGarage: () => openGarage(),
    onOpenLeaderboard: () => openLeaderboard(),
    onOpenParty: () => openParty(),
    onOpenMissions: () => openMissions(),
    onOpenSettings: () => openSettings(),
    onBack: () => goBack(),
    onPauseSettings: () => openPauseSettings(),
    onPreviewCar: (carId) => previewCar(carId),
    onBuyCar: (carId) => purchaseCar(carId),
    onSelectCar: (carId) => chooseCar(carId),
    onSelectColor: (carId, color) => chooseColor(carId, color),
    onSubmitName: (name) => submitName(name),
    onRename: () => ui.askName({ initial: profile.name, mode: 'rename' }),
    onLeaderboardTab: (kind) => loadLeaderboard(kind),
    onCreateParty: () => joinParty(generatePartyCode()),
    onJoinParty: (code) => joinParty(code),
    onLeaveParty: () => leaveParty({ forget: true }),
    onStartRace: () => app.party?.isHost && app.party.startRace(),
    onCopyInvite: () => copyInvite(),
    onShareInvite: () => shareInvite(),
    onEmote: (emoji) => app.party?.sendEmote(emoji),
    onChat: (id) => app.party?.sendChat(id),
    onFriendAdd: (code) => friends.add(code),
    onPartyFriend: (code) => friends.addFromParty(code),
    onOpenFriends: () => openFriends(),
    onOpenCampaign: () => openCampaign(),
    onStartMap: (id) => startMap(id),
    onNextMap: () => { const m = mapById(app.lastStart && app.lastStart.map && app.lastStart.map.id); const n = nextMapOf(m); if (n) startMap(n.id); },
    onFriendCopy: () => friends.copyLink(),
    onFriendShare: () => friends.shareLink(),
    onFriendRemove: (id) => friends.remove(id),
    onSettingsChange: (partial) => changeSettings(partial),
    onSettingsReset: () => resetSettings(),
    onReplayTutorial: () => replayTutorial(),
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    onRestart: () => restartRun(),
    onToMenu: () => toMenu(),
    onTouch: (action) => input.handleTouch(action),
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
const MAX_PIXEL_RATIO = quality === 'low' ? 1 : quality === 'medium' ? 1.25 : 1.5;
let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

function boot() {
  window.__bootDone = true; // beendet den Ladebalken aus index.html
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
  structures = new Structures({ scene, quality });
  effects = new Effects({ renderer, scene, camera, quality });
  effects.setSize(window.innerWidth, window.innerHeight);

  game = new Game({ scene, effects, audio, events: gameEvents });
  game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  game.idle();

  audio.setSettings(profile.settings);
  audio.setBackground(isBackground());
  ui.renderSettings(profile.settings);
  applyVisualSettings();
  applyCameraLayout();

  // Online-Verbindung im Hintergrund aufbauen – das Spiel läuft auch offline
  online.onStatus(() => {
    renderTopBar();
    if (app.screen === 'settings') cloud.refreshRecoveryUi();
  });
  online.init().then(async (ok) => {
    renderTopBar();
    if (ok && profile.name) {
      await ensureRegistered();
      await cloud.pull();
      if (app.pendingFriend) friends.acceptLink();
      if (app.pendingParty) joinParty(app.pendingParty);
      else if (profile.lastParty && !app.party) joinParty(profile.lastParty.code, { silent: true }); // Party bleibt bestehen
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

  // Erfolge, die ein älterer Spielstand schon verdient hat, werden nachträglich gutgeschrieben
  const late = checkAchievements(profile);
  if (late.unlocked.length) {
    saveProfile(profile);
    setTimeout(() => announceAchievements(late.unlocked), 1200);
  }

  // Für Neugierige in der Browser-Konsole
  window.laneRacer = { VERSION, app, profile, game, world, effects, audio, online, ui, camera, renderer, structures, frame };
}

// ===========================================================================
// Game-Loop
// ===========================================================================
let lastTime = performance.now();
let worldDistance = 0;
let liveCache = null;
let liveCacheAt = 0;
let structureStyleKey = '';
const perf = { sum: 0, frames: 0, slowFor: 0, step: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  // Zeitschritt in Sekunden: nie negativ (falls die Zeitachse springt) und höchstens 50 ms (nach Rucklern)
  const dt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;
  if (app.resumeAt) tickResume(now);

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

  // Tunnel und Brücken (nur während der Fahrt) und deren Farben nach Welt und Tageszeit
  if (structures.enabled !== driving) structures.setEnabled(driving);
  structures.update(game.distance);
  const styleKey = `${world.worldIndex}:${world.isNight}`;
  if (styleKey !== structureStyleKey) {
    structureStyleKey = styleKey;
    structures.setStyle({ hillColor: WORLD_HILL_COLOR[WORLDS[world.worldIndex].id], night: world.isNight });
  }

  const speedRatio = clamp(game.player.speed / TOP_SPEED, 0, 1);
  const inRun = game.state === 'playing' || game.state === 'countdown';
  const settings = profile.settings;
  effects.setBloom(settings.bloom ? world.bloom : { ...world.bloom, strength: 0 });
  const speedFx = settings.speedFx && !settings.reduceMotion;
  effects.setSpeedLines(speedFx ? (game.nitroActive ? 1 : Math.max(0, speedRatio - 0.62) * 1.6) : 0);
  effects.update(running ? dt : 0, { worldSpeed: speed, speedRatio, nitro: game.nitroActive && speedFx });

  updateCamera(dt);

  audio.setEngine({
    active: running && (inRun || game.state === 'idle'),
    speed: game.player.speed,
    maxSpeed: TOP_SPEED,
    throttle: game.state === 'countdown' ? 0.35 : game.player.gas ? 1 : game.player.brake ? 0 : 0.5,
    nitro: game.nitroActive,
    tunnel: structures.inside,
  });

  if (inRun || game.state === 'crashed') {
    const hud = game.hud();
    ui.updateHud({ ...hud, live: liveList(now), race: Boolean(app.race && app.race.raceId === game.raceId), campaign: campaignHud(hud) });
    if (app.tutorial && game.state === 'playing' && running) updateTutorial(hud, dt);
    if (app.party && running) app.party.sendState(game.liveState());
  }

  effects.render(dt);
  governPerformance(dt, inRun);
  updateFpsCounter(now);
}

/** Senkt die Auflösung, wenn das Gerät dauerhaft nicht mitkommt. */
/**
 * Automatische Leistungsanpassung: Wird die Fahrt zu ruckelig (unter ~48 Bilder pro Sekunde), schaltet das Spiel
 * Schritt für Schritt Aufwand ab – zuerst Auflösung, dann Leuchteffekt, dann Schatten. Nach jedem Schritt wird
 * wieder gemessen. Rückwärts geht es bewusst nicht (sonst würde das Bild ständig hin- und herspringen).
 */
const PERF_STEPS = [
  () => setResolution(Math.min(pixelRatio, 1.25)),
  () => setResolution(Math.min(pixelRatio, 1)),
  () => effects.setBloomEnabled(false),
  () => world.setShadowsEnabled(false),
  () => setResolution(Math.min(pixelRatio, 0.85)),
  () => setResolution(Math.min(pixelRatio, 0.7)),
];

function setResolution(ratio) {
  if (ratio === pixelRatio) return;
  pixelRatio = ratio;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  effects.setSize(window.innerWidth, window.innerHeight);
}

function governPerformance(dt, inRun) {
  if (!inRun || app.paused || profile.settings.quality === 'high') return; // "Hoch" bleibt, wie es ist
  perf.sum += dt;
  perf.frames += 1;
  if (perf.sum < 1.5) return;
  const avg = perf.sum / perf.frames;
  perf.sum = 0;
  perf.frames = 0;
  if (avg > 1 / 48 && perf.step < PERF_STEPS.length) {
    perf.slowFor += 1;
    if (perf.slowFor >= 2) {
      PERF_STEPS[perf.step]();
      perf.step += 1;
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
    if (profile.settings.speedFx && !profile.settings.reduceMotion) targetFov += speedRatio * CONFIG.fovBoost + (game.nitroActive ? CONFIG.fovNitro : 0);
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
  const shake = (game.shake * 0.45 + (game.nitroActive ? 0.05 : 0)) * (profile.settings.reduceMotion ? 0 : SHAKE_FACTOR[profile.settings.shake]);
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
  const statusByScreen = { menu: 'menu', campaign: 'menu', garage: 'garage', party: 'lobby', leaderboard: 'menu', missions: 'menu', settings: 'menu', hud: 'driving', gameover: 'crashed' };
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
    rejoin: !app.party && profile.lastParty ? profile.lastParty.code : '',
    campaign: { level: levelInfo(profile.campaign.xp).level, stars: totalStars(profile.campaign), maxStars: CAMPAIGN_MAPS.length * 3 },
    daily: dailyMenuText(),
  });
}

function toMenu() {
  app.lastStart = null;
  app.challenge = null;
  cancelResume();
  app.settingsFromPause = false;
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
    extraColors: unlockedColors(profile).map((c) => c.color),
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
  const achieved = checkAchievements(profile); // z. B. "Sammler" beim dritten Auto
  saveProfile(profile);
  audio.play('buy');
  ui.toast(`${carById(carId).name} gehört dir!`, 'Direkt ausgewählt – ab auf die Straße.', 'info');
  announceAchievements(achieved.unlocked);
  app.previewCar = carId;
  game.setPlayerCar(carId, colorOf(profile, carId));
  syncPlayerOnline();
  cloud.scheduleSave();
  renderGarage();
  renderTopBar();
}

/** Toast für jeden neu geschafften Erfolg. */
function announceAchievements(list) {
  if (list.length === 1) {
    const a = list[0];
    const extra = a.color ? ` · Neuer Lack: ${SPECIAL_COLORS[a.color].name}` : '';
    ui.toast(`Erfolg: ${a.name}`, `${a.text}  +${a.reward} Münzen${extra}`, 'mission');
  } else if (list.length > 1) {
    // Mehrere auf einmal (z. B. nach dem Update): eine Meldung statt eines Stapels
    const coins = list.reduce((sum, a) => sum + a.reward, 0);
    const colors = list.filter((a) => a.color).map((a) => SPECIAL_COLORS[a.color].name);
    ui.toast(`${list.length} Erfolge freigeschaltet`, `+${coins} Münzen${colors.length ? ` · Neuer Lack: ${colors.join(', ')}` : ''} – Details unter Missionen`, 'mission');
  }
  if (list.length) {
    audio.play('mission');
    renderTopBar();
  }
}

function chooseCar(carId) {
  if (!selectCar(profile, carId)) return;
  saveProfile(profile);
  app.previewCar = carId;
  game.setPlayerCar(carId, colorOf(profile, carId));
  syncPlayerOnline();
  cloud.scheduleSave();
  renderGarage();
}

function chooseColor(carId, color) {
  if (!setCarColor(profile, carId, color)) return;
  saveProfile(profile);
  if (app.previewCar === carId) game.setPlayerCar(carId, color);
  if (profile.selectedCar === carId) syncPlayerOnline();
  cloud.scheduleSave();
  renderGarage();
}

function renderMissionsScreen() {
  ui.renderMissions({ missions: profile.missions, stats: profile.stats, achievements: achievementViews(profile), streak: streakView(profile) });
}

function openMissions() {
  renderMissionsScreen();
  setScreen('missions');
}

function openSettings() {
  ui.renderSettings(profile.settings);
  cloud.refreshRecoveryUi();
  setScreen('settings');
}

/** Tageszeit einer Welt in dieser Runde: aus dem Seed, also in Party-Rennen und Tagesrennen für alle gleich. */
function timeFor(seed, index) {
  const list = WORLD_TIMES[WORLDS[index].id] || ['default'];
  return list[hashSeed(`${seed}:time:${index}`) % list.length];
}

function worldSubtitle(index, time) {
  const label = TIME_LABELS[time];
  return label ? `${WORLDS[index].tagline} · ${label}` : WORLDS[index].tagline;
}

/** Kamerawackeln: Faktor je Einstellung. */
const SHAKE_FACTOR = { off: 0, low: 0.4, normal: 1 };

let previewTimer = 0;
/** Kurzer Testton, damit man die Lautstärke beim Einstellen hört (erst wenn der Regler ruht). */
function previewVolume(partial) {
  if (!('volume' in partial || 'sfxVolume' in partial || 'engineVolume' in partial)) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (app.screen === 'settings') audio.play('coin');
  }, 220);
}

function changeSettings(partial) {
  const before = profile.settings;
  previewVolume(partial);
  const qualityChanged = partial.quality && partial.quality !== before.quality;
  profile.settings = sanitizeSettings({ ...before, ...partial });
  saveProfile(profile);
  audio.setSettings(profile.settings);
  ui.renderSettings(profile.settings);
  applyVisualSettings();
  if (qualityChanged) {
    ui.toast('Grafik wird umgestellt', 'Das Spiel lädt kurz neu …', 'info');
    setTimeout(() => location.reload(), 700);
  }
}

/** Alle Einstellungen auf die Standardwerte (Münzen, Autos und Name bleiben). */
function resetSettings() {
  const qualityChanged = profile.settings.quality !== DEFAULT_SETTINGS.quality;
  profile.settings = { ...DEFAULT_SETTINGS };
  saveProfile(profile);
  audio.setSettings(profile.settings);
  ui.renderSettings(profile.settings);
  applyVisualSettings();
  ui.toast('Einstellungen zurückgesetzt', 'Alles steht wieder auf Standard.', 'info');
  if (qualityChanged) setTimeout(() => location.reload(), 700);
}

/** Einstellungen, die nicht Ton sind: Kurven, Tempo-Einheit, Bildraten-Zähler. */
function applyVisualSettings() {
  const s = profile.settings;
  setBendEnabled(s.bend && !s.reduceMotion);
  ui.setSpeedUnit(s.unit);
  game.setColorblind(s.colorblind);
  const root = document.documentElement;
  root.classList.toggle('text-large', s.textSize === 'large');
  root.classList.toggle('text-xlarge', s.textSize === 'xlarge');
  root.classList.toggle('hc', s.contrast);
  root.classList.toggle('cb', s.colorblind);
  root.classList.toggle('reduce-motion', s.reduceMotion);
  if (s.fps && !fpsCounter.el) {
    fpsCounter.el = document.createElement('div');
    fpsCounter.el.id = 'fps-counter';
    fpsCounter.el.setAttribute('aria-hidden', 'true');
    document.body.append(fpsCounter.el);
  }
  if (fpsCounter.el) fpsCounter.el.hidden = !s.fps;
}

// Bildraten-Zähler (nur sichtbar, wenn in den Einstellungen eingeschaltet)
const fpsCounter = { el: null, frames: 0, last: 0 };
function updateFpsCounter(now) {
  if (!fpsCounter.el || !profile.settings.fps) return;
  fpsCounter.frames += 1;
  if (now - fpsCounter.last < 500) return;
  const fps = Math.round((fpsCounter.frames * 1000) / Math.max(1, now - fpsCounter.last));
  fpsCounter.el.textContent = `${fps} FPS`;
  fpsCounter.frames = 0;
  fpsCounter.last = now;
}

/** Handy vibrieren lassen (nur wenn eingeschaltet und vom Gerät unterstützt). */
function vibrate(pattern) {
  if (!profile.settings.vibrate || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (err) { /* nicht schlimm */ }
}

// ---------------------------------------------------------------------------
// Ranglisten
// ---------------------------------------------------------------------------
function renderCampaignScreen() {
  ui.renderCampaign({
    maps: CAMPAIGN_MAPS.map((m) => ({
      ...m,
      stars: starsOf(profile.campaign, m),
      best: profile.campaign.best[m.id] || 0,
      unlocked: isMapUnlocked(profile.campaign, m),
      hint: unlockHint(profile.campaign, m),
    })),
    level: levelInfo(profile.campaign.xp),
    stars: totalStars(profile.campaign),
    maxStars: CAMPAIGN_MAPS.length * 3,
  });
}

function openCampaign() {
  renderCampaignScreen();
  setScreen('campaign');
}

function startMap(id) {
  const map = mapById(id);
  if (!map) return;
  if (!isMapUnlocked(profile.campaign, map)) {
    audio.play('error');
    ui.toast('Karte gesperrt', 'Sammle mehr Sterne auf den vorherigen Karten.', 'error');
    return;
  }
  startRun({ seed: map.seed, map, remember: true });
}

async function openFriends() {
  setScreen('leaderboard');
  loadLeaderboard('friends');
}

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
  if (kind === 'friends') {
    await friends.load(base);
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
    fc: app.friendCode || '',
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

async function joinParty(rawCode, { silent = false } = {}) {
  const code = normalizePartyCode(rawCode);
  app.pendingParty = null;
  if (!code) {
    app.partyError = 'Der Code ist ungültig. Er besteht aus 4 bis 8 Buchstaben oder Ziffern.';
    renderParty();
    return;
  }
  if (app.party) {
    if (app.partyCode === code) return openParty();
    await leaveParty(); // wechseln: die neue Party wird unten gemerkt
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
    else if (!silent) ui.toast('Party nicht erreichbar', 'Keine Verbindung zum Server.', 'error');
    return;
  }

  app.partyError = null;
  if (app.screen === 'party') renderParty({ phase: 'joining', code });
  if (!app.friendCode) {
    const fc = await online.friendCode(profile.online);
    if (fc.code) app.friendCode = fc.code;
  }
  const party = await online.joinParty(code, me());
  if (!party || party.error) {
    app.partyError = party?.error || 'Beitritt fehlgeschlagen.';
    renderParty();
    return;
  }

  app.party = party;
  app.partyCode = code;
  app.knownMembers = new Set([profile.online.id]);
  profile.lastParty = { code, at: Date.now() };
  saveProfile(profile);
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
  party.on('chat', ({ id, text }) => {
    const m = app.party?.members.find((x) => x.id === id);
    ui.showChat({ name: m ? m.name : 'Jemand', color: m ? m.color : '#2ec4b6', text });
    audio.play('emote');
  });
  party.on('status', (status) => {
    if (status === 'reconnecting') ui.toast('Verbindung wackelt', 'Party verbindet sich neu …', 'info');
    if (status === 'error') ui.toast('Party-Verbindung verloren', 'Wir versuchen es weiter.', 'error');
  });

  setScreen(app.screen); // Status an die Party melden
  audio.play('join');
  if (silent) ui.toast('Wieder in der Party', `Code ${code}`, 'party');
  else ui.toast('Party beigetreten', `Code ${code} – schick den Link an deine Freunde!`, 'party');
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

/** forget = die Party bewusst verlassen (sonst merkt sich das Spiel sie und tritt beim nächsten Start wieder bei). */
async function leaveParty({ forget = false } = {}) {
  if (forget) {
    profile.lastParty = null;
    saveProfile(profile);
  }
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

async function copyInvite() {
  if (!app.partyCode) return;
  const url = partyShareUrl(app.partyCode);
  if (await copyToClipboard(url)) ui.toast('Link kopiert', 'Schick ihn an deine Freunde.', 'party');
  else ui.toast('Kopieren nicht möglich', url, 'error');
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
    copyToClipboard(`${text} ${url}`).then((ok) => (ok
      ? ui.toast('Herausforderung kopiert', 'In der Zwischenablage', 'info')
      : ui.toast('Kopieren nicht möglich', url, 'error')));
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
// Offline-Fähigkeit: Service Worker
// ===========================================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.info('[sw] nicht registriert:', err?.message || err));
}

// ===========================================================================
// Runde starten / beenden
// ===========================================================================
function startRun({ seed, raceId = null, countdown, challenge = null, remember = false, map = null }) {
  unlockAudio();
  cancelResume();
  app.settingsFromPause = false;
  app.paused = false;
  ui.showPause(false);
  audio.setPaused(false);
  if (!raceId || String(raceId).startsWith('daily-')) app.race = null;

  if (game.carId !== profile.selectedCar || game.carColor !== colorOf(profile, profile.selectedCar)) {
    game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
  }
  const runSeed = seed ?? `${Date.now()}-${Math.random()}`;
  const startWorld = map ? map.world : 0;
  const firstTime = map ? map.time : timeFor(runSeed, 0);
  world.setWorld(startWorld, false, firstTime);
  structures.reset(runSeed);
  audio.setMusic(WORLDS[startWorld].id);
  audio.setMusicIntensity(0.5);
  app.runSeed = runSeed;
  app.activeChallenge = challenge;
  app.lastStart = remember ? { seed: runSeed, raceId, challenge, map } : null;
  app.activeMap = map;
  liveCache = null;
  if (!map) registerRunOnServer(); // Kampagnenrunden zählen nicht für die Rangliste
  game.start({
    seed: runSeed,
    raceId,
    party: app.partyCode,
    countdown: countdown ?? CONFIG.countdownSolo,
    mode: map ? 'campaign' : profile.settings.difficulty,
    map,
  });

  // Tipps nur in der ersten normalen Runde – nicht in Party, Tagesrennen oder Herausforderung
  app.tutorial = !profile.tutorialDone && !raceId && !challenge && !map ? new Tutorial({ touch: isTouch }) : null;
  ui.setTip(null);

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
    const time = timeFor(app.runSeed, index);
    world.setWorld(index, false, time);
    audio.setMusic(WORLDS[index].id);
    ui.toast(WORLDS[index].name, worldSubtitle(index, time), 'world');
    audio.play('world');
  },
  onNearMiss({ combo, coins }) {
    ui.popup(combo > 1 ? `KNAPP! ×${combo}  +${coins}` : `KNAPP!  +${coins}`, combo > 1 ? 'combo' : 'near');
  },
  onSmash({ coins }) {
    vibrate(30);
    ui.popup(`BOOM!  +${coins}`, 'smash');
  },
  onPowerup(type) {
    ui.popup(POWERUPS[type].name, 'power');
    ui.flash(game.powerupColor(type));
  },
  onShieldBreak() {
    ui.flash('#7cf29c');
    ui.popup('Schild zerstört!', 'power');
  },
  onNitro(active) {
    if (active) { ui.flash('#00e5ff'); vibrate(40); }
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
  onFinish() {
    vibrate([60, 40, 60, 40, 120]);
    ui.flash('#ffc93c');
    ui.setTouchControls(false);
  },
  onCrash() {
    vibrate([120, 40, 200]);
    ui.flash('#ff3b4e');
    ui.setTouchControls(false);
    app.party?.setStatus('crashed');
  },
  onOver(result) {
    finishRun(result);
  },
};

async function finishRun(result) {
  if (app.tutorial) endTutorial(false);
  const summary = applyRun(profile, result);
  const distance = Math.floor(result.distance);
  if (result.isDaily) {
    const key = dailyKey();
    if (!profile.daily || profile.daily.key !== key) profile.daily = { key, best: 0 };
    profile.daily.best = Math.max(profile.daily.best, distance);
  }
  saveProfile(profile);
  cloud.scheduleSave(1500);
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

  // Entspannte Runden sind zum Üben da und zählen nicht für die Rangliste
  // Kampagne: Sterne, Belohnungen, Stufen
  const map = result.mapId ? mapById(result.mapId) : null;
  let campaign = null;
  if (map) {
    const res = applyCampaignResult(profile, map, result);
    const extra = res.coins + res.levelCoins;
    summary.breakdown.campaign = extra;
    summary.total += extra;
    const more = checkAchievements(profile); // Kampagnen-Erfolge
    summary.achievements.push(...more.unlocked);
    summary.breakdown.achievements += more.coins;
    summary.total += more.coins;
    const next = nextMapOf(map);
    campaign = {
      map: { id: map.id, name: map.name, worldName: map.worldName, number: map.number },
      evaluation: res.evaluation,
      reward: { coins: res.coins, xp: res.xp, levelUps: res.levelUps, newStars: res.newStars },
      level: levelInfo(profile.campaign.xp),
      next: next && isMapUnlocked(profile.campaign, next) ? { id: next.id, name: next.name } : null,
    };
    saveProfile(profile);
    cloud.scheduleSave();
    if (res.unlockedNext) ui.toast('Neue Karte frei!', `${res.unlockedNext.worldName}: ${res.unlockedNext.name}`, 'mission');
    for (const l of res.levelUps) ui.toast(`Fahrerstufe ${l}`, `+${levelReward(l)} Münzen`, 'mission');
  }

  const canSubmit = !map && summary.ranked && Boolean(profile.online) && online.status === 'online' && result.duration >= 1;
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
    online: map ? 'campaign' : !summary.ranked ? 'practice' : canSubmit ? 'pending' : 'offline',
    campaign,
  });
  renderTopBar();
  audio.setMusicIntensity(0.25);
  if (summary.newBest && profile.stats.runs > 1) audio.play('record');
  for (const m of summary.completed) {
    ui.toast('Mission erfüllt!', `${m.text}  +${m.reward} Münzen`, 'mission');
    audio.play('mission');
  }
  if (summary.streak.bonus > 0) {
    ui.toast(`Tagesserie: ${summary.streak.count} ${summary.streak.count === 1 ? 'Tag' : 'Tage'}`, `Bonus +${summary.streak.bonus} Münzen – komm morgen wieder!`, 'info');
  }
  announceAchievements(summary.achievements);

  if (!canSubmit) {
    // Später erneut versuchen, falls die Registrierung noch fehlt
    if (summary.ranked) ensureRegistered();
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

/** Ziel und Zusatzaufgaben der Kampagnenkarte fürs HUD (null außerhalb der Kampagne). */
function campaignHud(hud) {
  const map = game.map && mapById(game.map.id);
  if (!map || !hud.goal) return null;
  return {
    name: `${map.worldName} ${map.number}`,
    frac: hud.goal.frac,
    objectives: map.goals.slice(1).map((g) => {
      const value = Math.min(OBJECTIVES[g.type].value(game), g.target);
      return { label: OBJECTIVES[g.type].label(g.target), value, target: g.target, done: value >= g.target };
    }),
  };
}

/** Tipps der ersten Runde: füttert tutorial.js mit dem Spielstand und zeigt den passenden Tipp. */
function updateTutorial(hud, dt) {
  const tip = app.tutorial.update({
    distance: game.distance,
    lane: game.player.lane,
    coins: hud.coins,
    nearMisses: game.nearMisses,
    nitroReady: hud.nitroReady,
    nitroActive: hud.nitroActive,
    abilityReady: Boolean(hud.ability && hud.ability.ready),
    abilityActive: Boolean(hud.ability && hud.ability.active),
    abilityName: hud.ability ? hud.ability.name : '',
  }, dt);
  ui.setTip(tip);
  if (app.tutorial.finished) endTutorial(true);
}

function endTutorial(completed) {
  ui.setTip(null);
  if (app.tutorial && (completed || app.tutorial.completed.length >= 2)) {
    profile.tutorialDone = true;
    saveProfile(profile);
  }
  app.tutorial = null;
}

function replayTutorial() {
  profile.tutorialDone = false;
  saveProfile(profile);
  ui.toast('Tipps aktiviert', 'In deiner nächsten Solo-Runde erscheinen die Tipps wieder.', 'info');
}

const RESUME_MS = 3000; // so lange zählt es nach der Pause rückwärts, bevor es weitergeht

/**
 * Pause an/aus. Beim Weiterfahren läuft erst ein Rückwärtszählen (3-2-1), damit man sich wieder sammeln kann.
 * Wird währenddessen noch einmal pausiert (P, Esc, Fenster verlassen), geht es zurück in die Pause.
 */
function setPaused(paused) {
  const inRun = game.state === 'playing' || game.state === 'countdown';
  if (paused) {
    if (!inRun || (app.paused && !app.resumeAt)) return;
    cancelResume();
    app.paused = true;
    game.setGas(false);
    game.setBrake(false);
    ui.showPause(true);
    audio.setPaused(true);
    return;
  }
  if (!app.paused) return;
  if (app.resumeAt) {
    setPaused(true); // P/Esc während des Zählens = wieder pausieren
    return;
  }
  ui.showPause(false);
  app.resumeAt = performance.now() + RESUME_MS;
  app.resumeShown = 0;
}

function cancelResume() {
  if (!app.resumeAt) return;
  app.resumeAt = 0;
  app.resumeShown = 0;
  ui.showCountdown(null);
}

/** Läuft jedes Bild, solange das Rückwärtszählen nach der Pause aktiv ist. */
function tickResume(now) {
  const left = app.resumeAt - now;
  if (left <= 0) {
    app.resumeAt = 0;
    app.resumeShown = 0;
    app.paused = false;
    audio.setPaused(false);
    ui.showCountdown(null);
    return;
  }
  const n = Math.ceil(left / 1000);
  if (n !== app.resumeShown) {
    app.resumeShown = n;
    ui.showCountdown(n);
    audio.play('countdown');
  }
}

/** Einstellungen aus der Pause heraus: Zurück führt wieder zur Pause, nicht ins Menü. */
function openPauseSettings() {
  if (!app.paused || app.resumeAt) return;
  app.settingsFromPause = true;
  ui.showPause(false);
  ui.renderSettings(profile.settings);
  cloud.refreshRecoveryUi();
  app.screen = 'settings';
  ui.showScreen('settings');
}

function goBack() {
  if (!app.settingsFromPause) {
    toMenu();
    return;
  }
  app.settingsFromPause = false;
  app.screen = 'hud';
  ui.showScreen('hud');
  ui.showPause(true);
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

// ---------------------------------------------------------------------------
// Fenster im Hintergrund: Ton stoppen, Spiel pausieren
// ---------------------------------------------------------------------------

/** Ist das Spiel gerade nicht im Blick? (anderer Tab, anderes Programm, minimiert, ausgeblendetes Fenster) */
function isBackground() {
  return document.hidden || !document.hasFocus();
}

function syncBackground() {
  audio.setBackground(isBackground());
}

// Fokus weg (anderes Fenster): Tasten loslassen, ggf. pausieren, Ton anhalten
window.addEventListener('blur', () => {
  game?.setGas(false);
  game?.setBrake(false);
  if (game && profile.settings.autoPause) setPaused(true);
  syncBackground();
});
window.addEventListener('focus', syncBackground);
window.addEventListener('pageshow', syncBackground);

// Tab im Hintergrund oder minimiert → immer pausieren (der Browser bremst die Animation dort ohnehin)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game) setPaused(true);
  syncBackground();
});

// Sicherheitsnetz: In manchen Umgebungen (z. B. eingebettete Browser-Fenster) fehlen die Ereignisse.
// Deshalb einmal pro Sekunde nachschauen, damit die Musik nie im Hintergrund weiterläuft.
setInterval(syncBackground, 1000);


// Audio darf erst nach einer Nutzeraktion starten
window.addEventListener('pointerdown', () => unlockAudio(), { passive: true });

// Party sauber verlassen, wenn die Seite geschlossen wird
window.addEventListener('pagehide', () => {
  app.party?.leave();
});

boot();
