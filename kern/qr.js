// kern/qr.js — QR-Code-Erzeugung ohne Bibliothek (ISO/IEC 18004).
// Bewusst schlank: nur Byte-Modus (UTF-8) und Fehlerkorrektur-Stufe M —
// genau das, was der Swiss QR Code der QR-Rechnung verlangt (SIX IG
// QR-Rechnung: Stufe M, höchstens Version 25). Versionen 1–40 werden
// unterstützt; die kleinste passende wird gewählt.
// Aufbau nach dem bekannten Referenz-Algorithmus: Daten-Bits → Reed-
// Solomon je Block → Verschränken → Zickzack-Platzierung → beste Maske
// nach den Strafpunkt-Regeln N1–N4 → Format- und Versionsinformation.
// Ergebnis: Matrix (Array von Zeilen, true = dunkles Modul).

// Stufe M: Fehlerkorrektur-Codewörter je Block und Anzahl Blöcke je Version.
const ECC_JE_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24,
  28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28];
const BLOECKE = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
  16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_STUFE_M = 0; // Formatbits der Stufe M (L=1, M=0, Q=3, H=2)

// Anzahl Module, die für Daten + Fehlerkorrektur bleiben.
function rohModule(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const ausrichtung = Math.floor(version / 7) + 2;
    n -= (25 * ausrichtung - 10) * ausrichtung - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

function datenCodewoerter(version) {
  return Math.floor(rohModule(version) / 8) - ECC_JE_BLOCK[version] * BLOECKE[version];
}

// ---------- Reed-Solomon über GF(256), Polynom 0x11D ----------
function gfMal(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsTeiler(grad) {
  const teiler = new Array(grad).fill(0);
  teiler[grad - 1] = 1;
  let wurzel = 1;
  for (let i = 0; i < grad; i++) {
    for (let j = 0; j < teiler.length; j++) {
      teiler[j] = gfMal(teiler[j], wurzel);
      if (j + 1 < teiler.length) teiler[j] ^= teiler[j + 1];
    }
    wurzel = gfMal(wurzel, 0x02);
  }
  return teiler;
}

function rsRest(daten, teiler) {
  const rest = teiler.map(() => 0);
  for (const b of daten) {
    const faktor = b ^ rest.shift();
    rest.push(0);
    teiler.forEach((koeff, i) => { rest[i] ^= gfMal(koeff, faktor); });
  }
  return rest;
}

// ---------- Daten-Bitstrom (Byte-Modus) ----------
function datenBytes(bytes, version) {
  const bits = [];
  const schreibe = (wert, laenge) => {
    for (let i = laenge - 1; i >= 0; i--) bits.push((wert >>> i) & 1);
  };
  schreibe(0b0100, 4); // Byte-Modus
  schreibe(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) schreibe(b, 8);
  const kapazitaet = datenCodewoerter(version) * 8;
  schreibe(0, Math.min(4, kapazitaet - bits.length)); // Abschluss
  while (bits.length % 8) bits.push(0);
  const codewoerter = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewoerter.push(bits.slice(i, i + 8).reduce((s, b) => (s << 1) | b, 0));
  }
  for (let fuell = 0xec; codewoerter.length < datenCodewoerter(version); fuell ^= 0xec ^ 0x11) {
    codewoerter.push(fuell);
  }
  return codewoerter;
}

// Fehlerkorrektur je Block anhängen und Blöcke verschränken.
function mitFehlerkorrektur(daten, version) {
  const anzahl = BLOECKE[version];
  const eccLaenge = ECC_JE_BLOCK[version];
  const roh = Math.floor(rohModule(version) / 8);
  const kurze = anzahl - (roh % anzahl);
  const kurzLaenge = Math.floor(roh / anzahl);
  const teiler = rsTeiler(eccLaenge);
  const bloecke = [];
  for (let i = 0, k = 0; i < anzahl; i++) {
    const teil = daten.slice(k, k + kurzLaenge - eccLaenge + (i < kurze ? 0 : 1));
    k += teil.length;
    const ecc = rsRest(teil, teiler);
    if (i < kurze) teil.push(0); // Platzhalter, beim Verschränken übersprungen
    bloecke.push(teil.concat(ecc));
  }
  const ergebnis = [];
  for (let i = 0; i < bloecke[0].length; i++) {
    bloecke.forEach((block, j) => {
      if (i !== kurzLaenge - eccLaenge || j >= kurze) ergebnis.push(block[i]);
    });
  }
  return ergebnis;
}

// ---------- Matrix ----------
function ausrichtungsPositionen(version, groesse) {
  if (version === 1) return [];
  const anzahl = Math.floor(version / 7) + 2;
  const schritt = version === 32 ? 26
    : Math.ceil((version * 4 + 4) / (anzahl * 2 - 2)) * 2;
  const positionen = [6];
  for (let p = groesse - 7; positionen.length < anzahl; p -= schritt) positionen.splice(1, 0, p);
  return positionen;
}

function bit(wert, i) {
  return ((wert >>> i) & 1) !== 0;
}

function maskeTrifft(maske, x, y) {
  switch (maske) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function baueGrundmatrix(version) {
  const groesse = version * 4 + 17;
  const module = Array.from({ length: groesse }, () => new Array(groesse).fill(false));
  const funktion = Array.from({ length: groesse }, () => new Array(groesse).fill(false));
  const setze = (x, y, dunkel) => {
    module[y][x] = dunkel;
    funktion[y][x] = true;
  };
  // Taktlinien
  for (let i = 0; i < groesse; i++) {
    setze(6, i, i % 2 === 0);
    setze(i, 6, i % 2 === 0);
  }
  // Positionsmuster samt Trennrand
  for (const [cx, cy] of [[3, 3], [groesse - 4, 3], [3, groesse - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= groesse || y >= groesse) continue;
        const abstand = Math.max(Math.abs(dx), Math.abs(dy));
        setze(x, y, abstand !== 2 && abstand !== 4);
      }
    }
  }
  // Ausrichtungsmuster
  const pos = ausrichtungsPositionen(version, groesse);
  const letzte = pos.length - 1;
  pos.forEach((px, i) => pos.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === letzte) || (i === letzte && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setze(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }));
  // Formatbereich reservieren (wird nach der Maskenwahl beschrieben)
  for (let i = 0; i < 9; i++) {
    funktion[8][i] = true;
    funktion[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    funktion[8][groesse - 1 - i] = true;
    funktion[groesse - 1 - i][8] = true;
  }
  setze(8, groesse - 8, true); // dunkles Modul
  // Versionsinformation ab Version 7
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const a = groesse - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setze(a, b, bit(bits, i));
      setze(b, a, bit(bits, i));
    }
  }
  return { groesse, module, funktion };
}

