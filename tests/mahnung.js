// Mahnwesen: Verzugszins (5 % p. a., /365, kaufmännisch gerundet),
// fällige Stufen nach Tagesgrenzen 30/60/75, Zahlungserinnerung,
// 1. und 2. Mahnung, Teilzahlung, Zurücknehmen, Fristen in den
// Firmendaten, Anrechnung an Verzugszins (Art. 85 OR) bei camt-Zahlung,
// Betreibung, CSV-Export, Offene Posten, Mahn-PDF mit QR, Sprachregeln
// über alle Module, Handy hell/dunkel.
'use strict';
const fs = require('fs');
const h = require('./hilfe');
const M = h.ausgabeOrdner('mahnung');
const SH = M;
const URL = h.URL;
const shot = (p, n, full = true) => p.screenshot({ path: `${SH}/${n}.png`, fullPage: full });
const norm = h.norm;

h.lauf('Mahnwesen', async (b, pr) => {
  const { ok, ueberspringe } = pr;
  const ctx = await b.newContext({ viewport: { width: 1180, height: 800 }, serviceWorkers: 'block', locale: 'de-CH' });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  page.on('pageerror', (e) => fehler.push(String(e)));
  const dialoge = [];
  page.on('dialog', (d) => { dialoge.push(d.message()); d.accept(); });
  await h.oeffne(page);

  // ---------- reine Rechnung: Verzugszins ----------
  const zins = await page.evaluate(async () => {
    const m = await import('/module/rechnung.js');
    return {
      a: m.verzugszinsRappen(1081000, '2026-01-01', '2026-01-31'), // 30 Tage
      b: m.verzugszinsRappen(3650, '2026-01-01', '2026-01-02'), // genau 0.5 Rp → 1
      c: m.verzugszinsRappen(3649, '2026-01-01', '2026-01-02'), // 0.49986 → 0
      d: m.verzugszinsRappen(1081000, '2026-01-01', '2026-01-01'),
      e: m.verzugszinsRappen(1081000, '2026-10-12', '2026-11-26'), // 45 Tage
      f: m.verzugszinsRappen(1081000, '2028-02-01', '2028-03-01'), // Schaltjahr: 29 Tage /365
    };
  });
  // Hand: 10'810.00 × 5 % × 30 / 365 = 16'215 / 365 = 44.4247 → 44.42
  ok(zins.a === 4442, `Zins 10'810.00, 30 Tage = ${zins.a / 100} (Hand: 10810*0.05*30/365 = 44.4247 → 44.42)`);
  ok(zins.b === 1 && zins.c === 0, `Rundung kaufmännisch auf 1 Rp: 0.5 → ${zins.b}, 0.4999 → ${zins.c}`);
  ok(zins.d === 0, 'Zins 0 Tage = 0');
  ok(zins.e === 6664, `Zins 45 Tage = ${zins.e / 100} (Hand: 66.637 → 66.64)`);
  ok(zins.f === 4294, `29 Tage = ${zins.f / 100} (Hand: 15674.5/365 = 42.9438 → 42.94)`);

  // ---------- Firmendaten + Testdaten ----------
  const H = await page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js');
    const z = await import('/kern/zahlung.js');
    await st.speichereFirma({ name: 'Muster Tiefbau AG', strasse: 'Werkstrasse', hausnummer: '12', plz: '8400', ort: 'Winterthur', land: 'CH',
      iban: 'CH9300762011623852957', telefon: '052 000 00 00', email: 'buero@muster-tiefbau.ch', mwstNr: 'CHE-123.456.789 MWST', mwstSatz: '8.1' });
    const bs = await st.speichereBaustelle({ ktr: 'T-200', name: 'Werkleitung Mahnweg', ort: 'Testdorf', bauherr: 'Gemeinde Testdorf' });
    const B = bs.baustelleId;
    const heute = z.heuteTag();
    const t = (n) => z.plusTage(heute, -n);
    const me = (stufe, tage, offen = 0) => ({ stufe, datum: t(tage), offenRappen: offen, zinsRappen: 0, zinsVon: '', zinsBis: '', zinsProzent: 0, fristTage: 10 });
    const r = (nummer, alter, betrag, extra = {}) => sp.put({ typ: 'rechnung', baustelleId: B, nummer, referenz: z.scorAusNummer(nummer), tag: t(alter),
      titel: `Test ${nummer}`, betrag, mwstSatz: 8.1, zahlungsfristTage: 30,
      debitor: { name: 'Gemeinde Testdorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: 'Testdorf', land: 'CH' },
      basis: { art: 'manuell', id: '', label: '' }, status: 'gestellt',
      statusHistorie: [{ status: 'offen', datum: t(alter) }, { status: 'gestellt', datum: t(alter) }], ...extra });
    await r('R-2026-201', 29, '5000');
    await r('R-2026-202', 30, '5000');
    await r('R-2026-203', 59, '5000', { mahnungen: [me(1, 29, 540500)] });
    await r('R-2026-204', 60, '10000', { mahnungen: [me(1, 30, 1081000)] });
    await r('R-2026-205', 74, '10000', { mahnungen: [me(1, 44, 1081000), me(2, 14, 1081000)] });
    await r('R-2026-206', 75, '10000', { mahnungen: [me(1, 45, 1081000), me(2, 15, 1081000)] });
    await r('R-2026-207', 90, '2000'); // nichts erstellt → nur Zahlungserinnerung (kein Überspringen)
    await r('R-2026-208', 90, '2000', { status: 'bezahlt', bezahltAm: t(1) });
    await r('R-2026-209', 40, '10000', { status: 'teilbezahlt', statusVorZahlung: 'gestellt',
      zahlungen: [{ datum: t(5), valuta: t(5), betrag: '3000', quelle: 'manuell', bankRef: '', referenz: '', gegenpartei: '', skonto: '' }] });
    await r('R-2026-210', 65, '2000', { mahnungen: [me(1, 5, 216200)] }); // Frist der Erinnerung läuft noch
    await r('R-2026-211', 40, '2000', { status: 'offen' }); // nicht gestellt
    await r('R-2026-212', 100, '2000', { status: 'teilbezahlt', statusVorZahlung: 'gestellt',
      zahlungen: [{ datum: t(5), valuta: t(5), betrag: '2162', quelle: 'manuell', bankRef: '', referenz: '', gegenpartei: '', skonto: '' }] }); // voll bezahlt via Zahlung, Status inkonsistent → offen 0
    // Kapital bezahlt, Zins der 1. Mahnung (44.42) offen → zum Zurücknehmen
    await r('R-2026-213', 70, '10000', { status: 'teilbezahlt', statusVorZahlung: 'gestellt',
      mahnungen: [me(1, 40, 1081000), { stufe: 2, datum: t(10), offenRappen: 1081000, zinsRappen: 4442, zinsVon: t(40), zinsBis: t(10), zinsProzent: 5, fristTage: 10 }],
      zahlungen: [{ datum: t(3), valuta: t(3), betrag: '10810', quelle: 'manuell', bankRef: '', referenz: '', gegenpartei: '', skonto: '' }] });
    await r('R-2026-214', 35, '1000'); // für das Handy
    // 1. Mahnung mit Zins 44.42, danach Teilzahlung 1000 → 2. Mahnung fällig (Art. 85 OR)
    await r('R-2026-215', 80, '10000', { status: 'teilbezahlt', statusVorZahlung: 'gestellt',
      mahnungen: [me(1, 50, 1081000), { stufe: 2, datum: t(20), offenRappen: 1081000, zinsRappen: 4442, zinsVon: t(50), zinsBis: t(20), zinsProzent: 5, fristTage: 10 }],
      zahlungen: [{ datum: t(10), valuta: t(10), betrag: '1000', quelle: 'manuell', bankRef: '', referenz: '', gegenpartei: '', skonto: '' }] });
    localStorage.setItem('luense.aktiveBaustelle', B);
    localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
    return { B, heute, t45: t(45), t30: t(30) };
  });
  await h.neuLaden(page);

  // camt-Testdateien (synthetisch): Kapital 204, Zins 204, Vollzahlung 206
  fs.mkdirSync(`${M}/camt`, { recursive: true });
  const refs = await page.evaluate(async () => { const z = await import('/kern/zahlung.js'); return { r204: z.scorAusNummer('R-2026-204'), r206: z.scorAusNummer('R-2026-206') }; });
  const deb = h.iban('CH', '09000000123456789');
  for (const [datei, betrag, scor, ref] of [['c1-kapital-204.xml', '10810.00', refs.r204, 'M-001'], ['c2-zins-204.xml', '44.42', refs.r204, 'M-002'],
    ['c3-voll-206.xml', '10876.64', refs.r206, 'M-003']]) {
    fs.writeFileSync(`${M}/camt/${datei}`, h.camt({ art: '054', version: '08', bis: H.heute, msgId: `N-${ref}`,
      eintraege: [{ ref, betrag, tag: H.heute, name: 'Gemeinde Testdorf', iban: deb, scor }] }));
  }

  const zeile = async (nr) => norm(await page.locator(`.uebersicht-tabelle tr:has-text("${nr}")`).first().innerText());
  const faellig = async (nr) => {
    const l = page.locator(`.uebersicht-tabelle tr:has-text("${nr}") .mahn-faellig`);
    return (await l.count()) ? norm(await l.innerText()) : '';
  };
  const erwartet = {
    'R-2026-201': '', 'R-2026-202': 'Zahlungserinnerung fällig',
    'R-2026-203': '', 'R-2026-204': '1. Mahnung fällig',
    'R-2026-205': '', 'R-2026-206': '2. Mahnung fällig',
    'R-2026-207': 'Zahlungserinnerung fällig', 'R-2026-208': '',
    'R-2026-209': 'Zahlungserinnerung fällig', 'R-2026-210': '', 'R-2026-211': '', 'R-2026-212': '',
    'R-2026-213': '', 'R-2026-214': 'Zahlungserinnerung fällig', 'R-2026-215': '2. Mahnung fällig',
  };
  const tagLabel = { 'R-2026-201': '29 Tage', 'R-2026-202': '30 Tage', 'R-2026-203': '59 Tage + ZE', 'R-2026-204': '60 Tage + ZE',
    'R-2026-205': '74 Tage + ZE + M1', 'R-2026-206': '75 Tage + ZE + M1', 'R-2026-207': '90 Tage, nichts erstellt',
    'R-2026-208': 'bezahlt', 'R-2026-209': 'teilbezahlt 40 Tage', 'R-2026-210': '65 Tage, ZE vor 5 Tagen (Frist läuft)',
    'R-2026-211': 'Status offen (nicht gestellt)', 'R-2026-212': 'Zahlungen decken alles',
    'R-2026-213': 'Kapital bezahlt, Zins 44.42 offen → nach Art. 85 OR Rest Kapital, M1-Frist lief', 'R-2026-214': '35 Tage',
    'R-2026-215': '80 Tage, M1 + Teilzahlung' };
  for (const [nr, erw] of Object.entries(erwartet)) {
    const ist = await faellig(nr);
    ok(ist === erw, `${nr} (${tagLabel[nr]}): «${ist || '—'}»`);
  }
  ok((await page.locator('[data-aktion=mahnen]').count()) === 7, `7 Knöpfe «Mahnung erstellen» (fällige Stufen): ${await page.locator('[data-aktion=mahnen]').count()}`);
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-201") [data-aktion=mahnen]').count()) === 0, '29 Tage: kein Knopf');
  await shot(page, '01-laptop-rechnungen-faellig');

  // Seit v57 fragt «Mahnung erstellen» nach, wenn der Kontoauszug fehlt
  // oder veraltet ist: hier bewusst «Trotzdem mahnen».
  const trotzdem = async (pg = page) => {
    await pg.waitForSelector('[data-rolle=auswahl-dialog], .druckansicht', { timeout: 8000 });
    if (await pg.locator('[data-rolle=auswahl-dialog]').count()) {
      warnungen++;
      await pg.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
    }
  };
  let warnungen = 0;
  // ---------- PDF-Helfer ----------
  let pdfNr = 0;
  const pdfSprache = [];
  async function pdfSichern(name) {
    await page.waitForSelector('.druckansicht'); await page.waitForTimeout(400);
    const text = norm(await page.locator('.druckansicht .bericht').innerText());
    await page.locator('.druckansicht').screenshot({ path: `${SH}/${name}-ansicht.png` }).catch(() => {});
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: `${M}/${name}.pdf`, format: 'A4', printBackground: true });
    const pt = h.pdfText(`${M}/${name}.pdf`);
    const schlecht = pt.match(/.{0,30}[–—ß].{0,30}/g);
    if (schlecht) pdfSprache.push(`${name}: ${schlecht.slice(0, 2).join(' | ')}`);
    await page.emulateMedia({ media: 'screen' });
    await page.click('.druckansicht [data-aktion=schliessen]');
    pdfNr++;
    return text;
  }
  const meldung = async () => norm(await page.locator('.rechnungen [data-rolle=meldung]').innerText());
  const doc = (nr) => page.evaluate(async (n) => (await (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' })).find((r) => r.nummer === n), nr);

  // 1. Mahnung mit Zins (R-2026-204: ZE vor 30 Tagen, offen 10'810.00)
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-204") [data-aktion=mahnen]'); await trotzdem();
  const p204 = await pdfSichern('02-pdf-1-mahnung-R-2026-204');
  ok(warnungen === 1, 'ohne Kontoauszug: Rückfrage «Zahlungen aktuell?» vor dem Mahnen');
  ok(p204.includes('1. Mahnung zu Rechnung R-2026-204'), 'PDF Titel 1. Mahnung');
  const qr204 = h.qrAusPdf(`${M}/02-pdf-1-mahnung-R-2026-204.pdf`);
  if (qr204.status === 'fehlt') ueberspringe('QR-Dekodierung Mahn-PDF: zxing-cpp nicht verfügbar');
  else ok(qr204.zeilen[0] === 'SPC' && qr204.zeilen[18] === '10854.42' && qr204.zeilen[27] === 'SCOR', `Mahn-PDF QR: Betrag ${qr204.zeilen[18]} (Kapital + Zins), ${qr204.zeilen[27]}`);
  ok(p204.includes('Muster Tiefbau AG') && p204.includes('Werkstrasse 12') && p204.includes('CHE-123.456.789 MWST'), 'PDF Briefkopf Firmendaten');
  ok(p204.includes("Betrag inkl. MWST: CHF 10'810.00") && p204.includes("Bereits bezahlt: CHF 0.00") && p204.includes("Offen (Kapital): CHF 10'810.00"), 'PDF Bezug zur Rechnung (Betrag inkl. MWST, bezahlt, offen)');
  ok(/Verzugszins 5 % p\. a\. auf CHF 10'810\.00 vom \d\d\.\d\d\.\d{4} bis \d\d\.\d\d\.\d{4} \(30 Tage\) .*CHF 44\.42/.test(p204), 'PDF Verzugszins-Zeile 30 Tage CHF 44.42');
  ok(p204.includes("Total zu bezahlen") && p204.includes("CHF 10'854.42"), 'PDF Total 10\'854.42');
  ok(p204.includes('Art. 102 Abs. 1 OR') && p204.includes('Art. 104 Abs. 1 OR') && !p204.includes('Betreibung'), 'PDF Text 1. Mahnung (OR 102/104, keine Betreibung)');
  ok(p204.includes('Zahlungsfrist: 10 Tage') && p204.includes('RF'), 'PDF neue Zahlungsfrist 10 Tage, Referenz');
  ok(!/Mahngebühr|Gebühr/i.test(p204), 'keine Mahngebühr');
  ok(!/ß/.test(p204), 'kein ß im PDF');
  const d204 = await doc('R-2026-204');
  const m2 = d204.mahnungen[1];
  ok(d204.mahnungen.length === 2 && m2.stufe === 2 && m2.offenRappen === 1081000 && m2.zinsRappen === 4442 && m2.zinsVon === H.t30 && m2.zinsBis === H.heute,
    `Eintrag mahnungen[1] = ${JSON.stringify(m2)}`);
  ok(d204.status === 'gestellt', 'Status bleibt gestellt (keine Zahlungen)');
  ok((await zeile('R-2026-204')).includes("CHF 10'854.42") && (await zeile('R-2026-204')).includes("davon Verzugszins CHF 44.42"), 'Offen 10\'854.42 mit «davon Verzugszins CHF 44.42»');
  ok((await faellig('R-2026-204')) === '', 'nach 1. Mahnung: keine fällige Stufe (2. Mahnung erst ab 75 Tagen)');
  ok((await zeile('R-2026-204')).includes('1. Mahnung'), 'Verlauf zeigt 1. Mahnung');

  // Zahlungserinnerung ohne Zins (R-2026-202, 5'405.00)
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-202") [data-aktion=mahnen]'); await trotzdem();
  const p202 = await pdfSichern('03-pdf-erinnerung-R-2026-202');
  ok(p202.includes('Zahlungserinnerung zu Rechnung R-2026-202') && !p202.includes('Verzugszins') && p202.includes("Total zu bezahlen CHF 5'405.00"), 'Zahlungserinnerung: kein Zins, Total 5\'405.00');
  ok(p202.includes('übersehen') && p202.includes('noch nicht beglichen'), 'Erinnerung: freundlicher Text «übersehen»');

  // Teilzahlung (R-2026-209: 10'810 − 3'000 = 7'810.00)
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-209") [data-aktion=mahnen]'); await trotzdem();
  const p209 = await pdfSichern('04-pdf-erinnerung-teilbezahlt-R-2026-209');
  ok(p209.includes("Bereits bezahlt: CHF 3'000.00") && p209.includes("Offen (Kapital): CHF 7'810.00") && p209.includes("Total zu bezahlen CHF 7'810.00"), 'Teilzahlung: offener Betrag 7\'810.00');
  ok(p209.includes('noch nicht vollständig beglichen'), 'Teilzahlung: «noch nicht vollständig beglichen»');
  ok((await doc('R-2026-209')).mahnungen[0].offenRappen === 781000, 'Eintrag offenRappen 781000');

  // 2. Mahnung (R-2026-206: ZE vor 45 Tagen → 66.64)
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=mahnen]'); await trotzdem();
  const p206 = await pdfSichern('05-pdf-2-mahnung-R-2026-206');
  ok(p206.includes('2. Mahnung zu Rechnung R-2026-206') && /\(45 Tage\) .*CHF 66\.64/.test(p206) && p206.includes("CHF 10'876.64"), '2. Mahnung: Zins 45 Tage 66.64, Total 10\'876.64');
  ok(p206.includes('Betreibung') && p206.includes('letztmals') && p206.includes('Bisherige Mahnstufen'), '2. Mahnung: Betreibung vorbehalten, Verlauf');
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=mahnen]').count()) === 0, 'nach 2. Mahnung: keine weitere Stufe');

  // Undo
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=mahn-zurueck]');
  await page.waitForTimeout(500);
  ok((await doc('R-2026-206')).mahnungen.length === 2 && (await faellig('R-2026-206')) === '2. Mahnung fällig', 'Zurücknehmen: 2. Mahnung entfernt, wieder fällig');
  // Mahn-PDF erneut öffnen (letzte Stufe = 1. Mahnung von R-2026-204)
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-204") [data-aktion=mahn-pdf]');
  const p204b = await pdfSichern('06-pdf-1-mahnung-erneut');
  ok(p204b.includes("CHF 10'854.42"), 'PDF erneut geöffnet: gleiche Beträge');

  // Reload-Persistenz
  await h.neuLaden(page);
  ok((await zeile('R-2026-204')).includes('1. Mahnung') && (await zeile('R-2026-202')).includes('Zahlungserinnerung') && (await faellig('R-2026-206')) === '2. Mahnung fällig', 'nach Neuladen: Stufen bleiben erhalten');

  // ---------- Offene Posten alle Baustellen ----------
  await page.click('[data-ansicht=alle]'); await page.waitForTimeout(700);
  const kachel = norm(await page.locator('[data-rolle=kachel-mahnung]').innerText());
  ok(kachel.toLowerCase().startsWith('mahnstufe fällig (4)'), `Kachel Offene Posten: ${kachel}`);
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-207") .mahn-faellig').innerText()).includes('Zahlungserinnerung fällig'), 'Offene Posten: Badge R-2026-207');
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-201") .mahn-faellig').count()) === 0, 'Offene Posten: 201 ohne Badge');
  await shot(page, '07-laptop-offene-posten');
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-207") [data-aktion=mahnen]'); await trotzdem();
  const p207 = await pdfSichern('08-pdf-erinnerung-aus-offenen-posten');
  ok(p207.includes("Total zu bezahlen CHF 2'162.00") && p207.includes('T-200'), 'Mahnung aus Offene Posten erstellt');
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-207") .mahn-faellig').count()) === 0, 'Offene Posten: 207 nach Erinnerung ohne Badge');

  // ---------- Firmendaten: Fristen ändern ----------
  const fr = await page.evaluate(async () => {
    const st = await import('/kern/stamm.js');
    const f = await st.ladeFirma();
    let fehler = '';
    try { await st.speichereFirma({ ...f, mahnTageErinnerung: '60', mahnTageMahnung1: '40', mahnTageMahnung2: '75' }); } catch (e) { fehler = e.message; }
    await st.speichereFirma({ ...f, mahnTageErinnerung: '20', mahnTageMahnung1: '40', mahnTageMahnung2: '50' });
    const neu = st.mahnFristenFirma(await st.ladeFirma());
    return { fehler, neu, standard: st.mahnFristenFirma(null) };
  });
  ok(fr.fehler.includes('aufsteigen') && fr.neu.join() === '20,40,50' && fr.standard.join() === '30,60,75', `Fristen: Prüfung «${fr.fehler}», neu ${fr.neu}, Standard ${fr.standard}`);
  await page.click('[data-ansicht=baustelle]'); await page.waitForTimeout(700);
  ok((await faellig('R-2026-201')) === 'Zahlungserinnerung fällig', 'Frist 20 Tage: R-2026-201 (29 Tage) jetzt fällig');
  await page.evaluate(async () => { const st = await import('/kern/stamm.js'); const f = await st.ladeFirma();
    await st.speichereFirma({ ...f, mahnTageErinnerung: '', mahnTageMahnung1: '', mahnTageMahnung2: '' }); });
  // Firmendaten-Formular
  await page.click('#stamm-knopf'); await page.waitForTimeout(500);
  await page.click('summary:has-text("Firmendaten")');
  const ff = page.locator('[data-rolle=firma-formular]');
  ok(await ff.locator('[name=mahnTageErinnerung]').inputValue() === '30' && await ff.locator('[name=mahnTageMahnung2]').inputValue() === '75', 'Formular zeigt Standardfristen 30/75');
  await ff.locator('.mahn-fristen').scrollIntoViewIfNeeded(); await shot(page, '09-laptop-firmendaten-fristen', false);


  // ---------- Verzugszins im geschuldeten Betrag, Kontoauszug, Betreibung ----------
  await page.evaluate((B) => { localStorage.setItem('luense.aktiveBaustelle', B); localStorage.setItem('luense.aktivesModul', 'Rechnungen'); localStorage.setItem('luense.rechnungAnsicht', 'baustelle'); }, H.B);
  await h.neuLaden(page);
  const kern = (nr) => page.evaluate(async (n) => {
    const z = await import('/kern/zahlung.js');
    const r = (await (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' })).find((x) => x.nummer === n);
    return { status: r.status, offen: z.offenRappen(r), soll: z.sollRappen(r), zins: z.zinsSollRappen(r), auf: z.offenAufteilung(r), bezahltAm: r.bezahltAm || '' };
  }, nr);
  let k = await kern('R-2026-204');
  ok(k.soll === 1085442 && k.offen === 1085442 && k.auf.zins === 4442, `kern: soll/offen 204 = ${k.soll}/${k.offen}, davon Zins ${k.auf.zins}`);
  async function importCamt(datei) {
    await page.click('[data-aktion=kontoauszug]');
    await page.setInputFiles('[data-rolle=camt-datei]', `${M}/camt/${datei}`);
    await page.waitForTimeout(900);
    const text = norm(await page.locator('.bank-dialog').innerText());
    await page.locator('.bank-dialog [data-wahl]').first().check();
    await page.locator('.bank-dialog').screenshot({ path: `${SH}/${datei.replace('.xml', '')}.png` });
    await page.click('.bank-dialog [data-aktion=verbuchen]'); await page.waitForTimeout(900);
    if (await page.locator('.bank-dialog').count()) await page.click('.bank-dialog [data-aktion=zu]');
    await page.waitForTimeout(500);
    return text;
  }
  let c = await importCamt('c1-kapital-204.xml');
  ok(/Teilzahlung, Rest CHF 44\.42/.test(c), 'camt: 10\'810.00 nach 1. Mahnung → Vorschau Teilzahlung, Rest CHF 44.42');
  k = await kern('R-2026-204');
  ok(k.status === 'teilbezahlt' && k.offen === 4442 && k.auf.zins === 0 && k.auf.kapital === 4442 && k.auf.zinsBezahlt === 4442,
    `nach Zahlung 10'810.00 (Art. 85 OR): ${k.status}, offen ${k.offen}, Zins gedeckt ${k.auf.zinsBezahlt}, Rest Kapital ${k.auf.kapital}`);
  ok((await zeile('R-2026-204')).includes("CHF 44.42") && !(await zeile('R-2026-204')).includes('davon Verzugszins'), 'Tabelle: Rest 44.42 ohne «davon Verzugszins» (ist Kapital)');
  ok((await faellig('R-2026-204')) === '', 'Rest Kapital, Frist der 1. Mahnung läuft: keine Stufe fällig');
  c = await importCamt('c2-zins-204.xml');
  ok(/R-2026-204.*voll|bezahlt/i.test(c), 'camt: Zins 44.42 → Vorschau voll');
  k = await kern('R-2026-204');
  ok(k.status === 'bezahlt' && k.offen === 0 && k.bezahltAm === H.heute, `nach Zins-Zahlung: ${k.status}, offen ${k.offen}`);

  // Zahlungen-Dialog mit Zinsanteil (R-2026-213), dann Mahnung zurücknehmen → Zins fällt weg → bezahlt
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-213") [data-aktion=zahlungen]'); await page.waitForTimeout(500);
  const zd = norm(await page.locator('[data-rolle=zahlung-formular]').innerText());
  ok(zd.includes("(inkl. Verzugszins CHF 44.42)") && zd.includes("offen CHF 44.42") && !zd.includes('davon Verzugszins') && zd.includes('teilbezahlt'), `Zahlungen-Dialog: ${zd.slice(0, 170)}`);
  await page.locator('[data-rolle=zahlung-formular]').screenshot({ path: `${SH}/15-zahlungen-dialog-zins.png` });
  await page.click('[data-rolle=zahlung-formular] [data-aktion=zu]'); await page.waitForTimeout(300);
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-213") [data-aktion=mahn-zurueck]'); await page.waitForTimeout(600);
  k = await kern('R-2026-213');
  ok(k.status === 'bezahlt' && k.offen === 0 && k.zins === 0, `Mahnung zurückgenommen: Zins weg, ${k.status}, offen ${k.offen}`);
  ok((await meldung()).includes('Status → bezahlt'), 'Meldung nennt Statuswechsel');

  // 2. Mahnung nach Teilzahlung: Zins zuerst gedeckt (Art. 85 OR)
  k = await kern('R-2026-215');
  ok(k.offen === 985442 && k.auf.zins === 0 && k.auf.kapital === 985442, `215 vor 2. Mahnung: offen ${k.offen}, Zins 0 (durch 1000 gedeckt)`);
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-215") [data-aktion=mahnen]'); await trotzdem();
  const p215 = await pdfSichern('19-pdf-2-mahnung-nach-teilzahlung-R-2026-215');
  const m215 = (await doc('R-2026-215')).mahnungen[2];
  // Hand: Basis 9'854.42 × 5 % × 50 / 365 = 67.4960 → 67.50; soll 10'810 + 67.50 − 1'000 = 9'877.50
  ok(m215.zinsBasisRappen === 985442 && m215.zinsRappen === 6750 && m215.zinsBezahltRappen === 6750 && m215.offenRappen === 987750 && m215.bezahltRappen === 100000,
    `215 Eintrag: ${JSON.stringify(m215)}`);
  ok(p215.includes("Bereits bezahlt: CHF 1'000.00") && p215.includes("an Verzugszins angerechnet (Art. 85 OR): CHF 67.50")
    && /auf CHF 9'854\.42 vom .* \(50 Tage\) .*CHF 67\.50/.test(p215) && p215.includes('bereits bezahlter Verzugszins') && p215.includes("Total zu bezahlen CHF 9'877.50"),
    'PDF 215: Zins 67.50 auf 9\'854.42, bezahlter Zins abgezogen, Total 9\'877.50');
  k = await kern('R-2026-215');
  ok(k.offen === 987750 && k.status === 'teilbezahlt', `215 nach 2. Mahnung: offen ${k.offen} = Total im PDF`);

  // 2. Mahnung erneut, dann Betreibung
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=mahnen]'); await trotzdem();
  await pdfSichern('16-pdf-2-mahnung-erneut');
  k = await kern('R-2026-206');
  ok(k.offen === 1087664, `206 offen inkl. Zins der 2. Mahnung: ${k.offen}`);
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=betreibung]');
  const bf = page.locator('[data-rolle=betreibung-formular]');
  await bf.locator('[name=nummer]').fill('2026-12345'); await bf.locator('[name=notiz]').fill('Betreibungsamt Testdorf');
  await bf.screenshot({ path: `${SH}/17-betreibung-dialog.png` });
  await bf.locator('button[type=submit]').click(); await page.waitForTimeout(600);
  const b206 = (await doc('R-2026-206')).betreibung;
  ok(b206 && b206.datum === H.heute && b206.nummer === '2026-12345' && b206.notiz === 'Betreibungsamt Testdorf', `betreibung = ${JSON.stringify(b206)}`);
  ok((await faellig('R-2026-206')) === 'Betreibung eingeleitet' && (await kern('R-2026-206')).offen === 1087664, 'Badge «Betreibung eingeleitet», Betrag unverändert');
  ok((await page.locator('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=mahn-zurueck]').count()) === 0, 'Mahnung zurücknehmen gesperrt, solange Betreibung vermerkt');
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=betreibung-zurueck]'); await page.waitForTimeout(500);
  ok(!(await doc('R-2026-206')).betreibung && (await page.locator('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=betreibung]').count()) === 1, 'Betreibung zurückgenommen, Knopf wieder da');
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-206") [data-aktion=betreibung]');
  await page.locator('[data-rolle=betreibung-formular] [name=nummer]').fill('2026-12345');
  await page.locator('[data-rolle=betreibung-formular] button[type=submit]').click(); await page.waitForTimeout(600);
  await page.click('[data-ansicht=alle]'); await page.waitForTimeout(700);
  ok((await faellig('R-2026-206')) === 'Betreibung eingeleitet', 'Offene Posten: Badge «Betreibung eingeleitet»');
  ok((await zeile('R-2026-206')).includes('davon Verzugszins CHF 66.64'), 'Offene Posten: davon Verzugszins 66.64');
  await shot(page, '18-laptop-offene-posten-betreibung');
  await page.click('[data-ansicht=baustelle]'); await page.waitForTimeout(700);

  // Excel-Export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-aktion=export]')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  const kopf = csv.split(/\r?\n/)[0];
  const z206 = csv.split(/\r?\n/).find((l) => l.includes('R-2026-206')) || '';
  ok(/Verzugszins CHF/.test(kopf) && /Mahnstufe/.test(kopf) && /Betreibung/.test(kopf) && /davon Verzugszins/.test(kopf), 'CSV: Spalten Mahnstufe, Verzugszins, Betreibung');
  ok(z206.includes('2. Mahnung') && /66[.,]64/.test(z206) && z206.includes('2026-12345'), 'CSV-Zeile 206: Stufe, Zins, Betreibungs-Nr.');

  // genaue Vollzahlung inkl. Zins schliesst trotz Betreibung
  c = await importCamt('c3-voll-206.xml');
  k = await kern('R-2026-206');
  ok(k.status === 'bezahlt' && k.offen === 0, `camt 10'876.64 genau → 206 ${k.status}`);
  ok((await faellig('R-2026-206')) === '', 'bezahlt: keine Marke mehr');

  // ---------- Beispielbaustelle ----------
  await page.click('#stamm-knopf'); await page.waitForTimeout(500);
  await page.click('[data-aktion=beispiel-laden]'); await page.waitForTimeout(3000);
  const demo = await page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const m = await import('/module/rechnung.js');
    const d = (await sp.abfrage({ typ: 'rechnung' })).find((r) => r.nummer === 'R-DEMO-003');
    return { demo: d?.demo, demoB: d?.demoBaustelleId, faellig: d && m.mahnStand(d, st.mahnFristenFirma(await st.ladeFirma())).faellig };
  });
  ok(demo.demo === true && demo.faellig === 2, `Beispiel R-DEMO-003: markiert demo=${demo.demo}, fällig Stufe ${demo.faellig} (1. Mahnung)`);

  // ---------- Sprachregeln: keine Gedankenstriche, kein ß in allen Modulen ----------
  const VERBOTEN = /[–—ß]/;
  const pruefeText = async (wo) => {
    const t = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label],[placeholder]')]
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' '));
    const m = t.match(/.{0,40}[–—ß].{0,40}/g);
    return m ? `${wo}: ${m.slice(0, 3).join(' | ')}` : '';
  };
  const sprachFehler = [];
  for (const B of [H.B, 'baustelle:beispiel-demo-2417']) {
    await page.evaluate((b) => localStorage.setItem('luense.aktiveBaustelle', b), B);
    await h.neuLaden(page);
    const n = await page.locator('.nav-eintrag').count();
    for (let i = 0; i < n; i++) {
      const knopf = page.locator('.nav-eintrag').nth(i);
      const name = norm(await knopf.innerText());
      await knopf.click({ force: true }); await page.waitForTimeout(900);
      const f = await pruefeText(`${B.slice(-4)} ${name}`); if (f) sprachFehler.push(f);
      if (name.startsWith('Rechnungen')) {
        for (const a of ['alle', 'baustelle']) { await page.click(`[data-ansicht=${a}]`); await page.waitForTimeout(600);
          const g = await pruefeText(`Rechnungen ${a}`); if (g) sprachFehler.push(g); }
      }
    }
  }
  await page.click('#stamm-knopf'); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  { const f = await pruefeText('Stamm'); if (f) sprachFehler.push(f); }
  await page.click('#stamm-knopf'); await page.waitForTimeout(600);
  ok(!sprachFehler.length, `keine «–», «—», «ß» in allen Modulen (${sprachFehler.join(' || ')})`);
  // Rechnungs-PDF zusätzlich (Sprachregeln im PDF)
  await page.evaluate((b) => { localStorage.setItem('luense.aktiveBaustelle', b); localStorage.setItem('luense.aktivesModul', 'Rechnungen'); localStorage.setItem('luense.rechnungAnsicht', 'baustelle'); }, H.B);
  await h.neuLaden(page);
  await page.click('.uebersicht-tabelle tr:has-text("R-2026-214") [data-aktion=pdf]');
  await pdfSichern('20-pdf-rechnung-R-2026-214');

  ok(!fehler.length, `keine Konsolenfehler (${fehler.join(' | ')})`);
  ok(!pdfSprache.length, `Mahn- und Rechnungs-PDF (${pdfNr}) ohne «–», «—», «ß» ${pdfSprache.join(' || ')}`);

  // ---------- Handy hell / dunkel ----------
  const state = await ctx.storageState({ indexedDB: true });
  for (const schema of ['light', 'dark']) {
    const hc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'de-CH', colorScheme: schema, isMobile: true, hasTouch: true, storageState: state });
    const hp = await hc.newPage();
    const hf = [];
    hp.on('console', (m) => { if (m.type() === 'error') hf.push(m.text()); });
    hp.on('pageerror', (e) => hf.push(String(e)));
    hp.on('dialog', (d) => d.accept());
    await h.oeffne(hp);
    await hp.evaluate((B) => { localStorage.setItem('luense.aktiveBaustelle', B); localStorage.setItem('luense.aktivesModul', 'Rechnungen'); localStorage.setItem('luense.rechnungAnsicht', 'baustelle'); }, H.B);
    await h.neuLaden(hp);
    async function sichtbar(ansichtName) {
      const r = await hp.evaluate(() => {
        const zeile = [...document.querySelectorAll('.uebersicht-tabelle tr')].find((tr) => tr.textContent.includes('R-2026-214'));
        const box = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, h: b.height } : null; };
        return { badge: box(zeile?.querySelector('.mahn-faellig')), knopf: box(zeile?.querySelector('[data-aktion=senden]')), // Hauptaktion «Erstellen und senden» (seit v57)
          scroll: document.querySelector('.tabellen-scroll')?.scrollLeft, sw: document.documentElement.scrollWidth };
      });
      ok(r.badge && r.knopf && r.badge.l >= 0 && r.badge.r <= 390 && r.knopf.l >= 0 && r.knopf.r <= 390 && r.scroll === 0,
        `Handy ${schema} ${ansichtName}: Marke ${r.badge && Math.round(r.badge.l)}–${r.badge && Math.round(r.badge.r)} px, Knopf ${r.knopf && Math.round(r.knopf.l)}–${r.knopf && Math.round(r.knopf.r)} px ohne Seitwärts-Scrollen`);
      ok(r.knopf && r.knopf.h >= 44, `Handy ${schema} ${ansichtName}: Knopf ${r.knopf && Math.round(r.knopf.h)} px hoch`);
      ok(r.sw <= 390, `Handy ${schema} ${ansichtName}: keine horizontale Seiten-Scrollbar (${r.sw})`);
    }
    await sichtbar('Diese Baustelle');
    await hp.evaluate(() => { const el = [...document.querySelectorAll('.uebersicht-tabelle tr')].find((tr) => tr.textContent.includes('R-2026-214')); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200); });
    await hp.waitForTimeout(300);
    await shot(hp, `10-handy-${schema}-rechnungen`, false);
    await hp.locator('.uebersicht-tabelle tr:has-text("R-2026-214") [data-aktion=mahnen]').click(); await trotzdem(hp);
    await hp.waitForSelector('.druckansicht'); await hp.waitForTimeout(500);
    await shot(hp, `11-handy-${schema}-mahnung-pdf`, false);
    await hp.locator('.zahlteil').scrollIntoViewIfNeeded(); await shot(hp, `12-handy-${schema}-zahlteil`, false);
    await hp.click('.druckansicht [data-aktion=schliessen]');
    // wieder zurücknehmen, damit der zweite Lauf dieselbe Ausgangslage hat
    await hp.locator('.uebersicht-tabelle tr:has-text("R-2026-214") [data-aktion=mahn-zurueck]').click(); await hp.waitForTimeout(400);
    await hp.click('[data-ansicht=alle]'); await hp.waitForTimeout(700);
    await sichtbar('Offene Posten');
    await shot(hp, `13-handy-${schema}-offene-posten`, false);
    await hp.evaluate(() => { const el = [...document.querySelectorAll('.uebersicht-tabelle tr')].find((tr) => tr.textContent.includes('R-2026-214')); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150); });
    await hp.waitForTimeout(300);
    await shot(hp, `13b-handy-${schema}-offene-posten-badge`, false);
    await hp.click('[data-ansicht=baustelle]'); await hp.waitForTimeout(300);
    await hp.click('#stamm-knopf'); await hp.waitForTimeout(500);
    await hp.click('summary:has-text("Firmendaten")');
    await hp.locator('.mahn-fristen').scrollIntoViewIfNeeded(); await shot(hp, `14-handy-${schema}-firmendaten`, false);
    ok(!hf.length, `Handy ${schema}: keine Konsolenfehler (${hf.join(' | ')})`);
    await hc.close();
  }
  await b.close();
});
