// Gemeinsame Hilfsfunktionen der Regressions-Tests (Playwright, Node).
// Nicht Teil der App: tests/ wird nie ausgeliefert.
//
// Adresse der App:  LUENSE_URL (z. B. http://127.0.0.1:8123/)
//                   oder LUENSE_PORT bzw. erstes Argument (Port)
// Ausgabeordner:    LUENSE_AUSGABE (Bildschirmfotos, PDF, camt-Dateien);
//                   ohne Angabe ein neuer Ordner im System-Temp.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const PORT = process.env.LUENSE_PORT || process.argv[2] || '8000';
const URL = process.env.LUENSE_URL || `http://127.0.0.1:${PORT}/`;

function ausgabeOrdner(name) {
  const basis = process.env.LUENSE_AUSGABE
    || fs.mkdtempSync(path.join(os.tmpdir(), 'luense-tests-'));
  const ordner = path.join(basis, name);
  fs.mkdirSync(ordner, { recursive: true });
  return ordner;
}

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').replace(/[’']/g, "'").trim();
const VERBOTEN = /[–—ß]/;

// ---------- Prüfprotokoll ----------
function pruefer(name) {
  let fehler = 0;
  let anzahl = 0;
  let uebersprungen = 0;
  const ok = (bed, text) => {
    anzahl++;
    if (!bed) fehler++;
    console.log(`${bed ? 'OK     ' : 'FEHLER '} ${text}`);
    return !!bed;
  };
  const ueberspringe = (text) => { uebersprungen++; console.log(`SKIP    ${text}`); };
  const fertig = () => {
    console.log(`\n${name}: ${anzahl} Prüfungen, ${fehler} Fehler${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}`);
    return fehler;
  };
  return { ok, ueberspringe, fertig, get fehler() { return fehler; } };
}

// Test-Hauptfunktion: Abbruch zählt als Fehler, Exit-Code = Anzahl Fehler > 0.
function lauf(name, fn) {
  const p = pruefer(name);
  const start = Date.now();
  let browser;
  (async () => {
    browser = await chromium.launch();
    await fn(browser, p);
  })().catch((e) => {
    p.ok(false, `Abbruch: ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`);
  }).finally(async () => {
    if (browser) await browser.close().catch(() => {});
    const f = p.fertig();
    console.log(`Laufzeit ${Math.round((Date.now() - start) / 1000)} s`);
    process.exit(f ? 1 : 0);
  });
}

// ---------- Navigator-Attrappen: Teilen, Zwischenablage, Anker ----------
// window.__teilen.modus: 'ok' | 'abbruch' | 'aus'
function STUB_TEILEN() {
  window.__teilen = { modus: 'ok', log: [] };
  window.__anker = [];
  window.__zwischenablage = [];
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true,
    get() { return { writeText: async (t) => { window.__zwischenablage.push(t); } }; } });
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true,
    value(d) { return window.__teilen.modus !== 'aus' && !!(d && d.files && d.files.length); } });
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true,
    async value(d) {
      const f = d.files[0];
      const b = new Uint8Array(await f.arrayBuffer());
      let bin = ''; for (const x of b) bin += String.fromCharCode(x);
      window.__teilen.log.push({ name: f.name, type: f.type, size: f.size, title: d.title, text: d.text, b64: btoa(bin) });
      if (window.__teilen.modus === 'abbruch') throw new DOMException('Abgebrochen', 'AbortError');
    } });
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__anker.push({ href: this.href, download: this.download });
    if (this.href.startsWith('mailto:')) return undefined;
    return orig.call(this);
  };
}

