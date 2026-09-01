// module/rechnung.js — Rechnungsablage und -verwaltung (Abend 8.4, Stufe 1).
// Darstellung im Cockpit-Stil: Kacheln offen / gestellt / bezahlt, Tabelle
// mit Summenzeile. Dokumenttyp «rechnung»; Basis verlinkt auf Regierapport
// oder Nachtrag (Dokumente teilen, nie Code). Beim Wechsel auf «gestellt»
// springt die verlinkte Grundlage automatisch auf «verrechnet».
// Stufe 2 (Rechnungen aus Ausmass/Offerte, Akonto/Schlussrechnung, QR)
// ist bewusst NICHT gebaut — braucht einen neuen Beschluss.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import {
  RECHNUNG_STATUS, ZAHLUNGSFRIST_TAGE, erstelleRechnung, naechsteRechnungsnummer,
  heuteTag,
} from '../kern/rechnung.js';
import { exportiereCsv } from '../kern/export.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { esc } from '../kern/ui.js';

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${(n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

function zahlbarBis(rechnung) {
  const start = new Date(`${rechnung.tag}T12:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + (rechnung.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE));
  return new Date(start.getTime() - start.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

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

    container.innerHTML = `
      <section class="rechnungen">
        <h2>Rechnungen · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="kachel-reihe" data-rolle="kacheln"></div>
        <p class="hinweis" data-rolle="gesamt"></p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neue Rechnung
          </button>
          <button type="button" class="knopf" data-aktion="export"
            title="Öffnet direkt in Excel">Excel-Export</button>
        </div>

        <div data-rolle="formular-bereich"></div>
        <div data-rolle="tabelle"></div>
        <p class="meldung" data-rolle="meldung" role="status"></p>
      </section>`;

    const kachelnElement = container.querySelector('[data-rolle="kacheln"]');
    const gesamtElement = container.querySelector('[data-rolle="gesamt"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
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

    async function zeichneKacheln(rechnungen) {
      const jeStatus = (status, liste) => liste.filter((r) => r.status === status);
      kachelnElement.innerHTML = RECHNUNG_STATUS.map((status) => {
        const eigene = jeStatus(status, rechnungen);
        return `
          <div class="karte kachel${status === 'bezahlt' ? ' kachel-gruen' : ''}">
            <span class="kachel-titel">${status} (${eigene.length})</span>
            <span class="kachel-wert">${chf(summe(eigene))}</span>
          </div>`;
      }).join('');
      const alleBaustellen = await abfrage({ typ: 'rechnung' });
      gesamtElement.textContent = 'Gesamt über alle Baustellen: '
        + RECHNUNG_STATUS.map((status) =>
          `${status} ${chf(summe(jeStatus(status, alleBaustellen)))}`).join(' · ');
    }

    async function oeffneFormular(rechnung) {
      inBearbeitung = rechnung || null;
      neuZeile.hidden = true;
      const nummer = rechnung?.nummer || await naechsteRechnungsnummer();
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
          ${rechnung?.basis && rechnung.basis.art !== 'manuell' ? `
            <p class="hinweis">Basis: ${esc(basisText(rechnung.basis))} — bleibt verknüpft.</p>` : ''}
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

    async function zeichneTabelle() {
      const rechnungen = await ladeRechnungen();
      await zeichneKacheln(rechnungen);
      if (!rechnungen.length) {
        tabelleElement.innerHTML =
          '<p class="hinweis">Noch keine Rechnungen auf dieser Baustelle. '
          + 'Rechnungen entstehen hier — oder direkt aus unterschriebenen '
          + 'Regierapporten und genehmigten Nachträgen.</p>';
        return;
      }
      tabelleElement.innerHTML = `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Nummer</th><th>Datum</th><th>Titel</th><th>Basis</th>
              <th class="zahl">Betrag</th><th>Status</th><th>Zahlbar bis</th><th></th>
            </tr></thead>
            <tbody>
              ${rechnungen.map((r) => {
                const index = RECHNUNG_STATUS.indexOf(r.status);
                const naechster = RECHNUNG_STATUS[index + 1];
                const frist = zahlbarBis(r);
                const ueberfaellig = r.status === 'gestellt' && frist && frist < heuteTag();
                return `
                  <tr>
                    <td>${esc(r.nummer)}</td>
                    <td>${formatTag(r.tag)}</td>
                    <td>${esc(r.titel)}</td>
                    <td>${esc(basisText(r.basis))}</td>
                    <td class="zahl">${chf(zahl(r.betrag))}</td>
                    <td>${esc(r.status)}${ueberfaellig
                      ? ' <span class="ueberfaellig">überfällig</span>' : ''}<br>
                      <small class="hinweis">${(r.statusHistorie || [])
                        .map((h) => `${esc(h.status)} ${formatTag(h.datum)}`).join(' → ')}</small></td>
                    <td>${r.status === 'bezahlt' ? '—' : formatTag(frist)}</td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${naechster ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="weiter"
                          data-id="${esc(r._id)}">→ ${naechster}</button>` : ''}
                      ${index > 0 ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="zurueck"
                          data-id="${esc(r._id)}">← zurück</button>` : ''}
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
                <td colspan="3">davon bezahlt ${chf(summe(rechnungen.filter((r) => r.status === 'bezahlt')))}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
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

    function rechnungsPdf(rechnung) {
      const frist = zahlbarBis(rechnung);
      zeigeProtokollDruck(baustelle, {
        titel: `Rechnung ${rechnung.nummer}`,
        untertitel: [
          baustelle.bauherr ? `Rechnungsempfänger: ${baustelle.bauherr}` : '',
          `Rechnungsdatum: ${formatTag(rechnung.tag)}`,
        ].filter(Boolean).join(' · '),
        abschnitte: [
          { art: 'tabelle', titel: 'Leistung',
            spalten: ['Bezeichnung', 'Basis', 'Betrag'],
            zeilen: [[rechnung.titel, basisText(rechnung.basis), chf(zahl(rechnung.betrag))]] },
          { art: 'felder', titel: 'Zahlung', zeilen: [
            { label: 'Rechnungsbetrag', wert: chf(zahl(rechnung.betrag)) },
            { label: 'Zahlungsfrist', wert: `${rechnung.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE} Tage` },
            { label: 'Zahlbar bis', wert: formatTag(frist) },
          ] },
          rechnung.statusHistorie?.length ? { art: 'felder', titel: 'Status',
            zeilen: rechnung.statusHistorie.map((h) => ({
              label: h.status, wert: formatTag(h.datum),
            })) } : null,
        ].filter(Boolean),
        unterschriften: [],
      });
    }

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    container.querySelector('[data-aktion="export"]')
      .addEventListener('click', async () => {
        const rechnungen = await ladeRechnungen();
        exportiereCsv(
          `luense-rechnungen-${baustelle.ktr}.csv`,
          ['Nummer', 'Datum', 'Titel', 'Basis', 'Betrag CHF', 'Status',
            'Zahlbar bis', 'Statusverlauf'],
          rechnungen.slice().reverse().map((r) => [r.nummer, formatTag(r.tag),
            r.titel, basisText(r.basis), zahl(r.betrag), r.status,
            r.status === 'bezahlt' ? '' : formatTag(zahlbarBis(r)),
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
        await put({
          ...basis,
          nummer: formular.elements.nummer.value.trim(),
          tag: formular.elements.tag.value,
          titel: formular.elements.titel.value.trim(),
          betrag: formular.elements.betrag.value.trim(),
          zahlungsfristTage: parseInt(formular.elements.zahlungsfrist.value, 10)
            || ZAHLUNGSFRIST_TAGE,
        });
        schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    tabelleElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const rechnungen = await ladeRechnungen();
      const rechnung = rechnungen.find((r) => r._id === knopf.dataset.id);
      if (!rechnung) return;
      if (knopf.dataset.aktion === 'oeffnen') {
        oeffneFormular(rechnung);
      } else if (knopf.dataset.aktion === 'pdf') {
        rechnungsPdf(rechnung);
      } else if (knopf.dataset.aktion === 'weiter') {
        const naechster = RECHNUNG_STATUS[RECHNUNG_STATUS.indexOf(rechnung.status) + 1];
        if (!naechster) return;
        await put(mitHistorie(rechnung, naechster));
        let zusatz = '';
        if (naechster === 'gestellt') zusatz = await stelleGrundlageVerrechnet(rechnung);
        meldungElement.textContent = `Rechnung ${rechnung.nummer} → ${naechster}.${zusatz}`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (knopf.dataset.aktion === 'zurueck') {
        const vorheriger = RECHNUNG_STATUS[RECHNUNG_STATUS.indexOf(rechnung.status) - 1];
        if (!vorheriger) return;
        await put(mitHistorie(rechnung, vorheriger));
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
