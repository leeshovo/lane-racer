// Tests für Schwierigkeitsstufen, Übungsrunden und Farbenblind-Palette.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../js/game.js';
import { CARS, DIFFICULTY_MODES, POWERUPS, POWERUP_COLORBLIND, sanitizeSettings } from '../js/config.js';
import { defaultProfile, applyRun } from '../js/storage.js';

const noop = () => {};
const effects = { setShield: noop, sparks: noop, coinBurst: noop, explosion: noop, shieldBreak: noop, pickupFlash: noop };
const makeGame = () => {
  const game = new Game({ scene: new THREE.Scene(), effects, audio: { play: noop }, events: {} });
  game.setPlayerCar('blitz', CARS[0].colors[0]);
  return game;
};

/** Reihenabstände (in m) der ersten Reihen nach Start – daran erkennt man den Modus. */
function rowGaps(mode, seed = 'modes', raceId = null) {
  const game = makeGame();
  game.start({ seed, mode, raceId, countdown: 0.01 });
  const zs = [...new Set(game.enemies.map((e) => Math.round(e.object.position.z)))].sort((a, b) => b - a);
  const gaps = [];
  for (let i = 1; i < zs.length; i++) gaps.push(zs[i - 1] - zs[i]);
  return { game, gaps, mean: gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length), cars: game.enemies.length };
}

describe('Schwierigkeit', () => {
  it('kennt drei Stufen; nur Entspannt zählt nicht für die Rangliste', () => {
    assert.deepEqual(Object.keys(DIFFICULTY_MODES), ['easy', 'normal', 'hard']);
    assert.equal(DIFFICULTY_MODES.easy.ranked, false);
    assert.equal(DIFFICULTY_MODES.normal.ranked, true);
    assert.equal(DIFFICULTY_MODES.hard.ranked, true);
  });

  it('Entspannt hat mehr Platz zwischen den Reihen als Normal', () => {
    const easy = rowGaps('easy');
    const normal = rowGaps('normal');
    assert.ok(easy.mean > normal.mean * 1.1, `easy ${easy.mean.toFixed(1)} vs normal ${normal.mean.toFixed(1)}`);
  });

  it('Hardcore hat im Schnitt mehr Autos auf der Strecke', () => {
    let easy = 0; let normal = 0; let hard = 0;
    for (let i = 0; i < 30; i++) {
      easy += rowGaps('easy', `s${i}`).cars;
      normal += rowGaps('normal', `s${i}`).cars;
      hard += rowGaps('hard', `s${i}`).cars;
    }
    assert.ok(hard > normal, `hard ${hard} > normal ${normal}`);
    assert.ok(normal > easy * 0.9, `normal ${normal} vs easy ${easy}`);
  });

  it('gemeinsame Rennen (Tagesrennen, Party) laufen immer auf Normal – egal was eingestellt ist', () => {
    for (const raceId of ['daily-20260921', 'ABCDE-xyz1']) {
      const { game } = rowGaps('easy', 'shared', raceId);
      assert.equal(game.mode, 'normal');
      assert.deepEqual(rowGaps('hard', 'shared', raceId).gaps, rowGaps('normal', 'shared', raceId).gaps);
    }
  });

  it('unbekannter Modus wird zu Normal', () => {
    assert.equal(rowGaps('quatsch').game.mode, 'normal');
  });

  it('das Ergebnis nennt den Modus', () => {
    let result = null;
    const game = new Game({ scene: new THREE.Scene(), effects, audio: { play: noop }, events: { onOver: (r) => { result = r; } } });
    game.setPlayerCar('blitz', CARS[0].colors[0]);
    game.start({ seed: 'r', mode: 'hard', countdown: 0.01 });
    for (let i = 0; i < 60 * 60 && game.state !== 'over'; i++) game.update(1 / 60);
    assert.equal(result.mode, 'hard');
  });
});

describe('Münzen und Rekord je Modus', () => {
  const run = (mode) => ({ distance: 2000, duration: 60, coinsCollected: 40, nearMissCoins: 20, smashCoins: 10, nearMisses: 5, smashed: 2, overtakes: 30, level: 4, nitroUses: 1, mode });

  it('Entspannt: ×0,75, kein neuer Rekord', () => {
    const p = defaultProfile();
    const s = applyRun(p, run('easy'));
    assert.equal(s.breakdown.collected, 30);
    assert.equal(s.breakdown.nearMiss, 15);
    assert.equal(s.breakdown.distance, 15);
    assert.equal(s.ranked, false);
    assert.equal(s.newBest, false);
    assert.equal(p.best, 0);
  });

  it('Normal zählt voll, Hardcore ×1,25; beide setzen den Rekord', () => {
    const normal = applyRun(defaultProfile(), run('normal'));
    const p = defaultProfile();
    const hard = applyRun(p, run('hard'));
    assert.equal(normal.breakdown.collected, 40);
    assert.equal(hard.breakdown.collected, 50);
    assert.ok(hard.total > normal.total);
    assert.equal(hard.newBest, true);
    assert.equal(p.best, 2000);
  });

  it('Summe der Zeilen stimmt mit der Gesamtsumme überein', () => {
    for (const mode of ['easy', 'normal', 'hard']) {
      const s = applyRun(defaultProfile(), run(mode));
      const sum = Object.values(s.breakdown).reduce((a, b) => a + b, 0);
      assert.equal(sum, s.total, mode);
    }
  });

  it('ohne Modus (alte Läufe) gilt Normal', () => {
    const { mode, ...old } = run('normal');
    assert.equal(applyRun(defaultProfile(), old).ranked, true);
  });
});

describe('Barrierefreiheit', () => {
  it('Einstellungen sind gültig und fallen bei Unsinn auf den Standard zurück', () => {
    const s = sanitizeSettings({ difficulty: 'hard', textSize: 'xlarge', contrast: true, reduceMotion: true, colorblind: true });
    assert.equal(s.difficulty, 'hard');
    assert.equal(s.textSize, 'xlarge');
    assert.equal(s.contrast && s.reduceMotion && s.colorblind, true);
    const bad = sanitizeSettings({ difficulty: 'godmode', textSize: 'riesig', contrast: 'ja' });
    assert.equal(bad.difficulty, 'normal');
    assert.equal(bad.textSize, 'normal');
    assert.equal(bad.contrast, false);
  });

  it('Farbenblind-Palette: alle Power-ups haben eine eigene Farbe', () => {
    assert.deepEqual(Object.keys(POWERUP_COLORBLIND).sort(), Object.keys(POWERUPS).sort());
    assert.equal(new Set(Object.values(POWERUP_COLORBLIND)).size, Object.keys(POWERUPS).length);
  });

  it('Power-ups unterscheiden sich in der Form und wechseln die Farbe', () => {
    const game = makeGame();
    const shapes = new Set(Object.values(game.powerupGeometries).map((g) => g.type));
    assert.equal(shapes.size, Object.keys(POWERUPS).length, 'jede Art hat eine andere Geometrie');
    assert.equal(game.powerupColor('shield'), POWERUPS.shield.color);
    game.setColorblind(true);
    assert.equal(game.powerupColor('shield'), POWERUP_COLORBLIND.shield);
    assert.equal(game.powerupMaterials.shield.core.color.getHexString(), POWERUP_COLORBLIND.shield.slice(1).toLowerCase());
    game.setColorblind(false);
    assert.equal(game.powerupColor('shield'), POWERUPS.shield.color);
  });
});
