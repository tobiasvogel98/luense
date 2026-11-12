// kern/pdfdatei.js — echte PDF-Datei (application/pdf) ohne Bibliothek,
// z. B. als Mail-Anhang über den Teilen-Dialog. Die Druckansichten in
// kern/pdf.js bleiben für «Drucken / als PDF speichern»; eine Datei zum
// Weitergeben braucht aber Bytes, nicht den Druckdialog.
//
// Umfang bewusst klein: A4-Seiten, Text in Helvetica / Helvetica-Bold
// (Standardschriften jedes PDF-Programms, nichts eingebettet, Zeichensatz
// WinAnsi: Umlaute, «», ’, €), Linien, Rechtecke und der QR-Zahlteil als
// Vektorgrafik (kern/qrrechnung.js, zahlteilElemente). Masse in mm, y von
// oben gemessen wie im SVG.
//
// Gebraucht von module/rechnung.js (Mahnung als Mail-Anhang).

import { PT } from './qrrechnung.js';

const MM = 72 / 25.4; // 1 mm in PDF-Punkten
const SEITE = { b: 210, h: 297 };

// Zeichenbreiten (1/1000 em) der Standardschriften, ASCII 32 bis 126.
const BREITE_NORMAL = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
  722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BREITE_FETT = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722,
  722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Einige Zeichen oberhalb ASCII: [normal, fett].
const BREITE_EXTRA = {
  0x80: [556, 556], 0x84: [333, 500], 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278],
  0x93: [333, 500], 0x94: [333, 500], 0x96: [556, 556], 0x97: [1000, 1000], 0xA0: [278, 278],
  0xAB: [556, 556], 0xBB: [556, 556], 0xB0: [400, 400], 0xD7: [584, 584], 0xDF: [611, 611],
  0xE6: [889, 889], 0xC6: [1000, 1000], 0xF8: [611, 611], 0xD8: [778, 778], 0xA7: [556, 556],
};
// WinAnsi-Codes ausserhalb Latin-1.
const WIN_ANSI = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, 'Š': 0x8A, 'š': 0x9A, 'Ž': 0x8E, 'ž': 0x9E,
  'Œ': 0x8C, 'œ': 0x9C, 'Ÿ': 0x9F,
};
const ERSATZ = { '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', '✂': '' };

// Text → Liste von WinAnsi-Codes (nicht darstellbare Zeichen werden «?»).
function codes(text) {
  const liste = [];
  for (const zeichen of String(text ?? '')) {
    const z = ERSATZ[zeichen] ?? zeichen;
    if (!z) continue;
    const c = z.codePointAt(0);
    if (WIN_ANSI[z]) liste.push(WIN_ANSI[z]);
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) liste.push(c);
    else if (c === 9 || c === 10) liste.push(32);
    else liste.push(63);
  }
  return liste;
}

function zeichenBreite(c, fett) {
  if (c >= 32 && c <= 126) return (fett ? BREITE_FETT : BREITE_NORMAL)[c - 32];
  if (BREITE_EXTRA[c]) return BREITE_EXTRA[c][fett ? 1 : 0];
  if (c >= 0xC0) {
    // Akzentbuchstaben: Breite des Grundbuchstabens (ä wie a)
    const basis = String.fromCharCode(c).normalize('NFD').charCodeAt(0);
    if (basis >= 32 && basis <= 126) return (fett ? BREITE_FETT : BREITE_NORMAL)[basis - 32];
  }
  return 556;
}

// Breite eines Textes in mm bei «groessePt».
export function textBreite(text, groessePt, fett = false) {
  return codes(text).reduce((s, c) => s + zeichenBreite(c, fett), 0) / 1000 * groessePt / MM;
}

