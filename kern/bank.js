// kern/bank.js — Kontoauszug einlesen (ISO 20022 camt.053 / camt.054,
// auch camt.052) und Zahlungen automatisch verbuchen. Keine Bank-
// Schnittstelle: Die XML-Datei kommt aus dem E-Banking (Download), wird
// hier auf dem Gerät gelesen und bleibt hier.
//
// Ablauf: Datei(en) wählen → Buchungen lesen → Zuordnung vorschlagen →
// prüfen → «verbuchen». Gutschriften gehen an Debitoren-Rechnungen
// (Dokument «rechnung»), Belastungen an Kreditoren («kreditor»).
//   zugeordnet  — Referenz (SCOR/QRR) stimmt exakt → vorausgewählt
//   Vorschlag   — Rechnungs-Nr. im Text, IBAN + Betrag oder nur Betrag
//                 → muss bestätigt werden
//   offen       — von Hand einer offenen Rechnung zuweisen oder ignorieren
// Jede verarbeitete Buchung hinterlässt ein Dokument «bankbuchung» mit
// fester Id aus der Bankreferenz — derselbe Auszug zweimal eingelesen
// bucht nichts doppelt.
//
// Gebraucht von module/rechnung.js und module/kreditor.js (beide mit
// Knopf «Kontoauszug einlesen» und Zahlungs-Übersicht) — Rule of two.

import { put, get, abfrage, entferneDokument } from './speicher.js';
import { alleBaustellen, ladeFirma } from './stamm.js';
import { chf, esc } from './ui.js';
import {
  zahl, runde, heuteTag, formatTag, kompakt, gleicheReferenz, scorAusNummer,
  istGueltigeScor, istGueltigeQrr, offenerBetrag, kreditorWerte, zahlungen,
  statusNachZahlungen, formatIban, formatReferenz, rappen, sollRappen, bezahltSumme, skontoSumme,
} from './zahlung.js';

// ---------- camt lesen ----------
const kind = (el, name) => (el ? [...el.children].find((c) => c.localName === name) || null : null);
const kinder = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const pfad = (el, weg) => weg.split('/').reduce((e, name) => kind(e, name), el);
const text = (el, weg) => ((weg ? pfad(el, weg) : el)?.textContent || '').trim();

function tagAus(el, weg) {
  return (text(el, `${weg}/Dt`) || text(el, `${weg}/DtTm`)).slice(0, 10);
}

