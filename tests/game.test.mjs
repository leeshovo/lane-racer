// Tests für die Spiellogik (game.js) – laufen ohne Browser und ohne Grafik.
// Ausführen: npm install && npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../js/game.js';
import { CONFIG, LANE_X, CARS, TRAFFIC } from '../js/config.js';

const DT = 1 / 60;
const noop = () => {};
const effects = { setShield: noop, sparks: noop, coinBurst: noop, explosion: noop, shieldBreak: noop, pickupFlash: noop };
const audio = { play: noop };

function makeGame(events = {}, carId = 'blitz') {
  const game = new Game({ scene: new THREE.Scene(), effects, audio, events });
  game.setPlayerCar(carId, CARS.find((c) => c.id === carId).colors[0]);
  return game;
}

// ---------------------------------------------------------------------------
// Einfacher Bot: wählt die freieste Spur, bremst bei Enge, zündet Nitro in Not
// ---------------------------------------------------------------------------
const laneOf = (x) => Math.round((x + 4) / 4);
function gaps(game) {
  const g = [Infinity, Infinity, Infinity];
  for (const e of game.enemies) {
    const p = e.object.position;
    if (p.z - e.size.z / 2 > 2.3) continue;
    const l = laneOf(p.x);
    g[l] = Math.min(g[l], -2.3 - (p.z + e.size.z / 2));
  }
  return g;
}
function bot(game, { nitro = true } = {}) {
  const rel = game.player.speed - game.baseSpeed * CONFIG.trafficFactor;
  const g = gaps(game);
  const c = game.player.lane;
  game.setBrake(false);
  if (g[c] > Math.max(20, rel * 1.2)) return;
  let best = c;
  let bestGap = g[c];
  for (const d of [-1, 1]) {
    const n = c + d;
    if (n < 0 || n > 2) continue;
    if (!(g[n] > rel * 0.18 + 0.5)) continue;
    let v = g[n];
    const far = n + d;
    if (far >= 0 && far <= 2 && g[far] > v) v = Math.max(v, Math.min(g[far], g[n] + 5));
    if (v > bestGap) { best = n; bestGap = v; }
  }
  if (best !== c && Math.abs(game.player.x - LANE_X[c]) < 0.8) game.changeLane(best - c);
  if (bestGap < rel * 0.6) {
    game.setBrake(true);
    if (nitro && bestGap < rel * 0.3) game.triggerNitro();
  }
}
const run = (game, seconds, fn) => {
  for (let t = 0; t < seconds - 1e-9 && game.state !== 'over'; t += DT) { fn?.(); game.update(DT); }
};

describe('Start und Ablauf', () => {
  it('zählt herunter und startet die Fahrt', () => {
    const seen = [];
    const game = makeGame({ onCountdown: (v) => seen.push(v), onStart: () => seen.push('start') });
    game.start({ seed: 'abc', countdown: 3 });
    run(game, 3.5);
    assert.deepEqual(seen, [3, 2, 1, 'LOS!', 'start']);
    assert.equal(game.state, 'playing');
    assert.ok(game.player.speed > 0);
  });

  it('endet nach einem Crash mit vollständigem Ergebnis', () => {
    let result = null;
    const game = makeGame({ onOver: (r) => { result = r; } });
    game.start({ seed: 'crash', countdown: 0.01 });
    run(game, 60);
    assert.ok(result, 'onOver wurde aufgerufen');
    for (const key of ['distance', 'duration', 'coinsCollected', 'nearMisses', 'nearMissCoins', 'smashed', 'smashCoins', 'overtakes', 'level', 'nitroUses', 'raceId', 'isPartyRace', 'isDaily', 'car']) {
      assert.ok(key in result, `Ergebnis enthält ${key}`);
    }
    game.idle();
    assert.equal(game.state, 'idle');
    assert.equal(game.enemies.length, 0);
  });

  it('erkennt Tagesrennen und Party-Rennen am Renn-Kennzeichen', () => {
    for (const [raceId, party, daily] of [['daily-20260921', false, true], ['ABCDE-xyz1', true, false], [null, false, false]]) {
      let result = null;
      const game = makeGame({ onOver: (r) => { result = r; } });
      game.start({ seed: 's', raceId, countdown: 0.01 });
      run(game, 60);
      assert.equal(result.isPartyRace, party, `${raceId}: isPartyRace`);
      assert.equal(result.isDaily, daily, `${raceId}: isDaily`);
    }
  });
});