// Zeilenumbruch nach echter Zeichenbreite; überlange Wörter werden geteilt.
export function umbrechen(text, breiteMm, groessePt, fett = false) {
  const zeilen = [];
  for (const absatz of String(text ?? '').split('\n')) {
    let aktuell = '';
    for (const wort of absatz.split(/ +/).filter(Boolean)) {
      const versuch = aktuell ? `${aktuell} ${wort}` : wort;
      if (textBreite(versuch, groessePt, fett) <= breiteMm) {
        aktuell = versuch;
        continue;
      }
      if (aktuell) zeilen.push(aktuell);
      aktuell = wort;
      while (textBreite(aktuell, groessePt, fett) > breiteMm && aktuell.length > 1) {
        let n = aktuell.length - 1;
        while (n > 1 && textBreite(aktuell.slice(0, n), groessePt, fett) > breiteMm) n--;
        zeilen.push(aktuell.slice(0, n));
        aktuell = aktuell.slice(n);
      }
    }
    zeilen.push(aktuell);
  }
  return zeilen;
}

function pdfText(text) {
  return `(${codes(text).map((c) => {
    if (c === 0x28 || c === 0x29 || c === 0x5C) return `\\${String.fromCharCode(c)}`;
    if (c < 32 || c > 126) return `\\${c.toString(8).padStart(3, '0')}`;
    return String.fromCharCode(c);
  }).join('')})`;
}

const zahl = (n) => (Math.round(n * 1000) / 1000).toString();
const px = (mm) => zahl(mm * MM);
const py = (mm) => zahl((SEITE.h - mm) * MM);

// Eine Seite: sammelt Zeichenbefehle (Masse in mm, y von oben).
class Seite {
  constructor() {
    this.befehle = [];
  }

  // optionen: groesse (pt), fett, anker ('start' | 'end' | 'middle'), grau (0 = schwarz)
  text(x, y, text, { groesse = 10, fett = false, anker = 'start', grau = 0 } = {}) {
    if (text === '' || text == null) return;
    let x0 = x;
    if (anker !== 'start') {
      const b = textBreite(text, groesse, fett);
      x0 = anker === 'end' ? x - b : x - b / 2;
    }
    this.befehle.push(`BT ${zahl(grau)} g /${fett ? 'F2' : 'F1'} ${zahl(groesse)} Tf `
      + `${px(x0)} ${py(y)} Td ${pdfText(text)} Tj ET`);
  }

  rechteck(x, y, b, h, { grau = 0 } = {}) {
    this.befehle.push(`${zahl(grau)} g ${px(x)} ${py(y + h)} ${zahl(b * MM)} ${zahl(h * MM)} re f`);
  }

  // pfade: [[[x, y], [x, y], …], …] als offene Linienzüge.
  linie(pfade, { breite = 0.2, strich = null } = {}) {
    const d = pfade.map((punkte) => punkte.map(([x, y], i) =>
      `${px(x)} ${py(y)} ${i ? 'l' : 'm'}`).join(' ')).join(' ');
    this.befehle.push(`q 0 G ${zahl(breite * MM)} w ${strich
      ? `[${strich.map((s) => zahl(s * MM)).join(' ')}] 0 d` : '[] 0 d'} ${d} S Q`);
  }

  // QR-Matrix: dunkle Module zeilenweise als Rechtecke.
  qr(x, y, modul, matrix) {
    const teile = [];
    matrix.module.forEach((zeile, zy) => {
      let zx = 0;
      while (zx < zeile.length) {
        if (!zeile[zx]) { zx++; continue; }
        const start = zx;
        while (zx < zeile.length && zeile[zx]) zx++;
        teile.push(`${px(x + start * modul)} ${py(y + (zy + 1.02) * modul)} `
          + `${zahl((zx - start) * modul * MM)} ${zahl(1.02 * modul * MM)} re`);
      }
    });
    this.befehle.push(`0 g ${teile.join(' ')} f`);
  }

