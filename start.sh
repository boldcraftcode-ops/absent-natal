#!/usr/bin/env bash
# ===========================================================================
#  start.sh - versi Linux / macOS dari start.bat
#  Pakai:  ./start.sh          (port 4173)
#          ./start.sh 8080     (port lain)
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f index.html ] || [ ! -d js ]; then
  echo "[X] index.html tidak ditemukan di folder ini: $(pwd)"
  echo "    Taruh start.sh di dalam folder aplikasi."
  exit 1
fi

PORT="${1:-4173}"

if command -v node >/dev/null 2>&1; then
  exec node tools/lokal-server.mjs --port="$PORT" --no-open
fi

if command -v python3 >/dev/null 2>&1; then
  echo "Node.js tidak ada, memakai Python: http://localhost:$PORT/index.html"
  exec python3 -m http.server "$PORT" --bind 0.0.0.0
fi

echo "[X] Node.js atau Python 3 tidak ditemukan."
echo "    Pasang Node.js LTS dari https://nodejs.org lalu jalankan lagi."
exit 1
