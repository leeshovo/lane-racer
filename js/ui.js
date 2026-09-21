/*
 * ui.js – die komplette DOM-Oberfläche von Lane Racer 2.0:
 * Menü, Garage, Rangliste, Party-Lobby, Missionen, Einstellungen, Namensdialog,
 * HUD, Countdown, Einblendungen, Pause, Rundenende, Emotes, Touch-Steuerung.
 *
 * Designrichtung: „Nacht-Rallye im TV-Overlay“ – schräge Panels, Chevrons,
 * Zielflaggen-Muster, kräftige Condensed-Schrift (siehe style.css).
 *
 * Grundregeln dieser Datei:
 *  - Alles wird mit createElement/textContent gebaut. Namen anderer Spieler sind
 *    NICHT vertrauenswürdig → niemals innerHTML mit dynamischen Daten.
 *    (Einzige Ausnahme: die konstanten SVG-Icons weiter unten.)
 *  - Elemente werden einmal gebaut und danach nur noch aktualisiert, wenn sich
 *    wirklich etwas geändert hat. Besonders wichtig für updateHud(), das in
 *    jedem Frame aufgerufen wird.
 *  - Die UI kennt keine Spiellogik. Sie meldet Klicks über `callbacks` an
 *    main.js und zeigt an, was main.js ihr übergibt.
 */
import {
  CARS, PERKS, EMOTES, WORLDS, CONFIG, MISSION_POOL, LEVELS_PER_WORLD, VERSION, DEFAULT_SETTINGS, SETTINGS_GROUPS,
  SPECIAL_COLORS, STREAK, streakBonus, QUICK_CHAT, WEEKLY_ITEMS, WEEKLY_RESET, weeklyPrizeCoins,
  TUNING, TUNING_MAX, tuningCost,
} from './config.js';
import {
  TEAL, MUTED, NF, NF1, num, clamp01, fmtInt, fmtDist, fmtLongDist, fmtTime, fmtCountdown, statFrac, changed, easeOut, isDigit, COLOR_RE, safeColor, UNSAFE_CHARS, cleanName, cleanText, nameError, carName, missionMode, mq, h, appendAll, animate, coinIcon, checker, chevrons, srOnly, ICONS, iconCache, icon, Digits, byDistanceDesc, FRAMES,
} from './ui-kit.js';

// ===========================================================================
// Konstanten
// ===========================================================================
const SCREENS = ['loading', 'menu', 'campaign', 'garage', 'leaderboard', 'party', 'missions', 'settings', 'hud', 'gameover'];
const TOPBAR_SCREENS = new Set(['menu', 'campaign', 'garage', 'leaderboard', 'party', 'missions', 'settings']);

// Gleiche Grenze wie main.js (Kamera-Layout): darunter Handy-Layout mit Bottom-Sheet
const PHONE_QUERY = '(max-width: 899.98px)';

const TIME_TAG = { dawn: 'Morgen', day: 'Mittag', dusk: 'Abend', night: 'Nacht' };
const MODEL_LABEL = {
  coupe: 'Sportcoupé', hatch: 'Kleinwagen', muscle: 'Muscle-Car', pickup: 'Pick-up',
  police: 'Abfangjäger', gt: 'Supersportler', formula: 'Formelwagen', hover: 'Schwebegleiter',
  wedge: 'Keil-Supersportler', roadster: 'Roadster', suv: 'Geländewagen', tuner: 'Tuner', hyper: 'Hypersportwagen',
};
const STAT_DEFS = [['speed', 'Tempo'], ['handling', 'Handling'], ['nitro', 'Nitro']];
const NET_LABEL = { online: 'Online', connecting: 'Verbinde …', offline: 'Offline' };
const LB_TABS = [
  { kind: 'weekly', label: 'Diese Woche' },
  { kind: 'ranked', label: 'Ranked' },
  { kind: 'global', label: 'Allzeit' },
  { kind: 'daily', label: 'Heute' },
  { kind: 'friends', label: 'Freunde' },
  { kind: 'party', label: 'Party' },
];
// [Schlüssel in coins.breakdown, Beschriftung, immer anzeigen?]
const BREAKDOWN_ROWS = [
  ['collected', 'Eingesammelt', true],
  ['nearMiss', 'Beinahe-Unfälle', true],
  ['smash', 'Gerammt', true],
  ['distance', 'Strecke', true],
  ['perk', 'Bonus', false],
  ['missions', 'Missionen', false],
  ['campaign', 'Kampagne', false],
  ['streak', 'Tagesserie', false],
  ['achievements', 'Erfolge', false],
];
const POPUP_KINDS = new Set(['near', 'combo', 'smash', 'power', 'coin']);
const TOAST_KINDS = new Set(['level', 'world', 'mission', 'party', 'info', 'error']);
const TOAST_ICON = { level: 'chevrons', world: 'flag', mission: 'check', party: 'users', info: 'info', error: 'alert' };
const FLASH_COLORS = {
  red: '#FF3B4E', crash: '#FF3B4E', danger: '#FF3B4E', green: '#7CF29C', shield: '#7CF29C',
  cyan: '#00E5FF', nitro: '#00E5FF', gold: '#FFC93C', white: '#F3F5F9', orange: '#FF5A1F',
};
const MEMBER_STATUS = {
  menu: 'Im Menü', garage: 'In der Garage', lobby: 'In der Lobby', countdown: 'Am Start',
  driving: 'Fährt', crashed: 'Crash',
};
const HUD_SPEED_MAX = 400;      // km/h für die volle Tacho-Leiste
const EMOTE_COOLDOWN = 1200;    // ms zwischen zwei eigenen Emotes
const GAMEOVER_GUARD = 650;     // ms, in denen die Rundenende-Buttons noch gesperrt sind

const TICKER_TIPS = [
  'Knapp vorbei zählt: Beinahe-Unfälle füllen Nitro und bringen Kombo-Münzen',
  'Mit Nitro bist du unverwundbar – ramm den Verkehr für Extra-Münzen',
  `Alle ${LEVELS_PER_WORLD} Level wartet eine neue Welt: ${WORLDS.map((w) => w.name).join(' · ')}`,
  'Schick deinen Freunden einen Party-Link und fahrt dasselbe Rennen gleichzeitig',
  'Schild, Magnet und 2× Münzen liegen als Power-ups auf der Straße',
  'Missionen zahlen Bonus-Münzen – neue Autos warten in der Garage',
];

// ===========================================================================
// UI
// ===========================================================================
export class UI {
  /**
   * @param {{ root: HTMLElement, callbacks: object }} options
   *   callbacks: alle optional – onPlay, onOpenGarage, onOpenLeaderboard, onOpenParty,
   *   onOpenMissions, onOpenSettings, onBack, onPreviewCar, onBuyCar, onSelectCar,
   *   onSelectColor, onSubmitName, onRename, onLeaderboardTab, onCreateParty,
   *   onJoinParty, onLeaveParty, onStartRace, onCopyInvite, onShareInvite, onEmote, onChat,
   *   onFriendAdd, onFriendCopy, onFriendShare, onFriendRemove, onOpenFriends, onPartyFriend,
   *   onOpenCampaign, onStartMap, onNextMap, onWeekInvite, onWeekShare, onWeekRewardClose,
   *   onSettingsChange, onPause, onResume, onPauseSettings, onRestart, onToMenu, onTouch, onUiSound
   */
  constructor({ root, callbacks } = {}) {
    let el = root || document.getElementById('ui');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ui';
      document.body.append(el);
    }
    this.root = el;
    this.cb = callbacks || {};

    // Medienabfragen
    this._mqReduced = mq('(prefers-reduced-motion: reduce)');
    this.reducedMotion = !!this._mqReduced.matches;
    const onReduced = (e) => { this.reducedMotion = !!e.matches; };
    if (this._mqReduced.addEventListener) this._mqReduced.addEventListener('change', onReduced);
    this.mqPhone = mq(PHONE_QUERY);
    this.canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    // Zustand
    this.screen = null;
    this.screens = {};
    this.focusTargets = {};
    this._settings = { ...DEFAULT_SETTINGS };
    this._name = '';
    this._coinsTarget = null;
    this._coinsShown = 0;
    this._coinsTween = 0;
    this._emoteBtns = [];
    this._emoteReadyAt = 0;
    this._emoteTimer = 0;
    this._touchOn = false;
    this._holds = [];
    this._hudLast = {
      kmh: NaN, level: 0, world: null, coins: NaN, nitro: NaN, ready: null, active: null,
      combo: -1, comboFrac: NaN, comboShow: null, live: null, race: null,
      abilityOn: null, abilityName: '', abilityFrac: NaN, abilityState: '',
    };
    this._speedFactor = 1; // 1 = km/h, 0,621 = mph
    this._liveRows = [];
    this._liveOrder = [];
    this.goData = null;
    this._goRaf = 0;

    // Aufbau (Reihenfolge = Stapelreihenfolge im DOM; z-index regelt style.css)
    el.textContent = ''; // statischen Lade-Hinweis aus index.html entfernen
    el.classList.add('ui');
    this._buildTouch();
    this._buildHud();
    this._buildLoading();
    this._buildMenu();
    this._buildGarage();
    this._buildLeaderboard();
    this._buildParty();
    this._buildMissions();
    this._buildCampaign();
    this._buildSettings();
    this._buildGameOver();
    this._buildTopBar();
    this._buildOverlays();
    this._buildPause();
    this._buildWeekReward();
    this._buildNameDialog();
    this._buildFatal();

    // Klick-Sound für alle Buttons (außer denen mit data-sfx="none")
    el.addEventListener('click', (e) => this._onRootClick(e));