  // Grafik-Elemente (z. B. Zahlteil) mit Versatz in mm zeichnen.
  zeichne(elemente, { dx = 0, dy = 0 } = {}) {
    for (const e of elemente) {
      if (e.art === 'rechteck') {
        this.rechteck(e.x + dx, e.y + dy, e.b, e.h, { grau: e.farbe === '#fff' ? 1 : 0 });
      } else if (e.art === 'linie') {
        this.linie(e.pfade.map((p) => p.map(([x, y]) => [x + dx, y + dy])),
          { breite: e.breite, strich: e.strich });
      } else if (e.art === 'text') {
        this.text(e.x + dx, e.y + dy, e.text, { groesse: e.groesse / PT, fett: e.fett, anker: e.anker });
      } else if (e.art === 'schere') {
        // Scheren-Symbol nicht im PDF: ZapfDingbats fehlt in manchen
        // Programmen. Stattdessen steht «Vor der Einzahlung abzutrennen»
        // über der Trennlinie (zulässig nach den SIX-Richtlinien).
      } else if (e.art === 'qr') {
        this.qr(e.x + dx, e.y + dy, e.modul, e.matrix);
      }
    }
  }
}

// Mehrseitiges Dokument; blob() liefert die fertige Datei.
export class PdfDokument {
  constructor({ titel = '', autor = '' } = {}) {
    this.seiten = [];
    this.titel = titel;
    this.autor = autor;
  }

  neueSeite() {
    const seite = new Seite();
    this.seiten.push(seite);
    return seite;
  }

