// Journal und Stammdaten: Eintrag mit Foto (verkleinert auf höchstens
// 1600 px, JPEG), Regie-Vorschlag erzeugt Nachtrag, Suche, Filter, Sprung
// zum Nachtrag, Fotobericht; Gerätekatalog im Personal und Datalist im
// Rapport; Nummernvergabe (kern/ui.js naechsteNummer). Handy 390 × 844.
'use strict';
const h = require('./hilfe');

h.lauf('Journal und Katalog', async (browser, { ok }) => {
  const AUS = h.ausgabeOrdner('journal');
  const { page, konsole } = await h.neueSeite(browser, { handy: true });
  await h.oeffne(page);

  // ---------- Nummernvergabe ----------
  const nr = await page.evaluate(async () => {
    const { naechsteNummer: n } = await import('/kern/ui.js');
    return [n([], 'N-'), n(['N-01', 'N-03'], 'N-'), n(['O-2025-07', 'O-2026-02', 'O-2026-05'], 'O-2026-'),
      n(['O-DEMO-01', 'O-2026-01'], 'O-2026-'), n(['N-09', 'N-10', ' N-11 ', null, 'X'], 'N-')];
  });
  ok(JSON.stringify(nr) === '["N-01","N-04","O-2026-06","O-2026-02","N-12"]', `naechsteNummer: ${nr.join(', ')}`);

  await h.ladeBeispiel(page);
  await h.geheZu(page, 'Journal');
  ok(await page.isHidden('.journal-blatt'), 'Journal: Liste zuerst, Formular zu');
  const fab = await page.locator('.neu-knopf').boundingBox();
  ok(fab.height >= 56 && fab.x + fab.width > 340 && fab.y > 700, `Knopf «Neu» unten rechts, ${Math.round(fab.height)} px`);

  // ---------- Eintrag mit grossem Foto ----------
  const foto = async (b, ho) => {
    const b64 = await page.evaluate(({ b, ho }) => {
      const c = document.createElement('canvas'); c.width = b; c.height = ho;
      const g = c.getContext('2d'); g.fillStyle = '#6a8'; g.fillRect(0, 0, b, ho);
      g.fillStyle = '#fff'; g.font = 'bold 200px sans-serif'; g.fillText('Testfoto', 100, ho / 2);
      return c.toDataURL('image/png').split(',')[1];
    }, { b, ho });
    return { name: 'testfoto.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
  };
  await page.click('.neu-knopf');
  await page.waitForSelector('.journal-blatt:not([hidden])');
  ok(await page.isChecked('.tag-wahl input[value="Fortschritt"]'), 'neues Blatt: Tag Fortschritt vorgewählt');
  await page.click('.tag-wahl input[value="Mangel"] + span');
  await page.fill('.journal-blatt input[name="ortKv"]', 'Schacht KS 5');
  await page.fill('.journal-blatt textarea[name="notiz"]', 'Testeintrag Schachtabdeckung wackelt, Auflagering nachmoerteln.');
  await page.setInputFiles('[data-rolle="foto-eingabe"]', [await foto(3200, 2400)]);
  await page.waitForTimeout(500);
  await page.click('.journal-blatt [type="submit"]');
  await page.waitForSelector('.journal-blatt', { state: 'hidden', timeout: 15000 });
  await page.waitForTimeout(400);
  const bild = await page.evaluate(async () => {
    const db = new PouchDB('luense');
    const r = await db.allDocs({ include_docs: true, startkey: 'ereignis:', endkey: 'ereignis:￿' });
    const d = r.rows.map((x) => x.doc).find((x) => (x.notiz || '').startsWith('Testeintrag'));
    if (!d || !d._attachments) return { fehlt: true };
    const name = Object.keys(d._attachments)[0];
    const blob = await db.getAttachment(d._id, name);
    const bmp = await createImageBitmap(blob);
    return { typ: blob.type, b: bmp.width, h: bmp.height, tag: d.tag, ort: d.ortKv };
  });
  ok(!bild.fehlt && bild.tag === 'Mangel' && bild.ort === 'Schacht KS 5', `Eintrag gespeichert (Tag ${bild.tag}, Ort ${bild.ort})`);
  ok(bild.typ === 'image/jpeg' && Math.max(bild.b, bild.h) <= 1600 && Math.max(bild.b, bild.h) >= 1500,
    `Foto verkleinert: ${bild.b} × ${bild.h} ${bild.typ} (aus 3200 × 2400 PNG)`);

  // ---------- Regie-Vorschlag erzeugt Nachtrag ----------
  const nachtraege = () => page.evaluate(async () => (await new PouchDB('luense').allDocs({ startkey: 'nachtrag:', endkey: 'nachtrag:￿' })).rows.length);
  const vorher = await nachtraege();
  await page.click('.neu-knopf');
  await page.waitForSelector('.journal-blatt:not([hidden])');
  await page.fill('.journal-blatt input[name="ortKv"]', 'KS 6');
  await page.fill('.journal-blatt textarea[name="notiz"]', 'Unbekannte Werkleitung angetroffen, auf Anordnung der Bauleitung umgelegt.');
  await page.waitForTimeout(300);
  ok(await page.isVisible('[data-aktion="regie-uebernehmen"]'), 'Regie-Hinweis im Text: Vorschlag «als Regie übernehmen»');
  await page.click('[data-aktion="regie-uebernehmen"]');
  await page.click('.journal-blatt [type="submit"]');
  await page.waitForSelector('.journal-blatt', { state: 'hidden', timeout: 15000 });
  await page.waitForTimeout(400);
  const meld = await page.textContent('[data-rolle="listen-meldung"]');
  ok(/Nachtrag N-\d+/.test(meld) && await nachtraege() === vorher + 1, `genau ein neuer Nachtrag: ${h.norm(meld)}`);

  // ---------- Suche, Filter, Sprung ----------
  await page.fill('[data-rolle="suche"]', 'auflagering');
  await page.waitForTimeout(400);
  ok(await page.locator('.journal .ereignis').count() === 1, 'Suche ohne Umlaute/Grossschreibung findet den Eintrag');
  await page.fill('[data-rolle="suche"]', '');
  await page.click('.filter-chip[data-tag="Regie"]');
  await page.waitForTimeout(400);
  const verweise = await page.$$eval('.verweis', (v) => v.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(verweise.some((v) => /Nachtrag N-\d+ · /.test(v)), `Regie-Karten verweisen auf Nachtrag (${verweise.length})`);
  const klein = await h.kleineZiele(page, '.journal .ereignis button, .journal-werkzeuge button, .filter-chip, .neu-knopf');
  ok(!klein.length, `Journal: Touch-Ziele ≥ 44 px ${JSON.stringify(klein)}`);
  await page.locator('.verweis[data-modul="Nachträge"]').first().click();
  await page.waitForTimeout(1200);
  ok(await page.locator('.nachtrag-karte').count() > 0 && await page.locator('.fokus-karte').count() === 1, 'Sprung zu Nachträge, Nachtrag hervorgehoben');

  // ---------- Fotobericht ----------
  await h.geheZu(page, 'Journal');
  await page.click('[data-rolle="bericht"]');
  await page.waitForTimeout(400);
  await page.locator('[data-rolle="bericht-dialog"] [type="submit"]').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('.druckansicht').count() === 1, 'Fotobericht: Druckansicht');
  const datei = await h.druckePdf(page, `${AUS}/fotobericht.pdf`);
  const t = h.pdfText(datei);
  ok(t.includes('Schacht KS 5') && !h.VERBOTEN.test(t), `Fotobericht-PDF mit Eintrag, ohne «–», «—», «ß» ${(t.match(/.{0,30}[–—ß].{0,30}/g) || []).slice(0, 2).join(' | ')}`);
  await page.evaluate(() => document.querySelector('.druckansicht [data-aktion="schliessen"]')?.click());
  await page.evaluate(() => document.querySelector('.druckansicht')?.remove());

  // ---------- Gerätekatalog (Personal) und Rapport ----------
  await h.geheZu(page, 'Personal');
  await page.click('details.import > summary:has-text("Geräte")');
  await page.waitForTimeout(300);
  await page.click('details.katalog-wahl > summary');
  await page.waitForTimeout(300);
  const abschnitte = await page.$$eval('.katalog-abschnitt', (x) => x.map((e) => e.textContent));
  ok(abschnitte.includes('Fremdleistungen'), 'Katalog: Abschnitt Fremdleistungen');
  await page.fill('[data-rolle="katalog-suche"]', 'lastwagen');
  await page.waitForTimeout(200);
  const sicht = await page.$$eval('.katalog-abschnitt', (x) => x.filter((e) => !e.hidden).map((e) => e.textContent));
  ok(sicht.length === 1 && sicht[0] === 'Fremdleistungen', `Suche «lastwagen»: nur Fremdleistungen (${sicht})`);
  await page.click('[data-katalog-name="lastwagen 3-achser mit chauffeur"] span');
  await page.fill('[data-rolle="katalog-suche"]', '');
  await page.click('[data-katalog-name="minibagger 3 t"] span');
  await page.click('[data-aktion="katalog-uebernehmen"]');
  await page.waitForTimeout(600);
  const geraete = await page.evaluate(async () => (await new PouchDB('luense').allDocs({ include_docs: true, startkey: 'geraet:', endkey: 'geraet:￿' })).rows.map((r) => r.doc));
  const lw = geraete.find((d) => d.name === 'Lastwagen 3-Achser mit Chauffeur');
  const mb = geraete.find((d) => d.name === 'Minibagger 3 t');
  ok(lw?.art === 'fremdleistung' && mb && !mb.art, 'Geräte übernommen: Fremdleistung markiert, Maschine ohne Art');
  await h.geheZu(page, 'Rapporte');
  const dl = await page.evaluate(() => ({
    m: [...document.querySelectorAll('#katalog-maschinen option')].map((o) => o.value),
    f: [...document.querySelectorAll('#katalog-fremdleistungen option')].map((o) => o.value),
  }));
  ok(dl.m.includes('Dumper 6 t Nutzlast') && dl.f.includes('Lastwagen 4-Achser mit Chauffeur'), `Rapport: Datalist Maschinen (${dl.m.length}) und Fremdleistungen (${dl.f.length})`);
  const matrix = await page.$$eval('[data-geraet]', (i) => i.map((x) => x.dataset.geraet));
  ok(matrix.includes('Lastwagen 3-Achser mit Chauffeur') && matrix.includes('Minibagger 3 t'), 'Rapport-Matrix enthält die übernommenen Geräte');

  ok(await h.seitenBreite(page) <= 390, 'keine horizontale Scrollbar');
  ok(!konsole.length, `keine Konsolenfehler ${konsole.join(' | ')}`);
});
