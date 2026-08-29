# Bauplan — Schritt 1 (Shell, Kern, Ereignis-Journal)

8 Abende, 16–26 h, alles lokal, CHF 0. Pro Abend eine Etappe; fertig ist eine
Etappe erst, wenn ihr Abnahme-Test besteht. Danach Git-Commit.

## Abend 1 — Fundament (1–2 h)
Auftrag: Grundgerüst der PWA «Lünse»: index.html (Shell mit Kopfzeile,
Baustellen-Auswahl als Platzhalter, leerer Modulbereich), style.css mit
Design-Tokens (helles + dunkles Schema), Ordner kern/ und module/,
lib/pouchdb.min.js lokal eingebunden. Vanilla JS, native ES-Module, kein
Build-Step. Git-Repo mit sinnvollem .gitignore initialisieren.
**Fertig wenn:** Seite lädt auf dem Handy, sieht nach Lünse aus, erster Commit steht.

## Abend 2 — Speicher-Kern & Baustellen-Stamm (2–3 h)
Auftrag: kern/speicher.js als PouchDB-Wrapper (put/get, Abfrage nach {typ,
baustelleId}; alle Dokumente tragen typ, baustelleId, datum). Dann kern/stamm.js
+ Stamm-Ansicht: Baustellen (KTR-Nr., Name, Ort, Bauherr, Werkvertrag) anlegen/
bearbeiten/archivieren, plus JSON-Import für eine Baustellenliste. Kopfzeilen-
Auswahl zeigt die echten Baustellen.
**Fertig wenn:** Drei echte Baustellen erfasst, Neuladen — noch da.

## Abend 3 — Journal ohne Foto (2–3 h)
Auftrag: module/ereignis.js als erstes Modul ({name, dokumentTypen,
render(baustelle)}): Erfassung (Tag: Vorzustand/Fortschritt/Mangel/Regie/
Abnahme; Ort/KV; Notiz) und gefilterte Liste (Tag-Chips, neuste zuerst),
Dokumenttyp «ereignis». Shell registriert Module über eine Liste.
**Fertig wenn:** 10 Testeinträge auf 2 Baustellen, Filter und Neuladen stimmen.

## Abend 4 — Kamera & Fotos (3–5 h, Reserve einplanen)
Auftrag: kern/kamera.js: Foto via input type=file accept="image/*"
capture="environment", Canvas-Verkleinerung auf max. 1600 px (JPEG 0.8),
Speicherung als PouchDB-Attachment am Ereignis, Thumbnails in der Liste,
Vollbild beim Antippen, mehrere Fotos pro Ereignis.
**Fertig wenn:** 20 Fotos vom Handy erfasst, App bleibt flott, Neuladen ok.

## Abend 5 — Offline & Installieren, PWA (2–3 h)
Auftrag: manifest.json (Name «Lünse», Icons, Theme-Farben, standalone) und
sw.js (Precache aller App-Dateien, sauberes Update via Versionsstempel).
Deploy auf GitHub Pages einrichten.
**Fertig wenn:** Flugmodus an → App vom Startbildschirm → Ereignis mit Foto geht.

## Abend 6 — PDF-Fotobericht (3–4 h)
Auftrag: kern/pdf.js: Bericht fürs Journal — Auswahl Baustelle/Zeitraum/Tags,
Druckansicht mit eigener Print-CSS (Kopf mit KTR/Baustelle/Datum, 2 Fotos pro
Reihe mit Zeitstempel/Ort/Notiz, saubere Seitenumbrüche), Auslösung via
window.print().
**Fertig wenn:** Bericht mit 12 Fotos als PDF gespeichert und per Mail geteilt.

## Abend 7 — Backup & Export (1–2 h)
Auftrag: kern/export.js: Gesamtexport der PouchDB (Dokumente + Attachments)
als eine Datei via Teilen/Download; Import mit Duplikat-Schutz (ergänzt statt
überschreibt). Datum des letzten Exports in der Shell, Erinnerung nach 7 Tagen.
**Fertig wenn:** Export → Browserdaten löschen → Import → alles da, Fotos inkl.

## Abende 8+ — Feldwoche & Feinschliff (2–4 h über 2 Wochen)
Zwei Wochen täglich auf echten Baustellen nutzen. Jede Reibung als Ereignis
mit Tag «Mangel» in der App selbst erfassen. Danach ein Fix-Abend.
**Fertig wenn:** Eine Woche kein Baustellenfoto mehr in der normalen Galerie.

## Danach (nicht vorziehen)
Etappe 2 des Fahrplans: Pendenzenliste als zweites Modul. Sync/Raspberry Pi
erst, wenn Mehrgeräte-Betrieb wirklich gebraucht wird.
