/*
 * audio.js – der komplette Sound wird im Browser erzeugt (Web Audio API),
 * es werden keine Audiodateien geladen.
 *
 * Aufbau:
 *   Motor  → engineGain ─┐
 *   Effekte → sfxGain   ─┼→ master → Limiter → Lautsprecher
 *   Musik  → musicGain  ─┘
 *
 * Vor der ersten Nutzeraktion darf kein Ton laufen (Browser-Regel), deshalb
 * sind alle Methoden vor unlock() wirkungslos.
 */

const TWO_PI = Math.PI * 2;

// Halbtöne → Frequenz (A4 = 440 Hz entspricht Halbton 0)
const hz = (semitone) => 440 * Math.pow(2, semitone / 12);

/**
 * Musikstücke: je Welt eine eigene Stimmung.
 * scale = Halbtöne relativ zum Grundton, pattern = Schrittmuster (16tel).
 */
const TRACKS = {
  menu:    { bpm: 96,  root: -17, scale: [0, 3, 5, 7, 10], kick: 'sparse', bass: 'soft',  arp: 'slow',  pad: true,  hats: 'soft' },
  meadow:  { bpm: 118, root: -12, scale: [0, 2, 4, 7, 9],  kick: 'four',   bass: 'pulse', arp: 'happy', pad: true,  hats: 'off' },
  canyon:  { bpm: 112, root: -14, scale: [0, 2, 3, 7, 8],  kick: 'rock',   bass: 'pulse', arp: 'slow',  pad: true,  hats: 'soft' },
  neon:    { bpm: 128, root: -16, scale: [0, 3, 5, 6, 10], kick: 'four',   bass: 'drive', arp: 'fast',  pad: false, hats: 'drive' },
  frost:   { bpm: 104, root: -10, scale: [0, 2, 3, 7, 10], kick: 'sparse', bass: 'soft',  arp: 'slow',  pad: true,  hats: 'soft' },
  inferno: { bpm: 136, root: -19, scale: [0, 1, 5, 7, 8],  kick: 'drive',  bass: 'drive', arp: 'fast',  pad: false, hats: 'drive' },
};

