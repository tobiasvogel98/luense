// kern/fo.js — die FO-5.1.01-Rechenlogik, 1:1 aus dem Excel im
// Altbestand übernommen (siehe Abgleich im Controlling-Modul).
// Im Kern, weil Controlling UND Dossier sie brauchen (Rule of two).
//   W5 = W1+W2+W3+W4 · W9 = W5+W6+W7+W8
//   W10 = W9·(1−Rabatt)·(1−Allg.Abz.)·(1−Skonto)
//   B6 = B1+…+B5 · A8 = A1+A2+Abgrenzungen+A6+A7 · A9 = A8·Nettofaktor
//   A13 = A9+B2+B3+B5 · S6 = S1+Abgrenzungen
//   K1 = A13/S6 − 1 · K3 = W10 − A13

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function berechneAbschluss(w) {
  const nettoFaktor = (1 - zahl(w.rabatt) / 100)
    * (1 - zahl(w.allgAbzug) / 100)
    * (1 - zahl(w.skonto) / 100);
  const w5 = zahl(w.w1) + zahl(w.w2) + zahl(w.w3) + zahl(w.w4);
  const w9 = w5 + zahl(w.w6) + zahl(w.w7) + zahl(w.w8);
  const w10 = w9 * nettoFaktor;
  const b6 = zahl(w.b1) + zahl(w.b2) + zahl(w.b3) + zahl(w.b4) + zahl(w.b5);
  const ausmassAbgrenzung = (w.ausmassAbgrenzungen || [])
    .reduce((s, a) => s + zahl(a.betrag), 0);
  const a8 = zahl(w.a1) + zahl(w.a2) + ausmassAbgrenzung + zahl(w.a6) + zahl(w.a7);
  const a9 = a8 * nettoFaktor;
  const a13 = a9 + zahl(w.b2) + zahl(w.b3) + zahl(w.b5);
  const s6 = zahl(w.s1) + (w.skAbgrenzungen || []).reduce((s, a) => s + zahl(a.betrag), 0);
  const k1 = s6 !== 0 ? a13 / s6 - 1 : null;
  const k3 = w10 - a13;
  return { nettoFaktor, w5, w9, w10, b6, a8, a9, a13, s6, k1, k3 };
}
