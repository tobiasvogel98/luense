# Bauplan 6 (Entwurf) — Folgeaufträge aus dem Pilot

Stand November 2026. Vereinbart mit dem ersten Pilotkunden nach der Demo.
Die Schritte 1 (Offerte ↔ Ausmass) und 2 (Kreditoren/Debitoren mit
Kontoauszug-Import) sind in Arbeit, Schritt 3 (Mahnwesen) ist gebaut. Die folgenden Schritte werden erst nach
neuem Beschluss gebaut, in dieser Reihenfolge.

Voraussetzung vor Schritt 4: schriftliche Vereinbarung mit dem Pilotkunden
(Kostenbeteiligung, Rechte bleiben beim Lizenzgeber, Ausstieg).

## Schritt 3 — Mahnwesen (gebaut, 12.11.2026)
- Ziel: überfällige Rechnungen mahnen statt nur markieren. Die App
  verschickt nichts — sie zeigt, welche Rechnung für welche Stufe fällig ist,
  hält die erstellte Stufe an der Rechnung fest und erstellt das Mahn-PDF.
- Entscheide Tobias:
  - Drei Stufen in fester Reihenfolge (kein Überspringen): Zahlungserinnerung
    nach 30, 1. Mahnung nach 60, 2. Mahnung nach 75 Tagen — gezählt ab
    **Rechnungsdatum**, nicht ab Fälligkeit. Die drei Werte stehen in den
    Firmendaten (⚙ Stamm) und sind dort änderbar.
  - Kosten nach OR: **keine Mahngebühr** (bräuchte eine Vertragsabrede).
    **Verzugszins 5 % p. a.** (Art. 104 Abs. 1 OR). Verzug ab der
    Zahlungserinnerung (gilt als Mahnung nach Art. 102 Abs. 1 OR): Zins auf
    dem offenen Betrag inkl. MWST vom Datum der Zahlungserinnerung bis zum
    Datum der jeweiligen Mahnung, Tage effektiv / 365, kaufmännisch auf den
    Rappen (nie auf 5 Rappen). Zahlungserinnerung ohne Zins; 1. und
    2. Mahnung mit eigener Zinszeile, im QR-Betrag enthalten.
  - Bezahlt ist eine Rechnung erst, wenn Kapital UND verrechneter
    Verzugszins bezahlt sind. Verrechnet ist der Zins der LETZTEN Mahnung
    (jede rechnet ab der Zahlungserinnerung bis zu ihrem Datum, nie
    zusammenzählen). Geschuldet = Total inkl. MWST + dieser Zins; offen =
    geschuldet − Zahlungen (kern/zahlung.js). Zahlungen tilgen zuerst das
    Kapital: wer nur das Kapital zahlt, bleibt «teilbezahlt» mit dem Zins
    als Rest («davon Verzugszins»). Zurücknehmen der Mahnung nimmt den Zins
    wieder weg. Der Zins ist kein Werkvertrags-Ertrag: Controlling B1/B2
    bleibt bei den Netto-Rechnungsbeträgen.
  - Zins der nächsten Mahnung auf dem offenen Kapital am Mahndatum (ohne
    bereits verrechneten Zins); er fällt nie unter den schon verrechneten.
    Ist nur noch Zins offen, wird keine weitere Stufe fällig.
  - Nach der 2. Mahnung: Vermerk «Betreibung eingeleitet» (Datum,
    Betreibungs-Nr., Notiz) an der Rechnung, zurücknehmbar, ändert keine
    Beträge. Tage effektiv / 365; Mahndatum = heute.
  - Texte je Stufe sachlich und höflich (Erinnerung: «möglicherweise
    übersehen»; 1. Mahnung bestimmt mit Hinweis auf Art. 102/104 OR;
    2. Mahnung bestimmt, weitere Schritte, insbesondere Betreibung,
    vorbehalten). Als Konstanten in module/rechnung.js, leicht anpassbar.
- Umsetzung: Marke «Zahlungserinnerung fällig» / «1. Mahnung fällig» /
  «2. Mahnung fällig» in den Rechnungen und in «Offene Posten alle
  Baustellen» (mit Kachel «Mahnstufe fällig»). Knopf «Mahnung erstellen»
  speichert `mahnungen: [{ stufe, datum, offenRappen, zinsRappen, zinsVon,
  zinsBis, zinsProzent, fristTage }]` an der Rechnung und öffnet das PDF:
  Briefkopf aus den Firmendaten, Bezug zur Rechnung (Nr., Datum, Betrag
  inkl. MWST, bereits bezahlt, offen), Verzugszins, neue Zahlungsfrist
  10 Tage, QR-Zahlteil auf eigener Seite mit derselben SCOR-Referenz.
  Die letzte Stufe lässt sich zurücknehmen; ihr PDF jederzeit neu öffnen.
  Marke und Hauptaktion («Mahnung erstellen», «Betreibung eingeleitet»)
  stehen in der ersten Tabellenspalte — auf dem Handy ohne seitliches
  Scrollen. Excel-Export mit Verzugszins, Mahnstufe, fälliger Stufe und
  Betreibung.
- Fällig nur für gestellte bzw. teilbezahlte Rechnungen mit offenem Betrag.
  Die nächste Stufe wird erst fällig, wenn auch die 10-Tage-Frist der
  vorherigen Stufe abgelaufen ist (greift nur, wenn spät gemahnt wurde).
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
