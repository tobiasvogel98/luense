// kern/pdf.js — PDF-Fotobericht fürs Journal: Auswahl von Zeitraum und Tags,
// Druckansicht mit eigener Print-CSS, Auslösung über window.print().
// Der Browser-Druckdialog speichert als PDF (Handy wie Laptop).

import { abfrage, holeAnhang } from './speicher.js';
import { esc, formatDatumZeit } from './ui.js';

function formatDatum(iso) {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) return '';
  return datum.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Öffnet den Berichtsdialog für eine Baustelle (Zeitraum und Tag-Auswahl).
export async function oeffneBericht(baustelle) {
  const eintraege = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
  if (!eintraege.length) {
    alert('Noch keine Einträge auf dieser Baustelle — kein Bericht möglich.');
    return;
  }
  const tags = [...new Set(eintraege.map((e) => e.tag).filter(Boolean))];
  const gewaehlt = new Set(tags); // Standard: alle Tags im Bericht

  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  dialog.innerHTML = `
    <form class="karte formular dialog" data-rolle="bericht-dialog">
      <h3>PDF-Fotobericht</h3>
      <p class="hinweis">${esc(baustelle.ktr)} ${esc(baustelle.name)}</p>
      <label>Von<input type="date" name="von"></label>
      <label>Bis<input type="date" name="bis"></label>
      <div class="chips" data-rolle="tag-filter">
        ${tags.map((tag) => `
          <button type="button" class="chip chip-knopf aktiv" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('')}
      </div>
      <div class="knopfzeile">
        <button type="submit" class="knopf knopf-primaer">Druckansicht öffnen</button>
        <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const formular = dialog.querySelector('[data-rolle="bericht-dialog"]');
  dialog.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog) dialog.remove();
  });

  formular.querySelector('[data-rolle="tag-filter"]').addEventListener('click', (klick) => {
    const knopf = klick.target.closest('[data-tag]');
    if (!knopf) return;
    const tag = knopf.dataset.tag;
    gewaehlt.has(tag) ? gewaehlt.delete(tag) : gewaehlt.add(tag);
    knopf.classList.toggle('aktiv', gewaehlt.has(tag));
  });

  formular.addEventListener('submit', (abschicken) => {
    abschicken.preventDefault();
    const von = formular.elements.von.value; // Format jjjj-mm-tt
    const bis = formular.elements.bis.value;
    const gefiltert = eintraege
      .filter((e) => gewaehlt.has(e.tag))
      .filter((e) => !von || e.datum >= von)
      .filter((e) => !bis || e.datum <= `${bis}T23:59:59.999Z`)
      .reverse(); // Bericht chronologisch: älteste zuerst
    if (!gefiltert.length) {
      alert('Keine Einträge in dieser Auswahl.');
      return;
    }
    dialog.remove();
    zeigeDruckansicht(baustelle, gefiltert, { von, bis });
  });
}

