#!/bin/zsh
# Builds every part of a Leaflet release from one version number (js/version.js), so they ship and update together:
#   dist/Leaflet-macOS.zip     the Mac app       (updates itself from GitHub releases)
#   dist/Leaflet-Windows.zip   the Windows app   (Leaflet Helper updates it from GitHub releases)
#   dist/LeafletLink.3dsx      Leaflet Link      (Leaflet sends it to the 3DS when it connects to an older one)
#   Leaflet on phones          inside Leaflet Link, so it updates whenever Leaflet Link does
# Bump the version in js/version.js first. Publishing stays a separate, deliberate step: this prints the command.
set -euo pipefail
cd "${0:A:h}/.."
VERSION=$(sed -n "s/.*LEAFLET_VERSION = '\([0-9.]*\)'.*/\1/p" js/version.js)
[[ -n "$VERSION" ]] || { echo "No version in js/version.js" >&2; exit 1; }
echo "Leaflet $VERSION"

# Leaflet Link (and Leaflet for phones inside it), then js/linkapp.js so the apps carry this Leaflet Link.
export DEVKITPRO=${DEVKITPRO:-/opt/devkitpro} DEVKITARM=${DEVKITARM:-/opt/devkitpro/devkitARM}
make -C link all
make -C link sim
python3 link/tests/test_link.py link/host/leaflet-link-sim

# Every part must carry the same number.
grep -q "#define LL_VERSION \"$VERSION\"" link/source/version.h || { echo "Leaflet Link isn't $VERSION" >&2; exit 1; }
grep -q "version: '$VERSION'" js/linkapp.js || { echo "js/linkapp.js doesn't carry Leaflet Link $VERSION" >&2; exit 1; }

./tools/package.sh
cp link/LeafletLink.3dsx dist/
unzip -p dist/Leaflet-macOS.zip Leaflet.app/Contents/Info.plist | grep -q "<string>$VERSION</string>" || { echo "The Mac app isn't $VERSION" >&2; exit 1; }
unzip -p dist/Leaflet-Windows.zip Leaflet-Windows/app/js/version.js | grep -q "'$VERSION'" || { echo "The Windows app isn't $VERSION" >&2; exit 1; }

echo
echo "Built Leaflet $VERSION:"; ls -lh dist/Leaflet-macOS.zip dist/Leaflet-Windows.zip dist/LeafletLink.3dsx
echo
echo "To publish (the apps look for these exact file names):"
echo "  gh release create v$VERSION dist/Leaflet-macOS.zip dist/Leaflet-Windows.zip dist/LeafletLink.3dsx --title \"Leaflet $VERSION\" --notes-file <notes.md>"
