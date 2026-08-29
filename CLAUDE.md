# Lünse Stamm-App

Ein einziges Programm für den Bauführer-Alltag: Baustellen-Stamm, Ereignis-Journal
mit Fotos, später Rapporte, Ausmass, Nachträge, Pendenzen, Protokolle und das
Cockpit-Controlling als Module. Gebaut und genutzt von Tobias (Bauführer, Tiefbau,
Schweiz). Dieses Dokument sind die Grundregeln — sie gelten in jeder Session.

## Stack — nicht verhandelbar

- Vanilla JavaScript, native ES-Module. **Kein Build-Step, kein Bundler, kein npm
  zur Laufzeit, kein TypeScript, kein Framework** (kein React/Vue/Tailwind).
- Einzige Bibliothek: `lib/pouchdb.min.js` (lokal abgelegt, v9). Nichts von CDNs
  laden — die App muss vollständig offline funktionieren.
- Schriften: System-Font-Stack. Keine externen Fonts, keine externen Requests.
- Persistenz: **ausschliesslich PouchDB** (`kern/speicher.js`). `localStorage`
  höchstens für UI-Zustand (gewählte Baustelle, aktiver Tab), nie für Daten.
- Offline-first PWA: Service-Worker cacht alle App-Dateien. Datenhoheit: Daten
  bleiben auf dem Gerät (später Sync auf eigene Hardware via CouchDB — noch NICHT bauen).

## Architektur

- Jedes Datenobjekt ist ein Dokument: `{ _id, typ, baustelleId, datum, ... }`.
  Fotos sind PouchDB-Attachments am jeweiligen Dokument.
- **Module teilen Dokumente, nie Code.** Module rufen sich nie gegenseitig auf;
  sie lesen/schreiben getypte Dokumente über den Kern.
- Modul-Schnittstelle: jedes Modul in `module/` exportiert
  `{ name, dokumentTypen, render(baustelle) }`. Die Shell (`index.html`)
  registriert Module in einer Liste — mehr Kopplung gibt es nicht.
- Kern-Dienste in `kern/`: `speicher.js` (PouchDB-Wrapper), `stamm.js`
  (Baustellen), später `kamera.js`, `pdf.js`, `export.js`.
- **Rule of two:** Eine Funktion wandert erst in den Kern, wenn das zweite Modul
  sie braucht. Keine Architektur auf Vorrat.

## Oberfläche

- Sprache: Deutsch (Schweiz). **Immer ss statt ß** (Strasse, Massnahme, gross).
- Fachbegriffe der Branche verwenden: Baustelle/KTR, Ausmass, Regie, Nachtrag,
  Pendenz, Rapport, NPK-Position, SIA 118.
- Formate: Datum `de-CH` (28.08.2026), Beträge `CHF 12'345`, Zahlen mit
  `tabular-nums` in Tabellen.
- Touch-Ziele gross (Baustelle = Handschuhe): mindestens 44 px. Mobile-first —
  das Hauptgerät ist ein Handy.
- Helles und dunkles Farbschema über CSS-Tokens auf `:root`.

## Vorgehen

- Gebaut wird **streng nach `BAUPLAN.md`**: pro Session eine Etappe, nichts aus
  späteren Etappen vorziehen (kein Sync, keine weiteren Module, bevor Etappe dran).
- Jede Etappe endet mit ihrem Abnahme-Test aus dem Bauplan und einem Git-Commit.
- Fotos beim Erfassen immer verkleinern: max. 1600 px, JPEG ~0.8.
- Demo-/Testdaten nie in die echte Datenbank mischen (falls nötig: separater,
  klar markierter Demo-Modus).
- Bei Unklarheiten: nachfragen statt Annahmen über Fachlogik treffen — Tobias
  kennt die Baustellenrealität.
