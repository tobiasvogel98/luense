// kern/katalog.js — fix hinterlegte Ablage: übliche Maschinen, Geräte und
// Fremdleistungen im Schweizer Tiefbau / Werkleitungsbau.
// Bewusst CODE, keine Datenbank-Daten: nur lesen, nie schreiben. Wer etwas
// davon braucht, übernimmt es als eigenes Dokument (z. B. Gerätestamm) oder
// nutzt es als Vorschlag beim Tippen (Rapport). Keine Preise.
// Nicht verwechseln mit dem NPK-Positionskatalog (Dokumente «katalogposition»).
// Genutzt von: Personal-Modul (Gerätestamm, Maschinen UND Fremdleistungen)
// und Rapport-Modul (Vorschläge).
//
// Eintrag: { name, gruppe, einheit } — einheit 'h' = nach Stunden.

const eintraege = (gruppe, einheit, namen) =>
  namen.map((name) => (typeof name === 'string'
    ? { name, gruppe, einheit }
    : { gruppe, einheit, ...name }));

// Gruppen der Maschinen/Geräte — Reihenfolge = Anzeige-Reihenfolge.
// Bewusst schlank für den Start: Bagger nach Gewicht, Dumper nach
// Nutzlast, gängige Kleingeräte. Lastwagen/Transport sind Fremdleistungen.
export const MASCHINEN_GRUPPEN = ['Bagger', 'Dumper', 'Kleingeräte'];

export const FREMDLEISTUNGS_GRUPPEN = [
  'Transport & Kran', 'Kanal & Werkleitungen', 'Belag & Oberbau', 'Spezialtiefbau & Wasser',
  'Vermessung & Prüfung', 'Handwerker', 'Verkehr & Entsorgung',
];

export const MASCHINEN = Object.freeze([
  ...eintraege('Bagger', 'h', [
    'Minibagger 1.5 t', 'Minibagger 3 t', 'Minibagger 5 t',
    'Mobilbagger 8 t', 'Mobilbagger 14 t', 'Mobilbagger 18 t',
    'Raupenbagger 14 t', 'Raupenbagger 22 t', 'Raupenbagger 30 t',
  ]),
  ...eintraege('Dumper', 'h', [
    'Dumper 1.5 t Nutzlast', 'Dumper 3 t Nutzlast', 'Dumper 6 t Nutzlast', 'Dumper 9 t Nutzlast',
  ]),
  ...eintraege('Kleingeräte', 'h', [
    'Vibroplatte 100 kg', 'Vibroplatte 200 kg', 'Vibroplatte 400 kg',
    'Stampfer', 'Grabenwalze', 'Kompressor mit Abbauhammer', 'Tauchpumpe',
    'Notstromaggregat', 'Fugenschneider', 'Kernbohrgerät', 'Betonmischer',
    'Trennscheibe', 'Nivellier-/Rotationslaser', 'Verbauboxen (Grabenverbau)',
  ]),
]);

export const FREMDLEISTUNGEN = Object.freeze([
  ...eintraege('Kanal & Werkleitungen', 'h', [
    'Kanal-TV-Aufnahme', 'Saugwagen', 'Spülwagen / Kanalreinigung',
    'Werkleitungsortung / Sondierung', 'Rohrleitungsbau / PE-Schweisser',
  ]),
  ...eintraege('Belag & Oberbau', 'h', [
    { name: 'Belagsarbeiten (Belagsfirma)', einheit: 't' },
    { name: 'Markierungen', einheit: 'm' },
    'Kernbohrung (Firma)',
  ]),
  ...eintraege('Spezialtiefbau & Wasser', 'h', [
    'Spundwand / Spezialtiefbau', 'Wasserhaltung (Firma)',
  ]),
  ...eintraege('Transport & Kran', 'h', [
    'Lastwagen 3-Achser mit Chauffeur', 'Lastwagen 4-Achser mit Chauffeur',
    'Sattelzug / Tieflader', 'Autokran mit Kranführer', 'Pneukran',
    { name: 'Betonlieferung mit Pumpe', einheit: 'm³' },
  ]),
  ...eintraege('Vermessung & Prüfung', 'h', [
    'Vermessung / Geometer', 'Labor / ME-Messung (Verdichtung)',
  ]),
  ...eintraege('Handwerker', 'h', [
    'Elektriker', 'Sanitär', 'Gartenbau / Rasen',
  ]),
  ...eintraege('Verkehr & Entsorgung', 'h', [
    'Verkehrsdienst / Signalisation',
    { name: 'Entsorgung / Mulden', einheit: 'Stk' },
  ]),
]);

// Einträge nach Gruppe, in der Reihenfolge der Gruppenliste.
export function nachGruppe(liste, gruppen) {
  return gruppen.map((gruppe) => ({
    gruppe, eintraege: liste.filter((e) => e.gruppe === gruppe),
  })).filter((g) => g.eintraege.length);
}
