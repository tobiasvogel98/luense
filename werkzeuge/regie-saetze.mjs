// werkzeuge/regie-saetze.mjs — Prüfliste für die Regie-Erkennung.
// Nur für die Entwicklung (nicht Teil der App, nicht im Service-Worker):
//   node werkzeuge/regie-saetze.mjs
// Läuft typische Baustellen-Sätze gegen REGIE_MUSTER aus kern/ui.js und
// gegen das bisherige Muster (Stand vor der Erweiterung) und druckt eine
// Treffer-Tabelle. Exit-Code 1, wenn ein Satz falsch erkannt wird.

import { REGIE_MUSTER, schadenTreffer } from '../kern/ui.js';

// Muster bis luense-v49 — zum Vergleich vorher/nachher.
const ALT = new RegExp([
  'regie', 'nachtrag', 'unvorhergesehen',
  'zusatzarbeit', 'zusatzaufwand', 'zusatzleistung',
  'mehraufwand', 'mehrleistung', 'mehrkosten', 'stundenlohn',
  'nicht im lv', 'ausserhalb (des )?lv', 'nicht ausgeschrieben', 'nicht offeriert',
  'auf anordnung', 'anordnung (der )?bauleitung', 'anordnung (des )?bauherrn',
  'auf wunsch', 'ausservertraglich',
].join('|'), 'i');

// [Satz, soll Regie-Hinweis sein?]
export const SAETZE = [
  // --- Regie-Hinweise (müssen treffen) ---
  ['Leitung umgelegt gemäss Anweisung BL', true],
  ['Leitung umgelegt gemaess Anweisung BL', true],
  ['BL hat angeordnet, Schacht 3 tiefer setzen', true],
  ['Bauherr wünscht zusätzlich einen Anschluss für Parzelle 412', true],
  ['zusätzlich Leitung umgelegt', true],
  ['zusaetzlich Kandelaberfundament erstellt', true],
  ['Mehrarbeit wegen Grundwasser', true],
  ['Belagsanschluss nicht im Devis', true],
  ['Werkleitung nicht im Plan, umlegen', true],
  ['Findling ausgebaut, ca. 2 m3', true],
  ['Wartezeit wegen Elektriker EW', true],
  ['Behinderung durch Werkleitungsbau Swisscom', true],
  ['Projektänderung: Rinne statt Randstein', true],
  ['Mehrmenge Aushub Kofferung', true],
  ['Stundenlohnarbeit Handlanger', true],
  ['Regiearbeit Vorplatz Liegenschaft Meier', true],
  ['Graben verbreitert auf Verlangen der Gemeinde', true],
  ['lt. BL Rohrleitung 20 cm tiefer verlegt', true],
  ['gem. BL Schacht versetzt', true],
  ['BH will noch einen Parkplatz mehr', true],
  ['Bauherrschaft verlangt Pflästerung statt Belag', true],
  ['Änderungswunsch BH: Gefälle Richtung Garten', true],
  ['Aenderungswunsch Bauherrschaft umgesetzt', true],
  ['zusätzliche Sondierung bei Schacht 5', true],
  ['Erschwernis wegen Fels im Graben', true],
  ['auf Anordnung der Bauleitung Graben erweitert', true],
  ['Zusatzaushub wegen Altlast', true],
  ['unvorhergesehene Kabelschutzrohre angetroffen', true],
  ['Arbeitsunterbruch wegen fehlender Pläne', true],
  ['im Auftrag der Bauleitung Sickerleitung gespült', true],
  ['Planänderung Ingenieur, Rohr DN 250 statt 200', true],
  ['Kontaminiertes Material separat abgeführt', true],
  ['Position fehlt im LV, Kies nachgeliefert', true],
  ['nach Aufwand: Hausanschluss freigelegt', true],
  // Echter Testsatz des Eigentümers (sic) und Varianten: Werkleitung,
  // die nicht ersichtlich/nicht im Plan war = Risiko Bauherr.
  ['Werkleitungen herausgerissen, die nicht ersichtlich war', true],
  ['beim Aushub Werkleitung herausgerissen, die nicht ersichtlich war', true],
  ['Werkleitung herausgerissen, war nicht ersichtlich', true],
  ['Wasserleitung beschädigt, nicht im Werkleitungsplan', true],
  ['Kabel angefahren, nicht eingezeichnet', true],
  ['Leitung nicht im Kataster', true],
  ['Gasleitung war nicht bekannt', true],
  ['nicht vermerkte Leitung angebaggert', true],
  ['Leitung nicht erfasst, Bagger hat sie gekappt', true],
  ['unbekannte Werkleitung freigelegt', true],
  ['Fremdleitung im Graben, umgelegt', true],
  // --- Normale Arbeit (darf nicht treffen) ---
  ['Graben ausgehoben', false],
  ['Rohre verlegt und eingesandet', false],
  ['Kies eingebaut und verdichtet', false],
  ['Bauleitung vor Ort Begehung', false], // bewusst KEIN Treffer: Anwesenheit ist keine Anordnung
  ['Sitzung mit Bauherr, Termine besprochen', false],
  ['Belag eingebaut gemäss Plan', false],
  ['Schacht versetzt und angeschlossen', false],
  ['Mittagsunterbruch 12:00–13:00', false],
  ['Fundament betoniert, Beton mit Zusatzmittel', false],
  ['Anordnung der Schächte gemäss Plan kontrolliert', false],
  ['Behindertenparkplatz markiert', false],
  ['Planie erstellt, Blocksteine versetzt', false],
  ['Wasserleitung gespült, Druckprobe i.O.', false],
  ['Humus abgetragen und seitlich deponiert', false],
  ['Absperrung gestellt, Signalisation kontrolliert', false],
  ['BL-Sitzung 10:00', false],
  ['Leitungen eingemessen und Blechabdeckung montiert', false],
  ['Info an Regierungsrat zur Strassensperrung', false],
  // Leitungsschaden ohne Hinweis auf «nicht ersichtlich» → kein Häkchen,
  // nur Hinweis «Leitungsschaden – Regie prüfen?» (Spalte «Schaden»).
  ['Werkleitungen herausgerissen', false, true],
  ['Wasserleitung beim Aushub beschädigt', false, true],
  ['Kabel mit Bagger angefahren', false, true],
  ['Hausanschluss abgerissen, Sanitär avisiert', false, true],
];

