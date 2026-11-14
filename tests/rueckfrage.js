// v60: Rückfrage beim Stellen einer Rechnung mit MWST, wenn die Firma
// nicht MWST-pflichtig ist (Art. 27 MWSTG): Abbrechen, daneben tippen,
// ohne MWST neu rechnen und stellen, trotzdem stellen. Offert-Kopie mit
// 0 % bei nicht pflichtiger Firma. Laptop und Handy hell/dunkel.
'use strict';
const h = require('./hilfe');
const SH = h.ausgabeOrdner('rueckfrage');
const URL = h.URL;
const norm = h.norm;
const sprachFehler = [];
const pruefeText = async (wo, p) => { sprachFehler.push(...await h.sprachFehler(p, wo)); };

async function setup(b, { schema = 'light', handy = false, pflichtig = false } = {}) {
  const c = await b.newContext({ viewport: handy ? { width: 390, height: 844 } : { width: 1120, height: 800 },
    serviceWorkers: 'block', colorScheme: schema, isMobile: handy, hasTouch: handy, locale: 'de-CH' });
  const p = await c.newPage();
  const fe = [];
  p.on('console', (m) => { if (m.type() === 'error') fe.push(m.text()); });
  p.on('pageerror', (e) => fe.push(String(e)));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Kopie Test' : undefined));
  await h.oeffne(p);
  await p.evaluate(async (pfl) => {
    const sp = await import('/kern/speicher.js'); const st = await import('/kern/stamm.js'); const z = await import('/kern/zahlung.js');
    await st.speichereFirma({ name: 'Muster Tiefbau GmbH', strasse: 'Werkstrasse', hausnummer: '12', plz: '8400', ort: 'Winterthur', land: 'CH',
      iban: 'CH9300762011623852957', mwstNr: 'CHE-123.456.789 MWST', mwstSatz: '8.1', mwstPflichtig: pfl });
    const B = (await st.speichereBaustelle({ ktr: 'T-700', name: 'Feinschliffweg', ort: 'Edorf', bauherr: 'Gemeinde Edorf' })).baustelleId;
    const heute = z.heuteTag();
    const deb = { name: 'Gemeinde Edorf', strasse: 'Dorfstrasse', hausnummer: '1', plz: '8000', ort: 'Edorf', land: 'CH', email: 'kasse@edorf.ch' };
    for (const nr of ['R-2026-701', 'R-2026-702', 'R-2026-703']) {
      await sp.put({ typ: 'rechnung', baustelleId: B, nummer: nr, referenz: z.scorAusNummer(nr), tag: heute, titel: `Test ${nr}`, betrag: '1000',
        mwstSatz: 8.1, zahlungsfristTage: 30, debitor: deb, basis: { art: 'manuell', id: '', label: '' }, status: 'offen',
        statusHistorie: [{ status: 'offen', datum: heute }] });
    }
    await sp.put({ typ: 'rechnung', baustelleId: B, nummer: 'R-2026-704', referenz: z.scorAusNummer('R-2026-704'), tag: heute, titel: 'Test 0', betrag: '500',
      mwstSatz: 0, zahlungsfristTage: 30, debitor: deb, basis: { art: 'manuell', id: '', label: '' }, status: 'offen',
      statusHistorie: [{ status: 'offen', datum: heute }] });
    const pos = [{ art: 'position', nr: '211.101', text: 'Aushub', einheit: 'm3', ep: '50', menge: '10', ausmass: [] }];
    await sp.put({ typ: 'offerte', baustelleId: 'offertwesen', nummer: 'O-2026-701', kunde: 'Gemeinde Edorf', objekt: 'Vertrag', status: 'angenommen',
      angenommenAm: '2026-10-01T10:00:00.000Z', mwstSatz: 8.1, gliederung: pos });
    localStorage.setItem('luense.aktiveBaustelle', B);
    localStorage.setItem('luense.aktivesModul', 'Rechnungen');
    localStorage.setItem('luense.rechnungAnsicht', 'baustelle');
  }, pflichtig);
  await p.reload(); await p.waitForTimeout(1100);
  const rech = async (nr) => (await p.evaluate(async () => (await import('/kern/speicher.js')).abfrage({ typ: 'rechnung' }))).find((r) => r.nummer === nr);
  const offerten = async () => p.evaluate(async () => (await import('/kern/speicher.js')).abfrage({ typ: 'offerte' }));
  return { c, p, fe, rech, offerten };
}

const dlg = '[data-rolle=auswahl-dialog]';

