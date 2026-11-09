// module/rapport.js — Tagesrapporte, drittes Modul der Shell.
// Aufbau nach dem Muster von Tobias' bestehendem Tagesrapport-Tool:
// mehrere Arbeiten pro Rapport; je Arbeit Personen, Maschinen und
// Fremdleistungen mit eigenen Stunden sowie Material mit Menge/Einheit.
// Totale werden live gerechnet. Liste neuste zuerst, gruppiert nach
// Kalenderwoche mit Wochensumme. Dokumenttyp «rapport».

import {
  put, abfrage, entferneDokument, haengeAnhangAn, holeAnhang, holeMitAnhaengen,
  entferneAnhang,
} from '../kern/speicher.js';
import { erstelleRechnung, nachtraegeMitVerrechnung } from '../kern/rechnung.js';
import { exportiereCsv, teileDatei } from '../kern/export.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { zeigeRapportDruck, zeigeWochenDruck } from '../kern/pdf.js';
import {
  esc, formatDatumZeit, regieTreffer, regieHinweiseRapport, schadenTreffer, zeigeBildVollbild,
} from '../kern/ui.js';

// Absenzarten nach LMV — zählen im Stundenkonto als Sollerfüllung.
const ABSENZ_ARTEN = ['Ferien', 'Krankheit', 'Unfall', 'Schlechtwetter', 'Schule', 'Militär/ZS'];

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

