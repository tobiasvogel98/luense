# Liest den ersten Swiss-QR-Code (Text beginnt mit «SPC») aus PGM-Bildern
# (pdftoppm -gray). Braucht zxing-cpp und numpy (PYTHONPATH von hilfe.js).
# Ausgabe: der QR-Inhalt auf stdout; Exit 1, wenn keiner gefunden wurde.
import sys

import numpy
import zxingcpp


def lese_pgm(datei):
    with open(datei, 'rb') as f:
        daten = f.read()
    teile = []
    pos = 0
    while len(teile) < 4:
        while daten[pos:pos + 1].isspace():
            pos += 1
        if daten[pos:pos + 1] == b'#':
            pos = daten.index(b'\n', pos) + 1
            continue
        ende = pos
        while not daten[ende:ende + 1].isspace():
            ende += 1
        teile.append(daten[pos:ende])
        pos = ende
    pos += 1
    breite, hoehe = int(teile[1]), int(teile[2])
    return numpy.frombuffer(daten, dtype=numpy.uint8, count=breite * hoehe, offset=pos).reshape(hoehe, breite)


for datei in sys.argv[1:]:
    for treffer in zxingcpp.read_barcodes(lese_pgm(datei)):
        if treffer.text.startswith('SPC'):
            print(treffer.text)
            sys.exit(0)
sys.exit(1)
