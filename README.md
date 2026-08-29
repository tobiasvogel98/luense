# Lünse

Die Stamm-App: ein Programm für den Bauführer-Alltag — Baustellen, Foto-Journal,
und Schritt für Schritt alle weiteren Module. Offline-first PWA, Vanilla JS,
Daten bleiben auf dem eigenen Gerät.

## Loslegen

1. Ordner auf den Laptop legen, Terminal öffnen:
   ```
   cd luense
   claude
   ```
2. Claude Code liest `CLAUDE.md` (die Grundregeln) automatisch.
3. Sagen: **«Starte mit Abend 1 aus BAUPLAN.md.»** — und Abend für Abend
   weiterarbeiten. Jede Etappe endet mit ihrem Abnahme-Test und einem Commit.

## Struktur

```
luense/
├── CLAUDE.md      Grundregeln (liest Claude Code automatisch)
├── BAUPLAN.md     die 8 Bauabende von Schritt 1
├── index.html     Shell (entsteht an Abend 1)
├── kern/          Kern-Dienste: speicher, stamm, kamera, pdf, export
├── module/        Module, beginnend mit ereignis.js
└── lib/           pouchdb.min.js (v9, lokal — einzige Bibliothek)
```

Hinweis: Im Repo liegt nur Code. Alle erfassten Daten (Baustellen, Ereignisse,
Fotos) leben ausschliesslich in der lokalen Datenbank auf dem Gerät.