  bytes() {
    const objekte = [];
    const neu = (inhalt) => { objekte.push(inhalt); return objekte.length; };
    const katalog = neu('');
    const seitenBaum = neu('');
    const f1 = neu('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = neu('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kinder = this.seiten.map((seite) => {
      const strom = seite.befehle.join('\n');
      const inhalt = neu(`<< /Length ${strom.length} >>\nstream\n${strom}\nendstream`);
      return neu(`<< /Type /Page /Parent ${seitenBaum} 0 R /MediaBox [0 0 ${px(SEITE.b)} ${px(SEITE.h)}] `
        + `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${inhalt} 0 R >>`);
    });
    objekte[katalog - 1] = `<< /Type /Catalog /Pages ${seitenBaum} 0 R >>`;
    objekte[seitenBaum - 1] = `<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(' ')}] /Count ${kinder.length} >>`;
    const jetzt = new Date();
    const d = (n) => String(n).padStart(2, '0');
    const info = neu(`<< /Title ${pdfText(this.titel)} /Author ${pdfText(this.autor)} /Producer (Luense) `
      + `/CreationDate (D:${jetzt.getFullYear()}${d(jetzt.getMonth() + 1)}${d(jetzt.getDate())}`
      + `${d(jetzt.getHours())}${d(jetzt.getMinutes())}${d(jetzt.getSeconds())}) >>`);
    let text = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const versatz = [];
    objekte.forEach((inhalt, i) => {
      versatz.push(text.length);
      text += `${i + 1} 0 obj\n${inhalt}\nendobj\n`;
    });
    const xref = text.length;
    text += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${
      versatz.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('')}`;
    text += `trailer\n<< /Size ${objekte.length + 1} /Root ${katalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xFF;
    return bytes;
  }

  blob() {
    return new Blob([this.bytes()], { type: 'application/pdf' });
  }
}

// ---------- Brief mit Abschnitten (gleiches Modell wie zeigeProtokollDruck) ----------
// brief: { titel, absender: [Zeilen], empfaenger: [Zeilen], ortDatum,
//   abschnitte: [{ art: 'text' | 'felder' | 'summen', titel, absaetze | zeilen }],
//   zahlteil: Elemente aus zahlteilElemente() oder null, zahlteilHinweis,
//   zahlteilEigeneSeite }
// Der Zahlteil steht unten auf der letzten Seite (105 mm hoch); mit
// zahlteilEigeneSeite oder wenn der Brief nicht darüber passt, unten auf
// einer eigenen Seite.
export function briefPdf(brief) {
  const doc = new PdfDokument({ titel: brief.titel, autor: brief.absender?.[0] || '' });
  const LINKS = 20;
  const RECHTS = 195;
  const BREITE = RECHTS - LINKS;
  const UNTEN = 280;
  const zeile = (pt) => pt * 1.3 / MM;
  let seite = doc.neueSeite();
  let y = 15;

  const platz = (hoehe) => {
    if (y + hoehe <= UNTEN) return;
    seite = doc.neueSeite();
    y = 20;
  };

  // Absender oben links, Empfänger im Fenster rechts (Fenster rechts, CH)
  (brief.absender || []).forEach((t, i) => {
    seite.text(LINKS, y + zeile(i ? 9 : 11) * 0.8, t, { groesse: i ? 9 : 11, fett: i === 0 });
    y += zeile(i ? 9 : 11);
  });
  let ye = 52;
  for (const t of brief.empfaenger || []) {
    ye += zeile(10.5);
    seite.text(118, ye, t, { groesse: 10.5 });
  }
  y = Math.max(y, ye) + 14;
  if (brief.ortDatum) {
    seite.text(LINKS, y, brief.ortDatum, { groesse: 10 });
    y += 10;
  }
  for (const t of umbrechen(brief.titel, BREITE, 13, true)) {
    seite.text(LINKS, y, t, { groesse: 13, fett: true });
    y += zeile(13);
  }
  y += 3;

  for (const abschnitt of brief.abschnitte || []) {
    if (abschnitt.titel) {
      platz(zeile(10.5) + zeile(10) * 2);
      y += 2;
      seite.text(LINKS, y, abschnitt.titel, { groesse: 10.5, fett: true });
      y += zeile(10.5) + 0.5;
    }
    if (abschnitt.art === 'text') {
      for (const absatz of abschnitt.absaetze) {
        const zeilen = umbrechen(absatz, BREITE, 10);
        for (const t of zeilen) {
          platz(zeile(10));
          seite.text(LINKS, y, t, { groesse: 10 });
          y += zeile(10);
        }
        y += 2;
      }
    } else if (abschnitt.art === 'felder') {
      const LABEL = 62;
      for (const z of abschnitt.zeilen) {
        const werte = umbrechen(z.wert, BREITE - LABEL, 10);
        const labels = umbrechen(z.label, LABEL - 3, 10);
        platz(zeile(10) * Math.max(werte.length, labels.length));
        labels.forEach((t, i) => seite.text(LINKS, y + i * zeile(10), t, { groesse: 10, grau: 0.3 }));
        werte.forEach((t, i) => seite.text(LINKS + LABEL, y + i * zeile(10), t, { groesse: 10 }));
        y += zeile(10) * Math.max(werte.length, labels.length) + 0.6;
      }
      y += 1.5;
    } else if (abschnitt.art === 'summen') {
      for (const z of abschnitt.zeilen) {
        const labels = umbrechen(z.label, BREITE - 40, 10, !!z.total);
        platz(zeile(10) * labels.length + (z.total ? 2 : 0));
        if (z.total) {
          seite.linie([[[LINKS, y - zeile(10) * 0.8], [RECHTS, y - zeile(10) * 0.8]]], { breite: 0.3 });
          y += 1;
        }
        labels.forEach((t, i) => seite.text(LINKS, y + i * zeile(10), t, { groesse: 10, fett: !!z.total }));
        seite.text(RECHTS, y + (labels.length - 1) * zeile(10), z.wert, { groesse: 10, fett: !!z.total, anker: 'end' });
        y += zeile(10) * labels.length + 0.8;
      }
      y += 1.5;
    }
  }

  if (brief.zahlteil) {
    const OBEN = SEITE.h - 105;
    if (brief.zahlteilEigeneSeite || y > OBEN - 8) {
      seite = doc.neueSeite();
      if (brief.zahlteilHinweis) seite.text(LINKS, 20, brief.zahlteilHinweis, { groesse: 9, grau: 0.3 });
    }
    seite.text(105, OBEN - 2, 'Vor der Einzahlung abzutrennen', { groesse: 7, anker: 'middle', grau: 0.3 });
    seite.zeichne(brief.zahlteil, { dy: OBEN });
  }
  return doc.blob();
}
