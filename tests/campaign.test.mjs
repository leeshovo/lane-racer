// Tests für die Kampagne: Karten, Freischaltung, Auswertung, Belohnungen, Spielstand und der Zieleinlauf im Spiel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../js/game.js';
import { CARS, WORLDS, WORLD_TIMES } from '../js/config.js';
import {
  CAMPAIGN_MAPS, OBJECTIVES, mapById, nextMapOf, defaultCampaign, sanitizeCampaign, totalStars, isMapUnlocked, unlockHint,
  starsNeeded, levelInfo, xpForNext, levelReward, evaluateMap, applyCampaignResult,
} from '../js/campaign.js';
import { defaultProfile, applyRun, snapshotOf, adoptSnapshot, checkAchievements } from '../js/storage.js';

const finishedResult = (map, extra = {}) => ({
  finished: true, mapId: map.id, distance: map.goal, coinsCollected: 0, nearMisses: 0, smashed: 0, nitroUses: 0, overtakes: 0, ...extra,
});
const withGoals = (map, star2, star3) => finishedResult(map, {
  [{ coins: 'coinsCollected', near: 'nearMisses', smash: 'smashed', nitro: 'nitroUses', overtakes: 'overtakes' }[map.goals[1].type]]: star2 ? map.goals[1].target : 0,
  ...(star3 ? { [{ coins: 'coinsCollected', near: 'nearMisses', smash: 'smashed', nitro: 'nitroUses', overtakes: 'overtakes' }[map.goals[2].type]]: map.goals[2].target } : {}),
});

describe('Karten', () => {
  it('es gibt 20 Karten, 4 pro Welt, mit eindeutigen IDs und festen Seeds', () => {
    assert.equal(CAMPAIGN_MAPS.length, WORLDS.length * 4);
    assert.equal(new Set(CAMPAIGN_MAPS.map((m) => m.id)).size, 20);
    assert.equal(new Set(CAMPAIGN_MAPS.map((m) => m.seed)).size, 20);
    for (let w = 0; w < WORLDS.length; w++) assert.equal(CAMPAIGN_MAPS.filter((m) => m.world === w).length, 4);
  });

  it('Ziele werden länger, Karten schwerer, Tageszeiten gibt es in der Welt wirklich', () => {
    for (let i = 1; i < CAMPAIGN_MAPS.length; i++) {
      assert.ok(CAMPAIGN_MAPS[i].goal > CAMPAIGN_MAPS[i - 1].goal, `Ziel ${i}`);
      assert.ok(CAMPAIGN_MAPS[i].d0 >= CAMPAIGN_MAPS[i - 1].d0, `Schwierigkeit ${i}`);
    }
    for (const m of CAMPAIGN_MAPS) {
      assert.ok(m.d0 >= 0 && m.d1 <= 1 && m.d1 > m.d0, m.id);
      assert.ok(WORLD_TIMES[WORLDS[m.world].id].includes(m.time), `${m.id}: ${m.time}`);
      assert.equal(m.goals.length, 3);
      assert.deepEqual(m.goals.map((g) => g.star), [1, 2, 3]);
      assert.ok(m.goals[2].target >= m.goals[1].target * 1.2 || m.goals[2].type !== m.goals[1].type, `${m.id}: Stern 3 schwerer`);
      for (const g of m.goals.slice(1)) assert.ok(OBJECTIVES[g.type] && g.target >= 2 && g.label.includes(String(g.target)), `${m.id}: ${g.label}`);
      assert.equal(m.rewards.length, 3);
    }
    assert.equal(mapById('w1m1').index, 0);
    assert.equal(nextMapOf(CAMPAIGN_MAPS.at(-1)), null);
    assert.equal(mapById('gibt-es-nicht'), null);
  });
});

describe('Freischaltung', () => {
  it('nur die erste Karte ist am Anfang offen; danach braucht es die Vorgängerkarte und Sterne', () => {
    const c = defaultCampaign();
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[0]), true);
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[1]), false);
    c.stars.w1m1 = 1;
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[1]), true, 'Karte 2 braucht 1 Stern');
    assert.equal(starsNeeded(CAMPAIGN_MAPS[2]), 3);
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[2]), false);
    c.stars.w1m2 = 1;
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[2]), false, 'nur 2 Sterne insgesamt');
    assert.deepEqual(unlockHint(c, CAMPAIGN_MAPS[2]), { needPrev: null, needStars: 1 });
    c.stars.w1m1 = 2;
    assert.equal(isMapUnlocked(c, CAMPAIGN_MAPS[2]), true);
    assert.equal(unlockHint(c, CAMPAIGN_MAPS[2]), null);
  });

  it('mit lauter Ein-Sterne-Ergebnissen kommt man nicht durch die ganze Kampagne (Grinden lohnt sich)', () => {
    const c = defaultCampaign();
    let last = 0;
    for (const m of CAMPAIGN_MAPS) {
      if (!isMapUnlocked(c, m)) break;
      c.stars[m.id] = 1;
      last = m.index;
    }
    assert.ok(last < CAMPAIGN_MAPS.length - 1 && last >= 1, `mit 1 Stern kommt man bis Karte ${last + 1}`);
    for (const m of CAMPAIGN_MAPS) c.stars[m.id] = 3;
    assert.ok(CAMPAIGN_MAPS.every((m) => isMapUnlocked(c, m)));
    assert.equal(totalStars(c), 60);
  });
});

