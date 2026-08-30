// module/ereignis.js — Ereignis-Journal, erstes Modul der Shell.
// Erfassung (Tag, Ort/KV, Notiz, Fotos) und gefilterte Liste, neuste zuerst.
// Spricht ausschliesslich über den Kern mit der Datenbank.

import {
  put, abfrage, haengeAnhangAn, holeAnhang, entferneDokument, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { oeffneHandnotiz } from '../kern/handschrift.js';
import { oeffneBericht } from '../kern/pdf.js';
import { esc, formatDatumZeit, zeigeBildVollbild } from '../kern/ui.js';

const TAGS = ['Vorzustand', 'Fortschritt', 'Mangel', 'Regie', 'Abnahme'];

export default {
  name: 'Journal',
  dokumentTypen: ['ereignis'],

  render(container, baustelle) {
    const filter = new Set(); // gewählte Tag-Chips; leer = alle zeigen
    let gewaehlteFotos = []; // Dateien, die beim Speichern angehängt werden
    const objektUrls = []; // erzeugte Foto-URLs, beim Neuzeichnen freigeben

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
            <label class="foto-feld">
              <span class="knopf">📷 Foto aufnehmen</span>
              <input type="file" accept="image/*" capture="environment" multiple
                data-rolle="foto-eingabe" class="visually-hidden">
            </label>
            <button type="button" class="knopf" data-rolle="handnotiz">✍ Handnotiz</button>
          </div>
          <p class="hinweis" data-rolle="foto-info"></p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Eintrag speichern</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="listen-kopf">
          <div class="chips" data-rolle="filter"></div>
          <button type="button" class="knopf" data-rolle="bericht">PDF-Bericht</button>
        </div>
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const fotoEingabe = formular.querySelector('[data-rolle="foto-eingabe"]');
    const fotoInfo = formular.querySelector('[data-rolle="foto-info"]');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function zeigeFotoInfo() {
      fotoInfo.textContent = gewaehlteFotos.length
        ? `${gewaehlteFotos.length} Foto${gewaehlteFotos.length > 1 ? 's' : ''} bereit — ` +
          'nochmals antippen für ein weiteres.'
        : '';
    }

    // Jede Aufnahme wird gesammelt; so sind mehrere Fotos pro Eintrag möglich,
    // obwohl die Kamera pro Antippen nur ein Bild liefert.
    fotoEingabe.addEventListener('change', () => {
      gewaehlteFotos.push(...fotoEingabe.files);
      fotoEingabe.value = '';
      zeigeFotoInfo();
    });

    // Handnotiz zeichnen — landet wie ein Foto beim Eintrag.
    formular.querySelector('[data-rolle="handnotiz"]').addEventListener('click', async () => {
      const blob = await oeffneHandnotiz();
      if (!blob) return;
      gewaehlteFotos.push(new File([blob], `handnotiz-${Date.now()}.png`, { type: 'image/png' }));
      zeigeFotoInfo();
    });

    function zeichneFilter() {
      filterElement.innerHTML = TAGS.map((tag) => `
        <button type="button" class="chip chip-knopf${filter.has(tag) ? ' aktiv' : ''}"
          data-tag="${tag}">${tag}</button>`).join('');
    }

    async function zeichneListe() {
      objektUrls.forEach(URL.revokeObjectURL);
      objektUrls.length = 0;
      const alle = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
      const gezeigt = filter.size ? alle.filter((e) => filter.has(e.tag)) : alle;
      listeElement.innerHTML = gezeigt.length
        ? gezeigt.map((e) => {
            const fotos = Object.keys(e._attachments || {});
            return `
              <article class="karte ereignis">
                <div class="ereignis-kopf">
                  <span class="chip">${esc(e.tag)}</span>
                  <span class="hinweis">${formatDatumZeit(e.datum)}${
                    e.ortKv ? ' · ' + esc(e.ortKv) : ''}</span>
                  <button type="button" class="knopf eintrag-loeschen"
                    data-aktion="loeschen" data-id="${esc(e._id)}"
                    aria-label="Eintrag löschen">Löschen</button>
                </div>
                ${e.notiz ? `<p class="ereignis-notiz">${esc(e.notiz)}</p>` : ''}
                ${fotos.length ? `
                  <div class="foto-reihe">
                    ${fotos.map((name) => `
                      <img class="foto-thumb" alt="Foto zum Eintrag" loading="lazy"
                        data-id="${esc(e._id)}" data-name="${esc(name)}">`).join('')}
                  </div>` : ''}
              </article>`;
          }).join('')
        : `<p class="hinweis">${
            alle.length
              ? 'Keine Einträge zu dieser Tag-Auswahl.'
              : 'Noch keine Einträge auf dieser Baustelle.'}</p>`;

      for (const bild of listeElement.querySelectorAll('.foto-thumb')) {
        try {
          const blob = await holeAnhang(bild.dataset.id, bild.dataset.name);
          const url = URL.createObjectURL(blob);
          objektUrls.push(url);
          bild.src = url;
        } catch {
          bild.remove();
        }
      }
    }

    function zeigeVollbild(quelle, docId, name) {
      zeigeBildVollbild(quelle, {
        onLoeschen: async () => {
          await entferneAnhang(docId, name);
          await zeichneListe();
        },
      });
    }

    container.querySelector('[data-rolle="bericht"]')
      .addEventListener('click', () => oeffneBericht(baustelle));

    filterElement.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-tag]');
      if (!knopf) return;
      const tag = knopf.dataset.tag;
      filter.has(tag) ? filter.delete(tag) : filter.add(tag);
      zeichneFilter();
      zeichneListe();
    });

    listeElement.addEventListener('click', async (klick) => {
      const loeschKnopf = klick.target.closest('[data-aktion="loeschen"]');
      if (loeschKnopf) {
        if (confirm('Diesen Eintrag endgültig löschen? Zugehörige Fotos werden mitgelöscht.')) {
          await entferneDokument(loeschKnopf.dataset.id);
          await zeichneListe();
        }
        return;
      }
      const bild = klick.target.closest('.foto-thumb');
      if (bild?.src) zeigeVollbild(bild.src, bild.dataset.id, bild.dataset.name);
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const felder = Object.fromEntries(new FormData(formular));
      const speichernKnopf = formular.querySelector('[type="submit"]');
      speichernKnopf.disabled = true;
      meldung.textContent = gewaehlteFotos.length ? 'Fotos werden verarbeitet …' : '';
      try {
        // Erst verkleinern, dann Dokument und Anhänge schreiben.
        const verkleinerte = [];
        for (const datei of gewaehlteFotos) {
          verkleinerte.push(await verkleinereFoto(datei));
        }
        const doc = await put({
          typ: 'ereignis',
          baustelleId: baustelle.baustelleId,
          tag: felder.tag,
          ortKv: (felder.ortKv || '').trim(),
          notiz: (felder.notiz || '').trim(),
        });
        for (const [index, blob] of verkleinerte.entries()) {
          await haengeAnhangAn(doc._id, `foto-${index + 1}.jpg`, blob);
        }
        // Regie heisst: Nachtrag beziffern und melden — die Pendenz dazu
        // entsteht automatisch (getyptes Dokument über den Kern, kein
        // Aufruf des Pendenzen-Moduls).
        if (doc.tag === 'Regie') {
          await put({
            typ: 'pendenz',
            baustelleId: baustelle.baustelleId,
            text: 'Nachtrag beziffern/melden',
            prioritaet: 'hoch',
            termin: '',
            verantwortlich: '',
            erledigtAm: '',
            notiz: `Aus Regie-Ereignis vom ${formatDatumZeit(doc.datum)}${
              doc.ortKv ? ' · ' + doc.ortKv : ''}`,
            ereignisId: doc._id,
          });
        }
        formular.elements.ortKv.value = '';
        formular.elements.notiz.value = '';
        gewaehlteFotos = [];
        zeigeFotoInfo();
        meldung.textContent = doc.tag === 'Regie'
          ? 'Eintrag gespeichert — Pendenz «Nachtrag beziffern/melden» erstellt.'
          : 'Eintrag gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      } finally {
        speichernKnopf.disabled = false;
      }
    });

    zeichneFilter();
    zeichneListe();
  },
};
