#!/usr/bin/env bash
# Regressions-Tests der Lünse-App. Aufruf aus dem Repo oder von irgendwo:
#   tests/alle.sh             alle Tests (etwa 6 Minuten)
#   tests/alle.sh --schnell   nur Rauchtest
#   tests/alle.sh offerte bank   nur diese Tests (Dateiname ohne .js)
# Ausgabe (Protokolle, Bildschirmfotos, PDF): LUENSE_AUSGABE oder neuer Temp-Ordner.
set -u

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$TESTS_DIR")"
ALLE=(rauchtest offerte rechnung-mwst mwst-pflicht rueckfrage kreditor bank mahnung versand journal)

auswahl=()
for a in "$@"; do
  case "$a" in
    --schnell) auswahl=(rauchtest) ;;
    -h|--hilfe) sed -n '2,6p' "$0"; exit 0 ;;
    *) auswahl+=("${a%.js}") ;;
  esac
done
[ ${#auswahl[@]} -eq 0 ] && auswahl=("${ALLE[@]}")

# Voraussetzungen
command -v node >/dev/null || { echo "node fehlt"; exit 2; }
command -v python3 >/dev/null || { echo "python3 fehlt"; exit 2; }
command -v pdftotext >/dev/null || { echo "pdftotext/pdfinfo/pdftoppm fehlen (Paket poppler-utils)"; exit 2; }
(cd "$TESTS_DIR" && node -e "require('playwright')" 2>/dev/null) \
  || { echo "Node-Modul playwright fehlt (npm i -g playwright && npx playwright install chromium)"; exit 2; }

AUSGABE="${LUENSE_AUSGABE:-$(mktemp -d "${TMPDIR:-/tmp}/luense-tests.XXXXXX")}"
mkdir -p "$AUSGABE"
export LUENSE_AUSGABE="$AUSGABE"

# Freier Port, Server nur auf 127.0.0.1, wird in jedem Fall gestoppt.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
export LUENSE_PORT="$PORT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REPO" >"$AUSGABE/server.log" 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null' EXIT INT TERM
for _ in $(seq 1 50); do
  python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/index.html', timeout=1)" 2>/dev/null && break
  sleep 0.2
done

echo "Lünse-Tests: Server http://127.0.0.1:$PORT/, Ausgabe $AUSGABE"
start=$(date +%s)
uebersicht=()
gesamt=0
for t in "${auswahl[@]}"; do
  datei="$TESTS_DIR/$t.js"
  if [ ! -f "$datei" ]; then uebersicht+=("Test $t: FEHLER (Datei fehlt)"); gesamt=$((gesamt + 1)); continue; fi
  t0=$(date +%s)
  echo "== $t"
  node "$datei" >"$AUSGABE/$t.log" 2>&1
  code=$?
  n=$(grep -c '^FEHLER' "$AUSGABE/$t.log")
  s=$(grep -c '^SKIP' "$AUSGABE/$t.log")
  [ "$code" -ne 0 ] && [ "$n" -eq 0 ] && n=1
  grep -E '^(FEHLER|SKIP)' "$AUSGABE/$t.log" | sed 's/^/   /'
  dauer=$(( $(date +%s) - t0 ))
  zusatz=""
  [ "$s" -gt 0 ] && zusatz=", $s übersprungen"
  if [ "$n" -eq 0 ]; then uebersicht+=("Test $t: OK (${dauer} s$zusatz)")
  else uebersicht+=("Test $t: FEHLER ($n) (${dauer} s$zusatz)"); gesamt=$((gesamt + n)); fi
done

echo
echo "Übersicht"
printf '  %s\n' "${uebersicht[@]}"
echo "Laufzeit $(( $(date +%s) - start )) s, Protokolle in $AUSGABE"
[ "$gesamt" -eq 0 ]
