---
name: fehlerjagd
description: Systematische Fehlersuche — reproduzieren, eingrenzen, Ursache, Fix erst nach Freigabe
argument-hint: [was passiert / was stattdessen sollte]
disable-model-invocation: true
---
Jage den Fehler: «$ARGUMENTS». Vorgehen wie eine Leckortung — erst finden,
dann graben:

1. Reproduzieren: Baue die kleinsten Schritte nach, die den Fehler auslösen
   (Server starten, Ablauf durchspielen, Konsole lesen). Wenn nicht
   reproduzierbar: Stelle mir maximal 3 gezielte Fragen.
2. Eingrenzen: Welche Datei, welche Funktion, welcher Dokumenttyp? Belege
   mit Konsolen-Ausgabe oder Test, nicht mit Vermutung.
3. Ursache in einem Satz erklären — so, dass ein Nicht-Programmierer sie
   versteht.
4. Fix vorschlagen (was, wo, Risiko/Nebenwirkungen) — NOCH NICHTS ÄNDERN.
5. Nach meiner Freigabe: fixen, den ursprünglichen Ablauf erneut durchspielen,
   prüfen dass nichts anderes bricht, Commit «Fix: <ursache>».
