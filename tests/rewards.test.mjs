// Tests für Tagesserie, Erfolge und Sonderlacke.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, SPECIAL_COLORS, STREAK, streakBonus, CARS } from '../js/config.js';
import {
  defaultProfile, applyRun, updateStreak, streakView, previousDayKey, dayKeyOf, checkAchievements, achievementViews,
  unlockedColors, setCarColor, isColorUnlocked, snapshotOf, adoptSnapshot, buyCar, metricValue,
} from '../js/storage.js';

const run = (extra = {}) => ({
  distance: 500, duration: 30, coinsCollected: 5, nearMissCoins: 0, smashCoins: 0, nearMisses: 1, smashed: 0,
  overtakes: 5, level: 2, nitroUses: 0, mode: 'normal', ...extra,
});

describe('Tagesschlüssel', () => {
  it('rechnet über Monats- und Jahresgrenzen richtig', () => {
    assert.equal(previousDayKey('20260921'), '20260920');
    assert.equal(previousDayKey('20260301'), '20260228');
    assert.equal(previousDayKey('20240301'), '20240229');
    assert.equal(previousDayKey('20260101'), '20251231');
    assert.equal(dayKeyOf(new Date(Date.UTC(2026, 8, 21, 23, 59))), '20260921');
  });
});

describe('Tagesserie', () => {
  it('Bonus wächst um 20 pro Tag bis Tag 7 und bleibt dann gleich', () => {
    assert.deepEqual([1, 2, 3, 7, 8, 30].map(streakBonus), [20, 40, 60, 140, 140, 140]);
    assert.equal(streakBonus(0), 0);
    assert.equal(STREAK.maxDays, 7);
  });

  it('zählt aufeinanderfolgende Tage, setzt nach einer Lücke zurück und zahlt nur einmal pro Tag', () => {
    const p = defaultProfile();
    assert.deepEqual(updateStreak(p, '20260918'), { count: 1, bonus: 20, isNewDay: true });
    assert.deepEqual(updateStreak(p, '20260918'), { count: 1, bonus: 0, isNewDay: false }, 'zweite Runde am selben Tag');
    assert.equal(updateStreak(p, '20260919').count, 2);
    assert.equal(updateStreak(p, '20260920').bonus, 60);
    assert.equal(updateStreak(p, '20260922').count, 1, 'ein Tag ausgelassen → von vorn');
    assert.equal(p.stats.bestStreak, 3, 'Bestwert bleibt');
  });

  it('streakView: gerissene Serie zählt als 0', () => {
    const p = defaultProfile();
    updateStreak(p, '20260918');
    updateStreak(p, '20260919');
    assert.equal(streakView(p, '20260919').playedToday, true);
    assert.equal(streakView(p, '20260920').count, 2, 'gestern gefahren: Serie lebt noch');
    assert.equal(streakView(p, '20260920').next, 60);
    assert.equal(streakView(p, '20260925').count, 0, 'Serie ist gerissen');
    assert.equal(streakView(p, '20260925').next, 20);
  });

  it('applyRun zahlt den Bonus einmal pro Tag und zählt ihn in die Summe', () => {
    const p = defaultProfile();
    const a = applyRun(p, run({ dayKey: '20260918' }));
    const b = applyRun(p, run({ dayKey: '20260918' }));
    assert.equal(a.breakdown.streak, 20);
    assert.equal(b.breakdown.streak, 0);
    const c = applyRun(p, run({ dayKey: '20260919' }));
    assert.equal(c.breakdown.streak, 40);
    for (const s of [a, b, c]) assert.equal(Object.values(s.breakdown).reduce((x, y) => x + y, 0), s.total);
  });
});

