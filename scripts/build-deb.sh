#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/crates/salmon-desktop"
PACKAGING_DIR="$DESKTOP_DIR/packaging"
DIST_DIR="$ROOT_DIR/dist"

VERSION="$(
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('$DESKTOP_DIR/package.json','utf8')); process.stdout.write(p.version);"
)"

echo "Building SalmonApp Desktop $VERSION"
(
  cd "$DESKTOP_DIR"
  npm run tauri build
)

BASE_DEB="$ROOT_DIR/target/release/bundle/deb/SalmonApp Desktop_${VERSION}_amd64.deb"
OUT_DEB="$DIST_DIR/salmon-desktop_${VERSION}_amd64.deb"

if [[ ! -f "$BASE_DEB" ]]; then
  echo "Missing Tauri .deb: $BASE_DEB" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

PKG_DIR="$WORK_DIR/pkg"
dpkg-deb -R "$BASE_DEB" "$PKG_DIR"

install -d "$PKG_DIR/usr/share/wayland-sessions"
install -d "$PKG_DIR/usr/share/salmon-desktop/labwc-config"
install -d "$PKG_DIR/usr/bin"

install -m 0644 "$PACKAGING_DIR/salmon-shell.desktop" "$PKG_DIR/usr/share/wayland-sessions/salmon-shell.desktop"
install -m 0755 "$PACKAGING_DIR/salmon-session" "$PKG_DIR/usr/bin/salmon-session"
ln -sf salmonapp-desktop "$PKG_DIR/usr/bin/salmon-desktop"
install -m 0755 "$PACKAGING_DIR/labwc-config/autostart" "$PKG_DIR/usr/share/salmon-desktop/labwc-config/autostart"
install -m 0644 "$PACKAGING_DIR/labwc-config/environment" "$PKG_DIR/usr/share/salmon-desktop/labwc-config/environment"
install -m 0644 "$PACKAGING_DIR/labwc-config/rc.xml" "$PKG_DIR/usr/share/salmon-desktop/labwc-config/rc.xml"

install -d "$PKG_DIR/DEBIAN"
cat > "$PKG_DIR/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
POSTINST
chmod 0755 "$PKG_DIR/DEBIAN/postinst"

cat > "$PKG_DIR/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
POSTRM
chmod 0755 "$PKG_DIR/DEBIAN/postrm"

(
  cd "$PKG_DIR"
  find usr -type f -print0 \
    | sort -z \
    | xargs -0 md5sum > DEBIAN/md5sums
)

INSTALLED_SIZE="$(
  du -sk "$PKG_DIR/usr" | awk '{print $1}'
)"
sed -i "s/^Installed-Size: .*/Installed-Size: $INSTALLED_SIZE/" "$PKG_DIR/DEBIAN/control"
python3 - "$PKG_DIR/DEBIAN/control" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines()
out = []
for line in lines:
    if line.startswith("Depends: "):
        deps = [dep.strip() for dep in line.removeprefix("Depends: ").split(",")]
        normalized = []
        seen = set()
        for dep in deps:
            # Ubuntu 24.04+ renamed GTK for the 64-bit time_t transition. The
            # t64 package Provides the old name, but the concrete package name
            # makes apt/dpkg diagnostics clearer on Noble and newer.
            if dep == "libgtk-3-0":
                dep = "libgtk-3-0t64"
            if dep and dep not in seen:
                normalized.append(dep)
                seen.add(dep)
        line = "Depends: " + ", ".join(normalized)
    out.append(line)
path.write_text("\n".join(out) + "\n")
PY

mkdir -p "$DIST_DIR"
dpkg-deb --root-owner-group -b "$PKG_DIR" "$OUT_DEB"

echo "Wrote $OUT_DEB"
dpkg-deb -I "$OUT_DEB"
dpkg-deb -c "$OUT_DEB" | grep -E 'usr/bin/salmon-session|usr/bin/salmon-desktop|usr/bin/salmonapp-desktop|usr/share/wayland-sessions/salmon-shell.desktop|usr/share/salmon-desktop/labwc-config'
