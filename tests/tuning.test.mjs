// Tests für Tuning (Münzen-Senke): Kauf, Grenzen, Speicherung, Münzbonus.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING, TUNING_MAX, TUNING_COSTS, tuningCost, CARS, ACHIEVEMENTS } from '../js/config.js';
import { defaultProfile, buyTuning, tuningOf, sanitizeTuning, applyRun, snapshotOf, adoptSnapshot, checkAchievements, metricValue } from '../js/storage.js';

const rich = () => { const p = defaultProfile(); p.coins = 1_000_000; return p; };

describe('Tuning', () => {
  it('Preise steigen und enden nach 5 Stufen', () => {
    for (let i = 1; i < TUNING_COSTS.length; i++) assert.ok(TUNING_COSTS[i] > TUNING_COSTS[i - 1]);
    assert.equal(TUNING_COSTS.length, TUNING_MAX);
    assert.equal(tuningCost(TUNING_MAX), null);
    assert.equal(tuningCost(-1), null);
  });

  it('kauft Stufe für Stufe und zieht Münzen ab', () => {
    const p = rich();
    const before = p.coins;
    assert.equal(buyTuning(p, 'blitz', 'nitro').ok, true);
    assert.equal(tuningOf(p, 'blitz').nitro, 1);
    assert.equal(p.coins, before - TUNING_COSTS[0]);
    assert.equal(buyTuning(p, 'blitz', 'nitro').level, 2);
    assert.equal(tuningOf(p, 'blitz').handling, 0);
  });

  it('ohne Münzen, ohne Auto, unbekannter Wert und volle Stufe werden abgelehnt', () => {
    const p = defaultProfile();
    assert.equal(buyTuning(p, 'blitz', 'nitro').ok, false); // 0 Münzen
    p.coins = 99999;
    assert.equal(buyTuning(p, 'omega', 'nitro').ok, false); // nicht in der Garage
    assert.equal(buyTuning(p, 'blitz', 'speed').ok, false); // Tempo lässt sich nicht tunen
    p.coins = 1_000_000;
    for (let i = 0; i < TUNING_MAX; i++) assert.equal(buyTuning(p, 'blitz', 'coins').ok, true);
    assert.equal(buyTuning(p, 'blitz', 'coins').ok, false);
    assert.equal(tuningOf(p, 'blitz').coins, TUNING_MAX);
  });

  it('Tempo ist nie Teil des Tunings (Serverprüfung bleibt gültig)', () => {
    assert.deepEqual(TUNING.map((t) => t.id).sort(), ['coins', 'handling', 'nitro']);
  });

  it('sanitizeTuning verwirft Unsinn und begrenzt Stufen', () => {
    const t = sanitizeTuning({ blitz: { nitro: 99, handling: -3, coins: 'x' }, unbekannt: { nitro: 5 }, [CARS[1].id]: null, tuning: 1 });
    assert.deepEqual(t, { blitz: { nitro: TUNING_MAX, handling: 0, coins: 0 } });
    assert.deepEqual(sanitizeTuning(null), {});
  });

  it('bleibt im Cloud-Snapshot erhalten', () => {
    const p = rich();
    buyTuning(p, 'blitz', 'handling');
    const snap = snapshotOf(p);
    const other = defaultProfile();
    adoptSnapshot(other, snap);
    assert.equal(tuningOf(other, 'blitz').handling, 1);
  });

  it('Münzsammler erhöht die Belohnung der Runde', () => {
    const run = { distance: 2000, coinsCollected: 100, nearMissCoins: 0, smashCoins: 0, mode: 'normal' };
    const a = defaultProfile();
    const base = applyRun(a, { ...run }).breakdown.perk;
    const p = rich();
    for (let i = 0; i < 3; i++) buyTuning(p, 'blitz', 'coins');
    const tuned = applyRun(p, { ...run }).breakdown.perk;
    assert.equal(base, 0);
    assert.ok(tuned > 0, `Bonus ${tuned}`);
  });

  it('Erfolge: Schrauber und Vollgetunt', () => {
    const p = rich();
    for (let i = 0; i < 5; i++) buyTuning(p, 'blitz', 'nitro');
    assert.equal(metricValue(p, 'tuningTotal'), 5);
    assert.ok(checkAchievements(p).unlocked.some((a) => a.id === 'tune_5'));
    for (const tr of TUNING) while (tuningOf(p, 'blitz')[tr.id] < TUNING_MAX) buyTuning(p, 'blitz', tr.id);
    assert.equal(metricValue(p, 'tuningMaxCar'), 15);
    assert.ok(checkAchievements(p).unlocked.some((a) => a.id === 'tune_max'));
    assert.ok(ACHIEVEMENTS.every((a, i, all) => all.findIndex((b) => b.id === a.id) === i), 'IDs eindeutig');
  });
});
