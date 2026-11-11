// kern/umzug.js — Hinweis auf der alten Adresse (GitHub Pages), dass Lünse
// nach app.luense.ch umgezogen ist. Auf jeder anderen Adresse tut die
// Funktion nichts. Die alte App bleibt voll nutzbar; der Hinweis drängt
// nur zum Umzug und bietet das Backup direkt an.

import { erstelleBackup } from './export.js';

const ALTE_ADRESSE = 'tobiasvogel98.github.io';
const NEUE_ADRESSE = 'https://app.luense.ch';

export function zeigeUmzugHinweis() {
  if (location.hostname !== ALTE_ADRESSE) return;
  const kasten = document.createElement('section');
  kasten.className = 'umzug-hinweis';
  kasten.setAttribute('role', 'alert');
  kasten.innerHTML = `
    <h2>Lünse ist umgezogen</h2>
    <p>Diese Adresse wird bald abgeschaltet. Die App läuft neu unter
      <b>app.luense.ch</b> (Anmeldung mit Ihrer E-Mail-Adresse und Code).</p>
    <ol>
      <li>Hier ein Backup machen.</li>
      <li>app.luense.ch öffnen, anmelden, auf dem Startbildschirm installieren.</li>
      <li>Dort das Backup importieren (Seitenleiste ☰, unten «Import»).</li>
    </ol>
    <p>Ihre Daten bleiben hier erhalten, bis Sie die alte App löschen.</p>
    <div class="umzug-knoepfe">
      <button type="button" class="knopf knopf-primaer" data-aktion="backup">Backup jetzt machen</button>
      <a class="knopf" href="${NEUE_ADRESSE}" target="_blank" rel="noopener">app.luense.ch öffnen</a>
      <button type="button" class="knopf" data-aktion="spaeter">Später</button>
    </div>
    <p class="meldung" role="status"></p>`;
  kasten.addEventListener('click', async (klick) => {
    const aktion = klick.target.closest('[data-aktion]')?.dataset.aktion;
    if (aktion === 'spaeter') kasten.remove();
    if (aktion === 'backup') {
      const anzahl = await erstelleBackup();
      kasten.querySelector('.meldung').textContent = anzahl === null
        ? 'Backup abgebrochen.'
        : `Backup mit ${anzahl} Einträgen erstellt. Jetzt app.luense.ch öffnen und importieren.`;
    }
  });
  document.body.prepend(kasten);
}
