// Kreditoren (Firma MWST-pflichtig): netto + Vorsteuer = brutto, Vorsteuer
// von Hand, Migration alter Kreditoren, QR-Scan liefert brutto (Attrappe
// für BarcodeDetector), Visum, camt-Zahlung mit Skonto, Controlling S1
// netto, Dossier offene Kreditoren. Handy 390 × 844.
'use strict';
const fs = require('fs');
const h = require('./hilfe');
const DIR = h.ausgabeOrdner('kreditor');
const SHOTS = DIR;
const tag = 'kreditor';
const K1 = 'CH5604835012345678009';
const K2 = 'CH0700700110003456789';
const QRR = '210000000003139471430009017';
const SCOR = 'RF18539007547034';
const heute = new Date().toISOString().slice(0, 10);

function camtKreditoren(eintraege) {
  const ntry = ([ref, amt, iban, name, refArt, refWert]) => `<Ntry><NtryRef>${ref}</NtryRef><Amt Ccy="CHF">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>${heute}</Dt></BookgDt><ValDt><Dt>${heute}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>AUTT</SubFmlyCd></Fmly></Domn></BkTxCd>
    <NtryDtls><TxDtls><Refs><AcctSvcrRef>${ref}-TX</AcctSvcrRef><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
      <Amt Ccy="CHF">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <RltdPties><Cdtr><Nm>${name}</Nm></Cdtr><CdtrAcct><Id><IBAN>${iban}</IBAN></Id></CdtrAcct></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry>${refArt === 'SCOR' ? '<Cd>SCOR</Cd>' : '<Prtry>QRR</Prtry>'}</CdOrPrtry></Tp><Ref>${refWert}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.04">
 <BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>KRED-TEST</MsgId><CreDtTm>${heute}T06:00:00</CreDtTm></GrpHdr>
  <Ntfctn><Id>KRED-TEST-1</Id><CreDtTm>${heute}T06:00:00</CreDtTm>
   <Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
   ${eintraege.map(ntry).join('')}
  </Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
}

h.lauf('Kreditoren', async (browser, { ok }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'de-CH', isMobile: true, hasTouch: true });
  // QR-Scan: BarcodeDetector-Attrappe liefert eine Swiss-QR-Rechnung (Brutto 1'081.00).
  await ctx.addInitScript(() => {
    window.BarcodeDetector = class {
      async detect() {
        return [{ rawValue: ['SPC', '0200', '1', 'CH5604835012345678009', 'S', 'Kies QR AG', 'Weg', '1',
          '8000', 'Zürich', 'CH', '', '', '', '', '', '', '', '1081.00', 'CHF', '', '', '', '', '', '', '',
          'QRR', '210000000003139471430009017', 'Lieferung', 'EPD', '//S1/10/KQ-77/11/261110/40/0:30'].join('\n') }];
      }
    };
  });
  const page = await ctx.newPage();
  const konsole = [];
  page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()); });
  page.on('pageerror', (e) => konsole.push(String(e)));
  const antworten = [];
  page.on('dialog', async (d) => {
    const a = antworten.shift();
    if (a === false) await d.dismiss(); else await d.accept();
  });
  const docs = (p) => page.evaluate(async (praefix) => {
    const r = await new PouchDB('luense').allDocs({ include_docs: true, startkey: praefix, endkey: `${praefix}￿` });
    return r.rows.map((x) => x.doc);
  }, p);
  const geheZu = (name) => h.geheZu(page, name);

  await h.oeffne(page);
  await page.locator('[data-aktion="beispiel-laden"]').click();
  await page.waitForTimeout(1500);
  const demoB = (await docs('baustelle:')).find((b) => b.demo)?.baustelleId
    || (await docs('baustelle:'))[0].baustelleId;
  const demoK = (await docs('kreditor:')).find((k) => k.rechnungsNr === 'KW-0001');
  ok(demoK.netto === '7993.06' && demoK.vorsteuer === '647.44' && demoK.betrag === '8640.50',
    'Demo-Kreditor trägt netto/Vorsteuer (Summe = brutto)');

  // ---- Altbestand ohne netto ----
  await page.evaluate(async ({ B, K1, QRR, heute }) => {
    const db = new PouchDB('luense');
    await db.put({ _id: 'kreditor:alt-1', typ: 'kreditor', baustelleId: B, lieferant: 'Altlieferant AG',
      rechnungsNr: 'ALT-1', tag: heute, datum: `${heute}T12:00:00.000Z`, betrag: '1081', zahlungsfristTage: 30,
      skontoProzent: '', skontoTage: '', kostenart: 'Material', iban: K1, referenz: QRR,
      status: 'visiert', statusHistorie: [{ status: 'offen', datum: heute }, { status: 'visiert', datum: heute }] });
    await db.put({ _id: 'kreditor:alt-2', typ: 'kreditor', baustelleId: B, lieferant: 'Altlieferant 2',
      rechnungsNr: 'ALT-2', tag: heute, datum: `${heute}T12:00:00.000Z`, betrag: '99.99', zahlungsfristTage: 30,
      kostenart: 'Diverses', status: 'offen', statusHistorie: [] });
  }, { B: demoB, K1, QRR, heute });
  await page.reload();
  await page.waitForTimeout(1300);
  let alt1 = (await docs('kreditor:alt-1'))[0];
  let alt2 = (await docs('kreditor:alt-2'))[0];
  ok(alt1.netto === '1000.00' && alt1.vorsteuer === '81.00' && alt1.vorsteuerSatz === 8.1 && alt1.betrag === '1081',
    `Migration: 1081 brutto → netto ${alt1.netto} + Vorsteuer ${alt1.vorsteuer}, betrag unverändert`);
  ok(alt2.netto === '92.50' && alt2.vorsteuer === '7.49', `Migration: 99.99 → ${alt2.netto} + ${alt2.vorsteuer} (Summe exakt)`);
  const rev = alt1._rev;
  await page.reload();
  await page.waitForTimeout(1000);
  ok((await docs('kreditor:alt-1'))[0]._rev === rev, 'Migration idempotent');

  // ---- Neuer Kreditor im Formular ----
  await geheZu('Kreditoren');
  const baustelleKnopf = page.locator('[data-ansicht="baustelle"]');
  if (await baustelleKnopf.count()) await baustelleKnopf.click();
  await page.locator('[data-aktion="neu"]').first().click();
  await page.waitForTimeout(500);
  const f = page.locator('[data-rolle="kreditor-formular"]');
  const v = (n) => f.locator(`[name="${n}"]`);
  await v('lieferant').fill('Beton Test AG');
  await v('rechnungsNr').fill('BT-1');
  await v('netto').fill('2500');
  ok(await v('vorsteuer').inputValue() === '202.50' && await v('brutto').inputValue() === '2702.50',
    'Netto 2500 → Vorsteuer 202.50, brutto 2702.50');
  await v('vorsteuerSatz').fill('2.6');
  ok(await v('vorsteuer').inputValue() === '65.00' && await v('brutto').inputValue() === '2565.00',
    'Satz 2.6 → Vorsteuer 65.00, brutto 2565.00');
  await v('vorsteuerSatz').fill('0');
  ok(await v('vorsteuer').inputValue() === '0.00' && await v('brutto').inputValue() === '2500.00', 'Satz 0 erlaubt → brutto = netto');
  await v('vorsteuerSatz').fill('8.1');
  await v('vorsteuer').fill('202.55');
  ok(await v('brutto').inputValue() === '2702.55', 'Vorsteuer von Hand 202.55 → brutto 2702.55');
  const hinweis = await f.locator('[data-rolle="betrag-hinweis"]').innerText();
  ok(hinweis.includes('von Hand') && hinweis.includes('202.50'), `Hinweis: ${hinweis.replace(/\s+/g, ' ')}`);
  await v('netto').fill('2500.00');
  ok(await v('vorsteuer').inputValue() === '202.55', 'Netto neu getippt: Vorsteuer von Hand bleibt');
  await v('skontoProzent').fill('2');
  await v('skontoTage').fill('10');
  await v('iban').fill(K2);
  await v('referenz').fill(SCOR);
  await f.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-1-formular.png`, fullPage: false });
  await f.locator('[name="netto"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-1b-formular-betraege.png` });
  await f.locator('[type="submit"]').click();
  await page.waitForTimeout(800);
  let neu = (await docs('kreditor:')).find((k) => k.rechnungsNr === 'BT-1');
  ok(neu && neu.netto === '2500.00' && neu.vorsteuer === '202.55' && neu.vorsteuerSatz === 8.1 && neu.betrag === '2702.55',
    `Gespeichert: netto ${neu?.netto}, Vorsteuer ${neu?.vorsteuer}, brutto ${neu?.betrag}`);
  // Bearbeiten öffnet mit Hand-Hinweis
  const zeileNeu = page.locator('tr', { hasText: 'BT-1' });
  const zText = await zeileNeu.innerText();
  ok(zText.includes("netto CHF 2'500.00") && zText.includes('Vorsteuer 8.1 % CHF 202.55') && zText.includes("CHF 2'702.55"),
    'Tabelle: netto / Vorsteuer / brutto');
  await page.screenshot({ path: `${SHOTS}/${tag}-2-tabelle.png` });
  await zeileNeu.locator('[data-aktion="oeffnen"]').click();
  await page.waitForTimeout(500);
  ok((await f.locator('[data-rolle="betrag-hinweis"]').innerText()).includes('von Hand'), 'Bearbeiten: Vorsteuer-von-Hand erkannt');
  await f.locator('[data-aktion="abbrechen"]').click();

  // ---- QR-Scan liefert brutto ----
  await page.locator('[data-aktion="neu"]').first().click();
  await page.waitForTimeout(400);
  await f.locator('[data-aktion="qr-scan"]').click();
  await page.waitForTimeout(400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('[data-rolle="qr-foto"]', { name: 'qr.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(800);
  ok(await v('brutto').inputValue() === '1081.00' && await v('netto').inputValue() === '1000.00'
    && await v('vorsteuer').inputValue() === '81.00', 'QR: brutto 1081.00 → netto 1000.00 + Vorsteuer 81.00');
  ok((await f.locator('[data-rolle="qr-info"]').innerText()).includes('brutto'), 'QR-Info nennt brutto');
  await v('vorsteuerSatz').fill('7.7');
  await v('brutto').fill('1077');
  ok(await v('netto').inputValue() === '1000.00' && await v('vorsteuer').inputValue() === '77.00', 'Brutto bei 7.7 % korrigierbar → 1000.00 + 77.00');
  await page.screenshot({ path: `${SHOTS}/${tag}-3-qr.png` });
  await f.locator('[data-aktion="abbrechen"]').click();

  // ---- Visum (Lieferschein-Abgleich) ----
  await page.locator('tr', { hasText: 'BT-1' }).locator('[data-aktion="weiter"]').click();
  await page.waitForTimeout(500);
  const visum = await page.locator('[data-rolle="visum-dialog"]').innerText();
  ok(visum.includes("netto CHF 2'500.00 exkl. MWST") && visum.includes("brutto CHF 2'702.55 inkl. MWST"), 'Visum zeigt netto und brutto');
  await page.screenshot({ path: `${SHOTS}/${tag}-4-visum.png` });
  await page.locator('[data-rolle="visum-dialog"] [type="submit"]').click();
  await page.waitForTimeout(600);

  // ---- camt: migrierter (voll, QRR) + neuer (Skonto, SCOR) ----
  const datei = `${DIR}/camt-kreditoren.xml`;
  fs.writeFileSync(datei, camtKreditoren([
    ['KRED-1', '1081.00', K1, 'Altlieferant AG', 'QRR', QRR],
    ['KRED-2', '2648.50', K2, 'Beton Test AG', 'SCOR', SCOR],
  ]));
  await page.locator('[data-aktion="kontoauszug"]').click();
  await page.waitForTimeout(400);
  await page.setInputFiles('[data-rolle=camt-datei]', datei);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/${tag}-5-kontoauszug.png` });
  await page.click('[data-aktion=verbuchen]');
  await page.waitForTimeout(1300);
  alt1 = (await docs('kreditor:alt-1'))[0];
  neu = (await docs('kreditor:')).find((k) => k.rechnungsNr === 'BT-1');
  const z = (d) => (d.zahlungen || []).map((x) => `${x.betrag}/${x.skonto || 0}`).join(',');
  ok(alt1.status === 'bezahlt' && z(alt1) === '1081/0', `camt migrierter Kreditor: ${alt1.status} ${z(alt1)}`);
  ok(neu.status === 'bezahlt' && Number(neu.zahlungen?.[0]?.skonto) === 54.05,
    `camt neuer Kreditor mit Skonto 2 % auf brutto: ${neu.status} ${z(neu)}`);

  // ---- Controlling S1 netto ----
  await geheZu('Controlling');
  await page.locator('[data-aktion="neu"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-aktion="vorschlaege"]').click();
  await page.waitForTimeout(800);
  const s1 = page.locator('[data-uebernehmen="s1"]');
  const s1Wert = Number(await s1.getAttribute('data-wert'));
  // KW-0001 7993.06 + MT-0815 3626.27 + ALT-1 1000.00 + BT-1 2500.00 (ALT-2 «offen» zählt nicht)
  ok(Math.abs(s1Wert - 15119.33) < 0.001, `S1 netto = 15'119.33 (ist ${s1Wert})`);
  const vText = await page.locator('[data-rolle="vorschlags-liste"]').innerText();
  ok(/S1: Kreditoren visiert\/bezahlt[\s\S]*netto exkl\. MWST/.test(vText), 'S1 beschriftet «netto exkl. MWST»');
  ok(/Zahlungsausgang Kreditoren[\s\S]*inkl\. MWST/.test(vText), 'Zahlungsausgang «inkl. MWST»');
  await page.locator('[data-rolle="vorschlags-liste"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-6-controlling-s1.png` });

  // ---- Dossier: offene Kreditoren brutto ----
  await geheZu('Dossier');
  const dText = await page.locator('#modul-inhalt').innerText();
  ok(/Kreditoren offen\s*\(\d+\) · inkl\. MWST/i.test(dText), 'Dossier: Kreditoren offen · inkl. MWST');
  // offen: KW-0001 8640.50 (visiert) + ALT-2 99.99 = 8740.49 → CHF 8'740
  ok(dText.includes("8'740"), 'Dossier: offene Kreditoren brutto (8\'740)');

  // Reload-Persistenz
  await page.reload();
  await h.bereit(page);
  await geheZu('Kreditoren');
  ok((await page.locator('tr', { hasText: 'BT-1' }).innerText()).includes('Vorsteuer 8.1 % CHF 202.55'), 'Reload: Werte bleiben');
  const breit = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(breit, 'kein horizontales Seiten-Scrollen');
  const echte = konsole;
  ok(echte.length === 0, `keine Konsolenfehler ${echte.join(' | ')}`);
});
