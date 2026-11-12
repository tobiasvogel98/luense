// module/kreditor.js — Kreditoren: Lieferanten-/Subunternehmerrechnungen
// je Baustelle (Abend 9.1). Workflow nach dem Vorbild professioneller
// Bau-ERP (Visumskontrolle): erfassen und kontieren → visieren (mit
// Bemerkung) → bezahlen — jeder Schritt mit Datumsstempel. Dazu:
// Skonto-Fristen-Überwachung (nie mehr Skonto verpassen), Fälligkeits-
// warnung, Doppelerfassungs-Schutz (Lieferant + Rechnungs-Nr.),
// Beleg als Foto oder PDF am Dokument, Excel-Export.
// Die Kostenart entspricht den Selbstkosten-Gruppen des Controllings.
//
// Bank-Verknüpfung: IBAN und Zahlungsreferenz (QRR/SCOR, aus dem QR-Scan
// oder getippt) sind sichtbare Felder. Zahlungen kommen per Kontoauszug
// (camt.053/054, kern/bank.js) oder von Hand — mit Teilzahlung und Skonto.
// Dazu die Übersicht offener Kreditoren über alle Baustellen, sortiert
// nach der nächsten Frist (Skonto oder Fälligkeit).
//
// Beträge: erfasst wird NETTO (exkl. MWST), dazu Vorsteuer-Satz (Standard
// 8.1 %, je Lieferant änderbar, 0 erlaubt) und Vorsteuer in CHF (exakt
// gerechnet, von Hand übersteuerbar — massgebend ist die Lieferanten-
// rechnung). «betrag» = brutto = netto + Vorsteuer: darauf laufen Zahlung,
// Skonto, Restbetrag und Kontoauszug. Der QR-Scan liefert das Brutto —
// netto und Vorsteuer werden zum Satz abgeleitet und sind korrigierbar.
// Controlling (S1) rechnet netto. Details: kern/zahlung.js.

