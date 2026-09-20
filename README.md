# Lane Racer

Ein endloses 3D-Autorennen im Browser: fünf Welten, Nitro, Münzen, Garage mit freischaltbaren Autos,
Missionen, weltweite Rangliste und Party-Rennen mit Freunden über einen Einladungslink.

**Spielen: https://leeshovo.github.io/lane-racer/**

Gebaut mit [Three.js](https://threejs.org/) (r186) und [Supabase](https://supabase.com/).
Kein Build-Schritt, kein npm: Die Module werden per Import-Map direkt vom CDN geladen.

## Steuerung

| Taste | Aktion |
| --- | --- |
| ← / → (oder A / D) | Spur wechseln |
| ↑ (oder W) | Gas geben |
| ↓ (oder S) | Bremsen |
| Leertaste / Umschalt / N | **Nitro** – schneller und unverwundbar: Du rammst Autos aus dem Weg |
| P / Esc | Pause |
| Enter | Starten, Neustart |
| M | Ton an/aus |
| H | Hitboxen anzeigen (zum Angucken, wie die Kollision funktioniert) |

Auf Handy und Tablet: links oder rechts auf den Bildschirm tippen für den Spurwechsel, dazu Tasten für
Gas, Bremse und Nitro.

## Spielprinzip

- **Score = gefahrene Distanz** in Metern. Alle 12 Sekunden ein Level, alle 3 Level eine neue Welt:
  Sonnental → Canyon → Neon City → Frostpass → Vulkan. Nach ca. 3 Minuten ist die maximale Schwierigkeit erreicht.
- **Münzen** liegen auf der Strecke und sind die Währung für die Garage. Zusätzlich gibt es Münzen für
  Beinahe-Unfälle, gerammte Autos und die gefahrene Strecke.
- **Beinahe-Unfälle**: Wer knapp an einem Auto vorbeizieht, bekommt Münzen, füllt die Nitro-Leiste und
  baut eine Kombo bis ×5 auf.
- **Power-ups**: Nitro-Kanister, Schutzschild, Münzmagnet und doppelte Münzen.
- **8 Autos** mit eigenen Werten (Tempo, Handling, Nitro) und Sonderfähigkeiten, dazu Lackfarben.
- **Missionen**: drei Aufgaben gleichzeitig, nach dem Erfüllen kommt die nächste Stufe.
- **Fair by design**: In jeder Gegner-Reihe bleibt mindestens eine Spur frei, und von jeder freien Spur
  aus reicht ein einziger Spurwechsel für die nächste Reihe.

## Online mit Freunden

- **Rangliste**: Allzeit, diese Woche und innerhalb der Party.
- **Party**: „Party erstellen“ drücken und den Link verschicken. Wer ihn öffnet, ist automatisch dabei.
- **Live**: Du siehst die Autos deiner Freunde als Geister auf deiner Straße, dazu ihren Punktestand im HUD.
- **Party-Rennen**: Der Host startet ein Rennen, alle starten gleichzeitig und bekommen **denselben Verkehr**
  (gleicher Zufalls-Seed). Danach gibt es eine Rangliste des Rennens.

Der Spielstand (Münzen, Autos, Missionen) liegt lokal im Browser. Name und Ergebnisse liegen in der
Datenbank, damit Ranglisten und Party funktionieren.

## Lokal starten

Ein kleiner Webserver genügt – wegen der ES-Module funktioniert ein Doppelklick auf `index.html` nicht.

```bash
npx serve .
```

```bash
python -m http.server 8000
```

Danach `http://localhost:3000` bzw. `http://localhost:8000` öffnen.

## Projektstruktur

```
index.html      Grundgerüst, Import-Map, Schriften
style.css       Aussehen der Oberfläche
js/
  main.js       Einstieg: Game-Loop, Kamera, Eingabe, Menü-Ablauf, Party-Steuerung
  game.js       Spielmechanik: Spieler, Verkehr, Münzen, Nitro, Kollisionen, Geisterautos
  config.js     Alle Stellschrauben: Tempo, Schwierigkeit, Autos, Welten, Missionen
  cars.js       Fahrzeugmodelle (prozedural aus Boxen und Zylindern)
  world.js      Umgebung: Himmel, Licht, Straße, Deko, Wetter, Weltenwechsel
  effects.js    Bloom, Partikel, Schockwellen, Schild, Tempo-Striche
  audio.js      Motor, Soundeffekte und Musik – komplett im Browser erzeugt
  online.js     Supabase: Ranglisten, Party, Live-Positionen
  ui.js         Menüs, Garage, HUD, Party-Lobby, Game-Over
  storage.js    Spielstand im Browser (Münzen, Garage, Missionen)
  rng.js        Zufallsgenerator mit Seed (für identische Party-Rennen)
```

## Backend

Supabase-Projekt `lane-racer` (Region Frankfurt, kostenloser Plan):

- Tabellen `players`, `player_secrets`, `scores` mit Row Level Security. Lesen darf jeder,
  schreiben nur geprüfte Server-Funktionen.
- Funktionen: `register_player`, `update_player`, `submit_score`, `leaderboard_global`,
  `leaderboard_weekly`, `leaderboard_party`, `race_results`.
- Jeder Spieler bekommt beim ersten Start ein geheimes Token (nur als Hash gespeichert). Ohne dieses
  Token kann niemand unter fremdem Namen Ergebnisse eintragen.
- Unrealistische Scores (mehr Meter als in der Fahrzeit physikalisch möglich), zu schnelle Wiederholungen
  und ungültige Namen werden serverseitig abgelehnt.

Der Schlüssel in `js/config.js` ist der öffentliche „Publishable Key“. Er darf im Browser stehen; der
Schutz kommt aus Row Level Security und den geprüften Funktionen.

## Anpassen

Fast alles steht in `js/config.js`: Tempo (`startSpeed`, `maxBaseSpeed`), Schwierigkeit
(`difficultyTime`, `levelTime`), Verkehrsdichte (`rowSpacingStart/End`, `doubleChance…`), Nitro,
Münzen, Kamera sowie die Kataloge für Autos, Welten und Missionen.

Zum Ausprobieren ohne Neuladen gibt es in der Browser-Konsole `laneRacer`, z. B.
`laneRacer.profile.coins = 99999` (danach Garage öffnen).

## Updates veröffentlichen

```bash
git add -A && git commit -m "Update" && git push
```

GitHub Pages veröffentlicht den neuen Stand nach etwa einer Minute automatisch.
