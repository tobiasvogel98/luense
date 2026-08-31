// module/nachtrag.js — Nachträge je Baustelle.
// Nummer, Titel, Sachverhalt, Basis (SIA 118), Summe; Status-Pipeline
// erkannt → gemeldet → offeriert → genehmigt → verrechnet. Beweise sind
// Verknüpfungen auf Journal-Ereignisse, Rapporte und Ausmass-Positionen
// (Dokumente teilen, nie Code). Kacheln: Summe offen / genehmigt.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc, formatDatumZeit } from '../kern/ui.js';

export const NACHTRAG_STATUS = ['erkannt', 'gemeldet', 'offeriert', 'genehmigt', 'verrechnet'];

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${Math.round(n).toLocaleString('de-CH')}`;
}

function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

export default {
  name: 'Nachträge',
  dokumentTypen: ['nachtrag'],

  // Badge: offene Nachträge (noch nicht genehmigt/verrechnet).
  async badge(baustelle) {
    const alle = await abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId });
    return alle.filter((n) => !['genehmigt', 'verrechnet'].includes(n.status)).length || null;
  },

  render(container, baustelle) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="nachtraege">
        <h2>Nachträge · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="kachel-reihe" data-rolle="kacheln"></div>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neuer Nachtrag
          </button>
        </div>

        <div data-rolle="formular-bereich"></div>
        <div data-rolle="liste"></div>
      </section>`;

    const kachelnElement = container.querySelector('[data-rolle="kacheln"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    async function ladeNachtraege() {
      return abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId });
    }

    function zeichneKacheln(nachtraege) {
      const offen = nachtraege.filter((n) => !['genehmigt', 'verrechnet'].includes(n.status));
      const genehmigt = nachtraege.filter((n) => ['genehmigt', 'verrechnet'].includes(n.status));
      const summe = (liste) => liste.reduce((s, n) => s + zahl(n.summe), 0);
      kachelnElement.innerHTML = `
        <div class="karte kachel">
          <span class="kachel-titel">Offen (${offen.length})</span>
          <span class="kachel-wert">${chf(summe(offen))}</span>
        </div>
        <div class="karte kachel kachel-gruen">
          <span class="kachel-titel">Genehmigt (${genehmigt.length})</span>
          <span class="kachel-wert">${chf(summe(genehmigt))}</span>
        </div>`;
    }

    function beweisListe(titel, eintraege, feld, gewaehlte) {
      if (!eintraege.length) return '';
      const gewaehlt = new Set(gewaehlte || []);
      return `
        <p class="gruppen-label">${titel}</p>
        <div class="beweis-liste">
          ${eintraege.map((e) => `
            <label class="beweis-zeile">
              <input type="checkbox" data-beweis="${feld}" value="${esc(e.id)}"
                ${gewaehlt.has(e.id) ? 'checked' : ''}>
              <span>${esc(e.label)}</span>
            </label>`).join('')}
        </div>`;
    }

    async function oeffneFormular(nachtrag) {
      inBearbeitung = nachtrag || null;
      neuZeile.hidden = true;
      const [nachtraege, ereignisse, rapporte, positionen] = await Promise.all([
        ladeNachtraege(),
        abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'ausmass', baustelleId: baustelle.baustelleId }),
      ]);
      const nummer = nachtrag?.nummer
        || `N-${String(nachtraege.length + 1).padStart(2, '0')}`;
      const beweise = nachtrag?.beweise || {};
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="nachtrag-formular">
          <h3>${nachtrag ? `Nachtrag ${esc(nachtrag.nummer)} bearbeiten` : 'Neuer Nachtrag'}</h3>
          <div class="feld-reihe">
            <label>Nummer *<input name="nummer" required value="${esc(nummer)}"
              autocomplete="off"></label>
            <label>Summe [CHF]<input name="summe" type="number" inputmode="decimal"
              step="any" value="${esc(nachtrag?.summe ?? '')}" placeholder="0"></label>
          </div>
          <label>Titel *<input name="titel" required autocomplete="off"
            value="${esc(nachtrag?.titel ?? '')}"
            placeholder="z. B. Zusatzaushub Findling KV 8.1"></label>
          <label>Sachverhalt<textarea name="sachverhalt" rows="3"
            placeholder="Was ist passiert, warum ausservertraglich?">${esc(nachtrag?.sachverhalt ?? '')}</textarea></label>
          <label>Basis (SIA 118)<input name="basis" autocomplete="off"
            value="${esc(nachtrag?.basis ?? '')}"
            placeholder="z. B. Art. 87 SIA 118 — Bestellungsänderung"></label>
          <label>Status<select name="status">
            ${NACHTRAG_STATUS.map((s) => `<option${(nachtrag?.status || 'erkannt') === s ? ' selected' : ''}>${s}</option>`).join('')}
          </select></label>

          ${beweisListe('Beweise: Journal-Ereignisse', ereignisse.map((e) => ({
            id: e._id,
            label: `${e.tag} · ${formatDatumZeit(e.datum)}${e.notiz ? ' · ' + e.notiz.slice(0, 40) : ''}${
              Object.keys(e._attachments || {}).length ? ' 📷' : ''}`,
          })), 'ereignisIds', beweise.ereignisIds)}
          ${beweisListe('Beweise: Tagesrapporte', rapporte.map((r) => ({
            id: r._id,
            label: `Rapport ${formatTag(r.tag)}${zahl(r.davonRegie) ? ` · Regie ${r.davonRegie} h` : ''}`,
          })), 'rapportIds', beweise.rapportIds)}
          ${beweisListe('Beweise: Ausmass-Positionen', positionen.map((p) => ({
            id: p._id,
            label: `${p.pos} · ${p.text.slice(0, 40)}`,
          })), 'ausmassIds', beweise.ausmassIds)}

          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Nachtrag speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    function statusPipelineHtml(status) {
      return `<div class="status-pipeline">
        ${NACHTRAG_STATUS.map((s) => {
          const index = NACHTRAG_STATUS.indexOf(s);
          const aktuell = NACHTRAG_STATUS.indexOf(status);
          return `<span class="pipeline-schritt${index < aktuell ? ' erledigt' : ''}${
            index === aktuell ? ' aktuell' : ''}">${s}</span>`;
        }).join('<span class="pipeline-pfeil">→</span>')}
      </div>`;
    }

    async function zeichneListe() {
      const nachtraege = await ladeNachtraege();
      zeichneKacheln(nachtraege);
      listeElement.innerHTML = nachtraege.length
        ? nachtraege.map((n) => {
            const beweise = n.beweise || {};
            const beweisText = [
              beweise.ereignisIds?.length ? `${beweise.ereignisIds.length} Ereignis${beweise.ereignisIds.length > 1 ? 'se' : ''}` : '',
              beweise.rapportIds?.length ? `${beweise.rapportIds.length} Rapport${beweise.rapportIds.length > 1 ? 'e' : ''}` : '',
              beweise.ausmassIds?.length ? `${beweise.ausmassIds.length} Ausmass-Pos.` : '',
            ].filter(Boolean).join(', ');
            const naechster = NACHTRAG_STATUS[NACHTRAG_STATUS.indexOf(n.status) + 1];
            return `
              <article class="karte nachtrag-karte">
                <div class="rapport-kopf">
                  <strong>${esc(n.nummer)} · ${esc(n.titel)}</strong>
                  <span class="rapport-stunden">${chf(zahl(n.summe))}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(n._id)}">Bearbeiten</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(n._id)}" aria-label="Nachtrag löschen">Löschen</button>
                  </span>
                </div>
                ${statusPipelineHtml(n.status)}
                ${n.sachverhalt ? `<p class="hinweis">${esc(n.sachverhalt.slice(0, 120))}</p>` : ''}
                ${n.basis ? `<p class="hinweis">Basis: ${esc(n.basis)}</p>` : ''}
                ${beweisText ? `<p class="hinweis verknuepfung">↳ Beweise: ${beweisText}</p>` : ''}
                ${naechster ? `
                  <div class="knopfzeile">
                    <button type="button" class="knopf" data-aktion="weiter"
                      data-id="${esc(n._id)}">Status → ${naechster}</button>
                  </div>` : ''}
              </article>`;
          }).join('')
        : '<p class="hinweis">Noch keine Nachträge auf dieser Baustelle.</p>';
    }

    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) schliesseFormular();
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const beweise = { ereignisIds: [], rapportIds: [], ausmassIds: [] };
        for (const box of formular.querySelectorAll('[data-beweis]:checked')) {
          beweise[box.dataset.beweis].push(box.value);
        }
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'nachtrag', baustelleId: baustelle.baustelleId };
        await put({
          ...basis,
          nummer: formular.elements.nummer.value.trim(),
          titel: formular.elements.titel.value.trim(),
          sachverhalt: formular.elements.sachverhalt.value.trim(),
          basis: formular.elements.basis.value.trim(),
          summe: formular.elements.summe.value.trim(),
          status: formular.elements.status.value,
          beweise,
        });
        schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const nachtraege = await ladeNachtraege();
      const nachtrag = nachtraege.find((n) => n._id === knopf.dataset.id);
      if (!nachtrag) return;
      if (knopf.dataset.aktion === 'oeffnen') {
        oeffneFormular(nachtrag);
      } else if (knopf.dataset.aktion === 'weiter') {
        const naechster = NACHTRAG_STATUS[NACHTRAG_STATUS.indexOf(nachtrag.status) + 1];
        if (!naechster) return;
        await put({ ...nachtrag, status: naechster });
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm(`Nachtrag ${nachtrag.nummer} endgültig löschen?`)) return;
        await entferneDokument(nachtrag._id);
        if (inBearbeitung?._id === nachtrag._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      }
    });

    zeichneListe();
  },
};
