// Tests für die Tipps der ersten Runde (reine Logik).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESET_EPOCH } from '../js/config.js';
import { Tutorial, TUTORIAL_STEPS } from '../js/tutorial.js';
import { defaultProfile, adoptSnapshot, snapshotOf } from '../js/storage.js';

const base = { distance: 0, lane: 1, coins: 0, nearMisses: 0, nitroReady: false, nitroActive: false, abilityReady: false, abilityActive: false, abilityName: 'Blitzstart' };
const tick = (t, s, dt = 0.5) => t.update({ ...base, ...s }, dt);

describe('Tutorial', () => {
  it('beginnt mit dem Spurwechsel-Tipp, passend zum Gerät', () => {
    assert.match(tick(new Tutorial({ touch: false }), {}).text, /←/);
    assert.match(tick(new Tutorial({ touch: true }), {}).text, /Tippe/);
  });

  it('der Tipp verschwindet, sobald man zweimal die Spur gewechselt hat', () => {
    const t = new Tutorial();
    assert.equal(tick(t, { lane: 1 }).id, 'steer');
    assert.equal(tick(t, { lane: 0 }).id, 'steer');
    assert.equal(tick(t, { lane: 1 }), null);
    assert.equal(t.completed[0], 'steer');
  });

  it('zieht sich nach dem Zeitlimit von selbst zurück und lässt Ruhe vor dem nächsten', () => {
    const t = new Tutorial();
    let ids = [];
    for (let i = 0; i < 30; i++) ids.push(tick(t, { distance: 50 })?.id ?? null);
    assert.equal(ids[0], 'steer');
    assert.ok(ids.includes(null), 'Tipp ist irgendwann weg');
    assert.equal(ids.at(-1), null, 'am Ende zeigt sich (bei 50 m) noch nichts Neues');
  });

  it('Tipps kommen der Reihe nach und erst, wenn sie passen', () => {
    const t = new Tutorial();
    const seen = [];
    const step = (s) => { const tip = tick(t, s, 0.5); if (tip && seen.at(-1) !== tip.id) seen.push(tip.id); };
    // steer erledigen
    step({ lane: 1 }); step({ lane: 0 }); step({ lane: 2 });
    // Ruhephase abwarten, coins-Tipp erst ab 120 m
    for (let i = 0; i < 6; i++) step({ lane: 2, distance: 60 });
    assert.deepEqual(seen, ['steer']);
    step({ lane: 2, distance: 130 });
    assert.deepEqual(seen, ['steer', 'coins']);
    step({ lane: 2, distance: 140, coins: 3 }); // erledigt
    for (let i = 0; i < 4; i++) step({ lane: 2, distance: 320 });
    assert.deepEqual(seen, ['steer', 'coins', 'near']);
  });

  it('Nitro-Tipp erst bei gefüllter Leiste, erledigt beim Zünden; Fähigkeits-Tipp nennt den Namen', () => {
    const t = new Tutorial({ touch: false });
    t.index = 3; t.cooldown = 0;
    assert.equal(tick(t, { nitroReady: false }), null);
    assert.equal(tick(t, { nitroReady: true }).id, 'nitro');
    assert.equal(tick(t, { nitroReady: true, nitroActive: true }), null, 'Zünden beendet den Tipp');
    t.cooldown = 0;
    const tip = tick(t, { distance: 600, abilityReady: true });
    assert.equal(tip.id, 'ability');
    assert.match(tip.text, /Blitzstart/);
    tick(t, { distance: 600, abilityReady: true, abilityActive: true });
    assert.equal(t.abilityUses, 1);
  });

  it('endet nach dem letzten Schritt und liefert dann nur noch null', () => {
    const t = new Tutorial();
    t.index = TUTORIAL_STEPS.length;
    assert.equal(t.finished, true);
    assert.equal(tick(t, { distance: 9999 }), null);
  });

  it('jeder Schritt hat Text, Bedingung, Erledigt-Prüfung und Zeitlimit', () => {
    for (const s of TUTORIAL_STEPS) {
      assert.ok(s.id && typeof s.text(false, base) === 'string' && typeof s.when === 'function' && typeof s.done === 'function' && s.timeout > 0, s.id);
    }
  });
});

describe('Tutorial im Spielstand', () => {
  it('neue Spieler bekommen es, wer schon gespielt hat nicht', async () => {
    const { loadProfile } = await import('../js/storage.js');
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    assert.equal(loadProfile().tutorialDone, false);
    globalThis.localStorage = { getItem: () => JSON.stringify({ epoch: RESET_EPOCH, stats: { runs: 5 } }), setItem() {} };
    assert.equal(loadProfile().tutorialDone, true);
    globalThis.localStorage = { getItem: () => JSON.stringify({ epoch: RESET_EPOCH, stats: { runs: 5 }, tutorialDone: false }), setItem() {} };
    assert.equal(loadProfile().tutorialDone, false, 'ausdrücklicher Wert gewinnt');
    delete globalThis.localStorage;
  });

  it('bleibt beim Übernehmen eines Cloud-Spielstands erhalten', () => {
    const local = defaultProfile();
    local.tutorialDone = true;
    adoptSnapshot(local, snapshotOf(defaultProfile()));
    assert.equal(local.tutorialDone, true);
  });
});