describe('Auswertung', () => {
  const map = CAMPAIGN_MAPS[0];

  it('ohne Ziel gibt es keine Sterne, auch wenn die Aufgaben erfüllt sind', () => {
    const ev = evaluateMap(map, { ...withGoals(map, true, true), finished: false });
    assert.equal(ev.stars, 0);
  });

  it('Ziel = 1 Stern, jede Zusatzaufgabe einen weiteren', () => {
    assert.equal(evaluateMap(map, withGoals(map, false, false)).stars, 1);
    assert.equal(evaluateMap(map, withGoals(map, true, false)).stars, 2);
    assert.equal(evaluateMap(map, withGoals(map, true, true)).stars, 3);
    const only3 = evaluateMap(map, withGoals(map, false, true));
    assert.deepEqual(only3.goals.map((g) => g.done), [true, false, true], 'Sterne sind unabhängig voneinander');
  });

  it('das Ergebnis einer anderen Karte zählt nicht', () => {
    assert.equal(evaluateMap(map, { ...withGoals(map, true, true), mapId: 'w9m9' }).stars, 0);
  });
});

describe('Belohnungen und Stufen', () => {
  it('Münzen gibt es nur für neue Sterne', () => {
    const p = defaultProfile();
    const map = CAMPAIGN_MAPS[0];
    const first = applyCampaignResult(p, map, withGoals(map, true, false));
    assert.equal(first.newStars, 2);
    assert.equal(first.coins, map.rewards[0] + map.rewards[1]);
    assert.equal(first.firstClear, true);
    const coinsAfter = p.coins;
    const again = applyCampaignResult(p, map, withGoals(map, true, false));
    assert.equal(again.newStars, 0);
    assert.equal(again.coins, 0);
    assert.equal(again.firstClear, false);
    assert.ok(again.xp > 0, 'Wiederholen bringt trotzdem etwas XP (Grinden)');
    assert.ok(p.coins >= coinsAfter);
    const third = applyCampaignResult(p, map, withGoals(map, true, true));
    assert.equal(third.coins, map.rewards[2]);
    assert.equal(p.campaign.stars[map.id], 3);
  });

  it('Sterne gehen nie verloren; der Bestwert steigt nur', () => {
    const p = defaultProfile();
    const map = CAMPAIGN_MAPS[0];
    applyCampaignResult(p, map, withGoals(map, true, true));
    applyCampaignResult(p, map, { finished: false, mapId: map.id, distance: 300 });
    assert.equal(p.campaign.stars[map.id], 3);
    assert.equal(p.campaign.best[map.id], map.goal);
  });

  it('meldet die neu freigeschaltete nächste Karte', () => {
    const p = defaultProfile();
    const r = applyCampaignResult(p, CAMPAIGN_MAPS[0], withGoals(CAMPAIGN_MAPS[0], false, false));
    assert.equal(r.unlockedNext?.id, 'w1m2');
    const r2 = applyCampaignResult(p, CAMPAIGN_MAPS[0], withGoals(CAMPAIGN_MAPS[0], true, false));
    assert.equal(r2.unlockedNext, null, 'schon offen → keine Meldung');
  });

  it('Stufen: wachsende XP-Schwelle und Münzen beim Aufstieg', () => {
    assert.equal(levelInfo(0).level, 1);
    assert.equal(levelInfo(xpForNext(1) - 1).level, 1);
    assert.equal(levelInfo(xpForNext(1)).level, 2);
    assert.equal(levelInfo(xpForNext(1) + xpForNext(2)).level, 3);
    assert.ok(xpForNext(5) > xpForNext(1));
    const p = defaultProfile();
    p.campaign.xp = xpForNext(1) - 5;
    const map = CAMPAIGN_MAPS[0];
    const r = applyCampaignResult(p, map, withGoals(map, false, false));
    assert.deepEqual(r.levelUps, [2]);
    assert.equal(r.levelCoins, levelReward(2));
    assert.ok(levelInfo(p.campaign.xp).frac >= 0 && levelInfo(p.campaign.xp).frac < 1);
  });

  it('zählt für Erfolge (Sterne, Karten, Stufe)', () => {
    const p = defaultProfile();
    for (const m of CAMPAIGN_MAPS.slice(0, 4)) applyCampaignResult(p, m, withGoals(m, true, false));
    const got = checkAchievements(p).unlocked.map((a) => a.id);
    assert.ok(got.includes('camp_1') && got.includes('camp_w1'), got.join());
  });
});

