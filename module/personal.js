// module/personal.js — Personal & LMV-Stunden (Abschnitt 10).
// Abend 10.1: Mitarbeiter-Stammdaten light — Name, Lohnklasse (nur als
// Angabe, KEINE Löhne), Arbeitszeitmodell nach LMV 2026 (Arbeitszeit-
// kalender: Saldo −20…+120 h / ausgeglichenes Modell: −50…+120 h) und
// Tages-Sollstunden. Baustellenübergreifend — Mitarbeiter arbeiten auf
// allen Baustellen; wie Katalog/Offertwesen nutzen die Dokumente die
// Sammel-Id «personal» (bewusste Ausnahme von der Baustellen-Id-Regel).
// Abend 10.2 ergänzt das Stundenkonto aus den Tagesrapporten,
// Abend 10.3 den Treuhänder-Export.

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { exportiereCsv } from '../kern/export.js';
import { esc } from '../kern/ui.js';
import {
  MASCHINEN, MASCHINEN_GRUPPEN, FREMDLEISTUNGEN, FREMDLEISTUNGS_GRUPPEN, nachGruppe,
} from '../kern/katalog.js';

const PERSONAL_ID = 'personal';
// LMV-Lohnklassen — reine Angabe für den Treuhänder, Lünse rechnet keine Löhne.
const LOHNKLASSEN = ['C', 'B', 'A', 'Q', 'V', 'Polier', 'Kader/andere'];
const MODELLE = [
  ['kalender', 'Arbeitszeitkalender', -20, 120],
  ['ausgeglichen', 'Ausgeglichenes Modell', -50, 120],
];
const SOLL_PRO_TAG = 8.5;

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function modellVon(mitarbeiter) {
  return MODELLE.find(([schluessel]) => schluessel === mitarbeiter.modell) || MODELLE[0];
}