const fmt = (b) => (b ? 'ja ' : '-  ');
let alt = 0; let neu = 0; let fehler = 0; let altFehler = 0;
console.log('soll alt neu  Schaden  Satz');
for (const [satz, soll, schadenSoll = false] of SAETZE) {
  const a = ALT.test(satz);
  const n = REGIE_MUSTER.test(satz);
  const sch = !!schadenTreffer(satz);
  if (a === soll) alt++; else altFehler++;
  if (n === soll && sch === schadenSoll) neu++; else fehler++;
  const flag = n !== soll || sch !== schadenSoll ? '  <-- FALSCH' : '';
  console.log(`${fmt(soll)}  ${fmt(a)} ${fmt(n)} ${fmt(sch)}      ${satz}${flag}`);
}
const pos = SAETZE.filter(([, s]) => s).length;
console.log(`\n${SAETZE.length} Sätze (${pos} Regie, ${SAETZE.length - pos} normal)`);
console.log(`vorher richtig: ${alt}/${SAETZE.length} · nachher richtig: ${neu}/${SAETZE.length}`);
console.log(`vorher verpasst: ${SAETZE.filter(([s, soll]) => soll && !ALT.test(s)).length}, `
  + `Fehltreffer vorher: ${SAETZE.filter(([s, soll]) => !soll && ALT.test(s)).length}`);
console.log(`nachher verpasst: ${SAETZE.filter(([s, soll]) => soll && !REGIE_MUSTER.test(s)).length}, `
  + `Fehltreffer nachher: ${SAETZE.filter(([s, soll]) => !soll && REGIE_MUSTER.test(s)).length}`);
process.exitCode = fehler ? 1 : 0;