    this.showScreen('loading');
  }

  // =========================================================================
  // Öffentliche API
  // =========================================================================

  /** Wechselt den Hauptbildschirm. Overlays (Pause, Countdown, Dialog, Toasts) bleiben unberührt. */
  showScreen(name) {
    const target = SCREENS.includes(name) ? name : 'none';
    const prev = this.screen;
    // Fokus merken, BEVOR etwas versteckt wird (sonst setzt der Browser ihn auf <body>)
    const active = document.activeElement;
    const focusInUi = !!active && active !== document.body && this.root.contains(active) && !this._inOverlay(active);

    this.screen = target;
    for (const key of SCREENS) {
      const on = key === target;
      const sec = this.screens[key];
      if (sec.hidden === on) sec.hidden = !on;
    }
    this.topbar.hidden = !TOPBAR_SCREENS.has(target);
    this.root.dataset.screen = target;

    if (prev === 'gameover' && target !== 'gameover') this._finishGameOverAnim();

    if (target === 'hud' || target === 'none') {
      // Während der Fahrt darf kein Button den Fokus haben (Leertaste = Nitro!)
      if (focusInUi) active.blur();
    } else if (prev !== target && focusInUi) {
      const ft = this.focusTargets[target];
      if (ft) ft.focus({ preventScroll: true });
    }
    if (target === 'garage') this._afterFrame(() => this._scrollToPreview(false));
  }

  setLoading(text) {
    this.ld.text.textContent = cleanText(text, 120) || 'Lädt …';
  }

  /** Obere Leiste: Name, Online-Status, Party-Chip, Münzen (zählen animiert hoch/runter). */
  renderTopBar({ name, coins, onlineStatus, party } = {}) {
    const tb = this.tb;
    if (name !== undefined) {
      const nm = cleanName(name) || 'Gast';
      if (nm !== this._name) {
        this._name = nm;
        tb.nameText.textContent = nm;
        tb.nameBtn.setAttribute('aria-label', `Fahrername: ${nm} – ändern`);
        this.st.nameValue.textContent = nm;
      }
    }
    if (onlineStatus !== undefined) {
      const status = NET_LABEL[onlineStatus] ? onlineStatus : 'offline';
      if (tb.net.dataset.status !== status) {
        tb.net.dataset.status = status;
        tb.netText.textContent = NET_LABEL[status];
        tb.net.title = status === 'online' ? 'Verbunden mit der Rangliste' : status === 'connecting' ? 'Verbindung wird aufgebaut' : 'Keine Verbindung – das Spiel läuft trotzdem';
      }
    }
    if (party !== undefined) {
      const code = party && typeof party.code === 'string' ? party.code : '';
      tb.partyBtn.hidden = !code;
      if (code) {
        const count = Math.max(1, num(party.memberCount) | 0);
        tb.partyCode.textContent = code;
        tb.partyCount.textContent = String(count);
        tb.partyBtn.setAttribute('aria-label', `Party ${code} mit ${count} ${count === 1 ? 'Fahrer' : 'Fahrern'} öffnen`);
      }
    }
    if (coins !== undefined && Number.isFinite(Number(coins))) this._setCoins(Number(coins));
  }

  /** Hauptmenü: Rekord, gewähltes Auto, 3 Missionen, Party-Hinweis. */
  renderMenu({ best = 0, car = null, missions = [], party = null, daily = null, rejoin = '', campaign = null, ranked = null } = {}) {
    const m = this.mn;
    if (campaign && m.campaignSub) m.campaignSub.textContent = `Stufe ${campaign.level} · ${campaign.stars}/${campaign.maxStars} ★`;
    m.best.set(best);
    const c = car && typeof car === 'object' ? car : null;
    const perk = c && c.perk ? PERKS[c.perk] : null;
    m.carName.textContent = c ? c.name : '—';
    m.carPerk.textContent = perk ? perk.name : 'Kein Perk';
    m.ltName.textContent = c ? c.name : '—';
    m.ltModel.textContent = c ? MODEL_LABEL[c.model] || '' : '';
    m.ltPerk.textContent = perk ? `${perk.name}: ${perk.text}` : 'Pure Werte, keine Extras';
    if (c) m.lowerThird.style.setProperty('--car', safeColor(c.colors && c.colors[0], '#FF5A1F'));

    this._fillMissionList(m.missionList, missions, true);

    const code = party && typeof party.code === 'string' ? party.code : '';
    m.partyBadge.hidden = !code;
    if (code) {
      const count = Math.max(1, num(party.memberCount) | 0);
      m.partyCode.textContent = code;
      m.partyCount.textContent = `${count} ${count === 1 ? 'Fahrer' : 'Fahrer'} · Lobby öffnen`;
    }
    m.partySub.textContent = code ? `Party ${code}` : (rejoin ? `Zurück zu ${rejoin}` : 'mit Freunden');
    if (typeof daily === 'string') m.dailySub.textContent = cleanText(daily, 40);
    if (typeof ranked === 'string') m.rankedSub.textContent = cleanText(ranked, 40);
    m.bestTicker.textContent = best > 0 ? `Dein Rekord: ${fmtDist(best)} – schaffst du mehr?` : 'Noch kein Rekord – zeig, was du kannst';
  }

  /** Garage: Karten aller Autos (einmal gebaut, danach nur aktualisiert). */
  renderGarage({ cars = CARS, perks = PERKS, owned = [], selectedCar = null, previewCar = null, colors = {}, coins = 0, extraColors = [], tuning = [] } = {}) {
    const g = this.gg;
    const list = Array.isArray(cars) && cars.length ? cars : CARS;
    const key = list.map((c) => c.id).join('|');
    if (key !== g.key) {
      g.key = key;
      g.list.textContent = '';
      g.cards.clear();
      list.forEach((car, i) => {
        const card = this._createCarCard(car, i, perks || PERKS);
        g.cards.set(car.id, card);
        g.list.append(card.li);
      });
    }
    const tuningMap = new Map(Array.isArray(tuning) ? tuning : []);
    const ownedSet = new Set(Array.isArray(owned) ? owned : []);
    const activeCar = list.find((c) => c.id === selectedCar) || null;
    const coinCount = Math.floor(num(coins));
    let ownedCount = 0;
    for (const car of list) {
      const isOwned = ownedSet.has(car.id);
      if (isOwned) ownedCount += 1;
      this._updateCarCard(g.cards.get(car.id), {
        owned: isOwned,
        selected: car.id === selectedCar,
        preview: car.id === previewCar,
        color: (colors && colors[car.id]) || (car.colors && car.colors[0]),
        coins: coinCount,
        activeCar,
        extraColors: Array.isArray(extraColors) ? extraColors : [],
        tuning: tuningMap.get(car.id) || null,
      });
    }
    g.count.textContent = `${ownedCount}/${list.length}`;
    g.count.setAttribute('aria-label', `${ownedCount} von ${list.length} Autos in deiner Garage`);
    if (previewCar !== g.preview) {
      g.preview = previewCar;
      this._afterFrame(() => this._scrollToPreview(true));
    }
  }

  /** Rangliste mit Tabs, Lade-Skelett, Fehler- und Leerzustand. */
  renderLeaderboard({ kind = 'global', rows = [], meId = null, loading = false, error = null, partyCode = null } = {}) {
    const lb = this.lb;
    lb.friends.hidden = kind !== 'friends';
    lb.removable = kind === 'friends';
    lb.week.hidden = kind !== 'weekly';
    lb.ranked.hidden = kind !== 'ranked';
    if (kind !== 'weekly') this._stopWeekTimer();
    if (kind !== 'ranked') this._stopRankedTimer();
    const k = LB_TABS.some((t) => t.kind === kind) ? kind : 'global';
    for (const tab of lb.tabs) {
      const isParty = tab.kind === 'party';
      tab.btn.hidden = isParty && !partyCode;
      if (isParty && partyCode) tab.label.textContent = `Party ${cleanText(partyCode, 8)}`;
      const sel = tab.kind === k;
      tab.btn.setAttribute('aria-selected', sel ? 'true' : 'false');
      tab.btn.tabIndex = sel ? 0 : -1;
      if (sel) lb.panel.setAttribute('aria-labelledby', tab.btn.id);
    }
    lb.panel.setAttribute('aria-busy', loading ? 'true' : 'false');

    const data = Array.isArray(rows) ? rows : [];
    lb.state.textContent = '';
    lb.state.hidden = false;
    lb.list.hidden = true;
    if (loading) {
      lb.state.append(srOnly('Rangliste wird geladen …'), this._skeleton(8));
    } else if (error) {
      lb.state.append(h('div', { class: 'empty empty--error', role: 'alert' },
        icon('alert', 'empty__icon'),
        h('p', { class: 'empty__title' }, 'Rangliste nicht erreichbar'),
        h('p', { class: 'empty__text' }, cleanText(error)),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onLeaderboardTab', k) },
          icon('restart'), h('span', { class: 'btn__label' }, 'Nochmal versuchen'))));
    } else if (!data.length) {
      lb.state.append(h('div', { class: 'empty' },
        icon('flag', 'empty__icon'),
        h('p', { class: 'empty__title' }, 'Noch keine Einträge – fahr los!'),
        h('p', { class: 'empty__text' }, k === 'weekly' ? 'Die Wochenwertung startet jeden Mittwoch um 12:00 Uhr neu. Sie zählt deine besten Ranked-Fahrten.' : k === 'ranked' ? 'Auf dieser Karte ist noch niemand gefahren – sei der Erste!' : k === 'daily' ? 'Heute ist noch niemand das Tagesrennen gefahren – sei der Erste!' : 'Der erste Platz ist noch frei.')));
    } else {
      lb.state.hidden = true;
      lb.list.hidden = false;
      this._fillBoard(lb.list, data, meId, 100, lb.removable ? (id) => this._call('onFriendRemove', id) : null, { weekly: k === 'weekly' });
    }
  }

  /**
   * Wochenwertung: Restzeit (läuft im Sekundentakt weiter), eigener Platz und was er einbringt.
   * @param {{ endsAt: number, offset: number, rank: number, best: number, players: number, canShare: boolean }} info
   */
  renderWeek({ endsAt = 0, offset = 0, rank = 0, best = 0, players = 0, canShare = false } = {}) {
    const lb = this.lb;
    lb.weekEndsAt = num(endsAt);
    lb.weekOffset = num(offset);
    lb.weekShare.hidden = !canShare;
    const tick = () => {
      lb.weekCount.textContent = lb.weekEndsAt ? fmtCountdown(lb.weekEndsAt - (Date.now() + lb.weekOffset)) : '…';
    };
    tick();
    this._stopWeekTimer();
    this._weekTimer = setInterval(tick, 15000);
    if (rank > 0 && best > 0) {
      const coins = weeklyPrizeCoins(rank);
      const item = rank <= 3 ? Object.values(WEEKLY_ITEMS).find((i) => i.rank === rank) : null;
      lb.weekMe.textContent = `Du bist Platz ${rank} von ${players} (${fmtInt(best)} m) – wenn die Woche jetzt endet, bekommst du ${fmtInt(coins)} Münzen${item ? ` und ${item.name}` : ''}.`;
    } else {
      lb.weekMe.textContent = 'Fahr eine Ranked-Karte, um dich zu platzieren – ab dem ersten Punkt bekommst du zum Wochenende mindestens 25 Münzen.';
    }
  }

  /**
   * Ranked-Karte: Welt, Restzeit (läuft weiter) und eigener Platz.
   * @param {{ endsAt: number, offset: number, world: string, rank: number, best: number, players: number }} info
   */
  renderRanked({ endsAt = 0, offset = 0, world = '', rank = 0, best = 0, players = 0 } = {}) {
    const lb = this.lb;
    lb.rankedEndsAt = num(endsAt);
    lb.rankedOffset = num(offset);
    lb.rankedWorld.textContent = cleanText(world, 40);
    const tick = () => {
      lb.rankedCount.textContent = lb.rankedEndsAt ? fmtCountdown(lb.rankedEndsAt - (Date.now() + lb.rankedOffset)) : '…';
    };
    tick();
    this._stopRankedTimer();
    this._rankedTimer = setInterval(tick, 15000);
    lb.rankedMe.textContent = rank > 0 && best > 0
      ? `Du bist auf dieser Karte Platz ${rank} von ${players} (${fmtInt(best)} m). Dein bester Lauf pro Karte zählt für die Wochenwertung.`
      : 'Fahr diese Karte, um dich zu platzieren. Dein bester Lauf pro Karte zählt für die Wochenwertung.';
  }

  _stopRankedTimer() {
    clearInterval(this._rankedTimer);
    this._rankedTimer = 0;
  }

  _stopWeekTimer() {
    clearInterval(this._weekTimer);
    this._weekTimer = 0;
  }

  _buildWeekReward() {
    const w = {};
    w.list = h('div', { class: 'wr__list' });
    w.total = h('p', { class: 'wr__total' });
    w.ok = h('button', { type: 'button', class: 'btn btn--play', onClick: () => this._call('onWeekRewardClose') },
      icon('check', 'btn__icon'), h('span', { class: 'btn__label' }, 'Einsammeln'));
    w.el = h('div', { class: 'wr', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lr-wr-title' },
      h('div', { class: 'wr__backdrop', 'aria-hidden': 'true' }),
      h('div', { class: 'wr__card' },
        h('h2', { class: 'wr__title', id: 'lr-wr-title' }, 'Wochenwertung beendet!'),
        w.list, w.total, w.ok));
    this.root.append(w.el);
    this.wr = w;
  }

  /** Belohnungen einer abgeschlossenen Woche: [{ rank, score, coins, bonus, item, newCar }] */
  showWeekRewards(items = []) {
    const w = this.wr;
    const list = Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : [];
    if (!list.length) return;
    w.list.textContent = '';
    let total = 0;
    for (const r of list) {
      const item = WEEKLY_ITEMS[r.item] || null;
      total += num(r.coins) + num(r.bonus);
      w.list.append(h('div', { class: `wr__item${item ? ` wr__item--${r.item}` : ''}` },
        h('span', { class: 'wr__medal', 'aria-hidden': 'true' }, item ? item.medal : '🏁'),
        h('div', { class: 'wr__text' },
          h('strong', null, `Platz ${fmtInt(r.rank)}${num(r.score) ? ` mit ${fmtInt(r.score)} m` : ''}`),
          item ? h('span', { class: 'wr__prize' }, item.title + (r.newCar ? ` – neues Auto: ${item.name}!` : r.item === 'champion' ? ' – schon wieder!' : ` – Lack „${item.name}“ freigeschaltet`)) : null,
          num(r.bonus) > 0 ? h('span', null, `Auto schon vorhanden: +${fmtInt(r.bonus)} Extra-Münzen`) : null),
        h('span', { class: 'week__coins' }, coinIcon(), `+${fmtInt(num(r.coins) + num(r.bonus))}`)));
    }
    w.total.textContent = list.length > 1 ? `Zusammen ${fmtInt(total)} Münzen` : '';
    w.el.hidden = false;
    this.root.classList.add('is-modal');
    this._setInert(true);
    this._afterFrame(() => w.ok.focus({ preventScroll: true }));
  }

  hideWeekRewards() {
    const w = this.wr;
    if (w.el.hidden) return;
    w.el.hidden = true;
    this.root.classList.remove('is-modal');
    this._setInert(false);
  }

  /** Freunde-Bereich der Rangliste: eigener Code und Rückmeldung zum letzten Hinzufügen. */
  renderFriends({ code = '', canShare = false, message, error = false, busy = false, clearInput = false } = {}) {
    const lb = this.lb;
    lb.friendCode.textContent = /^[A-Z0-9]{6}$/.test(code) ? code : '——';
    lb.friendCopy.disabled = !code;
    lb.friendShare.disabled = !code;
    lb.friendShare.hidden = !(canShare || this.canShare);
    lb.friendAdd.disabled = Boolean(busy);
    if (message !== undefined) {
      lb.friendMsg.textContent = cleanText(message, 160);
      lb.friendMsg.classList.toggle('is-error', Boolean(error));
    }
    if (clearInput) lb.friendInput.value = '';
  }

  /** Party-Bildschirm: Erstellen/Beitreten, Lobby mit Mitgliedern, Rennen, Emotes, Party-Rangliste. */
  renderParty({ phase = 'none', code = null, shareUrl = null, members = [], isHost = false, board = [], race = null, error = null } = {}) {
    const p = this.pt;
    const ph = phase === 'joined' || phase === 'joining' ? phase : 'none';
    p.none.hidden = ph !== 'none';
    p.joining.hidden = ph !== 'joining';
    p.joined.hidden = ph !== 'joined';
    p.error.textContent = error ? cleanText(error) : '';
    p.error.hidden = !error;
    p.none.setAttribute('aria-busy', 'false');

    const safeCode = cleanText(code || '', 8).replace(/[^A-Z0-9]/gi, '');
    if (ph === 'joining') {
      p.joiningText.textContent = safeCode ? `Verbinde mit Party ${safeCode} …` : 'Verbinde mit der Party …';
      return;
    }
    if (ph !== 'joined') return;

    p.code.textContent = safeCode || '—';
    const url = typeof shareUrl === 'string' ? shareUrl : '';
    if (p.url.value !== url) p.url.value = url;
    p.share.hidden = !this.canShare;

    const list = Array.isArray(members) ? members.filter((m) => m && typeof m === 'object') : [];
    this._renderMembers(list);
    const host = list.find((m) => m.isHost);
    const meMember = list.find((m) => m.isMe);

    // Rennstatus
    const rp = race && race.phase;
    const racing = rp === 'countdown' || rp === 'running';
    p.raceBanner.hidden = !racing;
    p.raceBannerText.textContent = rp === 'countdown' ? 'Rennen startet – mach dich bereit!' : 'Rennen läuft …';
    p.results.hidden = rp !== 'results';
    if (rp === 'results') {
      const info = this._renderResults(p.resultsList, race.results);
      p.resultsSummary.textContent = info.myPlace ? `Du bist Platz ${info.myPlace} von ${info.count}.` : '';
    }

    // Host-Aktionen
    p.start.hidden = !isHost;
    p.start.disabled = racing;
    p.startLabel.textContent = racing ? 'Rennen läuft …' : rp === 'results' ? 'Revanche starten' : 'Rennen starten';
    p.wait.hidden = !!isHost;
    p.wait.textContent = host && !host.isMe
      ? `Warte, bis ${cleanName(host.name) || 'der Host'} das Rennen startet …`
      : 'Warte auf den Host …';
    p.solo.hidden = list.length > 1;

    // Party-Rangliste
    const rows = Array.isArray(board) ? board : board && Array.isArray(board.rows) ? board.rows : [];
    p.boardEmpty.hidden = rows.length > 0;
    p.board.hidden = rows.length === 0;
    if (rows.length) this._fillBoard(p.board, rows, meMember ? meMember.id : null, 20);
  }

  /** Missionen + Gesamtstatistik. */
  renderMissions({ missions = [], stats = {}, achievements = [], streak = null } = {}) {
    this._fillMissionList(this.ms.list, missions, false);
    this._fillAchievements(achievements);
    this._fillStreak(streak);
    const s = stats || {};
    const vals = {
      runs: fmtInt(s.runs),
      totalDistance: fmtLongDist(s.totalDistance),
      totalCoins: fmtInt(s.totalCoins),
      nearMisses: fmtInt(s.nearMisses),
      smashed: fmtInt(s.smashed),
      overtakes: fmtInt(s.overtakes),
      partyRaces: fmtInt(s.partyRaces),
    };
    for (const key of Object.keys(this.ms.stats)) this.ms.stats[key].textContent = vals[key];
  }

  /** Einstellungen setzen, ohne Change-Events auszulösen. */
  renderSettings(settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...this._settings, ...(settings || {}) };
    this._settings = s;
    const st = this.st;

    for (const key of Object.keys(st.rows)) {
      const r = st.rows[key];
      const { item } = r;
      const locked = Boolean(item.requires) && !s[item.requires]; // z. B. Musik-Regler bei ausgeschalteter Musik
      r.row.classList.toggle('is-disabled', locked);
      if (item.type === 'switch') {
        r.input.checked = !!s[key];
        r.input.disabled = locked;
      } else if (item.type === 'range') {
        const value = String(Math.round(clamp01(num(s[key])) * 100));
        if (r.input.value !== value) r.input.value = value;
        r.out.textContent = `${value} %`;
        r.input.style.setProperty('--p', `${value}%`);
        r.input.disabled = locked;
      } else {
        for (const b of r.buttons) b.btn.setAttribute('aria-pressed', b.value === s[key] ? 'true' : 'false');
      }
    }

    this.root.dataset.quality = s.quality || 'auto';
    this.root.classList.toggle('no-keyhints', s.keyHints === false); // Tastenhinweise ausblenden
    // Pause-Schalter spiegeln
    this.pz.music.checked = !!s.music;
    this.pz.sfx.checked = !!s.sfx;
  }

  /** Modaler Namensdialog. Absenden → callbacks.onSubmitName(name); main schließt mit closeName(). */
  /** Zeigt im Namensdialog, wer eingeladen hat (nach dem Laden nachgereicht). */
  setInviter(name) {
    const m = this.nm;
    m.inviter = cleanName(name) || '';
    if (m.mode === 'first' && !m.el.hidden) this._applyNameTexts();
  }

  _applyNameTexts() {
    const m = this.nm;
    if (m.mode === 'rename') {
      m.title.textContent = 'Name ändern';
      m.lead.textContent = 'So sehen dich die anderen in der Rangliste und in der Party.';
    } else if (m.invited) {
      m.title.textContent = 'Willkommen an Bord!';
      m.lead.textContent = m.inviter
        ? `${m.inviter} hat dich zur Wochen-Rangliste eingeladen. Such dir einen Namen aus – dann bist du sofort dabei und ihr seid Freunde.`
        : 'Du wurdest zur Wochen-Rangliste eingeladen. Such dir einen Namen aus – dann bist du sofort dabei.';
    } else {
      m.title.textContent = 'Wie heißt du, Fahrer?';
      m.lead.textContent = 'Dein Name erscheint in der Rangliste und bei deinen Freunden in der Party.';
    }
  }

  askName({ initial = '', error = null, mode = 'first', invited = false } = {}) {
    const m = this.nm;
    m.invited = Boolean(invited);
    const wasOpen = !m.el.hidden;
    m.mode = mode === 'rename' ? 'rename' : 'first';
    this._applyNameTexts();
    m.cancel.hidden = m.mode !== 'rename';
    m.submitLabel.textContent = m.mode === 'rename' ? 'Speichern' : 'Los geht’s';
    if (!wasOpen || !error) m.input.value = cleanName(typeof initial === 'string' ? initial : '', 16);
    this._updateNameCount();
    this._setNameError(error ? cleanText(error) : '');
    this._setNameBusy(false);
    if (!wasOpen) {
      m.prevFocus = document.activeElement;
      m.el.hidden = false;
      this.root.classList.add('is-modal');
      this._setInert(true);
    }
    this._afterFrame(() => {
      if (m.el.hidden) return;
      m.input.focus({ preventScroll: true });
      m.input.select();
    });
  }

  closeName() {
    const m = this.nm;
    this._setNameBusy(false);
    if (m.el.hidden) return;
    m.el.hidden = true;
    this.root.classList.remove('is-modal');
    this._setInert(false);
    const prev = m.prevFocus;
    m.prevFocus = null;
    if (prev && prev.isConnected && typeof prev.focus === 'function' && prev !== document.body && prev.getClientRects().length) {
      prev.focus({ preventScroll: true });
    } else if (document.activeElement && m.el.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  /**
   * HUD – wird in JEDEM Frame aufgerufen. Schreibt nur geänderte Werte ins DOM
   * und legt (außer bei der Live-Liste) keine Objekte an.
   */
  updateHud(s) {
    if (!s) return;
    const hd = this.hd;
    const L = this._hudLast;
    this._updateGoalHud(s.campaign);

    hd.dist.set(s.distance);

    const kmh = Math.round(num(s.kmh));
    if (kmh !== L.kmh) {
      L.kmh = kmh;
      hd.speed.set(Math.round(kmh * this._speedFactor));
      hd.speedFill.style.transform = `scaleX(${clamp01(kmh / HUD_SPEED_MAX).toFixed(3)})`;
    }

    const level = Math.max(1, num(s.level) | 0);
    if (level !== L.level) {
      const up = L.level > 0 && level > L.level;
      L.level = level;
      hd.levelNum.textContent = String(level);
      const inWorld = (level - 1) % LEVELS_PER_WORLD;
      for (let i = 0; i < hd.pips.length; i++) hd.pips[i].classList.toggle('is-on', i <= inWorld);
      if (up) this._bump(hd.levelBox);
    }
    const world = typeof s.worldName === 'string' ? s.worldName : '';
    if (world !== L.world) {
      L.world = world;
      hd.world.textContent = world;
    }

    const coins = Math.floor(num(s.coins));
    if (coins !== L.coins) {
      if (coins > L.coins) this._bump(hd.coinsBox);
      L.coins = coins;
      hd.coins.set(coins);
    }

    // Nitro
    const nitro = clamp01(num(s.nitro));
    if (changed(nitro, L.nitro, 0.002) || ((nitro === 0 || nitro === 1) && nitro !== L.nitro)) {
      L.nitro = nitro;
      hd.nitroFill.style.transform = `scaleX(${nitro.toFixed(3)})`;
      if (this._touchOn) this.tc.nitro.style.setProperty('--n', nitro.toFixed(3));
    }
    const ready = !!s.nitroReady;
    if (ready !== L.ready) {
      L.ready = ready;
      hd.nitro.classList.toggle('is-ready', ready);
      this.tc.nitro.classList.toggle('is-ready', ready);
    }
    const active = !!s.nitroActive;
    if (active !== L.active) {
      L.active = active;
      hd.nitro.classList.toggle('is-active', active);
      this.tc.nitro.classList.toggle('is-active', active);
      this.root.classList.toggle('is-nitro', active);
    }

    // Kombo
    const combo = Math.max(0, num(s.combo) | 0);
    const comboFrac = clamp01(num(s.comboFrac));
    const showCombo = combo >= 1 && comboFrac > 0;
    if (showCombo !== L.comboShow) {
      L.comboShow = showCombo;
      hd.combo.hidden = !showCombo;
    }
    if (combo !== L.combo) {
      const up = combo > L.combo && L.combo >= 0;
      L.combo = combo;
      hd.comboMult.textContent = `×${combo}`;
      hd.combo.dataset.level = String(Math.min(combo, 5));
      if (up && showCombo) this._bump(hd.combo);
    }
    if (showCombo && changed(comboFrac, L.comboFrac, 0.004)) {
      L.comboFrac = comboFrac;
      hd.comboFill.style.transform = `scaleX(${comboFrac.toFixed(3)})`;
    }

    // Power-ups
    this._updatePowerup(hd.pu.shield, s.shield ? 1 : 0);
    this._updatePowerup(hd.pu.magnet, s.magnet === Infinity ? Infinity : num(s.magnet));
    this._updatePowerup(hd.pu.double, s.double === Infinity ? Infinity : num(s.double));

    // Fähigkeit: lädt sich nach dem Einsatz wieder auf
    const ab = s.ability && typeof s.ability === 'object' ? s.ability : null;
    if (!!ab !== L.abilityOn) {
      L.abilityOn = !!ab;
      hd.ability.hidden = !ab;
      this.tc.ability.hidden = !ab;
    }
    if (ab) {
      if (ab.name !== L.abilityName) {
        L.abilityName = ab.name;
        const label = cleanText(ab.name, 24);
        hd.abilityName.textContent = label;
        this.tc.abilityText.textContent = label;
        this.tc.ability.setAttribute('aria-label', `Fähigkeit ${label} einsetzen`);
      }
      const frac = ab.active || ab.ready ? 1 : 1 - clamp01(num(ab.cooldownFrac));
      if (changed(frac, L.abilityFrac, 0.004)) {
        L.abilityFrac = frac;
        hd.abilityFill.style.transform = `scaleX(${frac.toFixed(3)})`;
        this.tc.ability.style.setProperty('--n', frac.toFixed(3));
      }
      const state = ab.active ? 'active' : ab.ready ? 'ready' : 'charging';
      if (state !== L.abilityState) {
        L.abilityState = state;
        hd.ability.dataset.state = state;
        this.tc.ability.dataset.state = state;
      }
    }

    this._updateLive(s.live);

    const race = !!s.race;
    if (race !== L.race) {
      L.race = race;
      hd.race.hidden = !race;
    }
  }

  /** Tempo-Anzeige in km/h oder mph. */
  setSpeedUnit(unit) {
    const mph = unit === 'mph';
    this._speedFactor = mph ? 0.621371 : 1;
    const label = this.root.querySelector('.hud-speed__unit');
    if (label) label.textContent = mph ? 'mph' : 'km/h';
    this._hudLast.kmh = NaN; // beim nächsten Frame neu schreiben
  }

  /** Sicherungscode-Bereich in den Einstellungen füllen. */
  setRecoveryCode({ code = null, hasProgress = false, status = '' } = {}) {
    const st = this.st;
    this._recoveryCode = typeof code === 'string' ? code : '';
    this._restoreNeedsConfirm = !!hasProgress;
    st.cloudStatus.textContent = cleanText(status, 120);
    st.codeShow.disabled = !this._recoveryCode;
    st.codeCopy.disabled = !this._recoveryCode;
    this._refreshRecoveryField();
  }

  _toggleRecoveryShown() {
    this._recoveryShown = !this._recoveryShown;
    this._refreshRecoveryField();
  }

  _refreshRecoveryField() {
    const st = this.st;
    const code = this._recoveryCode || '';
    const shown = !!this._recoveryShown && !!code;
    st.code.value = code ? (shown ? code : 'LR1-••••• ••••• ••••• •••••') : '';
    st.codeShow.querySelector('.btn__label').textContent = shown ? 'Verbergen' : 'Anzeigen';
  }

  _onRestoreClick() {
    const st = this.st;
    const value = st.restoreInput.value.trim();
    st.restoreMsg.dataset.state = '';
    if (!value) {
      st.restoreMsg.textContent = 'Füge zuerst den Sicherungscode ein.';
      st.restoreInput.focus();
      return;
    }
    // Wer schon Fortschritt hat, muss das Ersetzen bestätigen (zweiter Klick innerhalb von 6 s)
    if (this._restoreNeedsConfirm && !this._restoreConfirm) {
      this._restoreConfirm = true;
      st.restoreLabel.textContent = 'Wirklich ersetzen?';
      st.restoreMsg.textContent = 'Dein jetziger Spielstand auf diesem Gerät wird durch den gesicherten ersetzt.';
      clearTimeout(this._restoreTimer);
      this._restoreTimer = setTimeout(() => this._resetRestoreConfirm(), 6000);
      return;
    }
    this._resetRestoreConfirm();
    st.restoreBtn.disabled = true;
    st.restoreMsg.textContent = 'Wird wiederhergestellt …';
    this._call('onRestoreCode', value);
  }

  _resetRestoreConfirm() {
    clearTimeout(this._restoreTimer);
    this._restoreConfirm = false;
    if (this.st) this.st.restoreLabel.textContent = 'Wiederherstellen';
  }

  /** Antwort auf onRestoreCode. */
  setRestoreResult({ ok = false, message = '' } = {}) {
    const st = this.st;
    this._resetRestoreConfirm();
    st.restoreBtn.disabled = false;
    st.restoreMsg.textContent = cleanText(message, 200);
    st.restoreMsg.dataset.state = ok ? 'ok' : 'error';
    if (ok) st.restoreInput.value = '';
  }

  /** 3 | 2 | 1 | 'LOS!' | null */
  showCountdown(value) {
    const cd = this.cd;
    if (value == null || value === false || value === '') {
      if (cd.el.hidden) return;
      const token = ++cd.token;
      const done = () => { if (token === cd.token) cd.el.hidden = true; };
      const anim = this.reducedMotion ? null : animate(cd.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in' });
      if (anim) anim.onfinish = done;
      else done();
      return;
    }
    cd.token += 1;
    const go = typeof value !== 'number';
    cd.num.textContent = cleanText(value, 12);
    cd.el.classList.toggle('is-go', go);
    cd.el.hidden = false;
    if (cd.numAnim) cd.numAnim.cancel();
    if (cd.ringAnim) cd.ringAnim.cancel();
    if (this.reducedMotion) {
      cd.numAnim = animate(cd.num, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'forwards' });
      return;
    }
    cd.numAnim = animate(cd.num, go ? FRAMES.countGo : FRAMES.countNum, { duration: go ? 620 : 960, fill: 'forwards' });
    cd.ringAnim = animate(cd.ring, FRAMES.ring, { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  /** Kurzer Aufpopper in der Bildmitte ("KNAPP!", "BOOM +10"). */
  popup(text, kind = 'near') {
    const p = this.pp;
    const k = POPUP_KINDS.has(kind) ? kind : 'near';
    if (!this._hintAllowed('popup', k)) return;
    const now = performance.now();
    // Kommen mehrere kurz hintereinander, stapeln sie sich nach oben
    p.stack = now - p.lastAt < 420 ? Math.min(p.stack + 1, 3) : 0;
    p.lastAt = now;
    const slot = p.pool[p.next];
    p.next = (p.next + 1) % p.pool.length;
    if (slot.anim) slot.anim.cancel();
    slot.pop.textContent = cleanText(text, 40);
    slot.pop.className = `pop pop--${k}`;
    slot.wrap.style.transform = `translateY(${-p.stack * 1.15}em)`;
    slot.wrap.hidden = false;
    const anim = animate(slot.pop, this.reducedMotion ? FRAMES.popupCalm : FRAMES.popup, {
      duration: this.reducedMotion ? 900 : 1100,
      easing: 'cubic-bezier(.2,.8,.3,1)',
    });
    slot.anim = anim;
    if (anim) {
      anim.onfinish = () => { if (slot.anim === anim) slot.wrap.hidden = true; };
    } else {
      clearTimeout(slot.timer);
      slot.timer = setTimeout(() => { slot.wrap.hidden = true; }, 1000);
    }
  }

  /** Gestapelte Einblendung oben, verschwindet von allein. */
  /**
   * Was darf während der Fahrt eingeblendet werden? (Einstellung "Hinweise im Spiel")
   *   Keine  = nichts, Wenige = nur Warnungen und Weltwechsel, Alle = wie früher.
   * Außerhalb der Fahrt (Menüs, Rundenende) wird nie gefiltert.
   */
  _hintAllowed(type, kind) {
    if (this.screen !== 'hud') return true;
    const mode = this._settings.hints || 'few';
    if (mode === 'all') return true;
    if (mode === 'off') return false;
    if (type === 'toast') return kind === 'error' || kind === 'world';
    if (type === 'popup') return kind === 'combo';
    return false;
  }

  toast(title, subtitle = '', kind = 'info') {
    const k = TOAST_KINDS.has(kind) ? kind : 'info';
    if (!this._hintAllowed('toast', k)) return;
    const titleText = cleanText(title, 80);
    const subText = cleanText(subtitle, 160);
    const el = h('div', { class: `toast toast--${k}` },
      k === 'world' ? checker('toast__checker') : h('span', { class: 'toast__stripe', 'aria-hidden': 'true' }),
      h('span', { class: 'toast__icon', 'aria-hidden': 'true' }, icon(TOAST_ICON[k])),
      h('span', { class: 'toast__body' },
        k === 'world' ? h('span', { class: 'toast__kicker' }, 'Neue Welt') : null,
        h('strong', { class: 'toast__title' }, titleText),
        subText ? h('span', { class: 'toast__sub' }, subText) : null));
    const box = this.toastBox;
    box.prepend(el);
    // Höchstens 3 gleichzeitig – die ältesten fliegen raus
    while (box.children.length > 3) box.lastElementChild.remove();
    const ttl = k === 'error' ? 5200 : k === 'world' ? 4200 : 3200;
    setTimeout(() => this._dismissToast(el), ttl);
  }

  /** Vollbild-Blitz (Crash rot, Schild grün, Nitro cyan …). */
  flash(color = 'red') {
    // Bunte Bildschirmblitze nur bei "Alle"; der rote Crash-Blitz bleibt immer
    const isCrash = String(color).toLowerCase() === '#ff3b4e' || String(color).toLowerCase() === 'red' || String(color).toLowerCase() === 'crash';
    if (!isCrash && !this._hintAllowed('flash', 'flash')) return;
    let c = FLASH_COLORS[String(color).toLowerCase()];
    if (!c) c = typeof color === 'string' && (COLOR_RE.test(color) || /^#[0-9a-f]{3}$/i.test(color)) ? color : FLASH_COLORS.red;
    const f = this.fl;
    f.style.setProperty('--flash', c);
    if (this._flashAnim) this._flashAnim.cancel();
    this._flashAnim = animate(f, [{ opacity: this.reducedMotion ? 0.28 : 0.62 }, { opacity: 0 }], {
      duration: this.reducedMotion ? 260 : 520,
      easing: 'cubic-bezier(.2,.7,.3,1)',
    });
  }

  showPause(visible) {
    const pz = this.pz;
    const v = !!visible;
    if (v === !pz.el.hidden) return;
    if (v) {
      pz.music.checked = !!this._settings.music;
      pz.sfx.checked = !!this._settings.sfx;
      pz.el.hidden = false;
      this.root.classList.add('is-paused');
      this._afterFrame(() => { if (!pz.el.hidden) pz.resume.focus({ preventScroll: true }); });
    } else {
      const active = document.activeElement;
      pz.el.hidden = true;
      this.root.classList.remove('is-paused');
      if (active && pz.el.contains(active)) active.blur();
    }
  }

  /** Rundenende mit Count-up der Münzen. Wechselt selbst auf den Bildschirm 'gameover'. */
  showGameOver(data = {}) {
    this._finishGameOverAnim();
    this.goData = { ...(data || {}) };
    const g = this.go;
    const d = this.goData;

    const camp = d.campaign && typeof d.campaign === 'object' ? d.campaign : null;
    const finished = Boolean(camp && camp.evaluation && camp.evaluation.finished);
    g.tag.textContent = camp ? (finished ? 'Ziel' : 'Crash') : d.race ? 'Ziel' : 'Crash';
    g.tag.classList.toggle('tag--teal', !!d.race || finished);
    g.tag.classList.toggle('tag--danger', !d.race && !finished);
    g.title.textContent = camp ? (finished ? `${cleanText(camp.map.name, 30)} geschafft` : `${cleanText(camp.map.name, 30)} – knapp daneben`) : d.race ? 'Rennen vorbei' : 'Runde vorbei';
    g.challenge.hidden = Boolean(camp);
    this._renderGoCampaign(camp);

    const bd = (d.coins && d.coins.breakdown) || {};
    for (const row of g.rows) row.el.hidden = !(row.always || num(bd[row.key]) > 0);

    this._renderGoMeta();
    this._renderGoMissions();
    this._renderGoStats();
    this._renderGoRace();

    if (this.screen !== 'gameover') this.showScreen('gameover');
    if (g.scroll.scrollTo) g.scroll.scrollTo(0, 0);

    // Kurze Sperre gegen versehentliche Taps direkt nach dem Crash
    g.actions.classList.add('is-guarded');
    clearTimeout(g.guardTimer);
    g.guardTimer = setTimeout(() => g.actions.classList.remove('is-guarded'), GAMEOVER_GUARD);

    this._startGameOverAnim();
  }

  /** Spätere Ergänzungen (Rang vom Server, Rennergebnisse …). */
  updateGameOver(partial = {}) {
    if (!partial || typeof partial !== 'object') return;
    if (!this.goData) this.goData = {};
    Object.assign(this.goData, partial);
    if ('rank' in partial || 'online' in partial || 'isRecord' in partial || 'best' in partial) this._renderGoMeta();
    if ('race' in partial) this._renderGoRace();
    if ('completed' in partial) this._renderGoMissions();
    if ('stats' in partial) this._renderGoStats();
    if ('coins' in partial && !this._goRaf) this._applyGameOverFinal();
  }

  /** Emote eines Mitspielers (oder das eigene) als aufsteigende Sprechblase. */
  showEmote({ name = '', color = TEAL, emoji = '' } = {}) {
    const e = typeof emoji === 'string' ? emoji : '';
    if (!e || e.length > 12) return;
    const bubble = h('div', { class: 'emote-pop', style: { '--c': safeColor(color, TEAL), '--x': `${Math.round(Math.random() * 40 - 20)}px` } },
      h('span', { class: 'emote-pop__emoji' }, e),
      h('span', { class: 'emote-pop__name' }, cleanName(name) || 'Jemand'));
    this.emoteBox.append(bubble);
    while (this.emoteBox.children.length > 6) this.emoteBox.firstElementChild.remove();
    setTimeout(() => bubble.remove(), this.reducedMotion ? 2200 : 2800);
  }

  /** Schnellnachricht eines Mitspielers als Sprechblase (Text kommt aus QUICK_CHAT, nicht aus dem Netz). */
  showChat({ name = '', color = TEAL, text = '' } = {}) {
    const t = typeof text === 'string' ? text : '';
    if (!t || t.length > 40) return;
    const bubble = h('div', { class: 'emote-pop emote-pop--text', style: { '--c': safeColor(color, TEAL), '--x': `${Math.round(Math.random() * 24 - 12)}px` } },
      h('span', { class: 'emote-pop__emoji' }, t),
      h('span', { class: 'emote-pop__name' }, cleanName(name) || 'Jemand'));
    this.emoteBox.append(bubble);
    while (this.emoteBox.children.length > 6) this.emoteBox.firstElementChild.remove();
    setTimeout(() => bubble.remove(), this.reducedMotion ? 3200 : 3800);
  }

  /** Touch-Steuerung während der Fahrt ein-/ausblenden. */
  setTouchControls(visible) {
    const v = !!visible;
    if (v === this._touchOn) return;
    this._touchOn = v;
    this.tc.el.hidden = !v;
    this.root.classList.toggle('is-touch', v);
    if (v) {
      const n = Number.isFinite(this._hudLast.nitro) ? this._hudLast.nitro : 0;
      this.tc.nitro.style.setProperty('--n', n.toFixed(3));
    } else {
      // Gedrückt gehaltene Knöpfe loslassen, damit nichts „klemmt“
      for (const hold of this._holds) hold.release();
    }
  }

  /** Blockierende Fehlermeldung (z. B. kein WebGL). */
  showFatal(title, text) {
    const f = this.ft;
    f.title.textContent = cleanText(title, 80) || 'Hoppla';
    f.text.textContent = cleanText(text, 400);
    f.el.hidden = false;
    this.root.classList.add('is-fatal');
    this.setTouchControls(false);
    this._afterFrame(() => f.reload.focus({ preventScroll: true }));
  }

  // =========================================================================
  // Interne Helfer
  // =========================================================================

  _call(name, ...args) {
    const fn = this.cb[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn(...args);
    } catch (err) {
      console.error(`[UI] Callback ${name} ist fehlgeschlagen:`, err);
      return undefined;
    }
  }

  _onRootClick(e) {
    const target = e.target;
    const btn = target && target.closest ? target.closest('button') : null;
    if (!btn || !this.root.contains(btn) || btn.disabled) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    const sfx = btn.dataset.sfx;
    if (sfx === 'none') return;
    this._call('onUiSound', sfx || 'click');
  }

  _afterFrame(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 16);
  }

  _inOverlay(el) {
    return (this.nm && this.nm.el.contains(el)) || (this.pz && this.pz.el.contains(el)) || (this.ft && this.ft.el.contains(el));
  }

  _bump(el) {
    if (this.reducedMotion) return;
    animate(el, FRAMES.bump, { duration: 280, easing: 'ease-out' });
  }

  /** Legt einen Bildschirm (section) an und registriert ihn. */
  _screen(name, ...children) {
    const sec = h('section', { class: `screen screen--${name}`, hidden: true }, ...children);
    this.screens[name] = sec;
    this.root.append(sec);
    return sec;
  }

  /** Standard-Panel links (Handy: unten) mit Zurück-Button und Titelzeile. */
  _sheet(name, { kicker, title, extra = null, cls = '' }, ...body) {
    const titleEl = h('h2', { class: 'sheet__title', id: `lr-${name}-title`, tabindex: '-1' }, title);
    const back = h('button', { type: 'button', class: 'back', 'aria-label': 'Zurück zum Menü', onClick: () => this._call('onBack') },
      icon('back'), h('span', { class: 'back__label' }, 'Zurück'));
    const head = h('header', { class: 'sheet__head' },
      back,
      h('div', { class: 'sheet__titles' }, h('span', { class: 'sheet__kicker' }, kicker), titleEl),
      extra);
    const sheet = h('div', { class: `sheet ${cls}`.trim() }, checker('sheet__checker'), head, ...body);
    const sec = this._screen(name, sheet);
    sec.setAttribute('aria-labelledby', titleEl.id);
    this.focusTargets[name] = titleEl;
    return { sec, sheet, titleEl };
  }

  _setInert(on) {
    const targets = [this.topbar, this.tc.el, this.pz.el, ...Object.values(this.screens)];
    for (const el of targets) el.inert = on;
  }

  /** Hält den Tab-Fokus innerhalb eines Dialogs. */
  _trapFocus(container, e) {
    const focusables = Array.from(container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && !el.hidden && el.getClientRects().length);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  _setCoins(value) {
    const target = Math.max(0, Math.floor(value));
    const tb = this.tb;
    if (this._coinsTarget === null) {
      this._coinsTarget = target;
      this._coinsShown = target;
      tb.coins.set(target);
      tb.coinsWrap.setAttribute('aria-label', `${fmtInt(target)} Münzen`);
      return;
    }
    if (target === this._coinsTarget) return;
    const diff = target - this._coinsTarget;
    this._coinsTarget = target;
    tb.coinsWrap.setAttribute('aria-label', `${fmtInt(target)} Münzen`);
    tb.coinsDelta.textContent = diff > 0 ? `+${fmtInt(diff)}` : `−${fmtInt(-diff)}`;
    tb.coinsDelta.classList.toggle('is-neg', diff < 0);
    tb.coinsWrap.classList.toggle('is-gain', diff > 0);
    tb.coinsWrap.classList.toggle('is-loss', diff < 0);
    animate(tb.coinsDelta, FRAMES.coinDelta, { duration: 1500, easing: 'ease-out' });

    if (this._coinsTween) cancelAnimationFrame(this._coinsTween);
    this._coinsTween = 0;
    if (this.reducedMotion || typeof requestAnimationFrame !== 'function') {
      this._coinsShown = target;
      tb.coins.set(target);
      return;
    }
    // Hochzählen (bzw. runter beim Kauf) – Dauer wächst mit der Differenz
    const from = this._coinsShown;
    const duration = Math.min(1600, 450 + Math.abs(target - from) * 1.5);
    const t0 = performance.now();
    const step = (now) => {
      const t = clamp01((now - t0) / duration);
      this._coinsShown = Math.round(from + (target - from) * easeOut(t));
      tb.coins.set(this._coinsShown);
      if (t < 1) this._coinsTween = requestAnimationFrame(step);
      else {
        this._coinsTween = 0;
        tb.coinsWrap.classList.remove('is-gain', 'is-loss');
      }
    };
    this._coinsTween = requestAnimationFrame(step);
  }

  // =========================================================================
  // Aufbau: Touch-Steuerung
  // =========================================================================
  _buildTouch() {
    const fire = (action) => this._call('onTouch', action);
    const flashPress = (el) => {
      el.classList.add('is-down');
      clearTimeout(el._pressTimer);
      el._pressTimer = setTimeout(() => el.classList.remove('is-down'), 150);
    };
    // Tipp-Aktion (Spurwechsel, Nitro): feuert sofort beim Aufsetzen des Fingers
    const tap = (el, action) => {
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        e.preventDefault();
        fire(action);
        flashPress(el);
      });
    };
    // Halte-Aktion (Gas, Bremse): down beim Aufsetzen, up beim Loslassen – mehrere Finger zählen mit
    const hold = (el, name) => {
      const pointers = new Set();
      const up = (e) => {
        if (!pointers.delete(e.pointerId)) return;
        if (pointers.size === 0) {
          el.classList.remove('is-down');
          fire(`${name}:up`);
        }
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
        if (pointers.size === 0) {
          el.classList.add('is-down');
          fire(`${name}:down`);
        }
        pointers.add(e.pointerId);
      });
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      this._holds.push({
        release: () => {
          if (!pointers.size) return;
          pointers.clear();
          el.classList.remove('is-down');
          fire(`${name}:up`);
        },
      });
    };
    const tbtn = (cls, label, ...content) => h('button', {
      type: 'button', class: `tbtn ${cls}`, tabindex: '-1', 'data-sfx': 'none', 'aria-label': label,
    }, ...content);

    const zoneLeft = h('div', { class: 'tzone tzone--left', 'aria-hidden': 'true' });
    const zoneRight = h('div', { class: 'tzone tzone--right', 'aria-hidden': 'true' });
    const left = tbtn('tbtn--steer', 'Spur nach links', icon('arrowLeft'));
    const right = tbtn('tbtn--steer', 'Spur nach rechts', icon('arrowRight'));
    const nitro = tbtn('tbtn--nitro', 'Nitro zünden', h('span', { class: 'tbtn__ring', 'aria-hidden': 'true' }), icon('bolt'), h('span', { class: 'tbtn__text' }, 'Nitro'));
    const abilityText = h('span', { class: 'tbtn__text' }, 'Fähigkeit');
    const ability = tbtn('tbtn--ability', 'Fähigkeit einsetzen', h('span', { class: 'tbtn__ring', 'aria-hidden': 'true' }), icon('target'), abilityText);
    ability.hidden = true;
    tap(ability, 'ability');
    const brake = tbtn('tbtn--brake', 'Bremse (halten)', h('span', { class: 'tbtn__text' }, 'Bremse'));
    const gas = tbtn('tbtn--gas', 'Gas (halten)', chevrons(), h('span', { class: 'tbtn__text' }, 'Gas'));
    tap(zoneLeft, 'left');
    tap(zoneRight, 'right');
    tap(left, 'left');
    tap(right, 'right');
    tap(nitro, 'nitro');
    hold(gas, 'gas');
    hold(brake, 'brake');

    const el = h('div', { class: 'touch', hidden: true },
      zoneLeft, zoneRight,
      h('div', { class: 'tpad tpad--steer' }, left, right),
      h('div', { class: 'tpad tpad--drive' }, h('div', { class: 'tpad__row' }, ability, nitro), h('div', { class: 'tpad__row' }, brake, gas)));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.append(el);
    this.tc = { el, nitro, gas, brake, ability, abilityText };
  }

  // =========================================================================
  // Aufbau: HUD
  // =========================================================================
  _buildHud() {
    const hd = {};
    hd.dist = new Digits('hud-dist__num');
    hd.levelNum = h('span', { class: 'hud-level__num' }, '1');
    hd.pips = Array.from({ length: LEVELS_PER_WORLD }, () => h('i', { class: 'pip' }));
    hd.world = h('span', { class: 'hud-level__world' }, WORLDS[0].name);
    hd.levelBox = h('div', { class: 'hud-level' },
      h('span', { class: 'hud-level__tag' }, 'Lvl'), hd.levelNum,
      h('span', { class: 'pips', 'aria-hidden': 'true' }, hd.pips), hd.world);
    hd.race = h('span', { class: 'hud-race', hidden: true }, icon('flag'), 'Party-Rennen');
    // Kampagne: Fortschritt zum Ziel und die beiden Zusatzaufgaben
    hd.goalName = h('span', { class: 'hud-goal__name' });
    hd.goalFill = h('i', { class: 'hud-goal__fill' });
    hd.goalList = h('ul', { class: 'hud-goal__list' });
    hd.goalBox = h('div', { class: 'hud-goal', hidden: true, 'aria-hidden': 'true' },
      h('div', { class: 'hud-goal__head' }, icon('flag'), hd.goalName),
      h('div', { class: 'hud-goal__bar' }, hd.goalFill), hd.goalList);
    hd.goalSig = '';
    const topLeft = h('div', { class: 'hud-tl' },
      h('div', { class: 'hud-dist' }, hd.dist.el, h('span', { class: 'hud-dist__unit' }, 'm')),
      hd.levelBox,
      hd.race,
      hd.goalBox);

    hd.speed = new Digits('hud-speed__num');
    hd.speedFill = h('i', { class: 'hud-speed__fill' });
    const speedBox = h('div', { class: 'hud-speed' },
      h('div', { class: 'hud-speed__row' }, hd.speed.el, h('span', { class: 'hud-speed__unit' }, 'km/h')),
      h('div', { class: 'hud-speed__bar' }, hd.speedFill));

    hd.coins = new Digits('hud-coins__num');
    hd.coinsBox = h('div', { class: 'hud-coins' }, coinIcon(), hd.coins.el);
    const pause = h('button', {
      type: 'button', class: 'hud-pause', 'aria-label': 'Pause', title: 'Pause (P)',
      onClick: () => { pause.blur(); this._call('onPause'); },
    }, icon('pause'));
    const topRight = h('div', { class: 'hud-tr' }, hd.coinsBox, pause);

    // Live-Liste der Party
    hd.liveList = h('ol', { class: 'live__list' });
    hd.live = h('div', { class: 'live', hidden: true },
      h('div', { class: 'live__head' }, h('i', { class: 'live__rec', 'aria-hidden': 'true' }), 'Live'),
      hd.liveList,
      h('div', { class: 'live__emotes' }, EMOTES.map((e) => this._emoteButton(e, true))));

    // Power-ups, Kombo, Nitro
    const chip = (key, iconName, label, max) => {
      const time = h('span', { class: 'pu__time' });
      const fill = h('i', { class: 'pu__fill' });
      const el = h('div', { class: `pu pu--${key}`, hidden: true },
        icon(iconName), h('span', { class: 'pu__label' }, label), max ? time : null,
        max ? h('span', { class: 'pu__bar' }, fill) : null);
      return { el, time, fill, max, on: false, sec: NaN, frac: NaN };
    };
    hd.pu = {
      shield: chip('shield', 'shield', 'Schild', 0),
      magnet: chip('magnet', 'magnet', 'Magnet', CONFIG.magnetTime),
      double: chip('double', 'coins', '2× Münzen', CONFIG.doubleCoinsTime),
    };
    hd.comboMult = h('span', { class: 'combo__mult' }, '×1');
    hd.comboFill = h('i', { class: 'combo__fill' });
    hd.combo = h('div', { class: 'combo', hidden: true },
      h('span', { class: 'combo__label' }, 'Kombo'), hd.comboMult, h('span', { class: 'combo__bar' }, hd.comboFill));
    // Aktive Fähigkeit des Autos (Taste F oder E)
    hd.abilityName = h('span', { class: 'ability__name' }, 'Fähigkeit');
    hd.abilityFill = h('i', { class: 'ability__fill' });
    hd.ability = h('div', { class: 'ability', hidden: true },
      icon('target'), hd.abilityName,
      h('kbd', { class: 'ability__key' }, 'F'),
      h('span', { class: 'ability__bar', 'aria-hidden': 'true' }, hd.abilityFill));
    hd.nitroFill = h('i', { class: 'nitro__fill' });
    hd.nitro = h('div', { class: 'nitro' },
      h('div', { class: 'nitro__head' },
        icon('bolt', 'nitro__icon'),
        h('span', { class: 'nitro__label' }, 'Nitro'),
        h('kbd', { class: 'nitro__key' }, 'Leertaste')),
      h('div', { class: 'nitro__bar' }, hd.nitroFill, h('span', { class: 'nitro__ticks', 'aria-hidden': 'true' })));
    const bottom = h('div', { class: 'hud-bottom' },
      h('div', { class: 'hud-pus' }, hd.pu.shield.el, hd.pu.magnet.el, hd.pu.double.el),
      hd.combo,
      hd.ability,
      hd.nitro);

    // Tipp der ersten Runde (siehe tutorial.js)
    hd.tipText = h('span', { class: 'tip__text' });
    hd.tipStep = h('span', { class: 'tip__step' });
    hd.tip = h('div', { class: 'tip', role: 'status', hidden: true },
      h('span', { class: 'tip__tag' }, 'Tipp'), hd.tipText, hd.tipStep);
    hd.tipId = '';

    const keys = h('p', { class: 'hud-keys', 'aria-hidden': 'true' },
      h('kbd', null, '←'), h('kbd', null, '→'), ' Spur ',
      h('kbd', null, '↑'), ' Gas ',
      h('kbd', null, '↓'), ' Bremse ',
      h('kbd', null, 'P'), ' Pause');

    const stats = h('div', { class: 'hud-stats', 'aria-hidden': 'true' }, topLeft, speedBox, bottom, keys);
    const sec = this._screen('hud', h('div', { class: 'hud-vignette', 'aria-hidden': 'true' }), stats, topRight, hd.live, hd.tip);
    sec.setAttribute('aria-label', 'Fahranzeige');
    this.hd = hd;
  }

  /** Kampagnen-Ziel im HUD: { name, frac, goalText, objectives: [{ label, value, target, done }] } oder null. */
  _updateGoalHud(c) {
    const hd = this.hd;
    if (!c) {
      if (!hd.goalBox.hidden) hd.goalBox.hidden = true;
      hd.goalSig = '';
      return;
    }
    hd.goalBox.hidden = false;
    const pct = Math.round(clamp01(num(c.frac)) * 100);
    const sig = `${c.name}|${pct}|${(c.objectives || []).map((o) => `${o.value}/${o.target}`).join(',')}`;
    if (sig === hd.goalSig) return;
    hd.goalSig = sig;
    hd.goalName.textContent = `${cleanText(c.name, 30)} · ${pct} %`;
    hd.goalFill.style.transform = `scaleX(${clamp01(num(c.frac)).toFixed(3)})`;
    hd.goalList.textContent = '';
    for (const o of c.objectives || []) {
      hd.goalList.append(h('li', { class: o.done ? 'is-done' : '' },
        h('span', null, o.done ? '✓' : '○'), h('span', null, cleanText(o.label, 40)),
        h('b', null, `${fmtInt(o.value)}/${fmtInt(o.target)}`)));
    }
  }

  /** Zeigt einen Tipp der ersten Runde ({ id, text, step, steps }) oder blendet ihn aus (null). */
  setTip(tip) {
    const hd = this.hd;
    const id = tip ? tip.id : '';
    if (id === hd.tipId) return;
    hd.tipId = id;
    hd.tip.hidden = !tip;
    if (!tip) return;
    hd.tipText.textContent = tip.text;
    hd.tipStep.textContent = `${tip.step}/${tip.steps}`;
    if (!this.reducedMotion) animate(hd.tip, FRAMES.popIn, { duration: 320, easing: 'ease-out' });
  }

  _updatePowerup(pu, left) {
    const on = left > 0;
    if (on !== pu.on) {
      pu.on = on;
      pu.el.hidden = !on;
      pu.sec = NaN;
      pu.frac = NaN;
      if (on && !this.reducedMotion) animate(pu.el, FRAMES.popIn, { duration: 320, easing: 'ease-out' });
    }
    if (!on || !pu.max) return;
    const finite = Number.isFinite(left);
    const sec = finite ? Math.ceil(left) : -1;
    if (sec !== pu.sec) {
      pu.sec = sec;
      pu.time.textContent = finite ? `${sec}s` : '∞';
      pu.el.classList.toggle('is-ending', finite && sec <= 2);
    }
    const frac = finite ? clamp01(left / pu.max) : 1;
    if (changed(frac, pu.frac, 0.004)) {
      pu.frac = frac;
      pu.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
    }
  }

  _createLiveRow(index) {
    const name = h('span', { class: 'live-row__name' });
    const dist = h('span', { class: 'live-row__dist' });
    const li = h('li', { class: 'live-row', hidden: true },
      h('span', { class: 'live-row__pos' }, String(index + 1)),
      h('i', { class: 'live-row__dot' }),
      name, dist, h('span', { class: 'live-row__unit' }, 'm'));
    this.hd.liveList.append(li);
    return { li, name, dist, rawName: null, d: NaN, color: null, alive: null, me: null };
  }

  _updateLive(live) {
    const hd = this.hd;
    const on = Array.isArray(live) && live.length > 0;
    if (on !== this._hudLast.live) {
      this._hudLast.live = on;
      hd.live.hidden = !on;
    }
    if (!on) return;
    const order = this._liveOrder;
    order.length = 0;
    const n = Math.min(live.length, 8);
    for (let i = 0; i < n; i++) if (live[i]) order.push(live[i]);
    order.sort(byDistanceDesc);
    while (this._liveRows.length < order.length) this._liveRows.push(this._createLiveRow(this._liveRows.length));
    for (let i = 0; i < this._liveRows.length; i++) {
      const row = this._liveRows[i];
      const e = i < order.length ? order[i] : null;
      if (!e) {
        if (!row.li.hidden) row.li.hidden = true;
        continue;
      }
      if (row.li.hidden) row.li.hidden = false;
      if (e.name !== row.rawName) {
        row.rawName = e.name;
        row.name.textContent = cleanName(e.name) || 'Fahrer';
      }
      const d = Math.floor(num(e.distance));
      if (d !== row.d) {
        row.d = d;
        row.dist.textContent = NF.format(d);
      }
      if (e.color !== row.color) {
        row.color = e.color;
        row.li.style.setProperty('--c', safeColor(e.color, TEAL));
      }
      const alive = e.alive !== false;
      if (alive !== row.alive) {
        row.alive = alive;
        row.li.classList.toggle('is-out', !alive);
      }
      const me = !!e.isMe;
      if (me !== row.me) {
        row.me = me;
        row.li.classList.toggle('is-me', me);
      }
    }
  }

  // =========================================================================
  // Aufbau: Laden
  // =========================================================================
  _buildLoading() {
    const text = h('p', { class: 'loading__text', role: 'status' }, 'Lädt …');
    this._screen('loading', h('div', { class: 'loading' },
      h('div', { class: 'logo logo--center', 'aria-hidden': 'true' },
        h('span', { class: 'logo__lane' }, 'Lane'), h('span', { class: 'logo__racer' }, 'Racer'), h('span', { class: 'logo__ver' }, VERSION.split('.').slice(0, 2).join('.'))),
      h('div', { class: 'loading__bar', 'aria-hidden': 'true' }, h('i')),
      text));
    this.ld = { text };
  }

  // =========================================================================
  // Aufbau: Hauptmenü
  // =========================================================================
  _buildMenu() {
    const m = {};
    const logo = h('h1', { class: 'logo', id: 'lr-menu-title', tabindex: '-1' },
      h('span', { class: 'logo__lane' }, 'Lane'),
      h('span', { class: 'logo__racer' }, 'Racer'),
      h('span', { class: 'logo__ver' }, VERSION.split('.').slice(0, 2).join('.')));
    this.focusTargets.menu = logo;

    m.best = new Digits('meta__num');
    m.carName = h('span', { class: 'meta__value' }, '—');
    m.carPerk = h('span', { class: 'meta__sub' });
    const meta = h('div', { class: 'menu__meta' },
      h('div', { class: 'meta' }, h('span', { class: 'meta__label' }, icon('trophy'), 'Rekord'),
        h('span', { class: 'meta__value' }, m.best.el, h('span', { class: 'meta__unit' }, 'm'))),
      h('div', { class: 'meta' }, h('span', { class: 'meta__label' }, icon('car'), 'Dein Auto'), m.carName, m.carPerk));

    const play = h('button', { type: 'button', class: 'btn btn--play', onClick: () => this._call('onPlay') },
      icon('play', 'btn__icon'), h('span', { class: 'btn__label' }, 'Fahren'), chevrons());

    const navBtn = (iconName, label, sub, cbName, cls = '') => {
      const subEl = h('span', { class: 'navbtn__sub' }, sub);
      const btn = h('button', { type: 'button', class: `navbtn ${cls}`.trim(), onClick: () => this._call(cbName) },
        h('span', { class: 'navbtn__icon' }, icon(iconName)),
        h('span', { class: 'navbtn__text' }, h('span', { class: 'navbtn__label' }, label), subEl));
      return { btn, subEl };
    };
    const garage = navBtn('car', 'Garage', 'Autos & Lacke', 'onOpenGarage');
    const board = navBtn('trophy', 'Rangliste', 'Wochenpreise · live', 'onOpenLeaderboard');
    const party = navBtn('users', 'Party', 'mit Freunden', 'onOpenParty', 'navbtn--party');
    const friends = navBtn('users', 'Freunde', 'Code & Rangliste', 'onOpenFriends', 'navbtn--friends');
    const campaign = navBtn('road', 'Kampagne', '20 Karten · Sterne · Stufen', 'onOpenCampaign', 'navbtn--campaign');
    m.campaignSub = campaign.subEl;
    const daily = navBtn('flag', 'Tagesrennen', 'Neue Strecke jeden Tag', 'onOpenDaily', 'navbtn--daily');
    m.dailySub = daily.subEl;
    const ranked = navBtn('bolt', 'Ranked', 'Neue Karte alle 12 Stunden', 'onOpenRanked', 'navbtn--ranked');
    m.rankedSub = ranked.subEl;
    const missions = navBtn('target', 'Missionen', 'Münzen verdienen', 'onOpenMissions');
    const settings = navBtn('sliders', 'Einstellungen', 'Sound & Grafik', 'onOpenSettings');
    m.partySub = party.subEl;
    const nav = h('nav', { class: 'menu__nav', 'aria-label': 'Hauptmenü' },
      campaign.btn, ranked.btn, daily.btn, party.btn, friends.btn, garage.btn, board.btn, missions.btn, settings.btn);

    m.partyCode = h('strong', { class: 'party-badge__code' });
    m.partyCount = h('span', { class: 'party-badge__count' });
    m.partyBadge = h('button', { type: 'button', class: 'party-badge', hidden: true, onClick: () => this._call('onOpenParty') },
      h('i', { class: 'live__rec', 'aria-hidden': 'true' }),
      h('span', { class: 'party-badge__text' }, h('span', { class: 'party-badge__kicker' }, 'Du bist in der Party'), m.partyCode),
      m.partyCount);

    m.missionList = h('ul', { class: 'mlist mlist--compact' });
    const missionBox = h('section', { class: 'menu__missions', 'aria-labelledby': 'lr-menu-missions' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title', id: 'lr-menu-missions' }, 'Missionen'),
        h('button', { type: 'button', class: 'linkbtn', onClick: () => this._call('onOpenMissions') }, 'Alle ansehen', icon('chevrons'))),
      m.missionList);

    const keys = h('p', { class: 'menu__keys' },
      h('kbd', null, '←'), h('kbd', null, '→'), ' Spur  ',
      h('kbd', null, '↑'), ' Gas  ', h('kbd', null, '↓'), ' Bremse  ',
      h('kbd', null, 'Leertaste'), ' Nitro  ', h('kbd', null, 'P'), ' Pause');

    const panel = h('div', { class: 'menu__panel' },
      h('div', { class: 'menu__brand' }, logo, h('p', { class: 'menu__tagline' }, 'Drei Spuren. Kein Tempolimit.')),
      h('div', { class: 'menu__controls' }, meta, play, m.partyBadge, nav, missionBox, keys));

    // Bauchbinde zum Auto (Desktop, rechts unten)
    m.ltName = h('strong', { class: 'lt__name' }, '—');
    m.ltModel = h('span', { class: 'lt__model' });
    m.ltPerk = h('span', { class: 'lt__perk' });
    m.lowerThird = h('aside', { class: 'lower-third', 'aria-label': 'Dein Auto' },
      h('span', { class: 'lt__kicker' }, 'Startaufstellung'),
      h('div', { class: 'lt__main' }, m.ltName, m.ltModel),
      m.ltPerk);

    // Nachrichtenticker unten (TV-Optik)
    m.bestTicker = h('span', { class: 'ticker__item' }, 'Noch kein Rekord – zeig, was du kannst');
    const tickerItems = () => TICKER_TIPS.map((t) => h('span', { class: 'ticker__item' }, t));
    const track = h('div', { class: 'ticker__track' },
      h('div', { class: 'ticker__group' }, m.bestTicker, tickerItems()),
      h('div', { class: 'ticker__group', 'aria-hidden': 'true' }, h('span', { class: 'ticker__item' }, `Lane Racer ${VERSION}`), tickerItems()));
    const ticker = h('div', { class: 'ticker', role: 'marquee', 'aria-label': 'Tipps' },
      h('span', { class: 'ticker__tag' }, h('i', { class: 'live__rec', 'aria-hidden': 'true' }), 'Tipps'),
      h('div', { class: 'ticker__viewport' }, track));

    const sec = this._screen('menu', h('div', { class: 'menu' }, panel), m.lowerThird, ticker);
    sec.setAttribute('aria-labelledby', 'lr-menu-title');
    this.mn = m;
  }

  /** Tagesserie: heutiger Stand und was als Nächstes winkt. */
  _fillStreak(streak) {
    const el = this.ms.streak;
    const count = streak ? Math.max(0, Math.floor(num(streak.count))) : 0;
    const playedToday = Boolean(streak && streak.playedToday);
    el.textContent = '';
    const days = Array.from({ length: STREAK.maxDays }, (_, i) => h('li', {
      class: `streak__day${i < count ? ' is-on' : ''}`,
      'aria-label': `Tag ${i + 1}: ${streakBonus(i + 1)} Münzen`,
    }, h('b', null, String(i + 1)), h('small', null, `+${streakBonus(i + 1)}`)));
    const next = streak && streak.next ? Math.floor(num(streak.next)) : streakBonus(1);
    el.append(
      h('p', { class: 'streak__head' }, icon('bolt'),
        h('strong', null, count > 0 ? `${count} ${count === 1 ? 'Tag' : 'Tage'} in Folge` : 'Noch keine Serie'),
        h('span', null, playedToday ? ` · morgen +${next} Münzen` : ` · heute fahren für +${next} Münzen`)),
      h('ol', { class: 'streak__days' }, days));
  }

  /** Erfolgsliste: geschaffte zuerst nach unten, offene nach Fortschritt. */
  _fillAchievements(items) {
    const list = this.ms.ach;
    list.textContent = '';
    const arr = Array.isArray(items) ? items.filter((a) => a && typeof a === 'object') : [];
    const done = arr.filter((a) => a.done).length;
    this.ms.achCount.textContent = `${done}/${arr.length}`;
    const sorted = [...arr].sort((a, b) => (a.done - b.done) || (b.progress - a.progress));
    for (const a of sorted) {
      const frac = clamp01(num(a.progress));
      const li = h('li', { class: `mcard ach${a.done ? ' is-done' : ''}` },
        h('div', { class: 'mcard__main' },
          h('div', { class: 'mcard__row' },
            h('span', { class: 'mcard__text' }, a.done ? icon('check') : null, h('strong', null, cleanText(a.name, 40)), ` – ${cleanText(a.text, 100)}`),
            h('span', { class: 'mcard__reward', 'aria-label': `Belohnung ${fmtInt(a.reward)} Münzen` }, coinIcon(), `+${fmtInt(a.reward)}`)),
          h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(num(a.target)), 'aria-valuenow': String(num(a.value)), 'aria-label': 'Fortschritt' },
            h('i', { class: 'bar__fill', style: { '--p': frac.toFixed(3) } })),
          h('div', { class: 'mcard__meta' },
            h('span', { class: 'mcard__prog' }, a.done ? 'Geschafft' : `${fmtInt(a.value)} / ${fmtInt(a.target)}`),
            a.color ? h('span', { class: 'ach__color', style: { '--c': safeColor(a.color.color) } }, h('i', null), `Lack: ${cleanText(a.color.name, 20)}`) : null)));
      list.append(li);
    }
  }

  /** Füllt eine Missionsliste (kompakt fürs Menü oder groß für den Missions-Bildschirm). */
  _fillMissionList(list, missions, compact) {
    const arr = Array.isArray(missions) ? missions.filter((m) => m && typeof m === 'object').slice(0, 6) : [];
    list.textContent = '';
    if (!arr.length) {
      list.append(h('li', { class: 'mcard mcard--empty' }, 'Keine aktiven Missionen.'));
      return;
    }
    arr.forEach((mission, i) => {
      const target = Math.max(1, num(mission.target));
      const progress = Math.max(0, num(mission.progress));
      const frac = clamp01(progress / target);
      const done = progress >= target;
      const mode = missionMode(mission.id);
      const scope = mode === 'run' ? 'In einer Runde' : mode === 'total' ? 'Insgesamt' : '';
      const fill = h('i', { class: 'bar__fill', style: { '--p': frac.toFixed(3) } });
      const li = h('li', { class: `mcard${done ? ' is-done' : ''}` },
        compact ? null : h('span', { class: 'mcard__idx', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
        h('div', { class: 'mcard__main' },
          h('div', { class: 'mcard__row' },
            h('span', { class: 'mcard__text' }, cleanText(mission.text, 120)),
            h('span', { class: 'mcard__reward', 'aria-label': `Belohnung ${fmtInt(mission.reward)} Münzen` }, coinIcon(), `+${fmtInt(mission.reward)}`)),
          h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(target), 'aria-valuenow': String(Math.min(progress, target)), 'aria-label': 'Fortschritt' }, fill),
          h('div', { class: 'mcard__meta' },
            h('span', { class: 'mcard__prog' }, `${fmtInt(Math.min(progress, target))} / ${fmtInt(target)}`),
            scope ? h('span', { class: 'mcard__scope' }, scope) : null,
            !compact && num(mission.tier) > 0 ? h('span', { class: 'mcard__tier' }, `Stufe ${num(mission.tier) + 1}`) : null)));
      list.append(li);
    });
  }

  // =========================================================================
  // Aufbau: Garage
  // =========================================================================
  _buildGarage() {
    const g = { cards: new Map(), key: '', preview: undefined, scrollTimer: 0, ignoreScrollUntil: 0 };
    g.list = h('ul', { class: 'garage__list', 'aria-label': 'Autos' });
    g.count = h('span', { class: 'sheet__count' }, '1/8');
    const foot = h('footer', { class: 'sheet__foot' },
      h('p', { class: 'garage__hint' }, 'Tippe ein Auto an für die 3D-Vorschau.'),
      h('button', { type: 'button', class: 'btn btn--play btn--sm', onClick: () => this._call('onPlay') },
        h('span', { class: 'btn__label' }, 'Fahren'), chevrons()));
    this._sheet('garage', { kicker: 'Fuhrpark', title: 'Garage', extra: g.count, cls: 'sheet--garage' }, g.list, foot);
    // Handy: Wischen durchs Karussell wählt das mittlere Auto für die Vorschau
    g.list.addEventListener('scroll', () => this._onGarageScroll(), { passive: true });
    this.gg = g;
  }

  _createCarCard(car, index, perks) {
    const id = car.id;
    const statusText = h('span', { class: 'car__status-text' });
    const statusCoin = coinIcon();
    const status = h('span', { class: 'car__status' }, statusCoin, statusText);
    const mini = h('span', { class: 'car__mini', 'aria-hidden': 'true' },
      STAT_DEFS.map(([key]) => h('i', { style: { '--v': statFrac(car.stats && car.stats[key]).toFixed(3) } })));
    const head = h('button', {
      type: 'button', class: 'car__head', 'aria-pressed': 'false',
      onClick: () => this._call('onPreviewCar', id),
    },
    h('span', { class: 'car__idx', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
    h('span', { class: 'car__titles' },
      h('span', { class: 'car__name' }, cleanText(car.name, 24)),
      h('span', { class: 'car__model' }, MODEL_LABEL[car.model] || '')),
    mini,
    status);

    const stats = STAT_DEFS.map(([key, label]) => {
      const v = num(car.stats && car.stats[key]) || 1;
      const marker = h('b', { class: 'stat__marker', hidden: true });
      const li = h('li', { class: 'stat' },
        h('span', { class: 'stat__label' }, label),
        h('span', { class: 'stat__bar', 'aria-hidden': 'true' }, h('i', { class: 'stat__fill', style: { '--v': statFrac(v).toFixed(3) } }), marker),
        h('span', { class: 'stat__val' }, String(Math.round(v * 100))));
      return { key, marker, li };
    });

    const perk = car.perk && perks ? perks[car.perk] : null;
    const perkEl = h('p', { class: perk ? 'car__perk' : 'car__perk is-none' },
      icon('bolt'),
      h('span', { class: 'car__perk-text' },
        h('strong', null, perk ? perk.name : 'Kein Perk'),
        h('span', null, perk ? perk.text : 'Pure Werte, keine Extras.')));

    // Aktive Fähigkeit (Taste F): Name, Wirkung und Abklingzeit
    const ab = car.ability;
    const abilityEl = ab ? h('p', { class: 'car__perk car__ability' },
      icon('target'),
      h('span', { class: 'car__perk-text' },
        h('strong', null, `Fähigkeit: ${cleanText(ab.name, 30)}`),
        h('span', null, `${cleanText(ab.text, 120)} (Abklingzeit ${fmtInt(ab.cooldown)} s)`))) : null;

    const swatches = (Array.isArray(car.colors) ? car.colors : []).map((color, i) => ({
      color,
      btn: h('button', {
        type: 'button', class: 'swatch', 'aria-pressed': 'false',
        'aria-label': `Lackierung ${i + 1} für ${car.name}`, title: `Lackierung ${i + 1}`,
        style: { '--c': safeColor(color) },
        onClick: () => this._call('onSelectColor', id, color),
      }),
    }));
    // Sonderlacke: gesperrt, bis der passende Erfolg geschafft ist
    const specials = Object.entries(SPECIAL_COLORS).map(([key, def]) => ({
      key,
      color: def.color,
      btn: h('button', {
        type: 'button', class: 'swatch swatch--special is-locked', 'aria-pressed': 'false', disabled: true,
        'aria-label': `Sonderlack ${def.name} (gesperrt)`, title: `${def.name} – wird durch einen Erfolg oder Wochenpreis freigeschaltet`,
        style: { '--c': safeColor(def.color) },
        onClick: () => this._call('onSelectColor', id, def.color),
      }, icon('lock', 'swatch__lock')),
      name: def.name,
    }));
    const colorsEl = h('div', { class: 'car__colors', hidden: true },
      h('span', { class: 'car__colors-label' }, 'Lack'),
      h('div', { class: 'swatches', role: 'group', 'aria-label': `Lackierung für ${car.name}` },
        swatches.map((s) => s.btn), specials.map((s) => s.btn)));

    // Tuning: drei Werte je 5 Stufen (nur für Autos in der Garage)
    const tuneRows = TUNING.map((tr) => {
      const pips = Array.from({ length: TUNING_MAX }, () => h('i', { class: 'pip' }));
      const cost = h('span', { class: 'tune__cost' });
      const btn = h('button', {
        type: 'button', class: 'btn btn--gold btn--sm tune__btn', 'data-sfx': 'none',
        onClick: () => this._call('onBuyTuning', id, tr.id),
      }, cost);
      const li = h('li', { class: 'tune__row' },
        h('span', { class: 'tune__name' }, h('strong', null, tr.name), h('span', null, tr.text)),
        h('span', { class: 'tune__pips', 'aria-hidden': 'true' }, pips),
        btn);
      return { id: tr.id, name: tr.name, pips, cost, btn, li };
    });
    const tuneEl = h('div', { class: 'car__tune', hidden: true },
      h('span', { class: 'car__colors-label' }, 'Tuning'),
      h('ul', { class: 'tune' }, tuneRows.map((r) => r.li)));

    const buy = h('button', {
      type: 'button', class: 'btn btn--gold btn--sm car__buy', 'data-sfx': 'none',
      'aria-label': `${car.name} kaufen für ${fmtInt(car.price)} Münzen`,
      onClick: () => this._call('onBuyCar', id),
    }, icon('lock', 'car__lock'), h('span', { class: 'btn__label' }, 'Kaufen'), h('span', { class: 'car__price' }, coinIcon(), fmtInt(car.price)));
    const select = h('button', {
      type: 'button', class: 'btn btn--primary btn--sm car__select',
      onClick: () => this._call('onSelectCar', id),
    }, h('span', { class: 'btn__label' }, 'Auswählen'));
    const activeTag = h('span', { class: 'car__active', hidden: true }, icon('check'), 'Im Einsatz');
    const hint = h('p', { class: 'car__hint', hidden: true });

    const li = h('li', { class: 'car', 'data-car': id },
      head,
      h('div', { class: 'car__body' },
        h('ul', { class: 'car__stats', 'aria-label': 'Werte' }, stats.map((s) => s.li)),
        perkEl,
        abilityEl,
        h('p', { class: 'car__desc' }, cleanText(car.description, 200)),
        colorsEl,
        tuneEl,
        h('div', { class: 'car__actions' }, buy, select, activeTag),
        hint));
    // Klick irgendwo auf die Karte (nicht auf einen Button) → Vorschau
    li.addEventListener('click', (e) => {
      if (!e.target.closest('button')) this._call('onPreviewCar', id);
    });
    return { car, li, head, statusText, statusCoin, stats, swatches, specials, colorsEl, tuneEl, tuneRows, buy, select, activeTag, hint, key: '' };
  }

  _updateCarCard(card, { owned, selected, preview, color, coins, activeCar, extraColors = [], tuning = null }) {
    if (!card) return;
    const car = card.car;
    const price = Math.floor(num(car.price));
    const exclusive = Boolean(car.exclusive);
    const locked = !owned && (exclusive || coins < price);
    const key = `${owned}|${selected}|${preview}|${color}|${locked}|${activeCar ? activeCar.id : ''}|${locked ? coins : ''}|${extraColors.join(',')}|${tuning ? TUNING.map((t) => tuning[t.id]).join('.') : ''}|${owned ? coins : ''}`;
    if (key === card.key) return;
    card.key = key;

    const li = card.li;
    li.classList.toggle('is-owned', owned);
    li.classList.toggle('is-active', selected);
    li.classList.toggle('is-preview', preview);
    li.classList.toggle('is-locked', locked);
    li.style.setProperty('--paint', safeColor(color, '#FF5A1F'));
    card.head.setAttribute('aria-pressed', preview ? 'true' : 'false');
    card.statusText.textContent = selected ? 'Aktiv' : owned ? 'Besitzt' : exclusive ? 'Wochenpreis' : fmtInt(price);
    card.statusCoin.hidden = owned || exclusive;

    card.colorsEl.hidden = !owned;
    for (const s of card.swatches) s.btn.setAttribute('aria-pressed', s.color === color ? 'true' : 'false');
    for (const s of card.specials) {
      const open = extraColors.includes(s.color);
      s.btn.disabled = !open;
      s.btn.classList.toggle('is-locked', !open);
      s.btn.setAttribute('aria-pressed', open && s.color === color ? 'true' : 'false');
      s.btn.setAttribute('aria-label', open ? `Sonderlack ${s.name}` : `Sonderlack ${s.name} (gesperrt)`);
      s.btn.title = open ? s.name : `${s.name} – wird durch einen Erfolg oder Wochenpreis freigeschaltet`;
    }

    card.tuneEl.hidden = !owned;
    if (owned) {
      for (const r of card.tuneRows) {
        const level = Math.min(TUNING_MAX, Math.max(0, Math.floor(num(tuning && tuning[r.id]))));
        const price = tuningCost(level);
        r.pips.forEach((p, i) => p.classList.toggle('is-on', i < level));
        r.btn.hidden = false;
        r.btn.disabled = price === null;
        r.btn.classList.toggle('is-locked', price !== null && coins < price);
        r.cost.textContent = '';
        if (price === null) r.cost.append('Max');
        else r.cost.append(coinIcon(), fmtInt(price));
        r.btn.setAttribute('aria-label', price === null ? `${r.name} voll ausgebaut` : `${r.name} auf Stufe ${level + 1} verbessern für ${fmtInt(price)} Münzen`);
      }
    }
    card.buy.hidden = owned || exclusive;
    card.buy.classList.toggle('is-locked', locked);
    card.select.hidden = !owned || selected;
    card.activeTag.hidden = !selected;
    card.hint.hidden = !locked;
    if (locked) card.hint.textContent = exclusive ? `Nur als Sieger der Wochenwertung (Platz 1, ${WEEKLY_RESET}).` : `Dir fehlen noch ${fmtInt(price - coins)} Münzen.`;

    // Markierung: Wert des aktuell gefahrenen Autos zum Vergleich
    for (const s of card.stats) {
      const show = !!activeCar && !selected;
      s.marker.hidden = !show;
      if (show) s.marker.style.left = `${(statFrac(activeCar.stats && activeCar.stats[s.key]) * 100).toFixed(1)}%`;
    }
  }

  _scrollToPreview(smooth) {
    const g = this.gg;
    if (this.screen !== 'garage') return;
    const card = g.cards.get(g.preview);
    const list = g.list;
    if (!card || typeof list.scrollTo !== 'function') return;
    const li = card.li;
    const behavior = smooth && !this.reducedMotion ? 'smooth' : 'auto';
    g.ignoreScrollUntil = performance.now() + (behavior === 'smooth' ? 700 : 150);
    if (this.mqPhone.matches) {
      list.scrollTo({ left: li.offsetLeft - (list.clientWidth - li.offsetWidth) / 2, behavior });
    } else {
      const top = li.offsetTop;
      const bottom = top + li.offsetHeight;
      if (top < list.scrollTop + 8) list.scrollTo({ top: Math.max(0, top - 8), behavior });
      else if (bottom > list.scrollTop + list.clientHeight - 8) list.scrollTo({ top: bottom - list.clientHeight + 8, behavior });
    }
  }

  _onGarageScroll() {
    const g = this.gg;
    if (!this.mqPhone.matches || this.screen !== 'garage') return;
    clearTimeout(g.scrollTimer);
    g.scrollTimer = setTimeout(() => {
      if (performance.now() < g.ignoreScrollUntil || this.screen !== 'garage') return;
      const list = g.list;
      const mid = list.scrollLeft + list.clientWidth / 2;
      let best = null;
      let bestDist = Infinity;
      for (const [id, card] of g.cards) {
        const center = card.li.offsetLeft + card.li.offsetWidth / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) {
          bestDist = d;
          best = id;
        }
      }
      if (best && best !== g.preview) this._call('onPreviewCar', best);
    }, 160);
  }

  // =========================================================================
  // Aufbau: Rangliste
  // =========================================================================
  _buildLeaderboard() {
    const lb = { tabs: [] };
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Wertung' });
    for (const t of LB_TABS) {
      const label = h('span', null, t.label);
      const btn = h('button', {
        type: 'button', class: 'tab', role: 'tab', id: `lr-tab-${t.kind}`, 'aria-selected': 'false',
        'aria-controls': 'lr-lb-panel', tabindex: '-1', hidden: t.kind === 'party',
        onClick: () => this._call('onLeaderboardTab', t.kind),
      }, t.kind === 'party' ? icon('users') : null, label);
      lb.tabs.push({ kind: t.kind, btn, label });
      tablist.append(btn);
    }
    // Pfeiltasten wechseln zwischen den Tabs (ARIA-Tab-Muster)
    tablist.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs = lb.tabs.filter((t) => !t.btn.hidden).map((t) => t.btn);
      let i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
      else if (e.key === 'Home') i = 0;
      else i = tabs.length - 1;
      tabs[i].focus();
      tabs[i].click();
    });
    lb.state = h('div', { class: 'lb__state' });
    lb.list = h('ol', { class: 'board', hidden: true });

    // Freunde: eigener Code, Link teilen, Code eingeben
    lb.friendCode = h('strong', { class: 'friends__code' }, '——');
    lb.friendCopy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onFriendCopy') },
      icon('copy'), h('span', { class: 'btn__label' }, 'Link kopieren'));
    lb.friendShare = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onFriendShare') },
      icon('share'), h('span', { class: 'btn__label' }, 'Teilen'));
    lb.friendInput = h('input', {
      id: 'lr-friend-input', class: 'field__input field__input--code field__input--small', type: 'text', maxlength: '12',
      spellcheck: 'false', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'Code deines Freundes', 'aria-label': 'Freundescode eingeben',
    });
    lb.friendAdd = h('button', { type: 'submit', class: 'btn btn--primary btn--sm' },
      icon('users'), h('span', { class: 'btn__label' }, 'Hinzufügen'));
    lb.friendMsg = h('p', { class: 'setting__desc friends__msg', role: 'status' });
    const friendForm = h('form', { class: 'friends__form', autocomplete: 'off' }, lb.friendInput, lb.friendAdd);
    friendForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._call('onFriendAdd', lb.friendInput.value);
    });
    lb.friends = h('section', { class: 'friends', hidden: true, 'aria-label': 'Freunde' },
      h('p', { class: 'friends__lead' }, 'Tausche Codes mit deinen Freunden: Wer deinen Code eingibt oder deinen Link öffnet, ist mit dir verbunden – ihr seht gegenseitig Namen und Rekorde.'),
      h('div', { class: 'friends__me' }, h('span', { class: 'friends__label' }, 'Dein Code'), lb.friendCode, lb.friendCopy, lb.friendShare),
      friendForm, lb.friendMsg);
    // Wochenwertung: Restzeit, Preise, eigener Platz, Einladung
    lb.weekCount = h('strong', { class: 'week__count' }, '…');
    lb.weekMe = h('p', { class: 'week__me' });
    lb.weekPrizes = h('ul', { class: 'week__prizes' }, Object.entries(WEEKLY_ITEMS).map(([key, it]) => h('li', { class: `week__prize week__prize--${key}` },
      h('span', { class: 'week__medal', 'aria-hidden': 'true' }, it.medal),
      h('span', { class: 'week__prize-text' }, h('strong', null, `Platz ${it.rank}: ${it.title}`), h('span', null, it.text)),
      h('span', { class: 'week__coins' }, coinIcon(), fmtInt(weeklyPrizeCoins(it.rank))))));
    lb.weekInvite = h('button', { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => this._call('onWeekInvite') },
      icon('copy'), h('span', { class: 'btn__label' }, 'Freunde einladen (Link kopieren)'));
    lb.weekShare = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onWeekShare') },
      icon('share'), h('span', { class: 'btn__label' }, 'Teilen'));
    lb.week = h('section', { class: 'week', hidden: true, 'aria-label': 'Wochenwertung' },
      h('div', { class: 'week__head' }, h('span', { class: 'week__label' }, 'Wertung endet in'), lb.weekCount,
        h('span', { class: 'week__reset' }, `Neustart jeden ${WEEKLY_RESET}`), h('span', { class: 'week__live' }, h('i', null), 'Live')),
      lb.weekPrizes,
      h('p', { class: 'week__more' }, 'Platz 4: 500 · 5: 400 · 6: 320 · 7: 260 · 8: 210 · 9: 170 · 10: 140 · 11–15: 100 · 16–25: 70 · 26–50: 40 · danach 25 Münzen für jeden mit Punkten.'),
      lb.weekMe,
      h('div', { class: 'week__invite' }, lb.weekInvite, lb.weekShare));
    // Ranked-Karte: Welt, Restzeit, eigener Platz, Start
    lb.rankedCount = h('strong', { class: 'week__count' }, '…');
    lb.rankedWorld = h('span', { class: 'week__reset' });
    lb.rankedMe = h('p', { class: 'week__me' });
    lb.rankedPlay = h('button', { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => this._call('onOpenRanked') },
      icon('play'), h('span', { class: 'btn__label' }, 'Diese Karte fahren'));
    lb.ranked = h('section', { class: 'week', hidden: true, 'aria-label': 'Ranked-Karte' },
      h('div', { class: 'week__head' }, h('span', { class: 'week__label' }, 'Neue Karte in'), lb.rankedCount, lb.rankedWorld,
        h('span', { class: 'week__live' }, h('i', null), 'Live')),
      lb.rankedMe,
      h('div', { class: 'week__invite' }, lb.rankedPlay));
    lb.panel = h('div', { class: 'sheet__body lb', id: 'lr-lb-panel', role: 'tabpanel' }, lb.week, lb.ranked, lb.friends, lb.state, lb.list);
    this._sheet('leaderboard', { kicker: 'Bestenliste', title: 'Rangliste', cls: 'sheet--board' }, tablist, lb.panel);
    this.lb = lb;
  }

  _skeleton(n) {
    return h('ol', { class: 'board board--skeleton', 'aria-hidden': 'true' },
      Array.from({ length: n }, (_, i) => h('li', { class: 'lb-row is-skeleton', style: { '--i': String(i) } },
        h('span', { class: 'lb-row__rank' }), h('i', { class: 'lb-row__dot' }),
        h('span', { class: 'lb-row__who' }, h('span', { class: 'sk sk--name' }), h('span', { class: 'sk sk--car' })),
        h('span', { class: 'sk sk--best' }))));
  }

  /** Ranglistenzeilen (Allzeit, Woche, Party). Baut nur neu, wenn sich die Daten geändert haben. */
  _fillBoard(list, rows, meId, max, onRemove = null, opts = {}) {
    const data = rows.filter((r) => r && typeof r === 'object').slice(0, max);
    const sig = `${meId}#${onRemove ? 'r' : ''}${opts.weekly ? 'w' : ''}#${data.map((r) => `${r.player_id ?? r.id}:${r.name}:${r.best ?? r.score}:${r.car}:${r.color}:${r.runs}:${r.rank}:${r.wins ?? ''}`).join('|')}`;
    if (list._sig === sig) return;
    list._sig = sig;
    list.textContent = '';
    data.forEach((row, index) => {
      const rank = Math.max(1, Math.floor(num(row.rank)) || index + 1);
      const id = row.player_id ?? row.playerId ?? row.id;
      const me = row.isMe === true || (meId != null && id === meId);
      const runs = row.runs != null ? Math.floor(num(row.runs)) : null;
      list.append(h('li', {
        class: `lb-row${me ? ' is-me' : ''}${rank <= 3 ? ` is-top is-top${rank}` : ''}`,
        style: { '--c': safeColor(row.color) },
      },
      h('span', { class: 'lb-row__rank' }, String(rank)),
      h('i', { class: 'lb-row__dot', 'aria-hidden': 'true' }),
      h('span', { class: 'lb-row__who' },
        h('span', { class: 'lb-row__name' }, h('span', { class: 'lb-row__nametext' }, cleanName(row.name) || 'Unbekannt'), me ? h('span', { class: 'tag tag--me' }, 'Du') : null,
          num(row.wins) > 0 ? h('span', { class: 'tag tag--gold', title: 'Wochensiege' }, `🏆 ${fmtInt(row.wins)}`) : null),
        h('span', { class: 'lb-row__car' }, carName(row.car) || '—')),
      runs != null ? h('span', { class: 'lb-row__runs' }, `${fmtInt(runs)} ${runs === 1 ? 'Fahrt' : 'Fahrten'}`) : null,
      h('span', { class: 'lb-row__best' }, fmtInt(row.best ?? row.score), h('span', { class: 'lb-row__unit' }, 'm')),
      opts.weekly && num(row.best ?? row.score) > 0 ? h('span', { class: 'lb-row__prize', title: 'Preis, wenn die Woche jetzt endet' }, coinIcon(), fmtInt(weeklyPrizeCoins(rank))) : null,
      onRemove && !me ? h('button', {
        type: 'button', class: 'lb-row__remove', title: 'Freund entfernen', 'aria-label': `${cleanName(row.name) || 'Freund'} entfernen`,
        onClick: () => onRemove(id),
      }, icon('close')) : null));
    });
  }

  // =========================================================================
  // Aufbau: Party
  // =========================================================================
  _buildParty() {
    const p = { rows: new Map() };

    // --- Noch in keiner Party: erstellen oder beitreten ---------------------
    p.codeInput = h('input', {
      id: 'lr-party-code', class: 'field__input field__input--code', type: 'text', inputmode: 'text',
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '60',
      placeholder: 'z. B. K7QX2', 'aria-describedby': 'lr-party-code-hint', enterkeyhint: 'go',
    });
    // Nur A–Z/0–9 erlauben; ein eingefügter Einladungslink wird automatisch zum Code
    p.codeInput.addEventListener('input', () => {
      const raw = p.codeInput.value;
      const fromLink = /[?&]party=([A-Za-z0-9]{4,8})/.exec(raw);
      const clean = (fromLink ? fromLink[1] : raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (clean !== raw) p.codeInput.value = clean;
    });
    const joinForm = h('form', { class: 'pcard pcard--join', novalidate: true },
      h('h3', { class: 'pcard__title' }, icon('link'), 'Party beitreten'),
      h('label', { class: 'field__label', for: 'lr-party-code' }, 'Party-Code'),
      h('div', { class: 'field__row' },
        p.codeInput,
        h('button', { type: 'submit', class: 'btn btn--teal btn--sm' }, h('span', { class: 'btn__label' }, 'Beitreten'))),
      h('p', { class: 'field__hint', id: 'lr-party-code-hint' }, 'Oder einfach den Link deines Freundes öffnen – oder hier einfügen.'));
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = p.codeInput.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) {
        p.error.textContent = 'Der Code besteht aus 4 bis 8 Buchstaben oder Ziffern.';
        p.error.hidden = false;
        this._call('onUiSound', 'error');
        p.codeInput.focus();
        return;
      }
      p.error.hidden = true;
      this._call('onJoinParty', code);
    });
    const createCard = h('div', { class: 'pcard pcard--create' },
      h('h3', { class: 'pcard__title' }, icon('users'), 'Neue Party'),
      h('p', { class: 'pcard__text' }, 'Du bist Host und startest die Rennen. Bis zu 8 Fahrer.'),
      h('button', { type: 'button', class: 'btn btn--teal btn--block', onClick: () => this._call('onCreateParty') },
        h('span', { class: 'btn__label' }, 'Party erstellen'), chevrons()));
    const step = (n, title, text) => h('li', { class: 'step' },
      h('span', { class: 'step__num', 'aria-hidden': 'true' }, String(n)),
      h('span', { class: 'step__text' }, h('strong', null, title), h('span', null, text)));
    p.none = h('div', { class: 'party-none' },
      h('p', { class: 'lead' }, 'Fahrt zusammen! Ihr seht euch gegenseitig als Geisterautos auf der Strecke und könnt echte Rennen starten – gleiche Strecke, gleicher Verkehr.'),
      h('ol', { class: 'steps' },
        step(1, 'Party erstellen', 'Du bekommst einen Code.'),
        step(2, 'Link schicken', 'Per WhatsApp, Discord & Co.'),
        step(3, 'Zusammen fahren', 'Live-Punkte aller Fahrer.')),
      h('div', { class: 'pcards' }, createCard, joinForm));

    // --- Verbindungsaufbau --------------------------------------------------
    p.joiningText = h('p', { class: 'joining__text' }, 'Verbinde mit der Party …');
    p.joining = h('div', { class: 'party-joining', hidden: true, role: 'status' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }), p.joiningText);

    // --- In der Party -------------------------------------------------------
    p.code = h('strong', { class: 'party-code__value' }, '—');
    p.url = h('input', { class: 'field__input invite__url', type: 'text', readonly: true, 'aria-label': 'Einladungslink', id: 'lr-party-url' });
    p.url.addEventListener('focus', () => p.url.select());
    p.share = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onShareInvite') },
      icon('share'), h('span', { class: 'btn__label' }, 'Teilen'));
    const copy = h('button', { type: 'button', class: 'btn btn--teal btn--sm', onClick: () => this._call('onCopyInvite') },
      icon('copy'), h('span', { class: 'btn__label' }, 'Link kopieren'));
    const codeBlock = h('div', { class: 'party-code' },
      checker('party-code__checker'),
      h('span', { class: 'party-code__label' }, 'Party-Code'),
      p.code,
      h('div', { class: 'invite' },
        h('label', { class: 'field__label', for: 'lr-party-url' }, 'Einladungslink'),
        p.url,
        h('div', { class: 'invite__actions' }, copy, p.share)));

    p.raceBannerText = h('span', null, 'Rennen läuft …');
    p.raceBanner = h('div', { class: 'race-banner', hidden: true, role: 'status' }, h('i', { class: 'live__rec', 'aria-hidden': 'true' }), p.raceBannerText);

    p.resultsList = h('ol', { class: 'results' });
    p.resultsSummary = h('p', { class: 'results__summary' });
    p.results = h('section', { class: 'party-results', hidden: true, 'aria-labelledby': 'lr-party-results' },
      h('h3', { class: 'section-title', id: 'lr-party-results' }, icon('flag'), 'Rennergebnis'),
      p.resultsSummary, p.resultsList);

    p.startLabel = h('span', { class: 'btn__label' }, 'Rennen starten');
    p.start = h('button', { type: 'button', class: 'btn btn--play btn--block', hidden: true, onClick: () => this._call('onStartRace') },
      icon('flag', 'btn__icon'), p.startLabel, chevrons());
    p.wait = h('p', { class: 'party-wait' }, 'Warte auf den Host …');
    p.solo = h('p', { class: 'party-solo' }, 'Noch allein hier – schick den Link an deine Freunde!');
    const hostBox = h('div', { class: 'party-host' }, p.start,
      h('p', { class: 'party-host__hint' }, 'Alle starten gleichzeitig – gleiche Strecke, gleicher Verkehr.'), p.wait, p.solo);

    p.memberCount = h('span', { class: 'section-count' }, '0');
    p.memberList = h('ul', { class: 'members' });
    const membersBox = h('section', { class: 'party-members', 'aria-labelledby': 'lr-party-members' },
      h('div', { class: 'section-head' }, h('h3', { class: 'section-title', id: 'lr-party-members' }, 'Fahrer'), p.memberCount),
      p.memberList);

    const emotesBox = h('section', { class: 'party-emotes', 'aria-labelledby': 'lr-party-emotes' },
      h('h3', { class: 'section-title', id: 'lr-party-emotes' }, 'Emotes und Sprüche'),
      h('div', { class: 'emote-row' }, EMOTES.map((e) => this._emoteButton(e, false))),
      h('div', { class: 'chat-row' }, QUICK_CHAT.map((c) => this._chatButton(c))));

    p.board = h('ol', { class: 'board board--compact', hidden: true });
    p.boardEmpty = h('p', { class: 'muted-note' }, 'Noch keine Party-Ergebnisse – startet ein Rennen!');
    const boardBox = h('section', { class: 'party-board', 'aria-labelledby': 'lr-party-board' },
      h('h3', { class: 'section-title', id: 'lr-party-board' }, icon('trophy'), 'Party-Rangliste'),
      p.boardEmpty, p.board);

    const leave = h('button', { type: 'button', class: 'btn btn--danger btn--sm party-leave', onClick: () => this._call('onLeaveParty') },
      icon('close'), h('span', { class: 'btn__label' }, 'Party verlassen'));

    p.joined = h('div', { class: 'party-joined', hidden: true },
      h('div', { class: 'party-grid' },
        h('div', { class: 'party-col' }, codeBlock, p.raceBanner, p.results, hostBox),
        h('div', { class: 'party-col' }, membersBox, emotesBox, boardBox)),
      leave);

    p.error = h('p', { class: 'form-error', role: 'alert', hidden: true });

    this._sheet('party', { kicker: 'Mit Freunden', title: 'Party', cls: 'sheet--party' },
      h('div', { class: 'sheet__body' }, p.error, p.none, p.joining, p.joined));
    this.pt = p;
  }

  _emoteButton(emoji, compact) {
    const btn = h('button', {
      type: 'button', class: compact ? 'emote emote--sm' : 'emote', 'data-sfx': 'none',
      'aria-label': `Emote ${emoji} senden`, title: 'Emote senden',
    }, emoji);
    if (compact) {
      // Im HUD: nie den Fokus nehmen (sonst würde die Leertaste den Button auslösen)
      btn.tabIndex = -1;
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
    }
    btn.addEventListener('click', () => {
      if (compact) btn.blur();
      this._sendEmote(emoji);
    });
    this._emoteBtns.push(btn);
    return btn;
  }

  _chatButton(entry) {
    const btn = h('button', {
      type: 'button', class: 'chat-chip', 'data-sfx': 'none', title: 'Schnellnachricht senden',
    }, entry.text);
    btn.addEventListener('click', () => this._sendEmote(entry.id, 'onChat'));
    this._emoteBtns.push(btn);
    return btn;
  }

  _sendEmote(emoji, callback = 'onEmote') {
    const now = performance.now();
    if (now < this._emoteReadyAt) return;
    this._emoteReadyAt = now + EMOTE_COOLDOWN;
    for (const b of this._emoteBtns) {
      b.classList.add('is-cooling');
      b.setAttribute('aria-disabled', 'true');
    }
    clearTimeout(this._emoteTimer);
    this._emoteTimer = setTimeout(() => {
      for (const b of this._emoteBtns) {
        b.classList.remove('is-cooling');
        b.removeAttribute('aria-disabled');
      }
    }, EMOTE_COOLDOWN);
    this._call(callback, emoji);
  }

  _renderMembers(members) {
    const p = this.pt;
    const seen = new Set();
    const list = members.slice(0, 12);
    list.forEach((m, i) => {
      const id = String(m.id != null ? m.id : `idx-${i}`);
      seen.add(id);
      let row = p.rows.get(id);
      if (!row) {
        row = this._createMemberRow();
        p.rows.set(id, row);
      }
      this._updateMemberRow(row, m);
      const at = p.memberList.children[i];
      if (at !== row.li) p.memberList.insertBefore(row.li, at || null);
    });
    for (const [id, row] of p.rows) {
      if (!seen.has(id)) {
        row.li.remove();
        p.rows.delete(id);
      }
    }
    p.memberCount.textContent = String(list.length);
  }

  _createMemberRow() {
    const name = h('span', { class: 'member__name' });
    const crown = h('span', { class: 'member__crown', title: 'Host', hidden: true }, icon('crown'), srOnly('(Host)'));
    const you = h('span', { class: 'tag tag--me', hidden: true }, 'Du');
    const sub = h('span', { class: 'member__sub' });
    const chip = h('span', { class: 'status-chip' });
    const add = h('button', { type: 'button', class: 'member__add', hidden: true, title: 'Als Freund hinzufügen' }, icon('users'), h('span', null, 'Freund'));
    const row = { li: null, name, crown, you, sub, chip, add, fc: '', k: '' };
    add.addEventListener('click', () => { if (row.fc) this._call('onPartyFriend', row.fc); });
    row.li = h('li', { class: 'member' },
      h('i', { class: 'member__dot', 'aria-hidden': 'true' }),
      h('span', { class: 'member__main' }, h('span', { class: 'member__line' }, name, crown, you), sub),
      add,
      chip);
    return row;
  }

  _updateMemberRow(row, m) {
    const name = cleanName(m.name) || 'Fahrer';
    const [kind, label] = this._memberStatus(m);
    const sub = `${carName(m.car) || 'Auto'} · Rekord ${fmtDist(m.best)}`;
    const color = safeColor(m.color, TEAL);
    const key = `${name}|${kind}|${label}|${sub}|${color}|${!!m.isHost}|${!!m.isMe}|${m.fc || ''}`;
    if (key === row.k) return;
    row.k = key;
    row.fc = !m.isMe && typeof m.fc === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(m.fc) ? m.fc : '';
    row.add.hidden = !row.fc;
    row.name.textContent = name;
    row.sub.textContent = sub;
    row.chip.textContent = label;
    row.chip.dataset.status = kind;
    row.crown.hidden = !m.isHost;
    row.you.hidden = !m.isMe;
    row.li.classList.toggle('is-me', !!m.isMe);
    row.li.classList.toggle('is-host', !!m.isHost);
    row.li.classList.toggle('is-stale', kind === 'stale');
    row.li.style.setProperty('--c', color);
  }

  _memberStatus(m) {
    const status = typeof m.status === 'string' ? m.status : 'menu';
    if (status === 'driving') {
      // Kein Lebenszeichen seit > 5 s → „Verbindung weg?“ (nicht entfernen)
      let stale = m.stale === true;
      if (!stale && num(m.lastSeen) > 0) {
        const ls = num(m.lastSeen);
        const age = ls > 1e12 ? Date.now() - ls : performance.now() - ls;
        stale = age > 5000;
      }
      if (stale) return ['stale', 'Verbindung weg?'];
      return ['driving', `Fährt ${fmtDist(m.distance)}`];
    }
    if (status === 'crashed') return ['crashed', num(m.distance) > 0 ? `Crash · ${fmtDist(m.distance)}` : 'Crash'];
    return [MEMBER_STATUS[status] ? status : 'menu', MEMBER_STATUS[status] || MEMBER_STATUS.menu];
  }

  /**
   * Rennergebnis-Liste (Party-Bildschirm und Rundenende).
   * results: [{ name, color, score, alive?, isMe? }] – alive: true = fährt noch.
   */
  _renderResults(list, results) {
    const arr = (Array.isArray(results) ? results : [])
      .filter((r) => r && typeof r === 'object')
      .slice(0, 16)
      .map((r) => ({
        name: cleanName(r.name) || 'Fahrer',
        color: safeColor(r.color, TEAL),
        score: Math.floor(num(r.score != null ? r.score : r.distance)),
        running: r.alive === true || r.done === false || r.finished === false,
        me: !!r.isMe,
      }))
      .sort((a, b) => b.score - a.score);
    const myIndex = arr.findIndex((r) => r.me);
    const anyRunning = arr.some((r) => r.running);
    const info = { count: arr.length, myPlace: myIndex >= 0 && !anyRunning ? myIndex + 1 : 0, running: anyRunning };
    const sig = arr.map((r) => `${r.name}:${r.score}:${r.running}:${r.me}:${r.color}`).join('|');
    if (list._sig === sig) return info;
    list._sig = sig;
    list.textContent = '';
    if (!arr.length) {
      list.append(h('li', { class: 'result result--empty' }, 'Noch keine Ergebnisse …'));
      return info;
    }
    arr.forEach((r, i) => {
      list.append(h('li', {
        class: `result${r.me ? ' is-me' : ''}${i === 0 && !r.running ? ' is-winner' : ''}${r.running ? ' is-running' : ''}`,
        style: { '--c': r.color },
      },
      h('span', { class: 'result__place' }, String(i + 1)),
      h('i', { class: 'result__dot', 'aria-hidden': 'true' }),
      h('span', { class: 'result__name' }, h('span', { class: 'result__nametext' }, r.name), r.me ? h('span', { class: 'tag tag--me' }, 'Du') : null),
      r.running ? h('span', { class: 'result__live' }, 'fährt noch') : null,
      h('span', { class: 'result__score' }, fmtInt(r.score), h('span', { class: 'result__unit' }, 'm'))));
    });
    return info;
  }

  // =========================================================================
  // Aufbau: Missionen
  // =========================================================================
  _buildMissions() {
    const ms = { stats: {} };
    ms.list = h('ul', { class: 'mlist' });
    const statDefs = [
      ['runs', 'Fahrten', 'flag'], ['totalDistance', 'Gesamtstrecke', 'road'], ['totalCoins', 'Münzen verdient', 'coins'],
      ['nearMisses', 'Beinahe-Unfälle', 'bolt'], ['smashed', 'Gerammt', 'alert'], ['overtakes', 'Überholt', 'chevrons'],
      ['partyRaces', 'Party-Rennen', 'users'],
    ];
    const grid = h('dl', { class: 'stats-grid' }, statDefs.map(([key, label, ic]) => {
      const dd = h('dd', { class: 'stat-tile__value' }, '0');
      ms.stats[key] = dd;
      return h('div', { class: 'stat-tile' }, h('dt', { class: 'stat-tile__label' }, icon(ic), label), dd);
    }));
    ms.streak = h('div', { class: 'streak' });
    ms.ach = h('ul', { class: 'mlist mlist--ach' });
    ms.achCount = h('span', { class: 'sheet__count' }, '0/0');
    this._sheet('missions', { kicker: 'Aufträge', title: 'Missionen' },
      h('div', { class: 'sheet__body' },
        ms.list,
        h('p', { class: 'muted-note' }, 'Missionen werden am Ende jeder Runde geprüft. Geschaffte Missionen zahlen Münzen aus und werden durch neue, härtere ersetzt.'),
        h('h3', { class: 'section-title' }, 'Tagesserie'),
        ms.streak,
        h('h3', { class: 'section-title' }, 'Erfolge ', ms.achCount),
        ms.ach,
        h('h3', { class: 'section-title' }, 'Deine Statistik'),
        grid));
    this.ms = ms;
  }

  // =========================================================================
  // Aufbau: Einstellungen
  // =========================================================================
  // =========================================================================
  // Aufbau: Kampagne
  // =========================================================================
  _buildCampaign() {
    const c = {};
    c.levelNum = h('strong', { class: 'camp-head__level' }, 'Stufe 1');
    c.xpFill = h('i', { class: 'camp-xp__fill' });
    c.xpText = h('span', { class: 'camp-head__xp' });
    c.stars = h('span', { class: 'camp-head__stars' });
    c.head = h('div', { class: 'camp-head' },
      h('div', { class: 'camp-head__row' }, c.levelNum, c.stars),
      h('div', { class: 'camp-xp' }, c.xpFill), c.xpText);
    c.list = h('div', { class: 'camp-worlds' });
    this._sheet('campaign', { kicker: 'Singleplayer', title: 'Kampagne', cls: 'sheet--campaign' },
      h('div', { class: 'sheet__body' }, c.head,
        h('p', { class: 'muted-note' }, 'Jede Karte hat eine feste Strecke mit Ziel. Erreiche das Ziel für den ersten Stern, die Zusatzaufgaben bringen Stern 2 und 3. Sterne schalten neue Karten frei, Sterne und Stufen zahlen Münzen. Wiederholen bringt XP.'),
        c.list));
    this.cp = c;
  }

  /**
   * Kartenübersicht. maps: [{ id, name, number, world, worldName, goal, goals, stars, best, unlocked, hint }]
   * campaign: { level, into, need, frac, stars, maxStars }
   */
  renderCampaign({ maps = [], level = null, stars = 0, maxStars = 60 } = {}) {
    const c = this.cp;
    if (level) {
      c.levelNum.textContent = `Fahrerstufe ${level.level}`;
      c.xpFill.style.transform = `scaleX(${clamp01(num(level.frac)).toFixed(3)})`;
      c.xpText.textContent = `${fmtInt(level.into)} / ${fmtInt(level.need)} XP bis Stufe ${level.level + 1}`;
    }
    c.stars.textContent = `${stars} / ${maxStars} ★`;
    c.list.textContent = '';
    const byWorld = new Map();
    for (const m of maps) {
      if (!byWorld.has(m.world)) byWorld.set(m.world, []);
      byWorld.get(m.world).push(m);
    }
    for (const [world, list] of byWorld) {
      const have = list.reduce((sum, m) => sum + num(m.stars), 0);
      const cards = list.map((m) => {
        const starRow = h('span', { class: 'cmap__stars', 'aria-label': `${num(m.stars)} von 3 Sternen` },
          [1, 2, 3].map((i) => h('span', { class: i <= num(m.stars) ? 'is-on' : '' }, '★')));
        const goalLines = (m.goals || []).slice(1).map((g, i) => h('li', { class: num(m.stars) >= i + 2 ? 'is-done' : '' },
          h('span', null, num(m.stars) >= i + 2 ? '✓' : '○'), cleanText(g.label, 40)));
        const body = [
          h('span', { class: 'cmap__top' }, h('b', { class: 'cmap__num' }, `${world + 1}-${num(m.number)}`), h('span', { class: 'cmap__name' }, cleanText(m.name, 26)), starRow),
          h('span', { class: 'cmap__meta' }, `${fmtInt(m.goal)} m${TIME_TAG[m.time] ? ` · ${TIME_TAG[m.time]}` : ''}${num(m.best) ? ` · Bestwert ${fmtInt(m.best)} m` : ''}`),
          h('ul', { class: 'cmap__goals' }, goalLines),
        ];
        if (m.unlocked) {
          return h('button', { type: 'button', class: `cmap${num(m.stars) === 3 ? ' is-perfect' : ''}`, onClick: () => this._call('onStartMap', m.id) }, ...body,
            h('span', { class: 'cmap__go' }, icon('play'), num(m.stars) ? 'Nochmal fahren' : 'Starten'));
        }
        const hint = m.hint || {};
        const need = [];
        if (hint.needPrev) need.push(`Schaffe erst ${cleanText(hint.needPrev.name, 24)}`);
        if (num(hint.needStars) > 0) need.push(`noch ${num(hint.needStars)} ★ sammeln`);
        return h('div', { class: 'cmap is-locked', 'aria-disabled': 'true' }, ...body,
          h('span', { class: 'cmap__lock' }, icon('lock'), need.join(' · ') || 'Gesperrt'));
      });
      c.list.append(h('section', { class: 'camp-world', 'data-world': String(world) },
        h('h3', { class: 'section-title' }, cleanText(list[0].worldName, 24), h('span', { class: 'camp-world__count' }, `${have}/${list.length * 3} ★`)),
        h('div', { class: 'camp-grid' }, cards)));
    }
  }

  /** Reiter der Einstellungen wechseln (merkt sich die Wahl, auch nach dem Schließen). */
  _selectSettingsTab(id) {
    const st = this.st;
    const tab = st.tabs.find((t) => t.id === id) || st.tabs[0];
    for (const t of st.tabs) {
      const on = t === tab;
      t.panel.hidden = !on;
      t.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      t.btn.tabIndex = on ? 0 : -1;
    }
    st.active = tab.id;
    this._settingsTab = tab.id;
    st.body.scrollTop = 0;
  }

  _buildSettings() {
    const st = { rows: {} };
    const change = (partial) => this._call('onSettingsChange', partial);

    /** Baut eine Zeile nach der Beschreibung in SETTINGS_GROUPS (config.js). */
    const buildItem = (item) => {
      const id = `lr-set-${item.key}`;
      const text = (labelId) => h('span', { class: 'setting__text' },
        h('span', { class: 'setting__label', id: labelId }, item.label),
        item.desc ? h('span', { class: 'setting__desc' }, item.desc) : null);

      if (item.type === 'switch') {
        const input = h('input', { id, type: 'checkbox', role: 'switch', class: 'switch' });
        input.addEventListener('change', () => change({ [item.key]: input.checked }));
        const row = h('label', { class: 'setting setting--switch', for: id }, text(null), input);
        st.rows[item.key] = { item, row, input };
        return row;
      }

      if (item.type === 'range') {
        const input = h('input', { id, type: 'range', min: '0', max: '100', step: '5', class: 'range' });
        const out = h('output', { class: 'setting__value', for: id }, '0 %');
        input.addEventListener('input', () => {
          const v = Number(input.value);
          out.textContent = `${v} %`;
          input.style.setProperty('--p', `${v}%`);
          change({ [item.key]: v / 100 });
        });
        const row = h('div', { class: 'setting setting--range' },
          h('label', { class: 'setting__label', for: id }, item.label), out, input);
        st.rows[item.key] = { item, row, input, out };
        return row;
      }

      // Auswahl (seg)
      const buttons = item.options.map(([value, label]) => ({
        value,
        btn: h('button', {
          type: 'button', class: 'seg__btn', 'aria-pressed': 'false',
          onClick: () => { if (value !== this._settings[item.key]) change({ [item.key]: value }); },
        }, label),
      }));
      const row = h('div', { class: 'setting setting--seg', role: 'group', 'aria-labelledby': `${id}-label` },
        text(`${id}-label`),
        h('div', { class: 'seg' }, buttons.map((b) => b.btn)));
      st.rows[item.key] = { item, row, buttons };
      return row;
    };

    const groups = SETTINGS_GROUPS.map((group) => h('div', { class: 'settings-group', 'data-group': group.id },
      h('h3', { class: 'settings-group__title' }, group.title),
      group.items.map(buildItem)));

    st.nameValue = h('strong', { class: 'setting__name' }, 'Gast');
    const nameRow = h('div', { class: 'setting setting--name' },
      h('span', { class: 'setting__text' }, h('span', { class: 'setting__label' }, 'Fahrername'), st.nameValue),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onRename') },
        icon('pencil'), h('span', { class: 'btn__label' }, 'Name ändern')));

    const keyRow = (keys, text) => h('div', { class: 'keys__row' }, h('dt', null, keys.map((k) => h('kbd', null, k))), h('dd', null, text));
    const controls = h('div', { class: 'setting setting--keys' },
      h('span', { class: 'setting__label' }, 'Steuerung'),
      h('dl', { class: 'keys' },
        keyRow(['←', '→'], 'Spur wechseln (oder A / D)'),
        keyRow(['↑'], 'Gas geben'),
        keyRow(['↓'], 'Bremsen'),
        keyRow(['Leertaste'], 'Nitro zünden'),
        keyRow(['F'], 'Auto-Fähigkeit einsetzen (oder E)'),
        keyRow(['P'], 'Pause'),
        keyRow(['M'], 'Ton an / aus')),
      h('p', { class: 'setting__desc' }, 'Am Handy: links/rechts tippen oder die Pfeile nutzen, dazu Gas, Bremse, Nitro und Fähigkeit.'));

    // --- Spielstand sichern (Cloud) ---
    st.cloudStatus = h('span', { class: 'setting__desc setting__status', role: 'status' }, 'Noch nicht gesichert');
    st.code = h('input', {
      id: 'lr-set-code', class: 'field__input field__input--code field__input--small', type: 'text', readonly: true, value: '',
      spellcheck: 'false', autocomplete: 'off', placeholder: 'Wird nach dem Anmelden erzeugt', 'aria-label': 'Dein Sicherungscode',
    });
    st.codeShow = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._toggleRecoveryShown() },
      icon('lock'), h('span', { class: 'btn__label' }, 'Anzeigen'));
    st.codeCopy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onCopyRecovery') },
      icon('copy'), h('span', { class: 'btn__label' }, 'Kopieren'));
    st.restoreInput = h('input', {
      id: 'lr-set-restore', class: 'field__input field__input--small', type: 'text', spellcheck: 'false', autocomplete: 'off',
      autocapitalize: 'characters', placeholder: 'Code vom anderen Gerät einfügen', 'aria-label': 'Sicherungscode zum Wiederherstellen',
    });
    st.restoreLabel = h('span', { class: 'btn__label' }, 'Wiederherstellen');
    st.restoreBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._onRestoreClick() },
      icon('restart'), st.restoreLabel);
    st.restoreMsg = h('p', { class: 'setting__desc setting__msg', role: 'status' });
    const cloudRow = h('div', { class: 'setting setting--cloud' },
      h('span', { class: 'setting__text' },
        h('span', { class: 'setting__label' }, 'Spielstand sichern'),
        h('span', { class: 'setting__desc' }, 'Münzen, Autos und Missionen werden automatisch online gesichert. Mit dem Sicherungscode holst du sie auf einem anderen Gerät zurück. Behandle ihn wie ein Passwort und gib ihn nicht weiter.'),
        st.cloudStatus),
      h('div', { class: 'cloud__row' }, st.code, st.codeShow, st.codeCopy),
      h('div', { class: 'cloud__row' }, st.restoreInput, st.restoreBtn),
      st.restoreMsg);
    st.codeShow.disabled = true;
    st.codeCopy.disabled = true;

    // --- Alles auf Standard ---
    const resetRow = h('div', { class: 'setting setting--reset' },
      h('span', { class: 'setting__text' },
        h('span', { class: 'setting__label' }, 'Einstellungen zurücksetzen'),
        h('span', { class: 'setting__desc' }, 'Ton, Grafik und Anzeige gehen auf die Standardwerte. Münzen und Autos bleiben.')),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onSettingsReset') },
        icon('restart'), h('span', { class: 'btn__label' }, 'Zurücksetzen')));

    const tutorialRow = h('div', { class: 'setting setting--reset' },
      h('span', { class: 'setting__text' },
        h('span', { class: 'setting__label' }, 'Tipps wiederholen'),
        h('span', { class: 'setting__desc' }, 'Zeigt die Einsteiger-Tipps in deiner nächsten Solo-Runde noch einmal.')),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => this._call('onReplayTutorial') },
        icon('info'), h('span', { class: 'btn__label' }, 'Tipps zeigen')));

    // --- Reiter: eine Sache pro Seite statt einer langen Liste ---
    const panelOf = (...content) => h('div', { class: 'settings-panel', role: 'tabpanel' }, ...content);
    const groupEl = (id) => groups.find((g) => g.dataset.group === id);
    const wrap = (el) => h('div', { class: 'settings-group' }, el);
    const TABS = [
      { id: 'sound', label: 'Ton', content: [groupEl('sound')] },
      { id: 'graphics', label: 'Grafik', content: [groupEl('graphics')] },
      { id: 'game', label: 'Spiel', content: [groupEl('gameplay'), wrap(tutorialRow)] },
      { id: 'display', label: 'Anzeige', content: [groupEl('display'), groupEl('access')] },
      { id: 'controls', label: 'Steuerung', content: [wrap(controls)] },
      { id: 'account', label: 'Konto', content: [wrap(nameRow), wrap(cloudRow), wrap(resetRow)] },
    ];
    st.tabs = TABS.map((t) => {
      const btn = h('button', {
        type: 'button', class: 'tab', role: 'tab', id: `lr-set-tab-${t.id}`, 'aria-selected': 'false', tabindex: '-1',
        'aria-controls': `lr-set-panel-${t.id}`, onClick: () => this._selectSettingsTab(t.id),
      }, t.label);
      const panel = panelOf(...t.content);
      panel.id = `lr-set-panel-${t.id}`;
      panel.setAttribute('aria-labelledby', btn.id);
      panel.hidden = true;
      return { id: t.id, btn, panel };
    });
    const tablist = h('div', { class: 'tabs tabs--settings', role: 'tablist', 'aria-label': 'Einstellungen' }, st.tabs.map((t) => t.btn));
    tablist.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const btns = st.tabs.map((t) => t.btn);
      let i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft') i = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'ArrowRight') i = (i + 1) % btns.length;
      else if (e.key === 'Home') i = 0;
      else i = btns.length - 1;
      btns[i].focus();
      btns[i].click();
    });

    st.body = h('div', { class: 'sheet__body' }, st.tabs.map((t) => t.panel),
      h('p', { class: 'version' }, `Lane Racer ${VERSION} · three.js · Supabase`));
    this._sheet('settings', { kicker: 'Optionen', title: 'Einstellungen' }, tablist, st.body);
    st.active = '';
    this.st = st;
    this._selectSettingsTab(this._settingsTab || 'sound');
  }

  // =========================================================================
  // Aufbau: Rundenende
  // =========================================================================
  _buildGameOver() {
    const g = {};
    g.tag = h('span', { class: 'tag tag--danger' }, 'Crash');
    g.title = h('h2', { class: 'go__title', id: 'lr-go-title', tabindex: '-1' }, 'Runde vorbei');
    this.focusTargets.gameover = g.title;

    g.dist = new Digits('go__num');
    g.record = h('div', { class: 'go__record', hidden: true }, icon('trophy'), h('span', null, 'Neuer Rekord!'));
    g.best = h('span', { class: 'go__best' });
    g.rankText = h('span', { class: 'go__rank-text' });
    g.rank = h('span', { class: 'go__rank', hidden: true }, h('span', { class: 'spinner spinner--sm', 'aria-hidden': 'true' }), g.rankText);

    // Münz-Aufschlüsselung
    g.rows = BREAKDOWN_ROWS.map(([key, label, always]) => {
      const digits = new Digits('go-row__num');
      const el = h('div', { class: 'go-row' },
        h('dt', { class: 'go-row__label' }, label),
        h('dd', { class: 'go-row__value' }, '+', digits.el));
      return { key, label, always, digits, el };
    });
    g.total = new Digits('go-total__num');
    g.totalBox = h('div', { class: 'go-total' },
      h('span', { class: 'go-total__label' }, 'Summe'),
      h('span', { class: 'go-total__value' }, coinIcon(), g.total.el));
    g.coins = h('section', { class: 'go__coins', 'aria-labelledby': 'lr-go-coins', title: 'Klicken zum Überspringen' },
      h('h3', { class: 'section-title', id: 'lr-go-coins' }, coinIcon(), 'Münzen'),
      h('dl', { class: 'go-rows' }, g.rows.map((r) => r.el)),
      g.totalBox);
    g.coins.addEventListener('click', () => { if (this._goRaf) this._finishGameOverAnim(); });

    g.missionList = h('ul', { class: 'go-missions' });
    g.missions = h('section', { class: 'go__missions', hidden: true, 'aria-labelledby': 'lr-go-missions' },
      h('h3', { class: 'section-title', id: 'lr-go-missions' }, icon('check'), 'Mission erfüllt'), g.missionList);

    // Kampagne: Sterne, Aufgaben, Belohnung
    g.campStars = h('div', { class: 'camp-stars', 'aria-hidden': 'true' });
    g.campSummary = h('p', { class: 'camp-summary' });
    g.campList = h('ul', { class: 'camp-goals' });
    g.campReward = h('p', { class: 'camp-reward' });
    g.campXp = h('div', { class: 'camp-xp' }, h('i', { class: 'camp-xp__fill' }));
    g.camp = h('section', { class: 'go__camp', hidden: true, 'aria-labelledby': 'lr-go-camp' },
      h('h3', { class: 'section-title', id: 'lr-go-camp' }, icon('flag'), 'Kampagne'),
      g.campStars, g.campSummary, g.campList, g.campReward, g.campXp);

    g.raceList = h('ol', { class: 'results' });
    g.raceSummary = h('p', { class: 'results__summary' });
    g.race = h('section', { class: 'go__race', hidden: true, 'aria-labelledby': 'lr-go-race' },
      h('h3', { class: 'section-title', id: 'lr-go-race' }, icon('flag'), 'Rennergebnis'),
      g.raceSummary, g.raceList,
      h('div', { class: 'emote-row emote-row--sm' }, EMOTES.map((e) => this._emoteButton(e, false))));

    g.stats = {};
    const statDefs = [['overtakes', 'Überholt'], ['nearMisses', 'Beinahe'], ['smashed', 'Gerammt'], ['level', 'Level'], ['time', 'Zeit']];
    const statsRow = h('dl', { class: 'go__stats' }, statDefs.map(([key, label]) => {
      const dd = h('dd', null, '0');
      g.stats[key] = dd;
      return h('div', { class: 'go-stat' }, h('dt', null, label), dd);
    }));

    const guard = (fn) => () => { if (!g.actions.classList.contains('is-guarded')) fn(); };
    g.again = h('button', { type: 'button', class: 'btn btn--play go__again', onClick: guard(() => this._call('onRestart')) },
      icon('restart', 'btn__icon'), h('span', { class: 'btn__label' }, 'Nochmal'), chevrons());
    g.next = h('button', { type: 'button', class: 'btn btn--gold', hidden: true, onClick: guard(() => this._call('onNextMap')) },
      icon('play', 'btn__icon'), h('span', { class: 'btn__label' }, 'Nächste Karte'));
    g.challenge = h('button', { type: 'button', class: 'btn btn--ghost', onClick: guard(() => this._call('onChallenge')) },
      icon('flag'), h('span', { class: 'btn__label' }, 'Herausfordern'));
    g.actions = h('div', { class: 'go__actions' },
      g.again,
      g.next,
      h('button', { type: 'button', class: 'btn btn--ghost', onClick: guard(() => this._call('onOpenGarage')) },
        icon('car'), h('span', { class: 'btn__label' }, 'Garage')),
      g.challenge,
      h('button', { type: 'button', class: 'btn btn--ghost', onClick: guard(() => this._call('onToMenu')) },
        icon('menu'), h('span', { class: 'btn__label' }, 'Menü')));

    g.scroll = h('div', { class: 'go__scroll' },
      h('div', { class: 'go__hero' },
        h('div', { class: 'go__distance', 'aria-live': 'off' }, g.dist.el, h('span', { class: 'go__unit' }, 'm')),
        g.record,
        h('div', { class: 'go__meta' }, g.best, g.rank)),
      h('div', { class: 'go__cols' }, g.coins, h('div', { class: 'go__side' }, g.camp, g.race, g.missions)),
      statsRow);

    const card = h('div', { class: 'go' },
      checker('go__checker'),
      h('header', { class: 'go__band' }, g.tag, g.title),
      g.scroll,
      g.actions);
    const sec = this._screen('gameover', card);
    sec.setAttribute('aria-labelledby', 'lr-go-title');
    this.go = g;
  }

  _renderGoCampaign(camp) {
    const g = this.go;
    g.camp.hidden = !camp;
    g.next.hidden = !(camp && camp.next);
    if (!camp) return;
    const ev = camp.evaluation;
    g.campStars.textContent = '';
    for (let i = 1; i <= 3; i++) g.campStars.append(h('span', { class: `camp-star${i <= ev.stars ? ' is-on' : ''}` }, '★'));
    const nu = camp.reward.newStars;
    g.campSummary.textContent = ev.finished
      ? (nu > 0 ? `${nu === 1 ? 'Neuer Stern' : `${nu} neue Sterne`}!` : 'Geschafft – keine neuen Sterne.')
      : 'Ziel nicht erreicht. Beim nächsten Mal klappt es!';
    g.campList.textContent = '';
    for (const goal of ev.goals) {
      g.campList.append(h('li', { class: goal.done ? 'is-done' : '' },
        h('span', { class: 'camp-goals__tick' }, goal.done ? '✓' : '✗'),
        h('span', { class: 'camp-goals__text' }, cleanText(goal.label, 60)),
        goal.type === 'finish' ? null : h('b', null, `${fmtInt(goal.value)}/${fmtInt(goal.target)}`)));
    }
    const parts = [];
    if (camp.reward.coins > 0) parts.push(`+${fmtInt(camp.reward.coins)} Münzen für neue Sterne`);
    if (camp.reward.xp > 0) parts.push(`+${fmtInt(camp.reward.xp)} XP`);
    for (const l of camp.reward.levelUps || []) parts.push(`Fahrerstufe ${l}!`);
    g.campReward.textContent = parts.join(' · ');
    g.campXp.firstChild.style.transform = `scaleX(${clamp01(num(camp.level && camp.level.frac)).toFixed(3)})`;
    g.campXp.title = camp.level ? `Stufe ${camp.level.level}: ${fmtInt(camp.level.into)} / ${fmtInt(camp.level.need)} XP` : '';
    if (camp.next) g.next.querySelector('.btn__label').textContent = `Nächste: ${cleanText(camp.next.name, 22)}`;
  }

  _renderGoMeta() {
    const g = this.go;
    const d = this.goData || {};
    g.record.hidden = !d.isRecord;
    const best = Math.floor(num(d.best));
    g.best.textContent = d.isRecord ? 'Weiter als je zuvor!' : best > 0 ? `Rekord: ${fmtDist(best)}` : '';
    g.best.hidden = !g.best.textContent;

    const rank = Math.floor(num(d.rank));
    let text = '';
    let state = '';
    if (rank > 0) {
      text = rank === 1 ? 'Platz 1 weltweit – du bist die Nummer eins!' : `Platz ${fmtInt(rank)} weltweit`;
      state = rank <= 10 ? 'top' : 'ok';
    } else if (d.online === 'pending') {
      text = 'Rangliste wird abgefragt …';
      state = 'pending';
    } else if (d.online === 'practice') {
      text = 'Übungsrunde – zählt nicht für Rekord und Rangliste';
      state = 'off';
    } else if (d.online === 'offline') {
      text = 'Offline – nur lokal gespeichert';
      state = 'off';
    } else if (d.online === 'error') {
      text = 'Rangliste gerade nicht erreichbar';
      state = 'off';
    }
    g.rank.hidden = !text;
    g.rank.dataset.state = state;
    g.rankText.textContent = text;
  }

  _renderGoMissions() {
    const g = this.go;
    const list = Array.isArray(this.goData && this.goData.completed) ? this.goData.completed.filter(Boolean) : [];
    g.missions.hidden = !list.length;
    g.missionList.textContent = '';
    for (const m of list.slice(0, 6)) {
      g.missionList.append(h('li', { class: 'go-mission' },
        icon('check', 'go-mission__icon'),
        h('span', { class: 'go-mission__text' }, cleanText(m.text, 120)),
        h('span', { class: 'go-mission__reward' }, coinIcon(), `+${fmtInt(m.reward)}`)));
    }
  }

  _renderGoStats() {
    const g = this.go;
    const s = (this.goData && this.goData.stats) || {};
    g.stats.overtakes.textContent = fmtInt(s.overtakes);
    g.stats.nearMisses.textContent = fmtInt(s.nearMisses);
    g.stats.smashed.textContent = fmtInt(s.smashed);
    g.stats.level.textContent = String(Math.max(1, Math.floor(num(s.level))));
    g.stats.time.textContent = fmtTime(s.time);
  }

  _renderGoRace() {
    const g = this.go;
    const race = this.goData && this.goData.race;
    g.race.hidden = !race;
    if (!race) return;
    const info = this._renderResults(g.raceList, race.results);
    g.raceSummary.textContent = info.running
      ? 'Die anderen fahren noch – Ergebnisse kommen live rein.'
      : info.myPlace ? `Du bist Platz ${info.myPlace} von ${info.count}!` : '';
    g.raceSummary.classList.toggle('is-win', info.myPlace === 1 && info.count > 1);
  }

  _goTotals() {
    const d = this.goData || {};
    const bd = (d.coins && d.coins.breakdown) || {};
    let total = num(d.coins && d.coins.total);
    if (!total) total = BREAKDOWN_ROWS.reduce((sum, [key]) => sum + num(bd[key]), 0);
    return { bd, total, dist: num(d.distance) };
  }

  _applyGameOverFinal() {
    const g = this.go;
    const { bd, total, dist } = this._goTotals();
    g.dist.set(dist);
    for (const row of g.rows) {
      row.digits.set(bd[row.key]);
      row.el.classList.add('is-in');
    }
    g.total.set(total);
    g.totalBox.classList.add('is-in', 'is-landed');
  }

  _finishGameOverAnim() {
    if (!this._goRaf) return;
    cancelAnimationFrame(this._goRaf);
    this._goRaf = 0;
    this._applyGameOverFinal();
  }

  /** Zeitleiste: Strecke zählt hoch, dann jede Münzzeile nacheinander, zuletzt die Summe. */
  _startGameOverAnim() {
    const g = this.go;
    const rows = g.rows.filter((r) => !r.el.hidden);
    for (const row of g.rows) row.el.classList.remove('is-in');
    g.totalBox.classList.remove('is-in', 'is-landed');
    if (this.reducedMotion || typeof requestAnimationFrame !== 'function') {
      this._applyGameOverFinal();
      return;
    }
    g.dist.set(0);
    for (const row of g.rows) row.digits.set(0);
    g.total.set(0);

    const DIST_DUR = 800;
    const ROW_START = 520;
    const ROW_GAP = 230;
    const ROW_DUR = 420;
    const TOTAL_DUR = 750;
    const totalStart = ROW_START + Math.max(0, rows.length - 1) * ROW_GAP + ROW_DUR;
    const t0 = performance.now();
    const landed = new Array(rows.length).fill(false);
    const step = (now) => {
      const t = now - t0;
      const { bd, total, dist } = this._goTotals();
      g.dist.set(dist * easeOut(clamp01(t / DIST_DUR)));
      rows.forEach((row, i) => {
        const start = ROW_START + i * ROW_GAP;
        if (t < start) return;
        if (!row.el.classList.contains('is-in')) row.el.classList.add('is-in');
        const p = clamp01((t - start) / ROW_DUR);
        const value = num(bd[row.key]);
        row.digits.set(value * easeOut(p));
        if (p >= 1 && !landed[i]) {
          landed[i] = true;
          if (value > 0) this._call('onUiSound', 'coin');
        }
      });
      if (t >= totalStart) {
        if (!g.totalBox.classList.contains('is-in')) g.totalBox.classList.add('is-in');
        g.total.set(total * easeOut(clamp01((t - totalStart) / TOTAL_DUR)));
      }
      if (t < totalStart + TOTAL_DUR) {
        this._goRaf = requestAnimationFrame(step);
      } else {
        this._goRaf = 0;
        this._applyGameOverFinal();
      }
    };
    this._goRaf = requestAnimationFrame(step);
  }

  // =========================================================================
  // Aufbau: obere Leiste
  // =========================================================================
  _buildTopBar() {
    const tb = {};
    tb.nameText = h('span', { class: 'chip__text' }, 'Gast');
    tb.nameBtn = h('button', { type: 'button', class: 'chip chip--name', 'aria-label': 'Fahrername ändern', onClick: () => this._call('onRename') },
      icon('user'), tb.nameText, icon('pencil', 'chip__edit'));
    tb.netText = h('span', { class: 'chip__text' }, NET_LABEL.connecting);
    tb.net = h('span', { class: 'chip chip--net', 'data-status': 'connecting', role: 'status' },
      h('i', { class: 'net-dot', 'aria-hidden': 'true' }), tb.netText);
    tb.partyCode = h('span', { class: 'chip__code' });
    tb.partyCount = h('span', { class: 'chip__count' }, '1');
    tb.partyBtn = h('button', { type: 'button', class: 'chip chip--party', hidden: true, onClick: () => this._call('onOpenParty') },
      icon('users'), tb.partyCode, tb.partyCount);
    tb.coins = new Digits('coins__num');
    tb.coinsDelta = h('span', { class: 'coins__delta', 'aria-hidden': 'true' });
    tb.coinsWrap = h('div', { class: 'coins', role: 'img', 'aria-label': '0 Münzen', title: 'Deine Münzen' },
      coinIcon(), tb.coins.el, tb.coinsDelta);
    tb.coins.set(0);
    this.topbar = h('header', { class: 'topbar', hidden: true },
      h('div', { class: 'topbar__bug', 'aria-hidden': 'true' }, h('span', { class: 'bug__lane' }, 'Lane'), h('span', { class: 'bug__racer' }, 'Racer')),
      h('div', { class: 'topbar__chips' }, tb.nameBtn, tb.net, tb.partyBtn),
      tb.coinsWrap);
    this.root.append(this.topbar);
    this.tb = tb;
  }

  // =========================================================================
  // Aufbau: Overlays (Popups, Emotes, Countdown, Blitz, Toasts)
  // =========================================================================
  _buildOverlays() {
    // Popups: kleiner Pool, der reihum wiederverwendet wird
    const pool = [];
    const popups = h('div', { class: 'popups', 'aria-hidden': 'true' });
    for (let i = 0; i < 6; i++) {
      const pop = h('span', { class: 'pop' });
      const wrap = h('div', { class: 'pop-slot', hidden: true }, pop);
      popups.append(wrap);
      pool.push({ wrap, pop, anim: null, timer: 0 });
    }
    this.pp = { pool, next: 0, stack: 0, lastAt: 0 };

    this.emoteBox = h('div', { class: 'emotes' });

    const cdNum = h('span', { class: 'countdown__num' });
    const cdRing = h('span', { class: 'countdown__ring', 'aria-hidden': 'true' });
    const cdEl = h('div', { class: 'countdown', hidden: true, role: 'status', 'aria-live': 'assertive' },
      h('span', { class: 'countdown__band', 'aria-hidden': 'true' }, checker('countdown__checker')), cdRing, cdNum);
    this.cd = { el: cdEl, num: cdNum, ring: cdRing, token: 0, numAnim: null, ringAnim: null };

    this.fl = h('div', { class: 'flash', 'aria-hidden': 'true' });
    this.toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

    this.root.append(popups, this.emoteBox, cdEl, this.fl, this.toastBox);
  }

  _dismissToast(el) {
    if (!el.isConnected || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), this.reducedMotion ? 0 : 300);
  }

  // =========================================================================
  // Aufbau: Pause
  // =========================================================================
  _buildPause() {
    const pz = {};
    const change = (partial) => this._call('onSettingsChange', partial);
    const toggle = (id, label, key) => {
      const input = h('input', { id, type: 'checkbox', role: 'switch', class: 'switch' });
      input.addEventListener('change', () => change({ [key]: input.checked }));
      return { input, row: h('label', { class: 'pause__toggle', for: id }, h('span', null, label), input) };
    };
    const music = toggle('lr-pause-music', 'Musik', 'music');
    const sfx = toggle('lr-pause-sfx', 'Sound', 'sfx');
    pz.music = music.input;
    pz.sfx = sfx.input;
    pz.resume = h('button', { type: 'button', class: 'btn btn--play btn--block', onClick: () => this._call('onResume') },
      icon('play', 'btn__icon'), h('span', { class: 'btn__label' }, 'Weiter'), chevrons());
    const card = h('div', { class: 'pause__card' },
      checker('pause__checker'),
      h('h2', { class: 'pause__title', id: 'lr-pause-title' }, 'Pause'),
      h('p', { class: 'pause__hint' }, 'Kurz durchatmen.', h('span', { class: 'pause__keys' }, ' Weiter mit ', h('kbd', null, 'P'), ' oder ', h('kbd', null, 'Esc'))),
      h('div', { class: 'pause__actions' },
        pz.resume,
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => this._call('onPauseSettings') },
          icon('sliders'), h('span', { class: 'btn__label' }, 'Einstellungen')),
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => this._call('onRestart') },
          icon('restart'), h('span', { class: 'btn__label' }, 'Neustart')),
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => this._call('onToMenu') },
          icon('menu'), h('span', { class: 'btn__label' }, 'Zum Menü'))),
      h('div', { class: 'pause__toggles' }, music.row, sfx.row));
    pz.el = h('div', { class: 'pause', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lr-pause-title' },
      h('div', { class: 'pause__backdrop', 'aria-hidden': 'true' }), card);
    pz.el.addEventListener('keydown', (e) => { if (e.key === 'Tab') this._trapFocus(card, e); });
    this.root.append(pz.el);
    this.pz = pz;
  }

  // =========================================================================
  // Aufbau: Namensdialog
  // =========================================================================
  _buildNameDialog() {
    const m = { mode: 'first', busy: false, busyTimer: 0, prevFocus: null };
    m.title = h('h2', { class: 'modal__title', id: 'lr-name-title' }, 'Wie heißt du, Fahrer?');
    m.lead = h('p', { class: 'modal__lead', id: 'lr-name-lead' });
    m.input = h('input', {
      id: 'lr-name-input', class: 'field__input field__input--name', type: 'text', maxlength: '16', minlength: '2',
      autocomplete: 'nickname', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', required: true,
      'aria-describedby': 'lr-name-hint lr-name-error', placeholder: 'Dein Name',
    });
    m.count = h('span', { class: 'field__count', 'aria-hidden': 'true' }, '0/16');
    m.error = h('p', { class: 'field__error', id: 'lr-name-error', role: 'alert' });
    m.cancel = h('button', { type: 'button', class: 'btn btn--ghost', hidden: true, onClick: () => this.closeName() },
      h('span', { class: 'btn__label' }, 'Abbrechen'));
    m.submitLabel = h('span', { class: 'btn__label' }, 'Los geht’s');
    m.submit = h('button', { type: 'submit', class: 'btn btn--play' }, m.submitLabel, chevrons());
    m.card = h('form', { class: 'modal__card', novalidate: true, 'aria-labelledby': 'lr-name-title', 'aria-describedby': 'lr-name-lead' },
      checker('modal__checker'),
      h('span', { class: 'modal__kicker' }, icon('user'), 'Fahrerlizenz'),
      m.title, m.lead,
      h('label', { class: 'field__label', for: 'lr-name-input' }, 'Fahrername'),
      m.input,
      h('div', { class: 'field__foot' }, h('span', { class: 'field__hint', id: 'lr-name-hint' }, '2–16 Zeichen'), m.count),
      m.error,
      h('div', { class: 'modal__actions' }, m.cancel, m.submit));
    m.el = h('div', { class: 'modal', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lr-name-title' },
      h('div', { class: 'modal__backdrop', 'aria-hidden': 'true' }), m.card);

    m.input.addEventListener('input', () => {
      this._updateNameCount();
      if (m.error.textContent) this._setNameError('');
    });
    m.card.addEventListener('submit', (e) => {
      e.preventDefault();
      if (m.busy) return;
      const name = cleanName(m.input.value, 32);
      const err = nameError(name);
      if (err) {
        this._setNameError(err);
        this._call('onUiSound', 'error');
        m.input.focus();
        return;
      }
      m.input.value = name;
      this._setNameBusy(true);
      this._call('onSubmitName', name);
    });
    // Tastatur im Dialog gehört dem Dialog: Escape schließt (nur beim Umbenennen),
    // Tab bleibt im Dialog, nichts davon erreicht die Spielsteuerung in main.js.
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (m.mode === 'rename') this.closeName();
      } else if (e.key === 'Tab') {
        this._trapFocus(m.card, e);
      }
      e.stopPropagation();
    });
    this.root.append(m.el);
    this.nm = m;
  }

  _updateNameCount() {
    const m = this.nm;
    const len = Array.from(m.input.value).length;
    m.count.textContent = `${len}/16`;
    m.count.classList.toggle('is-over', len > 16);
  }

  _setNameError(text) {
    const m = this.nm;
    m.error.textContent = text;
    m.error.hidden = !text;
    m.input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  _setNameBusy(busy) {
    const m = this.nm;
    m.busy = busy;
    m.submit.disabled = busy;
    m.card.classList.toggle('is-busy', busy);
    clearTimeout(m.busyTimer);
    // Sicherheitsnetz: falls main.js nie antwortet, nach 10 s wieder freigeben
    if (busy) m.busyTimer = setTimeout(() => this._setNameBusy(false), 10000);
  }

  // =========================================================================
  // Aufbau: Fatale Fehler
  // =========================================================================
  _buildFatal() {
    const f = {};
    f.title = h('h2', { class: 'fatal__title', id: 'lr-fatal-title' }, 'Hoppla');
    f.text = h('p', { class: 'fatal__text', id: 'lr-fatal-text' });
    f.reload = h('button', { type: 'button', class: 'btn btn--play', onClick: () => location.reload() },
      icon('restart', 'btn__icon'), h('span', { class: 'btn__label' }, 'Neu laden'));
    f.el = h('div', { class: 'fatal', hidden: true, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'lr-fatal-title', 'aria-describedby': 'lr-fatal-text' },
      h('div', { class: 'fatal__card' }, checker('fatal__checker'), icon('alert', 'fatal__icon'), f.title, f.text, f.reload));
    this.root.append(f.el);
    this.ft = f;
  }
}
