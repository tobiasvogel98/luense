// kern/rechnung.js — Rechnungs-Grunddienst (Abend 8.4).
// Nummernkreis fortlaufend je Jahr über alle Baustellen (R-2026-001),
// Anlage einer Rechnung mit Status «offen» und Datumsstempel.
// Gebraucht von module/rechnung.js sowie den Automatik-Knöpfen in
// module/rapport.js (Regierapport unterschrieben) und module/nachtrag.js
// (Nachtrag genehmigt) — Rule of two erfüllt.

import { put, abfrage } from './speicher.js';

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
export async function erstelleRechnung({ baustelleId, titel, betrag, basis }) {
  return put({
    typ: 'rechnung',
    baustelleId,
    nummer: await naechsteRechnungsnummer(),
    tag: heuteTag(),
    titel: String(titel || '').trim() || '(ohne Titel)',
    betrag: String(betrag ?? '').trim(),
    zahlungsfristTage: ZAHLUNGSFRIST_TAGE,
    basis: basis || { art: 'manuell', id: '', label: '' },
    status: 'offen',
    statusHistorie: [{ status: 'offen', datum: heuteTag() }],
  });
}
