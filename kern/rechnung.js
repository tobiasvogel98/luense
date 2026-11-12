// kern/rechnung.js — Rechnungs-Grunddienst (Abend 8.4).
// Nummernkreis fortlaufend je Jahr über alle Baustellen (R-2026-001),
// Anlage einer Rechnung mit Status «offen» und Datumsstempel.
// Gebraucht von module/rechnung.js sowie den Automatik-Knöpfen in
// module/rapport.js (Regierapport unterschrieben) und module/nachtrag.js
// (Nachtrag genehmigt) — Rule of two erfüllt.

import { put, abfrage } from './speicher.js';
import { scorAusNummer } from './zahlung.js';
import { ladeFirma, mwstSatzFirma } from './stamm.js';

// Ablauf von Hand. Dazu kommt «teilbezahlt» — entsteht nur aus Zahlungen
// (Kontoauszug oder von Hand erfasst), siehe kern/zahlung.js.
export const RECHNUNG_STATUS = ['offen', 'gestellt', 'bezahlt'];
export const ZAHLUNGSFRIST_TAGE = 30;

export function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

// Nächste freie Nummer im Jahres-Nummernkreis, z. B. R-2026-004.
export async function naechsteRechnungsnummer() {
  const jahr = String(new Date().getFullYear());
  const alle = await abfrage({ typ: 'rechnung' });
  const laufnummern = alle
    .map((r) => /^R-(\d{4})-(\d+)$/.exec(r.nummer || ''))
    .filter((t) => t && t[1] === jahr)
    .map((t) => parseInt(t[2], 10));
  const naechste = (laufnummern.length ? Math.max(...laufnummern) : 0) + 1;
  return `R-${jahr}-${String(naechste).padStart(3, '0')}`;
}

// Legt eine Rechnung mit Status «offen» an. basis verlinkt auf die
// Grundlage: { art: 'regierapport' | 'nachtrag' | 'manuell', id, label }.
// «betrag» ist netto (exkl. MWST). Der MWST-Satz der Firmendaten wird an
// der Rechnung festgehalten (mwstSatz), damit eine spätere Satzänderung
// alte Rechnungen nicht verändert. Total inkl. MWST: kern/zahlung.js
// (rechnungsBetraege).
export async function erstelleRechnung({ baustelleId, titel, betrag, basis }) {
  const nummer = await naechsteRechnungsnummer();
  const mwstSatz = mwstSatzFirma(await ladeFirma());
  return put({
    typ: 'rechnung',
    baustelleId,
    nummer,
    referenz: scorAusNummer(nummer), // SCOR-Zahlungsreferenz (ISO 11649)
    tag: heuteTag(),
    titel: String(titel || '').trim() || '(ohne Titel)',
    betrag: String(betrag ?? '').trim(),
    mwstSatz,
    zahlungsfristTage: ZAHLUNGSFRIST_TAGE,
    basis: basis || { art: 'manuell', id: '', label: '' },
    status: 'offen',
    statusHistorie: [{ status: 'offen', datum: heuteTag() }],
  });
}

// Schutz gegen Doppelverrechnung: ein Regierapport kann direkt
// (Rechnung mit Basis «regierapport») ODER als Beweis eines Nachtrags
// verrechnet werden — nie beides. Gebraucht von module/rapport.js und
// module/nachtrag.js.

// Nachträge, über die ein Regierapport bereits verrechnet ist oder wird:
// Rapport steht in den Beweisen, und der Nachtrag ist «verrechnet» oder
// hat schon eine Rechnung.
export function nachtraegeMitVerrechnung(rapportId, nachtraege, rechnungen) {
  return nachtraege.filter((n) => n.beweise?.rapportIds?.includes(rapportId)
    && (n.status === 'verrechnet'
      || rechnungen.some((re) => re.basis?.art === 'nachtrag' && re.basis.id === n._id)));
}

// Direkt verrechneter Regierapport: eigene Rechnung vorhanden oder
// Regie-Status «verrechnet».
export function rapportDirektVerrechnet(rapport, rechnungen) {
  return rapport.regieStatus === 'verrechnet'
    || rechnungen.some((re) => re.basis?.art === 'regierapport' && re.basis.id === rapport._id);
}