// ---------- Browser-Kontext und Seite ----------
// Antworten auf alert/confirm/prompt: antworten.push(false) = abbrechen,
// Text = Prompt-Antwort, sonst annehmen (Prompt mit Vorschlag).
async function neueSeite(browser, { handy = false, schema = 'light', stub = false, breite, hoehe, downloads = false } = {}) {
  const viewport = handy ? { width: 390, height: 844 } : { width: breite || 1180, height: hoehe || 800 };
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'de-CH',
    colorScheme: schema, isMobile: handy, hasTouch: handy, acceptDownloads: downloads });
  if (stub) await ctx.addInitScript(STUB_TEILEN);
  const page = await ctx.newPage();
  const konsole = [];
  page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()); });
  page.on('pageerror', (e) => konsole.push(String(e)));
  const antworten = [];
  const dialoge = [];
  page.on('dialog', async (d) => {
    dialoge.push(`${d.type()}: ${d.message()}${d.defaultValue() ? ` [${d.defaultValue()}]` : ''}`);
    const a = antworten.shift();
    if (a === false) await d.dismiss();
    else if (d.type() === 'prompt') await d.accept(typeof a === 'string' ? a : d.defaultValue());
    else await d.accept();
  });
  return { ctx, page, konsole, antworten, dialoge };
}

