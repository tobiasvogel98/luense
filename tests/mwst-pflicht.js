// v59: Schalter «MWST-pflichtig» aus. Rechnung, Offerte und Mahnung ohne
// MWST (nur Total, Vermerk «Nicht mehrwertsteuerpflichtig.»), QR-Betrag
// dekodiert, Entwürfe ohne MWST neu rechnen, gestellte Belege bleiben,
// Kreditoren ohne Vorsteuer, Controlling brutto, Schalter wieder ein.
// Laptop und Handy 390 × 844 hell/dunkel.
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const h = require('./hilfe');
const M = h.ausgabeOrdner('mwst-pflicht');
const SH = M;
const URL = h.URL;
const norm = h.norm;
const VERBOTEN = h.VERBOTEN;
const STUB = h.STUB_TEILEN;
let ueberspringe = () => {};
// QR-Inhalt als Zeilen; null, wenn zxing-cpp fehlt (Prüfung übersprungen).
function qrAusPdf(pdf) {
  const r = h.qrAusPdf(pdf);
  if (r.status === 'fehlt') { ueberspringe(`QR-Dekodierung ${pdf.split('/').pop()}: zxing-cpp nicht verfügbar`); return null; }
  return r.zeilen;
}

h.lauf('MWST-pflichtig aus', async (b, pr) => {
  const ok = pr.ok;
  ueberspringe = pr.ueberspringe;
  const ctx = await b.newContext({ viewport: { width: 1120, height: 800 }, serviceWorkers: 'block', locale: 'de-CH' });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const fehler = [];
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  page.on('pageerror', (e) => fehler.push(String(e)));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'T-NEU' : undefined));
  const shot = (n, p = page, full = false) => p.screenshot({ path: `${SH}/${n}.png`, fullPage: full });
  const sprachFehler = [];
  const pruefeText = async (wo, p = page) => {
    const t = await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label],[placeholder]')]
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' '));
    const m = t.match(/.{0,40}[–—ß].{0,40}/g);
    if (m) sprachFehler.push(`${wo}: ${m.slice(0, 3).join(' | ')}`);
  };
  const docs = (typ) => page.evaluate(async (t) => (await (await import('/kern/speicher.js')).abfrage({ typ: t })), typ);
  const rech = async (nr) => (await docs('rechnung')).find((r) => r.nummer === nr);

  await h.oeffne(page);
  // Testdaten (eigener Browser-Kontext, nicht die echte Datenbank)
  const H = await page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js');
    // Firmendaten wie vor v59: ohne Feld mwstPflichtig
    await sp.put({ _id: 'firma:stamm', typ: 'firma', baustelleId: 'firma', name: 'Muster Tiefbau GmbH', strasse: 'Werkstrasse', hausnummer: '12',
      plz: '8400', ort: 'Winterthur', land: 'CH', iban: 'CH9300762011623852957', telefon: '', email: '', mwstNr: '', mwstSatz: '8.1',
      mahnTageErinnerung: '30', mahnTageMahnung1: '60', mahnTageMahnung2: '75' });
    const B = (await st.speichereBaustelle({ ktr: 'T-500', name: 'Werkleitung Pflichtweg', ort: 'Adorf', bauherr: 'Gemeinde Adorf' })).baustelleId;
    const heute = z.heuteTag();
    const deb = { name: 'Gemeinde Adorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: 'Adorf', land: 'CH', email: 'kasse@adorf.ch' };
    const r = (nummer, alter, betrag, extra) => sp.put({ typ: 'rechnung', baustelleId: B, nummer, referenz: z.scorAusNummer(nummer), tag: z.plusTage(heute, -alter),
      titel: `Test ${nummer}`, betrag, zahlungsfristTage: 30, debitor: deb, basis: { art: 'manuell', id: '', label: '' },
      statusHistorie: [{ status: 'offen', datum: z.plusTage(heute, -alter) }], ...extra });
    await r('R-2026-501', 10, '10000', { mwstSatz: 8.1, status: 'gestellt' }); // gestellt mit 8.1: bleibt
    await r('R-2026-502', 2, '500', { mwstSatz: 8.1, status: 'offen' }); // Entwurf mit 8.1: Hinweis
    await r('R-2026-503', 31, '2000', { mwstSatz: 0, status: 'gestellt' }); // ohne MWST, Zahlungserinnerung fällig
    const k = (lieferant, nr, extra) => sp.put({ typ: 'kreditor', baustelleId: B, lieferant, rechnungsNr: nr, tag: heute, datum: `${heute}T12:00:00.000Z`,
      zahlungsfristTage: 30, kostenart: 'Material', notiz: '', status: 'visiert', statusHistorie: [{ status: 'offen', datum: heute }], ...extra });
    await k('Kieswerk Alt AG', 'KA-1', { netto: '1000.00', vorsteuerSatz: 8.1, vorsteuer: '81.00', betrag: '1081.00' });
    // Offerten: Entwurf mit 8.1 und angenommene mit 8.1
    const pos = [{ art: 'position', nr: '211.101', text: 'Aushub', einheit: 'm3', ep: '50', menge: '10', ausmass: [] }];
    await sp.put({ typ: 'offerte', baustelleId: 'offertwesen', nummer: 'O-2026-501', kunde: 'Gemeinde Adorf', objekt: 'Entwurf alt', status: 'Entwurf', mwstSatz: 8.1, gliederung: pos });
    await sp.put({ typ: 'offerte', baustelleId: 'offertwesen', nummer: 'O-2026-502', kunde: 'Gemeinde Adorf', objekt: 'Vertrag alt', status: 'angenommen', angenommenAm: '2026-10-01T10:00:00.000Z', mwstSatz: 8.1, gliederung: pos });
    localStorage.setItem('luense.aktiveBaustelle', B);
    localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
    return { B, heute };
  });
  await page.reload(); await page.waitForTimeout(1200);
  const r501vorher = await rech('R-2026-501');

  // ---------- 1. Firmendaten: Standard pflichtig, Schalter aus ----------
  await page.click('#stamm-knopf'); await page.waitForTimeout(400);
  await page.click('summary:has-text("Firmendaten")');
  const f = page.locator('[data-rolle="firma-formular"]');
  const schalter = f.locator('[name=mwstPflichtig]');
  ok(await schalter.isChecked(), 'Firmendaten ohne Feld: Schalter MWST-pflichtig ein (Standard wie bisher)');
  ok(await f.locator('[name=mwstSatz]').isVisible() && await f.locator('[name=mwstNr]').isVisible(), 'Schalter ein: MWST-Nr. und Satz sichtbar');
  ok(await f.locator('[data-rolle=mwst-nr-warnung]').isVisible(), 'Schalter ein, ohne MWST-Nr.: Warnung sichtbar (wie v58)');
  await f.locator('.schalter-zeile').scrollIntoViewIfNeeded();
  await shot('01-firmendaten-ein');
  await f.locator('.schalter-zeile').click();
  ok(!(await schalter.isChecked()), 'Schalter aus (ganze Zeile antippbar)');
  ok(norm(await f.locator('[data-rolle=mwst-pflichtig-text]').innerText()) === 'Nicht pflichtig: Rechnungen und Offerten ohne MWST, Vorsteuer nicht abziehbar.', 'Erklärung «Nicht pflichtig: …»');
  ok(!(await f.locator('[name=mwstSatz]').isVisible()) && !(await f.locator('[name=mwstNr]').isVisible()), 'Schalter aus: MWST-Nr. und Satz ausgeblendet');
  ok(!(await f.locator('[data-rolle=mwst-nr-warnung]').isVisible()), 'Schalter aus: keine Warnung wegen fehlender MWST-Nr.');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(400);
  ok((await f.locator('.meldung').textContent()).includes('gespeichert'), 'Firmendaten gespeichert');
  let firma = await page.evaluate(async () => (await import('/kern/stamm.js')).ladeFirma());
  ok(firma.mwstPflichtig === false && firma.mwstSatz === '8.1', `firma.mwstPflichtig=${firma.mwstPflichtig}, Satz bleibt gespeichert (${firma.mwstSatz})`);
  await shot('02-firmendaten-aus');
  await pruefeText('Firmendaten');
  // Reload: Schalter bleibt aus
  await page.reload(); await page.waitForTimeout(1000);
  await page.click('#stamm-knopf'); await page.waitForTimeout(400);
  await page.click('summary:has-text("Firmendaten")');
  ok(!(await schalter.isChecked()) && !(await f.locator('[name=mwstSatz]').isVisible()), 'Reload: Schalter bleibt aus, Felder ausgeblendet');
  await page.click('#stamm-knopf').catch(() => {}); await page.waitForTimeout(300);
  await page.click('.nav-eintrag:has-text("Rechnungen")'); await page.waitForTimeout(900);

  // ---------- 2. Neue Rechnung 1.00 ----------
  await page.click('.rechnungen [data-aktion=neu]'); await page.waitForTimeout(500);
  const rf = page.locator('[data-rolle=rechnung-formular]');
  ok(norm(await rf.locator('[data-rolle=betrag-label]').innerText()) === 'Betrag [CHF] *', 'Formular: Betragsfeld heisst «Betrag [CHF]»');
  ok(!(await rf.locator('[data-rolle=mwst-nr-warnung]').count()), 'Formular: keine MWST-Nr.-Warnung');
  await rf.locator('[name=titel]').fill('Kleinauftrag');
  await rf.locator('[name=betrag]').fill('1.00');
  await page.waitForTimeout(200);
  const vorschau = norm(await rf.locator('[data-rolle=mwst-vorschau]').innerText());
  ok(vorschau === 'Total CHF 1.00', `Live-Vorschau nur Total: «${vorschau}»`);
  await shot('03-formular-ohne-mwst');
  await pruefeText('Formular');
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(700);
  const neu = (await docs('rechnung')).find((r) => r.titel === 'Kleinauftrag');
  ok(neu && neu.mwstSatz === 0 && neu.betrag === '1.00', `neue Rechnung ${neu?.nummer}: mwstSatz=${neu?.mwstSatz} betrag=${neu?.betrag}`);
  const zelle = async (nr) => norm(await page.locator(`.uebersicht-tabelle tr:has-text("${nr}") td.zahl`).first().innerText());
  ok(await zelle(neu.nummer) === 'CHF 1.00', `Tabelle ${neu.nummer}: nur Total (${await zelle(neu.nummer)})`);
  ok((await zelle('R-2026-501')).includes('MWST 8.1 %'), `R-2026-501 (gestellt, 8.1) zeigt weiter MWST: ${await zelle('R-2026-501')}`);
  const kopf = norm(await page.locator('.uebersicht-tabelle thead').innerText());
  ok(!/inkl\.|exkl\./.test(kopf) && !/inkl\. MWST|exkl\./.test(await page.locator('[data-rolle=gesamt]').innerText()), `Kopf und Hinweis ohne exkl./inkl.: ${kopf}`);
  ok(await page.locator('tr:has-text("R-2026-502") [data-aktion=ohne-mwst]').count() === 1, 'Entwurf R-2026-502 (8.1): Knopf «ohne MWST neu rechnen»');
  ok(await page.locator('tr:has-text("R-2026-501") [data-aktion=ohne-mwst]').count() === 0, 'Gestellte R-2026-501: kein Knopf');
  await shot('04-rechnungen-tabelle', page, true);
  await pruefeText('Rechnungen');

  // PDF der neuen Rechnung (Druckansicht als PDF) und QR-Betrag
  await page.locator(`tr:has-text("${neu.nummer}") [data-aktion=pdf]`).click(); await page.waitForTimeout(800);
  const druckText = norm(await page.locator('.druckansicht').innerText());
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${M}/rechnung-${neu.nummer}.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.locator('.druckansicht').screenshot({ path: `${SH}/05-pdf-rechnung-ansicht.png` }).catch(() => {});
  await page.click('.druckansicht [data-aktion=schliessen]');
  const pdfText = execSync(`pdftotext -layout ${M}/rechnung-${neu.nummer}.pdf - 2>/dev/null`).toString();
  const mwstStellen = (t) => (t.replace(/Nicht mehrwertsteuerpflichtig\./g, '').match(/.{0,30}MWST.{0,30}/gi) || []);
  ok(!mwstStellen(pdfText).length && !mwstStellen(druckText).length, `Rechnungs-PDF ohne «MWST» (${JSON.stringify(mwstStellen(pdfText).slice(0, 3))})`);
  ok(pdfText.includes('Nicht mehrwertsteuerpflichtig.') && /Total\s+CHF 1\.00/.test(pdfText), 'Rechnungs-PDF: «Total CHF 1.00» und «Nicht mehrwertsteuerpflichtig.»');
  ok(/Total CHF 1\.00 Nicht mehrwertsteuerpflichtig\./.test(druckText), 'Satz steht unter dem Total');
  ok(!VERBOTEN.test(pdfText), 'Rechnungs-PDF ohne Striche/ß');
  const qr = qrAusPdf(`${M}/rechnung-${neu.nummer}.pdf`);
  if (qr) ok(qr[0] === 'SPC' && qr[18] === '1.00' && qr[19] === 'CHF', `QR-Betrag ${qr[18]} ${qr[19]} (Ref ${qr[28]})`);

  // ---------- 3. Entwurf mit 8.1 neu rechnen, gestellte bleibt ----------
  await page.locator('tr:has-text("R-2026-502") [data-aktion=ohne-mwst]').click(); await page.waitForTimeout(700);
  const r502 = await rech('R-2026-502');
  ok(r502.mwstSatz === 0 && r502.betrag === '500', `R-2026-502 nach Knopf: mwstSatz=${r502.mwstSatz}`);
  ok(await zelle('R-2026-502') === 'CHF 500.00', `R-2026-502 Zelle: ${await zelle('R-2026-502')}`);
  { const mld = norm(await page.locator('.rechnungen [data-rolle=meldung]').innerText());
    ok(mld.includes("R-2026-502 ohne MWST neu gerechnet: Total CHF 500.00 (vorher CHF 540.50 mit MWST 8.1 %)"), `Meldung: ${mld}`); }
  // Formular-Variante: zweite Entwurf-Rechnung mit 8.1
  await page.evaluate(async (B) => {
    const sp = await import('/kern/speicher.js');
    await sp.put({ typ: 'rechnung', baustelleId: B, nummer: 'R-2026-590', referenz: '', tag: '2026-11-10', titel: 'Entwurf Formular', betrag: '200',
      mwstSatz: 8.1, zahlungsfristTage: 30, basis: { art: 'manuell', id: '', label: '' }, status: 'offen', statusHistorie: [] });
  }, H.B);
  await page.click('.nav-eintrag:has-text("Journal")'); await page.waitForTimeout(400);
  await page.click('.nav-eintrag:has-text("Rechnungen")'); await page.waitForTimeout(800);
  await page.locator('tr:has-text("R-2026-590") [data-aktion=oeffnen]').click(); await page.waitForTimeout(500);
  ok(await rf.locator('[data-rolle=ohne-mwst-hinweis]').isVisible(), 'Formular Entwurf mit 8.1: Hinweis mit Knopf');
  ok(norm(await rf.locator('[data-rolle=mwst-vorschau]').innerText()).includes('MWST 8.1 %'), 'Formular zeigt vorerst den gespeicherten Satz 8.1');
  await shot('06-formular-hinweis-entwurf');
  await rf.locator('[data-aktion=ohne-mwst-formular]').click();
  ok(norm(await rf.locator('[data-rolle=mwst-vorschau]').innerText()) === 'Total CHF 200.00', 'Nach Knopf: Vorschau nur Total');
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(600);
  ok((await rech('R-2026-590')).mwstSatz === 0, 'R-2026-590 gespeichert mit 0 %');
  const r501 = await rech('R-2026-501');
  ok(r501._rev === r501vorher._rev && r501.mwstSatz === 8.1, `Gestellte R-2026-501 unverändert (rev ${r501._rev.slice(0, 2)}, Satz ${r501.mwstSatz})`);
  // PDF der gestellten 8.1: weiterhin mit MWST (Beleg)
  await page.locator('tr:has-text("R-2026-501") [data-aktion=pdf]').click(); await page.waitForTimeout(700);
  const s501 = norm(await page.locator('.druckansicht .druck-summen').innerText());
  ok(/Total netto exkl\. MWST.*MWST 8\.1 %.*Total inkl\. MWST CHF 10'810\.00/.test(s501), `PDF R-2026-501 weiter mit MWST: ${s501}`);
  await page.click('.druckansicht [data-aktion=schliessen]');

  // ---------- 4. Mahn-PDF (Zahlungserinnerung R-2026-503, 0 %) ----------
  await page.locator('tr:has-text("R-2026-503") [data-aktion=senden]').click();
  await page.waitForSelector('[data-rolle=auswahl-dialog]');
  await page.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
  await page.waitForSelector('[data-rolle=senden-formular]');
  await page.locator('[data-rolle=senden-formular] button[type=submit]').click(); await page.waitForTimeout(1200);
  const log = await page.evaluate(() => window.__teilen.log);
  fs.writeFileSync(`${M}/mahnung-R-2026-503.pdf`, Buffer.from(log[0]?.b64 || '', 'base64'));
  const mText = execSync(`pdftotext -layout ${M}/mahnung-R-2026-503.pdf - 2>/dev/null`).toString();
  ok(!mwstStellen(mText).length && mText.includes('Nicht mehrwertsteuerpflichtig.') && /Betrag\s+CHF 2.000\.00/.test(mText),
    `Mahn-PDF ohne MWST, «Betrag», Vermerk (${JSON.stringify(mwstStellen(mText).slice(0, 2))})`);
  const qrM = qrAusPdf(`${M}/mahnung-R-2026-503.pdf`);
  if (qrM) ok(qrM[0] === 'SPC' && qrM[18] === '2000.00', `Mahn-PDF QR-Betrag ${qrM[18]}`);
  ok(!VERBOTEN.test(mText), 'Mahn-PDF ohne Striche/ß');

  // ---------- 5. Offene Posten ----------
  await page.click('[data-ansicht=alle]'); await page.waitForTimeout(700);
  const op = norm(await page.locator('.rechnungen').innerText());
  ok(!/inkl\. MWST|exkl\. MWST/.test(op), 'Offene Posten ohne «exkl./inkl. MWST»');
  await shot('08-offene-posten', page, true);
  await pruefeText('Offene Posten');
  // Zahlungen-Dialog
  await page.click('[data-ansicht=baustelle]'); await page.waitForTimeout(600);
  await page.locator(`tr:has-text("${neu.nummer}") [data-aktion=zahlungen]`).click(); await page.waitForTimeout(500);
  const zd = norm(await page.locator('[data-rolle=zahlung-formular]').innerText());
  ok(zd.includes('Total CHF 1.00') && !zd.includes('inkl. MWST'), `Zahlungen-Dialog: ${zd.slice(0, 60)}`);
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForTimeout(900);

  // ---------- 6. Offerten ----------
  await page.click('.nav-eintrag:has-text("Offerten")'); await page.waitForTimeout(900);
  ok(await page.locator('[data-offerte]:has-text("O-2026-501") [data-aktion=ohne-mwst]').count() === 1, 'Offerte Entwurf 8.1: Knopf «ohne MWST neu rechnen»');
  ok(await page.locator('[data-offerte]:has-text("O-2026-502") [data-aktion=ohne-mwst]').count() === 0, 'Angenommene Offerte: kein Knopf');
  await page.click('.offerten [data-aktion=neu]').catch(async () => page.click('[data-aktion=neu]')); await page.waitForTimeout(600);
  const of = page.locator('[data-rolle=offert-formular]');
  await of.locator('[name=kunde]').fill('Gemeinde Bedorf');
  await of.locator('[name=objekt]').fill('Hausanschluss');
  const blk = of.locator('[data-rolle=lv-zeile][data-art=position]').first();
  await blk.locator('[data-o=nr]').fill('237.111');
  await blk.locator('[data-o=text]').fill('Rohr verlegen');
  await blk.locator('[data-o=einheit]').fill('m');
  await blk.locator('[data-o=mengeEingabe]').fill('12');
  await blk.locator('[data-o=ep]').fill('85.50');
  await page.waitForTimeout(300);
  const zz = norm(await of.locator('[data-rolle=zusammenzug]').innerText());
  ok(zz === "Total CHF 1'026.00", `Offerte-Formular Zusammenzug nur Total: «${zz}»`);
  await shot('09-offerte-formular');
  await pruefeText('Offerte-Formular');
  await of.locator('button[type=submit]').click(); await page.waitForTimeout(700);
  const oNeu = (await docs('offerte')).find((o) => o.objekt === 'Hausanschluss');
  ok(oNeu && oNeu.mwstSatz === 0, `neue Offerte ${oNeu?.nummer}: mwstSatz=${oNeu?.mwstSatz}`);
  const karte = page.locator(`[data-offerte="${oNeu._id}"]`);
  ok(!/MWST/.test(norm(await karte.locator('p.hinweis').first().innerText())), `Offerte-Karte: ${norm(await karte.locator('p.hinweis').first().innerText())}`);
  await karte.locator('[data-aktion=pdf]').click(); await page.waitForTimeout(700);
  const oDruck = norm(await page.locator('.druckansicht').innerText());
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${M}/offerte.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.locator('.druckansicht').screenshot({ path: `${SH}/10-offerte-pdf-ansicht.png` }).catch(() => {});
  await page.click('.druckansicht [data-aktion=schliessen]');
  const oPdf = execSync(`pdftotext -layout ${M}/offerte.pdf - 2>/dev/null`).toString();
  ok(!mwstStellen(oPdf).length && !mwstStellen(oDruck).length && oPdf.includes('Nicht mehrwertsteuerpflichtig.'), `Offert-PDF ohne MWST, mit Vermerk (${JSON.stringify(mwstStellen(oDruck).slice(0, 2))})`);
  ok(/Total CHF 1'026\.00 Nicht mehrwertsteuerpflichtig\./.test(oDruck), 'Offert-PDF: Total, darunter Vermerk');
  await page.locator('[data-offerte]:has-text("O-2026-501") [data-aktion=ohne-mwst]').click(); await page.waitForTimeout(600);
  const o501 = (await docs('offerte')).find((o) => o.nummer === 'O-2026-501');
  const o502 = (await docs('offerte')).find((o) => o.nummer === 'O-2026-502');
  ok(o501.mwstSatz === 0 && o502.mwstSatz === 8.1, `O-2026-501 → ${o501.mwstSatz}, angenommene O-2026-502 bleibt ${o502.mwstSatz}`);
  await shot('11-offerten-liste', page, true);
  await pruefeText('Offerten');

  // ---------- 7. Kreditoren ----------
  await page.click('.nav-eintrag:has-text("Kreditoren")'); await page.waitForTimeout(900);
  await page.click('[data-aktion=neu]'); await page.waitForTimeout(500);
  const kf = page.locator('[data-rolle=kreditor-formular]');
  ok(!(await kf.locator('[name=netto]').isVisible()) && !(await kf.locator('[name=vorsteuer]').isVisible()) && !(await kf.locator('[name=vorsteuerSatz]').isVisible()),
    'Kreditor-Formular: Netto und Vorsteuer ausgeblendet');
  ok(norm(await kf.locator('label:has([name=brutto])').innerText()) === 'Betrag [CHF] *', 'Kreditor-Formular: «Betrag [CHF] *»');
  await kf.locator('[name=lieferant]').fill('Kieswerk Neu AG');
  await kf.locator('[name=rechnungsNr]').fill('KN-1');
  await kf.locator('[name=brutto]').fill('1081');
  await shot('12-kreditor-formular');
  await pruefeText('Kreditor-Formular');
  await kf.locator('button[type=submit]').click(); await page.waitForTimeout(700);
  const kNeu = (await docs('kreditor')).find((k) => k.rechnungsNr === 'KN-1');
  ok(kNeu && kNeu.vorsteuerSatz === 0 && kNeu.vorsteuer === '0.00' && kNeu.netto === '1081.00' && kNeu.betrag === '1081.00',
    `neuer Kreditor: Satz ${kNeu?.vorsteuerSatz}, Vorsteuer ${kNeu?.vorsteuer}, netto ${kNeu?.netto}, betrag ${kNeu?.betrag}`);
  const kAlt = (await docs('kreditor')).find((k) => k.rechnungsNr === 'KA-1');
  ok(kAlt.netto === '1000.00' && kAlt.vorsteuer === '81.00', 'alter Kreditor mit Vorsteuer unverändert');
  const kText = norm(await page.locator('.uebersicht-tabelle').innerText());
  ok(!/inkl\. MWST|exkl\. MWST|Vorsteuer/.test(kText), 'Kreditoren-Tabelle ohne exkl./inkl. MWST, ohne Vorsteuer');
  await page.evaluate(async () => {
    const sp = await import('/kern/speicher.js');
    const k = (await sp.abfrage({ typ: 'kreditor' })).find((x) => x.rechnungsNr === 'KN-1');
    await sp.put({ ...k, status: 'visiert' });
  });
  await shot('13-kreditoren', page, true);

  // ---------- 8. Controlling und Dossier ----------
  await page.click('.nav-eintrag:has-text("Controlling")'); await page.waitForTimeout(800);
  await page.click('[data-aktion=neu]'); await page.waitForTimeout(500);
  await page.click('[data-aktion=vorschlaege]'); await page.waitForTimeout(800);
  const vor = norm(await page.locator('[data-rolle=vorschlags-liste]').innerText());
  ok(/S1: Kreditoren visiert\/bezahlt 2 Lieferantenrechnungen, Kosten \(Vorsteuer nicht abziehbar\) CHF 2'162/.test(vor), 'Controlling S1 brutto: 1081 + 1081 = 2162');
  ok(!/exkl\.|inkl\. MWST/.test(vor), 'Controlling ohne exkl./inkl. MWST');
  await shot('14-controlling', page, true);
  await page.click('.nav-eintrag:has-text("Dossier")'); await page.waitForTimeout(800);
  ok(!/inkl\. MWST/.test(await page.locator('.dossier').innerText()), 'Dossier ohne «inkl. MWST»');
  await shot('15-dossier', page, true);

  // ---------- 9. Schalter wieder ein: wie v58 ----------
  await page.evaluate(async () => { const st = await import('/kern/stamm.js'); await st.speichereFirma({ ...(await st.ladeFirma()), mwstPflichtig: true }); });
  await page.click('.nav-eintrag:has-text("Controlling")'); await page.waitForTimeout(700);
  await page.click('[data-aktion=neu]'); await page.waitForTimeout(400);
  await page.click('[data-aktion=vorschlaege]'); await page.waitForTimeout(700);
  const vor2 = norm(await page.locator('[data-rolle=vorschlags-liste]').innerText());
  ok(/netto exkl\. MWST CHF 2'081/.test(vor2), 'Schalter ein: S1 netto 1000 + 1081 = 2081');
  await page.click('.nav-eintrag:has-text("Rechnungen")'); await page.waitForTimeout(800);
  await page.click('.rechnungen [data-aktion=neu]'); await page.waitForTimeout(500);
  ok(norm(await rf.locator('[data-rolle=betrag-label]').innerText()) === 'Betrag netto exkl. MWST [CHF] *', 'Schalter ein: Betragsfeld wie v58');
  await rf.locator('[name=titel]').fill('Pflichtig wieder');
  await rf.locator('[name=betrag]').fill('617');
  await page.waitForTimeout(200);
  ok(norm(await rf.locator('[data-rolle=mwst-vorschau]').innerText()) === "Total netto exkl. MWST CHF 617.00 MWST 8.1 % CHF 49.98 Total inkl. MWST CHF 666.98", 'Schalter ein: Vorschau wie v58');
  ok(await rf.locator('[data-rolle=mwst-nr-warnung]').isVisible(), 'Schalter ein: Warnung MWST-Nr. wieder da');
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(600);
  ok((await docs('rechnung')).find((r) => r.titel === 'Pflichtig wieder').mwstSatz === 8.1, 'Schalter ein: neue Rechnung 8.1 %');
  ok(await page.locator('[data-aktion=ohne-mwst]').count() === 0, 'Schalter ein: kein Knopf «ohne MWST neu rechnen»');
  ok(await zelle(neu.nummer) === 'netto CHF 1.00 ohne MWST CHF 1.00', `Schalter ein: Rechnung mit 0 % wie v58 (${await zelle(neu.nummer)})`);
  await page.evaluate(async () => { const st = await import('/kern/stamm.js'); await st.speichereFirma({ ...(await st.ladeFirma()), mwstPflichtig: false }); });
  ok(!fehler.length, `Laptop: keine Konsolenfehler ${fehler.join(' | ')}`);
  const st = await ctx.storageState();
  await ctx.close();

  // ---------- 10. Handy 390×844 hell und dunkel ----------
  for (const schema of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: schema, isMobile: true, hasTouch: true, locale: 'de-CH' });
    await c.addInitScript(STUB);
    const hp = await c.newPage();
    const fe = [];
    hp.on('console', (m) => { if (m.type() === 'error') fe.push(m.text()); });
    hp.on('pageerror', (e) => fe.push(String(e)));
    hp.on('dialog', (d) => d.accept());
    await h.oeffne(hp);
    await hp.evaluate(async () => {
      const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js');
      await st.speichereFirma({ name: 'Muster Tiefbau GmbH', strasse: 'Werkstrasse', hausnummer: '12', plz: '8400', ort: 'Winterthur', land: 'CH',
        iban: 'CH9300762011623852957', mwstNr: '', mwstSatz: '8.1', mwstPflichtig: false });
      const B = (await st.speichereBaustelle({ ktr: 'T-600', name: 'Handyweg', ort: 'Cdorf', bauherr: 'Gemeinde Cdorf' })).baustelleId;
      const heute = z.heuteTag();
      for (const [nr, satz, status] of [['R-2026-601', 8.1, 'gestellt'], ['R-2026-602', 8.1, 'offen'], ['R-2026-603', 0, 'gestellt']]) {
        await sp.put({ typ: 'rechnung', baustelleId: B, nummer: nr, referenz: z.scorAusNummer(nr), tag: heute, titel: `Handy ${nr}`, betrag: '1234.50',
          mwstSatz: satz, zahlungsfristTage: 30, basis: { art: 'manuell', id: '', label: '' }, status, statusHistorie: [] });
      }
      await sp.put({ typ: 'kreditor', baustelleId: B, lieferant: 'Beton AG', rechnungsNr: 'B-1', tag: heute, betrag: '540.00', netto: '540.00', vorsteuerSatz: 0, vorsteuer: '0.00',
        zahlungsfristTage: 30, kostenart: 'Material', status: 'offen', statusHistorie: [] });
      localStorage.setItem('luense.aktiveBaustelle', B);
      localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    });
    await hp.reload(); await hp.waitForTimeout(1100);
    const sw = async () => hp.evaluate(() => document.documentElement.scrollWidth);
    const klein = (sel) => hp.evaluate((s) => [...document.querySelectorAll(s)]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && e.type !== 'hidden')
      .map((e) => e.name || e.textContent.trim().slice(0, 30)), sel);
    ok(await sw() <= 390, `${schema}: Rechnungen ohne horizontale Scrollbar (${await sw()})`);
    ok(!(await klein('.rechnungen button, .rechnungen input')).length, `${schema}: Rechnungen Knöpfe ≥ 44 px ${JSON.stringify(await klein('.rechnungen button'))}`);
    await hp.screenshot({ path: `${SH}/20-handy-${schema}-rechnungen.png`, fullPage: true });
    await pruefeText(`Handy ${schema} Rechnungen`, hp);
    await hp.click('.rechnungen [data-aktion=neu]'); await hp.waitForTimeout(400);
    await hp.fill('[data-rolle=rechnung-formular] [name=betrag]', '1234.50');
    await hp.locator('[data-rolle=mwst-vorschau]').scrollIntoViewIfNeeded();
    ok(!(await klein('[data-rolle=rechnung-formular] button, [data-rolle=rechnung-formular] input')).length, `${schema}: Rechnungsformular ≥ 44 px`);
    ok(await sw() <= 390, `${schema}: Formular ohne horizontale Scrollbar`);
    await hp.screenshot({ path: `${SH}/21-handy-${schema}-formular.png` });
    await hp.click('[data-rolle=rechnung-formular] [data-aktion=abbrechen]');
    await hp.click('#stamm-knopf'); await hp.waitForTimeout(400);
    await hp.click('summary:has-text("Firmendaten")');
    await hp.locator('.schalter-zeile').scrollIntoViewIfNeeded();
    ok(!(await klein('[data-rolle=firma-formular] input, [data-rolle=firma-formular] button')).length, `${schema}: Firmendaten ≥ 44 px (Schalter ${JSON.stringify(await hp.locator('[name=mwstPflichtig]').boundingBox())})`);
    ok(await sw() <= 390, `${schema}: Firmendaten ohne horizontale Scrollbar`);
    await hp.screenshot({ path: `${SH}/22-handy-${schema}-firmendaten.png` });
    await pruefeText(`Handy ${schema} Firmendaten`, hp);
    await hp.click('#stamm-knopf').catch(() => {}); await hp.waitForTimeout(300);
    await hp.evaluate(() => { localStorage.setItem('luense.aktivesModul', 'Kreditoren'); });
    await hp.reload(); await hp.waitForTimeout(900);
    await hp.click('[data-aktion=neu]'); await hp.waitForTimeout(400);
    ok(!(await klein('[data-rolle=kreditor-formular] input:not([type=radio]):not([type=file]), [data-rolle=kreditor-formular] button')).length, `${schema}: Kreditor-Formular ≥ 44 px`);
    ok(await sw() <= 390, `${schema}: Kreditoren ohne horizontale Scrollbar`);
    await hp.screenshot({ path: `${SH}/23-handy-${schema}-kreditor.png`, fullPage: true });
    await pruefeText(`Handy ${schema} Kreditor`, hp);
    await hp.evaluate(() => { localStorage.setItem('luense.aktivesModul', 'Offerten'); });
    await hp.reload(); await hp.waitForTimeout(900);
    await hp.click('[data-aktion=neu]'); await hp.waitForTimeout(400);
    ok(await sw() <= 390, `${schema}: Offerten ohne horizontale Scrollbar`);
    await hp.locator('[data-rolle=zusammenzug]').scrollIntoViewIfNeeded();
    await hp.screenshot({ path: `${SH}/24-handy-${schema}-offerte.png` });
    ok(!fe.length, `${schema}: keine Konsolenfehler ${fe.join(' | ')}`);
    await c.close();
  }
  ok(!sprachFehler.length, `Strich/ß-Prüfung ${JSON.stringify(sprachFehler)}`);
});
