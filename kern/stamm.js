// kern/stamm.js — Baustellen-Stamm: Daten (anlegen/bearbeiten/archivieren,
// JSON-Import) und die Stamm-Ansicht für den Modulbereich.

import { put, get, abfrage, neueId } from './speicher.js';
import { esc } from './ui.js';
import {
  istGueltigeIban, istQrIban, formatIban, kompakt, mwstSatzAus,
  MWST_SATZ_STANDARD,
} from './zahlung.js';

// ---------- Daten ----------

export async function alleBaustellen({ mitArchivierten = false } = {}) {
  const alle = await abfrage({ typ: 'baustelle' });
  alle.sort((a, b) => (a.ktr || '').localeCompare(b.ktr || '', 'de-CH', { numeric: true }));
  return mitArchivierten ? alle : alle.filter((b) => !b.archiviert);
}

export async function speichereBaustelle(felder, vorhandene = null) {
  const doc = vorhandene
    ? { ...vorhandene }
    : (() => {
        const id = neueId('baustelle');
        return { _id: id, typ: 'baustelle', baustelleId: id, archiviert: false };
      })();
  doc.ktr = (felder.ktr || '').trim();
  doc.name = (felder.name || '').trim();
  doc.ort = (felder.ort || '').trim();
  doc.bauherr = (felder.bauherr || '').trim();
  doc.werkvertrag = (felder.werkvertrag || '').trim();
  if (!doc.ktr || !doc.name) throw new Error('KTR-Nr. und Name sind Pflichtfelder.');
  return put(doc);
}

export async function setzeArchiviert(baustelle, archiviert) {
  return put({ ...baustelle, archiviert });
}

