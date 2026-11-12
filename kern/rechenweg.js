// kern/rechenweg.js — Mengen als Zahl oder Rechenweg («12.5*3 + 4,2*2»).
// Gebraucht von module/offert.js (Offert-Menge) und module/ausmass.js
// (ausgemessene Menge der Baustelle) — Rule of two erfüllt.
// Gespeichert wird an der Position: menge (Ergebnis), mengeQuelle
// 'rechenweg' und mengeFormel (der getippte Rechenweg).

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

// Getippte Mengen-Eingabe auswerten: leer → { leer: true }, Zahl →
// { menge }, Rechenweg → { menge, formel }, ungültig → { fehler }.
export function werteMengeAus(text) {
  const t = String(text ?? '').trim();
  if (!t) return { leer: true, menge: '' };
  if (!istRechenweg(t)) {
    const n = parseFloat(t.replace(/['’\s]/g, '').replace(',', '.'));
    return { menge: String(Number.isFinite(n) ? n : 0) };
  }
  try {
    return { menge: String(rechneRechenweg(t)), formel: t };
  } catch (fehler) {
    return { fehler: `Rechenweg ungültig: ${fehler.message}` };
  }
}
