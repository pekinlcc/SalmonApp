# SalmonApp Desktop Phase 3 labwc package verification

Date: 2026-05-18
Artifact: `dist/salmon-desktop_2.0.0_amd64.deb`

This package uses Ubuntu's `labwc` compositor as the Wayland session
substrate. It does not install the parked Smithay skeleton.

## Package contents

The final package is produced by:

```bash
./scripts/build-deb.sh
```

Expected installed files:

```text
/usr/bin/salmonapp-desktop
/usr/bin/salmon-desktop
/usr/bin/salmon-session
/usr/share/wayland-sessions/salmon-shell.desktop
/usr/share/salmon-desktop/labwc-config/autostart
/usr/share/salmon-desktop/labwc-config/environment
/usr/share/salmon-desktop/labwc-config/rc.xml
```

`/usr/bin/salmon-desktop` is a compatibility symlink to the Tauri-built
`/usr/bin/salmonapp-desktop` binary, matching the session/autostart name
used in the Phase 3 handover.

The package declares `labwc`, `libwebkit2gtk-4.1-0`, and Ubuntu 24.04's
`libgtk-3-0t64` in `Depends`. Because `dpkg -i` does not resolve
dependencies, immediately repair dependencies with `apt -f install` if
`dpkg` reports missing packages.

Preferred local install sequence, matching the Phase 3 acceptance gate where
`dpkg -i` itself must exit successfully:

```bash
sudo apt-get install -y --no-install-recommends labwc
sudo dpkg -i dist/salmon-desktop_2.0.0_amd64.deb
ls /usr/share/wayland-sessions/salmon-shell.desktop
```

Clean-machine alternative when intentionally testing dependency repair:

```bash
sudo dpkg -i dist/salmon-desktop_2.0.0_amd64.deb || sudo apt-get -y -f install
```

## GDM verification

After install:

1. Log out.
2. In GDM, use the gear menu and choose `SalmonApp Desktop`.
3. Log in.
4. Verify the session is SalmonApp shell, not GNOME:
   - wallpaper is visible
   - Brief widget is visible
   - dock is visible
   - launcher is visible
5. Click Mail, Calendar, and Tasks from the dock.
6. Verify each opens as its own floating native window.
7. Verify each window can be focused independently and closed without
   closing the desktop shell.
8. Log out.
9. In GDM, use the gear menu and choose `Ubuntu`.
10. Log in and verify normal GNOME returns.

## Recovery

If the new session hangs, switch to a TTY with `Ctrl+Alt+F3`, log in, and
remove the package:

```bash
sudo dpkg -r salmon-app-desktop
```

If GDM still lists the session after removal, remove the session file:

```bash
sudo rm -f /usr/share/wayland-sessions/salmon-shell.desktop
```

Do not set SalmonApp Desktop as the default session. Pick it manually from
GDM each time while testing.
