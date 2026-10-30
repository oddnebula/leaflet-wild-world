#!/bin/zsh
# Builds dist/Leaflet.app and dist/Leaflet-macOS.zip (universal: Apple silicon + Intel) from the web editor.
# The app is assembled and signed in a temporary folder: cloud-synced folders (iCloud Drive "Documents") add Finder
# metadata to bundles that codesign refuses, so signing happens outside them and the zip is made from the signed copy.
set -euo pipefail
cd "${0:A:h}/.."
ROOT=$PWD
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/Leaflet.app"
mkdir -p "$ROOT/dist"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources/web"

# Universal binary (arm64 + x86_64), macOS 13+. Leaflet.swift has the app's top-level code, so it's compiled as
# main.swift alongside the other sources.
cp mac/Leaflet.swift "$TMP/main.swift"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" -framework AppKit -framework WebKit \
    -o "$TMP/Leaflet-$arch" "$TMP/main.swift" mac/LinkInstaller.swift mac/EmulatorSession.swift mac/MelonInstaller.swift mac/SaveFinder.swift mac/Updater.swift
done
lipo -create "$TMP/Leaflet-arm64" "$TMP/Leaflet-x86_64" -output "$OUT/Contents/MacOS/Leaflet"

# Web app.
ditto --noextattr index.html "$OUT/Contents/Resources/web/index.html"
ditto --noextattr css "$OUT/Contents/Resources/web/css"
ditto --noextattr js "$OUT/Contents/Resources/web/js"
ditto --noextattr LICENSE "$OUT/Contents/Resources/LICENSE"
ditto --noextattr LEGAL.md "$OUT/Contents/Resources/LEGAL.md"
ditto --noextattr THIRD_PARTY_NOTICES.md "$OUT/Contents/Resources/THIRD_PARTY_NOTICES.md"
ditto --noextattr licenses "$OUT/Contents/Resources/licenses"

# Icon.
swift mac/icon.swift "$TMP/Leaflet.iconset"
iconutil -c icns "$TMP/Leaflet.iconset" -o "$OUT/Contents/Resources/Leaflet.icns"

# The version comes from js/version.js.
VERSION=$(sed -n "s/.*LEAFLET_VERSION = '\([0-9.]*\)'.*/\1/p" js/version.js)
cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Leaflet</string>
  <key>CFBundleDisplayName</key><string>Leaflet</string>
  <key>CFBundleIdentifier</key><string>app.leaflet.wildworld-editor</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>Leaflet</string>
  <key>CFBundleIconFile</key><string>Leaflet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Not affiliated with Nintendo.</string>
  <key>NSLocalNetworkUsageDescription</key><string>Cartridge Sync talks to Leaflet Link on your 3DS over your Wi-Fi network.</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Nintendo DS save</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>CFBundleTypeExtensions</key><array><string>sav</string><string>dsv</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# Ad-hoc signature so Gatekeeper treats it as a local app.
xattr -cr "$OUT" 2>/dev/null || true
codesign --force --deep --sign - "$OUT"
codesign --verify --deep "$OUT"
rm -f "$ROOT/dist/Leaflet-macOS.zip"
(cd "$TMP" && ditto -c -k --norsrc --noextattr --keepParent Leaflet.app "$ROOT/dist/Leaflet-macOS.zip")
rm -rf "$ROOT/dist/Leaflet.app"
ditto --noextattr "$OUT" "$ROOT/dist/Leaflet.app"
echo "Built $ROOT/dist/Leaflet-macOS.zip and $ROOT/dist/Leaflet.app"
