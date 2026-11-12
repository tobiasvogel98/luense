// kern/zahlung.js — Zahlungs-Grunddienste für Debitoren (Rechnungen) und
// Kreditoren: IBAN-Prüfung, Zahlungsreferenzen (SCOR nach ISO 11649 und
// QR-Referenz), Zahlungen am Dokument (Teilzahlung, Restbetrag, Skonto)
// und der daraus folgende Status.
// Gebraucht von module/rechnung.js, module/kreditor.js, module/dossier.js,
// module/auswertung.js, kern/stamm.js (Firmendaten) und kern/bank.js
// (Kontoauszug) — Rule of two erfüllt.
//
// Zahlungen liegen als Liste am jeweiligen Dokument:
//   zahlungen: [{ datum, valuta, betrag, quelle: 'Kontoauszug' | 'manuell',
//     bankRef, referenz, gegenpartei, skonto }]
// Ältere Dokumente ohne Liste gelten als ohne erfasste Zahlungen.

//
// Geldrechnung: exakt in ganzen Rappen (Ganzzahlen), nie mit Gleitkomma-
// Toleranz. Keine Rundung auf 5 Rappen — gerundet wird nur dort, wo ein
// Ergebnis feiner als ein Rappen wäre (MWST, Skonto), kaufmännisch auf
// 0.01. Eine Zahlung schliesst eine Rechnung nur, wenn sie den offenen
// Betrag auf den Rappen genau deckt.

export const ZAHLUNGSFRIST_TAGE = 30;

export function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Dezimalwert (Text oder Zahl) als Ganzzahl mit «stellen» Nachkommastellen,
// aus dem Dezimaltext gelesen (keine Gleitkomma-Multiplikation) und
// kaufmännisch gerundet (ab 5 weg von null). ganzzahl('12.345', 2) → 1235.
function ganzzahl(wert, stellen) {
  let text = typeof wert === 'number'
    ? (Number.isFinite(wert) ? wert.toFixed(stellen + 6) : '0')
    : String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.');
  if (!text) return 0;
  const negativ = text.startsWith('-');
  text = text.replace(/^[-+]/, '');
  const treffer = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!treffer) return Math.round(zahl(wert) * 10 ** stellen); // z. B. «1e-7»
  const nachkomma = (treffer[2] || '').padEnd(stellen + 1, '0');
  let n = Number(`${treffer[1] || '0'}${nachkomma.slice(0, stellen)}`);
  if (Number(nachkomma[stellen]) >= 5) n += 1;
  return negativ && n ? -n : n;
}

// Betrag in ganzen Rappen: rappen('12\'345.60') → 1234560.
export function rappen(wert) {
  return ganzzahl(wert, 2);
}

// Prozent von einem Rappenbetrag, exakt gerechnet (BigInt) und
// kaufmännisch auf den Rappen gerundet: prozentVonRappen(1000000, 8.1) → 81000.
export function prozentVonRappen(basisRappen, prozent) {
  const satz = BigInt(ganzzahl(prozent, 4)); // Prozent × 10'000
  const basis = BigInt(basisRappen);
  const negativ = (basis < 0n) !== (satz < 0n);
  const produkt = (basis < 0n ? -basis : basis) * (satz < 0n ? -satz : satz);
  const ergebnis = Number((produkt + 500000n) / 1000000n);
  return negativ && ergebnis ? -ergebnis : ergebnis;
}

// Auf den Rappen (0.01) — nur wegen der Rappen der Währung, nie auf 5 Rappen.
export function runde(n) {
  return rappen(n) / 100;
}

// ---------- MWST ----------
// Satz für Dokumente ohne eigenen Satz. Seit der Einführung hält jede
// Rechnung und Offerte ihren Satz fest (mwstSatz, bei Erstellung aus den
// Firmendaten); ältere Dokumente erhalten beim Start einmalig 8.1 %
// (kern/migration.js). Der feste Rückfall bleibt als Sicherung — er folgt
// bewusst NICHT dem aktuellen Firmensatz, damit sich alte Beträge nie
// verändern.
export const MWST_SATZ_STANDARD = 8.1;

// Satz aus Text/Zahl; leer oder ungültig → null.
export function mwstSatzAus(wert) {
  const text = String(wert ?? '').trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}

// Satz eines Dokuments (Rechnung, Offerte): eigener Satz, sonst 8.1 %.
export function satzVon(doc) {
  return mwstSatzAus(doc?.mwstSatz) ?? MWST_SATZ_STANDARD;
}

