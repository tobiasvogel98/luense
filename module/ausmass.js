// module/ausmass.js — Ausmass: NPK-Positionen je Baustelle.
// Felder und Rechenlogik nach dem Alt-Tool (Offertrechner/BauCockpit):
// Betrag = Menge × EP ohne Zwischenrundung, CHF mit zwei Nachkommastellen.
// Fortschritt je Position in %; Menge über Vertragsmenge wird rot
// markiert (Nachtrags-Frühwarnung). Dokumenttyp «ausmass», ein Dokument
// je Position. JSON-Import als Probelauf mit Duplikat-Schutz.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc } from '../kern/ui.js';

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// CHF-Format wie im Alt-Tool: zwei Nachkommastellen, de-CH-Gruppierung.
function chf(n) {
  return `CHF ${(n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function mengeText(n) {
  return n.toLocaleString('de-CH', { maximumFractionDigits: 3 });
}

function prozent(anteil) {
  return `${Math.round(anteil * 100)} %`;
}

export function positionsWerte(p) {
  const vertragsmenge = zahl(p.vertragsmenge);
  const menge = zahl(p.menge);
  const ep = zahl(p.ep);
  return {
    vertragsmenge,
    menge,
    ep,
    betrag: menge * ep,                       // wie Alt-Tool: menge * ep
    vertragsbetrag: vertragsmenge * ep,
    fortschritt: vertragsmenge > 0 ? menge / vertragsmenge : null,
    ueberVertrag: vertragsmenge > 0 && menge > vertragsmenge,
  };
}

export default {
  name: 'Ausmass',
  dokumentTypen: ['ausmass'],

  render(container, baustelle) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="ausmass">
        <h2>Ausmass · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <h3 data-rolle="formular-titel">Neue Position</h3>
          <div class="feld-reihe">
            <label>NPK-Nr. *<input name="pos" required autocomplete="off"
              placeholder="z. B. 237.211"></label>
            <label>Einheit<input name="einheit" autocomplete="off"
              placeholder="z. B. m³"></label>
          </div>
          <label>Text *<input name="text" required autocomplete="off"
            placeholder="Positionstext"></label>
          <div class="feld-reihe">
            <label>Vertragsmenge<input name="vertragsmenge" type="number"
              inputmode="decimal" step="any" placeholder="0"></label>
            <label>Ausgemessen<input name="menge" type="number"
              inputmode="decimal" step="any" placeholder="0"></label>
            <label>EP [CHF]<input name="ep" type="number"
              inputmode="decimal" step="any" placeholder="0.00"></label>
          </div>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Position speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="karte" data-rolle="summen" hidden></div>

        <div class="listen-kopf">
          <span></span>
          <label class="knopf">
            Positionen importieren (JSON)
            <input type="file" accept=".json,application/json"
              data-rolle="import-datei" class="visually-hidden">
          </label>
        </div>
        <p class="meldung" data-rolle="import-meldung" role="status"></p>
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const formularTitel = formular.querySelector('[data-rolle="formular-titel"]');
    const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
    const meldung = formular.querySelector('.meldung');
    const summenElement = container.querySelector('[data-rolle="summen"]');
    const importDatei = container.querySelector('[data-rolle="import-datei"]');
    const importMeldung = container.querySelector('[data-rolle="import-meldung"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    async function ladePositionen() {
      const alle = await abfrage({ typ: 'ausmass', baustelleId: baustelle.baustelleId });
      return alle.sort((a, b) =>
        String(a.pos).localeCompare(String(b.pos), 'de-CH', { numeric: true }));
    }

    function fuelleFormular(position) {
      inBearbeitung = position;
      formularTitel.textContent = position
        ? `Position ${position.pos} bearbeiten` : 'Neue Position';
      abbrechenKnopf.hidden = !position;
      for (const feld of ['pos', 'text', 'einheit', 'vertragsmenge', 'menge', 'ep']) {
        formular.elements[feld].value = position?.[feld] ?? '';
      }
      meldung.textContent = '';
    }

    function positionsKarte(p) {
      const w = positionsWerte(p);
      return `
        <article class="karte position${w.ueberVertrag ? ' ueber-vertrag' : ''}">
          <div class="rapport-kopf">
            <strong>${esc(p.pos)}</strong>
            <span class="hinweis">${esc(p.einheit || '')}</span>
            ${w.ueberVertrag ? '<span class="chip wiederhol-chip">⚠ über Vertragsmenge</span>' : ''}
            <span class="rapport-knoepfe">
              <button type="button" class="knopf eintrag-loeschen" data-aktion="bearbeiten"
                data-id="${esc(p._id)}">Bearbeiten</button>
              <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                data-id="${esc(p._id)}" aria-label="Position löschen">Löschen</button>
            </span>
          </div>
          <p class="position-text">${esc(p.text || '')}</p>
          <div class="position-zahlen">
            <span>${mengeText(w.menge)} / ${mengeText(w.vertragsmenge)} ${esc(p.einheit || '')}
              ${w.fortschritt !== null ? `· <b class="${w.ueberVertrag ? 'verlust' : ''}">${prozent(w.fortschritt)}</b>` : ''}</span>
            <span>EP ${chf(w.ep)}</span>
            <span class="position-betrag">${chf(w.betrag)}</span>
          </div>
        </article>`;
    }

    async function zeichneListe() {
      const positionen = await ladePositionen();
      if (!positionen.length) {
        summenElement.hidden = true;
        listeElement.innerHTML =
          '<p class="hinweis">Noch keine Positionen auf dieser Baustelle.</p>';
        return;
      }
      const summe = positionen.reduce((s, p) => {
        const w = positionsWerte(p);
        s.betrag += w.betrag;
        s.vertragsbetrag += w.vertragsbetrag;
        return s;
      }, { betrag: 0, vertragsbetrag: 0 });
      summenElement.hidden = false;
      summenElement.innerHTML = `
        <div class="fo-zeile fo-berechnet"><span class="fo-nr"></span>
          <span class="fo-label">Vertragssumme (${positionen.length} Positionen)</span>
          <span class="fo-wert">${chf(summe.vertragsbetrag)}</span></div>
        <div class="fo-zeile fo-berechnet fo-hervor"><span class="fo-nr"></span>
          <span class="fo-label">Ausgemessen total</span>
          <span class="fo-wert">${chf(summe.betrag)}</span></div>
        <div class="fo-zeile fo-berechnet"><span class="fo-nr"></span>
          <span class="fo-label">Fortschritt gesamt</span>
          <span class="fo-wert">${summe.vertragsbetrag > 0
            ? prozent(summe.betrag / summe.vertragsbetrag) : '—'}</span></div>`;
      listeElement.innerHTML = positionen.map(positionsKarte).join('');
    }

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const felder = Object.fromEntries(new FormData(formular));
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'ausmass', baustelleId: baustelle.baustelleId };
        await put({
          ...basis,
          pos: felder.pos.trim(),
          text: felder.text.trim(),
          einheit: (felder.einheit || '').trim(),
          vertragsmenge: (felder.vertragsmenge || '').trim(),
          menge: (felder.menge || '').trim(),
          ep: (felder.ep || '').trim(),
        });
        fuelleFormular(null);
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
      const positionen = await ladePositionen();
      const position = positionen.find((p) => p._id === knopf.dataset.id);
      if (!position) return;
      if (knopf.dataset.aktion === 'bearbeiten') {
        fuelleFormular(position);
        formular.scrollIntoView({ behavior: 'smooth' });
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm(`Position ${position.pos} endgültig löschen?`)) return;
        await entferneDokument(position._id);
        if (inBearbeitung?._id === position._id) fuelleFormular(null);
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      }
    });

    // Probelauf-Import: JSON-Liste von Positionen; vorhandene NPK-Nrn.
    // werden übersprungen (ergänzt statt überschreibt).
    importDatei.addEventListener('change', async () => {
      const datei = importDatei.files[0];
      if (!datei) return;
      try {
        let liste;
        try {
          liste = JSON.parse(await datei.text());
        } catch {
          throw new Error('Die Datei ist kein gültiges JSON.');
        }
        if (!Array.isArray(liste)) {
          throw new Error('Erwartet wird eine JSON-Liste von Positionen.');
        }
        const bekannt = new Set((await ladePositionen()).map((p) => String(p.pos)));
        let neu = 0;
        let uebersprungen = 0;
        for (const eintrag of liste) {
          const pos = String(eintrag?.pos ?? eintrag?.nr ?? '').trim();
          const text = String(eintrag?.text ?? '').trim();
          if (!pos || !text || bekannt.has(pos)) { uebersprungen++; continue; }
          await put({
            typ: 'ausmass',
            baustelleId: baustelle.baustelleId,
            pos,
            text,
            einheit: String(eintrag.einheit ?? '').trim(),
            vertragsmenge: String(eintrag.vertragsmenge ?? '').trim(),
            menge: String(eintrag.menge ?? '').trim(),
            ep: String(eintrag.ep ?? '').trim(),
          });
          bekannt.add(pos);
          neu++;
        }
        importMeldung.textContent =
          `${neu} Positionen importiert, ${uebersprungen} übersprungen.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        importMeldung.textContent = fehler.message;
      } finally {
        importDatei.value = '';
      }
    });

    fuelleFormular(null);
    zeichneListe();
  },
};