const KICK_PATTERNS = {
  four:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  drive:  [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0],
  rock:   [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0],
  sparse: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
};
const SNARE_PATTERN = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.paused = false;
    // volume = Gesamtlautstärke; musicVolume / sfxVolume / engineVolume regeln die drei Gruppen einzeln
    this.settings = { music: true, sfx: true, volume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, engineVolume: 0.6, muteInBackground: true };
    this.background = false; // true = Fenster im Hintergrund oder ohne Fokus

    this.trackName = null;
    this.pendingTrack = null;
    this.intensity = 0.5;
    this.step = 0;
    this.nextNoteTime = 0;
    this.schedulerId = null;

    this.engine = null;
    this.engineState = { active: false, speed: 0, maxSpeed: 100, throttle: 0.5, nitro: false };
  }

  // =========================================================================
  // Aufbau / Einstellungen
  // =========================================================================

  /** Nach der ersten Nutzeraktion aufrufen (Klick, Tastendruck). Mehrfach unschädlich. */
  unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended' && !this.#silenced) this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch (err) {
      return;
    }

    const now = this.ctx.currentTime;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-8, now);
    this.limiter.knee.setValueAtTime(6, now);
    this.limiter.ratio.setValueAtTime(12, now);
    this.limiter.attack.setValueAtTime(0.004, now);
    this.limiter.release.setValueAtTime(0.18, now);
    this.limiter.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.volume;
    this.master.connect(this.limiter);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.settings.sfx ? this.settings.sfxVolume : 0;
    this.sfxGain.connect(this.master);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    this.noiseBuffer = this.#createNoiseBuffer();
    this.#buildEngine();
    this.ready = true;

    if (!this.#silenced) this.ctx.resume().catch(() => {});
    if (this.pendingTrack !== null) {
      const track = this.pendingTrack;
      this.pendingTrack = null;
      this.setMusic(track);
    }
  }

  setSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.volume, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx ? this.settings.sfxVolume : 0, now, 0.05);
    this.#updateMusicGain();
    if (!this.settings.music) this.#stopScheduler();
    else if (this.trackName) this.#startScheduler();
    this.#applyBackground();
  }

  /**
   * Fenster im Hintergrund (anderer Tab, anderes Programm, minimiert)?
   * Ist "Im Hintergrund stumm" an, wird der komplette Ton angehalten – auch die Menümusik.
   * Zurück im Vordergrund läuft er nahtlos weiter.
   */
  setBackground(background) {
    this.background = Boolean(background);
    this.#applyBackground();
  }

  /** true = es soll gerade nichts zu hören sein, weil das Fenster im Hintergrund ist. */
  get #silenced() {
    return this.background && this.settings.muteInBackground;
  }

  #applyBackground() {
    if (!this.ready) return;
    if (this.#silenced) {
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.ready) return;
    this.#updateMusicGain();
    if (paused) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  // =========================================================================
  // Motor
  // =========================================================================
  #buildEngine() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 6;
    filter.connect(this.engineGain);

    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    mix.connect(filter);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const gain1 = ctx.createGain();
    gain1.gain.value = 0.5;
    osc1.connect(gain1).connect(mix);

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.detune.value = -12;
    const gain2 = ctx.createGain();
    gain2.gain.value = 0.28;
    osc2.connect(gain2).connect(mix);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    sub.connect(subGain).connect(mix);

    // Rauschen für Fahrtwind und Nitro
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.engineGain);

    osc1.start();
    osc2.start();
    sub.start();
    noise.start();

    this.engine = { osc1, osc2, sub, filter, noiseFilter, noiseGain };
  }

  /** Jeden Frame aufrufen – die Werte werden weich nachgeführt. */
  setEngine(state = {}) {
    this.engineState = { ...this.engineState, ...state };
    if (!this.ready || !this.engine || this.paused) return;
    const { active, speed, maxSpeed, throttle, nitro } = this.engineState;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.25);
      this.engine.noiseGain.gain.setTargetAtTime(0, now, 0.25);
      return;
    }

    const ratio = Math.min(1, Math.max(0, speed / Math.max(1, maxSpeed)));
    // "Gänge": die Tonhöhe steigt innerhalb eines Gangs und fällt beim Wechsel
    const gear = Math.min(5, Math.floor(ratio * 6));
    const inGear = ratio * 6 - gear;
    const base = 52 + gear * 6 + inGear * 46 + (nitro ? 28 : 0);

    this.engine.osc1.frequency.setTargetAtTime(base, now, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(base * 1.5, now, 0.06);
    this.engine.sub.frequency.setTargetAtTime(base * 0.5, now, 0.08);
    this.engine.filter.frequency.setTargetAtTime(420 + ratio * 2600 + throttle * 900 + (nitro ? 1800 : 0), now, 0.08);

    const engineLevel = this.settings.sfx ? (this.settings.engineVolume / 0.6) * (this.engineState.tunnel ? 1.4 : 1) : 0; // im Tunnel hallt der Motor lauter // 0,6 = Standard = unverändert
    const volume = (0.05 + ratio * 0.1 + throttle * 0.05) * engineLevel;
    this.engineGain.gain.setTargetAtTime(volume, now, 0.1);

    this.engine.noiseFilter.frequency.setTargetAtTime(700 + ratio * 2600, now, 0.1);
    this.engine.noiseGain.gain.setTargetAtTime((nitro ? 0.09 : 0.02 + ratio * 0.025) * engineLevel, now, 0.12);
  }

  // =========================================================================
  // Effekte
  // =========================================================================
  play(name, opts = {}) {
    if (!this.ready || !this.settings.sfx || this.paused || this.#silenced) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitch = opts.pitch ?? 1;
    const volume = opts.volume ?? 1;
    const out = this.#sfxOut(opts.pan ?? 0);

    switch (name) {
      case 'coin':
        this.#blip(out, 1180 * pitch, 0.07, 0.32 * volume, 'triangle');
        this.#blip(out, 1760 * pitch, 0.09, 0.26 * volume, 'triangle', 0.05);
        break;
      case 'nearMiss':
        this.#whoosh(out, 0.28, 0.35 * volume, 600, 2600);
        break;
      case 'combo':
        this.#whoosh(out, 0.24, 0.32 * volume, 800, 3200);
        this.#blip(out, 880 * pitch, 0.12, 0.22 * volume, 'square', 0.02);
        break;
      case 'crash':
        this.#noiseBurst(out, 0.55, 0.55 * volume, 'lowpass', 1400);
        this.#thump(out, 90, 0.45, 0.6 * volume);
        break;
      case 'smash':
        this.#noiseBurst(out, 0.32, 0.45 * volume, 'bandpass', 900);
        this.#thump(out, 130, 0.25, 0.45 * volume);
        break;
      case 'powerup':
        this.#arp(out, [0, 4, 7, 12], 587 * pitch, 0.055, 0.28 * volume, 'square');
        break;
      case 'shieldUp':
        this.#arp(out, [0, 7, 12], 523 * pitch, 0.08, 0.3 * volume, 'sine');
        break;
      case 'shieldBreak':
        this.#noiseBurst(out, 0.3, 0.4 * volume, 'highpass', 1800);
        this.#blip(out, 320, 0.2, 0.25 * volume, 'sawtooth');
        break;
      case 'nitro':
        this.#whoosh(out, 0.7, 0.5 * volume, 300, 5200);
        this.#blip(out, 180, 0.35, 0.3 * volume, 'sawtooth');
        break;
      case 'levelUp':
        this.#arp(out, [0, 4, 7], 659, 0.09, 0.3 * volume, 'triangle');
        break;
      case 'world':
        this.#arp(out, [0, 5, 9, 12], 523, 0.11, 0.3 * volume, 'triangle');
        break;
      case 'countdown':
        this.#blip(out, 880 * pitch, 0.13, 0.32 * volume, 'square');
        break;
      case 'go':
        this.#blip(out, 1320, 0.3, 0.4 * volume, 'square');
        this.#arp(out, [0, 7, 12], 880, 0.07, 0.3 * volume, 'square', 0.04);
        break;
      case 'click':
        this.#blip(out, 520, 0.045, 0.18 * volume, 'square');
        break;
      case 'buy':
        this.#arp(out, [0, 4, 7, 11], 523, 0.07, 0.3 * volume, 'triangle');
        break;
      case 'error':
        this.#blip(out, 200, 0.18, 0.3 * volume, 'square');
        this.#blip(out, 150, 0.22, 0.28 * volume, 'square', 0.09);
        break;
      case 'record':
        this.#arp(out, [0, 4, 7, 12, 16], 659, 0.08, 0.32 * volume, 'square');
        break;
      case 'mission':
        this.#arp(out, [0, 7, 12], 784, 0.07, 0.28 * volume, 'triangle');
        break;
      case 'emote':
        this.#blip(out, 990, 0.09, 0.2 * volume, 'sine');
        break;
      case 'join':
        this.#arp(out, [0, 5, 9], 440, 0.1, 0.25 * volume, 'sine');
        break;
      default:
        this.#blip(out, 440, 0.06, 0.15 * volume, 'sine');
        break;
    }
  }

  #sfxOut(pan) {
    if (!this.ctx.createStereoPanner) return this.sfxGain;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.sfxGain);
    // Panner nach ein paar Sekunden trennen (sonst sammeln sich Knoten an)
    setTimeout(() => panner.disconnect(), 4000);
    return panner;
  }

  #blip(out, frequency, duration, gain, type = 'sine', delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  #arp(out, semitones, baseFreq, step, gain, type, delay = 0) {
    semitones.forEach((semi, i) => {
      this.#blip(out, baseFreq * Math.pow(2, semi / 12), step * 1.8, gain, type, delay + i * step);
    });
  }

  #thump(out, frequency, duration, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, frequency * 0.35), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  #noiseBurst(out, duration, gain, filterType, frequency) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 0.3), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  #whoosh(out, duration, gain, fromFreq, toFreq) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(fromFreq, t);
    filter.frequency.exponentialRampToValueAtTime(toFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + duration * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  #createNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // =========================================================================
  // Musik (Schrittsequenzer mit Vorausplanung)
  // =========================================================================
  setMusic(track) {
    if (!this.ready) {
      this.pendingTrack = track;
      return;
    }
    if (track === this.trackName) return;
    this.trackName = track && TRACKS[track] ? track : null;
    this.step = 0;
    this.#updateMusicGain();
    if (this.trackName && this.settings.music) this.#startScheduler();
    else this.#stopScheduler();
  }

  setMusicIntensity(value) {
    this.intensity = Math.max(0, Math.min(1, value || 0));
    this.#updateMusicGain();
  }

  #updateMusicGain() {
    if (!this.ready) return;
    const wanted = this.trackName && this.settings.music && !this.paused
      ? (0.16 + this.intensity * 0.12) * (this.settings.musicVolume / 0.7) // 0,7 = Standard = unverändert
      : 0;
    this.musicGain.gain.setTargetAtTime(wanted, this.ctx.currentTime, 0.6);
  }

  #startScheduler() {
    if (this.schedulerId) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.schedulerId = setInterval(() => this.#schedule(), 25);
  }

  #stopScheduler() {
    if (!this.schedulerId) return;
    clearInterval(this.schedulerId);
    this.schedulerId = null;
  }

  #schedule() {
    const track = TRACKS[this.trackName];
    if (!track || !this.ready) return this.#stopScheduler();
    const stepLength = 60 / track.bpm / 4; // Sechzehntel
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.#playStep(track, this.step % 16, this.nextNoteTime);
      this.step++;
      this.nextNoteTime += stepLength;
    }
  }

  #playStep(track, step, time) {
    const bar = Math.floor(this.step / 16) % 4;
    const root = track.root;
    const scale = track.scale;
    const out = this.musicGain;

    if (KICK_PATTERNS[track.kick][step]) this.#drumKick(out, time);
    if (SNARE_PATTERN[step] && track.kick !== 'sparse') this.#drumSnare(out, time, 0.22);
    if (track.hats !== 'off') {
      const drive = track.hats === 'drive';
      if (drive ? step % 2 === 0 : step % 4 === 2) this.#drumHat(out, time, drive ? 0.12 : 0.08);
    }

    // Bass auf 1 und 3 (bzw. treibend auf jedem Achtel)
    const bassStep = track.bass === 'drive' ? step % 2 === 0 : step % 8 === 0;
    if (bassStep) {
      const degree = [0, 0, 3, 4][bar] ?? 0;
      const note = root + scale[degree % scale.length] - 12;
      this.#note(out, hz(note), time, track.bass === 'soft' ? 0.5 : 0.22, 0.16, 'sawtooth', 320);
    }

    // Arpeggio
    const arpEvery = track.arp === 'fast' ? 2 : track.arp === 'happy' ? 4 : 8;
    if (step % arpEvery === 0) {
      const index = (this.step / arpEvery + bar) % scale.length;
      const note = root + scale[Math.floor(index)] + 12;
      this.#note(out, hz(note), time, 0.22, 0.07 + this.intensity * 0.05, 'square', 2200);
    }

    // Flächenklang zu Beginn jedes Takts
    if (track.pad && step === 0) {
      const degree = [0, 0, 3, 4][bar] ?? 0;
      const note = root + scale[degree % scale.length];
      this.#note(out, hz(note), time, 1.9, 0.05, 'sawtooth', 900, true);
      this.#note(out, hz(note + 7), time, 1.9, 0.04, 'sawtooth', 900, true);
    }
  }

  #note(out, frequency, time, duration, gain, type, cutoff, slowAttack = false) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff * (0.6 + this.intensity * 0.7), time);
    const attack = slowAttack ? duration * 0.35 : 0.01;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, time + duration);
    osc.connect(filter).connect(g).connect(out);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  #drumKick(out, time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    osc.connect(g).connect(out);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  #drumSnare(out, time, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1900, time);
    filter.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    src.connect(filter).connect(g).connect(out);
    src.start(time);
    src.stop(time + 0.2);
  }

  #drumHat(out, time, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7200, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(filter).connect(g).connect(out);
    src.start(time);
    src.stop(time + 0.08);
  }

  dispose() {
    this.#stopScheduler();
    if (!this.ready) return;
    try {
      this.engine?.osc1.stop();
      this.engine?.osc2.stop();
      this.engine?.sub.stop();
      this.ctx.close();
    } catch (err) {
      /* egal */
    }
    this.ready = false;
  }
}
