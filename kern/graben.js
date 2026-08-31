// kern/graben.js — Grabenrechner: Rechenlogik und Rohr-Bibliothek 1:1 aus
// dem Alt-Tool (Grabenprofil-Rechner) übernommen. Neu dazu: V-Graben
// (Trapezprofil mit Sohlen- und oberer Breite) — die Schichtvolumen
// (Bettung, Leitungsumhüllung, Auffüllung) rechnen dort mit der
// Trapezregel; beim U-Profil (Breite konstant) ergeben sich exakt die
// Formeln des Alt-Tools: Volumen = L · B · Schichthöhe.

export const ROHR_BIBLIOTHEK = [
  { type: 'kabel', d: 60 }, { type: 'kabel', d: 80 }, { type: 'kabel', d: 100 },
  { type: 'kabel', d: 120 }, { type: 'kabel', d: 150 },
  { type: 'ew', d: 120 }, { type: 'ew', d: 160 },
  { type: 'wasser', d: 125 }, { type: 'wasser', d: 150 },
  { type: 'gas', d: 63 }, { type: 'gas', d: 90 }, { type: 'gas', d: 110 },
  { type: 'gas', d: 125 }, { type: 'gas', d: 160 },
  { type: 'kanal', d: 160 }, { type: 'kanal', d: 200 }, { type: 'kanal', d: 250 },
  { type: 'kanal', d: 315 }, { type: 'kanal', d: 400 },
];

export const ROHR_FARBEN = {
  kabel: '#FF8C00', ew: '#C62828', wasser: '#1976D2', gas: '#F9A825', kanal: '#5D4037',
};

export const ROHR_LABELS = {
  kabel: 'Kabelschutzrohr', ew: 'EW-Rohr', wasser: 'Wasserleitung',
  gas: 'Gasleitung', kanal: 'Kanalisation',
};

const SCHICHT_FARBEN = { auffuellung: '#A0826D', verdaemmung: '#E8D49B', bettung: '#D4B896' };

// Vorgabewerte je Grabenart — unverändert aus dem Alt-Tool.
export const GRABENARTEN = {
  wasser: { name: 'Wassergraben', teile: [
    { name: 'Wasserleitung', profil: 'u', B: 0.80, BOben: 0.80, H: 1.50, hBett: 0.10, hUeber: 0.30,
      pipes: [{ type: 'wasser', d: 125, z: 0.20, x: 0 }] },
  ] },
  kanal: { name: 'Kanalisationsgraben', teile: [
    { name: 'Kanalisation', profil: 'u', B: 1.00, BOben: 1.00, H: 1.80, hBett: 0.15, hUeber: 0.30,
      pipes: [{ type: 'kanal', d: 200, z: 0.25, x: 0 }] },
  ] },
  ew: { name: 'EW-/Elektrograben', teile: [
    { name: 'EW / Elektro', profil: 'u', B: 0.60, BOben: 0.60, H: 1.00, hBett: 0.10, hUeber: 0.40,
      pipes: [
        { type: 'kabel', d: 120, z: 0.16, x: -0.14 },
        { type: 'kabel', d: 120, z: 0.16, x: 0.14 },
        { type: 'kabel', d: 80, z: 0.34, x: 0 },
      ] },
  ] },
  gas: { name: 'Gasgraben', teile: [
    { name: 'Gasleitung', profil: 'u', B: 0.70, BOben: 0.70, H: 1.20, hBett: 0.10, hUeber: 0.40,
      pipes: [{ type: 'gas', d: 110, z: 0.18, x: 0 }] },
  ] },
  kombi: { name: 'Kombigraben (Stufen)', teile: [
    { name: 'Wasserleitung', profil: 'u', B: 0.60, BOben: 0.60, H: 1.45, hBett: 0.10, hUeber: 0.30,
      pipes: [{ type: 'wasser', d: 125, z: 0.20, x: 0 }] },
    { name: 'EW-Rohrblock', profil: 'u', B: 0.70, BOben: 0.70, H: 1.15, hBett: 0.10, hUeber: 0.30,
      pipes: [
        { type: 'kabel', d: 120, z: 0.16, x: -0.15 },
        { type: 'kabel', d: 120, z: 0.16, x: 0.15 },
        { type: 'kabel', d: 100, z: 0.40, x: 0 },
      ] },
  ] },
};

// Grabenbreite auf Höhe h ab Sohle: U konstant, V linear Sohle→oben.
function breiteBei(teil, h) {
  if (teil.profil === 'v' && teil.H > 0) {
    const anteil = Math.min(Math.max(h / teil.H, 0), 1);
    return teil.B + (teil.BOben - teil.B) * anteil;
  }
  return teil.B;
}

// Schichtvolumen von Höhe `von` bis `bis` (Trapezregel; beim U-Profil
// exakt L·B·Höhe wie im Alt-Tool).
function schichtVolumen(L, teil, von, bis) {
  const hoehe = Math.max(0, bis - von);
  if (hoehe === 0) return 0;
  return L * ((breiteBei(teil, von) + breiteBei(teil, bis)) / 2) * hoehe;
}

