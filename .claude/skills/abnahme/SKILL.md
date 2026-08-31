---
name: abnahme
description: Führt die Abnahme eines Bauabends oder des Gesamtstands durch — Tests, Checkliste, Befund
argument-hint: [nummer oder "alles"]
disable-model-invocation: true
---

Führe eine Abnahme durch wie auf der Baustelle: prüfen, nicht schönreden.

1. Gilt die Abnahme einem Abend (Nummer als $ARGUMENTS) → nimm dessen
   «Fertig wenn»-Kriterium aus BAUPLAN.md/BAUPLAN2.md. Bei «alles» → nimm die
   «Definition of done»-Liste des jeweiligen Abschnitts plus alle
   «Fertig wenn»-Kriterien der gebauten Abende.
2. Prüfe alles, was am Rechner prüfbar ist, WIRKLICH — nicht nur den Code
   lesen: Server starten, die Abläufe durchspielen (erfassen, neu laden,
   filtern, exportieren/importieren mit Testdaten), Konsole auf Fehler
   prüfen. Bei Datenprüfungen echte Zahlen vergleichen, nicht «sieht gut aus».
3. Erstelle für alles, was nur am Gerät oder auf der Baustelle prüfbar ist,
   eine nummerierte Handy-/Feld-Checkliste zum Abhaken (Kamera mit 20 Fotos,
   Flugmodus-Start vom Startbildschirm, PDF am Handy teilen, Backup-Probe).
4. Befund in drei Kategorien: BESTANDEN (mit Beleg), MANGEL (mit Ort und
   vorgeschlagenem Fix — noch nichts fixen!), NICHT PRÜFBAR AM RECHNER
   (→ Checkliste). Keine Gefälligkeitsabnahme: Ein Kriterium ohne Beleg gilt
   als nicht bestanden.
5. Frage am Ende, ob die gefundenen Mängel jetzt behoben werden sollen.
   Erst nach Freigabe fixen, danach die betroffenen Prüfungen wiederholen.
