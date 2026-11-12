// kern/mahnung.js — Mahnstand der Debitoren-Rechnungen und der Hinweis
// «Heute fällig: …» über alle Baustellen.
//
// Warum im Kern: Der Hinweis erscheint beim Öffnen der App (Shell,
// index.html) UND im Modul Rechnungen. Die Shell darf Dokumente nur über
// den Kern lesen und kennt kein Modul; damit braucht die Berechnung der
// fälligen Stufe jetzt zwei Stellen (Rule of two). Die Mahnstufen selbst
// (Texte, Verzugszins, PDF, Versand) bleiben in module/rechnung.js.
//
// Datenmodell an der Rechnung (Dokument «rechnung»):
//   mahnungen: [{ stufe: 1 | 2 | 3, datum, offenRappen, zinsRappen, …,
//     fristTage,
//     versandAn: 'kunde@beispiel.ch'  (nur bei «Erstellen und senden»),
//     versendetAm: '2026-11-12'       (Teilen erfolgreich oder von Hand
//                                      «als versendet markiert»),
//     versandWeg: 'teilen' | 'mailto' }]
// Eine Stufe mit versandAn und ohne versendetAm gilt als «noch nicht
// versendet» (z. B. Teilen abgebrochen) und lässt sich erneut senden.

import { abfrage } from './speicher.js';
import { ladeFirma, mahnFristenFirma } from './stamm.js';
import {
  heuteTag, plusTage, offenRappen, offenAufteilung,
} from './zahlung.js';
import { esc } from './ui.js';

// Stufen in fester Reihenfolge; keine darf übersprungen werden.
export const MAHN_STUFEN = ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung'];
export const MAHN_ZAHLUNGSFRIST_TAGE = 10;
const FORDERUNG = ['gestellt', 'teilbezahlt'];

export function stufenName(stufe) {
  return MAHN_STUFEN[stufe - 1] || '';
}

export function tageZwischen(vonIso, bisIso) {
  return Math.round((new Date(`${bisIso}T12:00:00`) - new Date(`${vonIso}T12:00:00`)) / 86400000);
}

export function mahnungenVon(rechnung) {
  return Array.isArray(rechnung?.mahnungen) ? rechnung.mahnungen : [];
}

// Letzte Stufe per Mail vorbereitet, aber nicht als versendet bestätigt.
export function nichtVersendet(mahnung) {
  return !!(mahnung?.versandAn && !mahnung.versendetAm);
}

// Mahnstand einer Rechnung am Tag «heute»: letzte erstellte Stufe und die
// fällige Stufe (oder null). Fällig nur für gestellte bzw. teilbezahlte
// Rechnungen mit offenem Betrag, Stufe für Stufe: die nächste Stufe, sobald
// ihre Frist ab Rechnungsdatum erreicht ist UND die Zahlungsfrist der
// vorherigen Stufe (10 Tage) abgelaufen ist. Massgebend ist das offene
// KAPITAL (ohne Verzugszins): ist nur noch Zins offen, wird keine weitere
// Stufe fällig. Nach der 2. Mahnung keine weitere Stufe, dann lässt sich
// «Betreibung eingeleitet» vermerken.
export function mahnStand(rechnung, fristen, heute = heuteTag()) {
  const liste = mahnungenVon(rechnung);
  const letzte = liste[liste.length - 1] || null;
  const naechste = liste.length < MAHN_STUFEN.length ? liste.length + 1 : null;
  const offen = FORDERUNG.includes(rechnung?.status) && offenRappen(rechnung) > 0;
  const stand = {
    letzte,
    naechste,
    faellig: null,
    wartetBis: '',
    nichtVersendet: offen && nichtVersendet(letzte),
    betreibung: rechnung?.betreibung || null,
    betreibungMoeglich: offen && !naechste && !rechnung?.betreibung,
  };
  if (!naechste || !offen || !rechnung.tag || offenAufteilung(rechnung).kapital <= 0) return stand;
  if (tageZwischen(rechnung.tag, heute) < fristen[naechste - 1]) return stand;
  if (letzte) {
    const fristEnde = plusTage(letzte.datum, letzte.fristTage ?? MAHN_ZAHLUNGSFRIST_TAGE);
    if (heute <= fristEnde) {
      stand.wartetBis = fristEnde;
      return stand;
    }
  }
  stand.faellig = naechste;
  return stand;
}

