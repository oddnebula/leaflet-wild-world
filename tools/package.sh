#!/bin/zsh
# Builds both releases into dist/:
#   Leaflet-macOS.zip    Leaflet.app (universal, macOS 13+)
#   Leaflet-Windows.zip  "Start Leaflet.cmd" + app/ (Windows 10/11, runs in an Edge app window)
set -euo pipefail
cd "${0:A:h}/.."

./mac/build.sh

WIN=dist/Leaflet-Windows
rm -rf "$WIN" && mkdir -p "$WIN/app"
cp index.html "$WIN/app/" && cp -R css js "$WIN/app/"
# Windows wants CRLF line endings in batch files.
sed 's/$/\r/' "windows/Start Leaflet.cmd" > "$WIN/Start Leaflet.cmd"
# Leaflet Link and its wireless installer (Cartridge Sync).
if [[ -f link/LeafletLink.3dsx ]]; then
  cp link/LeafletLink.3dsx "$WIN/app/"
  sed 's/$/\r/' "windows/Install Leaflet Link.cmd" > "$WIN/Install Leaflet Link.cmd"
  sed 's/$/\r/' "windows/Install Leaflet Link.ps1" > "$WIN/app/Install Leaflet Link.ps1"
else
  echo "note: link/LeafletLink.3dsx isn't built (make -C link), so Leaflet Link isn't in the Windows zip" >&2
fi
cp README.md "$WIN/README.txt"
cp LICENSE "$WIN/LICENSE.txt" && cp LEGAL.md "$WIN/LEGAL.txt" && cp THIRD_PARTY_NOTICES.md "$WIN/THIRD_PARTY_NOTICES.txt" && cp -R licenses "$WIN/licenses"

rm -f dist/Leaflet-Windows.zip
(cd dist && zip -qr Leaflet-Windows.zip Leaflet-Windows)
ls -lh dist/*.zip
