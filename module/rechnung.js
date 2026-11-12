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
//
// MWST: «betrag» ist netto (exkl. MWST). Jede neue Rechnung hält den
// MWST-Satz der Firmendaten fest (mwstSatz). Die Rechnung zeigt zuerst
// «Total netto exkl. MWST», dann die MWST-Zeile, zuletzt das Total inkl.
// MWST — dieses ist der geschuldete Betrag (Bildschirm, PDF, QR-Zahlteil,
// Kontoauszug). Alte Rechnungen ohne mwstSatz haben beim Start einmalig
// 8.1 % erhalten (kern/migration.js). Keine Rundung auf 5 Rappen.
// Fehlt in den Firmendaten die MWST-Nr. bei Satz > 0, warnt das Formular
// (blockiert nicht, MWST bleibt).
//
// Mahnwesen (Bauplan 6, Schritt 3): drei Stufen — Zahlungserinnerung,
// 1. Mahnung, 2. Mahnung —, fällig nach Tagen ab RECHNUNGSDATUM (Firmendaten,
// Standard 30/60/75). Die App verschickt nichts: sie zeigt die fällige Stufe
// und hält eine erstellte Stufe an der Rechnung fest:
//   mahnungen: [{ stufe: 1 | 2 | 3, datum, offenRappen (offenes Kapital),
//     zinsBasisRappen, bezahltRappen, zinsBezahltRappen, zinsRappen,
//     zinsVon, zinsBis, zinsProzent, fristTage }]
// Zahlungen decken zuerst den verrechneten Zins (Art. 85 OR).
// Keine Mahngebühr (nach OR nur mit Vertragsabrede). Verzugszins 5 % p. a.
// (Art. 104 Abs. 1 OR) ab der Zahlungserinnerung (gilt als Mahnung nach
// Art. 102 Abs. 1 OR) bis zum Datum der jeweiligen Mahnung, auf dem offenen
// Kapital inkl. MWST (ohne bereits verrechneten Zins), Tage effektiv / 365,
// kaufmännisch auf den Rappen. Der Zins der LETZTEN Mahnung zählt zum
// geschuldeten Betrag (kern/zahlung.js, zinsSollRappen): bezahlt ist die
// Rechnung erst, wenn Kapital und Zins gedeckt sind. Nach der 2. Mahnung
// lässt sich «Betreibung eingeleitet» vermerken (betreibung: { datum,
// nummer, notiz }) — ein reiner Vermerk, ändert keine Beträge.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import {
  RECHNUNG_STATUS, ZAHLUNGSFRIST_TAGE, naechsteRechnungsnummer, heuteTag,
} from '../kern/rechnung.js';
import {
  formatTag, scorAusNummer, formatReferenz, formatIban, offenerBetrag,
  bezahltSumme, rechnungFaellig, zahlungen, rechnungsBetraege, formatSatz,
  offenRappen, plusTage, offenAufteilung, zinsSollRappen, statusNachZahlungen,
  bezahltRappen, skontoRappen,
} from '../kern/zahlung.js';
import { zahlteilSvg, pruefeZahlteil, adresseVollstaendig } from '../kern/qrrechnung.js';
import { oeffneKontoauszug, zeigeZahlungen } from '../kern/bank.js';
import {
  alleBaustellen, ladeFirma, mwstSatzFirma, mwstNrWarnung, mahnFristenFirma,
} from '../kern/stamm.js';
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

// Nach einer Mahnung (Zins kommt dazu) oder ihrer Rücknahme (Zins fällt
// weg) folgt der Status den erfassten Zahlungen: bezahlt nur, wenn Kapital
// und verrechneter Verzugszins auf den Rappen gedeckt sind.
function mitZahlungsStatus(neu, alt) {
  if (!zahlungen(neu).length) return neu;
  const status = statusNachZahlungen(neu);
  if (status === alt.status) return neu;
  const doc = { ...neu, status,
    statusHistorie: [...(alt.statusHistorie || []), { status, datum: heuteTag() }] };
  if (status === 'bezahlt') doc.bezahltAm = heuteTag();
  else delete doc.bezahltAm;
  return doc;
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
    return offenerBetrag({ ...r, status: 'teilbezahlt' }) > 0 ? 'teilbezahlt' : '';
  }
  return RECHNUNG_STATUS[RECHNUNG_STATUS.indexOf(r.status) - 1] || '';
}

// Betrag-Zelle: netto, MWST, zuletzt das Total inkl. MWST (fett).
function betragZelle(r) {
  const b = rechnungsBetraege(r);
  return `<span class="mwst-stapel">
    <small>netto ${chf(b.netto)}</small>
    ${b.satz > 0 ? `<small>MWST ${formatSatz(b.satz)} ${chf(b.mwst)}</small>`
      : '<small>ohne MWST</small>'}
    <b>${chf(b.brutto)}</b></span>`;
}

function tageUeberfaellig(faellig, heute) {
  if (!faellig || faellig >= heute) return 0;
  return Math.round((new Date(`${heute}T12:00:00`) - new Date(`${faellig}T12:00:00`)) / 86400000);
}

