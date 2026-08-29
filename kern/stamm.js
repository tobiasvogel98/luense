// kern/stamm.js — Baustellen-Stamm: Daten (anlegen/bearbeiten/archivieren,
// JSON-Import) und die Stamm-Ansicht für den Modulbereich.

import { put, abfrage, neueId } from './speicher.js';
import { esc } from './ui.js';

// ---------- Daten ----------

export async function alleBaustellen({ mitArchivierten = false } = {}) {
  const alle = await abfrage({ typ: 'baustelle' });
  alle.sort((a, b) => (a.ktr || '').localeCompare(b.ktr || '', 'de-CH', { numeric: true }));
  return mitArchivierten ? alle : alle.filter((b) => !b.archiviert);
}

export async function speichereBaustelle(felder, vorhandene = null) {
  const doc = vorhandene
    ? { ...vorhandene }
    : (() => {
        const id = neueId('baustelle');
        return { _id: id, typ: 'baustelle', baustelleId: id, archiviert: false };
      })();
  doc.ktr = (felder.ktr || '').trim();
  doc.name = (felder.name || '').trim();
  doc.ort = (felder.ort || '').trim();
  doc.bauherr = (felder.bauherr || '').trim();
  doc.werkvertrag = (felder.werkvertrag || '').trim();
  if (!doc.ktr || !doc.name) throw new Error('KTR-Nr. und Name sind Pflichtfelder.');
  return put(doc);
}

export async function setzeArchiviert(baustelle, archiviert) {
  return put({ ...baustelle, archiviert });
}

