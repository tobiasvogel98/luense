// Rechnung mit MWST (Firma pflichtig): Firmendaten-Formular, Live-Vorschau,
// festgehaltener Satz, Tabelle, Rechnungs-PDF mit QR-Zahlteil (Betrag
// dekodiert), Handy dunkel.
'use strict';
const h = require('./hilfe');

async function richteEin(page) {
  return page.evaluate(async () => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js');
    const B = (await st.speichereBaustelle({ ktr: 'T-100', name: 'Kanalisation Testweg', ort: 'Testdorf', bauherr: 'Gemeinde Testdorf' })).baustelleId;
    const deb = { name: 'Gemeinde Testdorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: 'Testdorf', land: 'CH' };
    for (const [n, betrag, titel, satz] of [['R-2026-101', '12000', 'Akonto 1 Kanalisation', 8.1], ['R-2026-102', '8500', 'Akonto 2', 8.1],
      ['R-2026-103', '2450.50', 'Regiearbeiten KW 44', 8.1], ['R-2026-104', '1980', 'Regiearbeiten KW 41 (alt, ohne Satz)', undefined]]) {
      const doc = { typ: 'rechnung', baustelleId: B, nummer: n, referenz: z.scorAusNummer(n), tag: '2026-10-01', titel, betrag,
        zahlungsfristTage: 30, debitor: deb, basis: { art: 'manuell', id: '', label: '' }, status: 'gestellt',
        statusHistorie: [{ status: 'offen', datum: '2026-10-01' }, { status: 'gestellt', datum: '2026-10-01' }] };
      if (satz !== undefined) doc.mwstSatz = satz;
      await sp.put(doc);
    }
    localStorage.setItem('luense.aktiveBaustelle', B);
    localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
    return B;
  });
}