describe('Reproduzierbarkeit', () => {
  const trace = (seed) => {
    const game = makeGame();
    game.start({ seed, countdown: 0.01 });
    const rows = [];
    let prev = game.freeLanes;
    for (let i = 0; i < 60 * 40 && game.state !== 'over'; i++) {
      bot(game, { nitro: false });
      game.update(DT);
      if (game.freeLanes !== prev) { prev = game.freeLanes; rows.push(`${game.rowIndex}:${game.freeLanes.join('')}:${game.enemies.at(-1)?.type}`); }
    }
    return rows.join('|');
  };

  it('gleicher Seed ergibt gleichen Verkehr, anderer Seed einen anderen', () => {
    assert.equal(trace('race-42'), trace('race-42'));
    assert.notEqual(trace('race-42'), trace('race-43'));
  });
});

describe('Fairness, Ereignisse und Konvoi (Bot fährt 25 × 200 s)', () => {
  it('lässt immer einen Weg frei und stellt Belohnungen nie in Autos', () => {
    let rows = 0;
    let violations = 0;
    let overlaps = 0;
    let goldStarts = 0;
    let rushStarts = 0;
    let bosses = 0;
    let bossPassed = 0;
    let minBossGap = Infinity;
    let survived = 0;
    for (let runIndex = 0; runIndex < 25; runIndex++) {
      const game = makeGame({
        onEvent: ({ type, phase }) => { if (phase === 'start') { if (type === 'gold') goldStarts++; else rushStarts++; } },
        onBoss: () => { bossPassed++; },
      });
      game.start({ seed: `bot-${runIndex}`, countdown: 0.01 });
      let steps = 0;
      let lastBossZ = null;
      while ((game.state === 'playing' || game.state === 'countdown') && game.elapsed < 200 && steps < 60 * 260) {
        bot(game);
        const prevFree = game.freeLanes;
        game.update(DT);
        steps++;
        if (game.freeLanes !== prevFree) {
          rows++;
          if (game.freeLanes.length === 1 && !prevFree.every((f) => Math.abs(f - game.freeLanes[0]) <= 1)) violations++;
        }
        for (const e of game.enemies) {
          if (e.type === 'boss' && !e.counted) {
            e.counted = true;
            bosses++;
            // Abstand zur vorigen und nächsten Reihe (Konvoi ist 15 m lang → extra Platz nötig)
            const others = game.enemies.filter((o) => o !== e && Math.abs(o.object.position.z - e.object.position.z) < 60);
            for (const o of others) {
              const gap = Math.abs(o.object.position.z - e.object.position.z) - o.size.z / 2 - e.size.z / 2;
              minBossGap = Math.min(minBossGap, gap);
            }
          }
        }
        if (steps % 10 === 0) {
          for (const coin of game.coins) {
            if (!coin.active || coin.pulled) continue;
            for (const e of game.enemies) {
              const p = e.object.position;
              if (Math.abs(p.x - coin.x) < 1.5 && Math.abs(p.z - coin.z) < e.size.z / 2 + 0.6) overlaps++;
            }
          }
        }
      }
      if (game.state === 'playing') survived++;
    }
    assert.equal(violations, 0, 'Fairness-Verstöße');
    assert.equal(overlaps, 0, 'Münzen in Autos');
    assert.ok(goldStarts > 20, `Goldrausch kommt vor (${goldStarts})`);
    assert.ok(rushStarts > 20, `Stoßverkehr kommt vor (${rushStarts})`);
    assert.ok(bosses > 20, `Konvoi kommt vor (${bosses})`);
    assert.ok(bossPassed > 15, `Konvoi wurde überholt (${bossPassed})`);
    assert.ok(minBossGap > 8, `genug Platz um den Konvoi (kleinster Abstand ${minBossGap.toFixed(1)} m)`);
    assert.ok(survived >= 20, `Bot überlebt (${survived}/25)`);
    console.log(`   Reihen ${rows}, Goldrausch ${goldStarts}, Stoßverkehr ${rushStarts}, Konvois ${bosses} (überholt ${bossPassed}), kleinster Konvoi-Abstand ${minBossGap.toFixed(1)} m, überlebt ${survived}/25`);
  });
});

