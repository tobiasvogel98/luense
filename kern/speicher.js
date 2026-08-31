// kern/speicher.js — einzige Stelle, die mit der Datenbank spricht.
// Jedes Dokument trägt: _id, typ, baustelleId, datum (ISO-String).

const db = new PouchDB('luense');

// Neue Dokument-Id mit typ-Präfix, damit abfrage() über den Id-Bereich lesen kann.
export function neueId(typ) {
  return `${typ}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function put(doc) {
  if (!doc.typ) throw new Error('Dokument ohne typ.');
  if (!doc._id) doc._id = neueId(doc.typ);
  if (!doc.baustelleId) throw new Error('Dokument ohne baustelleId.');
  if (!doc.datum) doc.datum = new Date().toISOString();
  const antwort = await db.put(doc);
  return { ...doc, _rev: antwort.rev };
}

export async function get(id) {
  return db.get(id);
}

// Anhänge (z. B. Fotos) am Dokument. Holt vor dem Anhängen die aktuelle
// Revision, damit mehrere Anhänge nacheinander sauber durchgehen.
export async function haengeAnhangAn(docId, name, blob) {
  const doc = await db.get(docId);
  return db.putAttachment(docId, name, doc._rev, blob, blob.type || 'image/jpeg');
}

export async function holeAnhang(docId, name) {
  return db.getAttachment(docId, name);
}

// Endgültiges Löschen — die Ansicht muss vorher bestätigen lassen.
export async function entferneDokument(docId) {
  const doc = await db.get(docId);
  return db.remove(doc);
}

export async function entferneAnhang(docId, name) {
  const doc = await db.get(docId);
  return db.removeAttachment(docId, name, doc._rev);
}

// Gesamtexport fürs Backup: alle Dokumente samt Anhängen (base64).
// Interne Index-Dokumente (_design/…) bleiben draussen.
export async function exportiereAlles() {
  const ergebnis = await db.allDocs({ include_docs: true, attachments: true });
  return ergebnis.rows.map((zeile) => zeile.doc)
    .filter((doc) => !doc._id.startsWith('_design/'));
}

// Import mit Duplikat-Schutz: ergänzt statt überschreibt — vorhandene
// _ids bleiben unangetastet.
export async function importiereDokumente(dokumente) {
  const vorhandene = new Set((await db.allDocs()).rows.map((zeile) => zeile.id));
  let neu = 0;
  let uebersprungen = 0;
  for (const doc of dokumente) {
    if (!doc || !doc._id || vorhandene.has(doc._id)) {
      uebersprungen++;
      continue;
    }
    const { _rev, ...ohneRev } = doc;
    await db.put(ohneRev);
    vorhandene.add(doc._id);
    neu++;
  }
  return { neu, uebersprungen };
}

// Persistenter Index über [typ, baustelleId, datum] — abfrage() liest
// damit nur die Dokumente der gefragten Baustelle statt alle eines Typs
// zu laden und erst danach zu filtern (skaliert mit vielen Baustellen
// und tausenden Fotos). Der Index wird von PouchDB einmal gebaut und
// danach inkrementell nachgeführt.
const INDEX_ID = '_design/luense';
let indexBereit = null;

function sicherstelleIndex() {
  if (!indexBereit) {
    indexBereit = db.get(INDEX_ID).catch(() => db.put({
      _id: INDEX_ID,
      views: {
        nachTypUndBaustelle: {
          map: "function (doc) { if (doc.typ) emit([doc.typ, doc.baustelleId || '', doc.datum || '']); }",
        },
      },
    })).catch(() => {});
  }
  return indexBereit;
}

// Alle Dokumente eines Typs, optional auf eine Baustelle gefiltert.
// Sortiert nach datum, neuste zuerst.
export async function abfrage({ typ, baustelleId } = {}) {
  if (!typ) throw new Error('abfrage() braucht einen typ.');
  try {
    await sicherstelleIndex();
    const ergebnis = await db.query('luense/nachTypUndBaustelle', {
      include_docs: true,
      ...(baustelleId
        ? { startkey: [typ, baustelleId], endkey: [typ, baustelleId, {}] }
        : { startkey: [typ], endkey: [typ, {}] }),
    });
    const docs = ergebnis.rows.map((zeile) => zeile.doc);
    docs.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    return docs;
  } catch {
    // Rückfallebene: alter Volltyp-Scan über die Id-Präfixe.
    const ergebnis = await db.allDocs({
      include_docs: true,
      startkey: `${typ}:`,
      endkey: `${typ}:￰`, // Endzeichen ist U+FFF0: oberes Ende des Id-Bereichs
    });
    let docs = ergebnis.rows.map((zeile) => zeile.doc);
    if (baustelleId) docs = docs.filter((d) => d.baustelleId === baustelleId);
    docs.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    return docs;
  }
}
