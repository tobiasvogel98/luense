#!/bin/sh
# Stellt für Cloudflare Pages nur die App-Dateien in dist/ zusammen.
# Baupläne, Anleitungen, CLAUDE.md und Werkzeuge bleiben so unveröffentlicht.
# Cloudflare Pages: Build-Befehl «sh werkzeuge/bereitstellen.sh»,
# Ausgabeverzeichnis «dist».
set -e
rm -rf dist
mkdir dist
cp -r index.html style.css sw.js manifest.json _headers icons kern module lib dist/
echo "dist/ bereit: $(find dist -type f | wc -l) Dateien"
