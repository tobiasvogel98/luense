# Bauplan — Abschnitte 4 bis 7 (der komplette Rest bis zur fertigen Stamm-App)

Anschluss an BAUPLAN.md (Abschnitt 1) und BAUPLAN2.md (Abschnitte 2–3).
Es gelten weiterhin: CLAUDE.md-Regeln, ein Abend = ein Auftrag + Abnahme-Test
+ Commit, nichts vorziehen, Suva bleibt ein eigenes Programm und wird NICHT
eingebaut.

WICHTIG — Altbestand bereitstellen: Lege vor Abschnitt 5 und 6 Kopien der
bestehenden Tools in einen Ordner `altbestand/` im Projekt (Grabenrechner/
Ausmass-Tool, das echte Cockpit-HTML, Sitzungsprotokoll-App). Claude Code
soll deren Logik LESEN und ÜBERNEHMEN, nicht neu erfinden. Der Ordner kommt
in .gitignore (enthält evtl. echte Daten).

---

## Abschnitt 4 — Protokoll-Engines

### Abend 4.1 — Generisches Protokoll-Grundgerüst
Auftrag: Baue module/protokolle.js: EINE Engine, die Protokolltypen aus einer
Definition rendert (Abschnitte, Felder, Tabellen, Checklisten). Dokumenttyp
«protokoll» mit Feld unterTyp. Übersicht je Baustelle: alle Protokolle
chronologisch, nach unterTyp filterbar.
**Fertig wenn:** Ein Dummy-Typ («Testprotokoll» mit 3 Feldern) lässt sich
anlegen, ausfüllen, speichern, wiederfinden — ohne Engine-Änderung.

### Abend 4.2 — Sitzungs-Engine
Auftrag: Sitzungsprotokoll als Typ: Kopf (Sitzungsart, Datum, Teilnehmende),
Traktanden-Tabelle (Thema, Besprochenes, Beschluss, Wer, Termin), zwei
Vorlagen: Jour fixe und Bauführersitzung. Aktion «Beschlüsse → Pendenzen»
(erzeugt Pendenz je Beschluss mit Wer/Termin). Protokoll-PDF über kern/pdf.js.
**Fertig wenn:** Eine Sitzung erfasst, drei Beschlüsse landen per Klick in
den Pendenzen, PDF sieht vorzeigbar aus.

### Abend 4.3 — Handschrift & Diktat (aus der Sitzungsprotokoll-App)
Auftrag: Übernimm aus altbestand/ die Canvas-Handschrift-Erfassung als
kern/handschrift.js: Skizze/Notiz zeichnen, als Bild am Protokoll oder
Ereignis speichern. OCR (Text aus Handschrift) nur als Online-Zusatz, klar
als solcher markiert — offline bleibt das Bild erhalten, nichts geht verloren.
**Fertig wenn:** Handnotiz am Handy gezeichnet, gespeichert, nach Neuladen da;
offline funktioniert alles ausser der Texterkennung.

### Abend 4.4 — Begehungs-Engine
Auftrag: Begehung als Typ: Checklisten-Vorlagen (frei definierbar, je Punkt
i. O. / Mangel / nicht zutreffend + Bemerkung). Ein «Mangel» erzeugt
automatisch ein Journal-Ereignis (Tag Mangel, mit Foto-Möglichkeit) und
verlinkt zurück. Begehungs-PDF.
**Fertig wenn:** Eine Begehung mit 5 Punkten, davon 1 Mangel → Journal-Eintrag
existiert und verweist auf die Begehung.

### Abend 4.5 — Abnahme-Engine mit Unterschrift
Auftrag: Abnahme als Typ: Mängelliste (Mangel, Frist, Status offen/behoben),
Nachkontrolle, kern/signatur.js (Canvas-Unterschrift, als Bild am Dokument).
Abnahmeprotokoll-PDF mit Unterschrift.
**Fertig wenn:** Abnahme mit 2 Mängeln erfasst, unterschrieben, PDF erzeugt;
Mangel auf «behoben» setzen aktualisiert die Liste.

### Abend 4.6 — Kalibrier- & Abgrenzungsprotokoll + Abschnitts-Abnahme
Auftrag: Die bestehenden Kalibrierungs- und Abgrenzungsprotokolle als Typen
der Engine nachbauen (Struktur aus altbestand/ übernehmen). Danach /abnahme
über den ganzen Abschnitt 4.
**Fertig wenn:** Beide Typen ausfüllbar und als PDF druckbar; Abschnitts-
Abnahme bestanden.

