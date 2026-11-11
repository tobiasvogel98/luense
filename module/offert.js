// module/offert.js — Offertwesen im Leistungsverzeichnis-Layout (nach
// Tobias' Vorlage / Sorba-Prinzip): Gliederung in NPK-Kapitel, Unter-
// nummern und Positionen — Nummer und Text links, EH/Menge/Preis/Betrag
// rechts, Zwischentotal je Kapitel. Je Position beliebig viele
// Ausmasszeilen (Bezeichnung, Anzahl × Länge × Breite × Höhe) als
// Kalkulationsgrundlage — sie bleiben in der Offerte gespeichert und
// sind hinter der Menge versteckt (Antippen öffnet sie im Fenster, dort
// erfassen und direkt in die Menge speichern).
// Zusammenzug wie das Alt-Tool: Total → −Rabatt → −Skonto → +MwSt.
// «angenommen» erzeugt per Klick eine Baustelle; die Positionen gehen
// als KOPIE ins Ausmass (dort wird gemessen, die Offerte bleibt unberührt).
// Bewusste Ausnahme von «alle Dokumente tragen eine Baustellen-Id»:
// Katalog und Offerten existieren VOR der Baustelle — sie nutzen die
// Sammel-Ids «katalog» bzw. «offertwesen».

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { speichereBaustelle } from '../kern/stamm.js';
import { zeigeOffertDruck } from '../kern/pdf.js';
import { chf, esc, naechsteNummer } from '../kern/ui.js';

const KATALOG_ID = 'katalog';
const OFFERT_ID = 'offertwesen';
const MWST_PROZENT = 8.1;
const OFFERT_STATUS = ['Entwurf', 'eingereicht', 'angenommen'];

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
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
//   { art: 'position', nr, text, einheit, ep, menge, ausmass: [zeilen],
//     mengeVonHand?: true }  (Menge bewusst abweichend vom Ausmass)
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
  // Rappenrundung nur auf dem Endbetrag (auf 0.05 CHF, kaufmännisch);
  // Positionen bleiben ungerundet. Basis sind die angezeigten Beträge
  // (exkl. und MwSt. je auf Rappen), damit der Zusammenzug aufgeht:
  // exkl. + MwSt. + Rundung = Total inkl. MwSt.
  const rappen = Math.round(exklMwst * 100) + Math.round(mwst * 100);
  const inklMwst = (Math.round(rappen / 5) * 5) / 100;
  const rundung = inklMwst - rappen / 100;
  return {
    total, rabatt, skonto, exklMwst, mwst, inklMwst,
    rundung: Math.abs(rundung) < 0.001 ? 0 : rundung,
  };
}

// Rundungsbetrag mit Vorzeichen, z. B. «− CHF 0.02» / «+ CHF 0.01».
function rundungText(rundung) {
  return `${rundung < 0 ? '−' : '+'} ${chf(Math.abs(rundung))}`;
}

// LV-Tabellenzeilen (Ansicht und Druck teilen dieselbe Darstellung).
// interaktiv: jede Menge wird zum Knopf — Antippen öffnet ihr Ausmass
// (bearbeiten und direkt in die Menge speichern). Der Druck bleibt schlicht.
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
      const mengeHtml = interaktiv
        ? mengeKnopfHtml(z, `data-ausmass-zeige="${index}"`)
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
    ...(z.rundung ? [{ label: 'Rundung', wert: rundungText(z.rundung) }] : []),
    { label: 'Total inkl. MwSt.', wert: chf(z.inklMwst) },
  ];
}

// ---------- Menge und Ausmass einer Position ----------
// Eine Position trägt ihre Menge entweder von Hand (ohne Ausmasszeilen)
// oder abgeleitet aus dem Ausmass (Menge = Summe der Zeilen). Wer trotz
// Ausmass eine andere Menge will, setzt «mengeVonHand» — die Abweichung
// wird dann überall sichtbar markiert. Alte Positionen ohne das Feld:
// Menge ≠ Summe gilt ebenfalls als Abweichung.
export function mengeHerkunft(position) {
  if (!position.ausmass?.length) return 'hand';
  const summe = ausmassSumme(position.ausmass);
  return Math.abs(zahl(position.menge) - summe) > 0.0005 ? 'abweichend' : 'ausmass';
}

const HERKUNFT_MARKE = {
  ausmass: '<span class="lv-menge-marke">aus Ausmass</span>',
  abweichend: '<span class="lv-menge-marke lv-menge-abweichend">≠ Ausmass</span>',
  hand: '',
};

