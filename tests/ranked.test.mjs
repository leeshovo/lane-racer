// Tests für Ranked-Karten (12-Stunden-Fenster) und den Fahrtverlauf für den Cheat-Schutz.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLDS } from '../js/config.js';
import { Online, cleanTrace } from '../js/online.js';
import { isRankedSlot, isRankedRaceId, rankedRaceId, rankedWorld, slotIndex, localSlot } from '../js/ranked.js';

const ID = '11111111-2222-4333-8444-555555555555';
const identity = { id: ID, secret: 'geheim' };
const RUN = '99999999-2222-4333-8444-555555555555';

function fakeOnline(handler) {
  const online = new Online();
  const calls = [];
  online._rpc = async (fn, args) => { calls.push({ fn, args }); return handler(fn, args); };
  return { online, calls };
}

describe('Ranked-Fenster', () => {
  it('erkennt gültige Kennungen', () => {
    assert.ok(isRankedSlot('20260922a'));
    assert.ok(isRankedSlot('20260922b'));
    assert.ok(!isRankedSlot('20260922c'));
    assert.ok(!isRankedSlot('2026092a'));
    assert.ok(!isRankedSlot(null));
    assert.equal(rankedRaceId('20260922a'), 'ranked-20260922a');
    assert.ok(isRankedRaceId('ranked-20260922b'));
    assert.ok(!isRankedRaceId('daily-20260922'));
  });

  it('a und b desselben Tages folgen aufeinander', () => {
    assert.equal(slotIndex('20260922b') - slotIndex('20260922a'), 1);
    assert.equal(slotIndex('20260923a') - slotIndex('20260922b'), 1);
  });

  it('die Welt wechselt bei jeder Karte und deckt alle Welten ab', () => {
    const seen = new Set();
    let prev = -1;
    for (let d = 0; d < 60; d++) {
      for (const half of ['a', 'b']) {
        const day = String(1 + (d % 28)).padStart(2, '0');
        const month = String(1 + Math.floor(d / 28)).padStart(2, '0');
        const w = rankedWorld(`2026${month}${day}${half}`);
        assert.ok(w >= 0 && w < WORLDS.length);
        assert.notEqual(w, prev, `${month}${day}${half}`);
        prev = w;
        seen.add(w);
      }
    }
    assert.equal(seen.size, WORLDS.length);
  });

  it('die lokale Ersatzberechnung liefert ein gültiges Fenster', () => {
    assert.ok(isRankedSlot(localSlot()));
    // 2026-09-22 08:00 UTC = 10:00 Berlin (Sommerzeit) -> a; 10:00 UTC = 12:00 Berlin -> b
    assert.equal(localSlot(Date.UTC(2026, 8, 22, 8, 0)), '20260922a');
    assert.equal(localSlot(Date.UTC(2026, 8, 22, 10, 0)), '20260922b');
    // 22:00 UTC = 00:00 Berlin des Folgetags
    assert.equal(localSlot(Date.UTC(2026, 8, 22, 22, 0)), '20260923a');
    // Winterzeit: 11:00 UTC = 12:00 Berlin
    assert.equal(localSlot(Date.UTC(2026, 11, 2, 11, 0)), '20261202b');
    assert.equal(localSlot(Date.UTC(2026, 11, 2, 10, 59)), '20261202a');
  });
});

describe('Fahrtverlauf', () => {
  it('cleanTrace verwirft Ungültiges', () => {
    assert.equal(cleanTrace(null), null);
    assert.equal(cleanTrace([]), null);
    assert.equal(cleanTrace([1, 'x']), null);
    assert.equal(cleanTrace([1, -5]), null);
    assert.deepEqual(cleanTrace([40.4, 90.6]), [40, 91]);
    assert.equal(cleanTrace(Array.from({ length: 900 }, (_, i) => i)).length, 400);
  });

  it('submitScore schickt den Verlauf mit', async () => {
    const { online, calls } = fakeOnline(async () => ({ data: [{ rank: 1, best: 500, is_record: true }] }));
    const trace = [40, 82, 125, 170];
    const res = await online.submitScore(identity, { runId: RUN, score: 500, duration: 6.2, coins: 0, nearMisses: 0, overtakes: 6, smashed: 0, level: 1, car: 'blitz', raceId: 'ranked-20260922a', trace });
    assert.equal(res.rank, 1);
    assert.deepEqual(calls[0].args.p_trace, trace);
    assert.equal(calls[0].args.p_race, 'ranked-20260922a');
  });

  it('leaderboard(ranked) fragt die richtige Karte ab', async () => {
    const { online, calls } = fakeOnline(async () => ({ data: [] }));
    await online.leaderboard('ranked', '20260922b');
    assert.equal(calls[0].fn, 'leaderboard_ranked');
    assert.equal(calls[0].args.p_slot, '20260922b');
    await online.leaderboard('ranked', 'kaputt');
    assert.equal(calls[1].args.p_slot, '');
  });

  it('rankedInfo prüft die Antwort', async () => {
    const good = fakeOnline(async () => ({ data: [{ slot: '20260922a', starts_at: '2026-09-21T22:00:00Z', ends_at: '2026-09-22T10:00:00Z', server_now: '2026-09-22T06:00:00Z' }] }));
    const info = await good.online.rankedInfo();
    assert.equal(info.slot, '20260922a');
    assert.equal(info.endsAt, Date.parse('2026-09-22T10:00:00Z'));
    const bad = fakeOnline(async () => ({ data: [{ slot: '<b>', starts_at: 'x', ends_at: 'y', server_now: 'z' }] }));
    assert.ok((await bad.online.rankedInfo()).error);
  });
});

describe('Server-Regeln (SQL)', () => {
  const SQL = fs.readFileSync(new URL('../supabase/migrations/20260922_ranked_maps_and_trace.sql', import.meta.url), 'utf8');
  it('das Tempolimit des Fahrtverlaufs deckt das schnellste Auto mit Overdrive und Nitro ab', () => {
    // Vortex: 1,17 (Auto) × 1,4 (Boost) × 1,3 (Overdrive) × 1,3 (Nitro) = 2,77
    const m = /\* ([0-9.]+) \* 1\.03\) \+ 3/.exec(SQL);
    assert.ok(m && Number(m[1]) * 1.03 >= 2.77 * 1.0, 'Grenze zu niedrig');
  });
  it('die Trace-Taktung im SQL passt zum Spiel (1,5 s)', () => {
    assert.match(SQL, /p_dur \/ 1\.5/);
    assert.match(fs.readFileSync(new URL('../js/game.js', import.meta.url), 'utf8'), /TRACE_STEP = 1\.5/);
  });
});
