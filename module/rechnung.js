// module/rechnung.js — Debitoren: Rechnungsablage und -verwaltung (Abend 8.4,
// ausgebaut mit Bank-Verknüpfung). Darstellung im Cockpit-Stil: Kacheln,
// Tabelle mit Summenzeile. Dokumenttyp «rechnung»; Basis verlinkt auf
// Regierapport oder Nachtrag (Dokumente teilen, nie Code). Beim Wechsel auf
// «gestellt» springt die verlinkte Grundlage automatisch auf «verrechnet».
//
// Bank-Verknüpfung: Jede Rechnung trägt eine SCOR-Referenz (RF…, aus der
// Rechnungsnummer), das PDF einen QR-Zahlteil. Zahlungen kommen über den
// Kontoauszug (camt.053/054, kern/bank.js) oder von Hand; daraus folgen
// «teilbezahlt» bzw. «bezahlt» mit Datumsstempel. Dazu die Übersicht der
// offenen Forderungen über alle Baustellen mit Fälligkeit.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import {
  RECHNUNG_STATUS, ZAHLUNGSFRIST_TAGE, naechsteRechnungsnummer, heuteTag,
} from '../kern/rechnung.js';
import {
  zahl, formatTag, scorAusNummer, formatReferenz, formatIban, offenerBetrag,
  bezahltSumme, rechnungFaellig, zahlungen,
} from '../kern/zahlung.js';
import { zahlteilSvg, pruefeZahlteil, adresseVollstaendig } from '../kern/qrrechnung.js';
import { oeffneKontoauszug, zeigeZahlungen } from '../kern/bank.js';
import { alleBaustellen, ladeFirma } from '../kern/stamm.js';
import { exportiereCsv } from '../kern/export.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { chf, esc } from '../kern/ui.js';

const ANSICHT_MERKER = 'luense.rechnungAnsicht'; // nur UI-Zustand
const FORDERUNG = ['gestellt', 'teilbezahlt'];

function mitHistorie(rechnung, neuerStatus) {
  return {
    ...rechnung,
    status: neuerStatus,
    statusHistorie: [...(rechnung.statusHistorie || []),
      { status: neuerStatus, datum: heuteTag() }],
  };
}

function basisText(basis) {
  if (!basis || basis.art === 'manuell' || !basis.art) return basis?.label || 'manuell';
  return basis.art === 'regierapport'
    ? `Regierapport ${basis.label || ''}`.trim()
    : `Nachtrag ${basis.label || ''}`.trim();
}

function referenzVon(r) {
  return r.referenz || scorAusNummer(r.nummer);
}

// Nächster/vorheriger Schritt von Hand. «teilbezahlt» entsteht nur aus
// Zahlungen und wird über die Zahlungs-Übersicht korrigiert.
function naechsterStatus(r) {
  if (r.status === 'teilbezahlt') return 'bezahlt';
  return RECHNUNG_STATUS[RECHNUNG_STATUS.indexOf(r.status) + 1] || '';
}

function vorherigerStatus(r) {
  if (r.status === 'teilbezahlt') return '';
  if (r.status === 'bezahlt' && zahlungen(r).length) {
    return bezahltSumme(r) < zahl(r.betrag) - 0.005 ? 'teilbezahlt' : '';
  }
  return RECHNUNG_STATUS[RECHNUNG_STATUS.indexOf(r.status) - 1] || '';
}

function tageUeberfaellig(faellig, heute) {
  if (!faellig || faellig >= heute) return 0;
  return Math.round((new Date(`${heute}T12:00:00`) - new Date(`${faellig}T12:00:00`)) / 86400000);
}