// Knopf für die Menge (LV-Ansicht und Editor teilen ihn): Wert gross,
// darunter klein die Herkunft — Antippen öffnet das Ausmass-Fenster.
function mengeKnopfHtml(position, attribut) {
  const herkunft = mengeHerkunft(position);
  const leer = String(position.menge ?? '').trim() === '';
  return `<button type="button" class="lv-menge-knopf" ${attribut}
      title="Menge und Ausmass bearbeiten"
      aria-label="Menge ${leer ? 'erfassen' : mengeText(zahl(position.menge))}${herkunft === 'ausmass' ? ' (aus Ausmass)' : ''}${herkunft === 'abweichend' ? ' (weicht vom Ausmass ab)' : ''} — Ausmass öffnen">
      <span class="lv-menge-wert">${leer ? 'Menge …' : mengeText(zahl(position.menge))}</span>
      ${HERKUNFT_MARKE[herkunft]}
    </button>`;
}

// ---------- Ausmass-Fenster ----------
// Ein Fenster für beide Wege (LV-Ansicht und Editor): Ausmasszeilen
// erfassen, Summe live, die Summe wird zur Menge — oder ohne Zeilen
// die Menge von Hand. onSpeichern({ ausmass, menge, mengeVonHand }).
// baustelle: optionales Promise auf { menge, einheit, onOeffnen } —
// zeigt die auf der Baustelle ausgemessene Menge mit Sprung ins Ausmass.
function oeffneAusmassFenster({
  titel, einheit, ep, zeilen, menge, mengeVonHand, speichernText = 'Speichern',
  baustelle = null, onSpeichern,
}) {
  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  const eh = einheit ? ` ${einheit}` : '';
  const zeileHtml = (z = {}) => `
    <div class="ausmass-editor-zeile" data-rolle="az">
      <input data-az="bez" placeholder="Bezeichnung" autocomplete="off"
        aria-label="Bezeichnung" value="${esc(z.bez ?? '')}">
      <input data-az="anzahl" type="number" inputmode="decimal" step="any"
        placeholder="Anz." aria-label="Anzahl" value="${esc(z.anzahl ?? '')}">
      <input data-az="laenge" type="number" inputmode="decimal" step="any"
        placeholder="Länge" aria-label="Länge" value="${esc(z.laenge ?? '')}">
      <input data-az="breite" type="number" inputmode="decimal" step="any"
        placeholder="Breite" aria-label="Breite" value="${esc(z.breite ?? '')}">
      <input data-az="hoehe" type="number" inputmode="decimal" step="any"
        placeholder="Höhe" aria-label="Höhe" value="${esc(z.hoehe ?? '')}">
      <span class="ausmass-wert" data-rolle="az-wert"></span>
      <button type="button" class="knopf zeile-weg"
        data-aktion="az-weg" aria-label="Zeile entfernen">×</button>
    </div>`;
  const startZeilen = zeilen?.length ? zeilen : [{}];
  const startSumme = ausmassSumme(zeilen);
  const startVonHand = Boolean(zeilen?.length)
    && (Boolean(mengeVonHand) || Math.abs(zahl(menge) - startSumme) > 0.0005);
  dialog.innerHTML = `
    <form class="karte formular dialog ausmass-dialog" data-rolle="ausmass-fenster"
      aria-label="Ausmass ${esc(titel)}">
      <h3>Ausmass · ${esc(titel)}</h3>
      <p class="hinweis">Anzahl × Länge × Breite × Höhe — leere Felder zählen
        nicht mit. Die Summe wird zur Menge${einheit ? ` [${esc(einheit)}]` : ''}.</p>
      <div class="ausmass-editor-kopf" aria-hidden="true">
        <span class="az-kopf-bez">Bezeichnung</span><span>Anz.</span><span>Länge</span>
        <span>Breite</span><span>Höhe</span><span>=</span><span></span>
      </div>
      <div data-rolle="az-liste">${startZeilen.map(zeileHtml).join('')}</div>
      <button type="button" class="knopf zeile-hinzu" data-aktion="az-neu">+ Ausmasszeile</button>

      <div class="ausmass-menge">
        <div class="ausmass-ergebnis summe" data-rolle="summe-zeile"><span>Summe Ausmass</span>
          <span data-rolle="az-summe"></span></div>
        <label class="ausmass-hand" data-rolle="hand-schalter">
          <input type="checkbox" data-rolle="von-hand"${startVonHand ? ' checked' : ''}>
          Menge von Hand übersteuern</label>
        <label data-rolle="menge-feld">Menge${einheit ? ` [${esc(einheit)}]` : ''}
          <input data-rolle="menge-eingabe" type="number" inputmode="decimal" step="any"
            value="${esc(menge ?? '')}" placeholder="0"></label>
        <p class="ausmass-abweichung" data-rolle="abweichung" role="status" hidden></p>
        <div class="ausmass-ergebnis"><span>Menge</span><strong data-rolle="menge-ergebnis"></strong></div>
        <div class="ausmass-ergebnis"><span>Betrag (× EP ${chf(zahl(ep))})</span>
          <strong data-rolle="betrag"></strong></div>
      </div>
      <div data-rolle="baustelle-link"></div>

      <div class="knopfzeile">
        <button type="submit" class="knopf knopf-primaer">${esc(speichernText)}</button>
        <button type="button" class="knopf" data-aktion="zu">Abbrechen</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const formular = dialog.querySelector('form');
  const liste = dialog.querySelector('[data-rolle="az-liste"]');
  const feld = (rolle) => dialog.querySelector(`[data-rolle="${rolle}"]`);
  const vonHand = feld('von-hand');
  const mengeEingabe = feld('menge-eingabe');
  let geaendert = false;

  function sammle() {
    return [...liste.querySelectorAll('[data-rolle="az"]')].map((block) => {
      const wert = (name) => block.querySelector(`[data-az="${name}"]`).value.trim();
      return { bez: wert('bez'), anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') };
    }).filter((z) => z.bez || z.anzahl || z.laenge || z.breite || z.hoehe);
  }

  // Ergebnis des Fensters: was beim Speichern in die Position geht.
  function ergebnis() {
    const ausmass = sammle();
    const summe = ausmassSumme(ausmass);
    const mitZeilen = ausmass.length > 0;
    const hand = !mitZeilen || vonHand.checked;
    const wert = hand ? mengeEingabe.value.trim() : String(summe);
    return { ausmass, summe, mitZeilen, hand, menge: wert,
      mengeVonHand: mitZeilen && vonHand.checked };
  }

  function rechne() {
    liste.querySelectorAll('[data-rolle="az"]').forEach((block) => {
      const wert = (name) => block.querySelector(`[data-az="${name}"]`).value;
      const einzel = ausmassZeileWert({ anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') });
      block.querySelector('[data-rolle="az-wert"]').textContent =
        einzel ? mengeText(Math.round(einzel * 1000) / 1000) : '—';
    });
    const e = ergebnis();
    feld('az-summe').textContent = `${mengeText(e.summe)}${eh}`;
    feld('summe-zeile').hidden = !e.mitZeilen;
    feld('hand-schalter').hidden = !e.mitZeilen;
    feld('menge-feld').hidden = !e.hand;
    const abweichung = feld('abweichung');
    const weichtAb = e.mitZeilen && e.hand && Math.abs(zahl(e.menge) - e.summe) > 0.0005;
    abweichung.hidden = !weichtAb;
    abweichung.textContent = weichtAb
      ? `⚠ Menge weicht vom Ausmass ab (Summe ${mengeText(e.summe)}${eh}) — in der Offerte als «≠ Ausmass» markiert.`
      : '';
    feld('menge-ergebnis').textContent = `${mengeText(zahl(e.menge))}${eh}`
      + (e.mitZeilen && !e.hand ? ' · aus Ausmass' : '');
    feld('betrag').textContent = chf(zahl(e.menge) * zahl(ep));
  }

  const schliesse = () => {
    document.removeEventListener('keydown', taste);
    dialog.remove();
  };
  const abbrechen = () => {
    if (geaendert && !confirm('Änderungen am Ausmass verwerfen?')) return;
    schliesse();
  };
  function taste(ereignis) {
    if (ereignis.key === 'Escape') abbrechen();
  }
  document.addEventListener('keydown', taste);

  vonHand.addEventListener('change', () => {
    // Übersteuern beginnt bei der aktuellen Summe, nicht bei einem alten Wert.
    if (vonHand.checked && !startVonHand) mengeEingabe.value = String(ausmassSumme(sammle()));
  });
  formular.addEventListener('input', () => { geaendert = true; rechne(); });
  formular.addEventListener('click', (klick) => {
    const knopf = klick.target.closest('[data-aktion]');
    if (!knopf) return;
    if (knopf.dataset.aktion === 'zu') {
      abbrechen();
    } else if (knopf.dataset.aktion === 'az-neu') {
      liste.insertAdjacentHTML('beforeend', zeileHtml());
      liste.lastElementChild.querySelector('input').focus();
      rechne();
    } else if (knopf.dataset.aktion === 'az-weg') {
      knopf.closest('[data-rolle="az"]').remove();
      geaendert = true;
      rechne();
    } else if (knopf.dataset.aktion === 'zur-baustelle') {
      schliesse();
    }
  });
  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog) abbrechen();
  });
  formular.addEventListener('submit', async (abschicken) => {
    abschicken.preventDefault();
    const e = ergebnis();
    const knopf = formular.querySelector('[type="submit"]');
    knopf.disabled = true;
    try {
      await onSpeichern?.({ ausmass: e.ausmass, menge: e.menge, mengeVonHand: e.mengeVonHand });
      schliesse();
    } catch (fehler) {
      knopf.disabled = false;
      alert(`Speichern fehlgeschlagen: ${fehler.message}`);
    }
  });
  rechne();

  // Verknüpfte Baustelle: dort ausgemessene Menge, Sprung ins Ausmass.
  baustelle?.then((treffer) => {
    if (!treffer || !dialog.isConnected) return;
    const ziel = feld('baustelle-link');
    ziel.innerHTML = `
      <div class="ausmass-baustelle">
        <span>Ausgemessene Menge auf der Baustelle${treffer.ktr ? ` ${esc(treffer.ktr)}` : ''}:
          <strong>${mengeText(zahl(treffer.menge))}${esc(treffer.einheit ? ` ${treffer.einheit}` : '')}</strong></span>
        <button type="button" class="knopf" data-aktion="zur-baustelle">zum Baustellen-Ausmass →</button>
      </div>`;
    ziel.querySelector('[data-aktion="zur-baustelle"]')
      .addEventListener('click', () => treffer.onOeffnen());
  }).catch(() => {});
}

// ---------- Verknüpfung Offerte → Baustelle ----------
// Liest nur Dokumente (kein Code aus dem Ausmass-Modul): die Ausmass-
// Position der Baustelle, die aus dieser Offert-Position entstanden ist.
// Neue Baustellen tragen offertId/offertPosNr, die Offerte zielBaustelleId;
// ältere Verknüpfungen (nur «baustelleErstellt») finden die Baustelle über
// das Objekt und die Position über die NPK-Nummer.
async function baustellenPosition(offerte, position) {
  if (!offerte?.zielBaustelleId && !offerte?.baustelleErstellt) return null;
  const nr = String(position.nr ?? '').trim();
  if (!nr) return null;
  const baustellen = await abfrage({ typ: 'baustelle' });
  let kandidaten;
  if (offerte.zielBaustelleId) {
    kandidaten = await abfrage({ typ: 'ausmass', baustelleId: offerte.zielBaustelleId });
  } else {
    const alle = await abfrage({ typ: 'ausmass' });
    kandidaten = alle.filter((d) => d.offertId === offerte._id);
    if (!kandidaten.length) {
      const passend = baustellen.filter((b) => b.name === offerte.objekt);
      const baustelle = passend.find((b) => String(b.werkvertrag || '')
        .includes(`Offerte ${offerte.nummer}`)) || passend[0];
      if (!baustelle) return null;
      kandidaten = alle.filter((d) => d.baustelleId === baustelle.baustelleId);
    }
  }
  const treffer = kandidaten.find((d) => d.offertId === offerte._id && d.offertPosNr === nr)
    || kandidaten.find((d) => String(d.pos ?? '').trim() === nr);
  if (!treffer) return null;
  const baustelle = baustellen.find((b) => b.baustelleId === treffer.baustelleId);
  if (!baustelle) return null;
  return {
    menge: treffer.menge, einheit: treffer.einheit, ktr: baustelle.ktr,
    onOeffnen: baustelle.archiviert ? null : () => {
      document.dispatchEvent(new CustomEvent('luense:modulWechseln', {
        detail: { name: 'Ausmass', fokusId: treffer._id, baustelleId: treffer.baustelleId },
      }));
    },
  };
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
      return `
        <div class="tab-block lv-block" data-rolle="lv-zeile" data-art="position"
          data-ausmass="${esc(JSON.stringify(z.ausmass || []))}"
          data-menge-von-hand="${z.mengeVonHand ? '1' : ''}">
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
            <div class="lv-menge-feld">
              <span class="lv-menge-label">Menge · Ausmass</span>
              <input type="hidden" data-o="menge" value="${esc(z.menge ?? '')}">
              ${mengeKnopfHtml(z, 'data-aktion="ausmass"')}
            </div>
            <label>EP [CHF]<input data-o="ep" type="number" inputmode="decimal" step="any"
              value="${esc(z.ep ?? '')}"></label>
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
            ...(block.dataset.mengeVonHand ? { mengeVonHand: true } : {}),
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
        ${z.rundung ? `<div><span>Rundung</span><span>${rundungText(z.rundung)}</span></div>` : ''}
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
      const nummer = offerte?.nummer || naechsteNummer(offerten.map((o) => o.nummer), `O-${jahr}-`);
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
        // Menge und Ausmass dieser Position — dasselbe Fenster wie in der
        // LV-Ansicht; «Übernehmen» schreibt ins Formular (gespeichert wird
        // mit «Offerte speichern»).
        const block = knopf.closest('[data-rolle="lv-zeile"]');
        const wert = (feld) => block.querySelector(`[data-o="${feld}"]`)?.value.trim() ?? '';
        oeffneAusmassFenster({
          titel: [wert('nr'), wert('text')].filter(Boolean).join(' · ') || 'Position',
          einheit: wert('einheit'),
          ep: wert('ep'),
          zeilen: JSON.parse(block.dataset.ausmass || '[]'),
          menge: wert('menge'),
          mengeVonHand: Boolean(block.dataset.mengeVonHand),
          speichernText: 'Übernehmen',
          baustelle: inBearbeitung ? baustellenPosition(inBearbeitung, { nr: wert('nr') }) : null,
          onSpeichern: ({ ausmass, menge, mengeVonHand }) => {
            block.dataset.ausmass = JSON.stringify(ausmass);
            block.dataset.mengeVonHand = mengeVonHand ? '1' : '';
            block.querySelector('[data-o="menge"]').value = menge;
            knopf.outerHTML = mengeKnopfHtml({ ausmass, menge, mengeVonHand }, 'data-aktion="ausmass"');
            aktualisiereZusammenzug();
            block.querySelector('[data-aktion="ausmass"]').focus();
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
    async function zeichneListe({ offenId = null } = {}) {
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
                <details class="lv-details"${o._id === offenId ? ' open' : ''}>
                  <summary>Leistungsverzeichnis anzeigen</summary>
                  <div class="tabellen-scroll">${lvTabelleHtml(gliederung, { interaktiv: true })}</div>
                  <p class="hinweis">Menge antippen öffnet das Ausmass der Position —
                    dort erfassen und direkt in die Menge speichern.</p>
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
      // Menge antippen: Ausmass dieser Position öffnen, bearbeiten und
      // direkt speichern — Menge, Betrag und Zusammenzug rechnen nach.
      const mengeKnopf = klick.target.closest('[data-ausmass-zeige]');
      if (mengeKnopf) {
        const offertId = mengeKnopf.closest('[data-offerte]').dataset.offerte;
        const index = Number(mengeKnopf.dataset.ausmassZeige);
        const offerte = (await ladeOfferten()).find((o) => o._id === offertId);
        const zeile = offerte && gliederungVon(offerte)[index];
        if (!zeile || zeile.art !== 'position') return;
        oeffneAusmassFenster({
          titel: [zeile.nr, zeile.text].filter(Boolean).join(' · ') || 'Position',
          einheit: zeile.einheit, ep: zeile.ep, zeilen: zeile.ausmass,
          menge: zeile.menge, mengeVonHand: zeile.mengeVonHand,
          baustelle: baustellenPosition(offerte, zeile),
          onSpeichern: async ({ ausmass, menge, mengeVonHand }) => {
            // Frisch lesen: die Offerte kann inzwischen bearbeitet worden sein.
            const aktuell = (await ladeOfferten()).find((o) => o._id === offertId);
            const gliederung = gliederungVon(aktuell).map((g) => ({ ...g }));
            const ziel = gliederung[index];
            if (!ziel || ziel.art !== 'position' || ziel.nr !== zeile.nr) {
              throw new Error('Die Offerte wurde inzwischen geändert — bitte neu öffnen.');
            }
            ziel.ausmass = ausmass;
            ziel.menge = menge;
            if (mengeVonHand) ziel.mengeVonHand = true; else delete ziel.mengeVonHand;
            const neu = { ...aktuell, gliederung };
            delete neu.positionen; // altes flaches Format wird abgelöst
            await put(neu);
            await zeichneListe({ offenId: offertId });
            listeElement.querySelector(`[data-offerte="${CSS.escape(offertId)}"] `
              + `[data-ausmass-zeige="${index}"]`)?.focus();
          },
        });
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
            offertId: offerte._id, offertPosNr: String(p.nr ?? '').trim(),
          });
        }
        await put({ ...offerte, baustelleErstellt: true,
          zielBaustelleId: neueBaustelle.baustelleId });
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