export function formatSatz(satz) {
  return `${Number(satz).toLocaleString('de-CH', { maximumFractionDigits: 4 })} %`;
}

// Beträge einer Debitoren-Rechnung: «betrag» ist netto (exkl. MWST), der
// Satz steht an der Rechnung (mwstSatz). MWST exakt in Rappen, kaufmännisch
// auf 0.01 — keine 5-Rappen-Rundung.
export function rechnungsBetraege(doc) {
  const satz = satzVon(doc);
  const nettoRappen = rappen(doc?.betrag);
  const mwstRappen = satz > 0 ? prozentVonRappen(nettoRappen, satz) : 0;
  const bruttoRappen = nettoRappen + mwstRappen;
  return {
    satz,
    nettoRappen,
    mwstRappen,
    bruttoRappen,
    netto: nettoRappen / 100,
    mwst: mwstRappen / 100,
    brutto: bruttoRappen / 100,
  };
}

// Netto aus einem Brutto-Betrag (Rappen) bei «satz» Prozent, exakt
// (BigInt) und kaufmännisch auf den Rappen: 10'810.00 bei 8.1 % → 10'000.00.
// Die Differenz brutto − netto ist die Steuer, damit die Summe aufgeht.
// Gebraucht vom Kreditoren-Formular (QR-Scan liefert brutto) und der
// Nachführung alter Kreditoren (kern/migration.js).
export function nettoAusBruttoRappen(bruttoRappen, satz) {
  const s = BigInt(ganzzahl(satz, 4)); // Prozent × 10'000
  if (s <= 0n) return bruttoRappen;
  const brutto = BigInt(bruttoRappen);
  const negativ = brutto < 0n;
  const b = negativ ? -brutto : brutto;
  const nenner = 1000000n + s;
  const netto = Number((b * 1000000n * 2n + nenner) / (nenner * 2n));
  return negativ && netto ? -netto : netto;
}

// ---------- Kreditoren: netto + Vorsteuer = brutto ----------
// Lieferantenrechnungen werden NETTO erfasst, die Vorsteuer (MWST des
// Lieferanten) als eigenes Feld: netto, vorsteuerSatz (Standard 8.1,
// je Kreditor änderbar, 0 erlaubt), vorsteuer (exakt gerechnet, aber von
// Hand übersteuerbar — massgebend ist die Rechnung des Lieferanten).
// «betrag» bleibt das BRUTTO (= netto + vorsteuer) — darauf laufen
// Zahlungen, Kontoauszug-Abgleich, Restbetrag, Skonto und der QR-Zahlteil.
// Kosten (Controlling) rechnen mit netto. Alte Kreditoren ohne netto: das
// erfasste «betrag» gilt als brutto, netto zu 8.1 % abgeleitet (siehe
// kern/migration.js, die das einmal festschreibt).
export const VORSTEUER_SATZ_STANDARD = 8.1;

export function kreditorBetraege(k) {
  const bruttoRp = rappen(k?.betrag);
  const satzEigen = mwstSatzAus(k?.vorsteuerSatz);
  const satz = satzEigen ?? VORSTEUER_SATZ_STANDARD;
  let nettoRp;
  let vorsteuerRp;
  if (String(k?.netto ?? '').trim() !== '') {
    nettoRp = rappen(k.netto);
    vorsteuerRp = String(k?.vorsteuer ?? '').trim() !== ''
      ? rappen(k.vorsteuer) : bruttoRp - nettoRp;
  } else {
    nettoRp = nettoAusBruttoRappen(bruttoRp, satz);
    vorsteuerRp = bruttoRp - nettoRp;
  }
  return {
    satz,
    nettoRappen: nettoRp,
    vorsteuerRappen: vorsteuerRp,
    bruttoRappen: bruttoRp,
    netto: nettoRp / 100,
    vorsteuer: vorsteuerRp / 100,
    brutto: bruttoRp / 100,
    abgeleitet: String(k?.netto ?? '').trim() === '',
  };
}

