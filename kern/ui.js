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