// ---------- Mahnwesen ----------
// Stufen in fester Reihenfolge; keine darf übersprungen werden.
const MAHN_STUFEN = ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung'];
const MAHN_ZAHLUNGSFRIST_TAGE = 10;
const VERZUGSZINS_PROZENT = 5; // Art. 104 Abs. 1 OR

// Standardtexte je Stufe — hier anpassen. Platzhalter in geschweiften
// Klammern: {rechnung} {rechnungsdatum} {beglichen} {betrag} {frist}
// {erinnerung} {mahnung1} {firma}. Jeder Eintrag ist ein Absatz. Der Gruss
// steht im PDF nach den Beträgen.
const VERZUG_TEXT = 'Mit unserer Zahlungserinnerung sind Sie in Verzug geraten '
  + '(Art. 102 Abs. 1 OR). Ab diesem Datum ist der Verzugszins von 5 % pro Jahr '
  + 'geschuldet (Art. 104 Abs. 1 OR); er ist unten bis zum Datum dieser Mahnung ausgewiesen.';
const MAHN_GRUSS = 'Freundliche Grüsse\n{firma}';
const MAHN_TEXTE = {
  1: [
    'Sehr geehrte Damen und Herren',
    'Bei der Durchsicht unserer offenen Posten haben wir festgestellt, dass unsere '
      + 'Rechnung {rechnung} vom {rechnungsdatum} {beglichen} ist. Möglicherweise '
      + 'haben Sie die Rechnung übersehen.',
    'Wir bitten Sie freundlich, den offenen Betrag von {betrag} bis zum {frist} '
      + 'mit dem beiliegenden QR-Zahlteil zu überweisen.',
    'Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie '
      + 'diese Erinnerung bitte als gegenstandslos. Für Fragen stehen wir Ihnen gerne '
      + 'zur Verfügung.',
  ],
  2: [
    'Sehr geehrte Damen und Herren',
    'Unsere Rechnung {rechnung} vom {rechnungsdatum} ist trotz unserer '
      + 'Zahlungserinnerung vom {erinnerung} {beglichen}.',
    VERZUG_TEXT,
    'Wir fordern Sie auf, den Betrag von {betrag} einschliesslich Verzugszins '
      + 'bis zum {frist} mit dem beiliegenden QR-Zahlteil zu bezahlen.',
    'Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie '
      + 'diese Mahnung bitte als gegenstandslos.',
  ],
  3: [
    'Sehr geehrte Damen und Herren',
    'Unsere Rechnung {rechnung} vom {rechnungsdatum} ist trotz unserer '
      + 'Zahlungserinnerung vom {erinnerung} und unserer 1. Mahnung vom {mahnung1} '
      + '{beglichen}.',
    VERZUG_TEXT,
    'Wir fordern Sie letztmals auf, den Betrag von {betrag} einschliesslich '
      + 'Verzugszins bis zum {frist} mit dem beiliegenden QR-Zahlteil zu bezahlen.',
    'Geht die Zahlung nicht fristgerecht ein, behalten wir uns weitere Schritte vor, '
      + 'insbesondere die Einleitung der Betreibung.',
    'Haben Sie Einwände gegen die Forderung, bitten wir Sie, sich umgehend mit uns '
      + 'in Verbindung zu setzen. Sollte sich Ihre Zahlung mit diesem Schreiben '
      + 'gekreuzt haben, betrachten Sie diese Mahnung bitte als gegenstandslos.',
  ],
};

function stufenName(stufe) {
  return MAHN_STUFEN[stufe - 1] || '';
}

function tageZwischen(vonIso, bisIso) {
  return Math.round((new Date(`${bisIso}T12:00:00`) - new Date(`${vonIso}T12:00:00`)) / 86400000);
}

export function mahnungenVon(rechnung) {
  return Array.isArray(rechnung?.mahnungen) ? rechnung.mahnungen : [];
}

// Verzugszins in Rappen: offen × Prozent × Tage / (100 × 365), exakt
// (BigInt) und kaufmännisch auf den Rappen gerundet — nie auf 5 Rappen.
// Tage effektiv: vom Datum der Zahlungserinnerung bis zum Mahndatum.
export function verzugszinsRappen(offen, vonIso, bisIso, prozent = VERZUGSZINS_PROZENT) {
  const tage = vonIso && bisIso ? tageZwischen(vonIso, bisIso) : 0;
  if (!(tage > 0) || !(offen > 0)) return 0;
  const satz = BigInt(Math.round(prozent * 10000)); // Prozent × 10'000
  const zaehler = BigInt(offen) * satz * BigInt(tage);
  const nenner = 100n * 10000n * 365n;
  return Number((zaehler * 2n + nenner) / (nenner * 2n));
}

// Mahnstand einer Rechnung am Tag «heute»: letzte erstellte Stufe und die
// fällige Stufe (oder null). Fällig nur für gestellte bzw. teilbezahlte
// Rechnungen mit offenem Betrag, Stufe für Stufe: die nächste Stufe, sobald
// ihre Frist ab Rechnungsdatum erreicht ist UND die Zahlungsfrist der
// vorherigen Stufe (10 Tage) abgelaufen ist. Massgebend ist das offene
// KAPITAL (ohne Verzugszins): ist nur noch Zins offen, wird keine weitere
// Stufe fällig. Nach der 2. Mahnung keine weitere Stufe — dann lässt sich
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

