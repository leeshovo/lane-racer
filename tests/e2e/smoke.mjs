// Rauchtest im echten Browser: Menü, Einstellungen, eine kurze Fahrt mit Tipps, Missionen, Garage, Rangliste.
//
//   npm run test:e2e
//
// Braucht Google Chrome (oder Edge). Auf GitHub ist Chrome vorinstalliert. Die Supabase-Anfragen werden
// abgefangen: Der Test läuft komplett offline gegen die Spieldateien und schreibt nichts in die Datenbank.
// Die Bibliotheken (three.js) kommen vom CDN – der Test braucht also Internet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { RESET_EPOCH } from '../../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('nicht gefunden');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${message}`);
  }
}

async function launch() {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true, args });
    } catch (err) {
      console.log(`(${channel} nicht gefunden: ${String(err.message).split('\n')[0]})`);
    }
  }
  throw new Error('Weder Chrome noch Edge gefunden – bitte installieren.');
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await launch();

try {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  // Erste Runde: Einsteiger-Tipps aktiv; Ton aus (kein Krach beim Testen)
  await context.addInitScript((epoch) => {
    if (!localStorage.getItem('laneRacer2.profile')) {
      localStorage.setItem('laneRacer2.profile', JSON.stringify({ epoch, name: 'Tester', tutorialDone: false, settings: { music: false, sfx: false, quality: 'low' } }));
    }
  }, RESET_EPOCH);
  await context.route(/supabase\.co/, (route) => route.abort());
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (err) => problems.push(`Seitenfehler: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/supabase|ERR_FAILED|Failed to load resource|favicon/i.test(text)) return; // gesperrte Online-Anfragen sind gewollt
    problems.push(`Konsole: ${text}`);
  });

  console.log('Start');
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.laneRacer && window.laneRacer.game, null, { timeout: 60000 });
  check(true, 'Spiel lädt und startet');
  const version = await page.evaluate(() => window.laneRacer.VERSION);
  check(/^\d+\.\d+\.\d+$/.test(version), `Version ${version}`);

  const clickText = async (pattern) => {
    const ok = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const btn = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent) && b.offsetParent !== null);
      if (btn) btn.click();
      return Boolean(btn);
    }, pattern);
    return ok;
  };
  const screen = () => page.evaluate(() => window.laneRacer.app.screen);

  console.log('Einstellungen');
  check(await clickText('^\\s*einstellungen'), 'Einstellungen öffnen');
  await page.waitForFunction(() => window.laneRacer.app.screen === 'settings');
  const rows = await page.evaluate(() => document.querySelectorAll('.setting').length);
  check(rows >= 25, `${rows} Einstellungs-Zeilen`);
  await page.evaluate(() => { document.getElementById('lr-set-fps').click(); });
  check(await page.evaluate(() => window.laneRacer.profile.settings.fps === true), 'Schalter wirkt (Bildrate anzeigen)');
  await page.evaluate(() => { document.getElementById('lr-set-fps').click(); });
  check(await page.evaluate(() => Array.from(document.querySelectorAll('[data-group]')).map((g) => g.dataset.group).join()) === 'sound,graphics,gameplay,display,access', 'alle Gruppen vorhanden');
  await page.evaluate(() => [...document.querySelectorAll('[data-group="access"] .seg__btn')].find((b) => /groß/i.test(b.textContent) && !/sehr/i.test(b.textContent)).click());
  check(await page.evaluate(() => document.documentElement.classList.contains('text-large')), 'Textgröße "Groß" wirkt');
  await page.evaluate(() => [...document.querySelectorAll('[data-group="access"] .seg__btn')].find((b) => /^normal$/i.test(b.textContent.trim())).click());
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabs--settings .tab')].map((t) => t.textContent.trim()).join());
  check(tabs === 'Ton,Grafik,Spiel,Anzeige,Steuerung,Konto', `Einstellungs-Reiter: ${tabs}`);
  await page.evaluate(() => document.getElementById('lr-set-tab-graphics').click());
  check(await page.evaluate(() => document.getElementById('lr-set-panel-graphics').hidden === false && document.getElementById('lr-set-panel-sound').hidden === true), 'Reiter Grafik zeigt nur die Grafik-Einstellungen');
  await clickText('^\\s*zurück');
  await page.waitForFunction(() => window.laneRacer.app.screen === 'menu');

  console.log('Fahrt');
  check(await page.evaluate(() => /ranked fahren/i.test(document.querySelector('.btn--play')?.textContent || '')), 'Großer Knopf wirbt für Ranked ("Ranked fahren")');
  // Ranked braucht eine Verbindung; dieser Test läuft komplett offline, also über den kleinen "Nur so fahren"-Knopf
  check(await clickText('^\\s*nur so fahren'), '"Nur so fahren" drücken (Ranked braucht online)');
  await page.waitForFunction(() => window.laneRacer.game.state === 'playing', null, { timeout: 90000 });
  check(true, 'Countdown vorbei, Runde läuft');
  await page.waitForFunction(() => window.laneRacer.game.distance > 60, null, { timeout: 90000 });
  check(true, 'Auto fährt (Strecke wächst)');
  const tip = await page.evaluate(() => { const t = document.querySelector('.tip'); return t && !t.hidden ? t.textContent : ''; });
  check(/Spur/.test(tip), `Einsteiger-Tipp sichtbar: "${tip.slice(0, 50)}"`);
  const toastsBefore = await page.evaluate(() => document.querySelectorAll('.toast').length);
  await page.evaluate(() => { window.laneRacer.ui.toast('Level 9', 'Test', 'level'); window.laneRacer.ui.popup('KNAPP', 'near'); });
  check(await page.evaluate((n) => document.querySelectorAll('.toast').length === n, toastsBefore), 'Im Spiel keine Level-Meldung (Hinweise: Wenige)');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('p');
  check(await page.evaluate(() => window.laneRacer.app.paused === true), 'Pause mit P');
  check(await page.evaluate(() => !document.querySelector('.pause').hidden), 'Pause-Fenster sichtbar');
  await page.evaluate(() => [...document.querySelectorAll('.pause button')].find((b) => /einstellungen/i.test(b.textContent)).click());
  check(await page.evaluate(() => window.laneRacer.app.screen === 'settings' && window.laneRacer.app.paused), 'Einstellungen aus der Pause öffnen (Spiel bleibt pausiert)');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.laneRacer.app.screen === 'hud' && !document.querySelector('.pause').hidden), 'Esc führt zurück zur Pause');
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.laneRacer.app.resumeAt > 0);
  check(await page.evaluate(() => window.laneRacer.app.paused === true), 'Nach "Weiter" zählt es erst rückwärts (Spiel steht noch)');
  await page.waitForFunction(() => window.laneRacer.app.paused === false, null, { timeout: 30000 });
  check(true, 'Nach 3 Sekunden geht es weiter');
  // Runde beenden: gegen Verkehr rasen lassen
  await page.evaluate(() => { window.laneRacer.game.setGas(true); });
  await page.waitForFunction(() => ['crashed', 'over'].includes(window.laneRacer.game.state), null, { timeout: 90000 }).catch(() => {});
  const ended = await page.evaluate(() => ['crashed', 'over'].includes(window.laneRacer.game.state));
  check(ended, 'Runde endet nach einem Crash');
  await page.waitForFunction(() => window.laneRacer.app.screen === 'gameover', null, { timeout: 60000 }).catch(() => {});
  check((await screen()) === 'gameover', 'Game-Over-Bildschirm');
  check(await page.evaluate(() => window.laneRacer.profile.stats.runs >= 1), 'Runde wurde im Spielstand gezählt');
  check(await page.evaluate(() => window.laneRacer.profile.achievements.first_run === true), 'Erfolg "Erste Fahrt" freigeschaltet');
  await clickText('menü|men');
  await page.waitForFunction(() => window.laneRacer.app.screen === 'menu', null, { timeout: 5000 }).catch(() => {});

  for (const [label, pattern, name] of [['Missionen', '^\\s*missionen', 'missions'], ['Garage', '^\\s*garage', 'garage'], ['Rangliste', '^\\s*rangliste', 'leaderboard']]) {
    console.log(label);
    if ((await screen()) !== 'menu') await page.evaluate(() => window.laneRacer.ui.cb.onToMenu());
    await page.waitForFunction(() => window.laneRacer.app.screen === 'menu');
    check(await clickText(pattern), `${label} öffnen`);
    await page.waitForFunction((n) => window.laneRacer.app.screen === n, name, { timeout: 5000 }).catch(() => {});
    check((await screen()) === name, `${label}-Bildschirm sichtbar`);
    if (name === 'missions') check(await page.evaluate(() => document.querySelectorAll('.ach').length >= 15), 'Erfolgsliste gefüllt');
    if (name === 'garage') check(await page.evaluate(async () => { const cfg = await import('/js/config.js'); const cars = await import('/js/cars.js'); return cfg.CARS.every((c) => { const v = cars.createPlayerCar(c.id, c.colors[0]); return v && v.object && v.object.children.length > 0; }); }), 'jedes Auto lässt sich bauen');
    if (name === 'garage') check(await page.evaluate(() => document.querySelectorAll('.car').length === 14), '14 Autos in der Garage (13 kaufbar + Wochenpreis)');
    if (name === 'garage') check(await page.evaluate(() => document.querySelectorAll('.car .tune__row').length === 14 * 3), 'Tuning-Zeilen in jeder Garagenkarte');
    if (name === 'leaderboard') check(await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()).includes('Ranked')), 'Tab "Ranked" vorhanden');
    if (name === 'leaderboard') check(await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()).includes('Freunde')), 'Tab "Freunde" vorhanden');
  }

  console.log('Welten');
  const overlaps = await page.evaluate(async () => {
    const L = window.laneRacer; const T = await import('three'); const m = new T.Matrix4(); const bb = new T.Box3(); const bad = [];
    for (let w = 0; w < 5; w++) {
      L.world.setWorld(w, true);
      for (let i = 0; i < 40; i++) L.world.update(0.016, { speed: 60, distance: i * 40, camera: L.camera });
      for (const [key, pool] of L.world.pools) {
        const mesh = pool.mesh; if (!mesh.visible || /arch|gantry/.test(key)) continue;
        mesh.geometry.computeBoundingBox();
        for (let i = 0; i < pool.capacity; i++) {
          mesh.getMatrixAt(i, m); if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue;
          bb.copy(mesh.geometry.boundingBox).applyMatrix4(m);
          const inner = (bb.min.x <= 0 && bb.max.x >= 0) ? 0 : Math.min(Math.abs(bb.min.x), Math.abs(bb.max.x));
          if (inner < 8.5) bad.push(key);
        }
      }
    }
    return bad;
  });
  check(overlaps.length === 0, `keine Häuser, Lava, Eis oder Felsen auf der Straße (${overlaps.length} gefunden${overlaps.length ? ': ' + [...new Set(overlaps)].join(', ') : ''})`);

  console.log('Kampagne');
  if ((await screen()) !== 'menu') await page.evaluate(() => window.laneRacer.ui.cb.onToMenu());
  await page.waitForFunction(() => window.laneRacer.app.screen === 'menu');
  check(await clickText('^\\s*kampagne'), 'Kampagne öffnen');
  await page.waitForFunction(() => window.laneRacer.app.screen === 'campaign', null, { timeout: 5000 }).catch(() => {});
  const cmaps = await page.evaluate(() => ({ all: document.querySelectorAll('.cmap').length, open: document.querySelectorAll('button.cmap').length }));
  check(cmaps.all === 20 && cmaps.open === 1, `20 Karten, nur die erste offen (${cmaps.all}/${cmaps.open})`);
  await page.evaluate(() => document.querySelector('button.cmap').click());
  await page.waitForFunction(() => window.laneRacer.game.state === 'playing', null, { timeout: 90000 });
  check(await page.evaluate(() => !document.querySelector('.hud-goal').hidden), 'Ziel-Anzeige im HUD');
  // Ziel fast erreicht: Verkehr wegschieben und das letzte Stück fahren lassen
  await page.evaluate(() => { window.laneRacer.game.distance = 1190; });
  await page.waitForFunction(() => {
    for (const e of window.laneRacer.game.enemies) e.object.position.z = -500;
    return window.laneRacer.game.state === 'over' || window.laneRacer.app.screen === 'gameover';
  }, null, { timeout: 90000, polling: 50 });
  await page.waitForFunction(() => window.laneRacer.app.screen === 'gameover', null, { timeout: 30000 }).catch(() => {});
  check(await page.evaluate(() => (window.laneRacer.profile.campaign.stars.w1m1 || 0) >= 1), 'Karte 1-1 geschafft: mindestens 1 Stern gespeichert');
  check(await page.evaluate(() => !document.querySelector('.go__camp').hidden && document.querySelectorAll('.camp-star.is-on').length >= 1), 'Ergebnis zeigt Sterne');
  check(await page.evaluate(() => !document.querySelector('.go__actions .btn--gold').hidden), '"Nächste Karte" erscheint (Karte 2 ist frei)');

  check(problems.length === 0, problems.length ? `keine Fehler in der Konsole:\n      ${problems.join('\n      ')}` : 'keine Fehler in der Konsole');
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.log(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlles in Ordnung.');
