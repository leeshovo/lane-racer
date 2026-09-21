// Tests für Einstellungen, Ton im Hintergrund, Tageszeiten und den Streckenplan der Bauwerke.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, SETTINGS_GROUPS, sanitizeSettings, WORLDS, WORLD_TIMES, TIME_LABELS, WORLD_HILL_COLOR, WORLD_BEND,
} from '../js/config.js';
import { defaultProfile, adoptSnapshot, snapshotOf } from '../js/storage.js';
import { planStructures } from '../js/structures.js';
import { AudioManager } from '../js/audio.js';

describe('Einstellungen', () => {
  const schemaKeys = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.key));

  it('jede Option der Oberfläche hat einen Standardwert und umgekehrt', () => {
    for (const key of schemaKeys) assert.ok(key in DEFAULT_SETTINGS, `${key} fehlt in DEFAULT_SETTINGS`);
    for (const key of Object.keys(DEFAULT_SETTINGS)) assert.ok(schemaKeys.includes(key), `${key} fehlt in SETTINGS_GROUPS`);
  });

  it('Optionen haben eindeutige Schlüssel, gültige Typen und Beschriftungen', () => {
    assert.equal(new Set(schemaKeys).size, schemaKeys.length);
    for (const item of SETTINGS_GROUPS.flatMap((g) => g.items)) {
      assert.ok(['switch', 'range', 'seg'].includes(item.type), `${item.key}: Typ`);
      assert.ok(item.label, `${item.key}: Beschriftung`);
      if (item.type === 'seg') assert.ok(item.options.length >= 2 && item.options.some(([v]) => v === DEFAULT_SETTINGS[item.key]), `${item.key}: Standard ist wählbar`);
      if (item.requires) assert.equal(typeof DEFAULT_SETTINGS[item.requires], 'boolean', `${item.key}: requires zeigt auf einen Schalter`);
    }
  });

  it('sanitizeSettings füllt Lücken und wirft Unsinn raus', () => {
    assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(sanitizeSettings('kaputt'), DEFAULT_SETTINGS);
    const s = sanitizeSettings({ music: 'ja', volume: 7, musicVolume: -3, sfxVolume: 'laut', shake: 'wild', unit: 'mph', bend: false, fps: true, unbekannt: 1 });
    assert.equal(s.music, true, 'kein Boolean → Standard');
    assert.equal(s.volume, 1, 'über 1 wird auf 1 begrenzt');
    assert.equal(s.musicVolume, 0, 'unter 0 wird auf 0 begrenzt');
    assert.equal(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 'kein Zahlenwert → Standard');
    assert.equal(s.shake, DEFAULT_SETTINGS.shake, 'unbekannte Auswahl → Standard');
    assert.equal(s.unit, 'mph');
    assert.equal(s.bend, false);
    assert.equal(s.fps, true);
    assert.equal('unbekannt' in s, false);
  });

  it('bleiben beim Übernehmen eines Cloud-Spielstands erhalten (sind Gerätesache)', () => {
    const local = defaultProfile();
    local.settings = sanitizeSettings({ volume: 0.2, bend: false });
    adoptSnapshot(local, snapshotOf(defaultProfile()));
    assert.equal(local.settings.volume, 0.2);
    assert.equal(local.settings.bend, false);
    assert.equal('settings' in snapshotOf(local), false);
  });
});

