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
for dep in \
  xwayland \
  foot \
  wlrctl \
  wlr-randr \
  waybar \
  libappindicator3-1 \
  swaylock \
  brightnessctl \
  gammastep \
  playerctl \
  power-profiles-daemon \
  xdg-utils \
  xdg-user-dirs \
  xdg-desktop-portal \
  xdg-desktop-portal-wlr \
  xdg-desktop-portal-gtk \
  dbus-bin \
  wireplumber \
  pulseaudio-utils \
  fontconfig \
  wl-clipboard \
  cliphist \
  libglib2.0-bin \
  libgtk-3-bin \
  gsettings-desktop-schemas \
  trash-cli \
  grim \
  slurp \
  libnotify-bin \
  swaybg \
  swayidle \
  wlopm \
  kanshi \
  procps \
  util-linux \
  udisks2 \
  udiskie \
  bluez \
  network-manager \
  cups-client; do
  [[ "$depends" == *"$dep"* ]] || {
    echo "Missing dependency $dep: $depends" >&2
    exit 1
  }
done
[[ "$depends" == *"fcitx5 | ibus"* ]] || {
  echo "Missing input method dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"fcitx5-config-qt | ibus"* ]] || {
  echo "Missing input method settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"mako | dunst"* ]] || {
  echo "Missing notification daemon dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"policykit-1-gnome | lxpolkit | mate-polkit"* ]] || {
  echo "Missing polkit agent dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"pavucontrol | gnome-control-center"* ]] || {
  echo "Missing sound settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"gnome-control-center | systemsettings | xfce4-settings | lxqt-config"* ]] || {
  echo "Missing general system settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"wdisplays | gnome-control-center | arandr"* ]] || {
  echo "Missing display settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"blueman | gnome-control-center"* ]] || {
  echo "Missing bluetooth settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"network-manager-gnome | gnome-control-center"* ]] || {
  echo "Missing network settings dependency alternative: $depends" >&2
  exit 1
}
[[ "$depends" == *"system-config-printer | gnome-control-center"* ]] || {
  echo "Missing printer settings dependency alternative: $depends" >&2
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
  usr/bin/salmon-desktop-doctor
  usr/bin/salmon-brightness
  usr/bin/salmon-input-toggle
  usr/bin/salmon-open-browser
  usr/bin/salmon-open-files
  usr/bin/salmon-open-terminal
  usr/bin/salmon-session-action
  usr/bin/salmon-screenshot
  usr/share/wayland-sessions/salmon-shell.desktop
  usr/share/salmon-desktop/labwc-config/autostart
  usr/share/salmon-desktop/labwc-config/environment
  usr/share/salmon-desktop/labwc-config/menu.xml
  usr/share/salmon-desktop/labwc-config/rc.xml
  usr/share/salmon-desktop/waybar/tray.jsonc
  usr/share/salmon-desktop/waybar/tray.css
  usr/share/xdg-desktop-portal/salmonapp-portals.conf
  usr/share/xdg-desktop-portal/SalmonApp-portals.conf
)

for path in "${required[@]}"; do
  if [[ ! -e "$tmp/$path" ]]; then
    echo "Missing package file: /$path" >&2
    exit 1
  fi
done

