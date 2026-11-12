// module/ereignis.js — Ereignis-Journal, erstes Modul der Shell.
// Liste zuerst (nach Tagen gruppiert, neuste zuerst, mit Suche und
// Tag-Filter); erfasst und bearbeitet wird in einem Blatt, das der
// Knopf «+ Eintrag» unten rechts öffnet (Tag, Ort/KV, Notiz, Fotos).
// Spricht ausschliesslich über den Kern mit der Datenbank.

import {
  put, abfrage, haengeAnhangAn, holeAnhang, entferneDokument, entferneAnhang,
} from '../kern/speicher.js';
import { verkleinereFoto } from '../kern/kamera.js';
import { oeffneHandnotiz } from '../kern/handschrift.js';
import { oeffneBericht } from '../kern/pdf.js';
import {
  esc, formatDatumZeit, naechsteNummer, regieTreffer, schadenTreffer, zeigeBildVollbild,
} from '../kern/ui.js';

const TAGS = ['Vorzustand', 'Fortschritt', 'Mangel', 'Regie', 'Abnahme'];
const STANDARD_TAG = 'Fortschritt';
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const FOTOS_IM_STREIFEN = 4; // danach eine Kachel «+N»

// CSS-Klasse je Tag (Farbe der Chips und des Kartenrands).
const tagKlasse = (tag) => `tag-${String(tag || '').toLowerCase()}`;