describe('Erfolge', () => {
  it('haben eindeutige IDs, gültige Kennzahlen und Freischalt-Lacke, die es gibt', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    const p = defaultProfile();
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.name && a.text && a.reward > 0 && a.target > 0, a.id);
      assert.equal(typeof metricValue(p, a.metric), 'number', `${a.id}: Kennzahl ${a.metric}`);
      if (a.color) assert.ok(SPECIAL_COLORS[a.color], `${a.id}: Lack ${a.color}`);
    }
    for (const key of Object.keys(SPECIAL_COLORS)) assert.ok(ACHIEVEMENTS.some((a) => a.color === key), `Lack ${key} ist erreichbar`);
    assert.equal(ACHIEVEMENTS.find((a) => a.id === 'garage_all').target, CARS.length);
  });

  it('werden genau einmal freigeschaltet und zahlen ihre Belohnung', () => {
    const p = defaultProfile();
    const before = p.coins;
    const first = applyRun(p, run());
    assert.ok(first.achievements.some((a) => a.id === 'first_run'));
    assert.ok(first.breakdown.achievements >= 25);
    assert.equal(p.achievements.first_run, true);
    const second = applyRun(p, run({ dayKey: '20990101' }));
    assert.ok(!second.achievements.some((a) => a.id === 'first_run'), 'kein zweites Mal');
    assert.ok(p.coins > before);
    assert.equal(checkAchievements(p).coins, 0, 'nichts Neues → nichts zu zahlen');
  });

  it('Distanz-Erfolge über den Rekord, Level-Erfolge über den Höchstwert', () => {
    const p = defaultProfile();
    const r = applyRun(p, run({ distance: 5200, level: 8 }));
    const got = r.achievements.map((a) => a.id);
    assert.ok(got.includes('dist_1k') && got.includes('dist_5k') && !got.includes('dist_10k'));
    assert.ok(got.includes('level_7') && !got.includes('level_13'));
  });

  it('Hardcore-Erfolg zählt nur Hardcore-Runden; Entspannt zählt nicht für Distanz-Rekorde', () => {
    const p = defaultProfile();
    applyRun(p, run({ distance: 3000, mode: 'normal' }));
    assert.equal(p.achievements.hard_2k, undefined);
    applyRun(p, run({ distance: 2500, mode: 'hard' }));
    assert.equal(p.achievements.hard_2k, true);
    const q = defaultProfile();
    applyRun(q, run({ distance: 12000, mode: 'easy' }));
    assert.equal(q.achievements.dist_10k, undefined, 'Übungsrunde zählt nicht');
  });

  it('Sammler-Erfolg nach dem dritten Auto', () => {
    const p = defaultProfile();
    p.coins = 100000;
    buyCar(p, CARS[1].id);
    assert.equal(checkAchievements(p).unlocked.length, 0);
    buyCar(p, CARS[2].id);
    assert.deepEqual(checkAchievements(p).unlocked.map((a) => a.id), ['garage_3']);
  });

  it('Ansicht: Fortschritt zwischen 0 und 1, geschaffte markiert', () => {
    const p = defaultProfile();
    applyRun(p, run({ distance: 1500 }));
    const views = achievementViews(p);
    assert.equal(views.length, ACHIEVEMENTS.length);
    const d1 = views.find((v) => v.id === 'dist_1k');
    const d5 = views.find((v) => v.id === 'dist_5k');
    assert.equal(d1.done, true);
    assert.equal(d5.done, false);
    assert.ok(d5.progress > 0.29 && d5.progress < 0.31);
    assert.ok(views.every((v) => v.progress >= 0 && v.progress <= 1));
  });
});

describe('Sonderlacke', () => {
  it('sind gesperrt, bis der Erfolg geschafft ist – dann für jedes Auto wählbar', () => {
    const p = defaultProfile();
    const gold = SPECIAL_COLORS.gold.color;
    assert.equal(isColorUnlocked(p, gold), false);
    assert.equal(setCarColor(p, 'blitz', gold), false);
    assert.equal(unlockedColors(p).length, 0);
    applyRun(p, run({ distance: 10500 }));
    assert.equal(isColorUnlocked(p, gold), true);
    assert.equal(setCarColor(p, 'blitz', gold), true);
    assert.equal(p.colors.blitz, gold);
    assert.deepEqual(unlockedColors(p).map((c) => c.key), ['gold']);
    assert.equal(setCarColor(p, 'blitz', '#123456'), false, 'beliebige Farben bleiben verboten');
  });

  it('bleiben im Spielstand und in der Cloud erhalten – gesperrte werden beim Laden zurückgesetzt', () => {
    const p = defaultProfile();
    applyRun(p, run({ distance: 10500 }));
    setCarColor(p, 'blitz', SPECIAL_COLORS.gold.color);
    const other = defaultProfile();
    adoptSnapshot(other, snapshotOf(p));
    assert.equal(other.colors.blitz, SPECIAL_COLORS.gold.color);
    assert.equal(other.achievements.dist_10k, true);
    assert.equal(other.streak.count, p.streak.count);
    // manipulierter Snapshot: Lack ohne Erfolg
    const cheat = snapshotOf(defaultProfile());
    cheat.colors.blitz = SPECIAL_COLORS.pink.color;
    const victim = defaultProfile();
    adoptSnapshot(victim, cheat);
    assert.notEqual(victim.colors.blitz, SPECIAL_COLORS.pink.color);
  });

  it('alte Spielstände ohne Erfolge und Serie laden fehlerfrei', () => {
    const p = defaultProfile();
    const snap = snapshotOf(p);
    delete snap.streak;
    delete snap.achievements;
    delete snap.stats.bestLevel;
    adoptSnapshot(p, snap);
    assert.deepEqual(p.achievements, {});
    assert.equal(p.streak.count, 0);
    assert.equal(p.stats.bestLevel, 0);
  });
});