h.lauf('Rechnung mit MWST', async (browser, { ok, ueberspringe }) => {
  const AUS = h.ausgabeOrdner('rechnung-mwst');
  const { page, konsole } = await h.neueSeite(browser);
  await h.oeffne(page);

  // ---------- Firmendaten über das Formular ----------
  await page.click('summary:has-text("Firmendaten")');
  const f = page.locator('[data-rolle="firma-formular"]');
  ok(await f.locator('[name=mwstSatz]').inputValue() === '8.1', 'Firmendaten: MWST-Satz vorbelegt 8.1');
  ok(await f.locator('[name=mwstPflichtig]').isChecked(), 'Firmendaten: Schalter «MWST-pflichtig» standardmässig ein');
  for (const [n, v] of [['name', 'Muster Tiefbau AG'], ['strasse', 'Werkstrasse'], ['hausnummer', '12'], ['plz', '8400'],
    ['ort', 'Winterthur'], ['iban', h.FIRMEN_IBAN], ['mwstNr', 'CHE-123.456.789 MWST']]) await f.locator(`[name=${n}]`).fill(v);
  await f.locator('button[type=submit]').click(); await page.waitForTimeout(400);
  ok((await f.locator('.meldung').textContent()).includes('gespeichert'), 'Firmendaten gespeichert');

  await richteEin(page);
  await h.neuLaden(page);
  const r104 = (await h.docs(page, 'rechnung')).find((r) => r.nummer === 'R-2026-104');
  ok(r104.mwstSatz === 8.1, `Migration beim Start: Rechnung ohne Satz bekommt 8.1 (${r104.mwstSatz})`);

  // ---------- Neue Rechnung: Live-Vorschau ----------
  await page.click('[data-aktion=neu]'); await page.waitForTimeout(400);
  const rf = page.locator('[data-rolle=rechnung-formular]');
  ok(h.norm(await rf.locator('[data-rolle=betrag-label]').innerText()) === 'Betrag netto exkl. MWST [CHF] *', 'Betragsfeld «Betrag netto exkl. MWST [CHF]»');
  await rf.locator('[name=titel]').fill('Regiearbeiten KW 46');
  await rf.locator('[name=betrag]').fill('617');
  await page.waitForTimeout(200);
  const vorschau = h.norm(await rf.locator('[data-rolle=mwst-vorschau]').innerText());
  ok(vorschau === 'Total netto exkl. MWST CHF 617.00 MWST 8.1 % CHF 49.98 Total inkl. MWST CHF 666.98', `Vorschau netto, MWST (49.977 → 49.98), Total: ${vorschau}`);
  await rf.locator('button[type=submit]').click(); await page.waitForTimeout(600);
  const neu = (await h.docs(page, 'rechnung')).find((r) => r.titel === 'Regiearbeiten KW 46');
  ok(neu && neu.mwstSatz === 8.1 && neu.betrag === '617', `neue Rechnung ${neu?.nummer}: mwstSatz ${neu?.mwstSatz}, betrag ${neu?.betrag}`);

  // ---------- Tabelle ----------
  const zelle = async (nr) => h.norm(await page.locator(`tr:has-text("${nr}") td.zahl`).first().innerText());
  for (const [nr, erw] of [['R-2026-101', "netto CHF 12'000.00 MWST 8.1 % CHF 972.00 CHF 12'972.00"],
    ['R-2026-103', "netto CHF 2'450.50 MWST 8.1 % CHF 198.49 CHF 2'648.99"],
    ['R-2026-104', "netto CHF 1'980.00 MWST 8.1 % CHF 160.38 CHF 2'140.38"]]) {
    const t = await zelle(nr);
    ok(t === erw, `${nr} Betrag-Zelle: ${t}`);
  }
  ok(!(await page.locator('.rechnungen').innerText()).includes('ohne festgehaltenen'), 'kein Hinweis «ohne festgehaltenen MWST-Satz» mehr');

  // Satzänderung in den Firmendaten ändert festgehaltene Rechnungen nicht
  const satz = await page.evaluate(async () => {
    const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js'); const sp = await import('/kern/speicher.js');
    const fi = await st.ladeFirma();
    await st.speichereFirma({ ...fi, mwstSatz: '7.7' });
    const r = await sp.abfrage({ typ: 'rechnung' });
    const b = (n) => z.rechnungsBetraege(r.find((x) => x.nummer === n)).brutto;
    const res = { r101: b('R-2026-101'), r104: b('R-2026-104') };
    await st.speichereFirma({ ...fi, mwstSatz: '8.1' });
    return res;
  });
  ok(satz.r101 === 12972 && satz.r104 === 2140.38, `Firmensatz 7.7: R-2026-101 bleibt ${satz.r101}, R-2026-104 bleibt ${satz.r104}`);

  // ---------- Rechnungs-PDF mit QR-Zahlteil ----------
  await page.locator('tr:has-text("R-2026-103") [data-aktion=pdf]').click(); await page.waitForTimeout(800);
  const summen = h.norm(await page.locator('.druckansicht .druck-summen').innerText());
  ok(/^(Rechnungsbetrag )?Total netto exkl\. MWST CHF 2'450\.50 MWST 8\.1 % CHF 198\.49 Total inkl\. MWST CHF 2'648\.99$/.test(summen), `PDF-Zusammenzug, Total inkl. MWST zuletzt: ${summen}`);
  ok(!/Rundung/i.test(await page.locator('.druckansicht').innerText()), 'PDF ohne Rundungsdifferenz');
  const datei = await h.druckePdf(page, `${AUS}/rechnung-R-2026-103.pdf`);
  await page.click('.druckansicht [data-aktion=schliessen]');
  const text = h.pdfText(datei);
  ok(text.includes('Empfangsschein') && text.includes('Zahlteil') && /2 648\.99/.test(text), 'PDF: Zahlteil mit Empfangsschein, Betrag 2 648.99');
  ok(!h.VERBOTEN.test(text), `PDF ohne «–», «—», «ß» ${(text.match(/.{0,30}[–—ß].{0,30}/g) || []).slice(0, 3).join(' | ')}`);
  const qr = h.qrAusPdf(datei);
  if (qr.status === 'fehlt') ueberspringe('QR-Dekodierung: zxing-cpp nicht verfügbar (pip install zxing-cpp numpy oder LUENSE_PYLIB)');
  else {
    const z = qr.zeilen;
    const ref = await page.evaluate(async () => (await import('/kern/zahlung.js')).scorAusNummer('R-2026-103'));
    ok(z[0] === 'SPC' && z[3] === h.FIRMEN_IBAN && z[18] === '2648.99' && z[19] === 'CHF' && z[27] === 'SCOR' && z[28] === ref,
      `QR dekodiert: IBAN ${z[3]}, Betrag ${z[18]} ${z[19]}, ${z[27]} ${z[28]}`);
  }
  ok(!konsole.length, `Laptop: keine Konsolenfehler ${konsole.join(' | ')}`);
  await page.context().close();

  // ---------- Handy dunkel ----------
  const hs = await h.neueSeite(browser, { handy: true, schema: 'dark' });
  const p = hs.page;
  await h.oeffne(p);
  await p.evaluate(async (FIRMA) => (await import('/kern/stamm.js')).speichereFirma(FIRMA), h.FIRMA);
  await richteEin(p);
  await h.neuLaden(p);
  ok(await h.seitenBreite(p) <= 390, `Handy: Rechnungen ohne horizontale Scrollbar (${await h.seitenBreite(p)})`);
  const kleinListe = await h.kleineZiele(p, '.rechnungen button');
  ok(!kleinListe.length, `Handy: Knöpfe der Rechnungsliste ≥ 44 px ${JSON.stringify(kleinListe)}`);
  await p.click('[data-aktion=neu]'); await p.waitForTimeout(400);
  await p.fill('[data-rolle=rechnung-formular] [name=titel]', 'Test Handy');
  await p.fill('[data-rolle=rechnung-formular] [name=betrag]', '10000');
  const klein = await h.kleineZiele(p, '[data-rolle=rechnung-formular] button, [data-rolle=rechnung-formular] input');
  ok(!klein.length, `Handy: Touch-Ziele Rechnungsformular ≥ 44 px ${JSON.stringify(klein)}`);
  ok(await h.seitenBreite(p) <= 390, 'Handy: Formular ohne horizontale Scrollbar');
  await p.screenshot({ path: `${AUS}/handy-dunkel-formular.png` });
  await p.click('[data-rolle=rechnung-formular] [data-aktion=abbrechen]');
  await p.locator('tr:has-text("R-2026-101") [data-aktion=pdf]').click(); await p.waitForTimeout(800);
  ok(await h.seitenBreite(p) <= 390, 'Handy: Druckansicht ohne horizontale Scrollbar');
  await p.click('.druckansicht [data-aktion=schliessen]');
  await p.click('#stamm-knopf'); await p.waitForTimeout(400);
  await p.click('summary:has-text("Firmendaten")');
  const klein2 = await h.kleineZiele(p, '[data-rolle=firma-formular] input, [data-rolle=firma-formular] button');
  ok(!klein2.length, `Handy: Touch-Ziele Firmendaten ≥ 44 px ${JSON.stringify(klein2)}`);
  ok(!hs.konsole.length, `Handy: keine Konsolenfehler ${hs.konsole.join(' | ')}`);
});
