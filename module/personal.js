// module/personal.js — Personal & LMV-Stunden (Abschnitt 10).
// Abend 10.1: Mitarbeiter-Stammdaten light — Name, Lohnklasse (nur als
// Angabe, KEINE Löhne), Arbeitszeitmodell nach LMV 2026 (Arbeitszeit-
// kalender: Saldo −20…+120 h / ausgeglichenes Modell: −50…+120 h) und
// Tages-Sollstunden. Baustellenübergreifend — Mitarbeiter arbeiten auf
// allen Baustellen; wie Katalog/Offertwesen nutzen die Dokumente die
// Sammel-Id «personal» (bewusste Ausnahme von der Baustellen-Id-Regel).
// Abend 10.2 ergänzt das Stundenkonto aus den Tagesrapporten,
// Abend 10.3 den Treuhänder-Export.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc } from '../kern/ui.js';

const PERSONAL_ID = 'personal';
// LMV-Lohnklassen — reine Angabe für den Treuhänder, Lünse rechnet keine Löhne.
const LOHNKLASSEN = ['C', 'B', 'A', 'Q', 'V', 'Polier', 'Kader/andere'];
const MODELLE = [
  ['kalender', 'Arbeitszeitkalender', -20, 120],
  ['ausgeglichen', 'Ausgeglichenes Modell', -50, 120],
];
const SOLL_PRO_TAG = 8.5;

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function modellVon(mitarbeiter) {
  return MODELLE.find(([schluessel]) => schluessel === mitarbeiter.modell) || MODELLE[0];
}

