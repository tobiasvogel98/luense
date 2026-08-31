---
name: abend
description: Baut den angegebenen Bauabend aus den Bauplänen, inkl. Abnahme-Test und Commit
argument-hint: [nummer, z.B. 3.2]
disable-model-invocation: true
---

Baue Abend $ARGUMENTS aus den Bauplänen. Gehe exakt so vor:

1. Lies BAUPLAN.md und BAUPLAN2.md und finde den Abend $ARGUMENTS. Wenn es
   ihn nicht gibt oder keine Nummer übergeben wurde: Liste die Abende auf,
   markiere anhand der Git-Historie, welche bereits gebaut sind, und schlage
   den nächsten offenen vor. Baue dann NICHTS ohne Rückfrage.
2. Prüfe die Voraussetzungen des Abends (frühere Abende vorhanden?). Fehlt
   etwas, sag es und stoppe.
3. Setze den Auftrag des Abends um — streng nach CLAUDE.md: Vanilla JS ohne
   Build-Step, nur PouchDB, Module teilen Dokumente statt Code, ss statt ß,
   Touch-Ziele min. 44 px. Ziehe NICHTS aus späteren Abenden vor.
4. Falls dafür eine Änderung am Kern (kern/) nötig ist: Führe sie aus, aber
   melde am Ende ausdrücklich WAS am Kern geändert wurde und WARUM — das ist
   Architektur-Feedback.
5. Führe den Abnahme-Test («Fertig wenn») des Abends durch, soweit er sich am
   Rechner prüfen lässt (Server starten, Abläufe durchspielen, Daten nach
   Reload prüfen). Was nur am Handy oder auf der Baustelle prüfbar ist
   (Kamera, Flugmodus, Feldtest), liste als offene Handy-Checkliste auf.
6. Git-Commit mit sprechender Message im Format «Abend $ARGUMENTS: <was>».
7. Schlussmeldung: Was gebaut wurde, Testergebnis, offene Handy-Checks,
   Kern-Änderungen, und welcher Abend als nächster dran ist.
