// module/kreditor.js — Kreditoren: Lieferanten-/Subunternehmerrechnungen
// je Baustelle (Abend 9.1). Workflow nach dem Vorbild professioneller
// Bau-ERP (Visumskontrolle): erfassen und kontieren → visieren (mit
// Bemerkung) → bezahlen — jeder Schritt mit Datumsstempel. Dazu:
// Skonto-Fristen-Überwachung (nie mehr Skonto verpassen), Fälligkeits-
// warnung, Doppelerfassungs-Schutz (Lieferant + Rechnungs-Nr.),
// Beleg als Foto oder PDF am Dokument, Excel-Export.
// Die Kostenart entspricht den Selbstkosten-Gruppen des Controllings —
// die Verknüpfung dorthin folgt in Abend 9.3.

import {
  put, abfrage, entferneDokument, haengeAnhangAn, holeAnhang, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { exportiereCsv } from '../kern/export.js';
import { esc, zeigeBildVollbild } from '../kern/ui.js';

const KREDITOR_STATUS = ['offen', 'visiert', 'bezahlt'];
const KOSTENARTEN = ['Material', 'Fremdleistung', 'Inventar/Miete', 'Entsorgung', 'Diverses'];
const ZAHLUNGSFRIST_TAGE = 30;

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${(n || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
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

function plusTage(tagIso, tage) {
  const start = new Date(`${tagIso}T12:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + tage);
  return new Date(start.getTime() - start.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function mitHistorie(kreditor, neuerStatus) {
  return {
    ...kreditor,
    status: neuerStatus,
    statusHistorie: [...(kreditor.statusHistorie || []),
      { status: neuerStatus, datum: heuteTag() }],
  };
}

// ---------- Swiss-QR-Rechnung (Abend 9.2) ----------
// Der QR-Code auf jeder Schweizer Rechnung (SIX-Standard) ist zeilenweise
// aufgebaut: SPC / Version / Coding / IBAN / Zahlungsempfänger (7 Zeilen) /
// endgültiger Empfänger (7) / Betrag / Währung / Zahlungspflichtiger (7) /
// Referenztyp / Referenz / Mitteilung / EPD / Swico-Rechnungsinformationen.
// Aus den optionalen Swico-Angaben (//S1/...) kommen Rechnungs-Nr., Datum
// und sogar die Skonto-Konditionen (/40/2:10;0:30 = 2 % zu 10 Tagen,
// netto 30 Tage).
export function parseSwissQr(text) {
  const zeilen = String(text).split(/\r?\n/).map((s) => s.trim());
  if (zeilen[0] !== 'SPC') return null;
  const daten = {
    iban: zeilen[3] || '',
    lieferant: zeilen[5] || '',
    betrag: zeilen[18] || '',
    waehrung: zeilen[19] || '',
    refTyp: zeilen[27] || '',
    referenz: zeilen[28] || '',
    mitteilung: zeilen[29] || '',
    rechnungsNr: '',
    rechnungsTag: '',
    skontoProzent: '',
    skontoTage: '',
    zahlungsfristTage: '',
  };
  const swico = zeilen.find((s) => s.startsWith('//S1/'));
  if (swico) {
    const teil = (code) => (swico.match(new RegExp(`/${code}/([^/]*)`)) || [])[1] || '';
    daten.rechnungsNr = teil('10');
    const datum = teil('11'); // JJMMTT
    if (/^\d{6}/.test(datum)) {
      daten.rechnungsTag = `20${datum.slice(0, 2)}-${datum.slice(2, 4)}-${datum.slice(4, 6)}`;
    }
    const konditionen = teil('40').split(';').map((k) => k.split(':'));
    const skonto = konditionen.find(([p]) => zahl(p) > 0);
    if (skonto?.[1]) {
      daten.skontoProzent = skonto[0];
      daten.skontoTage = skonto[1];
    }
    const netto = konditionen.find(([p]) => zahl(p) === 0);
    if (netto?.[1]) daten.zahlungsfristTage = netto[1];
  }
  return daten;
}

// Abgeleitete Termine und Beträge eines Kreditors.
export function kreditorWerte(k) {
  const betrag = zahl(k.betrag);
  const faelligTag = k.tag ? plusTage(k.tag, k.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE) : '';
  const skontoProzent = zahl(k.skontoProzent);
  const skontoTage = parseInt(k.skontoTage, 10) || 0;
  const skontoTag = skontoProzent > 0 && skontoTage > 0 && k.tag
    ? plusTage(k.tag, skontoTage) : '';
  const skontoBetrag = skontoTag ? betrag * skontoProzent / 100 : 0;
  const heute = heuteTag();
  return {
    betrag,
    faelligTag,
    ueberfaellig: k.status !== 'bezahlt' && faelligTag && faelligTag < heute,
    skontoTag,
    skontoBetrag,
    skontoNutzbar: k.status !== 'bezahlt' && skontoTag && skontoTag >= heute,
  };
}

export default {
  name: 'Kreditoren',
  dokumentTypen: ['kreditor'],

  // Badge: noch nicht bezahlte Kreditoren der Baustelle.
  async badge(baustelle) {
    const alle = await abfrage({ typ: 'kreditor', baustelleId: baustelle.baustelleId });
    return alle.filter((k) => k.status !== 'bezahlt').length || null;
  },

  render(container, baustelle) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="kreditoren">
        <h2>Kreditoren · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="kachel-reihe" data-rolle="kacheln"></div>
        <p class="hinweis skonto-chance" data-rolle="skonto-hinweis" hidden></p>

        <div class="knopfzeile" data-rolle="neu-zeile">
          <button type="button" class="knopf knopf-primaer" data-aktion="neu">
            Neue Lieferantenrechnung
          </button>
          <button type="button" class="knopf" data-aktion="export"
            title="Öffnet direkt in Excel">Excel-Export</button>
        </div>

        <div data-rolle="formular-bereich"></div>
        <div data-rolle="tabelle"></div>
        <p class="meldung" data-rolle="meldung" role="status"></p>
      </section>`;

    const kachelnElement = container.querySelector('[data-rolle="kacheln"]');
    const skontoHinweis = container.querySelector('[data-rolle="skonto-hinweis"]');
    const neuZeile = container.querySelector('[data-rolle="neu-zeile"]');
    const formularBereich = container.querySelector('[data-rolle="formular-bereich"]');
    const tabelleElement = container.querySelector('[data-rolle="tabelle"]');
    const meldungElement = container.querySelector('[data-rolle="meldung"]');

    async function ladeKreditoren() {
      const alle = await abfrage({ typ: 'kreditor', baustelleId: baustelle.baustelleId });
      return alle.sort((a, b) => (b.tag || '').localeCompare(a.tag || ''));
    }

    function summe(liste) {
      return liste.reduce((s, k) => s + zahl(k.betrag), 0);
    }

    function zeichneKacheln(kreditoren) {
      kachelnElement.innerHTML = KREDITOR_STATUS.map((status) => {
        const eigene = kreditoren.filter((k) => k.status === status);
        return `
          <div class="karte kachel${status === 'bezahlt' ? ' kachel-gruen' : ''}">
            <span class="kachel-titel">${status} (${eigene.length})</span>
            <span class="kachel-wert">${chf(summe(eigene))}</span>
          </div>`;
      }).join('');
      // Skonto-Überwachung: laufende Fristen und mögliche Ersparnis.
      const nutzbar = kreditoren
        .map((k) => ({ k, w: kreditorWerte(k) }))
        .filter(({ w }) => w.skontoNutzbar);
      if (nutzbar.length) {
        const ersparnis = nutzbar.reduce((s, { w }) => s + w.skontoBetrag, 0);
        const naechste = nutzbar.map(({ w }) => w.skontoTag).sort()[0];
        skontoHinweis.hidden = false;
        skontoHinweis.textContent = `💡 Skonto nutzbar auf ${nutzbar.length} `
          + `Rechnung${nutzbar.length > 1 ? 'en' : ''}: ${chf(ersparnis)} sparen — `
          + `nächste Frist ${formatTag(naechste)}.`;
      } else {
        skontoHinweis.hidden = true;
      }
    }

    function belegAnzahl(k) {
      return Object.keys(k._attachments || {}).length;
    }

    async function zeichneTabelle() {
      const kreditoren = await ladeKreditoren();
      zeichneKacheln(kreditoren);
      if (!kreditoren.length) {
        tabelleElement.innerHTML = `
          <p class="hinweis">Noch keine Lieferantenrechnungen auf dieser Baustelle.
            Erfassen, Beleg fotografieren, visieren, bezahlen — die Selbstkosten
            sammeln sich hier statt im Bürostapel.</p>`;
        return;
      }
      tabelleElement.innerHTML = `
        <div class="tabellen-scroll">
          <table class="uebersicht-tabelle">
            <thead><tr>
              <th>Lieferant · Rg.-Nr.</th><th>Datum</th><th>Kostenart</th>
              <th class="zahl">Betrag</th><th>Skonto bis</th><th>Fällig</th>
              <th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${kreditoren.map((k) => {
                const w = kreditorWerte(k);
                const index = KREDITOR_STATUS.indexOf(k.status);
                const naechster = KREDITOR_STATUS[index + 1];
                return `
                  <tr>
                    <td class="kein-umbruch"><b>${esc(k.lieferant)}</b><br>
                      <small class="hinweis">${esc(k.rechnungsNr)}</small></td>
                    <td class="kein-umbruch">${formatTag(k.tag)}</td>
                    <td class="kein-umbruch">${esc(k.kostenart)}</td>
                    <td class="zahl">${chf(w.betrag)}</td>
                    <td class="kein-umbruch">${w.skontoTag
                      ? `${formatTag(w.skontoTag)}${w.skontoNutzbar
                          ? `<br><small class="skonto-chance">− ${chf(w.skontoBetrag)}</small>`
                          : (k.skontoGenutzt
                            ? '<br><small class="gewinn">genutzt ✓</small>' : '')}`
                      : '—'}</td>
                    <td class="kein-umbruch">${k.status === 'bezahlt'
                      ? `bezahlt ${formatTag(k.bezahltAm)}`
                      : `${formatTag(w.faelligTag)}${w.ueberfaellig
                          ? ' <span class="ueberfaellig">überfällig</span>' : ''}`}</td>
                    <td>${esc(k.status)}${k.visumNotiz
                        ? `<br><small class="hinweis">Visum: ${esc(k.visumNotiz)}</small>` : ''}<br>
                      <small class="hinweis">${(k.statusHistorie || [])
                        .map((h) => `${esc(h.status)} ${formatTag(h.datum)}`).join(' → ')}</small></td>
                    <td class="zahl"><span class="rapport-knoepfe">
                      ${belegAnzahl(k) ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="beleg"
                          data-id="${esc(k._id)}">Beleg (${belegAnzahl(k)})</button>` : ''}
                      ${naechster ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="weiter"
                          data-id="${esc(k._id)}">→ ${naechster}</button>` : ''}
                      ${index > 0 ? `
                        <button type="button" class="knopf eintrag-loeschen" data-aktion="zurueck"
                          data-id="${esc(k._id)}">← zurück</button>` : ''}
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="oeffnen"
                        data-id="${esc(k._id)}">Bearbeiten</button>
                      <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                        data-id="${esc(k._id)}" aria-label="Kreditor löschen">Löschen</button>
                    </span></td>
                  </tr>`;
              }).join('')}
              <tr class="summen-zeile">
                <td colspan="3"><b>Total (${kreditoren.length})</b></td>
                <td class="zahl"><b>${chf(summe(kreditoren))}</b></td>
                <td colspan="4">davon bezahlt ${chf(summe(kreditoren.filter((k) => k.status === 'bezahlt')))}
                  · offen ${chf(summe(kreditoren.filter((k) => k.status !== 'bezahlt')))}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    // ---------- Formular ----------
    async function oeffneFormular(kreditor) {
      inBearbeitung = kreditor || null;
      neuZeile.hidden = true;
      // Lieferanten-Vorschläge aus allen bisherigen Kreditoren (alle Baustellen).
      const alleKreditoren = await abfrage({ typ: 'kreditor' });
      const lieferanten = [...new Set(alleKreditoren.map((k) => k.lieferant).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de-CH'));
      formularBereich.innerHTML = `
        <form class="karte formular" data-rolle="kreditor-formular">
          <h3>${kreditor ? `Rechnung ${esc(kreditor.rechnungsNr)} bearbeiten`
            : 'Neue Lieferantenrechnung'}</h3>
          <div class="knopfzeile">
            <button type="button" class="knopf" data-aktion="qr-scan">
              ⛶ QR-Rechnung scannen
            </button>
          </div>
          <p class="hinweis" data-rolle="qr-info" hidden></p>
          <input type="hidden" name="iban" value="${esc(kreditor?.iban ?? '')}">
          <input type="hidden" name="referenz" value="${esc(kreditor?.referenz ?? '')}">
          <div class="feld-reihe">
            <label>Lieferant / Firma *<input name="lieferant" required autocomplete="off"
              list="lieferanten-liste" value="${esc(kreditor?.lieferant ?? '')}"
              placeholder="z. B. Kieswerk Muster AG"></label>
            <label>Rechnungs-Nr. *<input name="rechnungsNr" required autocomplete="off"
              value="${esc(kreditor?.rechnungsNr ?? '')}"></label>
          </div>
          <datalist id="lieferanten-liste">
            ${lieferanten.map((l) => `<option value="${esc(l)}">`).join('')}
          </datalist>
          <div class="feld-reihe">
            <label>Rechnungsdatum *<input name="tag" type="date" required
              value="${esc(kreditor?.tag || heuteTag())}"></label>
            <label>Betrag [CHF] *<input name="betrag" type="number" required
              inputmode="decimal" step="any" min="0"
              value="${esc(kreditor?.betrag ?? '')}" placeholder="0.00"></label>
            <label>Zahlungsfrist [Tage]<input name="zahlungsfrist" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(kreditor?.zahlungsfristTage ?? ZAHLUNGSFRIST_TAGE)}"></label>
          </div>
          <div class="feld-reihe">
            <label>Skonto [%]<input name="skontoProzent" type="number"
              inputmode="decimal" step="any" min="0"
              value="${esc(kreditor?.skontoProzent ?? '')}" placeholder="z. B. 2"></label>
            <label>Skontofrist [Tage]<input name="skontoTage" type="number"
              inputmode="numeric" min="0" step="1"
              value="${esc(kreditor?.skontoTage ?? '')}" placeholder="z. B. 10"></label>
          </div>
          <p class="gruppen-label">Kostenart (fürs Controlling)</p>
          <div class="chips">
            ${KOSTENARTEN.map((art) => `
              <label class="chip-wahl">
                <input type="radio" name="kostenart" value="${art}"
                  ${(kreditor?.kostenart || 'Material') === art ? 'checked' : ''}>
                <span>${art}</span>
              </label>`).join('')}
          </div>
          <label>Notiz<input name="notiz" autocomplete="off"
            value="${esc(kreditor?.notiz ?? '')}"
            placeholder="z. B. Lieferung Etappe 2"></label>
          <label class="knopf">
            📷 Beleg anhängen (Foto oder PDF)
            <input type="file" accept="image/*,application/pdf" multiple
              data-rolle="beleg-eingabe" class="visually-hidden">
          </label>
          <p class="hinweis" data-rolle="beleg-hinweis">${
            kreditor && belegAnzahl(kreditor)
              ? `${belegAnzahl(kreditor)} Beleg${belegAnzahl(kreditor) > 1 ? 'e' : ''} vorhanden — neue kommen dazu.`
              : 'Noch kein Beleg gewählt.'}</p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Rechnung speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>`;
      const belegEingabe = formularBereich.querySelector('[data-rolle="beleg-eingabe"]');
      belegEingabe.addEventListener('change', () => {
        formularBereich.querySelector('[data-rolle="beleg-hinweis"]').textContent =
          belegEingabe.files.length
            ? `${belegEingabe.files.length} Datei${belegEingabe.files.length > 1 ? 'en' : ''} gewählt.`
            : 'Noch kein Beleg gewählt.';
      });
      formularBereich.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function schliesseFormular() {
      inBearbeitung = null;
      formularBereich.innerHTML = '';
      neuZeile.hidden = false;
    }

    // QR-Daten ins Formular übernehmen — Felder werden gefüllt, aber alles
    // bleibt editierbar (die Kostenart und den Rest ergänzt der Bauführer).
    function uebernehmeQr(formular, daten) {
      const setze = (name, wert) => {
        if (wert) formular.elements[name].value = wert;
      };
      setze('lieferant', daten.lieferant);
      setze('betrag', daten.betrag);
      setze('rechnungsNr', daten.rechnungsNr || daten.referenz);
      setze('tag', daten.rechnungsTag);
      setze('skontoProzent', daten.skontoProzent);
      setze('skontoTage', daten.skontoTage);
      setze('zahlungsfrist', daten.zahlungsfristTage);
      setze('iban', daten.iban);
      setze('referenz', daten.referenz);
      if (daten.mitteilung && !formular.elements.notiz.value) {
        formular.elements.notiz.value = daten.mitteilung;
      }
      const info = formular.querySelector('[data-rolle="qr-info"]');
      info.hidden = false;
      info.textContent = `QR gelesen: ${daten.lieferant || '—'} · `
        + `${daten.waehrung || 'CHF'} ${daten.betrag || '—'} · IBAN ${daten.iban || '—'}`
        + (daten.skontoProzent ? ` · Skonto ${daten.skontoProzent} % / ${daten.skontoTage} Tage` : '')
        + ' — bitte prüfen und Kostenart wählen.';
    }

    // Scan-Dialog: Kamera live (Handy) oder QR aus einem Foto (Rückfallebene).
    // Nutzt die native BarcodeDetector-API — offline, keine Bibliothek.
    async function oeffneQrScan(formular) {
      if (!('BarcodeDetector' in window)) {
        alert('Dieses Gerät kann QR-Codes nicht direkt lesen (BarcodeDetector fehlt) '
          + '— am Handy scannen oder die Werte von Hand eintragen.');
        return;
      }
      const erkenner = new BarcodeDetector({ formats: ['qr_code'] });
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <div class="karte formular dialog qr-dialog">
          <h3>QR-Rechnung scannen</h3>
          <video class="qr-video" autoplay playsinline muted></video>
          <p class="meldung" data-rolle="qr-status" role="status">Kamera startet …</p>
          <div class="knopfzeile">
            <label class="knopf">
              Aus Foto lesen
              <input type="file" accept="image/*" data-rolle="qr-foto" class="visually-hidden">
            </label>
            <button type="button" class="knopf" data-aktion="zu">Abbrechen</button>
          </div>
        </div>`;
      document.body.append(dialog);
      const video = dialog.querySelector('.qr-video');
      const status = dialog.querySelector('[data-rolle="qr-status"]');
      let strom = null;
      let laeuft = true;

      const schliessen = () => {
        laeuft = false;
        strom?.getTracks().forEach((t) => t.stop());
        dialog.remove();
      };

      const verarbeite = (rohtext) => {
        const daten = parseSwissQr(rohtext);
        if (!daten) {
          status.textContent = 'QR-Code gefunden, aber keine Schweizer QR-Rechnung — weiter versuchen.';
          return false;
        }
        uebernehmeQr(formular, daten);
        schliessen();
        return true;
      };

      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) schliessen();
      });
      dialog.querySelector('[data-rolle="qr-foto"]').addEventListener('change', async (wechsel) => {
        const datei = wechsel.target.files[0];
        if (!datei) return;
        try {
          const bild = await createImageBitmap(datei);
          const treffer = await erkenner.detect(bild);
          if (!treffer.length || !verarbeite(treffer[0].rawValue)) {
            status.textContent = treffer.length ? status.textContent
              : 'Kein QR-Code im Foto gefunden — näher und gerade fotografieren.';
          }
        } catch {
          status.textContent = 'Foto konnte nicht gelesen werden.';
        }
      });

      try {
        strom = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        video.srcObject = strom;
        status.textContent = 'Zahlteil der Rechnung vor die Kamera halten …';
        let sucheLaeuft = false;
        const suche = async () => {
          if (!laeuft) return;
          try {
            const treffer = await erkenner.detect(video);
            if (treffer.length && verarbeite(treffer[0].rawValue)) return;
          } catch { /* Einzelbild nicht lesbar — weiter */ }
          setTimeout(suche, 350);
        };
        const starteSuche = () => {
          if (sucheLaeuft || !laeuft) return;
          sucheLaeuft = true;
          suche();
        };
        video.addEventListener('loadeddata', starteSuche, { once: true });
        setTimeout(starteSuche, 1000); // Rückfallebene, falls das Ereignis ausbleibt
      } catch {
        status.textContent = 'Keine Kamera verfügbar — «Aus Foto lesen» nutzen.';
      }
    }

    formularBereich.addEventListener('click', (klick) => {
      if (klick.target.closest('[data-aktion="abbrechen"]')) {
        schliesseFormular();
      } else if (klick.target.closest('[data-aktion="qr-scan"]')) {
        oeffneQrScan(formularBereich.querySelector('form'));
      }
    });

    formularBereich.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      const formular = abschicken.target;
      const meldung = formular.querySelector('.meldung');
      try {
        const lieferant = formular.elements.lieferant.value.trim();
        const rechnungsNr = formular.elements.rechnungsNr.value.trim();
        // Doppelerfassungs-Schutz: gleiche Rechnung schon irgendwo erfasst?
        if (!inBearbeitung) {
          const alleKreditoren = await abfrage({ typ: 'kreditor' });
          const doppelt = alleKreditoren.find((k) =>
            k.lieferant.trim().toLowerCase() === lieferant.toLowerCase()
            && k.rechnungsNr.trim().toLowerCase() === rechnungsNr.toLowerCase());
          if (doppelt && !confirm(`Achtung: ${lieferant} · ${rechnungsNr} ist bereits `
            + `erfasst (${formatTag(doppelt.tag)}, ${chf(zahl(doppelt.betrag))}). `
            + 'Trotzdem speichern?')) {
            meldung.textContent = 'Nicht gespeichert — vermutlich Doppelerfassung.';
            return;
          }
        }
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : {
              typ: 'kreditor',
              baustelleId: baustelle.baustelleId,
              status: 'offen',
              statusHistorie: [{ status: 'offen', datum: heuteTag() }],
            };
        const gespeichert = await put({
          ...basis,
          lieferant,
          rechnungsNr,
          tag: formular.elements.tag.value,
          datum: `${formular.elements.tag.value}T12:00:00.000Z`,
          betrag: formular.elements.betrag.value.trim(),
          zahlungsfristTage: parseInt(formular.elements.zahlungsfrist.value, 10)
            || ZAHLUNGSFRIST_TAGE,
          skontoProzent: formular.elements.skontoProzent.value.trim(),
          skontoTage: formular.elements.skontoTage.value.trim(),
          kostenart: formular.elements.kostenart.value,
          notiz: formular.elements.notiz.value.trim(),
          iban: formular.elements.iban.value.trim(),
          referenz: formular.elements.referenz.value.trim(),
        });
        // Belege anhängen: Fotos verkleinert, PDF unverändert.
        const dateien = [...formular.querySelector('[data-rolle="beleg-eingabe"]').files];
        let lauf = belegAnzahl(gespeichert);
        for (const [i, datei] of dateien.entries()) {
          meldung.textContent = `Beleg ${i + 1} von ${dateien.length} wird verarbeitet …`;
          lauf += 1;
          const kennung = `${Date.now().toString(36)}-${lauf}`;
          if (datei.type === 'application/pdf') {
            await haengeAnhangAn(gespeichert._id, `beleg-${kennung}.pdf`, datei);
          } else {
            const klein = await verkleinereFoto(datei);
            await haengeAnhangAn(gespeichert._id, `beleg-${kennung}.jpg`, klein);
          }
        }
        schliesseFormular();
        meldungElement.textContent = dateien.length
          ? `Rechnung gespeichert — ${dateien.length} Beleg${dateien.length > 1 ? 'e' : ''} angehängt.`
          : 'Rechnung gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    // ---------- Beleg-Ansicht ----------
    async function zeigeBelege(kreditor) {
      const namen = Object.keys(kreditor._attachments || {});
      const oeffneEinzeln = async (name) => {
        const blob = await holeAnhang(kreditor._id, name);
        if (name.endsWith('.pdf')) {
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        } else {
          const url = URL.createObjectURL(blob);
          zeigeBildVollbild(url, {
            onLoeschen: async () => {
              await entferneAnhang(kreditor._id, name);
              document.dispatchEvent(new CustomEvent('luense:daten'));
              await zeichneTabelle();
            },
          });
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        }
      };
      if (namen.length === 1) {
        oeffneEinzeln(namen[0]);
        return;
      }
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <div class="karte formular dialog">
          <h3>Belege · ${esc(kreditor.lieferant)} ${esc(kreditor.rechnungsNr)}</h3>
          ${namen.map((name, i) => `
            <div class="fo-zeile dossier-zeile">
              <span class="fo-label">Beleg ${i + 1} ${name.endsWith('.pdf') ? '(PDF)' : '(Foto)'}</span>
              <button type="button" class="knopf" data-beleg="${esc(name)}">Öffnen</button>
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
        const name = klick.target.closest('[data-beleg]')?.dataset.beleg;
        if (name) oeffneEinzeln(name);
      });
    }

    // ---------- Visum mit Lieferschein-Abgleich (Abend 9.4) ----------
    // Beim Visieren zeigt der Dialog die Material-Zeilen aus den Tages-
    // rapporten der Baustelle: «Wurde geliefert, was verrechnet wird?»
    // Reine Anzeige-Hilfe zum Abhaken — keine Automatik, kein Speichern
    // der Haken; entschieden wird mit Visum und Bemerkung.
    async function oeffneVisumDialog(kreditor) {
      const rapporte = await abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId });
      const materialZeilen = rapporte
        .flatMap((r) => (r.arbeiten || []).flatMap((arbeit) =>
          (arbeit.material || []).map((m) => ({ tag: r.tag, ...m }))))
        .filter((m) => m.name || m.menge)
        .sort((a, b) => (b.tag || '').localeCompare(a.tag || ''));
      const gezeigt = materialZeilen.slice(0, 30);
      const dialog = document.createElement('div');
      dialog.className = 'vollbild dialog-hintergrund';
      dialog.innerHTML = `
        <form class="karte formular dialog" data-rolle="visum-dialog">
          <h3>Visum · ${esc(kreditor.lieferant)} ${esc(kreditor.rechnungsNr)}
            · ${chf(zahl(kreditor.betrag))}</h3>
          <p class="gruppen-label">Lieferschein-Abgleich — Material aus den Tagesrapporten</p>
          ${gezeigt.length ? `
            <div class="beweis-liste">
              ${gezeigt.map((m) => `
                <label class="beweis-zeile">
                  <input type="checkbox">
                  <span>${m.tag ? m.tag.split('-').reverse().join('.') + ' · ' : ''}${esc(m.name || '—')}${
                    [m.menge, m.einheit].filter(Boolean).length
                      ? ' · ' + [m.menge, m.einheit].filter(Boolean).map(esc).join(' ') : ''}</span>
                </label>`).join('')}
            </div>
            ${materialZeilen.length > gezeigt.length ? `
              <p class="hinweis">… und ${materialZeilen.length - gezeigt.length} ältere Einträge.</p>` : ''}
            <p class="hinweis">Haken dienen nur dem Abgleich beim Prüfen — gespeichert
              wird das Visum mit Bemerkung.</p>`
          : '<p class="hinweis">Keine Material-Einträge in den Rapporten dieser Baustelle.</p>'}
          <label>Visum-Bemerkung (optional)<input name="bemerkung" autocomplete="off"
            placeholder="z. B. Mengen gemäss Rapporten geprüft"></label>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Visieren</button>
            <button type="button" class="knopf" data-aktion="zu">Abbrechen</button>
          </div>
        </form>`;
      document.body.append(dialog);
      dialog.addEventListener('click', (klick) => {
        if (klick.target === dialog || klick.target.closest('[data-aktion="zu"]')) dialog.remove();
      });
      dialog.querySelector('form').addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const doc = mitHistorie(kreditor, 'visiert');
        doc.visumNotiz = abschicken.target.elements.bemerkung.value.trim();
        await put(doc);
        dialog.remove();
        meldungElement.textContent = `${kreditor.lieferant} ${kreditor.rechnungsNr} → visiert.`;
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      });
    }

    // ---------- Aktionen ----------
    container.querySelector('[data-aktion="neu"]')
      .addEventListener('click', () => oeffneFormular(null));

    container.querySelector('[data-aktion="export"]')
      .addEventListener('click', async () => {
        const kreditoren = await ladeKreditoren();
        exportiereCsv(
          `luense-kreditoren-${baustelle.ktr}.csv`,
          ['Lieferant', 'Rechnungs-Nr.', 'Datum', 'Kostenart', 'Betrag CHF',
            'Skonto %', 'Skonto bis', 'Skonto CHF', 'Fällig', 'Status',
            'Bezahlt am', 'Skonto genutzt', 'IBAN', 'Referenz',
            'Visum-Bemerkung', 'Notiz', 'Statusverlauf'],
          kreditoren.slice().reverse().map((k) => {
            const w = kreditorWerte(k);
            return [k.lieferant, k.rechnungsNr, formatTag(k.tag), k.kostenart,
              w.betrag, zahl(k.skontoProzent) || '', formatTag(w.skontoTag),
              w.skontoBetrag || '', formatTag(w.faelligTag), k.status,
              formatTag(k.bezahltAm), k.skontoGenutzt ? 'ja' : '',
              k.iban || '', k.referenz || '',
              k.visumNotiz || '', k.notiz || '',
              (k.statusHistorie || []).map((h) => `${h.status} ${formatTag(h.datum)}`).join(' → ')];
          }),
        );
      });

    tabelleElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const kreditoren = await ladeKreditoren();
      const kreditor = kreditoren.find((k) => k._id === knopf.dataset.id);
      if (!kreditor) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'oeffnen') {
        oeffneFormular(kreditor);
      } else if (aktion === 'beleg') {
        zeigeBelege(kreditor);
      } else if (aktion === 'weiter') {
        const naechster = KREDITOR_STATUS[KREDITOR_STATUS.indexOf(kreditor.status) + 1];
        if (!naechster) return;
        if (naechster === 'visiert') {
          // Visum im Dialog mit Lieferschein-Abgleich (Abend 9.4).
          oeffneVisumDialog(kreditor);
          return;
        }
        const doc = mitHistorie(kreditor, naechster);
        if (naechster === 'bezahlt') {
          doc.bezahltAm = heuteTag();
          const w = kreditorWerte(kreditor);
          if (w.skontoNutzbar) {
            doc.skontoGenutzt = confirm(`Skonto nutzen? ${chf(w.skontoBetrag)} `
              + `(${zahl(kreditor.skontoProzent)} %) — Frist läuft bis ${formatTag(w.skontoTag)}. `
              + `Zahlbetrag mit Skonto: ${chf(w.betrag - w.skontoBetrag)}.`);
          }
        }
        await put(doc);
        meldungElement.textContent = `${kreditor.lieferant} ${kreditor.rechnungsNr} → ${naechster}.`
          + (doc.skontoGenutzt ? ` Skonto genutzt: ${chf(kreditorWerte(kreditor).skontoBetrag)} gespart.` : '');
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'zurueck') {
        const vorheriger = KREDITOR_STATUS[KREDITOR_STATUS.indexOf(kreditor.status) - 1];
        if (!vorheriger) return;
        const doc = mitHistorie(kreditor, vorheriger);
        if (kreditor.status === 'bezahlt') {
          delete doc.bezahltAm;
          delete doc.skontoGenutzt;
        }
        if (vorheriger === 'offen') doc.visumNotiz = '';
        await put(doc);
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      } else if (aktion === 'loeschen') {
        if (!confirm(`Rechnung ${kreditor.lieferant} · ${kreditor.rechnungsNr} endgültig löschen (samt Belegen)?`)) return;
        await entferneDokument(kreditor._id);
        if (inBearbeitung?._id === kreditor._id) schliesseFormular();
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneTabelle();
      }
    });

    zeichneTabelle();
  },
};
