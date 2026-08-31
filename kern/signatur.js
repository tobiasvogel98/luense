// kern/signatur.js — Unterschrift direkt auf dem Bildschirm leisten.
// Kompaktes Unterschriften-Feld mit Grundlinie, liefert die Unterschrift
// als PNG-Blob mit transparentem Hintergrund (null bei Abbruch).

export function oeffneSignatur({ hinweis = 'Bitte im Feld unterschreiben' } = {}) {
  return new Promise((fertig) => {
    const overlay = document.createElement('div');
    overlay.className = 'vollbild signatur';
    overlay.innerHTML = `
      <div class="karte signatur-karte">
        <p class="hinweis">${hinweis}</p>
        <canvas class="signatur-feld"></canvas>
        <div class="knopfzeile">
          <button type="button" class="knopf" data-aktion="leeren">Leeren</button>
          <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
          <button type="button" class="knopf knopf-primaer" data-aktion="uebernehmen">Übernehmen</button>
        </div>
      </div>`;
    document.body.append(overlay);

    const canvas = overlay.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    const rechteck = canvas.getBoundingClientRect();
    canvas.width = Math.round(rechteck.width * dpr);
    canvas.height = Math.round(rechteck.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    // Kein weisser Grund: die Grundlinie kommt per CSS und landet so
    // nicht im exportierten Bild — die Unterschrift bleibt freigestellt.
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a237e';

    let zeichnet = false;
    let vorher = null;
    let benutzt = false;
    const position = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetisch */ }
      zeichnet = true;
      benutzt = true;
      vorher = position(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!zeichnet) return;
      const jetzt = position(e);
      ctx.beginPath();
      ctx.moveTo(vorher.x, vorher.y);
      ctx.lineTo(jetzt.x, jetzt.y);
      ctx.stroke();
      vorher = jetzt;
    });
    const stopp = () => { zeichnet = false; };
    canvas.addEventListener('pointerup', stopp);
    canvas.addEventListener('pointercancel', stopp);

    overlay.addEventListener('click', (klick) => {
      const aktion = klick.target.closest('[data-aktion]')?.dataset.aktion;
      if (!aktion) return;
      if (aktion === 'leeren') {
        ctx.clearRect(0, 0, rechteck.width, rechteck.height);
        benutzt = false;
      } else if (aktion === 'abbrechen') {
        overlay.remove();
        fertig(null);
      } else if (aktion === 'uebernehmen') {
        if (!benutzt) {
          overlay.remove();
          fertig(null);
          return;
        }
        canvas.toBlob((blob) => {
          overlay.remove();
          fertig(blob);
        }, 'image/png');
      }
    });
  });
}
