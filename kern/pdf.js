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
    <form class="karte dialog" data-rolle="bericht-dialog">
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
  status.textContent = `Bereit — ${eintraege.length} Einträge, ${bilder.length} Fotos.`;
}
