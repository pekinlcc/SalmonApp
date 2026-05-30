# Wayland Protocols Checklist

Every "the compositor needs to support X for app Y to work right" cost
in one table. Pick a protocol, find the Smithay handler trait, implement
the message handling, test with a known client.

## Tier 1 — must work for the desktop to be usable at all

| Protocol | What it gives you | Smithay handler | Test client |
|---|---|---|---|
| `wl_compositor` | Surfaces (the basic "thing that can have a buffer"). | `CompositorHandler` | weston-info |
| `wl_shm` | Shared-memory buffers (clients pass pixels via shm). | `ShmHandler` | weston-terminal |
| `wl_seat` | Input grouping (keyboard, pointer, touch belong to a seat). | `SeatHandler` | weston-terminal |
| `xdg-shell` (xdg_wm_base, xdg_surface, xdg_toplevel, xdg_popup) | The "this is an app window" protocol. Every GUI app uses it. | `XdgShellHandler` | weston-terminal, gnome-calculator |
| `xdg-decoration-v1` | Server-side vs client-side window borders. GTK apps often expect server-side. | `XdgDecorationHandler` | gnome-calculator |
| `wl_data_device_manager` | Clipboard + drag-and-drop. | `DataDeviceHandler` | any |
| `linux-dmabuf-v1` | GPU buffers (Firefox, Chrome use this). Without it you fall back to slow shm path. | `DmabufHandler` | firefox |

If only Tier 1 works you've got something you can use to launch a
terminal and a calculator. Not usable yet but a real milestone.

## Tier 2 — required for daily-driver feel

| Protocol | What it gives you | Test client |
|---|---|---|
| `wlr-layer-shell-v1` | "Panel" surfaces (top bars, docks, notifications) that pin to screen edges. Your dock and topbar use this. | nwg-bar, waybar |
| `wlr-foreign-toplevel-management-v1` | Lets the dock learn about other apps' windows (the "what's running" list). Without it, your dock can't show app states. | wlrctl |
| `text-input-v3` + `input-method-v2` | IME support. Without these, **no Chinese / Japanese / Korean input**. | fcitx5, ibus |
| `wlr-output-management-v1` | Multi-monitor configuration (kanshi, wdisplays). | wdisplays |
| `wlr-screencopy-v1` | Screenshots, screen sharing. Critical for Zoom / OBS. | grim, slurp |
| `wlr-virtual-pointer-v1` / `virtual-keyboard-v1` | Remote desktop, accessibility tools. | ydotool |
| `idle-notify-v1` | Screensaver triggering. | swayidle |
| `xdg-output-v1` | Logical (scaled) monitor sizes — without this, HiDPI is broken. | every app |
| `presentation-time` | Smooth video playback. | mpv |
| `fractional-scale-v1` | Per-monitor fractional scaling (125%, 150%). HiDPI laptops need this. | firefox, gtk4 |
| `viewporter` | Sub-pixel positioning, needed by video players. | mpv, gstreamer |

## Tier 3 — important but degrade-able

| Protocol | What it gives you | Without it |
|---|---|---|
| `xwayland` | Run X11 apps (still ~30% of the ecosystem). Smithay has `XWaylandKeyboardGrabHandler` + companion `xwayland` crate. | Steam, older Electron, JetBrains IDEs may not launch. |
| `wlr-gamma-control-v1` | Night light / redshift. | No warm-screen mode. |
| `wlr-input-inhibitor-v1` | Lock screen exclusive input. | Lock screen can be bypassed by other clients. |
| `pointer-constraints-v1` + `relative-pointer-v1` | First-person games, CAD. | Games unplayable. |
| `cursor-shape-v1` | Modern cursor protocol. | Falls back to wl_pointer + theme lookup. |
| `tablet-v2` | Graphics tablets (Wacom). | Tablets work but no pressure / tilt. |

## Tier 4 — protocols that exist but you can punt

`drm-lease-v1` (VR headsets), `keyboard-shortcuts-inhibit-v1`,
`primary-selection-v1` (X11 middle-click paste), most of the
`security-context` family. Skip until a user complains.

## XDG portals (org.freedesktop.portal.*)

Separate from Wayland protocols but mandatory for sandboxed apps
(Flatpak, snap). You need `xdg-desktop-portal-wlr` (or write your own
portal backend) for:

- `Screenshot` — `flameshot`, `grim`
- `ScreenCast` — Zoom, OBS, Discord screen share
- `FileChooser` — every Flatpak app that opens a file dialog
- `Settings` — dark mode preference exchange
- `Notification` — falls back here when `org.freedesktop.Notifications`
  isn't running

Install `xdg-desktop-portal-wlr` from apt and configure
`/etc/xdg/xdg-desktop-portal/wlr-portals.conf`. Don't write your own
portal backend in v1 — too much work for too little gain.

## Testing matrix

For each protocol you implement, run at least these clients and watch
for crashes / visual glitches:

| Client | Why it matters |
|---|---|
| `weston-terminal` | Reference correctness — Weston is the upstream Wayland reference compositor; if it works there and not yours, your bug. |
| `firefox` | Tier-1 web app, exercises dmabuf + clipboard heavily. |
| `chromium` | Distinct rendering path from firefox; catches different bugs. |
| `gnome-calculator` | GTK4 baseline. |
| `vscode` (Wayland mode, `--enable-features=UseOzonePlatform --ozone-platform=wayland`) | Electron app, IME stress test. |
| `obs-studio` | screencopy + pipewire integration. |
| `zoom` | screencast portal + dmabuf. |
| `mpv` | viewporter + presentation-time. |
| `gimp` | tablet-v2. |
| `steam` | xwayland survival test. |

Plan to spend at least a week per Tier-1 client on conformance bugs.