// Neuer Eintrag für die fällige Stufe. Zinsbasis = offenes Kapital nach
// Anrechnung der Zahlungen gemäss Art. 85 OR (zuerst an den verrechneten
// Zins), OHNE den Zins selbst — kein Zinseszins. Verzugszins ab der
// Erinnerung bis heute; er ersetzt den der vorherigen Mahnung
// (zinsSollRappen nimmt immer den letzten) und fällt nie unter den bereits
// verrechneten Zins. Festgehalten wird der Stand NACH dieser Mahnung:
// offenes Kapital (offenRappen), bisher Bezahltes und der davon an den Zins
// angerechnete Teil — Total = offenRappen + zinsRappen − zinsBezahltRappen.
export function neueMahnung(rechnung, stufe, heute = heuteTag()) {
  const basis = offenAufteilung(rechnung).kapital;
  const erinnerung = mahnungenVon(rechnung).find((m) => m.stufe === 1);
  const zinsVon = stufe > 1 && erinnerung ? erinnerung.datum : '';
  const zins = zinsVon
    ? Math.max(verzugszinsRappen(basis, zinsVon, heute), zinsSollRappen(rechnung)) : 0;
  const nachher = offenAufteilung({ ...rechnung,
    mahnungen: [...mahnungenVon(rechnung), { stufe, zinsRappen: zins }] });
  return {
    stufe,
    datum: heute,
    offenRappen: nachher.kapital,
    zinsBasisRappen: basis,
    bezahltRappen: bezahltRappen(rechnung) + skontoRappen(rechnung),
    zinsBezahltRappen: nachher.zinsBezahlt,
    zinsRappen: zins,
    zinsVon,
    zinsBis: zinsVon ? heute : '',
    zinsProzent: zinsVon ? VERZUGSZINS_PROZENT : 0,
    fristTage: MAHN_ZAHLUNGSFRIST_TAGE,
  };
}

// Erste Tabellenspalte: fällige Stufe bzw. Betreibung als Marke, darunter
// die Hauptaktion — so auf dem Handy ohne seitliches Scrollen erreichbar.
function mahnErsteSpalte(rechnung, stand) {
  const id = esc(rechnung._id);
  const betreibung = stand.betreibung && FORDERUNG.includes(rechnung.status);
  return `${stand.faellig ? `<span class="mahn-faellig">${stufenName(stand.faellig)} fällig</span>` : ''}${
    betreibung ? `<span class="mahn-faellig mahn-betreibung">Betreibung eingeleitet</span>` : ''}${
    stand.faellig ? `
    <button type="button" class="knopf mahn-knopf" data-aktion="mahnen"
      data-id="${id}" title="${stufenName(stand.faellig)} festhalten und PDF erstellen">Mahnung erstellen</button>` : ''}${
    stand.betreibungMoeglich ? `
    <button type="button" class="knopf mahn-knopf" data-aktion="betreibung"
      data-id="${id}">Betreibung eingeleitet</button>` : ''}`;
}

// Weitere Mahn-Knöpfe in der Aktionsspalte: PDF erneut, zurücknehmen.
function mahnKnoepfe(rechnung, stand, { mitZuruecknehmen = true } = {}) {
  const id = esc(rechnung._id);
  return `${stand.betreibung && mitZuruecknehmen ? `
    <button type="button" class="knopf eintrag-loeschen" data-aktion="betreibung-zurueck"
      data-id="${id}">Betreibung zurücknehmen</button>` : ''}${
    stand.letzte ? `
    <button type="button" class="knopf eintrag-loeschen" data-aktion="mahn-pdf"
      data-id="${id}">${stufenName(stand.letzte.stufe)} PDF</button>` : ''}${
    stand.letzte && mitZuruecknehmen && !stand.betreibung ? `
    <button type="button" class="knopf eintrag-loeschen" data-aktion="mahn-zurueck"
      data-id="${id}">${stufenName(stand.letzte.stufe)} zurücknehmen</button>` : ''}`;
}

function mahnText(absaetze, werte) {
  return absaetze.map((absatz) => absatz
    .replace(/\{(\w+)\}/g, (_, name) => werte[name] ?? ''));
}

// Verlauf für die Statusspalte: erstellte Stufen und Betreibung mit Datum.
function mahnVerlauf(rechnung) {
  const teile = mahnungenVon(rechnung).map((m) => `${stufenName(m.stufe)} ${formatTag(m.datum)}`);
  const b = rechnung.betreibung;
  if (b) teile.push(`Betreibung ${formatTag(b.datum)}${b.nummer ? ` Nr. ${b.nummer}` : ''}`);
  return teile.length ? `<small class="mahn-verlauf">${esc(teile.join(' → '))}</small>` : '';
}