grep -q '^Name=SalmonApp Desktop$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q '^Exec=/usr/bin/salmon-session$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q '^TryExec=/usr/bin/salmon-session$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q '^Type=Application$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q '^DesktopNames=SalmonApp$' "$tmp/usr/share/wayland-sessions/salmon-shell.desktop"
grep -q 'system_config="/usr/share/salmon-desktop/labwc-config"' "$tmp/usr/bin/salmon-session"
grep -q 'exec labwc -C "$system_config"' "$tmp/usr/bin/salmon-session"
grep -q 'XDG_DATA_DIRS="/usr/local/share:/usr/share"' "$tmp/usr/bin/salmon-session"
grep -q 'ensure_system_helper_path()' "$tmp/usr/bin/salmon-session"
grep -q 'PATH="${PATH:+$PATH:}$d"' "$tmp/usr/bin/salmon-session"
grep -q 'salmon-desktop/env' "$tmp/usr/bin/salmon-session"
grep -q 'flatpak/exports/share' "$tmp/usr/bin/salmon-session"
grep -q '/var/lib/snapd/desktop' "$tmp/usr/bin/salmon-session"
grep -q 'XDG_DATA_DIRS XDG_CONFIG_DIRS' "$tmp/usr/bin/salmon-session"
grep -q 'GTK/Qt/XIM variables as a group' "$tmp/usr/bin/salmon-session"
grep -q 'export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"' "$tmp/usr/bin/salmon-session"
grep -q 'SalmonApp Desktop doctor' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'wayland session desktop entry fields' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'session launcher starts labwc with Salmon desktop identity' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'session launcher exports desktop discovery paths' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'session launcher exports complete input method environment' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'XDG_DATA_DIRS includes /usr/share' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'PATH includes system sbin directories' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_cmd dbus-update-activation-environment' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_cmd salmon-brightness' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'input method environment is incomplete' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_any_cmd "cups enable command" cupsenable /usr/sbin/cupsenable /sbin/cupsenable' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_any_cmd "cups disable command" cupsdisable /usr/sbin/cupsdisable /sbin/cupsdisable' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_any_cmd "cups cancel command" cancel /usr/bin/cancel /bin/cancel' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_gsettings_schema org.gnome.desktop.interface' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_gsettings_schema org.gnome.desktop.a11y.applications' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_gsettings_schema org.gnome.desktop.a11y.keyboard' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'autostart imports desktop environment into dbus/systemd' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'autostart session services are guarded against duplicates' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'autostart desktop baseline daemons' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'running inside SalmonApp Desktop session' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'runtime process checks skipped; not currently inside SalmonApp Desktop' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "compositor" labwc' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "Salmon shell" salmonapp-desktop salmon-desktop' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "portal service" xdg-desktop-portal' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "tray host" '\''waybar.*salmon-desktop/waybar/tray.jsonc'\''' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "clipboard history watcher" '\''wl-paste.*cliphist store'\''' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'need_process "idle manager" swayidle' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'salmon-display-profile-init' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'tray-only Waybar host config' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'org.freedesktop.impl.portal.RemoteDesktop=wlr' "$tmp/usr/bin/salmon-desktop-doctor"
grep -q 'brightnessctl --class=backlight set "$amount"' "$tmp/usr/bin/salmon-brightness"
grep -q 'exec brightnessctl set "$amount"' "$tmp/usr/bin/salmon-brightness"
grep -q 'fcitx5-remote -t' "$tmp/usr/bin/salmon-input-toggle"
grep -q 'first_xkb=' "$tmp/usr/bin/salmon-input-toggle"
grep -q 'exec ibus engine "$first_xkb"' "$tmp/usr/bin/salmon-input-toggle"
grep -q 'xdg-settings get default-web-browser' "$tmp/usr/bin/salmon-open-browser"
grep -q 'gtk-launch "$default_browser"' "$tmp/usr/bin/salmon-open-browser"
grep -q 'xdg-mime query default inode/directory' "$tmp/usr/bin/salmon-open-files"
grep -q 'gtk-launch "$default_manager" "$target"' "$tmp/usr/bin/salmon-open-files"
grep -q 'TERMINAL' "$tmp/usr/bin/salmon-open-terminal"
grep -q 'run_terminal_command' "$tmp/usr/bin/salmon-open-terminal"
grep -q 'x-terminal-emulator foot gnome-terminal' "$tmp/usr/bin/salmon-open-terminal"
grep -q 'lock|suspend|reboot|poweroff|signout' "$tmp/usr/bin/salmon-session-action"
grep -q 'loginctl terminate-session' "$tmp/usr/bin/salmon-session-action"
grep -q 'Usage: .*{lock|suspend|reboot|poweroff|signout}' "$tmp/usr/bin/salmon-session-action"
SALMON_DESKTOP_ROOT="$tmp" sh "$tmp/usr/bin/salmon-desktop-doctor" >/dev/null || {
  echo "salmon-desktop-doctor reported package failures" >&2
  SALMON_DESKTOP_ROOT="$tmp" sh "$tmp/usr/bin/salmon-desktop-doctor" >&2 || true
  exit 1
}
grep -q 'grim' "$tmp/usr/bin/salmon-screenshot"
grep -q 'xdg-user-dir PICTURES' "$tmp/usr/bin/salmon-screenshot"
grep -q 'Screenshots' "$tmp/usr/bin/salmon-screenshot"
grep -q 'wl-copy -t image/png' "$tmp/usr/bin/salmon-screenshot"
grep -q 'while \[ -e "$file" \]' "$tmp/usr/bin/salmon-screenshot"
grep -q 'full|select' "$tmp/usr/bin/salmon-screenshot"
grep -q 'invalid screenshot mode' "$tmp/usr/bin/salmon-screenshot"
grep -q '"modules-right": \["tray"\]' "$tmp/usr/share/salmon-desktop/waybar/tray.jsonc"
grep -q '#tray' "$tmp/usr/share/salmon-desktop/waybar/tray.css"
[[ "$(readlink "$tmp/usr/bin/salmon-desktop")" == "salmonapp-desktop" ]] || {
  echo "Unexpected /usr/bin/salmon-desktop symlink target" >&2
  exit 1
}
grep -q '/usr/bin/salmon-desktop' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'PATH DISPLAY WAYLAND_DISPLAY' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'dbus-update-activation-environment --systemd PATH DISPLAY WAYLAND_DISPLAY' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'XDG_DATA_DIRS XDG_CONFIG_DIRS' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '/usr/lib/xdg-desktop-portal' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '! process_running fcitx5' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '! process_running swaybg' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'wl-paste.*cliphist store' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'salmon-display-profile-init' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '! process_running kanshi' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'process_running_f xdg-desktop-portal' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'process_running mako || process_running dunst' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'waybar.*salmon-desktop/waybar/tray.jsonc' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q 'polkit_agent_running' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '! process_running udiskie' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '! process_running swayidle' "$tmp/usr/share/salmon-desktop/labwc-config/autostart"
grep -q '^XDG_DATA_DIRS=/usr/local/share:/usr/share$' "$tmp/usr/share/salmon-desktop/labwc-config/environment"
python3 -c "import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])" \
  "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
