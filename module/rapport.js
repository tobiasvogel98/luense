// module/rapport.js — Tagesrapporte, drittes Modul der Shell.
// Erfassungsmaske angelehnt ans bisherige Tagesrapport-Tool: Datum,
// Mannschaft, Stunden (davon Regie), Wetter, Geräte, Material/Lieferungen.
// Liste pro Baustelle neuste zuerst, gruppiert nach Kalenderwoche mit
// Wochensumme. Dokumenttyp «rapport».

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc } from '../kern/ui.js';

function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function formatTag(tagIso) {
  const datum = new Date(`${tagIso}T12:00:00`);
  if (Number.isNaN(datum.getTime())) return tagIso;
  return datum.toLocaleDateString('de-CH', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ISO-Kalenderwoche, z. B. { jahr: 2026, kw: 36 }
function kalenderwoche(tagIso) {
  const datum = new Date(`${tagIso}T12:00:00`);
  const ziel = new Date(datum);
  ziel.setDate(datum.getDate() + 3 - ((datum.getDay() + 6) % 7));
  const ersteKw = new Date(ziel.getFullYear(), 0, 4);
  const kw = 1 + Math.round(
    ((ziel - ersteKw) / 86400000 - 3 + ((ersteKw.getDay() + 6) % 7)) / 7);
  return { jahr: ziel.getFullYear(), kw };
}

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function stundenText(n) {
  return `${Math.round(n * 100) / 100} h`;
}

export default {
  name: 'Rapporte',
  dokumentTypen: ['rapport'],

  render(container, baustelle) {
    container.innerHTML = `
      <section class="rapporte">
        <h2>Rapporte · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <label>Datum *<input type="date" name="tag" required value="${heuteTag()}"></label>
          <label>Mannschaft<input name="mannschaft" autocomplete="off"
            placeholder="z. B. Tobias, Max, 2 Temporäre"></label>
          <div class="feld-reihe">
            <label>Stunden total<input type="number" name="stunden" inputmode="decimal"
              step="0.25" min="0" placeholder="0"></label>
            <label>davon Regie<input type="number" name="davonRegie" inputmode="decimal"
              step="0.25" min="0" placeholder="0"></label>
          </div>
          <label>Wetter<input name="wetter" autocomplete="off"
            placeholder="z. B. sonnig, 18 °C"></label>
          <label>Geräte<input name="geraete" autocomplete="off"
            placeholder="z. B. Bagger 8 t, Vibroplatte"></label>
          <label>Material / Lieferungen<textarea name="material" rows="2"
            placeholder="z. B. 12 m³ Kiessand geliefert"></textarea></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rapport speichern</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function rapportKarte(r) {
      const zeilen = [
        r.mannschaft ? esc(r.mannschaft) : '',
        [r.wetter ? esc(r.wetter) : '', r.geraete ? esc(r.geraete) : '']
          .filter(Boolean).join(' · '),
        r.material ? esc(r.material) : '',
      ].filter(Boolean);
      return `
        <article class="karte rapport">
          <div class="rapport-kopf">
            <strong>${formatTag(r.tag)}</strong>
            <span class="rapport-stunden">${stundenText(r.stunden)}${
              r.davonRegie ? ` · <span class="regie-anteil">Regie ${stundenText(r.davonRegie)}</span>` : ''}</span>
            <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
              data-id="${esc(r._id)}" aria-label="Rapport löschen">Löschen</button>
          </div>
          ${zeilen.map((z) => `<p class="hinweis">${z}</p>`).join('')}
        </article>`;
    }

    async function zeichneListe() {
      const alle = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
      if (!alle.length) {
        listeElement.innerHTML =
          '<p class="hinweis">Noch keine Rapporte auf dieser Baustelle.</p>';
        return;
      }
      // Nach Kalenderwoche gruppieren; die Abfrage liefert neuste zuerst.
      const gruppen = new Map();
      for (const r of alle) {
        const { jahr, kw } = kalenderwoche(r.tag);
        const schluessel = `${jahr}-KW${String(kw).padStart(2, '0')}`;
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { kw, rapporte: [] });
        gruppen.get(schluessel).rapporte.push(r);
      }
      listeElement.innerHTML = [...gruppen.values()].map((gruppe) => {
        const total = gruppe.rapporte.reduce((s, r) => s + zahl(r.stunden), 0);
        const regie = gruppe.rapporte.reduce((s, r) => s + zahl(r.davonRegie), 0);
        return `
          <div class="wochen-titel">KW ${gruppe.kw} · Total ${stundenText(total)}${
            regie ? ` · Regie ${stundenText(regie)}` : ''}</div>
          ${gruppe.rapporte.map(rapportKarte).join('')}`;
      }).join('');
    }

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion="loeschen"]');
      if (!knopf) return;
      if (!confirm('Diesen Rapport endgültig löschen?')) return;
      await entferneDokument(knopf.dataset.id);
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await zeichneListe();
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const felder = Object.fromEntries(new FormData(formular));
      const stunden = zahl(felder.stunden);
      const davonRegie = zahl(felder.davonRegie);
      if (davonRegie > stunden) {
        meldung.textContent = 'Regie-Stunden können nicht grösser sein als das Total.';
        return;
      }
      try {
        await put({
          typ: 'rapport',
          baustelleId: baustelle.baustelleId,
          tag: felder.tag,
          datum: `${felder.tag}T12:00:00.000Z`, // sortiert die Liste nach Rapporttag
          mannschaft: (felder.mannschaft || '').trim(),
          stunden,
          davonRegie,
          wetter: (felder.wetter || '').trim(),
          geraete: (felder.geraete || '').trim(),
          material: (felder.material || '').trim(),
        });
        formular.reset();
        formular.elements.tag.value = heuteTag();
        meldung.textContent = 'Rapport gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    zeichneListe();
  },
};