// Offener Betrag mit Zinsanteil («davon Verzugszins»).
function offenZelle(r) {
  const a = offenAufteilung(r);
  return `${chf(a.offen / 100)}${a.zins ? `<br><small class="hinweis">davon Verzugszins ${chf(a.zins / 100)}</small>` : ''}`;
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

    // Summen in Rappen (exakt): Total inkl. MWST bzw. netto.
    function summe(liste) {
      return liste.reduce((s, r) => s + rechnungsBetraege(r).bruttoRappen, 0) / 100;
    }

    function summeNetto(liste) {
      return liste.reduce((s, r) => s + rechnungsBetraege(r).nettoRappen, 0) / 100;
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
      gesamtElement.textContent = `Beträge inkl. MWST. Offene Forderungen über alle Baustellen: ${chf(summeOffen(forderungen))}`
        + ` (${forderungen.length})${ueberfaellig.length
          ? ` · davon überfällig ${chf(summeOffen(ueberfaellig))} (${ueberfaellig.length})` : ''}`;
    }

    // ---------- Formular ----------
    async function oeffneFormular(rechnung) {
      inBearbeitung = rechnung || null;
      neuZeile.hidden = true;
      const nummer = rechnung?.nummer || await naechsteRechnungsnummer();
      const deb = rechnung?.debitor || { name: baustelle.bauherr || '' };
      // Neue Rechnung: Satz der Firmendaten; bestehende: ihr eigener Satz.
      const firma = await ladeFirma();
      const satz = rechnung ? rechnungsBetraege(rechnung).satz : mwstSatzFirma(firma);
      const warnung = satz > 0 ? mwstNrWarnung(firma) : '';
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
            <label>Betrag netto exkl. MWST [CHF] *<input name="betrag" type="number" required
              inputmode="decimal" step="any" value="${esc(rechnung?.betrag ?? '')}"
              placeholder="0.00"></label>
            <label>Zahlungsfrist [Tage]<input name="zahlungsfrist" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(rechnung?.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE)}"></label>
          </div>
          <div class="mwst-vorschau" data-rolle="mwst-vorschau" data-satz="${esc(satz)}"></div>
          ${warnung ? `<p class="mwst-warnung" role="alert" data-rolle="mwst-nr-warnung">${esc(warnung)}</p>` : ''}
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
      zeigeMwstVorschau(formularBereich.querySelector('form'));
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Zusammenzug im Formular, rechnet beim Tippen mit: netto → MWST → Total.
    function zeigeMwstVorschau(formular) {
      const ziel = formular?.querySelector('[data-rolle="mwst-vorschau"]');
      if (!ziel) return;
      const b = rechnungsBetraege({ betrag: formular.elements.betrag.value, mwstSatz: ziel.dataset.satz });
      ziel.innerHTML = `
        <div><span>Total netto exkl. MWST</span><span>${chf(b.netto)}</span></div>
        <div><span>${b.satz > 0 ? `MWST ${formatSatz(b.satz)}` : 'MWST'}</span><span>${b.satz > 0 ? chf(b.mwst) : 'keine'}</span></div>
        <div class="mwst-total"><span>Total inkl. MWST</span><span>${chf(b.brutto)}</span></div>`;
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
      const fristen = mahnFristenFirma(await ladeFirma());
      tabelleElement.innerHTML = `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Nummer</th><th>Datum</th><th>Titel</th><th>Basis</th>
              <th class="zahl">Betrag</th><th class="zahl">Offen inkl. MWST</th><th>Status</th><th>Zahlbar bis</th><th></th>
            </tr></thead>
            <tbody>
              ${rechnungen.map((r) => {
                const naechster = naechsterStatus(r);
                const vorheriger = vorherigerStatus(r);
                const frist = rechnungFaellig(r);
                const ueberfaellig = FORDERUNG.includes(r.status) && tageUeberfaellig(frist, heute) > 0;
                const anzahlZahlungen = zahlungen(r).length;
                const stand = mahnStand(r, fristen, heute);
                return `
                  <tr>
                    <td class="kein-umbruch mahn-spalte">${esc(r.nummer)}<br>
                      <small class="hinweis">${esc(formatReferenz(referenzVon(r)))}</small>${mahnErsteSpalte(r, stand)}</td>
                    <td class="kein-umbruch">${formatTag(r.tag)}</td>
                    <td class="text-spalte">${esc(r.titel)}</td>
                    <td class="kein-umbruch">${esc(basisText(r.basis))}</td>
                    <td class="zahl">${betragZelle(r)}</td>
                    <td class="zahl">${r.status === 'bezahlt' ? '—' : offenZelle(r)}</td>
                    <td class="status-spalte">${esc(r.status)}${ueberfaellig
                      ? ' <span class="ueberfaellig">überfällig</span>' : ''}${mahnVerlauf(r)}<br>
                      <small class="hinweis">${(r.statusHistorie || [])
                        .map((h) => `${esc(h.status)} ${formatTag(h.datum)}`).join(' → ')}</small></td>
                    <td class="kein-umbruch">${r.status === 'bezahlt' ? `bezahlt ${formatTag(r.bezahltAm) || ''}`.trim() : formatTag(frist)}</td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${mahnKnoepfe(r, stand)}
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
                <td class="zahl"><span class="mwst-stapel"><small>netto ${chf(summeNetto(rechnungen))}</small>
                  <b>${chf(summe(rechnungen))}</b></span></td>
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
      const fristen = mahnFristenFirma(await ladeFirma());
      const forderungen = alle
        .filter((r) => FORDERUNG.includes(r.status))
        .filter((r) => !filterBaustelle || r.baustelleId === filterBaustelle)
        .map((r) => ({
          r,
          faellig: rechnungFaellig(r),
          tage: tageUeberfaellig(rechnungFaellig(r), heute),
          stand: mahnStand(r, fristen, heute),
        }))
        .sort((a, b) => (a.faellig || '').localeCompare(b.faellig || ''));
      const nichtGestellt = alle.filter((r) => r.status === 'offen'
        && (!filterBaustelle || r.baustelleId === filterBaustelle));
      const total = forderungen.reduce((s, f) => s + offenerBetrag(f.r), 0);
      const ueber = forderungen.filter((f) => f.tage > 0);
      const mahnbar = forderungen.filter((f) => f.stand.faellig);
      const mitRechnungen = baustellen.filter((b) => alle.some((r) => r.baustelleId === b.baustelleId));
      kachelnElement.innerHTML = `
        <div class="karte kachel">
          <span class="kachel-titel">Offene Forderungen (${forderungen.length})</span>
          <span class="kachel-wert">${chf(total)}</span>
        </div>
        <div class="karte kachel">
          <span class="kachel-titel">davon überfällig (${ueber.length})</span>
          <span class="kachel-wert ${ueber.length ? 'verlust' : ''}">${chf(ueber.reduce((s, f) => s + offenerBetrag(f.r), 0))}</span>
        </div>
        <div class="karte kachel" data-rolle="kachel-mahnung">
          <span class="kachel-titel">Mahnstufe fällig (${mahnbar.length})</span>
          <span class="kachel-wert ${mahnbar.length ? 'verlust' : ''}">${chf(mahnbar.reduce((s, f) => s + offenerBetrag(f.r), 0))}</span>
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
              <th>Rechnung · fällig</th><th>Baustelle</th><th>Titel</th>
              <th class="zahl">Total inkl. MWST</th><th class="zahl">Offen</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${forderungen.map(({ r, faellig, tage, stand }) => {
                const b = ktr.get(r.baustelleId);
                return `
                  <tr class="${tage > 0 ? 'zeile-ueberfaellig' : ''}">
                    <td class="kein-umbruch mahn-spalte">${esc(r.nummer)}<br>
                      <small class="hinweis">fällig ${formatTag(faellig)}</small>${tage > 0
                      ? `<br><span class="ueberfaellig">${tage} Tag${tage > 1 ? 'e' : ''} überfällig</span>` : ''}${mahnErsteSpalte(r, stand)}</td>
                    <td class="kein-umbruch">${esc(b?.ktr || '—')}<br><small class="hinweis">${esc(b?.name || '')}</small></td>
                    <td class="text-spalte">${esc(r.titel)}</td>
                    <td class="zahl">${chf(rechnungsBetraege(r).brutto)}</td>
                    <td class="zahl"><b>${offenZelle(r)}</b></td>
                    <td class="status-spalte">${esc(r.status)}${mahnVerlauf(r)}</td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${mahnKnoepfe(r, stand, { mitZuruecknehmen: false })}
                      <button type="button" class="knopf eintrag-loeschen"
                      data-aktion="zur-baustelle" data-baustelle="${esc(r.baustelleId)}">Öffnen</button></span></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="4"><b>Total offen (${forderungen.length})</b></td>
                <td class="zahl"><b>${chf(total)}</b></td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hinweis">Beträge inkl. MWST.</p>` : '<p class="hinweis">Keine offenen Forderungen — alles bezahlt.</p>'}`;
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

    // Baustelle einer Rechnung (Offene Posten zeigen auch fremde Baustellen).
    async function baustelleVon(rechnung) {
      if (rechnung.baustelleId === baustelle.baustelleId) return baustelle;
      const alle = await alleBaustellen({ mitArchivierten: true });
      return alle.find((b) => b.baustelleId === rechnung.baustelleId) || baustelle;
    }

    // ---------- Mahn-PDF: Briefkopf wie die Rechnung, QR-Zahlteil ----------
    // Beträge aus dem festgehaltenen Eintrag (Stand am Mahndatum), damit
    // ein späteres Öffnen dasselbe Dokument ergibt.
    async function mahnPdf(rechnung, mahnung) {
      const firma = await ladeFirma();
      const bs = await baustelleVon(rechnung);
      const name = stufenName(mahnung.stufe);
      const referenz = referenzVon(rechnung);
      const b = rechnungsBetraege(rechnung);
      const offenRp = mahnung.offenRappen; // offenes Kapital nach Art. 85 OR
      const zinsRp = mahnung.zinsRappen || 0;
      const zinsBezahltRp = mahnung.zinsBezahltRappen || 0;
      const totalRp = offenRp + zinsRp - zinsBezahltRp;
      const bezahltRp = mahnung.bezahltRappen ?? (b.bruttoRappen - offenRp);
      const basisRp = mahnung.zinsBasisRappen ?? offenRp;
      const fristBis = plusTage(mahnung.datum, mahnung.fristTage ?? MAHN_ZAHLUNGSFRIST_TAGE);
      const frueher = mahnungenVon(rechnung).filter((m) => m.stufe < mahnung.stufe);
      const datumVon = (stufe) => formatTag(frueher.find((m) => m.stufe === stufe)?.datum);
      const deb = rechnung.debitor || {};
      const empfaenger = [deb.name || bs.bauherr, [deb.strasse, deb.hausnummer].filter(Boolean).join(' '),
        [deb.plz, deb.ort].filter(Boolean).join(' ')].filter(Boolean);
      const absender = firma ? [firma.name, [firma.strasse, firma.hausnummer].filter(Boolean).join(' '),
        [firma.plz, firma.ort].filter(Boolean).join(' '),
        [firma.telefon, firma.email].filter(Boolean).join(' · '),
        firma.mwstNr].filter(Boolean) : [];

      const angaben = {
        firma: firma || {},
        debitor: deb,
        betrag: totalRp / 100,
        referenz,
        mitteilung: `${name} zu Rechnung ${rechnung.nummer}`,
        rechnungsNr: rechnung.nummer,
        rechnungsTag: rechnung.tag,
      };
      const maengel = pruefeZahlteil(angaben);
      let svg = '';
      if (!maengel.length) {
        try {
          svg = zahlteilSvg(angaben);
        } catch (fehler) {
          maengel.push(fehler.message);
        }
      }
      meldungElement.textContent = maengel.length ? `PDF ohne QR-Zahlteil: ${maengel.join(' ')}` : '';

      const zinsTage = mahnung.zinsVon ? tageZwischen(mahnung.zinsVon, mahnung.zinsBis) : 0;
      const werte = {
        rechnung: rechnung.nummer,
        rechnungsdatum: formatTag(rechnung.tag),
        beglichen: bezahltRp > 0 ? 'noch nicht vollständig beglichen' : 'noch nicht beglichen',
        betrag: chf(totalRp / 100),
        frist: formatTag(fristBis),
        erinnerung: datumVon(1),
        mahnung1: datumVon(2),
        firma: firma?.name || '',
      };

      zeigeProtokollDruck(bs, {
        titel: `${name} zu Rechnung ${rechnung.nummer}`,
        untertitel: [absender[0] ? `Von: ${absender.join(', ')}` : '',
          `Datum: ${formatTag(mahnung.datum)}`].filter(Boolean).join(' · '),
        abschnitte: [
          { art: 'text', titel: name, absaetze: mahnText(MAHN_TEXTE[mahnung.stufe] || [], werte) },
          { art: 'felder', titel: 'Rechnung', zeilen: [
            ...(empfaenger.length ? [{ label: 'Rechnungsempfänger', wert: empfaenger.join(', ') }] : []),
            { label: 'Rechnungs-Nr.', wert: rechnung.nummer },
            { label: 'Rechnungsdatum', wert: formatTag(rechnung.tag) },
            ...(rechnung.titel ? [{ label: 'Bezeichnung', wert: rechnung.titel }] : []),
            { label: b.satz > 0 ? 'Betrag inkl. MWST' : 'Betrag', wert: chf(b.brutto) },
            { label: 'Bereits bezahlt', wert: chf(bezahltRp / 100) },
            ...(zinsBezahltRp ? [{ label: 'davon an Verzugszins angerechnet (Art. 85 OR)', wert: chf(zinsBezahltRp / 100) }] : []),
            { label: 'Offen (Kapital)', wert: chf(offenRp / 100) },
            ...(frueher.length ? [{ label: 'Bisherige Mahnstufen',
              wert: frueher.map((m) => `${stufenName(m.stufe)} ${formatTag(m.datum)}`).join(', ') }] : []),
          ] },
          { art: 'summen', titel: 'Zu bezahlen', zeilen: [
            { label: 'Offener Rechnungsbetrag', wert: chf(offenRp / 100) },
            ...(mahnung.stufe > 1 ? [{
              label: `Verzugszins ${mahnung.zinsProzent || VERZUGSZINS_PROZENT} % p. a. auf ${chf(basisRp / 100)} `
                + `vom ${formatTag(mahnung.zinsVon)} bis ${formatTag(mahnung.zinsBis)} (${zinsTage} Tag${zinsTage === 1 ? '' : 'e'})`,
              wert: chf(zinsRp / 100),
            }] : []),
            ...(zinsBezahltRp ? [{ label: './. bereits bezahlter Verzugszins', wert: `− ${chf(zinsBezahltRp / 100)}` }] : []),
            { label: 'Total zu bezahlen', wert: chf(totalRp / 100), total: true },
          ] },
          { art: 'felder', titel: 'Zahlung', zeilen: [
            { label: 'Zahlungsfrist', wert: `${mahnung.fristTage ?? MAHN_ZAHLUNGSFRIST_TAGE} Tage` },
            { label: 'Zahlbar bis', wert: formatTag(fristBis) },
            ...(firma?.iban ? [{ label: 'IBAN', wert: formatIban(firma.iban) }] : []),
            { label: 'Referenz', wert: formatReferenz(referenz) },
          ] },
          { art: 'text', titel: '', absaetze: mahnText([MAHN_GRUSS], werte) },
        ].filter(Boolean),
        unterschriften: [],
        zahlteilSvg: svg,
        zahlteilHinweis: `Zahlteil zu ${name} · Rechnung ${rechnung.nummer} · ${bs.ktr} ${bs.name}`,
      });
    }

    // ---------- PDF mit QR-Zahlteil ----------
    async function rechnungsPdf(rechnung) {
      const firma = await ladeFirma();
      const frist = rechnungFaellig(rechnung);
      const referenz = referenzVon(rechnung);
      const b = rechnungsBetraege(rechnung);
      const offen = offenerBetrag(rechnung); // Total inkl. MWST + Verzugszins − Zahlungen
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
            spalten: ['Bezeichnung', 'Basis', 'Betrag exkl. MWST'],
            zeilen: [[rechnung.titel, basisText(rechnung.basis), chf(b.netto)]] },
          // MWST immer zuletzt: netto → MWST → Total inkl. MWST.
          { art: 'summen', titel: 'Rechnungsbetrag', zeilen: b.satz > 0 ? [
            { label: 'Total netto exkl. MWST', wert: chf(b.netto) },
            { label: `MWST ${formatSatz(b.satz)}`, wert: chf(b.mwst) },
            { label: 'Total inkl. MWST', wert: chf(b.brutto), total: true },
          ] : [
            { label: 'Total (ohne MWST)', wert: chf(b.brutto), total: true },
          ] },
          { art: 'felder', titel: 'Zahlung', zeilen: [
            ...(zinsSollRappen(rechnung) ? [{ label: 'Verzugszins (gemäss Mahnung)', wert: chf(zinsSollRappen(rechnung) / 100) }] : []),
            ...(bezahlt || zinsSollRappen(rechnung) ? [{ label: 'Bereits bezahlt', wert: chf(bezahlt) },
              { label: 'Noch offen', wert: chf(offen) }] : []),
            ...(offenAufteilung(rechnung).zins ? [{ label: 'davon Verzugszins', wert: chf(offenAufteilung(rechnung).zins / 100) }] : []),
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

    // Mahnung erstellen (fällige Stufe festhalten + PDF), PDF der letzten
    // Stufe erneut öffnen, letzte Stufe zurücknehmen (Rückgängig).
    async function mahnAktion(aktion, id) {
      const rechnung = (await abfrage({ typ: 'rechnung' })).find((r) => r._id === id);
      if (!rechnung) return;
      const liste = mahnungenVon(rechnung);
      if (aktion === 'mahnen') {
        const stand = mahnStand(rechnung, mahnFristenFirma(await ladeFirma()));
        if (!stand.faellig) return;
        const eintrag = neueMahnung(rechnung, stand.faellig);
        const name = stufenName(eintrag.stufe);
        const zins = eintrag.zinsRappen ? `, Verzugszins ${chf(eintrag.zinsRappen / 100)}${
          eintrag.zinsBezahltRappen ? ` (davon bezahlt ${chf(eintrag.zinsBezahltRappen / 100)})` : ''}` : '';
        if (!confirm(`${name} zu Rechnung ${rechnung.nummer} erstellen?\n`
          + `Offen ${chf(eintrag.offenRappen / 100)}${zins}. Die Stufe wird an der Rechnung festgehalten.`)) return;
        const gespeichert = await put(mitZahlungsStatus({ ...rechnung, mahnungen: [...liste, eintrag] }, rechnung));
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
        await mahnPdf(gespeichert, eintrag);
        meldungElement.textContent = `${name} zu Rechnung ${rechnung.nummer} festgehalten.`
          + (meldungElement.textContent ? ` ${meldungElement.textContent}` : '');
      } else if (aktion === 'mahn-pdf') {
        if (liste.length) await mahnPdf(rechnung, liste[liste.length - 1]);
      } else if (aktion === 'mahn-zurueck') {
        const letzte = liste[liste.length - 1];
        if (!letzte) return;
        const name = stufenName(letzte.stufe);
        if (!confirm(`${name} vom ${formatTag(letzte.datum)} zu Rechnung ${rechnung.nummer} zurücknehmen?`)) return;
        if (rechnung.betreibung) return; // zuerst die Betreibung zurücknehmen
        const neu = await put(mitZahlungsStatus({ ...rechnung, mahnungen: liste.slice(0, -1) }, rechnung));
        meldungElement.textContent = `${name} zu Rechnung ${rechnung.nummer} zurückgenommen.`
          + (neu.status !== rechnung.status ? ` Status → ${neu.status}.` : '');
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'betreibung') {
        if (!mahnStand(rechnung, mahnFristenFirma(await ladeFirma())).betreibungMoeglich) return;
        const angaben = await betreibungDialog(rechnung);
        if (!angaben) return;
        await put({ ...rechnung, betreibung: angaben });
        meldungElement.textContent = `Rechnung ${rechnung.nummer}: Betreibung eingeleitet am ${formatTag(angaben.datum)} vermerkt.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'betreibung-zurueck') {
        if (!rechnung.betreibung) return;
        if (!confirm(`Vermerk «Betreibung eingeleitet» zu Rechnung ${rechnung.nummer} zurücknehmen?`)) return;
        const neu = { ...rechnung };
        delete neu.betreibung;
        await put(neu);
        meldungElement.textContent = `Rechnung ${rechnung.nummer}: Betreibungsvermerk zurückgenommen.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      }
    }

    // Vermerk «Betreibung eingeleitet»: Datum, optional Betreibungs-Nr. und
    // Notiz. Ändert keine Beträge — Zahlungen schliessen die Rechnung normal.
    function betreibungDialog(rechnung) {
      return new Promise((fertig) => {
        const dialog = document.createElement('div');
        dialog.className = 'vollbild dialog-hintergrund';
        dialog.innerHTML = `
          <form class="karte formular dialog" data-rolle="betreibung-formular">
            <h3>Betreibung eingeleitet · Rechnung ${esc(rechnung.nummer)}</h3>
            <p class="hinweis">Nur ein Vermerk an der Rechnung — die Beträge bleiben,
              Zahlungen schliessen die Rechnung wie gewohnt.</p>
            <label>Datum *<input name="datum" type="date" required value="${heuteTag()}"></label>
            <label>Betreibungs-Nr.<input name="nummer" autocomplete="off" placeholder="optional"></label>
            <label>Notiz<input name="notiz" autocomplete="off" placeholder="optional, z. B. Betreibungsamt"></label>
            <div class="knopfzeile">
              <button type="submit" class="knopf knopf-primaer">Vermerk speichern</button>
              <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
            </div>
          </form>`;
        document.body.append(dialog);
        const schliesse = (wert) => { dialog.remove(); fertig(wert); };
        dialog.addEventListener('click', (klick) => {
          if (klick.target === dialog || klick.target.closest('[data-aktion="abbrechen"]')) schliesse(null);
        });
        dialog.querySelector('form').addEventListener('submit', (abschicken) => {
          abschicken.preventDefault();
          const f = abschicken.target.elements;
          schliesse({ datum: f.datum.value || heuteTag(), nummer: f.nummer.value.trim(), notiz: f.notiz.value.trim() });
        });
        dialog.querySelector('[name="datum"]').focus();
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
        const fristen = mahnFristenFirma(await ladeFirma());
        const letzteStufe = (r) => {
          const m = mahnungenVon(r);
          return m.length ? `${stufenName(m[m.length - 1].stufe)} ${formatTag(m[m.length - 1].datum)}` : '';
        };
        const betreibungText = (r) => (r.betreibung ? [formatTag(r.betreibung.datum),
          r.betreibung.nummer ? `Nr. ${r.betreibung.nummer}` : '', r.betreibung.notiz].filter(Boolean).join(' · ') : '');
        exportiereCsv(
          ansicht === 'alle' ? 'luense-offene-forderungen.csv' : `luense-rechnungen-${baustelle.ktr}.csv`,
          ['KTR', 'Nummer', 'Datum', 'Titel', 'Basis', 'Netto exkl. MWST CHF', 'MWST-Satz %',
            'MWST CHF', 'Total inkl. MWST CHF', 'Verzugszins CHF', 'Bezahlt CHF', 'Offen CHF',
            'davon Verzugszins CHF', 'Status', 'Zahlbar bis', 'Mahnstufe', 'Mahnstufe fällig',
            'Betreibung', 'Referenz', 'Statusverlauf'],
          rechnungen.slice().reverse().map((r) => [baustellen.get(r.baustelleId) || '', r.nummer,
            formatTag(r.tag), r.titel, basisText(r.basis), rechnungsBetraege(r).netto,
            rechnungsBetraege(r).satz, rechnungsBetraege(r).mwst, rechnungsBetraege(r).brutto,
            zinsSollRappen(r) / 100, bezahltSumme(r), offenerBetrag(r), offenAufteilung(r).zins / 100, r.status,
            r.status === 'bezahlt' ? '' : formatTag(rechnungFaellig(r)), letzteStufe(r),
            stufenName(mahnStand(r, fristen).faellig), betreibungText(r), referenzVon(r),
            (r.statusHistorie || []).map((h) => `${h.status} ${formatTag(h.datum)}`).join(' → ')]),
        );
      });

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) schliesseFormular();
    });

    formularBereich.addEventListener('input', (eingabe) => {
      if (eingabe.target.name === 'betrag') zeigeMwstVorschau(eingabe.target.form);
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
        // Neue Rechnung: MWST-Satz festhalten. Bestehende behalten ihren
        // (alte ohne Satz bleiben ohne — sie rechnen mit dem Firmensatz).
        if (!inBearbeitung) basis.mwstSatz = mwstSatzFirma(await ladeFirma());
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
      if (['mahnen', 'mahn-pdf', 'mahn-zurueck', 'betreibung', 'betreibung-zurueck'].includes(knopf.dataset.aktion)) {
        await mahnAktion(knopf.dataset.aktion, knopf.dataset.id);
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
