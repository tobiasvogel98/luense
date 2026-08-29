// kern/export.js — Backup und Wiederherstellung: Gesamtexport der Datenbank
// (Dokumente + Fotos) als eine JSON-Datei via Teilen/Download, Import mit
// Duplikat-Schutz. Fusszeile in der Shell zeigt das letzte Backup-Datum
// und erinnert nach 7 Tagen.

import { exportiereAlles, importiereDokumente } from './speicher.js';

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

// Fusszeile für die Shell: Backup-Stand, Erinnerung, Backup- und Import-Knopf.
export function renderBackupZeile(container, { nachImport = () => {} } = {}) {
  container.innerHTML = `
    <span data-rolle="backup-status"></span>
    <span class="fusszeile-knoepfe">
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

  function zeigeStand() {
    const letzter = localStorage.getItem(MERKER);
    const alterTage = letzter
      ? (Date.now() - new Date(letzter).getTime()) / 86_400_000
      : Infinity;
    const faellig = alterTage > ERINNERUNG_TAGE;
    container.classList.toggle('faellig', faellig);
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
      const ergebnis = await importiereBackup(datei);
      status.textContent =
        `Import: ${ergebnis.neu} neu, ${ergebnis.uebersprungen} schon vorhanden.`;
      nachImport();
    } catch (fehler) {
      status.textContent = fehler.message;
    } finally {
      importDatei.value = '';
    }
  });

  zeigeStand();
}
