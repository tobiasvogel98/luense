// Rauchtest: Beispielbaustelle laden, jedes Modul öffnen (Handy 390 × 844
// hell und Laptop dunkel), Inhalt vorhanden, keine horizontale Scrollbar,
// Touch-Ziele ≥ 44 px, kein «–», «—», «ß», keine Konsolenfehler.
'use strict';
const h = require('./hilfe');

const MODULE = ['Dossier', 'Journal', 'Pendenzen', 'Rapporte', 'Ausmass', 'Nachträge', 'Rechnungen',
  'Kreditoren', 'Personal', 'Protokolle', 'Controlling', 'Offerten'];
// Bedienelemente, die als Touch-Ziel gelten (Knöpfe, Eingaben, Auswahl).
const ZIELE = '#modul-inhalt button, #modul-inhalt .knopf, #modul-inhalt select, '
  + '#modul-inhalt input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden])';

h.lauf('Rauchtest', async (browser, { ok }) => {
  const AUS = h.ausgabeOrdner('rauchtest');
  for (const art of ['handy', 'laptop']) {
    const handy = art === 'handy';
    const { page, konsole } = await h.neueSeite(browser, { handy, schema: handy ? 'light' : 'dark' });
    await h.oeffne(page);
    ok(await page.locator('[data-aktion="beispiel-laden"]').count() === 1, `${art}: leerer Bestand öffnet den Stamm mit «Beispielbaustelle laden»`);
    await h.ladeBeispiel(page);
    ok(await page.locator('#beispiel-hinweis').isVisible(), `${art}: Kopfzeile zeigt «Beispiel»`);
    ok(!(await page.evaluate(() => !!document.querySelector('.umzug-hinweis'))), `${art}: kein Umzugshinweis auf 127.0.0.1`);
    const nav = await page.locator('#modul-nav .nav-eintrag').allInnerTexts();
    ok(MODULE.every((m) => nav.some((n) => h.norm(n).startsWith(m))), `${art}: Navigation mit allen ${MODULE.length} Modulen`);
    const sprache = [];
    for (const name of MODULE) {
      await h.geheZu(page, name);
      const laenge = await page.evaluate(() => document.querySelector('#modul-inhalt').innerText.trim().length);
      ok(laenge > 80, `${art} ${name}: Inhalt gezeichnet (${laenge} Zeichen)`);
      // aufklappbare Bereiche öffnen, damit auch deren Text geprüft wird
      await page.evaluate(() => document.querySelectorAll('#modul-inhalt details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(150);
      sprache.push(...await h.sprachFehler(page, `${art} ${name}`));
      if (handy) {
        const sw = await h.seitenBreite(page);
        ok(sw <= 390, `Handy ${name}: keine horizontale Scrollbar (${sw} px)`);
        const klein = await h.kleineZiele(page, ZIELE);
        ok(!klein.length, `Handy ${name}: Touch-Ziele ≥ 44 px ${klein.length ? JSON.stringify(klein.slice(0, 8)) : ''}`);
        await page.screenshot({ path: `${AUS}/${art}-${name}.png` });
      }
    }
    // Stamm (⚙) mit allen Abschnitten
    await page.locator('#stamm-knopf').click();
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    sprache.push(...await h.sprachFehler(page, `${art} Stamm`));
    if (handy) {
      ok(await h.seitenBreite(page) <= 390, 'Handy Stamm: keine horizontale Scrollbar');
      const klein = await h.kleineZiele(page, '#modul-inhalt button, #modul-inhalt .knopf, #modul-inhalt select, #modul-inhalt input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden])');
      ok(!klein.length, `Handy Stamm: Touch-Ziele ≥ 44 px ${klein.length ? JSON.stringify(klein.slice(0, 8)) : ''}`);
      await page.screenshot({ path: `${AUS}/${art}-stamm.png`, fullPage: true });
    }
    ok(!sprache.length, `${art}: kein «–», «—», «ß» ${sprache.join(' || ')}`);
    // Reload: Modulwahl bleibt erhalten, Daten bleiben
    await page.locator('#stamm-knopf').click();
    await page.waitForSelector('#modul-nav:not([hidden])');
    await page.waitForTimeout(500);
    await h.geheZu(page, 'Kreditoren');
    await h.neuLaden(page);
    ok(await page.locator('.nav-eintrag.aktiv', { hasText: 'Kreditoren' }).count() === 1, `${art}: nach Neuladen wieder im zuletzt gewählten Modul`);
    ok(konsole.length === 0, `${art}: keine Konsolenfehler ${konsole.join(' | ')}`);
    await page.context().close();
  }
});