// Berechnung pro Grabenteil — Ablauf und Warnungen wie calcSection im
// Alt-Tool, Volumen über schichtVolumen (deckt U und V ab).
export function berechneTeil(L, teil) {
  const { H, hBett, hUeber, pipes } = teil;
  const vAushub = schichtVolumen(L, teil, 0, H);
  const vBettung = schichtVolumen(L, teil, 0, hBett);
  let highestTop = hBett;
  let pipeVol = 0;
  for (const p of pipes) {
    const top = p.z + p.d / 2000;
    if (top > highestTop) highestTop = top;
    pipeVol += L * Math.PI * Math.pow(p.d / 2000, 2);
  }
  let verdaemmTop;
  let vVerdBrutto;
  let vVerdNetto;
  let vAuf;
  if (pipes.length > 0) {
    verdaemmTop = highestTop + hUeber;
    vVerdBrutto = schichtVolumen(L, teil, hBett, verdaemmTop);
    vVerdNetto = Math.max(0, vVerdBrutto - pipeVol);
    vAuf = schichtVolumen(L, teil, verdaemmTop, H);
  } else {
    verdaemmTop = hBett;
    vVerdBrutto = 0;
    vVerdNetto = 0;
    vAuf = schichtVolumen(L, teil, hBett, H);
  }
  const warnings = [];
  pipes.forEach((p, i) => {
    if (p.z - p.d / 2000 < hBett - 1e-6) {
      warnings.push(`${teil.name} – Rohr ${i + 1}: liegt in der Bettung`);
    }
    if (p.z + p.d / 2000 + hUeber > H + 1e-6) {
      warnings.push(`${teil.name} – Rohr ${i + 1}: Überdeckung ragt aus dem Graben`);
    }
    // Seitlich: beim V-Graben ist die Breite an der unteren Rohrkante massgebend.
    const halbeBreite = breiteBei(teil, Math.max(0, p.z - p.d / 2000)) / 2;
    if (Math.abs(p.x) + p.d / 2000 > halbeBreite + 1e-6) {
      warnings.push(`${teil.name} – Rohr ${i + 1}: ragt seitlich aus dem Graben`);
    }
  });
  return {
    aushub: vAushub,
    bettung: vBettung,
    verdaemmungBrutto: vVerdBrutto,
    verdaemmungNetto: vVerdNetto,
    rohrVolumen: pipeVol,
    auffuellung: vAuf,
    sandTotal: vBettung + vVerdNetto,
    verdaemmTop,
    warnings,
  };
}

// Querschnitt-Skizze als SVG: Schichten, Rohre, Hauptmasse.
export function querschnittSvg(teil) {
  const H = teil.H || 1;
  const Bu = teil.B || 0.5;
  const Bo = teil.profil === 'v' ? (teil.BOben || Bu) : Bu;
  const maxB = Math.max(Bu, Bo);
  const massstab = 150 / Math.max(maxB, H);
  const rand = 34;
  const breitePx = maxB * massstab + rand * 2;
  const hoehePx = H * massstab + rand * 2;
  const mitte = breitePx / 2;
  const y = (h) => rand + (H - h) * massstab; // h ab Sohle → Pixel-y
  const halbe = (h) => (breiteBei(teil, h) * massstab) / 2;
  const band = (von, bis, farbe) => {
    if (bis <= von) return '';
    return `<polygon fill="${farbe}" points="
      ${mitte - halbe(von)},${y(von)} ${mitte + halbe(von)},${y(von)}
      ${mitte + halbe(bis)},${y(bis)} ${mitte - halbe(bis)},${y(bis)}"/>`;
  };
  const erg = berechneTeil(1, teil);
  const rohre = (teil.pipes || []).map((p) => {
    const r = (p.d / 2000) * massstab;
    return `<circle cx="${mitte + p.x * massstab}" cy="${y(p.z)}" r="${r}"
      fill="${ROHR_FARBEN[p.type] || '#666'}" stroke="#1c1b18" stroke-width="1"/>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${breitePx} ${hoehePx}" class="graben-skizze"
      role="img" aria-label="Querschnitt ${esc2(teil.name)}">
      ${band(erg.verdaemmTop, H, SCHICHT_FARBEN.auffuellung)}
      ${band(teil.hBett, Math.min(erg.verdaemmTop, H), SCHICHT_FARBEN.verdaemmung)}
      ${band(0, teil.hBett, SCHICHT_FARBEN.bettung)}
      <polyline points="${mitte - halbe(H)},${y(H)} ${mitte - halbe(0)},${y(0)}
        ${mitte + halbe(0)},${y(0)} ${mitte + halbe(H)},${y(H)}"
        fill="none" stroke="#1c1b18" stroke-width="2"/>
      ${rohre}
      <text x="${mitte}" y="${y(0) + 14}" text-anchor="middle" class="mass">${Bu.toFixed(2)} m</text>
      ${teil.profil === 'v' ? `<text x="${mitte}" y="${y(H) - 6}" text-anchor="middle" class="mass">${Bo.toFixed(2)} m</text>` : ''}
      <text x="${mitte + halbe(H) + 6}" y="${(y(0) + y(H)) / 2}" class="mass">T ${H.toFixed(2)} m</text>
    </svg>`;
}

function esc2(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
