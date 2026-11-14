// Mahn-Versand: Hinweis «Heute fällig» beim Start, Erstellen und senden
// (navigator.share und Zwischenablage als Attrappe: Teilen ok, Abbruch,
// ohne Datei-Teilen Download + mailto), E-Mail-Prüfung, Warnung «noch nie»
// bzw. «alter Kontoauszug», PDF mit Zahlteil auf eigener Seite und QR,
// Rechnungsformular E-Mail, Sprachregeln, Handy hell/dunkel.
'use strict';
const fs = require('fs');
const h = require('./hilfe');
const V = h.ausgabeOrdner('versand');
const SH = V;
const URL = h.URL;
const norm = h.norm;
const VERBOTEN = h.VERBOTEN;
const STUB = h.STUB_TEILEN;
function camt(bis, buchungen) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <BkToCstmrStmt><GrpHdr><MsgId>T-${bis}</MsgId><CreDtTm>${bis}T23:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>T-${bis}-1</Id><CreDtTm>${bis}T23:00:00</CreDtTm>
   <FrToDt><FrDtTm>${bis.slice(0, 8)}01T00:00:00</FrDtTm><ToDtTm>${bis}T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
   ${buchungen.map(([ref, betrag, tag, text]) => `<Ntry><NtryRef>${ref}</NtryRef><Amt Ccy="CHF">${betrag}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>${tag}</Dt></BookgDt><ValDt><Dt>${tag}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef>
    <NtryDtls><TxDtls><Refs><AcctSvcrRef>${ref}-TX</AcctSvcrRef></Refs><Amt Ccy="CHF">${betrag}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
     <RltdPties><Dbtr><Pty><Nm>Unbekannt AG</Nm></Pty></Dbtr></RltdPties><RmtInf><Ustrd>${text}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join('\n')}
  </Stmt></BkToCstmrStmt></Document>`;
}

// Testdaten: zwei Baustellen, fällig 2 Zahlungserinnerungen + 1 Mahnung
async function richteEin(page) {
  return page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js');
    const z = await import('/kern/zahlung.js');
    await st.speichereFirma({ name: 'Muster Tiefbau AG', strasse: 'Werkstrasse', hausnummer: '12', plz: '8400', ort: 'Winterthur', land: 'CH',
      iban: 'CH9300762011623852957', telefon: '052 000 00 00', email: 'buero@muster-tiefbau.ch', mwstNr: 'CHE-123.456.789 MWST', mwstSatz: '8.1' });
    const A = (await st.speichereBaustelle({ ktr: 'T-300', name: 'Werkleitung Versandweg', ort: 'Adorf', bauherr: 'Gemeinde Adorf' })).baustelleId;
    const B = (await st.speichereBaustelle({ ktr: 'T-301', name: 'Strasse Bedorf', ort: 'Bedorf', bauherr: 'Gemeinde Bedorf' })).baustelleId;
    const heute = z.heuteTag();
    const t = (n) => z.plusTage(heute, -n);
    const r = (B_, nummer, alter, betrag, email, extra = {}) => sp.put({ typ: 'rechnung', baustelleId: B_, nummer, referenz: z.scorAusNummer(nummer), tag: t(alter),
      titel: `Test ${nummer}`, betrag, mwstSatz: 8.1, zahlungsfristTage: 30,
      debitor: { name: B_ === A ? 'Gemeinde Adorf' : 'Gemeinde Bedorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: B_ === A ? 'Adorf' : 'Bedorf', land: 'CH', ...(email ? { email } : {}) },
      basis: { art: 'manuell', id: '', label: '' }, status: 'gestellt',
      statusHistorie: [{ status: 'offen', datum: t(alter) }, { status: 'gestellt', datum: t(alter) }], ...extra });
    await r(A, 'R-2026-301', 31, '5000', 'kasse@adorf.ch');
    await r(A, 'R-2026-302', 61, '10000', '', { mahnungen: [{ stufe: 1, datum: t(31), offenRappen: 1081000, zinsRappen: 0, zinsVon: '', zinsBis: '', zinsProzent: 0, fristTage: 10 }] });
    await r(B, 'R-2026-303', 35, '2000', '');
    await r(B, 'R-2026-304', 10, '3000', 'bau@bedorf.ch');
    await r(B, 'R-2026-305', 90, '1000', '', { status: 'bezahlt', bezahltAm: t(2) });
    localStorage.setItem('luense.aktiveBaustelle', A);
    localStorage.setItem('luense.aktivesModul', 'Journal');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
    return { A, B, heute, t10: t(10), t1: t(1) };
  });
}