describe('Schild, Nitro und Bremse', () => {
  it('Schild fängt genau einen Treffer ab', () => {
    const game = makeGame({}, 'rancher');
    let crashes = 0;
    let broken = false;
    game.events.onCrash = () => crashes++;
    game.events.onShieldBreak = () => { broken = true; };
    game.start({ seed: 'shield', countdown: 0.01 });
    assert.equal(game.shieldActive, true, 'Rancher startet mit Schild');
    run(game, 60, () => { if (broken) return; });
    assert.ok(broken, 'Schild zerbrach');
    assert.equal(crashes, 1, 'danach normaler Crash');
    assert.ok(game.smashed >= 1);
  });

  it('Nitro macht schneller und unverwundbar, braucht aber 30 % Füllung', () => {
    const game = makeGame();
    let crashes = 0;
    game.events.onCrash = () => crashes++;
    game.start({ seed: 'nitro', countdown: 0.01 });
    run(game, 3);
    const normalMax = game.baseSpeed * CONFIG.boostFactor;
    game.nitro = 1;
    assert.equal(game.triggerNitro(), true);
    let max = 0;
    run(game, 3, () => { max = Math.max(max, game.player.speed); });
    assert.ok(max > normalMax * 1.1, `Nitro-Tempo ${max.toFixed(1)} > ${normalMax.toFixed(1)}`);
    assert.equal(crashes, 0);
    game.nitro = 0.1;
    assert.equal(game.triggerNitro(), false);
  });

  it('Bremsen hält die Untergrenze ohne Zittern', () => {
    const game = makeGame();
    game.start({ seed: 'brake', countdown: 0.01 });
    run(game, 2);
    game.setBrake(true);
    const speeds = [];
    run(game, 2, () => speeds.push(game.player.speed));
    const last = speeds.slice(-30);
    assert.ok(Math.abs(last.at(-1) - game.baseSpeed * CONFIG.brakeFactor) < 0.2);
    assert.ok(Math.max(...last) - Math.min(...last) < 0.2);
  });
});

