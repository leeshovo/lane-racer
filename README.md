# Lane Racer

Ein endloses 3D-Autorennen im Browser: fünf Welten mit Kurven und Hügeln, Nitro, Münzen, Garage mit
acht Autos, Missionen, Tagesrennen, weltweite Rangliste und Party-Rennen mit Freunden über einen Link.

**Spielen: https://leeshovo.github.io/lane-racer/**

Gebaut mit [Three.js](https://threejs.org/) (r186) und [Supabase](https://supabase.com/).
Kein Build-Schritt: Die Module werden per Import-Map direkt vom CDN geladen.

## Steuerung

| Taste | Aktion |
| --- | --- |
| ← / → (oder A / D) | Spur wechseln |
| ↑ (oder W) | Gas geben |
| ↓ (oder S) | Bremsen |
| Leertaste / Umschalt / N | **Nitro** – schneller und unverwundbar: Du rammst Autos aus dem Weg |
| F oder E | **Auto-Fähigkeit** einsetzen (jedes Auto hat eine eigene) |
| P / Esc | Pause |
| Enter | Starten, Neustart |
| M | Ton an/aus |
| H | Hitboxen anzeigen |

Auf dem Handy: links/rechts auf den Bildschirm tippen oder die Pfeile nutzen, dazu Knöpfe für Gas,
Bremse, Nitro und Fähigkeit.

## Spielprinzip

- **Score = gefahrene Distanz.** Alle 12 Sekunden ein Level, alle 3 Level eine neue Welt:
  Sonnental → Canyon → Neon City → Frostpass → Vulkan. Nach ca. 3 Minuten ist die maximale Schwierigkeit erreicht.
- **Kurven und Hügel:** Die Straße schwingt seitlich und über Kuppen. Gefahren wird trotzdem in drei geraden
  Spuren, die Krümmung ist ein optischer Effekt (siehe `js/bend.js`).
- **Münzen** liegen auf der Strecke und bezahlen die Garage. Dazu gibt es Münzen für Beinahe-Unfälle
  (Kombo bis ×5), gerammte Autos und die gefahrene Strecke.
- **Ereignisse:** *Goldrausch* (lange Münzlinien), *Stoßverkehr* (dichter Verkehr, dafür doppelte Beinahe-Münzen)
  und der *Schwerlast-Konvoi* (zwei Lkw, 15 m lang, mit Bonus fürs Überholen oder Rammen).
- **Power-ups:** Nitro-Kanister, Schutzschild, Münzmagnet, doppelte Münzen.
- **8 Autos** mit eigenen Werten, einem passiven Bonus und einer **aktiven Fähigkeit**:
  Blitzstart, Münzsog, Rammbock, Reparatur, Sirene, Phasensprung, Overdrive und Schwebesprung.
- **Missionen:** drei laufende Aufgaben, danach kommt jeweils eine schwerere Stufe.
- **Fair by design:** In jeder Gegner-Reihe bleibt mindestens eine Spur frei, und von jeder freien Spur
  reicht ein Spurwechsel für die nächste Reihe. Um den Konvoi herum gibt es extra Platz.

## Online mit Freunden

- **Rangliste:** Allzeit, diese Woche und heute.
- **Tagesrennen:** Jeden Tag gibt es eine Strecke (gleicher Seed für alle Spieler weltweit). Dein bester
  Versuch des Tages zählt für die Tagesrangliste.
- **Party:** „Party erstellen“ drücken und den Link verschicken. Wer ihn öffnet, ist dabei. Du siehst die Autos
  deiner Freunde als Geister auf deiner Straße und ihren Stand im HUD. Der Host startet gemeinsame Rennen,
  bei denen alle **denselben Verkehr** bekommen.
- **Herausfordern:** Nach jeder Runde erzeugt „Herausfordern“ einen Link mit deiner Strecke und deinem
  Score. Dein Freund fährt dieselbe Strecke und sieht deinen Score als Ziellinie im HUD.
- **Spielstand sichern:** Münzen, Autos und Missionen werden automatisch in der Cloud gesichert. Unter
  *Einstellungen → Spielstand sichern* gibt es einen Sicherungscode, mit dem man den Stand auf einem anderen
  Gerät wiederherstellt. Der Code ist wie ein Passwort: Wer ihn hat, kann als du spielen.
- **Offline:** Nach dem ersten Besuch startet das Spiel auch ohne Internet (Service Worker).
  Rangliste und Party brauchen dann natürlich eine Verbindung.

## So startest du das Spiel über GitHub (GitHub Pages)

Das Spiel besteht nur aus statischen Dateien, GitHub kann es deshalb kostenlos ausliefern.

1. Repository öffnen: `https://github.com/leeshovo/lane-racer`
2. **Settings** (Zahnrad-Reiter oben) → links **Pages**.
3. Unter **Build and deployment → Source** die Option **Deploy from a branch** wählen.
4. Bei **Branch** `main` und den Ordner `/ (root)` wählen, dann **Save**.
5. Etwa eine Minute warten. Oben auf der Seite erscheint dann
   „Your site is live at **https://leeshovo.github.io/lane-racer/**“.
6. Diesen Link an Freunde schicken. Sie brauchen keinen Account, nur einen Namen beim ersten Start.

**Updates veröffentlichen:** Änderungen committen und pushen, GitHub Pages aktualisiert die Seite von selbst:

```bash
git add -A && git commit -m "Update" && git push
```

Bei größeren Änderungen die Version in `sw.js` (`VERSION`) erhöhen, damit der Offline-Cache der Spieler
erneuert wird.

## Lokal starten

Wegen der ES-Module funktioniert ein Doppelklick auf `index.html` nicht, ein kleiner Webserver genügt:

```bash
npx serve .
```

```bash
python -m http.server 8000
```

Danach `http://localhost:3000` (serve) bzw. `http://localhost:8000` (Python) öffnen.

## Tests

Die Spiellogik läuft auch ohne Browser und Grafik. Die Tests prüfen unter anderem Fairness in tausenden
Verkehrsreihen, alle acht Fähigkeiten, Konvoi-Abstände, Sicherungscode, Spielstand-Zusammenführung und die
Grenzen der Kurven:

```bash
npm install
npm test
```

Bei jedem Push führt GitHub die Tests automatisch aus (Reiter **Actions**).

## Projektstruktur

```
index.html      Grundgerüst, Import-Map, Schriften
style.css       Aussehen der Oberfläche
sw.js           Service Worker (Offline-Betrieb, schnellerer Start)
manifest.webmanifest, icon.svg   Installierbar als App
js/
  main.js       Einstieg: Game-Loop, Kamera, Eingabe, Menü-Ablauf, Party, Cloud-Sicherung
  game.js       Spielmechanik: Spieler, Verkehr, Ereignisse, Konvoi, Fähigkeiten, Kollisionen
  config.js     Alle Stellschrauben: Tempo, Schwierigkeit, Autos, Welten, Missionen
  bend.js       Kurven und Hügel (gebogene Welt im Vertex-Shader)
  cars.js       Fahrzeugmodelle (prozedural aus Boxen und Zylindern)
  world.js      Umgebung: Himmel, Licht, Straße, Deko, Wetter, Weltenwechsel
  effects.js    Bloom, Partikel, Schockwellen, Schild, Tempo-Striche
  audio.js      Motor, Soundeffekte und Musik – komplett im Browser erzeugt
  online.js     Supabase: Ranglisten, Party, Live-Positionen, Cloud-Spielstand
  ui.js         Menüs, Garage, HUD, Party-Lobby, Game-Over, Einstellungen
  storage.js    Spielstand im Browser, Snapshot für die Cloud
  rng.js        Zufallsgenerator mit Seed (für identische Rennen)
tests/          Automatische Tests (node:test)
```

## Backend

Supabase-Projekt `lane-racer` (Region Frankfurt, kostenloser Plan):

- Tabellen `players`, `player_secrets`, `player_saves`, `runs`, `scores` mit Row Level Security. Lesen darf
  jeder (nur Spieler und Scores), geschrieben wird ausschließlich über geprüfte Server-Funktionen.
- Jeder Spieler bekommt beim ersten Start ein geheimes Token (nur als Hash gespeichert).
- **Server-gemessene Runden:** `begin_run` merkt sich den Startzeitpunkt. `submit_score` nimmt einen Score nur
  mit dieser Runden-ID an und begrenzt ihn durch die *tatsächlich vergangene* Zeit und die physikalisch
  mögliche Höchstgeschwindigkeit. Erfundene Fahrzeiten, doppelte Einsendungen, zu schnelle Wiederholungen,
  unmögliche Scores und abgelaufene Tagesrennen werden abgelehnt.
- Der Schlüssel in `js/config.js` ist der öffentliche „Publishable Key“. Er darf im Browser stehen, der
  Schutz kommt aus Row Level Security und den Funktionen.

**Grenzen des Cheat-Schutzes:** Wer wirklich Zeit im Spiel verbringt, kann den Client manipulieren und einen
Score knapp unter der physikalischen Grenze einreichen. Für einen Freundeskreis reicht das, für eine große
öffentliche Rangliste bräuchte es eine serverseitige Nachrechnung der Fahrt.

## Anpassen

Fast alles steht in `js/config.js`: Tempo, Schwierigkeit, Verkehrsdichte, Ereignisse, Nitro, Münzen,
Kamera sowie die Kataloge für Autos (samt Fähigkeiten), Welten und Missionen.

Zum Ausprobieren gibt es in der Browser-Konsole das Objekt `laneRacer`, z. B.
`laneRacer.profile.coins = 99999` (danach die Garage öffnen).