export default {
  name: 'Personal',
  dokumentTypen: ['mitarbeiter'],

  render(container) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="personal">
        <h2>Personal & LMV-Stunden</h2>
        <p class="hinweis">Baustellenübergreifend. Lohnklasse und Modell sind
          Angaben nach LMV 2026 — Löhne rechnet der Treuhänder, Lünse liefert
          die Stunden.</p>

        <form class="karte formular" data-rolle="mitarbeiter-formular">
          <h3 data-rolle="formular-titel">Neuer Mitarbeiter</h3>
          <div class="feld-reihe">
            <label>Name *<input name="name" required autocomplete="off"
              placeholder="genau wie im Tagesrapport, z. B. Max"></label>
            <label>Lohnklasse (LMV)<select name="lohnklasse">
              ${LOHNKLASSEN.map((k) => `<option>${k}</option>`).join('')}
            </select></label>
          </div>
          <div class="feld-reihe">
            <label>Arbeitszeitmodell<select name="modell">
              ${MODELLE.map(([schluessel, label, von, bis]) => `
                <option value="${schluessel}">${label} (${von}…+${bis} h)</option>`).join('')}
            </select></label>
            <label>Soll pro Arbeitstag [h]<input name="sollProTag" type="number"
              inputmode="decimal" step="0.05" min="0" value="${SOLL_PRO_TAG}"></label>
          </div>
          <p class="hinweis">Der Name muss den Personen-Einträgen in den
            Tagesrapporten entsprechen — daraus entsteht das Stundenkonto.
            Soll = Arbeitstage (Mo–Fr) × Tagessoll; der offizielle
            Arbeitszeitkalender kann später hinterlegt werden.</p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div data-rolle="liste"></div>
        <div data-rolle="konto"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="mitarbeiter-formular"]');
    const formularTitel = formular.querySelector('[data-rolle="formular-titel"]');
    const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
    const meldung = formular.querySelector('.meldung');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    async function ladeMitarbeiter() {
      const alle = await abfrage({ typ: 'mitarbeiter', baustelleId: PERSONAL_ID });
      return alle.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
    }

    function fuelleFormular(mitarbeiter) {
      inBearbeitung = mitarbeiter;
      formularTitel.textContent = mitarbeiter
        ? `${mitarbeiter.name} bearbeiten` : 'Neuer Mitarbeiter';
      abbrechenKnopf.hidden = !mitarbeiter;
      formular.elements.name.value = mitarbeiter?.name ?? '';
      formular.elements.lohnklasse.value = mitarbeiter?.lohnklasse ?? 'C';
      formular.elements.modell.value = mitarbeiter?.modell ?? 'kalender';
      formular.elements.sollProTag.value = mitarbeiter?.sollProTag ?? SOLL_PRO_TAG;
      meldung.textContent = '';
    }

    async function zeichneListe() {
      const alle = await ladeMitarbeiter();
      const aktive = alle.filter((m) => !m.archiviert);
      const archivierte = alle.filter((m) => m.archiviert);
      const karte = (m) => {
        const [, modellLabel, von, bis] = modellVon(m);
        return `
          <article class="karte baustelle${m.archiviert ? ' archiviert' : ''}">
            <div class="baustelle-kopf">
              <strong>${esc(m.name)}</strong> Lohnklasse ${esc(m.lohnklasse || '—')}
              ${m.archiviert ? '<span class="chip">archiviert</span>' : ''}
            </div>
            <p class="hinweis">${modellLabel} (${von}…+${bis} h) ·
              Soll ${zahl(m.sollProTag)} h/Tag</p>
            <div class="knopfzeile">
              <button type="button" class="knopf" data-aktion="konto"
                data-id="${esc(m._id)}">Stundenkonto</button>
              <button type="button" class="knopf" data-aktion="bearbeiten"
                data-id="${esc(m._id)}">Bearbeiten</button>
              <button type="button" class="knopf" data-aktion="${m.archiviert ? 'aktivieren' : 'archivieren'}"
                data-id="${esc(m._id)}">${m.archiviert ? 'Aktivieren' : 'Archivieren'}</button>
              ${m.archiviert ? `
                <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                  data-id="${esc(m._id)}">Löschen</button>` : ''}
            </div>
          </article>`;
      };
      listeElement.innerHTML = `
        ${aktive.length ? aktive.map(karte).join('')
          : '<p class="hinweis">Noch keine Mitarbeiter erfasst.</p>'}
        ${archivierte.length ? `
          <details class="archiv">
            <summary>Archivierte Mitarbeiter (${archivierte.length})</summary>
            ${archivierte.map(karte).join('')}
          </details>` : ''}`;
    }

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      try {
        const name = formular.elements.name.value.trim();
        if (!name) throw new Error('Name ist Pflicht.');
        const alle = await ladeMitarbeiter();
        const doppelt = alle.find((m) => m._id !== inBearbeitung?._id
          && m.name.trim().toLowerCase() === name.toLowerCase());
        if (doppelt) throw new Error(`«${doppelt.name}» ist bereits erfasst.`);
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'mitarbeiter', baustelleId: PERSONAL_ID, archiviert: false };
        await put({
          ...basis,
          name,
          lohnklasse: formular.elements.lohnklasse.value,
          modell: formular.elements.modell.value,
          sollProTag: formular.elements.sollProTag.value.trim() || String(SOLL_PRO_TAG),
        });
        fuelleFormular(null);
        meldung.textContent = 'Mitarbeiter gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    abbrechenKnopf.addEventListener('click', () => fuelleFormular(null));

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const alle = await ladeMitarbeiter();
      const mitarbeiter = alle.find((m) => m._id === knopf.dataset.id);
      if (!mitarbeiter) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'bearbeiten') {
        fuelleFormular(mitarbeiter);
        formular.scrollIntoView({ behavior: 'smooth' });
      } else if (aktion === 'archivieren' || aktion === 'aktivieren') {
        await put({ ...mitarbeiter, archiviert: aktion === 'archivieren' });
        await zeichneListe();
      } else if (aktion === 'loeschen') {
        if (!confirm(`${mitarbeiter.name} endgültig löschen? Die Rapporte bleiben unverändert.`)) return;
        await entferneDokument(mitarbeiter._id);
        if (inBearbeitung?._id === mitarbeiter._id) fuelleFormular(null);
        await zeichneListe();
      } else if (aktion === 'konto') {
        container.querySelector('[data-rolle="konto"]').innerHTML =
          '<p class="hinweis">Das Stundenkonto folgt in Abend 10.2.</p>';
      }
    });

    fuelleFormular(null);
    zeichneListe();
  },
};
