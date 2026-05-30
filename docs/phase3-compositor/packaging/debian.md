# Packaging `salmon-desktop` for Debian / Ubuntu

This is the recipe for the `.deb` that puts `salmon-shell` on a user's
machine and exposes it as a GDM session option. Run this after the
compositor is at least Tier-1-functional (see `../wayland-protocols.md`).

## What the package installs

```
/usr/bin/salmon-shell                                       # the compositor binary
/usr/bin/salmon-app                                         # the desktop UI (Tauri)
/usr/share/wayland-sessions/salmon-shell.desktop            # GDM picks this up
/usr/share/xsessions/salmon-shell-x11.desktop  (optional)   # X11 fallback if you support it
/usr/share/applications/salmon-app.desktop                  # so it shows in normal app menus too
/usr/share/icons/hicolor/*/apps/salmon.png                  # icon at multiple sizes
/usr/share/dbus-1/services/app.salmon.Shell.service         # if you implement D-Bus services
/etc/systemd/user/salmon-shell-services.target              # user-services target
/etc/xdg/xdg-desktop-portal/salmon-portals.conf             # tells xdg-desktop-portal which backend
```

## Build recipe (cargo-deb)

```toml
# In crates/salmon-shell/Cargo.toml:
[package.metadata.deb]
maintainer = "Salmon <hi@salmon.app>"
copyright = "2026, Salmon"
license-file = ["LICENSE", "4"]
extended-description = """
SalmonApp Desktop is an AI-first Wayland session that replaces GNOME
Shell with the Salmon Brief widget, an Ubuntu-style dock, and direct
access to mail/calendar/tasks from the desktop.
"""
section = "x11"
priority = "optional"
depends = """
  libwayland-server0,
  libinput10,
  libudev1,
  libgbm1,
  libdrm2,
  libsystemd0,
  xdg-desktop-portal-wlr,
  xwayland,
  fonts-noto-cjk
"""
assets = [
    ["target/release/salmon-shell", "usr/bin/", "755"],
    ["target/release/salmon-app",   "usr/bin/", "755"],
    ["../../docs/phase3-compositor/session/salmon-shell.desktop",
     "usr/share/wayland-sessions/salmon-shell.desktop", "644"],
    ["../../assets/icon-256.png",
     "usr/share/icons/hicolor/256x256/apps/salmon.png", "644"],
]
```

Then:

```
cargo install cargo-deb
cargo deb -p salmon-shell
# → target/debian/salmon-desktop_1.20.0_amd64.deb
sudo apt install ./target/debian/salmon-desktop_1.20.0_amd64.deb
```

## Snap (alternative distribution)

Wayland compositors as snaps are awkward — snaps run sandboxed and the
compositor needs to talk to /dev/dri and /dev/input directly. The two
options:

1. **Classic confinement** — `confinement: classic` in `snapcraft.yaml`.
   Easier but requires manual review by the Snap Store team.
2. **Strict + interfaces** — declare `wayland`, `opengl`, `hardware-observe`,
   `kernel-module-control`, `desktop`, `desktop-launch` interfaces. Most
   users will need `sudo snap connect` invocations to enable them all.

Recommendation: ship `.deb` first, defer snap until there's user demand.

## Post-install behaviour

After `apt install`, the user **does not** automatically switch to
Salmon. They must:

1. Log out (or reboot).
2. At GDM, click the gear icon next to their password field.
3. Pick "SalmonApp Desktop" from the session list.
4. Log in.

GDM persists their choice, so subsequent boots default to Salmon
until they switch back the same way. If `salmon-shell` crashes on
launch, GDM falls back to its login screen — they can pick a different
session (Ubuntu) from there.

## Recovery / uninstall

```
sudo apt remove salmon-desktop
# At next login, the GDM gear no longer shows "SalmonApp Desktop".
# If you were defaulting to it, GDM falls back to Ubuntu.
```

If you broke the install enough that GDM itself won't start, drop to
a TTY (Ctrl+Alt+F3), log in, run `sudo apt remove --purge salmon-desktop`
+ `sudo systemctl restart gdm`. The session file going away will make
GDM forget the choice on next boot.

## Don't do these

- **Don't ship a `Pre-Depends`** that swaps GDM out for SDDM or LightDM.
  Users picked their distro for a reason.
- **Don't replace `/usr/share/xsessions/ubuntu.desktop`** even if you
  also ship an X11 fallback. Coexist.
- **Don't auto-switch the default session** in `postinst`. Make the user
  click the gear once.
- **Don't bundle PipeWire, NetworkManager, or polkit** in your package.
  Depend on them. They're already on every Ubuntu install.
