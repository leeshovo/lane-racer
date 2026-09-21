/*
 * ui-kit.js – Werkzeuge für die Oberfläche (aus ui.js herausgelöst).
 *
 * Zahlen formatieren, Texte aus dem Netz bereinigen, DOM-Elemente bauen (h), Icons, Zahlenanzeige (Digits)
 * und wiederverwendete Animations-Keyframes. Enthält keine Spiellogik und keinen Zustand.
 */
import { CARS, MISSION_POOL } from './config.js';

export const TEAL = '#2EC4B6';
export const MUTED = '#95A0B3';

// ===========================================================================
// Formatierung & Bereinigung
// ===========================================================================
export const NF = new Intl.NumberFormat('de-DE');
export const NF1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0
export const fmtInt = (v) => NF.format(Math.floor(num(v)));
export const fmtDist = (v) => `${fmtInt(v)} m`;
export const fmtLongDist = (v) => (num(v) >= 10000 ? `${NF1.format(num(v) / 1000)} km` : fmtDist(v));
export const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(num(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/** Stat-Werte liegen zwischen 0,9 und 1,3 → Anteil 0..1 für die Balken. */
export const statFrac = (v) => Math.min(1, Math.max(0.06, (num(v) - 0.9) / 0.4));
/** true, wenn sich zwei Zahlen um mehr als eps unterscheiden (NaN zählt als geändert). */
export const changed = (a, b, eps) => !(Math.abs(a - b) <= eps);
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const isDigit = (ch) => ch >= '0' && ch <= '9';

export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Nur echte #rrggbb-Farben durchlassen (Farben anderer Spieler sind unsicher). */
export const safeColor = (c, fallback = MUTED) => (typeof c === 'string' && COLOR_RE.test(c) ? c : fallback);

// Steuerzeichen, spitze Klammern, unsichtbare Zeichen und Bidi-Overrides entfernen
export const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f<>\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function cleanName(value, max = 16) {
  if (typeof value !== 'string') return '';
  const s = value.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}
export function cleanText(value, max = 160) {
  if (value == null) return '';
  const s = String(value).replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
/** Prüft einen Namen wie der Server (2–16 Zeichen, keine < > oder Steuerzeichen). */
export function nameError(name) {
  const len = Array.from(name).length;
  if (len < 2) return 'Mindestens 2 Zeichen, bitte.';
  if (len > 16) return 'Höchstens 16 Zeichen.';
  if (/[<>\u0000-\u001f]/.test(name)) return 'Bitte ohne < und > und ohne Steuerzeichen.';
  return null;
}
export const carName = (id) => (CARS.find((c) => c.id === id) || {}).name || '';
export const missionMode = (id) => (MISSION_POOL.find((d) => d.id === id) || {}).mode || null;

export const mq = (query) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia(query)
  : { matches: false, addEventListener() {} });

// ===========================================================================
// DOM-Helfer
// ===========================================================================

/**
 * Baut ein Element: h('button', { class: 'btn', onClick: fn }, 'Text', kindElement).
 * Strings werden immer als Textknoten eingefügt – dadurch ist jeder Inhalt
 * automatisch sicher, egal was drinsteht.
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') {
        for (const prop of Object.keys(value)) node.style.setProperty(prop, value[prop]);
      } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendAll(node, children);
  return node;
}
export function appendAll(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendAll(node, child);
    else node.append(child instanceof Node ? child : String(child));
  }
}
/** Web-Animations-API mit Absicherung (ältere Browser / Testumgebungen). */
export function animate(el, frames, options) {
  if (!el || typeof el.animate !== 'function') return null;
  try {
    return el.animate(frames, options);
  } catch (err) {
    return null;
  }
}
export const coinIcon = () => h('i', { class: 'coin', 'aria-hidden': 'true' });
export const checker = (cls = '') => h('span', { class: `checker ${cls}`.trim(), 'aria-hidden': 'true' });
export const chevrons = () => h('span', { class: 'chev', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
export const srOnly = (text) => h('span', { class: 'sr-only' }, text);

// ---------------------------------------------------------------------------
// Icons: konstante SVG-Pfade (keine dynamischen Daten → innerHTML hier unbedenklich)
// ---------------------------------------------------------------------------
export const ICONS = {
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.2h4.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h11"/>',
  car: '<path d="M5 17H3.5v-4l2.2-5.1A2 2 0 0 1 7.5 6.6h9a2 2 0 0 1 1.8 1.3l2.2 5.1v4H19"/><path d="M3.5 13h17"/><circle cx="7.3" cy="17" r="1.9"/><circle cx="16.7" cy="17" r="1.9"/><path d="M9.2 17h5.6"/>',
  trophy: '<path d="M8 4h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6H5.2A3 3 0 0 0 8 10.2M16 6h2.8A3 3 0 0 1 16 10.2"/><path d="M12 13.2V17M8.5 20h7M9.8 17h4.4"/>',
  users: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.8 14.1a4.6 4.6 0 0 1 5.2 4.6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  sliders: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  pencil: '<path d="M4.5 19.5l1-4.2L16 4.8l3.2 3.2L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>',
  crown: '<path d="M3.6 17.6L2.7 7.4l5.2 3.9L12 4.6l4.1 6.7 5.2-3.9-.9 10.2z" fill="currentColor" stroke-width="1.2"/><path d="M4 20h16" stroke-width="2"/>',
  check: '<path d="M5 12.5l4.3 4.3L19 7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.6"/><path d="M15.5 8.5V5.2a1.2 1.2 0 0 0-1.2-1.2H5.2A1.2 1.2 0 0 0 4 5.2v9.1a1.2 1.2 0 0 0 1.2 1.2h3.3"/>',
  share: '<path d="M12 15V4.2M7.6 8.4L12 4l4.4 4.4"/><path d="M5 12.8V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6.2"/>',
  bolt: '<path d="M13.2 2.8L5.3 13.4h5.9l-1 7.8 7.9-10.7h-5.9z" fill="currentColor" stroke-width="1.1"/>',
  shield: '<path d="M12 3.2l7.3 2.9v5.4c0 4.5-3.1 8-7.3 9.3-4.2-1.3-7.3-4.8-7.3-9.3V6.1z"/><path d="M8.8 12l2.2 2.2 4.3-4.4"/>',
  magnet: '<path d="M5 4h4.4v8a2.6 2.6 0 0 0 5.2 0V4H19v8a7 7 0 0 1-14 0z"/><path d="M5 8.2h4.4M14.6 8.2H19"/>',
  coins: '<ellipse cx="12" cy="6.8" rx="7" ry="2.8"/><path d="M5 6.8v5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5"/><path d="M5 11.8v5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.8"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4h12.5l-2.4 4.4 2.4 4.6H5.5"/>',
  alert: '<path d="M12 3.6L2.6 20h18.8z"/><path d="M12 9.8v4.6"/><circle cx="12" cy="17.2" r=".7" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".8" fill="currentColor"/>',
  chevrons: '<path d="M5 17l5-5-5-5M12 17l5-5-5-5"/>',
  arrowLeft: '<path d="M15.6 4.4L6.8 12l8.8 7.6z" fill="currentColor" stroke-width="1.4"/>',
  arrowRight: '<path d="M8.4 4.4l8.8 7.6-8.8 7.6z" fill="currentColor" stroke-width="1.4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6v4.8l3.1 2"/>',
  road: '<path d="M8 3.5L4.5 20.5M16 3.5l3.5 17"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
export const iconCache = new Map();
export function icon(name, cls = '') {
  let tpl = iconCache.get(name);
  if (!tpl) {
    tpl = document.createElement('template');
    tpl.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
    iconCache.set(name, tpl);
  }
  const svg = tpl.content.firstElementChild.cloneNode(true);
  if (cls) svg.classList.add(...cls.split(' ').filter(Boolean));
  return svg;
}

// ---------------------------------------------------------------------------
// Ziffernanzeige mit festen Ziffernbreiten
// ---------------------------------------------------------------------------
/**
 * Russo One und Saira haben proportionale Ziffern (kein "tnum"). Damit schnell
 * laufende Zahlen (Strecke, Tempo, Count-ups) nicht zappeln, steckt jede Ziffer
 * in einer eigenen Zelle mit fester Breite. Bei einer Änderung werden nur die
 * Zellen neu beschrieben, deren Ziffer sich tatsächlich geändert hat.
 */
export class Digits {
  constructor(className = '') {
    this.el = h('span', { class: `digits ${className}`.trim() });
    this.value = NaN;
    this.text = '';
    this.cells = [];
  }

  set(value) {
    const v = Math.floor(num(value));
    if (v === this.value) return;
    this.value = v;
    const text = NF.format(v);
    if (text.length !== this.text.length) {
      // Andere Stellenzahl → Zellen neu aufbauen (selten)
      this.el.textContent = '';
      this.cells.length = 0;
      for (const ch of text) {
        const cell = document.createElement('span');
        cell.className = isDigit(ch) ? 'dg' : 'ds';
        cell.textContent = ch;
        this.el.append(cell);
        this.cells.push(cell);
      }
    } else {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === this.text[i]) continue;
        const cell = this.cells[i];
        cell.textContent = ch;
        const cls = isDigit(ch) ? 'dg' : 'ds';
        if (cell.className !== cls) cell.className = cls;
      }
    }
    this.text = text;
  }
}

// Sortierung der Live-Liste (einmal definiert → keine Allokation pro Frame)
export const byDistanceDesc = (a, b) => num(b.distance) - num(a.distance);

// Keyframes, die häufig gebraucht werden (einmal angelegt)
export const FRAMES = {
  bump: [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.35 }, { transform: 'scale(1)' }],
  popIn: [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
  popup: [
    { transform: 'translateY(14px) scale(0.5) skewX(-10deg)', opacity: 0 },
    { transform: 'translateY(0) scale(1.14) skewX(-10deg)', opacity: 1, offset: 0.14 },
    { transform: 'translateY(-6px) scale(1) skewX(-10deg)', opacity: 1, offset: 0.3 },
    { transform: 'translateY(-26px) scale(1) skewX(-10deg)', opacity: 1, offset: 0.74 },
    { transform: 'translateY(-50px) scale(0.94) skewX(-10deg)', opacity: 0 },
  ],
  popupCalm: [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
  countNum: [
    { transform: 'scale(2.5) skewX(-10deg)', opacity: 0, easing: 'cubic-bezier(.15,.85,.3,1)' },
    { transform: 'scale(1) skewX(-10deg)', opacity: 1, offset: 0.28 },
    { transform: 'scale(1.05) skewX(-10deg)', opacity: 1, offset: 0.78, easing: 'ease-in' },
    { transform: 'scale(0.72) skewX(-10deg)', opacity: 0 },
  ],
  countGo: [
    { transform: 'scale(0.3) skewX(-10deg)', opacity: 0, easing: 'cubic-bezier(.2,1.4,.4,1)' },
    { transform: 'scale(1.16) skewX(-10deg)', opacity: 1, offset: 0.45 },
    { transform: 'scale(1) skewX(-10deg)', opacity: 1 },
  ],
  ring: [
    { transform: 'scale(0.35)', opacity: 0.95 },
    { transform: 'scale(1.7)', opacity: 0 },
  ],
  coinDelta: [
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)', offset: 0.12 },
    { opacity: 1, transform: 'translateY(0)', offset: 0.72 },
    { opacity: 0, transform: 'translateY(-10px)' },
  ],
};

