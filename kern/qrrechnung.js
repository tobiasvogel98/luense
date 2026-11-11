// kern/qrrechnung.js — Zahlteil mit Empfangsschein der Schweizer QR-Rechnung
// nach SIX «Swiss Payment Standards — Schweizer Implementation Guidelines
// QR-Rechnung» (Version 2.3, Adresstyp S strukturiert; der kombinierte
// Adresstyp K ist seit November 2025 nicht mehr zulässig).
// Referenztyp SCOR (ISO 11649) mit normaler IBAN — QR-IBAN/QR-Referenz
// bräuchte einen Bankvertrag und wird bewusst nicht erzeugt.
// Der Zahlteil ist ein SVG in Millimetern (210 × 105 mm): auf Papier exakt,
// am Bildschirm skaliert. Der QR-Code entsteht mit kern/qr.js.

import { erzeugeQr, qrPfad } from './qr.js';
import {
  kompakt, formatIban, formatReferenz, istGueltigeIban, istQrIban, istGueltigeScor,
} from './zahlung.js';

// Zeichensatz der Implementation Guidelines (Latin-1-Auszug plus
// einige Zeichen aus Latin Extended-A und €) — alles andere wird ersetzt.
const ERLAUBT = /[\x20-\x7E\xA0-\xFFĀ-ſȘșȚț€]/u;

function sauber(text, max) {
  return [...String(text ?? '').replace(/[\r\n\t]+/g, ' ').trim()]
    .map((z) => (ERLAUBT.test(z) ? z : '.')).join('').slice(0, max).trim();
}

// Strukturierte Adresse (Typ S): Name, Strasse, Hausnummer, PLZ, Ort, Land.
function adresse(a) {
  return {
    name: sauber(a?.name, 70),
    strasse: sauber(a?.strasse, 70),
    hausnummer: sauber(a?.hausnummer, 16),
    plz: sauber(a?.plz, 16),
    ort: sauber(a?.ort, 35),
    land: sauber(a?.land || 'CH', 2).toUpperCase(),
  };
}

export function adresseVollstaendig(a) {
  return !!(a?.name && a?.plz && a?.ort);
}

function adressZeilen(a) {
  return a.name
    ? ['S', a.name, a.strasse, a.hausnummer, a.plz, a.ort, a.land]
    : ['', '', '', '', '', '', ''];
}

// Prüft die Angaben und liefert eine Liste von Mängeln (leer = in Ordnung).
export function pruefeZahlteil({ firma, betrag, referenz }) {
  const maengel = [];
  if (!firma?.iban) maengel.push('IBAN fehlt in den Firmendaten (⚙ Stamm).');
  else if (!istGueltigeIban(firma.iban)) maengel.push('IBAN der Firmendaten ist ungültig.');
  else if (!/^(CH|LI)/.test(kompakt(firma.iban))) maengel.push('QR-Rechnung nur mit IBAN aus CH oder LI.');
  else if (istQrIban(firma.iban)) maengel.push('QR-IBAN hinterlegt — dafür wäre eine QR-Referenz nötig. Bitte die normale IBAN des Kontos eintragen.');
  if (!adresseVollstaendig(firma)) maengel.push('Firmenname, PLZ und Ort fehlen in den Firmendaten.');
  if (!(betrag >= 0.01 && betrag <= 999999999.99)) maengel.push('Betrag muss zwischen 0.01 und 999 999 999.99 liegen.');
  if (referenz && !istGueltigeScor(referenz)) maengel.push('Referenz ist keine gültige SCOR-Referenz.');
  return maengel;
}