python3 -c "import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])" \
  "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q '<desktops number="4">' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'name="GoToDesktop" to="1"' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'name="SendToDesktop" to="1"' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'name="SnapToEdge" direction="left"' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-open-terminal' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'key="A-F4"' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'if command -v wpctl' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'pactl set-sink-volume @DEFAULT_SINK@ +5%' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'pactl set-source-mute @DEFAULT_SOURCE@ toggle' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-brightness up' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-brightness down' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-session-action suspend' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-session-action lock' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-session-action signout' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-open-files' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'salmon-open-browser' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q 'menu="root-menu"' "$tmp/usr/share/salmon-desktop/labwc-config/rc.xml"
grep -q '<menu id="root-menu">' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q '<menu id="client-menu">' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-session-action lock' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-session-action suspend' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-session-action reboot' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-session-action poweroff' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-session-action signout' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-open-terminal' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-open-files' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q 'salmon-open-browser' "$tmp/usr/share/salmon-desktop/labwc-config/menu.xml"
grep -q '^default=wlr;gtk;$' "$tmp/usr/share/xdg-desktop-portal/salmonapp-portals.conf"
grep -q '^org.freedesktop.impl.portal.FileChooser=gtk;$' "$tmp/usr/share/xdg-desktop-portal/salmonapp-portals.conf"
grep -q '^org.freedesktop.impl.portal.ScreenCast=wlr;$' "$tmp/usr/share/xdg-desktop-portal/salmonapp-portals.conf"
grep -q '^org.freedesktop.impl.portal.RemoteDesktop=wlr;$' "$tmp/usr/share/xdg-desktop-portal/salmonapp-portals.conf"
cmp -s "$tmp/usr/share/xdg-desktop-portal/salmonapp-portals.conf" "$tmp/usr/share/xdg-desktop-portal/SalmonApp-portals.conf"

echo "OK: $DEB"
echo "Package: $package"
echo "Version: $version"
echo "Architecture: $arch"
echo "Depends: $depends"
