// module/dossier.js — Baustellen-Dossier: eine Seite je Baustelle, die
// «Wo stehen wir?» ohne zweiten Klick beantwortet. Liest die geteilten
// Dokumente aller Module (nie deren Code): Kennzahlen aus dem letzten
// Monatsabschluss, offene Posten aus Nachträgen/Pendenzen/Abnahmen/
// Rapporten, letzte Journal-Ereignisse. Eigene Dokumenttypen:
// «meilenstein» und «kontakt» (am Baustellen-Stamm).

import { put, abfrage, entferneDokument } from '../kern/speicher.js';
import { berechneAbschluss } from '../kern/fo.js';
import { zeigeProtokollDruck } from '../kern/pdf.js';
import { esc, formatDatumZeit } from '../kern/ui.js';

function zahl(wert) {
  const n = parseFloat(String(wert ?? '').replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chf(n) {
  return `CHF ${Math.round(n).toLocaleString('de-CH')}`;
}

function prozentText(anteil) {
  return anteil === null || !Number.isFinite(anteil) ? '—'
    : `${(anteil * 100).toLocaleString('de-CH', { maximumFractionDigits: 1 })} %`;
}

function formatTag(tagIso) {
  if (!tagIso) return '';
  const [j, m, t] = String(tagIso).slice(0, 10).split('-');
  return t && m && j ? `${t}.${m}.${j}` : tagIso;
}

function heuteTag() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

export default {
  name: 'Dossier',
  dokumentTypen: ['meilenstein', 'kontakt'],

  render(container, baustelle) {
    async function ladeAlles() {
      const [abschluesse, nachtraege, pendenzen, protokolle, rapporte, ereignisse,
        meilensteine, kontakte] = await Promise.all([
        abfrage({ typ: 'kosten', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'nachtrag', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'pendenz', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'protokoll', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'rapport', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'ereignis', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'meilenstein', baustelleId: baustelle.baustelleId }),
        abfrage({ typ: 'kontakt', baustelleId: baustelle.baustelleId }),
      ]);
      const rechnungen = await abfrage({ typ: 'rechnung', baustelleId: baustelle.baustelleId });
      return { abschluesse, nachtraege, pendenzen, protokolle, rapporte, ereignisse,
        meilensteine, kontakte, rechnungen };
    }

    function sprungKnopf(modulName) {
      return `<button type="button" class="knopf eintrag-loeschen" data-sprung="${modulName}">
        → ${modulName}</button>`;
    }

    async function zeichne() {
      const d = await ladeAlles();
      const letzter = d.abschluesse
        .slice().sort((a, b) => (b.stichtag || '').localeCompare(a.stichtag || ''))[0];
      const kenn = letzter ? berechneAbschluss(letzter.werte || {}) : null;
      const ntOffen = d.nachtraege.filter((n) => !['genehmigt', 'verrechnet'].includes(n.status));
      const ntOffenSumme = ntOffen.reduce((s, n) => s + zahl(n.summe), 0);
      const pendenzenOffen = d.pendenzen.filter((p) => !p.erledigtAm);
      const abnahmeMaengel = d.protokolle
        .filter((p) => p.unterTyp === 'abnahme')
        .flatMap((p) => (p.werte?.maengel || [])
          .filter((m) => m.status !== 'behoben')
          .map((m) => ({ ...m, datum: p.werte?.datum })));
      const regieOhneNachtrag = d.rapporte.filter((r) => zahl(r.davonRegie) > 0
        && !d.nachtraege.some((n) => n.beweise?.rapportIds?.includes(r._id)));
      const gestellteRechnungen = d.rechnungen.filter((r) => r.status === 'gestellt');
      const gestellteSumme = gestellteRechnungen.reduce((s, r) => s + zahl(r.betrag), 0);
      const letzteEreignisse = d.ereignisse.slice(0, 5);

      // Zeit vs. Leistung: Start = ältestes Ereignis/Rapport, Ende = Bauende.
      const startDaten = [...d.ereignisse, ...d.rapporte].map((x) => x.datum).filter(Boolean).sort();
      const start = startDaten[0]?.slice(0, 10);
      const bauende = letzter?.werte?.bauende;
      let zeitAnteil = null;
      if (start && bauende && bauende > start) {
        const gesamt = new Date(bauende) - new Date(start);
        zeitAnteil = Math.min(Math.max((new Date(heuteTag()) - new Date(start)) / gesamt, 0), 1);
      }
      const leistungAnteil = kenn && kenn.w10 > 0 ? Math.min(kenn.a13 / kenn.w10, 1) : null;

      const meilensteine = d.meilensteine
        .slice().sort((a, b) => (a.termin || '').localeCompare(b.termin || ''));

      container.innerHTML = `
        <section class="dossier">
          <h2>Dossier · ${esc(baustelle.ktr)} ${esc(baustelle.name)}</h2>

          <div class="karte">
            <p class="hinweis">${[
              baustelle.ort ? esc(baustelle.ort) : '',
              baustelle.bauherr ? `Bauherr: ${esc(baustelle.bauherr)}` : '',
              baustelle.werkvertrag ? `Werkvertrag: ${esc(baustelle.werkvertrag)}` : '',
              bauende ? `Bauende: ${formatTag(bauende)}` : '',
              letzter ? `Letzter Abschluss: ${formatTag(letzter.stichtag)}` : 'Noch kein Monatsabschluss',
            ].filter(Boolean).join(' · ')}</p>
            <div class="knopfzeile">
              <button type="button" class="knopf knopf-primaer" data-aktion="pdf">Dossier-PDF</button>
            </div>
          </div>

          <div class="kachel-reihe">
            <div class="karte kachel"><span class="kachel-titel">Leistung (A13)</span>
              <span class="kachel-wert">${kenn ? chf(kenn.a13) : '—'}</span></div>
            <div class="karte kachel ${kenn?.k1 > 0 ? 'kachel-gruen' : ''}">
              <span class="kachel-titel">Ergebnis (K1)</span>
              <span class="kachel-wert ${kenn?.k1 < 0 ? 'verlust' : ''}">${kenn ? prozentText(kenn.k1) : '—'}</span></div>
          </div>
          <div class="kachel-reihe">
            <div class="karte kachel"><span class="kachel-titel">NT offen (${ntOffen.length})</span>
              <span class="kachel-wert">${chf(ntOffenSumme)}</span></div>
            <div class="karte kachel"><span class="kachel-titel">Pendenzen offen</span>
              <span class="kachel-wert">${pendenzenOffen.length}</span></div>
            <div class="karte kachel"><span class="kachel-titel">Gestellt, nicht bezahlt
              (${gestellteRechnungen.length})</span>
              <span class="kachel-wert">${chf(gestellteSumme)}</span></div>
          </div>

          ${zeitAnteil !== null || leistungAnteil !== null ? `
            <div class="karte">
              <h3>Zeit vs. Leistung</h3>
              ${leistungAnteil !== null ? `
                <p class="balken-label">Leistung ${prozentText(leistungAnteil)}</p>
                <div class="balken"><div class="balken-fuellung" style="width:${leistungAnteil * 100}%"></div></div>` : ''}
              ${zeitAnteil !== null ? `
                <p class="balken-label">Zeit ${prozentText(zeitAnteil)} (Start ${formatTag(start)} – Bauende ${formatTag(bauende)})</p>
                <div class="balken"><div class="balken-fuellung balken-zeit" style="width:${zeitAnteil * 100}%"></div></div>` : ''}
            </div>` : ''}

          <div class="karte">
            <h3>Offene Posten ${sprungKnopf('Nachträge')} ${sprungKnopf('Pendenzen')}</h3>
            ${ntOffen.length ? `<p class="gruppen-label">Nachträge</p>${ntOffen.map((n) => `
              <p class="hinweis">• ${esc(n.nummer)} ${esc(n.titel)} — ${esc(n.status)}${
                zahl(n.summe) ? ` · ${chf(zahl(n.summe))}` : ''}</p>`).join('')}` : ''}
            ${pendenzenOffen.length ? `<p class="gruppen-label">Pendenzen</p>${pendenzenOffen.slice(0, 8).map((p) => `
              <p class="hinweis">• ${esc(p.text)}${p.termin ? ` · bis ${formatTag(p.termin)}` : ''}</p>`).join('')}${
              pendenzenOffen.length > 8 ? `<p class="hinweis">… und ${pendenzenOffen.length - 8} weitere</p>` : ''}` : ''}
            ${abnahmeMaengel.length ? `<p class="gruppen-label">Abnahme-Mängel offen</p>${abnahmeMaengel.map((m) => `
              <p class="hinweis">• ${esc(m.mangel)}${m.frist ? ` · Frist ${formatTag(m.frist)}` : ''}</p>`).join('')}` : ''}
            ${regieOhneNachtrag.length ? `<p class="gruppen-label">Regie-Rapporte ohne Nachtrag</p>${
              regieOhneNachtrag.map((r) => `
                <p class="hinweis">• Rapport ${formatTag(r.tag)} · Regie ${r.davonRegie} h</p>`).join('')}` : ''}
            ${!ntOffen.length && !pendenzenOffen.length && !abnahmeMaengel.length && !regieOhneNachtrag.length
              ? '<p class="hinweis">Nichts offen — sauber. ✓</p>' : ''}
          </div>

          <div class="karte">
            <h3>Meilensteine</h3>
            <div data-rolle="meilensteine">
              ${meilensteine.length ? meilensteine.map((m) => `
                <div class="fo-zeile dossier-zeile${m.erledigt ? ' erledigt-zeile' : ''}">
                  <button type="button" class="knopf pendenz-haken" data-aktion="meilenstein-haken"
                    data-id="${esc(m._id)}">${m.erledigt ? '↺' : '✓'}</button>
                  <span class="fo-label">${esc(m.titel)}${m.termin ? ` · ${formatTag(m.termin)}` : ''}</span>
                  <button type="button" class="knopf zeile-weg" data-aktion="meilenstein-weg"
                    data-id="${esc(m._id)}" aria-label="Meilenstein löschen">×</button>
                </div>`).join('') : '<p class="hinweis">Noch keine Meilensteine.</p>'}
            </div>
            <form class="feld-reihe" data-rolle="meilenstein-form">
              <label>Meilenstein<input name="titel" required autocomplete="off"
                placeholder="z. B. Belagseinbau"></label>
              <label>Termin<input name="termin" type="date"></label>
              <button type="submit" class="knopf zeile-hinzu">+ Meilenstein</button>
            </form>
          </div>

          <div class="karte">
            <h3>Kontakte</h3>
            <div data-rolle="kontakte">
              ${d.kontakte.length ? d.kontakte.map((k) => `
                <div class="fo-zeile dossier-zeile">
                  <span class="fo-label"><b>${esc(k.name)}</b>${k.rolle ? ` · ${esc(k.rolle)}` : ''}${
                    k.telefon ? ` · <a href="tel:${esc(k.telefon)}">${esc(k.telefon)}</a>` : ''}</span>
                  <button type="button" class="knopf zeile-weg" data-aktion="kontakt-weg"
                    data-id="${esc(k._id)}" aria-label="Kontakt löschen">×</button>
                </div>`).join('') : '<p class="hinweis">Noch keine Kontakte.</p>'}
            </div>
            <form class="feld-reihe" data-rolle="kontakt-form">
              <label>Name<input name="name" required autocomplete="off"></label>
              <label>Rolle/Firma<input name="rolle" autocomplete="off"></label>
              <label>Telefon<input name="telefon" type="tel" autocomplete="off"></label>
              <button type="submit" class="knopf zeile-hinzu">+ Kontakt</button>
            </form>
          </div>

          <div class="karte">
            <h3>Letzte Journal-Ereignisse ${sprungKnopf('Journal')}</h3>
            ${letzteEreignisse.length ? letzteEreignisse.map((e) => `
              <p class="hinweis">• ${esc(e.tag)} · ${formatDatumZeit(e.datum)}${
                e.notiz ? ` — ${esc(e.notiz.slice(0, 60))}` : ''}</p>`).join('')
              : '<p class="hinweis">Noch keine Einträge.</p>'}
          </div>
        </section>`;

      // ---------- Ereignisse ----------
      container.querySelector('[data-aktion="pdf"]').addEventListener('click', () => {
        zeigeProtokollDruck(baustelle, {
          titel: 'Baustellen-Dossier',
          untertitel: [
            baustelle.ort, baustelle.bauherr ? `Bauherr: ${baustelle.bauherr}` : '',
            `Stand: ${formatTag(heuteTag())}`,
          ].filter(Boolean).join(' · '),
          abschnitte: [
            { art: 'felder', titel: 'Kennzahlen', zeilen: [
              { label: 'Leistung (A13)', wert: kenn ? chf(kenn.a13) : '—' },
              { label: 'Selbstkosten (S6)', wert: kenn ? chf(kenn.s6) : '—' },
              { label: 'Ergebnis (K1)', wert: kenn ? prozentText(kenn.k1) : '—' },
              { label: 'Restbausumme (K3)', wert: kenn ? chf(kenn.k3) : '—' },
              { label: 'Nachträge offen', wert: `${ntOffen.length} · ${chf(ntOffenSumme)}` },
              { label: 'Pendenzen offen', wert: String(pendenzenOffen.length) },
            ] },
            ntOffen.length ? { art: 'tabelle', titel: 'Offene Nachträge',
              spalten: ['Nr.', 'Titel', 'Status', 'Summe'],
              zeilen: ntOffen.map((n) => [n.nummer, n.titel, n.status, chf(zahl(n.summe))]) } : null,
            pendenzenOffen.length ? { art: 'tabelle', titel: 'Offene Pendenzen',
              spalten: ['Pendenz', 'Verantwortlich', 'Termin'],
              zeilen: pendenzenOffen.map((p) => [p.text, p.verantwortlich || '—', formatTag(p.termin) || '—']) } : null,
            meilensteine.length ? { art: 'tabelle', titel: 'Meilensteine',
              spalten: ['Meilenstein', 'Termin', 'Status'],
              zeilen: meilensteine.map((m) => [m.titel, formatTag(m.termin) || '—', m.erledigt ? 'erledigt' : 'offen']) } : null,
            d.kontakte.length ? { art: 'tabelle', titel: 'Kontakte',
              spalten: ['Name', 'Rolle/Firma', 'Telefon'],
              zeilen: d.kontakte.map((k) => [k.name, k.rolle || '—', k.telefon || '—']) } : null,
            letzteEreignisse.length ? { art: 'felder', titel: 'Letzte Journal-Ereignisse',
              zeilen: letzteEreignisse.map((e) => ({
                label: `${e.tag} · ${formatDatumZeit(e.datum)}`, wert: e.notiz || '—',
              })) } : null,
          ].filter(Boolean),
          unterschriften: ['Bauführer'],
        });
      });

      container.querySelector('[data-rolle="meilenstein-form"]')
        .addEventListener('submit', async (abschicken) => {
          abschicken.preventDefault();
          const f = abschicken.target;
          await put({
            typ: 'meilenstein', baustelleId: baustelle.baustelleId,
            titel: f.elements.titel.value.trim(), termin: f.elements.termin.value, erledigt: false,
          });
          zeichne();
        });

      container.querySelector('[data-rolle="kontakt-form"]')
        .addEventListener('submit', async (abschicken) => {
          abschicken.preventDefault();
          const f = abschicken.target;
          await put({
            typ: 'kontakt', baustelleId: baustelle.baustelleId,
            name: f.elements.name.value.trim(), rolle: f.elements.rolle.value.trim(),
            telefon: f.elements.telefon.value.trim(),
          });
          zeichne();
        });

      container.querySelector('.dossier').addEventListener('click', async (klick) => {
        const sprung = klick.target.closest('[data-sprung]');
        if (sprung) {
          document.dispatchEvent(new CustomEvent('luense:modulWechseln', {
            detail: { name: sprung.dataset.sprung },
          }));
          return;
        }
        const knopf = klick.target.closest('[data-aktion]');
        if (!knopf?.dataset.id) return;
        if (knopf.dataset.aktion === 'meilenstein-haken') {
          const alle = await abfrage({ typ: 'meilenstein', baustelleId: baustelle.baustelleId });
          const m = alle.find((x) => x._id === knopf.dataset.id);
          if (m) await put({ ...m, erledigt: !m.erledigt });
          zeichne();
        } else if (knopf.dataset.aktion === 'meilenstein-weg') {
          if (!confirm('Meilenstein löschen?')) return;
          await entferneDokument(knopf.dataset.id);
          zeichne();
        } else if (knopf.dataset.aktion === 'kontakt-weg') {
          if (!confirm('Kontakt löschen?')) return;
          await entferneDokument(knopf.dataset.id);
          zeichne();
        }
      });
    }

    zeichne();
  },
};
