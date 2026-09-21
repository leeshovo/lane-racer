// Tests: Die letzte Party wird gemerkt, Einstellungs-Reiter und Hinweise sind stimmig.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, defaultProfile, adoptSnapshot, snapshotOf, PARTY_MEMORY_MS } from '../js/storage.js';
import { SETTINGS_GROUPS, DEFAULT_SETTINGS, sanitizeSettings } from '../js/config.js';

function withStored(value, fn) {
  globalThis.localStorage = { getItem: () => (value === null ? null : JSON.stringify(value)), setItem() {} };
  try { return fn(); } finally { delete globalThis.localStorage; }
}

describe('Letzte Party', () => {
  it('bleibt erhalten, solange sie frisch und gültig ist', () => {
    const at = Date.now() - 3600 * 1000;
    const p = withStored({ lastParty: { code: 'ABCDE', at } }, loadProfile);
    assert.deepEqual(p.lastParty, { code: 'ABCDE', at });
  });

  it('verfällt nach 14 Tagen', () => {
    const p = withStored({ lastParty: { code: 'ABCDE', at: Date.now() - PARTY_MEMORY_MS - 1000 } }, loadProfile);
    assert.equal(p.lastParty, null);
  });

  it('ungültige Einträge werden verworfen', () => {
    for (const bad of [{ code: 'ab', at: Date.now() }, { code: '<script>', at: Date.now() }, { code: 'ABCDE', at: 'gestern' }, 'ABCDE', 42, null]) {
      assert.equal(withStored({ lastParty: bad }, loadProfile).lastParty, null, JSON.stringify(bad));
    }
  });

  it('ein neuer Spieler hat keine Party; ein Cloud-Spielstand ändert sie nicht (gehört zum Gerät)', () => {
    assert.equal(defaultProfile().lastParty, null);
    const local = defaultProfile();
    local.lastParty = { code: 'QWERT', at: Date.now() };
    adoptSnapshot(local, snapshotOf(defaultProfile()));
    assert.equal(local.lastParty.code, 'QWERT');
    assert.equal('lastParty' in snapshotOf(local), false);
  });
});

describe('Einstellungen: Reiter und Hinweise', () => {
  it('"Hinweise im Spiel" gibt es mit drei Stufen, Standard: wenige', () => {
    const item = SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'hints');
    assert.deepEqual(item.options.map(([v]) => v), ['off', 'few', 'all']);
    assert.equal(DEFAULT_SETTINGS.hints, 'few');
    assert.equal(sanitizeSettings({ hints: 'laut' }).hints, 'few');
    assert.equal(sanitizeSettings({ hints: 'all' }).hints, 'all');
  });

  it('die Gruppen, aus denen die Reiter gebaut werden, gibt es alle', () => {
    const ids = SETTINGS_GROUPS.map((g) => g.id);
    for (const id of ['sound', 'graphics', 'gameplay', 'display', 'access']) assert.ok(ids.includes(id), id);
  });
});
