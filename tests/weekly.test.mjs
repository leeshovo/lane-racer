// Tests für die Wochenwertung: Preise (JS = SQL), Gutschrift ohne Doppelauszahlung, Sonderpreise, Einladungslink, Online-Aufrufe.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Online, friendCodeFromUrl, friendShareUrl } from '../js/online.js';
import {
  WEEKLY_ITEMS, weeklyPrizeCoins, weeklyItemForRank, SPECIAL_COLORS, carById, CARS,
} from '../js/config.js';
import {
  defaultProfile, applyWeeklyRewards, buyCar, isColorUnlocked, unlockedColors, setCarColor, snapshotOf, adoptSnapshot, loadProfile,
} from '../js/storage.js';

const SQL = fs.readFileSync(new URL('../supabase/migrations/20260921_weekly_ranking.sql', import.meta.url), 'utf8');
const ID = '11111111-2222-4333-8444-555555555555';
const identity = { id: ID, secret: 'geheim' };
const WEEK = '2026-09-16T10:00:00+00:00';

function fakeOnline(handler) {
  const online = new Online();
  const calls = [];
  online._rpc = async (fn, args) => { calls.push({ fn, args }); return handler(fn, args); };
  return { online, calls };
}

describe('Preise', () => {
  it('Münzen fallen mit dem Platz und Platz 1–3 sind besonders', () => {
    const coins = Array.from({ length: 80 }, (_, i) => weeklyPrizeCoins(i + 1));
    assert.deepEqual(coins.slice(0, 10), [1500, 1000, 750, 500, 400, 320, 260, 210, 170, 140]);
    for (let i = 1; i < coins.length; i++) assert.ok(coins[i] <= coins[i - 1], `Platz ${i + 1}`);
    assert.equal(coins.at(-1), 25, 'wer Punkte hat, bekommt mindestens 25');
    assert.equal(weeklyPrizeCoins(0), 0);
    assert.equal(weeklyPrizeCoins('x'), 0);
    assert.deepEqual([1, 2, 3, 4].map(weeklyItemForRank), ['champion', 'silver', 'bronze', null]);
  });

  it('die Preistabelle in js/config.js und in der Datenbank-Datei ist identisch', () => {
    const body = SQL.slice(SQL.indexOf('function public.week_prize_coins'), SQL.indexOf('-- Rangfolge einer Woche'));
    const exact = new Map([...body.matchAll(/p_rank = (\d+) then (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
    const steps = [...body.matchAll(/p_rank <= (\d+) then (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const rest = Number(body.match(/else (\d+) end/)[1]);
    for (let rank = 1; rank <= 120; rank++) {
      let sql = exact.get(rank);
      if (sql === undefined) sql = (steps.find(([max]) => rank <= max) || [0, rest])[1];
      assert.equal(weeklyPrizeCoins(rank), sql, `Platz ${rank}`);
    }
  });

  it('die Sonderpreis-Kürzel passen zur Datenbank', () => {
    for (const key of Object.keys(WEEKLY_ITEMS)) assert.ok(SQL.includes(`'${key}'`), key);
    assert.deepEqual(Object.values(WEEKLY_ITEMS).map((i) => i.rank), [1, 2, 3]);
  });

  it('Wochenfenster: Reset Mittwoch 12:00 steht in der Datenbank-Datei', () => {
    assert.match(SQL, /isodow from t\)::int - 3/, 'Mittwoch');
    assert.match(SQL, /interval '12 hours'/);
    assert.match(SQL, /Europe\/Berlin/);
  });
});

describe('Belohnungen gutschreiben', () => {
  const reward = (extra = {}) => ({ week: WEEK, rank: 2, score: 7400, coins: 1000, item: 'silver', ...extra });

  it('Münzen, Pokal und Lack; jede Woche nur einmal', () => {
    const p = defaultProfile();
    const first = applyWeeklyRewards(p, [reward()]);
    assert.equal(first.length, 1);
    assert.equal(p.coins, 1000);
    assert.equal(p.trophies.silver, 1);
    assert.equal(isColorUnlocked(p, SPECIAL_COLORS.silver.color), true);
    assert.equal(setCarColor(p, 'blitz', SPECIAL_COLORS.silver.color), true);
    assert.deepEqual(applyWeeklyRewards(p, [reward()]), [], 'nochmal gemeldet (Abbruch vor der Bestätigung) → nichts');
    assert.equal(p.coins, 1000);
    assert.equal(p.trophies.silver, 1);
  });

  it('Platz 1 bekommt das exklusive Auto, jeder weitere Sieg Extra-Münzen', () => {
    const p = defaultProfile();
    const [a] = applyWeeklyRewards(p, [reward({ rank: 1, coins: 1500, item: 'champion' })]);
    assert.equal(a.newCar, true);
    assert.ok(p.owned.includes('apex'));
    assert.equal(p.coins, 1500);
    assert.equal(isColorUnlocked(p, SPECIAL_COLORS.crown.color), true);
    const [b] = applyWeeklyRewards(p, [reward({ week: '2026-09-23T10:00:00+00:00', rank: 1, coins: 1500, item: 'champion' })]);
    assert.equal(b.newCar, false);
    assert.equal(b.bonus, 1000);
    assert.equal(p.coins, 1500 + 1500 + 1000);
    assert.equal(p.trophies.gold, 2);
  });

  it('Bronze, kein Sonderpreis und Müll', () => {
    const p = defaultProfile();
    applyWeeklyRewards(p, [reward({ week: 'a', rank: 3, coins: 750, item: 'bronze' }), reward({ week: 'b', rank: 9, coins: 170, item: null })]);
    assert.equal(p.trophies.bronze, 1);
    assert.equal(p.coins, 920);
    const before = p.coins;
    applyWeeklyRewards(p, [null, {}, { week: 'c', rank: 0, coins: 999 }, { week: 'd', rank: 5, coins: 999999, item: 'hack' }]);
    assert.equal(p.coins - before, 5000, 'Münzen pro Woche sind nach oben begrenzt, unbekannte Preise ignoriert');
    assert.equal(p.trophies.gold, 0);
    assert.deepEqual(applyWeeklyRewards(p, 'kaputt'), []);
  });

  it('das Wochenpreis-Auto ist nicht kaufbar, aber in der Garage vorhanden', () => {
    const apex = carById('apex');
    assert.equal(apex.exclusive, 'weekly');
    assert.ok(CARS.includes(apex));
    const p = defaultProfile();
    p.coins = 999999;
    const r = buyCar(p, 'apex');
    assert.equal(r.ok, false);
    assert.equal(p.coins, 999999);
    assert.ok(!p.owned.includes('apex'));
    assert.ok(apex.stats.speed * 1.4 * 1.3 < 2.4, 'bleibt unter der Tempo-Grenze, die der Server prüft');
  });

  it('bleibt im Spielstand und in der Cloud; gefälschte Pokale werden nicht geladen', () => {
    const p = defaultProfile();
    applyWeeklyRewards(p, [reward({ rank: 1, coins: 1500, item: 'champion' })]);
    const other = defaultProfile();
    adoptSnapshot(other, snapshotOf(p));
    assert.equal(other.trophies.gold, 1);
    assert.deepEqual(other.weekly.applied, [WEEK]);
    assert.deepEqual(applyWeeklyRewards(other, [reward({ rank: 1, coins: 1500, item: 'champion' })]), [], 'nach Gerätewechsel keine zweite Auszahlung');
    globalThis.localStorage = { getItem: () => JSON.stringify({ trophies: { gold: -5, silver: 'x', bronze: 1e9 }, weekly: { applied: [1, {}, 'ok'] } }), setItem() {} };
    const l = loadProfile();
    delete globalThis.localStorage;
    assert.deepEqual(l.trophies, { gold: 0, silver: 0, bronze: 9999 });
    assert.deepEqual(l.weekly.applied, ['ok']);
  });

  it('Pokal-Lacke erscheinen bei den freigeschalteten', () => {
    const p = defaultProfile();
    assert.equal(unlockedColors(p).length, 0);
    applyWeeklyRewards(p, [reward({ week: 'x', rank: 3, coins: 750, item: 'bronze' })]);
    assert.deepEqual(unlockedColors(p).map((c) => c.key), ['bronze']);
  });
});

describe('Online: Wochenwertung', () => {
  it('weekInfo liest Ende und Uhrzeitabweichung', async () => {
    const now = Date.now();
    const { online, calls } = fakeOnline(() => ({ data: [{ week_start: '2026-09-16T10:00:00+00:00', ends_at: '2026-09-23T10:00:00+00:00', server_now: new Date(now + 5000).toISOString() }] }));
    const r = await online.weekInfo();
    assert.equal(calls[0].fn, 'week_info');
    assert.equal(r.endsAt, Date.parse('2026-09-23T10:00:00Z'));
    assert.ok(Math.abs(r.offset - 5000) < 500);
    const bad = await fakeOnline(() => ({ data: [{ week_start: 'x' }] })).online.weekInfo();
    assert.ok(bad.error);
  });

  it('die Wochen-Rangliste nutzt leaderboard_week und liefert Sieger-Zähler', async () => {
    const { online, calls } = fakeOnline(() => ({ data: [
      { player_id: ID, name: 'Ich', car: 'blitz', color: '#ff5a1f', best: 100, runs: 2, wins: 0 },
      { player_id: '99999999-2222-4333-8444-555555555555', name: 'Mia', car: 'kiwi', color: '#2ec4b6', best: 900, runs: 5, wins: 3 },
    ] }));
    const r = await online.leaderboard('weekly');
    assert.equal(calls[0].fn, 'leaderboard_week');
    assert.deepEqual(r.rows.map((x) => [x.rank, x.name, x.wins]), [[1, 'Mia', 3], [2, 'Ich', 0]]);
  });

  it('joinWeek meldet sich mit Geheimnis an; ohne Identität passiert nichts', async () => {
    const { online, calls } = fakeOnline(() => ({ data: [{ week_start: WEEK }] }));
    assert.deepEqual(await online.joinWeek(identity), { ok: true });
    assert.deepEqual(calls[0].args, { p_player: ID, p_secret: 'geheim' });
    assert.ok((await online.joinWeek(null)).error);
    assert.equal(calls.length, 1);
  });

  it('claimRewards bereinigt die Antwort des Servers', async () => {
    const { online } = fakeOnline(() => ({ data: [
      { week_start: WEEK, rank: 1, score: 9000, coins: 1500, item: 'champion' },
      { week_start: 'kaputt', rank: 2, score: 1, coins: 1, item: null },
      { week_start: WEEK, rank: 4, score: 100, coins: 999999, item: '<b>x</b>' },
      null,
    ] }));
    const r = await online.claimRewards(identity);
    assert.equal(r.rewards.length, 2);
    assert.equal(r.rewards[0].item, 'champion');
    assert.equal(r.rewards[1].item, null);
    assert.equal(r.rewards[1].coins, 5000, 'nach oben begrenzt');
  });

  it('ackRewards schickt nur gültige Wochen', async () => {
    const { online, calls } = fakeOnline(() => ({ data: 1 }));
    await online.ackRewards(identity, [WEEK, 'müll', 5]);
    assert.deepEqual(calls[0].args.p_weeks, [WEEK]);
    await online.ackRewards(identity, []);
    assert.equal(calls.length, 1, 'nichts zu bestätigen → kein Aufruf');
  });

  it('inviteInfo liefert den Namen des Einladenden, sonst null (nie einen Fehler)', async () => {
    assert.deepEqual(await fakeOnline(() => ({ data: [{ name: 'Mia' }] })).online.inviteInfo('k7m-2qx'), { name: 'Mia' });
    assert.deepEqual(await fakeOnline(() => ({ error: 'x', code: 'server' })).online.inviteInfo('K7M2QX'), { name: null });
    assert.deepEqual(await fakeOnline(() => ({ data: [] })).online.inviteInfo('K7M2QX'), { name: null });
    const none = fakeOnline(() => { throw new Error('darf nicht aufgerufen werden'); });
    assert.deepEqual(await none.online.inviteInfo('zu kurz!'), { name: null });
  });
});

describe('Einladungslink', () => {
  it('?join=CODE ist der neue Link, ?friend=CODE funktioniert weiter', () => {
    globalThis.location = { origin: 'https://spiel.test', pathname: '/lane-racer/', search: '' };
    assert.equal(friendShareUrl('k7m2qx'), 'https://spiel.test/lane-racer/?join=K7M2QX');
    for (const [search, expected] of [['?join=k7m-2qx', 'K7M2QX'], ['?friend=K7M2QX', 'K7M2QX'], ['?join=zu', null], ['', null], ['?join=%3Cscript%3E', null]]) {
      globalThis.location.search = search;
      assert.equal(friendCodeFromUrl(), expected, search);
    }
    delete globalThis.location;
  });
});
