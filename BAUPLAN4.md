# Bauplan — Abschnitt 8 (Beschlüsse vom 31.08.2026)

Fünf beschlossene Ausbauten. START ERST NACH dem Demo-Termin und der laufenden
Live-Testwoche — bis dahin bleibt die Oberfläche eingefroren. Es gelten
CLAUDE.md und die bekannten Regeln (ein Abend = Auftrag + Abnahme-Test +
Commit). Hinweis Protokoll: Mit Abend 8.4 ist die frühere Parkierung
«Abrechnung» für Stufe 1 offiziell aufgehoben; Stufe 2 (Abend 8.5) ist
bewusst NICHT terminiert.

Empfohlene Reihenfolge: 8.1 → 8.2 → 8.3 → 8.4. (8.2 vor 8.4, weil die
Rechnungen auf den Datumsstempeln aufbauen.)

## Abend 8.1 — Navigation links (1–2 h)
Auftrag: Baue die Modul-Navigation um: Auf Desktop (ab ca. 900 px) eine FESTE
Seitenleiste links im Cockpit-Stil — Module gruppiert (Übersicht / Erfassung /
Verwaltung / Wissen), aktives Modul markiert, Badges für offene Pendenzen und
Nachträge. Auf Mobile dieselbe Navigation EINKLAPPBAR (Hamburger öffnet die
Leiste als Overlay von links, Schliessen per Tap daneben). Keine Änderung an
Logik oder Daten, reine Darstellung; Service-Worker-Version erhöhen.
**Fertig wenn:** Desktop zeigt die Leiste fix links, Handy klappt sie sauber
ein/aus, alle Module bleiben erreichbar, Update kommt auf dem Handy an.

## Abend 8.2 — Datumsstempel für Nachträge & Regierapporte (1–2 h)
Auftrag: Jeder Statuswechsel bei Nachträgen (erkannt→…→verrechnet) und
Regierapporten (offen→unterschrieben→verrechnet) erhält einen Datumsstempel;
bestehende Dokumente bekommen beim ersten Öffnen einen Verlauf mit dem
heutigen Datum als Startpunkt. Anzeige: kleiner Verlauf am Dokument («gemeldet
02.09. · offeriert 05.09. …»), dazu ein «Status zurück»-Knopf für Fehlklicks
(mit Stempel-Korrektur). Die Stempel erscheinen auch im Nachtrags-PDF
(wichtig für SIA-118-Fristen/Anzeige).
**Fertig wenn:** Statuswechsel erzeugt sichtbaren Stempel, zurück funktioniert,
PDF zeigt den Verlauf.

## Abend 8.3 — Excel-Export (2–3 h)
Auftrag: Erweitere kern/export.js um Tabellen-Exporte, die Excel direkt
öffnet: CSV (Trennzeichen Semikolon, UTF-8 mit BOM, CH-Zahlenformat) für
Ausmass je Baustelle, Nachtragsliste, Regierapporte, Pendenzen und die
Cockpit-Gesamttabelle — Auslösung je Modul über einen Export-Knopf.
KEINE neue Bibliothek (CLAUDE.md-Regel); CSV genügt für Excel.
Falls später echte .xlsx-Dateien gewünscht sind: separater Beschluss nötig,
weil dafür eine zweite lokale Bibliothek (SheetJS) in CLAUDE.md erlaubt
werden müsste.
**Fertig wenn:** Jede der fünf Tabellen öffnet sich per Doppelklick korrekt in
Excel (Umlaute, Zahlen, Spalten stimmen).

## Abend 8.4 — Rechnungsablage & -verwaltung (3–5 h)
Auftrag: Neues Modul module/rechnung.js, Darstellung im Cockpit-Stil
(Tabelle mit Summenzeile, Kacheln oben). Dokumenttyp «rechnung»:
Nummer (fortlaufend je Jahr), Datum, Baustelle, Titel, Betrag, Basis
(Verknüpfung auf Regierapport, Nachtrag oder manuell), Status
offen → gestellt → bezahlt (mit Datumsstempeln wie 8.2).
Kern der Sache — die Kleinbaustellen-Automatik:
- Bei einem Regierapport mit Status «unterschrieben» erscheint der Knopf
  «→ Rechnung erstellen» (Betrag aus Stunden × Regieansatz, editierbar).
- Bei einem Nachtrag mit Status «genehmigt» ebenso (Betrag = Nachtragssumme).
- Die erzeugte Rechnung verlinkt zurück; der Regierapport/Nachtrag springt
  bei «gestellt» automatisch auf «verrechnet».
Rechnungs-PDF über kern/pdf.js (Kopf, Positionen/Basis, Beträge,
Zahlungsfrist als Feld). Kacheln: offen / gestellt / bezahlt je Baustelle und
gesamt; die Summe «gestellt, nicht bezahlt» erscheint zusätzlich im
Baustellen-Dossier. Export gemäss 8.3 auch für die Rechnungsliste.
**Fertig wenn:** Kette läuft durch: Regierapport unterschrieben → Rechnung →
PDF → Status bezahlt; Zahlen in Kacheln, Dossier und Export stimmen überein.

## Abend 8.5 — Abrechnung Stufe 2 (SPÄTER — bewusst nicht terminiert)
Umfang, wenn er dereinst beschlossen wird: Rechnungen aus Ausmass und Offerte
(Menge ausgemessen × vereinbarter EP je NPK-Position), Akonto- und
Schlussrechnung mit Soll-Ist-Vergleich, SIA-118-konform, evtl. Schweizer
QR-Rechnung. Voraussetzung: Erfahrungen aus den ersten Kundengesprächen.
NICHT bauen ohne neuen Beschluss.