describe('Aktive Auto-Fähigkeiten', () => {
  const startedGame = (carId, seed = 'ability') => {
    const game = makeGame({}, carId);
    game.start({ seed, countdown: 0.01 });
    run(game, 1.5);
    // freie Bahn, damit die Fähigkeit isoliert getestet wird
    for (const e of game.enemies.slice()) e.object.position.z = -400;
    return game;
  };

  it('jedes Auto hat eine Fähigkeit mit Namen, Text und Abklingzeit', () => {
    for (const car of CARS) {
      assert.ok(car.ability?.id && car.ability.name && car.ability.text, `${car.id} hat eine Fähigkeit`);
      assert.ok(car.ability.cooldown >= car.ability.duration, `${car.id}: Abklingzeit ≥ Wirkdauer`);
    }
  });

  it('Abklingzeit: erst nach Ablauf wieder nutzbar', () => {
    const game = startedGame('blitz');
    assert.equal(game.useAbility(), true);
    assert.equal(game.useAbility(), false, 'sofort erneut nicht möglich');
    assert.equal(game.hud().ability.ready, false);
    game.nextRowSpacing = 1e9;
    run(game, CARS[0].ability.cooldown + 0.5, () => { for (const e of game.enemies) e.object.position.z = -400; });
    assert.equal(game.hud().ability.ready, true);
  });

  it('Blitzstart füllt Nitro auf 60 %', () => {
    const game = startedGame('blitz');
    game.nitro = 0.1;
    game.useAbility();
    assert.ok(game.nitro >= 0.6);
  });

  it('Münzsog zieht Münzen aus allen Spuren an', () => {
    const game = startedGame('kiwi');
    const coin = game.coins[0];
    Object.assign(coin, { active: true, pulled: false, x: 4, y: 1, z: -30 });
    game.useAbility();
    assert.equal(coin.pulled, true);
    const before = game.coinsCollected;
    game.nextRowSpacing = 1e9;
    run(game, 1.5);
    assert.equal(game.coinsCollected, before + 1, 'Münze eingesammelt');
  });

  it('Reparatur stellt das Schild wieder her', () => {
    const game = startedGame('rancher');
    game.shieldActive = false;
    game.useAbility();
    assert.equal(game.shieldActive, true);
  });

  it('Rammbock: Autos werden weggeschleudert statt Crash', () => {
    const game = startedGame('bulldog');
    let crashes = 0;
    game.events.onCrash = () => crashes++;
    game.useAbility();
    const target = game.enemies[0];
    target.object.position.set(game.player.x, 0, -8);
    game.nextRowSpacing = 1e9;
    run(game, 1.5);
    assert.equal(crashes, 0);
    assert.ok(game.smashed >= 1);
  });

  it('Phasensprung: fährt durch Autos, ohne Crash und ohne Schaden', () => {
    const game = startedGame('neon');
    let crashes = 0;
    game.events.onCrash = () => crashes++;
    game.useAbility();
    const target = game.enemies[0];
    target.object.position.set(game.player.x, 0, -12);
    game.nextRowSpacing = 1e9;
    run(game, 1.2);
    assert.equal(crashes, 0);
    assert.equal(game.smashed, 0, 'wird nicht weggerammt');
  });

  it('Schwebesprung: hebt ab und fliegt über Lkw', () => {
    const game = startedGame('phantom');
    let crashes = 0;
    game.events.onCrash = () => crashes++;
    game.useAbility();
    const target = game.enemies.find((e) => e.type === 'truck') || game.enemies[0];
    target.object.position.set(game.player.x, 0, -20);
    game.nextRowSpacing = 1e9;
    let maxHeight = 0;
    run(game, 1.6, () => { maxHeight = Math.max(maxHeight, game.vehicle.object.position.y); });
    assert.ok(maxHeight > 3, `Sprunghöhe ${maxHeight.toFixed(2)} m`);
    assert.equal(crashes, 0);
    assert.equal(game.vehicle.object.position.y, 0, 'landet wieder');
  });

  it('Sirene: Verkehr fährt schneller weg (kleineres Relativtempo)', () => {
    const game = startedGame('sheriff');
    game.nextRowSpacing = 1e9;
    const e = game.enemies[0];
    e.object.position.z = -100;
    const dt1 = (() => { const z0 = e.object.position.z; run(game, 0.5, () => { for (const o of game.enemies) if (o !== e) o.object.position.z = -400; }); return e.object.position.z - z0; })();
    e.object.position.z = -100;
    game.abilityCooldown = 0;
    game.useAbility();
    const dt2 = (() => { const z0 = e.object.position.z; run(game, 0.5, () => { for (const o of game.enemies) if (o !== e) o.object.position.z = -400; }); return e.object.position.z - z0; })();
    assert.ok(dt2 < dt1 * 0.7, `mit Sirene ${dt2.toFixed(1)} m < ohne ${dt1.toFixed(1)} m`);
  });

  it('Overdrive: höheres Höchsttempo', () => {
    const base = startedGame('rakete');
    base.setGas(true);
    base.nextRowSpacing = 1e9;
    run(base, 4, () => { for (const e of base.enemies) e.object.position.z = -400; });
    const withoutOverdrive = base.player.speed;

    const boosted = startedGame('rakete');
    boosted.useAbility();
    boosted.setGas(true);
    boosted.nextRowSpacing = 1e9;
    run(boosted, 4, () => { for (const e of boosted.enemies) e.object.position.z = -400; });
    assert.ok(boosted.player.speed > withoutOverdrive * 1.1, `${boosted.player.speed.toFixed(1)} > ${withoutOverdrive.toFixed(1)}`);
  });
});

describe('Party-Geister', () => {
  it('zeigt Mitspieler relativ zur eigenen Strecke und räumt sie wieder auf', () => {
    const game = makeGame();
    game.start({ seed: 'ghost', countdown: 0.01 });
    run(game, 1);
    game.setGhosts([{ id: 'g1', name: 'Freund', car: 'kiwi', color: '#8bd346', distance: game.distance + 40, x: 4, speed: 0, alive: true, lastSeen: performance.now() }]);
    run(game, 1);
    const ghost = game.ghosts.get('g1');
    assert.ok(ghost?.vehicle.object.visible);
    game.setGhosts([]);
    game.update(DT);
    assert.equal(game.ghosts.size, 0);
  });
});

describe('Verkehrskatalog', () => {
  it('Konvoi ist 15 m lang und entsteht nur als Ereignis (Gewicht 0)', () => {
    const boss = TRAFFIC.find((t) => t.type === 'boss');
    assert.equal(boss.weight, 0);
    assert.equal(boss.size[2], 15);
  });
});

