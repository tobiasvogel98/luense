---
name: baustatus
description: Zeigt den Baufortschritt des Projekts — Module, Tests, Betriebsstatus, nächste Schritte
disable-model-invocation: true
---

Erstelle einen kompakten Lagebericht des Lünse-Projekts. Nur berichten,
nichts bauen oder ändern.

1. Ermittle den Iststand aus dem Repo: vorhandene Dateien in kern/ und
   module/, Git-Log (welche Abende committet), offene/unversionierte
   Änderungen (git status).
2. Gleiche mit BAUPLAN.md und BAUPLAN2.md ab: welche Abende gebaut, welche
   offen, welche Abnahme-Tests laut letzten Abnahmen bestanden bzw. als
   Handy-/Feld-Checks noch offen sind.
3. Falls die Betriebsstatus-Anzeige (im Aufbau / Parallelbetrieb / führend)
   schon existiert: lies ihren Stand aus dem Code und übernimm ihn.
4. Gib den Bericht als Tabelle aus:
   Modul | gebaut (Abend) | Abnahme | Betriebsstatus
   Danach: offene Feld-Checks als kurze Liste, letzter Backup-Export falls
   feststellbar, und der nächste empfohlene Abend laut Plan.
5. Schliesse mit einer ehrlichen Ampel: GRÜN (Plan hält), GELB (offene
   Abnahmen stauen sich — erst prüfen, dann weiterbauen), ROT (es wird
   gebaut, obwohl Abnahmen fehlen oder die Migrationsregeln verletzt sind —
   klar benennen, welche).
