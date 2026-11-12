// kern/migration.js — Datennachführungen beim Start (index.html ruft
// fuehreDatenNach() einmal vor dem ersten Zeichnen auf).
// Jede Nachführung ist idempotent: sie ergänzt nur Dokumente, denen das
// neue Feld fehlt, und tut beim nächsten Start nichts mehr. Dokumente,
// die später ohne das Feld hereinkommen (Backup-Import alter Daten),
// werden beim nächsten Start ebenso ergänzt. Echte und Beispieldaten
// werden gleich behandelt — die Nachführung ändert keine Markierung und
// keine Baustellen-Zuordnung, nur das fehlende Feld.

import { abfrage, put } from './speicher.js';
import { mwstSatzAus, MWST_SATZ_STANDARD } from './zahlung.js';

// MWST-Satz an Rechnungen und Offerten (Tobias: fest 8.1 %, nicht der
// aktuelle Firmensatz — diese Dokumente stammen aus der Zeit vor der
// MWST-Einführung und wurden mit 8.1 % gerechnet).
async function mwstSatzNachfuehren() {
  let anzahl = 0;
  for (const typ of ['rechnung', 'offerte']) {
    for (const doc of await abfrage({ typ })) {
      if (mwstSatzAus(doc.mwstSatz) !== null) continue;
      await put({ ...doc, mwstSatz: MWST_SATZ_STANDARD });
      anzahl++;
    }
  }
  return anzahl;
}

export async function fuehreDatenNach() {
  const ergebnis = {};
  for (const [name, schritt] of [['mwstSatz', mwstSatzNachfuehren]]) {
    try {
      ergebnis[name] = await schritt();
    } catch (fehler) {
      // Nie den Start blockieren — beim nächsten Start erneut versuchen.
      console.warn(`Nachführung ${name} fehlgeschlagen:`, fehler);
      ergebnis[name] = null;
    }
  }
  return ergebnis;
}
