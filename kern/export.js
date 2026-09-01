// kern/export.js — Backup und Wiederherstellung: Gesamtexport der Datenbank
// (Dokumente + Fotos) als eine JSON-Datei via Teilen/Download, Import mit
// Duplikat-Schutz. Fusszeile in der Shell zeigt das letzte Backup-Datum
// und erinnert nach 7 Tagen.

import {
  exportiereAlles, importiereDokumente, put, abfrage, entferneDokument,
} from './speicher.js';
import { alleBaustellen } from './stamm.js';
import { esc, REGIE_MUSTER } from './ui.js';

const MERKER = 'luense.letzterExport'; // nur UI-Zustand (Datum), keine Daten
const ERINNERUNG_TAGE = 7;

function ladeHerunter(datei) {
  const url = URL.createObjectURL(datei);
  const link = document.createElement('a');
  link.href = url;
  link.download = datei.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Excel-Export (Abend 8.3) ----------
// CSV, das Excel (Schweiz) per Doppelklick korrekt öffnet: Semikolon als
// Trenner, UTF-8 mit BOM (Umlaute), CRLF. Zahlen mit Punkt als Dezimal-
// trenner, ohne Tausendertrennung; Texte mit Semikolon/Anführungszeichen/
// Zeilenumbruch werden nach CSV-Regeln maskiert.

function csvFeld(wert) {
  if (typeof wert === 'number') {
    return Number.isFinite(wert) ? String(Math.round(wert * 1000) / 1000) : '';
  }
  const text = String(wert ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportiereCsv(dateiname, spalten, zeilen) {
  const inhalt = '\uFEFF' + [spalten, ...zeilen]
    .map((zeile) => zeile.map(csvFeld).join(';')).join('\r\n');
  ladeHerunter(new File([inhalt], dateiname, { type: 'text/csv' }));
}

// Erstellt die Backup-Datei und übergibt sie dem Teilen-Dialog (Handy)
// oder dem Download (Laptop). Gibt die Anzahl Dokumente zurück,
// oder null, wenn der Nutzer das Teilen abgebrochen hat.
export async function erstelleBackup() {
  const dokumente = await exportiereAlles();
  const inhalt = JSON.stringify({
    app: 'luense',
    version: 1,
    exportiertAm: new Date().toISOString(),
    dokumente,
  });
  const datei = new File(
    [inhalt],
    `luense-backup-${new Date().toISOString().slice(0, 10)}.json`,
    { type: 'application/json' },
  );
  if (navigator.canShare?.({ files: [datei] })) {
    try {
      await navigator.share({ files: [datei], title: 'Lünse-Backup' });
    } catch (fehler) {
      if (fehler.name === 'AbortError') return null;
      ladeHerunter(datei); // Teilen fehlgeschlagen — Download als Ersatz
    }
  } else {
    ladeHerunter(datei);
  }
  localStorage.setItem(MERKER, new Date().toISOString());
  return dokumente.length;
}

// Liest eine Backup-Datei ein. Ergänzt den Bestand, überschreibt nichts.
export async function importiereBackup(datei) {
  let inhalt;
  try {
    inhalt = JSON.parse(await datei.text());
  } catch {
    throw new Error('Die Datei ist kein gültiges Lünse-Backup.');
  }
  const dokumente = Array.isArray(inhalt) ? inhalt : inhalt?.dokumente;
  if (!Array.isArray(dokumente)) {
    throw new Error('Die Datei ist kein gültiges Lünse-Backup.');
  }
  return importiereDokumente(dokumente);
}

// ---------- Import aus der alten Pendenzenliste-App ----------
// Deren Export: { baustellen: [{id, name}], items: [{id, baustelleId,
// priority: low|mid|high, title, who, due, done, note, created}] }.
// Die Alt-App kennt keine KTR-Nr. — die Zuordnung Alt-Baustelle →
// Lünse-Baustelle (KTR) wählt der Nutzer im Dialog. Jeder Import trägt
// eine importId, damit ein Probelauf rückstandslos entfernt werden kann.

const ALT_IMPORT_MERKER = 'luense.letzterAltImport';
const PRIO_ZUORDNUNG = { low: 'tief', mid: 'mittel', high: 'hoch' };

export function istAltPendenzenFormat(daten) {
  return !!daten && !Array.isArray(daten)
    && Array.isArray(daten.items) && Array.isArray(daten.baustellen)
    && !Array.isArray(daten.dokumente);
}

export function altImportVorhanden() {
  return !!localStorage.getItem(ALT_IMPORT_MERKER);
}

// Entfernt den letzten Probeimport vollständig (alle Dokumente mit
// dessen importId, egal welchen Typs). Gibt die Anzahl zurück.
export async function entferneAltImport() {
  const importId = localStorage.getItem(ALT_IMPORT_MERKER);
  if (!importId) return 0;
  let entfernt = 0;
  for (const typ of ['pendenz', 'rapport']) {
    const betroffene = (await abfrage({ typ })).filter((d) => d.importId === importId);
    for (const doc of betroffene) {
      await entferneDokument(doc._id);
      entfernt++;
    }
  }
  localStorage.removeItem(ALT_IMPORT_MERKER);
  return entfernt;
}

export async function oeffneAltPendenzenImport(daten, { nachImport = () => {} } = {}) {
  const ziele = await alleBaustellen();
  if (!ziele.length) {
    alert('Zuerst in Lünse die Baustellen mit KTR-Nr. anlegen — danach importieren.');
    return;
  }
  const altBaustellen = daten.baustellen
    .map((b) => ({ ...b, anzahl: daten.items.filter((it) => it.baustelleId === b.id).length }))
    .filter((b) => b.anzahl > 0);
  if (!altBaustellen.length) {
    alert('Die Datei enthält keine Pendenzen.');
    return;
  }

  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  dialog.innerHTML = `
    <form class="karte formular dialog" data-rolle="alt-import">
      <h3>Pendenzen aus der Alt-App importieren</h3>
      <p class="hinweis">${daten.items.length} Pendenzen gefunden. Ordne jeder
        Alt-Baustelle die richtige Lünse-Baustelle (KTR-Nr.) zu — nicht
        zugeordnete werden übersprungen.</p>
      ${altBaustellen.map((b) => `
        <label>${esc(b.name)} (${b.anzahl} Pendenz${b.anzahl > 1 ? 'en' : ''})
          <select name="ziel-${esc(b.id)}">
            <option value="">— nicht importieren —</option>
            ${ziele.map((z) => `
              <option value="${esc(z.baustelleId)}"
                ${z.name.trim().toLowerCase() === String(b.name || '').trim().toLowerCase()
                  ? 'selected' : ''}>
                ${esc(z.ktr)} · ${esc(z.name)}</option>`).join('')}
          </select>
        </label>`).join('')}
      <div class="knopfzeile">
        <button type="submit" class="knopf knopf-primaer">Importieren</button>
        <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
      </div>
      <p class="meldung" role="status"></p>
    </form>`;
  document.body.append(dialog);

  const formular = dialog.querySelector('[data-rolle="alt-import"]');
  const meldung = formular.querySelector('.meldung');
  dialog.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog) dialog.remove();
  });

  formular.addEventListener('submit', async (abschicken) => {
    abschicken.preventDefault();
    const zuordnung = new Map();
    for (const b of altBaustellen) {
      const ziel = formular.elements[`ziel-${b.id}`].value;
      if (ziel) zuordnung.set(b.id, ziel);
    }
    if (!zuordnung.size) {
      meldung.textContent = 'Mindestens einer Baustelle eine KTR-Nr. zuordnen.';
      return;
    }
    // Duplikat-Schutz: bereits importierte Alt-Ids überspringen.
    const bekannteAltIds = new Set(
      (await abfrage({ typ: 'pendenz' })).map((p) => p.altId).filter(Boolean));
    const importId = `alt-pendenzen:${Date.now().toString(36)}`;
    let neu = 0;
    let doppelt = 0;
    let ohneZiel = 0;
    const doppeltListe = [];
    for (const item of daten.items) {
      const ziel = zuordnung.get(item.baustelleId);
      if (!ziel) { ohneZiel++; continue; }
      if (item.id && bekannteAltIds.has(item.id)) {
        doppelt++;
        doppeltListe.push(String(item.title || item.id).slice(0, 30));
        continue;
      }
      await put({
        typ: 'pendenz',
        baustelleId: ziel,
        text: String(item.title || '').trim() || '(ohne Text)',
        prioritaet: PRIO_ZUORDNUNG[item.priority] || 'mittel',
        termin: item.due || '',
        verantwortlich: String(item.who || '').trim(),
        erledigtAm: item.done || '',
        notiz: String(item.note || '').trim(),
        datum: item.created ? `${item.created}T00:00:00.000Z` : '',
        altId: item.id || '',
        importId,
        quelle: 'pendenzen-alt',
      });
      neu++;
    }
    if (neu) localStorage.setItem(ALT_IMPORT_MERKER, importId);
    dialog.remove();
    nachImport({ neu, doppelt, ohneZiel, doppeltListe });
  });
}