// Suche: Gross/klein egal, Umlaute auch als ae/oe/ue (wie die Regie-
// Erkennung) — «Schacht Mueller» findet «Schacht Müller» und umgekehrt.
const normal = (text) => String(text ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const tagSchluessel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// «Mo 09.11.2026»
function formatTagKopf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Ohne Datum';
  return `${WOCHENTAGE[d.getDay()]} ${d.toLocaleDateString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

function formatZeit(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

export default {
  name: 'Journal',
  dokumentTypen: ['ereignis'],

  render(container, baustelle) {
    const filter = new Set(); // gewählte Filter-Chips; leer = alle zeigen
    let suche = ''; // Suchtext (normalisiert)
    let gewaehlteFotos = []; // Dateien, die beim Speichern angehängt werden
    let inBearbeitung = null; // Ereignis, das gerade im Formular steht
    let regieAbgelehnt = ''; // «Nein, keine Regie» für genau diesen Hinweis
    let rueckkehr = null; // Listenposition beim Öffnen des Blatts
    const objektUrls = []; // erzeugte Foto-URLs, beim Neuzeichnen freigeben
    const offeneNotizen = new Set(); // aufgeklappte Notizen (Ids)
    const offeneFotos = new Set(); // aufgeklappte Fotostreifen (Ids)

    container.innerHTML = `
      <section class="journal">
        <h2>Journal · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

        <div class="journal-werkzeuge">
          <label class="journal-suche">
            <span class="visually-hidden">Suchen in Notiz und Ort/KV</span>
            <input type="search" data-rolle="suche" autocomplete="off"
              placeholder="🔍 Suchen (Notiz, Ort/KV)">
          </label>
          <button type="button" class="knopf bericht-knopf" data-rolle="bericht"
            title="PDF-Fotobericht erstellen">📄 PDF</button>
        </div>
        <div class="filter-zeile" role="group" aria-label="Liste filtern">
          <span class="filter-titel">Filter</span>
          <div class="chips" data-rolle="filter"></div>
        </div>
        <p class="meldung journal-meldung" role="status" data-rolle="listen-meldung"></p>

        <input type="file" accept="image/*" capture="environment" multiple
          data-rolle="foto-nachtrag" class="visually-hidden">
        <div class="journal-liste" data-rolle="liste"></div>

        <button type="button" class="knopf knopf-primaer neu-knopf" data-aktion="neu"
          aria-haspopup="dialog">+ Eintrag</button>

        <div class="blatt-schleier" data-rolle="schleier" hidden></div>
        <form class="karte formular journal-blatt" data-rolle="erfassung" hidden
          role="dialog" aria-modal="true" aria-labelledby="journal-blatt-titel">
          <div class="blatt-kopf">
            <h3 id="journal-blatt-titel" data-rolle="blatt-titel">Neuer Eintrag</h3>
            <button type="button" class="knopf blatt-zu" data-aktion="bearbeiten-abbrechen"
              aria-label="Schliessen">✕</button>
          </div>
          <p class="hinweis blatt-tag-titel">Tag</p>
          <div class="chips tag-wahl" data-rolle="tag-wahl">
            ${TAGS.map((tag) => `
              <label class="chip-wahl ${tagKlasse(tag)}">
                <input type="radio" name="tag" value="${tag}"
                  ${tag === STANDARD_TAG ? 'checked' : ''}>
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
          <div class="knopfzeile blatt-aktionen">
            <button type="submit" class="knopf knopf-primaer">Eintrag speichern</button>
            <button type="button" class="knopf" data-aktion="bearbeiten-abbrechen">
              Abbrechen
            </button>
          </div>
          <p class="meldung" role="status"></p>
        </form>
      </section>`;

    const formular = container.querySelector('[data-rolle="erfassung"]');
    const meldung = formular.querySelector('.meldung');
    const blattTitel = formular.querySelector('[data-rolle="blatt-titel"]');
    const schleier = container.querySelector('[data-rolle="schleier"]');
    const neuKnopf = container.querySelector('[data-aktion="neu"]');
    const fotoEingabe = formular.querySelector('[data-rolle="foto-eingabe"]');
    const fotoInfo = formular.querySelector('[data-rolle="foto-info"]');
    const filterElement = container.querySelector('[data-rolle="filter"]');
    const listeElement = container.querySelector('[data-rolle="liste"]');
    const listenMeldung = container.querySelector('[data-rolle="listen-meldung"]');
    const sucheEingabe = container.querySelector('[data-rolle="suche"]');

    function zeigeFotoInfo() {
      fotoInfo.textContent = gewaehlteFotos.length
        ? `${gewaehlteFotos.length} Foto${gewaehlteFotos.length > 1 ? 's' : ''} bereit, ` +
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
          : `Leitungsschaden («${esc(schaden)}»): Regie prüfen? War die Leitung nicht
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
        meldung.textContent = 'Tag «Regie» gewählt, beim Speichern entstehen Nachtrag und Pendenz.';
      } else {
        regieAbgelehnt = vorschlag.dataset.treffer;
        meldung.textContent = '';
      }
      zeigeRegieVorschlag();
    });

    function zeichneFilter() {
      filterElement.innerHTML = TAGS.map((tag) => `
        <button type="button" class="chip chip-knopf filter-chip${filter.has(tag) ? ' aktiv' : ''}"
          data-tag="${tag}" aria-pressed="${filter.has(tag)}">${
            filter.has(tag) ? '✓ ' : ''}${tag}</button>`).join('');
    }

    // Eintrag mit Regie-Hinweis, aber anderem Tag (z. B. älter oder
    // importiert): nur anzeigen, «Prüfen» öffnet ihn mit dem Vorschlag.
    function regieKartenHinweis(e) {
      const treffer = e.tag !== 'Regie' && regieTreffer(e.notiz);
      if (!treffer || treffer === e.regieHinweisAbgelehnt) return '';
      return `<p class="regie-erkannt regie-warnung">⚠ Regie-Hinweis «${esc(treffer)}»,
        Tag ist «${esc(e.tag)}».
        <button type="button" class="knopf eintrag-loeschen" data-aktion="eintrag-bearbeiten"
          data-id="${esc(e._id)}">Prüfen</button></p>`;
    }

    // Was aus einem Eintrag entstanden ist: Nachtrag (verweist über
    // beweise.ereignisIds) und Pendenz (verweist über ereignisId).
    // Antippen wechselt ins jeweilige Modul (Shell-Ereignis, kein Aufruf).
    function verweiseHtml(e, nachtraege, pendenzen) {
      const zeilen = [
        ...nachtraege.filter((n) => n.beweise?.ereignisIds?.includes(e._id)).map((n) => `
          <button type="button" class="verweis" data-modul="Nachträge" data-ziel="${esc(n._id)}">
            ↳ Nachtrag <strong>${esc(n.nummer || '')}</strong> · ${esc(n.status || 'erkannt')}
          </button>`),
        ...pendenzen.filter((p) => p.ereignisId === e._id).map((p) => `
          <button type="button" class="verweis${p.erledigtAm ? ' verweis-erledigt' : ''}"
            data-modul="Pendenzen" data-ziel="${esc(p._id)}">
            ↳ Pendenz <strong>${p.erledigtAm ? 'erledigt' : 'offen'}</strong>
          </button>`),
      ];
      return zeilen.length ? `<div class="verweise">${zeilen.join('')}</div>` : '';
    }

    function fotoStreifenHtml(e) {
      const fotos = Object.keys(e._attachments || {});
      if (!fotos.length) return '';
      const alle = offeneFotos.has(e._id) || fotos.length <= FOTOS_IM_STREIFEN;
      const gezeigt = alle ? fotos : fotos.slice(0, FOTOS_IM_STREIFEN - 1);
      const rest = fotos.length - gezeigt.length;
      return `
        <div class="foto-streifen${alle && fotos.length > FOTOS_IM_STREIFEN ? ' offen' : ''}">
          ${gezeigt.map((name) => `
            <button type="button" class="foto-kachel" aria-label="Foto in Vollbild">
              <img class="foto-thumb" alt="" data-id="${esc(e._id)}" data-name="${esc(name)}">
            </button>`).join('')}
          ${rest ? `<button type="button" class="foto-kachel foto-mehr" data-aktion="fotos-alle"
            data-id="${esc(e._id)}" aria-label="Alle ${fotos.length} Fotos zeigen">+${rest}</button>` : ''}
        </div>`;
    }

    function karteHtml(e, nachtraege, pendenzen) {
      return `
        <article class="karte ereignis ${tagKlasse(e.tag)}" data-ereignis="${esc(e._id)}">
          <div class="ereignis-kopf">
            <span class="tag-chip ${tagKlasse(e.tag)}">${esc(e.tag)}</span>
            ${e.wiederholung > 1
              ? `<span class="chip wiederhol-chip">⚠ ${e.wiederholung}. Mal</span>` : ''}
            <span class="ereignis-zeit">${formatZeit(e.datum)}</span>
            ${e.ortKv ? `<span class="ereignis-ort">· ${esc(e.ortKv)}</span>` : ''}
            <span class="ereignis-aktionen">
              <button type="button" class="knopf karten-knopf" data-aktion="foto-plus"
                data-id="${esc(e._id)}" aria-label="Foto ergänzen">+ 📷</button>
              <button type="button" class="knopf karten-knopf" data-aktion="menue"
                data-id="${esc(e._id)}" aria-haspopup="menu" aria-expanded="false"
                aria-label="Weitere Aktionen">⋯</button>
              <span class="karten-menue" role="menu" hidden>
                <button type="button" class="knopf" role="menuitem"
                  data-aktion="eintrag-bearbeiten" data-id="${esc(e._id)}">✎ Bearbeiten</button>
                <button type="button" class="knopf menue-loeschen" role="menuitem"
                  data-aktion="loeschen" data-id="${esc(e._id)}">🗑 Löschen</button>
              </span>
            </span>
          </div>
          ${e.notiz ? `<p class="ereignis-notiz${offeneNotizen.has(e._id) ? ' offen' : ''}"
            data-aktion="notiz-umschalten" data-id="${esc(e._id)}">${esc(e.notiz)}</p>` : ''}
          ${e.quelleText ? `<p class="hinweis verknuepfung">↳ ${esc(e.quelleText)}</p>` : ''}
          ${verweiseHtml(e, nachtraege, pendenzen)}
          ${regieKartenHinweis(e)}
          ${fotoStreifenHtml(e)}
        </article>`;
    }

    function passt(e) {
      if (filter.size && !filter.has(e.tag)) return false;
      if (!suche) return true;
      return normal(`${e.notiz || ''} ${e.ortKv || ''}`).includes(suche);
    }

    async function zeichneListe() {
      objektUrls.forEach(URL.revokeObjectURL);
      objektUrls.length = 0;
      const [alle, nachtraege, pendenzen] = await Promise.all([
        abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'pendenz', baustelleId: baustelle.baustelleId }),
      ]);
      const gezeigt = alle.filter(passt);

      // Nach Kalendertag gruppieren (Liste kommt schon neuste zuerst).
      const tage = [];
      for (const e of gezeigt) {
        const schluessel = tagSchluessel(e.datum);
        if (tage.at(-1)?.schluessel !== schluessel) tage.push({ schluessel, eintraege: [] });
        tage.at(-1).eintraege.push(e);
      }

      listeElement.innerHTML = gezeigt.length
        ? tage.map(({ eintraege }) => `
            <section class="tag-gruppe">
              <h3 class="tag-kopf">${formatTagKopf(eintraege[0].datum)}
                <span class="tag-anzahl">· ${eintraege.length} ${
                  eintraege.length === 1 ? 'Eintrag' : 'Einträge'}</span></h3>
              ${eintraege.map((e) => karteHtml(e, nachtraege, pendenzen)).join('')}
            </section>`).join('')
        : `<p class="hinweis">${
            !alle.length ? 'Noch keine Einträge auf dieser Baustelle, unten rechts «+ Eintrag».'
              : suche ? 'Keine Einträge zu dieser Suche.'
                : 'Keine Einträge zu dieser Tag-Auswahl.'}</p>`;

      // Notizen, die in zwei Zeilen passen, brauchen kein Aufklappen.
      for (const notiz of listeElement.querySelectorAll('.ereignis-notiz:not(.offen)')) {
        if (notiz.scrollHeight <= notiz.clientHeight + 1) notiz.classList.add('kurz');
      }

      await ladeThumbs(listeElement.querySelectorAll('.foto-thumb'));
    }

    async function ladeThumbs(bilder) {
      for (const bild of bilder) {
        try {
          const blob = await holeAnhang(bild.dataset.id, bild.dataset.name);
          const url = URL.createObjectURL(blob);
          objektUrls.push(url);
          bild.src = url;
        } catch {
          bild.closest('.foto-kachel')?.remove();
        }
      }
    }

    function zeigeVollbild(quelle, docId, name) {
      zeigeBildVollbild(quelle, {
        onLoeschen: async () => {
          await entferneAnhang(docId, name);
          await neuZeichnenAnOrt(docId);
        },
      });
    }

    // Neu zeichnen, ohne dass die Liste springt: die Karte (oder sonst
    // die Scrollhöhe) bleibt an derselben Stelle im Bildschirm.
    async function neuZeichnenAnOrt(id) {
      const karte = id && listeElement.querySelector(`[data-ereignis="${CSS.escape(id)}"]`);
      const oben = karte ? karte.getBoundingClientRect().top : null;
      const y = window.scrollY;
      await zeichneListe();
      const neu = id && listeElement.querySelector(`[data-ereignis="${CSS.escape(id)}"]`);
      if (neu && oben !== null) {
        window.scrollTo(0, window.scrollY + neu.getBoundingClientRect().top - oben);
      } else {
        window.scrollTo(0, y);
      }
    }

    function zeigeListenMeldung(text) {
      listenMeldung.textContent = text;
      clearTimeout(zeigeListenMeldung.uhr);
      zeigeListenMeldung.uhr = setTimeout(() => { listenMeldung.textContent = ''; }, 6000);
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

    sucheEingabe.addEventListener('input', () => {
      suche = normal(sucheEingabe.value.trim());
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
      const ziel = fotoZielId;
      for (const [index, datei] of dateien.entries()) {
        const klein = await verkleinereFoto(datei);
        await haengeAnhangAn(ziel,
          `foto-${Date.now().toString(36)}-${index}.jpg`, klein);
      }
      fotoZielId = null;
      document.dispatchEvent(new CustomEvent('luense:daten'));
      await neuZeichnenAnOrt(ziel);
    });

    // ---------- Erfassungsblatt öffnen / schliessen ----------

    function blattOffen() {
      return !formular.hidden;
    }

    function oeffneBlatt(ereignis) {
      rueckkehr = { y: window.scrollY, id: ereignis?._id || null };
      fuelleFormular(ereignis);
      formular.hidden = false;
      schleier.hidden = false;
      neuKnopf.hidden = true;
      document.body.classList.add('blatt-offen');
      formular.scrollTop = 0;
    }

    function schliesseBlatt() {
      formular.hidden = true;
      schleier.hidden = true;
      neuKnopf.hidden = false;
      document.body.classList.remove('blatt-offen');
      fuelleFormular(null);
      if (rueckkehr) window.scrollTo(0, rueckkehr.y);
    }

    // Bestehenden Eintrag ins Formular laden (Fotos bleiben erhalten);
    // ohne Eintrag: leeres Formular, Tag zurück auf «Fortschritt».
    function fuelleFormular(ereignis) {
      inBearbeitung = ereignis;
      blattTitel.textContent = ereignis
        ? `Eintrag vom ${formatDatumZeit(ereignis.datum)}` : 'Neuer Eintrag';
      const tagWahl = formular.querySelector(`input[value="${ereignis?.tag || STANDARD_TAG}"]`);
      if (tagWahl) tagWahl.checked = true;
      formular.elements.ortKv.value = ereignis?.ortKv ?? '';
      formular.elements.notiz.value = ereignis?.notiz ?? '';
      gewaehlteFotos = [];
      zeigeFotoInfo();
      regieAbgelehnt = ereignis?.regieHinweisAbgelehnt || '';
      zeigeRegieVorschlag();
      meldung.textContent = ereignis ? 'Bearbeiten, vorhandene Fotos bleiben erhalten.' : '';
    }

    // Antippen daneben schliesst nur, wenn nichts verloren geht.
    function hatEingaben() {
      if (inBearbeitung) {
        return gewaehlteFotos.length
          || formular.elements.notiz.value !== (inBearbeitung.notiz ?? '')
          || formular.elements.ortKv.value !== (inBearbeitung.ortKv ?? '')
          || gewaehlterTag() !== inBearbeitung.tag;
      }
      return gewaehlteFotos.length || formular.elements.notiz.value.trim()
        || formular.elements.ortKv.value.trim();
    }

    neuKnopf.addEventListener('click', () => oeffneBlatt(null));
    formular.querySelectorAll('[data-aktion="bearbeiten-abbrechen"]').forEach((knopf) =>
      knopf.addEventListener('click', schliesseBlatt));
    schleier.addEventListener('click', () => {
      if (hatEingaben()) {
        meldung.textContent = 'Noch nicht gespeichert, «Eintrag speichern» oder «Abbrechen».';
        return;
      }
      schliesseBlatt();
    });
    const escTaste = (taste) => {
      if (taste.key === 'Escape' && blattOffen() && !document.querySelector('.vollbild, .handnotiz')) {
        schliesseBlatt();
      }
    };
    document.addEventListener('keydown', escTaste);

    // ---------- Karten-Menü «⋯» ----------

    function schliesseMenues(ausser) {
      listeElement.querySelectorAll('.karten-menue:not([hidden])').forEach((menue) => {
        if (menue === ausser) return;
        menue.hidden = true;
        menue.previousElementSibling?.setAttribute('aria-expanded', 'false');
      });
    }

    const draussenKlick = (klick) => {
      if (!klick.target.closest('.ereignis-aktionen')) schliesseMenues();
    };
    document.addEventListener('click', draussenKlick);
    // Aufräumen, sobald die Shell ein anderes Modul zeichnet.
    new MutationObserver((_, beobachter) => {
      if (!container.contains(listeElement)) {
        document.removeEventListener('click', draussenKlick);
        document.removeEventListener('keydown', escTaste);
        document.body.classList.remove('blatt-offen');
        beobachter.disconnect();
      }
    }).observe(container, { childList: true });

    listeElement.addEventListener('click', async (klick) => {
      const ziel = klick.target.closest('[data-aktion], .foto-kachel, [data-modul]');
      if (!ziel) return;
      const aktion = ziel.dataset.aktion;
      const id = ziel.dataset.id;

      if (aktion === 'menue') {
        const menue = ziel.nextElementSibling;
        const auf = menue.hidden;
        schliesseMenues(menue);
        menue.hidden = !auf;
        ziel.setAttribute('aria-expanded', String(auf));
        return;
      }
      schliesseMenues();

      if (ziel.dataset.modul) {
        document.dispatchEvent(new CustomEvent('luense:modulWechseln', {
          detail: { name: ziel.dataset.modul, fokusId: ziel.dataset.ziel },
        }));
        return;
      }
      if (aktion === 'eintrag-bearbeiten') {
        const alle = await abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId });
        const ereignis = alle.find((e) => e._id === id);
        if (ereignis) oeffneBlatt(ereignis);
        return;
      }
      if (aktion === 'foto-plus') {
        fotoZielId = id;
        fotoNachtrag.click();
        return;
      }
      if (aktion === 'loeschen') {
        if (confirm('Diesen Eintrag endgültig löschen? Zugehörige Fotos werden mitgelöscht.')) {
          await entferneDokument(id);
          await neuZeichnenAnOrt(null);
          zeigeListenMeldung('Eintrag gelöscht.');
        }
        return;
      }
      if (aktion === 'notiz-umschalten') {
        if (ziel.classList.contains('kurz')) return;
        ziel.classList.toggle('offen');
        offeneNotizen[ziel.classList.contains('offen') ? 'add' : 'delete'](id);
        return;
      }
      if (aktion === 'fotos-alle') {
        offeneFotos.add(id);
        await neuZeichnenAnOrt(id);
        return;
      }
      const bild = ziel.querySelector('.foto-thumb');
      if (bild?.src) zeigeVollbild(bild.src, bild.dataset.id, bild.dataset.name);
    });

    // ---------- Speichern ----------

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
        let nummer = '';
        if (neuRegie) {
          nummer = naechsteNummer(nachtraege.map((n) => n.nummer), 'N-');
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
        // Blatt zu, Formular leer und Tag zurück auf «Fortschritt» —
        // der nächste schnelle Eintrag erzeugt so keinen zweiten Nachtrag.
        const zurueck = rueckkehr;
        formular.hidden = true;
        schleier.hidden = true;
        neuKnopf.hidden = false;
        document.body.classList.remove('blatt-offen');
        fuelleFormular(null);
        zeigeListenMeldung(neuRegie
          ? `Eintrag ${warBearbeitung ? 'aktualisiert' : 'gespeichert'}, Nachtrag ${nummer} (erkannt) und Pendenz erstellt.`
          : warBearbeitung ? 'Eintrag aktualisiert.' : 'Eintrag gespeichert.');
        document.dispatchEvent(new CustomEvent('luense:daten'));
        if (warBearbeitung) {
          if (zurueck) window.scrollTo(0, zurueck.y);
          await neuZeichnenAnOrt(doc._id);
        } else {
          await zeichneListe();
          // Neuer Eintrag steht zuoberst — dorthin, damit man ihn sieht.
          listeElement.querySelector(`[data-ereignis="${CSS.escape(doc._id)}"]`)
            ?.scrollIntoView({ block: 'center' });
        }
      } catch (fehler) {
        meldung.textContent = fehler.message;
      } finally {
        speichernKnopf.disabled = false;
      }
    });

    fuelleFormular(null);
    zeichneFilter();
    zeichneListe();
  },
};