// ---------- Verzugszins aus dem Mahnwesen ----------
// Verrechneter Verzugszins einer Debitoren-Rechnung: der Zins der LETZTEN
// Mahnung (mahnungen[], module/rechnung.js). Jede Mahnung rechnet ab der
// Zahlungserinnerung bis zu ihrem eigenen Datum — die letzte ersetzt die
// früheren, nie zusammenzählen. Zurücknehmen der Mahnung nimmt den Zins
// wieder weg. Entscheid Tobias 12.11.2026: eine Rechnung ist erst bezahlt,
// wenn Kapital UND verrechneter Verzugszins bezahlt sind. Der Zins ist kein
// Werkvertrags-Ertrag (Controlling rechnet weiter mit «betrag» netto).
export function zinsSollRappen(doc) {
  if (doc?.typ !== 'rechnung' || !Array.isArray(doc.mahnungen) || !doc.mahnungen.length) return 0;
  return Math.max(0, Math.round(Number(doc.mahnungen[doc.mahnungen.length - 1].zinsRappen) || 0));
}

// Geschuldeter Betrag in Rappen: Rechnung = Total inkl. MWST plus
// verrechneter Verzugszins, Kreditor = Rechnungsbetrag des Lieferanten.
export function sollRappen(doc) {
  return doc?.typ === 'rechnung'
    ? rechnungsBetraege(doc).bruttoRappen + zinsSollRappen(doc) : rappen(doc?.betrag);
}

export function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