h.lauf('Mahn-Versand', async (b, { ok, ueberspringe }) => {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block', locale: 'de-CH', acceptDownloads: true });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const fehler = [];
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  page.on('pageerror', (e) => fehler.push(String(e)));
  const dialoge = [];
  page.on('dialog', (d) => { dialoge.push(d.message()); d.accept(); });
  const downloads = [];
  page.on('download', async (d) => { const p = `${V}/download-${d.suggestedFilename()}`; await d.saveAs(p); downloads.push({ name: d.suggestedFilename(), pfad: p }); });
  const shot = (n, p = page, full = false) => p.screenshot({ path: `${SH}/${n}.png`, fullPage: full });
  const doc = (nr) => page.evaluate(async (n) => (await (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' })).find((r) => r.nummer === n), nr);
  const meldung = async () => norm(await page.locator('.rechnungen [data-rolle=meldung]').innerText());
  const sprachFehler = [];
  const pruefeText = async (wo, p = page) => {
    const t = await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label],[placeholder]')]
      .map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder].filter(Boolean).join(' ')).join(' ')
      + ' ' + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join(' '));
    const m = t.match(/.{0,40}[–—ß].{0,40}/g);
    if (m) sprachFehler.push(`${wo}: ${m.slice(0, 3).join(' | ')}`);
  };

  await h.oeffne(page);
  const H = await richteEin(page);
  await h.neuLaden(page);

  // ---------- 1. Hinweis beim Öffnen (Journal, Baustelle A) ----------
  const hinweis = page.locator('#start-hinweis .mahn-hinweis-text');
  ok(await page.locator('#start-hinweis').isVisible(), 'Start: Hinweis sichtbar (Modul Journal)');
  const hText = norm(await hinweis.innerText());
  ok(hText === 'Heute fällig: 2 Zahlungserinnerungen, 1 Mahnung', `Start: «${hText}» (über beide Baustellen)`);
  await shot('01-laptop-start-hinweis');
  await pruefeText('Start');
  await page.click('#start-hinweis [data-aktion=mahn-hinweis-oeffnen]'); await page.waitForTimeout(1200);
  ok(await page.locator('.rechnungen').isVisible(), 'Antippen öffnet Rechnungen');
  ok(await page.locator('[data-ansicht=alle].aktiv').count() === 1, 'Ansicht Offene Posten aktiv');
  ok(await page.locator('[data-aktion=nur-faellig].aktiv').count() === 1, 'Filter «Nur fällige Mahnstufen» aktiv');
  const zeilen = await page.locator('.uebersicht-tabelle tbody tr:not(.summen-zeile)').count();
  ok(zeilen === 3, `Gefiltert: 3 Zeilen (301, 302, 303), ist ${zeilen}; 304 nicht fällig ausgeblendet`);
  ok(!(await page.locator('.uebersicht-tabelle tr:has-text("R-2026-304")').count()), '304 (nicht fällig) nicht in der Liste');
  ok(await page.locator('#start-hinweis').isHidden(), 'Shell-Hinweis in Rechnungen ausgeblendet');
  ok(norm(await page.locator('.rechnungen [data-rolle=mahn-hinweis] .mahn-hinweis-text').innerText()) === hText, 'Hinweis auch im Modul Rechnungen');
  ok(await page.locator('[data-aktion=senden]').count() === 3, '3 Knöpfe «Erstellen und senden»');
  await shot('02-laptop-offene-posten-faellig', page, true);
  await pruefeText('Offene Posten fällig');

  const zeile = (nr) => page.locator(`.uebersicht-tabelle tr:has-text("${nr}")`).first();

  // ---------- 2. Teilen ok (301, E-Mail vorhanden), ohne Kontoauszug: Warnung ----------
  await zeile('R-2026-301').locator('[data-aktion=senden]').click();
  await page.waitForSelector('[data-rolle=auswahl-dialog]');
  const warn1 = norm(await page.locator('[data-rolle=auswahl-dialog]').innerText());
  ok(warn1.includes('Noch nie ein Kontoauszug eingelesen') && warn1.includes('Kontoauszug einlesen') && warn1.includes('Trotzdem mahnen'),
    `Warnung ohne Import: ${warn1.slice(0, 90)}`);
  await shot('03-laptop-warnung-kein-auszug');
  await pruefeText('Warnung');
  await page.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
  await page.waitForSelector('[data-rolle=senden-formular]');
  const f = page.locator('[data-rolle=senden-formular]');
  ok(await f.locator('[name=email]').inputValue() === 'kasse@adorf.ch', 'Senden-Dialog: E-Mail der Rechnung vorausgefüllt');
  ok(await f.locator('[name=betreff]').inputValue() === 'Zahlungserinnerung Rechnung R-2026-301', 'Betreff «Zahlungserinnerung Rechnung R-2026-301»');
  const mailText = await f.locator('[name=text]').inputValue();
  ok(mailText.startsWith('Sehr geehrte Damen und Herren\n\nUnsere Rechnung R-2026-301') && mailText.endsWith('Freundliche Grüsse\nMuster Tiefbau AG')
    && /CHF 5'405\.00 bis zum \d\d\.\d\d\.\d{4}/.test(norm(mailText)), `Mailtext Stufe 1: ${norm(mailText).slice(0, 160)} …`);
  ok(!VERBOTEN.test(mailText), 'Mailtext ohne Striche/ß');
  ok(norm(await f.innerText()).includes('Teilen-Menü'), 'Hinweis Teilen-Menü (Datei teilbar)');
  await shot('04-laptop-senden-dialog');
  await pruefeText('Senden-Dialog');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(1200);
  let log = await page.evaluate(() => window.__teilen.log);
  ok(log.length === 1, `navigator.share 1× aufgerufen (${log.length})`);
  const g = log[0] || {};
  ok(g.name === 'Zahlungserinnerung-R-2026-301.pdf' && g.type === 'application/pdf', `Datei ${g.name}, ${g.type}, ${g.size} Bytes`);
  ok(g.title === 'Zahlungserinnerung Rechnung R-2026-301' && g.text === mailText, 'share: title = Betreff, text = Mailtext');
  const pdf1 = Buffer.from(g.b64 || '', 'base64');
  fs.writeFileSync(`${V}/geteilt-R-2026-301.pdf`, pdf1);
  ok(pdf1.slice(0, 8).toString() === '%PDF-1.4', 'Datei beginnt mit %PDF-1.4');
  let d = await doc('R-2026-301');
  let m = d.mahnungen?.[0] || {};
  ok(d.mahnungen?.length === 1 && m.stufe === 1 && m.versandAn === 'kasse@adorf.ch' && m.versendetAm === H.heute && m.versandWeg === 'teilen',
    `Stufe festgehalten und versendet: ${JSON.stringify({ stufe: m.stufe, an: m.versandAn, am: m.versendetAm, weg: m.versandWeg })}`);
  ok((await meldung()).includes('ans Mail-Programm übergeben'), `Meldung: ${await meldung()}`);
  ok((await meldung()).includes('Adresse kopiert: kasse@adorf.ch. In der Mail-App ins Feld An einfügen.'), 'Hinweis «Adresse kopiert: … ins Feld An einfügen.»');
  ok(JSON.stringify(await page.evaluate(() => window.__zwischenablage)) === '["kasse@adorf.ch"]', 'Zwischenablage: Empfängeradresse');
  const seiten = String(h.pdfSeiten(`${V}/geteilt-R-2026-301.pdf`));
  const s1 = h.pdfTextSeite(`${V}/geteilt-R-2026-301.pdf`, 1);
  const s2 = h.pdfTextSeite(`${V}/geteilt-R-2026-301.pdf`, 2);
  ok(seiten === '2' && !s1.includes('Empfangsschein') && s2.includes('Empfangsschein') && s2.includes('Vor der Einzahlung abzutrennen'), `Zahlteil auf eigener Seite (${seiten} Seiten)`);
  ok(norm(await page.locator('.rechnungen [data-rolle=mahn-hinweis]').innerText()).includes('Heute fällig: 1 Zahlungserinnerung, 1 Mahnung'), 'Hinweis zählt nach: 1 Zahlungserinnerung, 1 Mahnung');

  // PDF prüfen: Text und QR-Code
  const pdfText = h.pdfText(`${V}/geteilt-R-2026-301.pdf`);
  fs.writeFileSync(`${V}/geteilt-R-2026-301.txt`, pdfText);
  ok(pdfText.includes('Zahlungserinnerung zu Rechnung R-2026-301') && pdfText.includes('Muster Tiefbau AG') && pdfText.includes('Gemeinde Adorf')
    && pdfText.includes('Winterthur, ') && /CHF 5.405\.00/.test(pdfText) && pdfText.includes('Freundliche Grüsse'), 'PDF-Text: Titel, Absender, Empfänger, Betrag, Gruss');
  ok(pdfText.includes('Empfangsschein') && pdfText.includes('Zahlteil') && pdfText.includes('Annahmestelle') && pdfText.includes('5 405.00'), 'PDF: Zahlteil mit Empfangsschein und Betrag 5 405.00');
  ok(!VERBOTEN.test(pdfText), 'PDF ohne Striche/ß');
  const qr = h.qrAusPdf(`${V}/geteilt-R-2026-301.pdf`);
  if (qr.status === 'fehlt') ueberspringe('QR-Dekodierung: zxing-cpp nicht verfügbar');
  else {
    const qrz = qr.zeilen;
    ok(qrz[0] === 'SPC' && qrz[3] === h.FIRMEN_IBAN && qrz[18] === '5405.00' && qrz[27] === 'SCOR' && qrz.includes('Zahlungserinnerung zu Rechnung R-2026-301'),
      `QR-Code im PDF lesbar: IBAN ${qrz[3]}, Betrag ${qrz[18]}, ${qrz[27]}, Mitteilung ${qrz[29]}`);
  }

  // ---------- 3. Teilen abgebrochen (302, keine E-Mail, Vorschlag aus 301) ----------
  await page.evaluate(() => { window.__teilen.modus = 'abbruch'; });
  await zeile('R-2026-302').locator('[data-aktion=senden]').click();
  await page.waitForSelector('[data-rolle=auswahl-dialog]');
  await page.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
  await page.waitForSelector('[data-rolle=senden-formular]');
  ok(await f.locator('[name=email]').inputValue() === 'kasse@adorf.ch', 'fehlende E-Mail: Vorschlag aus letzter Rechnung der Baustelle');
  ok(await f.locator('[data-rolle=email-fehlt]').isVisible(), 'Hinweis «An der Rechnung fehlt die E-Mail-Adresse»');
  ok(await f.locator('[name=betreff]').inputValue() === '1. Mahnung Rechnung R-2026-302', 'Betreff 1. Mahnung');
  const text2 = norm(await f.locator('[name=text]').inputValue());
  ok(text2.includes('trotz unserer Zahlungserinnerung') && text2.includes('einschliesslich Verzugszins'), 'Mailtext 1. Mahnung');
  await f.locator('[name=email]').fill('');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(200);
  ok(norm(await f.locator('.meldung').innerText()).includes('Bitte die E-Mail-Adresse'), 'leer: Rückfrage nach E-Mail');
  await f.locator('[name=email]').fill('buchhaltung@adorf');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(200);
  ok(norm(await f.locator('.meldung').innerText()).includes('E-Mail-Adresse ungültig'), 'ungültig: Formatfehler');
  await shot('06-laptop-senden-email-ungueltig');
  ok((await doc('R-2026-302')).mahnungen.length === 1, 'vor gültiger E-Mail nichts festgehalten');
  await f.locator('[name=email]').fill('buchhaltung@adorf.ch');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(1200);
  d = await doc('R-2026-302'); m = d.mahnungen[1] || {};
  ok(d.mahnungen.length === 2 && m.stufe === 2 && m.versandAn === 'buchhaltung@adorf.ch' && !m.versendetAm && m.zinsRappen > 0,
    `Abbruch: Stufe festgehalten, nicht versendet (Zins ${m.zinsRappen / 100})`);
  ok(d.debitor.email === 'buchhaltung@adorf.ch', 'E-Mail an der Rechnung gespeichert');
  ok((await meldung()).includes('noch nicht versendet'), `Meldung: ${await meldung()}`);
  ok(norm(await zeile('R-2026-302').innerText()).includes('1. Mahnung noch nicht versendet'), 'Zeile: «1. Mahnung noch nicht versendet»');
  ok(await zeile('R-2026-302').locator('[data-aktion=erneut-senden]').count() === 1 && await zeile('R-2026-302').locator('[data-aktion=als-versendet]').count() === 1,
    'Knöpfe «Erneut senden» und «Als versendet markieren»');
  ok(norm(await page.locator('.rechnungen [data-rolle=mahn-hinweis]').innerText()).includes('1 Zahlungserinnerung. 1 Mahnschreiben noch nicht versendet'),
    `Hinweis: ${norm(await page.locator('.rechnungen [data-rolle=mahn-hinweis] .mahn-hinweis-text').innerText())}`);
  await shot('07-laptop-noch-nicht-versendet', page, true);
  // erneut senden, diesmal ok: keine neue Stufe
  await page.evaluate(() => { window.__teilen.modus = 'ok'; });
  await zeile('R-2026-302').locator('[data-aktion=erneut-senden]').click();
  await page.waitForSelector('[data-rolle=auswahl-dialog]');
  await page.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
  await page.waitForSelector('[data-rolle=senden-formular]');
  ok(await f.locator('[name=email]').inputValue() === 'buchhaltung@adorf.ch' && norm(await f.locator('button[type=submit]').innerText()) === 'Erneut senden',
    'Erneut senden: gespeicherte E-Mail, Knopf «Erneut senden»');
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(1200);
  d = await doc('R-2026-302'); m = d.mahnungen[1] || {};
  log = await page.evaluate(() => window.__teilen.log);
  ok(d.mahnungen.length === 2 && m.versendetAm === H.heute && log.length === 3 && log[2].name === '1-Mahnung-R-2026-302.pdf',
    `Erneut gesendet ohne neue Stufe: ${d.mahnungen.length} Stufen, versendet ${m.versendetAm}, Datei ${log[2]?.name}`);
  fs.writeFileSync(`${V}/geteilt-R-2026-302.pdf`, Buffer.from(log[2].b64, 'base64'));
  const t302 = h.pdfText(`${V}/geteilt-R-2026-302.pdf`);
  ok(/Verzugszins 5 % p\. a\./.test(t302) && t302.includes('Art. 104 Abs. 1 OR') && !VERBOTEN.test(t302), 'PDF 1. Mahnung: Verzugszins, OR 104, ohne Striche/ß');

  // ---------- 4. Kontoauszug: alt → Warnung mit Datum; frisch → keine Warnung ----------
  fs.writeFileSync(`${V}/camt-alt.xml`, camt(H.t10, [['ALT-1', '150.00', H.t10, 'Rueckverguetung']]));
  fs.writeFileSync(`${V}/camt-frisch.xml`, camt(H.t1, [['NEU-1', '80.00', H.t1, 'Gutschrift']]));
  await page.click('[data-aktion=kontoauszug]');
  await page.setInputFiles('[data-rolle=camt-datei]', `${V}/camt-alt.xml`); await page.waitForTimeout(800);
  await page.click('.bank-dialog [data-aktion=verbuchen]'); await page.waitForTimeout(800);
  const st1 = await page.evaluate(async () => (await import('/kern/bank.js')).kontoauszugStand());
  ok(st1.tag === H.t10 && st1.veraltet, `Stand nach altem Auszug: ${st1.tag}, veraltet ${st1.veraltet}`);
  ok((await meldung()).includes('Stand der Bankdaten'), `Meldung Import: ${await meldung()}`);
  await zeile('R-2026-303').locator('[data-aktion=senden]').click();
  await page.waitForSelector('[data-rolle=auswahl-dialog]');
  const warn2 = norm(await page.locator('[data-rolle=auswahl-dialog]').innerText());
  const t10 = H.t10.split('-').reverse().join('.');
  ok(warn2.includes(`Letzter Kontoauszug vom ${t10}. Bitte zuerst einen aktuellen Auszug einlesen, damit niemand gemahnt wird, der schon bezahlt hat.`), `Warnung alter Auszug: ${warn2.slice(0, 120)}`);
  await shot('09-laptop-warnung-alter-auszug');
  await page.click('[data-rolle=auswahl-dialog] [data-wahl=einlesen]');
  await page.waitForSelector('.bank-dialog');
  ok(true, '«Kontoauszug einlesen» öffnet den Import');
  await page.setInputFiles('[data-rolle=camt-datei]', `${V}/camt-frisch.xml`); await page.waitForTimeout(800);
  await page.click('.bank-dialog [data-aktion=verbuchen]'); await page.waitForTimeout(1000);
  const st2 = await page.evaluate(async () => (await import('/kern/bank.js')).kontoauszugStand());
  ok(st2.tag === H.t1 && !st2.veraltet, `Stand nach frischem camt: ${st2.tag}, veraltet ${st2.veraltet}`);
  ok((await meldung()).includes('neu berechnet'), `Meldung: ${await meldung()}`);
  ok((await doc('R-2026-303')).mahnungen === undefined, '303: durch «Kontoauszug einlesen» nichts festgehalten');

  // ---------- 5. Laptop ohne Datei-Teilen: Download + mailto (303, Vorschlag aus 304) ----------
  await page.evaluate(() => { window.__teilen.modus = 'aus'; window.__anker = []; });
  await zeile('R-2026-303').locator('[data-aktion=senden]').click();
  await page.waitForSelector('[data-rolle=senden-formular]', { timeout: 3000 });
  ok(await page.locator('[data-rolle=auswahl-dialog]').count() === 0, 'frischer Auszug: keine Warnung');
  ok(await f.locator('[name=email]').inputValue() === 'bau@bedorf.ch', 'Vorschlag aus Rechnung 304 derselben Baustelle B');
  ok(norm(await f.locator('[data-rolle=versand-weg]').innerText()).includes('von Hand anhängen'), 'Hinweis: PDF von Hand anhängen');
  const ablageVorher = (await page.evaluate(() => window.__zwischenablage)).length;
  await shot('10-laptop-senden-mailto-dialog');
  const text3 = await f.locator('[name=text]').inputValue();
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(1500);
  const anker = await page.evaluate(() => window.__anker);
  const dl = anker.find((a) => a.download);
  const mt = anker.find((a) => a.href.startsWith('mailto:'));
  ok(dl && dl.download === 'Zahlungserinnerung-R-2026-303.pdf', `Download-Anker: ${dl?.download}`);
  ok(downloads.some((x) => x.name === 'Zahlungserinnerung-R-2026-303.pdf' && fs.readFileSync(x.pfad).slice(0, 5).toString() === '%PDF-'), 'Download-Datei ist ein PDF');
  const erwartet = `mailto:bau@bedorf.ch?subject=${encodeURIComponent('Zahlungserinnerung Rechnung R-2026-303')}&body=${encodeURIComponent(text3)}`;
  ok(mt && decodeURIComponent(mt.href) === decodeURIComponent(erwartet), `mailto: ${mt?.href.slice(0, 110)} …`);
  ok((await page.evaluate(() => window.__teilen.log.length)) === 3, 'share nicht aufgerufen');
  d = await doc('R-2026-303'); m = d.mahnungen?.[0] || {};
  ok(m.versandAn === 'bau@bedorf.ch' && !m.versendetAm && m.versandWeg === 'mailto' && d.debitor.email === 'bau@bedorf.ch', 'mailto: festgehalten, noch nicht versendet, E-Mail gespeichert');
  ok((await meldung()).includes('von Hand anhängen') && !(await meldung()).includes('Adresse kopiert'), `Meldung: ${await meldung()}`);
  ok((await page.evaluate(() => window.__zwischenablage)).length === ablageVorher, 'mailto: nichts in die Zwischenablage (Adresse steht im mailto)');
  await shot('11-laptop-mailto-meldung', page, true);
  await zeile('R-2026-303').locator('[data-aktion=als-versendet]').click(); await page.waitForTimeout(800);
  d = await doc('R-2026-303');
  ok(d.mahnungen[0].versendetAm === H.heute, 'Als versendet markiert');
  ok(await page.locator('.rechnungen [data-rolle=mahn-hinweis]').isHidden(), 'nichts mehr fällig: Hinweis weg');
  ok(norm(await page.locator('.rechnungen').innerText()).includes('Keine fällige Mahnstufe'), 'Liste: «Keine fällige Mahnstufe»');

  // ---------- 6. Reload: alles gespeichert ----------
  await page.evaluate(() => { localStorage.setItem('luense.aktivesModul', 'Journal'); });
  await h.neuLaden(page);
  ok(await page.locator('#start-hinweis').isHidden(), 'nach Reload: kein Hinweis (nichts fällig)');
  const persist = await page.evaluate(async () => (await (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' }))
    .filter((r) => r.mahnungen?.length).map((r) => `${r.nummer}:${r.mahnungen.map((x) => `${x.stufe}/${x.versendetAm ? 'v' : '-'}`).join(',')}:${r.debitor?.email}`).sort());
  ok(persist.join(' ') === 'R-2026-301:1/v:kasse@adorf.ch R-2026-302:1/-,2/v:buchhaltung@adorf.ch R-2026-303:1/v:bau@bedorf.ch', `nach Reload: ${persist.join(' ')}`);
  await page.evaluate((B) => { localStorage.setItem('luense.aktiveBaustelle', B); localStorage.setItem('luense.aktivesModul', 'Rechnungen'); localStorage.setItem('luense.rechnungAnsicht', 'baustelle'); }, H.B);
  await h.neuLaden(page);
  ok(norm(await zeile('R-2026-303').innerText()).includes(`Zahlungserinnerung ${H.heute.split('-').reverse().join('.')} (versendet`), 'Verlauf zeigt «(versendet …)»');

  // ---------- 7. Rechnungsformular: E-Mail ----------
  await page.click('[data-aktion=neu]'); await page.waitForTimeout(600);
  const rf = page.locator('[data-rolle=rechnung-formular]');
  ok(await rf.locator('[name=debEmail]').inputValue() === 'bau@bedorf.ch', 'neue Rechnung: E-Mail aus letzter Rechnung der Baustelle');
  const adr = await rf.evaluate((el) => ['debName', 'debStrasse', 'debHausnummer', 'debPlz', 'debOrt'].map((n) => el.elements[n].value).join('|'));
  ok(adr === 'Gemeinde Bedorf|Dorfstrasse|1|8000|Bedorf', `neue Rechnung: ganze Adresse aus R-2026-304 (${adr})`);
  await rf.locator('[name=titel]').fill('Test E-Mail');
  await rf.locator('[name=betrag]').fill('100');
  await rf.evaluate((el) => { el.querySelector('details').open = true; });
  await rf.locator('[name=debEmail]').fill('bau at bedorf');
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(500);
  ok(norm(await rf.locator('.meldung').innerText()).includes('E-Mail-Adresse ungültig'), 'Formular: ungültige E-Mail abgelehnt');
  await shot('12-laptop-formular-email-ungueltig');
  await rf.locator('[name=debEmail]').fill('neu@bedorf.ch');
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(800);
  const neuR = await page.evaluate(async () => (await (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' })).find((r) => r.titel === 'Test E-Mail'));
  ok(neuR?.debitor?.email === 'neu@bedorf.ch', `gespeichert mit E-Mail ${neuR?.debitor?.email}`);
  await page.locator(`.uebersicht-tabelle tr:has-text("Test E-Mail") [data-aktion=oeffnen]`).click(); await page.waitForTimeout(500);
  ok(await page.locator('[name=debEmail]').inputValue() === 'neu@bedorf.ch', 'Bearbeiten zeigt die E-Mail');
  await page.click('[data-rolle=rechnung-formular] [data-aktion=abbrechen]');

  // ---------- 8. Sprachregeln über alle Module ----------
  const n = await page.locator('.nav-eintrag').count();
  for (let i = 0; i < n; i++) {
    const knopf = page.locator('.nav-eintrag').nth(i);
    const name = norm(await knopf.innerText());
    await knopf.click({ force: true }); await page.waitForTimeout(700);
    await pruefeText(name);
  }
  ok(!sprachFehler.length, `keine «–», «—», «ß» (UI, Dialoge, Eingabefelder) ${sprachFehler.join(' || ')}`);
  ok(!fehler.length, `Laptop: keine Konsolenfehler ${fehler.join(' | ')}`);
  await ctx.close();

  // ---------- 9. Handy 390 × 844, hell und dunkel ----------
  for (const schema of ['light', 'dark']) {
    const hc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'de-CH',
      colorScheme: schema, isMobile: true, hasTouch: true });
    await hc.addInitScript(STUB);
    const hp = await hc.newPage();
    const hf = [];
    hp.on('console', (x) => { if (x.type() === 'error') hf.push(x.text()); });
    hp.on('pageerror', (e) => hf.push(String(e)));
    hp.on('dialog', (x) => x.accept());
    await h.oeffne(hp);
    await richteEin(hp);
    await h.neuLaden(hp);
    const box = (sel) => hp.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, h: r.height } : null; }, sel);
    const sw = () => hp.evaluate(() => document.documentElement.scrollWidth);
    const hb = await box('#start-hinweis .mahn-hinweis-knopf');
    const zu = await box('#start-hinweis .mahn-hinweis-zu');
    ok(hb && hb.h >= 44 && hb.r <= 390 && zu && zu.h >= 44 && zu.r <= 390 && (await sw()) <= 390, `Handy ${schema}: Start-Hinweis ${hb && Math.round(hb.h)} px, × ${zu && Math.round(zu.h)} px, Breite ${await sw()}`);
    await shot(`20-handy-${schema}-start-hinweis`, hp);
    await hp.click('#start-hinweis [data-aktion=mahn-hinweis-oeffnen]'); await hp.waitForTimeout(1200);
    const sk = await hp.evaluate(() => { const k = document.querySelector('.uebersicht-tabelle [data-aktion=senden]'); const r = k?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, h: r.height } : null; });
    ok(sk && sk.h >= 44 && sk.l >= 0 && sk.r <= 390 && (await sw()) <= 390, `Handy ${schema}: «Erstellen und senden» ${sk && Math.round(sk.l)} bis ${sk && Math.round(sk.r)} px, ${sk && Math.round(sk.h)} px hoch, keine Seiten-Scrollbar`);
    await shot(`21-handy-${schema}-offene-posten-faellig`, hp);
    await hp.locator('.uebersicht-tabelle tr:has-text("R-2026-301") [data-aktion=senden]').click();
    await hp.waitForSelector('[data-rolle=auswahl-dialog]');
    const wk = await hp.evaluate(() => [...document.querySelectorAll('[data-rolle=auswahl-dialog] .knopf')].map((k) => { const r = k.getBoundingClientRect(); return [r.height, r.right]; }));
    ok(wk.length === 3 && wk.every(([hh, r]) => hh >= 44 && r <= 390), `Handy ${schema}: Warnung, Knöpfe ≥ 44 px (${wk.map((x) => Math.round(x[0])).join('/')})`);
    await shot(`22-handy-${schema}-warnung`, hp);
    await hp.click('[data-rolle=auswahl-dialog] [data-wahl=trotzdem]');
    await hp.waitForSelector('[data-rolle=senden-formular]');
    const fk = await hp.evaluate(() => { const f = document.querySelector('[data-rolle=senden-formular]'); const r = f.getBoundingClientRect();
      return { r: r.right, l: r.left, k: [...f.querySelectorAll('.knopf, input')].map((k) => k.getBoundingClientRect().height) }; });
    ok(fk.l >= 0 && fk.r <= 390 && fk.k.every((x) => x >= 44), `Handy ${schema}: Senden-Dialog passt (${Math.round(fk.l)} bis ${Math.round(fk.r)}), Felder/Knöpfe ≥ 44 px`);
    await shot(`23-handy-${schema}-senden-dialog`, hp);
    await hp.evaluate(() => { window.__teilen.modus = 'abbruch'; });
    await hp.click('[data-rolle=senden-formular] button[type=submit]'); await hp.waitForTimeout(1200);
    const nv = await hp.evaluate(() => { const z = [...document.querySelectorAll('.uebersicht-tabelle tr')].find((tr) => tr.textContent.includes('R-2026-301'));
      return [...z.querySelectorAll('.mahn-spalte .knopf, .mahn-unversendet')].map((k) => { const r = k.getBoundingClientRect(); return [k.textContent.trim(), Math.round(r.right), Math.round(r.height)]; }); });
    ok(nv.length === 3 && nv.every(([, r]) => r <= 390) && nv.filter(([t]) => t !== 'Zahlungserinnerung noch nicht versendet').every(([, , hh]) => hh >= 44),
      `Handy ${schema}: «noch nicht versendet» mit 2 Knöpfen sichtbar ${JSON.stringify(nv)}`);
    await hp.evaluate(() => { const z = [...document.querySelectorAll('.uebersicht-tabelle tr')].find((tr) => tr.textContent.includes('R-2026-301')); window.scrollTo(0, z.getBoundingClientRect().top + window.scrollY - 120); });
    await hp.waitForTimeout(300);
    await shot(`24-handy-${schema}-noch-nicht-versendet`, hp);
    ok((await sw()) <= 390, `Handy ${schema}: keine horizontale Scrollbar (${await sw()})`);
    ok(!hf.length, `Handy ${schema}: keine Konsolenfehler ${hf.join(' | ')}`);
    await hc.close();
  }
  await b.close();
});