function platziereDaten({ groesse, module, funktion }, codewoerter) {
  let i = 0;
  const gesamt = codewoerter.length * 8;
  for (let rechts = groesse - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let senkrecht = 0; senkrecht < groesse; senkrecht++) {
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        const aufwaerts = ((rechts + 1) & 2) === 0;
        const y = aufwaerts ? groesse - 1 - senkrecht : senkrecht;
        if (!funktion[y][x] && i < gesamt) {
          module[y][x] = bit(codewoerter[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function schreibeFormat(module, groesse, maske) {
  const daten = (FORMAT_STUFE_M << 3) | maske;
  let rest = daten;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  const bits = ((daten << 10) | rest) ^ 0x5412;
  const setze = (x, y, dunkel) => { module[y][x] = dunkel; };
  for (let i = 0; i <= 5; i++) setze(8, i, bit(bits, i));
  setze(8, 7, bit(bits, 6));
  setze(8, 8, bit(bits, 7));
  setze(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setze(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setze(groesse - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setze(8, groesse - 15 + i, bit(bits, i));
  setze(8, groesse - 8, true);
}

// Strafpunkte N1–N4 (ISO/IEC 18004, Abschnitt 7.8.3).
function strafpunkte(module) {
  const n = module.length;
  let punkte = 0;
  const zeile = (y) => module[y];
  const spalte = (x) => module.map((z) => z[x]);
  const linien = [];
  for (let i = 0; i < n; i++) linien.push(zeile(i), spalte(i));
  const muster1 = [true, false, true, true, true, false, true, false, false, false, false];
  const muster2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (const linie of linien) {
    // N1: fünf und mehr gleichfarbige Module in Folge
    let lauf = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && linie[i] === linie[i - 1]) {
        lauf++;
      } else {
        if (lauf >= 5) punkte += 3 + (lauf - 5);
        lauf = 1;
      }
    }
    // N3: positionsmusterähnliche Folge 1:1:3:1:1 mit 4 hellen Modulen
    for (let i = 0; i + 11 <= n; i++) {
      let gleich1 = true;
      let gleich2 = true;
      for (let k = 0; k < 11; k++) {
        if (linie[i + k] !== muster1[k]) gleich1 = false;
        if (linie[i + k] !== muster2[k]) gleich2 = false;
      }
      if (gleich1) punkte += 40;
      if (gleich2) punkte += 40;
    }
  }
  // N2: 2×2-Blöcke gleicher Farbe
  let dunkle = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (module[y][x]) dunkle++;
      if (x < n - 1 && y < n - 1) {
        const f = module[y][x];
        if (f === module[y][x + 1] && f === module[y + 1][x] && f === module[y + 1][x + 1]) {
          punkte += 3;
        }
      }
    }
  }
  // N4: Anteil dunkler Module weit weg von 50 %
  const k = Math.ceil(Math.abs(dunkle * 20 - n * n * 10) / (n * n)) - 1;
  punkte += Math.max(0, k) * 10;
  return punkte;
}

export function utf8Bytes(text) {
  return [...new TextEncoder().encode(String(text))];
}

// Erzeugt die QR-Matrix für einen Text (UTF-8, Byte-Modus, Stufe M).
// Optionen: minVersion, maxVersion (Standard 1…40), maske (0–7, sonst
// automatisch). Wirft einen Fehler, wenn der Text nicht passt.
export function erzeugeQr(text, { minVersion = 1, maxVersion = 40, maske = null } = {}) {
  const bytes = utf8Bytes(text);
  let version = minVersion;
  for (; version <= maxVersion; version++) {
    const noetig = 4 + (version <= 9 ? 8 : 16) + bytes.length * 8;
    if (noetig <= datenCodewoerter(version) * 8) break;
  }
  if (version > maxVersion) throw new Error('Text zu lang für den QR-Code.');
  const codewoerter = mitFehlerkorrektur(datenBytes(bytes, version), version);
  const grund = baueGrundmatrix(version);
  platziereDaten(grund, codewoerter);
  const kandidaten = maske === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [maske];
  let beste = null;
  for (const m of kandidaten) {
    const module = grund.module.map((zeile, y) => zeile.map((dunkel, x) =>
      (!grund.funktion[y][x] && maskeTrifft(m, x, y) ? !dunkel : dunkel)));
    schreibeFormat(module, grund.groesse, m);
    const punkte = kandidaten.length > 1 ? strafpunkte(module) : 0;
    if (!beste || punkte < beste.punkte) beste = { module, punkte, maske: m };
  }
  return { version, groesse: grund.groesse, maske: beste.maske, module: beste.module };
}

// SVG-Pfad der dunklen Module (eine Einheit je Modul, ohne Ruhezone) —
// zeilenweise zusammengefasst, damit das SVG klein bleibt.
export function qrPfad(matrix) {
  const teile = [];
  matrix.module.forEach((zeile, y) => {
    let x = 0;
    while (x < zeile.length) {
      if (!zeile[x]) { x++; continue; }
      const start = x;
      while (x < zeile.length && zeile[x]) x++;
      // 0.05 Modul Überlappung nach unten: keine hellen Haarlinien zwischen
      // den Zeilen beim Skalieren am Bildschirm.
      teile.push(`M${start} ${y}h${x - start}v1.05h${start - x}z`);
    }
  });
  return teile.join('');
}