export function plusTage(tagIso, tage) {
  const start = new Date(`${tagIso}T12:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + tage);
  return new Date(start.getTime() - start.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

export function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

// ---------- Modulo 97 (IBAN, SCOR) ----------
function mod97(ziffern) {
  let rest = 0;
  for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
  return rest;
}

function buchstabenAlsZahlen(text) {
  return text.replace(/[A-Z]/g, (b) => String(b.charCodeAt(0) - 55));
}

export function kompakt(text) {
  return String(text ?? '').replace(/\s+/g, '').toUpperCase();
}

// ---------- IBAN ----------
export function istGueltigeIban(iban) {
  const i = kompakt(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  if ((i.startsWith('CH') || i.startsWith('LI')) && i.length !== 21) return false;
  return mod97(buchstabenAlsZahlen(i.slice(4) + i.slice(0, 4))) === 1;
}

// QR-IBAN: Institut-Identifikation 30000–31999 (nur mit QR-Referenz).
export function istQrIban(iban) {
  const i = kompakt(iban);
  const iid = Number(i.slice(4, 9));
  return /^(CH|LI)/.test(i) && iid >= 30000 && iid <= 31999;
}

export function formatIban(iban) {
  return kompakt(iban).replace(/(.{4})/g, '$1 ').trim();
}

// ---------- SCOR (ISO 11649, «RF…») ----------
// Aus der Rechnungsnummer abgeleitet, z. B. R-2026-001 → RF67R2026001:
// gleiche Nummer ergibt immer dieselbe Referenz. Funktioniert mit einer
// normalen IBAN (QR-Referenz bräuchte QR-IBAN und Bankvertrag).
export function scorAusNummer(nummer) {
  const kern = kompakt(nummer).replace(/[^A-Z0-9]/g, '').slice(0, 21);
  if (!kern) return '';
  const pruef = 98 - mod97(buchstabenAlsZahlen(`${kern}RF00`));
  return `RF${String(pruef).padStart(2, '0')}${kern}`;
}

export function istGueltigeScor(ref) {
  const r = kompakt(ref);
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(r)) return false;
  return mod97(buchstabenAlsZahlen(r.slice(4) + r.slice(0, 4))) === 1;
}

// ---------- QR-Referenz (27 Ziffern, Modulo 10 rekursiv) ----------
const MOD10_TABELLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
function mod10Pruefziffer(ziffern) {
  let uebertrag = 0;
  for (const z of ziffern) uebertrag = MOD10_TABELLE[(uebertrag + Number(z)) % 10];
  return (10 - uebertrag) % 10;
}

export function istGueltigeQrr(ref) {
  const r = kompakt(ref);
  return /^\d{27}$/.test(r) && mod10Pruefziffer(r.slice(0, 26)) === Number(r[26]);
}

// Art der Referenz: 'QRR', 'SCOR', '' (keine) oder 'ungueltig'.
export function referenzArt(ref) {
  const r = kompakt(ref);
  if (!r) return '';
  if (istGueltigeQrr(r)) return 'QRR';
  if (istGueltigeScor(r)) return 'SCOR';
  return 'ungueltig';
}

export function formatReferenz(ref) {
  const r = kompakt(ref);
  if (/^\d{27}$/.test(r)) {
    // QR-Referenz: 2 Ziffern, dann Fünfergruppen
    return `${r.slice(0, 2)} ${r.slice(2).replace(/(.{5})/g, '$1 ').trim()}`;
  }
  return r.replace(/(.{4})/g, '$1 ').trim();
}

// Referenzen vergleichbar machen: Leerzeichen weg, Grossbuchstaben,
// bei QR-Referenzen führende Nullen ignorieren.
export function gleicheReferenz(a, b) {
  const x = kompakt(a);
  const y = kompakt(b);
  if (!x || !y) return false;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return x.replace(/^0+/, '') === y.replace(/^0+/, '');
  return x === y;
}

// ---------- Zahlungen am Dokument ----------
export function zahlungen(doc) {
  return Array.isArray(doc?.zahlungen) ? doc.zahlungen : [];
}

export function bezahltRappen(doc) {
  return zahlungen(doc).reduce((s, z) => s + rappen(z.betrag), 0);
}

export function skontoRappen(doc) {
  return zahlungen(doc).reduce((s, z) => s + rappen(z.skonto), 0);
}

export function bezahltSumme(doc) {
  return bezahltRappen(doc) / 100;
}

export function skontoSumme(doc) {
  return skontoRappen(doc) / 100;
}

// Restbetrag in Rappen: geschuldeter Betrag (Rechnung inkl. MWST und
// verrechnetem Verzugszins) minus
// Zahlungen minus abgezogener Skonto. Ein von Hand auf «bezahlt» gesetztes
// Dokument hat keinen Rest.
export function offenRappen(doc) {
  if (doc?.status === 'bezahlt') return 0;
  return Math.max(0, sollRappen(doc) - bezahltRappen(doc) - skontoRappen(doc));
}

export function offenerBetrag(doc) {
  return offenRappen(doc) / 100;
}

// Offener Betrag aufgeteilt: Zahlungen tilgen zuerst das Kapital (Total
// inkl. MWST), der verrechnete Verzugszins bleibt als Rest offen.
// { offen, zins (davon Verzugszins), kapital } — alles in Rappen.
export function offenAufteilung(doc) {
  const offen = offenRappen(doc);
  const zins = Math.min(zinsSollRappen(doc), offen);
  return { offen, zins, kapital: offen - zins };
}

// Fälligkeit einer Debitoren-Rechnung (Rechnungsdatum + Zahlungsfrist).
export function rechnungFaellig(rechnung) {
  return rechnung?.tag
    ? plusTage(rechnung.tag, rechnung.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE) : '';
}

// Abgeleitete Termine und Beträge eines Kreditors (Skonto, Fälligkeit, Rest).
export function kreditorWerte(k, heute = heuteTag()) {
  const betragRappen = rappen(k.betrag);
  const betrag = betragRappen / 100;
  const faelligTag = k.tag ? plusTage(k.tag, k.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE) : '';
  const skontoProzent = zahl(k.skontoProzent);
  const skontoTage = parseInt(k.skontoTage, 10) || 0;
  const skontoTag = skontoProzent > 0 && skontoTage > 0 && k.tag
    ? plusTage(k.tag, skontoTage) : '';
  const skontoBetrag = skontoTag ? prozentVonRappen(betragRappen, k.skontoProzent) / 100 : 0;
  const offen = k.status !== 'bezahlt';
  const kb = kreditorBetraege(k);
  return {
    betrag, // brutto inkl. MWST — Zahlungen, Skonto, Rest
    netto: kb.netto,
    vorsteuer: kb.vorsteuer,
    vorsteuerSatz: kb.satz,
    faelligTag,
    ueberfaellig: offen && !!faelligTag && faelligTag < heute,
    skontoTag,
    skontoBetrag,
    // Skonto nur auf die ganze Rechnung, solange noch nichts bezahlt ist.
    skontoNutzbar: offen && !!skontoTag && skontoTag >= heute && !zahlungen(k).length,
    bezahlt: bezahltSumme(k),
    rest: offenerBetrag(k),
  };
}

// Status nach einer Änderung der Zahlungen. «vorher» ist der Status vor
// der ersten Zahlung (gestellt bzw. visiert), damit beim Entfernen einer
// Zahlung der Ablauf korrekt zurückspringt.
export function statusNachZahlungen(doc) {
  if (!zahlungen(doc).length) return doc.statusVorZahlung || doc.status;
  // Exakt auf den Rappen: 1 Rappen zu wenig bleibt «teilbezahlt».
  if (bezahltRappen(doc) + skontoRappen(doc) >= sollRappen(doc)) return 'bezahlt';
  return 'teilbezahlt';
}