// ---------- Import aus dem alten Tagesrapport-Tool ----------
// Dessen Daten liegen im localStorage: Archiv `tagesrapport_archive` =
// [{id, data}], data = { worker, date, project (Freitext-Baustelle),
// notes, entries: [{task, persons/machines/services: [{name, hours}],
// materials: [{name, qty, unit}]}] }. Der Import akzeptiert das Archiv,
// eine Liste von data-Objekten oder ein einzelnes data-Objekt.

function altRapportListe(daten) {
  const roh = Array.isArray(daten) ? daten
    : Array.isArray(daten?.tagesrapport_archive) ? daten.tagesrapport_archive
    : (daten?.entries ? [daten] : null);
  if (!roh) return null;
  const liste = roh
    .map((eintrag) => (eintrag?.data?.entries ? { id: eintrag.id, ...eintrag.data }
      : (eintrag?.entries ? eintrag : null)))
    .filter(Boolean)
    .filter((r) => r.date);
  return liste.length ? liste : null;
}

export function istAltRapportFormat(daten) {
  return !!altRapportListe(daten);
}

function altRapportZuDokument(alt, baustelleId, importId) {
  const stundenListe = (liste) => (liste || [])
    .map((z) => ({ name: String(z.name ?? '').trim(), stunden: String(z.hours ?? '').trim() }))
    .filter((z) => z.name || z.stunden);
  const arbeiten = (alt.entries || []).map((e) => ({
    text: String(e.task ?? '').trim(),
    regie: REGIE_MUSTER.test(String(e.task ?? '')),
    personen: stundenListe(e.persons),
    maschinen: stundenListe(e.machines),
    fremdleistungen: stundenListe(e.services),
    material: (e.materials || [])
      .map((m) => ({ name: String(m.name ?? '').trim(), menge: String(m.qty ?? '').trim(), einheit: String(m.unit ?? '').trim() }))
      .filter((m) => m.name || m.menge || m.einheit),
  })).filter((a) => a.text || a.personen.length || a.maschinen.length
    || a.fremdleistungen.length || a.material.length);
  const regieStunden = arbeiten.filter((a) => a.regie)
    .flatMap((a) => [...a.personen, ...a.maschinen, ...a.fremdleistungen])
    .reduce((s, z) => s + (parseFloat(String(z.stunden).replace(',', '.')) || 0), 0);
  return {
    typ: 'rapport',
    baustelleId,
    tag: alt.date,
    datum: `${alt.date}T12:00:00.000Z`,
    mitarbeiter: String(alt.worker ?? '').trim(),
    wetter: '',
    davonRegie: regieStunden,
    bemerkungen: String(alt.notes ?? '').trim(),
    arbeiten,
    altId: alt.id || `${alt.date}|${alt.project || ''}|${alt.worker || ''}`,
    importId,
    quelle: 'tagesrapport-alt',
  };
}

