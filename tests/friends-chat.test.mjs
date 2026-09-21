// Tests für Freunde (Online-Funktionen mit Attrappe) und Party-Schnellnachrichten.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Online, Party, normalizeFriendCode } from '../js/online.js';
import { QUICK_CHAT, EMOTES } from '../js/config.js';

const ID = '11111111-2222-4333-8444-555555555555';
const FRIEND = '99999999-2222-4333-8444-555555555555';
const identity = { id: ID, secret: 'geheim' };

/** Online-Objekt, dessen Datenbank-Aufrufe wir abfangen. */
function fakeOnline(handler) {
  const online = new Online();
  const calls = [];
  online._rpc = async (fn, args) => {
    calls.push({ fn, args });
    return handler(fn, args);
  };
  return { online, calls };
}

describe('Freundescode', () => {
  it('normalisiert Eingaben und lehnt Ungültiges ab (kein I, O, 0, 1)', () => {
    assert.equal(normalizeFriendCode('k7m2qx'), 'K7M2QX');
    assert.equal(normalizeFriendCode(' K7M-2QX '), 'K7M2QX');
    assert.equal(normalizeFriendCode('K7M2Q'), null, 'zu kurz');
    assert.equal(normalizeFriendCode('K7M2QXY'), null, 'zu lang');
    assert.equal(normalizeFriendCode('K7M2Q0'), null, 'Null ist nicht erlaubt');
    assert.equal(normalizeFriendCode('IIIIII'), null);
    assert.equal(normalizeFriendCode(null), null);
    assert.equal(normalizeFriendCode({}), null);
  });
});

describe('Freunde (Online)', () => {
  it('friendCode holt den Code vom Server und prüft die Antwort', async () => {
    const { online, calls } = fakeOnline(() => ({ data: 'K7M2QX' }));
    assert.deepEqual(await online.friendCode(identity), { code: 'K7M2QX' });
    assert.equal(calls[0].fn, 'my_friend_code');
    assert.deepEqual(calls[0].args, { p_player: ID, p_secret: 'geheim' });
    const bad = fakeOnline(() => ({ data: '<script>' })).online;
    assert.ok((await bad.friendCode(identity)).error, 'Unsinn vom Server wird abgelehnt');
  });

  it('addFriend schickt nur einen gültigen Code und liefert den Namen des Freundes', async () => {
    const { online, calls } = fakeOnline(() => ({ data: [{ friend_id: FRIEND, name: 'Mia' }] }));
    const res = await online.addFriend(identity, 'k7m-2qx');
    assert.deepEqual(res, { friend: { id: FRIEND, name: 'Mia' } });
    assert.equal(calls[0].args.p_code, 'K7M2QX');
    const none = fakeOnline(() => assert.fail('darf keinen Serveraufruf auslösen'));
    const bad = await none.online.addFriend(identity, 'abc');
    assert.ok(bad.error && /gültig/.test(bad.error));
    assert.equal(none.calls.length, 0);
  });

  it('addFriend gibt Serverfehler unverändert weiter', async () => {
    const { online } = fakeOnline(() => ({ error: 'Kein Spieler mit diesem Code', code: 'invalid' }));
    const res = await online.addFriend(identity, 'K7M2QX');
    assert.equal(res.error, 'Kein Spieler mit diesem Code');
  });

  it('removeFriend prüft die ID', async () => {
    const { online, calls } = fakeOnline(() => ({ data: null }));
    assert.deepEqual(await online.removeFriend(identity, FRIEND), { ok: true });
    assert.equal(calls[0].args.p_friend, FRIEND);
    assert.ok((await online.removeFriend(identity, 'kaputt')).error);
  });

  it('friendsBoard sortiert nach Rekord und nummeriert', async () => {
    const rows = [
      { player_id: ID, name: 'Ich', car: 'blitz', color: '#ff5a1f', best: 1200, runs: 3 },
      { player_id: FRIEND, name: 'Mia', car: 'kiwi', color: '#2ec4b6', best: 3400, runs: 9 },
    ];
    const { online } = fakeOnline(() => ({ data: rows }));
    const res = await online.friendsBoard(identity);
    assert.deepEqual(res.rows.map((r) => [r.rank, r.name]), [[1, 'Mia'], [2, 'Ich']]);
  });

  it('ohne Identität passiert nichts', async () => {
    const { online, calls } = fakeOnline(() => ({ data: null }));
    assert.ok((await online.friendCode(null)).error);
    assert.ok((await online.friendsBoard({})).error);
    assert.equal(calls.length, 0);
  });
});

describe('Party-Schnellnachrichten', () => {
  it('sind feste, kurze Sätze mit eindeutiger ID', () => {
    assert.equal(new Set(QUICK_CHAT.map((c) => c.id)).size, QUICK_CHAT.length);
    for (const c of QUICK_CHAT) assert.ok(c.text.length > 0 && c.text.length <= 30, c.id);
    for (const c of QUICK_CHAT) assert.ok(!EMOTES.includes(c.id));
  });

  /** Party-Objekt mit abgefangenem Senden, ohne Netzwerk. */
  function partyObject() {
    const party = Object.create(Party.prototype);
    const sent = [];
    const events = [];
    party._leaving = false;
    party._lastEmoteAt = -Infinity;
    party._me = { id: ID, name: 'Ich', color: '#ff5a1f' };
    party._broadcast = (event, payload) => { sent.push({ event, payload }); return true; };
    party._events = { emit: (name, data) => events.push({ name, data }) };
    party._others = new Map([[FRIEND, { name: 'Mia', color: '#2ec4b6' }]]);
    party._meta = new Map([[FRIEND, { lastEmoteAt: -Infinity }]]);
    return { party, sent, events };
  }

  it('sendChat sendet nur die ID und meldet sich selbst lokal', () => {
    const { party, sent, events } = partyObject();
    assert.equal(party.sendChat('gg'), true);
    assert.deepEqual(sent, [{ event: 'chat', payload: { id: ID, chat: 'gg' } }]);
    assert.equal(events[0].name, 'chat');
    assert.equal(events[0].data.text, QUICK_CHAT.find((c) => c.id === 'gg').text);
    assert.equal(events[0].data.isMe, true);
  });

  it('sendChat lehnt Unbekanntes und zu schnelles Wiederholen ab', () => {
    const { party, sent } = partyObject();
    assert.equal(party.sendChat('<b>hi</b>'), false);
    assert.equal(party.sendChat('gg'), true);
    assert.equal(party.sendChat('again'), false, 'Wartezeit');
    assert.equal(sent.length, 1);
  });

  it('empfangene Nachrichten: Text kommt aus der eigenen Liste, nicht aus dem Netz', () => {
    const { party, events } = partyObject();
    party._handleChat({ id: FRIEND, chat: 'nice', text: 'ICH SCHREIBE WAS ICH WILL' });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.text, QUICK_CHAT.find((c) => c.id === 'nice').text);
    assert.equal(events[0].data.name, 'Mia');
    // Müll, fremde und eigene IDs, unbekannte Nachricht
    party._handleChat(null);
    party._handleChat({ id: FRIEND, chat: 'hack' });
    party._handleChat({ id: ID, chat: 'gg' });
    party._handleChat({ id: '00000000-0000-4000-8000-000000000000', chat: 'gg' });
    assert.equal(events.length, 1);
  });

  it('empfangene Nachrichten werden pro Sender gedrosselt', () => {
    const { party, events } = partyObject();
    party._handleChat({ id: FRIEND, chat: 'gg' });
    party._handleChat({ id: FRIEND, chat: 'gg' });
    assert.equal(events.length, 1);
  });
});
