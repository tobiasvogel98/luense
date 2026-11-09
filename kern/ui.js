// kern/ui.js — kleine UI-Helfer, die mehr als eine Ansicht braucht.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Woran ein Text Regie erkennt: das Wort selbst plus typische Indikatoren
// aus der Baupraxis (Regieanmeldung, SIA 118 Art. 84 ff.: Bestellungs-
// änderung, Erschwernis, Behinderung, Mehrmengen). Genutzt vom Rapport
// (Häkchen-Vorschlag beim Tippen, beim Laden und beim Speichern), vom
// Journal (Vorschlag Tag «Regie») und vom Importer.
//
// Schreibweise: Umlaute werden unten automatisch auch als ae/oe/ue
// erkannt («zusaetzlich», «gemaess»). Wortstämme, damit Beugungen
// mitgehen («zusätzliche», «Mehrmengen», «Regiearbeit»).
//
// Abwägung Fehltreffer: Ein falsch gesetztes Häkchen kostet einen
// Antipp (und wird nach dem Abwählen nie wieder gesetzt) — eine
// vergessene Regie kostet Geld. Darum lieber etwas grosszügig, aber:
// - Kürzel BL/BH/OBL nur als ganzes Wort UND nur mit «gem./lt./gemäss/
//   laut» davor oder mit einem Anordnungs-Verb danach («BL hat
//   angeordnet», «BH will …») — «BL-Sitzung», «Blech», «Bauleitung vor
//   Ort Begehung» treffen bewusst NICHT (Anwesenheit ≠ Anordnung).
// - «Anordnung» allein trifft nicht («Anordnung der Schächte»), nur
//   «auf/gemäss/laut Anordnung» bzw. «Anordnung der Bauleitung».
// - Ausgeschlossen: Regierung, Mittagsunterbruch, Zusatzmittel/-stoff
//   (Beton), Behindertenparkplatz.
// - Bewusst grosszügig: «zusätzlich», «Mehrmenge», «Wartezeit»,
//   «angetroffen», «nicht im Plan», «nicht ersichtlich/bekannt»,
//   «unbekannt» — können auch normale Arbeit sein («Lieferzeit
//   unbekannt»), sind aber häufige Vorboten eines Nachtrags.
// - Leitungsschaden allein («herausgerissen», «beschädigt») ist KEIN
//   Treffer hier (kann Unternehmerverschulden sein) → SCHADEN_MUSTER.
const W = '(?<![\\p{L}\\p{N}])'; // Wortanfang (auch vor Umlauten korrekt)
const E = '(?![\\p{L}\\p{N}])'; // Wortende
const AG = `(?:bl|obl|bh|bauleitung|oberbauleitung|bauherr(?:in|en|n|schaft)?|ingenieur|projektverfasser|auftraggeber(?:in)?|gemeinde|tiefbauamt|bauamt|werkeigentümer)${E}`;
const REGIE_TEILE = [
  // Das Wort selbst und direkte Begriffe
  'regie(?!rung)', 'nachtrag', 'unvorhergesehen', 'stundenlohn', 'taglohn',
  `${W}nach\\s+aufwand`,
  'ausservertraglich',
  // Zusatz-/Mehr-/Sonderleistungen
  `${W}zusätzlich`, `${W}zusatz(?!mittel|stoff)`,
  `${W}mehr(?:arbeit|aufwand|leistung|kosten|menge|ausmass|preis)`,
  `${W}(?:extra|sonder)(?:arbeit|aufwand|leistung|wunsch)`,
  // Nicht im Vertrag
  `nicht\\s+(?:im|in\\s+der|in\\s+den)\\s+(?:lv|devis|leistungsverzeichnis|vertrag|werkvertrag|angebot|offerte|auftrag)${E}`,
  `(?:lv|devis|vertrag|offerte)\\s+nicht${E}`,
  `fehlt\\s+im\\s+(?:lv|devis|leistungsverzeichnis|vertrag|angebot|offerte)${E}`,
  `nicht\\s+(?:ausgeschrieben|offeriert|devisiert|vorgesehen|enthalten|vereinbart|bestellt)`,
  `ausserhalb\\s+(?:des\\s+|der\\s+)?(?:lv|devis|leistungsverzeichnis|vertrags?|werkvertrags?|auftrags?|offerte)${E}`,
  `${W}(?:keine|ohne|fehlende)\\s+(?:npk[- ]?)?pos(?:ition|\\.)`,
  // Anordnung / Wunsch des Auftraggebers
  `${W}(?:auf|gemäss|gem\\.?|lt\\.?|laut|nach|per)\\s+(?:(?:mündliche|telefonische|ausdrückliche)[rn]?\\s+)?(?:anordnung|anweisung|weisung|verlangen|wunsch|bestellung)${E}`,
  `${W}(?:anordnung|anweisung|auftrag|wunsch)\\s+(?:der\\s+|des\\s+|von\\s+|vom\\s+)?${AG}`,
  `${W}(?:gemäss|gem\\.?|lt\\.?|laut)\\s+${AG}`,
  `${W}${AG}\\s+(?:\\p{L}+\\s+){0,3}?(?:angeordnet|angewiesen|verlangt|gewünscht|wünscht|bestellt|will|möchte)${E}`,
  'angeordnet',
  `${W}(?:änderungs|bauherren|kunden)wunsch`, `${W}änderungswünsche`,
  `(?:projekt|plan|bestellungs|ausführungs)änderung`,
  `${W}projekt\\s+geändert`, 'umprojektiert',
  // Erschwernis, Behinderung, Wartezeit
  'erschwernis', 'erschwert', `behinderung`, `behindert(?!en)`,
  'wartezeit', `${W}(?:warten|gewartet)\\s+auf${E}`, 'stillstand',
  `${W}(?:arbeits)?unterbruch`,
  // Unvorhergesehenes im Boden
  'findling', 'altlast', 'kontaminiert', 'angetroffen',
  // Werkleitung nicht ersichtlich/nicht im Plan = Baugrundrisiko des
  // Bauherrn (SIA 118 Art. 58) — typischer Regie-/Nachtragsfall.
  `nicht\\s+(?:im|in\\s+den|in\\s+der|auf\\s+dem|auf\\s+den)\\s+\\p{L}*(?:pl(?:a|ä)ne?n?|kataster)${E}`,
  'nicht\\s+(?:ersichtlich|eingezeichnet|erfasst|vermerkt|bekannt|dokumentiert|verzeichnet)',
  `${W}unbekannt`, 'fremdleitung',
  `${W}(?:notfall|pikett)einsatz`,
];

