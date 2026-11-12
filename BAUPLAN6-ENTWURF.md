# Bauplan 6 (Entwurf) — Folgeaufträge aus dem Pilot

Stand November 2026. Vereinbart mit dem ersten Pilotkunden nach der Demo.
Die Schritte 1 (Offerte ↔ Ausmass) und 2 (Kreditoren/Debitoren mit
Kontoauszug-Import) sind in Arbeit. Die folgenden Schritte werden erst nach
neuem Beschluss gebaut, in dieser Reihenfolge.

Voraussetzung vor Schritt 4: schriftliche Vereinbarung mit dem Pilotkunden
(Kostenbeteiligung, Rechte bleiben beim Lizenzgeber, Ausstieg).

## Schritt 3 — Mahnwesen (als nächster Bau beschlossen, 12.11.2026)
- Ziel: überfällige Rechnungen mahnen statt nur markieren.
- Mahnstufen (Zahlungserinnerung, 1. und 2. Mahnung) mit Datum und Frist
  an der Rechnung; Mahn-PDF mit neuem QR-Zahlteil über den offenen Betrag.
- Offen mit Tobias: Fristen pro Stufe, Mahngebühren und Verzugszins (ja/nein,
  wie hoch), Text der Stufen.
- Grundsatz aus dem Pilot: Beträge immer exakt, nie runden.

## Schritt 4 — Offertanfragen einlesen
- Ziel: Ausschreibungen mit Positionen, Mengen, Einheiten, Texten und
  Bedingungen übernehmen, ohne Abtippen.
- Primär: Import SIA 451 (Austauschformat für NPK-Leistungsverzeichnisse),
  exakt und vollständig.
- Ausweichlösung: PDF einlesen, Vorschlag anzeigen, Nutzer prüft und
  bestätigt. «1:1 aus jedem PDF» ist nicht zuverlässig erreichbar.
- Benötigt vom Eigentümer: 2–3 echte Offertanfragen (PDF, falls vorhanden
  SIA 451, Texte dürfen geschwärzt sein) und den Ausschnitt aus dem
  TB-Viewer. NPK-Texte nur aus der Lizenz des jeweiligen Nutzers, nie im Repo.

## Schritt 5 — Server mit Benutzern und Rollen (Mehrbenutzer)
- Reiner Geräte-Sync genügt nicht: Mitarbeiter dürfen nur eigene Stunden
  sehen, der Buchhalter nur Kreditoren/Debitoren/Auswertung.
- Synchronisation über CouchDB (passt zu PouchDB), Hosting in der Schweiz
  (z. B. Infomaniak), offline-first bleibt: Erfassung offline, Sync bei Empfang.
- Rollen: Bauführer (alles), Mitarbeiter (nur eigene Stunden),
  Buchhalter (Kreditoren, Debitoren, Controlling), später Polier.
- Mitlaufend anpassen: Datenschutzerklärung, AVV (Lizenzgeber wird
  Auftragsbearbeiter mit Server), Preisliste (Stufe 3), Lizenzvertrag,
  Website-Text «Daten bleiben auf Ihrem Gerät», Backup-Konzept Server.
- Widerspricht der Grundregel in CLAUDE.md («Sync noch NICHT bauen») —
  CLAUDE.md bei Beschluss anpassen.

## Schritt 6 — Stundenerfassung pro Mitarbeiter
- Schlanke Handy-Ansicht: Datum, Baustelle, Stunden, Bemerkung; fliesst
  ins Stundenkonto (LMV) und in die Rapporte.
- Polier-Modus bleibt bestehen (für spätere Kunden).
- Setzt Schritt 4 voraus (Benutzerkonten).

## Schritt 7 — Buchhalter-Zugang
- Weitere Rolle mit Zugriff auf Kreditoren, Debitoren und Controlling.
- Setzt Schritt 4 voraus.

## Schritt 8 — Buchhaltung (ganz am Schluss)
- Keine eigene Finanzbuchhaltung (Haftung, Geschäftsbücherverordnung,
  MWST-Abrechnung), sondern Schnittstelle zum Programm des Treuhänders
  (Bexio, Banana, Abacus o. ä.): Buchungen, Belege, Stunden exportieren.
- Benötigt: Welches Programm nutzt der Treuhänder des Pilotkunden?
