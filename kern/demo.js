// kern/demo.js — Beispielbaustelle für Kundendemos und zum Ausprobieren.
// Legt EINE klar markierte Baustelle (KTR DEMO-2417) samt verknüpften
// Beispieldaten an: Journal (mit neutralem Platzhalter-Foto), Rapporte,
// Nachträge, Rechnungen, Kreditoren, Pendenzen, Ausmass mit Graben-
// Abschnitt, Monatsabschluss, Offerte, Personal und Geräte.
//
// Markierung: JEDES erzeugte Dokument trägt `demo: true` und
// `demoBaustelleId`. Personal, Geräte und Offerte liegen in den Sammel-
// Stämmen («personal», «offertwesen»); die fünf Personen tragen fiktive
// Namen mit «Beispiel»/«Test», Geräte und Offerte heissen «… (Beispiel)». Beim Löschen fallen alle markierten Dokumente weg —
// dazu alles, was während der Demo auf der Beispielbaustelle neu erfasst
// wurde (gleiche baustelleId). Echte Daten bleiben unberührt.
//
// Backup: Beispieldaten werden vom Backup AUSGENOMMEN (kern/export.js
// filtert mit istBeispielDokument) — so wandern sie nie auf ein anderes
// Gerät oder ins Archiv. Der Treuhänder-Export läuft je Mitarbeiter; die
// Beispiel-Mitarbeiter sind an ihren Namen erkennbar, und ihre Stunden
// stehen nur in Rapporten der Beispielbaustelle.
//
// Die Dokumente folgen exakt den Schemas der Module (die Module selbst
// werden nicht aufgerufen — Module teilen Dokumente, nie Code).

import {
  put, get, haengeAnhangAn, sucheDokumente, entferneDokument,
} from './speicher.js';
import { GRABENARTEN, berechneTeil } from './graben.js';
import { esc } from './ui.js';

export const DEMO_BAUSTELLE_ID = 'baustelle:beispiel-demo-2417';
const KTR = 'DEMO-2417';
const PERSONAL_ID = 'personal';
const OFFERT_ID = 'offertwesen';

export function istBeispielDokument(doc) {
  return !!doc && (doc.demo === true || doc.baustelleId === DEMO_BAUSTELLE_ID
    || doc.demoBaustelleId === DEMO_BAUSTELLE_ID);
}

export async function beispielVorhanden() {
  try {
    const doc = await get(DEMO_BAUSTELLE_ID);
    return !!doc;
  } catch {
    return false;
  }
}

// ---------- Datums-Helfer (relativ zu heute, lokal) ----------

function tagIso(datum) {
  return new Date(datum.getTime() - datum.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function plusTage(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return tagIso(d);
}

// n-ter Arbeitstag (Mo–Fr) vor heute, 1 = letzter Arbeitstag.
function arbeitstagZurueck(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  let gezaehlt = 0;
  while (gezaehlt < n) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) gezaehlt++;
  }
  return tagIso(d);
}

function letzterTagVormonat() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(0);
  return tagIso(d);
}

const zeit = (tag, stunde) => new Date(`${tag}T${String(stunde).padStart(2, '0')}:15:00`).toISOString();
const deCh = (tag) => tag.split('-').reverse().join('.');
const rund2 = (n) => Math.round(n * 100) / 100;