---

## Abschnitt 5 — Ausmass, Grabenrechner, Nachträge

### Abend 5.1 — Ausmass-Modul
Auftrag: module/ausmass.js: NPK-Positionen je Baustelle (Nr., Text, Einheit,
Vertragsmenge, ausgemessene Menge, EP, Betrag), Summen, Fortschritt je
Position in %; Menge über Vertragsmenge wird rot markiert (Nachtrags-
Frühwarnung). Struktur und Rechenlogik aus dem bestehenden Ausmass-Tool
(altbestand/) übernehmen. Import der bestehenden Ausmass-Daten als Probelauf.
**Fertig wenn:** Positionen einer echten Baustelle erfasst/importiert, Beträge
stimmen mit dem Alt-Tool überein (Stichprobe 5 Positionen).

### Abend 5.2 — Grabenrechner integrieren
Auftrag: Grabenrechner aus altbestand/ als Teil des Ausmass-Moduls: rechnen
(Trapezquerschnitt, Aushub, Auffüllung abzügl. Rohr, alle bestehenden
Rechenarten übernehmen) und Ergebnis per Klick in eine gewählte NPK-Position
übernehmen.
**Fertig wenn:** Drei Kontrollrechnungen liefern dieselben Werte wie das
Alt-Tool; Übernahme in Position funktioniert.

### Abend 5.3 — Nachtrags-Modul
Auftrag: module/nachtrag.js: Nachtrag mit Nummer, Titel, Sachverhalt, Basis
(SIA-118-Feld), Summe; Status-Pipeline erkannt → gemeldet → offeriert →
genehmigt → verrechnet; Beweise als Verknüpfungen auf Ereignisse, Rapporte
und Ausmass-Positionen. Kacheln: Summe offen / genehmigt. Regie-Ereignis im
Journal erzeugt automatisch einen Nachtrag im Status «erkannt» (bestehende
Pendenz-Automatik anpassen: Pendenz verweist auf den Nachtrag).
**Fertig wenn:** Kette komplett durchspielbar: Regie-Foto → Nachtrag →
Status bis genehmigt → Summen stimmen.

### Abend 5.4 — Nachtrags-PDF & Regierapport-Verbindung
Auftrag: Nachtrags-PDF: Begründung (Sachverhalt, Basis, Forderung) plus
automatische Beweisliste (verknüpfte Fotos mit Zeitstempel, Rapporte,
Ausmass). Rapporte mit Regie-Stunden lassen sich einem Nachtrag zuordnen.
**Fertig wenn:** Ein Nachtrag erzeugt ein versandfertiges PDF mit allen
Beweisen; /abnahme über Abschnitt 5 bestanden.

---

## Abschnitt 6 — Auswertung (Cockpit), Dossier, Offertrechner

### Abend 6.1 — Datengrundlage Kosten & Leistung
Auftrag: Kläre und baue die Kennzahlen-Basis: Leistung = Ausmass-Summe +
genehmigte Nachträge + verrechnete Regie; Kosten = monatliche Erfassung je
Baustelle und Kostenart (Lohn, Material, Inventar, Fremdleistungen, Übrige)
— Eingabemaske Monatswerte, Dokumenttyp «kosten». KEINE Prognose-Logik
erfinden: die kommt an 6.2 aus dem echten Cockpit.
**Fertig wenn:** Für eine Baustelle sind Leistung (gerechnet) und Kosten
(erfasst) sichtbar und nachvollziehbar.

### Abend 6.2 — Cockpit-Logik übernehmen
Auftrag: Lies das echte Cockpit aus altbestand/ und ÜBERNIMM die
FO-5.1.01-Rechenlogik (Kostenarten-Auswertung, Fertigstellungsgrad,
Prognose Endkosten/Ergebnis, Ampelregeln) 1:1 in module/auswertung.js.
Jede Abweichung von der Alt-Logik ist ein Fehler, keine Verbesserung —
Verbesserungen erst NACH bestandenem Abgleich.
**Fertig wenn:** Für zwei Baustellen liefern Alt-Cockpit und neues Modul mit
denselben Eingabedaten dieselben Zahlen (Abgleich dokumentiert).

