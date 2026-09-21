/*
 * game.js – die eigentliche Spielmechanik.
 *
 * Prinzip wie in Version 1: Das Spielerauto bleibt bei z = 0 und bewegt sich
 * nur seitlich. Verkehr, Münzen und Power-ups kommen mit der Relativ-
 * geschwindigkeit (Spielertempo − Verkehrstempo) auf die Kamera zu.
 *
 * Diese Datei kennt keine Menüs und kein HTML: Sie meldet Ereignisse über
 * `events` (siehe Konstruktor) und liefert mit hud() / liveState() Daten
 * für die Anzeige und den Party-Modus.
 */
import * as THREE from 'three';
import {
  CONFIG, LANE_X, LANE_COUNT, PLAYER_SIZE, TRAFFIC, TRAFFIC_COLORS, POWERUPS,
  WORLDS, worldIndexForLevel, carById,
} from './config.js';
import { createRng } from './rng.js';
import { createPlayerCar, createTrafficVehicle, createGhostCar, createNameTag } from './cars.js';

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const smoothing = (rate, dt) => 1 - Math.exp(-rate * dt);

const ALL_LANES = LANE_X.map((_, i) => i);
const MIDDLE_LANE = Math.floor(LANE_COUNT / 2);
const TRAFFIC_BY_TYPE = Object.fromEntries(TRAFFIC.map((t) => [t.type, t]));
const TRAFFIC_SPAWNABLE = TRAFFIC.filter((t) => t.weight > 0);
const PLAYER_VISUAL = new THREE.Vector3(...PLAYER_SIZE);
const PLAYER_HIT = PLAYER_VISUAL.clone().multiplyScalar(CONFIG.hitboxScale);
const POWERUP_WEIGHTS = [
  { type: 'nitro', weight: 35 },
  { type: 'shield', weight: 25 },
  { type: 'magnet', weight: 20 },
  { type: 'double', weight: 20 },
];
const MAX_COINS = 120;
const GRAVITY = 32;

// Wiederverwendete Objekte (keine Allokationen pro Frame)
const tmpCenter = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const COIN_BASE_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Schwerlast-Konvoi: zwei Lkw dicht hintereinander, 15 m lang.
 * Verhält sich nach außen wie ein einzelnes Fahrzeug (object, setHeadlights, update, dispose).
 */
function createConvoy() {
  const front = createTrafficVehicle('truck', '#c1121f');
  const rear = createTrafficVehicle('truck', '#e9ecef');
  const object = new THREE.Group();
  front.object.position.z = -3.9;
  rear.object.position.z = 3.9;
  object.add(front.object, rear.object);
  return {
    object,
    size: new THREE.Vector3(2.35, 3.2, 15),
    setHeadlights(on) { front.setHeadlights(on); rear.setHeadlights(on); },
    setNitro() {},
    setBrake() {},
    update(dt, speed) { front.update(dt, speed); rear.update(dt, speed); },
    dispose() { front.dispose(); rear.dispose(); },
  };
}

export class Game {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {import('./effects.js').Effects} opts.effects
   * @param {import('./audio.js').AudioManager} opts.audio
   * @param {object} opts.events  optionale Callbacks:
   *   onCountdown(value), onStart(), onLevel(level), onWorld(index), onCoin(value),
   *   onNearMiss({ combo, coins }), onSmash({ coins }), onPowerup(type), onShieldBreak(),
   *   onNitro(active), onCrash(), onOver(result)
   */
  constructor({ scene, effects, audio, events = {} }) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.events = events;

    this.state = 'idle'; // 'idle' | 'countdown' | 'playing' | 'crashed' | 'over'
    this.night = false;
    this.debugHitboxes = false;

    // Spieler
    this.carId = 'blitz';
    this.carColor = '#ff5a1f';
    this.car = carById(this.carId);
    this.vehicle = null;
    this.player = {
      lane: MIDDLE_LANE, x: LANE_X[MIDDLE_LANE], vx: 0, speed: 0,
      gas: false, brake: false, spin: 0,
      box: new THREE.Box3(), helper: null,
    };

    this.enemies = [];
    this.debris = []; // weggerammte Fahrzeuge, die durch die Luft fliegen
    this.powerups = [];
    this.ghosts = new Map();
    this.shake = 0;

