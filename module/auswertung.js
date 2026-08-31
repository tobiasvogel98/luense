// module/auswertung.js — Controlling nach FO 5.1.01 (Monatsabschluss).
// Struktur und Rechenlogik 1:1 aus altbestand/«Kopie von FO 5.1.01.
// controlling.xlsx» übernommen — jede Abweichung wäre ein Fehler:
//   W5 = W1+W2+W3+W4              (nachgeführte Bausumme exkl. Regie)
//   W9 = W5+W6+W7+W8              (inkl. Regie)
//   W10 = W9·(1−Rabatt)·(1−Allg.Abz.)·(1−Skonto)   (Total netto)
//   B6 = B1+…+B5                  (Total Ertrag gemäss KTR-Übersicht)
//   A8 = A1+A2+Abgrenzungen+A6+A7 (Total Ausmass inkl. Abgrenzungen, brutto)
//   A9 = A8·Nettofaktoren
//   A13 = A9+B2+B3+B5             (Total Ertrag per Abgrenzungsstichtag)
//   S6 = S1+Abgrenzungen          (Total Selbstkosten)
//   K1 = A13/S6 − 1               (Baustellenergebnis per Stichtag, + = G / − = V)
//   K3 = W10 − A13                (Restbausumme per Stichtag)
// Dokumenttyp «kosten», ein Dokument je Stichtag und Baustelle.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { berechneAbschluss } from '../kern/fo.js';
import { alleBaustellen } from '../kern/stamm.js';
import { esc } from '../kern/ui.js';

