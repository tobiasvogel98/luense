# Regressions-Tests

Automatische Prüfung der App im Browser (Playwright, Chromium). Der Ordner
`tests/` gehört nicht zur App: `werkzeuge/bereitstellen.sh` und `sw.js`
liefern ihn nicht aus.

## Starten

```sh
tests/alle.sh              # alle Tests, etwa 5 bis 6 Minuten
tests/alle.sh --schnell    # nur Rauchtest, etwa 30 Sekunden
tests/alle.sh offerte bank # nur einzelne Tests
```

`alle.sh` startet `python3 -m http.server` auf einem freien Port (nur
127.0.0.1), führt die Tests nacheinander aus, stoppt den Server immer und
zeigt am Schluss «Test X: OK» oder «Test X: FEHLER (n)». Bei Fehlern ist
der Exit-Code nicht 0.

Ein einzelner Test geht auch direkt, wenn schon ein Server läuft:

```sh
LUENSE_PORT=8000 node tests/offerte.js
```

Umgebungsvariablen:

* `LUENSE_PORT` oder `LUENSE_URL`: Adresse der App
* `LUENSE_AUSGABE`: Ordner für Protokolle, Bildschirmfotos, PDF und
  camt-Testdateien (sonst ein neuer Temp-Ordner)
* `LUENSE_PYLIB`: Ordner mit `zxingcpp` und `numpy` für die QR-Prüfung
  (wird als PYTHONPATH verwendet; alternativ `tests/pylib/` oder
  `pip install zxing-cpp numpy`). Fehlt zxing-cpp, wird die QR-Prüfung
  mit Hinweis übersprungen statt als Fehler gezählt.

Voraussetzungen: Node mit dem Modul `playwright` und Chromium, Python 3,
`pdftotext`, `pdfinfo` und `pdftoppm` (poppler-utils).

Jeder Test läuft in einem eigenen, frischen Browser-Kontext mit eigener
Datenbank. Echte Daten werden nie berührt. Alle Testdaten und
camt-Dateien sind synthetisch.

## Was geprüft wird

| Test | Inhalt |
| --- | --- |
| `rauchtest` | Beispielbaustelle laden, alle 12 Module und der Stamm auf Handy 390 × 844 (hell) und Laptop (dunkel): Inhalt da, keine horizontale Scrollbar, Touch-Ziele mindestens 44 px, keine Gedankenstriche und kein scharfes S, keine Konsolenfehler |
| `offerte` | Migration MWST-Satz, Warnung MWST-Nr. fehlt, Sperre der angenommenen Offerte, PDF exakt, Kopie als Arbeitsversion (nie annehmbar), Rechenweg, Grabenrechner, Sprung aus dem Ausmass mit Kopienwahl, Rechenweg im Baustellen-Ausmass |
| `rechnung-mwst` | Firma MWST-pflichtig: Vorschau, festgehaltener Satz, Tabelle, Rechnungs-PDF, QR-Betrag dekodiert, Handy dunkel |
| `mwst-pflicht` | Schalter «MWST-pflichtig» aus: Rechnung, Offerte, Mahnung nur mit Total und Vermerk, QR-Betrag, Entwürfe neu rechnen, Kreditoren ohne Vorsteuer, Controlling, Schalter wieder ein |
| `rueckfrage` | Rückfrage beim Stellen einer Rechnung mit MWST bei nicht pflichtiger Firma (v60), Offert-Kopie mit 0 % |
| `kreditor` | Netto, Vorsteuer, brutto, Migration, QR-Scan (Attrappe), Visum, camt mit Skonto, Controlling S1, Dossier |
| `bank` | camt.053 und camt.054: zugeordnet, Rückfall über Text und IBAN, Teilzahlung, Skonto, Sammelbuchung, Doppelimport |
| `mahnung` | Verzugszins, Tagesgrenzen, Stufen, Teilzahlung, Zinsanrechnung nach Art. 85 OR, Betreibung, CSV, Mahn-PDF mit QR, Sprachregeln über alle Module und PDF |
| `versand` | Hinweis «Heute fällig», Erstellen und senden mit Attrappen für Teilen und Zwischenablage, mailto, E-Mail-Prüfung, Warnung alter Kontoauszug |
| `journal` | Eintrag mit Foto (verkleinert auf 1600 px, JPEG), Regie zu Nachtrag, Suche, Fotobericht, Gerätekatalog, Nummernvergabe |

Hilfsfunktionen für neue Tests stehen in `tests/hilfe.js`.
