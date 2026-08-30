// module/protokolle.js — Protokoll-Engine, viertes Modul der Shell.
// EINE Engine rendert Protokolltypen aus einer Definition: Abschnitte mit
// Feldern (text/mehrzeilig/datum/zeit/auswahl), Tabellen (dynamische
// Zeilen) und Checklisten (Punkt, Status, Bemerkung). Neue Typen sind
// reine Definitionen — die Engine bleibt unverändert.
// Dokumenttyp «protokoll» mit Feld unterTyp.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { esc } from '../kern/ui.js';

const CHECK_STATI = ['i. O.', 'Mangel', 'nicht zutreffend'];

// ---------- Protokolltyp-Definitionen ----------
// Weitere Typen (Sitzung, Begehung, Abnahme, …) kommen in den nächsten
// Abenden ausschliesslich als Einträge in dieser Liste dazu.
const PROTOKOLL_TYPEN = [
  {
    unterTyp: 'test',
    name: 'Testprotokoll',
    abschnitte: [
      {
        titel: 'Kopfdaten',
        felder: [
          { schluessel: 'datum', label: 'Datum', art: 'datum' },
          { schluessel: 'ort', label: 'Ort', art: 'text' },
        ],
      },
      {
        titel: 'Inhalt',
        felder: [
          { schluessel: 'feststellungen', label: 'Feststellungen', art: 'mehrzeilig' },
        ],
      },
    ],
  },
];

function typVon(unterTyp) {
  return PROTOKOLL_TYPEN.find((t) => t.unterTyp === unterTyp);
}

function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

// ---------- Engine: Definition → Formular-HTML ----------

function feldHtml(feld, wert) {
  const w = wert ?? '';
  if (feld.art === 'mehrzeilig') {
    return `<label>${esc(feld.label)}<textarea data-schluessel="${esc(feld.schluessel)}"
      rows="${feld.zeilen || 3}">${esc(w)}</textarea></label>`;
  }
  if (feld.art === 'auswahl') {
    return `<label>${esc(feld.label)}<select data-schluessel="${esc(feld.schluessel)}">
      ${(feld.optionen || []).map((o) => `<option${o === w ? ' selected' : ''}>${esc(o)}</option>`).join('')}
    </select></label>`;
  }
  const typ = feld.art === 'datum' ? 'date' : feld.art === 'zeit' ? 'time' : 'text';
  return `<label>${esc(feld.label)}<input type="${typ}"
    data-schluessel="${esc(feld.schluessel)}" value="${esc(w)}" autocomplete="off"></label>`;
}

function tabellenZeileHtml(tabelle, zeile = {}) {
  return `<div class="rapport-zeile" data-rolle="tab-zeile">
    ${tabelle.spalten.map((s) => `<input class="zeile-name" data-spalte="${esc(s.schluessel)}"
      type="${s.art === 'datum' ? 'date' : 'text'}" placeholder="${esc(s.label)}"
      value="${esc(zeile[s.schluessel] ?? '')}" autocomplete="off">`).join('')}
    <button type="button" class="knopf zeile-weg" data-aktion="tab-zeile-entfernen"
      aria-label="Zeile entfernen">×</button>
  </div>`;
}

