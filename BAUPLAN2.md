# Bauplan — Abschnitte 2 & 3 (Pendenzen, Tagesrapporte)

Voraussetzung: Bauetappe 1 ist gebaut. WICHTIG (Migrationsregel 1): Diese
Abschnitte werden GEBAUT, aber erst IN BETRIEB genommen, wenn (a) die
Feldwoche von Schritt 1 bestanden ist und (b) das jeweilige Modul seinen
eigenen Parallelbetrieb (2 Wochen neben dem Alt-Tool) bestanden hat. Bis dahin
bleiben Pendenzenliste-App und Tagesrapport-Tool führend. Keine echten Daten
migrieren, bevor der Parallelbetrieb beginnt.

---

## Abschnitt 2 — Pendenzen (der Beweis für die Modul-Schnittstelle)

### Abend 2.1 — Modul pendenzen.js
Auftrag: Baue module/pendenzen.js nach derselben Schnittstelle wie ereignis.js:
Pendenz erfassen (Text, Priorität hoch/mittel/tief, Termin, Verantwortlich),
Liste pro Baustelle mit Prioritäts-Farbband, abhaken (erledigt bleibt sichtbar,
durchgestrichen), Filter offen/alle. Dokumenttyp «pendenz».
**Fertig wenn:** Modul läuft neben dem Journal, ohne dass am Kern etwas
geändert werden musste. (Musste doch — kurz notieren, warum: das ist
Architektur-Feedback.)

### Abend 2.2 — Importer aus der Pendenzenliste-App
Auftrag: Baue in kern/export.js einen Import für das Exportformat der
bestehenden Pendenzenliste-App (localStorage-Export). Zuordnung zu Baustellen
über KTR-Nr., Duplikat-Schutz, Probelauf mit einer Kopie der echten Daten —
danach Import wieder löschen (Parallelbetrieb startet erst nach Feldwoche).
**Fertig wenn:** Ein Probeimport alle Pendenzen korrekt zeigt und rückstandslos
entfernt werden kann.

### Abend 2.3 — Verknüpfungen
Auftrag: Regie-Ereignis im Journal erzeugt automatisch eine Pendenz
(«Nachtrag beziffern/melden», Priorität hoch). Pendenzen erscheinen mit
Anzahl-Badge in der Navigation.
**Fertig wenn:** Journal-Eintrag mit Tag Regie → Pendenz steht ohne weiteres
Zutun in der Liste.

---

## Abschnitt 3 — Tagesrapporte

### Abend 3.1 — Modul rapport.js
Auftrag: Baue module/rapport.js: Tagesrapport erfassen (Datum, Mannschaft,
Stunden, davon Regie, Wetter, Geräte, Material/Lieferungen als Freitext),
Liste pro Baustelle neuste zuerst, Wochensumme. Dokumenttyp «rapport».
Erfassungsmaske am Muster des bestehenden Tagesrapport-Tools ausrichten.
**Fertig wenn:** Ein kompletter Rapport ist am Handy in unter einer Minute
erfasst.

### Abend 3.2 — Regie-Verknüpfung
Auftrag: Rapporte mit Regie-Stunden > 0 werden markiert und erzeugen
automatisch eine Pendenz «Regierapport unterschreiben lassen» (hoch) sowie
einen Verweis auf Journal-Ereignisse desselben Tages mit Tag «Regie».
**Fertig wenn:** Regie-Rapport → Pendenz + Verknüpfung sichtbar, ohne Handgriff.

### Abend 3.3 — Rapport-PDF
Auftrag: Erweitere kern/pdf.js um den Tagesrapport-Druck (eigene Print-CSS:
Kopf mit KTR/Baustelle/Datum/Wetter, Stunden-Tabelle, Regie-Block separat
ausgewiesen, Unterschriftszeile). Einzelrapport und Wochenübersicht.
**Fertig wenn:** Ein Rapport-PDF ist erstellt, lesbar und per Mail geteilt.

### Abend 3.4 — Importer & Parallelbetrieb vorbereiten
Auftrag: Import für das Exportformat des bestehenden Tagesrapport-Tools
(analog Abend 2.2, Probelauf mit Kopie, danach entfernen). Zusätzlich eine
kleine «Betriebsstatus»-Anzeige in der Shell: pro Modul «im Aufbau /
Parallelbetrieb / führend», von Hand umschaltbar.
**Fertig wenn:** Probeimport sauber; die Statusanzeige zeigt ehrlich, welches
Modul schon führend ist — und welches noch nicht.

---

## Inbetriebnahme-Reihenfolge (nicht überspringen)
1. Feldwoche Schritt 1 bestehen (Journal führend).
2. Pendenzen: echten Import fahren → 2 Wochen parallel zur alten App →
   Zahlenabgleich → Alt-App einfrieren (Archiv), Modul auf «führend».
3. Erst danach dasselbe für Tagesrapporte.
Ein Modul aufs Mal. Alt-Tools nie löschen.