### Abend 6.3 — Übersichten & Ampel
Auftrag: Gesamttabelle aller Baustellen (Auftrag inkl. NT, Leistung, Kosten,
Fertigstellungsgrad, Prognose-Marge, Ampel) plus Detailsicht je Baustelle
(Kostenarten Vorgabe/Ist, Monatsverlauf). Zeile antippen wählt die Baustelle.
**Fertig wenn:** Die Übersicht zeigt alle Baustellen korrekt; Statuswechsel
eines Nachtrags bewegt die Zahlen sofort.

### Abend 6.4 — Abgleichs-Betrieb (Kalenderzeit!)
Auftrag: JSON-Brücke: Export aus dem neuen System in ein Format, das sich
mit dem Alt-Cockpit vergleichen lässt; Abgleich-Checkliste je Monatsabschluss.
Dieser Abend hat KEINEN Bau-Schwerpunkt, sondern eine Regel: Das Auswertungs-
Modul wird erst nach ZWEI stimmigen Monatsabschlüssen (z. B. September und
Oktober) führend. Bis dahin bleibt das alte Cockpit die Referenz.
**Fertig wenn:** Erster Monatsabgleich durchgeführt und dokumentiert.

### Abend 6.5 — Baustellen-Dossier
Auftrag: module/dossier.js: eine Seite je Baustelle — Kopf (Bauherr, Termine),
Kennzahlen-Kacheln, Zeit vs. Leistung, alle offenen Posten (Nachträge,
Regierapporte, Pendenzen, Abnahme-Mängel) mit Absprung ins Modul,
Meilensteine, Kontakte (neuer Dokumenttyp «kontakt» am Baustellen-Stamm),
letzte Journal-Ereignisse. Dossier-PDF.
**Fertig wenn:** Das Dossier einer echten Baustelle beantwortet «wo stehen
wir?» ohne einen zweiten Klick.

### Abend 6.6 — Offertrechner
Auftrag: module/offert.js: NPK-Positionskatalog (eigene Positionen pflegbar),
Offerte zusammenstellen (Menge, EP, Beträge live), Zusammenzug mit Rabatt,
Skonto, MWST; Offerten-Verwaltung mit Status Entwurf → eingereicht →
angenommen; «angenommen» erzeugt per Klick eine neue Baustelle mit
Werkvertrag = Offertsumme und den Offert-Positionen als Ausmass-Vorlage
(Vertragsmengen). Offert-PDF.
**Fertig wenn:** Von leerer Offerte bis neuer Baustelle mit Ausmass-Vorlage
in einem Durchlauf, Zusammenzug rechnerisch geprüft.

---

## Abschnitt 7 — Mehrgeräte-Sync (erst wenn wirklich gebraucht)

### Abend 7.1 — Server einrichten
Auftrag: CouchDB auf Raspberry Pi (oder VPS) aufsetzen, Zugriff über
Tailscale/VPN statt offener Ports, TLS. Schritt-für-Schritt-Anleitung als
SERVER.md ins Repo (ohne Zugangsdaten!).
**Fertig wenn:** CouchDB vom Handy und Laptop aus erreichbar (im VPN).

### Abend 7.2 — Sync einbauen
Auftrag: kern/sync.js: PouchDB-Live-Sync mit der CouchDB, Statusanzeige in
der Shell (synchron / ausstehend / offline), einfaches Konfliktverhalten
(letzter Schreiber gewinnt, Konflikte werden geloggt und angezeigt).
**Fertig wenn:** Ereignis am Handy erfasst erscheint am Laptop; Offline-
Erfassung synct beim nächsten Kontakt nach.

### Abend 7.3 — Backup-Automatik & Notfallprobe
Auftrag: Nächtlicher Dump der CouchDB auf Disk (Skript auf dem Pi),
Aufbewahrung 30 Tage. Danach die volle Notfallprobe: Gerät «verloren»
(Browserdaten löschen) → aus Sync wiederhergestellt; Server «tot» →
aus Dump wiederhergestellt.
**Fertig wenn:** Beide Notfallproben bestanden und in WOCHENLOG.md notiert.

---

## Definition of done — Gesamtsystem
- Alle Module führend, Betriebsstatus-Anzeige überall auf «führend»
- Auswertung nach zwei stimmigen Monatsabschlüssen führend, Alt-Cockpit
  eingefroren als Archiv (nie löschen)
- Alt-Tools eingefroren, je ein letzter Export archiviert
- Backup-Automatik läuft, Notfallproben bestanden
- Eine Woche Vollbetrieb ohne Rückgriff auf ein Alt-Tool
