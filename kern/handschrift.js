// kern/handschrift.js — Handnotizen und Skizzen mit Finger oder Stift.
// Öffnet eine Vollbild-Zeichenfläche und liefert die Zeichnung als
// PNG-Blob zurück (null bei Abbruch). Offline vollständig funktionsfähig;
// eine Texterkennung (OCR) wäre nur online möglich und ist bewusst
// nicht eingebaut, solange kein Dienst dafür bestimmt ist.

const FARBEN = ['#1c1b18', '#c62828', '#1565c0'];

export function oeffneHandnotiz() {
  return new Promise((fertig) => {
    const overlay = document.createElement('div');
    overlay.className = 'handnotiz';
    overlay.innerHTML = `
      <div class="handnotiz-leiste">
        ${FARBEN.map((farbe, i) => `
          <button type="button" class="farb-knopf${i === 0 ? ' aktiv' : ''}"
            data-farbe="${farbe}" style="--stift: ${farbe}"
            aria-label="Stiftfarbe ${farbe}"></button>`).join('')}
        <button type="button" class="knopf" data-aktion="leeren">Leeren</button>
        <span class="handnotiz-platz"></span>
        <button type="button" class="knopf" data-aktion="abbrechen">Abbrechen</button>
        <button type="button" class="knopf knopf-primaer" data-aktion="speichern">Speichern</button>
      </div>
      <canvas></canvas>`;
    document.body.append(overlay);

    const canvas = overlay.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    const rechteck = canvas.getBoundingClientRect();
    canvas.width = Math.round(rechteck.width * dpr);
    canvas.height = Math.round(rechteck.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rechteck.width, rechteck.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = FARBEN[0];

    let zeichnet = false;
    let vorher = null;
    let benutzt = false;
    const position = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      zeichnet = true;
      benutzt = true;
      vorher = position(e);
      // Punkt setzen, damit auch ein Tipp sichtbar ist.
      ctx.beginPath();
      ctx.moveTo(vorher.x, vorher.y);
      ctx.lineTo(vorher.x + 0.1, vorher.y + 0.1);
      ctx.stroke();
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

    overlay.querySelector('.handnotiz-leiste').addEventListener('click', (klick) => {
      const farbKnopf = klick.target.closest('[data-farbe]');
      if (farbKnopf) {
        ctx.strokeStyle = farbKnopf.dataset.farbe;
        overlay.querySelectorAll('.farb-knopf').forEach((k) =>
          k.classList.toggle('aktiv', k === farbKnopf));
        return;
      }
      const aktion = klick.target.closest('[data-aktion]')?.dataset.aktion;
      if (aktion === 'leeren') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, rechteck.width, rechteck.height);
        benutzt = false;
      } else if (aktion === 'abbrechen') {
        overlay.remove();
        fertig(null);
      } else if (aktion === 'speichern') {
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
