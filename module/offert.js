// module/offert.js — Offertrechner (baustellenunabhängig).
// NPK-Positionskatalog (eigene Positionen pflegbar), Offerte mit Menge/
// EP und Live-Zusammenzug (Rabatt, Skonto, MwSt — Rechenweg wie das
// Alt-Tool: Betrag = Menge × EP, CHF mit zwei Nachkommastellen).
// Status Entwurf → eingereicht → angenommen; «angenommen» erzeugt per
// Klick eine Baustelle mit Werkvertrag = Offertsumme und den Positionen
// als Ausmass-Vorlage (Vertragsmengen).
// Bewusste Ausnahme von «alle Dokumente tragen eine Baustellen-Id»:
// Katalog und Offerten existieren VOR der Baustelle — sie nutzen die
// Sammel-Ids «katalog» bzw. «offertwesen».

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { speichereBaustelle } from '../kern/stamm.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { esc } from '../kern/ui.js';

const KATALOG_ID = 'katalog';
const OFFERT_ID = 'offertwesen';
const MWST_PROZENT = 8.1;
const OFFERT_STATUS = ['Entwurf', 'eingereicht', 'angenommen'];

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${(n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

// Zusammenzug wie im Alt-Tool: Total → −Rabatt → −Skonto → exkl. → +MwSt.
export function zusammenzug(offerte) {
  const total = (offerte.positionen || [])
    .reduce((s, p) => s + zahl(p.menge) * zahl(p.ep), 0);
  const rabatt = total * zahl(offerte.rabatt) / 100;
  const nachRabatt = total - rabatt;
  const skonto = nachRabatt * zahl(offerte.skonto) / 100;
  const exklMwst = nachRabatt - skonto;
  const mwst = exklMwst * MWST_PROZENT / 100;
  return { total, rabatt, skonto, exklMwst, mwst, inklMwst: exklMwst + mwst };
}

export default {
  name: 'Offerten',
  dokumentTypen: ['offerte', 'katalogposition'],

  render(container) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="offerten">
        <h2>Offerten</h2>
        <p class="hinweis">Baustellenunabhängig — eine angenommene Offerte wird
          per Klick zur neuen Baustelle mit Ausmass-Vorlage.</p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">Neue Offerte</button>
        </div>
        <div data-rolle="formular-bereich"></div>
        <div data-rolle="liste"></div>

        <details class="karte import">
          <summary>NPK-Positionskatalog pflegen</summary>
          <div data-rolle="katalog-liste"></div>
          <form class="feld-reihe" data-rolle="katalog-form">
            <label>NPK-Nr.<input name="pos" required autocomplete="off"></label>
            <label>Text<input name="text" required autocomplete="off"></label>
            <label>Einheit<input name="einheit" autocomplete="off"></label>
            <label>EP<input name="ep" type="number" inputmode="decimal" step="any"></label>
            <button type="submit" class="knopf zeile-hinzu">+ Katalogposition</button>
          </form>
        </details>
      </section>`;

    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');
    const katalogListe = container.querySelector('[data-rolle="katalog-liste"]');

    const ladeOfferten = () => abfrage({ typ: 'offerte', baustelleId: OFFERT_ID });
    const ladeKatalog = async () => (await abfrage({ typ: 'katalogposition', baustelleId: KATALOG_ID }))
      .sort((a, b) => String(a.pos).localeCompare(String(b.pos), 'de-CH', { numeric: true }));

    // ---------- Katalog ----------
    async function zeichneKatalog() {
      const katalog = await ladeKatalog();
      katalogListe.innerHTML = katalog.length
        ? katalog.map((k) => `
            <div class="fo-zeile dossier-zeile">
              <span class="fo-label">${esc(k.pos)} · ${esc(k.text)} · ${esc(k.einheit || '—')}
                · EP ${chf(zahl(k.ep))}</span>
              <button type="button" class="knopf zeile-weg" data-katalog-weg="${esc(k._id)}"
                aria-label="Katalogposition löschen">×</button>
            </div>`).join('')
        : '<p class="hinweis">Noch keine Katalogpositionen.</p>';
    }

    container.querySelector('[data-rolle="katalog-form"]')
      .addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const f = abschicken.target;
        await put({
          typ: 'katalogposition', baustelleId: KATALOG_ID,
          pos: f.elements.pos.value.trim(), text: f.elements.text.value.trim(),
          einheit: f.elements.einheit.value.trim(), ep: f.elements.ep.value.trim(),
        });
        f.reset();
        await zeichneKatalog();
        // Katalog-Auswahl im offenen Editor auffrischen
        if (formularBereich.querySelector('form')) aktualisiereKatalogWahl();
      });

    katalogListe.addEventListener('click', async (klick) => {
      const id = klick.target.closest('[data-katalog-weg]')?.dataset.katalogWeg;
      if (!id || !confirm('Katalogposition löschen?')) return;
      await entferneDokument(id);
      await zeichneKatalog();
    });

    // ---------- Offert-Editor ----------
    function positionsBlock(p = {}) {
      return `
        <div class="tab-block" data-rolle="off-pos">
          <div class="tab-block-kopf">
            <strong data-rolle="tab-nr"></strong>
            <button type="button" class="knopf zeile-weg" data-aktion="pos-weg"
              aria-label="Position entfernen">×</button>
          </div>
          <div class="feld-reihe">
            <label>NPK-Nr.<input data-o="pos" value="${esc(p.pos ?? '')}" autocomplete="off"></label>
            <label>Einheit<input data-o="einheit" value="${esc(p.einheit ?? '')}" autocomplete="off"></label>
          </div>
          <label>Text<input data-o="text" value="${esc(p.text ?? '')}" autocomplete="off"></label>
          <div class="feld-reihe">
            <label>Menge<input data-o="menge" type="number" inputmode="decimal" step="any"
              value="${esc(p.menge ?? '')}"></label>
            <label>EP [CHF]<input data-o="ep" type="number" inputmode="decimal" step="any"
              value="${esc(p.ep ?? '')}"></label>
          </div>
        </div>`;
    }

    function sammleOfferte(formular) {
      return {
        nummer: formular.elements.nummer.value.trim(),
        kunde: formular.elements.kunde.value.trim(),
        objekt: formular.elements.objekt.value.trim(),
        status: formular.elements.status.value,
        rabatt: formular.elements.rabatt.value.trim(),
        skonto: formular.elements.skonto.value.trim(),
        positionen: [...formular.querySelectorAll('[data-rolle="off-pos"]')].map((b) => ({
          pos: b.querySelector('[data-o="pos"]').value.trim(),
          text: b.querySelector('[data-o="text"]').value.trim(),
          einheit: b.querySelector('[data-o="einheit"]').value.trim(),
          menge: b.querySelector('[data-o="menge"]').value.trim(),
          ep: b.querySelector('[data-o="ep"]').value.trim(),
        })).filter((p) => p.pos || p.text || zahl(p.menge) || zahl(p.ep)),
      };
    }

    function aktualisiereZusammenzug() {
      const formular = formularBereich.querySelector('form');
      if (!formular) return;
      const z = zusammenzug(sammleOfferte(formular));
      formular.querySelector('[data-rolle="zusammenzug"]').innerHTML = `
        <div><span>Total Positionen</span><span>${chf(z.total)}</span></div>
        ${z.rabatt ? `<div><span>− Rabatt</span><span>${chf(z.rabatt)}</span></div>` : ''}
        ${z.skonto ? `<div><span>− Skonto</span><span>${chf(z.skonto)}</span></div>` : ''}
        <div><span>Total exkl. MwSt.</span><span>${chf(z.exklMwst)}</span></div>
        <div><span>MwSt. ${MWST_PROZENT} %</span><span>${chf(z.mwst)}</span></div>
        <div class="regie-total"><span>Total inkl. MwSt.</span><span>${chf(z.inklMwst)}</span></div>`;
      formular.querySelectorAll('[data-rolle="tab-nr"]').forEach((el, i) => {
        el.textContent = `Pos. ${i + 1}`;
      });
    }

    async function aktualisiereKatalogWahl() {
      const katalog = await ladeKatalog();
      const wahl = formularBereich.querySelector('[data-rolle="katalog-wahl"]');
      if (wahl) {
        wahl.innerHTML = katalog.length
          ? katalog.map((k, i) => `<option value="${i}">${esc(k.pos)} · ${esc(k.text.slice(0, 30))}</option>`).join('')
          : '<option value="">Katalog leer</option>';
        wahl.dataset.katalog = JSON.stringify(katalog.map((k) => ({
          pos: k.pos, text: k.text, einheit: k.einheit, ep: k.ep,
        })));
      }
    }

    async function oeffneFormular(offerte) {
      inBearbeitung = offerte || null;
      neuZeile.hidden = true;
      const offerten = await ladeOfferten();
      const jahr = new Date().getFullYear();
      const nummer = offerte?.nummer || `O-${jahr}-${String(offerten.length + 1).padStart(2, '0')}`;
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="offert-formular">
          <h3>${offerte ? `Offerte ${esc(offerte.nummer)} bearbeiten` : 'Neue Offerte'}</h3>
          <div class="feld-reihe">
            <label>Nummer *<input name="nummer" required value="${esc(nummer)}" autocomplete="off"></label>
            <label>Status<select name="status">
              ${OFFERT_STATUS.map((s) => `<option${(offerte?.status || 'Entwurf') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></label>
          </div>
          <label>Kunde / Bauherr *<input name="kunde" required autocomplete="off"
            value="${esc(offerte?.kunde ?? '')}"></label>
          <label>Objekt / Baustelle *<input name="objekt" required autocomplete="off"
            value="${esc(offerte?.objekt ?? '')}"></label>

          <div data-rolle="off-positionen">
            ${(offerte?.positionen?.length ? offerte.positionen : [{}]).map(positionsBlock).join('')}
          </div>
          <div class="feld-reihe">
            <select data-rolle="katalog-wahl"></select>
            <button type="button" class="knopf zeile-hinzu" data-aktion="aus-katalog">+ aus Katalog</button>
            <button type="button" class="knopf zeile-hinzu" data-aktion="pos-neu">+ leere Position</button>
          </div>

          <div class="feld-reihe">
            <label>Rabatt %<input name="rabatt" type="number" inputmode="decimal" step="any"
              value="${esc(offerte?.rabatt ?? '')}" placeholder="0"></label>
            <label>Skonto %<input name="skonto" type="number" inputmode="decimal" step="any"
              value="${esc(offerte?.skonto ?? '')}" placeholder="0"></label>
          </div>
          <div class="rapport-totale" data-rolle="zusammenzug"></div>

          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Offerte speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      await aktualisiereKatalogWahl();
      aktualisiereZusammenzug();
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    formularBereich.addEventListener('input', aktualisiereZusammenzug);

    formularBereich.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const formular = formularBereich.querySelector('form');
      if (knopf.dataset.aktion === 'abbrechen') {
        schliesseFormular();
      } else if (knopf.dataset.aktion === 'pos-neu') {
        formular.querySelector('[data-rolle="off-positionen"]')
          .insertAdjacentHTML('beforeend', positionsBlock());
        aktualisiereZusammenzug();
      } else if (knopf.dataset.aktion === 'aus-katalog') {
        const wahl = formular.querySelector('[data-rolle="katalog-wahl"]');
        const katalog = JSON.parse(wahl.dataset.katalog || '[]');
        const eintrag = katalog[Number(wahl.value)];
        if (!eintrag) return;
        formular.querySelector('[data-rolle="off-positionen"]')
          .insertAdjacentHTML('beforeend', positionsBlock({ ...eintrag, menge: '' }));
        aktualisiereZusammenzug();
      } else if (knopf.dataset.aktion === 'pos-weg') {
        knopf.closest('[data-rolle="off-pos"]').remove();
        aktualisiereZusammenzug();
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'offerte', baustelleId: OFFERT_ID };
        await put({ ...basis, ...sammleOfferte(formular) });
        schliesseFormular();
        await zeichneListe();
      } catch (fehler) {
        formular.querySelector('.meldung').textContent = fehler.message;
      }
    });

    // ---------- Offerten-Liste ----------
    async function zeichneListe() {
      const offerten = await ladeOfferten();
      listeElement.innerHTML = offerten.length
        ? offerten.map((o) => {
            const z = zusammenzug(o);
            const index = OFFERT_STATUS.indexOf(o.status);
            const naechster = OFFERT_STATUS[index + 1];
            return `
              <article class="karte offert-karte">
                <div class="rapport-kopf">
                  <strong>${esc(o.nummer)} · ${esc(o.objekt)}</strong>
                  <span class="chip${o.status === 'angenommen' ? ' gewinn' : ''}">${esc(o.status)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                      data-id="${esc(o._id)}">PDF</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(o._id)}">Bearbeiten</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(o._id)}" aria-label="Offerte löschen">Löschen</button>
                  </span>
                </div>
                <p class="hinweis">${esc(o.kunde)} · ${o.positionen?.length || 0} Positionen
                  · ${chf(z.inklMwst)} inkl. MwSt.</p>
                <div class="knopfzeile">
                  ${naechster ? `<button type="button" class="knopf" data-aktion="weiter"
                    data-id="${esc(o._id)}">Status → ${naechster}</button>` : ''}
                  ${o.status === 'angenommen' && !o.baustelleErstellt ? `
                    <button type="button" class="knopf knopf-primaer" data-aktion="baustelle"
                      data-id="${esc(o._id)}">Baustelle erstellen</button>` : ''}
                  ${o.baustelleErstellt ? '<span class="hinweis">↳ Baustelle erstellt ✓</span>' : ''}
                </div>
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch keine Offerten.</p>';
    }

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const offerten = await ladeOfferten();
      const offerte = offerten.find((o) => o._id === knopf.dataset.id);
      if (!offerte) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'oeffnen') {
        oeffneFormular(offerte);
      } else if (aktion === 'weiter') {
        const naechster = OFFERT_STATUS[OFFERT_STATUS.indexOf(offerte.status) + 1];
        if (naechster) await put({ ...offerte, status: naechster });
        await zeichneListe();
      } else if (aktion === 'loeschen') {
        if (!confirm(`Offerte ${offerte.nummer} endgültig löschen?`)) return;
        await entferneDokument(offerte._id);
        if (inBearbeitung?._id === offerte._id) schliesseFormular();
        await zeichneListe();
      } else if (aktion === 'pdf') {
        const z = zusammenzug(offerte);
        zeigeProtokollDruck({ ktr: offerte.nummer, name: offerte.objekt, ort: '' }, {
          titel: `Offerte ${offerte.nummer}`,
          untertitel: `${offerte.kunde} · Status: ${offerte.status}`,
          abschnitte: [
            { art: 'tabelle', titel: 'Positionen',
              spalten: ['NPK', 'Text', 'Einheit', 'Menge', 'EP', 'Betrag'],
              zeilen: (offerte.positionen || []).map((p) => [
                p.pos, p.text, p.einheit || '—', p.menge || '—',
                chf(zahl(p.ep)), chf(zahl(p.menge) * zahl(p.ep)),
              ]) },
            { art: 'felder', titel: 'Zusammenzug', zeilen: [
              { label: 'Total Positionen', wert: chf(z.total) },
              ...(z.rabatt ? [{ label: `Rabatt ${offerte.rabatt} %`, wert: `− ${chf(z.rabatt)}` }] : []),
              ...(z.skonto ? [{ label: `Skonto ${offerte.skonto} %`, wert: `− ${chf(z.skonto)}` }] : []),
              { label: 'Total exkl. MwSt.', wert: chf(z.exklMwst) },
              { label: `MwSt. ${MWST_PROZENT} %`, wert: chf(z.mwst) },
              { label: 'Total inkl. MwSt.', wert: chf(z.inklMwst) },
            ] },
          ],
          unterschriften: ['Lünse — Tobias Vogel', 'Auftraggeber'],
        });
      } else if (aktion === 'baustelle') {
        // Angenommene Offerte → neue Baustelle mit Ausmass-Vorlage.
        const ktr = prompt('KTR-Nr. für die neue Baustelle:');
        if (!ktr || !ktr.trim()) return;
        const z = zusammenzug(offerte);
        const neueBaustelle = await speichereBaustelle({
          ktr: ktr.trim(),
          name: offerte.objekt,
          ort: '',
          bauherr: offerte.kunde,
          werkvertrag: `${chf(z.exklMwst)} exkl. MwSt. (Offerte ${offerte.nummer})`,
        });
        for (const p of offerte.positionen || []) {
          await put({
            typ: 'ausmass',
            baustelleId: neueBaustelle.baustelleId,
            pos: p.pos, text: p.text, einheit: p.einheit,
            vertragsmenge: p.menge, menge: '', ep: p.ep,
          });
        }
        await put({ ...offerte, baustelleErstellt: true });
        document.dispatchEvent(new CustomEvent('luense:daten'));
        alert(`Baustelle ${ktr.trim()} erstellt — ${offerte.positionen?.length || 0} `
          + 'Positionen als Ausmass-Vorlage übernommen.');
        document.dispatchEvent(new CustomEvent('luense:baustelleWechseln', {
          detail: { baustelleId: neueBaustelle.baustelleId },
        }));
      }
    });

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    zeichneListe();
    zeichneKatalog();
  },
};