// JSON-Import: Liste von Objekten mit ktr, name, optional ort/bauherr/werkvertrag.
// Vorhandene KTR-Nummern werden übersprungen (ergänzen statt überschreiben).
export async function importiereBaustellen(jsonText) {
  let liste;
  try {
    liste = JSON.parse(jsonText);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (!Array.isArray(liste)) throw new Error('Erwartet wird eine JSON-Liste von Baustellen.');
  const bekannt = new Set((await alleBaustellen({ mitArchivierten: true })).map((b) => b.ktr));
  let neu = 0;
  let uebersprungen = 0;
  for (const eintrag of liste) {
    const ktr = String(eintrag?.ktr ?? '').trim();
    const name = String(eintrag?.name ?? '').trim();
    if (!ktr || !name || bekannt.has(ktr)) {
      uebersprungen++;
      continue;
    }
    await speichereBaustelle({
      ktr,
      name,
      ort: String(eintrag.ort ?? ''),
      bauherr: String(eintrag.bauherr ?? ''),
      werkvertrag: String(eintrag.werkvertrag ?? ''),
    });
    bekannt.add(ktr);
    neu++;
  }
  return { neu, uebersprungen };
}

// ---------- Firmendaten ----------
// Ein Dokument für die eigene Firma: Absender der Rechnungen und
// Zahlungsempfänger im QR-Zahlteil (Adresse strukturiert, IBAN).

const FIRMA_ID = 'firma:stamm';
const FIRMA_FELDER = ['name', 'strasse', 'hausnummer', 'plz', 'ort', 'land', 'iban',
  'telefon', 'email', 'mwstNr', 'mwstSatz',
  'mahnTageErinnerung', 'mahnTageMahnung1', 'mahnTageMahnung2'];

// Mahnfristen in Tagen ab Rechnungsdatum (nicht ab Fälligkeit), Entscheid
// Tobias 12.11.2026: Zahlungserinnerung nach 30, 1. Mahnung nach 60,
// 2. Mahnung nach 75 Tagen. In den Firmendaten änderbar; leer = Standard.
// Gebraucht von der Firmendaten-Ansicht und module/rechnung.js.
export const MAHN_TAGE_STANDARD = [30, 60, 75];
const MAHN_FELDER = ['mahnTageErinnerung', 'mahnTageMahnung1', 'mahnTageMahnung2'];

function mahnTageAus(wert) {
  const text = String(wert ?? '').trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  return Number(text);
}

// Die drei Fristen der Firma: [Zahlungserinnerung, 1. Mahnung, 2. Mahnung].
export function mahnFristenFirma(firma) {
  return MAHN_FELDER.map((feld, i) => mahnTageAus(firma?.[feld]) ?? MAHN_TAGE_STANDARD[i]);
}

// MWST-Satz der Firma in Prozent (leer → Standard 8.1 %). Gilt für neue
// Rechnungen und Offerten (dort bei Erstellung festgehalten).
export function mwstSatzFirma(firma) {
  return mwstSatzAus(firma?.mwstSatz) ?? MWST_SATZ_STANDARD;
}

// Warnung: MWST wird verrechnet (Satz > 0), aber in den Firmendaten fehlt
// die MWST-Nr. — sie gehört auf jede Rechnung mit MWST. Blockiert nichts.
// Gebraucht von der Firmendaten-Ansicht und module/rechnung.js.
export function mwstNrWarnung(firma) {
  const satz = mwstSatzFirma(firma);
  if (satz <= 0 || String(firma?.mwstNr ?? '').trim()) return '';
  return `⚠ MWST ${satz.toLocaleString('de-CH', { maximumFractionDigits: 4 })} % wird verrechnet, `
    + 'aber in den Firmendaten fehlt die MWST-Nr. (CHE-…). Sie gehört auf jede '
    + 'Rechnung mit MWST, bitte unter ⚙ Firmendaten nachtragen.';
}

export async function ladeFirma() {
  let firma = null;
  try {
    firma = await get(FIRMA_ID);
  } catch {
    firma = null;
  }
  return firma;
}

export async function speichereFirma(felder) {
  const vorhanden = await ladeFirma();
  const doc = vorhanden
    ? { ...vorhanden }
    : { _id: FIRMA_ID, typ: 'firma', baustelleId: 'firma' };
  for (const feld of FIRMA_FELDER) doc[feld] = String(felder[feld] ?? '').trim();
  doc.land = (doc.land || 'CH').toUpperCase().slice(0, 2);
  doc.iban = kompakt(doc.iban);
  doc.datum = new Date().toISOString();
  if (!doc.name) throw new Error('Firmenname ist ein Pflichtfeld.');
  if (doc.mwstSatz) {
    const satz = mwstSatzAus(doc.mwstSatz);
    if (satz === null) throw new Error('MWST-Satz ungültig, Prozent zwischen 0 und 99.9, z. B. 8.1.');
    doc.mwstSatz = String(satz);
  }
  for (const feld of MAHN_FELDER) {
    if (doc[feld] && mahnTageAus(doc[feld]) === null) {
      throw new Error('Mahnfristen: ganze Tage angeben, z. B. 30.');
    }
  }
  const fristen = mahnFristenFirma(doc);
  if (!(fristen[0] < fristen[1] && fristen[1] < fristen[2])) {
    throw new Error('Mahnfristen müssen aufsteigen: Zahlungserinnerung < 1. Mahnung < 2. Mahnung.');
  }
  if (doc.iban && !istGueltigeIban(doc.iban)) {
    throw new Error('IBAN ungültig, Prüfziffer stimmt nicht. Bitte genau abschreiben.');
  }
  return put(doc);
}

// ---------- Ansicht ----------

// Zeichnet die Stamm-Ansicht in den Container. onAenderung wird nach jeder
// Änderung am Bestand gerufen (die Shell aktualisiert damit die Kopfzeile).
export function renderStammAnsicht(container, { onAenderung = () => {} } = {}) {
  container.innerHTML = `
    <section class="stamm">
      <h2>Baustellen-Stamm</h2>

      <form class="karte formular" data-rolle="formular">
        <h3 data-rolle="formular-titel">Neue Baustelle</h3>
        <label>KTR-Nr. *<input name="ktr" required autocomplete="off"></label>
        <label>Name *<input name="name" required autocomplete="off"></label>
        <label>Ort<input name="ort" autocomplete="off"></label>
        <label>Bauherr<input name="bauherr" autocomplete="off"></label>
        <label>Werkvertrag<input name="werkvertrag" autocomplete="off"
          placeholder="z. B. Vertrags-Nr. oder Summe"></label>
        <div class="knopfzeile">
          <button type="submit" class="knopf knopf-primaer">Speichern</button>
          <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
        </div>
        <p class="meldung" role="status"></p>
      </form>

      <div data-rolle="liste"></div>

      <details class="karte import" data-rolle="firma-bereich">
        <summary>Firmendaten (Rechnungen, QR-Zahlteil)</summary>
        <form class="formular" data-rolle="firma-formular">
          <p class="hinweis">Absender der Rechnungen und Zahlungsempfänger im
            QR-Zahlteil. Die IBAN wird mit der Prüfziffer kontrolliert, normale
            IBAN des Geschäftskontos, keine QR-IBAN.</p>
          <label>Firmenname *<input name="name" required autocomplete="organization"></label>
          <div class="feld-reihe">
            <label class="feld-breit">Strasse<input name="strasse" autocomplete="address-line1"></label>
            <label class="feld-schmal">Nr.<input name="hausnummer" autocomplete="off"></label>
          </div>
          <div class="feld-reihe">
            <label class="feld-schmal">PLZ<input name="plz" inputmode="numeric" autocomplete="postal-code"></label>
            <label class="feld-breit">Ort<input name="ort" autocomplete="address-level2"></label>
            <label class="feld-schmal">Land<input name="land" maxlength="2" placeholder="CH"
              autocomplete="country"></label>
          </div>
          <label>IBAN<input name="iban" autocomplete="off" spellcheck="false"
            placeholder="CH00 0000 0000 0000 0000 0"></label>
          <p class="hinweis" data-rolle="iban-pruefung"></p>
          <div class="feld-reihe">
            <label>Telefon<input name="telefon" type="tel" autocomplete="tel"></label>
            <label>E-Mail<input name="email" type="email" autocomplete="email"></label>
          </div>
          <div class="feld-reihe">
            <label class="feld-breit">MWST-Nr.<input name="mwstNr" autocomplete="off" placeholder="CHE-123.456.789 MWST"></label>
            <label class="feld-schmal">MWST [%]<input name="mwstSatz" aria-label="MWST-Satz in Prozent" type="number" inputmode="decimal"
              step="any" min="0" max="99.9" placeholder="${MWST_SATZ_STANDARD}"></label>
          </div>
          <p class="mwst-warnung" data-rolle="mwst-nr-warnung" role="alert" hidden></p>
          <p class="hinweis">Der MWST-Satz gilt für neue Rechnungen und Offerten und wird
            dort beim Erstellen festgehalten, bestehende behalten ihren Satz.
            0 = ohne MWST.</p>
          <fieldset class="mahn-fristen">
            <legend>Mahnfristen [Tage ab Rechnungsdatum]</legend>
            <div class="feld-reihe">
              <label class="mahn-tage">Zahlungserinnerung<input name="mahnTageErinnerung" type="number"
                inputmode="numeric" min="1" step="1" placeholder="${MAHN_TAGE_STANDARD[0]}"></label>
              <label class="mahn-tage">1. Mahnung<input name="mahnTageMahnung1" type="number"
                inputmode="numeric" min="1" step="1" placeholder="${MAHN_TAGE_STANDARD[1]}"></label>
              <label class="mahn-tage">2. Mahnung<input name="mahnTageMahnung2" type="number"
                inputmode="numeric" min="1" step="1" placeholder="${MAHN_TAGE_STANDARD[2]}"></label>
            </div>
            <p class="hinweis">Ab wann eine Rechnung zur nächsten Stufe fällig wird,
              gezählt ab Rechnungsdatum. Leer = ${MAHN_TAGE_STANDARD.join(' / ')} Tage.</p>
          </fieldset>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Firmendaten speichern</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>
      </details>

      <details class="karte import">
        <summary>Baustellenliste aus JSON importieren</summary>
        <p class="hinweis">Erwartet eine JSON-Liste von Objekten mit <code>ktr</code> und
          <code>name</code>, optional <code>ort</code>, <code>bauherr</code>,
          <code>werkvertrag</code>. Bereits vorhandene KTR-Nummern werden übersprungen.</p>
        <input type="file" accept=".json,application/json" data-rolle="import-datei">
        <p class="meldung" role="status"></p>
      </details>

      <details class="karte import">
        <summary>Gerätemodus (Polier-Modus)</summary>
        <p class="hinweis">Im <b>Polier-Modus</b> zeigt dieses Gerät nur die
          Tagesrapporte, schnell und übersichtlich für die Stundenerfassung.
          Erfasste Rapporte gehen per «Übergeben»-Knopf an den Bauführer.
          Einrichtung: Baustellen vorher per Lünse-Backup-Import übernehmen
          (Import-Knopf), damit die Rapporte zur richtigen Baustelle passen.
          Der Modus gilt nur für dieses Gerät und ist hier jederzeit umschaltbar.</p>
        <p class="hinweis">Aktuell: <b data-rolle="modus-anzeige"></b></p>
        <div class="knopfzeile">
          <button type="button" class="knopf" data-rolle="modus-schalter"></button>
        </div>
      </details>
    </section>`;

  const formular = container.querySelector('[data-rolle="formular"]');
  const formularTitel = container.querySelector('[data-rolle="formular-titel"]');
  const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
  const formularMeldung = formular.querySelector('.meldung');
  const listeElement = container.querySelector('[data-rolle="liste"]');
  const importDatei = container.querySelector('[data-rolle="import-datei"]');
  const importMeldung = importDatei.closest('.import').querySelector('.meldung');

  let inBearbeitung = null; // Baustellen-Dokument, das gerade im Formular steht

  function fuelleFormular(baustelle) {
    inBearbeitung = baustelle;
    formularTitel.textContent = baustelle
      ? `Baustelle ${baustelle.ktr} bearbeiten`
      : 'Neue Baustelle';
    abbrechenKnopf.hidden = !baustelle;
    for (const feld of ['ktr', 'name', 'ort', 'bauherr', 'werkvertrag']) {
      formular.elements[feld].value = baustelle?.[feld] ?? '';
    }
    formularMeldung.textContent = '';
  }

  function baustellenKarte(b) {
    const details = [b.ort, b.bauherr, b.werkvertrag].filter(Boolean).map(esc).join(' · ');
    return `
      <article class="karte baustelle${b.archiviert ? ' archiviert' : ''}">
        <div class="baustelle-kopf">
          <strong>${esc(b.ktr)}</strong> ${esc(b.name)}
          ${b.demo ? '<span class="chip beispiel-chip">Beispiel</span>' : ''}
          ${b.archiviert ? '<span class="chip">archiviert</span>' : ''}
        </div>
        ${details ? `<p class="hinweis">${details}</p>` : ''}
        <div class="knopfzeile">
          <button type="button" class="knopf" data-aktion="bearbeiten" data-id="${esc(b._id)}">Bearbeiten</button>
          <button type="button" class="knopf" data-aktion="${b.archiviert ? 'aktivieren' : 'archivieren'}"
            data-id="${esc(b._id)}">${b.archiviert ? 'Aktivieren' : 'Archivieren'}</button>
        </div>
      </article>`;
  }

  async function zeichneListe() {
    const alle = await alleBaustellen({ mitArchivierten: true });
    const aktive = alle.filter((b) => !b.archiviert);
    const archivierte = alle.filter((b) => b.archiviert);
    listeElement.innerHTML = `
      ${aktive.length ? aktive.map(baustellenKarte).join('') : '<p class="hinweis">Noch keine aktiven Baustellen.</p>'}
      ${archivierte.length ? `
        <details class="archiv">
          <summary>Archivierte Baustellen (${archivierte.length})</summary>
          ${archivierte.map(baustellenKarte).join('')}
        </details>` : ''}`;
  }

  formular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const felder = Object.fromEntries(new FormData(formular));
    try {
      await speichereBaustelle(felder, inBearbeitung);
      fuelleFormular(null);
      await zeichneListe();
      onAenderung();
    } catch (fehler) {
      formularMeldung.textContent = fehler.message;
    }
  });

  abbrechenKnopf.addEventListener('click', () => fuelleFormular(null));

  listeElement.addEventListener('click', async (ereignis) => {
    const knopf = ereignis.target.closest('button[data-aktion]');
    if (!knopf) return;
    const alle = await alleBaustellen({ mitArchivierten: true });
    const baustelle = alle.find((b) => b._id === knopf.dataset.id);
    if (!baustelle) return;
    if (knopf.dataset.aktion === 'bearbeiten') {
      fuelleFormular(baustelle);
      formular.scrollIntoView({ behavior: 'smooth' });
    } else {
      await setzeArchiviert(baustelle, knopf.dataset.aktion === 'archivieren');
      if (inBearbeitung?._id === baustelle._id) fuelleFormular(null);
      await zeichneListe();
      onAenderung();
    }
  });

  importDatei.addEventListener('change', async () => {
    const datei = importDatei.files[0];
    if (!datei) return;
    try {
      const ergebnis = await importiereBaustellen(await datei.text());
      importMeldung.textContent =
        `${ergebnis.neu} neu importiert, ${ergebnis.uebersprungen} übersprungen.`;
      await zeichneListe();
      onAenderung();
    } catch (fehler) {
      importMeldung.textContent = fehler.message;
    } finally {
      importDatei.value = '';
    }
  });

  // Gerätemodus: Polier-Modus zeigt nur die Tagesrapporte (nur UI-Zustand
  // dieses Geräts — localStorage, keine Daten). Die Shell liest den Wert
  // beim Start; Umschalten lädt darum neu.
  const MODUS_MERKER = 'luense.modus';
  const modusAnzeige = container.querySelector('[data-rolle="modus-anzeige"]');
  const modusSchalter = container.querySelector('[data-rolle="modus-schalter"]');

  function zeigeModus() {
    const polier = localStorage.getItem(MODUS_MERKER) === 'polier';
    modusAnzeige.textContent = polier
      ? 'Polier-Modus (nur Tagesrapporte)' : 'Vollmodus (alle Module)';
    modusSchalter.textContent = polier
      ? 'Vollmodus einschalten' : 'Polier-Modus einschalten';
  }

  modusSchalter.addEventListener('click', () => {
    const polier = localStorage.getItem(MODUS_MERKER) === 'polier';
    if (polier) {
      localStorage.removeItem(MODUS_MERKER);
    } else {
      localStorage.setItem(MODUS_MERKER, 'polier');
    }
    location.reload();
  });

  // Firmendaten: laden, IBAN beim Tippen prüfen, speichern.
  const firmaFormular = container.querySelector('[data-rolle="firma-formular"]');
  const ibanPruefung = firmaFormular.querySelector('[data-rolle="iban-pruefung"]');
  const pruefeIban = () => {
    const iban = kompakt(firmaFormular.elements.iban.value);
    if (!iban) {
      ibanPruefung.textContent = 'Ohne IBAN entsteht kein QR-Zahlteil.';
    } else if (!istGueltigeIban(iban)) {
      ibanPruefung.textContent = '✗ IBAN ungültig (Prüfziffer oder Länge).';
    } else if (istQrIban(iban)) {
      ibanPruefung.textContent = '⚠ Das ist eine QR-IBAN, für SCOR-Referenzen die normale IBAN eintragen.';
    } else {
      ibanPruefung.textContent = `✓ IBAN gültig: ${formatIban(iban)}`;
    }
  };
  const mwstWarnung = firmaFormular.querySelector('[data-rolle="mwst-nr-warnung"]');
  const pruefeMwstNr = () => {
    const text = mwstNrWarnung({
      mwstNr: firmaFormular.elements.mwstNr.value,
      mwstSatz: firmaFormular.elements.mwstSatz.value,
    });
    mwstWarnung.textContent = text;
    mwstWarnung.hidden = !text;
  };
  firmaFormular.elements.mwstNr.addEventListener('input', pruefeMwstNr);
  firmaFormular.elements.mwstSatz.addEventListener('input', pruefeMwstNr);
  ladeFirma().then((firma) => {
    for (const feld of FIRMA_FELDER) {
      firmaFormular.elements[feld].value = feld === 'iban'
        ? formatIban(firma?.iban || '') : (firma?.[feld] ?? '');
    }
    if (!String(firma?.mwstSatz ?? '').trim()) {
      firmaFormular.elements.mwstSatz.value = String(MWST_SATZ_STANDARD);
    }
    if (!firma) firmaFormular.elements.land.value = 'CH';
    mahnFristenFirma(firma).forEach((tage, i) => {
      const feld = firmaFormular.elements[MAHN_FELDER[i]];
      if (!String(feld.value).trim()) feld.value = String(tage);
    });
    pruefeIban();
    pruefeMwstNr();
  });
  firmaFormular.elements.iban.addEventListener('input', pruefeIban);
  firmaFormular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const meldung = firmaFormular.querySelector('.meldung');
    try {
      await speichereFirma(Object.fromEntries(new FormData(firmaFormular)));
      meldung.textContent = 'Firmendaten gespeichert.';
      pruefeIban();
    } catch (fehler) {
      meldung.textContent = fehler.message;
    }
  });

  zeigeModus();
  fuelleFormular(null);
  zeichneListe();
}