// Neutrales Platzhalter-Foto (kein echtes Bild): Canvas, 1600 × 1200, JPEG 0.8.
async function platzhalterFoto(titel) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1200;
  const g = canvas.getContext('2d');
  g.fillStyle = '#c9c4b8';
  g.fillRect(0, 0, 1600, 1200);
  g.strokeStyle = '#b5afa1';
  g.lineWidth = 40;
  for (let x = -1200; x < 1600; x += 160) {
    g.beginPath();
    g.moveTo(x, 1200);
    g.lineTo(x + 1200, 0);
    g.stroke();
  }
  g.fillStyle = 'rgba(38, 51, 61, 0.85)';
  g.fillRect(200, 440, 1200, 320);
  g.fillStyle = '#f4f3f0';
  g.textAlign = 'center';
  g.font = 'bold 72px system-ui, sans-serif';
  g.fillText('BEISPIELFOTO', 800, 560);
  g.font = '44px system-ui, sans-serif';
  g.fillText(titel, 800, 650);
  g.fillText('kein echtes Bild', 800, 715);
  const blob = await new Promise((erfuelle) => canvas.toBlob(erfuelle, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Platzhalter-Foto konnte nicht erzeugt werden.');
  return blob;
}

// ---------- Beispielbaustelle anlegen ----------

// Gibt { neu: Anzahl Dokumente } zurück, oder { vorhanden: true }, wenn
// die Beispielbaustelle schon existiert (kein zweites Mal anlegen).
export async function ladeBeispielbaustelle() {
  if (await beispielVorhanden()) return { vorhanden: true };

  const B = DEMO_BAUSTELLE_ID;
  const marke = { demo: true, demoBaustelleId: B };
  let anzahl = 0;
  const speichere = async (doc) => {
    anzahl++;
    return put({ ...doc, ...marke });
  };

  // Personal & Geräte (Sammel-Stamm «personal», sichtbar als Beispiel).
  const TEAM = [
    { name: 'Max Beispiel', rolle: 'Polier', lohnklasse: 'Polier' },
    { name: 'Lea Test', rolle: 'Vorarbeiterin', lohnklasse: 'V' },
    { name: 'Sandro Beispiel', rolle: 'Maurer', lohnklasse: 'Q' },
    { name: 'Nina Test', rolle: 'Baumaschinenführerin', lohnklasse: 'A' },
    { name: 'Marco Beispiel', rolle: 'Lernender', lohnklasse: 'C' },
  ];
  for (const m of TEAM) {
    await speichere({
      typ: 'mitarbeiter', baustelleId: PERSONAL_ID, archiviert: false,
      name: m.name, rolle: m.rolle, lohnklasse: m.lohnklasse,
      modell: 'kalender', sollProTag: '8.5',
    });
  }
  const [MAX, LEA, SANDRO, NINA, MARCO] = TEAM.map((m) => m.name);
  const GERAETE = ['Bagger 14 t (Beispiel)', 'Dumper 6 t (Beispiel)', 'Vibroplatte 200 kg (Beispiel)'];
  for (const name of GERAETE) {
    await speichere({ typ: 'geraet', baustelleId: PERSONAL_ID, name, archiviert: false });
  }
  const [BAGGER, DUMPER, VIBRO] = GERAETE;

  // Baustelle (feste Id → Doppel-Erkennung).
  anzahl++;
  await put({
    _id: B, typ: 'baustelle', baustelleId: B, archiviert: false, ...marke,
    ktr: KTR, name: 'Werkleitungen Musterweg (Beispiel)', ort: 'Musterhausen',
    bauherr: 'Gemeinde Musterhausen', werkvertrag: "CHF 420'000",
  });

  // Dossier: Kontakte und Meilensteine.
  await speichere({ typ: 'kontakt', baustelleId: B, name: 'Petra Planer (Beispiel)',
    rolle: 'Bauleitung, Ingenieurbüro Beispiel AG', telefon: '000 000 00 00' });
  await speichere({ typ: 'kontakt', baustelleId: B, name: 'Bruno Brunnen (Beispiel)',
    rolle: 'Brunnenmeister Gemeinde', telefon: '000 000 00 01' });
  await speichere({ typ: 'meilenstein', baustelleId: B, titel: 'Druckprobe Wasserleitung',
    termin: plusTage(6), erledigt: false });
  await speichere({ typ: 'meilenstein', baustelleId: B, titel: 'Belagseinbau Musterweg',
    termin: plusTage(45), erledigt: false });

  // Journal.
  const tVorzustand = arbeitstagZurueck(9);
  const tFortschritt1 = arbeitstagZurueck(7);
  const tMangel = arbeitstagZurueck(5);
  const tRegie = arbeitstagZurueck(4);
  const tFortschritt2 = arbeitstagZurueck(1);
  const ereignis = (tag, stunde, art, ortKv, notiz) => speichere({
    typ: 'ereignis', baustelleId: B, datum: zeit(tag, stunde), tag: art, ortKv, notiz,
  });
  await ereignis(tVorzustand, 7, 'Vorzustand', 'Musterweg 1–15',
    'Vorzustand Strasse und Vorgärten vor Baubeginn aufgenommen. Randsteine intakt, Riss im Belag bei Nr. 7.');
  await ereignis(tFortschritt1, 16, 'Fortschritt', 'KS 1 – KS 2',
    'Graben KS 1 – KS 2 ausgehoben, Wasserleitung PE d125 auf 40 m verlegt.');
  await ereignis(tMangel, 10, 'Mangel', 'Musterweg 9',
    'Abschrankung beim Hauszugang Nr. 9 umgestossen — sofort wieder gestellt, Anwohner informiert.');
  const regieEreignis = await ereignis(tRegie, 9, 'Regie', 'KS 3',
    'Findling im Graben bei KS 3, ca. 1.2 m³. Zusatzaushub und Abtransport auf Anordnung der Bauleitung (P. Planer).');
  await haengeAnhangAn(regieEreignis._id, `foto-${Date.now().toString(36)}-1.jpg`,
    await platzhalterFoto('Findling KS 3'));
  await ereignis(tFortschritt2, 15, 'Fortschritt', 'KS 3 – KS 4',
    'Abschnitt KS 3 – KS 4 verfüllt und verdichtet, Kabelschutzrohre eingelegt.');

  // Tagesrapporte.
  const rapport = (tag, wetter, arbeiten, extra = {}) => {
    const t = arbeiten.reduce((s, a) => {
      const h = [...a.personen, ...a.maschinen, ...(a.fremdleistungen || [])]
        .reduce((x, p) => x + Number(p.stunden), 0);
      return a.regie ? s + h : s;
    }, 0);
    return speichere({
      typ: 'rapport', baustelleId: B, tag, datum: `${tag}T12:00:00.000Z`,
      mitarbeiter: MAX, wetter, davonRegie: t, bemerkungen: '',
      arbeiten: arbeiten.map((a) => ({ fremdleistungen: [], material: [], regie: false, ...a })),
      absenzen: [], reisezeiten: [], ...extra,
    });
  };
  const p = (name, stunden) => ({ name, stunden: String(stunden) });
  const mat = (name, menge, einheit) => ({ name, menge: String(menge), einheit });

  await rapport(tFortschritt1, 'sonnig, 14 °C', [
    { text: 'Graben KS 1 – KS 2 ausheben, Leitung PE d125 verlegen',
      personen: [p(MAX, 8.5), p(LEA, 8.5), p(SANDRO, 8.5), p(NINA, 8.5)],
      maschinen: [p(BAGGER, 7.5), p(DUMPER, 6)],
      material: [mat('Sand 0/4', 18, 'm³'), mat('PE-Rohr d125', 40, 'm')] },
  ], { absenzen: [{ name: MARCO, art: 'Ferien', stunden: '8.5' }] });
  await rapport(arbeitstagZurueck(6), 'bewölkt, 11 °C', [
    { text: 'Graben KS 2 – KS 3 ausheben, Leitung verlegen',
      personen: [p(MAX, 8.5), p(LEA, 8.5), p(NINA, 8.5)],
      maschinen: [p(BAGGER, 8), p(DUMPER, 7)],
      material: [mat('Sand 0/4', 16, 'm³')] },
    { text: 'Hausanschluss Nr. 5 vorbereiten',
      personen: [p(SANDRO, 8.5), p(MARCO, 8.5)], maschinen: [p(VIBRO, 2)] },
  ], { reisezeiten: [{ name: MARCO, minuten: '30' }] });
  const regieRapport = await rapport(tRegie, 'Regen, 9 °C', [
    { text: 'Zusatzaushub Findling KS 3 auf Anordnung der Bauleitung, Abtransport',
      regie: true,
      personen: [p(LEA, 3), p(NINA, 3)],
      maschinen: [p(BAGGER, 3), p(DUMPER, 2)],
      fremdleistungen: [p('Muldenservice Beispiel GmbH', 1)] },
    { text: 'Leitung KS 3 – KS 4 verlegen',
      personen: [p(MAX, 8.5), p(LEA, 5.5), p(NINA, 5.5), p(SANDRO, 8.5), p(MARCO, 8.5)],
      maschinen: [p(BAGGER, 5)],
      material: [mat('Sand 0/4', 12, 'm³')] },
  ], {
    regieStatus: 'unterschrieben',
    regieStatusHistorie: [{ status: 'offen', datum: tRegie },
      { status: 'unterschrieben', datum: arbeitstagZurueck(3) }],
  });
  await rapport(tFortschritt2, 'sonnig, 12 °C', [
    { text: 'Verfüllen und verdichten KS 3 – KS 4, Kabelschutzrohre einlegen',
      personen: [p(MAX, 8.5), p(LEA, 8.5), p(SANDRO, 8.5), p(MARCO, 8.5)],
      maschinen: [p(VIBRO, 6), p(DUMPER, 5)],
      material: [mat('Kiessand 0/45', 64, 't'), mat('Kabelschutzrohr d120', 96, 'm')] },
  ]);

  // Nachträge.
  const n1 = await speichere({
    typ: 'nachtrag', baustelleId: B, datum: zeit(arbeitstagZurueck(8), 11), nummer: 'N-01',
    titel: 'Mehrtiefe Graben wegen Fremdleitung (Swisscom-Kabel)',
    sachverhalt: 'Ungeplante Fremdleitung in 1.1 m Tiefe; Wasserleitung auf 40 m tiefer geführt.',
    basis: 'SIA 118 Art. 58 (Bestellungsänderung)', summe: '6800',
    status: 'verrechnet',
    statusHistorie: [
      { status: 'erkannt', datum: arbeitstagZurueck(8) },
      { status: 'gemeldet', datum: arbeitstagZurueck(8) },
      { status: 'offeriert', datum: arbeitstagZurueck(7) },
      { status: 'genehmigt', datum: arbeitstagZurueck(5) },
      { status: 'verrechnet', datum: arbeitstagZurueck(2) },
    ],
    beweise: { ereignisIds: [], rapportIds: [], ausmassIds: [] },
  });
  const n2 = await speichere({
    typ: 'nachtrag', baustelleId: B, datum: zeit(tRegie, 10), nummer: 'N-02',
    titel: `Regie vom ${deCh(tRegie)} · KS 3`, sachverhalt: 'Findling im Graben, Zusatzaushub und Abtransport auf Anordnung der Bauleitung.',
    basis: 'SIA 118 Art. 25 (Anzeigepflicht)', summe: '2450', status: 'gemeldet',
    statusHistorie: [{ status: 'erkannt', datum: tRegie }, { status: 'gemeldet', datum: arbeitstagZurueck(3) }],
    beweise: { ereignisIds: [regieEreignis._id], rapportIds: [regieRapport._id], ausmassIds: [] },
  });

  // Rechnungen (eigener Nummernkreis R-DEMO-…, damit der echte
  // Jahres-Nummernkreis R-JJJJ-NNN unberührt bleibt).
  await speichere({
    typ: 'rechnung', baustelleId: B, nummer: 'R-DEMO-001', tag: arbeitstagZurueck(9),
    datum: `${arbeitstagZurueck(9)}T12:00:00.000Z`,
    titel: '1. Akontozahlung (Beispiel)', betrag: '40000', mwstSatz: 8.1, zahlungsfristTage: 30,
    basis: { art: 'manuell', id: '', label: '' }, status: 'bezahlt',
    statusHistorie: [{ status: 'offen', datum: arbeitstagZurueck(9) },
      { status: 'gestellt', datum: arbeitstagZurueck(9) },
      { status: 'bezahlt', datum: arbeitstagZurueck(1) }],
  });
  await speichere({
    typ: 'rechnung', baustelleId: B, nummer: 'R-DEMO-002', tag: arbeitstagZurueck(2),
    datum: `${arbeitstagZurueck(2)}T12:00:00.000Z`,
    titel: `Nachtrag N-01 — ${n1.titel}`, betrag: '6800', mwstSatz: 8.1, zahlungsfristTage: 30,
    basis: { art: 'nachtrag', id: n1._id, label: 'N-01' }, status: 'gestellt',
    statusHistorie: [{ status: 'offen', datum: arbeitstagZurueck(2) },
      { status: 'gestellt', datum: arbeitstagZurueck(2) }],
  });

  // Mahnwesen zum Vorführen: Rechnung vor 64 Tagen, Zahlungserinnerung am
  // 31. Tag festgehalten (Zahlungsfrist 10 Tage abgelaufen) — damit ist die
  // 1. Mahnung fällig (Standardfristen 30/60/75 Tage ab Rechnungsdatum).
  const tMahnRechnung = plusTage(-64);
  const tErinnerung = plusTage(-33);
  await speichere({
    typ: 'rechnung', baustelleId: B, nummer: 'R-DEMO-003', tag: tMahnRechnung,
    datum: `${tMahnRechnung}T12:00:00.000Z`,
    titel: 'Werkleitungen Etappe 1 (Beispiel)', betrag: '10000', mwstSatz: 8.1, zahlungsfristTage: 30,
    basis: { art: 'manuell', id: '', label: '' }, status: 'gestellt',
    statusHistorie: [{ status: 'offen', datum: tMahnRechnung },
      { status: 'gestellt', datum: tMahnRechnung }],
    mahnungen: [{
      stufe: 1, datum: tErinnerung, offenRappen: 1081000, zinsRappen: 0,
      zinsVon: '', zinsBis: '', zinsProzent: 0, fristTage: 10,
    }],
  });

  // Kreditoren.
  await speichere({
    typ: 'kreditor', baustelleId: B, lieferant: 'Kieswerk Beispiel AG (Beispiel)',
    rechnungsNr: 'KW-0001', tag: arbeitstagZurueck(3), datum: `${arbeitstagZurueck(3)}T12:00:00.000Z`,
    netto: '7993.06', vorsteuerSatz: 8.1, vorsteuer: '647.44', betrag: '8640.50', zahlungsfristTage: 30, skontoProzent: '2', skontoTage: '10',
    kostenart: 'Material', notiz: 'Sand 0/4 und Kiessand 0/45', iban: '', referenz: '',
    status: 'visiert', visumNotiz: 'Mengen mit Rapporten abgeglichen',
    statusHistorie: [{ status: 'offen', datum: arbeitstagZurueck(3) },
      { status: 'visiert', datum: arbeitstagZurueck(2) }],
  });
  await speichere({
    typ: 'kreditor', baustelleId: B, lieferant: 'Muster Transporte GmbH (Beispiel)',
    rechnungsNr: 'MT-0815', tag: arbeitstagZurueck(8), datum: `${arbeitstagZurueck(8)}T12:00:00.000Z`,
    netto: '3626.27', vorsteuerSatz: 8.1, vorsteuer: '293.73', betrag: '3920.00', zahlungsfristTage: 30, skontoProzent: '', skontoTage: '',
    kostenart: 'Fremdleistung', notiz: 'Abtransport Aushub', iban: '', referenz: '',
    status: 'bezahlt', bezahltAm: arbeitstagZurueck(1), skontoGenutzt: false,
    statusHistorie: [{ status: 'offen', datum: arbeitstagZurueck(8) },
      { status: 'visiert', datum: arbeitstagZurueck(6) },
      { status: 'bezahlt', datum: arbeitstagZurueck(1) }],
  });

  // Pendenzen.
  const pendenz = (felder) => speichere({
    typ: 'pendenz', baustelleId: B, termin: '', verantwortlich: '', erledigtAm: '', ...felder,
  });
  await pendenz({ text: 'Regierapport unterschreiben lassen', prioritaet: 'hoch',
    notiz: `Aus Tagesrapport vom ${deCh(tRegie)} (Regie ${regieRapport.davonRegie} h)`,
    rapportId: regieRapport._id, erledigtAm: arbeitstagZurueck(3) });
  await pendenz({ text: 'Nachtrag N-02 beziffern/melden', prioritaet: 'hoch',
    notiz: `Aus Regie-Ereignis vom ${deCh(tRegie)} · KS 3`,
    ereignisId: regieEreignis._id, nachtragId: n2._id, erledigtAm: arbeitstagZurueck(3) });
  await pendenz({ text: 'Druckprobe mit Brunnenmeister vereinbaren', prioritaet: 'hoch',
    termin: plusTage(3), verantwortlich: MAX });
  await pendenz({ text: 'Werkleitungskataster bei der Gemeinde nachführen lassen',
    prioritaet: 'mittel', termin: plusTage(10), verantwortlich: 'Bauführer' });
  await pendenz({ text: 'Signalisation Musterweg mit Verkehrsdienst prüfen',
    prioritaet: 'tief', erledigtAm: arbeitstagZurueck(6) });

  // Ausmass (NPK-ähnliche Positionen) und ein Graben-Abschnitt.
  const POSITIONEN = [
    ['113.111', 'Baustelleneinrichtung installieren und räumen', 'gl', 1, 1, 24000],
    ['151.111', 'Belag aufbrechen und entsorgen, Stärke bis 12 cm', 'm²', 1150, 430, 18],
    ['211.111', 'Grabenaushub maschinell, Tiefe bis 1.5 m', 'm³', 1250, 0, 38.5],
    ['211.411', 'Leitungsumhüllung mit Sand 0/4', 'm³', 310, 0, 72],
    ['211.511', 'Auffüllung mit Aushubmaterial, lagenweise verdichtet', 'm³', 820, 0, 24],
    ['237.211', 'Wasserleitung PE d125 liefern und verlegen', 'm', 620, 168, 64],
    ['237.611', 'Kabelschutzrohr d120 liefern und verlegen', 'm', 1240, 96, 28],
  ];
  const posIds = {};
  const ausmass = [];
  for (const [pos, text, einheit, vertragsmenge, menge, ep] of POSITIONEN) {
    const doc = await speichere({
      typ: 'ausmass', baustelleId: B, pos, text, einheit,
      vertragsmenge: String(vertragsmenge), menge: String(menge), ep: String(ep),
    });
    posIds[pos] = doc._id;
    ausmass.push(doc);
  }
  const teil = {
    ...JSON.parse(JSON.stringify(GRABENARTEN.wasser.teile[0])),
    zuordnung: { aushub: posIds['211.111'], sand: posIds['211.411'], auffuellung: posIds['211.511'] },
  };
  const L = 120;
  await speichere({ typ: 'graben', baustelleId: B, name: 'KS 1 – KS 4', grabenart: 'wasser', L, teile: [teil] });
  // Mengen wie «Mengen ins Ausmass übernehmen» des Grabenrechners.
  const erg = berechneTeil(L, teil);
  const ausGraben = { '211.111': erg.aushub, '211.411': erg.sandTotal, '211.511': erg.auffuellung };
  for (const doc of ausmass) {
    if (ausGraben[doc.pos] === undefined) continue;
    const neu = await put({ ...doc, menge: String(rund2(ausGraben[doc.pos])), mengeQuelle: 'grabenrechner' });
    Object.assign(doc, neu);
  }

  // Monatsabschluss (FO 5.1.01) per Ende Vormonat — A1 aus dem Ausmass,
  // Selbstkosten so, dass ein plausibles Ergebnis von rund +6 % entsteht.
  const a1 = ausmass.reduce((s, d) => s + Number(d.menge) * Number(d.ep), 0);
  const stichtag = letzterTagVormonat();
  const a13 = (a1 + 1450) * 0.98;
  await speichere({
    typ: 'kosten', baustelleId: B, stichtag, datum: `${stichtag}T12:00:00.000Z`,
    werte: {
      skonto: '2', rabatt: '', allgAbzug: '',
      w1: '420000', w2: '', w3: '6800', w4: '', w6: '1450', w7: '', w8: '',
      b1: '40000', b2: '', b3: '', b4: '', b5: '',
      a1: String(Math.round(a1)), a2: '', a6: '1450', a7: '',
      ausmassAbgrenzungen: [{ bez: '', betrag: '' }, { bez: '', betrag: '' }, { bez: '', betrag: '' }],
      s1: String(Math.round(a13 / 1.06)),
      skAbgrenzungen: [{ bez: '', betrag: '' }, { bez: '', betrag: '' },
        { bez: '', betrag: '' }, { bez: '', betrag: '' }],
      k2: '8', k4: '', bauende: plusTage(75),
      bemerkungen: 'Beispiel-Abschluss — keine echten Zahlen.', visum: 'Beispiel',
    },
  });

  // Offerte (Sammel-Id «offertwesen»), angenommen → diese Baustelle.
  const lvPos = (pos) => {
    const [nr, text, einheit, menge, , ep] = POSITIONEN.find((z) => z[0] === pos);
    return { art: 'position', nr, text, einheit, menge: String(menge), ep: String(ep), ausmass: [] };
  };
  const aushubPos = lvPos('211.111');
  aushubPos.ausmass = [
    { bez: 'Wassergraben KS 1 – KS 8', anzahl: '1', laenge: '620', breite: '0.8', hoehe: '1.5' },
    { bez: 'Hausanschlüsse', anzahl: '12', laenge: '8', breite: '0.8', hoehe: '1.5' },
    { bez: 'Zuschlag Kabelgraben', anzahl: '1', laenge: '', breite: '', hoehe: '390.8' },
  ];
  await speichere({
    typ: 'offerte', baustelleId: OFFERT_ID, nummer: 'O-DEMO-01',
    kunde: 'Gemeinde Musterhausen', objekt: 'Werkleitungen Musterweg (Beispiel)',
    status: 'angenommen', baustelleErstellt: true, zielBaustelleId: B,
    rabatt: '3', skonto: '2', mwstSatz: 8.1,
    gliederung: [
      { art: 'kapitel', nr: '113', titel: 'Baustelleneinrichtung' }, lvPos('113.111'),
      { art: 'kapitel', nr: '151', titel: 'Abbrüche' }, lvPos('151.111'),
      { art: 'kapitel', nr: '211', titel: 'Baugruben und Gräben' },
      aushubPos, lvPos('211.411'), lvPos('211.511'),
      { art: 'kapitel', nr: '237', titel: 'Leitungen' }, lvPos('237.211'), lvPos('237.611'),
    ],
  });

  return { neu: anzahl };
}

// ---------- Beispielbaustelle entfernen ----------

// Löscht exakt die markierten Dokumente (samt Anhängen — PouchDB entfernt
// sie mit dem Dokument) und alles, was auf der Beispielbaustelle erfasst
// wurde. Gibt die Anzahl entfernter Dokumente zurück.
export async function loescheBeispielbaustelle() {
  const treffer = await sucheDokumente(istBeispielDokument);
  for (const doc of treffer) await entferneDokument(doc._id);
  return treffer.length;
}

// ---------- Ansicht im Stamm (⚙) ----------

let letzteMeldung = '';

// Abschnitt «Beispielbaustelle» für die Stamm-Ansicht. nachLaden(id)
// wechselt zur Beispielbaustelle, nachLoeschen() zeichnet den Stamm neu.
export function renderBeispielBereich(container, { nachLaden = () => {}, nachLoeschen = () => {} } = {}) {
  container.innerHTML = `
    <h3>Beispielbaustelle</h3>
    <p class="hinweis">Für Kundendemos und zum Ausprobieren: legt die klar
      markierte Baustelle <b>${esc(KTR)} · Werkleitungen Musterweg (Beispiel)</b>
      an — mit Journal, Rapporten, Nachträgen, Rechnungen, Kreditoren,
      Pendenzen, Ausmass/Grabenrechner, Monatsabschluss, Offerte sowie
      Beispiel-Personal und -Geräten. Alle Beispieldaten sind markiert,
      gehören nicht ins Backup und lassen sich mit einem Knopf restlos
      entfernen. Echte Daten bleiben unberührt.</p>
    <p class="hinweis" data-rolle="beispiel-status"></p>
    <div class="knopfzeile">
      <button type="button" class="knopf knopf-primaer" data-aktion="beispiel-laden">
        Beispielbaustelle laden</button>
      <button type="button" class="knopf eintrag-loeschen" data-aktion="beispiel-loeschen" hidden>
        Beispielbaustelle löschen</button>
    </div>
    <p class="meldung" role="status" data-rolle="beispiel-meldung"></p>`;

  const status = container.querySelector('[data-rolle="beispiel-status"]');
  const laden = container.querySelector('[data-aktion="beispiel-laden"]');
  const loeschen = container.querySelector('[data-aktion="beispiel-loeschen"]');
  const meldung = container.querySelector('[data-rolle="beispiel-meldung"]');

  async function zeigeStand() {
    const da = await beispielVorhanden();
    laden.textContent = da ? 'Beispielbaustelle öffnen' : 'Beispielbaustelle laden';
    loeschen.hidden = !da;
    status.textContent = da
      ? `Geladen: ${(await sucheDokumente(istBeispielDokument)).length} Beispiel-Dokumente.`
      : 'Nicht geladen.';
  }

  laden.addEventListener('click', async () => {
    laden.disabled = true;
    meldung.textContent = 'Beispielbaustelle wird angelegt …';
    try {
      // Schon vorhanden: nichts doppelt anlegen, nur hinwechseln.
      const ergebnis = await ladeBeispielbaustelle();
      document.dispatchEvent(new CustomEvent('luense:daten'));
      nachLaden(DEMO_BAUSTELLE_ID, ergebnis);
    } catch (fehler) {
      meldung.textContent = fehler.message;
    } finally {
      laden.disabled = false;
    }
  });

  loeschen.addEventListener('click', async () => {
    if (!confirm('Beispielbaustelle samt allen Beispieldaten (auch Beispiel-Personal, '
      + '-Geräte und -Offerte) endgültig löschen? Echte Daten bleiben unberührt.')) return;
    loeschen.disabled = true;
    try {
      const anzahl = await loescheBeispielbaustelle();
      letzteMeldung = `Beispielbaustelle gelöscht — ${anzahl} ${anzahl === 1 ? 'Dokument' : 'Dokumente'} entfernt.`;
      document.dispatchEvent(new CustomEvent('luense:daten'));
      nachLoeschen();
    } catch (fehler) {
      meldung.textContent = fehler.message;
      loeschen.disabled = false;
    }
  });

  if (letzteMeldung) {
    meldung.textContent = letzteMeldung;
    letzteMeldung = '';
  }
  zeigeStand();
}

// Für Tests/Abnahme: Anzahl der Beispiel-Dokumente je Typ.
export async function beispielStatistik() {
  const docs = await sucheDokumente(istBeispielDokument);
  return docs.reduce((s, d) => ({ ...s, [d.typ]: (s[d.typ] || 0) + 1 }), {});
}
