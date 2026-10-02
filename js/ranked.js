/*
 * ranked.js – Ranked-Karten: jede volle Stunde (Berlin-Zeit) gibt es eine neue Strecke in einer festen Welt.
 * Die Kennung ("2026092214" = Datum + Stunde) wird vom Server vergeben (ranked_info); lokal wird sie nur als Ersatz berechnet.
 * Der Server prüft beim Einreichen, dass die Runde zur aktuellen (oder gerade abgelaufenen) Karte gehört.
 */
import { WORLDS } from './config.js';

export const RANKED_PREFIX = 'ranked-';
const RE_SLOT = /^(\d{4})(\d{2})(\d{2})([01]\d|2[0-3])$/;

export const isRankedSlot = (slot) => typeof slot === 'string' && RE_SLOT.test(slot);
export const rankedRaceId = (slot) => RANKED_PREFIX + slot;
export const isRankedRaceId = (id) => typeof id === 'string' && id.startsWith(RANKED_PREFIX) && isRankedSlot(id.slice(RANKED_PREFIX.length));

/** Fortlaufende Nummer des Stundenfensters (24 pro Tag). */
export function slotIndex(slot) {
  const m = RE_SLOT.exec(slot);
  if (!m) return 0;
  const days = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  return days * 24 + Number(m[4]);
}

/** Welt dieser Karte. Zwei aufeinanderfolgende Karten haben nie dieselbe Welt (Schritt 3 von 5, alle 5 Karten um 1 verschoben). */
export function rankedWorld(slot) {
  const i = slotIndex(slot);
  return (i * 3 + Math.floor(i / 5)) % WORLDS.length;
}

/** Ersatzberechnung des Fensters aus der Uhr (Berlin), falls der Server nicht erreichbar ist. */
export function localSlot(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour').padStart(2, '0')}`;
}
