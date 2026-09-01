// module/offert.js — Offertwesen im Leistungsverzeichnis-Layout (nach
// Tobias' Vorlage / Sorba-Prinzip): Gliederung in NPK-Kapitel, Unter-
// nummern und Positionen — Nummer und Text links, EH/Menge/Preis/Betrag
// rechts, Zwischentotal je Kapitel. Je Position beliebig viele
// Ausmasszeilen (Bezeichnung, Anzahl × Länge × Breite × Höhe) als
// Kalkulationsgrundlage — sie bleiben in der Offerte gespeichert und
// sind hinter der Menge versteckt (Antippen öffnet sie im Fenster).
// Zusammenzug wie das Alt-Tool: Total → −Rabatt → −Skonto → +MwSt.
// «angenommen» erzeugt per Klick eine Baustelle; die Positionen gehen
// als KOPIE ins Ausmass (dort wird gemessen, die Offerte bleibt unberührt).
// Bewusste Ausnahme von «alle Dokumente tragen eine Baustellen-Id»:
// Katalog und Offerten existieren VOR der Baustelle — sie nutzen die
// Sammel-Ids «katalog» bzw. «offertwesen».

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { speichereBaustelle } from '../kern/stamm.js';
import { zeigeOffertDruck } from '../kern/pdf.js';
import { esc } from '../kern/ui.js';

