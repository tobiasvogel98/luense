// module/ereignis.js — Ereignis-Journal, erstes Modul der Shell.
// Erfassung (Tag, Ort/KV, Notiz, Fotos) und gefilterte Liste, neuste zuerst.
// Spricht ausschliesslich über den Kern mit der Datenbank.

import {
  put, abfrage, haengeAnhangAn, holeAnhang, entferneDokument, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { oeffneHandnotiz } from '../kern/handschrift.js';
import { oeffneBericht } from '../kern/pdf.js';
import {
  esc, formatDatumZeit, regieTreffer, schadenTreffer, zeigeBildVollbild,
} from '../kern/ui.js';

const TAGS = ['Vorzustand', 'Fortschritt', 'Mangel', 'Regie', 'Abnahme'];

export default {
  name: 'Journal',
  dokumentTypen: ['ereignis'],

  render(container, baustelle) {
    const filter = new Set(); // gewählte Tag-Chips; leer = alle zeigen
    let gewaehlteFotos = []; // Dateien, die beim Speichern angehängt werden
    let inBearbeitung = null; // Ereignis, das gerade im Formular steht
    let regieAbgelehnt = ''; // «Nein, keine Regie» für genau diesen Hinweis
    const objektUrls = []; // erzeugte Foto-URLs, beim Neuzeichnen freigeben

    container.innerHTML = `
      <section class="journal">
        <h2>Journal · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <form class="karte formular" data-rolle="erfassung">
          <div class="chips" data-rolle="tag-wahl">
            ${TAGS.map((tag) => `
              <label class="chip-wahl">
                <input type="radio" name="tag" value="${tag}"
                  ${tag === 'Fortschritt' ? 'checked' : ''}>
                <span>${tag}</span>
              </label>`).join('')}
          </div>
          <label>Ort / KV<input name="ortKv" autocomplete="off"></label>
          <label>Notiz<textarea name="notiz" rows="3"></textarea></label>
          <div class="regie-erkannt regie-vorschlag" data-rolle="regie-vorschlag"
            role="status" hidden></div>
          <div class="knopfzeile">
            <label class="foto-feld">
              <span class="knopf">📷 Foto aufnehmen</span>
              <input type="file" accept="image/*" capture="environment" multiple
                data-rolle="foto-eingabe" class="visually-hidden">
            </label>
            <button type="button" class="knopf" data-rolle="handnotiz">✍ Handnotiz</button>
          </div>
          <p class="hinweis" data-rolle="foto-info"></p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Eintrag speichern</button>
            <button type="button" class="knopf" data-aktion="bearbeiten-abbrechen" hidden>
              Abbrechen
            </button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div class="listen-kopf">
          <div class="chips" data-rolle="filter"></div>
          <button type="button" class="knopf" data-rolle="bericht">PDF-Bericht</button>
        </div>
        <input type="file" accept="image/*" capture="environment" multiple
          data-rolle="foto-nachtrag" class="visually-hidden">
        <div data-rolle="liste"></div>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const fotoEingabe = formular.querySelector('[data-rolle="foto-eingabe"]');
    const fotoInfo = formular.querySelector('[data-rolle="foto-info"]');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    function zeigeFotoInfo() {
      fotoInfo.textContent = gewaehlteFotos.length
        ? `${gewaehlteFotos.length} Foto${gewaehlteFotos.length > 1 ? 's' : ''} bereit — ` +
          'nochmals antippen für ein weiteres.'
        : '';
    }

    // Jede Aufnahme wird gesammelt; so sind mehrere Fotos pro Eintrag möglich,
    // obwohl die Kamera pro Antippen nur ein Bild liefert.
    fotoEingabe.addEventListener('change', () => {
      gewaehlteFotos.push(...fotoEingabe.files);
      fotoEingabe.value = '';
      zeigeFotoInfo();
    });

    // Handnotiz zeichnen — landet wie ein Foto beim Eintrag.
    formular.querySelector('[data-rolle="handnotiz"]').addEventListener('click', async () => {
      const blob = await oeffneHandnotiz();
      if (!blob) return;
      gewaehlteFotos.push(new File([blob], `handnotiz-${Date.now()}.png`, { type: 'image/png' }));
      zeigeFotoInfo();
    });

    // Regie-Vorschlag: Notiz klingt nach Regie, Tag ist aber ein anderer.
    // Nichts geschieht automatisch — erst «Tag auf Regie setzen» führt
    // beim Speichern zum gewohnten Ablauf (Nachtrag + Pendenz).
    const vorschlag = formular.querySelector('[data-rolle="regie-vorschlag"]');

    function gewaehlterTag() {
      return formular.querySelector('input[name="tag"]:checked')?.value || '';
    }

    function zeigeRegieVorschlag() {
      const notiz = formular.elements.notiz.value;
      const treffer = regieTreffer(notiz);
      const schaden = schadenTreffer(notiz);
      const offen = gewaehlterTag() !== 'Regie'
        && ((treffer && treffer !== regieAbgelehnt) || (schaden && schaden !== regieAbgelehnt));
      vorschlag.hidden = !offen;
      vorschlag.dataset.treffer = offen ? (treffer || schaden) : '';
      vorschlag.dataset.verbindlich = offen && treffer ? '1' : '';
      if (!offen) { vorschlag.innerHTML = ''; return; }
      vorschlag.innerHTML = `
        <p>${treffer
          ? `Regie-Hinweis erkannt: «${esc(treffer)}». Als Regie erfassen? Beim Speichern
             entstehen dann Nachtrag (erkannt) und Pendenz.`
          : `Leitungsschaden («${esc(schaden)}») – Regie prüfen? War die Leitung nicht
             ersichtlich oder nicht im Plan, Tag «Regie» wählen.`}</p>
        <div class="knopfzeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="regie-uebernehmen">
            Tag auf «Regie» setzen</button>
          <button type="button" class="knopf" data-aktion="regie-ablehnen">Keine Regie</button>
        </div>`;
    }

    formular.elements.notiz.addEventListener('input', zeigeRegieVorschlag);
    formular.querySelector('[data-rolle="tag-wahl"]').addEventListener('change', zeigeRegieVorschlag);
    vorschlag.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      if (knopf.dataset.aktion === 'regie-uebernehmen') {
        formular.querySelector('input[name="tag"][value="Regie"]').checked = true;
        meldung.textContent = 'Tag «Regie» gewählt — beim Speichern entstehen Nachtrag und Pendenz.';
      } else {
        regieAbgelehnt = vorschlag.dataset.treffer;
        meldung.textContent = '';
      }
      zeigeRegieVorschlag();
    });

    function zeichneFilter() {
      filterElement.innerHTML = TAGS.map((tag) => `
        <button type="button" class="chip chip-knopf${filter.has(tag) ? ' aktiv' : ''}"
          data-tag="${tag}">${tag}</button>`).join('');
    }

    // Eintrag mit Regie-Hinweis, aber anderem Tag (z. B. älter oder
    // importiert): nur anzeigen, «Prüfen» öffnet ihn mit dem Vorschlag.
    function regieKartenHinweis(e) {
      const treffer = e.tag !== 'Regie' && regieTreffer(e.notiz);
      if (!treffer || treffer === e.regieHinweisAbgelehnt) return '';
      return `<p class="regie-erkannt regie-warnung">⚠ Regie-Hinweis «${esc(treffer)}» —
        Tag ist «${esc(e.tag)}».
        <button type="button" class="knopf eintrag-loeschen" data-aktion="eintrag-bearbeiten"
          data-id="${esc(e._id)}">Prüfen</button></p>`;
    }

    async function zeichneListe() {
      objektUrls.forEach(URL.revokeObjectURL);
      objektUrls.length = 0;
      const alle = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
      const gezeigt = filter.size ? alle.filter((e) => filter.has(e.tag)) : alle;
      listeElement.innerHTML = gezeigt.length
        ? gezeigt.map((e) => {
            const fotos = Object.keys(e._attachments || {});
            return `
              <article class="karte ereignis">
                <div class="ereignis-kopf">
                  <span class="chip">${esc(e.tag)}</span>
                  ${e.wiederholung > 1
                    ? `<span class="chip wiederhol-chip">⚠ ${e.wiederholung}. Mal</span>` : ''}
                  <span class="hinweis">${formatDatumZeit(e.datum)}${
                    e.ortKv ? ' · ' + esc(e.ortKv) : ''}</span>
                  <span class="rapport-knoepfe">
                    <button type="button" class="knopf eintrag-loeschen"
                      data-aktion="eintrag-bearbeiten" data-id="${esc(e._id)}">Bearbeiten</button>
                    <button type="button" class="knopf eintrag-loeschen"
                      data-aktion="foto-plus" data-id="${esc(e._id)}"
                      aria-label="Foto ergänzen">+ 📷</button>
                    <button type="button" class="knopf eintrag-loeschen"
                      data-aktion="loeschen" data-id="${esc(e._id)}"
                      aria-label="Eintrag löschen">Löschen</button>
                  </span>
                </div>
                ${e.notiz ? `<p class="ereignis-notiz">${esc(e.notiz)}</p>` : ''}
                ${e.quelleText ? `<p class="hinweis verknuepfung">↳ ${esc(e.quelleText)}</p>` : ''}
                ${regieKartenHinweis(e)}
                ${fotos.length ? `
                  <div class="foto-reihe">
                    ${fotos.map((name) => `
                      <img class="foto-thumb" alt="Foto zum Eintrag" loading="lazy"
                        data-id="${esc(e._id)}" data-name="${esc(name)}">`).join('')}
                  </div>` : ''}
              </article>`;
          }).join('')
        : `<p class="hinweis">${
            alle.length
              ? 'Keine Einträge zu dieser Tag-Auswahl.'
              : 'Noch keine Einträge auf dieser Baustelle.'}</p>`;

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

    function zeigeVollbild(quelle, docId, name) {
      zeigeBildVollbild(quelle, {
        onLoeschen: async () => {
          await entferneAnhang(docId, name);
          await zeichneListe();
        },
      });
    }

    container.querySelector('[data-rolle="bericht"]')
      .addEventListener('click', () => oeffneBericht(baustelle));

    filterElement.addEventListener('click', (klick) => {
      const knopf = klick.target.closest('[data-tag]');
      if (!knopf) return;
      const tag = knopf.dataset.tag;
      filter.has(tag) ? filter.delete(tag) : filter.add(tag);
      zeichneFilter();
      zeichneListe();
    });

    // Fotos nachträglich an einen bestehenden Eintrag hängen (z. B. an
    // Mängel, die eine Begehung automatisch erzeugt hat).
    const fotoNachtrag = container.querySelector('[data-rolle="foto-nachtrag"]');
    let fotoZielId = null;

    fotoNachtrag.addEventListener('change', async () => {
      const dateien = [...fotoNachtrag.files];
      fotoNachtrag.value = '';
      if (!fotoZielId || !dateien.length) return;
      for (const [index, datei] of dateien.entries()) {
        const klein = await verkleinereFoto(datei);
        await haengeAnhangAn(fotoZielId,
          `foto-${Date.now().toString(36)}-${index}.jpg`, klein);
      }
      fotoZielId = null;
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await zeichneListe();
    });

    // Bestehenden Eintrag ins Formular laden (Fotos bleiben erhalten).
    function fuelleFormular(ereignis) {
      inBearbeitung = ereignis;
      const abbrechen = formular.querySelector('[data-aktion="bearbeiten-abbrechen"]');
      abbrechen.hidden = !ereignis;
      const tagWahl = formular.querySelector(`input[value="${ereignis?.tag || 'Fortschritt'}"]`);
      if (tagWahl) tagWahl.checked = true;
      formular.elements.ortKv.value = ereignis?.ortKv ?? '';
      formular.elements.notiz.value = ereignis?.notiz ?? '';
      regieAbgelehnt = ereignis?.regieHinweisAbgelehnt || '';
      zeigeRegieVorschlag();
      meldung.textContent = ereignis
        ? `Eintrag vom ${formatDatumZeit(ereignis.datum)} bearbeiten — Fotos bleiben erhalten.`
        : '';
      if (ereignis) formular.scrollIntoView({ behavior: 'smooth' });
    }

    formular.querySelector('[data-aktion="bearbeiten-abbrechen"]')
      .addEventListener('click', () => fuelleFormular(null));

    listeElement.addEventListener('click', async (klick) => {
      const bearbeitenKnopf = klick.target.closest('[data-aktion="eintrag-bearbeiten"]');
      if (bearbeitenKnopf) {
        const alle = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
        const ereignis = alle.find((e) => e._id === bearbeitenKnopf.dataset.id);
        if (ereignis) fuelleFormular(ereignis);
        return;
      }
      const fotoKnopf = klick.target.closest('[data-aktion="foto-plus"]');
      if (fotoKnopf) {
        fotoZielId = fotoKnopf.dataset.id;
        fotoNachtrag.click();
        return;
      }
      const loeschKnopf = klick.target.closest('[data-aktion="loeschen"]');
      if (loeschKnopf) {
        if (confirm('Diesen Eintrag endgültig löschen? Zugehörige Fotos werden mitgelöscht.')) {
          await entferneDokument(loeschKnopf.dataset.id);
          if (inBearbeitung?._id === loeschKnopf.dataset.id) fuelleFormular(null);
          await zeichneListe();
        }
        return;
      }
      const bild = klick.target.closest('.foto-thumb');
      if (bild?.src) zeigeVollbild(bild.src, bild.dataset.id, bild.dataset.name);
    });

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      // Offener Regie-Vorschlag: erst beantworten lassen, nicht raten.
      if (vorschlag.dataset.verbindlich) {
        meldung.textContent = 'Bitte zuerst den Regie-Vorschlag beantworten.';
        vorschlag.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const felder = Object.fromEntries(new FormData(formular));
      const speichernKnopf = formular.querySelector('[type="submit"]');
      speichernKnopf.disabled = true;
      try {
        const warBearbeitung = !!inBearbeitung;
        const vorherTag = inBearbeitung?.tag;
        // «Keine Regie» merken, damit die Liste nicht weiter mahnt.
        const abgelehnt = felder.tag !== 'Regie' && regieAbgelehnt
          && [regieTreffer(felder.notiz), schadenTreffer(felder.notiz)].includes(regieAbgelehnt)
          ? regieAbgelehnt : undefined;
        const doc = await put(warBearbeitung
          ? {
              ...inBearbeitung,
              tag: felder.tag,
              ortKv: (felder.ortKv || '').trim(),
              notiz: (felder.notiz || '').trim(),
              regieHinweisAbgelehnt: abgelehnt,
            }
          : {
              typ: 'ereignis',
              baustelleId: baustelle.baustelleId,
              tag: felder.tag,
              ortKv: (felder.ortKv || '').trim(),
              notiz: (felder.notiz || '').trim(),
              regieHinweisAbgelehnt: abgelehnt,
            });
        // Fotos einzeln verarbeiten, mit sichtbarem Fortschritt.
        const anzahl = gewaehlteFotos.length;
        for (const [index, datei] of gewaehlteFotos.entries()) {
          meldung.textContent = `Foto ${index + 1} von ${anzahl} wird verarbeitet …`;
          const blob = await verkleinereFoto(datei);
          await haengeAnhangAn(doc._id,
            `foto-${Date.now().toString(36)}-${index + 1}.jpg`, blob);
        }
        // Regie heisst: Nachtrag erkannt — Nachtrag und Pendenz entstehen
        // automatisch bei NEUEN Einträgen. Beim Bearbeiten nur, wenn der
        // Tag neu auf Regie wechselt (z. B. nach dem Regie-Vorschlag) und
        // noch kein Nachtrag auf diesen Eintrag verweist — keine Duplikate.
        const nachtraege = doc.tag === 'Regie'
          ? await abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId })
          : [];
        const neuRegie = doc.tag === 'Regie' && (!warBearbeitung || (vorherTag !== 'Regie'
          && !nachtraege.some((n) => n.beweise?.ereignisIds?.includes(doc._id))));
        if (neuRegie) {
          const nummer = `N-${String(nachtraege.length + 1).padStart(2, '0')}`;
          const nachtrag = await put({
            typ: 'nachtrag',
            baustelleId: baustelle.baustelleId,
            nummer,
            titel: `Regie vom ${formatDatumZeit(doc.datum).split(',')[0]}${
              doc.ortKv ? ' · ' + doc.ortKv : ''}`,
            sachverhalt: doc.notiz || '',
            basis: '',
            summe: '',
            status: 'erkannt',
            statusHistorie: [{ status: 'erkannt', datum: new Date().toISOString().slice(0, 10) }],
            beweise: { ereignisIds: [doc._id], rapportIds: [], ausmassIds: [] },
          });
          await put({
            typ: 'pendenz',
            baustelleId: baustelle.baustelleId,
            text: `Nachtrag ${nummer} beziffern/melden`,
            prioritaet: 'hoch',
            termin: '',
            verantwortlich: '',
            erledigtAm: '',
            notiz: `Aus Regie-Ereignis vom ${formatDatumZeit(doc.datum)}${
              doc.ortKv ? ' · ' + doc.ortKv : ''}`,
            ereignisId: doc._id,
            nachtragId: nachtrag._id,
          });
        }
        formular.elements.ortKv.value = '';
        formular.elements.notiz.value = '';
        gewaehlteFotos = [];
        zeigeFotoInfo();
        const alteBearbeitung = warBearbeitung;
        inBearbeitung = null;
        formular.querySelector('[data-aktion="bearbeiten-abbrechen"]').hidden = true;
        meldung.textContent = neuRegie
          ? `Eintrag ${alteBearbeitung ? 'aktualisiert' : 'gespeichert'} — Nachtrag (erkannt) und Pendenz erstellt.`
          : alteBearbeitung ? 'Eintrag aktualisiert.' : 'Eintrag gespeichert.';
        regieAbgelehnt = '';
        zeigeRegieVorschlag();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      } finally {
        speichernKnopf.disabled = false;
      }
    });

    zeichneFilter();
    zeichneListe();
  },
};