h.lauf('Rückfrage beim Stellen', async (b, { ok }) => {

  // ---------- A. Nicht pflichtig, Desktop ----------
  {
    const { c, p, fe, rech, offerten } = await setup(b, { pflichtig: false });
    // 1. Abbrechen
    await p.locator('tr:has-text("R-2026-701") [data-aktion=weiter]').click(); await p.waitForTimeout(400);
    ok(await p.locator(dlg).isVisible(), 'Nicht pflichtig, Satz 8.1: Rückfrage erscheint');
    const txt = norm(await p.locator(dlg).innerText());
    ok(txt.includes('Diese Rechnung weist MWST aus, Ihre Firma ist aber nicht mehrwertsteuerpflichtig. Ausgewiesene MWST ist trotzdem geschuldet (Art. 27 MWSTG).'), `Dialogtext: ${txt}`);
    const knoepfe = await p.locator(`${dlg} [data-wahl]`).allInnerTexts();
    ok(JSON.stringify(knoepfe) === JSON.stringify(['Ohne MWST neu rechnen und stellen', 'Trotzdem stellen', 'Abbrechen']), `Knöpfe ${JSON.stringify(knoepfe)}`);
    const hoehen = await p.$$eval(`${dlg} [data-wahl]`, (els) => els.map((e) => e.getBoundingClientRect().height));
    ok(hoehen.every((h) => h >= 44), `Knöpfe ≥ 44 px ${JSON.stringify(hoehen)}`);
    await pruefeText('Dialog Desktop', p);
    await p.screenshot({ path: `${SH}/01-dialog-desktop.png` });
    await p.click(`${dlg} [data-wahl=abbrechen]`); await p.waitForTimeout(400);
    let r = await rech('R-2026-701');
    ok(!(await p.locator(dlg).count()) && r.status === 'offen' && r.mwstSatz === 8.1, `Abbrechen: bleibt offen mit 8.1 (${r.status}, ${r.mwstSatz})`);
    // Daneben tippen = abbrechen
    await p.locator('tr:has-text("R-2026-701") [data-aktion=weiter]').click(); await p.waitForTimeout(400);
    await p.mouse.click(5, 5); await p.waitForTimeout(400);
    r = await rech('R-2026-701');
    ok(!(await p.locator(dlg).count()) && r.status === 'offen', 'Daneben tippen: abgebrochen, bleibt offen');
    // 2. Ohne MWST neu rechnen und stellen
    await p.locator('tr:has-text("R-2026-701") [data-aktion=weiter]').click(); await p.waitForTimeout(400);
    await p.click(`${dlg} [data-wahl=neu]`); await p.waitForTimeout(600);
    r = await rech('R-2026-701');
    ok(r.status === 'gestellt' && r.mwstSatz === 0, `Neu rechnen: gestellt mit 0 % (${r.status}, ${r.mwstSatz})`);
    ok(r.statusHistorie.at(-1).status === 'gestellt', 'Statusverlauf ergänzt');
    const meld = norm(await p.locator('.rechnungen .meldung, .rechnungen [role=status]').first().innerText().catch(() => ''));
    
    ok(/R-2026-701 → gestellt\. Ohne MWST neu gerechnet: Total CHF 1'000\.00 \(vorher CHF 1'081\.00 mit MWST 8\.1 %\)\./.test(meld), 'Meldung nennt neu gerechnetes Total');
    ok(norm(await p.locator('tr:has-text("R-2026-701") td.zahl').first().innerText()) === "CHF 1'000.00", 'Tabelle: nur Total CHF 1000.00');
    // 3. Trotzdem stellen
    await p.locator('tr:has-text("R-2026-702") [data-aktion=weiter]').click(); await p.waitForTimeout(400);
    await p.click(`${dlg} [data-wahl=trotzdem]`); await p.waitForTimeout(600);
    r = await rech('R-2026-702');
    ok(r.status === 'gestellt' && r.mwstSatz === 8.1, `Trotzdem: gestellt mit 8.1 (${r.status}, ${r.mwstSatz})`);
    // Rechnung mit 0 %: keine Rückfrage
    await p.locator('tr:has-text("R-2026-704") [data-aktion=weiter]').click(); await p.waitForTimeout(500);
    r = await rech('R-2026-704');
    ok(!(await p.locator(dlg).count()) && r.status === 'gestellt', 'Rechnung 0 %: ohne Rückfrage gestellt');
    // Gestellt → bezahlt: keine Rückfrage
    await p.locator('tr:has-text("R-2026-702") [data-aktion=weiter]').click(); await p.waitForTimeout(500);
    r = await rech('R-2026-702');
    ok(!(await p.locator(dlg).count()) && r.status === 'bezahlt', 'gestellt → bezahlt: keine Rückfrage');
    await pruefeText('Rechnungen Desktop', p);
    // Reload
    await p.reload(); await p.waitForTimeout(1100);
    const r1 = await rech('R-2026-701'); const r2 = await rech('R-2026-702');
    ok(r1.status === 'gestellt' && r1.mwstSatz === 0 && r2.mwstSatz === 8.1, 'Reload: Status und Sätze bleiben');
    ok(norm(await p.locator('tr:has-text("R-2026-701") td.zahl').first().innerText()) === "CHF 1'000.00", 'Reload: Tabelle zeigt CHF 1000.00');
    // Offert-Kopie: 0 %
    await p.evaluate(() => localStorage.setItem('luense.aktivesModul', 'Offerten'));
    await p.reload(); await p.waitForTimeout(1100);
    await p.locator('[data-offerte]:has-text("O-2026-701") [data-aktion=kopie]').click(); await p.waitForTimeout(900);
    let kopie = (await offerten()).find((o) => o.kopieVon);
    ok(kopie && kopie.mwstSatz === 0, `Nicht pflichtig: Kopie ${kopie?.nummer} mit mwstSatz ${kopie?.mwstSatz}`);
    const orig = (await offerten()).find((o) => o.nummer === 'O-2026-701');
    ok(orig.mwstSatz === 8.1, 'Original behält 8.1');
    const zz = norm(await p.locator('[data-rolle=offert-formular] [data-rolle=zusammenzug]').innerText());
    ok(zz === "Total CHF 500.00", `Kopie-Formular: nur Total («${zz}»)`);
    ok(!(await p.locator('[data-rolle=offert-formular] [data-rolle=ohne-mwst-hinweis]').count()), 'Kopie-Formular: kein «ohne MWST neu rechnen» nötig');
    await p.screenshot({ path: `${SH}/02-kopie-nicht-pflichtig.png` });
    await pruefeText('Offerten Desktop', p);
    await p.reload(); await p.waitForTimeout(1100);
    kopie = (await offerten()).find((o) => o.kopieVon);
    ok(kopie.mwstSatz === 0, 'Reload: Kopie bleibt 0 %');

    ok(!fe.length, `A: keine Konsolenfehler ${fe.join(' | ')}`);
    await c.close();
  }

  // ---------- B. Pflichtig, Desktop ----------
  {
    const { c, p, fe, rech, offerten } = await setup(b, { pflichtig: true });
    await p.locator('tr:has-text("R-2026-701") [data-aktion=weiter]').click(); await p.waitForTimeout(600);
    const r = await rech('R-2026-701');
    ok(!(await p.locator(dlg).count()) && r.status === 'gestellt' && r.mwstSatz === 8.1, `Pflichtig: ohne Rückfrage gestellt mit 8.1 (${r.status}, ${r.mwstSatz})`);
    await p.evaluate(() => localStorage.setItem('luense.aktivesModul', 'Offerten'));
    await p.reload(); await p.waitForTimeout(1100);
    await p.locator('[data-offerte]:has-text("O-2026-701") [data-aktion=kopie]').click(); await p.waitForTimeout(900);
    const kopie = (await offerten()).find((o) => o.kopieVon);
    ok(kopie && kopie.mwstSatz === 8.1, `Pflichtig: Kopie mit Satz des Originals (${kopie?.mwstSatz})`);
    await p.reload(); await p.waitForTimeout(1000);
    ok((await offerten()).find((o) => o.kopieVon).mwstSatz === 8.1, 'Reload: Kopie bleibt 8.1');

    ok(!fe.length, `B: keine Konsolenfehler ${fe.join(' | ')}`);
    await c.close();
  }

  // ---------- C. Handy hell/dunkel ----------
  for (const schema of ['light', 'dark']) {
    const { c, p, fe, rech } = await setup(b, { schema, handy: true, pflichtig: false });
    const knopf = p.locator('tr:has-text("R-2026-703") [data-aktion=weiter]');
    await knopf.scrollIntoViewIfNeeded();
    await knopf.click(); await p.waitForTimeout(400);
    ok(await p.locator(dlg).isVisible(), `${schema}: Dialog auf dem Handy`);
    const boxen = await p.$$eval(`${dlg} [data-wahl]`, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.height), Math.round(r.right)]; }));
    ok(boxen.every(([h, r]) => h >= 44 && r <= 390), `${schema}: Knöpfe ≥ 44 px und im Bild ${JSON.stringify(boxen)}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, `${schema}: keine horizontale Scrollbar`);
    await p.screenshot({ path: `${SH}/10-handy-${schema}-dialog.png` });
    await pruefeText(`Handy ${schema}`, p);
    await p.click(`${dlg} [data-wahl=neu]`); await p.waitForTimeout(600);
    const r = await rech('R-2026-703');
    ok(r.status === 'gestellt' && r.mwstSatz === 0, `${schema}: neu gerechnet und gestellt`);
    await p.screenshot({ path: `${SH}/11-handy-${schema}-nachher.png`, fullPage: true });

    ok(!fe.length, `${schema}: keine Konsolenfehler ${fe.join(' | ')}`);
    await c.close();
  }

  ok(!sprachFehler.length, `Strich/ß-Prüfung ${JSON.stringify(sprachFehler)}`);
});