const KATALOG_ID = 'katalog';
const OFFERT_ID = 'offertwesen';
const MWST_PROZENT = 8.1;
const OFFERT_STATUS = ['Entwurf', 'eingereicht', 'angenommen'];

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${(n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function mengeText(n) {
  return (n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// ---------- Ausmasszeilen (Kalkulationsgrundlage) ----------
// Wert einer Zeile: Produkt der ausgefüllten Faktoren (Anzahl × Länge ×
// Breite × Höhe) — leere Felder zählen nicht mit, ganz leere Zeile = 0.
export function ausmassZeileWert(zeile) {
  const felder = [zeile.anzahl, zeile.laenge, zeile.breite, zeile.hoehe]
    .filter((wert) => String(wert ?? '').trim() !== '');
  if (!felder.length) return 0;
  return felder.reduce((produkt, wert) => produkt * zahl(wert), 1);
}

export function ausmassSumme(zeilen) {
  const summe = (zeilen || []).reduce((s, z) => s + ausmassZeileWert(z), 0);
  return Math.round(summe * 1000) / 1000;
}

function ausmassFormel(zeile) {
  const teile = [zeile.anzahl, zeile.laenge, zeile.breite, zeile.hoehe]
    .filter((wert) => String(wert ?? '').trim() !== '');
  return teile.length ? teile.join(' × ') : '—';
}

// ---------- Gliederung ----------
// offerte.gliederung: geordnete LV-Zeilen —
//   { art: 'kapitel', nr, titel }
//   { art: 'unternummer', nr, titel }
//   { art: 'position', nr, text, einheit, ep, menge, ausmass: [zeilen] }
// Alte Offerten (flache positionen-Liste) werden beim Lesen abgebildet.
export function gliederungVon(offerte) {
  if (offerte.gliederung?.length) return offerte.gliederung;
  return (offerte.positionen || []).map((p) => ({
    art: 'position', nr: p.pos || '', text: p.text || '',
    einheit: p.einheit || '', ep: p.ep || '', menge: p.menge || '', ausmass: [],
  }));
}

function nurPositionen(offerte) {
  return gliederungVon(offerte).filter((z) => z.art === 'position');
}

// Zusammenzug wie im Alt-Tool: Total → −Rabatt → −Skonto → exkl. → +MwSt.
export function zusammenzug(offerte) {
  const total = nurPositionen(offerte)
    .reduce((s, p) => s + zahl(p.menge) * zahl(p.ep), 0);
  const rabatt = total * zahl(offerte.rabatt) / 100;
  const nachRabatt = total - rabatt;
  const skonto = nachRabatt * zahl(offerte.skonto) / 100;
  const exklMwst = nachRabatt - skonto;
  const mwst = exklMwst * MWST_PROZENT / 100;
  return { total, rabatt, skonto, exklMwst, mwst, inklMwst: exklMwst + mwst };
}

// LV-Tabellenzeilen (Ansicht und Druck teilen dieselbe Darstellung).
// interaktiv: Menge wird zum Knopf, wenn Ausmasszeilen dahinterliegen.
export function lvZeilenHtml(gliederung, { interaktiv = false } = {}) {
  const zeilen = [];
  let kapitelSumme = 0;
  let kapitelNr = null;
  let gesamt = 0;
  const zwischentotal = () => {
    if (kapitelNr !== null) {
      zeilen.push(`<tr class="lv-zwischentotal"><td></td>
        <td colspan="4">Total ${esc(kapitelNr)}</td>
        <td class="lv-zahl">${chf(kapitelSumme)}</td></tr>`);
    }
  };
  gliederung.forEach((z, index) => {
    if (z.art === 'kapitel') {
      zwischentotal();
      kapitelNr = z.nr;
      kapitelSumme = 0;
      zeilen.push(`<tr class="lv-kapitel"><td class="lv-nr">${esc(z.nr)}</td>
        <td colspan="5">${esc(z.titel)}</td></tr>`);
    } else if (z.art === 'unternummer') {
      zeilen.push(`<tr class="lv-unternummer"><td class="lv-nr">${esc(z.nr)}</td>
        <td colspan="5">${esc(z.titel)}</td></tr>`);
    } else {
      const betrag = zahl(z.menge) * zahl(z.ep);
      kapitelSumme += betrag;
      gesamt += betrag;
      const mitAusmass = z.ausmass?.length > 0;
      const mengeHtml = interaktiv && mitAusmass
        ? `<button type="button" class="lv-menge-knopf" data-ausmass-zeige="${index}"
             title="Ausmass anzeigen">${mengeText(zahl(z.menge))}</button>`
        : mengeText(zahl(z.menge));
      zeilen.push(`<tr class="lv-position"><td class="lv-nr">${esc(z.nr)}</td>
        <td>${esc(z.text)}</td>
        <td class="lv-eh">${esc(z.einheit || '')}</td>
        <td class="lv-zahl">${mengeHtml}</td>
        <td class="lv-zahl">${mengeText(zahl(z.ep))}</td>
        <td class="lv-zahl">${chf(betrag)}</td></tr>`);
    }
  });
  zwischentotal();
  zeilen.push(`<tr class="lv-endtotal"><td></td>
    <td colspan="4">Total Positionen exkl. MwSt.</td>
    <td class="lv-zahl">${chf(gesamt)}</td></tr>`);
  return zeilen.join('');
}

function lvTabelleHtml(gliederung, optionen) {
  return `
    <table class="lv-tabelle">
      <thead><tr>
        <th class="lv-nr">Pos.-Nr.</th><th>Text</th><th class="lv-eh">EH</th>
        <th class="lv-zahl">Menge</th><th class="lv-zahl">Preis</th>
        <th class="lv-zahl">Betrag</th>
      </tr></thead>
      <tbody>${lvZeilenHtml(gliederung, optionen)}</tbody>
    </table>`;
}

function zusammenzugZeilen(offerte) {
  const z = zusammenzug(offerte);
  return [
    { label: 'Total Positionen', wert: chf(z.total) },
    ...(z.rabatt ? [{ label: `Rabatt ${offerte.rabatt} %`, wert: `− ${chf(z.rabatt)}` }] : []),
    ...(z.skonto ? [{ label: `Skonto ${offerte.skonto} %`, wert: `− ${chf(z.skonto)}` }] : []),
    { label: 'Total exkl. MwSt.', wert: chf(z.exklMwst) },
    { label: `MwSt. ${MWST_PROZENT} %`, wert: chf(z.mwst) },
    { label: 'Total inkl. MwSt.', wert: chf(z.inklMwst) },
  ];
}

// ---------- Ausmass-Fenster ----------
// Editierbar im Editor, nur lesend aus der LV-Ansicht (hinter der Menge).
function oeffneAusmassFenster({ titel, einheit, zeilen, editierbar, onUebernehmen }) {
  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  const zeileHtml = (z = {}) => `
    <div class="ausmass-editor-zeile" data-rolle="az">
      <input data-az="bez" placeholder="Bezeichnung" autocomplete="off"
        value="${esc(z.bez ?? '')}" ${editierbar ? '' : 'readonly'}>
      <input data-az="anzahl" type="number" inputmode="decimal" step="any"
        placeholder="Anz." value="${esc(z.anzahl ?? '')}" ${editierbar ? '' : 'readonly'}>
      <input data-az="laenge" type="number" inputmode="decimal" step="any"
        placeholder="Länge" value="${esc(z.laenge ?? '')}" ${editierbar ? '' : 'readonly'}>
      <input data-az="breite" type="number" inputmode="decimal" step="any"
        placeholder="Breite" value="${esc(z.breite ?? '')}" ${editierbar ? '' : 'readonly'}>
      <input data-az="hoehe" type="number" inputmode="decimal" step="any"
        placeholder="Höhe" value="${esc(z.hoehe ?? '')}" ${editierbar ? '' : 'readonly'}>
      <span class="ausmass-wert" data-rolle="az-wert"></span>
      ${editierbar ? `<button type="button" class="knopf zeile-weg"
        data-aktion="az-weg" aria-label="Zeile entfernen">×</button>` : ''}
    </div>`;
  dialog.innerHTML = `
    <form class="karte formular dialog ausmass-dialog" data-rolle="ausmass-fenster">
      <h3>Ausmass · ${esc(titel)}</h3>
      <p class="hinweis">Anzahl × Länge × Breite × Höhe — leere Felder zählen
        nicht mit. Die Summe wird zur Menge${einheit ? ` [${esc(einheit)}]` : ''}.</p>
      <div class="ausmass-editor-kopf">
        <span>Bezeichnung</span><span>Anz.</span><span>Länge</span>
        <span>Breite</span><span>Höhe</span><span>=</span><span></span>
      </div>
      <div data-rolle="az-liste">
        ${(zeilen?.length ? zeilen : (editierbar ? [{}] : [])).map(zeileHtml).join('')}
      </div>
      ${editierbar ? `<button type="button" class="knopf zeile-hinzu"
        data-aktion="az-neu">+ Ausmasszeile</button>` : ''}
      <div class="rapport-totale">
        <div class="regie-total"><span>Summe (Menge)</span>
          <span data-rolle="az-summe"></span></div>
      </div>
      <div class="knopfzeile">
        ${editierbar ? `<button type="submit" class="knopf knopf-primaer">
          Übernehmen</button>` : ''}
        <button type="button" class="knopf" data-aktion="zu">Schliessen</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const formular = dialog.querySelector('form');
  const liste = dialog.querySelector('[data-rolle="az-liste"]');

  function sammle() {
    return [...liste.querySelectorAll('[data-rolle="az"]')].map((block) => {
      const wert = (feld) => block.querySelector(`[data-az="${feld}"]`).value.trim();
      return { bez: wert('bez'), anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') };
    }).filter((z) => z.bez || z.anzahl || z.laenge || z.breite || z.hoehe);
  }

  function rechne() {
    liste.querySelectorAll('[data-rolle="az"]').forEach((block) => {
      const wert = (feld) => block.querySelector(`[data-az="${feld}"]`).value;
      const einzel = ausmassZeileWert({ anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') });
      block.querySelector('[data-rolle="az-wert"]').textContent =
        einzel ? mengeText(Math.round(einzel * 1000) / 1000) : '—';
    });
    dialog.querySelector('[data-rolle="az-summe"]').textContent =
      `${mengeText(ausmassSumme(sammle()))}${einheit ? ` ${einheit}` : ''}`;
  }

  formular.addEventListener('input', rechne);
  formular.addEventListener('click', (klick) => {
    const knopf = klick.target.closest('[data-aktion]');
    if (!knopf) return;
    if (knopf.dataset.aktion === 'zu') {
      dialog.remove();
    } else if (knopf.dataset.aktion === 'az-neu') {
      liste.insertAdjacentHTML('beforeend', zeileHtml());
    } else if (knopf.dataset.aktion === 'az-weg') {
      knopf.closest('[data-rolle="az"]').remove();
      rechne();
    }
  });
  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog) dialog.remove();
  });
  formular.addEventListener('submit', (abschicken) => {
    abschicken.preventDefault();
    const daten = sammle();
    onUebernehmen?.(daten, ausmassSumme(daten));
    dialog.remove();
  });
  rechne();
}

export default {
  name: 'Offerten',
  dokumentTypen: ['offerte', 'katalogposition'],

  render(container) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="offerten">
        <h2>Offerten</h2>
        <p class="hinweis">Baustellenunabhängig — eine angenommene Offerte wird
          per Klick zur neuen Baustelle; die Positionen gehen als Kopie ins
          Ausmass, die Offerte selbst bleibt unverändert.</p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">Neue Offerte</button>
        </div>
        <div data-rolle="formular-bereich"></div>
        <div data-rolle="liste"></div>

        <details class="karte import">
          <summary>NPK-Positionskatalog pflegen</summary>
          <div data-rolle="katalog-liste"></div>
          <form class="feld-reihe" data-rolle="katalog-form">
            <label>NPK-Nr.<input name="pos" required autocomplete="off"></label>
            <label>Text<input name="text" required autocomplete="off"></label>
            <label>Einheit<input name="einheit" autocomplete="off"></label>
            <label>EP<input name="ep" type="number" inputmode="decimal" step="any"></label>
            <button type="submit" class="knopf zeile-hinzu">+ Katalogposition</button>
          </form>
        </details>
      </section>`;

    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');
    const katalogListe = container.querySelector('[data-rolle="katalog-liste"]');

    const ladeOfferten = () => abfrage({ typ: 'offerte', baustelleId: OFFERT_ID });
    const ladeKatalog = async () => (await abfrage({ typ: 'katalogposition', baustelleId: KATALOG_ID }))
      .sort((a, b) => String(a.pos).localeCompare(String(b.pos), 'de-CH', { numeric: true }));

    // ---------- Katalog ----------
    async function zeichneKatalog() {
      const katalog = await ladeKatalog();
      katalogListe.innerHTML = katalog.length
        ? katalog.map((k) => `
            <div class="fo-zeile dossier-zeile">
              <span class="fo-label">${esc(k.pos)} · ${esc(k.text)} · ${esc(k.einheit || '—')}
                · EP ${chf(zahl(k.ep))}</span>
              <button type="button" class="knopf zeile-weg" data-katalog-weg="${esc(k._id)}"
                aria-label="Katalogposition löschen">×</button>
            </div>`).join('')
        : '<p class="hinweis">Noch keine Katalogpositionen.</p>';
    }

    container.querySelector('[data-rolle="katalog-form"]')
      .addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const f = abschicken.target;
        await put({
          typ: 'katalogposition', baustelleId: KATALOG_ID,
          pos: f.elements.pos.value.trim(), text: f.elements.text.value.trim(),
          einheit: f.elements.einheit.value.trim(), ep: f.elements.ep.value.trim(),
        });
        f.reset();
        await zeichneKatalog();
        if (formularBereich.querySelector('form')) aktualisiereKatalogWahl();
      });

    katalogListe.addEventListener('click', async (klick) => {
      const id = klick.target.closest('[data-katalog-weg]')?.dataset.katalogWeg;
      if (!id || !confirm('Katalogposition löschen?')) return;
      await entferneDokument(id);
      await zeichneKatalog();
    });

    // ---------- Editor: Gliederungszeilen ----------
    function gliederungsBlock(z = { art: 'position' }) {
      if (z.art === 'kapitel' || z.art === 'unternummer') {
        const istKapitel = z.art === 'kapitel';
        return `
          <div class="tab-block lv-block ${istKapitel ? 'lv-block-kapitel' : 'lv-block-unternummer'}"
            data-rolle="lv-zeile" data-art="${z.art}">
            <div class="tab-block-kopf">
              <strong>${istKapitel ? 'NPK-Kapitel' : 'Unternummer'}</strong>
              <button type="button" class="knopf zeile-weg" data-aktion="zeile-weg"
                aria-label="Zeile entfernen">×</button>
            </div>
            <div class="feld-reihe">
              <label>Nummer<input data-o="nr" value="${esc(z.nr ?? '')}"
                placeholder="${istKapitel ? 'z. B. NPK 211' : 'z. B. 211.100'}"
                autocomplete="off"></label>
              <label>Titel<input data-o="titel" value="${esc(z.titel ?? '')}"
                autocomplete="off"></label>
            </div>
          </div>`;
      }
      const anzahl = z.ausmass?.length || 0;
      return `
        <div class="tab-block lv-block" data-rolle="lv-zeile" data-art="position"
          data-ausmass="${esc(JSON.stringify(z.ausmass || []))}">
          <div class="tab-block-kopf">
            <strong data-rolle="tab-nr"></strong>
            <button type="button" class="knopf zeile-weg" data-aktion="zeile-weg"
              aria-label="Position entfernen">×</button>
          </div>
          <div class="feld-reihe">
            <label>Pos.-Nr.<input data-o="nr" value="${esc(z.nr ?? '')}"
              placeholder="z. B. 211.101.001" autocomplete="off"></label>
            <label>Einheit<input data-o="einheit" value="${esc(z.einheit ?? '')}"
              autocomplete="off"></label>
          </div>
          <label>Text<input data-o="text" value="${esc(z.text ?? '')}" autocomplete="off"></label>
          <div class="feld-reihe">
            <label>Menge<input data-o="menge" type="number" inputmode="decimal" step="any"
              value="${esc(z.menge ?? '')}"></label>
            <label>EP [CHF]<input data-o="ep" type="number" inputmode="decimal" step="any"
              value="${esc(z.ep ?? '')}"></label>
            <button type="button" class="knopf zeile-hinzu" data-aktion="ausmass">
              Ausmass (${anzahl})</button>
          </div>
        </div>`;
    }

    function sammleOfferte(formular) {
      return {
        nummer: formular.elements.nummer.value.trim(),
        kunde: formular.elements.kunde.value.trim(),
        objekt: formular.elements.objekt.value.trim(),
        status: formular.elements.status.value,
        rabatt: formular.elements.rabatt.value.trim(),
        skonto: formular.elements.skonto.value.trim(),
        gliederung: [...formular.querySelectorAll('[data-rolle="lv-zeile"]')].map((block) => {
          const wert = (feld) => block.querySelector(`[data-o="${feld}"]`)?.value.trim() ?? '';
          if (block.dataset.art !== 'position') {
            return { art: block.dataset.art, nr: wert('nr'), titel: wert('titel') };
          }
          return {
            art: 'position', nr: wert('nr'), text: wert('text'),
            einheit: wert('einheit'), menge: wert('menge'), ep: wert('ep'),
            ausmass: JSON.parse(block.dataset.ausmass || '[]'),
          };
        }).filter((z) => z.nr || z.titel || z.text
          || (z.art === 'position' && (zahl(z.menge) || zahl(z.ep)))),
      };
    }

    function aktualisiereZusammenzug() {
      const formular = formularBereich.querySelector('form');
      if (!formular) return;
      const offerte = sammleOfferte(formular);
      const z = zusammenzug(offerte);
      formular.querySelector('[data-rolle="zusammenzug"]').innerHTML = `
        <div><span>Total Positionen</span><span>${chf(z.total)}</span></div>
        ${z.rabatt ? `<div><span>− Rabatt</span><span>${chf(z.rabatt)}</span></div>` : ''}
        ${z.skonto ? `<div><span>− Skonto</span><span>${chf(z.skonto)}</span></div>` : ''}
        <div><span>Total exkl. MwSt.</span><span>${chf(z.exklMwst)}</span></div>
        <div><span>MwSt. ${MWST_PROZENT} %</span><span>${chf(z.mwst)}</span></div>
        <div class="regie-total"><span>Total inkl. MwSt.</span><span>${chf(z.inklMwst)}</span></div>`;
      let lauf = 0;
      formular.querySelectorAll('[data-rolle="lv-zeile"][data-art="position"] [data-rolle="tab-nr"]')
        .forEach((el) => { el.textContent = `Position ${++lauf}`; });
    }

    async function aktualisiereKatalogWahl() {
      const katalog = await ladeKatalog();
      const wahl = formularBereich.querySelector('[data-rolle="katalog-wahl"]');
      if (wahl) {
        wahl.innerHTML = katalog.length
          ? katalog.map((k, i) => `<option value="${i}">${esc(k.pos)} · ${esc(k.text.slice(0, 30))}</option>`).join('')
          : '<option value="">Katalog leer</option>';
        wahl.dataset.katalog = JSON.stringify(katalog.map((k) => ({
          pos: k.pos, text: k.text, einheit: k.einheit, ep: k.ep,
        })));
      }
    }

    async function oeffneFormular(offerte) {
      inBearbeitung = offerte || null;
      neuZeile.hidden = true;
      const offerten = await ladeOfferten();
      const jahr = new Date().getFullYear();
      const nummer = offerte?.nummer || `O-${jahr}-${String(offerten.length + 1).padStart(2, '0')}`;
      const gliederung = offerte ? gliederungVon(offerte) : [{ art: 'position' }];
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="offert-formular">
          <h3>${offerte ? `Offerte ${esc(offerte.nummer)} bearbeiten` : 'Neue Offerte'}</h3>
          <div class="feld-reihe">
            <label>Nummer *<input name="nummer" required value="${esc(nummer)}" autocomplete="off"></label>
            <label>Status<select name="status">
              ${OFFERT_STATUS.map((s) => `<option${(offerte?.status || 'Entwurf') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></label>
          </div>
          <label>Kunde / Bauherr *<input name="kunde" required autocomplete="off"
            value="${esc(offerte?.kunde ?? '')}"></label>
          <label>Objekt / Baustelle *<input name="objekt" required autocomplete="off"
            value="${esc(offerte?.objekt ?? '')}"></label>

          <div data-rolle="lv-zeilen">
            ${gliederung.map(gliederungsBlock).join('')}
          </div>
          <div class="knopfzeile">
            <button type="button" class="knopf zeile-hinzu" data-aktion="kapitel-neu">+ NPK-Kapitel</button>
            <button type="button" class="knopf zeile-hinzu" data-aktion="unternummer-neu">+ Unternummer</button>
            <button type="button" class="knopf zeile-hinzu" data-aktion="pos-neu">+ Position</button>
          </div>
          <div class="feld-reihe">
            <select data-rolle="katalog-wahl"></select>
            <button type="button" class="knopf zeile-hinzu" data-aktion="aus-katalog">+ aus Katalog</button>
          </div>

          <div class="feld-reihe">
            <label>Rabatt %<input name="rabatt" type="number" inputmode="decimal" step="any"
              value="${esc(offerte?.rabatt ?? '')}" placeholder="0"></label>
            <label>Skonto %<input name="skonto" type="number" inputmode="decimal" step="any"
              value="${esc(offerte?.skonto ?? '')}" placeholder="0"></label>
          </div>
          <div class="rapport-totale" data-rolle="zusammenzug"></div>

          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Offerte speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      await aktualisiereKatalogWahl();
      aktualisiereZusammenzug();
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    formularBereich.addEventListener('input', aktualisiereZusammenzug);

    formularBereich.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const formular = formularBereich.querySelector('form');
      const zeilen = formular?.querySelector('[data-rolle="lv-zeilen"]');
      const aktion = knopf.dataset.aktion;
      if (aktion === 'abbrechen') {
        schliesseFormular();
      } else if (aktion === 'kapitel-neu') {
        zeilen.insertAdjacentHTML('beforeend', gliederungsBlock({ art: 'kapitel' }));
        aktualisiereZusammenzug();
      } else if (aktion === 'unternummer-neu') {
        zeilen.insertAdjacentHTML('beforeend', gliederungsBlock({ art: 'unternummer' }));
        aktualisiereZusammenzug();
      } else if (aktion === 'pos-neu') {
        zeilen.insertAdjacentHTML('beforeend', gliederungsBlock({ art: 'position' }));
        aktualisiereZusammenzug();
      } else if (aktion === 'aus-katalog') {
        const wahl = formular.querySelector('[data-rolle="katalog-wahl"]');
        const katalog = JSON.parse(wahl.dataset.katalog || '[]');
        const eintrag = katalog[Number(wahl.value)];
        if (!eintrag) return;
        zeilen.insertAdjacentHTML('beforeend', gliederungsBlock({
          art: 'position', nr: eintrag.pos, text: eintrag.text,
          einheit: eintrag.einheit, ep: eintrag.ep,
        }));
        aktualisiereZusammenzug();
      } else if (aktion === 'zeile-weg') {
        knopf.closest('[data-rolle="lv-zeile"]').remove();
        aktualisiereZusammenzug();
      } else if (aktion === 'ausmass') {
        // Ausmasszeilen dieser Position bearbeiten — die Summe wird zur
        // Menge (nachträglich von Hand übersteuerbar).
        const block = knopf.closest('[data-rolle="lv-zeile"]');
        const wert = (feld) => block.querySelector(`[data-o="${feld}"]`)?.value.trim() ?? '';
        oeffneAusmassFenster({
          titel: [wert('nr'), wert('text')].filter(Boolean).join(' · ') || 'Position',
          einheit: wert('einheit'),
          zeilen: JSON.parse(block.dataset.ausmass || '[]'),
          editierbar: true,
          onUebernehmen: (daten, summe) => {
            block.dataset.ausmass = JSON.stringify(daten);
            block.querySelector('[data-o="menge"]').value = daten.length ? summe : wert('menge');
            knopf.textContent = `Ausmass (${daten.length})`;
            aktualisiereZusammenzug();
          },
        });
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      if (abschicken.target.dataset.rolle !== 'offert-formular') return;
      abschicken.preventDefault();
      const formular = abschicken.target;
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'offerte', baustelleId: OFFERT_ID };
        delete basis.positionen; // altes flaches Format wird abgelöst
        await put({ ...basis, ...sammleOfferte(formular) });
        schliesseFormular();
        await zeichneListe();
      } catch (fehler) {
        formular.querySelector('.meldung').textContent = fehler.message;
      }
    });

    // ---------- Offerten-Liste (LV-Ansicht) ----------
    async function zeichneListe() {
      const offerten = await ladeOfferten();
      listeElement.innerHTML = offerten.length
        ? offerten.map((o) => {
            const z = zusammenzug(o);
            const gliederung = gliederungVon(o);
            const anzahl = gliederung.filter((g) => g.art === 'position').length;
            const index = OFFERT_STATUS.indexOf(o.status);
            const naechster = OFFERT_STATUS[index + 1];
            return `
              <article class="karte offert-karte" data-offerte="${esc(o._id)}">
                <div class="rapport-kopf">
                  <strong>${esc(o.nummer)} · ${esc(o.objekt)}</strong>
                  <span class="chip${o.status === 'angenommen' ? ' gewinn' : ''}">${esc(o.status)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                      data-id="${esc(o._id)}">PDF</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(o._id)}">Bearbeiten</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(o._id)}" aria-label="Offerte löschen">Löschen</button>
                  </span>
                </div>
                <p class="hinweis">${esc(o.kunde)} · ${anzahl} Positionen
                  · ${chf(z.inklMwst)} inkl. MwSt.</p>
                <details class="lv-details">
                  <summary>Leistungsverzeichnis anzeigen</summary>
                  <div class="tabellen-scroll">${lvTabelleHtml(gliederung, { interaktiv: true })}</div>
                  <p class="hinweis">Menge antippen zeigt das Ausmass dahinter.</p>
                </details>
                <div class="knopfzeile">
                  ${naechster ? `<button type="button" class="knopf" data-aktion="weiter"
                    data-id="${esc(o._id)}">Status → ${naechster}</button>` : ''}
                  ${o.status === 'angenommen' && !o.baustelleErstellt ? `
                    <button type="button" class="knopf knopf-primaer" data-aktion="baustelle"
                      data-id="${esc(o._id)}">Baustelle erstellen</button>` : ''}
                  ${o.baustelleErstellt ? '<span class="hinweis">↳ Baustelle erstellt ✓</span>' : ''}
                </div>
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch keine Offerten.</p>';
    }

    listeElement.addEventListener('click', async (klick) => {
      // Menge mit Ausmass dahinter: Antippen öffnet das Fenster (nur lesend).
      const mengeKnopf = klick.target.closest('[data-ausmass-zeige]');
      if (mengeKnopf) {
        const karte = mengeKnopf.closest('[data-offerte]');
        const offerten = await ladeOfferten();
        const offerte = offerten.find((o) => o._id === karte.dataset.offerte);
        const zeile = gliederungVon(offerte)[Number(mengeKnopf.dataset.ausmassZeige)];
        if (zeile) {
          oeffneAusmassFenster({
            titel: [zeile.nr, zeile.text].filter(Boolean).join(' · '),
            einheit: zeile.einheit, zeilen: zeile.ausmass, editierbar: false,
          });
        }
        return;
      }
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const offerten = await ladeOfferten();
      const offerte = offerten.find((o) => o._id === knopf.dataset.id);
      if (!offerte) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'oeffnen') {
        oeffneFormular(offerte);
      } else if (aktion === 'weiter') {
        const naechster = OFFERT_STATUS[OFFERT_STATUS.indexOf(offerte.status) + 1];
        if (naechster) await put({ ...offerte, status: naechster });
        await zeichneListe();
      } else if (aktion === 'loeschen') {
        if (!confirm(`Offerte ${offerte.nummer} endgültig löschen?`)) return;
        await entferneDokument(offerte._id);
        if (inBearbeitung?._id === offerte._id) schliesseFormular();
        await zeichneListe();
      } else if (aktion === 'pdf') {
        // Druck ohne Ausmass-Spalte (Kalkulationsgrundlage bleibt intern) —
        // Text bekommt die Breite, wie auf der Papier-Vorlage.
        zeigeOffertDruck(offerte, {
          tabelleHtml: lvTabelleHtml(gliederungVon(offerte)),
          zusammenzug: zusammenzugZeilen(offerte),
        });
      } else if (aktion === 'baustelle') {
        // Angenommene Offerte → neue Baustelle. Die Positionen gehen als
        // KOPIE ins Ausmass (dort wird gemessen); die Offerte samt ihrer
        // Kalkulationsgrundlage bleibt unverändert stehen.
        const ktr = prompt('KTR-Nr. für die neue Baustelle:');
        if (!ktr || !ktr.trim()) return;
        const z = zusammenzug(offerte);
        const neueBaustelle = await speichereBaustelle({
          ktr: ktr.trim(),
          name: offerte.objekt,
          ort: '',
          bauherr: offerte.kunde,
          werkvertrag: `${chf(z.exklMwst)} exkl. MwSt. (Offerte ${offerte.nummer})`,
        });
        const positionen = nurPositionen(offerte);
        for (const p of positionen) {
          await put({
            typ: 'ausmass',
            baustelleId: neueBaustelle.baustelleId,
            pos: p.nr, text: p.text, einheit: p.einheit,
            vertragsmenge: p.menge, menge: '', ep: p.ep,
            offertAusmass: p.ausmass || [], // Kopie der Kalkulationsgrundlage
          });
        }
        await put({ ...offerte, baustelleErstellt: true });
        document.dispatchEvent(new CustomEvent('luense:daten'));
        alert(`Baustelle ${ktr.trim()} erstellt — ${positionen.length} `
          + 'Positionen als Ausmass-Kopie übernommen. Die Offerte bleibt unverändert.');
        document.dispatchEvent(new CustomEvent('luense:baustelleWechseln', {
          detail: { baustelleId: neueBaustelle.baustelleId },
        }));
      }
    });

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    zeichneListe();
    zeichneKatalog();
  },
};
