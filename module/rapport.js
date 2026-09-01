// module/rapport.js — Tagesrapporte, drittes Modul der Shell.
// Aufbau nach dem Muster von Tobias' bestehendem Tagesrapport-Tool:
// mehrere Arbeiten pro Rapport; je Arbeit Personen, Maschinen und
// Fremdleistungen mit eigenen Stunden sowie Material mit Menge/Einheit.
// Totale werden live gerechnet. Liste neuste zuerst, gruppiert nach
// Kalenderwoche mit Wochensumme. Dokumenttyp «rapport».

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { exportiereCsv } from '../kern/export.js';
import { zeigeRapportDruck, zeigeWochenDruck } from '../kern/pdf.js';
import { esc, formatDatumZeit, REGIE_MUSTER } from '../kern/ui.js';

const GRUPPEN = [
  { schluessel: 'personen', label: 'Personen (mit Stunden)', hinzu: '+ Person', art: 'stunden', platzhalter: 'Name, z. B. Max' },
  { schluessel: 'maschinen', label: 'Maschinen / Geräte (mit Stunden)', hinzu: '+ Maschine', art: 'stunden', platzhalter: 'z. B. Bagger' },
  { schluessel: 'material', label: 'Material (Menge + Einheit)', hinzu: '+ Material', art: 'menge', platzhalter: 'z. B. Kiessand' },
  { schluessel: 'fremdleistungen', label: 'Fremdleistungen (mit Stunden)', hinzu: '+ Fremdleistung', art: 'stunden', platzhalter: 'z. B. Kran Firma X' },
];

function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

// Regierapporte durchlaufen offen → unterschrieben → verrechnet.
// Jeder Wechsel wird mit Datum protokolliert (Grundlage der Abrechnung).
const REGIE_STATUS = ['offen', 'unterschrieben', 'verrechnet'];