describe('Spielstand', () => {
  it('wird gespeichert, in die Cloud übernommen und bereinigt', () => {
    const p = defaultProfile();
    applyCampaignResult(p, CAMPAIGN_MAPS[0], withGoals(CAMPAIGN_MAPS[0], true, true));
    const other = defaultProfile();
    adoptSnapshot(other, snapshotOf(p));
    assert.equal(other.campaign.stars.w1m1, 3);
    assert.equal(other.campaign.xp, p.campaign.xp);
    const messy = sanitizeCampaign({ stars: { w1m1: 9, 'x': 3, w1m2: -2, w1m3: 'a' }, best: { w1m1: 1e12 }, xp: -5, finishes: 'viel' });
    assert.deepEqual(messy.stars, { w1m1: 3 });
    assert.ok(messy.best.w1m1 <= CAMPAIGN_MAPS[0].goal * 2);
    assert.equal(messy.xp, 0);
    assert.equal(messy.finishes, 0);
    assert.deepEqual(sanitizeCampaign(null), defaultCampaign());
    assert.deepEqual(sanitizeCampaign('quatsch'), defaultCampaign());
  });

  it('Kampagnenrunden zählen nicht für den Rekord (Modus "campaign")', () => {
    const p = defaultProfile();
    const map = CAMPAIGN_MAPS[0];
    const s = applyRun(p, { ...withGoals(map, true, true), duration: 60, level: 3, mode: 'campaign' });
    assert.equal(s.ranked, false);
    assert.equal(p.best, 0);
  });
});

describe('Kampagne im Spiel', () => {
  const noop = () => {};
  const effects = { setShield: noop, sparks: noop, coinBurst: noop, explosion: noop, shieldBreak: noop, pickupFlash: noop };
  const makeGame = (events = {}) => {
    const g = new Game({ scene: new THREE.Scene(), effects, audio: { play: noop }, events });
    g.setPlayerCar('blitz', CARS[0].colors[0]);
    return g;
  };
  const clear = (game) => { for (const e of game.enemies) e.object.position.z = -500; };

  it('läuft bis zum Ziel, rollt aus und meldet das Ergebnis mit Karte und "geschafft"', () => {
    const map = mapById('w1m1');
    let result = null;
    let finishEvents = 0;
    const game = makeGame({ onOver: (r) => { result = r; }, onFinish: () => { finishEvents++; } });
    game.start({ seed: map.seed, mode: 'campaign', map, countdown: 0.01 });
    game.nextRowSpacing = 1e9;
    let steps = 0;
    while (game.state !== 'over' && steps++ < 60 * 300) { clear(game); game.update(1 / 60); }
    assert.ok(result, 'Ergebnis da');
    assert.equal(result.finished, true);
    assert.equal(result.mapId, map.id);
    assert.equal(result.mode, 'campaign');
    assert.ok(result.distance >= map.goal);
    assert.equal(finishEvents, 1);
    assert.equal(game.hud().goal.frac, 1);
  });

  it('Welt bleibt fest, keine Weltwechsel, Ziel wird im HUD gemeldet', () => {
    const map = mapById('w3m2');
    const worlds = [];
    const game = makeGame({ onWorld: (i) => worlds.push(i) });
    game.start({ seed: map.seed, mode: 'campaign', map, countdown: 0.01 });
    game.nextRowSpacing = 1e9;
    for (let i = 0; i < 60 * 45; i++) { clear(game); game.update(1 / 60); }
    assert.deepEqual(worlds, []);
    assert.equal(game.worldIndex, map.world);
    const goal = game.hud().goal;
    assert.equal(goal.distance, map.goal);
    assert.ok(goal.frac > 0 && goal.frac <= 1);
  });

  it('ein Crash ist kein Zieleinlauf', () => {
    const map = mapById('w1m1');
    let result = null;
    const game = makeGame({ onOver: (r) => { result = r; } });
    game.start({ seed: map.seed, mode: 'campaign', map, countdown: 0.01 });
    for (let i = 0; i < 60 * 120 && game.state !== 'over'; i++) game.update(1 / 60); // ohne Ausweichen
    assert.ok(result);
    assert.equal(result.finished, false);
    assert.equal(result.mapId, map.id);
    assert.equal(evaluateMap(map, result).stars, 0);
  });

  it('gleiche Karte = gleicher Verkehr (fester Seed)', () => {
    const map = mapById('w2m3');
    const rows = () => {
      const game = makeGame();
      game.start({ seed: map.seed, mode: 'campaign', map, countdown: 0.01 });
      return game.enemies.map((e) => `${e.type}@${Math.round(e.object.position.x)},${Math.round(e.object.position.z)}`).join('|');
    };
    assert.equal(rows(), rows());
  });

  it('Party- und Tagesrennen ignorieren eine Karte (immer Normal)', () => {
    const map = mapById('w1m1');
    const game = makeGame();
    game.start({ seed: 's', raceId: 'daily-20260921', mode: 'campaign', map, countdown: 0.01 });
    assert.equal(game.map, null);
    assert.equal(game.mode, 'normal');
  });

  it('nach "idle" ist die Karte weg', () => {
    const game = makeGame();
    game.start({ seed: 's', mode: 'campaign', map: mapById('w1m1'), countdown: 0.01 });
    game.idle();
    assert.equal(game.map, null);
  });
});
