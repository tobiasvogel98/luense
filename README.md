# Lünse

Die Stamm-App: ein Programm für den Bauführer-Alltag — Baustellen, Foto-Journal,
und Schritt für Schritt alle weiteren Module. Offline-first PWA, Vanilla JS,
Daten bleiben auf dem eigenen Gerät.

**Live:** https://tobiasvogel98.github.io/luense/

## Nutzung

1. Adresse oben am Handy öffnen und über «Zum Startbildschirm hinzufügen»
   installieren — danach läuft die App komplett offline.
2. Im ⚙-Stamm Baustellen anlegen (KTR-Nr., Name, Ort, Bauherr, Werkvertrag).
3. Im Journal Ereignisse erfassen: Tag (Vorzustand/Fortschritt/Mangel/Regie/
   Abnahme), Ort/KV, Notiz, Fotos. «PDF-Bericht» erzeugt den Fotobericht.
4. Regelmässig «Backup» in der Fusszeile — die App erinnert nach 7 Tagen.
   Der Import ergänzt den Bestand und überschreibt nichts.

Alle Daten (Baustellen, Einträge, Fotos) leben ausschliesslich in der lokalen
Datenbank des jeweiligen Geräts. Im Repo liegt nur Code. Kein Sync zwischen
Geräten — Datenaustausch bewusst nur über Backup/Import.

## Entwicklung

Kein Build-Step: einen statischen Server im Ordner starten (z. B.
`python -m http.server`) und loslegen. Gebaut wird streng nach `BAUPLAN.md`,
die Grundregeln stehen in `CLAUDE.md` (liest Claude Code automatisch).

Nach jeder Änderung an App-Dateien: `VERSION` in `sw.js` hochzählen und neue
Dateien in dessen `DATEIEN`-Liste aufnehmen, sonst erhalten installierte
Geräte das Update nicht. Installierte Apps holen Updates in zwei Schritten:
Der erste Start lädt die neue Version, der zweite zeigt sie.

## Struktur

```
luense/
├── CLAUDE.md          Grundregeln (liest Claude Code automatisch)
├── BAUPLAN.md         die Bauabende von Schritt 1
├── index.html         Shell: Kopfzeile, Modulbereich, Backup-Fusszeile
├── style.css          Design-Tokens (hell/dunkel), Layout, Print-CSS
├── manifest.json      PWA-Manifest
├── sw.js              Service-Worker (Precache, Versionsstempel)
├── kern/              speicher, stamm, kamera, pdf, export, ui
├── module/            Module, beginnend mit ereignis.js (Journal)
├── icons/             App-Icons
└── lib/               pouchdb.min.js (v9, lokal — einzige Bibliothek)
```
