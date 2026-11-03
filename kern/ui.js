// kern/ui.js — kleine UI-Helfer, die mehr als eine Ansicht braucht.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Woran ein Arbeitstext Regie erkennt: das Wort selbst plus typische
// Indikatoren (Quelle: Regieanmeldung in LünseDok und Baupraxis).
// Wortstämme, damit Beugungen wie «unvorhergesehener» mitgehen.
// Genutzt vom Rapport-Modul (Vorschlag beim Tippen) und vom Importer.
export const REGIE_MUSTER = new RegExp([
  'regie',
  'nachtrag',
  'unvorhergesehen',
  'zusatzarbeit', 'zusatzaufwand', 'zusatzleistung',
  'mehraufwand', 'mehrleistung', 'mehrkosten',
  'stundenlohn',
  'nicht im lv', 'ausserhalb (des )?lv', 'nicht ausgeschrieben', 'nicht offeriert',
  'auf anordnung', 'anordnung (der )?bauleitung', 'anordnung (des )?bauherrn',
  'auf wunsch',
  'ausservertraglich',
].join('|'), 'i');

// Bild in Vollbild zeigen, optional mit Löschen — genutzt vom Journal
// (Fotos) und von den Protokollen (Handnotizen).
export function zeigeBildVollbild(quelle, { onLoeschen } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'vollbild';
  overlay.innerHTML = `
    <img src="${quelle}" alt="Bild in Vollbild">
    ${onLoeschen ? `
      <div class="vollbild-leiste">
        <button type="button" class="knopf" data-aktion="bild-loeschen">Bild löschen</button>
      </div>` : ''}`;
  overlay.addEventListener('click', async (klick) => {
    if (!klick.target.closest('[data-aktion="bild-loeschen"]')) {
      overlay.remove();
      return;
    }
    if (!confirm('Dieses Bild endgültig löschen?')) return;
    await onLoeschen();
    overlay.remove();
  });
  document.body.append(overlay);
}

// ISO-Datum als de-CH-Anzeige, z. B. «29.08.2026, 14:05».
export function formatDatumZeit(iso) {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) return '';
  return datum.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Beträge in CHF, de-CH mit Apostroph als Tausendertrenner.
// Regel für die ganze App:
//  • chf()      — 2 Dezimalen (CHF 1'450.00) für Dokumente und Listen:
//                 Rechnung, Offerte, Nachtrag, Kreditor, Ausmass, PDF-Positionen.
//  • chfGanz()  — ganze Franken (CHF 1'450) NUR für grosse Kennzahl-Kacheln
//                 und Summen-Übersichten (Dossier-KPIs, Controlling).
// Gerechnet wird immer mit den ungerundeten Werten; gerundet wird nur
// in der Anzeige.
export function chf(n) {
  return `CHF ${(Number(n) || 0).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

export function chfGanz(n) {
  return `CHF ${Math.round(Number(n) || 0).toLocaleString('de-CH')}`;
}