// Diese Regeln prüft der Server in submit_score – ehrliche Runden dürfen nie daran scheitern.
describe('Serverprüfung: ehrliche Runden bleiben plausibel', () => {
  it('Überholte und gerammte Autos sowie Level passen zu Strecke und Zeit (Bot, 12 Runden)', () => {
    for (let i = 0; i < 12; i++) {
      let result = null;
      const game = makeGame({ onOver: (r) => { result = r; } });
      game.start({ seed: `plaus-${i}`, countdown: 0.01 });
      run(game, 150, () => bot(game));
      if (!result) result = game.hud() && { distance: game.distance, overtakes: game.overtakes, smashed: game.smashed, level: game.level, duration: game.elapsed };
      const activity = result.overtakes + result.smashed;
      assert.ok(activity >= (result.distance - 500) / 90, `Runde ${i}: ${activity} Autos bei ${Math.floor(result.distance)} m`);
      assert.ok(result.level <= Math.min(15, 2 + Math.floor(result.duration / 12)), `Runde ${i}: Level ${result.level} nach ${result.duration.toFixed(0)} s`);
      assert.ok(result.distance <= (25 * result.duration + (47 / 360) * result.duration ** 2) * 2.4 + 100, `Runde ${i}: Strecke`);
    }
  });
});

// Fahrtverlauf (Cheat-Schutz): dieselben Regeln wie _trace_ok in der Datenbank – auch mit Vollgas, Nitro und Fähigkeiten
const baseSpeed = (t) => 25 + (47 * Math.min(Math.max(t, 0), 180)) / 180;
function traceOk(trace, score, dur) {
  const n = trace.length;
  if (score < 400 && n === 0) return 'ok';
  if (n === 0 || n > 400) return 'leer';
  if (Math.abs(n - Math.floor(dur / 1.5)) > 2) return `Länge ${n} statt ${Math.floor(dur / 1.5)}`;
  for (let i = 0; i < n; i++) {
    const prev = i ? trace[i - 1] : 0;
    const ord = i + 1;
    const d = trace[i] - prev;
    if (d < 0) return `rückwärts bei ${ord}`;
    if (d > 1.5 * (baseSpeed(ord * 1.5) * 2.9 * 1.03) + 3) return `zu schnell bei ${ord}: ${d}`;
    if (ord > 4 && d < 1.5 * baseSpeed((ord - 1) * 1.5) * 0.6) return `zu langsam bei ${ord}: ${d}`;
  }
  if (trace[n - 1] > score + 5) return 'Trace über Score';
  if (score - trace[n - 1] > 1.6 * (baseSpeed(dur) * 2.9 * 1.03) + 10) return 'Score weit über Trace';
  return 'ok';
}

describe('Serverprüfung: Fahrtverlauf', () => {
  for (const car of CARS.map((c) => c.id)) {
    it(`ehrliche Fahrt mit ${car} besteht die Verlaufsprüfung (Vollgas, Nitro, Fähigkeit)`, () => {
      let result = null;
      const game = makeGame({ onOver: (r) => { result = r; } }, car);
      game.start({ seed: `trace-${car}`, countdown: 0.01 });
      run(game, 70, () => {
        bot(game);
        if (!game.player.brake) game.setGas(true);
        game.useAbility();
        if (game.nitro > 0.9) game.triggerNitro();
      });
      const r = result || { distance: game.distance, duration: game.elapsed, trace: game.trace };
      assert.equal(traceOk(r.trace, Math.floor(r.distance), r.duration), 'ok', `${car}: ${r.trace.length} Punkte, ${r.duration.toFixed(1)} s`);
    });
  }

  it('der Verlauf ist ein Messpunkt alle 1,5 s und wird zurückgesetzt', () => {
    let result = null;
    const game = makeGame({ onOver: (r) => { result = r; } });
    game.start({ seed: 'trace-len', countdown: 0.01 });
    run(game, 30, () => bot(game));
    const first = game.trace.length;
    assert.ok(first >= 5 && first === Math.floor(game.elapsed / 1.5), `${first} Punkte nach ${game.elapsed.toFixed(1)} s`);
    game.start({ seed: 'trace-len-2', countdown: 0.01 });
    assert.equal(game.trace.length, 0);
    assert.ok(result === null || Array.isArray(result.trace));
  });
});