export async function oeffneAltRapportImport(daten, { nachImport = () => {} } = {}) {
  const liste = altRapportListe(daten);
  const ziele = await alleBaustellen();
  if (!ziele.length) {
    alert('Zuerst in Lünse die Baustellen mit KTR-Nr. anlegen — danach importieren.');
    return;
  }
  // Gruppieren nach dem Freitext-Feld «Baustelle» des Alt-Tools.
  const projekte = new Map();
  for (const r of liste) {
    const name = String(r.project ?? '').trim() || '(ohne Baustelle)';
    if (!projekte.has(name)) projekte.set(name, []);
    projekte.get(name).push(r);
  }

  const dialog = document.createElement('div');
  dialog.className = 'vollbild dialog-hintergrund';
  dialog.innerHTML = `
    <form class="karte formular dialog" data-rolle="alt-rapport-import">
      <h3>Tagesrapporte aus dem Alt-Tool importieren</h3>
      <p class="hinweis">${liste.length} Rapport${liste.length > 1 ? 'e' : ''} gefunden.
        Ordne jeder Alt-Baustelle die richtige Lünse-Baustelle (KTR-Nr.) zu —
        nicht Zugeordnetes wird übersprungen.</p>
      ${[...projekte.entries()].map(([name, rapporte], index) => `
        <label>${esc(name)} (${rapporte.length} Rapport${rapporte.length > 1 ? 'e' : ''})
          <select name="ziel-${index}" data-projekt="${esc(name)}">
            <option value="">— nicht importieren —</option>
            ${ziele.map((z) => `
              <option value="${esc(z.baustelleId)}"
                ${z.name.trim().toLowerCase() === name.trim().toLowerCase() ? 'selected' : ''}>
                ${esc(z.ktr)} · ${esc(z.name)}</option>`).join('')}
          </select>
        </label>`).join('')}
      <div class="knopfzeile">
        <button type="submit" class="knopf knopf-primaer">Importieren</button>
        <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
      </div>
      <p class="meldung" role="status"></p>
    </form>`;
  document.body.append(dialog);

  const formular = dialog.querySelector('[data-rolle="alt-rapport-import"]');
  const meldung = formular.querySelector('.meldung');
  dialog.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => dialog.remove());
  dialog.addEventListener('click', (klick) => {
    if (klick.target === dialog) dialog.remove();
  });

  formular.addEventListener('submit', async (abschicken) => {
    abschicken.preventDefault();
    const zuordnung = new Map();
    for (const select of formular.querySelectorAll('select')) {
      if (select.value) zuordnung.set(select.dataset.projekt, select.value);
    }
    if (!zuordnung.size) {
      meldung.textContent = 'Mindestens einer Baustelle eine KTR-Nr. zuordnen.';
      return;
    }
    const bekannteAltIds = new Set(
      (await abfrage({ typ: 'rapport' })).map((r) => r.altId).filter(Boolean));
    const importId = `alt-rapporte:${Date.now().toString(36)}`;
    let neu = 0;
    let doppelt = 0;
    let ohneZiel = 0;
    const doppeltListe = [];
    for (const [name, rapporte] of projekte.entries()) {
      const ziel = zuordnung.get(name);
      for (const alt of rapporte) {
        if (!ziel) { ohneZiel++; continue; }
        const doc = altRapportZuDokument(alt, ziel, importId);
        if (bekannteAltIds.has(doc.altId)) {
          doppelt++;
          doppeltListe.push(`${alt.date} ${name}`.slice(0, 30));
          continue;
        }
        await put(doc);
        bekannteAltIds.add(doc.altId);
        neu++;
      }
    }
    if (neu) localStorage.setItem(ALT_IMPORT_MERKER, importId);
    dialog.remove();
    nachImport({ neu, doppelt, ohneZiel, doppeltListe });
  });
}