function streuwert(s) {
  let h = 5381;
  for (const z of s) h = ((h * 33) ^ z.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function sauberSchluessel(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function partei(el) {
  if (!el) return '';
  return text(el, 'Nm') || text(el, 'Pty/Nm');
}

// Liest eine camt-Datei. Wirft einen verständlichen Fehler, wenn die
// Datei kein Kontoauszug ist.
export function leseCamt(xmlText, dateiname = '') {
  const doc = new DOMParser().parseFromString(String(xmlText), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`${dateiname || 'Datei'}: keine gültige XML-Datei.`);
  }
  const wurzel = doc.documentElement;
  const nachricht = [...wurzel.children].find((c) =>
    ['BkToCstmrStmt', 'BkToCstmrDbtCdtNtfctn', 'BkToCstmrAcctRpt'].includes(c.localName));
  if (!nachricht) {
    throw new Error(`${dateiname || 'Datei'}: kein camt.053/054-Kontoauszug (ISO 20022).`);
  }
  const art = { BkToCstmrStmt: 'camt.053', BkToCstmrDbtCdtNtfctn: 'camt.054',
    BkToCstmrAcctRpt: 'camt.052' }[nachricht.localName];
  const version = (/camt\.\d{3}\.\d{3}\.\d{2}/.exec(wurzel.namespaceURI || '') || [art])[0];
  const auszuege = kinder(nachricht, 'Stmt').concat(kinder(nachricht, 'Ntfctn'), kinder(nachricht, 'Rpt'));
  const posten = [];
  const konten = [];
  for (const auszug of auszuege) {
    const kontoIban = kompakt(text(auszug, 'Acct/Id/IBAN') || text(auszug, 'Acct/Id/Othr/Id'));
    konten.push({
      iban: kontoIban,
      von: (text(auszug, 'FrToDt/FrDtTm') || '').slice(0, 10),
      bis: (text(auszug, 'FrToDt/ToDtTm') || '').slice(0, 10),
      erstellt: (text(auszug, 'CreDtTm') || '').slice(0, 10),
    });
    kinder(auszug, 'Ntry').forEach((ntry, ntryIndex) => {
      const ntryBetrag = zahl(text(ntry, 'Amt'));
      const ntryWaehrung = pfad(ntry, 'Amt')?.getAttribute('Ccy') || '';
      const ntryRichtung = text(ntry, 'CdtDbtInd');
      const status = text(ntry, 'Sts/Cd') || text(ntry, 'Sts');
      const storno = text(ntry, 'RvslInd') === 'true';
      const buchungsDatum = tagAus(ntry, 'BookgDt');
      const valuta = tagAus(ntry, 'ValDt');
      const ntryRef = text(ntry, 'AcctSvcrRef') || text(ntry, 'NtryRef');
      const ntryInfo = text(ntry, 'AddtlNtryInf');
      const txs = kinder(ntry, 'NtryDtls').flatMap((nd) => kinder(nd, 'TxDtls'));
      const liste = txs.length ? txs : [null];
      liste.forEach((tx, txIndex) => {
        const richtung = text(tx, 'CdtDbtInd') || ntryRichtung;
        const betragText = text(tx, 'Amt') || text(tx, 'AmtDtls/TxAmt/Amt');
        const betrag = betragText ? zahl(betragText) : (liste.length === 1 ? ntryBetrag : 0);
        const waehrung = (pfad(tx, 'Amt') || pfad(tx, 'AmtDtls/TxAmt/Amt'))?.getAttribute('Ccy')
          || ntryWaehrung;
        // Referenzen: strukturiert (SCOR/QRR), sonst Freitext
        const strd = kinder(pfad(tx, 'RmtInf'), 'Strd');
        let referenz = '';
        let refArt = '';
        const zusatz = [];
        for (const s of strd) {
          const ref = text(s, 'CdtrRefInf/Ref');
          if (ref && !referenz) {
            referenz = kompakt(ref);
            refArt = text(s, 'CdtrRefInf/Tp/CdOrPrtry/Cd') || text(s, 'CdtrRefInf/Tp/CdOrPrtry/Prtry');
          }
          kinder(s, 'AddtlRmtInf').forEach((a) => zusatz.push(a.textContent.trim()));
        }
        const ustrd = kinder(pfad(tx, 'RmtInf'), 'Ustrd').map((u) => u.textContent.trim());
        const mitteilung = [...ustrd, ...zusatz, text(tx, 'AddtlTxInf'), txs.length <= 1 ? ntryInfo : '']
          .filter(Boolean).join(' · ');
        if (!referenz) {
          // Referenz im Freitext (z. B. «RF43 R202 6001» abgetippt)
          const scor = /RF\d{2}(?:\s?[A-Z0-9]){1,21}/i.exec(mitteilung)?.[0];
          if (scor && istGueltigeScor(scor)) {
            referenz = kompakt(scor);
            refArt = 'SCOR (Text)';
          }
        }
        const gegen = richtung === 'CRDT'
          ? { name: partei(pfad(tx, 'RltdPties/Dbtr')) || partei(pfad(tx, 'RltdPties/UltmtDbtr')),
            iban: kompakt(text(tx, 'RltdPties/DbtrAcct/Id/IBAN')) }
          : { name: partei(pfad(tx, 'RltdPties/Cdtr')) || partei(pfad(tx, 'RltdPties/UltmtCdtr')),
            iban: kompakt(text(tx, 'RltdPties/CdtrAcct/Id/IBAN')) };
        const endToEnd = text(tx, 'Refs/EndToEndId');
        const txRef = text(tx, 'Refs/AcctSvcrRef');
        // Schlüssel für die Doppel-Erkennung: Bankreferenz der Transaktion,
        // sonst der Buchung (+ Position im Sammel), sonst Streuwert.
        const schluessel = txRef
          || (ntryRef ? `${ntryRef}${liste.length > 1 ? `/${txIndex + 1}` : ''}` : '')
          || `h${streuwert([kontoIban, buchungsDatum, valuta, richtung, betrag, referenz,
            gegen.iban, endToEnd, mitteilung, ntryIndex, txIndex].join('|'))}`;
        posten.push({
          schluessel: sauberSchluessel(schluessel),
          kontoIban,
          buchungsDatum: buchungsDatum || valuta,
          valuta,
          betrag: runde(betrag),
          waehrung,
          richtung,
          status,
          storno,
          referenz,
          refArt,
          mitteilung,
          gegenpartei: gegen,
          endToEnd: endToEnd === 'NOTPROVIDED' ? '' : endToEnd,
          sammel: liste.length > 1 ? { anzahl: liste.length, total: ntryBetrag } : null,
          quelle: `${art} ${dateiname}`.trim(),
        });
      });
    });
  }
  return { art, version, konten, posten };
}

// ---------- Zuordnung ----------
function nurZeichen(s) {
  return kompakt(s).replace(/[^A-Z0-9]/g, '');
}

function rechnungsReferenz(r) {
  return r.referenz || scorAusNummer(r.nummer);
}

function buchungsId(p) {
  return `bankbuchung:${sauberSchluessel(p.kontoIban || 'konto')}:${p.schluessel}`;
}

// Bewertet einen Zahlbetrag gegen den (virtuellen) Restbetrag eines Ziels.
// Liefert { art: 'voll'|'teil'|'ueber', skonto, rest }. Exakt auf den
// Rappen, ohne Toleranz: «voll» nur, wenn der Betrag den Rest genau deckt
// (bei Kreditoren mit Skonto: genau Rechnungsbetrag minus Skonto, innert
// Frist). 1 Rappen zu wenig bleibt eine Teilzahlung.
function bewerte(ziel, betrag, datum, rest) {
  const b = rappen(betrag);
  const r = rappen(rest);
  if (ziel.art === 'kreditor') {
    const w = kreditorWerte(ziel.doc, datum);
    const voll = rappen(w.betrag);
    const skonto = rappen(w.skontoBetrag);
    const ohneVorZahlung = !zahlungen(ziel.doc).length && r >= voll;
    if (w.skontoTag && skonto > 0 && ohneVorZahlung && b === voll - skonto) {
      if (datum <= w.skontoTag) return { art: 'voll', skonto: skonto / 100, rest: 0 };
      return { art: 'teil', skonto: 0, rest: (r - b) / 100, skontoVerpasst: true };
    }
  }
  if (b === r) return { art: 'voll', skonto: 0, rest: 0 };
  if (b > r) return { art: 'ueber', skonto: 0, rest: 0 };
  return { art: 'teil', skonto: 0, rest: (r - b) / 100 };
}

function passtBetrag(ziel, betrag, datum, rest) {
  return bewerte(ziel, betrag, datum, rest).art === 'voll';
}

// Ordnet alle Posten zu. bestand: { rechnungen, kreditoren, baustellen,
// bankbuchungen }. Gibt die Posten mit { ergebnis, ziel, grund, bewertung }.
export function ordneZu(posten, bestand) {
  const ktr = new Map(bestand.baustellen.map((b) => [b.baustelleId, b]));
  const offeneZiele = (art) => (art === 'rechnung' ? bestand.rechnungen : bestand.kreditoren)
    .filter((d) => d.status !== 'bezahlt' && offenerBetrag(d) > 0)
    .map((doc) => ({ art, doc, baustelle: ktr.get(doc.baustelleId) }));
  const rechnungen = offeneZiele('rechnung');
  const kreditoren = offeneZiele('kreditor');
  const rest = new Map([...rechnungen, ...kreditoren].map((z) => [z.doc._id, offenerBetrag(z.doc)]));
  const bekannteBuchungen = new Set(bestand.bankbuchungen.map((b) => b._id));
  const bekannteRefs = new Set([...bestand.rechnungen, ...bestand.kreditoren]
    .flatMap((d) => zahlungen(d).map((z) => z.bankRef)).filter(Boolean));
  const gesehen = new Set();

  const sortiert = posten.slice().sort((a, b) => (a.buchungsDatum || '').localeCompare(b.buchungsDatum || ''));
  for (const p of sortiert) {
    p.id = buchungsId(p);
    p.ziel = null;
    p.bewertung = null;
    if (gesehen.has(p.id) || bekannteBuchungen.has(p.id) || bekannteRefs.has(p.schluessel)) {
      p.ergebnis = 'doppelt';
      p.grund = gesehen.has(p.id) ? 'kommt in den gewählten Dateien mehrfach vor'
        : 'bereits eingelesen';
      continue;
    }
    gesehen.add(p.id);
    if (p.storno) { p.ergebnis = 'nicht-buchbar'; p.grund = 'Storno-Buchung — von Hand prüfen'; continue; }
    if (p.status && p.status !== 'BOOK') { p.ergebnis = 'nicht-buchbar'; p.grund = `Status ${p.status} (noch nicht gebucht)`; continue; }
    if (p.waehrung && p.waehrung !== 'CHF') { p.ergebnis = 'nicht-buchbar'; p.grund = `Währung ${p.waehrung}`; continue; }
    if (!(p.betrag > 0)) { p.ergebnis = 'nicht-buchbar'; p.grund = 'ohne Betrag'; continue; }

    const gutschrift = p.richtung === 'CRDT';
    const kandidaten = (gutschrift ? rechnungen : kreditoren).filter((z) => rest.get(z.doc._id) > 0);
    const r = (z) => rest.get(z.doc._id);
    let treffer = null;
    let ergebnis = 'offen';
    let grund = '';

    // 1) Referenz exakt
    if (p.referenz) {
      treffer = kandidaten.find((z) => gleicheReferenz(p.referenz,
        gutschrift ? rechnungsReferenz(z.doc) : z.doc.referenz));
      if (treffer) {
        ergebnis = 'zugeordnet';
        grund = `Referenz ${p.refArt || ''} stimmt`.replace(/\s+/g, ' ');
      }
    }
    // 2) Rückfall: Rechnungs-Nr. im Text, IBAN + Betrag, nur Betrag
    if (!treffer) {
      const textZeichen = nurZeichen(`${p.mitteilung} ${p.referenz}`);
      const nummerImText = kandidaten.filter((z) => {
        const nr = nurZeichen(gutschrift ? z.doc.nummer : z.doc.rechnungsNr);
        return nr.length >= 4 && textZeichen.includes(nr);
      });
      const mitBetrag = (liste) => liste.filter((z) => passtBetrag(z, p.betrag, p.buchungsDatum, r(z)));
      if (nummerImText.length) {
        treffer = mitBetrag(nummerImText)[0] || (nummerImText.length === 1 ? nummerImText[0] : null);
        if (treffer) grund = 'Rechnungs-Nr. in der Mitteilung';
      }
      if (!treffer && !gutschrift && p.gegenpartei.iban) {
        const gleicheIban = mitBetrag(kandidaten.filter((z) => z.doc.iban
          && kompakt(z.doc.iban) === p.gegenpartei.iban));
        if (gleicheIban.length === 1) {
          treffer = gleicheIban[0];
          grund = 'IBAN und Betrag stimmen';
        }
      }
      if (!treffer) {
        const nurBetrag = mitBetrag(kandidaten);
        if (nurBetrag.length === 1) {
          treffer = nurBetrag[0];
          grund = 'nur der Betrag stimmt — genau prüfen';
        }
      }
      if (treffer) ergebnis = 'vorschlag';
    }
    if (treffer) {
      p.ziel = treffer;
      p.bewertung = bewerte(treffer, p.betrag, p.buchungsDatum, r(treffer));
      rest.set(treffer.doc._id, p.bewertung.rest);
    }
    p.ergebnis = ergebnis;
    p.grund = grund || (gutschrift ? 'keine passende Rechnung gefunden' : 'kein passender Kreditor gefunden');
  }
  return sortiert;
}

// ---------- Verbuchen ----------
// Eine Zahlung am Dokument erfassen; Status, Datumsstempel und Skonto
// folgen daraus. art: 'rechnung' | 'kreditor'.
export async function bucheZahlung(docId, zahlung) {
  const doc = await get(docId);
  if (zahlung.bankRef && zahlungen(doc).some((z) => z.bankRef === zahlung.bankRef)) {
    return { doc, doppelt: true };
  }
  const neu = { ...doc, zahlungen: [...zahlungen(doc), zahlung] };
  if (!zahlungen(doc).length) neu.statusVorZahlung = doc.status;
  const status = statusNachZahlungen(neu);
  if (status !== doc.status) {
    neu.status = status;
    neu.statusHistorie = [...(doc.statusHistorie || []),
      { status, datum: zahlung.datum || heuteTag(), quelle: zahlung.quelle }];
  }
  if (status === 'bezahlt') neu.bezahltAm = zahlung.datum || heuteTag();
  if (zahl(zahlung.skonto) > 0) neu.skontoGenutzt = true;
  const gespeichert = await put(neu);
  return { doc: gespeichert, doppelt: false };
}

// Zahlung wieder entfernen (Fehlbuchung): Status springt zurück, die
// zugehörige Bankbuchung wird freigegeben (kann neu eingelesen werden).
export async function entferneZahlung(docId, index) {
  const doc = await get(docId);
  const liste = zahlungen(doc).slice();
  const [weg] = liste.splice(index, 1);
  if (!weg) return doc;
  const neu = { ...doc, zahlungen: liste };
  const ruhe = doc.typ === 'kreditor' ? 'visiert' : 'gestellt';
  const status = liste.length ? statusNachZahlungen(neu) : (doc.statusVorZahlung || ruhe);
  if (status !== doc.status) {
    neu.status = status;
    neu.statusHistorie = [...(doc.statusHistorie || []), { status, datum: heuteTag() }];
  }
  if (status !== 'bezahlt') delete neu.bezahltAm;
  if (!liste.some((z) => zahl(z.skonto) > 0)) delete neu.skontoGenutzt;
  if (!liste.length) delete neu.statusVorZahlung;
  const gespeichert = await put(neu);
  if (weg.buchungId) {
    try { await entferneDokument(weg.buchungId); } catch { /* schon weg */ }
  }
  return gespeichert;
}

async function merkeBuchung(p, ergebnis, ziel) {
  try {
    await put({
      _id: p.id,
      typ: 'bankbuchung',
      baustelleId: ziel?.baustelleId || 'bank',
      datum: `${p.buchungsDatum || heuteTag()}T12:00:00.000Z`,
      schluessel: p.schluessel,
      kontoIban: p.kontoIban,
      buchungsDatum: p.buchungsDatum,
      valuta: p.valuta,
      betrag: p.betrag,
      richtung: p.richtung,
      referenz: p.referenz,
      mitteilung: p.mitteilung,
      gegenpartei: p.gegenpartei,
      quelle: p.quelle,
      ergebnis,
      zielId: ziel?._id || '',
      zielTyp: ziel?.typ || '',
      importiertAm: heuteTag(),
    });
  } catch (fehler) {
    if (fehler.status !== 409) throw fehler; // 409: schon vorhanden = schon verbucht
  }
}

async function verbuche(p, zielId) {
  const ziel = await get(zielId);
  const bewertung = p.ziel?.doc._id === zielId && p.bewertung
    ? p.bewertung
    : bewerte({ art: ziel.typ, doc: ziel }, p.betrag, p.buchungsDatum, offenerBetrag(ziel));
  const { doc, doppelt } = await bucheZahlung(zielId, {
    datum: p.buchungsDatum,
    valuta: p.valuta,
    betrag: p.betrag,
    skonto: bewertung.skonto || 0,
    quelle: 'Kontoauszug',
    bankRef: p.schluessel,
    buchungId: p.id,
    referenz: p.referenz,
    gegenpartei: p.gegenpartei.name || '',
    erfasstAm: heuteTag(),
  });
  if (!doppelt) await merkeBuchung(p, 'verbucht', doc);
  return { doc, doppelt, bewertung };
}

// ---------- Ansicht: Kontoauszug-Dialog ----------
function zielText(ziel) {
  const d = ziel.doc;
  const ort = ziel.baustelle ? `${ziel.baustelle.ktr} · ` : '';
  return ziel.art === 'rechnung'
    ? `${ort}Rechnung ${d.nummer} · ${d.titel || ''}`
    : `${ort}${d.lieferant} · ${d.rechnungsNr}`;
}

function bewertungText(p) {
  const b = p.bewertung;
  if (!b) return '';
  if (b.skonto > 0) return `voll bezahlt mit Skonto ${chf(b.skonto)}`;
  if (b.skontoVerpasst) return `Skonto abgezogen, aber Frist vorbei — als Teilzahlung, Rest ${chf(b.rest)}`;
  if (b.art === 'ueber') return 'Überzahlung — Differenz von Hand klären';
  if (b.art === 'teil') return `Teilzahlung — Rest ${chf(b.rest)}`;
  return 'voll bezahlt';
}

function postenKopf(p) {
  const vorzeichen = p.richtung === 'CRDT' ? '+' : '−';
  return `
    <span class="bank-betrag ${p.richtung === 'CRDT' ? 'gewinn' : ''}">${vorzeichen} ${chf(p.betrag)}</span>
    <span class="bank-datum">${formatTag(p.buchungsDatum)}</span>
    <span class="bank-partei">${esc(p.gegenpartei.name || (p.richtung === 'CRDT' ? 'Gutschrift' : 'Belastung'))}</span>
    ${p.referenz ? `<small class="hinweis bank-zeile">Ref. ${esc(formatReferenz(p.referenz))}</small>` : ''}
    ${p.mitteilung ? `<small class="hinweis bank-zeile">${esc(p.mitteilung.slice(0, 140))}</small>` : ''}
    ${p.sammel ? `<small class="hinweis bank-zeile">Teil einer Sammelbuchung (${p.sammel.anzahl} Zahlungen, total ${chf(p.sammel.total)})</small>` : ''}`;
}

// Öffnet den Dialog. nachBuchung() wird nach dem Verbuchen gerufen.
// richtung: 'CRDT' (aus Rechnungen) oder 'DBIT' (aus Kreditoren) — nur
// für die Reihenfolge; verbucht werden immer beide Richtungen.
export function oeffneKontoauszug({ richtung = 'CRDT', nachBuchung = () => {} } = {}) {
  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  dialog.innerHTML = `
    <div class="karte formular dialog bank-dialog" role="dialog" aria-label="Kontoauszug einlesen">
      <h3>Kontoauszug einlesen</h3>
      <p class="hinweis">Im E-Banking den Kontoauszug als <b>camt.053</b> oder die
        Gutschrift-/Belastungsanzeige als <b>camt.054</b> (XML) herunterladen und hier
        wählen. Die Datei bleibt auf diesem Gerät.</p>
      <label class="knopf knopf-primaer datei-knopf">
        XML-Datei wählen
        <input type="file" accept=".xml,application/xml,text/xml" multiple
          data-rolle="camt-datei" class="visually-hidden">
      </label>
      <p class="meldung" role="status" data-rolle="bank-meldung"></p>
      <div data-rolle="bank-vorschau"></div>
      <div class="knopfzeile bank-fuss">
        <button type="button" class="knopf knopf-primaer" data-aktion="verbuchen" hidden>Verbuchen</button>
        <button type="button" class="knopf" data-aktion="zu">Schliessen</button>
      </div>
    </div>`;
  document.body.append(dialog);
  const meldung = dialog.querySelector('[data-rolle="bank-meldung"]');
  const vorschau = dialog.querySelector('[data-rolle="bank-vorschau"]');
  const verbuchenKnopf = dialog.querySelector('[data-aktion="verbuchen"]');
  let posten = [];
  let offeneZiele = [];

  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) dialog.remove();
  });

  function zaehleAuswahl() {
    const n = [...vorschau.querySelectorAll('[data-wahl]')].filter((el) =>
      (el.type === 'checkbox' ? el.checked : el.value)).length;
    verbuchenKnopf.hidden = !posten.length;
    verbuchenKnopf.disabled = n === 0;
    verbuchenKnopf.textContent = `Auswahl verbuchen (${n})`;
  }

  function zeichne(dateiInfo) {
    const gruppe = (ergebnis) => posten.filter((p) => p.ergebnis === ergebnis);
    const reihenfolge = (liste) => liste.slice().sort((a, b) =>
      (a.richtung === richtung ? 0 : 1) - (b.richtung === richtung ? 0 : 1));
    const karte = (p, inhalt) => `
      <div class="bank-posten ${p.richtung === 'CRDT' ? 'bank-gutschrift' : 'bank-belastung'}">
        <div class="bank-kopf">${postenKopf(p)}</div>
        ${inhalt}
      </div>`;
    const zuordnungKarte = (p, vorausgewaehlt) => karte(p, `
      <label class="bank-wahl">
        <input type="checkbox" data-wahl="${esc(p.id)}" ${vorausgewaehlt ? 'checked' : ''}>
        <span>→ <b>${esc(zielText(p.ziel))}</b><br>
          <small>${esc(p.grund)} · ${esc(bewertungText(p))}${
            p.ziel.art === 'kreditor' && p.ziel.doc.status === 'offen' ? ' · noch nicht visiert' : ''}</small></span>
      </label>`);
    const offenKarte = (p) => {
      const passende = offeneZiele.filter((z) => z.art === (p.richtung === 'CRDT' ? 'rechnung' : 'kreditor'));
      return karte(p, `
        <label class="bank-zuweisen">${p.richtung === 'CRDT' ? 'Rechnung' : 'Kreditor'} zuweisen
          <select data-wahl="${esc(p.id)}">
            <option value="">— später entscheiden —</option>
            <option value="ignorieren">ignorieren (keine Rechnung)</option>
            ${passende.map((z) => `<option value="${esc(z.doc._id)}">${esc(zielText(z))} · offen ${
              chf(offenerBetrag(z.doc))}</option>`).join('')}
          </select>
        </label>
        <small class="hinweis">${esc(p.grund)}</small>`);
    };
    const abschnitt = (titel, liste, inhalt, offen = true) => (liste.length ? `
      <details class="bank-gruppe" ${offen ? 'open' : ''}>
        <summary>${titel} (${liste.length})</summary>
        ${reihenfolge(liste).map(inhalt).join('')}
      </details>` : '');
    const zugeordnet = gruppe('zugeordnet');
    const vorschlag = gruppe('vorschlag');
    const offen = gruppe('offen');
    const doppelt = gruppe('doppelt');
    const nichtBuchbar = gruppe('nicht-buchbar');
    vorschau.innerHTML = `
      ${dateiInfo}
      ${abschnitt('Zugeordnet', zugeordnet, (p) => zuordnungKarte(p, true))}
      ${abschnitt('Vorschlag — bitte bestätigen', vorschlag, (p) => zuordnungKarte(p, false))}
      ${abschnitt('Nicht zugeordnet', offen, offenKarte)}
      ${abschnitt('Nicht buchbar', nichtBuchbar, (p) => karte(p, `<small class="hinweis">${esc(p.grund)}</small>`), false)}
      ${abschnitt('Bereits verbucht — wird übersprungen', doppelt, (p) => karte(p, `<small class="hinweis">${esc(p.grund)}</small>`), false)}
      ${posten.length ? '' : '<p class="hinweis">Die Datei enthält keine Buchungen.</p>'}`;
    zaehleAuswahl();
  }

  vorschau.addEventListener('change', zaehleAuswahl);

  dialog.querySelector('[data-rolle="camt-datei"]').addEventListener('change', async (wechsel) => {
    const dateien = [...wechsel.target.files];
    if (!dateien.length) return;
    meldung.textContent = 'Datei wird gelesen …';
    try {
      const gelesen = [];
      for (const datei of dateien) gelesen.push(leseCamt(await datei.text(), datei.name));
      const [rechnungen, kreditoren, baustellen, bankbuchungen, firma] = await Promise.all([
        abfrage({ typ: 'rechnung' }), abfrage({ typ: 'kreditor' }),
        alleBaustellen({ mitArchivierten: true }), abfrage({ typ: 'bankbuchung' }), ladeFirma(),
      ]);
      posten = ordneZu(gelesen.flatMap((g) => g.posten),
        { rechnungen, kreditoren, baustellen, bankbuchungen });
      const ktr = new Map(baustellen.map((b) => [b.baustelleId, b]));
      offeneZiele = [...rechnungen.map((doc) => ({ art: 'rechnung', doc })),
        ...kreditoren.map((doc) => ({ art: 'kreditor', doc }))]
        .filter((z) => z.doc.status !== 'bezahlt' && offenerBetrag(z.doc) > 0)
        .map((z) => ({ ...z, baustelle: ktr.get(z.doc.baustelleId) }));
      const konten = [...new Set(gelesen.flatMap((g) => g.konten.map((k) => k.iban)).filter(Boolean))];
      const fremdesKonto = firma?.iban && konten.some((k) => k !== kompakt(firma.iban));
      const zeitraum = gelesen.flatMap((g) => g.konten)
        .map((k) => [k.von, k.bis].filter(Boolean).map(formatTag).join('–')).filter(Boolean);
      const dateiInfo = `
        <p class="hinweis">${gelesen.map((g) => esc(g.version)).join(', ')} · Konto ${
          konten.map((k) => esc(formatIban(k))).join(', ') || '—'}${
          zeitraum.length ? ` · ${esc([...new Set(zeitraum)].join(', '))}` : ''} · ${posten.length} Buchungen</p>
        ${fremdesKonto ? `<p class="hinweis skonto-chance">⚠ Konto weicht von der IBAN in den
          Firmendaten ab (${esc(formatIban(firma.iban))}) — richtiges Konto?</p>` : ''}`;
      meldung.textContent = '';
      zeichne(dateiInfo);
    } catch (fehler) {
      meldung.textContent = fehler.message;
      vorschau.innerHTML = '';
      posten = [];
      zaehleAuswahl();
    } finally {
      wechsel.target.value = '';
    }
  });

  verbuchenKnopf.addEventListener('click', async () => {
    verbuchenKnopf.disabled = true;
    const zaehler = { voll: 0, teil: 0, ignoriert: 0, doppelt: 0, skonto: 0 };
    try {
      for (const el of vorschau.querySelectorAll('[data-wahl]')) {
        const p = posten.find((x) => x.id === el.dataset.wahl);
        if (!p) continue;
        if (el.type === 'checkbox') {
          if (!el.checked || !p.ziel) continue;
          const { doc, doppelt } = await verbuche(p, p.ziel.doc._id);
          if (doppelt) zaehler.doppelt++;
          else if (doc.status === 'bezahlt') zaehler.voll++;
          else zaehler.teil++;
          if (!doppelt && doc.skontoGenutzt && p.bewertung?.skonto) zaehler.skonto += p.bewertung.skonto;
        } else if (el.value === 'ignorieren') {
          await merkeBuchung(p, 'ignoriert', null);
          zaehler.ignoriert++;
        } else if (el.value) {
          const { doc, doppelt } = await verbuche(p, el.value);
          if (doppelt) zaehler.doppelt++;
          else if (doc.status === 'bezahlt') zaehler.voll++;
          else zaehler.teil++;
        }
      }
      const teile = [
        zaehler.voll ? `${zaehler.voll} bezahlt` : '',
        zaehler.teil ? `${zaehler.teil} Teilzahlung${zaehler.teil > 1 ? 'en' : ''}` : '',
        zaehler.skonto ? `Skonto ${chf(zaehler.skonto)}` : '',
        zaehler.ignoriert ? `${zaehler.ignoriert} ignoriert` : '',
        zaehler.doppelt ? `${zaehler.doppelt} schon verbucht` : '',
      ].filter(Boolean);
      document.dispatchEvent(new CustomEvent('luense:daten'));
      dialog.remove();
      nachBuchung(`Kontoauszug verbucht: ${teile.join(' · ') || 'nichts ausgewählt'}.`);
    } catch (fehler) {
      meldung.textContent = `Fehler beim Verbuchen: ${fehler.message}`;
      verbuchenKnopf.disabled = false;
    }
  });
}