export const REGIE_MUSTER = new RegExp(
  REGIE_TEILE.join('|')
    .replace(/ä/g, '(?:ä|ae)').replace(/ö/g, '(?:ö|oe)').replace(/ü/g, '(?:ü|ue)'),
  'iu');

// Leitungsschaden allein (herausgerissen, beschädigt, angefahren) kann
// auch Unternehmerverschulden sein — darum KEIN automatisches Häkchen,
// nur ein sichtbarer Hinweis «Leitungsschaden – Regie prüfen?». Greift
// nur, wenn REGIE_MUSTER nicht schon trifft.
export const SCHADEN_MUSTER = new RegExp([
  '(?:her|r)?ausgerissen', 'rausgerissen', 'abgerissen', 'beschädigt', 'angefahren',
  'angebaggert', 'angebohrt', 'durchtrennt', 'gekappt',
  '(?:leitungs|kabel|rohr)(?:schaden|bruch)', '(?<![\\p{L}])leck',
].join('|').replace(/ä/g, '(?:ä|ae)'), 'iu');

export function schadenTreffer(text) {
  const t = String(text ?? '');
  if (REGIE_MUSTER.test(t)) return '';
  const treffer = t.match(SCHADEN_MUSTER);
  return treffer ? treffer[0] : '';
}

// Die erkannte Stelle als kurzer Text («auf Anordnung»), sonst ''.
export function regieTreffer(text) {
  const treffer = String(text ?? '').match(REGIE_MUSTER);
  return treffer ? treffer[0].replace(/\s+/g, ' ').trim() : '';
}

// Alle Texte einer Rapport-Arbeit, in denen ein Regie-Hinweis stehen kann:
// Beschreibung plus die Textzeilen von Maschinen, Material, Fremdleistungen.
export function arbeitTexte(arbeit) {
  return [arbeit?.text,
    ...[...(arbeit?.maschinen || []), ...(arbeit?.material || []),
      ...(arbeit?.fremdleistungen || [])].map((z) => z?.name)]
    .filter(Boolean).join(' · ');
}

// Regie-Hinweise eines gespeicherten Rapports, die (noch) nicht als Regie
// verbucht sind — für Liste, Import-Meldung und Kontrolle beim Speichern.
// Eine Arbeit mit von Hand gesetztem/entferntem Häkchen (regieManuell)
// zählt nicht. Bemerkungen zählen nur, wenn keine Arbeit Regie ist.
export function regieHinweiseRapport(rapport) {
  const arbeiten = rapport?.arbeiten || [];
  const hinweise = [];
  arbeiten.forEach((arbeit, index) => {
    if (arbeit.regie || arbeit.regieManuell) return;
    const treffer = regieTreffer(arbeitTexte(arbeit));
    if (treffer) hinweise.push({ ort: `Arbeit ${index + 1}`, index, treffer });
  });
  if (!arbeiten.some((a) => a.regie)) {
    const treffer = regieTreffer(rapport?.bemerkungen);
    // «Ohne Regie speichern» gilt nur für genau diesen Hinweis.
    if (treffer && treffer !== rapport?.regieHinweisIgnoriert) {
      hinweise.push({ ort: 'Bemerkungen', index: -1, treffer });
    }
  }
  return hinweise;
}

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
