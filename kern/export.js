// kern/export.js — Backup und Wiederherstellung: Gesamtexport der Datenbank
// (Dokumente + Fotos) als eine JSON-Datei via Teilen/Download, Import mit
// Duplikat-Schutz. Fusszeile in der Shell zeigt das letzte Backup-Datum
// und erinnert nach 7 Tagen.

import {
  exportiereAlles, importiereDokumente, put, abfrage, entferneDokument,
} from './speicher.js';
import { alleBaustellen } from './stamm.js';
import { esc } from './ui.js';

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
// dessen importId). Gibt die Anzahl entfernter Pendenzen zurück.
export async function entferneAltImport() {
  const importId = localStorage.getItem(ALT_IMPORT_MERKER);
  if (!importId) return 0;
  const betroffene = (await abfrage({ typ: 'pendenz' }))
    .filter((p) => p.importId === importId);
  for (const doc of betroffene) await entferneDokument(doc._id);
  localStorage.removeItem(ALT_IMPORT_MERKER);
  return betroffene.length;
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
    for (const item of daten.items) {
      const ziel = zuordnung.get(item.baustelleId);
      if (!ziel) { ohneZiel++; continue; }
      if (item.id && bekannteAltIds.has(item.id)) { doppelt++; continue; }
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
    nachImport({ neu, doppelt, ohneZiel });
  });
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
              + `${ergebnis.doppelt} Duplikate, ${ergebnis.ohneZiel} ohne Zuordnung.`;
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
    status.textContent = `Probeimport entfernt: ${anzahl} Pendenz${anzahl === 1 ? '' : 'en'} gelöscht.`;
    entfernenKnopf.hidden = true;
    nachImport();
  });

  zeigeStand();
}