async function zeigeDruckansicht(baustelle, eintraege, { von, bis }) {
  const zeitraum = von || bis
    ? `${von ? formatDatum(von) : 'Anfang'} – ${bis ? formatDatum(bis) : 'heute'}`
    : 'alle Einträge';

  const ansicht = document.createElement('div');
  ansicht.className = 'druckansicht';
  ansicht.innerHTML = `
    <div class="druck-toolbar">
      <button type="button" class="knopf knopf-primaer" data-aktion="drucken">
        Drucken / als PDF speichern
      </button>
      <button type="button" class="knopf" data-aktion="schliessen">Schliessen</button>
      <p class="hinweis" data-rolle="lade-status">Fotos werden geladen …</p>
    </div>

    <div class="bericht">
      <header class="bericht-kopf">
        <h1>Fotobericht ${esc(baustelle.ktr)} — ${esc(baustelle.name)}</h1>
        <p>
          ${baustelle.ort ? esc(baustelle.ort) + ' · ' : ''}${
            baustelle.bauherr ? 'Bauherr: ' + esc(baustelle.bauherr) + ' · ' : ''}
          Zeitraum: ${zeitraum} · erstellt am ${formatDatum(new Date().toISOString())}
        </p>
      </header>
      ${eintraege.map((e) => {
        const fotos = Object.keys(e._attachments || {});
        return `
          <section class="bericht-eintrag">
            <h2>
              <span class="chip">${esc(e.tag)}</span>
              ${formatDatumZeit(e.datum)}${e.ortKv ? ' · ' + esc(e.ortKv) : ''}
            </h2>
            ${e.notiz ? `<p class="bericht-notiz">${esc(e.notiz)}</p>` : ''}
            ${fotos.length ? `
              <div class="bericht-fotos">
                ${fotos.map((name) => `
                  <figure>
                    <img alt="Foto" data-id="${esc(e._id)}" data-name="${esc(name)}">
                    <figcaption>${formatDatumZeit(e.datum)}${
                      e.ortKv ? ' · ' + esc(e.ortKv) : ''}</figcaption>
                  </figure>`).join('')}
              </div>` : ''}
          </section>`;
      }).join('')}
    </div>`;
  document.body.append(ansicht);

  const urls = [];
  const schliessen = () => {
    urls.forEach(URL.revokeObjectURL);
    ansicht.remove();
  };
  ansicht.querySelector('[data-aktion="schliessen"]').addEventListener('click', schliessen);
  ansicht.querySelector('[data-aktion="drucken"]').addEventListener('click', () => window.print());

  // Alle Fotos laden, erst dann ist der Bericht druckbereit.
  const bilder = [...ansicht.querySelectorAll('img[data-id]')];
  await Promise.all(bilder.map(async (bild) => {
    try {
      const blob = await holeAnhang(bild.dataset.id, bild.dataset.name);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      await new Promise((geladen) => {
        bild.onload = geladen;
        bild.onerror = geladen;
        bild.src = url;
      });
    } catch {
      bild.closest('figure').remove();
    }
  }));
  const status = ansicht.querySelector('[data-rolle="lade-status"]');
  const einheit = (anzahl, einzahl, mehrzahl) =>
    `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`;
  status.textContent = `Bereit — ${einheit(eintraege.length, 'Eintrag', 'Einträge')}, ${
    einheit(bilder.length, 'Foto', 'Fotos')}.`;
}

// ---------- Tagesrapport-Druck (Einzelrapport und Wochenübersicht) ----------
// Das Rapport-Modul rechnet die Totale und übergibt sie — hier wird nur
// gerendert und gedruckt.

function stundenText(n) {
  return `${Math.round(n * 100) / 100} h`;
}

