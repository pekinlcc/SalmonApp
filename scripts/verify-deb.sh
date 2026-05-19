#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('$ROOT_DIR/crates/salmon-desktop/package.json','utf8')); process.stdout.write(p.version);"
)"
DEB="${1:-$ROOT_DIR/dist/salmon-desktop_${VERSION}_amd64.deb}"

if [[ ! -f "$DEB" ]]; then
  echo "Missing .deb: $DEB" >&2
  exit 1
fi

package="$(dpkg-deb -f "$DEB" Package)"
version="$(dpkg-deb -f "$DEB" Version)"
arch="$(dpkg-deb -f "$DEB" Architecture)"
depends="$(dpkg-deb -f "$DEB" Depends)"

[[ "$package" == "salmon-app-desktop" ]] || {
  echo "Unexpected package: $package" >&2
  exit 1
}
[[ "$version" == "$VERSION" ]] || {
  echo "Unexpected version: $version" >&2
  exit 1
}
[[ "$arch" == "amd64" ]] || {
  echo "Unexpected architecture: $arch" >&2
  exit 1
}
[[ "$depends" == *"labwc"* ]] || {
  echo "Missing labwc dependency: $depends" >&2
  exit 1
}
[[ "$depends" == *"libwebkit2gtk-4.1-0"* ]] || {
  echo "Missing WebKitGTK dependency: $depends" >&2
  exit 1
}
[[ "$depends" == *"libgtk-3-0t64"* ]] || {
  echo "Missing GTK t64 dependency: $depends" >&2
  exit 1
}

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

dpkg-deb -x "$DEB" "$tmp"

required=(
  usr/bin/salmonapp-desktop
  usr/bin/salmon-desktop
  usr/bin/salmon-session
  usr/share/wayland-sessions/salmon-shell.desktop
  usr/share/salmon-desktop/labwc-config/autostart
  usr/share/salmon-desktop/labwc-config/environment
  usr/share/salmon-desktop/labwc-config/rc.xml
)

for path in "${required[@]}"; do
  if [[ ! -e "$tmp/$path" ]]; then
    echo "Missing package file: /$path" >&2
    exit 1
  fi
done

grep -q '^Name=SalmonApp Desktop$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q '^Exec=/usr/bin/salmon-session$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q 'system_config="/usr/share/salmon-desktop/labwc-config"' "$tmp/usr/bin/salmon-session"
grep -q 'exec labwc -C "$system_config"' "$tmp/usr/bin/salmon-session"
[[ "$(readlink "$tmp/usr/bin/salmon-desktop")" == "salmonapp-desktop" ]] || {
  echo "Unexpected /usr/bin/salmon-desktop symlink target" >&2
  exit 1
}
grep -q '/usr/bin/salmon-desktop' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
python3 -c "import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])" \
  "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"

echo "OK: $DEB"
echo "Package: $package"
echo "Version: $version"
echo "Architecture: $arch"
echo "Depends: $depends"