// Fällige Stufen über alle Baustellen. Beispieldaten (demo) zählen nur mit
// mitBeispiel, damit sie sich nie unter die echten Zahlen mischen.
// { erinnerungen, mahnungen, nichtVersendet, total }: je Anzahl Rechnungen.
export async function faelligeMahnungen({ mitBeispiel = false, heute = heuteTag() } = {}) {
  const [rechnungen, firma] = await Promise.all([abfrage({ typ: 'rechnung' }), ladeFirma()]);
  const fristen = mahnFristenFirma(firma);
  const zaehlung = { erinnerungen: 0, mahnungen: 0, nichtVersendet: 0, total: 0 };
  for (const r of rechnungen) {
    if (r.demo && !mitBeispiel) continue;
    const stand = mahnStand(r, fristen, heute);
    if (stand.faellig === 1) zaehlung.erinnerungen++;
    else if (stand.faellig) zaehlung.mahnungen++;
    if (stand.nichtVersendet) zaehlung.nichtVersendet++;
  }
  zaehlung.total = zaehlung.erinnerungen + zaehlung.mahnungen + zaehlung.nichtVersendet;
  return zaehlung;
}

// «Heute fällig: 2 Zahlungserinnerungen, 1 Mahnung» (leer = nichts fällig).
export function mahnHinweisText(z) {
  const teile = [
    z.erinnerungen ? `${z.erinnerungen} Zahlungserinnerung${z.erinnerungen > 1 ? 'en' : ''}` : '',
    z.mahnungen ? `${z.mahnungen} Mahnung${z.mahnungen > 1 ? 'en' : ''}` : '',
  ].filter(Boolean);
  const offen = z.nichtVersendet
    ? `${z.nichtVersendet} Mahnschreiben noch nicht versendet` : '';
  if (!teile.length) return offen;
  return `Heute fällig: ${teile.join(', ')}${offen ? `. ${offen}` : ''}`;
}

// Zeichnet den Hinweis in «ziel» (leert es, wenn nichts fällig ist).
// Antippen ruft onOeffnen(); «×» blendet ihn bis zum nächsten Zeichnen aus.
// nochAktuell(): nach dem Lesen der Datenbank prüfen, ob der Aufrufer den
// Hinweis inzwischen nicht mehr will (z. B. anderes Modul gewählt).
export async function zeichneMahnHinweis(ziel, {
  mitBeispiel = false, onOeffnen = () => {}, onSchliessen = null, nochAktuell = () => true,
} = {}) {
  const zaehlung = await faelligeMahnungen({ mitBeispiel });
  if (!nochAktuell()) return zaehlung;
  const text = mahnHinweisText(zaehlung);
  ziel.hidden = !text;
  ziel.innerHTML = text ? `
    <div class="mahn-hinweis" role="status">
      <button type="button" class="knopf mahn-hinweis-knopf" data-aktion="mahn-hinweis-oeffnen">
        <span class="mahn-hinweis-text">${esc(text)}</span>
        <span class="mahn-hinweis-ziel">Fällige anzeigen</span>
      </button>
      ${onSchliessen ? `<button type="button" class="knopf mahn-hinweis-zu" data-aktion="mahn-hinweis-zu"
        aria-label="Hinweis ausblenden">×</button>` : ''}
    </div>` : '';
  ziel.querySelector('[data-aktion="mahn-hinweis-oeffnen"]')?.addEventListener('click', onOeffnen);
  ziel.querySelector('[data-aktion="mahn-hinweis-zu"]')?.addEventListener('click', () => {
    ziel.hidden = true;
    onSchliessen?.();
  });
  return zaehlung;
}
