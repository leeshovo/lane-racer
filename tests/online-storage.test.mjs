// Tests für Sicherungscode, Tages-Kennung, Spielstand-Snapshot und Missionen.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESET_EPOCH } from '../js/config.js';
import {
  makeRecoveryCode, parseRecoveryCode, dailyKey, dailyRaceId, secondsUntilNextDaily, normalizePartyCode, generatePartyCode,
} from '../js/online.js';
import {
  defaultProfile, snapshotOf, adoptSnapshot, progressOf, applyRun, buyCar, ensureMissions,
} from '../js/storage.js';
import { CARS, MISSION_POOL } from '../js/config.js';
import { updateBend, bendUniform, setBendEnabled } from '../js/bend.js';

const identity = { id: '2292a3d5-460d-49b6-96fb-9d71502cc316', secret: 'ab12'.repeat(12) };

describe('Sicherungscode', () => {
  it('lässt sich erzeugen und wieder einlesen', () => {
    const code = makeRecoveryCode(identity);
    assert.match(code, /^LR1-([0-9A-F]{5}-){15}[0-9A-F]{5}$/);
    assert.deepEqual(parseRecoveryCode(code), identity);
  });

  it('verzeiht Leerzeichen, Kleinschreibung und Zeilenumbrüche', () => {
    const code = makeRecoveryCode(identity).toLowerCase().replaceAll('-', ' \n ');
    assert.deepEqual(parseRecoveryCode(code), identity);
  });

  it('lehnt falsche Codes ab', () => {
    assert.equal(parseRecoveryCode(''), null);
    assert.equal(parseRecoveryCode('LR1-12345'), null);
    assert.equal(parseRecoveryCode('x'.repeat(500)), null);
    assert.equal(parseRecoveryCode(null), null);
    assert.equal(makeRecoveryCode({ id: 'kaputt', secret: 'x' }), null);
  });
});