function mitRegieHistorie(rapport, neuerStatus) {
  return {
    ...rapport,
    regieStatus: neuerStatus,
    regieStatusHistorie: [...(rapport.regieStatusHistorie || []),
      { status: neuerStatus, datum: heuteTag() }],
  };
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

// Lokaler Kalendertag eines ISO-Zeitstempels (fürs Verknüpfen mit Ereignissen).
function lokalerTag(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

// Totale eines Rapports — wie im Alt-Tool: Stunden je Gruppe; Material
// wird summiert und trägt die Einheit nur, wenn alle Zeilen dieselbe haben.
function totale(arbeiten) {
  const t = {
    personen: 0, maschinen: 0, fremdleistungen: 0, regie: 0,
    materialSumme: 0, materialEinheiten: new Set(),
  };
  for (const arbeit of arbeiten || []) {
    let arbeitStunden = 0;
    for (const p of arbeit.personen || []) { t.personen += zahl(p.stunden); arbeitStunden += zahl(p.stunden); }
    for (const m of arbeit.maschinen || []) { t.maschinen += zahl(m.stunden); arbeitStunden += zahl(m.stunden); }
    for (const f of arbeit.fremdleistungen || []) { t.fremdleistungen += zahl(f.stunden); arbeitStunden += zahl(f.stunden); }
    // Regie-Arbeit: alle ihre Stunden zählen als Regie.
    if (arbeit.regie) t.regie += arbeitStunden;
    for (const m of arbeit.material || []) {
      t.materialSumme += zahl(m.menge);
      if ((m.einheit || '').trim()) t.materialEinheiten.add(m.einheit.trim());
    }
  }
  t.materialText = `${Math.round(t.materialSumme * 100) / 100}${
    t.materialEinheiten.size === 1 ? ' ' + [...t.materialEinheiten][0] : ''}`;
  return t;
}

export default {
  name: 'Rapporte',
  dokumentTypen: ['rapport'],

  render(container, baustelle) {
    let inBearbeitung = null; // Rapport-Dokument, das gerade im Formular steht
    let letzteGruppen = new Map(); // KW-Gruppen der letzten Listen-Zeichnung

    container.innerHTML = `
      <section class="rapporte">
        <h2>Rapporte · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <h3 data-rolle="formular-titel">Neuer Tagesrapport</h3>
          <div class="feld-reihe">
            <label>Datum *<input type="date" name="tag" required></label>
            <label>Mitarbeiter<input name="mitarbeiter" autocomplete="off"
              placeholder="z. B. Tobias"></label>
          </div>
          <label>Wetter<input name="wetter" autocomplete="off"
            placeholder="z. B. sonnig, 18 °C"></label>

          <div data-rolle="arbeiten"></div>
          <button type="button" class="knopf" data-aktion="arbeit-hinzu">
            + Arbeit hinzufügen
          </button>

          <label>Bemerkungen<textarea name="bemerkungen" rows="2"></textarea></label>

          <div class="rapport-totale" data-rolle="totale"></div>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rapport speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="knopfzeile">
          <button type="button" class="knopf" data-aktion="regie-export"
            title="Alle Regierapporte dieser Baustelle — öffnet direkt in Excel">
            Excel-Export Regierapporte</button>
        </div>
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const formularTitel = formular.querySelector('[data-rolle="formular-titel"]');
    const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
    const meldung = formular.querySelector('.meldung');
    const arbeitenElement = formular.querySelector('[data-rolle="arbeiten"]');
    const totaleElement = formular.querySelector('[data-rolle="totale"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    // ---------- Formular-Aufbau ----------

    function zeileHtml(gruppe, daten = {}) {
      const felder = gruppe.art === 'menge'
        ? `<input data-feld="name" class="zeile-name" placeholder="${gruppe.platzhalter}"
             autocomplete="off" value="${esc(daten.name ?? '')}">
           <input data-feld="menge" class="zeile-zahl" type="number" inputmode="decimal"
             step="any" min="0" placeholder="Menge" value="${esc(daten.menge ?? '')}">
           <input data-feld="einheit" class="zeile-einheit" placeholder="Einheit"
             autocomplete="off" value="${esc(daten.einheit ?? '')}">`
        : `<input data-feld="name" class="zeile-name" placeholder="${gruppe.platzhalter}"
             autocomplete="off" value="${esc(daten.name ?? '')}">
           <input data-feld="stunden" class="zeile-zahl" type="number" inputmode="decimal"
             step="0.25" min="0" placeholder="Std." value="${esc(daten.stunden ?? '')}">`;
      return `<div class="rapport-zeile" data-rolle="zeile">${felder}
        <button type="button" class="knopf zeile-weg" data-aktion="zeile-entfernen"
          aria-label="Zeile entfernen">×</button></div>`;
    }

    function arbeitHtml(daten = {}) {
      return `
        <div class="arbeit" data-rolle="arbeit">
          <div class="arbeit-kopf">
            <strong data-rolle="arbeit-nr"></strong>
            <label class="chip-wahl regie-schalter">
              <input type="checkbox" data-feld="regie" ${daten.regie ? 'checked' : ''}>
              <span>Regie</span>
            </label>
            <button type="button" class="knopf eintrag-loeschen"
              data-aktion="arbeit-entfernen">Entfernen</button>
          </div>
          <label>Was wurde gemacht?<textarea data-feld="text" rows="2"
            placeholder="z. B. Werkleitungsgraben Etappe 2 ausgehoben">${esc(daten.text ?? '')}</textarea></label>
          ${GRUPPEN.map((gruppe) => `
            <div class="gruppe" data-gruppe="${gruppe.schluessel}">
              <p class="gruppen-label">${gruppe.label}</p>
              <div data-rolle="zeilen">${
                (daten[gruppe.schluessel]?.length ? daten[gruppe.schluessel] : [{}])
                  .map((zeile) => zeileHtml(gruppe, zeile)).join('')}</div>
              <button type="button" class="knopf zeile-hinzu" data-aktion="zeile-hinzu"
                data-gruppe="${gruppe.schluessel}">${gruppe.hinzu}</button>
            </div>`).join('')}
        </div>`;
    }

    function nummeriereArbeiten() {
      formular.querySelectorAll('[data-rolle="arbeit-nr"]').forEach((el, i) => {
        el.textContent = `Arbeit ${i + 1}`;
      });
    }

    function sammleArbeiten() {
      return [...arbeitenElement.querySelectorAll('[data-rolle="arbeit"]')].map((block) => {
        const arbeit = {
          text: block.querySelector('[data-feld="text"]').value.trim(),
          regie: block.querySelector('[data-feld="regie"]').checked,
        };
        for (const gruppe of GRUPPEN) {
          arbeit[gruppe.schluessel] = [...block.querySelectorAll(
            `[data-gruppe="${gruppe.schluessel}"] [data-rolle="zeile"]`)].map((zeile) => {
            const wert = (feld) => zeile.querySelector(`[data-feld="${feld}"]`)?.value.trim() ?? '';
            return gruppe.art === 'menge'
              ? { name: wert('name'), menge: wert('menge'), einheit: wert('einheit') }
              : { name: wert('name'), stunden: wert('stunden') };
          }).filter((zeile) => Object.values(zeile).some(Boolean));
        }
        return arbeit;
      }).filter((arbeit) =>
        arbeit.text || GRUPPEN.some((g) => arbeit[g.schluessel].length));
    }

    function zeigeTotale() {
      const t = totale(sammleArbeiten());
      totaleElement.innerHTML = `
        <div><span>Total Personal</span><span>${stundenText(t.personen)}</span></div>
        <div><span>Total Maschinen</span><span>${stundenText(t.maschinen)}</span></div>
        <div><span>Total Material</span><span>${t.materialText}</span></div>
        <div><span>Total Fremdleistungen</span><span>${stundenText(t.fremdleistungen)}</span></div>
        <div class="regie-total"><span>davon Regie</span><span>${stundenText(t.regie)}</span></div>`;
    }

    function fuelleFormular(rapport) {
      inBearbeitung = rapport;
      formularTitel.textContent = rapport
        ? `Rapport vom ${formatTag(rapport.tag)} bearbeiten`
        : 'Neuer Tagesrapport';
      abbrechenKnopf.hidden = !rapport;
      formular.elements.tag.value = rapport?.tag ?? heuteTag();
      formular.elements.mitarbeiter.value = rapport?.mitarbeiter ?? '';
      formular.elements.wetter.value = rapport?.wetter ?? '';
      formular.elements.bemerkungen.value = rapport?.bemerkungen ?? '';
      const arbeiten = rapport?.arbeiten?.length ? rapport.arbeiten : [{}];
      arbeitenElement.innerHTML = arbeiten.map((a) => arbeitHtml(a)).join('');
      nummeriereArbeiten();
      zeigeTotale();
      meldung.textContent = '';
    }

    // ---------- Liste ----------

    function gruppenText(liste, mitStunden) {
      return liste.map((z) => {
        const wert = mitStunden
          ? (String(z.stunden).trim() ? ` ${stundenText(zahl(z.stunden))}` : '')
          : ([z.menge, z.einheit].filter(Boolean).join(' ') ? ` ${[z.menge, z.einheit].filter(Boolean).join(' ')}` : '');
        return `${esc(z.name || '—')}${wert}`;
      }).join(', ');
    }

    function rapportKarte(r, regieEreignisse, nachtraege) {
      const t = totale(r.arbeiten);
      const mitRegie = zahl(r.davonRegie) > 0;
      const verknuepfte = mitRegie
        ? regieEreignisse.filter((e) => lokalerTag(e.datum) === r.tag)
        : [];
      const zugeordnet = nachtraege
        .filter((n) => n.beweise?.rapportIds?.includes(r._id))
        .map((n) => n.nummer);
      return `
        <article class="karte rapport${mitRegie ? ' mit-regie' : ''}">
          <div class="rapport-kopf">
            <strong>${formatTag(r.tag)}</strong>
            <span class="rapport-stunden">${stundenText(t.personen)}${
              zahl(r.davonRegie) ? ` · <span class="regie-anteil">Regie ${stundenText(zahl(r.davonRegie))}</span>` : ''}</span>
            <span class="rapport-knoepfe">
              ${mitRegie ? `
                <button type="button" class="knopf eintrag-loeschen" data-aktion="nachtrag-zu"
                  data-id="${esc(r._id)}">Nachtrag…</button>` : ''}
              <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                data-id="${esc(r._id)}">PDF</button>
              <button type="button" class="knopf eintrag-loeschen" data-aktion="bearbeiten"
                data-id="${esc(r._id)}">Bearbeiten</button>
              <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                data-id="${esc(r._id)}" aria-label="Rapport löschen">Löschen</button>
            </span>
          </div>
          ${[r.mitarbeiter ? esc(r.mitarbeiter) : '', r.wetter ? esc(r.wetter) : '']
            .filter(Boolean).length
            ? `<p class="hinweis">${[r.mitarbeiter, r.wetter].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
          ${(r.arbeiten || []).map((arbeit, i) => `
            <div class="rapport-arbeit">
              <p class="arbeit-titel">${i + 1}. ${esc(arbeit.text || '—')}${
                arbeit.regie ? ' <span class="chip regie-chip">Regie</span>' : ''}</p>
              ${arbeit.personen?.length ? `<p class="hinweis">Personen: ${gruppenText(arbeit.personen, true)}</p>` : ''}
              ${arbeit.maschinen?.length ? `<p class="hinweis">Maschinen: ${gruppenText(arbeit.maschinen, true)}</p>` : ''}
              ${arbeit.material?.length ? `<p class="hinweis">Material: ${gruppenText(arbeit.material, false)}</p>` : ''}
              ${arbeit.fremdleistungen?.length ? `<p class="hinweis">Fremdleistungen: ${gruppenText(arbeit.fremdleistungen, true)}</p>` : ''}
            </div>`).join('')}
          ${r.bemerkungen ? `<p class="hinweis">Bemerkungen: ${esc(r.bemerkungen)}</p>` : ''}
          ${mitRegie ? `
            <p class="hinweis verknuepfung">↳ Regie-Ereignisse im Journal am ${formatTag(r.tag)}: ${
              verknuepfte.length
                ? verknuepfte.map((e) => `${formatDatumZeit(e.datum).split(', ')[1] || ''}${
                    e.ortKv ? ' ' + esc(e.ortKv) : ''}`.trim()).join(', ')
                : 'keine erfasst'}</p>` : ''}
          ${zugeordnet.length ? `
            <p class="hinweis verknuepfung">↳ Zugeordnet: Nachtrag ${zugeordnet.map(esc).join(', ')}</p>` : ''}
          ${mitRegie ? regieStatusHtml(r) : ''}
        </article>`;
    }

    // Status-Pipeline des Regierapports mit datiertem Verlauf und
    // weiter/zurück — analog zur Nachtrags-Pipeline.
    function regieStatusHtml(r) {
      const status = r.regieStatus || 'offen';
      const index = REGIE_STATUS.indexOf(status);
      const naechster = REGIE_STATUS[index + 1];
      return `
        <div class="status-pipeline">
          ${REGIE_STATUS.map((s, i) => `<span class="pipeline-schritt${
            i < index ? ' erledigt' : ''}${i === index ? ' aktuell' : ''}">${s}</span>`)
            .join('<span class="pipeline-pfeil">→</span>')}
        </div>
        ${r.regieStatusHistorie?.length ? `
          <p class="hinweis">${r.regieStatusHistorie
            .map((h) => `${esc(h.status)} ${h.datum.split('-').reverse().join('.')}`)
            .join(' → ')}</p>` : ''}
        <div class="knopfzeile">
          ${naechster ? `
            <button type="button" class="knopf" data-aktion="regie-weiter"
              data-id="${esc(r._id)}">Status → ${naechster}</button>` : ''}
          ${index > 0 ? `
            <button type="button" class="knopf" data-aktion="regie-zurueck"
              data-id="${esc(r._id)}">← zurück</button>` : ''}
        </div>`;
    }

    async function zeichneListe() {
      const alle = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
      // Bestehende Regierapporte ohne Verlauf bekommen beim ersten Öffnen
      // einen Startpunkt mit heutigem Datum (Rückwirkung Abend 8.2).
      for (const r of alle) {
        if (zahl(r.davonRegie) > 0 && !r.regieStatusHistorie?.length) {
          r.regieStatus = r.regieStatus || 'offen';
          r.regieStatusHistorie = [{ status: r.regieStatus, datum: heuteTag() }];
          const gespeichert = await put(r);
          r._rev = gespeichert._rev;
        }
      }
      if (!alle.length) {
        listeElement.innerHTML =
          '<p class="hinweis">Noch keine Rapporte auf dieser Baustelle.</p>';
        return;
      }
      // Verweis auf Journal-Ereignisse desselben Tages mit Tag «Regie» —
      // dynamisch nachgeschlagen, nicht kopiert (Dokumente teilen, nie Code).
      const regieEreignisse = (await abfrage({
        typ: 'ereignis', baustelleId: baustelle.baustelleId,
      })).filter((e) => e.tag === 'Regie');
      const nachtraege = await abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId });
      const gruppen = new Map();
      for (const r of alle) {
        const { jahr, kw } = kalenderwoche(r.tag);
        const schluessel = `${jahr}-KW${String(kw).padStart(2, '0')}`;
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { kw, rapporte: [] });
        gruppen.get(schluessel).rapporte.push(r);
      }
      letzteGruppen = gruppen;
      listeElement.innerHTML = [...gruppen.entries()].map(([schluessel, gruppe]) => {
        const personal = gruppe.rapporte.reduce((s, r) => s + totale(r.arbeiten).personen, 0);
        const regie = gruppe.rapporte.reduce((s, r) => s + zahl(r.davonRegie), 0);
        return `
          <div class="wochen-titel">
            <span>KW ${gruppe.kw} · Personal ${stundenText(personal)}${
              regie ? ` · Regie ${stundenText(regie)}` : ''}</span>
            <button type="button" class="knopf eintrag-loeschen" data-aktion="woche-pdf"
              data-schluessel="${schluessel}">Wochen-PDF</button>
          </div>
          ${gruppe.rapporte.map((r) => rapportKarte(r, regieEreignisse, nachtraege)).join('')}`;
      }).join('');
    }

    // Regie-Rapport einem oder mehreren Nachträgen zuordnen — schreibt
    // die rapportId in deren Beweisliste (Dokumente teilen, nie Code).
    async function oeffneNachtragZuordnung(rapport) {
      const nachtraege = await abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId });
      if (!nachtraege.length) {
        alert('Noch keine Nachträge auf dieser Baustelle — zuerst im Nachträge-Tab anlegen.');
        return;
      }
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <form class="karte formular dialog" data-rolle="zuordnung">
          <h3>Rapport vom ${formatTag(rapport.tag)} zuordnen</h3>
          <div class="beweis-liste">
            ${nachtraege.map((n) => `
              <label class="beweis-zeile">
                <input type="checkbox" value="${esc(n._id)}"
                  ${n.beweise?.rapportIds?.includes(rapport._id) ? 'checked' : ''}>
                <span>${esc(n.nummer)} · ${esc(n.titel)} (${esc(n.status)})</span>
              </label>`).join('')}
          </div>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Zuordnen</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
        </form>`;
      document.body.append(dialog);
      dialog.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => dialog.remove());
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog) dialog.remove();
      });
      dialog.querySelector('form').addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const gewaehlt = new Set([...dialog.querySelectorAll('input:checked')].map((b) => b.value));
        for (const n of nachtraege) {
          const ids = new Set(n.beweise?.rapportIds || []);
          const soll = gewaehlt.has(n._id);
          if (soll === ids.has(rapport._id)) continue;
          soll ? ids.add(rapport._id) : ids.delete(rapport._id);
          await put({
            ...n,
            beweise: { ereignisIds: [], ausmassIds: [], ...n.beweise, rapportIds: [...ids] },
          });
        }
        dialog.remove();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      });
    }

    // ---------- Ereignisse ----------

    formular.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'arbeit-hinzu') {
        arbeitenElement.insertAdjacentHTML('beforeend', arbeitHtml());
        nummeriereArbeiten();
      } else if (aktion === 'arbeit-entfernen') {
        knopf.closest('[data-rolle="arbeit"]').remove();
        if (!arbeitenElement.querySelector('[data-rolle="arbeit"]')) {
          arbeitenElement.innerHTML = arbeitHtml();
        }
        nummeriereArbeiten();
        zeigeTotale();
      } else if (aktion === 'zeile-hinzu') {
        const gruppe = GRUPPEN.find((g) => g.schluessel === knopf.dataset.gruppe);
        knopf.closest('.gruppe').querySelector('[data-rolle="zeilen"]')
          .insertAdjacentHTML('beforeend', zeileHtml(gruppe));
      } else if (aktion === 'zeile-entfernen') {
        const zeilen = knopf.closest('[data-rolle="zeilen"]');
        knopf.closest('[data-rolle="zeile"]').remove();
        if (!zeilen.querySelector('[data-rolle="zeile"]')) {
          const gruppe = GRUPPEN.find((g) => g.schluessel === zeilen.closest('.gruppe').dataset.gruppe);
          zeilen.insertAdjacentHTML('beforeend', zeileHtml(gruppe));
        }
        zeigeTotale();
      } else if (aktion === 'abbrechen') {
        fuelleFormular(null);
      }
    });

    formular.addEventListener('input', (eingabe) => {
      const ziel = eingabe.target;
      if (ziel.matches('[data-feld="regie"]')) {
        // Von Hand gesetzt oder entfernt — die Automatik mischt sich
        // bei dieser Arbeit nicht mehr ein.
        ziel.dataset.manuell = '1';
      } else if (ziel.matches('[data-feld="text"]')) {
        // Deutet der Arbeitstext auf Regie hin, wird das Häkchen vorgeschlagen.
        const schalter = ziel.closest('[data-rolle="arbeit"]')
          .querySelector('[data-feld="regie"]');
        if (REGIE_MUSTER.test(ziel.value) && !schalter.dataset.manuell && !schalter.checked) {
          schalter.checked = true;
        }
      }
      zeigeTotale();
    });

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      if (knopf.dataset.aktion === 'woche-pdf') {
        const gruppe = letzteGruppen.get(knopf.dataset.schluessel);
        if (!gruppe) return;
        // Wochenbereich Mo–So aus einem beliebigen Tag der Gruppe ableiten.
        const irgendein = new Date(`${gruppe.rapporte[0].tag}T12:00:00`);
        const montag = new Date(irgendein);
        montag.setDate(irgendein.getDate() - ((irgendein.getDay() + 6) % 7));
        const sonntag = new Date(montag);
        sonntag.setDate(montag.getDate() + 6);
        const chronologisch = gruppe.rapporte.slice().reverse();
        const zeilen = chronologisch.map((r) => {
          const t = totale(r.arbeiten);
          return {
            tagText: formatTag(r.tag),
            mitarbeiter: r.mitarbeiter || '',
            arbeitenText: (r.arbeiten || []).map((a) => a.text).filter(Boolean).join('; ') || '—',
            personen: t.personen,
            maschinen: t.maschinen,
            fremdleistungen: t.fremdleistungen,
            regie: zahl(r.davonRegie),
          };
        });
        const summen = zeilen.reduce((s, z) => ({
          personen: s.personen + z.personen,
          maschinen: s.maschinen + z.maschinen,
          fremdleistungen: s.fremdleistungen + z.fremdleistungen,
          regie: s.regie + z.regie,
        }), { personen: 0, maschinen: 0, fremdleistungen: 0, regie: 0 });
        zeigeWochenDruck(baustelle, {
          kw: gruppe.kw,
          von: montag.toLocaleDateString('de-CH'),
          bis: sonntag.toLocaleDateString('de-CH'),
          zeilen,
          summen,
        });
        return;
      }
      const alle = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
      const rapport = alle.find((r) => r._id === knopf.dataset.id);
      if (!rapport) return;
      if (knopf.dataset.aktion === 'nachtrag-zu') {
        oeffneNachtragZuordnung(rapport);
      } else if (knopf.dataset.aktion === 'regie-weiter') {
        const naechster = REGIE_STATUS[REGIE_STATUS.indexOf(rapport.regieStatus || 'offen') + 1];
        if (!naechster) return;
        await put(mitRegieHistorie(rapport, naechster));
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } else if (knopf.dataset.aktion === 'regie-zurueck') {
        // Für Fehlklicks: ein Schritt zurück, ebenfalls mit Datumsstempel.
        const vorheriger = REGIE_STATUS[REGIE_STATUS.indexOf(rapport.regieStatus || 'offen') - 1];
        if (!vorheriger) return;
        await put(mitRegieHistorie(rapport, vorheriger));
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } else if (knopf.dataset.aktion === 'pdf') {
        zeigeRapportDruck(baustelle, rapport, totale(rapport.arbeiten));
      } else if (knopf.dataset.aktion === 'bearbeiten') {
        fuelleFormular(rapport);
        formular.scrollIntoView({ behavior: 'smooth' });
      } else if (knopf.dataset.aktion === 'loeschen') {
        if (!confirm('Diesen Rapport endgültig löschen?')) return;
        await entferneDokument(rapport._id);
        if (inBearbeitung?._id === rapport._id) fuelleFormular(null);
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      }
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const arbeiten = sammleArbeiten();
      if (!arbeiten.length) {
        meldung.textContent = 'Mindestens eine Arbeit erfassen.';
        return;
      }
      try {
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'rapport', baustelleId: baustelle.baustelleId };
        const gespeichert = await put({
          ...basis,
          tag: formular.elements.tag.value,
          datum: `${formular.elements.tag.value}T12:00:00.000Z`,
          mitarbeiter: formular.elements.mitarbeiter.value.trim(),
          wetter: formular.elements.wetter.value.trim(),
          davonRegie: totale(arbeiten).regie, // aus den Regie-Arbeiten gerechnet
          bemerkungen: formular.elements.bemerkungen.value.trim(),
          arbeiten,
        });
        // Regie-Stunden > 0: Pendenz «Regierapport unterschreiben lassen»
        // automatisch erzeugen — genau einmal pro Rapport.
        let pendenzErstellt = false;
        if (gespeichert.davonRegie > 0) {
          const schonDa = (await abfrage({
            typ: 'pendenz', baustelleId: baustelle.baustelleId,
          })).some((p) => p.rapportId === gespeichert._id);
          if (!schonDa) {
            await put({
              typ: 'pendenz',
              baustelleId: baustelle.baustelleId,
              text: 'Regierapport unterschreiben lassen',
              prioritaet: 'hoch',
              termin: '',
              verantwortlich: '',
              erledigtAm: '',
              notiz: `Aus Tagesrapport vom ${formatTag(gespeichert.tag)} `
                + `(Regie ${stundenText(gespeichert.davonRegie)})`,
              rapportId: gespeichert._id,
            });
            pendenzErstellt = true;
          }
        }
        fuelleFormular(null);
        meldung.textContent = pendenzErstellt
          ? 'Rapport gespeichert — Pendenz «Regierapport unterschreiben lassen» erstellt.'
          : 'Rapport gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    container.querySelector('[data-aktion="regie-export"]')
      .addEventListener('click', async () => {
        const alle = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
        const regie = alle.filter((r) => zahl(r.davonRegie) > 0).slice().reverse();
        exportiereCsv(
          `luense-regierapporte-${baustelle.ktr}.csv`,
          ['Datum', 'Mitarbeiter', 'Arbeiten', 'Personal h', 'Maschinen h',
            'Fremdleistungen h', 'davon Regie h', 'Status', 'Statusverlauf'],
          regie.map((r) => {
            const t = totale(r.arbeiten);
            return [r.tag.split('-').reverse().join('.'), r.mitarbeiter || '',
              (r.arbeiten || []).map((a) => a.text).filter(Boolean).join('; '),
              t.personen, t.maschinen, t.fremdleistungen, zahl(r.davonRegie),
              r.regieStatus || 'offen',
              (r.regieStatusHistorie || [])
                .map((h) => `${h.status} ${h.datum.split('-').reverse().join('.')}`).join(' → ')];
          }),
        );
      });

    fuelleFormular(null);
    zeichneListe();
  },
};