// Bis zu acht übersprungene Einträge namentlich ausweisen.
export function doppeltText(liste) {
  if (!liste?.length) return '';
  return ` Übersprungen: ${liste.slice(0, 8).join(', ')}${liste.length > 8 ? ' …' : ''}`;
}

// Fusszeile für die Shell: Backup-Stand, Erinnerung, Backup- und Import-Knopf.
export function renderBackupZeile(container, { nachImport = () => {} } = {}) {
  container.innerHTML = `
    <span data-rolle="backup-status"></span>
    <span class="fusszeile-knoepfe">
      <button type="button" class="knopf" data-rolle="import-entfernen" hidden>
        Probeimport entfernen
      </button>
      <button type="button" class="knopf" data-rolle="backup">Backup</button>
      <label class="knopf">
        Import
        <input type="file" accept=".json,application/json"
          data-rolle="import-datei" class="visually-hidden">
      </label>
    </span>`;

  const status = container.querySelector('[data-rolle="backup-status"]');
  const backupKnopf = container.querySelector('[data-rolle="backup"]');
  const importDatei = container.querySelector('[data-rolle="import-datei"]');
  const entfernenKnopf = container.querySelector('[data-rolle="import-entfernen"]');

  function zeigeStand() {
    const letzter = localStorage.getItem(MERKER);
    const alterTage = letzter
      ? (Date.now() - new Date(letzter).getTime()) / 86_400_000
      : Infinity;
    const faellig = alterTage > ERINNERUNG_TAGE;
    container.classList.toggle('faellig', faellig);
    entfernenKnopf.hidden = !altImportVorhanden();
    status.textContent = letzter
      ? `Letztes Backup: ${new Date(letzter).toLocaleDateString('de-CH')}${
          faellig ? ' — Backup fällig!' : ''}`
      : 'Noch kein Backup — jetzt eines erstellen.';
  }

  backupKnopf.addEventListener('click', async () => {
    backupKnopf.disabled = true;
    try {
      const anzahl = await erstelleBackup();
      if (anzahl !== null) {
        status.textContent =
          `Backup mit ${anzahl} ${anzahl === 1 ? 'Dokument' : 'Dokumenten'} erstellt.`;
        setTimeout(zeigeStand, 4000);
      }
    } catch (fehler) {
      status.textContent = fehler.message;
    } finally {
      backupKnopf.disabled = false;
      container.classList.remove('faellig');
    }
  });

  importDatei.addEventListener('change', async () => {
    const datei = importDatei.files[0];
    if (!datei) return;
    try {
      let inhalt = null;
      try {
        inhalt = JSON.parse(await datei.text());
      } catch {
        throw new Error('Die Datei ist kein gültiges JSON.');
      }
      if (istAltPendenzenFormat(inhalt)) {
        await oeffneAltPendenzenImport(inhalt, {
          nachImport: (ergebnis) => {
            status.textContent = `Probeimport: ${ergebnis.neu} Pendenzen neu, `
              + `${ergebnis.doppelt} Duplikate, ${ergebnis.ohneZiel} ohne Zuordnung.`
              + doppeltText(ergebnis.doppeltListe);
            entfernenKnopf.hidden = !altImportVorhanden();
            nachImport();
          },
        });
      } else if (istAltRapportFormat(inhalt)) {
        await oeffneAltRapportImport(inhalt, {
          nachImport: (ergebnis) => {
            status.textContent = `Probeimport: ${ergebnis.neu} Rapporte neu, `
              + `${ergebnis.doppelt} Duplikate, ${ergebnis.ohneZiel} ohne Zuordnung.`
              + doppeltText(ergebnis.doppeltListe);
            entfernenKnopf.hidden = !altImportVorhanden();
            nachImport();
          },
        });
      } else {
        const ergebnis = await importiereBackup(datei);
        status.textContent =
          `Import: ${ergebnis.neu} neu, ${ergebnis.uebersprungen} schon vorhanden.`;
        nachImport();
      }
    } catch (fehler) {
      status.textContent = fehler.message;
    } finally {
      importDatei.value = '';
    }
  });

  entfernenKnopf.addEventListener('click', async () => {
    if (!confirm('Den letzten Probeimport vollständig entfernen?')) return;
    const anzahl = await entferneAltImport();
    status.textContent = `Probeimport entfernt: ${anzahl} ${anzahl === 1 ? 'Dokument' : 'Dokumente'} gelöscht.`;
    entfernenKnopf.hidden = true;
    nachImport();
  });

  zeigeStand();
}
