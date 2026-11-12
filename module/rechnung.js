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
import {
  zahlteilSvg, zahlteilElemente, pruefeZahlteil, adresseVollstaendig,
} from '../kern/qrrechnung.js';
import { briefPdf } from '../kern/pdfdatei.js';
import {
  oeffneKontoauszug, zeigeZahlungen, kontoauszugStand, AUSZUG_HOECHSTALTER_TAGE,
} from '../kern/bank.js';
import {
  alleBaustellen, ladeFirma, mwstSatzFirma, mwstNrWarnung, mahnFristenFirma,
} from '../kern/stamm.js';
import { exportiereCsv, ladeHerunter } from '../kern/export.js';
import {
  MAHN_ZAHLUNGSFRIST_TAGE, stufenName, tageZwischen, mahnungenVon, mahnStand,
  zeichneMahnHinweis, nichtVersendet,
} from '../kern/mahnung.js';
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

// E-Mail-Adresse des Rechnungsempfängers (für den Mahnversand): bewusst
// einfache Prüfung, ein @, ein Punkt in der Domain, keine Leerzeichen.
export function istEmail(text) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/.test(String(text ?? '').trim());
}

const EMAIL_FEHLER = 'E-Mail-Adresse ungültig, bitte im Format name@firma.ch eingeben.';

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
// Stufen, Mahnstand und fällige Stufen: kern/mahnung.js (auch die Shell
// braucht sie für den Hinweis «Heute fällig»).
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

// Mail zur Mahnung (Betreff und kurzer Text, das PDF hängt an). Platzhalter
// wie oben. Kurz und höflich, je Stufe etwas bestimmter.
const MAIL_TEXTE = {
  1: [
    'Sehr geehrte Damen und Herren',
    'Unsere Rechnung {rechnung} vom {rechnungsdatum} ist bei uns noch offen. '
      + 'Im Anhang finden Sie die Zahlungserinnerung mit dem QR-Zahlteil.',
    'Wir bitten Sie freundlich, den Betrag von {betrag} bis zum {frist} zu überweisen. '
      + 'Sollte sich Ihre Zahlung mit dieser Nachricht gekreuzt haben, betrachten Sie sie bitte als gegenstandslos.',
  ],
  2: [
    'Sehr geehrte Damen und Herren',
    'Unsere Rechnung {rechnung} vom {rechnungsdatum} ist trotz unserer Zahlungserinnerung '
      + 'noch offen. Im Anhang finden Sie unsere 1. Mahnung mit dem QR-Zahlteil.',
    'Bitte überweisen Sie den Betrag von {betrag} einschliesslich Verzugszins bis zum {frist}. '
      + 'Sollte sich Ihre Zahlung mit dieser Nachricht gekreuzt haben, betrachten Sie sie bitte als gegenstandslos.',
  ],
  3: [
    'Sehr geehrte Damen und Herren',
    'Unsere Rechnung {rechnung} vom {rechnungsdatum} ist trotz Zahlungserinnerung und '
      + '1. Mahnung noch offen. Im Anhang finden Sie unsere 2. Mahnung mit dem QR-Zahlteil.',
    'Wir bitten Sie letztmals, den Betrag von {betrag} einschliesslich Verzugszins bis zum {frist} '
      + 'zu überweisen. Geht die Zahlung nicht fristgerecht ein, behalten wir uns die Einleitung '
      + 'der Betreibung vor.',
  ],
};

// Für bestehende Tests und Werkzeuge weiterhin hier erreichbar.
export { mahnStand, mahnungenVon };

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
  return `${stand.nichtVersendet ? `
    <span class="mahn-faellig mahn-unversendet">${stufenName(stand.letzte.stufe)} noch nicht versendet</span>
    <button type="button" class="knopf mahn-knopf" data-aktion="erneut-senden"
      data-id="${id}">Erneut senden</button>
    <button type="button" class="knopf mahn-knopf mahn-knopf-neben" data-aktion="als-versendet"
      data-id="${id}">Als versendet markieren</button>` : ''}${
    stand.faellig ? `<span class="mahn-faellig">${stufenName(stand.faellig)} fällig</span>` : ''}${
    betreibung ? `<span class="mahn-faellig mahn-betreibung">Betreibung eingeleitet</span>` : ''}${
    stand.faellig ? `
    <button type="button" class="knopf mahn-knopf" data-aktion="senden"
      data-id="${id}" title="${stufenName(stand.faellig)} festhalten, PDF erstellen und ans Mail-Programm geben">Erstellen und senden</button>` : ''}${
    stand.betreibungMoeglich ? `
    <button type="button" class="knopf mahn-knopf" data-aktion="betreibung"
      data-id="${id}">Betreibung eingeleitet</button>` : ''}`;
}

