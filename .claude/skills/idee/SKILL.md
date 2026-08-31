---
name: idee
description: Prüft eine neue Idee gegen Zielbild und Feature-Freeze — und parkt sie sauber statt sie zu bauen
argument-hint: [beschreibung der idee]
disable-model-invocation: true
---
Bewerte die Idee «$ARGUMENTS» — baue sie NICHT.

1. Ordne ein: Ist es (a) Verbesserung von Bestehendem, (b) neues Feature,
   (c) neues Modul/Programm?
2. Prüfe gegen CLAUDE.md und die Baupläne: Passt es zur Architektur
   (Dokumente statt Code teilen)? Kollidiert es mit dem Feature-Freeze oder
   den geparkten Themen (mobile Erfassung, Abrechnung, Lieferschein-OCR)?
3. Schätze Aufwand (S/M/L) und Nutzen im Baustellen-Alltag (1–5), je ein Satz.
4. Bei (b) oder (c): Trage die Idee mit Datum, Einordnung und Schätzung in
   IDEEN.md ein (Datei anlegen, falls fehlt) — der Ideen-Parkplatz.
   Bei (a): Empfiehl, in welchen Bauabend es passt.
5. Schlussurteil in einem Satz: jetzt / später / gar nicht — mit Begründung.
   Erinnere bei Freeze-Konflikt ausdrücklich an die eigene Regel.
