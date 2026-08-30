// module/pendenzen.js — Pendenzenliste, zweites Modul der Shell.
// Erfassen (Text, Priorität, Termin, Verantwortlich), Liste mit
// Prioritäts-Farbband, abhaken (erledigt bleibt durchgestrichen sichtbar),
// Filter offen/alle. Dokumenttyp «pendenz».
// Spricht ausschliesslich über den Kern mit der Datenbank.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc } from '../kern/ui.js';

const PRIORITAETEN = ['hoch', 'mittel', 'tief'];
const PRIO_RANG = { hoch: 0, mittel: 1, tief: 2 };

function formatTag(isoTag) {
  if (!isoTag) return '';
  const [j, m, t] = isoTag.slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : isoTag;
}

function istUeberfaellig(p) {
  return !p.erledigtAm && p.termin && p.termin < new Date().toISOString().slice(0, 10);
}

// Offene zuerst (Termin aufsteigend, ohne Termin zuletzt, dann Priorität),
// Erledigte am Schluss (zuletzt erledigte zuoberst).
function sortiere(pendenzen) {
  return pendenzen.sort((a, b) => {
    const ea = a.erledigtAm ? 1 : 0;
    const eb = b.erledigtAm ? 1 : 0;
    if (ea !== eb) return ea - eb;
    if (ea) return (b.erledigtAm || '').localeCompare(a.erledigtAm || '');
    if (a.termin !== b.termin) {
      if (!a.termin) return 1;
      if (!b.termin) return -1;
      return a.termin.localeCompare(b.termin);
    }
    return PRIO_RANG[a.prioritaet] - PRIO_RANG[b.prioritaet];
  });
}

export default {
  name: 'Pendenzen',
  dokumentTypen: ['pendenz'],

  // Anzahl-Badge für die Modul-Navigation: offene Pendenzen der Baustelle.
  async badge(baustelle) {
    const alle = await abfrage({ typ: 'pendenz', baustelleId: baustelle.baustelleId });
    return alle.filter((p) => !p.erledigtAm).length || null;
  },

  render(container, baustelle) {
    let nurOffene = true;

    container.innerHTML = `
      <section class="pendenzen">
        <h2>Pendenzen · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <label>Pendenz *<input name="text" required autocomplete="off"
            placeholder="Was ist zu erledigen?"></label>
          <div class="chips">
            ${PRIORITAETEN.map((p) => `
              <label class="chip-wahl">
                <input type="radio" name="prioritaet" value="${p}"
                  ${p === 'mittel' ? 'checked' : ''}>
                <span>${p[0].toUpperCase() + p.slice(1)}</span>
              </label>`).join('')}
          </div>
          <label>Termin<input type="date" name="termin"></label>
          <label>Verantwortlich<input name="verantwortlich" autocomplete="off"
            placeholder="Person oder Firma"></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Pendenz speichern</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="chips" data-rolle="filter">
          <button type="button" class="chip chip-knopf aktiv" data-filter="offen">Offen</button>
          <button type="button" class="chip chip-knopf" data-filter="alle">Alle</button>
        </div>
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function pendenzKarte(p) {
      const meta = [
        p.verantwortlich ? esc(p.verantwortlich) : '',
        p.termin ? `bis ${formatTag(p.termin)}` : '',
        istUeberfaellig(p) ? '<span class="ueberfaellig">überfällig</span>' : '',
        p.erledigtAm ? `erledigt am ${formatTag(p.erledigtAm)}` : '',
      ].filter(Boolean).join(' · ');
      return `
        <article class="karte pendenz prio-${esc(p.prioritaet)}${p.erledigtAm ? ' erledigt' : ''}">
          <div class="pendenz-zeile">
            <button type="button" class="knopf pendenz-haken" data-aktion="haken"
              data-id="${esc(p._id)}"
              aria-label="${p.erledigtAm ? 'Wieder öffnen' : 'Als erledigt abhaken'}">
              ${p.erledigtAm ? '↺' : '✓'}
            </button>
            <div class="pendenz-mitte">
              <p class="pendenz-text">${esc(p.text)}</p>
              ${meta ? `<p class="hinweis">${meta}</p>` : ''}
              ${p.notiz ? `<p class="hinweis">${esc(p.notiz)}</p>` : ''}
            </div>
            <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
              data-id="${esc(p._id)}" aria-label="Pendenz löschen">Löschen</button>
          </div>
        </article>`;
    }

    async function zeichneListe() {
      const alle = sortiere(
        await abfrage({ typ: 'pendenz', baustelleId: baustelle.baustelleId }));
      const gezeigt = nurOffene ? alle.filter((p) => !p.erledigtAm) : alle;
      listeElement.innerHTML = gezeigt.length
        ? gezeigt.map(pendenzKarte).join('')
        : `<p class="hinweis">${
            alle.length ? 'Keine offenen Pendenzen — alles erledigt.' : 'Noch keine Pendenzen auf dieser Baustelle.'}</p>`;
    }

    filterElement.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-filter]');
      if (!knopf) return;
      nurOffene = knopf.dataset.filter === 'offen';
      filterElement.querySelectorAll('.chip-knopf').forEach((c) =>
        c.classList.toggle('aktiv', c === knopf));
      zeichneListe();
    });

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const alle = await abfrage({ typ: 'pendenz', baustelleId: baustelle.baustelleId });
      const pendenz = alle.find((p) => p._id === knopf.dataset.id);
      if (!pendenz) return;
      if (knopf.dataset.aktion === 'haken') {
        await put({
          ...pendenz,
          erledigtAm: pendenz.erledigtAm ? '' : new Date().toISOString().slice(0, 10),
        });
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm('Diese Pendenz endgültig löschen?')) return;
        await entferneDokument(pendenz._id);
      }
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await zeichneListe();
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const felder = Object.fromEntries(new FormData(formular));
      try {
        await put({
          typ: 'pendenz',
          baustelleId: baustelle.baustelleId,
          text: (felder.text || '').trim(),
          prioritaet: felder.prioritaet,
          termin: felder.termin || '',
          verantwortlich: (felder.verantwortlich || '').trim(),
          erledigtAm: '',
        });
        formular.reset();
        formular.querySelector('input[value="mittel"]').checked = true;
        meldung.textContent = 'Pendenz gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    zeichneListe();
  },
};
