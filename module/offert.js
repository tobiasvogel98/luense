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
// Sperre: eine angenommene Offerte ist der Vertragsstand und bleibt
// unveränderlich (kein Entsperren). Gearbeitet wird in einer Kopie
// («Kopie erstellen», kopieVon = Original) — dort werden Mengen erfasst.
// Menge je Position: direkt als Zahl oder als Rechenweg («12.5*3 + 4.2»,
// eigener kleiner Parser, kein eval), aus Ausmasszeilen oder mit dem
// Grabenrechner (kern/graben.js).

import { put, get, abfrage, entferneDokument } from '../kern/speicher.js';
import { speichereBaustelle } from '../kern/stamm.js';
import { zeigeOffertDruck } from '../kern/pdf.js';
import { chf, esc, naechsteNummer } from '../kern/ui.js';
import { GRABENARTEN, ROHR_LABELS, berechneTeil } from '../kern/graben.js';

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

// ---------- Rechenweg ----------
// Eine Menge ist entweder eine Zahl («12.5», «1'250,5») oder ein
// Rechenweg mit + − × / und Klammern («12.5*3 + 4,2*2»). Ausgewertet
// mit einem kleinen rekursiven Parser — bewusst ohne eval/Function.
// Mal: * × x ·   Geteilt: / : ÷   Dezimal: Punkt oder Komma.
const NUR_ZAHL = /^[+-]?\d[\d'’]*(?:[.,]\d+)?$/;

export function istRechenweg(text) {
  const t = String(text ?? '').replace(/\s/g, '');
  return t !== '' && !NUR_ZAHL.test(t);
}

export function rechneRechenweg(text) {
  const quelle = String(text ?? '');
  let i = 0;
  const fehler = (meldung) => { throw new Error(meldung); };
  const zeichen = () => {
    while (i < quelle.length && /\s/.test(quelle[i])) i++;
    return quelle[i] ?? '';
  };
  const unerwartet = () => (i >= quelle.length
    ? 'Der Rechenweg endet mitten in der Rechnung.'
    : `Unerwartetes Zeichen «${quelle[i]}» an Stelle ${i + 1}.`);
  function zahlLesen() {
    zeichen();
    let ziffern = '';
    let dezimal = false;
    while (i < quelle.length) {
      const c = quelle[i];
      if (c >= '0' && c <= '9') ziffern += c;
      else if ((c === '.' || c === ',') && !dezimal && /\d/.test(ziffern)) {
        dezimal = true;
        ziffern += '.';
      } else if ((c === "'" || c === '’') && /\d/.test(ziffern) && !dezimal) {
        // Tausender-Hochkomma (1'250) — zählt nicht
      } else break;
      i++;
    }
    if (!/\d/.test(ziffern)) fehler(unerwartet());
    return Number(ziffern);
  }
  function faktor() {
    const c = zeichen();
    if (c === '+') { i++; return faktor(); }
    if (c === '-' || c === '−') { i++; return -faktor(); }
    if (c === '(') {
      i++;
      const wert = summe();
      if (zeichen() !== ')') fehler('Klammer «)» fehlt.');
      i++;
      return wert;
    }
    return zahlLesen();
  }
  function produkt() {
    let wert = faktor();
    for (;;) {
      const c = zeichen();
      if (c && '*×xX·'.includes(c)) {
        i++;
        wert *= faktor();
      } else if (c && '/:÷'.includes(c)) {
        i++;
        const teiler = faktor();
        if (teiler === 0) fehler('Division durch null.');
        wert /= teiler;
      } else return wert;
    }
  }
  function summe() {
    let wert = produkt();
    for (;;) {
      const c = zeichen();
      if (c === '+') { i++; wert += produkt(); }
      else if (c === '-' || c === '−') { i++; wert -= produkt(); }
      else return wert;
    }
  }
  if (!quelle.trim()) fehler('Der Rechenweg ist leer.');
  const wert = summe();
  if (zeichen()) fehler(quelle[i] === ')' ? 'Klammer «(» fehlt.' : unerwartet());
  if (!Number.isFinite(wert)) fehler('Das Ergebnis ist keine Zahl.');
  return Math.round(wert * 1000) / 1000;
}

// Direkte Eingabe (Zahl oder Rechenweg) → Felder der Position.
// Mit vorhandenen Ausmasszeilen gilt eine Zahl als bewusstes Übersteuern.
function direktErgebnis(text, ausmass) {
  const t = String(text ?? '').trim();
  const mitZeilen = Boolean(ausmass?.length);
  if (!t) return { menge: '' };
  if (istRechenweg(t)) {
    try {
      const wert = rechneRechenweg(t);
      return { menge: String(wert), mengeQuelle: 'rechenweg', mengeFormel: t };
    } catch (fehler) {
      return { fehler: `Rechenweg ungültig: ${fehler.message}` };
    }
  }
  return { menge: String(zahl(t)), mengeVonHand: mitZeilen || undefined };
}

// ---------- Grabenrechner in der Offerte ----------
// position.graben = { grabenart, L, groesse, teile } — dieselben Teile
// wie im Baustellen-Grabenrechner; die gewählte Grösse (Aushub, Sand …)
// summiert über alle Teile wird zur Menge.
const GRABEN_GROESSEN = {
  aushub: 'Aushub',
  bettung: 'Bettung',
  verdaemmungNetto: 'Umhüllung netto',
  sandTotal: 'Sand total (Bettung + Umhüllung)',
  auffuellung: 'Auffüllung',
};

function groesseVorschlag(text) {
  const t = String(text ?? '').toLowerCase();
  if (/auff[üu]ll|r[üu]ckf[üu]ll|hinterf[üu]ll/.test(t)) return 'auffuellung';
  if (/umh[üu]ll|verd[äa]mm|sand|bettung|leitungszone/.test(t)) return 'sandTotal';
  return 'aushub';
}

function grabenVorlage(grabenart, groesse = 'aushub') {
  return {
    grabenart, L: '', groesse,
    teile: JSON.parse(JSON.stringify(GRABENARTEN[grabenart].teile)),
  };
}

export function grabenMenge(graben) {
  if (!graben?.teile?.length) return 0;
  const groesse = GRABEN_GROESSEN[graben.groesse] ? graben.groesse : 'aushub';
  const summe = graben.teile
    .reduce((s, teil) => s + (berechneTeil(zahl(graben.L), teil)[groesse] || 0), 0);
  return Math.round(summe * 100) / 100;
}

// ---------- Sperre und Kopie ----------
export function istGesperrt(offerte) {
  return offerte?.status === 'angenommen';
}

// Felder, die sich an einer gesperrten Offerte noch ändern dürfen: die
// Verknüpfung zur daraus erstellten Baustelle (kein Inhalt der Offerte).
const SPERRE_FREI = new Set(['_rev', 'baustelleErstellt', 'zielBaustelleId']);

function inhalt(offerte) {
  return JSON.stringify(Object.keys(offerte).filter((k) => !SPERRE_FREI.has(k)).sort()
    .map((k) => [k, offerte[k]]));
}

// Einziger Schreibweg für Offerten: eine gespeicherte, angenommene
// Offerte lässt sich inhaltlich nicht mehr ändern — auch nicht über
// einen veralteten Bildschirmstand.
async function speichereOfferte(offerte) {
  if (offerte._id) {
    let alt = null;
    try { alt = await get(offerte._id); } catch { alt = null; }
    if (istGesperrt(alt) && inhalt(alt) !== inhalt(offerte)) {
      throw new Error(`Offerte ${alt.nummer} ist angenommen und gesperrt — `
        + 'bitte eine Kopie erstellen.');
    }
    if (alt && !istGesperrt(alt) && istGesperrt(offerte)) {
      return put({ ...offerte, angenommenAm: new Date().toISOString() });
    }
  } else if (istGesperrt(offerte)) {
    return put({ ...offerte, angenommenAm: new Date().toISOString() });
  }
  return put(offerte);
}

// Alle Ids, von denen diese Offerte (über Kopien) abstammt, samt eigener.
function abstammung(offerte, alle) {
  const ids = new Set();
  let lauf = offerte;
  while (lauf && !ids.has(lauf._id)) {
    ids.add(lauf._id);
    lauf = lauf.kopieVon ? alle.find((o) => o._id === lauf.kopieVon) : null;
  }
  return ids;
}

function offertName(offerte) {
  return offerte.titel || offerte.objekt || '';
}

function datumText(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-CH',
    { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
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
export function lvZeilenHtml(gliederung, { interaktiv = false, gesperrt = false } = {}) {
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
        ? mengeKnopfHtml(z, `data-ausmass-zeige="${index}"`, { gesperrt })
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
// Neu: mengeQuelle «rechenweg» (mengeFormel) bzw. «graben» (graben) —
// dann stammt die Menge aus dem Rechenweg bzw. dem Grabenrechner.
export function mengeHerkunft(position) {
  if (position.mengeQuelle === 'rechenweg' && position.mengeFormel) return 'rechenweg';
  if (position.mengeQuelle === 'graben' && position.graben) return 'graben';
  if (!position.ausmass?.length) return 'hand';
  const summe = ausmassSumme(position.ausmass);
  return Math.abs(zahl(position.menge) - summe) > 0.0005 ? 'abweichend' : 'ausmass';
}

const HERKUNFT_MARKE = {
  ausmass: '<span class="lv-menge-marke">aus Ausmass</span>',
  abweichend: '<span class="lv-menge-marke lv-menge-abweichend">≠ Ausmass</span>',
  rechenweg: '<span class="lv-menge-marke">Rechenweg</span>',
  graben: '<span class="lv-menge-marke">Grabenrechner</span>',
  hand: '',
};

const HERKUNFT_TEXT = {
  ausmass: ' (aus Ausmass)', abweichend: ' (weicht vom Ausmass ab)',
  rechenweg: ' (Rechenweg)', graben: ' (Grabenrechner)', hand: '',
};

// Knopf für die Menge (LV-Ansicht und Editor teilen ihn): Wert gross,
// darunter klein die Herkunft — Antippen öffnet das Ausmass-Fenster.
function mengeKnopfHtml(position, attribut, { gesperrt = false } = {}) {
  const herkunft = mengeHerkunft(position);
  const leer = String(position.menge ?? '').trim() === '';
  const formel = herkunft === 'rechenweg' ? ` · ${position.mengeFormel}` : '';
  return `<button type="button" class="lv-menge-knopf" ${attribut}
      title="${gesperrt ? 'Menge und Ausmass ansehen (gesperrt)' : 'Menge und Ausmass bearbeiten'}${esc(formel)}"
      aria-label="Menge ${leer ? (gesperrt ? 'leer' : 'erfassen') : mengeText(zahl(position.menge))}${HERKUNFT_TEXT[herkunft]} — ${gesperrt ? 'ansehen' : 'Ausmass öffnen'}">
      <span class="lv-menge-wert">${leer ? 'Menge …' : mengeText(zahl(position.menge))}</span>
      ${HERKUNFT_MARKE[herkunft]}
    </button>`;
}

// ---------- Mengen-Fenster ----------
// Ein Fenster für alle Wege (LV-Ansicht, Editor, Sprung von der
// Baustelle): oben die Wahl, wie die Menge entsteht —
//   «Direkt / Rechenweg»: Zahl oder Rechnung tippen,
//   «Ausmass-Zeilen»: Anzahl × Länge × Breite × Höhe, Summe = Menge
//     (mit «Menge von Hand übersteuern»),
//   «Grabenrechner»: Grabenart, Länge, Profil → Aushub/Sand/Auffüllung.
// Gespeichert wird der gewählte Weg; Ausmasszeilen und Grabenangaben
// bleiben als Kalkulationsgrundlage an der Position erhalten.
// onSpeichern(felder) mit { menge, ausmass, mengeVonHand, mengeQuelle,
// mengeFormel, graben } — fehlende Felder werden an der Position entfernt.
// nurLesen: gesperrte Offerte — alles sichtbar, nichts änderbar.
// baustelle: optionales Promise auf { menge, einheit, onOeffnen } —
// zeigt die auf der Baustelle ausgemessene Menge mit Sprung ins Ausmass.
const MENGEN_FELDER = ['ausmass', 'menge', 'mengeVonHand', 'mengeQuelle', 'mengeFormel', 'graben'];

export function wendeMengeAn(position, felder) {
  const neu = { ...position };
  for (const feld of MENGEN_FELDER) {
    const wert = felder[feld];
    if (wert === undefined || wert === null || wert === false || wert === '') {
      if (feld === 'menge') neu.menge = '';
      else if (feld === 'ausmass') neu.ausmass = [];
      else delete neu[feld];
    } else {
      neu[feld] = wert;
    }
  }
  return neu;
}

function startWeg(position) {
  const herkunft = mengeHerkunft(position);
  if (herkunft === 'graben') return 'graben';
  if (herkunft === 'ausmass' || herkunft === 'abweichend') return 'zeilen';
  return 'direkt';
}

const WEGE = [
  ['direkt', 'Direkt / Rechenweg'],
  ['zeilen', 'Ausmass-Zeilen'],
  ['graben', 'Grabenrechner'],
];

function oeffneAusmassFenster({
  titel, untertitel = '', position, speichernText = 'Speichern',
  baustelle = null, nurLesen = false, startMitWeg = null, onSpeichern,
}) {
  const { einheit, ep, ausmass: zeilen, menge, mengeVonHand } = position;
  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  const eh = einheit ? ` ${einheit}` : '';
  const ehKlammer = einheit ? ` [${esc(einheit)}]` : '';
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
      ${nurLesen ? '<span></span>' : `<button type="button" class="knopf zeile-weg"
        data-aktion="az-weg" aria-label="Zeile entfernen">×</button>`}
    </div>`;
  const startZeilen = zeilen?.length ? zeilen : [{}];
  const startSumme = ausmassSumme(zeilen);
  const startVonHand = Boolean(zeilen?.length)
    && (Boolean(mengeVonHand) || Math.abs(zahl(menge) - startSumme) > 0.0005);
  const startDirekt = mengeHerkunft(position) === 'rechenweg'
    ? position.mengeFormel : (menge ?? '');
  let graben = position.graben
    ? JSON.parse(JSON.stringify(position.graben))
    : grabenVorlage('wasser', groesseVorschlag(position.text || titel));
  let grabenBenutzt = Boolean(position.graben);
  let weg = startMitWeg || startWeg(position);

  const teilHtml = (teil, index) => {
    const rohre = (teil.pipes || []).map((r) => `${ROHR_LABELS[r.type] || r.type} d${r.d}`);
    const feldHtml = (name, label, wert) => `<label>${label}<input data-gt="${name}"
      type="number" inputmode="decimal" step="any" value="${esc(wert ?? '')}"></label>`;
    return `
      <div class="graben-teil-kurz" data-rolle="g-teil" data-index="${index}">
        <p class="gruppen-label">${esc(teil.name)}${rohre.length ? ` · ${esc(rohre.join(', '))}` : ''}</p>
        <div class="feld-reihe">
          <label>Profil<select data-gt="profil">
            <option value="u"${teil.profil !== 'v' ? ' selected' : ''}>U-Graben</option>
            <option value="v"${teil.profil === 'v' ? ' selected' : ''}>V-Graben</option>
          </select></label>
          ${feldHtml('B', 'Breite Sohle [m]', teil.B)}
          <span data-rolle="g-oben"${teil.profil === 'v' ? '' : ' hidden'}>${feldHtml('BOben', 'Breite oben [m]', teil.BOben ?? teil.B)}</span>
        </div>
        <div class="feld-reihe">
          ${feldHtml('H', 'Tiefe [m]', teil.H)}
          ${feldHtml('hBett', 'Bettung [m]', teil.hBett)}
          ${feldHtml('hUeber', 'Überdeckung [m]', teil.hUeber)}
        </div>
        <p class="hinweis graben-teil-ergebnis" data-rolle="g-teil-erg"></p>
      </div>`;
  };

  dialog.innerHTML = `
    <form class="karte formular dialog ausmass-dialog" data-rolle="ausmass-fenster"
      aria-label="Menge ${esc(titel)}">
      <h3>Menge · ${esc(titel)}</h3>
      ${untertitel ? `<p class="hinweis">${esc(untertitel)}</p>` : ''}
      ${nurLesen ? `<p class="sperre-hinweis" role="note">🔒 Offerte angenommen · gesperrt —
        nur Ansicht. Für Mengen eine Kopie der Offerte erstellen.</p>` : ''}
      <div class="menge-wege" role="tablist" aria-label="Menge ermitteln">
        ${WEGE.map(([schluessel, label]) => `<button type="button" class="chip-knopf"
          role="tab" data-weg="${schluessel}">${label}</button>`).join('')}
      </div>
      <fieldset class="menge-feldset"${nurLesen ? ' disabled' : ''}>
        <legend class="visually-hidden">Menge erfassen</legend>
        <div data-panel="direkt" role="tabpanel">
          <label>Menge oder Rechenweg${ehKlammer}
            <input data-rolle="direkt-eingabe" inputmode="text" autocomplete="off"
              enterkeyhint="done" spellcheck="false" class="rechenweg-feld"
              placeholder="z. B. 12.5*3 + 4.2*2" value="${esc(startDirekt)}"></label>
          <p class="hinweis">Zahl oder Rechnung mit + − * / und Klammern,
            Dezimal mit Punkt oder Komma. Der Rechenweg bleibt gespeichert.</p>
          <p class="rechenweg-fehler" data-rolle="direkt-fehler" role="alert" hidden></p>
        </div>

        <div data-panel="zeilen" role="tabpanel">
          <p class="hinweis">Anzahl × Länge × Breite × Höhe — leere Felder zählen
            nicht mit. Die Summe wird zur Menge${ehKlammer}.</p>
          <div class="ausmass-editor-kopf" aria-hidden="true">
            <span class="az-kopf-bez">Bezeichnung</span><span>Anz.</span><span>Länge</span>
            <span>Breite</span><span>Höhe</span><span>=</span><span></span>
          </div>
          <div data-rolle="az-liste">${startZeilen.map(zeileHtml).join('')}</div>
          ${nurLesen ? '' : '<button type="button" class="knopf zeile-hinzu" data-aktion="az-neu">+ Ausmasszeile</button>'}
          <div class="ausmass-menge">
            <div class="ausmass-ergebnis summe" data-rolle="summe-zeile"><span>Summe Ausmass</span>
              <span data-rolle="az-summe"></span></div>
            <label class="ausmass-hand" data-rolle="hand-schalter">
              <input type="checkbox" data-rolle="von-hand"${startVonHand ? ' checked' : ''}>
              Menge von Hand übersteuern</label>
            <label data-rolle="menge-feld">Menge${ehKlammer}
              <input data-rolle="menge-eingabe" type="number" inputmode="decimal" step="any"
                value="${esc(menge ?? '')}" placeholder="0"></label>
            <p class="ausmass-abweichung" data-rolle="abweichung" role="status" hidden></p>
          </div>
        </div>

        <div data-panel="graben" role="tabpanel">
          <div class="feld-reihe">
            <label>Grabenart<select data-g="grabenart">
              ${Object.entries(GRABENARTEN).map(([schluessel, art]) => `<option value="${schluessel}"
                ${schluessel === graben.grabenart ? ' selected' : ''}>${esc(art.name)}</option>`).join('')}
            </select></label>
            <label>Länge [m]<input data-g="L" type="number" inputmode="decimal" step="any"
              value="${esc(graben.L ?? '')}" placeholder="0"></label>
          </div>
          <label>Menge aus<select data-g="groesse">
            ${Object.entries(GRABEN_GROESSEN).map(([schluessel, label]) => `<option value="${schluessel}"
              ${schluessel === graben.groesse ? ' selected' : ''}>${label}</option>`).join('')}
          </select></label>
          <div data-rolle="g-teile">${graben.teile.map(teilHtml).join('')}</div>
          <div data-rolle="g-warnungen"></div>
        </div>
      </fieldset>

      <div class="ausmass-menge">
        <div class="ausmass-ergebnis"><span>Menge</span><strong data-rolle="menge-ergebnis"></strong></div>
        <div class="ausmass-ergebnis"><span>Betrag (× EP ${chf(zahl(ep))})</span>
          <strong data-rolle="betrag"></strong></div>
      </div>
      <div data-rolle="baustelle-link"></div>

      <div class="knopfzeile">
        ${nurLesen ? '' : `<button type="submit" class="knopf knopf-primaer">${esc(speichernText)}</button>`}
        <button type="button" class="knopf" data-aktion="zu">${nurLesen ? 'Schliessen' : 'Abbrechen'}</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const formular = dialog.querySelector('form');
  const liste = dialog.querySelector('[data-rolle="az-liste"]');
  const feld = (rolle) => dialog.querySelector(`[data-rolle="${rolle}"]`);
  const vonHand = feld('von-hand');
  const mengeEingabe = feld('menge-eingabe');
  const direktEingabe = feld('direkt-eingabe');
  let geaendert = false;

  function sammle() {
    return [...liste.querySelectorAll('[data-rolle="az"]')].map((block) => {
      const wert = (name) => block.querySelector(`[data-az="${name}"]`).value.trim();
      return { bez: wert('bez'), anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') };
    }).filter((z) => z.bez || z.anzahl || z.laenge || z.breite || z.hoehe);
  }

  function sammleGraben() {
    const g = (name) => dialog.querySelector(`[data-g="${name}"]`).value;
    graben.L = g('L').trim();
    graben.groesse = g('groesse');
    dialog.querySelectorAll('[data-rolle="g-teil"]').forEach((block) => {
      const teil = graben.teile[Number(block.dataset.index)];
      const wert = (name) => block.querySelector(`[data-gt="${name}"]`).value;
      teil.profil = wert('profil');
      for (const name of ['B', 'H', 'hBett', 'hUeber']) teil[name] = zahl(wert(name));
      teil.BOben = teil.profil === 'v' ? zahl(wert('BOben')) : teil.B;
    });
    return graben;
  }

  // Ergebnis des Fensters: was beim Speichern in die Position geht.
  function ergebnis() {
    const ausmass = sammle();
    const grundlage = { ausmass, graben: grabenBenutzt ? sammleGraben() : null };
    if (weg === 'direkt') {
      return { ...grundlage, ...direktErgebnis(direktEingabe.value, ausmass) };
    }
    if (weg === 'graben') {
      const g = sammleGraben();
      return { ...grundlage, graben: g, menge: String(grabenMenge(g)), mengeQuelle: 'graben' };
    }
    const summe = ausmassSumme(ausmass);
    const mitZeilen = ausmass.length > 0;
    const hand = !mitZeilen || vonHand.checked;
    return { ...grundlage, menge: hand ? mengeEingabe.value.trim() : String(summe),
      mengeVonHand: mitZeilen && vonHand.checked };
  }

  function rechneZeilen() {
    liste.querySelectorAll('[data-rolle="az"]').forEach((block) => {
      const wert = (name) => block.querySelector(`[data-az="${name}"]`).value;
      const einzel = ausmassZeileWert({ anzahl: wert('anzahl'), laenge: wert('laenge'),
        breite: wert('breite'), hoehe: wert('hoehe') });
      block.querySelector('[data-rolle="az-wert"]').textContent =
        einzel ? mengeText(Math.round(einzel * 1000) / 1000) : '—';
    });
    const ausmass = sammle();
    const summe = ausmassSumme(ausmass);
    const mitZeilen = ausmass.length > 0;
    const hand = !mitZeilen || vonHand.checked;
    feld('az-summe').textContent = `${mengeText(summe)}${eh}`;
    feld('summe-zeile').hidden = !mitZeilen;
    feld('hand-schalter').hidden = !mitZeilen;
    feld('menge-feld').hidden = !hand;
    const abweichung = feld('abweichung');
    const weichtAb = mitZeilen && hand && Math.abs(zahl(mengeEingabe.value) - summe) > 0.0005;
    abweichung.hidden = !weichtAb;
    abweichung.textContent = weichtAb
      ? `⚠ Menge weicht vom Ausmass ab (Summe ${mengeText(summe)}${eh}) — in der Offerte als «≠ Ausmass» markiert.`
      : '';
  }

  function rechneGraben() {
    const g = sammleGraben();
    const warnungen = [];
    dialog.querySelectorAll('[data-rolle="g-teil"]').forEach((block) => {
      const teil = g.teile[Number(block.dataset.index)];
      const erg = berechneTeil(zahl(g.L), teil);
      block.querySelector('[data-rolle="g-oben"]').hidden = teil.profil !== 'v';
      block.querySelector('[data-rolle="g-teil-erg"]').textContent =
        `Aushub ${mengeText(erg.aushub)} m³ · Sand ${mengeText(erg.sandTotal)} m³ · `
        + `Auffüllung ${mengeText(erg.auffuellung)} m³`;
      warnungen.push(...erg.warnings);
    });
    feld('g-warnungen').innerHTML = warnungen
      .map((w) => `<p class="hinweis wiederhol-warnung">⚠ ${esc(w)}</p>`).join('');
  }

  function rechne() {
    rechneZeilen();
    if (weg === 'graben') rechneGraben();
    dialog.querySelectorAll('[data-weg]').forEach((knopf) => {
      const aktiv = knopf.dataset.weg === weg;
      knopf.classList.toggle('aktiv', aktiv);
      knopf.setAttribute('aria-selected', String(aktiv));
    });
    dialog.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== weg;
    });
    const e = ergebnis();
    const fehlerFeld = feld('direkt-fehler');
    fehlerFeld.hidden = !(weg === 'direkt' && e.fehler);
    fehlerFeld.textContent = weg === 'direkt' && e.fehler ? `⚠ ${e.fehler}` : '';
    direktEingabe.setAttribute('aria-invalid', String(Boolean(e.fehler)));
    const zusatz = {
      direkt: e.mengeQuelle === 'rechenweg' ? ' · Rechenweg' : '',
      zeilen: sammle().length && !vonHand.checked ? ' · aus Ausmass' : '',
      graben: ` · ${(GRABEN_GROESSEN[graben.groesse] || '').split(' (')[0]}`,
    }[weg];
    feld('menge-ergebnis').textContent = e.fehler
      ? '—' : `${mengeText(zahl(e.menge))}${eh}${zusatz}`;
    feld('betrag').textContent = e.fehler ? '—' : chf(zahl(e.menge) * zahl(ep));
    const knopf = formular.querySelector('[type="submit"]');
    if (knopf) knopf.disabled = Boolean(e.fehler);
  }

  const schliesse = () => {
    document.removeEventListener('keydown', taste);
    dialog.remove();
  };
  const abbrechen = () => {
    if (!nurLesen && geaendert && !confirm('Änderungen an der Menge verwerfen?')) return;
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
  formular.addEventListener('change', (wechsel) => {
    if (wechsel.target.dataset.g === 'grabenart') {
      // Neue Grabenart: Teile-Vorlage frisch (Länge und Grösse bleiben).
      const { L, groesse } = sammleGraben();
      graben = { ...grabenVorlage(wechsel.target.value, groesse), L };
      feld('g-teile').innerHTML = graben.teile.map(teilHtml).join('');
      rechne();
    }
  });
  formular.addEventListener('input', (eingabe) => {
    geaendert = true;
    if (eingabe.target.closest('[data-panel="graben"]')) grabenBenutzt = true;
    rechne();
  });
  formular.addEventListener('click', (klick) => {
    const wegKnopf = klick.target.closest('[data-weg]');
    if (wegKnopf) {
      weg = wegKnopf.dataset.weg;
      rechne();
      if (!nurLesen && weg === 'direkt') direktEingabe.select();
      return;
    }
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
    if (nurLesen) return;
    const e = ergebnis();
    if (e.fehler) {
      direktEingabe.focus();
      return;
    }
    const knopf = formular.querySelector('[type="submit"]');
    knopf.disabled = true;
    try {
      const { fehler, ...felder } = e;
      await onSpeichern?.(felder);
      schliesse();
    } catch (fehler) {
      knopf.disabled = false;
      alert(`Speichern fehlgeschlagen: ${fehler.message}`);
    }
  });
  rechne();
  if (!nurLesen && weg === 'direkt') direktEingabe.focus();

  // Verknüpfte Baustelle: dort ausgemessene Menge, Sprung ins Ausmass.
  baustelle?.then((treffer) => {
    if (!treffer || !dialog.isConnected) return;
    const ziel = feld('baustelle-link');
    ziel.innerHTML = `
      <div class="ausmass-baustelle">
        <span>Ausgemessene Menge auf der Baustelle${treffer.ktr ? ` ${esc(treffer.ktr)}` : ''}:
          <strong>${mengeText(zahl(treffer.menge))}${esc(treffer.einheit ? ` ${treffer.einheit}` : '')}</strong></span>
        ${treffer.onOeffnen ? '<button type="button" class="knopf" data-aktion="zur-baustelle">zum Baustellen-Ausmass →</button>' : ''}
      </div>`;
    ziel.querySelector('[data-aktion="zur-baustelle"]')
      ?.addEventListener('click', () => treffer.onOeffnen());
  }).catch(() => {});
  return dialog;
}

// ---------- Verknüpfung Offerte → Baustelle ----------
// Liest nur Dokumente (kein Code aus dem Ausmass-Modul): die Ausmass-
// Position der Baustelle, die aus dieser Offert-Position entstanden ist.
// Neue Baustellen tragen offertId/offertPosNr, die Offerte zielBaustelleId;
// ältere Verknüpfungen (nur «baustelleErstellt») finden die Baustelle über
// das Objekt und die Position über die NPK-Nummer. Eine Kopie findet die
// Baustelle ihres Originals (offertId zeigt auf das Original).
async function baustellenPosition(offerte, position, alleOfferten = []) {
  if (!offerte?.zielBaustelleId && !offerte?.baustelleErstellt) return null;
  const nr = String(position.nr ?? '').trim();
  if (!nr) return null;
  const ids = abstammung(offerte, [offerte, ...alleOfferten]);
  const nummern = alleOfferten.filter((o) => ids.has(o._id)).map((o) => o.nummer)
    .concat(offerte.nummer);
  const baustellen = await abfrage({ typ: 'baustelle' });
  let kandidaten;
  if (offerte.zielBaustelleId) {
    kandidaten = await abfrage({ typ: 'ausmass', baustelleId: offerte.zielBaustelleId });
  } else {
    const alle = await abfrage({ typ: 'ausmass' });
    kandidaten = alle.filter((d) => ids.has(d.offertId));
    if (!kandidaten.length) {
      const passend = baustellen.filter((b) => b.name === offerte.objekt);
      const baustelle = passend.find((b) => nummern.some((n) => String(b.werkvertrag || '')
        .includes(`Offerte ${n}`))) || passend[0];
      if (!baustelle) return null;
      kandidaten = alle.filter((d) => d.baustelleId === baustelle.baustelleId);
    }
  }
  const treffer = kandidaten.find((d) => ids.has(d.offertId) && d.offertPosNr === nr)
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

  // optionen.ziel (von der Shell, Sprung aus dem Baustellen-Ausmass):
  // { offertId, posNr } — öffnet die Arbeitsversion dieser Offerte mit
  // dem Mengen-Fenster der Position.
  render(container, _baustelle, optionen = {}) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="offerten">
        <h2>Offerten</h2>
        <p class="hinweis">Baustellenunabhängig — eine angenommene Offerte wird
          per Klick zur neuen Baustelle; die Positionen gehen als Kopie ins
          Ausmass. Angenommene Offerten sind gesperrt (Vertragsstand) —
          für Mengen eine Kopie erstellen und dort weiterarbeiten.</p>

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
    // Position: sichtbare Felder Nr./Einheit/Text/EP und das Mengenfeld
    // (Zahl oder Rechenweg direkt tippen). Die übrigen Mengenangaben
    // (Ausmasszeilen, Grabenrechner, Quelle) liegen als JSON am Block.
    function mengenStand(block) {
      return JSON.parse(block.dataset.menge || '{}');
    }

    function mengenStatusHtml(stand, fehler = '') {
      if (fehler) return `<span class="rechenweg-fehler">⚠ ${esc(fehler)}</span>`;
      const eh = stand.einheit ? ` ${esc(stand.einheit)}` : '';
      const herkunft = mengeHerkunft(stand);
      if (herkunft === 'rechenweg') return `= ${mengeText(zahl(stand.menge))}${eh} · Rechenweg`;
      if (herkunft === 'graben') {
        return `Grabenrechner · ${esc((GRABEN_GROESSEN[stand.graben.groesse] || '').split(' (')[0])}`;
      }
      if (herkunft === 'ausmass') return `aus Ausmass (${stand.ausmass.length} Zeilen)`;
      if (herkunft === 'abweichend') {
        return `<span class="lv-menge-abweichend">≠ Ausmass (Summe ${mengeText(ausmassSumme(stand.ausmass))}${eh})</span>`;
      }
      return '';
    }

    function mengenEingabeWert(stand) {
      return mengeHerkunft(stand) === 'rechenweg' ? stand.mengeFormel : (stand.menge ?? '');
    }

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
      const stand = {};
      for (const feld of MENGEN_FELDER) if (z[feld] !== undefined) stand[feld] = z[feld];
      stand.ausmass = z.ausmass || [];
      stand.menge = z.menge ?? '';
      return `
        <div class="tab-block lv-block" data-rolle="lv-zeile" data-art="position"
          data-menge="${esc(JSON.stringify(stand))}">
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
              <span class="lv-menge-label">Menge (Zahl oder Rechenweg)</span>
              <div class="menge-eingabe-zeile">
                <input data-o="mengeEingabe" class="rechenweg-feld" inputmode="text"
                  autocomplete="off" spellcheck="false" aria-label="Menge oder Rechenweg"
                  placeholder="z. B. 12.5*3" value="${esc(mengenEingabeWert({ ...stand, einheit: z.einheit }))}">
                <button type="button" class="knopf menge-rechner-knopf" data-aktion="ausmass"
                  aria-label="Menge ermitteln: Ausmass-Zeilen oder Grabenrechner">📐 Ausmass</button>
              </div>
              <span class="menge-status" data-rolle="menge-status" role="status">${mengenStatusHtml({ ...stand, einheit: z.einheit })}</span>
            </div>
            <label>EP [CHF]<input data-o="ep" type="number" inputmode="decimal" step="any"
              value="${esc(z.ep ?? '')}"></label>
          </div>
        </div>`;
    }

    // Mengenfeld im Editor getippt: Zahl oder Rechenweg in den Block-Stand.
    function aktualisiereMengenfeld(block) {
      const stand = mengenStand(block);
      const eingabe = block.querySelector('[data-o="mengeEingabe"]');
      const einheit = block.querySelector('[data-o="einheit"]').value.trim();
      const e = direktErgebnis(eingabe.value, stand.ausmass);
      const status = block.querySelector('[data-rolle="menge-status"]');
      block.dataset.mengeFehler = e.fehler || '';
      eingabe.setAttribute('aria-invalid', String(Boolean(e.fehler)));
      if (e.fehler) {
        status.innerHTML = mengenStatusHtml(stand, e.fehler);
        return;
      }
      // Tippen löst Rechenweg/Grabenrechner als Quelle ab; Ausmasszeilen
      // und Grabenangaben bleiben als Grundlage stehen.
      const neu = wendeMengeAn(stand, {
        ausmass: stand.ausmass, graben: stand.graben, ...e,
      });
      block.dataset.menge = JSON.stringify(neu);
      status.innerHTML = mengenStatusHtml({ ...neu, einheit });
    }

    function sammleOfferte(formular) {
      return {
        nummer: formular.elements.nummer.value.trim(),
        titel: formular.elements.titel.value.trim(),
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
          return wendeMengeAn({
            art: 'position', nr: wert('nr'), text: wert('text'),
            einheit: wert('einheit'), ep: wert('ep'),
          }, mengenStand(block));
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

    async function oeffneFormular(offerte, { hinweis = '' } = {}) {
      if (istGesperrt(offerte)) {
        alert(`Offerte ${offerte.nummer} ist angenommen und gesperrt — bitte eine Kopie erstellen.`);
        return;
      }
      inBearbeitung = offerte || null;
      neuZeile.hidden = true;
      const offerten = await ladeOfferten();
      const jahr = new Date().getFullYear();
      const nummer = offerte?.nummer || naechsteNummer(offerten.map((o) => o.nummer), `O-${jahr}-`);
      const gliederung = offerte ? gliederungVon(offerte) : [{ art: 'position' }];
      const original = offerte?.kopieVon ? offerten.find((o) => o._id === offerte.kopieVon) : null;
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="offert-formular">
          <h3>${offerte ? `Offerte ${esc(offerte.nummer)} bearbeiten` : 'Neue Offerte'}</h3>
          ${hinweis ? `<p class="hinweis kopie-hinweis" role="status">${esc(hinweis)}</p>` : ''}
          ${offerte?.kopieVon ? `<p class="hinweis">Kopie von Offerte ${esc(original?.nummer || '(gelöscht)')}${
            original && istGesperrt(original) ? ' (angenommen · gesperrt)' : ''}</p>` : ''}
          <div class="feld-reihe">
            <label>Nummer *<input name="nummer" required value="${esc(nummer)}" autocomplete="off"></label>
            <label>Status<select name="status">
              ${OFFERT_STATUS.map((s) => `<option${(offerte?.status || 'Entwurf') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></label>
          </div>
          <label>Bezeichnung (Name der Offerte, z. B. für die Ausmass-Version)
            <input name="titel" autocomplete="off" value="${esc(offerte?.titel ?? '')}"
              placeholder="leer = Objekt"></label>
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

    formularBereich.addEventListener('input', (eingabe) => {
      const block = eingabe.target.closest('[data-rolle="lv-zeile"][data-art="position"]');
      if (block && eingabe.target.matches('[data-o="mengeEingabe"], [data-o="einheit"]')) {
        aktualisiereMengenfeld(block);
      }
      aktualisiereZusammenzug();
    });

    formularBereich.addEventListener('click', async (klick) => {
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
        // Menge dieser Position ermitteln — dasselbe Fenster wie in der
        // LV-Ansicht; «Übernehmen» schreibt ins Formular (gespeichert wird
        // mit «Offerte speichern»).
        const block = knopf.closest('[data-rolle="lv-zeile"]');
        const wert = (feld) => block.querySelector(`[data-o="${feld}"]`)?.value.trim() ?? '';
        const stand = mengenStand(block);
        if (block.dataset.mengeFehler) {
          // Ungültiger Rechenweg im Feld: im Fenster weiterbearbeiten.
          stand.mengeQuelle = 'rechenweg';
          stand.mengeFormel = wert('mengeEingabe');
        }
        const position = { ...stand, nr: wert('nr'), text: wert('text'),
          einheit: wert('einheit'), ep: wert('ep') };
        const fenster = oeffneAusmassFenster({
          titel: [wert('nr'), wert('text')].filter(Boolean).join(' · ') || 'Position',
          position,
          startMitWeg: startWeg(position) === 'direkt' ? 'zeilen' : null,
          speichernText: 'Übernehmen',
          baustelle: inBearbeitung
            ? baustellenPosition(inBearbeitung, { nr: wert('nr') }, await ladeOfferten()) : null,
          onSpeichern: (felder) => {
            const neu = wendeMengeAn(stand, felder);
            block.dataset.menge = JSON.stringify(neu);
            block.dataset.mengeFehler = '';
            const eingabe = block.querySelector('[data-o="mengeEingabe"]');
            eingabe.value = mengenEingabeWert(neu);
            eingabe.setAttribute('aria-invalid', 'false');
            block.querySelector('[data-rolle="menge-status"]').innerHTML =
              mengenStatusHtml({ ...neu, einheit: wert('einheit') });
            aktualisiereZusammenzug();
            knopf.focus();
          },
        });
        if (block.dataset.mengeFehler) {
          fenster.querySelector('[data-weg="direkt"]').click();
        }
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      if (abschicken.target.dataset.rolle !== 'offert-formular') return;
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      const fehlerBlock = formular.querySelector('[data-rolle="lv-zeile"][data-menge-fehler]:not([data-menge-fehler=""])');
      if (fehlerBlock) {
        meldung.textContent = `Menge ungültig: ${fehlerBlock.dataset.mengeFehler}`;
        fehlerBlock.querySelector('[data-o="mengeEingabe"]').focus();
        return;
      }
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'offerte', baustelleId: OFFERT_ID };
        delete basis.positionen; // altes flaches Format wird abgelöst
        const neu = { ...basis, ...sammleOfferte(formular) };
        if (!neu.titel) delete neu.titel;
        if (istGesperrt(neu) && !istGesperrt(inBearbeitung)
          && !confirm(`Offerte ${neu.nummer} als angenommen speichern? Danach ist sie `
            + 'gesperrt und lässt sich nicht mehr ändern (nur noch kopieren).')) return;
        await speichereOfferte(neu);
        schliesseFormular();
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    // ---------- Kopie ----------
    // Neue Offerte mit neuer Nummer und eigenem Namen, Status Entwurf,
    // gleiche Positionen, Preise, Mengen und Kalkulationsgrundlagen.
    // Eine Baustellen-Verknüpfung geht mit (die Kopie ist die Arbeits-
    // version für das Ausmass); das Original bleibt unverändert.
    async function erstelleKopie(original) {
      const offerten = await ladeOfferten();
      const vorschlag = `${offertName(original)} · Ausmass`;
      const name = prompt(`Name der Kopie von Offerte ${original.nummer}:`, vorschlag);
      if (name === null) return null;
      const jahr = new Date().getFullYear();
      const kopie = JSON.parse(JSON.stringify(original));
      delete kopie._id;
      delete kopie._rev;
      delete kopie._attachments;
      delete kopie.angenommenAm;
      delete kopie.positionen;
      delete kopie.datum; // die Kopie bekommt ihr eigenes Erfassungsdatum
      const neu = await speichereOfferte({
        ...kopie,
        gliederung: gliederungVon(original).map((z) => ({ ...z })),
        nummer: naechsteNummer(offerten.map((o) => o.nummer), `O-${jahr}-`),
        titel: name.trim() || vorschlag,
        status: 'Entwurf',
        kopieVon: original._id,
        kopieErstelltAm: new Date().toISOString(),
      });
      return neu;
    }

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
            const gesperrt = istGesperrt(o);
            const original = o.kopieVon ? offerten.find((x) => x._id === o.kopieVon) : null;
            const kopien = offerten.filter((x) => x.kopieVon === o._id);
            return `
              <article class="karte offert-karte${gesperrt ? ' offert-gesperrt' : ''}" data-offerte="${esc(o._id)}">
                <div class="rapport-kopf">
                  <strong>${esc(o.nummer)} · ${esc(offertName(o))}</strong>
                  <span class="chip${gesperrt ? ' gewinn chip-gesperrt' : ''}">${gesperrt
                    ? '🔒 angenommen · gesperrt' : esc(o.status)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                      data-id="${esc(o._id)}">PDF</button>
                    ${gesperrt ? '' : `<button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(o._id)}">Bearbeiten</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(o._id)}" aria-label="Offerte löschen">Löschen</button>`}
                  </span>
                </div>
                <p class="hinweis">${esc(o.kunde)}${o.titel ? ` · ${esc(o.objekt)}` : ''} · ${anzahl} Positionen
                  · ${chf(z.inklMwst)} inkl. MwSt.</p>
                ${gesperrt ? `<p class="hinweis">Vertragsstand${o.angenommenAm
                  ? ` seit ${datumText(o.angenommenAm)}` : ''} — nicht mehr änderbar.
                  Mengen in einer Kopie erfassen.</p>` : ''}
                ${o.kopieVon ? `<p class="hinweis">Kopie von Offerte ${esc(original?.nummer || '(gelöscht)')}${
                  o.kopieErstelltAm ? ` vom ${datumText(o.kopieErstelltAm)}` : ''}</p>` : ''}
                ${kopien.length ? `<p class="hinweis">Kopien: ${kopien.map((k) => esc(k.nummer)).join(', ')}</p>` : ''}
                <details class="lv-details"${o._id === offenId ? ' open' : ''}>
                  <summary>Leistungsverzeichnis anzeigen</summary>
                  <div class="tabellen-scroll">${lvTabelleHtml(gliederung, { interaktiv: true, gesperrt })}</div>
                  <p class="hinweis">${gesperrt
                    ? 'Menge antippen zeigt Ausmass und Rechenweg der Position (nur Ansicht).'
                    : 'Menge antippen: direkt tippen, Rechenweg, Ausmass-Zeilen oder Grabenrechner — und direkt speichern.'}</p>
                </details>
                <div class="knopfzeile">
                  ${naechster && !gesperrt ? `<button type="button" class="knopf" data-aktion="weiter"
                    data-id="${esc(o._id)}">Status → ${naechster}</button>` : ''}
                  ${gesperrt && !o.baustelleErstellt ? `
                    <button type="button" class="knopf" data-aktion="baustelle"
                      data-id="${esc(o._id)}">Baustelle erstellen</button>` : ''}
                  <button type="button" class="knopf${gesperrt ? ' knopf-primaer' : ''}" data-aktion="kopie"
                    data-id="${esc(o._id)}">Kopie erstellen</button>
                  ${o.baustelleErstellt ? '<span class="hinweis">↳ Baustelle erstellt ✓</span>' : ''}
                </div>
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch keine Offerten.</p>';
    }

    // Mengen-Fenster einer Position aus der LV-Ansicht — bei gesperrten
    // Offerten nur zur Ansicht, sonst direkt speichern.
    async function oeffnePositionsFenster(offertId, index) {
      const offerten = await ladeOfferten();
      const offerte = offerten.find((o) => o._id === offertId);
      const zeile = offerte && gliederungVon(offerte)[index];
      if (!zeile || zeile.art !== 'position') return null;
      const gesperrt = istGesperrt(offerte);
      return oeffneAusmassFenster({
        titel: [zeile.nr, zeile.text].filter(Boolean).join(' · ') || 'Position',
        untertitel: `Offerte ${offerte.nummer} · ${offertName(offerte)}`,
        position: zeile,
        nurLesen: gesperrt,
        baustelle: baustellenPosition(offerte, zeile, offerten),
        onSpeichern: async (felder) => {
          // Frisch lesen: die Offerte kann inzwischen bearbeitet worden sein.
          const aktuell = (await ladeOfferten()).find((o) => o._id === offertId);
          if (!aktuell) throw new Error('Die Offerte gibt es nicht mehr.');
          const gliederung = gliederungVon(aktuell).map((g) => ({ ...g }));
          const ziel = gliederung[index];
          if (!ziel || ziel.art !== 'position' || ziel.nr !== zeile.nr) {
            throw new Error('Die Offerte wurde inzwischen geändert — bitte neu öffnen.');
          }
          gliederung[index] = wendeMengeAn(ziel, felder);
          const neu = { ...aktuell, gliederung };
          delete neu.positionen; // altes flaches Format wird abgelöst
          await speichereOfferte(neu);
          await zeichneListe({ offenId: offertId });
          listeElement.querySelector(`[data-offerte="${CSS.escape(offertId)}"] `
            + `[data-ausmass-zeige="${index}"]`)?.focus();
        },
      });
    }

    listeElement.addEventListener('click', async (klick) => {
      const mengeKnopf = klick.target.closest('[data-ausmass-zeige]');
      if (mengeKnopf) {
        await oeffnePositionsFenster(mengeKnopf.closest('[data-offerte]').dataset.offerte,
          Number(mengeKnopf.dataset.ausmassZeige));
        return;
      }
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const offerten = await ladeOfferten();
      const offerte = offerten.find((o) => o._id === knopf.dataset.id);
      if (!offerte) return;
      const aktion = knopf.dataset.aktion;
      try {
        if (aktion === 'oeffnen') {
          oeffneFormular(offerte);
        } else if (aktion === 'weiter') {
          const naechster = OFFERT_STATUS[OFFERT_STATUS.indexOf(offerte.status) + 1];
          if (!naechster) return;
          if (naechster === 'angenommen' && !confirm(`Offerte ${offerte.nummer} als angenommen `
            + 'markieren? Danach ist sie gesperrt und lässt sich nicht mehr ändern '
            + '(nur noch kopieren).')) return;
          await speichereOfferte({ ...offerte, status: naechster });
          await zeichneListe();
        } else if (aktion === 'kopie') {
          const kopie = await erstelleKopie(offerte);
          if (!kopie) return;
          await zeichneListe({ offenId: kopie._id });
          await oeffneFormular(kopie, {
            hinweis: `Kopie ${kopie.nummer} erstellt — Name, Mengen und Positionen hier anpassen.`,
          });
        } else if (aktion === 'loeschen') {
          if (istGesperrt(offerte)) return;
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
          await erstelleBaustelle(offerte);
        }
      } catch (fehler) {
        alert(fehler.message);
      }
    });

    // Angenommene Offerte → neue Baustelle. Die Positionen gehen als
    // KOPIE ins Ausmass (dort wird gemessen); die Offerte samt ihrer
    // Kalkulationsgrundlage bleibt unverändert stehen.
    async function erstelleBaustelle(offerte) {
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
      await speichereOfferte({ ...offerte, baustelleErstellt: true,
        zielBaustelleId: neueBaustelle.baustelleId });
      document.dispatchEvent(new CustomEvent('luense:daten'));
      alert(`Baustelle ${ktr.trim()} erstellt — ${positionen.length} `
        + 'Positionen als Ausmass-Kopie übernommen. Die Offerte bleibt unverändert.');
      document.dispatchEvent(new CustomEvent('luense:baustelleWechseln', {
        detail: { baustelleId: neueBaustelle.baustelleId },
      }));
    }

    // ---------- Sprung aus dem Baustellen-Ausmass ----------
    // Ziel ist die Arbeitsversion: die neueste ungesperrte Offerte, die
    // von der verknüpften Offerte abstammt (Kopie) — sonst die Offerte
    // selbst (gesperrt: nur Ansicht, mit Hinweis auf «Kopie erstellen»).
    async function springeZuPosition({ offertId, posNr }) {
      const offerten = await ladeOfferten();
      const familie = offerten.filter((o) => abstammung(o, offerten).has(offertId));
      if (!familie.length) {
        alert('Die verknüpfte Offerte gibt es nicht mehr.');
        return;
      }
      const mitPosition = (o) => gliederungVon(o)
        .some((z) => z.art === 'position' && String(z.nr ?? '').trim() === String(posNr ?? '').trim());
      const arbeit = familie.filter((o) => !istGesperrt(o) && mitPosition(o))
        .sort((a, b) => String(b.kopieErstelltAm || '').localeCompare(String(a.kopieErstelltAm || '')));
      const ziel = arbeit[0] || familie.find((o) => o._id === offertId) || familie[0];
      const index = gliederungVon(ziel)
        .findIndex((z) => z.art === 'position' && String(z.nr ?? '').trim() === String(posNr ?? '').trim());
      await zeichneListe({ offenId: ziel._id });
      const karte = listeElement.querySelector(`[data-offerte="${CSS.escape(ziel._id)}"]`);
      karte?.scrollIntoView({ block: 'start' });
      karte?.classList.add('fokus-karte');
      setTimeout(() => karte?.classList.remove('fokus-karte'), 2500);
      if (index < 0) {
        alert(`Position ${posNr} ist in Offerte ${ziel.nummer} nicht (mehr) vorhanden.`);
        return;
      }
      await oeffnePositionsFenster(ziel._id, index);
    }

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    zeichneKatalog();
    const ziel = optionen?.ziel;
    if (ziel?.offertId) springeZuPosition(ziel);
    else zeichneListe();
  },
};
