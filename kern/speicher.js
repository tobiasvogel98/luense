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

// Alle Dokumente eines Typs, optional auf eine Baustelle gefiltert.
// Sortiert nach datum, neuste zuerst.
export async function abfrage({ typ, baustelleId } = {}) {
  if (!typ) throw new Error('abfrage() braucht einen typ.');
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
