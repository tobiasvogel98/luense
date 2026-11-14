// Offerte: MWST-Satz festhalten (Migration, Firmensatz), Sperre der
// angenommenen Offerte, Kopie als Arbeitsversion (nie annehmbar),
// Rechenweg, Grabenrechner, Sprung aus dem Baustellen-Ausmass mit
// Kopienwahl, Rechenweg im Baustellen-Ausmass. Handy 390 × 844.
'use strict';
const h = require('./hilfe');

h.lauf('Offerte', async (browser, { ok }) => {
  const AUS = h.ausgabeOrdner('offerte');
  const { page, konsole, antworten, dialoge } = await h.neueSeite(browser, { handy: true });
  const alle = (p) => page.evaluate(async (praefix) => {
    const r = await new PouchDB('luense').allDocs({ include_docs: true, startkey: praefix, endkey: `${praefix}￿` });
    return r.rows.map((x) => x.doc);
  }, p);
  const offerten = () => alle('offerte:');
  const putDoc = (doc) => page.evaluate(async (d) => new PouchDB('luense').put(d), doc);
  const karte = (nr) => page.locator('.offert-karte')
    .filter({ has: page.locator('.rapport-kopf strong', { hasText: `${nr} ·` }) });
  const fenster = () => page.locator('[data-rolle="ausmass-fenster"]');
  const formular = () => page.locator('[data-rolle="offert-formular"]');
  const chf = (v) => `CHF ${v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sprache = [];

  await h.oeffne(page);

  // ---------- Migration: Altbestand ohne mwstSatz bekommt 8.1 ----------
  await putDoc({ _id: 'rechnung:alt-1', typ: 'rechnung', baustelleId: 'baustelle:alt', nummer: 'R-2025-900',
    tag: '2025-12-01', titel: 'Altrechnung', betrag: '1000', status: 'offen', datum: '2025-12-01T10:00:00Z' });
  await putDoc({ _id: 'offerte:alt-1', typ: 'offerte', baustelleId: 'offertwesen', nummer: 'O-2025-90',
    kunde: 'Alt AG', objekt: 'Altobjekt', status: 'angenommen', datum: '2025-11-01T10:00:00Z',
    gliederung: [{ art: 'position', nr: '1', text: 'Alt', einheit: 'm', menge: '10', ep: '12.34', ausmass: [] }] });
  await putDoc({ _id: 'firma:stamm', typ: 'firma', baustelleId: 'firma', name: 'Lünse Test AG',
    mwstSatz: '7.7', mwstNr: '', land: 'CH', datum: '2026-01-01T00:00:00Z' });
  await h.neuLaden(page);
  let alt = (await alle('rechnung:alt-1'))[0];
  let altO = (await alle('offerte:alt-1'))[0];
  ok(alt.mwstSatz === 8.1, `Migration: Altrechnung mwstSatz 8.1 (nicht Firmensatz 7.7): ${alt.mwstSatz}`);
  ok(altO.mwstSatz === 8.1, `Migration: alte, gesperrte Offerte mwstSatz 8.1: ${altO.mwstSatz}`);
  const revR = alt._rev; const revO = altO._rev;
  await h.neuLaden(page);
  alt = (await alle('rechnung:alt-1'))[0];
  altO = (await alle('offerte:alt-1'))[0];
  ok(alt._rev === revR && altO._rev === revO, 'Migration idempotent: zweiter Start schreibt nichts');

  await h.ladeBeispiel(page);
  const demo = (await offerten()).find((d) => d.nummer === 'O-DEMO-01');
  ok(demo && demo.mwstSatz === 8.1 && demo.status === 'angenommen', 'Beispiel-Offerte O-DEMO-01: angenommen, mwstSatz 8.1');

  // ---------- Firmendaten: Warnung MWST-Nr. fehlt ----------
  await page.locator('#stamm-knopf').click();
  await page.waitForTimeout(500);
  await page.locator('details', { has: page.locator('[data-rolle="firma-formular"]') }).locator('summary').click();
  const warnF = page.locator('[data-rolle="firma-formular"] [data-rolle="mwst-nr-warnung"]');
  ok(await warnF.isVisible() && (await warnF.textContent()).includes('MWST-Nr.'), 'Firmendaten: Warnung bei Satz 7.7 ohne MWST-Nr.');
  await page.locator('[name="mwstSatz"]').fill('0');
  ok(!(await warnF.isVisible()), 'Firmendaten: Satz 0, keine Warnung');
  await page.locator('[name="mwstSatz"]').fill('7.7');
  await page.locator('[name="mwstNr"]').fill('CHE-123.456.789 MWST');
  ok(!(await warnF.isVisible()), 'Firmendaten: MWST-Nr. erfasst, keine Warnung');
  await page.locator('[name="mwstNr"]').fill('');
  ok(await warnF.isVisible(), 'Firmendaten: MWST-Nr. wieder leer, Warnung');
  await page.locator('#stamm-knopf').click();
  await page.waitForSelector('#modul-nav:not([hidden])');
  await page.waitForTimeout(400);

  await h.geheZu(page, 'Rechnungen');
  await page.locator('[data-aktion="neu"]').first().click();
  await page.waitForTimeout(500);
  const rf = page.locator('[data-rolle="rechnung-formular"]');
  ok(await rf.locator('[data-rolle="mwst-nr-warnung"]').isVisible(), 'Rechnungsformular: Warnung «MWST-Nr. fehlt»');
  await rf.locator('[name="titel"]').fill('Test MWST-Nr.');
  await rf.locator('[name="betrag"]').fill('1234.55');
  const vorschau = h.norm(await rf.locator('[data-rolle="mwst-vorschau"]').innerText());
  ok(vorschau.includes('7.7 %') && vorschau.includes('95.06') && vorschau.includes("1'329.61"), `Rechnung: Vorschau mit Firmensatz 7.7: ${vorschau}`);
  await rf.locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  const neueR = (await h.docs(page, 'rechnung')).find((r) => r.titel === 'Test MWST-Nr.');
  ok(neueR && Number(neueR.mwstSatz) === 7.7, 'Rechnung: Speichern trotz Warnung, Satz 7.7 festgehalten');
  const rListe = await page.locator('#modul-inhalt').innerText();
  ok(!rListe.includes('ohne festgehaltenen'), 'Rechnungsliste ohne Hinweis «ohne festgehaltenen MWST-Satz» (alle migriert)');

  // ---------- Gesperrte Beispiel-Offerte ----------
  await h.geheZu(page, 'Offerten');
  const dk = karte('O-DEMO-01');
  ok(await dk.locator('.chip', { hasText: 'angenommen · gesperrt' }).count() === 1, 'Beispiel-Offerte: Chip «angenommen · gesperrt»');
  ok(await dk.locator('[data-aktion="oeffnen"]').count() === 0 && await dk.locator('[data-aktion="loeschen"]').count() === 0
    && await dk.locator('[data-aktion="weiter"]').count() === 0, 'gesperrt: kein Bearbeiten, Löschen, Statuswechsel');
  ok(await dk.locator('[data-aktion="kopie"].knopf-primaer').count() === 1, 'gesperrt: «Kopie erstellen» prominent');
  // Betrag exakt: Rabatt 3 %, Skonto 2 %, MWST 8.1 % des Originals (nicht Firmensatz 7.7)
  const summe = demo.gliederung.filter((z) => z.art === 'position').reduce((s, p) => s + Number(p.menge || 0) * Number(p.ep || 0), 0);
  const pct = (basis, satz) => Math.round(basis * satz / 100);
  const totalRp = Math.round(summe * 100);
  const rabRp = pct(totalRp, 3);
  const skRp = pct(totalRp - rabRp, 2);
  const exRp = totalRp - rabRp - skRp;
  const mwRp = pct(exRp, 8.1);
  const inkl = (exRp + mwRp) / 100;
  const kText = await dk.locator('.hinweis').first().innerText();
  ok(kText.includes(`${chf(inkl)} inkl. MWST`), `Beispiel-Offerte mit 8.1 % trotz Firmensatz 7.7: ${chf(inkl)} | ${h.norm(kText)}`);
  await dk.locator('[data-aktion="pdf"]').click();
  await page.waitForTimeout(500);
  const druck = await page.locator('.druckansicht').innerText();
  const zeilen = druck.split('\n').map((x) => x.trim()).filter(Boolean);
  const iNetto = zeilen.findIndex((x) => x.startsWith('Total netto exkl. MWST'));
  const iMwst = zeilen.findIndex((x) => x.startsWith('MWST 8.1 %'));
  const iInkl = zeilen.findIndex((x) => x.startsWith('Total inkl. MWST'));
  ok(iNetto >= 0 && iNetto < iMwst && iMwst < iInkl, `PDF: Reihenfolge netto, MWST, Total inkl. (${iNetto}, ${iMwst}, ${iInkl})`);
  ok(!druck.includes('Rundung') && !druck.includes('MwSt') && druck.includes(chf(mwRp / 100)) && druck.includes(chf(inkl)),
    `PDF: MWST ${chf(mwRp / 100)}, Total ${chf(inkl)} exakt, ohne «Rundung»`);
  ok(await page.locator('.druckansicht .druck-total').count() === 1, 'PDF: Total inkl. MWST fett');
  const pdfDatei = await h.druckePdf(page, `${AUS}/offerte-O-DEMO-01.pdf`);
  const pdfT = h.pdfText(pdfDatei);
  ok(!h.VERBOTEN.test(pdfT), `Offert-PDF ohne «–», «—», «ß» ${(pdfT.match(/.{0,30}[–—ß].{0,30}/g) || []).slice(0, 3).join(' | ')}`);
  await page.locator('.druckansicht [data-aktion="schliessen"]').click();

  await dk.locator('summary').click();
  await dk.locator('[data-ausmass-zeige]').nth(2).click();
  await page.waitForTimeout(300);
  ok(await fenster().locator('.sperre-hinweis').count() === 1 && await fenster().locator('fieldset[disabled]').count() === 1,
    'Mengen-Fenster der gesperrten Offerte: Hinweis, Felder deaktiviert');
  ok(await fenster().locator('[type="submit"]').count() === 0 && await fenster().locator('[data-aktion="az-neu"]').count() === 0,
    'gesperrt: kein Speichern, keine neue Ausmasszeile');
  await fenster().locator('[data-weg="graben"]').click();
  ok(await fenster().locator('[data-g="L"]').isDisabled(), 'gesperrt: Grabenrechner nur Ansicht');
  await fenster().locator('[data-weg="direkt"]').click();
  ok(await fenster().locator('[data-rolle="direkt-eingabe"]').isDisabled(), 'gesperrt: Direkteingabe nur Ansicht');
  await fenster().locator('[data-aktion="zu"]').click();
  ok(await fenster().count() === 0, 'Mengen-Fenster schliesst');

  // ---------- Sprung aus dem Baustellen-Ausmass: noch keine Kopie ----------
  const sprung = async (nr = '211.111') => {
    await h.geheZu(page, 'Ausmass');
    const pos = page.locator('article.position', { has: page.locator('strong', { hasText: new RegExp(`^${nr.replace('.', '\\.')}$`) }) });
    await pos.locator('[data-aktion="offert-ausmass"]').click();
    await page.waitForTimeout(900);
  };
  await sprung();
  ok(await fenster().count() === 1 && await fenster().locator('.sperre-hinweis').count() === 1, 'Sprung ohne Kopie: Original gesperrt, nur Ansicht');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(await fenster().count() === 0, 'Escape schliesst das Mengen-Fenster');

  // ---------- Neue Offerte mit Firmensatz 7.7 ----------
  await h.geheZu(page, 'Offerten');
  await page.locator('[data-aktion="neu"]').first().click();
  await page.waitForTimeout(500);
  const of = formular();
  await of.locator('[name="kunde"]').fill('Test Kunde');
  await of.locator('[name="objekt"]').fill('Testobjekt MWST');
  const pb = of.locator('[data-rolle="lv-zeile"][data-art="position"]').first();
  await pb.locator('[data-o="nr"]').fill('211.111');
  await pb.locator('[data-o="text"]').fill('Grabenaushub');
  await pb.locator('[data-o="einheit"]').fill('m³');
  await pb.locator('[data-o="mengeEingabe"]').fill('3*1.15');
  await pb.locator('[data-o="ep"]').fill('33.33');
  // 3.45 × 33.33 = 114.9885 → 114.99; MWST 7.7 % = 8.85; Total 123.84
  const zz = h.norm(await of.locator('[data-rolle="zusammenzug"]').innerText());
  ok(zz.includes('MWST 7.7 %') && zz.includes('8.85') && /Total inkl\. MWST CHF 123\.84$/.test(zz) && !zz.includes('Rundung'),
    `Editor-Zusammenzug exakt mit Firmensatz, Total zuletzt: ${zz}`);
  await of.locator('[type="submit"]').click();
  await page.waitForTimeout(700);
  const testO = (await offerten()).find((d) => d.objekt === 'Testobjekt MWST');
  ok(testO && testO.mwstSatz === 7.7, `neue Offerte ${testO?.nummer} hält mwstSatz 7.7 fest`);
  await page.evaluate(async () => {
    const db = new PouchDB('luense'); const f = await db.get('firma:stamm');
    f.mwstSatz = '8.5'; await db.put(f);
  });
  await h.geheZu(page, 'Dossier'); await h.geheZu(page, 'Offerten');
  ok((await karte(testO.nummer).locator('.hinweis').first().innerText()).includes('123.84'), 'Firmensatz 8.5 ändert bestehende Offerte nicht (123.84)');

  // Grabenrechner in der eigenen Offerte, dann annehmen
  const tk = karte(testO.nummer);
  await tk.locator('details.lv-details').evaluate((d) => { d.open = true; });
  await tk.locator('[data-ausmass-zeige]').first().click();
  await page.waitForTimeout(300);
  await fenster().locator('[data-weg="graben"]').click();
  await fenster().locator('[data-g="L"]').fill('48.5');
  await fenster().locator('[data-g="groesse"]').selectOption('aushub');
  const teil0 = fenster().locator('[data-rolle="g-teil"]').first();
  await teil0.locator('[data-gt="B"]').fill('0.95');
  await teil0.locator('[data-gt="H"]').fill('1.65');
  const gMengeText = await fenster().locator('[data-rolle="menge-ergebnis"]').textContent();
  ok(gMengeText.includes('76.02'), `Grabenrechner 48.5 m × 0.95 × 1.65 = 76.02: ${gMengeText}`);
  await fenster().locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  let tDoc = (await offerten()).find((d) => d._id === testO._id);
  const gPos = tDoc.gliederung.find((z) => z.art === 'position');
  ok(gPos.mengeQuelle === 'graben' && gPos.graben?.L === '48.5' && gPos.graben.teile[0].B === 0.95, 'Grabenangaben an der Position gespeichert');

  // Veralteter Editor: Sperre greift auch beim Speichern
  await karte(testO.nummer).locator('[data-aktion="oeffnen"]').click();
  await page.waitForTimeout(400);
  await karte(testO.nummer).locator('[data-aktion="weiter"]').click(); // eingereicht
  await page.waitForTimeout(400);
  antworten.push(true);
  await karte(testO.nummer).locator('[data-aktion="weiter"]').click(); // angenommen
  await page.waitForTimeout(500);
  ok(dialoge.some((t) => t.includes('gesperrt und lässt sich nicht mehr ändern')), 'Annehmen fragt nach (Sperre)');
  tDoc = (await offerten()).find((d) => d._id === testO._id);
  ok(tDoc.status === 'angenommen' && tDoc.angenommenAm, 'eigene Offerte angenommen');
  if (await formular().count()) {
    await formular().locator('[data-rolle="lv-zeile"][data-art="position"]').first().locator('[data-o="ep"]').fill('99');
    await formular().locator('[type="submit"]').click();
    await page.waitForTimeout(400);
    ok((await formular().locator('.meldung').textContent()).includes('gesperrt'), 'veralteter Editor: Speichern verweigert (gesperrt)');
    await formular().locator('[data-aktion="abbrechen"]').click();
  } else ok(false, 'Editor blieb nach Statuswechsel nicht offen');
  const originalJson = JSON.stringify((await offerten()).find((d) => d._id === testO._id).gliederung);
  ok(originalJson === JSON.stringify(tDoc.gliederung), 'angenommene Offerte unverändert');

  // Kopie der eigenen Offerte: Graben 1:1, Status nur Entwurf/eingereicht
  antworten.push('Test Arbeitsversion');
  await karte(testO.nummer).locator('[data-aktion="kopie"]').click();
  await page.waitForTimeout(800);
  const opts = await formular().locator('[name="status"] option').allTextContents();
  ok(JSON.stringify(opts) === '["Entwurf","eingereicht"]', `Kopie: Status nur ${opts.join('/')}`);
  // Kern-Sperre: auch ein manipulierter Status «angenommen» wird abgewiesen
  await formular().locator('[name="status"]').evaluate((s) => { s.add(new Option('angenommen', 'angenommen')); s.value = 'angenommen'; });
  await formular().locator('[type="submit"]').click();
  await page.waitForTimeout(500);
  const kMeld = await formular().locator('.meldung').textContent().catch(() => '');
  ok(kMeld.includes('kann nicht angenommen werden'), `Kopie annehmen verweigert: «${h.norm(kMeld)}»`);
  await formular().locator('[data-aktion="abbrechen"]').click();
  let kopie = (await offerten()).find((d) => d.kopieVon === testO._id);
  ok(kopie && kopie.status === 'Entwurf' && JSON.stringify(kopie.gliederung) === originalJson && kopie.mwstSatz === 7.7,
    'Kopie: Entwurf, Gliederung 1:1 (Graben, Mengen, Quelle), Satz des Originals 7.7');
  const kk = karte(kopie.nummer);
  await kk.locator('details.lv-details').evaluate((d) => { d.open = true; });
  await kk.locator('[data-ausmass-zeige]').first().click();
  await page.waitForTimeout(400);
  ok(await fenster().locator('[data-weg="graben"].aktiv').count() === 1 && await fenster().locator('[data-g="L"]').inputValue() === '48.5'
    && await fenster().locator('[data-rolle="g-teil"]').first().locator('[data-gt="B"]').inputValue() === '0.95'
    && await fenster().locator('[data-g="groesse"]').inputValue() === 'aushub'
    && await fenster().locator('[data-rolle="menge-ergebnis"]').textContent() === gMengeText,
  'Kopie: Grabenrechner vorbefüllt (L 48.5, B 0.95, Aushub, gleiche Menge)');
  await fenster().locator('[data-g="L"]').fill('52');
  await fenster().locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  kopie = (await offerten()).find((d) => d._id === kopie._id);
  ok(kopie.gliederung.find((z) => z.art === 'position').graben.L === '52', 'Kopie geändert (L 52)');
  ok(JSON.stringify((await offerten()).find((d) => d._id === testO._id).gliederung) === originalJson, 'Original unverändert nach Änderung der Kopie');
  await karte(kopie.nummer).locator('[data-aktion="weiter"]').click();
  await page.waitForTimeout(500);
  ok(await karte(kopie.nummer).locator('[data-aktion="weiter"]').count() === 0, 'Kopie eingereicht: kein Schritt zu «angenommen»');
  ok((await offerten()).find((d) => d._id === kopie._id).status === 'eingereicht', 'Kopie bleibt eingereicht, ungesperrt');
  antworten.push('Kopie der Kopie');
  await karte(kopie.nummer).locator('[data-aktion="kopie"]').click();
  await page.waitForTimeout(800);
  await formular().locator('[data-aktion="abbrechen"]').click();
  const kk2 = (await offerten()).find((d) => d.kopieVon === kopie._id);
  ok(kk2 && kk2.gliederung.find((z) => z.art === 'position').graben.L === '52', 'Kopie einer Kopie trägt den Graben mit');

  // ---------- Kopie der Beispiel-Offerte: Rechenweg, Grabenrechner ----------
  const nummernVorher = (await offerten()).map((o) => o.nummer);
  antworten.push('Musterweg Ausmass-Version');
  await karte('O-DEMO-01').locator('[data-aktion="kopie"]').click();
  await page.waitForTimeout(800);
  const f = formular();
  ok(f && await f.count() === 1, 'Kopie: Editor öffnet');
  const neueNr = await f.locator('[name="nummer"]').inputValue();
  const jahr = new Date().getFullYear();
  ok(new RegExp(`^O-${jahr}-\\d\\d$`).test(neueNr) && !nummernVorher.includes(neueNr), `Kopie: neue Nummer ${neueNr}`);
  ok(await f.locator('[name="titel"]').inputValue() === 'Musterweg Ausmass-Version' && await f.locator('[name="status"]').inputValue() === 'Entwurf',
    'Kopie: Name aus der Abfrage, Status Entwurf');
  ok(dialoge.some((t) => t.includes('· Ausmass')), 'Kopie: Namensvorschlag mit «· Ausmass»');
  await f.locator('[name="titel"]').fill('Demo Kopie A');
  const bloecke = f.locator('[data-rolle="lv-zeile"][data-art="position"]');
  ok(await bloecke.count() === 7, `Kopie: 7 Positionen übernommen (${await bloecke.count()})`);
  await bloecke.nth(0).locator('[data-o="mengeEingabe"]').fill('1');
  const b151 = bloecke.nth(1);
  const e151 = b151.locator('[data-o="mengeEingabe"]');
  const status151 = async () => b151.locator('[data-rolle="menge-status"]').textContent();
  await e151.fill('12*(3+');
  ok((await status151()).includes('Rechenweg ungültig') && await e151.getAttribute('aria-invalid') === 'true', 'Rechenweg ungültig: Meldung, Feld markiert');
  await f.locator('[type="submit"]').click();
  await page.waitForTimeout(300);
  ok((await f.locator('.meldung').textContent()).includes('Menge ungültig'), 'Speichern mit ungültigem Rechenweg blockiert');
  await e151.fill('abc');
  ok((await status151()).includes('Unerwartetes Zeichen'), 'Rechenweg mit Buchstaben: Meldung');
  await e151.fill('10/0');
  ok((await status151()).includes('Division durch null'), 'Rechenweg durch 0: Meldung');
  await e151.fill('12.5*3 + 4,2*2 + (1000 + 70.1)');
  const s151 = await status151();
  ok(s151.includes("1'116.00") && s151.includes('Rechenweg'), `Rechenweg gerechnet: ${h.norm(s151)}`);
  const b411 = bloecke.nth(3);
  await b411.locator('[data-aktion="ausmass"]').click();
  await page.waitForTimeout(300);
  await fenster().locator('[data-weg="graben"]').click();
  ok(await fenster().locator('[data-g="groesse"]').inputValue() === 'sandTotal', 'Grabenrechner: Vorschlag «Sand» aus dem Positionstext');
  await fenster().locator('[data-g="groesse"]').selectOption('aushub');
  await fenster().locator('[data-g="L"]').fill('100');
  await page.waitForTimeout(150);
  ok((await fenster().locator('[data-rolle="menge-ergebnis"]').textContent()).includes('120.00'), 'Grabenrechner: Aushub 100 m × 0.8 × 1.5 = 120.00');
  await fenster().locator('[data-g="groesse"]').selectOption('sandTotal');
  await page.waitForTimeout(150);
  const erwartetSand = await page.evaluate(async () => {
    const { berechneTeil, GRABENARTEN } = await import('/kern/graben.js');
    return Math.round(berechneTeil(100, GRABENARTEN.wasser.teile[0]).sandTotal * 100) / 100;
  });
  ok((await fenster().locator('[data-rolle="menge-ergebnis"]').textContent()).includes(erwartetSand.toLocaleString('de-CH', { minimumFractionDigits: 2 })),
    `Grabenrechner: Sand ${erwartetSand} wie kern/graben.js`);
  await fenster().locator('[type="submit"]').click();
  await page.waitForTimeout(200);
  ok((await b411.locator('[data-rolle="menge-status"]').textContent()).includes('Grabenrechner')
    && Number(await b411.locator('[data-o="mengeEingabe"]').inputValue()) === erwartetSand, 'Grabenrechner: Menge im Editor übernommen');
  await page.screenshot({ path: `${AUS}/editor-kopie.png` });
  await f.locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  ok(await formular().count() === 0, 'Kopie gespeichert');
  const kopieA = karte(neueNr);
  ok((await kopieA.textContent()).includes('Kopie von Offerte O-DEMO-01'), 'Kopie zeigt ihr Original');
  if (await kopieA.locator('details[open]').count() === 0) await kopieA.locator('summary').first().click();
  ok(await kopieA.locator('.lv-menge-marke', { hasText: 'Rechenweg' }).count() === 1
    && await kopieA.locator('.lv-menge-marke', { hasText: 'Grabenrechner' }).count() === 1, 'LV: Marken «Rechenweg» und «Grabenrechner»');
  await kopieA.locator('[data-ausmass-zeige]').nth(5).click();
  await page.waitForTimeout(300);
  ok(await fenster().locator('[data-weg="direkt"].aktiv').count() === 1, 'LV-Fenster startet mit «Direkt»');
  await fenster().locator('[data-rolle="direkt-eingabe"]').fill('(2+3)*4');
  await fenster().locator('[data-rolle="direkt-eingabe"]').press('Enter');
  await page.waitForTimeout(500);
  ok(await fenster().count() === 0 && (await kopieA.locator('[data-ausmass-zeige]').nth(5).textContent()).includes('20.00'), 'Enter speichert: Menge 20.00 aus Rechenweg');

  // ---------- Sprung: eine Kopie direkt, zwei Kopien mit Auswahl ----------
  await sprung();
  ok(await page.locator('[data-rolle="kopie-wahl"]').count() === 0
    && (await fenster().innerText()).includes(`Offerte ${neueNr}`) && await fenster().locator('.sperre-hinweis').count() === 0,
  `eine Kopie: Sprung direkt in ${neueNr}, bearbeitbar`);
  ok(await fenster().locator('[data-weg="zeilen"].aktiv').count() === 1 && (await fenster().locator('.ausmass-baustelle').textContent()).includes('Baustelle'),
    'Sprung: Ausmass-Zeilen aktiv, Baustellen-Menge sichtbar');
  await fenster().locator('[data-weg="direkt"]').click();
  await fenster().locator('[data-rolle="direkt-eingabe"]').fill('620*0.8*1.5 + 12*8*0.8*1.5');
  await page.waitForTimeout(100);
  ok((await fenster().locator('[data-rolle="menge-ergebnis"]').textContent()).includes('859.20'), 'Sprung-Fenster: Rechenweg 859.20');
  await fenster().locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  const kADoc = (await offerten()).find((o) => o.nummer === neueNr);
  ok(Number(kADoc.gliederung.find((z) => z.nr === '211.111').menge) === 859.2, 'Kopie A: 211.111 = 859.20 gespeichert');
  // zurück zur Baustelle
  await h.geheZu(page, 'Offerten');
  const kA2 = karte(neueNr);
  if (await kA2.locator('details[open]').count() === 0) await kA2.locator('summary').first().click();
  await kA2.locator('[data-ausmass-zeige="5"]').click();
  await page.waitForTimeout(600);
  await fenster().locator('[data-aktion="zur-baustelle"]').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('section.ausmass').count() === 1 && await page.locator('.fokus-karte').count() === 1,
    'zurück im Baustellen-Ausmass, Position hervorgehoben');
  // zweite Kopie (Kette: Kopie von Kopie A)
  await h.geheZu(page, 'Offerten');
  antworten.push('Demo Kopie B');
  await karte(neueNr).locator('[data-aktion="kopie"]').click();
  await page.waitForTimeout(800);
  await formular().locator('[data-aktion="abbrechen"]').click();
  await sprung();
  const wahl = page.locator('[data-rolle="kopie-wahl"]');
  ok(await wahl.count() === 1 && await wahl.locator('.kopie-wahl').count() === 3, 'zwei Kopien: Auswahl mit 2 Kopien und Original');
  const wText = await wahl.innerText();
  ok(wText.includes('Demo Kopie A') && wText.includes('Demo Kopie B') && /Kopie vom \d{2}\.\d{2}\.\d{4}/.test(wText), 'Auswahl mit Name und Datum (de-CH)');
  const hoehen = await wahl.locator('.kopie-wahl').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  ok(hoehen.every((x) => x >= 44), `Auswahl-Knöpfe ≥ 44 px (${hoehen.map(Math.round).join('/')})`);
  await page.screenshot({ path: `${AUS}/kopie-wahl.png` });
  await wahl.locator('.kopie-wahl').filter({ hasText: 'Demo Kopie A' }).click();
  await page.waitForTimeout(800);
  ok((await fenster().innerText()).includes(`Offerte ${neueNr}`), 'gewählte Kopie A geöffnet');
  await fenster().locator('[data-aktion="zu"]').click();
  await sprung();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(await wahl.count() === 0 && await fenster().count() === 0, 'Escape bricht die Auswahl ab');

  // ---------- Rechenweg im Baustellen-Ausmass ----------
  await h.geheZu(page, 'Ausmass');
  const p151 = () => page.locator('article.position', { has: page.locator('strong', { hasText: /^151\.111$/ }) });
  await p151().locator('[data-aktion="bearbeiten"]').click();
  await page.waitForTimeout(400);
  const af = page.locator('[data-rolle="erfassung"]');
  await af.locator('[name="menge"]').fill('12*(3+');
  ok((await af.locator('[data-rolle="menge-status"]').textContent()).includes('Rechenweg ungültig'), 'Ausmass: ungültiger Rechenweg gemeldet');
  await af.locator('[type="submit"]').click();
  await page.waitForTimeout(300);
  ok((await af.locator('.meldung').textContent()).includes('Rechenweg ungültig'), 'Ausmass: Speichern blockiert');
  await af.locator('[name="menge"]').fill('12.5*3 + 4,2*2');
  ok((await af.locator('[data-rolle="menge-status"]').textContent()).includes('45.9'), 'Ausmass: Vorschau 45.9');
  await af.locator('[type="submit"]').click();
  await page.waitForTimeout(600);
  let a151 = (await alle('ausmass:')).find((d) => d.pos === '151.111');
  ok(a151.menge === '45.9' && a151.mengeQuelle === 'rechenweg' && a151.mengeFormel === '12.5*3 + 4,2*2', `Ausmass: gespeichert ${a151.menge}, Formel ${a151.mengeFormel}`);
  await h.neuLaden(page);
  await h.geheZu(page, 'Ausmass');
  ok((await p151().innerText()).includes('Rechenweg: 12.5*3 + 4,2*2'), 'Ausmass: Rechenweg nach Neuladen sichtbar');
  await p151().locator('[data-aktion="bearbeiten"]').click();
  await page.waitForTimeout(300);
  ok(await af.locator('[name="menge"]').inputValue() === '12.5*3 + 4,2*2', 'Ausmass: Bearbeiten zeigt den Rechenweg');
  await af.locator('[name="menge"]').fill('40');
  await af.locator('[type="submit"]').click();
  await page.waitForTimeout(500);
  a151 = (await alle('ausmass:')).find((d) => d.pos === '151.111');
  ok(a151.menge === '40' && !a151.mengeFormel && !a151.mengeQuelle, 'Ausmass: Zahl getippt, Rechenweg entfernt');
  await p151().locator('[data-aktion="bearbeiten"]').click();
  await page.waitForTimeout(300);
  await af.locator('[name="menge"]').fill('(10+6)*2.5');
  await af.locator('[type="submit"]').click();
  await page.waitForTimeout(500);
  await p151().locator('[data-aktion="offert-ausmass"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-rolle="kopie-wahl"] .kopie-wahl').first().click();
  await page.waitForTimeout(1000);
  const bl = h.norm(await fenster().locator('[data-rolle="baustelle-link"]').innerText());
  ok(bl.includes('40.00') && bl.includes('(10+6)*2.5'), `Offert-Fenster zeigt Baustellen-Menge mit Rechenweg: ${bl}`);
  await fenster().locator('[data-aktion="zu"]').click();

  // ---------- Neuladen: alles gespeichert ----------
  await h.neuLaden(page);
  const nachher = await offerten();
  const orig = nachher.find((d) => d.nummer === 'O-DEMO-01');
  ok(orig._rev === demo._rev && JSON.stringify(orig.gliederung) === JSON.stringify(demo.gliederung), 'Beispiel-Offerte unverändert (gleiche Revision)');
  const kA = nachher.find((d) => d.nummer === neueNr);
  const p1 = kA.gliederung.find((z) => z.nr === '151.111');
  const p4 = kA.gliederung.find((z) => z.nr === '211.411');
  ok(p1.mengeQuelle === 'rechenweg' && p1.mengeFormel === '12.5*3 + 4,2*2 + (1000 + 70.1)' && p1.menge === '1116', `Kopie A: Rechenweg gespeichert (${p1.mengeFormel} = ${p1.menge})`);
  ok(p4.mengeQuelle === 'graben' && p4.graben?.L === '100' && Number(p4.menge) === erwartetSand, 'Kopie A: Grabenangaben gespeichert');
  ok(kA.gliederung.find((z) => z.nr === '113.111').menge === '1', 'Kopie A: direkte Menge 1 gl');
  ok(kA.kopieVon === orig._id && kA.zielBaustelleId === orig.zielBaustelleId && kA.demo === true,
    'Kopie A: kopieVon, Baustellen-Verknüpfung, als Beispiel markiert');
  await h.geheZu(page, 'Offerten');
  ok(await page.locator('.offert-karte').count() >= 7, 'Offerten nach Neuladen erhalten');
  await page.evaluate(() => document.querySelectorAll('#modul-inhalt details').forEach((d) => { d.open = true; }));
  sprache.push(...await h.sprachFehler(page, 'Offerten'));
  ok(await h.seitenBreite(page) <= 390, 'keine horizontale Scrollbar');
  ok(!sprache.length, `kein «–», «—», «ß» ${sprache.join(' || ')}`);
  ok(konsole.length === 0, `keine Konsolenfehler ${konsole.join(' | ')}`);
});