// ---------------------------------------------------------------------------
// Ton: Attrappe für die Web Audio API
// ---------------------------------------------------------------------------
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
function node() {
  const n = { connect: (d) => d, disconnect() {}, start() {}, stop() {}, type: '', buffer: null, loop: false };
  return new Proxy(n, {
    get(t, k) { if (!(k in t)) t[k] = param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
class FakeContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = node(); this.suspends = 0; this.resumes = 0; FakeContext.last = this; }
  resume() { this.state = 'running'; this.resumes++; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; this.suspends++; return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBiquadFilter() { return node(); }
  createBufferSource() { return node(); }
  createDynamicsCompressor() { return node(); }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
}

describe('Ton im Hintergrund', () => {
  const makeAudio = (settings = {}) => {
    globalThis.window = { AudioContext: FakeContext };
    const audio = new AudioManager();
    audio.setSettings(settings);
    audio.unlock();
    return { audio, ctx: FakeContext.last };
  };

  it('läuft im Vordergrund und hält an, sobald das Fenster im Hintergrund ist', async () => {
    const { audio, ctx } = makeAudio();
    assert.equal(ctx.state, 'running');
    audio.setBackground(true);
    assert.equal(ctx.state, 'suspended', 'Kontext angehalten → auch Menümusik verstummt');
    audio.setBackground(false);
    assert.equal(ctx.state, 'running', 'kommt nahtlos zurück');
    audio.dispose();
  });

  it('bleibt an, wenn "Im Hintergrund stumm" ausgeschaltet ist', () => {
    const { audio, ctx } = makeAudio({ muteInBackground: false });
    audio.setBackground(true);
    assert.equal(ctx.state, 'running');
    audio.dispose();
  });

  it('greift sofort, wenn die Option währenddessen umgestellt wird', () => {
    const { audio, ctx } = makeAudio({ muteInBackground: false });
    audio.setBackground(true);
    audio.setSettings({ muteInBackground: true });
    assert.equal(ctx.state, 'suspended');
    audio.setSettings({ muteInBackground: false });
    assert.equal(ctx.state, 'running');
    audio.dispose();
  });

  it('unlock() weckt den Ton nicht auf, solange das Fenster im Hintergrund ist', () => {
    const { audio, ctx } = makeAudio();
    audio.setBackground(true);
    const resumesBefore = ctx.resumes;
    audio.unlock(); // z. B. durch einen späten Klick oder Tastendruck
    assert.equal(ctx.state, 'suspended');
    assert.equal(ctx.resumes, resumesBefore);
    audio.dispose();
  });

  it('Effekte werden im Hintergrund gar nicht erst erzeugt', () => {
    const { audio, ctx } = makeAudio();
    let created = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { created++; return original(); };
    audio.setBackground(true);
    audio.play('coin');
    audio.play('crash');
    assert.equal(created, 0);
    audio.dispose();
  });

  it('ohne Web Audio passiert nichts (kein Absturz)', () => {
    globalThis.window = {};
    const audio = new AudioManager();
    audio.setBackground(true);
    audio.setSettings({ volume: 0.5 });
    audio.unlock();
    audio.play('coin');
    audio.setEngine({ active: true, speed: 30, maxSpeed: 100 });
    assert.equal(audio.ready, false);
  });
});

describe('Tageszeiten', () => {
  it('jede Welt kennt mindestens ihre Grundstimmung und nur bekannte Zeiten', () => {
    for (const world of WORLDS) {
      const times = WORLD_TIMES[world.id];
      assert.ok(times && times.length >= 1, `${world.id} hat Zeiten`);
      assert.equal(times[0], 'default', `${world.id}: Grundstimmung zuerst`);
      for (const t of times) assert.ok(t in TIME_LABELS, `${world.id}: ${t} hat eine Beschriftung`);
      assert.ok(world.id in WORLD_HILL_COLOR, `${world.id}: Hügelfarbe`);
      assert.ok(world.id in WORLD_BEND, `${world.id}: Krümmung`);
    }
  });
});

describe('Tunnel und Brücken (Streckenplan)', () => {
  it('ist bei gleichem Seed identisch und bei anderem Seed anders', () => {
    assert.deepEqual(planStructures('daily-20260921'), planStructures('daily-20260921'));
    assert.notDeepEqual(planStructures('a'), planStructures('b'));
  });

  it('beginnt erst nach 1,4 km mit einem Tunnel und lässt genug Platz dazwischen', () => {
    for (const seed of ['x', 'y', 'z', 'daily-1', '1789973075550-0.078']) {
      const plan = planStructures(seed);
      assert.equal(plan[0].type, 'tunnel');
      assert.ok(plan[0].start >= 1400, `${seed}: Start ${plan[0].start}`);
      for (let i = 1; i < plan.length; i++) {
        const gap = plan[i].start - (plan[i - 1].start + plan[i - 1].length);
        assert.ok(gap >= 1500, `${seed}: Lücke ${gap.toFixed(0)} m zwischen ${i - 1} und ${i}`);
      }
    }
  });

  it('Längen sind sinnvoll: Tunnel 224–320 m (Vielfache von 8), Brücke 296 m', () => {
    let tunnels = 0;
    let bridges = 0;
    for (const item of planStructures('laengen', 200)) {
      if (item.type === 'tunnel') {
        tunnels++;
        assert.ok(item.length >= 224 && item.length <= 320 && item.length % 8 === 0, `Tunnel ${item.length}`);
      } else {
        bridges++;
        assert.equal(item.length, 296);
      }
    }
    assert.ok(tunnels > 50 && bridges > 50, `Mischung: ${tunnels} Tunnel, ${bridges} Brücken`);
  });
});
