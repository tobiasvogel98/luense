// module/protokolle.js — Protokoll-Engine, viertes Modul der Shell.
// EINE Engine rendert Protokolltypen aus einer Definition: Abschnitte mit
// Feldern (text/mehrzeilig/datum/zeit/auswahl), Tabellen (dynamische
// Blöcke) und Checklisten. Jeder Typ ist auf seinen Zweck zugeschnitten —
// wie das echte Papier-Protokoll (Vorbild: LünseDok). Neue Typen sind
// reine Definitionen. Dokumenttyp «protokoll» mit Feld unterTyp.

import {
  put, abfrage, entferneDokument, haengeAnhangAn, holeAnhang, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { oeffneHandnotiz } from '../kern/handschrift.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { esc, zeigeBildVollbild } from '../kern/ui.js';

const CHECK_STATI = ['i. O.', 'Mangel', 'nicht zutreffend'];

// ---------- Protokolltyp-Definitionen ----------

const PROTOKOLL_TYPEN = [
  {
    unterTyp: 'sitzung',
    name: 'Sitzungsprotokoll',
    unterschriften: ['Protokollführer', 'Bauleitung / Bauherr'],
    kartenTitel: (werte) => werte.sitzungsart || 'Sitzung',
    abschnitte: [
      {
        titel: 'Kopfdaten',
        felder: [
          { schluessel: 'sitzungsart', label: 'Sitzungsart', art: 'auswahl',
            optionen: ['Jour fixe', 'Bauführersitzung', 'Bausitzung'] },
          { schluessel: 'datum', label: 'Datum', art: 'datum', halb: true },
          { schluessel: 'ort', label: 'Ort der Sitzung', art: 'text', halb: true },
          { schluessel: 'zeitVon', label: 'Zeit von', art: 'zeit', halb: true },
          { schluessel: 'zeitBis', label: 'Zeit bis', art: 'zeit', halb: true },
          { schluessel: 'protokollfuehrer', label: 'Protokollführer', art: 'text', halb: true },
          { schluessel: 'verteiler', label: 'Verteiler', art: 'text', halb: true },
        ],
      },
      {
        titel: 'Teilnehmende',
        felder: [
          { schluessel: 'teilnehmende',
            label: 'Teilnehmende (eine Person pro Zeile: Name, Firma, Funktion)',
            art: 'mehrzeilig', zeilen: 4 },
        ],
      },
      {
        titel: 'Traktanden & Beschlüsse',
        tabelle: {
          schluessel: 'traktanden',
          hinzu: '+ Traktandum',
          spalten: [
            { schluessel: 'thema', label: 'Thema', art: 'text' },
            { schluessel: 'besprochenes', label: 'Besprochenes', art: 'mehrzeilig' },
            { schluessel: 'beschluss', label: 'Beschluss', art: 'mehrzeilig' },
            { schluessel: 'wer', label: 'Wer', art: 'text', halb: true },
            { schluessel: 'termin', label: 'Termin', art: 'datum', halb: true },
          ],
        },
      },
      {
        titel: 'Abschluss',
        felder: [
          { schluessel: 'naechsteSitzung', label: 'Nächste Sitzung', art: 'datum', halb: true },
          { schluessel: 'bemerkungen', label: 'Bemerkungen', art: 'mehrzeilig' },
        ],
      },
    ],
    vorlagen: [
      { name: 'Jour fixe',
        werte: { sitzungsart: 'Jour fixe', traktanden: [
          { thema: 'Bautenstand' }, { thema: 'Termine' }, { thema: 'Pendenzen' },
          { thema: 'Nachträge / Regie' }, { thema: 'Verschiedenes' },
        ] } },
      { name: 'Bauführersitzung',
        werte: { sitzungsart: 'Bauführersitzung', traktanden: [
          { thema: 'Arbeitssicherheit' }, { thema: 'Personal & Inventar' },
          { thema: 'Stand Baustellen' }, { thema: 'Termine' }, { thema: 'Verschiedenes' },
        ] } },
    ],
    aktionen: [{ id: 'beschluesse', label: 'Beschlüsse → Pendenzen' }],
  },
  {
    unterTyp: 'test',
    name: 'Testprotokoll',
    unterschriften: ['Erfasser', 'Beteiligter'],
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

// Nebeneinanderliegende halb-Felder paarweise gruppieren.
function gruppiereHalb(liste) {
  const gruppen = [];
  let i = 0;
  while (i < liste.length) {
    if (liste[i].halb && liste[i + 1]?.halb) {
      gruppen.push([liste[i], liste[i + 1]]);
      i += 2;
    } else {
      gruppen.push([liste[i]]);
      i += 1;
    }
  }
  return gruppen;
}

// ---------- Engine: Definition → Formular-HTML ----------

function eingabeHtml(def, wert, attribut) {
  const w = wert ?? '';
  if (def.art === 'mehrzeilig') {
    return `<label>${esc(def.label)}<textarea ${attribut}="${esc(def.schluessel)}"
      rows="${def.zeilen || 2}">${esc(w)}</textarea></label>`;
  }
  if (def.art === 'auswahl') {
    return `<label>${esc(def.label)}<select ${attribut}="${esc(def.schluessel)}">
      ${(def.optionen || []).map((o) => `<option${o === w ? ' selected' : ''}>${esc(o)}</option>`).join('')}
    </select></label>`;
  }
  const typ = def.art === 'datum' ? 'date' : def.art === 'zeit' ? 'time' : 'text';
  return `<label>${esc(def.label)}<input type="${typ}"
    ${attribut}="${esc(def.schluessel)}" value="${esc(w)}" autocomplete="off"></label>`;
}

function felderHtml(felder, werte, attribut) {
  return gruppiereHalb(felder).map((gruppe) => gruppe.length > 1
    ? `<div class="feld-reihe">${gruppe.map((f) => eingabeHtml(f, werte[f.schluessel], attribut)).join('')}</div>`
    : eingabeHtml(gruppe[0], werte[gruppe[0].schluessel], attribut)).join('');
}

function tabellenZeileHtml(tabelle, zeile = {}) {
  return `<div class="tab-block" data-rolle="tab-zeile">
    <div class="tab-block-kopf">
      <strong data-rolle="tab-nr"></strong>
      <button type="button" class="knopf zeile-weg" data-aktion="tab-zeile-entfernen"
        aria-label="Zeile entfernen">×</button>
    </div>
    ${felderHtml(tabelle.spalten, zeile, 'data-spalte')}
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
    inhalt = felderHtml(abschnitt.felder, werte, 'data-schluessel');
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

// ---------- Druckmodell: Definition + Werte → neutrale Druckdaten ----------

function druckModell(typ, protokoll) {
  const werte = protokoll.werte || {};
  const anzeige = (def, wert) => (def.art === 'datum' ? formatTag(wert) : (wert || ''));
  return typ.abschnitte.map((abschnitt) => {
    if (abschnitt.felder) {
      const zeilen = abschnitt.felder
        .map((f) => ({ label: f.label.split(' (')[0], wert: anzeige(f, werte[f.schluessel]) }))
        .filter((z) => z.wert);
      return zeilen.length ? { art: 'felder', titel: abschnitt.titel, zeilen } : null;
    }
    if (abschnitt.tabelle) {
      const zeilen = (werte[abschnitt.tabelle.schluessel] || []).map((zeile) =>
        abschnitt.tabelle.spalten.map((s) => anzeige(s, zeile[s.schluessel])));
      return zeilen.length ? {
        art: 'tabelle', titel: abschnitt.titel,
        spalten: abschnitt.tabelle.spalten.map((s) => s.label), zeilen,
      } : null;
    }
    if (abschnitt.checkliste) {
      const zeilen = (werte[abschnitt.checkliste.schluessel] || [])
        .map((z) => [z.punkt, z.status, z.bemerkung]);
      return zeilen.length ? {
        art: 'tabelle', titel: abschnitt.titel,
        spalten: ['Prüfpunkt', 'Status', 'Bemerkung'], zeilen,
      } : null;
    }
    return null;
  }).filter(Boolean);
}

// ---------- Typ-Aktionen ----------

const AKTIONEN = {
  // Sitzung: jeder Beschluss wird zur Pendenz mit Wer/Termin — genau einmal.
  async beschluesse(protokoll, baustelle) {
    const traktanden = protokoll.werte?.traktanden || [];
    const bestehende = new Set((await abfrage({
      typ: 'pendenz', baustelleId: baustelle.baustelleId,
    })).map((p) => p.protokollRef).filter(Boolean));
    let neu = 0;
    let schonDa = 0;
    for (const [index, t] of traktanden.entries()) {
      if (!t.beschluss) continue;
      const ref = `${protokoll._id}#${index}`;
      if (bestehende.has(ref)) { schonDa++; continue; }
      await put({
        typ: 'pendenz',
        baustelleId: baustelle.baustelleId,
        text: t.thema ? `${t.thema}: ${t.beschluss}` : t.beschluss,
        prioritaet: 'mittel',
        termin: t.termin || '',
        verantwortlich: t.wer || '',
        erledigtAm: '',
        notiz: `Beschluss aus ${protokoll.werte?.sitzungsart || 'Sitzung'} vom ${
          formatTag(protokoll.werte?.datum)}`,
        protokollRef: ref,
      });
      neu++;
    }
    return `${neu} Pendenz${neu === 1 ? '' : 'en'} erstellt${
      schonDa ? `, ${schonDa} bereits vorhanden` : ''}.`;
  },
};

// Kurzfassung fürs Listen-Karteli: erster gefüllter längerer Textwert.
function vorschau(werte) {
  for (const wert of Object.values(werte)) {
    if (typeof wert === 'string' && wert.length > 12 && !/^\d{4}-\d{2}-\d{2}$/.test(wert)) {
      return wert.length > 90 ? `${wert.slice(0, 90)}…` : wert;
    }
  }
  return '';
}

export default {
  name: 'Protokolle',
  dokumentTypen: ['protokoll'],

  render(container, baustelle) {
    const filter = new Set();
    let inBearbeitung = null;
    let aktiverTyp = null;
    const objektUrls = []; // Bild-URLs der Karten, beim Neuzeichnen freigeben

    // Anlege-Auswahl: Typen und ihre Vorlagen als eigene Einträge.
    const anlegeOptionen = PROTOKOLL_TYPEN.flatMap((typ) => (typ.vorlagen?.length
      ? typ.vorlagen.map((v, i) => ({
          wert: `${typ.unterTyp}::${i}`, text: `${typ.name} — ${v.name}`,
        }))
      : [{ wert: typ.unterTyp, text: typ.name }]));

    container.innerHTML = `
      <section class="protokolle">
        <h2>Protokolle · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="karte formular" data-rolle="neu-bereich">
          <label>Protokolltyp
            <select data-rolle="typ-wahl">
              ${anlegeOptionen.map((o) => `<option value="${esc(o.wert)}">${esc(o.text)}</option>`).join('')}
            </select>
          </label>
          <div class="knopfzeile">
            <button type="button" class="knopf knopf-primaer" data-aktion="anlegen">
              Neues Protokoll anlegen
            </button>
          </div>
          <p class="meldung" data-rolle="aktions-meldung" role="status"></p>
        </div>

        <div data-rolle="formular-bereich"></div>

        <div class="chips" data-rolle="filter"></div>
        <div data-rolle="liste"></div>
      </section>`;

    const neuBereich = container.querySelector('[data-rolle="neu-bereich"]');
    const typWahl = container.querySelector('[data-rolle="typ-wahl"]');
    const aktionsMeldung = container.querySelector('[data-rolle="aktions-meldung"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function nummeriereTabellen() {
      for (const tabelle of formularBereich.querySelectorAll('[data-tabelle]')) {
        tabelle.querySelectorAll('[data-rolle="tab-nr"]').forEach((el, i) => {
          el.textContent = `${i + 1}.`;
        });
      }
    }

    function schliesseFormular() {
      inBearbeitung = null;
      aktiverTyp = null;
      formularBereich.innerHTML = '';
      neuBereich.hidden = false;
    }

    function oeffneFormular(typ, protokoll, vorlageWerte) {
      aktiverTyp = typ;
      inBearbeitung = protokoll || null;
      neuBereich.hidden = true;
      const werte = protokoll?.werte
        || { datum: heuteTag(), ...(vorlageWerte || {}) };
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
      nummeriereTabellen();
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
            const titel = typ?.kartenTitel?.(p.werte || {}) || typ?.name || p.unterTyp;
            const kurz = vorschau(p.werte || {});
            const aktionen = (typ?.aktionen || []).map((a) => `
              <button type="button" class="knopf eintrag-loeschen" data-aktion="typ-aktion"
                data-aktion-id="${esc(a.id)}" data-id="${esc(p._id)}">${esc(a.label)}</button>`).join('');
            return `
              <article class="karte protokoll-karte">
                <div class="rapport-kopf">
                  <strong>${esc(titel)}</strong>
                  <span class="hinweis">${formatTag(p.werte?.datum) || formatTag(p.datum)}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                      data-id="${esc(p._id)}">PDF</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                      data-id="${esc(p._id)}">Öffnen</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="handnotiz"
                      data-id="${esc(p._id)}">✍</button>
                    <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                      data-id="${esc(p._id)}" aria-label="Protokoll löschen">Löschen</button>
                  </span>
                </div>
                ${kurz ? `<p class="hinweis">${esc(kurz)}</p>` : ''}
                ${Object.keys(p._attachments || {}).length ? `
                  <div class="foto-reihe">
                    ${Object.keys(p._attachments).map((name) => `
                      <img class="foto-thumb" alt="Handnotiz" loading="lazy"
                        data-id="${esc(p._id)}" data-name="${esc(name)}">`).join('')}
                  </div>` : ''}
                ${aktionen ? `<div class="knopfzeile protokoll-aktionen">${aktionen}</div>` : ''}
              </article>`;
          }).join('')
        : `<p class="hinweis">${
            alle.length ? 'Keine Protokolle zu dieser Auswahl.' : 'Noch keine Protokolle auf dieser Baustelle.'}</p>`;
      objektUrls.forEach(URL.revokeObjectURL);
      objektUrls.length = 0;
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

    container.querySelector('[data-aktion="anlegen"]').addEventListener('click', () => {
      const [unterTyp, vorlagenIndex] = typWahl.value.split('::');
      const typ = typVon(unterTyp);
      if (!typ) return;
      const vorlage = vorlagenIndex !== undefined ? typ.vorlagen?.[Number(vorlagenIndex)] : null;
      // Vorlagen-Werte tief kopieren, damit die Definition unangetastet bleibt.
      oeffneFormular(typ, null, vorlage ? JSON.parse(JSON.stringify(vorlage.werte)) : null);
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
        nummeriereTabellen();
      } else if (aktion === 'tab-zeile-entfernen') {
        knopf.closest('[data-rolle="tab-zeile"]').remove();
        nummeriereTabellen();
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
      const bild = klick.target.closest('.foto-thumb');
      if (bild?.src) {
        zeigeBildVollbild(bild.src, {
          onLoeschen: async () => {
            await entferneAnhang(bild.dataset.id, bild.dataset.name);
            await zeichneListe();
          },
        });
        return;
      }
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const alle = await abfrage({ typ: 'protokoll', baustelleId: baustelle.baustelleId });
      const protokoll = alle.find((p) => p._id === knopf.dataset.id);
      if (!protokoll) return;
      const typ = typVon(protokoll.unterTyp);
      if (knopf.dataset.aktion === 'oeffnen') {
        if (typ) oeffneFormular(typ, protokoll);
      } else if (knopf.dataset.aktion === 'pdf') {
        if (!typ) return;
        const werte = protokoll.werte || {};
        zeigeProtokollDruck(baustelle, {
          titel: typ.kartenTitel?.(werte) || typ.name,
          untertitel: [formatTag(werte.datum), werte.ort, werte.protokollfuehrer]
            .filter(Boolean).join(' · '),
          abschnitte: druckModell(typ, protokoll),
          unterschriften: typ.unterschriften,
        });
      } else if (knopf.dataset.aktion === 'handnotiz') {
        const blob = await oeffneHandnotiz();
        if (!blob) return;
        const klein = await verkleinereFoto(blob);
        await haengeAnhangAn(protokoll._id, `handnotiz-${Date.now().toString(36)}.jpg`, klein);
        await zeichneListe();
      } else if (knopf.dataset.aktion === 'typ-aktion') {
        const handler = AKTIONEN[knopf.dataset.aktionId];
        if (!handler) return;
        aktionsMeldung.textContent = await handler(protokoll, baustelle);
        document.dispatchEvent(new CustomEvent('luense:daten'));
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