// JSON-Import: Liste von Objekten mit ktr, name, optional ort/bauherr/werkvertrag.
// Vorhandene KTR-Nummern werden übersprungen (ergänzen statt überschreiben).
export async function importiereBaustellen(jsonText) {
  let liste;
  try {
    liste = JSON.parse(jsonText);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (!Array.isArray(liste)) throw new Error('Erwartet wird eine JSON-Liste von Baustellen.');
  const bekannt = new Set((await alleBaustellen({ mitArchivierten: true })).map((b) => b.ktr));
  let neu = 0;
  let uebersprungen = 0;
  for (const eintrag of liste) {
    const ktr = String(eintrag?.ktr ?? '').trim();
    const name = String(eintrag?.name ?? '').trim();
    if (!ktr || !name || bekannt.has(ktr)) {
      uebersprungen++;
      continue;
    }
    await speichereBaustelle({
      ktr,
      name,
      ort: String(eintrag.ort ?? ''),
      bauherr: String(eintrag.bauherr ?? ''),
      werkvertrag: String(eintrag.werkvertrag ?? ''),
    });
    bekannt.add(ktr);
    neu++;
  }
  return { neu, uebersprungen };
}

// ---------- Ansicht ----------

// Zeichnet die Stamm-Ansicht in den Container. onAenderung wird nach jeder
// Änderung am Bestand gerufen (die Shell aktualisiert damit die Kopfzeile).
export function renderStammAnsicht(container, { onAenderung = () => {} } = {}) {
  container.innerHTML = `
    <section class="stamm">
      <h2>Baustellen-Stamm</h2>

      <form class="karte formular" data-rolle="formular">
        <h3 data-rolle="formular-titel">Neue Baustelle</h3>
        <label>KTR-Nr. *<input name="ktr" required autocomplete="off"></label>
        <label>Name *<input name="name" required autocomplete="off"></label>
        <label>Ort<input name="ort" autocomplete="off"></label>
        <label>Bauherr<input name="bauherr" autocomplete="off"></label>
        <label>Werkvertrag<input name="werkvertrag" autocomplete="off"
          placeholder="z. B. Vertrags-Nr. oder Summe"></label>
        <div class="knopfzeile">
          <button type="submit" class="knopf knopf-primaer">Speichern</button>
          <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
        </div>
        <p class="meldung" role="status"></p>
      </form>

      <div data-rolle="liste"></div>

      <details class="karte import">
        <summary>Baustellenliste aus JSON importieren</summary>
        <p class="hinweis">Erwartet eine JSON-Liste von Objekten mit <code>ktr</code> und
          <code>name</code>, optional <code>ort</code>, <code>bauherr</code>,
          <code>werkvertrag</code>. Bereits vorhandene KTR-Nummern werden übersprungen.</p>
        <input type="file" accept=".json,application/json" data-rolle="import-datei">
        <p class="meldung" role="status"></p>
      </details>
    </section>`;

  const formular = container.querySelector('[data-rolle="formular"]');
  const formularTitel = container.querySelector('[data-rolle="formular-titel"]');
  const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
  const formularMeldung = formular.querySelector('.meldung');
  const listeElement = container.querySelector('[data-rolle="liste"]');
  const importDatei = container.querySelector('[data-rolle="import-datei"]');
  const importMeldung = container.querySelector('.import .meldung');

  let inBearbeitung = null; // Baustellen-Dokument, das gerade im Formular steht

  function fuelleFormular(baustelle) {
    inBearbeitung = baustelle;
    formularTitel.textContent = baustelle
      ? `Baustelle ${baustelle.ktr} bearbeiten`
      : 'Neue Baustelle';
    abbrechenKnopf.hidden = !baustelle;
    for (const feld of ['ktr', 'name', 'ort', 'bauherr', 'werkvertrag']) {
      formular.elements[feld].value = baustelle?.[feld] ?? '';
    }
    formularMeldung.textContent = '';
  }

  function baustellenKarte(b) {
    const details = [b.ort, b.bauherr, b.werkvertrag].filter(Boolean).map(esc).join(' · ');
    return `
      <article class="karte baustelle${b.archiviert ? ' archiviert' : ''}">
        <div class="baustelle-kopf">
          <strong>${esc(b.ktr)}</strong> ${esc(b.name)}
          ${b.archiviert ? '<span class="chip">archiviert</span>' : ''}
        </div>
        ${details ? `<p class="hinweis">${details}</p>` : ''}
        <div class="knopfzeile">
          <button type="button" class="knopf" data-aktion="bearbeiten" data-id="${esc(b._id)}">Bearbeiten</button>
          <button type="button" class="knopf" data-aktion="${b.archiviert ? 'aktivieren' : 'archivieren'}"
            data-id="${esc(b._id)}">${b.archiviert ? 'Aktivieren' : 'Archivieren'}</button>
        </div>
      </article>`;
  }

  async function zeichneListe() {
    const alle = await alleBaustellen({ mitArchivierten: true });
    const aktive = alle.filter((b) => !b.archiviert);
    const archivierte = alle.filter((b) => b.archiviert);
    listeElement.innerHTML = `
      ${aktive.length ? aktive.map(baustellenKarte).join('') : '<p class="hinweis">Noch keine aktiven Baustellen.</p>'}
      ${archivierte.length ? `
        <details class="archiv">
          <summary>Archivierte Baustellen (${archivierte.length})</summary>
          ${archivierte.map(baustellenKarte).join('')}
        </details>` : ''}`;
  }

  formular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const felder = Object.fromEntries(new FormData(formular));
    try {
      await speichereBaustelle(felder, inBearbeitung);
      fuelleFormular(null);
      await zeichneListe();
      onAenderung();
    } catch (fehler) {
      formularMeldung.textContent = fehler.message;
    }
  });

  abbrechenKnopf.addEventListener('click', () => fuelleFormular(null));

  listeElement.addEventListener('click', async (ereignis) => {
    const knopf = ereignis.target.closest('button[data-aktion]');
    if (!knopf) return;
    const alle = await alleBaustellen({ mitArchivierten: true });
    const baustelle = alle.find((b) => b._id === knopf.dataset.id);
    if (!baustelle) return;
    if (knopf.dataset.aktion === 'bearbeiten') {
      fuelleFormular(baustelle);
      formular.scrollIntoView({ behavior: 'smooth' });
    } else {
      await setzeArchiviert(baustelle, knopf.dataset.aktion === 'archivieren');
      if (inBearbeitung?._id === baustelle._id) fuelleFormular(null);
      await zeichneListe();
      onAenderung();
    }
  });

  importDatei.addEventListener('change', async () => {
    const datei = importDatei.files[0];
    if (!datei) return;
    try {
      const ergebnis = await importiereBaustellen(await datei.text());
      importMeldung.textContent =
        `${ergebnis.neu} neu importiert, ${ergebnis.uebersprungen} übersprungen.`;
      await zeichneListe();
      onAenderung();
    } catch (fehler) {
      importMeldung.textContent = fehler.message;
    } finally {
      importDatei.value = '';
    }
  });

  fuelleFormular(null);
  zeichneListe();
}