    this.#createCoinPool();
    this.setPlayerCar(this.carId, this.carColor);
    this.#resetRun();
  }

  // =========================================================================
  // Öffentliche Steuerung
  // =========================================================================

  /** Tauscht das Spielerauto (Garage, Farbwahl). */
  setPlayerCar(carId, color) {
    this.carId = carId;
    this.carColor = color;
    this.car = carById(carId);
    const old = this.vehicle;
    const position = old ? old.object.position.clone() : new THREE.Vector3(this.player.x, 0, 0);
    const rotation = old ? old.object.rotation.clone() : new THREE.Euler();
    if (old) {
      this.scene.remove(old.object);
      old.dispose();
    }
    this.vehicle = createPlayerCar(carId, color);
    this.vehicle.object.position.copy(position);
    this.vehicle.object.rotation.copy(rotation);
    this.vehicle.setHeadlights(this.night);
    this.scene.add(this.vehicle.object);
    if (this.shieldActive) this.effects.setShield(this.vehicle.object);
  }

  /** Nacht-Welten: Scheinwerfer an (Spieler, Verkehr, neue Fahrzeuge). */
  setNight(on) {
    this.night = on;
    this.vehicle?.setHeadlights(on);
    for (const e of this.enemies) e.vehicle.setHeadlights(on);
  }

  /** Menü/Garage: Auto rollt ohne Verkehr gemütlich die Straße entlang. */
  idle() {
    this.#clearRun();
    this.#resetRun(); // setzt auch ein nach dem Crash verdrehtes Auto wieder gerade
    this.state = 'idle';
    this.player.speed = 16;
  }

  /**
   * Neue Runde vorbereiten und Countdown starten.
   * @param {object} opts { seed, raceId, party, countdown (s) }
   */
  start({ seed = `${Date.now()}-${Math.random()}`, raceId = null, party = null, countdown = CONFIG.countdownSolo } = {}) {
    this.#clearRun();
    this.#resetRun();
    this.rng = createRng(seed);
    this.seed = seed;
    this.raceId = raceId;
    this.party = party;
    this.rowsUntilEvent = this.rng.int(CONFIG.eventFirstRows[0], CONFIG.eventFirstRows[1]);
    this.nextBossRow = CONFIG.bossFirstRow;

    // Auto-Sonderfähigkeiten
    if (this.car.perk === 'startShield') this.#setShield(true);
    if (this.car.perk === 'nitroStart') this.nitro = 0.5;

    // Straße ist beim Start schon belebt: Reihen bis zum Spawnpunkt vorbelegen
    for (let z = CONFIG.firstRowZ; z > CONFIG.spawnZ; z -= this.nextRowSpacing) this.#spawnRow(z);

    this.state = 'countdown';
    this.countdown = countdown;
    this.lastCountdownValue = null;
    this.player.speed = 0;
    this.launching = true;
  }

  changeLane(direction) {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.player.lane = clamp(this.player.lane + direction, 0, LANE_COUNT - 1);
  }

  setGas(on) { this.player.gas = on; }
  setBrake(on) { this.player.brake = on; }

  /** Nitro zünden (mindestens 30 % Füllung). */
  triggerNitro() {
    if (this.state !== 'playing' || this.nitroActive || this.nitro < CONFIG.nitroMinToStart) return false;
    this.nitroActive = true;
    this.nitroUses += 1;
    this.vehicle.setNitro(true);
    this.audio.play('nitro');
    this.events.onNitro?.(true);
    return true;
  }

  /** Aktive Fähigkeit des Autos (Taste F/E). Gibt true zurück, wenn sie gezündet hat. */
  useAbility() {
    const a = this.car.ability;
    if (!a || this.state !== 'playing' || this.abilityCooldown > 0 || this.abilityTime > 0) return false;
    this.abilityCooldown = a.cooldown;
    this.abilityTime = a.duration;
    tmpPos.set(this.player.x, 1, 0);

    switch (a.id) {
      case 'boost':
        this.nitro = Math.max(this.nitro, 0.6);
        break;
      case 'pulse':
        // Alle Münzen der nächsten 50 m fliegen zum Auto – egal in welcher Spur
        for (const coin of this.coins) if (coin.active && coin.z > -50 && coin.z < 3) coin.pulled = true;
        break;
      case 'repair':
        this.#setShield(true);
        break;
      default:
        break; // ram, phase, siren, overdrive wirken über abilityTime
    }
    this.effects.pickupFlash(tmpPos, '#ffffff');
    this.audio.play(a.id === 'siren' ? 'nitro' : 'powerup');
    this.events.onAbility?.(a);
    return true;
  }

  #abilityIs(id) {
    return this.abilityTime > 0 && this.car.ability?.id === id;
  }

  /** Nach Fähigkeiten, in denen man durch Autos fährt: kurze Schonzeit, damit man nicht in einem Wagen "aufwacht". */
  #endAbility() {
    const id = this.car.ability?.id;
    if (id === 'phase' || id === 'hop') this.shieldGrace = Math.max(this.shieldGrace, 0.6);
  }

  /** Höhe beim Schwebesprung (Phantom X): rauf in einem Bogen, kurz oben, wieder runter. */
  #hopHeight() {
    if (!this.#abilityIs('hop')) return 0;
    const duration = this.car.ability.duration;
    const t = clamp(1 - this.abilityTime / duration, 0, 1);
    return 3.9 * Math.pow(Math.sin(Math.PI * t), 0.55);
  }

  /** Fahren durch andere Autos ohne Schaden und ohne sie wegzuschleudern (Phasensprung, Schwebesprung). */
  get #ghost() {
    return this.#abilityIs('phase') || this.#abilityIs('hop');
  }

  /** Tempo des Verkehrs – bei aktiver Sirene fährt er deutlich schneller weg. */
  get #trafficSpeed() {
    return this.baseSpeed * CONFIG.trafficFactor * (this.#abilityIs('siren') ? 2.4 : 1);
  }

  setDebugHitboxes(on) {
    this.debugHitboxes = on;
    for (const entity of [this.player, ...this.enemies]) {
      if (on && !entity.helper) {
        entity.helper = new THREE.Box3Helper(entity.box, 0xffff00);
        this.scene.add(entity.helper);
      } else if (!on && entity.helper) {
        this.#removeHelper(entity);
      }
    }
  }

  /** Scroll-Tempo der Welt (für world.update). */
  get worldSpeed() {
    return this.player.speed;
  }

  /** Daten für das HUD. */
  hud() {
    return {
      distance: this.distance,
      kmh: this.player.speed * 3.6,
      level: this.level,
      worldName: WORLDS[this.worldIndex].name,
      coins: this.coinsCollected + this.nearMissCoins + this.smashCoins,
      nitro: this.nitro,
      nitroActive: this.nitroActive,
      nitroReady: this.nitro >= CONFIG.nitroMinToStart,
      combo: this.combo,
      comboFrac: this.combo > 0 ? clamp(this.comboTimer / CONFIG.comboWindow, 0, 1) : 0,
      shield: this.shieldActive,
      magnet: this.magnetTimer,
      double: this.doubleTimer,
      ability: this.car.ability ? {
        id: this.car.ability.id,
        name: this.car.ability.name,
        ready: this.abilityCooldown <= 0 && this.abilityTime <= 0,
        active: this.abilityTime > 0,
        cooldownFrac: this.car.ability.cooldown > 0 ? clamp(this.abilityCooldown / this.car.ability.cooldown, 0, 1) : 0,
      } : null,
    };
  }

  /** Daten für die Party (Live-Position für die anderen). */
  liveState() {
    return {
      distance: this.distance,
      x: this.player.x,
      speed: this.player.speed,
      level: this.level,
      alive: this.state === 'playing' || this.state === 'countdown',
      nitro: this.nitroActive,
    };
  }

  // =========================================================================
  // Haupt-Update
  // =========================================================================
  update(dt) {
    switch (this.state) {
      case 'idle':
        this.#updateSteering(dt);
        break;
      case 'countdown':
        this.#updateCountdown(dt);
        break;
      case 'playing':
        this.#updatePlaying(dt);
        break;
      case 'crashed':
        this.#updateCrash(dt);
        break;
      default:
        break;
    }

    this.#updateDebris(dt);
    this.#updatePowerupVisuals(dt);
    this.#updateCoinInstances(dt);
    this.#updateGhosts(dt);

    // Fahrzeug-Animationen (Räder, Flammen, Blaulicht …)
    this.vehicle.update(dt, this.player.speed);
    const trafficSpeed = this.#trafficSpeed;
    for (const e of this.enemies) e.vehicle.update(dt, trafficSpeed);

    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  // =========================================================================
  // Zustände
  // =========================================================================
  #updateCountdown(dt) {
    this.countdown -= dt;
    const value = this.countdown > 0 ? Math.ceil(this.countdown) : 0;
    if (value !== this.lastCountdownValue) {
      this.lastCountdownValue = value;
      if (value > 0) {
        this.events.onCountdown?.(value);
        this.audio.play('countdown');
      }
    }
    this.#updateSteering(dt);
    if (this.countdown <= 0) {
      this.state = 'playing';
      this.events.onCountdown?.('LOS!');
      this.audio.play('go');
      this.events.onStart?.();
    }
  }

  #updatePlaying(dt) {
    // 1) Schwierigkeit über die Zeit
    this.elapsed += dt;
    this.difficulty = Math.min(this.elapsed / CONFIG.difficultyTime, 1);
    this.baseSpeed = lerp(CONFIG.startSpeed, CONFIG.maxBaseSpeed, this.difficulty);

    const level = Math.min(CONFIG.maxLevel, 1 + Math.floor(this.elapsed / CONFIG.levelTime));
    if (level > this.level) {
      this.level = level;
      const worldIndex = worldIndexForLevel(level);
      if (worldIndex !== this.worldIndex) {
        this.worldIndex = worldIndex;
        this.events.onWorld?.(worldIndex);
      }
      this.events.onLevel?.(level);
    }

    // 2) Timer der Power-ups und Kombo
    this.#updateTimers(dt);

    // 3) Tempo und Lenkung
    this.#updateSpeed(dt);
    this.#updateSteering(dt);

    // 4) Strecke
    const dz = this.player.speed * dt;
    this.distance += dz;

    // 5) Verkehr: neue Reihe exakt im Sollabstand
    if (this.lastRowZ - CONFIG.spawnZ >= this.nextRowSpacing) {
      this.#spawnRow(this.lastRowZ - this.nextRowSpacing);
    }
    const relative = this.player.speed - this.#trafficSpeed;
    this.#moveTraffic(dt, relative);
    this.#updatePickups(dt, relative);
    this.#checkCollisions();
  }

  #updateCrash(dt) {
    this.crashTime += dt;
    const p = this.player;
    p.speed = approach(p.speed, 0, 40 * dt);
    p.vx *= Math.exp(-6 * dt);
    p.spin *= Math.exp(-2.2 * dt);
    const obj = this.vehicle.object;
    obj.rotation.y += p.spin * dt;
    obj.rotation.z = Math.sin(this.crashTime * 18) * 0.07 * Math.max(0, 1 - this.crashTime / CONFIG.crashDuration);
    obj.position.y = Math.max(0, Math.sin(Math.min(this.crashTime * 5, Math.PI)) * 0.6);

    // Verkehr vor dem Wrack fährt weiter, dahinter bleibt er stehen
    const relative = p.speed - this.#trafficSpeed;
    for (const e of this.enemies) {
      if (e.object.position.z < 0) e.object.position.z += relative * dt;
      this.#updateEnemyBox(e);
    }

    if (this.crashTime >= CONFIG.crashDuration) {
      this.state = 'over';
      this.events.onOver?.(this.#result());
    }
  }

  // =========================================================================
  // Spieler
  // =========================================================================
  #updateSpeed(dt) {
    const p = this.player;
    const stats = this.car.stats;
    const overdrive = this.#abilityIs('overdrive') ? 1.3 : 1;
    const maxNormal = this.baseSpeed * CONFIG.boostFactor * stats.speed * overdrive;
    const minSpeed = this.baseSpeed * CONFIG.brakeFactor;

    if (this.launching) {
      // Start aus dem Stand nach dem Countdown: automatisch hochbeschleunigen
      p.speed += CONFIG.acceleration * (p.gas ? 1.6 : 1.3) * dt;
      if (p.speed >= minSpeed) this.launching = false;
    } else if (this.nitroActive) {
      p.speed = approach(p.speed, maxNormal * CONFIG.nitroSpeedFactor, 45 * dt);
    } else if (p.gas && !p.brake) {
      p.speed += CONFIG.acceleration * overdrive * dt;
    } else if (p.brake && !p.gas) {
      p.speed -= CONFIG.braking * dt;
    } else {
      p.speed = approach(p.speed, this.baseSpeed, CONFIG.coastRate * dt);
    }

    if (!this.launching) {
      // Nach Nitro sanft auf das normale Maximum abbremsen statt hart zu kappen
      if (!this.nitroActive && p.speed > maxNormal) p.speed = approach(p.speed, maxNormal, 30 * dt);
      p.speed = Math.max(p.speed, minSpeed); // Untergrenze wandert mit dem Grundtempo mit
    }
    this.vehicle.setBrake(p.brake && !p.gas);
  }

  /** Kritisch gedämpfte Feder für den Spurwechsel (wie Version 1). */
  #updateSteering(dt) {
    const p = this.player;
    const k = CONFIG.steerStiffness * this.car.stats.handling;
    const targetX = LANE_X[p.lane];
    const accel = k * k * (targetX - p.x) - 2 * k * p.vx;
    p.vx += accel * dt;
    p.x += p.vx * dt;

    const obj = this.vehicle.object;
    obj.position.x = p.x;
    obj.rotation.y = clamp(-p.vx * 0.012, -0.35, 0.35); // Nase in Lenkrichtung
    obj.rotation.z = clamp(p.vx * 0.003, -0.08, 0.08);  // Karosserie neigt sich nach außen
    if (this.state !== 'crashed') obj.position.y = this.#hopHeight();
  }

  #updatePlayerBox() {
    this.player.box.setFromCenterAndSize(tmpCenter.set(this.player.x, PLAYER_HIT.y / 2, 0), PLAYER_HIT);
  }

  #updateTimers(dt) {
    // Nitro
    if (this.nitroActive) {
      this.nitro -= dt / (CONFIG.nitroDuration * this.car.stats.nitro);
      if (this.nitro <= 0) {
        this.nitro = 0;
        this.nitroActive = false;
        this.nitroGrace = CONFIG.nitroGrace;
        this.vehicle.setNitro(false);
        this.events.onNitro?.(false);
      }
    } else {
      this.nitro = Math.min(1, this.nitro + CONFIG.nitroFillPassive * dt);
      this.nitroGrace = Math.max(0, this.nitroGrace - dt);
    }
    this.shieldGrace = Math.max(0, this.shieldGrace - dt);
    this.magnetTimer = Math.max(0, this.magnetTimer - dt);
    this.doubleTimer = Math.max(0, this.doubleTimer - dt);
    this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    if (this.abilityTime > 0) {
      this.abilityTime = Math.max(0, this.abilityTime - dt);
      if (this.abilityTime === 0) this.#endAbility();
    }
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  get #invulnerable() {
    return this.nitroActive || this.nitroGrace > 0 || this.shieldGrace > 0 || this.#abilityIs('ram');
  }

  #setShield(on) {
    this.shieldActive = on;
    this.effects.setShield(on ? this.vehicle.object : null);
  }

  // =========================================================================
  // Verkehr
  // =========================================================================

  /**
   * Eine Reihe aus 1–2 Gegnern. Fairness-Regeln (siehe Version 1):
   * mindestens eine Spur bleibt frei, und von jeder freien Spur der vorigen
   * Reihe aus reicht ein einziger Spurwechsel für die nächste.
   * Alle spielrelevanten Zufallszahlen kommen aus this.rng (Seed) – so haben
   * alle Teilnehmer eines Party-Rennens dieselben Verkehrsmuster.
   */
  #spawnRow(z) {
    const rng = this.rng;
    this.rowIndex += 1;
    const ev = this.#advanceEvent(z);
    const isBoss = this.rowIndex === this.nextBossRow;
    if (isBoss) this.nextBossRow += rng.int(CONFIG.bossGapRows[0], CONFIG.bossGapRows[1]);

    this.safeLane = clamp(this.safeLane + rng.int(-1, 1), 0, LANE_COUNT - 1);

    let doubleChance = lerp(CONFIG.doubleChanceStart, CONFIG.doubleChanceEnd, this.difficulty);
    if (ev === 'rush') doubleChance = Math.min(0.85, doubleChance + CONFIG.rushDoubleBonus);
    let count = rng.chance(doubleChance) ? 2 : 1;
    if (count === 2 && this.freeLanes.some((lane) => Math.abs(lane - this.safeLane) > 1)) count = 1;
    if (isBoss) count = 1; // Der Konvoi blockiert genau eine Spur

    const blocked = rng.shuffle(ALL_LANES.filter((i) => i !== this.safeLane)).slice(0, count);
    for (const lane of blocked) this.#spawnEnemy(lane, z, isBoss ? 'boss' : null);
    this.freeLanes = ALL_LANES.filter((i) => !blocked.includes(i));
    if (isBoss) this.eventMarkers.push({ z, type: 'boss', phase: 'start' }); // Warnung kurz vor dem Konvoi

    // Belohnungen liegen immer in der garantiert freien Spur
    if (ev === 'gold') {
      this.#spawnCoinLine(this.safeLane, z, CONFIG.goldCoinsPerLine);
    } else if (rng.chance(CONFIG.powerupChance)) {
      this.#spawnPowerup(rng.weighted(POWERUP_WEIGHTS).type, this.safeLane, z);
    } else if (rng.chance(CONFIG.coinLineChance)) {
      this.#spawnCoinLine(this.safeLane, z);
    }

    this.lastRowZ = z;
    let base = lerp(CONFIG.rowSpacingStart, CONFIG.rowSpacingEnd, this.difficulty);
    if (ev === 'rush') base *= CONFIG.rushSpacingFactor;
    let spacing = base * (1 + rng.next() * CONFIG.rowSpacingJitter);
    // Fairness: Vor und hinter dem 15 m langen Konvoi extra Platz zum Spurwechseln
    if (isBoss || this.rowIndex + 1 === this.nextBossRow) spacing += CONFIG.bossExtraSpacing;
    this.nextRowSpacing = spacing;
  }

  /**
   * Ereignisplan: zählt Reihen (nicht Sekunden), damit alle Teilnehmer eines Party-Rennens
   * dasselbe erleben. Gibt das Ereignis zurück, das für die neue Reihe gilt (oder null).
   */
  #advanceEvent(z) {
    const rng = this.rng;
    if (this.event) {
      this.event.rowsLeft -= 1;
      if (this.event.rowsLeft < 0) {
        this.eventMarkers.push({ z, type: this.event.type, phase: 'end' });
        this.event = null;
        this.rowsUntilEvent = rng.int(CONFIG.eventGapRows[0], CONFIG.eventGapRows[1]);
      }
    } else {
      this.rowsUntilEvent -= 1;
      if (this.rowsUntilEvent <= 0) {
        const type = rng.chance(0.5) ? 'gold' : 'rush';
        this.event = { type, rowsLeft: rng.int(CONFIG.eventLengthRows[0], CONFIG.eventLengthRows[1]) };
        this.eventMarkers.push({ z, type, phase: 'start' });
      }
    }
    return this.event ? this.event.type : null;
  }

  #spawnEnemy(lane, z, forceType = null) {
    // rng immer gleich oft ziehen, damit der Seed-Verlauf stabil bleibt
    const def = forceType ? TRAFFIC_BY_TYPE[forceType] : this.rng.weighted(TRAFFIC_SPAWNABLE);
    const paint = this.rng.pick(TRAFFIC_COLORS);
    const color = def.type === 'taxi' ? '#f2c200' : def.type === 'police' ? '#f4f6fa' : paint;
    const vehicle = def.type === 'boss' ? createConvoy() : createTrafficVehicle(def.type, color);
    vehicle.object.position.set(LANE_X[lane], 0, z);
    vehicle.setHeadlights(this.night);
    this.scene.add(vehicle.object);

    const size = new THREE.Vector3(...TRAFFIC_BY_TYPE[def.type].size);
    const enemy = {
      vehicle,
      object: vehicle.object,
      type: def.type,
      size,
      hitSize: size.clone().multiplyScalar(CONFIG.hitboxScale),
      box: new THREE.Box3(),
      helper: null,
      passed: false,
      minClearance: Infinity, // kleinster seitlicher Abstand beim Vorbeifahren
    };
    this.#updateEnemyBox(enemy);
    if (this.debugHitboxes) {
      enemy.helper = new THREE.Box3Helper(enemy.box, 0xffff00);
      this.scene.add(enemy.helper);
    }
    this.enemies.push(enemy);
  }

  #updateEnemyBox(enemy) {
    const p = enemy.object.position;
    enemy.box.setFromCenterAndSize(tmpCenter.set(p.x, enemy.size.y / 2, p.z), enemy.hitSize);
  }

  #removeEnemy(index) {
    const enemy = this.enemies[index];
    this.scene.remove(enemy.object);
    enemy.vehicle.dispose();
    this.#removeHelper(enemy);
    this.enemies.splice(index, 1);
  }

  #removeHelper(entity) {
    if (!entity.helper) return;
    this.scene.remove(entity.helper);
    entity.helper.geometry.dispose();
    entity.helper.material.dispose();
    entity.helper = null;
  }

  #moveTraffic(dt, relative) {
    const dz = relative * dt;
    this.lastRowZ += dz;
    this.#announceEvents(dz);
    const halfPlayerL = PLAYER_VISUAL.z / 2;
    const halfPlayerW = PLAYER_VISUAL.x / 2;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const pos = e.object.position;
      pos.z += dz;

      if (pos.z > CONFIG.despawnZ || pos.z < CONFIG.spawnZ - 80) {
        this.#removeEnemy(i);
        continue;
      }

      // Beinahe-Unfall: kleinster Seitenabstand, solange wir auf gleicher Höhe sind
      const halfL = e.size.z / 2;
      if (Math.abs(pos.z) < halfL + halfPlayerL) {
        const clearance = Math.abs(pos.x - this.player.x) - (e.size.x / 2 + halfPlayerW);
        if (clearance < e.minClearance) e.minClearance = clearance;
      }

      // Überholt: Front des Gegners hinter unserem Heck
      if (!e.passed && pos.z - halfL > halfPlayerL) {
        e.passed = true;
        this.overtakes += 1;
        if (e.minClearance < CONFIG.nearMissClearance) this.#nearMiss(e);
        if (e.type === 'boss') {
          this.coinsCollected += CONFIG.bossPassCoins;
          this.events.onBoss?.({ phase: 'passed', coins: CONFIG.bossPassCoins });
        }
      }

      this.#updateEnemyBox(e);
    }
  }

  /** Kündigt Ereignisse an, sobald der Spieler ihnen nahe kommt (die Reihen entstehen ja schon 235 m voraus). */
  #announceEvents(dz) {
    for (let i = this.eventMarkers.length - 1; i >= 0; i--) {
      const m = this.eventMarkers[i];
      m.z += dz;
      if (m.z > -75) {
        this.eventMarkers.splice(i, 1);
        if (m.type !== 'boss') this.liveEvent = m.phase === 'start' ? m.type : null;
        this.events.onEvent?.({ type: m.type, phase: m.phase });
      }
    }
  }

  #nearMiss(enemy) {
    this.nearMisses += 1;
    this.combo = this.combo > 0 ? Math.min(this.combo + 1, CONFIG.maxCombo) : 1;
    this.comboTimer = CONFIG.comboWindow;
    const coins = CONFIG.nearMissCoins * this.combo * (this.liveEvent === 'rush' ? CONFIG.rushNearMissFactor : 1);
    this.nearMissCoins += coins;

    const fill = CONFIG.nitroFillNearMiss * (this.car.perk === 'nearMissPlus' ? 1.4 : 1);
    this.nitro = Math.min(1, this.nitro + fill);

    const side = Math.sign(enemy.object.position.x - this.player.x) || 1;
    tmpPos.set(this.player.x + side * 1.1, 0.6, -0.5);
    this.effects.sparks(tmpPos, { count: 18 + this.combo * 6 });
    this.audio.play(this.combo > 1 ? 'combo' : 'nearMiss', { pitch: 1 + (this.combo - 1) * 0.08, pan: side * 0.6 });
    this.events.onNearMiss?.({ combo: this.combo, coins });
  }

  #checkCollisions() {
    this.#updatePlayerBox();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.box.intersectsBox(this.player.box)) continue;
      if (this.#ghost) continue; // Phasen-/Schwebesprung: einfach hindurch

      if (this.#invulnerable) {
        this.#smash(i);
      } else if (this.shieldActive) {
        this.#setShield(false);
        this.shieldGrace = CONFIG.shieldGrace;
        this.effects.shieldBreak(this.vehicle.object.position);
        this.audio.play('shieldBreak');
        this.events.onShieldBreak?.();
        this.#smash(i);
      } else {
        this.#crash(e);
        return;
      }
    }
  }

  /** Fahrzeug wegrammen: fliegt in hohem Bogen davon. */
  #smash(index) {
    const e = this.enemies[index];
    this.enemies.splice(index, 1);
    this.#removeHelper(e);

    const side = Math.sign(e.object.position.x - this.player.x) || (Math.random() < 0.5 ? -1 : 1);
    e.velocity = new THREE.Vector3(side * (7 + Math.random() * 7), 9 + Math.random() * 6, -(12 + Math.random() * 14));
    e.angular = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10, side * (4 + Math.random() * 6));
    e.life = 1.8;
    this.debris.push(e);

    this.smashed += 1;
    const coins = (e.type === 'boss' ? CONFIG.bossSmashCoins : CONFIG.smashCoins) * (this.car.perk === 'smashPlus' ? 2 : 1);
    this.smashCoins += coins;
    this.shake = Math.min(1, this.shake + 0.45);
    tmpPos.copy(e.object.position).setY(1);
    this.effects.explosion(tmpPos, { color: '#ff8a2a', scale: e.type === 'boss' ? 2.2 : e.type === 'truck' ? 1.5 : 1 });
    this.audio.play('smash');
    this.events.onSmash?.({ coins });
  }

  #updateDebris(dt) {
    const relative = this.player.speed - this.#trafficSpeed;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const o = d.object;
      d.velocity.y -= GRAVITY * dt;
      o.position.x += d.velocity.x * dt;
      o.position.y = Math.max(-2, o.position.y + d.velocity.y * dt);
      o.position.z += (d.velocity.z + relative) * dt;
      o.rotation.x += d.angular.x * dt;
      o.rotation.y += d.angular.y * dt;
      o.rotation.z += d.angular.z * dt;
      d.life -= dt;
      if (d.life <= 0 || o.position.z > CONFIG.despawnZ + 10) {
        this.scene.remove(o);
        d.vehicle.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  #crash(enemy) {
    this.state = 'crashed';
    this.crashTime = 0;
    this.shake = 1;
    this.player.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 3);
    this.vehicle.setNitro(false);
    this.vehicle.setBrake(true);
    tmpPos.set((this.player.x + enemy.object.position.x) / 2, 0.8, enemy.object.position.z + enemy.size.z / 2);
    this.effects.explosion(tmpPos, { color: '#ff4a2a', scale: 0.8 });
    this.effects.sparks(tmpPos, { count: 60 });
    this.audio.play('crash');
    this.events.onCrash?.();
  }

  // =========================================================================
  // Münzen & Power-ups
  // =========================================================================
  #createCoinPool() {
    const geometry = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 28);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffc93c, metalness: 0.95, roughness: 0.22,
      emissive: 0xff9d00, emissiveIntensity: 0.45,
    });
    this.coinMesh = new THREE.InstancedMesh(geometry, material, MAX_COINS);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.castShadow = true;
    this.scene.add(this.coinMesh);
    this.coins = Array.from({ length: MAX_COINS }, () => ({ active: false, x: 0, y: 1, z: 0, pulled: false }));
    this.coinSpin = 0;

    // Power-up-Modelle: leuchtender Kristall mit Ring
    this.powerupGeometry = new THREE.OctahedronGeometry(0.55, 0);
    this.powerupRingGeometry = new THREE.TorusGeometry(0.95, 0.06, 8, 40);
    this.powerupMaterials = Object.fromEntries(Object.entries(POWERUPS).map(([type, def]) => [type, {
      core: new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 2.6, roughness: 0.3, metalness: 0.2 }),
      ring: new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    }]));
  }

  #spawnCoinLine(lane, z, length = CONFIG.coinsPerLine) {
    const n = length;
    for (let i = 0; i < n; i++) {
      const coin = this.coins.find((c) => !c.active);
      if (!coin) return;
      coin.active = true;
      coin.pulled = false;
      coin.x = LANE_X[lane];
      coin.y = 1.0;
      coin.z = z + (i - (n - 1) / 2) * CONFIG.coinSpacing;
    }
  }

  #spawnPowerup(type, lane, z) {
    const group = new THREE.Group();
    const mats = this.powerupMaterials[type];
    const core = new THREE.Mesh(this.powerupGeometry, mats.core);
    const ring = new THREE.Mesh(this.powerupRingGeometry, mats.ring);
    core.castShadow = true;
    group.add(core, ring);
    group.position.set(LANE_X[lane], 1.2, z);
    this.scene.add(group);
    this.powerups.push({ type, group, core, ring, phase: Math.random() * Math.PI * 2 });
  }

  #updatePickups(dt, relative) {
    const dz = relative * dt;
    const px = this.player.x;
    const magnet = this.magnetTimer > 0 || this.car.perk === 'magnet';

    for (const coin of this.coins) {
      if (!coin.active) continue;
      const prevZ = coin.z;
      coin.z += dz;

      // Magnet: Münzen in Reichweite fliegen zum Auto
      if (magnet && !coin.pulled && Math.abs(coin.x - px) <= CONFIG.magnetRange && coin.z > -18 && coin.z < 3) coin.pulled = true;
      if (coin.pulled) {
        const t = smoothing(14, dt);
        coin.x = lerp(coin.x, px, t);
        coin.z = lerp(coin.z, 0, t);
      }

      // Überstrichener Weg dieses Frames (prevZ … z) statt nur der Endposition –
      // sonst könnte eine Münze bei niedriger Bildrate "durchrutschen".
      const reached = prevZ <= 1.8 && coin.z >= -1.8;
      if (reached && Math.abs(coin.x - px) < 1.4) {
        coin.active = false;
        const value = this.doubleTimer > 0 ? 2 : 1;
        this.coinsCollected += value;
        tmpPos.set(coin.x, coin.y, coin.z);
        this.effects.coinBurst(tmpPos);
        this.audio.play('coin', { pitch: 1 + Math.random() * 0.08 });
        this.events.onCoin?.(value);
      } else if (coin.z > CONFIG.despawnZ || coin.z < CONFIG.spawnZ - 80) {
        coin.active = false;
      }
    }

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      const prevZ = p.group.position.z;
      p.group.position.z += dz;
      const z = p.group.position.z;
      if (prevZ <= 2 && z >= -2 && Math.abs(p.group.position.x - px) < 1.5) {
        this.#collectPowerup(p.type, p.group.position);
        this.#removePowerup(i);
      } else if (z > CONFIG.despawnZ || z < CONFIG.spawnZ - 80) {
        this.#removePowerup(i);
      }
    }
  }

  #collectPowerup(type, position) {
    switch (type) {
      case 'nitro': this.nitro = 1; break;
      case 'shield': this.#setShield(true); break;
      case 'magnet': this.magnetTimer = CONFIG.magnetTime; break;
      case 'double': this.doubleTimer = CONFIG.doubleCoinsTime; break;
      default: break;
    }
    this.effects.pickupFlash(position, POWERUPS[type].color);
    this.audio.play(type === 'shield' ? 'shieldUp' : 'powerup');
    this.events.onPowerup?.(type);
  }

  #removePowerup(index) {
    const p = this.powerups[index];
    this.scene.remove(p.group);
    this.powerups.splice(index, 1);
  }

  #updatePowerupVisuals(dt) {
    for (const p of this.powerups) {
      p.phase += dt;
      p.core.rotation.y += dt * 2.2;
      p.core.rotation.x += dt * 0.9;
      p.ring.rotation.x = Math.PI / 2 + Math.sin(p.phase * 1.3) * 0.4;
      p.ring.rotation.y += dt * 1.5;
      p.group.position.y = 1.2 + Math.sin(p.phase * 3) * 0.18;
    }
  }

  #updateCoinInstances(dt) {
    this.coinSpin += dt * 3.2;
    tmpQuat.setFromAxisAngle(Y_AXIS, this.coinSpin).multiply(COIN_BASE_ROTATION);
    for (let i = 0; i < MAX_COINS; i++) {
      const c = this.coins[i];
      if (c.active) {
        tmpPos.set(c.x, c.y + Math.sin(this.coinSpin + c.z * 0.3) * 0.12, c.z);
        tmpScale.set(1, 1, 1);
      } else {
        tmpPos.set(0, -50, 0);
        tmpScale.set(0, 0, 0);
      }
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.coinMesh.setMatrixAt(i, tmpMatrix);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // =========================================================================
  // Geisterautos der Party-Mitglieder
  // =========================================================================

  /**
   * @param {Array} members  [{ id, name, car, color, distance, x, speed, alive, lastSeen }]
   *   (lastSeen = performance.now() des letzten Updates; nur andere Spieler übergeben)
   */
  setGhosts(members) {
    this.ghostInput = members;
  }

  #updateGhosts(dt) {
    const input = this.ghostInput || [];
    const racing = this.state === 'playing' || this.state === 'crashed' || this.state === 'countdown';
    const seen = new Set();
    const now = performance.now();

    for (const m of input) {
      if (!m || !m.id) continue;
      seen.add(m.id);
      let ghost = this.ghosts.get(m.id);
      if (!ghost || ghost.car !== m.car || ghost.color !== m.color) {
        if (ghost) this.#removeGhost(m.id);
        const vehicle = createGhostCar(m.car, m.color);
        const tag = createNameTag(m.name, m.color);
        tag.position.set(0, 2.9, 0);
        vehicle.object.add(tag);
        vehicle.object.visible = false;
        this.scene.add(vehicle.object);
        ghost = { vehicle, tag, car: m.car, color: m.color, name: m.name, x: m.x ?? 0, z: 0 };
        this.ghosts.set(m.id, ghost);
      }

      // Vorhersage: letzte bekannte Strecke + Tempo × Alter (max. 0,5 s)
      const age = Math.min(0.5, Math.max(0, (now - (m.lastSeen ?? now)) / 1000));
      const remoteDistance = (m.distance ?? 0) + (m.alive ? (m.speed ?? 0) * age : 0);
      const targetZ = -(remoteDistance - this.distance);
      ghost.z = Math.abs(ghost.z - targetZ) > 30 ? targetZ : lerp(ghost.z, targetZ, smoothing(10, dt));
      ghost.x = lerp(ghost.x, m.x ?? 0, smoothing(10, dt));

      const visible = racing && m.alive && ghost.z > CONFIG.spawnZ * 0.8 && ghost.z < 25;
      const obj = ghost.vehicle.object;
      obj.visible = visible;
      if (visible) {
        obj.position.set(ghost.x, 0, ghost.z);
        ghost.vehicle.update(dt, m.speed ?? 0);
      }
    }

    for (const id of this.ghosts.keys()) if (!seen.has(id)) this.#removeGhost(id);
  }

  #removeGhost(id) {
    const ghost = this.ghosts.get(id);
    if (!ghost) return;
    this.scene.remove(ghost.vehicle.object);
    ghost.tag.material?.map?.dispose();
    ghost.tag.material?.dispose();
    ghost.vehicle.dispose();
    this.ghosts.delete(id);
  }

  // =========================================================================
  // Runde zurücksetzen / Ergebnis
  // =========================================================================
  #resetRun() {
    this.rng = createRng(Date.now());
    this.seed = null;
    this.raceId = null;
    this.party = null;
    this.distance = 0;
    this.elapsed = 0;
    this.difficulty = 0;
    this.baseSpeed = CONFIG.startSpeed;
    this.level = 1;
    this.worldIndex = 0;
    this.safeLane = MIDDLE_LANE;
    this.freeLanes = [MIDDLE_LANE];
    this.lastRowZ = 0;
    this.nextRowSpacing = CONFIG.rowSpacingStart;

    this.coinsCollected = 0;
    this.nearMissCoins = 0;
    this.smashCoins = 0;
    this.nearMisses = 0;
    this.overtakes = 0;
    this.smashed = 0;
    this.nitroUses = 0;
    this.combo = 0;
    this.comboTimer = 0;

    this.nitro = 0;
    this.nitroActive = false;
    this.nitroGrace = 0;
    this.shieldActive = false;
    this.shieldGrace = 0;
    this.magnetTimer = 0;
    this.doubleTimer = 0;
    this.crashTime = 0;
    this.shake = 0;
    this.launching = false;

    // Ereignisse (Goldrausch, Stoßverkehr), Konvoi und aktive Fähigkeit
    this.rowIndex = 0;
    this.event = null;          // { type: 'gold' | 'rush', rowsLeft }
    this.rowsUntilEvent = 999;
    this.nextBossRow = 0;
    this.eventMarkers = [];     // Ereignisse, die noch angekündigt werden müssen
    this.liveEvent = null;      // Ereignis, in dem der Spieler gerade fährt
    this.abilityCooldown = 0;
    this.abilityTime = 0;

    const p = this.player;
    p.lane = MIDDLE_LANE;
    p.x = LANE_X[MIDDLE_LANE];
    p.vx = 0;
    p.speed = 0;
    p.spin = 0;
    p.gas = false;
    p.brake = false;
    if (this.vehicle) {
      this.vehicle.object.position.set(p.x, 0, 0);
      this.vehicle.object.rotation.set(0, 0, 0);
      this.vehicle.setNitro(false);
      this.vehicle.setBrake(false);
    }
    this.effects.setShield(null);
    this.#updatePlayerBox();
  }

  #clearRun() {
    for (let i = this.enemies.length - 1; i >= 0; i--) this.#removeEnemy(i);
    for (const d of this.debris) {
      this.scene.remove(d.object);
      d.vehicle.dispose();
    }
    this.debris.length = 0;
    for (let i = this.powerups.length - 1; i >= 0; i--) this.#removePowerup(i);
    for (const c of this.coins) c.active = false;
  }

  #result() {
    return {
      distance: this.distance,
      duration: this.elapsed,
      coinsCollected: this.coinsCollected,
      nearMisses: this.nearMisses,
      nearMissCoins: this.nearMissCoins,
      smashed: this.smashed,
      smashCoins: this.smashCoins,
      overtakes: this.overtakes,
      level: this.level,
      nitroUses: this.nitroUses,
      raceId: this.raceId,
      party: this.party,
      isPartyRace: Boolean(this.raceId) && !String(this.raceId).startsWith('daily-'),
      isDaily: Boolean(this.raceId) && String(this.raceId).startsWith('daily-'),
      seed: this.seed,
      car: this.carId,
    };
  }
}
