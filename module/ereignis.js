// module/ereignis.js — Ereignis-Journal, erstes Modul der Shell.
// Erfassung (Tag, Ort/KV, Notiz) und gefilterte Liste, neuste zuerst.
// Spricht ausschliesslich über den Kern mit der Datenbank.

import { put, abfrage } from '../kern/speicher.js';
import { esc, formatDatumZeit } from '../kern/ui.js';

const TAGS = ['Vorzustand', 'Fortschritt', 'Mangel', 'Regie', 'Abnahme'];

export default {
  name: 'Journal',
  dokumentTypen: ['ereignis'],

  render(container, baustelle) {
    const filter = new Set(); // gewählte Tag-Chips; leer = alle zeigen

    container.innerHTML = `
      <section class="journal">
        <h2>Journal · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <div class="chips" data-rolle="tag-wahl">
            ${TAGS.map((tag) => `
              <label class="chip-wahl">
                <input type="radio" name="tag" value="${tag}"
                  ${tag === 'Fortschritt' ? 'checked' : ''}>
                <span>${tag}</span>
              </label>`).join('')}
          </div>
          <label>Ort / KV<input name="ortKv" autocomplete="off"></label>
          <label>Notiz<textarea name="notiz" rows="3"></textarea></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Eintrag speichern</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="chips" data-rolle="filter"></div>
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function zeichneFilter() {
      filterElement.innerHTML = TAGS.map((tag) => `
        <button type="button" class="chip chip-knopf${filter.has(tag) ? ' aktiv' : ''}"
          data-tag="${tag}">${tag}</button>`).join('');
    }

    async function zeichneListe() {
      const alle = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
      const gezeigt = filter.size ? alle.filter((e) => filter.has(e.tag)) : alle;
      listeElement.innerHTML = gezeigt.length
        ? gezeigt.map((e) => `
            <article class="karte ereignis">
              <div class="ereignis-kopf">
                <span class="chip">${esc(e.tag)}</span>
                <span class="hinweis">${formatDatumZeit(e.datum)}${
                  e.ortKv ? ' · ' + esc(e.ortKv) : ''}</span>
              </div>
              ${e.notiz ? `<p class="ereignis-notiz">${esc(e.notiz)}</p>` : ''}
            </article>`).join('')
        : `<p class="hinweis">${
            alle.length
              ? 'Keine Einträge zu dieser Tag-Auswahl.'
              : 'Noch keine Einträge auf dieser Baustelle.'}</p>`;
    }

    filterElement.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-tag]');
      if (!knopf) return;
      const tag = knopf.dataset.tag;
      filter.has(tag) ? filter.delete(tag) : filter.add(tag);
      zeichneFilter();
      zeichneListe();
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const felder = Object.fromEntries(new FormData(formular));
      try {
        await put({
          typ: 'ereignis',
          baustelleId: baustelle.baustelleId,
          tag: felder.tag,
          ortKv: (felder.ortKv || '').trim(),
          notiz: (felder.notiz || '').trim(),
        });
        formular.elements.ortKv.value = '';
        formular.elements.notiz.value = '';
        meldung.textContent = 'Eintrag gespeichert.';
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    zeichneFilter();
    zeichneListe();
  },
};
