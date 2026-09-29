# Bauplan 5 — ENTWURF (Stand 29.09.2026, noch kein Beschluss)

Grundlage: Rückmeldung von Tobias' Bekanntem (selbstständig, Sorba-Nutzer)
vom September 2026. Zwei Aussagen wurden geprüft; daraus abgeleitet sind
die möglichen Abschnitte 9 und 10 sowie — nur als Anforderungsbild, NICHT
zum Bauen — der Anhang «Was ein echter Finanzteil bräuchte».

---

## Prüfung Aussage 1: «Ein ERP sollte dem Landesmantelvertrag folgen»

**Die Aussage stimmt — mit einer wichtigen Präzisierung.**

Der Landesmantelvertrag (LMV) ist der Gesamtarbeitsvertrag des Schweizer
Bauhauptgewerbes zwischen dem Baumeisterverband (SBV) und den Gewerkschaften
Unia/Syna. Er wird vom Bundesrat **allgemeinverbindlich** erklärt — er gilt
also zwingend für praktisch alle Betriebe des Bauhauptgewerbes, auch
Nichtmitglieder, und die paritätischen Kommissionen kontrollieren die
Einhaltung. Seit 1.1.2026 gilt der neue **LMV 2026–2031** (Laufzeit 6 Jahre,
ca. 80'000 Mitarbeitende betroffen).

Präzisierung: Nicht «das ERP» muss dem LMV folgen, sondern **jeder Teil der
Software, der Arbeitszeit oder Lohn abbildet**, muss LMV-konforme Resultate
liefern. Für die reine Baustellenführung (Journal, Ausmass, Nachträge,
Offerten, Rechnungen) gibt es keine LMV-Vorgaben. Betroffen wären in Lünse:
die Stunden in den Tagesrapporten (heute Leistungsnachweis, nicht
Lohngrundlage) und ein allfälliger späterer Lohnteil.

### Was der LMV 2026 konkret regelt (das müsste Software abbilden)

- **Jahresarbeitszeit 2'112 h**; ab 2027 Umstellung aufs Kalenderjahr
  (2026 ist Übergangsjahr Mai–Dezember).
- **Zwei Arbeitszeitmodelle** ab 2027: klassischer Arbeitszeitkalender
  (Stundensaldo −20 bis +120 h) oder «ausgeglichenes Modell» mit konstanter
  Tagesarbeitszeit (Saldo −50 bis +120 h). Abrechnung per 31.12.
- **Zuschläge:** 25 % ab 50 Wochenstunden; Samstagsarbeit 25 %
  (meldepflichtig); unterjährige Auszahlung bis 100 h möglich.
- **Reisezeit:** getrennt von der Jahresarbeitszeit; bis 2028 sind 30 min/Tag
  unbezahlt (abgegolten über die Zulage), ab 2029 25 min, ab 2030 20 min,
  ab 2031 bezahlt ab Minute 21. Tageslimiten 60 bzw. 90 min je Modell.
- **Baustellenzulage** (Spesencharakter, keine Sozialabgaben):
  CHF 4.–/Arbeitstag 2026, CHF 6.50 ab 2027, CHF 9.– ab 2028.
- **Mindestlöhne** nach Lohnklassen, an den LIK gekoppelt (2026 kein
  Teuerungsausgleich, 2027–2028 80 % in Franken, danach Sonderregeln).
- **Langzeitferienkonto** (optional): Aufbau über Überstunden, max. 200 h/Jahr.
- **Krankentaggeld** neu 80 % des Lohns, Aufschub bis 60 Tage möglich.

### Folgerung für Lünse

Lünse rechnet heute keine Löhne — muss es auch nicht. Aber die
**Stundenerfassung sollte LMV-tauglich strukturiert** sein, damit (a) der
Treuhänder/das Lohnbüro direkt damit arbeiten kann und (b) ein späterer
Lohnteil andocken könnte, ohne die Rapporte umzubauen. Das ist Abschnitt 10.

---

## Prüfung Aussage 2: «Debitoren und Kreditoren verknüpfen, teils automatisch erfassen»

**Die Aussage stimmt, und sie passt exakt zur bestehenden Architektur.**

- **Debitoren** (unsere Rechnungen an Kunden) gibt es seit Abend 8.4 —
  inkl. Automatik aus Regierapporten und Nachträgen.
- **Kreditoren** (Rechnungen von Lieferanten/Subunternehmern an uns) fehlen
  komplett — dabei sind sie die Hälfte des Baustellenerfolgs: Die
  Selbstkosten (S-Zeilen im FO 5.1.01) tippt Tobias heute von Hand aus der
  Buchhaltung ab.
- **Teilautomatische Erfassung** ist in der Schweiz dank der
  **QR-Rechnung** realistisch: Der Swiss-QR-Code auf jeder Rechnung enthält
  Betrag, Währung, IBAN, Referenz und den Namen des Rechnungsstellers als
  strukturierte Daten. Auf dem Handy (Chrome/Android) kann die Kamera den
  Code nativ lesen (BarcodeDetector-API, offline, keine neue Bibliothek);
  wo die API fehlt (ältere Desktops), bleibt die Handeingabe.

## Abschnitt 9 — Kreditoren & Verknüpfung (Vorschlag)

### Abend 9.1 — Kreditoren-Modul (3–4 h)
Neues Modul `module/kreditor.js`, Dokumenttyp «kreditor», Gruppe Verwaltung.
Felder: Lieferant, Rechnungs-Nr., Datum, Betrag, Fälligkeit, Baustelle (KTR),
Kostenart passend zu den FO-Zeilen (Material / Fremdleistung / Inventar /
Entsorgung / Diverses), Beleg als Foto/PDF-Anhang (kern/kamera.js).
Status offen → visiert → bezahlt mit Datumsstempeln (wie 8.2), zurück-Knopf.
Kacheln je Baustelle und gesamt, Tabelle mit Summenzeile, Fälligkeits-
Warnung, Excel-Export (kern/export.js).
**Fertig wenn:** Eine Lieferantenrechnung mit Belegfoto erfasst, visiert,
bezahlt ist; Kacheln, Export und 375-px-Ansicht stimmen.

### Abend 9.2 — QR-Rechnung scannen (2–3 h)
Im Kreditoren-Formular Knopf «QR scannen»: Kamera an, Swiss-QR-Code lesen,
Betrag/IBAN/Referenz/Absender automatisch einfüllen (Rest von Hand).
Rückfallebene ohne BarcodeDetector: Hinweis + Handeingabe. Kein CDN, keine
Bibliothek — native API.
**Fertig wenn:** Eine echte QR-Rechnung (Papier abfotografieren) füllt das
Formular korrekt; ohne Kamera-API erscheint der Hinweis.

### Abend 9.3 — Debi/Kredi ↔ Controlling verknüpfen (2–3 h)
Der FO-Monatsabschluss schlägt live vor (Übernehmen per Knopf, nie
Automatik — die Hoheit bleibt beim Abschluss):
- B-Zeilen (Fakturen) aus den **Debitoren**-Rechnungen bis zum Stichtag
  (B1 Ausmass-/Akonto, B2/B3 Regie je nach Basis der Rechnung),
- S-Zeilen (Selbstkosten) aus den **Kreditoren** bis zum Stichtag,
  gruppiert nach Kostenart,
- W1 aus dem Werkvertrag der Baustelle (steht seit der Offerten-Übernahme).
Dossier: neue Kachel «Kreditoren offen»; offene Posten zeigen überfällige
Kreditoren. Rechnung (Debitor) und Kreditor zeigen ihre Baustelle im Export.
**Fertig wenn:** Vorschlagswerte stimmen mit von Hand gerechneten überein
und erscheinen NUR nach Knopfdruck im Formular.

### Abend 9.4 — Lieferschein-Abgleich (2 h, optional)
Material-Zeilen der Tagesrapporte als Checkliste beim Visieren einer
Kreditorenrechnung («wurde geliefert, was verrechnet wird?») — reine
Anzeige-Hilfe, keine Automatik.

## Abschnitt 10 — LMV-taugliche Stunden (Vorschlag)

### Abend 10.1 — Mitarbeiter-Stammdaten light (2 h)
Dokumenttyp «mitarbeiter» (Name, Lohnklasse als Info, Modell
Arbeitszeitkalender/ausgeglichen, Soll-Stunden-Kalender). Keine Löhne.

### Abend 10.2 — Stundenkonto aus Rapporten (3 h)
Je Mitarbeiter: Ist-Stunden aus allen Tagesrapporten (über alle Baustellen)
gegen Soll gemäss Kalender → Saldo mit LMV-Bandbreiten-Warnung
(−20/+120 bzw. −50/+120), Samstag automatisch markiert (Zuschlag/
Meldepflicht), Reisezeit als eigenes Feld je Rapport-Arbeit.
Absenzarten im Rapport: Ferien, Krankheit, Unfall, Schlechtwetter, Schule.
**Fertig wenn:** Monatsblatt je Mitarbeiter stimmt mit Handrechnung überein.

### Abend 10.3 — Treuhänder-Export (1–2 h)
CSV je Mitarbeiter/Monat (Tage, Stunden, Zuschlagsart, Absenz, Baustelle) —
das Lohnbüro rechnet die Löhne, Lünse liefert die sauberen Grundlagen.

**Ausdrücklich NICHT in Abschnitt 10:** Lohnberechnung, Basislöhne,
Sozialabzüge, Lohnabrechnung. Begründung siehe Anhang.

---

## Anhang — Was ein ECHTER Finanzteil detailliert bräuchte
### (Anforderungsbild, bewusst NICHT terminiert)

Falls Lünse dereinst die Finanzen selbst führen soll, braucht es sauber
getrennt vier Blöcke. Ehrliche Einordnung: Jeder Block ist für sich ein
mehrmonatiges Projekt mit **jährlicher Pflegepflicht** (Gesetzes- und
Satzänderungen). Das ist der Grund, warum selbst grosse Bau-ERP oft an
Treuhand-Software anbinden statt alles selbst zu rechnen.

**1. Finanzbuchhaltung (Fibu)**
- Doppelte Buchhaltung nach OR 957 ff., KMU-Kontenrahmen (Käfer/Sterchi)
- Journal, Hauptbuch, Bilanz, Erfolgsrechnung, Jahresabschluss
- Revisionssicherheit: Belege 10 Jahre unveränderbar aufbewahren (GeBüV) —
  dafür reicht PouchDB allein nicht, es braucht ein Unveränderbarkeits-
  konzept (z. B. Beleg-Hashes, Sperrperioden)
- Mehrbenutzer mit Rollen/Berechtigungen → **setzt Abschnitt 7 (Sync)
  zwingend voraus**

**2. Mehrwertsteuer**
- Abrechnungsmethoden effektiv / Saldosteuersatz, Sätze 8.1 / 2.6 / 3.8 %
- Quartalsabrechnung, Umsatzabstimmung, Vorsteuer auf Kreditoren

**3. Nebenbücher Debitoren/Kreditoren (Vollausbau)**
- Offene-Posten-Listen, Mahnwesen (Stufen, Fristen)
- Eigene QR-Rechnungen mit Zahlteil (QR-Code-Erzeugung nach Swiss-
  Implementation-Guidelines, QR-Referenz mit Prüfziffer)
- Zahlungsläufe als pain.001 an die Bank, Kontoabgleich via camt.053/054
  (automatisches Ausziffern über die QR-Referenz), evtl. eBill
- Akonto-/Schlussrechnung SIA 118 mit Rückbehalt (= der bereits definierte,
  nicht terminierte Abend 8.5)

**4. Baulohn (der grösste Block)**
- LMV-Lohnarten: Basislöhne je Lohnklasse und Zone, 13. Monatslohn,
  Zuschläge (50-h-Grenze, Samstag, Nacht), Baustellenzulage nach Jahr,
  Reisezeitstaffel 2026–2031, Langzeitferienkonto
- Sozialversicherungen: AHV/IV/EO, ALV, UVG/UVG-Zusatz, KTG, BVG,
  FAR (frühzeitiger Altersrücktritt Bau), Parifonds-Beiträge
- Quellensteuer nach Kanton, Lohnausweis, Jahresmeldungen
- **Swissdec-Zertifizierung (ELM)** für elektronische Lohnmeldungen —
  faktisch Pflicht, damit ein Lohnprogramm ernst genommen wird
- Kontrollen der paritätischen Kommissionen (ISAB): jede Abweichung vom
  LMV fällt dem BETRIEB auf die Füsse, nicht der Software

**Empfehlung (Stand heute):** Blöcke 1, 2 und 4 nicht selbst bauen.
Lünse liefert stattdessen saubere, verknüpfte Grundlagen (Abschnitte 9
und 10) und exportiert an Treuhänder bzw. Buchhaltungssoftware. Block 3
teilweise selbst (QR-Zahlteil und Akonto/Schluss = Abend 8.5, wenn
beschlossen). So bleibt Lünse das, was es stark macht: das Baustellen-
Cockpit — und rechnet trotzdem vom ersten Beleg bis zum Baustellenergebnis
alles nach.

---

## Reihenfolge-Empfehlung

1. **Abschnitt 7 (Sync)** vorziehen, SOBALD die Zusammenarbeit mit einem
   Partner konkret wird — Mehrgeräte/Mehrbenutzer ist deren Voraussetzung.
2. Abschnitt 9 (Kreditoren + Verknüpfung) — grösster Alltagsnutzen,
   direkt auf Bestehendem.
3. Abschnitt 10 (LMV-Stunden) — macht Lünse «LMV-tauglich» im ehrlichen
   Sinn, ohne Lohnrisiko.
4. Abend 8.5 (Abrechnung Stufe 2) und Finanz-Anbindung: je nach Erfahrung
   aus den Kundengesprächen.