// Weitere Mahn-Knöpfe in der Aktionsspalte: PDF erneut, zurücknehmen.
function mahnKnoepfe(rechnung, stand, { mitZuruecknehmen = true } = {}) {
  const id = esc(rechnung._id);
  const offen = FORDERUNG.includes(rechnung.status);
  return `${stand.faellig ? `
    <button type="button" class="knopf eintrag-loeschen" data-aktion="mahnen" data-id="${id}"
      title="${stufenName(stand.faellig)} festhalten und Druckansicht öffnen, ohne Mail">Nur erstellen (Druck)</button>` : ''}${
    stand.letzte && offen && !stand.letzte.versendetAm && !stand.nichtVersendet ? `
    <button type="button" class="knopf eintrag-loeschen" data-aktion="erneut-senden"
      data-id="${id}">${stufenName(stand.letzte.stufe)} per Mail</button>` : ''}${
    stand.betreibung && mitZuruecknehmen ? `
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
  const teile = mahnungenVon(rechnung).map((m) => `${stufenName(m.stufe)} ${formatTag(m.datum)}${
    m.versendetAm ? ` (versendet ${formatTag(m.versendetAm)})` : ''}`);
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

  render(container, baustelle, { ziel = null } = {}) {
    let inBearbeitung = null;
    let ansicht = 'baustelle';
    try {
      ansicht = localStorage.getItem(ANSICHT_MERKER) === 'alle' ? 'alle' : 'baustelle';
    } catch { /* ohne Speicher: Standardansicht */ }
    let filterBaustelle = '';
    // Offene Posten nur mit fälliger oder noch nicht versendeter Mahnstufe
    // (Sprung aus dem Hinweis «Heute fällig»).
    let nurFaellig = false;
    if (ziel?.ansicht === 'faellig') {
      ansicht = 'alle';
      nurFaellig = true;
    }

    container.innerHTML = `
      <section class="rechnungen">
        <h2>Rechnungen · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="chips ansicht-wahl" role="tablist">
          <button type="button" class="chip chip-knopf" data-ansicht="baustelle" role="tab">Diese Baustelle</button>
          <button type="button" class="chip chip-knopf" data-ansicht="alle" role="tab">Offene Posten alle Baustellen</button>
        </div>

        <div data-rolle="mahn-hinweis" hidden></div>
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
    const mahnHinweisElement = container.querySelector('[data-rolle="mahn-hinweis"]');

    // Hinweis «Heute fällig: …» über alle Baustellen; Antippen zeigt die
    // Offenen Posten mit den fälligen Stufen.
    function zeichneMahnHinweisHier() {
      return zeichneMahnHinweis(mahnHinweisElement, {
        mitBeispiel: !!baustelle.demo,
        onOeffnen: () => {
          ansicht = 'alle';
          nurFaellig = true;
          filterBaustelle = '';
          try { localStorage.setItem(ANSICHT_MERKER, ansicht); } catch { /* egal */ }
          zeichneTabelle();
        },
      });
    }

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
        ...(teil.length ? [{ titel: 'teilbezahlt, Rest', liste: teil, wert: summeOffen }] : []),
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
      let deb = rechnung?.debitor || { name: baustelle.bauherr || '' };
      // Neue Rechnung: ganze Rechnungsadresse inkl. E-Mail von der letzten
      // Rechnung dieser Baustelle (Entscheid Tobias). Hat jene keine
      // E-Mail, kommt sie von der letzten Rechnung mit E-Mail.
      if (!rechnung) {
        const neuste = (liste) => liste
          .sort((a, b) => `${b.tag || ''}${b.nummer || ''}`.localeCompare(`${a.tag || ''}${a.nummer || ''}`))[0];
        const alle = await ladeRechnungen();
        const mitAdresse = neuste(alle.filter((r) => r.debitor
          && ['name', 'strasse', 'plz', 'ort', 'email'].some((feld) => String(r.debitor[feld] ?? '').trim())));
        if (mitAdresse) deb = { ...mitAdresse.debitor, name: mitAdresse.debitor.name || deb.name };
        if (!deb.email) deb.email = neuste(alle.filter((r) => r.debitor?.email))?.debitor.email || '';
      }
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
            <label>E-Mail (für Zahlungserinnerung und Mahnung)<input name="debEmail" type="text"
              inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"
              value="${esc(deb.email ?? '')}" placeholder="z. B. buchhaltung@kunde.ch"></label>
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
              (zum Ausfüllen von Hand), das ist zulässig.</p>
          </details>
          ${rechnung?.basis && rechnung.basis.art !== 'manuell' ? `
            <p class="hinweis">Basis: ${esc(basisText(rechnung.basis))}, bleibt verknüpft.</p>` : ''}
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
          + 'Rechnungen entstehen hier, oder direkt aus unterschriebenen '
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
                    <td class="zahl">${r.status === 'bezahlt' ? '-' : offenZelle(r)}</td>
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
        .filter((f) => !nurFaellig || f.stand.faellig || f.stand.nichtVersendet)
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
        <div class="chips">
          <button type="button" class="chip chip-knopf${nurFaellig ? ' aktiv' : ''}" data-aktion="nur-faellig"
            aria-pressed="${nurFaellig}">Nur fällige Mahnstufen</button>
        </div>
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
                    <td class="kein-umbruch">${esc(b?.ktr || '-')}<br><small class="hinweis">${esc(b?.name || '')}</small></td>
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
        <p class="hinweis">Beträge inkl. MWST.</p>` : `<p class="hinweis">${nurFaellig
          ? 'Keine fällige Mahnstufe.' : 'Keine offenen Forderungen, alles bezahlt.'}</p>`}`;
    }

    async function zeichneTabelle() {
      container.querySelectorAll('[data-ansicht]').forEach((k) => {
        k.classList.toggle('aktiv', k.dataset.ansicht === ansicht);
        k.setAttribute('aria-selected', String(k.dataset.ansicht === ansicht));
      });
      neuKnopf.hidden = ansicht === 'alle';
      zeichneMahnHinweisHier();
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
    // mahnBrief: gemeinsame Angaben für die Druckansicht (mahnPdf) und die
    // PDF-Datei für den Mail-Versand (mahnPdfDatei).
    async function mahnBrief(rechnung, mahnung) {
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
      let zahlteil = null;
      if (!maengel.length) {
        try {
          svg = zahlteilSvg(angaben);
          zahlteil = zahlteilElemente(angaben);
        } catch (fehler) {
          maengel.push(fehler.message);
        }
      }

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

      return { bs, firma, name, maengel, svg, zahlteil, absender, empfaenger,
        titel: `${name} zu Rechnung ${rechnung.nummer}`,
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
        zahlteilHinweis: `Zahlteil zu ${name} · Rechnung ${rechnung.nummer} · ${bs.ktr} ${bs.name}`,
      };
    }

    async function mahnPdf(rechnung, mahnung) {
      const brief = await mahnBrief(rechnung, mahnung);
      meldungElement.textContent = brief.maengel.length ? `PDF ohne QR-Zahlteil: ${brief.maengel.join(' ')}` : '';
      zeigeProtokollDruck(brief.bs, {
        titel: brief.titel,
        untertitel: [brief.absender[0] ? `Von: ${brief.absender.join(', ')}` : '',
          `Datum: ${formatTag(mahnung.datum)}`].filter(Boolean).join(' · '),
        abschnitte: brief.abschnitte,
        unterschriften: [],
        zahlteilSvg: brief.svg,
        zahlteilHinweis: brief.zahlteilHinweis,
      });
    }

    // Mahnung als PDF-Datei (Mail-Anhang): Briefkopf, Empfänger im Fenster,
    // Text und Beträge wie in der Druckansicht, QR-Zahlteil als Vektorgrafik.
    async function mahnPdfDatei(rechnung, mahnung) {
      const brief = await mahnBrief(rechnung, mahnung);
      const blob = briefPdf({
        titel: brief.titel,
        absender: brief.absender,
        empfaenger: brief.empfaenger,
        ortDatum: [brief.firma?.ort, formatTag(mahnung.datum)].filter(Boolean).join(', '),
        abschnitte: brief.abschnitte,
        zahlteil: brief.zahlteil,
        zahlteilEigeneSeite: true, // Entscheid Tobias: Zahlteil immer auf eigener Seite
        zahlteilHinweis: brief.zahlteilHinweis,
      });
      const dateiname = `${brief.name.replace(/\. /g, '-').replace(/\s+/g, '-')}-${rechnung.nummer}.pdf`
        .replace(/[^A-Za-z0-9._-]/g, '');
      return { datei: new File([blob], dateiname, { type: 'application/pdf' }), maengel: brief.maengel, brief };
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

    // ---------- Versand per Mail (halbautomatisch) ----------
    // Die App verschickt selbst nichts (kein Server). «Erstellen und senden»
    // hält die Stufe fest, erstellt die PDF-Datei und gibt sie ans
    // Mail-Programm: auf dem Handy über den Teilen-Dialog (Web Share API mit
    // Datei, Betreff und Text), wo das nicht geht (Laptop) als Download plus
    // mailto-Link mit Empfänger, Betreff und Text; das PDF dann von Hand
    // anhängen. Versendet gilt eine Stufe, wenn das Teilen geklappt hat oder
    // sie von Hand «als versendet markiert» wird (versendetAm).

    function mailVorlage(rechnung, mahnung, firma) {
      const totalRp = mahnung.offenRappen + (mahnung.zinsRappen || 0) - (mahnung.zinsBezahltRappen || 0);
      const werte = {
        rechnung: rechnung.nummer,
        rechnungsdatum: formatTag(rechnung.tag),
        betrag: chf(totalRp / 100),
        frist: formatTag(plusTage(mahnung.datum, mahnung.fristTage ?? MAHN_ZAHLUNGSFRIST_TAGE)),
        firma: firma?.name || '',
      };
      return {
        betreff: `${stufenName(mahnung.stufe)} Rechnung ${rechnung.nummer}`,
        text: [...mahnText(MAIL_TEXTE[mahnung.stufe] || MAIL_TEXTE[1], werte),
          mahnText([MAHN_GRUSS], werte)[0]].join('\n\n').trim(),
      };
    }

    function kannDateiTeilen() {
      try {
        return !!navigator.canShare?.({ files: [new File(['%PDF'], 'test.pdf', { type: 'application/pdf' })] });
      } catch {
        return false;
      }
    }

    // Übergabe ans Mail-Programm: 'geteilt' | 'abgebrochen' | 'mailto'.
    async function uebergebeMail({ datei, email, betreff, text }) {
      if (navigator.canShare?.({ files: [datei] })) {
        try {
          await navigator.share({ files: [datei], title: betreff, text });
          return 'geteilt';
        } catch (fehler) {
          if (fehler?.name === 'AbortError') return 'abgebrochen';
          // anderer Fehler: wie am Laptop weiter
        }
      }
      ladeHerunter(datei);
      const link = document.createElement('a');
      link.href = `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${
        encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
      link.click();
      return 'mailto';
    }

    // Vorschlag für eine fehlende E-Mail: letzte Rechnung derselben Baustelle.
    async function emailVorschlag(rechnung) {
      const alle = await abfrage({ typ: 'rechnung', baustelleId: rechnung.baustelleId });
      return alle.filter((r) => r.debitor?.email && r._id !== rechnung._id)
        .sort((a, b) => `${b.tag || ''}${b.nummer || ''}`.localeCompare(`${a.tag || ''}${a.nummer || ''}`))[0]
        ?.debitor.email || '';
    }

    // Dialog vor dem Senden: Empfänger (Pflicht, wird an der Rechnung
    // gespeichert), Betreff und Text (anpassbar, nur für diese Mail).
    // Liefert { email, betreff, text } oder null (abgebrochen).
    function sendeDialog({ rechnung, mahnung, neu, firma, vorschlag }) {
      const vorlage = mailVorlage(rechnung, mahnung, firma);
      const vorhanden = rechnung.debitor?.email || '';
      const teilen = kannDateiTeilen();
      const name = stufenName(mahnung.stufe);
      const totalRp = mahnung.offenRappen + (mahnung.zinsRappen || 0) - (mahnung.zinsBezahltRappen || 0);
      return new Promise((fertig) => {
        const dialog = document.createElement('div');
        dialog.className = 'vollbild dialog-hintergrund';
        dialog.innerHTML = `
          <form class="karte formular dialog" data-rolle="senden-formular" novalidate>
            <h3>${esc(name)} senden · Rechnung ${esc(rechnung.nummer)}</h3>
            <p class="hinweis">Zu bezahlen ${chf(totalRp / 100)}${mahnung.zinsRappen
              ? ` (inkl. Verzugszins ${chf(mahnung.zinsRappen / 100)})` : ''}. ${neu
              ? `Die ${esc(name)} wird an der Rechnung festgehalten, das PDF geht an Ihr Mail-Programm.`
              : `Die ${esc(name)} vom ${formatTag(mahnung.datum)} ist schon festgehalten, das PDF geht nochmals an Ihr Mail-Programm.`}</p>
            <label>E-Mail Empfänger *<input name="email" type="text" inputmode="email"
              autocomplete="off" autocapitalize="off" spellcheck="false"
              value="${esc(vorhanden || vorschlag)}" placeholder="z. B. buchhaltung@kunde.ch"></label>
            ${vorhanden ? '' : `<p class="hinweis" data-rolle="email-fehlt">An der Rechnung fehlt die
              E-Mail-Adresse${vorschlag ? ' (Vorschlag aus der letzten Rechnung dieser Baustelle)' : ''}.
              Sie wird beim Senden an der Rechnung gespeichert.</p>`}
            <label>Betreff<input name="betreff" autocomplete="off" value="${esc(vorlage.betreff)}"></label>
            <label>Text<textarea name="text" rows="9">${esc(vorlage.text)}</textarea></label>
            <p class="hinweis" data-rolle="versand-weg">${teilen
              ? 'Das Teilen-Menü öffnet sich: dort das Mail-Programm wählen. Die Empfängeradresse kommt in die Zwischenablage, in der Mail-App ins Feld An einfügen.'
              : 'Dieses Gerät kann das PDF nicht direkt ans Mail-Programm geben: Das PDF wird heruntergeladen und eine neue Mail geöffnet. Bitte das PDF dort von Hand anhängen.'}</p>
            <div class="knopfzeile">
              <button type="submit" class="knopf knopf-primaer">${neu ? 'Erstellen und senden' : 'Erneut senden'}</button>
              <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
            </div>
            <p class="meldung" role="status"></p>
          </form>`;
        document.body.append(dialog);
        const schliesse = (wert) => { dialog.remove(); fertig(wert); };
        dialog.addEventListener('click', (klick) => {
          if (klick.target === dialog || klick.target.closest('[data-aktion="abbrechen"]')) schliesse(null);
        });
        const formular = dialog.querySelector('form');
        formular.addEventListener('submit', (abschicken) => {
          abschicken.preventDefault();
          const f = formular.elements;
          const email = f.email.value.trim();
          if (!istEmail(email)) {
            formular.querySelector('.meldung').textContent = email
              ? EMAIL_FEHLER : 'Bitte die E-Mail-Adresse des Rechnungsempfängers eingeben.';
            f.email.focus();
            return;
          }
          // Adresse im selben Tipp-Ereignis in die Zwischenablage: das
          // Teilen-Menü kann den Empfänger nicht vorbelegen. Fehler still.
          let kopiert = Promise.resolve(false);
          if (teilen) {
            try {
              kopiert = navigator.clipboard.writeText(email).then(() => true, () => false);
            } catch { /* ohne Zwischenablage */ }
          }
          schliesse({ email, betreff: f.betreff.value.trim() || vorlage.betreff, text: f.text.value, kopiert });
        });
        formular.elements.email.focus();
      });
    }

    // Auswahl mit mehreren Knöpfen; liefert den Schlüssel oder null.
    function auswahlDialog({ titel, text, hinweis = '', knoepfe }) {
      return new Promise((fertig) => {
        const dialog = document.createElement('div');
        dialog.className = 'vollbild dialog-hintergrund';
        dialog.innerHTML = `
          <div class="karte formular dialog" role="alertdialog" aria-label="${esc(titel)}" data-rolle="auswahl-dialog">
            <h3>${esc(titel)}</h3>
            <p class="mwst-warnung">${esc(text)}</p>
            ${hinweis ? `<p class="hinweis">${esc(hinweis)}</p>` : ''}
            <div class="knopfzeile">
              ${knoepfe.map(([wert, beschriftung, primaer]) => `<button type="button"
                class="knopf${primaer ? ' knopf-primaer' : ''}" data-wahl="${esc(wert)}">${esc(beschriftung)}</button>`).join('')}
            </div>
          </div>`;
        document.body.append(dialog);
        dialog.addEventListener('click', (klick) => {
          const knopf = klick.target.closest('[data-wahl]');
          if (klick.target !== dialog && !knopf) return;
          dialog.remove();
          fertig(knopf ? knopf.dataset.wahl : null);
        });
        dialog.querySelector('[data-wahl]').focus();
      });
    }

    // Prüfung vor dem Mahnen: sind die Zahlungen aktuell verbucht?
    // true = weiter, false = abbrechen (oder zuerst Kontoauszug einlesen).
    async function bankStandGeprueft() {
      const stand = await kontoauszugStand();
      if (!stand.veraltet) return true;
      const wahl = await auswahlDialog({
        titel: 'Zahlungen aktuell?',
        text: stand.tag
          ? `Letzter Kontoauszug vom ${formatTag(stand.tag)}. Bitte zuerst einen aktuellen Auszug einlesen, damit niemand gemahnt wird, der schon bezahlt hat.`
          : 'Noch nie ein Kontoauszug eingelesen. Bitte zuerst einen aktuellen Auszug einlesen, damit niemand gemahnt wird, der schon bezahlt hat.',
        hinweis: `Massgebend ist der Stand der Bankdaten (Ende des Auszugs), höchstens ${AUSZUG_HOECHSTALTER_TAGE} Tage alt.`,
        knoepfe: [['einlesen', 'Kontoauszug einlesen', true], ['trotzdem', 'Trotzdem mahnen'], ['abbrechen', 'Abbrechen']],
      });
      if (wahl === 'einlesen') {
        oeffneKontoauszug({
          richtung: 'CRDT',
          nachBuchung: async (text) => {
            await zeichneTabelle();
            meldungElement.textContent = `${text} Die fälligen Stufen sind neu berechnet, bitte nochmals prüfen.`;
          },
        });
        return false;
      }
      return wahl === 'trotzdem';
    }

    // Letzte Stufe einer Rechnung mit Änderungen speichern (frisch gelesen).
    async function aendereLetzteStufe(id, aenderung) {
      const aktuell = (await abfrage({ typ: 'rechnung' })).find((r) => r._id === id);
      const liste = mahnungenVon(aktuell);
      if (!liste.length) return aktuell;
      return put({ ...aktuell, mahnungen: [...liste.slice(0, -1), { ...liste[liste.length - 1], ...aenderung }] });
    }

    // Senden: neue Stufe (neu = true) oder die letzte Stufe nochmals.
    async function sende(rechnung, { neu }) {
      const liste = mahnungenVon(rechnung);
      let eintrag;
      if (neu) {
        const stand = mahnStand(rechnung, mahnFristenFirma(await ladeFirma()));
        if (!stand.faellig) return;
        if (!await bankStandGeprueft()) return;
        eintrag = neueMahnung(rechnung, stand.faellig);
      } else {
        eintrag = liste[liste.length - 1];
        if (!eintrag) return;
        if (!await bankStandGeprueft()) return;
      }
      const name = stufenName(eintrag.stufe);
      const vorschau = neu ? { ...rechnung, mahnungen: [...liste, eintrag] } : rechnung;
      const firma = await ladeFirma();
      // PDF vorher bauen: das Teilen muss gleich nach dem Antippen folgen.
      const { datei, maengel } = await mahnPdfDatei(vorschau, eintrag);
      const angaben = await sendeDialog({
        rechnung, mahnung: eintrag, neu, firma,
        vorschlag: rechnung.debitor?.email ? '' : await emailVorschlag(rechnung),
      });
      if (!angaben) return;
      const debitor = { ...(rechnung.debitor || {}), email: angaben.email };
      const versand = { versandAn: angaben.email };
      let gespeichert;
      if (neu) {
        gespeichert = await put(mitZahlungsStatus({ ...rechnung, debitor,
          mahnungen: [...liste, { ...eintrag, ...versand }] }, rechnung));
      } else {
        gespeichert = await put({ ...rechnung, debitor,
          mahnungen: [...liste.slice(0, -1), { ...eintrag, ...versand }] });
      }
      const ergebnis = await uebergebeMail({ datei, ...angaben });
      const kopiert = ergebnis !== 'mailto' && await angaben.kopiert;
      if (ergebnis === 'geteilt') {
        await aendereLetzteStufe(gespeichert._id, { versendetAm: heuteTag(), versandWeg: 'teilen' });
      } else if (ergebnis === 'mailto') {
        await aendereLetzteStufe(gespeichert._id, { versandWeg: 'mailto' });
      }
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await zeichneTabelle();
      const qr = maengel.length ? ` PDF ohne QR-Zahlteil: ${maengel.join(' ')}` : '';
      meldungElement.textContent = ({
        geteilt: `${name} zu Rechnung ${rechnung.nummer} ans Mail-Programm übergeben und als versendet vermerkt.`,
        abgebrochen: `Teilen abgebrochen: ${name} zu Rechnung ${rechnung.nummer} ist festgehalten, aber noch nicht versendet. «Erneut senden» in der Zeile.`,
        mailto: `${name} zu Rechnung ${rechnung.nummer}: PDF «${datei.name}» heruntergeladen und neue Mail an ${angaben.email} geöffnet. `
          + 'Bitte das PDF von Hand anhängen und nach dem Senden «Als versendet markieren».',
      })[ergebnis] + qr + (kopiert ? ` Adresse kopiert: ${angaben.email}. In der Mail-App ins Feld An einfügen.` : '');
    }

    // Mahnung erstellen (fällige Stufe festhalten + PDF), PDF der letzten
    // Stufe erneut öffnen, letzte Stufe zurücknehmen (Rückgängig).
    async function mahnAktion(aktion, id) {
      const rechnung = (await abfrage({ typ: 'rechnung' })).find((r) => r._id === id);
      if (!rechnung) return;
      const liste = mahnungenVon(rechnung);
      if (aktion === 'senden' || aktion === 'erneut-senden') {
        await sende(rechnung, { neu: aktion === 'senden' });
      } else if (aktion === 'als-versendet') {
        const letzte = liste[liste.length - 1];
        if (!letzte || letzte.versendetAm) return;
        if (!confirm(`${stufenName(letzte.stufe)} zu Rechnung ${rechnung.nummer} als versendet markieren?`)) return;
        await aendereLetzteStufe(rechnung._id, { versendetAm: heuteTag() });
        meldungElement.textContent = `${stufenName(letzte.stufe)} zu Rechnung ${rechnung.nummer} als versendet vermerkt.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'mahnen') {
        const stand = mahnStand(rechnung, mahnFristenFirma(await ladeFirma()));
        if (!stand.faellig) return;
        if (!await bankStandGeprueft()) return;
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
            <p class="hinweis">Nur ein Vermerk an der Rechnung, die Beträge bleiben,
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
      nurFaellig = false;
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
        if (feld('debEmail') && !istEmail(feld('debEmail'))) {
          formular.querySelector('details.adress-block').open = true;
          formular.elements.debEmail.focus();
          throw new Error(EMAIL_FEHLER);
        }
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
            email: feld('debEmail'),
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
      if (knopf.dataset.aktion === 'nur-faellig') {
        nurFaellig = !nurFaellig;
        zeichneTabelle();
        return;
      }
      if (knopf.dataset.aktion === 'zur-baustelle') {
        ansicht = 'baustelle';
        try { localStorage.setItem(ANSICHT_MERKER, ansicht); } catch { /* egal */ }
        document.dispatchEvent(new CustomEvent('luense:baustelleWechseln',
          { detail: { baustelleId: knopf.dataset.baustelle } }));
        return;
      }
      if (['mahnen', 'mahn-pdf', 'mahn-zurueck', 'betreibung', 'betreibung-zurueck', 'senden',
        'erneut-senden', 'als-versendet'].includes(knopf.dataset.aktion)) {
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
          + 'Die Grundlage bleibt auf «verrechnet», dort von Hand zurückstellen, falls nötig.';
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