import {
  put, abfrage, entferneDokument, haengeAnhangAn, holeAnhang, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { exportiereCsv } from '../kern/export.js';
import { chf, esc, zeigeBildVollbild } from '../kern/ui.js';
import {
  zahl, heuteTag, formatTag, plusTage, kreditorWerte, zahlungen, bezahltSumme,
  offenerBetrag, kompakt, istGueltigeIban, formatIban, referenzArt, formatReferenz,
  ZAHLUNGSFRIST_TAGE, rappen, prozentVonRappen, nettoAusBruttoRappen, mwstSatzAus,
  kreditorBetraege, formatSatz, VORSTEUER_SATZ_STANDARD,
} from '../kern/zahlung.js';
import { oeffneKontoauszug, zeigeZahlungen } from '../kern/bank.js';
import { alleBaustellen } from '../kern/stamm.js';

// Ablauf von Hand; «teilbezahlt» entsteht nur aus Zahlungen.
const KREDITOR_STATUS = ['offen', 'visiert', 'bezahlt'];
const KOSTENARTEN = ['Material', 'Fremdleistung', 'Inventar/Miete', 'Entsorgung', 'Diverses'];
const ANSICHT_MERKER = 'luense.kreditorAnsicht'; // nur UI-Zustand

function naechsterStatus(k) {
  if (k.status === 'teilbezahlt') return 'bezahlt';
  return KREDITOR_STATUS[KREDITOR_STATUS.indexOf(k.status) + 1] || '';
}

function vorherigerStatus(k) {
  if (k.status === 'teilbezahlt') return '';
  if (k.status === 'bezahlt' && zahlungen(k).length) {
    return offenerBetrag({ ...k, status: 'teilbezahlt' }) > 0 ? 'teilbezahlt' : '';
  }
  return KREDITOR_STATUS[KREDITOR_STATUS.indexOf(k.status) - 1] || '';
}

// Betrag-Zelle: netto, Vorsteuer, zuletzt brutto (fett) — wie bei den Rechnungen.
function betragZelle(k) {
  const b = kreditorBetraege(k);
  return `<span class="mwst-stapel">
    <small>netto ${chf(b.netto)}</small>
    <small>${b.satz > 0 || b.vorsteuer ? `Vorsteuer ${formatSatz(b.satz)} ${chf(b.vorsteuer)}` : 'ohne Vorsteuer'}</small>
    <b>${chf(b.brutto)}</b></span>`;
}

const fix2 = (rp) => (rp / 100).toFixed(2);

function mitHistorie(kreditor, neuerStatus) {
  return {
    ...kreditor,
    status: neuerStatus,
    statusHistorie: [...(kreditor.statusHistorie || []),
      { status: neuerStatus, datum: heuteTag() }],
  };
}

// ---------- Swiss-QR-Rechnung (Abend 9.2) ----------
// Der QR-Code auf jeder Schweizer Rechnung (SIX-Standard) ist zeilenweise
// aufgebaut: SPC / Version / Coding / IBAN / Zahlungsempfänger (7 Zeilen) /
// endgültiger Empfänger (7) / Betrag / Währung / Zahlungspflichtiger (7) /
// Referenztyp / Referenz / Mitteilung / EPD / Swico-Rechnungsinformationen.
// Aus den optionalen Swico-Angaben (//S1/...) kommen Rechnungs-Nr., Datum
// und sogar die Skonto-Konditionen (/40/2:10;0:30 = 2 % zu 10 Tagen,
// netto 30 Tage).
export function parseSwissQr(text) {
  const zeilen = String(text).split(/\r?\n/).map((s) => s.trim());
  if (zeilen[0] !== 'SPC') return null;
  const daten = {
    iban: zeilen[3] || '',
    lieferant: zeilen[5] || '',
    betrag: zeilen[18] || '',
    waehrung: zeilen[19] || '',
    refTyp: zeilen[27] || '',
    referenz: zeilen[28] || '',
    mitteilung: zeilen[29] || '',
    rechnungsNr: '',
    rechnungsTag: '',
    skontoProzent: '',
    skontoTage: '',
    zahlungsfristTage: '',
  };
  const swico = zeilen.find((s) => s.startsWith('//S1/'));
  if (swico) {
    const teil = (code) => (swico.match(new RegExp(`/${code}/([^/]*)`)) || [])[1] || '';
    daten.rechnungsNr = teil('10');
    const datum = teil('11'); // JJMMTT
    if (/^\d{6}/.test(datum)) {
      daten.rechnungsTag = `20${datum.slice(0, 2)}-${datum.slice(2, 4)}-${datum.slice(4, 6)}`;
    }
    const konditionen = teil('40').split(';').map((k) => k.split(':'));
    const skonto = konditionen.find(([p]) => zahl(p) > 0);
    if (skonto?.[1]) {
      daten.skontoProzent = skonto[0];
      daten.skontoTage = skonto[1];
    }
    const netto = konditionen.find(([p]) => zahl(p) === 0);
    if (netto?.[1]) daten.zahlungsfristTage = netto[1];
  }
  return daten;
}

// Abgeleitete Termine und Beträge: kern/zahlung.js (kreditorWerte), weil
// auch der Kontoauszug-Abgleich Skonto und Restbetrag braucht.
export { kreditorWerte };

export default {
  name: 'Kreditoren',
  dokumentTypen: ['kreditor'],

  // Badge: noch nicht bezahlte Kreditoren der Baustelle.
  async badge(baustelle) {
    const alle = await abfrage({ typ: 'kreditor', baustelleId: baustelle.baustelleId });
    return alle.filter((k) => k.status !== 'bezahlt').length || null;
  },

  render(container, baustelle) {
    let inBearbeitung = null;
    let ansicht = 'baustelle';
    try {
      ansicht = localStorage.getItem(ANSICHT_MERKER) === 'alle' ? 'alle' : 'baustelle';
    } catch { /* ohne Speicher: Standardansicht */ }
    let filterBaustelle = '';

    container.innerHTML = `
      <section class="kreditoren">
        <h2>Kreditoren · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="chips ansicht-wahl" role="tablist">
          <button type="button" class="chip chip-knopf" data-ansicht="baustelle" role="tab">Diese Baustelle</button>
          <button type="button" class="chip chip-knopf" data-ansicht="alle" role="tab">Offene Posten alle Baustellen</button>
        </div>

        <div class="kachel-reihe" data-rolle="kacheln"></div>
        <p class="hinweis skonto-chance" data-rolle="skonto-hinweis" hidden></p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neue Lieferantenrechnung
          </button>
          <button type="button" class="knopf" data-aktion="kontoauszug"
            title="camt.053 / camt.054 aus dem E-Banking">Kontoauszug einlesen</button>
          <button type="button" class="knopf" data-aktion="export"
            title="Öffnet direkt in Excel">Excel-Export</button>
        </div>

        <div data-rolle="formular-bereich"></div>
        <p class="meldung" data-rolle="meldung" role="status"></p>
        <div data-rolle="tabelle"></div>
      </section>`;

    const kachelnElement = container.querySelector('[data-rolle="kacheln"]');
    const skontoHinweis = container.querySelector('[data-rolle="skonto-hinweis"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const neuKnopf = container.querySelector('[data-aktion="neu"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const tabelleElement = container.querySelector('[data-rolle="tabelle"]');
    const meldungElement = container.querySelector('[data-rolle="meldung"]');

    async function ladeKreditoren() {
      const alle = await abfrage({ typ: 'kreditor', baustelleId: baustelle.baustelleId });
      return alle.sort((a, b) => (b.tag || '').localeCompare(a.tag || ''));
    }

    // Brutto (inkl. MWST, zu zahlen) bzw. netto (Kosten), exakt in Rappen.
    function summe(liste) {
      return liste.reduce((s, k) => s + kreditorBetraege(k).bruttoRappen, 0) / 100;
    }

    function summeNetto(liste) {
      return liste.reduce((s, k) => s + kreditorBetraege(k).nettoRappen, 0) / 100;
    }

    function summeOffen(liste) {
      return liste.reduce((s, k) => s + offenerBetrag(k), 0);
    }

    function zeichneKacheln(kreditoren) {
      const teil = kreditoren.filter((k) => k.status === 'teilbezahlt');
      const kacheln = [
        { titel: 'offen', liste: kreditoren.filter((k) => k.status === 'offen'), wert: summe },
        { titel: 'visiert', liste: kreditoren.filter((k) => k.status === 'visiert'), wert: summe },
        ...(teil.length ? [{ titel: 'teilbezahlt, Rest', liste: teil, wert: summeOffen }] : []),
        { titel: 'bezahlt', liste: kreditoren.filter((k) => k.status === 'bezahlt'), wert: summe, gruen: true },
      ];
      kachelnElement.innerHTML = kacheln.map((k) => `
          <div class="karte kachel${k.gruen ? ' kachel-gruen' : ''}">
            <span class="kachel-titel">${k.titel} (${k.liste.length}) · inkl. MWST</span>
            <span class="kachel-wert">${chf(k.wert(k.liste))}</span>
          </div>`).join('');
      // Skonto-Überwachung: laufende Fristen und mögliche Ersparnis.
      const nutzbar = kreditoren
        .map((k) => ({ k, w: kreditorWerte(k) }))
        .filter(({ w }) => w.skontoNutzbar);
      if (nutzbar.length) {
        const ersparnis = nutzbar.reduce((s, { w }) => s + w.skontoBetrag, 0);
        const naechste = nutzbar.map(({ w }) => w.skontoTag).sort()[0];
        skontoHinweis.hidden = false;
        skontoHinweis.textContent = `💡 Skonto nutzbar auf ${nutzbar.length} `
          + `Rechnung${nutzbar.length > 1 ? 'en' : ''}: ${chf(ersparnis)} sparen, `
          + `nächste Frist ${formatTag(naechste)}.`;
      } else {
        skontoHinweis.hidden = true;
      }
    }

    function belegAnzahl(k) {
      return Object.keys(k._attachments || {}).length;
    }

    async function zeichneBaustelle() {
      const kreditoren = await ladeKreditoren();
      zeichneKacheln(kreditoren);
      if (!kreditoren.length) {
        tabelleElement.innerHTML = `
          <p class="hinweis">Noch keine Lieferantenrechnungen auf dieser Baustelle.
            Erfassen, Beleg fotografieren, visieren, bezahlen: die Selbstkosten
            sammeln sich hier statt im Bürostapel.</p>`;
        return;
      }
      tabelleElement.innerHTML = `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Lieferant · Rg.-Nr.</th><th>Datum</th><th>Kostenart</th>
              <th class="zahl">Betrag</th><th class="zahl">Offen inkl. MWST</th><th>Skonto bis</th><th>Fällig</th>
              <th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${kreditoren.map((k) => {
                const w = kreditorWerte(k);
                const naechster = naechsterStatus(k);
                const vorheriger = vorherigerStatus(k);
                const anzahlZahlungen = zahlungen(k).length;
                return `
                  <tr>
                    <td class="kein-umbruch"><b>${esc(k.lieferant)}</b><br>
                      <small class="hinweis">${esc(k.rechnungsNr)}</small></td>
                    <td class="kein-umbruch">${formatTag(k.tag)}</td>
                    <td class="kein-umbruch">${esc(k.kostenart)}</td>
                    <td class="zahl">${betragZelle(k)}</td>
                    <td class="zahl">${k.status === 'bezahlt' ? '-' : chf(w.rest)}</td>
                    <td class="kein-umbruch">${w.skontoTag
                      ? `${formatTag(w.skontoTag)}${w.skontoNutzbar
                          ? `<br><small class="skonto-chance">− ${chf(w.skontoBetrag)}</small>`
                          : (k.skontoGenutzt
                            ? '<br><small class="gewinn">genutzt ✓</small>' : '')}`
                      : '-'}</td>
                    <td class="kein-umbruch">${k.status === 'bezahlt'
                      ? `bezahlt ${formatTag(k.bezahltAm)}`
                      : `${formatTag(w.faelligTag)}${w.ueberfaellig
                          ? ' <span class="ueberfaellig">überfällig</span>' : ''}`}</td>
                    <td class="status-spalte">${esc(k.status)}${k.visumNotiz
                        ? `<br><small class="hinweis">Visum: ${esc(k.visumNotiz)}</small>` : ''}<br>
                      <small class="hinweis">${(k.statusHistorie || [])
                        .map((h) => `${esc(h.status)} ${formatTag(h.datum)}`).join(' → ')}</small></td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${belegAnzahl(k) ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="beleg"
                          data-id="${esc(k._id)}">Beleg (${belegAnzahl(k)})</button>` : ''}
                      ${naechster ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="weiter"
                          data-id="${esc(k._id)}">→ ${naechster}</button>` : ''}
                      ${vorheriger ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="zurueck"
                          data-id="${esc(k._id)}">← zurück</button>` : ''}
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="zahlungen"
                        data-id="${esc(k._id)}">Zahlungen${anzahlZahlungen ? ` (${anzahlZahlungen})` : ''}</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                        data-id="${esc(k._id)}">Bearbeiten</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                        data-id="${esc(k._id)}" aria-label="Kreditor löschen">Löschen</button>
                    </span></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="3"><b>Total (${kreditoren.length})</b></td>
                <td class="zahl"><span class="mwst-stapel"><small>netto ${chf(summeNetto(kreditoren))}</small>
                  <b>${chf(summe(kreditoren))}</b></span></td>
                <td class="zahl"><b>${chf(summeOffen(kreditoren))}</b></td>
                <td colspan="4">davon bezahlt ${chf(summe(kreditoren.filter((k) => k.status === 'bezahlt'))
                  + kreditoren.filter((k) => k.status !== 'bezahlt').reduce((s, k) => s + bezahltSumme(k), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    // ---------- Offene Kreditoren über alle Baustellen ----------
    // Sortiert nach der nächsten Frist: laufende Skontofrist vor Fälligkeit.
    async function zeichneAlle() {
      const [alle, baustellen] = await Promise.all([
        abfrage({ typ: 'kreditor' }), alleBaustellen({ mitArchivierten: true }),
      ]);
      const ktr = new Map(baustellen.map((b) => [b.baustelleId, b]));
      const heute = heuteTag();
      const offene = alle
        .filter((k) => k.status !== 'bezahlt')
        .filter((k) => !filterBaustelle || k.baustelleId === filterBaustelle)
        .map((k) => {
          const w = kreditorWerte(k);
          return { k, w, frist: w.skontoNutzbar ? w.skontoTag : w.faelligTag };
        })
        .sort((a, b) => (a.frist || '9999').localeCompare(b.frist || '9999'));
      const total = offene.reduce((s, o) => s + o.w.rest, 0);
      const skonto = offene.filter((o) => o.w.skontoNutzbar);
      const ueber = offene.filter((o) => o.w.ueberfaellig);
      const mitKreditoren = baustellen.filter((b) => alle.some((k) => k.baustelleId === b.baustelleId));
      kachelnElement.innerHTML = `
        <div class="karte kachel">
          <span class="kachel-titel">Offene Kreditoren (${offene.length}) · inkl. MWST</span>
          <span class="kachel-wert">${chf(total)}</span>
        </div>
        <div class="karte kachel">
          <span class="kachel-titel">Skonto möglich (${skonto.length})</span>
          <span class="kachel-wert skonto-chance">${chf(skonto.reduce((s, o) => s + o.w.skontoBetrag, 0))}</span>
        </div>
        <div class="karte kachel">
          <span class="kachel-titel">überfällig (${ueber.length})</span>
          <span class="kachel-wert ${ueber.length ? 'verlust' : ''}">${chf(ueber.reduce((s, o) => s + o.w.rest, 0))}</span>
        </div>`;
      skontoHinweis.hidden = true;
      tabelleElement.innerHTML = `
        <label class="filter-baustelle">Baustelle
          <select data-rolle="filter-baustelle">
            <option value="">Alle Baustellen</option>
            ${mitKreditoren.map((b) => `<option value="${esc(b.baustelleId)}"
              ${b.baustelleId === filterBaustelle ? 'selected' : ''}>${esc(b.ktr)} · ${esc(b.name)}</option>`).join('')}
          </select>
        </label>
        ${offene.length ? `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Nächste Frist</th><th>Baustelle</th><th>Lieferant · Rg.-Nr.</th>
              <th class="zahl">Offen inkl. MWST</th><th>Skonto bis</th><th>Fällig</th><th>Status</th><th>Zahlung an</th><th></th>
            </tr></thead>
            <tbody>
              ${offene.map(({ k, w, frist }) => {
                const b = ktr.get(k.baustelleId);
                return `
                  <tr class="${w.ueberfaellig ? 'zeile-ueberfaellig' : ''}">
                    <td class="kein-umbruch"><b>${formatTag(frist) || '-'}</b>${w.skontoNutzbar
                      ? '<br><small class="skonto-chance">Skonto</small>'
                      : (w.ueberfaellig ? '<br><span class="ueberfaellig">überfällig</span>' : '')}</td>
                    <td class="kein-umbruch">${esc(b?.ktr || '-')}<br><small class="hinweis">${esc(b?.name || '')}</small></td>
                    <td class="kein-umbruch"><b>${esc(k.lieferant)}</b><br><small class="hinweis">${esc(k.rechnungsNr)}</small></td>
                    <td class="zahl"><b>${chf(w.rest)}</b>${w.skontoNutzbar
                      ? `<br><small class="skonto-chance">mit Skonto ${chf(w.rest - w.skontoBetrag)}</small>` : ''}</td>
                    <td class="kein-umbruch">${w.skontoTag ? formatTag(w.skontoTag) : '-'}</td>
                    <td class="kein-umbruch">${formatTag(w.faelligTag)}</td>
                    <td class="kein-umbruch">${esc(k.status)}</td>
                    <td class="kein-umbruch"><small>${k.iban ? esc(formatIban(k.iban)) : '<span class="hinweis">IBAN fehlt</span>'}${
                      k.referenz ? `<br>${esc(formatReferenz(k.referenz))}` : ''}</small></td>
                    <td class="zahl"><button type="button" class="knopf eintrag-loeschen"
                      data-aktion="zur-baustelle" data-baustelle="${esc(k.baustelleId)}">Öffnen</button></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="3"><b>Total offen (${offene.length})</b></td>
                <td class="zahl"><b>${chf(total)}</b></td>
                <td colspan="5"></td>
              </tr>
            </tbody>
          </table>
        </div>` : '<p class="hinweis">Keine offenen Kreditoren, alles bezahlt.</p>'}`;
    }

    async function zeichneTabelle() {
      container.querySelectorAll('[data-ansicht]').forEach((knopf) => {
        knopf.classList.toggle('aktiv', knopf.dataset.ansicht === ansicht);
        knopf.setAttribute('aria-selected', String(knopf.dataset.ansicht === ansicht));
      });
      neuKnopf.hidden = ansicht === 'alle';
      if (ansicht === 'alle') {
        schliesseFormular();
        await zeichneAlle();
      } else {
        await zeichneBaustelle();
      }
    }

    // ---------- Formular ----------
    async function oeffneFormular(kreditor) {
      inBearbeitung = kreditor || null;
      neuZeile.hidden = true;
      // Lieferanten-Vorschläge aus allen bisherigen Kreditoren (alle Baustellen).
      const alleKreditoren = await abfrage({ typ: 'kreditor' });
      const lieferanten = [...new Set(alleKreditoren.map((k) => k.lieferant).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de-CH'));
      // Startwerte netto / Satz / Vorsteuer / brutto (alte Kreditoren ohne
      // netto: aus dem Brutto zu 8.1 % abgeleitet).
      const kb = kreditor ? kreditorBetraege(kreditor) : null;
      const start = kb ? {
        netto: fix2(kb.nettoRappen), satz: kb.satz,
        vorsteuer: fix2(kb.vorsteuerRappen), brutto: fix2(kb.bruttoRappen),
      } : { netto: '', satz: VORSTEUER_SATZ_STANDARD, vorsteuer: '', brutto: '' };
      const vonHand = Boolean(kb && !kb.abgeleitet
        && kb.vorsteuerRappen !== prozentVonRappen(kb.nettoRappen, kb.satz));
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="kreditor-formular"
          data-vorsteuer-hand="${vonHand ? '1' : ''}">
          <h3>${kreditor ? `Rechnung ${esc(kreditor.rechnungsNr)} bearbeiten`
            : 'Neue Lieferantenrechnung'}</h3>
          <div class="knopfzeile">
            <button type="button" class="knopf" data-aktion="qr-scan">
              ⛶ QR-Rechnung scannen
            </button>
          </div>
          <p class="hinweis" data-rolle="qr-info" hidden></p>
          <div class="feld-reihe">
            <label>Lieferant / Firma *<input name="lieferant" required autocomplete="off"
              list="lieferanten-liste" value="${esc(kreditor?.lieferant ?? '')}"
              placeholder="z. B. Kieswerk Muster AG"></label>
            <label>Rechnungs-Nr. *<input name="rechnungsNr" required autocomplete="off"
              value="${esc(kreditor?.rechnungsNr ?? '')}"></label>
          </div>
          <datalist id="lieferanten-liste">
            ${lieferanten.map((l) => `<option value="${esc(l)}">`).join('')}
          </datalist>
          <div class="feld-reihe">
            <label>Rechnungsdatum *<input name="tag" type="date" required
              value="${esc(kreditor?.tag || heuteTag())}"></label>
            <label>Zahlungsfrist [Tage]<input name="zahlungsfrist" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(kreditor?.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE)}"></label>
          </div>
          <div class="feld-reihe">
            <label class="feld-breit">Netto exkl. MWST [CHF] *<input name="netto" type="number" required
              inputmode="decimal" step="any" value="${esc(start.netto)}" placeholder="0.00"></label>
            <label class="feld-schmal">Vorsteuer [%]<input name="vorsteuerSatz" type="number"
              inputmode="decimal" step="any" min="0" max="99.9" aria-label="Vorsteuer-Satz in Prozent"
              value="${esc(start.satz)}"></label>
          </div>
          <div class="feld-reihe">
            <label>Vorsteuer [CHF]<input name="vorsteuer" type="number" inputmode="decimal"
              step="any" value="${esc(start.vorsteuer)}" placeholder="0.00"></label>
            <label>Brutto inkl. MWST [CHF]<input name="brutto" type="number" inputmode="decimal"
              step="any" value="${esc(start.brutto)}" placeholder="0.00"></label>
          </div>
          <p class="hinweis" data-rolle="betrag-hinweis" role="status"></p>
          <div class="feld-reihe">
            <label>Skonto [%]<input name="skontoProzent" type="number"
              inputmode="decimal" step="any" min="0"
              value="${esc(kreditor?.skontoProzent ?? '')}" placeholder="z. B. 2"></label>
            <label>Skontofrist [Tage]<input name="skontoTage" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(kreditor?.skontoTage ?? '')}" placeholder="z. B. 10"></label>
          </div>
          <p class="hinweis" data-rolle="termine"></p>
          <p class="gruppen-label">Zahlung an (für den Kontoauszug-Abgleich)</p>
          <label>IBAN Lieferant<input name="iban" autocomplete="off" spellcheck="false"
            value="${esc(formatIban(kreditor?.iban ?? ''))}" placeholder="CH00 0000 0000 0000 0000 0"></label>
          <label>Zahlungsreferenz (QR-Referenz oder RF…)<input name="referenz" autocomplete="off"
            spellcheck="false" value="${esc(formatReferenz(kreditor?.referenz ?? ''))}"></label>
          <p class="hinweis" data-rolle="bank-pruefung"></p>
          <p class="gruppen-label">Kostenart (fürs Controlling)</p>
          <div class="chips">
            ${KOSTENARTEN.map((art) => `
              <label class="chip-wahl">
                <input type="radio" name="kostenart" value="${art}"
                  ${(kreditor?.kostenart || 'Material') === art ? 'checked' : ''}>
                <span>${art}</span>
              </label>`).join('')}
          </div>
          <label>Notiz<input name="notiz" autocomplete="off"
            value="${esc(kreditor?.notiz ?? '')}"
            placeholder="z. B. Lieferung Etappe 2"></label>
          <label class="knopf">
            📷 Beleg anhängen (Foto oder PDF)
            <input type="file" accept="image/*,application/pdf" multiple
              data-rolle="beleg-eingabe" class="visually-hidden">
          </label>
          <p class="hinweis" data-rolle="beleg-hinweis">${
            kreditor && belegAnzahl(kreditor)
              ? `${belegAnzahl(kreditor)} Beleg${belegAnzahl(kreditor) > 1 ? 'e' : ''} vorhanden, neue kommen dazu.`
              : 'Noch kein Beleg gewählt.'}</p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rechnung speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      const formular = formularBereich.querySelector('form');
      formular.addEventListener('input', (eingabe) => {
        rechneBetraege(formular, eingabe.target.name);
        pruefeFormular(formular);
      });
      formular.addEventListener('click', (klick) => {
        if (klick.target.closest('[data-aktion="vorsteuer-rechnen"]')) {
          formular.dataset.vorsteuerHand = '';
          rechneBetraege(formular, 'netto');
        }
      });
      rechneBetraege(formular, null);
      pruefeFormular(formular);
      const belegEingabe = formularBereich.querySelector('[data-rolle="beleg-eingabe"]');
      belegEingabe.addEventListener('change', () => {
        formularBereich.querySelector('[data-rolle="beleg-hinweis"]').textContent =
          belegEingabe.files.length
            ? `${belegEingabe.files.length} Datei${belegEingabe.files.length > 1 ? 'en' : ''} gewählt.`
            : 'Noch kein Beleg gewählt.';
      });
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Netto / Vorsteuer / Brutto gegenseitig nachführen (exakt in Rappen):
    //   netto oder Satz geändert → Vorsteuer = netto × Satz (ausser von Hand),
    //   Vorsteuer getippt        → von Hand, brutto = netto + Vorsteuer,
    //   brutto getippt (QR-Scan) → netto und Vorsteuer zum Satz abgeleitet.
    function rechneBetraege(formular, feld) {
      const el = formular.elements;
      if (!['netto', 'vorsteuerSatz', 'vorsteuer', 'brutto', null].includes(feld)) return;
      const satz = mwstSatzAus(el.vorsteuerSatz.value) ?? 0;
      const leer = (name) => String(el[name].value).trim() === '';
      if (feld === 'brutto') {
        formular.dataset.vorsteuerHand = '';
        if (leer('brutto')) {
          el.netto.value = '';
          el.vorsteuer.value = '';
        } else {
          const bruttoRp = rappen(el.brutto.value);
          const nettoRp = nettoAusBruttoRappen(bruttoRp, satz);
          el.netto.value = fix2(nettoRp);
          el.vorsteuer.value = fix2(bruttoRp - nettoRp);
        }
      } else if (feld === 'vorsteuer') {
        formular.dataset.vorsteuerHand = leer('vorsteuer') ? '' : '1';
        if (!leer('netto')) el.brutto.value = fix2(rappen(el.netto.value) + rappen(el.vorsteuer.value));
      } else if (feld !== null) {
        if (leer('netto')) {
          el.vorsteuer.value = '';
          el.brutto.value = '';
        } else {
          const nettoRp = rappen(el.netto.value);
          if (!formular.dataset.vorsteuerHand) el.vorsteuer.value = fix2(prozentVonRappen(nettoRp, satz));
          el.brutto.value = fix2(nettoRp + rappen(el.vorsteuer.value));
        }
      }
      const hinweis = formular.querySelector('[data-rolle="betrag-hinweis"]');
      const vonHand = Boolean(formular.dataset.vorsteuerHand);
      const soll = leer('netto') ? 0 : prozentVonRappen(rappen(el.netto.value), satz);
      hinweis.innerHTML = vonHand && rappen(el.vorsteuer.value) !== soll
        ? `Vorsteuer von Hand (gerechnet wären ${chf(soll / 100)}),
          <button type="button" class="knopf eintrag-loeschen" data-aktion="vorsteuer-rechnen">neu rechnen</button>`
        : 'Brutto = netto + Vorsteuer, darauf laufen Zahlung, Skonto und Kontoauszug-Abgleich.';
    }

    // Live-Hinweise: Fälligkeit/Skontofrist als Datum, IBAN und Referenz geprüft.
    function pruefeFormular(formular) {
      const el = formular.elements;
      const tag = el.tag.value;
      const frist = parseInt(el.zahlungsfrist.value, 10);
      const skontoTage = parseInt(el.skontoTage.value, 10);
      formular.querySelector('[data-rolle="termine"]').textContent = tag ? [
        `Fällig am ${formatTag(plusTage(tag, Number.isFinite(frist) ? frist : ZAHLUNGSFRIST_TAGE))}`,
        zahl(el.skontoProzent.value) > 0 && skontoTage > 0
          ? `Skonto ${zahl(el.skontoProzent.value)} % bis ${formatTag(plusTage(tag, skontoTage))}` : '',
      ].filter(Boolean).join(' · ') : '';
      const iban = kompakt(el.iban.value);
      const ref = kompakt(el.referenz.value);
      const art = referenzArt(ref);
      formular.querySelector('[data-rolle="bank-pruefung"]').textContent = [
        iban ? (istGueltigeIban(iban) ? '✓ IBAN gültig' : '✗ IBAN ungültig, bitte prüfen') : '',
        ref ? ({ QRR: '✓ QR-Referenz gültig', SCOR: '✓ SCOR-Referenz gültig' }[art]
          || '⚠ Referenz ohne gültige Prüfziffer, wird als Text abgeglichen') : '',
      ].filter(Boolean).join(' · ');
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    // QR-Daten ins Formular übernehmen — Felder werden gefüllt, aber alles
    // bleibt editierbar (die Kostenart und den Rest ergänzt der Bauführer).
    function uebernehmeQr(formular, daten) {
      const setze = (name, wert) => {
        if (wert) formular.elements[name].value = wert;
      };
      setze('lieferant', daten.lieferant);
      if (daten.betrag) {
        // QR liefert das Brutto: netto und Vorsteuer zum Satz ableiten.
        setze('brutto', daten.betrag);
        rechneBetraege(formular, 'brutto');
      }
      setze('rechnungsNr', daten.rechnungsNr || daten.referenz);
      setze('tag', daten.rechnungsTag);
      setze('skontoProzent', daten.skontoProzent);
      setze('skontoTage', daten.skontoTage);
      setze('zahlungsfrist', daten.zahlungsfristTage);
      setze('iban', daten.iban);
      setze('referenz', daten.referenz);
      pruefeFormular(formular);
      if (daten.mitteilung && !formular.elements.notiz.value) {
        formular.elements.notiz.value = daten.mitteilung;
      }
      const info = formular.querySelector('[data-rolle="qr-info"]');
      info.hidden = false;
      info.textContent = `QR gelesen: ${daten.lieferant || '-'} · `
        + `${daten.waehrung || 'CHF'} ${daten.betrag || '-'} brutto · IBAN ${daten.iban || '-'}`
        + (daten.skontoProzent ? ` · Skonto ${daten.skontoProzent} % / ${daten.skontoTage} Tage` : '')
        + ', netto und Vorsteuer bitte mit der Rechnung prüfen, Kostenart wählen.';
    }

    // Scan-Dialog: Kamera live (Handy) oder QR aus einem Foto (Rückfallebene).
    // Nutzt die native BarcodeDetector-API — offline, keine Bibliothek.
    async function oeffneQrScan(formular) {
      if (!('BarcodeDetector' in window)) {
        alert('Dieses Gerät kann QR-Codes nicht direkt lesen (BarcodeDetector fehlt). '
          + 'Am Handy scannen oder die Werte von Hand eintragen.');
        return;
      }
      const erkenner = new BarcodeDetector({ formats: ['qr_code'] });
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <div class="karte formular dialog qr-dialog">
          <h3>QR-Rechnung scannen</h3>
          <video class="qr-video" autoplay playsinline muted></video>
          <p class="meldung" data-rolle="qr-status" role="status">Kamera startet …</p>
          <div class="knopfzeile">
            <label class="knopf">
              Aus Foto lesen
              <input type="file" accept="image/*" data-rolle="qr-foto" class="visually-hidden">
            </label>
            <button type="button" class="knopf" data-aktion="zu">Abbrechen</button>
          </div>
        </div>`;
      document.body.append(dialog);
      const video = dialog.querySelector('.qr-video');
      const status = dialog.querySelector('[data-rolle="qr-status"]');
      let strom = null;
      let laeuft = true;

      const schliessen = () => {
        laeuft = false;
        strom?.getTracks().forEach((t) => t.stop());
        dialog.remove();
      };

      const verarbeite = (rohtext) => {
        const daten = parseSwissQr(rohtext);
        if (!daten) {
          status.textContent = 'QR-Code gefunden, aber keine Schweizer QR-Rechnung, weiter versuchen.';
          return false;
        }
        uebernehmeQr(formular, daten);
        schliessen();
        return true;
      };

      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) schliessen();
      });
      dialog.querySelector('[data-rolle="qr-foto"]').addEventListener('change', async (wechsel) => {
        const datei = wechsel.target.files[0];
        if (!datei) return;
        try {
          const bild = await createImageBitmap(datei);
          const treffer = await erkenner.detect(bild);
          if (!treffer.length || !verarbeite(treffer[0].rawValue)) {
            status.textContent = treffer.length ? status.textContent
              : 'Kein QR-Code im Foto gefunden, näher und gerade fotografieren.';
          }
        } catch {
          status.textContent = 'Foto konnte nicht gelesen werden.';
        }
      });

      try {
        strom = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        video.srcObject = strom;
        status.textContent = 'Zahlteil der Rechnung vor die Kamera halten …';
        let sucheLaeuft = false;
        const suche = async () => {
          if (!laeuft) return;
          try {
            const treffer = await erkenner.detect(video);
            if (treffer.length && verarbeite(treffer[0].rawValue)) return;
          } catch { /* Einzelbild nicht lesbar — weiter */ }
          setTimeout(suche, 350);
        };
        const starteSuche = () => {
          if (sucheLaeuft || !laeuft) return;
          sucheLaeuft = true;
          suche();
        };
        video.addEventListener('loadeddata', starteSuche, { once: true });
        setTimeout(starteSuche, 1000); // Rückfallebene, falls das Ereignis ausbleibt
      } catch {
        status.textContent = 'Keine Kamera verfügbar, «Aus Foto lesen» nutzen.';
      }
    }

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) {
        schliesseFormular();
      } else if (klick.target.closest('[data-aktion="qr-scan"]')) {
        oeffneQrScan(formularBereich.querySelector('form'));
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const el = formular.elements;
        const satz = mwstSatzAus(el.vorsteuerSatz.value);
        if (satz === null) throw new Error('Vorsteuer-Satz ungültig, Prozent zwischen 0 und 99.9, z. B. 8.1.');
        if (String(el.netto.value).trim() === '') throw new Error('Netto-Betrag fehlt.');
        const nettoRp = rappen(el.netto.value);
        const vorsteuerRp = String(el.vorsteuer.value).trim() === ''
          ? prozentVonRappen(nettoRp, satz) : rappen(el.vorsteuer.value);
        const lieferant = formular.elements.lieferant.value.trim();
        const rechnungsNr = formular.elements.rechnungsNr.value.trim();
        // Doppelerfassungs-Schutz: gleiche Rechnung schon irgendwo erfasst?
        if (!inBearbeitung) {
          const alleKreditoren = await abfrage({ typ: 'kreditor' });
          const doppelt = alleKreditoren.find((k) =>
            k.lieferant.trim().toLowerCase() === lieferant.toLowerCase()
            && k.rechnungsNr.trim().toLowerCase() === rechnungsNr.toLowerCase());
          if (doppelt && !confirm(`Achtung: ${lieferant} · ${rechnungsNr} ist bereits `
            + `erfasst (${formatTag(doppelt.tag)}, ${chf(zahl(doppelt.betrag))} inkl. MWST). `
            + 'Trotzdem speichern?')) {
            meldung.textContent = 'Nicht gespeichert, vermutlich Doppelerfassung.';
            return;
          }
        }
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : {
              typ: 'kreditor',
              baustelleId: baustelle.baustelleId,
              status: 'offen',
              statusHistorie: [{ status: 'offen', datum: heuteTag() }],
            };
        const gespeichert = await put({
          ...basis,
          lieferant,
          rechnungsNr,
          tag: formular.elements.tag.value,
          datum: `${formular.elements.tag.value}T12:00:00.000Z`,
          netto: fix2(nettoRp),
          vorsteuerSatz: satz,
          vorsteuer: fix2(vorsteuerRp),
          betrag: fix2(nettoRp + vorsteuerRp), // brutto
          zahlungsfristTage: parseInt(formular.elements.zahlungsfrist.value, 10)
            || ZAHLUNGSFRIST_TAGE,
          skontoProzent: formular.elements.skontoProzent.value.trim(),
          skontoTage: formular.elements.skontoTage.value.trim(),
          kostenart: formular.elements.kostenart.value,
          notiz: formular.elements.notiz.value.trim(),
          iban: kompakt(formular.elements.iban.value),
          referenz: kompakt(formular.elements.referenz.value),
        });
        // Belege anhängen: Fotos verkleinert, PDF unverändert.
        const dateien = [...formular.querySelector('[data-rolle="beleg-eingabe"]').files];
        let lauf = belegAnzahl(gespeichert);
        for (const [i, datei] of dateien.entries()) {
          meldung.textContent = `Beleg ${i + 1} von ${dateien.length} wird verarbeitet …`;
          lauf += 1;
          const kennung = `${Date.now().toString(36)}-${lauf}`;
          if (datei.type === 'application/pdf') {
            await haengeAnhangAn(gespeichert._id, `beleg-${kennung}.pdf`, datei);
          } else {
            const klein = await verkleinereFoto(datei);
            await haengeAnhangAn(gespeichert._id, `beleg-${kennung}.jpg`, klein);
          }
        }
        schliesseFormular();
        meldungElement.textContent = dateien.length
          ? `Rechnung gespeichert, ${dateien.length} Beleg${dateien.length > 1 ? 'e' : ''} angehängt.`
          : 'Rechnung gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    // ---------- Beleg-Ansicht ----------
    async function zeigeBelege(kreditor) {
      const namen = Object.keys(kreditor._attachments || {});
      const oeffneEinzeln = async (name) => {
        const blob = await holeAnhang(kreditor._id, name);
        if (name.endsWith('.pdf')) {
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        } else {
          const url = URL.createObjectURL(blob);
          zeigeBildVollbild(url, {
            onLoeschen: async () => {
              await entferneAnhang(kreditor._id, name);
              document.dispatchEvent(new CustomEvent('luense:daten'));
              await zeichneTabelle();
            },
          });
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        }
      };
      if (namen.length === 1) {
        oeffneEinzeln(namen[0]);
        return;
      }
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <div class="karte formular dialog">
          <h3>Belege · ${esc(kreditor.lieferant)} ${esc(kreditor.rechnungsNr)}</h3>
          ${namen.map((name, i) => `
            <div class="fo-zeile dossier-zeile">
              <span class="fo-label">Beleg ${i + 1} ${name.endsWith('.pdf') ? '(PDF)' : '(Foto)'}</span>
              <button type="button" class="knopf" data-beleg="${esc(name)}">Öffnen</button>
            </div>`).join('')}
          <div class="knopfzeile">
            <button type="button" class="knopf" data-aktion="zu">Schliessen</button>
          </div>
        </div>`;
      document.body.append(dialog);
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) {
          dialog.remove();
          return;
        }
        const name = klick.target.closest('[data-beleg]')?.dataset.beleg;
        if (name) oeffneEinzeln(name);
      });
    }

    // ---------- Visum mit Lieferschein-Abgleich (Abend 9.4) ----------
    // Beim Visieren zeigt der Dialog die Material-Zeilen aus den Tages-
    // rapporten der Baustelle: «Wurde geliefert, was verrechnet wird?»
    // Reine Anzeige-Hilfe zum Abhaken — keine Automatik, kein Speichern
    // der Haken; entschieden wird mit Visum und Bemerkung.
    async function oeffneVisumDialog(kreditor) {
      const rapporte = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
      const materialZeilen = rapporte
        .flatMap((r) => (r.arbeiten || []).flatMap((arbeit) =>
          (arbeit.material || []).map((m) => ({ tag: r.tag, ...m }))))
        .filter((m) => m.name || m.menge)
        .sort((a, b) => (b.tag || '').localeCompare(a.tag || ''));
      const gezeigt = materialZeilen.slice(0, 30);
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <form class="karte formular dialog" data-rolle="visum-dialog">
          <h3>Visum · ${esc(kreditor.lieferant)} ${esc(kreditor.rechnungsNr)}</h3>
          <p class="hinweis visum-betrag">netto ${chf(kreditorBetraege(kreditor).netto)} exkl. MWST
            · brutto ${chf(kreditorBetraege(kreditor).brutto)} inkl. MWST</p>
          <p class="gruppen-label">Lieferschein-Abgleich: Material aus den Tagesrapporten</p>
          ${gezeigt.length ? `
            <div class="beweis-liste">
              ${gezeigt.map((m) => `
                <label class="beweis-zeile">
                  <input type="checkbox">
                  <span>${m.tag ? m.tag.split('-').reverse().join('.') + ' · ' : ''}${esc(m.name || '-')}${
                    [m.menge, m.einheit].filter(Boolean).length
                      ? ' · ' + [m.menge, m.einheit].filter(Boolean).map(esc).join(' ') : ''}</span>
                </label>`).join('')}
            </div>
            ${materialZeilen.length > gezeigt.length ? `
              <p class="hinweis">… und ${materialZeilen.length - gezeigt.length} ältere Einträge.</p>` : ''}
            <p class="hinweis">Haken dienen nur dem Abgleich beim Prüfen, gespeichert
              wird das Visum mit Bemerkung.</p>`
          : '<p class="hinweis">Keine Material-Einträge in den Rapporten dieser Baustelle.</p>'}
          <label>Visum-Bemerkung (optional)<input name="bemerkung" autocomplete="off"
            placeholder="z. B. Mengen gemäss Rapporten geprüft"></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Visieren</button>
            <button type="button" class="knopf" data-aktion="zu">Abbrechen</button>
          </div>
        </form>`;
      document.body.append(dialog);
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) dialog.remove();
      });
      dialog.querySelector('form').addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const doc = mitHistorie(kreditor, 'visiert');
        doc.visumNotiz = abschicken.target.elements.bemerkung.value.trim();
        await put(doc);
        dialog.remove();
        meldungElement.textContent = `${kreditor.lieferant} ${kreditor.rechnungsNr} → visiert.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      });
    }

    // ---------- Aktionen ----------
    neuKnopf.addEventListener('click', () => oeffneFormular(null));

    container.querySelector('.ansicht-wahl').addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-ansicht]');
      if (!knopf) return;
      ansicht = knopf.dataset.ansicht;
      try { localStorage.setItem(ANSICHT_MERKER, ansicht); } catch { /* egal */ }
      meldungElement.textContent = '';
      zeichneTabelle();
    });

    container.querySelector('[data-aktion="kontoauszug"]').addEventListener('click', () => {
      oeffneKontoauszug({
        richtung: 'DBIT',
        nachBuchung: async (text) => {
          await zeichneTabelle();
          meldungElement.textContent = text;
        },
      });
    });

    tabelleElement.addEventListener('change', (wechsel) => {
      if (wechsel.target.matches('[data-rolle="filter-baustelle"]')) {
        filterBaustelle = wechsel.target.value;
        zeichneTabelle();
      }
    });

    container.querySelector('[data-aktion="export"]')
      .addEventListener('click', async () => {
        const kreditoren = ansicht === 'alle'
          ? (await abfrage({ typ: 'kreditor' })).filter((k) => k.status !== 'bezahlt')
          : await ladeKreditoren();
        const ktrVon = new Map((await alleBaustellen({ mitArchivierten: true }))
          .map((b) => [b.baustelleId, b.ktr]));
        exportiereCsv(
          ansicht === 'alle' ? 'luense-offene-kreditoren.csv' : `luense-kreditoren-${baustelle.ktr}.csv`,
          ['KTR', 'Lieferant', 'Rechnungs-Nr.', 'Datum', 'Kostenart', 'Netto exkl. MWST CHF',
            'Vorsteuer-Satz %', 'Vorsteuer CHF', 'Brutto inkl. MWST CHF',
            'Bezahlt CHF', 'Offen CHF',
            'Skonto %', 'Skonto bis', 'Skonto CHF', 'Fällig', 'Status',
            'Bezahlt am', 'Skonto genutzt', 'IBAN', 'Referenz',
            'Visum-Bemerkung', 'Notiz', 'Statusverlauf'],
          kreditoren.slice().reverse().map((k) => {
            const w = kreditorWerte(k);
            return [ktrVon.get(k.baustelleId) || '', k.lieferant, k.rechnungsNr, formatTag(k.tag),
              k.kostenart, w.netto, w.vorsteuerSatz, w.vorsteuer, w.betrag, w.bezahlt, w.rest, zahl(k.skontoProzent) || '', formatTag(w.skontoTag),
              w.skontoBetrag || '', formatTag(w.faelligTag), k.status,
              formatTag(k.bezahltAm), k.skontoGenutzt ? 'ja' : '',
              k.iban || '', k.referenz || '',
              k.visumNotiz || '', k.notiz || '',
              (k.statusHistorie || []).map((h) => `${h.status} ${formatTag(h.datum)}`).join(' → ')];
          }),
        );
      });

    tabelleElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      if (knopf.dataset.aktion === 'zur-baustelle') {
        ansicht = 'baustelle';
        try { localStorage.setItem(ANSICHT_MERKER, ansicht); } catch { /* egal */ }
        document.dispatchEvent(new CustomEvent('luense:baustelleWechseln',
          { detail: { baustelleId: knopf.dataset.baustelle } }));
        return;
      }
      const kreditoren = await ladeKreditoren();
      const kreditor = kreditoren.find((k) => k._id === knopf.dataset.id);
      if (!kreditor) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'oeffnen') {
        oeffneFormular(kreditor);
      } else if (aktion === 'beleg') {
        zeigeBelege(kreditor);
      } else if (aktion === 'zahlungen') {
        zeigeZahlungen(kreditor._id, {
          titel: `Zahlungen · ${kreditor.lieferant} ${kreditor.rechnungsNr}`,
          nachAenderung: zeichneTabelle,
        });
      } else if (aktion === 'weiter') {
        const naechster = naechsterStatus(kreditor);
        if (!naechster) return;
        if (naechster === 'bezahlt' && kreditor.status === 'teilbezahlt'
          && !confirm(`Noch offen: ${chf(offenerBetrag(kreditor))}. Trotzdem als bezahlt abschliessen?`)) return;
        if (naechster === 'visiert') {
          // Visum im Dialog mit Lieferschein-Abgleich (Abend 9.4).
          oeffneVisumDialog(kreditor);
          return;
        }
        const doc = mitHistorie(kreditor, naechster);
        if (naechster === 'bezahlt') {
          doc.bezahltAm = heuteTag();
          const w = kreditorWerte(kreditor);
          if (w.skontoNutzbar) {
            doc.skontoGenutzt = confirm(`Skonto nutzen? ${chf(w.skontoBetrag)} `
              + `(${zahl(kreditor.skontoProzent)} %), Frist läuft bis ${formatTag(w.skontoTag)}. `
              + `Zahlbetrag mit Skonto: ${chf(w.betrag - w.skontoBetrag)}.`);
          }
        }
        await put(doc);
        meldungElement.textContent = `${kreditor.lieferant} ${kreditor.rechnungsNr} → ${naechster}.`
          + (doc.skontoGenutzt ? ` Skonto genutzt: ${chf(kreditorWerte(kreditor).skontoBetrag)} gespart.` : '');
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'zurueck') {
        const vorheriger = vorherigerStatus(kreditor);
        if (!vorheriger) return;
        const doc = mitHistorie(kreditor, vorheriger);
        if (kreditor.status === 'bezahlt') {
          delete doc.bezahltAm;
          if (!zahlungen(kreditor).some((z) => zahl(z.skonto) > 0)) delete doc.skontoGenutzt;
        }
        if (vorheriger === 'offen') doc.visumNotiz = '';
        await put(doc);
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'loeschen') {
        if (!confirm(`Rechnung ${kreditor.lieferant} · ${kreditor.rechnungsNr} endgültig löschen (samt Belegen)?`)) return;
        await entferneDokument(kreditor._id);
        if (inBearbeitung?._id === kreditor._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      }
    });

    zeichneTabelle();
  },
};
