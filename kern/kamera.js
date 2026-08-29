// kern/kamera.js — Fotos fürs Erfassen aufbereiten:
// Canvas-Verkleinerung auf max. 1600 px lange Kante, JPEG-Qualität 0.8.

const MAX_KANTE = 1600;
const QUALITAET = 0.8;

async function ladeBild(datei) {
  try {
    // from-image respektiert die EXIF-Ausrichtung (Handy-Hochformat).
    return await createImageBitmap(datei, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(datei);
  }
}

export async function verkleinereFoto(datei) {
  const bild = await ladeBild(datei);
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
  const breite = Math.max(1, Math.round(bild.width * faktor));
  const hoehe = Math.max(1, Math.round(bild.height * faktor));
  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  canvas.getContext('2d').drawImage(bild, 0, 0, breite, hoehe);
  bild.close();
  const blob = await new Promise((erfuelle) =>
    canvas.toBlob(erfuelle, 'image/jpeg', QUALITAET));
  if (!blob) throw new Error('Foto konnte nicht verarbeitet werden.');
  return blob;
}
