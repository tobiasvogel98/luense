// module/ausmass.js — Ausmass: NPK-Positionen je Baustelle.
// Felder und Rechenlogik nach dem Alt-Tool (Offertrechner/BauCockpit):
// Betrag = Menge × EP ohne Zwischenrundung, CHF mit zwei Nachkommastellen.
// Fortschritt je Position in %; Menge über Vertragsmenge wird rot
// markiert (Nachtrags-Frühwarnung). Dokumenttyp «ausmass», ein Dokument
// je Position. JSON-Import als Probelauf mit Duplikat-Schutz.
// «Ausgemessen» nimmt eine Zahl oder einen Rechenweg («12.5*3 + 4,2»,
// kern/rechenweg.js) — gespeichert als menge (Ergebnis), mengeQuelle
// 'rechenweg' und mengeFormel, sichtbar an der Position.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { exportiereCsv } from '../kern/export.js';
import {
  GRABENARTEN, ROHR_BIBLIOTHEK, ROHR_LABELS, berechneTeil, abschnittSvg,
} from '../kern/graben.js';
import { chf, esc } from '../kern/ui.js';
import { werteMengeAus } from '../kern/rechenweg.js';

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function mengeText(n) {
  return n.toLocaleString('de-CH', { maximumFractionDigits: 3 });
}

function prozent(anteil) {
  return `${Math.round(anteil * 100)} %`;
}

function hatRechenweg(p) {
  return p?.mengeQuelle === 'rechenweg' && Boolean(p.mengeFormel);
}