// Unterschriebene/verrechnete Regierapporte ändert die Automatik nie —
// dort wird ein Regie-Hinweis nur angezeigt.
function istUnterschrieben(rapport) {
  return ['unterschrieben', 'verrechnet'].includes(rapport?.regieStatus);
}

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

          <div class="gruppe team-bereich">
            <p class="gruppen-label">Team des Tages — antippen, wer dabei war</p>
            <div class="chips" data-rolle="team-chips"></div>
            <div class="feld-reihe">
              <label>Weitere Person (temporär/fremd)<input data-rolle="team-eigen"
                autocomplete="off" placeholder="z. B. Temporär Luigi"></label>
              <button type="button" class="knopf zeile-hinzu" data-aktion="team-hinzu">+ dazu</button>
            </div>
          </div>

          <div data-rolle="arbeiten"></div>
          <button type="button" class="knopf" data-aktion="arbeit-hinzu">
            + Arbeit/Vorgang hinzufügen
          </button>

          <label class="knopf">
            📷 Foto / Lieferschein anhängen
            <input type="file" accept="image/*" multiple
              data-rolle="rapport-foto" class="visually-hidden">
          </label>
          <p class="hinweis" data-rolle="foto-hinweis">Noch kein Foto gewählt.</p>

          <details class="absenz-bereich" data-rolle="absenz-bereich">
            <summary>Absenzen & Reisezeit (LMV)</summary>
            <div class="gruppe">
              <p class="gruppen-label">Absenzen (zählen als Sollerfüllung)</p>
              <div data-rolle="absenz-zeilen"></div>
              <button type="button" class="knopf zeile-hinzu" data-aktion="absenz-hinzu">+ Absenz</button>
            </div>
            <div class="gruppe">
              <p class="gruppen-label">Reisezeit (separat vom Stundenkonto, LMV Art. Reisezeit)</p>
              <div data-rolle="reise-zeilen"></div>
              <button type="button" class="knopf zeile-hinzu" data-aktion="reise-hinzu">+ Reisezeit</button>
            </div>
          </details>

          <label>Bemerkungen<textarea name="bemerkungen" rows="2"></textarea></label>
          <p class="regie-erkannt" data-rolle="bemerkung-regie" role="status" hidden></p>

          <div class="rapport-totale" data-rolle="totale"></div>
          <div class="regie-pruefung" data-rolle="regie-pruefung" role="alert" hidden></div>
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

    formular.querySelector('[data-rolle="rapport-foto"]').addEventListener('change', (wechsel) => {
      formular.querySelector('[data-rolle="foto-hinweis"]').textContent =
        wechsel.target.files.length
          ? `${wechsel.target.files.length} Foto${wechsel.target.files.length > 1 ? 's' : ''} gewählt.`
          : 'Noch kein Foto gewählt.';
    });

    // ---------- Formular-Aufbau (Eingabe nach Sorba-Prinzip) ----------
    // Team einmal pro Tag antippen (aus dem Personal-Stamm), dann je
    // Arbeit/Vorgang die Stunden pro Person in der Matrix eintragen —
    // die Kontrollzeile zählt das Tagestotal je Mitarbeiter zusammen.
    // Maschinen kommen aus dem Gerätestamm (Personal-Modul), ebenfalls
    // als Antipp-Matrix. Das GESPEICHERTE Dokument bleibt unverändert
    // (arbeiten mit personen/maschinen/material/fremdleistungen).

    let team = []; // Namen des Tages (Stamm + von Hand ergänzte)
    let mitarbeiterStamm = []; // aktive Namen aus dem Personal-Stamm
    let geraeteStamm = []; // aktive Gerätenamen aus dem Stamm

    async function ladeStaemme() {
      const [mitarbeiter, geraete] = await Promise.all([
        abfrage({ typ: 'mitarbeiter', baustelleId: 'personal' }),
        abfrage({ typ: 'geraet', baustelleId: 'personal' }),
      ]);
      mitarbeiterStamm = mitarbeiter.filter((m) => !m.archiviert)
        .map((m) => m.name).sort((a, b) => a.localeCompare(b, 'de-CH'));
      geraeteStamm = geraete.filter((g) => !g.archiviert)
        .map((g) => g.name).sort((a, b) => a.localeCompare(b, 'de-CH'));
    }

    function zeichneTeamChips() {
      const alleNamen = [...new Set([...mitarbeiterStamm, ...team])];
      formular.querySelector('[data-rolle="team-chips"]').innerHTML = alleNamen.length
        ? alleNamen.map((name) => `
            <label class="chip-wahl">
              <input type="checkbox" data-team-chip value="${esc(name)}"
                ${team.includes(name) ? 'checked' : ''}>
              <span>${esc(name)}</span>
            </label>`).join('')
        : '<p class="hinweis">Noch keine Mitarbeiter im Personal-Stamm — unten von Hand ergänzen.</p>';
    }

    // Matrix-Zellen: eine Stunden-Eingabe je Name (Personen oder Geräte).
    function matrixHtml(artKlasse, datenAttr, namen, werte) {
      if (!namen.length) {
        return `<p class="hinweis">${artKlasse === 'personen'
          ? 'Zuerst oben das Team antippen.' : 'Kein Gerät im Stamm — Zeile unten nutzen.'}</p>`;
      }
      return `<div class="stunden-matrix">${namen.map((name) => `
        <label class="matrix-zelle">
          <span>${esc(name)}</span>
          <input type="number" inputmode="decimal" step="0.25" min="0" placeholder="Std."
            ${datenAttr}="${esc(name)}" value="${esc(werte?.[name] ?? '')}">
        </label>`).join('')}</div>`;
    }

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
      // Personen-Stunden als Matrix (Werte aus dem Dokument je Name),
      // Geräte aus dem Stamm ebenso; unbekannte Maschinen und alles
      // Übrige als klassische Zeilen.
      const personenWerte = Object.fromEntries(
        (daten.personen || []).map((p) => [p.name, p.stunden]));
      const geraeteWerte = Object.fromEntries(
        (daten.maschinen || []).filter((m) => geraeteStamm.includes(m.name))
          .map((m) => [m.name, m.stunden]));
      const fremdeMaschinen = (daten.maschinen || [])
        .filter((m) => !geraeteStamm.includes(m.name));
      const material = daten.material || [];
      const fremdleistungen = daten.fremdleistungen || [];
      return `
        <div class="arbeit" data-rolle="arbeit">
          <div class="arbeit-kopf">
            <strong data-rolle="arbeit-nr"></strong>
            <label class="chip-wahl regie-schalter">
              <input type="checkbox" data-feld="regie" ${daten.regie ? 'checked' : ''}
                ${daten.regieManuell ? 'data-manuell="1"' : ''}>
              <span>Regie</span>
            </label>
            <button type="button" class="knopf eintrag-loeschen"
              data-aktion="arbeit-entfernen">Entfernen</button>
          </div>
          <p class="regie-erkannt" data-rolle="regie-erkannt" role="status" hidden></p>
          <label>Was wurde gemacht?<textarea data-feld="text" rows="2"
            placeholder="z. B. Werkleitungsgraben Etappe 2 ausgehoben">${esc(daten.text ?? '')}</textarea></label>

          <div class="gruppe" data-gruppe="personen">
            <p class="gruppen-label">Stunden je Mitarbeiter</p>
            <div data-rolle="personen-matrix">${matrixHtml('personen', 'data-person', team, personenWerte)}</div>
          </div>

          <div class="gruppe" data-gruppe="geraete">
            <p class="gruppen-label">Maschinen / Geräte (mit Stunden)</p>
            <div data-rolle="geraete-matrix">${matrixHtml('geraete', 'data-geraet', geraeteStamm, geraeteWerte)}</div>
            <div data-rolle="zeilen" data-gruppe-zeilen="maschinen">${
              fremdeMaschinen.map((zeile) => zeileHtml(GRUPPEN[1], zeile)).join('')}</div>
            <button type="button" class="knopf zeile-hinzu" data-aktion="zeile-hinzu"
              data-gruppe="maschinen">+ Maschine (ohne Stamm)</button>
          </div>

          <div class="gruppe" data-gruppe="material">
            <p class="gruppen-label">Material (Menge + Einheit)</p>
            <div data-rolle="zeilen" data-gruppe-zeilen="material">${
              (material.length ? material : [{}]).map((zeile) => zeileHtml(GRUPPEN[2], zeile)).join('')}</div>
            <button type="button" class="knopf zeile-hinzu" data-aktion="zeile-hinzu"
              data-gruppe="material">+ Material</button>
          </div>

          <div class="gruppe" data-gruppe="fremdleistungen">
            <p class="gruppen-label">Fremdleistungen (mit Stunden)</p>
            <div data-rolle="zeilen" data-gruppe-zeilen="fremdleistungen">${
              fremdleistungen.map((zeile) => zeileHtml(GRUPPEN[3], zeile)).join('')}</div>
            <button type="button" class="knopf zeile-hinzu" data-aktion="zeile-hinzu"
              data-gruppe="fremdleistungen">+ Fremdleistung</button>
          </div>
        </div>`;
    }

    function nummeriereArbeiten() {
      formular.querySelectorAll('[data-rolle="arbeit-nr"]').forEach((el, i) => {
        el.textContent = `Arbeit ${i + 1}`;
      });
    }

    function sammleArbeiten() {
      return [...arbeitenElement.querySelectorAll('[data-rolle="arbeit"]')].map(arbeitAusBlock)
        .filter((arbeit) => arbeit.text || GRUPPEN.some((g) => arbeit[g.schluessel].length));
    }

    function arbeitAusBlock(block) {
      const zeilen = (schluessel, art) => [...block.querySelectorAll(
        `[data-gruppe-zeilen="${schluessel}"] [data-rolle="zeile"]`)].map((zeile) => {
        const wert = (feld) => zeile.querySelector(`[data-feld="${feld}"]`)?.value.trim() ?? '';
        return art === 'menge'
          ? { name: wert('name'), menge: wert('menge'), einheit: wert('einheit') }
          : { name: wert('name'), stunden: wert('stunden') };
      }).filter((zeile) => Object.values(zeile).some(Boolean));
      // Matrix: nur Zellen mit Stunden werden zu Zeilen — das Dokument
      // behält exakt die bisherige Struktur.
      const matrix = (attr) => [...block.querySelectorAll(`[${attr}]`)]
        .map((feld) => ({ name: feld.getAttribute(attr), stunden: feld.value.trim() }))
        .filter((zeile) => zahl(zeile.stunden) > 0);
      const schalter = block.querySelector('[data-feld="regie"]');
      return {
        text: block.querySelector('[data-feld="text"]').value.trim(),
        regie: schalter.checked,
        // Von Hand gesetzt/entfernt: die Automatik bleibt auch nach dem
        // Wiederöffnen draussen (nur gespeichert, wenn es zutrifft).
        ...(schalter.dataset.manuell ? { regieManuell: true } : {}),
        personen: matrix('data-person'),
        maschinen: [...matrix('data-geraet'), ...zeilen('maschinen', 'stunden')],
        material: zeilen('material', 'menge'),
        fremdleistungen: zeilen('fremdleistungen', 'stunden'),
      };
    }

    function zeigeTotale() {
      const arbeiten = sammleArbeiten();
      const t = totale(arbeiten);
      // Kontrollzeile wie bei Sorba: Tagestotal je Mitarbeiter über alle
      // Arbeiten/Vorgänge — stimmt es nicht, sieht man es sofort.
      const jePerson = new Map();
      for (const arbeit of arbeiten) {
        for (const p of arbeit.personen) {
          jePerson.set(p.name, (jePerson.get(p.name) || 0) + zahl(p.stunden));
        }
      }
      totaleElement.innerHTML = `
        ${jePerson.size ? `
          <div class="team-summen"><span>Kontrolle je Mitarbeiter</span>
            <span>${[...jePerson.entries()]
              .map(([name, s]) => `${esc(name)} ${stundenText(s)}`).join(' · ')}</span></div>` : ''}
        <div><span>Total Personal</span><span>${stundenText(t.personen)}</span></div>
        <div><span>Total Maschinen</span><span>${stundenText(t.maschinen)}</span></div>
        <div><span>Total Material</span><span>${t.materialText}</span></div>
        <div><span>Total Fremdleistungen</span><span>${stundenText(t.fremdleistungen)}</span></div>
        <div class="regie-total"><span>davon Regie</span><span>${stundenText(t.regie)}</span></div>`;
    }

    // Absenz- und Reisezeit-Zeilen (Abend 10.2) — Name wie im Personal-Stamm.
    function absenzZeileHtml(z = {}) {
      return `<div class="rapport-zeile" data-rolle="absenz-zeile">
        <input data-feld="name" class="zeile-name" placeholder="Name"
          autocomplete="off" value="${esc(z.name ?? '')}">
        <select data-feld="art" class="zeile-einheit">
          ${ABSENZ_ARTEN.map((a) => `<option${z.art === a ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
        <input data-feld="stunden" class="zeile-zahl" type="number" inputmode="decimal"
          step="0.25" min="0" placeholder="Std." value="${esc(z.stunden ?? '')}">
        <button type="button" class="knopf zeile-weg" data-aktion="absenz-weg"
          aria-label="Zeile entfernen">×</button>
      </div>`;
    }

    function reiseZeileHtml(z = {}) {
      return `<div class="rapport-zeile" data-rolle="reise-zeile">
        <input data-feld="name" class="zeile-name" placeholder="Name"
          autocomplete="off" value="${esc(z.name ?? '')}">
        <input data-feld="minuten" class="zeile-zahl" type="number" inputmode="numeric"
          step="5" min="0" placeholder="Min." value="${esc(z.minuten ?? '')}">
        <button type="button" class="knopf zeile-weg" data-aktion="reise-weg"
          aria-label="Zeile entfernen">×</button>
      </div>`;
    }

    function sammleAbsenzen() {
      return [...formular.querySelectorAll('[data-rolle="absenz-zeile"]')].map((zeile) => ({
        name: zeile.querySelector('[data-feld="name"]').value.trim(),
        art: zeile.querySelector('[data-feld="art"]').value,
        stunden: zeile.querySelector('[data-feld="stunden"]').value.trim(),
      })).filter((z) => z.name || z.stunden);
    }

    function sammleReisezeiten() {
      return [...formular.querySelectorAll('[data-rolle="reise-zeile"]')].map((zeile) => ({
        name: zeile.querySelector('[data-feld="name"]').value.trim(),
        minuten: zeile.querySelector('[data-feld="minuten"]').value.trim(),
      })).filter((z) => z.name || z.minuten);
    }

    // ---------- Regie-Erkennung ----------
    // Sucht in Beschreibung und Textzeilen (Maschinen, Material,
    // Fremdleistungen) einer Arbeit nach Regie-Hinweisen. Setzt das
    // Häkchen nur, wenn es nie von Hand berührt wurde, und sagt sichtbar
    // warum. Bei unterschriebenen Rapporten wird nur angezeigt.
    // Rückgabe: true, wenn das Häkchen dabei neu gesetzt wurde.
    let pruefungUebersprungen = false; // «So speichern» in der Schlusskontrolle

    function blockTexte(block) {
      return [block.querySelector('[data-feld="text"]').value,
        ...[...block.querySelectorAll('[data-rolle="zeile"] [data-feld="name"]')]
          .map((feld) => feld.value)]
        .map((t) => t.trim()).filter(Boolean).join(' · ');
    }

    function pruefeArbeit(block) {
      const schalter = block.querySelector('[data-feld="regie"]');
      const notiz = block.querySelector('[data-rolle="regie-erkannt"]');
      const treffer = regieTreffer(blockTexte(block));
      const gesperrt = istUnterschrieben(inBearbeitung);
      let neuGesetzt = false;
      if (!schalter.dataset.manuell && !gesperrt) {
        if (treffer && !schalter.checked) {
          schalter.checked = true;
          schalter.dataset.auto = '1';
          neuGesetzt = true;
        } else if (!treffer && schalter.dataset.auto) {
          // Hinweis wieder weggetippt — nur das selbst gesetzte Häkchen weg.
          schalter.checked = false;
          delete schalter.dataset.auto;
        }
      }
      let text = '';
      if (treffer && schalter.checked && schalter.dataset.auto) {
        text = `Regie erkannt: «${treffer}» — abwählen, falls es keine Regie ist.`;
      } else if (treffer && !schalter.checked) {
        text = gesperrt
          ? `Regie-Hinweis «${treffer}» — Rapport ist bereits unterschrieben, `
            + 'Häkchen nicht automatisch gesetzt. Bitte separat prüfen (Nachtrag).'
          : `Regie-Hinweis «${treffer}» — Regie von Hand ausgeschaltet.`;
      } else if (!treffer && !schalter.checked) {
        // Schaden allein kann Unternehmerverschulden sein: nur fragen.
        const schaden = schadenTreffer(blockTexte(block));
        if (schaden) {
          text = `Leitungsschaden («${schaden}») – Regie prüfen? War die Leitung `
            + 'nicht ersichtlich/nicht im Plan, «Regie» antippen.';
        }
      }
      notiz.textContent = text;
      notiz.hidden = !text;
      notiz.classList.toggle('regie-aus', !!treffer && !schalter.checked && !gesperrt);
      return neuGesetzt;
    }

    // Bemerkungen gehören keiner Arbeit — dort wird nichts angekreuzt,
    // nur deutlich darauf hingewiesen, solange keine Arbeit Regie ist.
    function pruefeBemerkungen() {
      const hinweis = formular.querySelector('[data-rolle="bemerkung-regie"]');
      const treffer = regieTreffer(formular.elements.bemerkungen.value);
      const regieDa = [...arbeitenElement.querySelectorAll('[data-feld="regie"]')]
        .some((s) => s.checked);
      hinweis.textContent = treffer && !regieDa
        ? `Regie-Hinweis in den Bemerkungen: «${treffer}» — bitte bei der `
          + 'betreffenden Arbeit «Regie» antippen.'
        : '';
      const schaden = !treffer && !regieDa && schadenTreffer(formular.elements.bemerkungen.value);
      if (schaden) {
        hinweis.textContent = `Leitungsschaden («${schaden}») in den Bemerkungen – Regie prüfen? `
          + 'War die Leitung nicht ersichtlich/nicht im Plan, bei der Arbeit «Regie» antippen.';
      }
      hinweis.hidden = !hinweis.textContent;
      return treffer && !regieDa ? treffer : '';
    }

    function pruefeAlles() {
      const neu = [...arbeitenElement.querySelectorAll('[data-rolle="arbeit"]')]
        .map((block, i) => (pruefeArbeit(block) ? i + 1 : 0)).filter(Boolean);
      const bemerkung = pruefeBemerkungen();
      return { neu, bemerkung };
    }

    function zeigePruefung(punkte) {
      const box = formular.querySelector('[data-rolle="regie-pruefung"]');
      box.innerHTML = punkte.length ? `
        <strong>Regie prüfen, bevor gespeichert wird</strong>
        <ul>${punkte.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <div class="knopfzeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="regie-so-speichern">
            So speichern</button>
        </div>` : '';
      box.hidden = !punkte.length;
      if (punkte.length) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function fuelleFormular(rapport) {
      inBearbeitung = rapport;
      await ladeStaemme();
      formularTitel.textContent = rapport
        ? `Rapport vom ${formatTag(rapport.tag)} bearbeiten`
        : 'Neuer Tagesrapport';
      abbrechenKnopf.hidden = !rapport;
      formular.elements.tag.value = rapport?.tag ?? heuteTag();
      formular.elements.mitarbeiter.value = rapport?.mitarbeiter ?? '';
      formular.elements.wetter.value = rapport?.wetter ?? '';
      formular.elements.bemerkungen.value = rapport?.bemerkungen ?? '';
      // Team des Tages: beim Bearbeiten alle Namen aus dem Rapport,
      // bei einem neuen Rapport leer — der Polier tippt sein Team an.
      team = rapport
        ? [...new Set((rapport.arbeiten || [])
            .flatMap((a) => a.personen || []).map((p) => p.name).filter(Boolean))]
        : [];
      zeichneTeamChips();
      const arbeiten = rapport?.arbeiten?.length ? rapport.arbeiten : [{}];
      arbeitenElement.innerHTML = arbeiten.map((a) => arbeitHtml(a)).join('');
      const absenzBereich = formular.querySelector('[data-rolle="absenz-bereich"]');
      formular.querySelector('[data-rolle="absenz-zeilen"]').innerHTML =
        (rapport?.absenzen || []).map(absenzZeileHtml).join('');
      formular.querySelector('[data-rolle="reise-zeilen"]').innerHTML =
        (rapport?.reisezeiten || []).map(reiseZeileHtml).join('');
      absenzBereich.open = !!(rapport?.absenzen?.length || rapport?.reisezeiten?.length);
      const fotoEingabe = formular.querySelector('[data-rolle="rapport-foto"]');
      fotoEingabe.value = '';
      const anzahlFotos = Object.keys(rapport?._attachments || {}).length;
      formular.querySelector('[data-rolle="foto-hinweis"]').textContent = anzahlFotos
        ? `${anzahlFotos} Foto${anzahlFotos > 1 ? 's' : ''} am Rapport — neue kommen dazu.`
        : 'Noch kein Foto gewählt.';
      nummeriereArbeiten();
      pruefungUebersprungen = false;
      zeigePruefung([]);
      // Bestehender Rapport: Erkennung auch ohne Tippen (z. B. alte oder
      // importierte Rapporte, die noch ohne Erkennung erfasst wurden).
      pruefeAlles();
      zeigeTotale();
      meldung.textContent = '';
    }

    // Team geändert: Personen-Matrizen in allen Arbeiten neu aufbauen,
    // bereits eingetragene Stunden bleiben erhalten (nach Name gemerkt).
    function baueMatrizenNeu() {
      for (const block of arbeitenElement.querySelectorAll('[data-rolle="arbeit"]')) {
        const werte = Object.fromEntries([...block.querySelectorAll('[data-person]')]
          .map((f) => [f.getAttribute('data-person'), f.value]));
        block.querySelector('[data-rolle="personen-matrix"]').innerHTML =
          matrixHtml('personen', 'data-person', team, werte);
      }
      zeigeTotale();
    }

    formular.addEventListener('change', (wechsel) => {
      const chip = wechsel.target.closest('[data-team-chip]');
      if (!chip) return;
      team = chip.checked
        ? [...team, chip.value]
        : team.filter((name) => name !== chip.value);
      baueMatrizenNeu();
    });

    // ---------- Liste ----------

    function gruppenText(liste, mitStunden) {
      return liste.map((z) => {
        const wert = mitStunden
          ? (String(z.stunden).trim() ? ` ${stundenText(zahl(z.stunden))}` : '')
          : ([z.menge, z.einheit].filter(Boolean).join(' ') ? ` ${[z.menge, z.einheit].filter(Boolean).join(' ')}` : '');
        return `${esc(z.name || '—')}${wert}`;
      }).join(', ');
    }

    function rapportKarte(r, regieEreignisse, nachtraege, rechnungen) {
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
              ${Object.keys(r._attachments || {}).length ? `
                <button type="button" class="knopf eintrag-loeschen" data-aktion="fotos"
                  data-id="${esc(r._id)}">Fotos (${Object.keys(r._attachments).length})</button>` : ''}
              <button type="button" class="knopf eintrag-loeschen" data-aktion="pdf"
                data-id="${esc(r._id)}">PDF</button>
              <button type="button" class="knopf eintrag-loeschen" data-aktion="uebergeben"
                data-id="${esc(r._id)}" title="Rapport als Datei an den Bauführer senden —
                dort über «Import» einlesen">Übergeben</button>
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
          ${regieWarnungHtml(r)}
          ${r.absenzen?.length ? `<p class="hinweis">Absenzen: ${r.absenzen
            .map((a) => `${esc(a.name)} · ${esc(a.art)} ${zahl(a.stunden)} h`).join(', ')}</p>` : ''}
          ${r.reisezeiten?.length ? `<p class="hinweis">Reisezeit: ${r.reisezeiten
            .map((z) => `${esc(z.name)} ${zahl(z.minuten)} min`).join(', ')}</p>` : ''}
          ${mitRegie ? `
            <p class="hinweis verknuepfung">↳ Regie-Ereignisse im Journal am ${formatTag(r.tag)}: ${
              verknuepfte.length
                ? verknuepfte.map((e) => `${formatDatumZeit(e.datum).split(', ')[1] || ''}${
                    e.ortKv ? ' ' + esc(e.ortKv) : ''}`.trim()).join(', ')
                : 'keine erfasst'}</p>` : ''}
          ${zugeordnet.length ? `
            <p class="hinweis verknuepfung">↳ Zugeordnet: Nachtrag ${zugeordnet.map(esc).join(', ')}</p>` : ''}
          ${mitRegie ? regieStatusHtml(r, rechnungen, nachtraege) : ''}
        </article>`;
    }

    // Regie-Hinweis im Text, aber nicht als Regie verbucht — z. B. alte,
    // importierte oder übergebene Rapporte. Die Liste ändert nichts am
    // Dokument; «Prüfen» öffnet den Rapport, dort greift die Erkennung
    // (bei unterschriebenen Rapporten nur als Hinweis).
    function regieWarnungHtml(r) {
      const hinweise = regieHinweiseRapport(r);
      if (!hinweise.length) return '';
      return `
        <p class="regie-erkannt regie-warnung">⚠ Regie-Hinweis nicht verbucht: ${hinweise
          .map((h) => `${esc(h.ort)} «${esc(h.treffer)}»`).join(', ')}${
          istUnterschrieben(r) ? ' — Rapport ist unterschrieben, bitte separat prüfen (Nachtrag).' : ''}
          <button type="button" class="knopf eintrag-loeschen" data-aktion="bearbeiten"
            data-id="${esc(r._id)}">Prüfen</button></p>`;
    }

    // Status-Pipeline des Regierapports mit datiertem Verlauf und
    // weiter/zurück — analog zur Nachtrags-Pipeline.
    function regieStatusHtml(r, rechnungen = [], nachtraege = []) {
      const status = r.regieStatus || 'offen';
      const index = REGIE_STATUS.indexOf(status);
      const naechster = REGIE_STATUS[index + 1];
      const verlinkte = rechnungen.filter((re) => re.basis?.art === 'regierapport'
        && re.basis.id === r._id);
      // Schon über einen Nachtrag verrechnet → keine zweite Rechnung.
      const ueberNachtrag = nachtraegeMitVerrechnung(r._id, nachtraege, rechnungen);
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
        ${verlinkte.length ? `
          <p class="hinweis verknuepfung">↳ Rechnung ${verlinkte
            .map((re) => `${esc(re.nummer)} (${esc(re.status)})`).join(', ')}</p>` : ''}
        ${ueberNachtrag.length ? `
          <p class="hinweis verknuepfung">↳ Verrechnet über Nachtrag ${ueberNachtrag
            .map((n) => esc(n.nummer)).join(', ')}</p>` : ''}
        <div class="knopfzeile">
          ${naechster ? `
            <button type="button" class="knopf" data-aktion="regie-weiter"
              data-id="${esc(r._id)}">Status → ${naechster}</button>` : ''}
          ${index > 0 ? `
            <button type="button" class="knopf" data-aktion="regie-zurueck"
              data-id="${esc(r._id)}">← zurück</button>` : ''}
          ${status === 'unterschrieben' && !verlinkte.length && !ueberNachtrag.length ? `
            <button type="button" class="knopf knopf-primaer" data-aktion="rechnung-erstellen"
              data-id="${esc(r._id)}">→ Rechnung erstellen</button>` : ''}
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
      const rechnungen = await abfrage({ typ: 'rechnung', baustelleId: baustelle.baustelleId });
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
          ${gruppe.rapporte.map((r) => rapportKarte(r, regieEreignisse, nachtraege, rechnungen)).join('')}`;
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

    // Kleinbaustellen-Automatik (Abend 8.4): aus einem unterschriebenen
    // Regierapport direkt eine Rechnung erzeugen. Betrag = Stunden ×
    // Regieansatz, beides editierbar; der zuletzt benutzte Ansatz wird
    // gemerkt (nur UI-Zustand).
    function oeffneRegieRechnung(rapport) {
      const stunden = zahl(rapport.davonRegie);
      const ansatz = zahl(localStorage.getItem('luense.regieansatz')) || 110;
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <form class="karte formular dialog" data-rolle="regie-rechnung">
          <h3>Rechnung aus Regierapport vom ${formatTag(rapport.tag)}</h3>
          <div class="feld-reihe">
            <label>Stunden<input name="stunden" type="number" inputmode="decimal"
              step="0.25" min="0" value="${esc(stunden)}"></label>
            <label>Regieansatz [CHF/h]<input name="ansatz" type="number"
              inputmode="decimal" step="any" min="0" value="${esc(ansatz)}"></label>
          </div>
          <label>Betrag [CHF]<input name="betrag" type="number" inputmode="decimal"
            step="any" min="0" value="${esc(Math.round(stunden * ansatz * 100) / 100)}"></label>
          <label>Titel<input name="titel" autocomplete="off"
            value="Regiearbeiten vom ${esc(formatTag(rapport.tag))}"></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rechnung erstellen</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
        </form>`;
      document.body.append(dialog);
      const dForm = dialog.querySelector('form');
      dForm.addEventListener('input', (eingabe) => {
        // Stunden/Ansatz rechnen den Betrag neu — direkte Betragseingabe bleibt.
        if (['stunden', 'ansatz'].includes(eingabe.target.name)) {
          dForm.elements.betrag.value = Math.round(
            zahl(dForm.elements.stunden.value) * zahl(dForm.elements.ansatz.value) * 100) / 100;
        }
      });
      dialog.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => dialog.remove());
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog) dialog.remove();
      });
      dForm.addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        localStorage.setItem('luense.regieansatz', dForm.elements.ansatz.value);
        const rechnung = await erstelleRechnung({
          baustelleId: baustelle.baustelleId,
          titel: dForm.elements.titel.value,
          betrag: dForm.elements.betrag.value,
          basis: { art: 'regierapport', id: rapport._id, label: `vom ${formatTag(rapport.tag)}` },
        });
        dialog.remove();
        meldung.textContent = `Rechnung ${rechnung.nummer} erstellt — im Modul Rechnungen stellen.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      });
    }

    // Fotos/Lieferscheine eines Rapports ansehen: eines direkt im Vollbild
    // (mit Löschen), mehrere über einen Auswahl-Dialog.
    async function zeigeRapportFotos(rapport) {
      const namen = Object.keys(rapport._attachments || {});
      const oeffneEinzeln = async (name) => {
        const blob = await holeAnhang(rapport._id, name);
        const url = URL.createObjectURL(blob);
        zeigeBildVollbild(url, {
          onLoeschen: async () => {
            await entferneAnhang(rapport._id, name);
            document.dispatchEvent(new CustomEvent('luense:daten'));
            await zeichneListe();
          },
        });
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      };
      if (namen.length === 1) {
        oeffneEinzeln(namen[0]);
        return;
      }
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <div class="karte formular dialog">
          <h3>Fotos · Rapport vom ${formatTag(rapport.tag)}</h3>
          ${namen.map((name, i) => `
            <div class="fo-zeile dossier-zeile">
              <span class="fo-label">Foto ${i + 1}</span>
              <button type="button" class="knopf" data-foto="${esc(name)}">Öffnen</button>
            </div>`).join('')}
          <div class="knopfzeile">
            <button type="button" class="knopf" data-aktion="zu">Schliessen</button>
          </div>
        </div>`;
      document.body.append(dialog);
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) {
          dialog.remove();
          return;
        }
        const name = klick.target.closest('[data-foto]')?.dataset.foto;
        if (name) oeffneEinzeln(name);
      });
    }

    // ---------- Ereignisse ----------

    formular.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'team-hinzu') {
        const eigen = formular.querySelector('[data-rolle="team-eigen"]');
        const name = eigen.value.trim();
        if (name && !team.includes(name)) {
          team = [...team, name];
          eigen.value = '';
          zeichneTeamChips();
          baueMatrizenNeu();
        }
      } else if (aktion === 'arbeit-hinzu') {
        arbeitenElement.insertAdjacentHTML('beforeend', arbeitHtml());
        nummeriereArbeiten();
      } else if (aktion === 'arbeit-entfernen') {
        knopf.closest('[data-rolle="arbeit"]').remove();
        if (!arbeitenElement.querySelector('[data-rolle="arbeit"]')) {
          arbeitenElement.innerHTML = arbeitHtml();
        }
        nummeriereArbeiten();
        pruefeBemerkungen();
        zeigeTotale();
      } else if (aktion === 'regie-so-speichern') {
        pruefungUebersprungen = true;
        formular.requestSubmit();
      } else if (aktion === 'zeile-hinzu') {
        const gruppe = GRUPPEN.find((g) => g.schluessel === knopf.dataset.gruppe);
        knopf.closest('.gruppe').querySelector('[data-rolle="zeilen"]')
          .insertAdjacentHTML('beforeend', zeileHtml(gruppe));
      } else if (aktion === 'zeile-entfernen') {
        const zeilen = knopf.closest('[data-rolle="zeilen"]');
        const block = knopf.closest('[data-rolle="arbeit"]');
        knopf.closest('[data-rolle="zeile"]').remove();
        pruefeArbeit(block);
        // Nur Material behält immer eine leere Zeile; Maschinen- und
        // Fremdleistungs-Zeilen dürfen ganz verschwinden (Matrix reicht).
        if (zeilen.dataset.gruppeZeilen === 'material'
          && !zeilen.querySelector('[data-rolle="zeile"]')) {
          zeilen.insertAdjacentHTML('beforeend', zeileHtml(GRUPPEN[2]));
        }
        zeigeTotale();
      } else if (aktion === 'absenz-hinzu') {
        formular.querySelector('[data-rolle="absenz-zeilen"]')
          .insertAdjacentHTML('beforeend', absenzZeileHtml());
      } else if (aktion === 'absenz-weg') {
        knopf.closest('[data-rolle="absenz-zeile"]').remove();
      } else if (aktion === 'reise-hinzu') {
        formular.querySelector('[data-rolle="reise-zeilen"]')
          .insertAdjacentHTML('beforeend', reiseZeileHtml());
      } else if (aktion === 'reise-weg') {
        knopf.closest('[data-rolle="reise-zeile"]').remove();
      } else if (aktion === 'abbrechen') {
        fuelleFormular(null);
      }
    });

    formular.addEventListener('input', (eingabe) => {
      const ziel = eingabe.target;
      const block = ziel.closest('[data-rolle="arbeit"]');
      if (ziel.matches('[data-feld="regie"]')) {
        // Von Hand gesetzt oder entfernt — die Automatik mischt sich
        // bei dieser Arbeit nicht mehr ein (auch nach dem Speichern).
        ziel.dataset.manuell = '1';
        delete ziel.dataset.auto;
        pruefeArbeit(block);
        pruefeBemerkungen();
      } else if (block && ziel.matches('[data-feld="text"], [data-feld="name"]')) {
        // Beschreibung oder Textzeile deutet auf Regie hin → Häkchen
        // vorschlagen, mit sichtbarer Begründung.
        pruefeArbeit(block);
        pruefeBemerkungen();
      } else if (ziel.name === 'bemerkungen') {
        pruefeBemerkungen();
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
      } else if (knopf.dataset.aktion === 'fotos') {
        zeigeRapportFotos(rapport);
      } else if (knopf.dataset.aktion === 'uebergeben') {
        // Rapport-Übergabe (Polier → Bauführer): ein einzelner Rapport als
        // Lünse-Datei — der Empfänger liest sie über «Import» ein (ergänzt,
        // überschreibt nichts). Gleiches Format wie das Backup.
        const datei = new File(
          [JSON.stringify({
            app: 'luense',
            version: 1,
            exportiertAm: new Date().toISOString(),
            // Mit Anhängen: die Fotos/Lieferscheine reisen mit zum Bauführer.
            dokumente: [await holeMitAnhaengen(rapport._id)],
          })],
          `luense-rapport-${String(baustelle.ktr).replace(/[^\w.-]/g, '_')}-${rapport.tag}.json`,
          { type: 'application/json' },
        );
        if (await teileDatei(datei, `Tagesrapport ${formatTag(rapport.tag)}`)) {
          meldung.textContent = `Rapport vom ${formatTag(rapport.tag)} übergeben — `
            + 'der Empfänger liest ihn über «Import» ein.';
        }
      } else if (knopf.dataset.aktion === 'rechnung-erstellen') {
        // Nochmals prüfen: inzwischen über einen Nachtrag verrechnet?
        const [nachtraege, rechnungen] = await Promise.all([
          abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId }),
          abfrage({ typ: 'rechnung', baustelleId: baustelle.baustelleId }),
        ]);
        const ueberNachtrag = nachtraegeMitVerrechnung(rapport._id, nachtraege, rechnungen);
        if (ueberNachtrag.length) {
          meldung.textContent = `Bereits verrechnet über Nachtrag ${ueberNachtrag
            .map((n) => n.nummer).join(', ')} — keine zweite Rechnung.`;
          await zeichneListe();
          return;
        }
        oeffneRegieRechnung(rapport);
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
        // Fotos/Lieferscheine kommen mit in den Ausdruck.
        const bilder = [];
        for (const name of Object.keys(rapport._attachments || {})) {
          try {
            const blob = await holeAnhang(rapport._id, name);
            const url = URL.createObjectURL(blob);
            setTimeout(() => URL.revokeObjectURL(url), 120000);
            bilder.push({ url, titel: `Beilage · ${formatTag(rapport.tag)}` });
          } catch { /* Anhang nicht lesbar */ }
        }
        zeigeRapportDruck(baustelle, rapport, totale(rapport.arbeiten), bilder);
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
      // Schlusskontrolle: Texte können auch ohne Tippen ins Formular
      // gekommen sein (Autofill, Wiederherstellen, Einfügen per Diktat) —
      // darum hier nochmals prüfen. Neu Erkanntes und offene Hinweise
      // werden gezeigt, gespeichert wird erst nach «So speichern».
      const { neu, bemerkung } = pruefeAlles();
      const arbeiten = sammleArbeiten();
      if (!arbeiten.length) {
        meldung.textContent = 'Mindestens eine Arbeit erfassen.';
        return;
      }
      const ignoriert = inBearbeitung?.regieHinweisIgnoriert === bemerkung;
      if (!pruefungUebersprungen) {
        const punkte = [];
        if (neu.length) {
          punkte.push(`Regie automatisch angekreuzt bei Arbeit ${neu.join(', ')} — `
            + 'Begründung steht bei der Arbeit. Falls keine Regie: Häkchen dort abwählen.');
        }
        if (bemerkung && !ignoriert) {
          punkte.push(`In den Bemerkungen steht «${bemerkung}», aber keine Arbeit ist als `
            + 'Regie markiert. Bei der betreffenden Arbeit «Regie» antippen — oder ohne Regie speichern.');
        }
        if (istUnterschrieben(inBearbeitung)) {
          regieHinweiseRapport({ ...inBearbeitung, arbeiten, bemerkungen: '' })
            .forEach((h) => punkte.push(`${h.ort}: «${h.treffer}» — Rapport ist unterschrieben, `
              + 'nicht automatisch als Regie verbucht. Bitte separat prüfen (Nachtrag).'));
        }
        [...arbeitenElement.querySelectorAll('[data-rolle="arbeit"]')].forEach((block, i) => {
          if (!block.querySelector('[data-feld="regie"]').checked) return;
          if (!totale([arbeitAusBlock(block)]).regie) {
            punkte.push(`Arbeit ${i + 1} ist Regie, hat aber keine Stunden — `
              + 'so wird keine Regie verbucht. Stunden bei dieser Arbeit eintragen.');
          }
        });
        if (punkte.length) {
          zeigePruefung(punkte);
          meldung.textContent = 'Bitte die Regie-Hinweise oben prüfen.';
          return;
        }
      }
      pruefungUebersprungen = false;
      zeigePruefung([]);
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
          // «Ohne Regie speichern» trotz Hinweis in den Bemerkungen: merken,
          // damit derselbe Hinweis nicht bei jedem Öffnen wieder kommt.
          regieHinweisIgnoriert: bemerkung || undefined,
          arbeiten,
          absenzen: sammleAbsenzen(),
          reisezeiten: sammleReisezeiten(),
        });
        // Fotos/Lieferscheine anhängen (verkleinert, wie im Journal).
        const fotos = [...formular.querySelector('[data-rolle="rapport-foto"]').files];
        let lauf = Object.keys(gespeichert._attachments || {}).length;
        for (const [i, datei] of fotos.entries()) {
          meldung.textContent = `Foto ${i + 1} von ${fotos.length} wird verarbeitet …`;
          lauf += 1;
          const klein = await verkleinereFoto(datei);
          await haengeAnhangAn(gespeichert._id,
            `foto-${Date.now().toString(36)}-${lauf}.jpg`, klein);
        }
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
        await fuelleFormular(null); // erst zurücksetzen, dann melden —
        meldung.textContent = pendenzErstellt // sonst löscht der Reset die Meldung
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