// Swico-Rechnungsinformationen (S1): Rechnungs-Nr., Datum, Konditionen.
function swico({ rechnungsNr, rechnungsTag, zahlungsfristTage }) {
  const maske = (t) => String(t).replace(/\\/g, '\\\\').replace(/\//g, '\\/');
  const teile = ['//S1'];
  if (rechnungsNr) teile.push(`10/${maske(sauber(rechnungsNr, 40))}`);
  if (/^\d{4}-\d{2}-\d{2}/.test(rechnungsTag || '')) {
    teile.push(`11/${rechnungsTag.slice(2, 4)}${rechnungsTag.slice(5, 7)}${rechnungsTag.slice(8, 10)}`);
  }
  if (Number.isFinite(zahlungsfristTage)) teile.push(`40/0:${zahlungsfristTage}`);
  return teile.length > 1 ? teile.join('/') : '';
}

// Inhalt des Swiss QR Codes, Zeilen mit LF getrennt, ohne Abschluss-Umbruch.
export function qrInhalt({ firma, debitor, betrag, waehrung = 'CHF', referenz, mitteilung,
  rechnungsNr, rechnungsTag, zahlungsfristTage }) {
  const ref = kompakt(referenz);
  const info = swico({ rechnungsNr, rechnungsTag, zahlungsfristTage });
  // Mitteilung + Rechnungsinformationen zusammen höchstens 140 Zeichen.
  const text = sauber(mitteilung, Math.max(0, 140 - info.length));
  const deb = adresseVollstaendig(debitor) ? adresse(debitor) : adresse(null);
  return [
    'SPC', '0200', '1',
    kompakt(firma.iban),
    ...adressZeilen(adresse(firma)),
    '', '', '', '', '', '', '', // endgültiger Zahlungsempfänger: leer (reserviert)
    Number(betrag).toFixed(2),
    waehrung,
    ...adressZeilen(deb),
    ref ? 'SCOR' : 'NON',
    ref,
    text,
    'EPD',
    info,
  ].join('\n');
}

// ---------- Darstellung (SVG, Masse in mm) ----------
const SCHRIFT = 'Helvetica, Arial, "Liberation Sans", sans-serif';
const PT = 0.3528; // 1 pt in mm

function x(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Grober Zeilenumbruch nach Zeichenbreite (mittlere Breite ≈ 0.53 em).
function umbrechen(text, breiteMm, groessePt) {
  const maxZeichen = Math.max(8, Math.floor(breiteMm / (groessePt * PT * 0.53)));
  const woerter = String(text).split(/\s+/).filter(Boolean);
  const zeilen = [];
  let aktuell = '';
  for (const wort of woerter) {
    const versuch = aktuell ? `${aktuell} ${wort}` : wort;
    if (versuch.length <= maxZeichen) aktuell = versuch;
    else {
      if (aktuell) zeilen.push(aktuell);
      aktuell = wort.slice(0, maxZeichen);
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen;
}

// Betrag mit Leerschlag als Tausendertrenner (Vorgabe Zahlteil).
export function betragZahlteil(betrag) {
  const [ganz, rappen] = Number(betrag).toFixed(2).split('.');
  return `${ganz.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${rappen}`;
}

function eckmarken(x0, y0, b, h) {
  const l = 3;
  return `<path d="M${x0} ${y0 + l}V${y0}H${x0 + l} M${x0 + b - l} ${y0}H${x0 + b}V${y0 + l}
    M${x0 + b} ${y0 + h - l}V${y0 + h}H${x0 + b - l} M${x0 + l} ${y0 + h}H${x0}V${y0 + h - l}"
    fill="none" stroke="#000" stroke-width="${0.75 * PT}"/>`;
}

// Textblock: Abschnitte aus Überschrift + Zeilen, ab Position (x0, y0).
function block(x0, y0, abschnitte, { titelPt, wertPt, zeilenPt, breite }) {
  let y = y0;
  const teile = [];
  for (const abschnitt of abschnitte) {
    y += titelPt * PT;
    teile.push(`<text x="${x0}" y="${y.toFixed(2)}" font-size="${titelPt * PT}" font-weight="700">${x(abschnitt.titel)}</text>`);
    if (abschnitt.leer) {
      y += 1;
      teile.push(eckmarken(x0, y, abschnitt.leer[0], abschnitt.leer[1]));
      y += abschnitt.leer[1];
    } else {
      for (const zeile of abschnitt.zeilen.flatMap((z) => umbrechen(z, breite, wertPt))) {
        y += zeilenPt * PT;
        teile.push(`<text x="${x0}" y="${y.toFixed(2)}" font-size="${wertPt * PT}">${x(zeile)}</text>`);
      }
    }
    y += zeilenPt * PT * 0.9; // Leerzeile zwischen den Abschnitten
  }
  return teile.join('');
}

function adressText(a) {
  return [a.name, [a.strasse, a.hausnummer].filter(Boolean).join(' '),
    [a.land && a.land !== 'CH' ? `${a.land}-${a.plz}` : a.plz, a.ort].filter(Boolean).join(' ')]
    .filter(Boolean);
}

// Schweizerkreuz in der Mitte des QR-Codes (7 × 7 mm).
function schweizerkreuz(mx, my) {
  const s = 7;
  const innen = 6;
  const balkenB = 1.17;
  const balkenL = 3.9;
  return `<rect x="${mx - s / 2}" y="${my - s / 2}" width="${s}" height="${s}" fill="#fff"/>
    <rect x="${mx - innen / 2}" y="${my - innen / 2}" width="${innen}" height="${innen}" fill="#000"/>
    <rect x="${mx - balkenB / 2}" y="${my - balkenL / 2}" width="${balkenB}" height="${balkenL}" fill="#fff"/>
    <rect x="${mx - balkenL / 2}" y="${my - balkenB / 2}" width="${balkenL}" height="${balkenB}" fill="#fff"/>`;
}

// Zahlteil + Empfangsschein als SVG-Text. Wirft einen Fehler, wenn die
// Angaben nicht genügen (vorher pruefeZahlteil nutzen).
export function zahlteilSvg(angaben) {
  const maengel = pruefeZahlteil(angaben);
  if (maengel.length) throw new Error(maengel.join(' '));
  const inhalt = qrInhalt(angaben);
  const qr = erzeugeQr(inhalt, { maxVersion: 25 });
  const firma = adresse(angaben.firma);
  const debitor = adresseVollstaendig(angaben.debitor) ? adresse(angaben.debitor) : null;
  const ref = kompakt(angaben.referenz);
  const betrag = betragZahlteil(angaben.betrag);
  const konto = [formatIban(angaben.firma.iban), ...adressText(firma)];

  // Empfangsschein (62 mm)
  const empfang = [
    { titel: 'Konto / Zahlbar an', zeilen: konto },
    ...(ref ? [{ titel: 'Referenz', zeilen: [formatReferenz(ref)] }] : []),
    debitor
      ? { titel: 'Zahlbar durch', zeilen: adressText(debitor) }
      : { titel: 'Zahlbar durch (Name/Adresse)', leer: [52, 20] },
  ];
  // Zahlteil-Angaben (rechte Spalte, ab x = 118 mm)
  const mitteilung = sauber(angaben.mitteilung, 140);
  const angabenZahlteil = [
    { titel: 'Konto / Zahlbar an', zeilen: konto },
    ...(ref ? [{ titel: 'Referenz', zeilen: [formatReferenz(ref)] }] : []),
    ...(mitteilung ? [{ titel: 'Zusätzliche Informationen', zeilen: [mitteilung] }] : []),
    debitor
      ? { titel: 'Zahlbar durch', zeilen: adressText(debitor) }
      : { titel: 'Zahlbar durch (Name/Adresse)', leer: [65, 25] },
  ];

  const qrX = 67;
  const qrY = 17;
  const modul = 46 / qr.groesse;

  return `<svg class="zahlteil-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 105"
    width="210mm" height="105mm" font-family='${SCHRIFT}' fill="#000" role="img"
    aria-label="QR-Rechnung: Zahlteil und Empfangsschein">
    <rect x="0" y="0" width="210" height="105" fill="#fff"/>
    <path d="M0 0.2H210 M62 0V105" stroke="#000" stroke-width="0.2" stroke-dasharray="1 0.8"/>
    <text x="4" y="1.4" font-size="3.4">✂</text>
    <text x="61.1" y="5" font-size="3.4" transform="rotate(90 62.3 4)">✂</text>

    <text x="5" y="${(5 + 11 * PT).toFixed(2)}" font-size="${11 * PT}" font-weight="700">Empfangsschein</text>
    ${block(5, 12, empfang, { titelPt: 6, wertPt: 8, zeilenPt: 9, breite: 52 })}
    <text x="5" y="${(68 + 6 * PT).toFixed(2)}" font-size="${6 * PT}" font-weight="700">Währung</text>
    <text x="17" y="${(68 + 6 * PT).toFixed(2)}" font-size="${6 * PT}" font-weight="700">Betrag</text>
    <text x="5" y="${(68 + 6 * PT + 9 * PT).toFixed(2)}" font-size="${8 * PT}">${x(angaben.waehrung || 'CHF')}</text>
    <text x="17" y="${(68 + 6 * PT + 9 * PT).toFixed(2)}" font-size="${8 * PT}">${x(betrag)}</text>
    <text x="57" y="${(82 + 6 * PT).toFixed(2)}" font-size="${6 * PT}" font-weight="700" text-anchor="end">Annahmestelle</text>

    <text x="67" y="${(5 + 11 * PT).toFixed(2)}" font-size="${11 * PT}" font-weight="700">Zahlteil</text>
    <rect x="${qrX - 1}" y="${qrY - 1}" width="48" height="48" fill="#fff"/>
    <g transform="translate(${qrX} ${qrY}) scale(${modul})">
      <path d="${qrPfad(qr)}" shape-rendering="crispEdges"/>
    </g>
    ${schweizerkreuz(qrX + 23, qrY + 23)}
    <text x="67" y="${(68 + 8 * PT).toFixed(2)}" font-size="${8 * PT}" font-weight="700">Währung</text>
    <text x="81" y="${(68 + 8 * PT).toFixed(2)}" font-size="${8 * PT}" font-weight="700">Betrag</text>
    <text x="67" y="${(68 + 8 * PT + 11 * PT).toFixed(2)}" font-size="${10 * PT}">${x(angaben.waehrung || 'CHF')}</text>
    <text x="81" y="${(68 + 8 * PT + 11 * PT).toFixed(2)}" font-size="${10 * PT}">${x(betrag)}</text>
    ${block(118, 5, angabenZahlteil, { titelPt: 8, wertPt: 10, zeilenPt: 11, breite: 87 })}
  </svg>`;
}