function quelleText(p) {
  if (hatRechenweg(p)) return `Rechenweg ${p.mengeFormel}`;
  return p.mengeQuelle === 'grabenrechner' ? 'Grabenrechner' : '';
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

        <div class="knopfzeile ausmass-aktionen">
          <button type="button" class="knopf graben-sprung" data-aktion="zum-grabenrechner">
            📐 Grabenrechner <span class="badge-anzahl" data-rolle="graben-anzahl" hidden></span>
          </button>
        </div>

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
            <label>Ausgemessen (Zahl oder Rechenweg)<input name="menge" inputmode="text"
              autocomplete="off" spellcheck="false" enterkeyhint="done" class="rechenweg-feld"
              placeholder="z. B. 12.5*3 + 4.2"></label>
            <label>EP [CHF]<input name="ep" type="number"
              inputmode="decimal" step="any" placeholder="0.00"></label>
          </div>
          <p class="menge-status" data-rolle="menge-status" role="status"></p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Position speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="karte" data-rolle="summen" hidden></div>

        <div class="listen-kopf">
          <button type="button" class="knopf" data-aktion="export"
            title="Öffnet direkt in Excel">Excel-Export</button>
          <label class="knopf">
            Positionen importieren (JSON)
            <input type="file" accept=".json,application/json"
              data-rolle="import-datei" class="visually-hidden">
          </label>
        </div>
        <p class="meldung" data-rolle="import-meldung" role="status"></p>
        <div data-rolle="liste"></div>

        <div class="graben-kopf" data-rolle="graben-bereich">
          <h3 class="graben-titel">Grabenrechner</h3>
          <button type="button" class="knopf eintrag-loeschen" data-aktion="zu-positionen">
            ↑ Positionen</button>
        </div>
        <p class="hinweis">Abschnitte bleiben gespeichert — die berechneten Mengen
          lassen sich je Grabenteil einer NPK-Position zuordnen und übernehmen.</p>
        <div data-rolle="graben-liste"></div>
        <div data-rolle="graben-editor"></div>
        <div class="knopfzeile">
          <button type="button" class="knopf" data-aktion="graben-neu">+ Abschnitt</button>
          <button type="button" class="knopf knopf-primaer" data-aktion="uebernehmen">
            Mengen ins Ausmass übernehmen
          </button>
        </div>
        <p class="meldung" data-rolle="graben-meldung" role="status"></p>
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

    container.querySelector('[data-aktion="export"]')
      .addEventListener('click', async () => {
        const positionen = await ladePositionen();
        exportiereCsv(
          `luense-ausmass-${baustelle.ktr}.csv`,
          ['NPK-Pos.', 'Text', 'Einheit', 'Vertragsmenge', 'Ausgemessen',
            'EP CHF', 'Betrag CHF', 'Über Vertrag', 'Quelle'],
          positionen.map((p) => {
            const w = positionsWerte(p);
            return [p.pos, p.text, p.einheit || '', w.vertragsmenge, w.menge,
              w.ep, w.betrag, w.ueberVertrag ? 'ja' : '',
              quelleText(p)];
          }),
        );
      });

    function fuelleFormular(position) {
      inBearbeitung = position;
      formularTitel.textContent = position
        ? `Position ${position.pos} bearbeiten` : 'Neue Position';
      abbrechenKnopf.hidden = !position;
      for (const feld of ['pos', 'text', 'einheit', 'vertragsmenge', 'menge', 'ep']) {
        formular.elements[feld].value = position?.[feld] ?? '';
      }
      if (hatRechenweg(position)) formular.elements.menge.value = position.mengeFormel;
      meldung.textContent = '';
      zeigeMengenStatus();
    }

    // Rechenweg-Vorschau unter dem Feld: «= 41.90 m³ · Rechenweg» oder Fehler.
    const mengenStatus = formular.querySelector('[data-rolle="menge-status"]');
    function zeigeMengenStatus() {
      const e = werteMengeAus(formular.elements.menge.value);
      const eh = formular.elements.einheit.value.trim();
      formular.elements.menge.setAttribute('aria-invalid', String(Boolean(e.fehler)));
      mengenStatus.classList.toggle('rechenweg-fehler', Boolean(e.fehler));
      mengenStatus.textContent = e.fehler ? `⚠ ${e.fehler}`
        : e.formel ? `= ${mengeText(Number(e.menge))}${eh ? ` ${eh}` : ''} · Rechenweg` : '';
    }
    formular.elements.menge.addEventListener('input', zeigeMengenStatus);
    formular.elements.einheit.addEventListener('input', zeigeMengenStatus);

    // Verknüpfung zur Offerte (nur über Dokumente, ohne Code des Offert-
    // Moduls): Positionen tragen offertId/offertPosNr; ältere bzw. Beispiel-
    // Positionen finden ihre Offerte über zielBaustelleId und die NPK-Nr.
    let offertLinks = new Map(); // ausmass-_id → { offertId, posNr }

    async function ladeOffertLinks(positionen) {
      const offerten = (await abfrage({ typ: 'offerte', baustelleId: 'offertwesen' }))
        .filter((o) => o.zielBaustelleId === baustelle.baustelleId && !o.kopieVon);
      const nrn = (o) => new Set((o.gliederung || o.positionen || [])
        .filter((z) => (z.art ?? 'position') === 'position')
        .map((z) => String(z.nr ?? z.pos ?? '').trim()));
      const links = new Map();
      for (const p of positionen) {
        const nr = String(p.offertPosNr ?? p.pos ?? '').trim();
        if (p.offertId) {
          links.set(p._id, { offertId: p.offertId, posNr: nr });
        } else {
          const offerte = offerten.find((o) => nrn(o).has(nr));
          if (offerte) links.set(p._id, { offertId: offerte._id, posNr: nr });
        }
      }
      return links;
    }

    function positionsKarte(p) {
      const w = positionsWerte(p);
      const link = offertLinks.get(p._id);
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
          ${hatRechenweg(p) ? `<p class="hinweis position-rechenweg">Rechenweg: <code>${esc(p.mengeFormel)}</code>
            = ${mengeText(w.menge)} ${esc(p.einheit || '')}</p>` : ''}
          ${p.mengeQuelle === 'grabenrechner' ? '<p class="hinweis position-rechenweg">Menge aus dem Grabenrechner</p>' : ''}
          ${link ? `<div class="knopfzeile offert-sprung">
            <button type="button" class="knopf" data-aktion="offert-ausmass" data-id="${esc(p._id)}"
              aria-label="Offert-Ausmass der Position ${esc(p.pos)} öffnen">Offert-Ausmass öffnen ↗</button>
          </div>` : ''}
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
      try {
        offertLinks = await ladeOffertLinks(positionen);
      } catch {
        offertLinks = new Map();
      }
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
      const mengeEingabe = werteMengeAus(felder.menge);
      if (mengeEingabe.fehler) {
        meldung.textContent = mengeEingabe.fehler;
        formular.elements.menge.focus();
        return;
      }
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'ausmass', baustelleId: baustelle.baustelleId };
        const neu = {
          ...basis,
          pos: felder.pos.trim(),
          text: felder.text.trim(),
          einheit: (felder.einheit || '').trim(),
          vertragsmenge: (felder.vertragsmenge || '').trim(),
          menge: mengeEingabe.formel ? mengeEingabe.menge : (felder.menge || '').trim(),
          ep: (felder.ep || '').trim(),
        };
        if (mengeEingabe.formel) {
          neu.mengeQuelle = 'rechenweg';
          neu.mengeFormel = mengeEingabe.formel;
        } else {
          // Zahl getippt: ein früherer Rechenweg gilt nicht mehr; eine
          // gleich gebliebene Menge behält ihre Quelle (z. B. Grabenrechner).
          delete neu.mengeFormel;
          if (neu.mengeQuelle === 'rechenweg'
            || (neu.mengeQuelle && zahl(neu.menge) !== zahl(basis.menge))) delete neu.mengeQuelle;
        }
        await put(neu);
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
      if (knopf.dataset.aktion === 'offert-ausmass') {
        // Sprung ins Offert-Ausmass (Mengen-Fenster der Offert-Position);
        // die Offerte wählt selbst ihre Arbeitsversion (Kopie).
        const link = offertLinks.get(position._id);
        if (!link) return;
        document.dispatchEvent(new CustomEvent('luense:modulWechseln', {
          detail: { name: 'Offerten', offertId: link.offertId, posNr: link.posNr },
        }));
      } else if (knopf.dataset.aktion === 'bearbeiten') {
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
        const uebersprungenListe = [];
        for (const eintrag of liste) {
          const pos = String(eintrag?.pos ?? eintrag?.nr ?? '').trim();
          const text = String(eintrag?.text ?? '').trim();
          if (!pos || !text || bekannt.has(pos)) {
            uebersprungen++;
            uebersprungenListe.push(pos || '(ohne Nr.)');
            continue;
          }
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
          `${neu} Positionen importiert, ${uebersprungen} übersprungen.${
            uebersprungenListe.length
              ? ` Übersprungen: ${uebersprungenListe.slice(0, 8).join(', ')}${
                  uebersprungenListe.length > 8 ? ' …' : ''}` : ''}`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        importMeldung.textContent = fehler.message;
      } finally {
        importDatei.value = '';
      }
    });

    // ================= Grabenrechner =================
    const grabenListe = container.querySelector('[data-rolle="graben-liste"]');
    const grabenEditor = container.querySelector('[data-rolle="graben-editor"]');
    const grabenMeldung = container.querySelector('[data-rolle="graben-meldung"]');
    let grabenInBearbeitung = null; // Abschnitts-Dokument im Editor

    const rund2 = (n) => Math.round(n * 100) / 100;
    const m3 = (n) => `${rund2(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`;

    async function ladeAbschnitte() {
      const alle = await abfrage({ typ: 'graben', baustelleId: baustelle.baustelleId });
      return alle.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de-CH', { numeric: true }));
    }

    function teilAusFormular(block) {
      const wert = (name) => zahl(block.querySelector(`[data-t="${name}"]`).value);
      const profil = block.querySelector('[data-t="profil"]').value;
      return {
        name: block.querySelector('[data-t="name"]').value.trim() || 'Grabenteil',
        profil,
        B: wert('B'),
        BOben: profil === 'v' ? wert('BOben') : wert('B'),
        H: wert('H'),
        hBett: wert('hBett'),
        hUeber: wert('hUeber'),
        pipes: [...block.querySelectorAll('[data-rolle="rohr"]')].map((r) => ({
          type: r.dataset.typ,
          d: zahl(r.dataset.d),
          z: zahl(r.querySelector('[data-t="z"]').value),
          x: zahl(r.querySelector('[data-t="x"]').value),
        })),
        zuordnung: {
          aushub: block.querySelector('[data-t="zu-aushub"]').value,
          sand: block.querySelector('[data-t="zu-sand"]').value,
          auffuellung: block.querySelector('[data-t="zu-auffuellung"]').value,
        },
      };
    }

    function sammleAbschnitt(formular) {
      return {
        name: formular.elements.abschnittName.value.trim() || 'Abschnitt',
        grabenart: formular.elements.grabenart.value,
        L: zahl(formular.elements.laenge.value),
        teile: [...formular.querySelectorAll('[data-rolle="teil"]')].map(teilAusFormular),
      };
    }

    function rohrZeileHtml(p) {
      return `
        <div class="rapport-zeile" data-rolle="rohr" data-typ="${esc(p.type)}" data-d="${p.d}">
          <span class="rohr-name">${esc(ROHR_LABELS[p.type] || p.type)} d${p.d}</span>
          <label class="rohr-mass">z [m]<input data-t="z" type="number" step="0.01"
            inputmode="decimal" value="${p.z}"></label>
          <label class="rohr-mass">x [m]<input data-t="x" type="number" step="0.01"
            inputmode="decimal" value="${p.x}"></label>
          <button type="button" class="knopf zeile-weg" data-aktion="rohr-entfernen"
            aria-label="Rohr entfernen">×</button>
        </div>`;
    }

    function zuordnungSelect(name, gewaehlt, positionen) {
      return `<select data-t="${name}">
        <option value="">— nicht übernehmen —</option>
        ${positionen.map((p) => `<option value="${esc(p._id)}"
          ${p._id === gewaehlt ? ' selected' : ''}>${esc(p.pos)} · ${esc(p.text.slice(0, 32))}</option>`).join('')}
      </select>`;
    }

    function teilHtml(teil, index, positionen) {
      return `
        <div class="arbeit graben-teil" data-rolle="teil">
          <div class="arbeit-kopf">
            <strong>Teil ${index + 1}</strong>
            <button type="button" class="knopf eintrag-loeschen"
              data-aktion="teil-entfernen">Entfernen</button>
          </div>
          <label>Bezeichnung<input data-t="name" value="${esc(teil.name)}" autocomplete="off"></label>
          <div class="feld-reihe">
            <label>Profil<select data-t="profil">
              <option value="u"${teil.profil !== 'v' ? ' selected' : ''}>U-Graben</option>
              <option value="v"${teil.profil === 'v' ? ' selected' : ''}>V-Graben</option>
            </select></label>
            <label>Breite Sohle [m]<input data-t="B" type="number" step="0.05"
              inputmode="decimal" value="${teil.B}"></label>
            <label data-rolle="oben-feld" ${teil.profil !== 'v' ? 'hidden' : ''}>Breite oben [m]
              <input data-t="BOben" type="number" step="0.05" inputmode="decimal"
              value="${teil.BOben ?? teil.B}"></label>
          </div>
          <div class="feld-reihe">
            <label>Tiefe [m]<input data-t="H" type="number" step="0.05"
              inputmode="decimal" value="${teil.H}"></label>
            <label>Bettung [m]<input data-t="hBett" type="number" step="0.05"
              inputmode="decimal" value="${teil.hBett}"></label>
            <label>Überdeckung [m]<input data-t="hUeber" type="number" step="0.05"
              inputmode="decimal" value="${teil.hUeber}"></label>
          </div>
          <p class="gruppen-label">Rohre im Graben (z = Achshöhe ab Sohle, x = seitlich ab Mitte)</p>
          <div data-rolle="rohre">${teil.pipes.map(rohrZeileHtml).join('')}</div>
          <div class="feld-reihe">
            <select data-rolle="rohr-wahl">
              ${ROHR_BIBLIOTHEK.map((r, i) => `<option value="${i}">${esc(ROHR_LABELS[r.type])} d${r.d}</option>`).join('')}
            </select>
            <button type="button" class="knopf zeile-hinzu" data-aktion="rohr-hinzu">+ Rohr</button>
          </div>
          <div data-rolle="ergebnis" class="graben-ergebnis"></div>
          <p class="gruppen-label">NPK-Zuordnung dieses Grabenteils</p>
          <div class="feld-reihe">
            <label>Aushub${zuordnungSelect('zu-aushub', teil.zuordnung?.aushub, positionen)}</label>
            <label>Sand/Umhüllung${zuordnungSelect('zu-sand', teil.zuordnung?.sand, positionen)}</label>
            <label>Auffüllung${zuordnungSelect('zu-auffuellung', teil.zuordnung?.auffuellung, positionen)}</label>
          </div>
        </div>`;
    }

    function aktualisiereTeil(block, L) {
      const teil = teilAusFormular(block);
      const erg = berechneTeil(L, teil);
      block.querySelector('[data-rolle="ergebnis"]').innerHTML = `
        <div><span>Aushub</span><b>${m3(erg.aushub)}</b></div>
        <div><span>Bettung</span><b>${m3(erg.bettung)}</b></div>
        <div><span>Umhüllung netto</span><b>${m3(erg.verdaemmungNetto)}</b></div>
        <div><span>Sand total</span><b>${m3(erg.sandTotal)}</b></div>
        <div><span>Auffüllung</span><b>${m3(erg.auffuellung)}</b></div>
        <div><span>Rohrvolumen</span><b>${m3(erg.rohrVolumen)}</b></div>
        ${erg.warnings.map((w) => `<p class="hinweis wiederhol-warnung">⚠ ${esc(w)}</p>`).join('')}`;
      block.querySelector('[data-rolle="oben-feld"]').hidden = teil.profil !== 'v';
    }

    function aktualisiereAlleTeile(formular) {
      const L = zahl(formular.elements.laenge.value);
      const bloecke = [...formular.querySelectorAll('[data-rolle="teil"]')];
      bloecke.forEach((b) => aktualisiereTeil(b, L));
      // EIN gemeinsamer Querschnitt für den ganzen Abschnitt.
      formular.querySelector('[data-rolle="abschnitt-skizze"]').innerHTML =
        abschnittSvg(bloecke.map(teilAusFormular));
    }

    async function oeffneGrabenEditor(abschnitt) {
      grabenInBearbeitung = abschnitt || null;
      const positionen = await ladePositionen();
      const daten = abschnitt || {
        name: '', grabenart: 'wasser', L: 10,
        teile: JSON.parse(JSON.stringify(GRABENARTEN.wasser.teile)),
      };
      grabenEditor.innerHTML = `
        <form class="karte formular" data-rolle="graben-formular">
          <h3>${abschnitt ? `Abschnitt «${esc(abschnitt.name)}» bearbeiten` : 'Neuer Abschnitt'}</h3>
          <div class="feld-reihe">
            <label>Abschnitt (z. B. KS 12 – KS 13) *
              <input name="abschnittName" required autocomplete="off" value="${esc(daten.name)}"></label>
            <label>Grabenart<select name="grabenart">
              ${Object.entries(GRABENARTEN).map(([schluessel, art]) => `
                <option value="${schluessel}"${schluessel === daten.grabenart ? ' selected' : ''}>${esc(art.name)}</option>`).join('')}
            </select></label>
            <label>Länge [m]<input name="laenge" type="number" step="0.1"
              inputmode="decimal" value="${daten.L}"></label>
          </div>
          <div class="abschnitt-skizze-halter" data-rolle="abschnitt-skizze"></div>
          <div data-rolle="teile">
            ${daten.teile.map((t, i) => teilHtml(t, i, positionen)).join('')}
          </div>
          <button type="button" class="knopf zeile-hinzu" data-aktion="teil-hinzu">+ Grabenteil</button>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Abschnitt speichern</button>
            <button type="button" class="knopf" data-aktion="graben-abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      aktualisiereAlleTeile(grabenEditor.querySelector('form'));
      grabenEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function zeichneGrabenListe() {
      const abschnitte = await ladeAbschnitte();
      const anzahlElement = container.querySelector('[data-rolle="graben-anzahl"]');
      anzahlElement.textContent = abschnitte.length;
      anzahlElement.hidden = !abschnitte.length;
      grabenListe.innerHTML = abschnitte.length
        ? abschnitte.map((a) => {
            const teile = (a.teile || []).map((t) => {
              const erg = berechneTeil(a.L, t);
              return `${esc(t.name)}${t.profil === 'v' ? ' (V)' : ''}: Aushub ${m3(erg.aushub)}, `
                + `Sand ${m3(erg.sandTotal)}, Auffüllung ${m3(erg.auffuellung)}`;
            });
            return `
              <article class="karte graben-abschnitt">
                <div class="rapport-kopf">
                  <strong>${esc(a.name)}</strong>
                  <span class="hinweis">${esc(GRABENARTEN[a.grabenart]?.name || a.grabenart)} · L ${a.L} m</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="graben-oeffnen"
                      data-id="${esc(a._id)}">Öffnen</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="graben-loeschen"
                      data-id="${esc(a._id)}" aria-label="Abschnitt löschen">Löschen</button>
                  </span>
                </div>
                ${teile.map((t) => `<p class="hinweis">${t}</p>`).join('')}
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch keine Abschnitte erfasst.</p>';
    }

    // Übernahme: je zugeordneter NPK-Position die Summe aller Abschnitte
    // — setzt die ausgemessene Menge (Rechner ist die eine Wahrheit).
    async function uebernehmeMengen() {
      const [positionen, abschnitte] = await Promise.all([ladePositionen(), ladeAbschnitte()]);
      const summen = new Map();
      for (const a of abschnitte) {
        for (const teil of a.teile || []) {
          const erg = berechneTeil(a.L, teil);
          for (const [art, menge] of [
            ['aushub', erg.aushub], ['sand', erg.sandTotal], ['auffuellung', erg.auffuellung],
          ]) {
            const posId = teil.zuordnung?.[art];
            if (posId) summen.set(posId, (summen.get(posId) || 0) + menge);
          }
        }
      }
      if (!summen.size) {
        grabenMeldung.textContent = 'Keine NPK-Zuordnungen vorhanden — zuerst in den Abschnitten zuordnen.';
        return;
      }
      const zeilen = [];
      const ziele = [];
      for (const [posId, summe] of summen) {
        const position = positionen.find((p) => p._id === posId);
        if (!position) continue;
        ziele.push({ position, menge: rund2(summe) });
        zeilen.push(`${position.pos}: ${zahl(position.menge)} → ${rund2(summe)} ${position.einheit || ''}`);
      }
      if (!confirm(`Mengen ins Ausmass übernehmen?\n\n${zeilen.join('\n')}`)) return;
      for (const ziel of ziele) {
        const { mengeFormel, ...ohneRechenweg } = ziel.position; // Rechner löst den Rechenweg ab
        await put({ ...ohneRechenweg, menge: String(ziel.menge), mengeQuelle: 'grabenrechner' });
      }
      grabenMeldung.textContent = `${ziele.length} Position${ziele.length === 1 ? '' : 'en'} aktualisiert.`;
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await zeichneListe();
    }

    grabenEditor.addEventListener('input', () => {
      const formular = grabenEditor.querySelector('form');
      if (formular) aktualisiereAlleTeile(formular);
    });

    grabenEditor.addEventListener('change', async (wechsel) => {
      const formular = grabenEditor.querySelector('form');
      if (!formular) return;
      if (wechsel.target === formular.elements.grabenart && !grabenInBearbeitung) {
        // Neue Grabenart: Teile-Vorlage frisch laden (nur beim Neuanlegen).
        const positionen = await ladePositionen();
        const vorlage = JSON.parse(JSON.stringify(GRABENARTEN[wechsel.target.value].teile));
        formular.querySelector('[data-rolle="teile"]').innerHTML =
          vorlage.map((t, i) => teilHtml(t, i, positionen)).join('');
      }
      aktualisiereAlleTeile(formular);
    });

    grabenEditor.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const formular = grabenEditor.querySelector('form');
      const aktion = knopf.dataset.aktion;
      if (aktion === 'graben-abbrechen') {
        grabenInBearbeitung = null;
        grabenEditor.innerHTML = '';
      } else if (aktion === 'teil-hinzu') {
        const positionen = await ladePositionen();
        const anzahl = formular.querySelectorAll('[data-rolle="teil"]').length;
        formular.querySelector('[data-rolle="teile"]').insertAdjacentHTML('beforeend',
          teilHtml(JSON.parse(JSON.stringify(GRABENARTEN.wasser.teile[0])), anzahl, positionen));
        aktualisiereAlleTeile(formular);
      } else if (aktion === 'teil-entfernen') {
        knopf.closest('[data-rolle="teil"]').remove();
        aktualisiereAlleTeile(formular);
      } else if (aktion === 'rohr-hinzu') {
        const teilBlock = knopf.closest('[data-rolle="teil"]');
        const wahl = ROHR_BIBLIOTHEK[Number(teilBlock.querySelector('[data-rolle="rohr-wahl"]').value)];
        const teil = teilAusFormular(teilBlock);
        // Sinnvoller Vorgabewert: Rohr sitzt auf der Bettung, mittig.
        teilBlock.querySelector('[data-rolle="rohre"]').insertAdjacentHTML('beforeend',
          rohrZeileHtml({ ...wahl, z: rund2(teil.hBett + wahl.d / 2000), x: 0 }));
        aktualisiereAlleTeile(formular);
      } else if (aktion === 'rohr-entfernen') {
        knopf.closest('[data-rolle="rohr"]').remove();
        aktualisiereAlleTeile(formular);
      }
    });

    grabenEditor.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      try {
        const basis = grabenInBearbeitung
          ? { ...grabenInBearbeitung }
          : { typ: 'graben', baustelleId: baustelle.baustelleId };
        await put({ ...basis, ...sammleAbschnitt(formular) });
        grabenInBearbeitung = null;
        grabenEditor.innerHTML = '';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneGrabenListe();
      } catch (fehler) {
        formular.querySelector('.meldung').textContent = fehler.message;
      }
    });

    grabenListe.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const abschnitte = await ladeAbschnitte();
      const abschnitt = abschnitte.find((a) => a._id === knopf.dataset.id);
      if (!abschnitt) return;
      if (knopf.dataset.aktion === 'graben-oeffnen') {
        oeffneGrabenEditor(abschnitt);
      } else if (knopf.dataset.aktion === 'graben-loeschen') {
        if (!confirm(`Abschnitt «${abschnitt.name}» endgültig löschen?`)) return;
        await entferneDokument(abschnitt._id);
        if (grabenInBearbeitung?._id === abschnitt._id) {
          grabenInBearbeitung = null;
          grabenEditor.innerHTML = '';
        }
        await zeichneGrabenListe();
      }
    });

    container.querySelector('[data-aktion="graben-neu"]')
      .addEventListener('click', () => oeffneGrabenEditor(null));

    // Sprung-Knopf oben: direkt zum Grabenrechner. Ohne Abschnitte öffnet
    // er gleich den Editor für einen neuen Abschnitt, sonst die Liste.
    container.querySelector('[data-aktion="zum-grabenrechner"]')
      .addEventListener('click', async () => {
        if (grabenEditor.querySelector('form')) {
          grabenEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (!(await ladeAbschnitte()).length) {
          await oeffneGrabenEditor(null);
        } else {
          container.querySelector('[data-rolle="graben-bereich"]')
            .scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    container.querySelector('[data-aktion="zu-positionen"]')
      .addEventListener('click', () => container.querySelector('.ausmass')
        .scrollIntoView({ behavior: 'smooth', block: 'start' }));
    container.querySelector('[data-aktion="uebernehmen"]')
      .addEventListener('click', uebernehmeMengen);

    fuelleFormular(null);
    zeichneListe();
    zeichneGrabenListe();
  },
};
