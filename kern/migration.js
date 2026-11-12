// kern/migration.js — Datennachführungen beim Start (index.html ruft
// fuehreDatenNach() einmal vor dem ersten Zeichnen auf).
// Jede Nachführung ist idempotent: sie ergänzt nur Dokumente, denen das
// neue Feld fehlt, und tut beim nächsten Start nichts mehr. Dokumente,
// die später ohne das Feld hereinkommen (Backup-Import alter Daten),
// werden beim nächsten Start ebenso ergänzt. Echte und Beispieldaten
// werden gleich behandelt — die Nachführung ändert keine Markierung und
// keine Baustellen-Zuordnung, nur das fehlende Feld.

import { abfrage, put } from './speicher.js';
import {
  mwstSatzAus, MWST_SATZ_STANDARD, rappen, nettoAusBruttoRappen, VORSTEUER_SATZ_STANDARD,
} from './zahlung.js';

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

// Kreditoren netto + Vorsteuer (Tobias): alte Kreditoren hatten nur
// «betrag» — das gilt als BRUTTO und bleibt unverändert (Zahlungen,
// Abgleich). Festgeschrieben werden vorsteuerSatz 8.1, netto = brutto /
// 1.081 auf den Rappen und vorsteuer = brutto − netto (Summe exakt).
const fix2 = (rp) => (rp / 100).toFixed(2);

async function kreditorNettoNachfuehren() {
  let anzahl = 0;
  for (const doc of await abfrage({ typ: 'kreditor' })) {
    const hatNetto = String(doc.netto ?? '').trim() !== '';
    const hatSatz = mwstSatzAus(doc.vorsteuerSatz) !== null;
    if (hatNetto && hatSatz) continue;
    const neu = { ...doc };
    if (!hatSatz) neu.vorsteuerSatz = VORSTEUER_SATZ_STANDARD;
    if (!hatNetto) {
      const bruttoRp = rappen(doc.betrag);
      const nettoRp = nettoAusBruttoRappen(bruttoRp, neu.vorsteuerSatz);
      neu.netto = fix2(nettoRp);
      neu.vorsteuer = fix2(bruttoRp - nettoRp);
    }
    await put(neu);
    anzahl++;
  }
  return anzahl;
}

export async function fuehreDatenNach() {
  const ergebnis = {};
  for (const [name, schritt] of [
    ['mwstSatz', mwstSatzNachfuehren],
    ['kreditorNetto', kreditorNettoNachfuehren],
  ]) {
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