function formatTagLang(tagIso) {
  const datum = new Date(`${tagIso}T12:00:00`);
  if (Number.isNaN(datum.getTime())) return tagIso;
  return datum.toLocaleDateString('de-CH', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function druckOverlay(inhalt) {
  const ansicht = document.createElement('div');
  ansicht.className = 'druckansicht';
  ansicht.innerHTML = `
    <div class="druck-toolbar">
      <button type="button" class="knopf knopf-primaer" data-aktion="drucken">
        Drucken / als PDF speichern
      </button>
      <button type="button" class="knopf" data-aktion="schliessen">Schliessen</button>
    </div>
    <div class="bericht">${inhalt}</div>`;
  document.body.append(ansicht);
  ansicht.querySelector('[data-aktion="schliessen"]').addEventListener('click', () => ansicht.remove());
  ansicht.querySelector('[data-aktion="drucken"]').addEventListener('click', () => window.print());
}

function druckZeile(name, wert) {
  return `<div class="druck-zeile"><span>${esc(name || '—')}</span>
    <span class="punkte"></span><span class="druck-wert">${esc(wert)}</span></div>`;
}

function zeilenGruppe(label, liste, art) {
  if (!liste?.length) return '';
  const zeilen = liste.map((z) => {
    const wert = art === 'menge'
      ? [z.menge, z.einheit].filter(Boolean).join(' ')
      : (String(z.stunden ?? '').trim()
          ? stundenText(parseFloat(String(z.stunden).replace(',', '.')) || 0) : '');
    return druckZeile(z.name, wert);
  }).join('');
  return `<p class="gruppen-label">${label}</p>${zeilen}`;
}

// Einzelrapport: Kopf (KTR/Baustelle/Datum/Wetter), Arbeiten, Stunden-
// Tabelle, Regie-Block separat, Unterschriftszeile.
export function zeigeRapportDruck(baustelle, rapport, t) {
  const regieArbeiten = (rapport.arbeiten || []).filter((a) => a.regie);
  druckOverlay(`
    <header class="bericht-kopf">
      <h1>Tagesrapport ${esc(baustelle.ktr)} — ${esc(baustelle.name)}</h1>
      <p>${formatTagLang(rapport.tag)}${
        rapport.mitarbeiter ? ' · ' + esc(rapport.mitarbeiter) : ''}${
        rapport.wetter ? ' · ' + esc(rapport.wetter) : ''}${
        baustelle.ort ? ' · ' + esc(baustelle.ort) : ''}</p>
    </header>

    ${(rapport.arbeiten || []).map((arbeit, i) => `
      <section class="bericht-eintrag">
        <h2>${i + 1}. ${esc(arbeit.text || '—')}${
          arbeit.regie ? ' <span class="chip">Regie</span>' : ''}</h2>
        ${zeilenGruppe('Personen', arbeit.personen, 'stunden')}
        ${zeilenGruppe('Maschinen', arbeit.maschinen, 'stunden')}
        ${zeilenGruppe('Material', arbeit.material, 'menge')}
        ${zeilenGruppe('Fremdleistungen', arbeit.fremdleistungen, 'stunden')}
      </section>`).join('')}

    <table class="rapport-tabelle">
      <tbody>
        <tr><td>Total Personal</td><td class="zahl">${stundenText(t.personen)}</td></tr>
        <tr><td>Total Maschinen</td><td class="zahl">${stundenText(t.maschinen)}</td></tr>
        <tr><td>Total Material</td><td class="zahl">${esc(t.materialText)}</td></tr>
        <tr><td>Total Fremdleistungen</td><td class="zahl">${stundenText(t.fremdleistungen)}</td></tr>
      </tbody>
    </table>

    ${t.regie > 0 ? `
      <section class="regie-block">
        <h2>Regie — separat ausgewiesen</h2>
        ${regieArbeiten.map((arbeit) => {
          const stunden = ['personen', 'maschinen', 'fremdleistungen']
            .flatMap((g) => arbeit[g] || [])
            .reduce((s, z) => s + (parseFloat(String(z.stunden ?? '').replace(',', '.')) || 0), 0);
          return druckZeile(arbeit.text || '—', stundenText(stunden));
        }).join('')}
        <div class="druck-zeile regie-total-zeile"><span><strong>Total Regie</strong></span>
          <span class="punkte"></span><span class="druck-wert"><strong>${
            stundenText(t.regie)}</strong></span></div>
      </section>` : ''}

    ${rapport.bemerkungen ? `
      <section class="bericht-eintrag">
        <h2>Bemerkungen</h2>
        <p class="bericht-notiz">${esc(rapport.bemerkungen)}</p>
      </section>` : ''}

    <div class="unterschriften">
      <div>Unterschrift Mitarbeiter</div>
      <div>Unterschrift Bauleitung / Bauherr</div>
    </div>`);
}

// Offert-Druck im Leistungsverzeichnis-Layout (Vorlage von Tobias):
// Pos.-Nr. und Text links, EH/Menge/Preis/Betrag rechts, Kapitel- und
// Unternummern-Zeilen, Zwischentotal je Kapitel. Die Tabelle liefert
// das Offert-Modul fertig an (gleiche Darstellung wie am Bildschirm,
// ohne Ausmass — die Kalkulationsgrundlage bleibt intern).
export function zeigeOffertDruck(offerte, lv) {
  druckOverlay(`
    <header class="bericht-kopf">
      <h1>Offerte ${esc(offerte.nummer)} · ${esc(offerte.objekt)}</h1>
      <p>${esc(offerte.kunde)} · Preise in CHF exkl. MwSt.</p>
    </header>

    ${lv.tabelleHtml}

    <section class="bericht-eintrag">
      <h2>Zusammenzug</h2>
      ${lv.zusammenzug.map((z) => druckZeile(z.label, z.wert)).join('')}
    </section>

    <div class="unterschriften">
      <div>Lünse — Tobias Vogel</div>
      <div>Auftraggeber</div>
    </div>`);
}

// Protokoll-Druck: neutrales Druckmodell aus der Protokoll-Engine —
// Felder als Beschriftung/Wert, Tabellen als echte Tabellen, dazu die
// typ-eigenen Unterschriftszeilen.
export function zeigeProtokollDruck(baustelle, optionen) {
  druckOverlay(`
    <header class="bericht-kopf">
      <h1>${esc(optionen.titel)} · ${esc(baustelle.ktr)} — ${esc(baustelle.name)}</h1>
      ${optionen.untertitel ? `<p>${esc(optionen.untertitel)}</p>` : ''}
    </header>

    ${optionen.abschnitte.map((abschnitt) => abschnitt.art === 'felder'
      ? `<section class="bericht-eintrag">
          <h2>${esc(abschnitt.titel)}</h2>
          ${abschnitt.zeilen.map((z) => `
            <div class="meta-zeile"><b>${esc(z.label)}:</b>
              <span class="meta-wert">${esc(z.wert)}</span></div>`).join('')}
        </section>`
      : `<section class="bericht-eintrag">
          <h2>${esc(abschnitt.titel)}</h2>
          <table class="rapport-tabelle">
            <thead><tr>${abschnitt.spalten.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead>
            <tbody>${abschnitt.zeilen.map((zeile) => `
              <tr>${zeile.map((w) => `<td class="meta-wert">${esc(w)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </section>`).join('')}

    ${optionen.bilder?.length ? `
      <section class="bericht-eintrag">
        <h2>${esc(optionen.bilderTitel || 'Anlagen')}</h2>
        <div class="bericht-fotos">
          ${optionen.bilder.map((bild) => `
            <figure>
              <img src="${bild.url}" alt="${esc(bild.titel || 'Anlage')}">
              <figcaption>${esc(bild.titel || '')}</figcaption>
            </figure>`).join('')}
        </div>
      </section>` : ''}

    <div class="unterschriften">
      ${(optionen.unterschriften || ['Unterschrift', 'Unterschrift'])
        .map((u) => `<div>${esc(u)}</div>`).join('')}
    </div>`);
}

// Wochenübersicht: eine Zeile je Rapport, Summenzeile, Unterschrift.
export function zeigeWochenDruck(baustelle, woche) {
  druckOverlay(`
    <header class="bericht-kopf">
      <h1>Wochenrapport KW ${woche.kw} · ${esc(baustelle.ktr)} — ${esc(baustelle.name)}</h1>
      <p>${esc(woche.von)} – ${esc(woche.bis)}${
        baustelle.ort ? ' · ' + esc(baustelle.ort) : ''}</p>
    </header>

    <table class="rapport-tabelle">
      <thead>
        <tr><th>Datum</th><th>Arbeiten</th><th class="zahl">Personal</th>
          <th class="zahl">Maschinen</th><th class="zahl">Fremd</th><th class="zahl">Regie</th></tr>
      </thead>
      <tbody>
        ${woche.zeilen.map((z) => `
          <tr>
            <td>${esc(z.tagText)}</td>
            <td>${esc(z.arbeitenText)}${z.mitarbeiter ? `<br><small>${esc(z.mitarbeiter)}</small>` : ''}</td>
            <td class="zahl">${stundenText(z.personen)}</td>
            <td class="zahl">${stundenText(z.maschinen)}</td>
            <td class="zahl">${stundenText(z.fremdleistungen)}</td>
            <td class="zahl">${z.regie ? stundenText(z.regie) : '—'}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total</td>
          <td class="zahl">${stundenText(woche.summen.personen)}</td>
          <td class="zahl">${stundenText(woche.summen.maschinen)}</td>
          <td class="zahl">${stundenText(woche.summen.fremdleistungen)}</td>
          <td class="zahl">${stundenText(woche.summen.regie)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="unterschriften">
      <div>Unterschrift Mitarbeiter</div>
      <div>Unterschrift Bauleitung / Bauherr</div>
    </div>`);
}