function checkZeileHtml(zeile = {}) {
  return `<div class="check-zeile" data-rolle="check-zeile">
    <div class="rapport-zeile">
      <input class="zeile-name" data-feld="punkt" placeholder="Prüfpunkt"
        value="${esc(zeile.punkt ?? '')}" autocomplete="off">
      <select data-feld="status" class="check-status">
        ${CHECK_STATI.map((s) => `<option${s === (zeile.status ?? 'i. O.') ? ' selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
      <button type="button" class="knopf zeile-weg" data-aktion="check-zeile-entfernen"
        aria-label="Punkt entfernen">×</button>
    </div>
    <input class="check-bemerkung" data-feld="bemerkung" placeholder="Bemerkung"
      value="${esc(zeile.bemerkung ?? '')}" autocomplete="off">
  </div>`;
}

function abschnittHtml(abschnitt, werte) {
  let inhalt = '';
  if (abschnitt.felder) {
    inhalt = abschnitt.felder.map((f) => feldHtml(f, werte[f.schluessel])).join('');
  } else if (abschnitt.tabelle) {
    const zeilen = werte[abschnitt.tabelle.schluessel]?.length
      ? werte[abschnitt.tabelle.schluessel] : [{}];
    inhalt = `
      <div class="tabelle" data-tabelle="${esc(abschnitt.tabelle.schluessel)}">
        <div data-rolle="tab-zeilen">${zeilen.map((z) => tabellenZeileHtml(abschnitt.tabelle, z)).join('')}</div>
        <button type="button" class="knopf zeile-hinzu" data-aktion="tab-zeile-hinzu">
          ${esc(abschnitt.tabelle.hinzu || '+ Zeile')}</button>
      </div>`;
  } else if (abschnitt.checkliste) {
    const zeilen = werte[abschnitt.checkliste.schluessel]?.length
      ? werte[abschnitt.checkliste.schluessel]
      : (abschnitt.checkliste.punkte || []).map((p) => ({ punkt: p, status: 'i. O.' }));
    inhalt = `
      <div class="checkliste" data-checkliste="${esc(abschnitt.checkliste.schluessel)}">
        <div data-rolle="check-zeilen">${(zeilen.length ? zeilen : [{}]).map(checkZeileHtml).join('')}</div>
        <button type="button" class="knopf zeile-hinzu" data-aktion="check-zeile-hinzu">+ Prüfpunkt</button>
      </div>`;
  }
  return `<div class="abschnitt"><h4 class="abschnitt-titel">${esc(abschnitt.titel)}</h4>${inhalt}</div>`;
}

// ---------- Engine: Formular → Werte ----------

function sammleWerte(formular, typ) {
  const werte = {};
  for (const abschnitt of typ.abschnitte) {
    if (abschnitt.felder) {
      for (const feld of abschnitt.felder) {
        werte[feld.schluessel] = formular
          .querySelector(`[data-schluessel="${feld.schluessel}"]`).value.trim();
      }
    } else if (abschnitt.tabelle) {
      const wurzel = formular.querySelector(`[data-tabelle="${abschnitt.tabelle.schluessel}"]`);
      werte[abschnitt.tabelle.schluessel] = [...wurzel.querySelectorAll('[data-rolle="tab-zeile"]')]
        .map((zeile) => {
          const eintrag = {};
          for (const spalte of abschnitt.tabelle.spalten) {
            eintrag[spalte.schluessel] = zeile
              .querySelector(`[data-spalte="${spalte.schluessel}"]`).value.trim();
          }
          return eintrag;
        })
        .filter((eintrag) => Object.values(eintrag).some(Boolean));
    } else if (abschnitt.checkliste) {
      const wurzel = formular.querySelector(`[data-checkliste="${abschnitt.checkliste.schluessel}"]`);
      werte[abschnitt.checkliste.schluessel] = [...wurzel.querySelectorAll('[data-rolle="check-zeile"]')]
        .map((zeile) => ({
          punkt: zeile.querySelector('[data-feld="punkt"]').value.trim(),
          status: zeile.querySelector('[data-feld="status"]').value,
          bemerkung: zeile.querySelector('[data-feld="bemerkung"]').value.trim(),
        }))
        .filter((z) => z.punkt || z.bemerkung);
    }
  }
  return werte;
}

// Kurzfassung fürs Listen-Karteli: erster gefüllter Textwert.
function vorschau(werte) {
  for (const wert of Object.values(werte)) {
    if (typeof wert === 'string' && wert && !/^\d{4}-\d{2}-\d{2}$/.test(wert)) {
      return wert.length > 90 ? `${wert.slice(0, 90)}…` : wert;
    }
  }
  return '';
}

export default {
  name: 'Protokolle',
  dokumentTypen: ['protokoll'],

  render(container, baustelle) {
    const filter = new Set(); // gewählte unterTypen; leer = alle
    let inBearbeitung = null; // Protokoll-Dokument im Formular
    let aktiverTyp = null;

    container.innerHTML = `
      <section class="protokolle">
        <h2>Protokolle · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="karte formular" data-rolle="neu-bereich">
          <label>Protokolltyp
            <select data-rolle="typ-wahl">
              ${PROTOKOLL_TYPEN.map((t) => `<option value="${esc(t.unterTyp)}">${esc(t.name)}</option>`).join('')}
            </select>
          </label>
          <div class="knopfzeile">
            <button type="button" class="knopf knopf-primaer" data-aktion="anlegen">
              Neues Protokoll anlegen
            </button>
          </div>
        </div>

        <div data-rolle="formular-bereich"></div>

        <div class="chips" data-rolle="filter"></div>
        <div data-rolle="liste"></div>
      </section>`;

    const neuBereich = container.querySelector('[data-rolle="neu-bereich"]');
    const typWahl = container.querySelector('[data-rolle="typ-wahl"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function schliesseFormular() {
      inBearbeitung = null;
      aktiverTyp = null;
      formularBereich.innerHTML = '';
      neuBereich.hidden = false;
    }

    function oeffneFormular(typ, protokoll) {
      aktiverTyp = typ;
      inBearbeitung = protokoll || null;
      neuBereich.hidden = true;
      const werte = protokoll?.werte || { datum: heuteTag() };
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="protokoll-formular">
          <h3>${esc(typ.name)}${protokoll ? ' bearbeiten' : ''}</h3>
          ${typ.abschnitte.map((a) => abschnittHtml(a, werte)).join('')}
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function zeichneFilter() {
      filterElement.innerHTML = PROTOKOLL_TYPEN.map((t) => `
        <button type="button" class="chip chip-knopf${filter.has(t.unterTyp) ? ' aktiv' : ''}"
          data-untertyp="${esc(t.unterTyp)}">${esc(t.name)}</button>`).join('');
    }

    async function zeichneListe() {
      const alle = await abfrage({ typ: 'protokoll', baustelleId: baustelle.baustelleId });
      const gezeigt = filter.size ? alle.filter((p) => filter.has(p.unterTyp)) : alle;
      listeElement.innerHTML = gezeigt.length
        ? gezeigt.map((p) => {
            const typ = typVon(p.unterTyp);
            const kurz = vorschau(p.werte || {});
            return `
              <article class="karte protokoll-karte">
                <div class="rapport-kopf">
                  <strong>${esc(typ?.name || p.unterTyp)}</strong>
                  <span class="hinweis">${formatTag(p.werte?.datum) || formatTag(p.datum)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(p._id)}">Öffnen</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(p._id)}" aria-label="Protokoll löschen">Löschen</button>
                  </span>
                </div>
                ${kurz ? `<p class="hinweis">${esc(kurz)}</p>` : ''}
              </article>`;
          }).join('')
        : `<p class="hinweis">${
            alle.length ? 'Keine Protokolle zu dieser Auswahl.' : 'Noch keine Protokolle auf dieser Baustelle.'}</p>`;
    }

    container.querySelector('[data-aktion="anlegen"]').addEventListener('click', () => {
      const typ = typVon(typWahl.value);
      if (typ) oeffneFormular(typ, null);
    });

    filterElement.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-untertyp]');
      if (!knopf) return;
      const wert = knopf.dataset.untertyp;
      filter.has(wert) ? filter.delete(wert) : filter.add(wert);
      zeichneFilter();
      zeichneListe();
    });

    formularBereich.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'abbrechen') {
        schliesseFormular();
      } else if (aktion === 'tab-zeile-hinzu') {
        const wurzel = knopf.closest('[data-tabelle]');
        const abschnitt = aktiverTyp.abschnitte
          .find((a) => a.tabelle?.schluessel === wurzel.dataset.tabelle);
        wurzel.querySelector('[data-rolle="tab-zeilen"]')
          .insertAdjacentHTML('beforeend', tabellenZeileHtml(abschnitt.tabelle));
      } else if (aktion === 'tab-zeile-entfernen') {
        knopf.closest('[data-rolle="tab-zeile"]').remove();
      } else if (aktion === 'check-zeile-hinzu') {
        knopf.closest('[data-checkliste]').querySelector('[data-rolle="check-zeilen"]')
          .insertAdjacentHTML('beforeend', checkZeileHtml());
      } else if (aktion === 'check-zeile-entfernen') {
        knopf.closest('[data-rolle="check-zeile"]').remove();
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const werte = sammleWerte(formular, aktiverTyp);
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'protokoll', baustelleId: baustelle.baustelleId, unterTyp: aktiverTyp.unterTyp };
        await put({
          ...basis,
          werte,
          // Chronologie: das Protokolldatum bestimmt die Sortierung.
          datum: /^\d{4}-\d{2}-\d{2}$/.test(werte.datum || '')
            ? `${werte.datum}T12:00:00.000Z`
            : (basis.datum || new Date().toISOString()),
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
      const alle = await abfrage({ typ: 'protokoll', baustelleId: baustelle.baustelleId });
      const protokoll = alle.find((p) => p._id === knopf.dataset.id);
      if (!protokoll) return;
      if (knopf.dataset.aktion === 'oeffnen') {
        const typ = typVon(protokoll.unterTyp);
        if (typ) oeffneFormular(typ, protokoll);
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm('Dieses Protokoll endgültig löschen?')) return;
        await entferneDokument(protokoll._id);
        if (inBearbeitung?._id === protokoll._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      }
    });

    zeichneFilter();
    zeichneListe();
  },
};