// ---------- Ansicht: Zahlungen eines Dokuments ----------
// Liste der Zahlungen mit Entfernen und Erfassen von Hand (bar,
// Verrechnung, Zahlung ohne Auszug).
export function zeigeZahlungen(docId, { titel = 'Zahlungen', nachAenderung = () => {} } = {}) {
  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  document.body.append(dialog);

  async function zeichne() {
    const doc = await get(docId);
    const liste = zahlungen(doc);
    const w = doc.typ === 'kreditor' ? kreditorWerte(doc) : null;
    dialog.innerHTML = `
      <form class="karte formular dialog" data-rolle="zahlung-formular">
        <h3>${esc(titel)}</h3>
        <p class="hinweis">${doc.typ === 'rechnung' ? 'Total inkl. MWST' : 'Betrag'} ${chf(sollRappen(doc) / 100)}
          · bezahlt ${chf(bezahltSumme(doc))}${
          skontoSumme(doc) ? ` · Skonto ${chf(skontoSumme(doc))}` : ''}
          · offen <b>${chf(offenerBetrag(doc))}</b> · Status ${esc(doc.status)}</p>
        ${liste.length ? liste.map((z, i) => `
          <div class="fo-zeile dossier-zeile">
            <span class="fo-label">${formatTag(z.datum)} · ${chf(zahl(z.betrag))}${
              zahl(z.skonto) ? ` + Skonto ${chf(zahl(z.skonto))}` : ''}<br>
              <small class="hinweis">${esc(z.quelle || '')}${z.gegenpartei ? ` · ${esc(z.gegenpartei)}` : ''}${
                z.bankRef ? ` · Bank-Ref. ${esc(z.bankRef)}` : ''}</small></span>
            <button type="button" class="knopf eintrag-loeschen" data-entfernen="${i}">Entfernen</button>
          </div>`).join('') : '<p class="hinweis">Noch keine Zahlungen erfasst.</p>'}
        <p class="gruppen-label">Zahlung von Hand erfassen</p>
        <div class="feld-reihe">
          <label>Datum<input name="datum" type="date" required value="${heuteTag()}"></label>
          <label>Betrag [CHF]<input name="betrag" type="number" inputmode="decimal" step="any"
            min="0.01" required value="${offenerBetrag(doc) || ''}"></label>
        </div>
        ${w?.skontoTag ? `<label class="bank-wahl"><input type="checkbox" name="skonto">
          Skonto ${chf(w.skontoBetrag)} abgezogen</label>` : ''}
        <div class="knopfzeile">
          <button type="submit" class="knopf knopf-primaer">Zahlung erfassen</button>
          <button type="button" class="knopf" data-aktion="zu">Schliessen</button>
        </div>
        <p class="meldung" role="status"></p>
      </form>`;
  }

  dialog.addEventListener('click', async (klick) => {
    if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) {
      dialog.remove();
      return;
    }
    const knopf = klick.target.closest('[data-entfernen]');
    if (!knopf) return;
    if (!confirm('Diese Zahlung entfernen? Der Status wird neu berechnet; eine Zahlung aus dem '
      + 'Kontoauszug kann danach erneut eingelesen werden.')) return;
    await entferneZahlung(docId, Number(knopf.dataset.entfernen));
    document.dispatchEvent(new CustomEvent('luense:daten'));
    await zeichne();
    nachAenderung();
  });

  dialog.addEventListener('submit', async (abschicken) => {
    abschicken.preventDefault();
    const formular = abschicken.target;
    const doc = await get(docId);
    const w = doc.typ === 'kreditor' ? kreditorWerte(doc) : null;
    await bucheZahlung(docId, {
      datum: formular.elements.datum.value,
      betrag: rappen(formular.elements.betrag.value) / 100,
      skonto: formular.elements.skonto?.checked ? w.skontoBetrag : 0,
      quelle: 'von Hand',
      erfasstAm: heuteTag(),
    });
    document.dispatchEvent(new CustomEvent('luense:daten'));
    await zeichne();
    nachAenderung();
  });

  zeichne();
}