export default {
  name: 'Personal',
  dokumentTypen: ['mitarbeiter', 'geraet'],

  render(container) {
    let inBearbeitung = null;

    container.innerHTML = `
      <section class="personal">
        <h2>Personal & LMV-Stunden</h2>
        <p class="hinweis">Baustellenübergreifend. Lohnklasse und Modell sind
          Angaben nach LMV 2026 — Löhne rechnet der Treuhänder, Lünse liefert
          die Stunden.</p>

        <form class="karte formular" data-rolle="mitarbeiter-formular">
          <h3 data-rolle="formular-titel">Neuer Mitarbeiter</h3>
          <div class="feld-reihe">
            <label>Name *<input name="name" required autocomplete="off"
              placeholder="genau wie im Tagesrapport, z. B. Max"></label>
            <label>Lohnklasse (LMV)<select name="lohnklasse">
              ${LOHNKLASSEN.map((k) => `<option>${k}</option>`).join('')}
            </select></label>
          </div>
          <div class="feld-reihe">
            <label>Arbeitszeitmodell<select name="modell">
              ${MODELLE.map(([schluessel, label, von, bis]) => `
                <option value="${schluessel}">${label} (${von}…+${bis} h)</option>`).join('')}
            </select></label>
            <label>Soll pro Arbeitstag [h]<input name="sollProTag" type="number"
              inputmode="decimal" step="0.05" min="0" value="${SOLL_PRO_TAG}"></label>
          </div>
          <p class="hinweis">Der Name muss den Personen-Einträgen in den
            Tagesrapporten entsprechen — daraus entsteht das Stundenkonto.
            Soll = Arbeitstage (Mo–Fr) × Tagessoll.</p>
          <div class="knopfzeile">
            <button type="submit" class="knopf knopf-primaer">Speichern</button>
            <button type="button" class="knopf" data-aktion="abbrechen" hidden>Abbrechen</button>
          </div>
          <p class="meldung" role="status"></p>
        </form>

        <div data-rolle="liste"></div>
        <div data-rolle="konto"></div>

        <details class="karte import">
          <summary>Geräte / Inventar pflegen</summary>
          <p class="hinweis">Die Geräteliste erscheint im Tagesrapport als
            Antipp-Matrix — einheitliche Namen statt Tipperei. Auch
            Fremdleistungen (z. B. Lastwagen mit Chauffeur) können hier stehen.</p>
          <div data-rolle="geraete-liste"></div>
          <form class="feld-reihe geraet-form" data-rolle="geraet-form">
            <label>Gerät / Maschine<input name="name" required autocomplete="off"
              placeholder="z. B. Bagger 308"></label>
            <button type="submit" class="knopf zeile-hinzu">+ Gerät</button>
          </form>
          <details class="katalog-wahl" data-rolle="katalog-wahl">
            <summary>Aus Katalog übernehmen</summary>
            <p class="hinweis">Übliche Maschinen, Geräte und Fremdleistungen —
              antippen, dann übernehmen. Bereits erfasste sind ausgegraut.</p>
            <label class="katalog-suche">Suchen<input type="search" data-rolle="katalog-suche"
              autocomplete="off" placeholder="z. B. Bagger, Lastwagen"></label>
            <div data-rolle="katalog-gruppen"></div>
            <div class="knopfzeile katalog-aktionen">
              <button type="button" class="knopf knopf-primaer"
                data-aktion="katalog-uebernehmen">Ausgewählte übernehmen</button>
            </div>
            <p class="meldung" role="status" data-rolle="katalog-meldung"></p>
          </details>
        </details>
      </section>`;

    const formular = container.querySelector('[data-rolle="mitarbeiter-formular"]');
    const formularTitel = formular.querySelector('[data-rolle="formular-titel"]');
    const abbrechenKnopf = formular.querySelector('[data-aktion="abbrechen"]');
    const meldung = formular.querySelector('.meldung');
    const listeElement = container.querySelector('[data-rolle="liste"]');

    async function ladeMitarbeiter() {
      const alle = await abfrage({ typ: 'mitarbeiter', baustelleId: PERSONAL_ID });
      return alle.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
    }

    function fuelleFormular(mitarbeiter) {
      inBearbeitung = mitarbeiter;
      formularTitel.textContent = mitarbeiter
        ? `${mitarbeiter.name} bearbeiten` : 'Neuer Mitarbeiter';
      abbrechenKnopf.hidden = !mitarbeiter;
      formular.elements.name.value = mitarbeiter?.name ?? '';
      formular.elements.lohnklasse.value = mitarbeiter?.lohnklasse ?? 'C';
      formular.elements.modell.value = mitarbeiter?.modell ?? 'kalender';
      formular.elements.sollProTag.value = mitarbeiter?.sollProTag ?? SOLL_PRO_TAG;
      meldung.textContent = '';
    }

    async function zeichneListe() {
      const alle = await ladeMitarbeiter();
      const aktive = alle.filter((m) => !m.archiviert);
      const archivierte = alle.filter((m) => m.archiviert);
      const karte = (m) => {
        const [, modellLabel, von, bis] = modellVon(m);
        return `
          <article class="karte baustelle${m.archiviert ? ' archiviert' : ''}">
            <div class="baustelle-kopf">
              <strong>${esc(m.name)}</strong> Lohnklasse ${esc(m.lohnklasse || '—')}
              ${m.archiviert ? '<span class="chip">archiviert</span>' : ''}
            </div>
            <p class="hinweis">${modellLabel} (${von}…+${bis} h) ·
              Soll ${zahl(m.sollProTag)} h/Tag</p>
            <div class="knopfzeile">
              <button type="button" class="knopf" data-aktion="konto"
                data-id="${esc(m._id)}">Stundenkonto</button>
              <button type="button" class="knopf" data-aktion="bearbeiten"
                data-id="${esc(m._id)}">Bearbeiten</button>
              <button type="button" class="knopf" data-aktion="${m.archiviert ? 'aktivieren' : 'archivieren'}"
                data-id="${esc(m._id)}">${m.archiviert ? 'Aktivieren' : 'Archivieren'}</button>
              ${m.archiviert ? `
                <button type="button" class="knopf eintrag-loeschen" data-aktion="loeschen"
                  data-id="${esc(m._id)}">Löschen</button>` : ''}
            </div>
          </article>`;
      };
      listeElement.innerHTML = `
        ${aktive.length ? aktive.map(karte).join('')
          : '<p class="hinweis">Noch keine Mitarbeiter erfasst.</p>'}
        ${archivierte.length ? `
          <details class="archiv">
            <summary>Archivierte Mitarbeiter (${archivierte.length})</summary>
            ${archivierte.map(karte).join('')}
          </details>` : ''}`;
    }

    formular.addEventListener('submit', async (abschicken) => {
      abschicken.preventDefault();
      try {
        const name = formular.elements.name.value.trim();
        if (!name) throw new Error('Name ist Pflicht.');
        const alle = await ladeMitarbeiter();
        const doppelt = alle.find((m) => m._id !== inBearbeitung?._id
          && m.name.trim().toLowerCase() === name.toLowerCase());
        if (doppelt) throw new Error(`«${doppelt.name}» ist bereits erfasst.`);
        const basis = inBearbeitung
          ? { ...inBearbeitung }
          : { typ: 'mitarbeiter', baustelleId: PERSONAL_ID, archiviert: false };
        await put({
          ...basis,
          name,
          lohnklasse: formular.elements.lohnklasse.value,
          modell: formular.elements.modell.value,
          sollProTag: formular.elements.sollProTag.value.trim() || String(SOLL_PRO_TAG),
        });
        fuelleFormular(null);
        meldung.textContent = 'Mitarbeiter gespeichert.';
        document.dispatchEvent(new CustomEvent('luense:daten'));
        await zeichneListe();
      } catch (fehler) {
        meldung.textContent = fehler.message;
      }
    });

    abbrechenKnopf.addEventListener('click', () => fuelleFormular(null));

    listeElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      const alle = await ladeMitarbeiter();
      const mitarbeiter = alle.find((m) => m._id === knopf.dataset.id);
      if (!mitarbeiter) return;
      const aktion = knopf.dataset.aktion;
      if (aktion === 'bearbeiten') {
        fuelleFormular(mitarbeiter);
        formular.scrollIntoView({ behavior: 'smooth' });
      } else if (aktion === 'archivieren' || aktion === 'aktivieren') {
        await put({ ...mitarbeiter, archiviert: aktion === 'archivieren' });
        await zeichneListe();
      } else if (aktion === 'loeschen') {
        if (!confirm(`${mitarbeiter.name} endgültig löschen? Die Rapporte bleiben unverändert.`)) return;
        await entferneDokument(mitarbeiter._id);
        if (inBearbeitung?._id === mitarbeiter._id) fuelleFormular(null);
        await zeichneListe();
      } else if (aktion === 'konto') {
        zeigeKonto(mitarbeiter);
      }
    });

    // ---------- Stundenkonto (Abend 10.2) ----------
    // Ist-Stunden aus den Personen-Zeilen ALLER Tagesrapporte (über alle
    // Baustellen), Absenzen zählen als Sollerfüllung, Reisezeit läuft
    // separat (LMV), Samstage werden markiert (25 % / meldepflichtig).
    // Soll = Arbeitstage Mo–Fr × Tagessoll. Jahressaldo kumuliert ab dem
    // ersten Monat mit Einträgen — mit LMV-Bandbreiten-Warnung je Modell.
    const kontoElement = container.querySelector('[data-rolle="konto"]');

    function gleicherName(a, b) {
      return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    function arbeitstageMoFr(jahr, monat) {
      let tage = 0;
      const d = new Date(jahr, monat - 1, 1);
      while (d.getMonth() === monat - 1) {
        if (d.getDay() >= 1 && d.getDay() <= 5) tage++;
        d.setDate(d.getDate() + 1);
      }
      return tage;
    }

    function istSamstag(tagIso) {
      return new Date(`${tagIso}T12:00:00`).getDay() === 6;
    }

    // Alle Einträge eines Mitarbeiters aus allen Rapporten, je Tag.
    async function ladeEintraege(mitarbeiter) {
      const [rapporte, baustellen] = await Promise.all([
        abfrage({ typ: 'rapport' }),
        abfrage({ typ: 'baustelle' }),
      ]);
      const ktrVon = new Map(baustellen.map((b) => [b.baustelleId, b.ktr]));
      const eintraege = [];
      for (const r of rapporte) {
        if (!r.tag) continue;
        const stunden = (r.arbeiten || [])
          .flatMap((arbeit) => arbeit.personen || [])
          .filter((person) => gleicherName(person.name, mitarbeiter.name))
          .reduce((s, person) => s + zahl(person.stunden), 0);
        const absenzen = (r.absenzen || []).filter((a) => gleicherName(a.name, mitarbeiter.name));
        const reiseMin = (r.reisezeiten || [])
          .filter((z) => gleicherName(z.name, mitarbeiter.name))
          .reduce((s, z) => s + zahl(z.minuten), 0);
        if (stunden || absenzen.length || reiseMin) {
          eintraege.push({
            tag: r.tag,
            ktr: ktrVon.get(r.baustelleId) || r.baustelleId,
            stunden,
            absenzen,
            absenzStunden: absenzen.reduce((s, a) => s + zahl(a.stunden), 0),
            reiseMin,
            samstag: istSamstag(r.tag),
          });
        }
      }
      return eintraege.sort((a, b) => a.tag.localeCompare(b.tag));
    }

    async function zeigeKonto(mitarbeiter, monatIso) {
      const eintraege = await ladeEintraege(mitarbeiter);
      const heute = new Date();
      const monat = monatIso
        || `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}`;
      const [jahr, monatNr] = monat.split('-').map(Number);
      const soll = zahl(mitarbeiter.sollProTag) || SOLL_PRO_TAG;
      const [, modellLabel, von, bis] = modellVon(mitarbeiter);

      const imMonat = eintraege.filter((e) => e.tag.startsWith(monat));
      const summe = (liste, feld) => liste.reduce((s, e) => s + e[feld], 0);
      const monatIst = summe(imMonat, 'stunden');
      const monatAbsenz = summe(imMonat, 'absenzStunden');
      const monatSoll = arbeitstageMoFr(jahr, monatNr) * soll;
      const monatSamstag = summe(imMonat.filter((e) => e.samstag), 'stunden');
      const monatReise = summe(imMonat, 'reiseMin');

      // Jahressaldo ab dem ersten Monat mit Einträgen dieses Jahres.
      const imJahr = eintraege.filter((e) => e.tag.startsWith(String(jahr))
        && e.tag.slice(0, 7) <= monat);
      const startMonat = imJahr.length ? Number(imJahr[0].tag.slice(5, 7)) : monatNr;
      let jahrSoll = 0;
      for (let m = startMonat; m <= monatNr; m++) jahrSoll += arbeitstageMoFr(jahr, m) * soll;
      const jahrIst = summe(imJahr, 'stunden') + summe(imJahr, 'absenzStunden');
      const saldo = jahrIst - jahrSoll;
      const ausserhalb = saldo < von || saldo > bis;

      const stundenText = (n) => `${Math.round(n * 100) / 100} h`;
      kontoElement.innerHTML = `
        <div class="karte">
          <h3>Stundenkonto · ${esc(mitarbeiter.name)}</h3>
          <p class="hinweis">${modellLabel} (Bandbreite ${von}…+${bis} h) ·
            Soll ${soll} h je Arbeitstag Mo–Fr · Kumulation ab
            ${String(startMonat).padStart(2, '0')}.${jahr} (erster Monat mit Einträgen).</p>
          <label>Monat<input type="month" data-rolle="konto-monat" value="${monat}"></label>
          <div class="kachel-reihe">
            <div class="karte kachel"><span class="kachel-titel">Soll ${String(monatNr).padStart(2, '0')}.${jahr}</span>
              <span class="kachel-wert">${stundenText(monatSoll)}</span></div>
            <div class="karte kachel"><span class="kachel-titel">Ist + Absenz</span>
              <span class="kachel-wert">${stundenText(monatIst + monatAbsenz)}</span></div>
            <div class="karte kachel${ausserhalb ? '' : ' kachel-gruen'}">
              <span class="kachel-titel">Saldo kumuliert</span>
              <span class="kachel-wert${ausserhalb ? ' verlust' : ''}">${saldo >= 0 ? '+' : ''}${stundenText(saldo)}</span></div>
          </div>
          ${ausserhalb ? `<p class="hinweis ueberfaellig">⚠ Saldo ausserhalb der
            LMV-Bandbreite (${von}…+${bis} h) — Stunden ausgleichen oder auszahlen.</p>` : ''}
          <p class="hinweis">${monatSamstag ? `Samstagsstunden im Monat:
            <b>${stundenText(monatSamstag)}</b> (25 % Zuschlag, meldepflichtig) · ` : ''}
            Reisezeit im Monat: ${monatReise} min (separat vom Konto, LMV-Staffel).</p>
          ${imMonat.length ? `
            <div class="tabellen-scroll">
              <table class="uebersicht-tabelle">
                <thead><tr><th>Datum</th><th>KTR</th><th class="zahl">Arbeit</th>
                  <th>Absenz</th><th class="zahl">Reise</th></tr></thead>
                <tbody>
                  ${imMonat.map((e) => `
                    <tr>
                      <td class="kein-umbruch">${e.tag.split('-').reverse().join('.')}${
                        e.samstag ? ' <span class="skonto-chance">Sa</span>' : ''}</td>
                      <td class="kein-umbruch">${esc(e.ktr)}</td>
                      <td class="zahl">${e.stunden ? stundenText(e.stunden) : '—'}</td>
                      <td>${e.absenzen.length ? e.absenzen
                        .map((a) => `${esc(a.art)} ${zahl(a.stunden)} h`).join(', ') : '—'}</td>
                      <td class="zahl">${e.reiseMin ? `${e.reiseMin} min` : '—'}</td>
                    </tr>`).join('')}
                  <tr class="summen-zeile">
                    <td colspan="2"><b>Total Monat</b></td>
                    <td class="zahl"><b>${stundenText(monatIst)}</b></td>
                    <td><b>${stundenText(monatAbsenz)}</b></td>
                    <td class="zahl"><b>${monatReise} min</b></td>
                  </tr>
                </tbody>
              </table>
            </div>`
          : '<p class="hinweis">Keine Einträge in diesem Monat.</p>'}
          <div class="knopfzeile">
            <button type="button" class="knopf" data-aktion="konto-export"
              data-id="${esc(mitarbeiter._id)}" data-monat="${monat}"
              title="Öffnet direkt in Excel">Excel-Export (Treuhänder)</button>
            <button type="button" class="knopf" data-aktion="konto-zu">Schliessen</button>
          </div>
        </div>`;
      kontoElement.querySelector('[data-rolle="konto-monat"]')
        .addEventListener('change', (wechsel) => zeigeKonto(mitarbeiter, wechsel.target.value));
      kontoElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    kontoElement.addEventListener('click', async (klick) => {
      const knopf = klick.target.closest('[data-aktion]');
      if (!knopf) return;
      if (knopf.dataset.aktion === 'konto-zu') {
        kontoElement.innerHTML = '';
      } else if (knopf.dataset.aktion === 'konto-export') {
        // Treuhänder-Export (Abend 10.3): ein Monatsblatt je Mitarbeiter —
        // das Lohnbüro rechnet die Löhne, Lünse liefert saubere Grundlagen.
        const alle = await ladeMitarbeiter();
        const mitarbeiter = alle.find((m) => m._id === knopf.dataset.id);
        const monat = knopf.dataset.monat;
        if (!mitarbeiter || !monat) return;
        const eintraege = (await ladeEintraege(mitarbeiter))
          .filter((e) => e.tag.startsWith(monat));
        const soll = zahl(mitarbeiter.sollProTag) || SOLL_PRO_TAG;
        const [jahr, monatNr] = monat.split('-').map(Number);
        const zeilen = eintraege.map((e) => [
          e.tag.split('-').reverse().join('.'), e.ktr,
          e.stunden || '', e.samstag && e.stunden ? 'ja' : '',
          e.absenzen.map((a) => a.art).join(', '),
          e.absenzStunden || '', e.reiseMin || '']);
        zeilen.push(['Total Monat', '',
          eintraege.reduce((s, e) => s + e.stunden, 0), '',
          `Soll ${arbeitstageMoFr(jahr, monatNr) * soll} h`,
          eintraege.reduce((s, e) => s + e.absenzStunden, 0),
          eintraege.reduce((s, e) => s + e.reiseMin, 0)]);
        exportiereCsv(
          `luense-stunden-${mitarbeiter.name.replace(/\s+/g, '_')}-${monat}.csv`,
          ['Datum', 'Baustelle (KTR)', 'Arbeitsstunden', 'Samstag (25 %)',
            'Absenzart', 'Absenzstunden', 'Reisezeit min'],
          zeilen,
        );
      }
    });

    // Kontrolle: Namen aus den Rapporten, die keinem Mitarbeiter zugeordnet
    // sind — Tippfehler fallen so sofort auf.
    async function zeigeUnzugeordnete() {
      const [rapporte, mitarbeiter] = await Promise.all([
        abfrage({ typ: 'rapport' }), ladeMitarbeiter(),
      ]);
      const bekannt = new Set(mitarbeiter.map((m) => m.name.trim().toLowerCase()));
      const fremde = new Set();
      for (const r of rapporte) {
        for (const person of (r.arbeiten || []).flatMap((a) => a.personen || [])) {
          const name = String(person.name || '').trim();
          if (name && !bekannt.has(name.toLowerCase())) fremde.add(name);
        }
      }
      if (fremde.size) {
        listeElement.insertAdjacentHTML('beforeend', `
          <p class="hinweis">⚠ Namen in Rapporten ohne Mitarbeiter-Stamm:
            ${[...fremde].slice(0, 10).map(esc).join(', ')}${fremde.size > 10 ? ' …' : ''}
            — gleich schreiben wie hier, sonst fehlen die Stunden im Konto.</p>`);
      }
    }

    // ---------- Gerätestamm (für die Maschinen-Matrix im Rapport) ----------
    const geraeteListe = container.querySelector('[data-rolle="geraete-liste"]');

    async function ladeGeraete() {
      const alle = await abfrage({ typ: 'geraet', baustelleId: PERSONAL_ID });
      return alle.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
    }

    async function zeichneGeraete() {
      const geraete = await ladeGeraete();
      geraeteListe.innerHTML = geraete.length
        ? geraete.map((g) => `
            <div class="fo-zeile dossier-zeile${g.archiviert ? ' erledigt-zeile' : ''}">
              <span class="fo-label">${esc(g.name)}${g.archiviert ? ' (archiviert)' : ''}${
                g.art === 'fremdleistung' ? ' <span class="chip">Fremdleistung</span>' : ''}</span>
              <button type="button" class="knopf" data-geraet-archiv="${esc(g._id)}">
                ${g.archiviert ? 'Aktivieren' : 'Archivieren'}</button>
              <button type="button" class="knopf zeile-weg" data-geraet-weg="${esc(g._id)}"
                aria-label="Gerät löschen">×</button>
            </div>`).join('')
        : '<p class="hinweis">Noch keine Geräte erfasst.</p>';
    }

    container.querySelector('[data-rolle="geraet-form"]')
      .addEventListener('submit', async (abschicken) => {
        abschicken.preventDefault();
        const f = abschicken.target;
        const name = f.elements.name.value.trim();
        if (!name) return;
        const geraete = await ladeGeraete();
        if (geraete.some((g) => g.name.trim().toLowerCase() === name.toLowerCase())) {
          alert(`«${name}» ist bereits im Gerätestamm.`);
          return;
        }
        await put({ typ: 'geraet', baustelleId: PERSONAL_ID, name, archiviert: false });
        f.reset();
        await zeichneGeraete();
        if (katalogWahl.open) await zeichneKatalog();
      });

    // ---------- Katalog-Wahl: fix hinterlegte Geräte übernehmen ----------
    const katalogWahl = container.querySelector('[data-rolle="katalog-wahl"]');
    const katalogGruppen = katalogWahl.querySelector('[data-rolle="katalog-gruppen"]');
    const katalogSuche = katalogWahl.querySelector('[data-rolle="katalog-suche"]');
    const katalogMeldung = katalogWahl.querySelector('[data-rolle="katalog-meldung"]');

    async function zeichneKatalog() {
      const vorhanden = new Set((await ladeGeraete()).map((g) => g.name.trim().toLowerCase()));
      const gewaehlt = new Set([...katalogGruppen.querySelectorAll('[data-katalog]:checked')]
        .map((el) => el.value));
      const gruppeHtml = (art) => ({ gruppe, eintraege }) => `
        <fieldset class="katalog-gruppe">
          <legend>${esc(gruppe)}</legend>
          <div class="chips">${eintraege.map((e) => {
            const schon = vorhanden.has(e.name.toLowerCase());
            return `
              <label class="chip-wahl${schon ? ' katalog-vorhanden' : ''}" data-katalog-name="${esc(e.name.toLowerCase())}">
                <input type="checkbox" data-katalog data-art="${art}" value="${esc(e.name)}"
                  ${schon ? 'disabled' : ''} ${!schon && gewaehlt.has(e.name) ? 'checked' : ''}>
                <span>${schon ? '✓ ' : ''}${esc(e.name)}</span>
              </label>`;
          }).join('')}</div>
        </fieldset>`;
      // Zwei Abschnitte: eigene Maschinen/Geräte und Fremdleistungen.
      // Beide werden normale Geräte im Stamm (Zeilen der Rapport-Matrix),
      // Fremdleistungen tragen art: 'fremdleistung'.
      katalogGruppen.innerHTML = `
        <h4 class="katalog-abschnitt">Maschinen / Geräte</h4>
        ${nachGruppe(MASCHINEN, MASCHINEN_GRUPPEN).map(gruppeHtml('maschine')).join('')}
        <h4 class="katalog-abschnitt" data-rolle="fremd-abschnitt">Fremdleistungen</h4>
        ${nachGruppe(FREMDLEISTUNGEN, FREMDLEISTUNGS_GRUPPEN).map(gruppeHtml('fremdleistung')).join('')}`;
      filtereKatalog();
    }

    function filtereKatalog() {
      const suche = katalogSuche.value.trim().toLowerCase();
      katalogGruppen.querySelectorAll('.katalog-gruppe').forEach((gruppe) => {
        let sichtbar = 0;
        gruppe.querySelectorAll('[data-katalog-name]').forEach((chip) => {
          const passt = !suche || chip.dataset.katalogName.includes(suche)
            || gruppe.querySelector('legend').textContent.toLowerCase().includes(suche);
          chip.hidden = !passt;
          if (passt) sichtbar += 1;
        });
        gruppe.hidden = !sichtbar;
      });
      // Abschnittstitel ohne sichtbare Gruppe ausblenden.
      katalogGruppen.querySelectorAll('.katalog-abschnitt').forEach((titel) => {
        let el = titel.nextElementSibling;
        let leer = true;
        while (el && !el.classList.contains('katalog-abschnitt')) {
          if (!el.hidden) leer = false;
          el = el.nextElementSibling;
        }
        titel.hidden = leer;
      });
    }

    katalogSuche.addEventListener('input', filtereKatalog);
    katalogWahl.addEventListener('toggle', () => {
      if (katalogWahl.open) zeichneKatalog();
    });

    katalogWahl.querySelector('[data-aktion="katalog-uebernehmen"]')
      .addEventListener('click', async () => {
        const gewaehlte = [...katalogGruppen.querySelectorAll('[data-katalog]:checked')]
          .map((el) => ({ name: el.value, art: el.dataset.art }));
        const namen = gewaehlte.map((g) => g.name);
        if (!namen.length) {
          katalogMeldung.textContent = 'Nichts ausgewählt — zuerst Einträge antippen.';
          return;
        }
        const vorhanden = new Set((await ladeGeraete()).map((g) => g.name.trim().toLowerCase()));
        const neu = gewaehlte.filter((g) => !vorhanden.has(g.name.toLowerCase()));
        for (const { name, art } of neu) {
          await put({
            typ: 'geraet', baustelleId: PERSONAL_ID, name, archiviert: false,
            ...(art === 'fremdleistung' ? { art } : {}),
          });
        }
        const uebersprungen = namen.length - neu.length;
        katalogMeldung.textContent = `${neu.length} ${neu.length === 1 ? 'Eintrag' : 'Einträge'} übernommen${
          uebersprungen ? `, ${uebersprungen} schon vorhanden` : ''}.`;
        katalogGruppen.querySelectorAll('[data-katalog]:checked').forEach((el) => { el.checked = false; });
        await zeichneGeraete();
        await zeichneKatalog();
      });

    geraeteListe.addEventListener('click', async (klick) => {
      const archivId = klick.target.closest('[data-geraet-archiv]')?.dataset.geraetArchiv;
      const wegId = klick.target.closest('[data-geraet-weg]')?.dataset.geraetWeg;
      if (archivId) {
        const geraet = (await ladeGeraete()).find((g) => g._id === archivId);
        await put({ ...geraet, archiviert: !geraet.archiviert });
        await zeichneGeraete();
      } else if (wegId) {
        if (!confirm('Gerät aus dem Stamm löschen? Bestehende Rapporte bleiben unverändert.')) return;
        await entferneDokument(wegId);
        await zeichneGeraete();
        if (katalogWahl.open) await zeichneKatalog();
      }
    });

    fuelleFormular(null);
    zeichneListe().then(zeigeUnzugeordnete);
    zeichneGeraete();
  },
};