describe('Tagesrennen', () => {
  it('Kennung ist der UTC-Tag', () => {
    assert.equal(dailyKey(new Date(Date.UTC(2026, 8, 21, 23, 59))), '20260921');
    assert.equal(dailyKey(new Date(Date.UTC(2026, 8, 22, 0, 0))), '20260922');
    assert.equal(dailyRaceId(new Date(Date.UTC(2026, 0, 5))), 'daily-20260105');
  });

  it('zählt bis zur nächsten Mitternacht (UTC)', () => {
    assert.equal(secondsUntilNextDaily(new Date(Date.UTC(2026, 8, 21, 23, 0, 0))), 3600);
  });

  it('Party-Codes: gültige Form, ungültige werden abgelehnt', () => {
    assert.match(generatePartyCode(), /^[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(normalizePartyCode(' ab-c12 '), 'ABC12');
    assert.equal(normalizePartyCode('a'), null);
  });
});

describe('Spielstand', () => {
  it('Snapshot enthält keine Zugangsdaten und übersteht JSON', () => {
    const p = defaultProfile();
    p.name = 'Lucas';
    p.online = identity;
    const snap = JSON.parse(JSON.stringify(snapshotOf(p)));
    assert.equal('online' in snap, false);
    assert.equal('name' in snap, false);
    assert.equal('settings' in snap, false);
    assert.ok(JSON.stringify(snap).length < 5000);
  });

  it('adoptSnapshot übernimmt Fortschritt, behält Name, Einstellungen und Online-ID', () => {
    const cloud = defaultProfile();
    cloud.coins = 4321;
    cloud.owned = ['blitz', 'kiwi', 'bulldog'];
    cloud.selectedCar = 'bulldog';
    cloud.best = 5000;
    cloud.stats.totalCoins = 9000;

    const local = defaultProfile();
    local.name = 'Lucas';
    local.online = identity;
    local.settings.volume = 0.3;
    adoptSnapshot(local, snapshotOf(cloud));

    assert.equal(local.coins, 4321);
    assert.deepEqual(local.owned, ['blitz', 'kiwi', 'bulldog']);
    assert.equal(local.selectedCar, 'bulldog');
    assert.equal(local.name, 'Lucas');
    assert.equal(local.settings.volume, 0.3);
    assert.deepEqual(local.online, identity);
    assert.equal(local.missions.length, 3);
  });

  it('wirft Unsinn aus manipulierten Snapshots raus', () => {
    const p = defaultProfile();
    adoptSnapshot(p, { epoch: RESET_EPOCH, coins: -50, owned: ['blitz', 'ufo', 42], selectedCar: 'ufo', colors: { blitz: '#123456' }, stats: { runs: 'viele' }, missions: [{ id: 'gibtsnicht' }] });
    assert.equal(p.coins, 0);
    assert.deepEqual(p.owned, ['blitz']);
    assert.equal(p.selectedCar, 'blitz');
    assert.equal(p.colors.blitz, CARS[0].colors[0], 'unerlaubte Lackfarbe wird ersetzt');
    assert.equal(p.stats.runs, 0);
    assert.equal(p.missions.length, 3);
  });

  it('Fortschritt wächst monoton (auch nach Käufen)', () => {
    const p = defaultProfile();
    applyRun(p, { distance: 3000, coinsCollected: 500, nearMisses: 0, nearMissCoins: 0, smashed: 0, smashCoins: 0, overtakes: 0, level: 3, nitroUses: 0 });
    p.coins = 2000; // Autos kosten mehr, Guthaben aufstocken
    const before = progressOf(p);
    assert.ok(buyCar(p, 'kiwi').ok);
    assert.ok(p.coins < 2000, 'Guthaben sinkt beim Kauf');
    assert.equal(progressOf(p), before, 'Fortschritt bleibt');
  });
});

describe('Missionen', () => {
  it('Tagesrennen-Mission zählt Tagesrennen', () => {
    assert.ok(MISSION_POOL.some((m) => m.id === 'daily'));
    const p = defaultProfile();
    p.missions = [];
    p.missionTier = {};
    const def = MISSION_POOL.find((m) => m.id === 'daily');
    p.missions.push({ id: 'daily', tier: 0, target: def.tiers[0][0], reward: def.tiers[0][1], progress: 0, text: 'Fahre 1 Tagesrennen' });
    ensureMissions(p);
    const result = applyRun(p, { distance: 500, coinsCollected: 0, nearMisses: 0, nearMissCoins: 0, smashed: 0, smashCoins: 0, overtakes: 0, level: 1, nitroUses: 0, isDaily: true });
    assert.equal(result.completed.some((m) => m.id === 'daily'), true);
    assert.equal(p.stats.dailyRuns, 1);
  });
});

describe('Kurven und Hügel', () => {
  it('Straße bleibt am Anfang gerade und kurvt später', () => {
    setBendEnabled(true);
    updateBend(0, 0, 1, true);
    assert.equal(bendUniform.value.length(), 0);
    updateBend(2000, 1, 1, true);
    assert.ok(bendUniform.value.length() > 0);
  });

  it('bleibt in vernünftigen Grenzen (max. 15 m Versatz in 215 m Entfernung)', () => {
    let max = 0;
    for (let d = 0; d < 20000; d += 25) {
      for (let w = 0; w < 5; w++) {
        updateBend(d, w, 1, true);
        max = Math.max(max, Math.abs(bendUniform.value.x), Math.abs(bendUniform.value.y));
      }
    }
    assert.ok(max * 215 * 215 <= 16, `größter Versatz ${(max * 215 * 215).toFixed(1)} m`);
  });

  it('lässt sich abschalten', () => {
    setBendEnabled(false);
    updateBend(2000, 1, 1, true);
    assert.equal(bendUniform.value.length(), 0);
    setBendEnabled(true);
  });
});