const W_ZEILEN = [
  ['w1', 'W1', 'ursprüngliche Werkvertragssumme'],
  ['w2', 'W2', 'Pauschalbetrag'],
  ['w3', 'W3', 'bewilligte Nachträge'],
  ['w4', 'W4', 'approx. Mehr- / Minderausmass'],
];
const W_REGIE_ZEILEN = [
  ['w6', 'W6', 'Regie an Bauherr'],
  ['w7', 'W7', 'Regie an Dritte'],
  ['w8', 'W8', 'Diverses (Teuerung, …)'],
];
const B_ZEILEN = [
  ['b1', 'B1', 'Ausmass- und Akontofakturen', 'LstA 3000+3004'],
  ['b2', 'B2', 'Regiefakturen Bauherr', 'LstA 3001'],
  ['b3', 'B3', 'Regiefakturen Dritte', 'LstA 3002'],
  ['b4', 'B4', 'Skonto / Ertragsminderungen', 'LstA 3900'],
  ['b5', 'B5', 'Diverse Fakturen (Teuerung / B+F)', 'LstA 3003+3007'],
];
const A_ZEILEN = [
  ['a1', 'A1', 'Ausgemessen, bereinigt'],
  ['a2', 'A2', 'Ausgemessen, nicht bereinigt'],
];
const A_REGIE_ZEILEN = [
  ['a6', 'A6', 'Regie nicht verrechnet, unterschrieben'],
  ['a7', 'A7', 'Regie nicht verrechnet, nicht unterschrieben'],
];
const ANZAHL_AUSMASS_ABGRENZUNGEN = 3; // A3–A5, z. B. gas / ew / wasser
const ANZAHL_SK_ABGRENZUNGEN = 4;      // S2–S5

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${Math.round(n).toLocaleString('de-CH')}`;
}

function prozentText(anteil) {
  return anteil === null ? '—'
    : `${(anteil * 100).toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`;
}

function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}


function geldZeile(schluessel, nr, label, wert, zusatz) {
  return `
    <div class="fo-zeile">
      <span class="fo-nr">${nr}</span>
      <label class="fo-label">${esc(label)}${zusatz ? `<small> ${esc(zusatz)}</small>` : ''}
        <input data-feld="${schluessel}" type="number" inputmode="decimal" step="any"
          value="${esc(wert ?? '')}" placeholder="0">
      </label>
    </div>`;
}

function abgrenzungsZeilen(liste, praefix, anzahl, platzhalter) {
  return Array.from({ length: anzahl }, (_, i) => {
    const eintrag = liste?.[i] || {};
    return `
      <div class="fo-zeile">
        <span class="fo-nr">${praefix}${i + 1}</span>
        <div class="fo-abgrenzung">
          <input data-abgrenzung="${praefix}" data-index="${i}" data-feld="bez"
            placeholder="${platzhalter}" value="${esc(eintrag.bez ?? '')}" autocomplete="off">
          <input data-abgrenzung="${praefix}" data-index="${i}" data-feld="betrag"
            type="number" inputmode="decimal" step="any" placeholder="0"
            value="${esc(eintrag.betrag ?? '')}">
        </div>
      </div>`;
  }).join('');
}

function berechnetZeile(nr, label, wert, hervor) {
  return `<div class="fo-zeile fo-berechnet${hervor ? ' fo-hervor' : ''}">
    <span class="fo-nr">${nr}</span><span class="fo-label">${esc(label)}</span>
    <span class="fo-wert" data-kennzahl="${nr}">${wert}</span></div>`;
}

export default {
  name: 'Controlling',
  dokumentTypen: ['kosten'],

  render(container, baustelle) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="controlling">
        <h2>Controlling · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>
        <p class="hinweis">Monatsabschluss nach FO 5.1.01 — das Alt-Cockpit bleibt
          führend, bis zwei Monatsabschlüsse stimmig abgeglichen sind.</p>

        <div class="karte" data-rolle="uebersicht"></div>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neuer Monatsabschluss
          </button>
        </div>

        <div data-rolle="formular-bereich"></div>
        <div data-rolle="liste"></div>

        <details class="karte import">
          <summary>Abgleich-Checkliste je Monatsabschluss (6.4)</summary>
          <ol class="checkliste-text">
            <li>FO-5.1.01-Excel öffnen, Blatt zum gleichen Stichtag wählen.</li>
            <li>Hier beim Abschluss «Abgleich (JSON)» herunterladen oder die Kennzahlen ablesen.</li>
            <li>Vergleichen: W10, B6, A13, S6, K1, K3 — <b>jede Abweichung ist ein Fehler</b>, das Excel gilt.</li>
            <li>Ergebnis im Abschluss unter «Bemerkungen» notieren (z. B. «Abgleich ok, 30.09.»).</li>
            <li>Nach <b>zwei</b> stimmigen Monatsabschlüssen: Betriebsstatus «Controlling» auf
              <b>führend</b> stellen; das Excel einfrieren als Archiv — nie löschen.</li>
          </ol>
        </details>
      </section>`;

    const uebersichtElement = container.querySelector('[data-rolle="uebersicht"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    // ---------- Gesamtübersicht über alle Baustellen ----------
    // Bausumme/Leistung/SK/Ergebnis aus dem letzten FO-Abschluss;
    // Nachtragssummen LIVE aus dem Nachtrags-Modul (geteilte Dokumente) —
    // ein Statuswechsel dort bewegt die Zahlen hier sofort.
    async function zeichneUebersicht() {
      const [baustellen, abschluesse, nachtraege] = await Promise.all([
        alleBaustellen(), abfrage({ typ: 'kosten' }), abfrage({ typ: 'nachtrag' }),
      ]);
      const zeilen = baustellen.map((b) => {
        const eigene = abschluesse
          .filter((a) => a.baustelleId === b.baustelleId)
          .sort((x, y) => (y.stichtag || '').localeCompare(x.stichtag || ''));
        const letzter = eigene[0];
        const kenn = letzter ? berechneAbschluss(letzter.werte || {}) : null;
        const eigeneNt = nachtraege.filter((n) => n.baustelleId === b.baustelleId);
        const ntSumme = (liste) => liste.reduce((s, n) => s + zahl(n.summe), 0);
        return {
          b,
          letzter,
          kenn,
          ntGenehmigt: ntSumme(eigeneNt.filter((n) => ['genehmigt', 'verrechnet'].includes(n.status))),
          ntOffen: ntSumme(eigeneNt.filter((n) => !['genehmigt', 'verrechnet'].includes(n.status))),
        };
      });
      uebersichtElement.innerHTML = `
        <h3>Alle Baustellen</h3>
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>KTR · Baustelle</th><th class="zahl">Stichtag</th>
              <th class="zahl">Bausumme</th><th class="zahl">NT gen.</th>
              <th class="zahl">NT offen</th><th class="zahl">Leistung</th>
              <th class="zahl">SK</th><th class="zahl">Fertig</th>
              <th class="zahl">Ergebnis</th>
            </tr></thead>
            <tbody>
              ${zeilen.map(({ b, letzter, kenn, ntGenehmigt, ntOffen }) => {
                const fertig = kenn && kenn.w10 > 0 ? kenn.a13 / kenn.w10 : null;
                return `
                  <tr data-baustelle="${esc(b.baustelleId)}"
                    class="${b.baustelleId === baustelle.baustelleId ? 'aktiv' : ''}">
                    <td>${esc(b.ktr)} · ${esc(b.name)}</td>
                    <td class="zahl">${letzter ? formatTag(letzter.stichtag) : '—'}</td>
                    <td class="zahl">${kenn ? chf(kenn.w10) : '—'}</td>
                    <td class="zahl ${ntGenehmigt ? 'gewinn' : ''}">${ntGenehmigt ? chf(ntGenehmigt) : '—'}</td>
                    <td class="zahl">${ntOffen ? chf(ntOffen) : '—'}</td>
                    <td class="zahl">${kenn ? chf(kenn.a13) : '—'}</td>
                    <td class="zahl">${kenn ? chf(kenn.s6) : '—'}</td>
                    <td class="zahl">${fertig !== null ? prozentText(fertig) : '—'}</td>
                    <td class="zahl ${kenn?.k1 > 0 ? 'gewinn' : kenn?.k1 < 0 ? 'verlust' : ''}">
                      ${kenn ? prozentText(kenn.k1) : '—'}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p class="hinweis">Zeile antippen wählt die Baustelle. Nachtragssummen live
          aus dem Nachträge-Modul; übrige Werte aus dem letzten Monatsabschluss.</p>

        <h3>Monatsverlauf · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h3>
        ${(() => {
          const eigene = abschluesse
            .filter((a) => a.baustelleId === baustelle.baustelleId)
            .sort((x, y) => (x.stichtag || '').localeCompare(y.stichtag || ''));
          if (!eigene.length) return '<p class="hinweis">Noch kein Monatsabschluss.</p>';
          return `
            <div class="tabellen-scroll">
              <table class="uebersicht-tabelle">
                <thead><tr><th>Stichtag</th><th class="zahl">Ertrag (A13)</th>
                  <th class="zahl">SK (S6)</th><th class="zahl">Ergebnis</th>
                  <th class="zahl">Restbausumme</th></tr></thead>
                <tbody>
                  ${eigene.map((a) => {
                    const kenn = berechneAbschluss(a.werte || {});
                    return `<tr>
                      <td>${formatTag(a.stichtag)}</td>
                      <td class="zahl">${chf(kenn.a13)}</td>
                      <td class="zahl">${chf(kenn.s6)}</td>
                      <td class="zahl ${kenn.k1 > 0 ? 'gewinn' : kenn.k1 < 0 ? 'verlust' : ''}">
                        ${prozentText(kenn.k1)}</td>
                      <td class="zahl">${chf(kenn.k3)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`;
        })()}`;
    }

    uebersichtElement.addEventListener('click', (klick) => {
      const zeile = klick.target.closest('[data-baustelle]');
      if (!zeile || zeile.dataset.baustelle === baustelle.baustelleId) return;
      document.dispatchEvent(new CustomEvent('luense:baustelleWechseln', {
        detail: { baustelleId: zeile.dataset.baustelle },
      }));
    });

    // ---------- Formular (das FO-Blatt) ----------
    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    function oeffneFormular(abschluss) {
      inBearbeitung = abschluss || null;
      neuZeile.hidden = true;
      const w = abschluss?.werte || {};
      formularBereich.innerHTML = `
        <form class="karte formular fo-formular" data-rolle="fo-formular">
          <h3>${abschluss ? `Abschluss per ${formatTag(abschluss.stichtag)} bearbeiten` : 'Neuer Monatsabschluss'}</h3>
          <div class="feld-reihe">
            <label>Per (Stichtag) *<input type="date" name="stichtag" required
              value="${esc(abschluss?.stichtag ?? heuteTag())}"></label>
            <label>Bauende<input type="date" data-feld="bauende" value="${esc(w.bauende ?? '')}"></label>
          </div>
          <div class="feld-reihe">
            <label>Bauführer<input data-feld="baufuehrer" value="${esc(w.baufuehrer ?? '')}"
              autocomplete="off"></label>
            <label>Kalkulationsvorgabe SK ±<input data-feld="kalkVorgabe"
              value="${esc(w.kalkVorgabe ?? '')}" autocomplete="off"></label>
          </div>
          <div class="feld-reihe">
            <label>Skonto %<input data-feld="skonto" type="number" inputmode="decimal"
              step="any" value="${esc(w.skonto ?? '')}" placeholder="0"></label>
            <label>Rabatt %<input data-feld="rabatt" type="number" inputmode="decimal"
              step="any" value="${esc(w.rabatt ?? '')}" placeholder="0"></label>
            <label>Allg. Abz. %<input data-feld="allgAbzug" type="number" inputmode="decimal"
              step="any" value="${esc(w.allgAbzug ?? '')}" placeholder="0"></label>
          </div>

          <h4 class="abschnitt-titel">Bausumme Werkvertrag (brutto)</h4>
          ${W_ZEILEN.map(([s, nr, l]) => geldZeile(s, nr, l, w[s])).join('')}
          ${berechnetZeile('W5', 'nachgeführte Bausumme exkl. Regie', '')}
          ${W_REGIE_ZEILEN.map(([s, nr, l]) => geldZeile(s, nr, l, w[s])).join('')}
          ${berechnetZeile('W9', 'nachgeführte Bausumme inkl. Regie', '')}
          ${berechnetZeile('W10', 'Total Bausumme netto', '', true)}

          <h4 class="abschnitt-titel">Gebucht gemäss KTR-Übersicht (netto)</h4>
          ${B_ZEILEN.map(([s, nr, l, z]) => geldZeile(s, nr, l, w[s], z)).join('')}
          ${berechnetZeile('B6', 'Total Ertrag gemäss KTR-Übersicht', '')}

          <h4 class="abschnitt-titel">Ausmass (brutto)</h4>
          ${A_ZEILEN.map(([s, nr, l]) => geldZeile(s, nr, l, w[s])).join('')}
          ${abgrenzungsZeilen(w.ausmassAbgrenzungen, 'A', ANZAHL_AUSMASS_ABGRENZUNGEN,
            'Ausmassabgrenzung, z. B. gas')}
          ${A_REGIE_ZEILEN.map(([s, nr, l]) => geldZeile(s, nr, l, w[s])).join('')}
          ${berechnetZeile('A8', 'Total Ausmass inkl. Abgrenzungen (brutto)', '')}
          ${berechnetZeile('A9', 'Total Ausmass inkl. Abgrenzungen (netto)', '')}
          ${berechnetZeile('A13', 'Total Ertrag per Abgrenzungsstichtag', '', true)}

          <h4 class="abschnitt-titel">Selbstkosten</h4>
          ${geldZeile('s1', 'S1', 'Selbstkosten gemäss KTR-Übersicht', w.s1)}
          ${abgrenzungsZeilen(w.skAbgrenzungen, 'S', ANZAHL_SK_ABGRENZUNGEN, 'Abgrenzung')}
          ${berechnetZeile('S6', 'Total Selbstkosten inkl. Abgrenzungen', '', true)}

          <h4 class="abschnitt-titel">Kenndaten</h4>
          ${berechnetZeile('K1', 'Baustellenergebnis per Stichtag (+ = G / − = V)', '', true)}
          <div class="fo-zeile">
            <span class="fo-nr">K2</span>
            <label class="fo-label">Baustellenergebnis per Baustellenende [%]
              <input data-feld="k2" type="number" inputmode="decimal" step="any"
                value="${esc(w.k2 ?? '')}" placeholder="z. B. 20"></label>
          </div>
          ${berechnetZeile('K3', 'Restbausumme per Stichtag (netto)', '')}
          <div class="fo-zeile">
            <span class="fo-nr">K4</span>
            <label class="fo-label">Restbausumme aktuell (netto)
              <input data-feld="k4" type="number" inputmode="decimal" step="any"
                value="${esc(w.k4 ?? '')}" placeholder="0"></label>
          </div>

          <label>Bemerkungen<textarea data-feld="bemerkungen" rows="2">${esc(w.bemerkungen ?? '')}</textarea></label>
          <label>Visum<input data-feld="visum" value="${esc(w.visum ?? '')}" autocomplete="off"></label>

          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Abschluss speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      aktualisiereKennzahlen();
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function sammleWerte(formular) {
      const werte = {};
      for (const feld of formular.querySelectorAll('[data-feld]:not([data-abgrenzung])')) {
        werte[feld.dataset.feld] = feld.value.trim();
      }
      for (const praefix of ['A', 'S']) {
        const schluessel = praefix === 'A' ? 'ausmassAbgrenzungen' : 'skAbgrenzungen';
        const anzahl = praefix === 'A' ? ANZAHL_AUSMASS_ABGRENZUNGEN : ANZAHL_SK_ABGRENZUNGEN;
        werte[schluessel] = Array.from({ length: anzahl }, (_, i) => ({
          bez: formular.querySelector(`[data-abgrenzung="${praefix}"][data-index="${i}"][data-feld="bez"]`).value.trim(),
          betrag: formular.querySelector(`[data-abgrenzung="${praefix}"][data-index="${i}"][data-feld="betrag"]`).value.trim(),
        }));
      }
      return werte;
    }

    function aktualisiereKennzahlen() {
      const formular = formularBereich.querySelector('[data-rolle="fo-formular"]');
      if (!formular) return;
      const kenn = berechneAbschluss(sammleWerte(formular));
      const setze = (nr, text) => {
        const el = formular.querySelector(`[data-kennzahl="${nr}"]`);
        if (el) el.textContent = text;
      };
      setze('W5', chf(kenn.w5));
      setze('W9', chf(kenn.w9));
      setze('W10', chf(kenn.w10));
      setze('B6', chf(kenn.b6));
      setze('A8', chf(kenn.a8));
      setze('A9', chf(kenn.a9));
      setze('A13', chf(kenn.a13));
      setze('S6', chf(kenn.s6));
      setze('K1', prozentText(kenn.k1));
      setze('K3', chf(kenn.k3));
    }

    formularBereich.addEventListener('input', aktualisiereKennzahlen);

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) schliesseFormular();
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const stichtag = formular.elements.stichtag.value;
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'kosten', baustelleId: baustelle.baustelleId };
        await put({
          ...basis,
          stichtag,
          datum: `${stichtag}T12:00:00.000Z`,
          werte: sammleWerte(formular),
        });
        schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await Promise.all([zeichneListe(), zeichneUebersicht()]);
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    // ---------- Liste der Monatsabschlüsse ----------
    async function zeichneListe() {
      const alle = await abfrage({ typ: 'kosten', baustelleId: baustelle.baustelleId });
      listeElement.innerHTML = alle.length
        ? alle.map((a) => {
            const kenn = berechneAbschluss(a.werte || {});
            return `
              <article class="karte abschluss">
                <div class="rapport-kopf">
                  <strong>Per ${formatTag(a.stichtag)}</strong>
                  <span class="chip ${kenn.k1 > 0 ? 'gewinn' : kenn.k1 < 0 ? 'verlust' : ''}">
                    ${prozentText(kenn.k1)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="abgleich"
                      data-id="${esc(a._id)}">Abgleich (JSON)</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                      data-id="${esc(a._id)}">PDF</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(a._id)}">Öffnen</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(a._id)}" aria-label="Abschluss löschen">Löschen</button>
                  </span>
                </div>
                <p class="hinweis">Ertrag ${chf(kenn.a13)} · Selbstkosten ${chf(kenn.s6)}
                  · Restbausumme ${chf(kenn.k3)}${
                    a.werte?.k2 ? ` · Prognose Bauende ${a.werte.k2} %` : ''}</p>
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch kein Monatsabschluss auf dieser Baustelle.</p>';
    }

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const alle = await abfrage({ typ: 'kosten', baustelleId: baustelle.baustelleId });
      const abschluss = alle.find((a) => a._id === knopf.dataset.id);
      if (!abschluss) return;
      if (knopf.dataset.aktion === 'oeffnen') {
        oeffneFormular(abschluss);
      } else if (knopf.dataset.aktion === 'abgleich') {
        // JSON-Brücke fürs Alt-Cockpit: Eingaben + Kennzahlen mit den
        // FO-Zeilenbezeichnungen, direkt vergleichbar mit dem Excel.
        const kenn = berechneAbschluss(abschluss.werte || {});
        const inhalt = JSON.stringify({
          formular: 'FO 5.1.01',
          baustelle: { ktr: baustelle.ktr, name: baustelle.name },
          stichtag: abschluss.stichtag,
          eingaben: abschluss.werte,
          kennzahlen: {
            W5: kenn.w5, W9: kenn.w9, W10: kenn.w10, B6: kenn.b6,
            A8: kenn.a8, A9: kenn.a9, A13: kenn.a13, S6: kenn.s6,
            K1: kenn.k1, K3: kenn.k3,
          },
        }, null, 2);
        const url = URL.createObjectURL(new Blob([inhalt], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `abgleich-${baustelle.ktr}-${abschluss.stichtag}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (knopf.dataset.aktion === 'pdf') {
        const w = abschluss.werte || {};
        const kenn = berechneAbschluss(w);
        const geld = (wert) => (zahl(wert) ? chf(zahl(wert)) : '');
        const block = (zeilen) => zeilen
          .map(([label, wert]) => ({ label, wert }))
          .filter((z) => z.wert);
        zeigeProtokollDruck(baustelle, {
          titel: `Controlling FO 5.1.01 per ${formatTag(abschluss.stichtag)}`,
          untertitel: [w.baufuehrer ? `Bauführer: ${w.baufuehrer}` : '',
            w.bauende ? `Bauende: ${formatTag(w.bauende)}` : '',
            baustelle.bauherr ? `Bauherr: ${baustelle.bauherr}` : '']
            .filter(Boolean).join(' · '),
          abschnitte: [
            { art: 'felder', titel: 'Bausumme Werkvertrag', zeilen: block([
              ...W_ZEILEN.map(([s, , l]) => [l, geld(w[s])]),
              ['Nachgeführte Bausumme exkl. Regie (W5)', chf(kenn.w5)],
              ...W_REGIE_ZEILEN.map(([s, , l]) => [l, geld(w[s])]),
              ['Nachgeführte Bausumme inkl. Regie (W9)', chf(kenn.w9)],
              ['Total Bausumme netto (W10)', chf(kenn.w10)],
            ]) },
            { art: 'felder', titel: 'Gebucht gemäss KTR-Übersicht', zeilen: block([
              ...B_ZEILEN.map(([s, , l]) => [l, geld(w[s])]),
              ['Total Ertrag gemäss KTR-Übersicht (B6)', chf(kenn.b6)],
            ]) },
            { art: 'felder', titel: 'Ausmass', zeilen: block([
              ...A_ZEILEN.map(([s, , l]) => [l, geld(w[s])]),
              ...(w.ausmassAbgrenzungen || [])
                .map((a) => [`Ausmassabgrenzung ${a.bez || ''}`.trim(), geld(a.betrag)]),
              ...A_REGIE_ZEILEN.map(([s, , l]) => [l, geld(w[s])]),
              ['Total Ausmass inkl. Abgrenzungen brutto (A8)', chf(kenn.a8)],
              ['Total Ertrag per Abgrenzungsstichtag (A13)', chf(kenn.a13)],
            ]) },
            { art: 'felder', titel: 'Selbstkosten', zeilen: block([
              ['Selbstkosten gemäss KTR-Übersicht', geld(w.s1)],
              ...(w.skAbgrenzungen || [])
                .map((a) => [`Abgrenzung ${a.bez || ''}`.trim(), geld(a.betrag)]),
              ['Total Selbstkosten inkl. Abgrenzungen (S6)', chf(kenn.s6)],
            ]) },
            { art: 'felder', titel: 'Kenndaten', zeilen: [
              { label: 'Baustellenergebnis per Stichtag (K1)', wert: prozentText(kenn.k1) },
              ...(w.k2 ? [{ label: 'Baustellenergebnis per Baustellenende (K2)', wert: `${w.k2} %` }] : []),
              { label: 'Restbausumme per Stichtag (K3)', wert: chf(kenn.k3) },
              ...(zahl(w.k4) ? [{ label: 'Restbausumme aktuell (K4)', wert: chf(zahl(w.k4)) }] : []),
              ...(w.bemerkungen ? [{ label: 'Bemerkungen', wert: w.bemerkungen }] : []),
              ...(w.visum ? [{ label: 'Visum', wert: w.visum }] : []),
            ] },
          ],
          unterschriften: ['Bauführer', 'Geschäftsleitung'],
        });
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm('Diesen Monatsabschluss endgültig löschen?')) return;
        await entferneDokument(abschluss._id);
        if (inBearbeitung?._id === abschluss._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await Promise.all([zeichneListe(), zeichneUebersicht()]);
      }
    });

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    zeichneUebersicht();
    zeichneListe();
  },
};
