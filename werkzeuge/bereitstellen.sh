#!/bin/sh
# Stellt für Cloudflare nur die App-Dateien in dist/ zusammen.
# Baupläne, Anleitungen, CLAUDE.md und Werkzeuge bleiben so unveröffentlicht.
# Cloudflare Worker: Build-Befehl «sh werkzeuge/bereitstellen.sh»,
# Deploy-Befehl «npx wrangler deploy» (liest wrangler.jsonc).
set -e
rm -rf dist
mkdir dist
cp -r index.html style.css sw.js manifest.json _headers icons kern module lib dist/
echo "dist/ bereit: $(find dist -type f | wc -l) Dateien"
