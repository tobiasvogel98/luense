// camt-Import (nur synthetische Testdateien): camt.053 v08 und camt.054 v04,
// Zuordnung per SCOR/QRR, Rückfall über Rechnungsnummer im Text und über
// IBAN + Betrag, Teilzahlung, Skonto beim Kreditor, Sammelbuchung,
// unbekannter Posten ignorieren, Doppelimport (gleiche Bankreferenz,
// gleiche Datei noch einmal) bucht nichts doppelt.
'use strict';
const fs = require('fs');
const h = require('./hilfe');

const DEB = h.iban('CH', '09000000123456789');
const K1 = h.iban('CH', '04835012345678009');
const K2 = h.iban('CH', '00700110003456789');
const QRR = '210000000003139471430009017';

h.lauf('camt-Import', async (browser, { ok }) => {
  const AUS = h.ausgabeOrdner('bank');
  const { page, konsole } = await h.neueSeite(browser);
  await h.oeffne(page);
  await h.ladeBeispiel(page);
  const ref = await page.evaluate(async ({ FIRMA, K1, K2, QRR }) => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js');
    await st.speichereFirma(FIRMA);
    const B = (await st.speichereBaustelle({ ktr: 'T-100', name: 'Kanalisation Testweg', ort: 'Testdorf', bauherr: 'Gemeinde Testdorf' })).baustelleId;
    const deb = { name: 'Gemeinde Testdorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: 'Testdorf', land: 'CH' };
    for (const [n, betrag] of [['R-2026-101', '12000'], ['R-2026-102', '8500'], ['R-2026-103', '2450.50'], ['R-2026-104', '1980']]) {
      await sp.put({ typ: 'rechnung', baustelleId: B, nummer: n, referenz: z.scorAusNummer(n), tag: '2026-10-01', titel: `Test ${n}`, betrag,
        mwstSatz: 8.1, zahlungsfristTage: 30, debitor: deb, basis: { art: 'manuell', id: '', label: '' }, status: 'gestellt',
        statusHistorie: [{ status: 'offen', datum: '2026-10-01' }, { status: 'gestellt', datum: '2026-10-01' }] });
    }
    const k = (lieferant, rechnungsNr, betrag, extra) => sp.put({ typ: 'kreditor', baustelleId: B, lieferant, rechnungsNr, tag: '2026-11-04',
      datum: '2026-11-04T12:00:00.000Z', betrag, zahlungsfristTage: 30, kostenart: 'Material', notiz: '', status: 'visiert',
      statusHistorie: [{ status: 'offen', datum: '2026-11-04' }, { status: 'visiert', datum: '2026-11-05' }], ...extra });
    await k('Kieswerk Test AG', 'KW-5001', '10000', { skontoProzent: '2', skontoTage: '10', iban: K1, referenz: QRR });
    await k('Transport Muster GmbH', 'TM-77', '3920', { iban: K2, referenz: '' });
    await k('Transport Muster GmbH', 'TM-78', '1234.56', { iban: K2, referenz: '' });
    localStorage.setItem('luense.aktiveBaustelle', B);
    localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
    const r = await sp.abfrage({ typ: 'rechnung' });
    return Object.fromEntries(r.map((x) => [x.nummer, x.referenz || z.scorAusNummer(x.nummer)]));
  }, { FIRMA: h.FIRMA, K1, K2, QRR });
  await h.neuLaden(page);

  // Testdateien
  const c053 = `${AUS}/camt053_v08.xml`;
  fs.writeFileSync(c053, h.camt({ art: '053', version: '08', bis: '2026-11-10', msgId: 'STMT-TEST', eintraege: [
    { ref: 'T-053-1', betrag: '12972.00', tag: '2026-11-03', name: 'Gemeinde Testdorf', iban: DEB, scor: ref['R-2026-101'] },
    { ref: 'T-053-2', betrag: '5000.00', tag: '2026-11-04', name: 'Gemeinde Testdorf', iban: DEB, scor: ref['R-2026-102'] },
    { ref: 'T-053-3', betrag: '2648.98', tag: '2026-11-05', name: 'Bauherrschaft Meier', text: 'Zahlung Rg. R-2026-103 besten Dank' },
    { ref: 'T-053-4', betrag: '150.00', tag: '2026-11-06', name: 'Unbekannt AG', text: 'Gutschrift Rueckverguetung' },
    { ref: 'T-053-5', betrag: '9800.00', cdi: 'DBIT', tag: '2026-11-10', name: 'Kieswerk Test AG', iban: K1, qrr: QRR },
    { ref: 'T-053-6', betrag: '3920.00', cdi: 'DBIT', tag: '2026-11-07', name: 'Transport Muster GmbH', iban: K2, text: 'Lieferung Oktober' },
    { ref: 'T-053-8', betrag: '1234.55', cdi: 'DBIT', tag: '2026-11-08', name: 'Transport Muster GmbH', iban: K2, text: 'Rg TM-78' },
    { ref: 'T-053-9', betrag: '2140.38', tag: '2026-11-08', name: 'Gemeinde Testdorf', iban: DEB, scor: ref['R-2026-104'] },
    { ref: 'T-053-7', betrag: '12.50', cdi: 'DBIT', tag: '2026-11-10', ohneDetails: true, info: 'Kontofuehrung Oktober' },
  ] }));
  const c054 = `${AUS}/camt054_v04.xml`;
  fs.writeFileSync(c054, h.camt({ art: '054', version: '04', bis: '2026-11-10', msgId: 'NTFCTN-TEST', eintraege: [
    { ref: 'T-054-100', betrag: '10850.80', tag: '2026-11-09', txs: [
      { ref: 'T-054-101', betrag: '7350.80', name: 'Gemeinde Musterhausen', iban: DEB, scor: ref['R-DEMO-002'] },
      { ref: 'T-054-102', betrag: '3500.00', name: 'Gemeinde Testdorf', iban: DEB, scor: ref['R-2026-102'] }] },
    // gleiche Bankreferenz wie T-053-1 (Transaktion T-053-1-TX): schon verbucht
    { ref: 'T-053-1', betrag: '12972.00', tag: '2026-11-03', name: 'Gemeinde Testdorf', iban: DEB, scor: ref['R-2026-101'] },
  ] }));

  const stand = () => page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const z = await import('/kern/zahlung.js');
    const r = await sp.abfrage({ typ: 'rechnung' }); const k = await sp.abfrage({ typ: 'kreditor' });
    return Object.fromEntries([...r.map((d) => [d.nummer, `${d.status} bezahlt=${z.bezahltSumme(d)} offen=${z.offenerBetrag(d)}`]),
      ...k.map((d) => [d.rechnungsNr, `${d.status} bezahlt=${z.bezahltSumme(d)} skonto=${z.skontoSumme(d)} offen=${z.offenerBetrag(d)}`])]);
  });
  const gruppen = () => page.evaluate(() => [...document.querySelectorAll('.bank-gruppe > summary')].map((s) => s.textContent.trim()));
  const meldung = async () => h.norm(await page.locator('.rechnungen [data-rolle=meldung]').innerText());

  // ---------- camt.053 ----------
  await page.click('[data-aktion=kontoauszug]');
  await page.setInputFiles('[data-rolle=camt-datei]', c053); await page.waitForTimeout(900);
  const g1 = await gruppen();
  ok(g1.length >= 2 && !g1.some((g) => /Bereits verbucht/.test(g)), `camt.053 Vorschau gruppiert: ${g1.join(' / ')}`);
  const vText = h.norm(await page.locator('.bank-dialog').innerText());
  ok(/R-2026-102.*Teilzahlung/.test(vText) || vText.includes('Teilzahlung'), 'Vorschau nennt Teilzahlung');
  ok(vText.includes('150.00'), 'Vorschau: unbekannter Posten 150.00 aufgeführt');
  await page.screenshot({ path: `${AUS}/import-053.png`, fullPage: true });
  // alles Zugeordnete übernehmen, den unbekannten Posten ignorieren
  await page.evaluate(() => {
    document.querySelectorAll('.bank-gruppe input[type=checkbox]').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    for (const s of document.querySelectorAll('.bank-zuweisen select')) {
      if (s.closest('.bank-posten').innerText.includes('150.00')) { s.value = 'ignorieren'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await page.click('[data-aktion=verbuchen]'); await page.waitForTimeout(1200);
  if (await page.locator('.bank-dialog').count()) await page.click('.bank-dialog [data-aktion=zu]').catch(() => {});
  ok((await meldung()).length > 0, `Meldung nach Verbuchen: ${await meldung()}`);

  // ---------- camt.054 mit Sammelbuchung und Doppel ----------
  await page.click('[data-aktion=kontoauszug]');
  await page.setInputFiles('[data-rolle=camt-datei]', c054); await page.waitForTimeout(900);
  const g2 = await gruppen();
  ok(g2.some((g) => /Bereits verbucht, wird übersprungen \(1\)/.test(g)), `camt.054: gleiche Bankreferenz als «Bereits verbucht» erkannt (${g2.join(' / ')})`);
  await page.click('[data-aktion=verbuchen]'); await page.waitForTimeout(1200);
  if (await page.locator('.bank-dialog').count()) await page.click('.bank-dialog [data-aktion=zu]').catch(() => {});
  let st = await stand();
  const erw = {
    'R-2026-101': 'bezahlt bezahlt=12972 offen=0', 'R-2026-102': 'teilbezahlt bezahlt=8500 offen=688.5',
    'R-2026-103': 'teilbezahlt bezahlt=2648.98 offen=0.01', 'R-2026-104': 'bezahlt bezahlt=2140.38 offen=0',
    'R-DEMO-002': 'bezahlt bezahlt=7350.8 offen=0',
    'KW-5001': 'bezahlt bezahlt=9800 skonto=200 offen=0', 'TM-77': 'bezahlt bezahlt=3920 skonto=0 offen=0',
    'TM-78': 'teilbezahlt bezahlt=1234.55 skonto=0 offen=0.01',
  };
  const was = { 'R-2026-101': 'SCOR voll', 'R-2026-102': 'SCOR Teilzahlung + Sammelbuchung', 'R-2026-103': 'Nummer im Text, 1 Rp. zu wenig',
    'R-2026-104': 'SCOR voll', 'R-DEMO-002': 'Sammelbuchung camt.054', 'KW-5001': 'QRR mit Skonto 2 %', 'TM-77': 'IBAN + Betrag', 'TM-78': 'IBAN, 1 Rp. zu wenig' };
  for (const [k, v] of Object.entries(erw)) ok(st[k] === v, `${k} (${was[k]}): ${st[k]}`);

  // ---------- gleiche Datei noch einmal ----------
  await page.click('[data-aktion=kontoauszug]');
  await page.setInputFiles('[data-rolle=camt-datei]', c053); await page.waitForTimeout(900);
  const g3 = await gruppen();
  ok(g3.some((g) => /Bereits verbucht/.test(g)), `Doppelimport camt.053: ${g3.join(' / ')}`);
  await page.click('[data-aktion=verbuchen]'); await page.waitForTimeout(1200);
  if (await page.locator('.bank-dialog').count()) await page.click('.bank-dialog [data-aktion=zu]').catch(() => {});
  const st2 = await stand();
  ok(JSON.stringify(st2) === JSON.stringify(st), 'Doppelimport: kein Betrag doppelt verbucht');

  await h.neuLaden(page);
  ok(JSON.stringify(await stand()) === JSON.stringify(st), 'nach Neuladen: Zahlungen gespeichert');
  const zText = h.norm(await page.locator('tr:has-text("R-2026-102")').first().innerText());
  ok(zText.includes('teilbezahlt') && zText.includes('688.50'), `Tabelle R-2026-102: teilbezahlt, offen 688.50 (${zText.slice(0, 120)})`);
  ok(!konsole.length, `keine Konsolenfehler ${konsole.join(' | ')}`);
});