export default {
  name: 'Rechnungen',
  dokumentTypen: ['rechnung'],

  // Badge: Rechnungen, die noch nicht bezahlt sind.
  async badge(baustelle) {
    const alle = await abfrage({ typ: 'rechnung', baustelleId: baustelle.baustelleId });
    return alle.filter((r) => r.status !== 'bezahlt').length || null;
  },

  render(container, baustelle) {
    let inBearbeitung = null;
    let ansicht = 'baustelle';
    try {
      ansicht = localStorage.getItem(ANSICHT_MERKER) === 'alle' ? 'alle' : 'baustelle';
    } catch { /* ohne Speicher: Standardansicht */ }
    let filterBaustelle = '';

    container.innerHTML = `
      <section class="rechnungen">
        <h2>Rechnungen · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="chips ansicht-wahl" role="tablist">
          <button type="button" class="chip chip-knopf" data-ansicht="baustelle" role="tab">Diese Baustelle</button>
          <button type="button" class="chip chip-knopf" data-ansicht="alle" role="tab">Offene Posten alle Baustellen</button>
        </div>

        <div class="kachel-reihe" data-rolle="kacheln"></div>
        <p class="hinweis" data-rolle="gesamt"></p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neue Rechnung
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
    const gesamtElement = container.querySelector('[data-rolle="gesamt"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const neuKnopf = container.querySelector('[data-aktion="neu"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const tabelleElement = container.querySelector('[data-rolle="tabelle"]');
    const meldungElement = container.querySelector('[data-rolle="meldung"]');

    async function ladeRechnungen() {
      const alle = await abfrage({ typ: 'rechnung', baustelleId: baustelle.baustelleId });
      return alle.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
    }

    function summe(liste) {
      return liste.reduce((s, r) => s + zahl(r.betrag), 0);
    }

    function summeOffen(liste) {
      return liste.reduce((s, r) => s + offenerBetrag(r), 0);
    }

    async function zeichneKacheln(rechnungen) {
      const jeStatus = (status, liste) => liste.filter((r) => r.status === status);
      const teil = jeStatus('teilbezahlt', rechnungen);
      const kacheln = [
        { titel: 'offen', liste: jeStatus('offen', rechnungen), wert: summe },
        { titel: 'gestellt', liste: jeStatus('gestellt', rechnungen), wert: summe },
        ...(teil.length ? [{ titel: 'teilbezahlt — Rest', liste: teil, wert: summeOffen }] : []),
        { titel: 'bezahlt', liste: jeStatus('bezahlt', rechnungen), wert: summe, gruen: true },
      ];
      kachelnElement.innerHTML = kacheln.map((k) => `
        <div class="karte kachel${k.gruen ? ' kachel-gruen' : ''}">
          <span class="kachel-titel">${k.titel} (${k.liste.length})</span>
          <span class="kachel-wert">${chf(k.wert(k.liste))}</span>
        </div>`).join('');
      const alleBaustellenRechnungen = await abfrage({ typ: 'rechnung' });
      const forderungen = alleBaustellenRechnungen.filter((r) => FORDERUNG.includes(r.status));
      const heute = heuteTag();
      const ueberfaellig = forderungen.filter((r) => tageUeberfaellig(rechnungFaellig(r), heute) > 0);
      gesamtElement.textContent = `Offene Forderungen über alle Baustellen: ${chf(summeOffen(forderungen))}`
        + ` (${forderungen.length})${ueberfaellig.length
          ? ` · davon überfällig ${chf(summeOffen(ueberfaellig))} (${ueberfaellig.length})` : ''}`;
    }

    // ---------- Formular ----------
    async function oeffneFormular(rechnung) {
      inBearbeitung = rechnung || null;
      neuZeile.hidden = true;
      const nummer = rechnung?.nummer || await naechsteRechnungsnummer();
      const deb = rechnung?.debitor || { name: baustelle.bauherr || '' };
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="rechnung-formular">
          <h3>${rechnung ? `Rechnung ${esc(rechnung.nummer)} bearbeiten` : 'Neue Rechnung'}</h3>
          <div class="feld-reihe">
            <label>Nummer *<input name="nummer" required autocomplete="off"
              value="${esc(nummer)}"></label>
            <label>Datum *<input name="tag" type="date" required
              value="${esc(rechnung?.tag || heuteTag())}"></label>
          </div>
          <label>Titel *<input name="titel" required autocomplete="off"
            value="${esc(rechnung?.titel ?? '')}"
            placeholder="z. B. Regiearbeiten KW 35"></label>
          <div class="feld-reihe">
            <label>Betrag [CHF] *<input name="betrag" type="number" required
              inputmode="decimal" step="any" value="${esc(rechnung?.betrag ?? '')}"
              placeholder="0.00"></label>
            <label>Zahlungsfrist [Tage]<input name="zahlungsfrist" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(rechnung?.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE)}"></label>
          </div>
          <details class="adress-block" ${adresseVollstaendig(deb) ? '' : 'open'}>
            <summary>Rechnungsadresse (für PDF und QR-Zahlteil)</summary>
            <label>Name / Firma<input name="debName" autocomplete="off" value="${esc(deb.name ?? '')}"></label>
            <div class="feld-reihe">
              <label class="feld-breit">Strasse<input name="debStrasse" autocomplete="off"
                value="${esc(deb.strasse ?? '')}"></label>
              <label class="feld-schmal">Nr.<input name="debHausnummer" autocomplete="off"
                value="${esc(deb.hausnummer ?? '')}"></label>
            </div>
            <div class="feld-reihe">
              <label class="feld-schmal">PLZ<input name="debPlz" inputmode="numeric" autocomplete="off"
                value="${esc(deb.plz ?? '')}"></label>
              <label class="feld-breit">Ort<input name="debOrt" autocomplete="off"
                value="${esc(deb.ort ?? '')}"></label>
            </div>
            <p class="hinweis">Ohne PLZ und Ort bleibt «Zahlbar durch» im Zahlteil leer
              (zum Ausfüllen von Hand) — das ist zulässig.</p>
          </details>
          ${rechnung?.basis && rechnung.basis.art !== 'manuell' ? `
            <p class="hinweis">Basis: ${esc(basisText(rechnung.basis))} — bleibt verknüpft.</p>` : ''}
          ${rechnung ? `<p class="hinweis">Zahlungsreferenz: ${esc(formatReferenz(referenzVon(rechnung)))}</p>` : ''}
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rechnung speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    // ---------- Tabelle dieser Baustelle ----------
    async function zeichneBaustelle() {
      const rechnungen = await ladeRechnungen();
      await zeichneKacheln(rechnungen);
      if (!rechnungen.length) {
        tabelleElement.innerHTML =
          '<p class="hinweis">Noch keine Rechnungen auf dieser Baustelle. '
          + 'Rechnungen entstehen hier — oder direkt aus unterschriebenen '
          + 'Regierapporten und genehmigten Nachträgen.</p>';
        return;
      }
      const heute = heuteTag();
      tabelleElement.innerHTML = `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Nummer</th><th>Datum</th><th>Titel</th><th>Basis</th>
              <th class="zahl">Betrag</th><th class="zahl">Offen</th><th>Status</th><th>Zahlbar bis</th><th></th>
            </tr></thead>
            <tbody>
              ${rechnungen.map((r) => {
                const naechster = naechsterStatus(r);
                const vorheriger = vorherigerStatus(r);
                const frist = rechnungFaellig(r);
                const ueberfaellig = FORDERUNG.includes(r.status) && tageUeberfaellig(frist, heute) > 0;
                const anzahlZahlungen = zahlungen(r).length;
                return `
                  <tr>
                    <td class="kein-umbruch">${esc(r.nummer)}<br>
                      <small class="hinweis">${esc(formatReferenz(referenzVon(r)))}</small></td>
                    <td class="kein-umbruch">${formatTag(r.tag)}</td>
                    <td class="text-spalte">${esc(r.titel)}</td>
                    <td class="kein-umbruch">${esc(basisText(r.basis))}</td>
                    <td class="zahl">${chf(zahl(r.betrag))}</td>
                    <td class="zahl">${r.status === 'bezahlt' ? '—' : chf(offenerBetrag(r))}</td>
                    <td class="status-spalte">${esc(r.status)}${ueberfaellig
                      ? ' <span class="ueberfaellig">überfällig</span>' : ''}<br>
                      <small class="hinweis">${(r.statusHistorie || [])
                        .map((h) => `${esc(h.status)} ${formatTag(h.datum)}`).join(' → ')}</small></td>
                    <td class="kein-umbruch">${r.status === 'bezahlt' ? `bezahlt ${formatTag(r.bezahltAm) || ''}`.trim() : formatTag(frist)}</td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${naechster ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="weiter"
                          data-id="${esc(r._id)}">→ ${naechster}</button>` : ''}
                      ${vorheriger ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="zurueck"
                          data-id="${esc(r._id)}">← zurück</button>` : ''}
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="zahlungen"
                        data-id="${esc(r._id)}">Zahlungen${anzahlZahlungen ? ` (${anzahlZahlungen})` : ''}</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                        data-id="${esc(r._id)}">PDF</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                        data-id="${esc(r._id)}">Bearbeiten</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                        data-id="${esc(r._id)}" aria-label="Rechnung löschen">Löschen</button>
                    </span></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="4"><b>Total (${rechnungen.length})</b></td>
                <td class="zahl"><b>${chf(summe(rechnungen))}</b></td>
                <td class="zahl"><b>${chf(summeOffen(rechnungen.filter((r) => r.status !== 'offen')))}</b></td>
                <td colspan="3">davon bezahlt ${chf(summe(rechnungen.filter((r) => r.status === 'bezahlt'))
                  + rechnungen.filter((r) => r.status !== 'bezahlt').reduce((s, r) => s + bezahltSumme(r), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    // ---------- Offene Posten über alle Baustellen ----------
    async function zeichneAlle() {
      const [alle, baustellen] = await Promise.all([
        abfrage({ typ: 'rechnung' }), alleBaustellen({ mitArchivierten: true }),
      ]);
      const ktr = new Map(baustellen.map((b) => [b.baustelleId, b]));
      const heute = heuteTag();
      const forderungen = alle
        .filter((r) => FORDERUNG.includes(r.status))
        .filter((r) => !filterBaustelle || r.baustelleId === filterBaustelle)
        .map((r) => ({ r, faellig: rechnungFaellig(r), tage: tageUeberfaellig(rechnungFaellig(r), heute) }))
        .sort((a, b) => (a.faellig || '').localeCompare(b.faellig || ''));
      const nichtGestellt = alle.filter((r) => r.status === 'offen'
        && (!filterBaustelle || r.baustelleId === filterBaustelle));
      const total = forderungen.reduce((s, f) => s + offenerBetrag(f.r), 0);
      const ueber = forderungen.filter((f) => f.tage > 0);
      const mitRechnungen = baustellen.filter((b) => alle.some((r) => r.baustelleId === b.baustelleId));
      kachelnElement.innerHTML = `
        <div class="karte kachel">
          <span class="kachel-titel">Offene Forderungen (${forderungen.length})</span>
          <span class="kachel-wert">${chf(total)}</span>
        </div>
        <div class="karte kachel">
          <span class="kachel-titel">davon überfällig (${ueber.length})</span>
          <span class="kachel-wert ${ueber.length ? 'verlust' : ''}">${chf(ueber.reduce((s, f) => s + offenerBetrag(f.r), 0))}</span>
        </div>`;
      gesamtElement.textContent = nichtGestellt.length
        ? `Noch nicht gestellt: ${nichtGestellt.length} Rechnung${nichtGestellt.length > 1 ? 'en' : ''}, ${chf(summe(nichtGestellt))}.`
        : '';
      tabelleElement.innerHTML = `
        <label class="filter-baustelle">Baustelle
          <select data-rolle="filter-baustelle">
            <option value="">Alle Baustellen</option>
            ${mitRechnungen.map((b) => `<option value="${esc(b.baustelleId)}"
              ${b.baustelleId === filterBaustelle ? 'selected' : ''}>${esc(b.ktr)} · ${esc(b.name)}</option>`).join('')}
          </select>
        </label>
        ${forderungen.length ? `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Fällig</th><th>Baustelle</th><th>Nummer</th><th>Titel</th>
              <th class="zahl">Betrag</th><th class="zahl">Offen</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${forderungen.map(({ r, faellig, tage }) => {
                const b = ktr.get(r.baustelleId);
                return `
                  <tr class="${tage > 0 ? 'zeile-ueberfaellig' : ''}">
                    <td class="kein-umbruch">${formatTag(faellig)}${tage > 0
                      ? `<br><span class="ueberfaellig">${tage} Tag${tage > 1 ? 'e' : ''} überfällig</span>` : ''}</td>
                    <td class="kein-umbruch">${esc(b?.ktr || '—')}<br><small class="hinweis">${esc(b?.name || '')}</small></td>
                    <td class="kein-umbruch">${esc(r.nummer)}</td>
                    <td class="text-spalte">${esc(r.titel)}</td>
                    <td class="zahl">${chf(zahl(r.betrag))}</td>
                    <td class="zahl"><b>${chf(offenerBetrag(r))}</b></td>
                    <td class="kein-umbruch">${esc(r.status)}</td>
                    <td class="zahl"><button type="button" class="knopf eintrag-loeschen"
                      data-aktion="zur-baustelle" data-baustelle="${esc(r.baustelleId)}">Öffnen</button></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="5"><b>Total offen (${forderungen.length})</b></td>
                <td class="zahl"><b>${chf(total)}</b></td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>` : '<p class="hinweis">Keine offenen Forderungen — alles bezahlt.</p>'}`;
    }

    async function zeichneTabelle() {
      container.querySelectorAll('[data-ansicht]').forEach((k) => {
        k.classList.toggle('aktiv', k.dataset.ansicht === ansicht);
        k.setAttribute('aria-selected', String(k.dataset.ansicht === ansicht));
      });
      neuKnopf.hidden = ansicht === 'alle';
      if (ansicht === 'alle') {
        schliesseFormular();
        await zeichneAlle();
      } else {
        await zeichneBaustelle();
      }
    }

    // Beim Wechsel auf «gestellt» springt die verlinkte Grundlage auf
    // «verrechnet» — Regierapport wie Nachtrag, je mit Datumsstempel.
    async function stelleGrundlageVerrechnet(rechnung) {
      const basis = rechnung.basis;
      if (!basis?.id) return '';
      if (basis.art === 'regierapport') {
        const alle = await abfrage({ typ: 'rapport', baustelleId: rechnung.baustelleId });
        const rapport = alle.find((r) => r._id === basis.id);
        if (rapport && rapport.regieStatus !== 'verrechnet') {
          await put({
            ...rapport,
            regieStatus: 'verrechnet',
            regieStatusHistorie: [...(rapport.regieStatusHistorie || []),
              { status: 'verrechnet', datum: heuteTag() }],
          });
          return ` Regierapport ${basis.label || ''} → verrechnet.`;
        }
      } else if (basis.art === 'nachtrag') {
        const alle = await abfrage({ typ: 'nachtrag', baustelleId: rechnung.baustelleId });
        const nachtrag = alle.find((n) => n._id === basis.id);
        if (nachtrag && nachtrag.status !== 'verrechnet') {
          await put({
            ...nachtrag,
            status: 'verrechnet',
            statusHistorie: [...(nachtrag.statusHistorie || []),
              { status: 'verrechnet', datum: heuteTag() }],
          });
          return ` Nachtrag ${basis.label || ''} → verrechnet.`;
        }
      }
      return '';
    }

    // ---------- PDF mit QR-Zahlteil ----------
    async function rechnungsPdf(rechnung) {
      const firma = await ladeFirma();
      const frist = rechnungFaellig(rechnung);
      const referenz = referenzVon(rechnung);
      const offen = offenerBetrag(rechnung);
      const bezahlt = bezahltSumme(rechnung);
      const deb = rechnung.debitor || {};
      const empfaenger = [deb.name || baustelle.bauherr, [deb.strasse, deb.hausnummer].filter(Boolean).join(' '),
        [deb.plz, deb.ort].filter(Boolean).join(' ')].filter(Boolean);
      const absender = firma ? [firma.name, [firma.strasse, firma.hausnummer].filter(Boolean).join(' '),
        [firma.plz, firma.ort].filter(Boolean).join(' '),
        [firma.telefon, firma.email].filter(Boolean).join(' · '),
        firma.mwstNr].filter(Boolean) : [];

      const angaben = {
        firma: firma || {},
        debitor: deb,
        betrag: offen,
        referenz,
        mitteilung: `Rechnung ${rechnung.nummer}${rechnung.titel ? ` ${rechnung.titel}` : ''}`,
        rechnungsNr: rechnung.nummer,
        rechnungsTag: rechnung.tag,
        zahlungsfristTage: rechnung.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE,
      };
      const maengel = rechnung.status === 'bezahlt' ? ['Rechnung ist bezahlt.'] : pruefeZahlteil(angaben);
      let svg = '';
      if (!maengel.length) {
        try {
          svg = zahlteilSvg(angaben);
        } catch (fehler) {
          maengel.push(fehler.message);
        }
      }
      meldungElement.textContent = maengel.length && rechnung.status !== 'bezahlt'
        ? `PDF ohne QR-Zahlteil: ${maengel.join(' ')}` : '';

      zeigeProtokollDruck(baustelle, {
        titel: `Rechnung ${rechnung.nummer}`,
        untertitel: [absender[0] ? `Von: ${absender.join(', ')}` : '',
          `Rechnungsdatum: ${formatTag(rechnung.tag)}`].filter(Boolean).join(' · '),
        abschnitte: [
          empfaenger.length ? { art: 'felder', titel: 'Rechnungsempfänger',
            zeilen: [{ label: 'Adresse', wert: empfaenger.join(', ') }] } : null,
          { art: 'tabelle', titel: 'Leistung',
            spalten: ['Bezeichnung', 'Basis', 'Betrag'],
            zeilen: [[rechnung.titel, basisText(rechnung.basis), chf(zahl(rechnung.betrag))]] },
          { art: 'felder', titel: 'Zahlung', zeilen: [
            { label: 'Rechnungsbetrag', wert: chf(zahl(rechnung.betrag)) },
            ...(bezahlt ? [{ label: 'Bereits bezahlt', wert: chf(bezahlt) },
              { label: 'Noch offen', wert: chf(offen) }] : []),
            { label: 'Zahlungsfrist', wert: `${rechnung.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE} Tage` },
            { label: 'Zahlbar bis', wert: formatTag(frist) },
            ...(firma?.iban ? [{ label: 'IBAN', wert: formatIban(firma.iban) }] : []),
            { label: 'Referenz', wert: formatReferenz(referenz) },
          ] },
          rechnung.statusHistorie?.length ? { art: 'felder', titel: 'Status',
            zeilen: rechnung.statusHistorie.map((h) => ({
              label: h.status, wert: formatTag(h.datum),
            })) } : null,
        ].filter(Boolean),
        unterschriften: [],
        zahlteilSvg: svg,
        zahlteilHinweis: `Zahlteil zu Rechnung ${rechnung.nummer} · ${baustelle.ktr} ${baustelle.name}`,
      });
    }

    // ---------- Aktionen ----------
    container.querySelector('.ansicht-wahl').addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-ansicht]');
      if (!knopf) return;
      ansicht = knopf.dataset.ansicht;
      try { localStorage.setItem(ANSICHT_MERKER, ansicht); } catch { /* egal */ }
      meldungElement.textContent = '';
      zeichneTabelle();
    });

    neuKnopf.addEventListener('click', () => oeffneFormular(null));

    container.querySelector('[data-aktion="kontoauszug"]').addEventListener('click', () => {
      oeffneKontoauszug({
        richtung: 'CRDT',
        nachBuchung: async (text) => {
          await zeichneTabelle();
          meldungElement.textContent = text;
        },
      });
    });

    container.querySelector('[data-aktion="export"]')
      .addEventListener('click', async () => {
        const rechnungen = ansicht === 'alle'
          ? (await abfrage({ typ: 'rechnung' })).filter((r) => FORDERUNG.includes(r.status))
          : await ladeRechnungen();
        const baustellen = new Map((await alleBaustellen({ mitArchivierten: true }))
          .map((b) => [b.baustelleId, b.ktr]));
        exportiereCsv(
          ansicht === 'alle' ? 'luense-offene-forderungen.csv' : `luense-rechnungen-${baustelle.ktr}.csv`,
          ['KTR', 'Nummer', 'Datum', 'Titel', 'Basis', 'Betrag CHF', 'Bezahlt CHF', 'Offen CHF',
            'Status', 'Zahlbar bis', 'Referenz', 'Statusverlauf'],
          rechnungen.slice().reverse().map((r) => [baustellen.get(r.baustelleId) || '', r.nummer,
            formatTag(r.tag), r.titel, basisText(r.basis), zahl(r.betrag), bezahltSumme(r),
            offenerBetrag(r), r.status,
            r.status === 'bezahlt' ? '' : formatTag(rechnungFaellig(r)), referenzVon(r),
            (r.statusHistorie || []).map((h) => `${h.status} ${formatTag(h.datum)}`).join(' → ')]),
        );
      });

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) schliesseFormular();
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : {
              typ: 'rechnung',
              baustelleId: baustelle.baustelleId,
              basis: { art: 'manuell', id: '', label: '' },
              status: 'offen',
              statusHistorie: [{ status: 'offen', datum: heuteTag() }],
            };
        const nummer = formular.elements.nummer.value.trim();
        // Referenz bleibt, solange die Nummer gleich bleibt (schon verschickt).
        const referenz = basis.referenz && basis.nummer === nummer
          ? basis.referenz : scorAusNummer(nummer);
        const feld = (name) => formular.elements[name].value.trim();
        await put({
          ...basis,
          nummer,
          referenz,
          tag: formular.elements.tag.value,
          titel: feld('titel'),
          betrag: feld('betrag'),
          zahlungsfristTage: parseInt(formular.elements.zahlungsfrist.value, 10)
            || ZAHLUNGSFRIST_TAGE,
          debitor: {
            name: feld('debName'), strasse: feld('debStrasse'), hausnummer: feld('debHausnummer'),
            plz: feld('debPlz'), ort: feld('debOrt'), land: 'CH',
          },
        });
        schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    tabelleElement.addEventListener('change', (wechsel) => {
      if (wechsel.target.matches('[data-rolle="filter-baustelle"]')) {
        filterBaustelle = wechsel.target.value;
        zeichneTabelle();
      }
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
      const rechnungen = await ladeRechnungen();
      const rechnung = rechnungen.find((r) => r._id === knopf.dataset.id);
      if (!rechnung) return;
      if (knopf.dataset.aktion === 'oeffnen') {
        oeffneFormular(rechnung);
      } else if (knopf.dataset.aktion === 'pdf') {
        rechnungsPdf(rechnung);
      } else if (knopf.dataset.aktion === 'zahlungen') {
        zeigeZahlungen(rechnung._id, {
          titel: `Zahlungen · Rechnung ${rechnung.nummer}`,
          nachAenderung: zeichneTabelle,
        });
      } else if (knopf.dataset.aktion === 'weiter') {
        const naechster = naechsterStatus(rechnung);
        if (!naechster) return;
        if (naechster === 'bezahlt' && zahlungen(rechnung).length && offenerBetrag(rechnung) > 0
          && !confirm(`Noch offen: ${chf(offenerBetrag(rechnung))}. Trotzdem als bezahlt abschliessen?`)) return;
        const doc = mitHistorie(rechnung, naechster);
        if (naechster === 'bezahlt') doc.bezahltAm = heuteTag();
        await put(doc);
        let zusatz = '';
        if (naechster === 'gestellt') zusatz = await stelleGrundlageVerrechnet(rechnung);
        meldungElement.textContent = `Rechnung ${rechnung.nummer} → ${naechster}.${zusatz}`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (knopf.dataset.aktion === 'zurueck') {
        const vorheriger = vorherigerStatus(rechnung);
        if (!vorheriger) return;
        const doc = mitHistorie(rechnung, vorheriger);
        if (rechnung.status === 'bezahlt') delete doc.bezahltAm;
        await put(doc);
        meldungElement.textContent = `Rechnung ${rechnung.nummer} → ${vorheriger}. `
          + 'Die Grundlage bleibt auf «verrechnet» — dort von Hand zurückstellen, falls nötig.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm(`Rechnung ${rechnung.nummer} endgültig löschen?`)) return;
        await entferneDokument(rechnung._id);
        if (inBearbeitung?._id === rechnung._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      }
    });

    zeichneTabelle();
  },
};