// App öffnen und warten, bis die Shell gezeichnet hat.
async function oeffne(page, pfad = '') {
  await page.goto(URL + pfad);
  await bereit(page);
}
async function bereit(page) {
  await page.waitForFunction(() => {
    const m = document.querySelector('#modul-inhalt');
    return m && m.children.length > 0;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(500);
}
async function neuLaden(page) {
  await page.reload();
  await bereit(page);
}

// Beispielbaustelle über den Knopf im Stamm (⚙) laden.
async function ladeBeispiel(page) {
  const knopf = page.locator('[data-aktion="beispiel-laden"]');
  if (!(await knopf.count())) {
    await page.locator('#stamm-knopf').click();
    await page.waitForTimeout(400);
  }
  await knopf.click();
  await page.waitForFunction(() => !document.querySelector('[data-aktion="beispiel-laden"]')
    && document.querySelectorAll('.nav-eintrag').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
}

// Modul über die Navigation wechseln (Handy: Menü öffnen).
async function geheZu(page, name) {
  const nav = page.locator('#nav-knopf');
  if (await nav.isVisible() && !(await page.evaluate(() => document.body.classList.contains('nav-offen')))) {
    await nav.click();
    await page.waitForTimeout(350);
  }
  await page.locator('#modul-nav .nav-eintrag', { hasText: new RegExp(`^\\s*${name}`) }).first().click();
  await page.waitForTimeout(600);
}

// Testdaten direkt über den Kern anlegen und Modul/Baustelle vormerken.
async function merke(page, { baustelle, modul, rechnungAnsicht } = {}) {
  await page.evaluate(({ baustelle, modul, rechnungAnsicht }) => {
    if (baustelle) localStorage.setItem('luense.aktiveBaustelle', baustelle);
    if (modul) localStorage.setItem('luense.aktivesModul', modul);
    if (rechnungAnsicht) localStorage.setItem('luense.rechnungAnsicht', rechnungAnsicht);
  }, { baustelle, modul, rechnungAnsicht });
}

const docs = (page, typ) => page.evaluate(async (t) =>
  (await import('/kern/speicher.js')).abfrage({ typ: t }), typ);

const FIRMA = { name: 'Muster Tiefbau AG', strasse: 'Werkstrasse', hausnummer: '12', plz: '8400', ort: 'Winterthur',
  land: 'CH', iban: 'CH9300762011623852957', telefon: '052 000 00 00', email: 'buero@muster-tiefbau.ch',
  mwstNr: 'CHE-123.456.789 MWST', mwstSatz: '8.1' };

// ---------- Sprachregeln: kein «–», «—», «ß» ----------
async function sprachFehler(page, wo, { felder = false } = {}) {
  const t = await page.evaluate((felder) => document.body.innerText + ' '
    + [...document.querySelectorAll('[title],[aria-label],[placeholder]')]
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ')
    + (felder ? ` ${[...document.querySelectorAll('input,textarea')].map((e) => e.value).join(' ')}` : ''), felder);
  const m = t.match(/.{0,40}[–—ß].{0,40}/g);
  return m ? [`${wo}: ${m.slice(0, 3).join(' | ')}`] : [];
}

// ---------- Handy: Breite und Touch-Ziele ----------
const seitenBreite = (page) => page.evaluate(() => document.documentElement.scrollWidth);
async function kleineZiele(page, selektor, min = 44) {
  return page.evaluate(({ s, min }) => [...document.querySelectorAll(s)]
    .filter((e) => e.offsetParent && e.type !== 'hidden' && getComputedStyle(e).visibility !== 'hidden')
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < min; })
    .map((e) => `${(e.name || e.getAttribute('data-aktion') || e.textContent.trim()).slice(0, 30)} (${Math.round(e.getBoundingClientRect().height)} px)`),
  { s: selektor, min });
}

// ---------- PDF ----------
// Druckansicht als A4-PDF sichern (wie «Drucken > Als PDF sichern»).
async function druckePdf(page, datei) {
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: datei, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  return datei;
}
const pdfText = (datei, layout = true) =>
  execFileSync('pdftotext', [...(layout ? ['-layout'] : []), datei, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const pdfSeiten = (datei) => Number(execFileSync('pdfinfo', [datei], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().match(/Pages:\s+(\d+)/)[1]);
const pdfTextSeite = (datei, s) =>
  execFileSync('pdftotext', ['-f', String(s), '-l', String(s), datei, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

// ---------- QR-Rechnung im PDF dekodieren (zxing-cpp) ----------
// Sucht zxing-cpp (mit numpy) in: LUENSE_PYLIB (Ordner für PYTHONPATH),
// tests/pylib (nicht im Git), dann im normalen Python.
// Fehlt es: { status: 'fehlt' }, die QR-Prüfung wird übersprungen.
const PYLIB_KANDIDATEN = [process.env.LUENSE_PYLIB, path.join(__dirname, 'pylib')].filter(Boolean);
let qrUmgebung;
function qrPythonPfad() {
  if (qrUmgebung !== undefined) return qrUmgebung;
  qrUmgebung = null;
  for (const p of [...PYLIB_KANDIDATEN.filter((x) => fs.existsSync(x)), '']) {
    const r = spawnSync('python3', ['-c', 'import zxingcpp, numpy'], { env: { ...process.env, PYTHONPATH: p } });
    if (r.status === 0) { qrUmgebung = p; break; }
  }
  return qrUmgebung;
}
function qrAusPdf(datei) {
  const py = qrPythonPfad();
  if (py === null) return { status: 'fehlt', zeilen: [] };
  const praefix = datei.replace(/\.pdf$/, '-qr');
  execFileSync('pdftoppm', ['-r', '200', '-gray', datei, praefix], { stdio: 'ignore' });
  const bilder = fs.readdirSync(path.dirname(praefix))
    .filter((f) => f.startsWith(path.basename(praefix)) && f.endsWith('.pgm'))
    .map((f) => path.join(path.dirname(praefix), f)).sort();
  const r = spawnSync('python3', [path.join(__dirname, 'qr_lesen.py'), ...bilder],
    { env: { ...process.env, PYTHONPATH: py } });
  const text = r.stdout.toString();
  if (r.status !== 0 || !text.startsWith('SPC')) return { status: 'kein-qr', zeilen: [], fehler: r.stderr.toString().slice(0, 300) };
  return { status: 'ok', zeilen: text.replace(/\n$/, '').split('\n') };
}

// ---------- camt-Testdateien (nur synthetische Daten) ----------
// eintrag: { ref, betrag, cdi: 'CRDT'|'DBIT', tag, name, iban, scor, qrr, text, txs: [...] }
const FIRMEN_IBAN = 'CH9300762011623852957';
function camt({ art = '053', version, bis = '2026-11-10', von, eintraege, msgId = `T-${art}-${bis}` }) {
  const v8 = (version || (art === '053' ? '08' : '04')) >= '08';
  const ns = `camt.${art}.001.${version || (art === '053' ? '08' : '04')}`;
  const [huelle, innen] = art === '053' ? ['BkToCstmrStmt', 'Stmt'] : ['BkToCstmrDbtCdtNtfctn', 'Ntfctn'];
  const partei = (tag, name, iban) => `<${tag}>${v8 ? `<Pty><Nm>${name}</Nm></Pty>` : `<Nm>${name}</Nm>`}</${tag}>`
    + (iban ? `<${tag}Acct><Id><IBAN>${iban}</IBAN></Id></${tag}Acct>` : '');
  const tx = (t, cdi) => {
    let rmt = '';
    if (t.scor || t.qrr) {
      const cd = t.scor ? '<Cd>SCOR</Cd>' : '<Prtry>QRR</Prtry>';
      rmt += `<Strd><CdtrRefInf><Tp><CdOrPrtry>${cd}</CdOrPrtry></Tp><Ref>${t.scor || t.qrr}</Ref></CdtrRefInf></Strd>`;
    }
    if (t.text) rmt = `<Ustrd>${t.text}</Ustrd>${rmt}`;
    const pt = cdi === 'CRDT' ? partei('Dbtr', t.name || 'Unbekannt AG', t.iban) : partei('Cdtr', t.name || 'Unbekannt AG', t.iban);
    return `<TxDtls><Refs><AcctSvcrRef>${t.ref}-TX</AcctSvcrRef><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
      <Amt Ccy="CHF">${t.betrag}</Amt><CdtDbtInd>${cdi}</CdtDbtInd>
      <RltdPties>${pt}</RltdPties>${rmt ? `<RmtInf>${rmt}</RmtInf>` : ''}</TxDtls>`;
  };
  const ntry = (e) => {
    const cdi = e.cdi || 'CRDT';
    const txs = e.txs || (e.ohneDetails ? [] : [e]);
    const btch = txs.length > 1 ? `<Btch><NbOfTxs>${txs.length}</NbOfTxs></Btch>` : '';
    return `<Ntry><NtryRef>${e.ref}</NtryRef><Amt Ccy="CHF">${e.betrag}</Amt><CdtDbtInd>${cdi}</CdtDbtInd>${v8 ? '<Sts><Cd>BOOK</Cd></Sts>' : '<Sts>BOOK</Sts>'}
    <BookgDt><Dt>${e.tag || bis}</Dt></BookgDt><ValDt><Dt>${e.tag || bis}</Dt></ValDt><AcctSvcrRef>${e.ref}</AcctSvcrRef>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>${cdi === 'CRDT' ? 'RCDT' : 'ICDT'}</Cd><SubFmlyCd>AUTT</SubFmlyCd></Fmly></Domn></BkTxCd>
    ${txs.length ? `<NtryDtls>${btch}${txs.map((t) => tx(t, cdi)).join('')}</NtryDtls>` : ''}${e.info ? `<AddtlNtryInf>${e.info}</AddtlNtryInf>` : ''}</Ntry>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:${ns}">
 <${huelle}><GrpHdr><MsgId>${msgId}</MsgId><CreDtTm>${bis}T23:00:00</CreDtTm></GrpHdr>
  <${innen}><Id>${msgId}-1</Id><CreDtTm>${bis}T23:00:00</CreDtTm>
   <FrToDt><FrDtTm>${von || `${bis.slice(0, 8)}01`}T00:00:00</FrDtTm><ToDtTm>${bis}T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>${FIRMEN_IBAN}</IBAN></Id><Ccy>CHF</Ccy></Acct>
   ${eintraege.map(ntry).join('\n')}
  </${innen}></${huelle}></Document>`;
}

// IBAN mit gültiger Prüfziffer aus Bankleitzahl + Konto (synthetisch).
function iban(land, bban) {
  const s = bban + land + '00';
  const n = BigInt([...s].map((c) => parseInt(c, 36)).join(''));
  return `${land}${String(98n - (n % 97n)).padStart(2, '0')}${bban}`;
}

module.exports = {
  URL, PORT, ausgabeOrdner, norm, VERBOTEN, pruefer, lauf, STUB_TEILEN, neueSeite, oeffne, bereit, neuLaden,
  ladeBeispiel, geheZu, merke, docs, FIRMA, sprachFehler, seitenBreite, kleineZiele, druckePdf, pdfText,
  pdfSeiten, pdfTextSeite, qrAusPdf, qrPythonPfad, camt, iban, FIRMEN_IBAN,
};
