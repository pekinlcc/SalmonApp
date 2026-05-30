# Salmon Desktop Linux Baseline Audit

This tracks the baseline desktop capabilities expected from a normal Linux
desktop session while preserving Salmon Desktop's AI-first shell.

## Covered In Current Worktree

- Session startup: GDM session entry launches `salmon-session`, which starts
  labwc with bundled config and preserves user PATH, proxy env, DPI, Wayland
  backends, XWayland support for legacy X11 apps, XDG data/config discovery
  paths, Flatpak/Snap exported application directories, system sbin helper
  directories (`/usr/local/sbin`, `/usr/sbin`, `/sbin`), and input method
  variables. The system helper PATH repair is applied both before and after
  the user's `~/.config/salmon-desktop/env` override, so per-machine env files
  can add custom paths without accidentally hiding desktop management helpers.
  Those environment values are also imported into user systemd/dbus activation,
  including the repaired PATH, both before labwc starts and again from labwc
  autostart after `WAYLAND_DISPLAY`/`DISPLAY` are available, so portal
  backends, launched apps, input methods, and
  freedesktop desktop-file discovery see the same session context. The
  installed Wayland session entry includes Name, Exec, TryExec, Type, and
  DesktopNames fields and is checked by the desktop doctor/package verifier.
- Window management: labwc provides real external window management, Alt-Tab,
  close-window, Super and Ctrl+Alt terminal shortcuts, files/browser
  shortcuts, volume/microphone/media-player keys, brightness keys, lock, sign
  out, suspend key with `systemctl`/`loginctl` fallback, screenshot shortcuts,
  four named workspaces, workspace
  switching/move-window bindings, snap-left/right, maximize,
  minimize, show-desktop, fullscreen, Alt+F4 close-window,
  interactive move/resize shortcuts,
  Alt+Space client menu, and a labwc root fallback menu for
  terminal/files/browser/workspaces,
  reconfigure, lock, and sign out. Quick settings exposes the four Salmon
  workspaces, lets users switch or send the focused window to a workspace via
  the existing labwc Super+number bindings, and records Salmon-initiated
  switches as best-effort active workspace state. Salmon validates workspace
  actions against that same four-workspace model, and a test guards that the
  packaged labwc workspace names stay aligned with Salmon's quick-settings
  labels. The dock can also detect and focus pinned external app windows for
  Files, Browser, Terminal, and System Settings through `wlrctl` when the
  compositor exposes foreign-toplevel management.
  When the installed `wlrctl` supports `toplevel list`, Salmon's window strip
  also includes external windows and can focus/minimize/maximize/fullscreen/close
  them through the same foreign-toplevel interface. For external windows with
  identical app-id/title pairs, Salmon marks the row as a duplicate match and
  disables strip actions, including focus, that `wlrctl` cannot target
  uniquely.
- Salmon app windows: Mail, Calendar, Tasks, Home, Contacts, and Settings open
  as separate Tauri windows from the desktop shell; the dock shows running
  Salmon windows and provides focus/minimize/maximize/fullscreen/close
  controls.
- Screenshots: Print and Shift+Print call the bundled `salmon-screenshot`
  helper for full-screen and area screenshots, and quick settings now exposes
  the same full/area screenshot actions for discoverability. Captures are saved
  to the user's XDG Pictures directory under `Screenshots` (via
  `xdg-user-dir PICTURES`, with `~/Pictures` fallback) and rely on `grim` plus
  `slurp` for region select. Both the packaged helper and Salmon's Rust
  fallback report a clear failure when `grim` or `slurp` is missing, avoid
  overwriting an existing screenshot taken in the same second, accept only the
  known `full` and `select` capture modes, and copy the saved PNG to the
  Wayland clipboard through `wl-copy` when available.
- Desktop management: the shell lists files from the user's XDG Desktop
  directory, opens files/folders through the system opener, supports desktop
  context menus, new folders, new blank documents, rename, copy path, refresh,
  move to trash, opening the trash view, and emptying trash. The desktop icon
  grid renders the full Desktop directory listing instead of truncating after a
  fixed item count, and scrolls when the user's desktop contains more files
  than fit on screen. File/folder/volume/link opening now uses the standard
  Linux opener path with `gio open` first and `xdg-open` fallback, so default
  applications and portal-aware handlers remain in charge. Opening from the
  desktop UI is constrained to the resolved XDG Desktop directory or its
  direct entries, while still allowing desktop symlink entries to open as
  desktop items instead of treating their target path as the managed item. The desktop
  directory is resolved through `xdg-user-dir DESKTOP` and
  `~/.config/user-dirs.dirs` before falling back to `~/Desktop`/`~/桌面`, so
  localized or customized Desktop paths are preserved even before Salmon
  creates missing directories. New desktop folders/documents avoid clobbering
  existing names, and document-name de-duplication preserves extensions in the
  expected desktop-manager style (`name 2.txt` rather than `name.txt 2`).
  Renaming a desktop item to its current name is treated as a no-op success
  instead of surfacing a false "target exists" error.
  The labwc session also starts a compositor-level `swaybg` background when
  one is not already running, so the desktop has a stable fallback behind
  Salmon's own WebView wallpaper without stacking duplicate background
  processes. Salmon also provides a desktop appearance panel for choosing built-in wallpaper
  variants or a local image file, selecting image fit mode, choosing
  system/dark/light desktop theme, choosing a Salmon-compatible accent color,
  and scheduling automatic built-in wallpaper rotation. Those appearance
  choices persist in the shared app settings DB while preserving the AI
  desktop layout and live Salmon surfaces. Dark/light shell theme changes also
  sync the common GNOME/portal `org.gnome.desktop.interface color-scheme`
  preference so GTK apps and portal-aware apps can pick up the session's
  color preference. Wallpaper-fit, shell-theme, and accent enum values are
  normalized before storing or restoring, so harmless outer whitespace in a
  saved setting does not break appearance startup while unknown values still
  fail closed. The appearance panel also discovers installed GTK, icon, and
  cursor themes from the normal user and system theme directories and applies
  the selected values through `org.gnome.desktop.interface` gsettings, so
  external GTK/portal-aware apps can follow the chosen desktop styling without
  changing Salmon's AI shell layout. It also lists installed fontconfig
  families through `fc-list`, lets users choose interface, document, and
  monospace font families, and exposes common text-scaling factors through the
  same GNOME interface settings while keeping Salmon's own AI shell typography
  stable. Font-family kind values are normalized and restricted to the three
  exposed slots before applying gsettings changes. The package explicitly
  depends on
  `gsettings-desktop-schemas`, and the desktop doctor verifies the
  `org.gnome.desktop.interface` schema used by these handoffs.
- Clipboard: the package now requires `cliphist` because Salmon's native
  quick-settings clipboard panel depends on `cliphist list/decode` for text
  and image history. The session starts a Wayland clipboard watcher with
  `cliphist`, with `clipman` kept only as a best-effort fallback for custom
  non-packaged environments, and checks for an existing Salmon clipboard
  watcher before spawning another one, so copied text/images persist after the
  source app exits and can be restored through `cliphist decode | wl-copy`.
  Restore actions recheck the current `cliphist list` result first, so the
  quick-settings panel only decodes history rows it actually listed.
- Browser handoff: Super+B, the labwc fallback Browser menu item, and Salmon's
  dock/launcher Browser tile use the bundled `salmon-open-browser` helper
  rather than a hard-coded search URL. The helper respects `$BROWSER`, then the
  XDG default browser desktop entry through `xdg-settings`/`gtk-launch`, then
  common browser binaries, with a neutral `example.com` URL only as a final
  fallback when no browser command can be launched directly. The Debian package
  and doctor now explicitly cover the `xdg-settings` and `gtk-launch` commands
  used by this default desktop-entry path.
- File-manager handoff: Super+F, the labwc fallback Files menu item, and
  Salmon's dock/launcher Files tile use the bundled `salmon-open-files` helper
  rather than forcing Nautilus. The helper opens the user's home directory
  through the XDG default `inode/directory` desktop entry when available,
  falls back to `xdg-open`, and only then tries common file-manager binaries.
  The packaged baseline also verifies `xdg-mime` and `gtk-launch`, so the
  default file-manager desktop entry path is available after install.
- Terminal handoff: Super+T, Super+Return, Ctrl+Alt+T, the labwc fallback
  Terminal menu item, and Salmon's Terminal dock/launcher action use the
  bundled `salmon-open-terminal` helper, which respects `$TERMINAL`, then the
  distro's `x-terminal-emulator` alternative, before falling back to the
  packaged `foot` terminal and other common terminal emulators. Freedesktop
  `Terminal=true` launcher entries use the same helper for their command
  execution path, while preserving per-entry `Path` working directories.
- Launcher: the app launcher shows Salmon entries plus installed freedesktop
  `.desktop` applications from user, system, Flatpak, and Snap application
  directories, including nested application subdirectories whose desktop IDs
  are derived from their relative path, supports live filtering, hides entries
  without a usable Exec command, missing TryExec binary, or incompatible
  OnlyShowIn/NotShowIn desktop visibility, and launches the first app match on
  Enter before falling back to Salmon search. It prefers `gtk-launch`, with a
  manual fallback that handles quoted Exec arguments, spaces in paths,
  Terminal=true entries, per-entry Path working directories, nested desktop
  IDs, and standard freedesktop Exec field codes. The launch command enforces
  the same visibility and `TryExec` checks as the launcher list before handing
  an entry to `gtk-launch`, so hidden helper desktop files cannot be started
  through the launcher API. Built-in launcher tiles are limited to actionable
  Salmon/system entries; non-functional placeholders are not shown.
- Status bar: the top bar surfaces network, volume/mute, Bluetooth,
  battery/charging, brightness, input method, clock/calendar, quick settings,
  notifications, power/session actions, and system tool entry points for
  printers, VPN/network connections, accessibility, and system information.
  Quick-settings hardware actions are validated against a strict shared action
  set for volume, microphone mute, brightness, input method, Wi-Fi, and
  Bluetooth toggles before any helper command is invoked. System tool handoffs
  likewise validate against a strict set of known desktop surfaces before
  launching any settings helper. The top-bar UI now routes those handoffs and
  common hardware/session controls through shared feedback paths, so missing
  helpers or unsupported system settings apps surface an inline message instead
  of failing silently.
  The clock popover includes a month calendar, next Salmon calendar item from
  the Brief snapshot, Activities handoff, and a date/time settings entry.
  The power panel reads Linux power-supply details from sysfs, showing AC
  state, battery percentage/status, rough remaining or charging time when
  kernel energy/power counters are available, exposes supported
  power-profiles-daemon modes through `powerprofilesctl`, normalizes profile
  actions to power-saver/balanced/performance before checking the current
  supported list, plus lock/suspend and system power settings shortcuts.
  Packaging requires WirePlumber's `wpctl` for native output/input device
  listing and switching, and also includes `pulseaudio-utils` so `pactl`
  remains available as a compatibility fallback for volume status/keys. The
  compositor media-key bindings now try `wpctl` first but still fall through
  to `pactl` when `wpctl` is installed but cannot handle the current audio
  session, matching the Rust quick-settings fallback behavior.
  Brightness keys use the bundled `salmon-brightness` helper, which prefers
  `brightnessctl --class=backlight` before falling back to the default
  brightnessctl device, so display brightness control is not confused by
  keyboard LED or platform LED devices.
  Packaging also guarantees a sound settings surface
  (`pavucontrol | gnome-control-center`) for the top-bar sound settings
  handoff.
  The package also guarantees at least one general desktop settings surface
  (`gnome-control-center | systemsettings | xfce4-settings | lxqt-config`),
  and Salmon's settings handoffs now try common GNOME, KDE, Xfce, LXQt, MATE,
  and Cinnamon tools for power, date/time, accessibility, and system
  information instead of assuming a GNOME-only install. Network, sound,
  input, display, Bluetooth, printer, and VPN settings handoffs likewise try
  common GNOME/KDE/Xfce/LXQt/Cinnamon-specific panels where those desktops
  expose them, before falling back to generic settings managers.
  The notification center now aggregates Salmon's own desktop work reminders
  from the Brief snapshot (upcoming event, unread mail, due/overdue tasks, and
  pending AI recommendations), provides per-row navigation, and lets the user
  clear the current batch locally without deleting the underlying data; new
  work items reappear as a fresh batch. It also exposes a system notification
  do-not-disturb toggle for the active `mako` or `dunst` daemon.
  Quick settings can also adjust volume/mute state, list and switch PipeWire
  audio outputs and microphone inputs through `wpctl`, with default-device
  switch actions rechecking that the target id is still present in the current
  Sink/Source list before invoking `wpctl set-default`. It can also toggle microphone mute,
  toggle Wi-Fi through NetworkManager, scan nearby Wi-Fi networks through `nmcli`, connect to open or
  passphrase-protected visible networks after rechecking the current Wi-Fi
  list, toggle Bluetooth power through `bluetoothctl`,
  and list/connect/disconnect known Bluetooth devices while leaving pairing
  and trust flows to the system Bluetooth settings app. Bluetooth
  connect/disconnect actions recheck the current `bluetoothctl devices` list
  before running, so the quick-settings panel only operates devices known to
  the session. It also exposes a
  night-light control backed by `gammastep`, with persistent enable state and
  color temperature restored when the Salmon shell starts.
- Printing: quick settings reads CUPS printer state through `lpstat`, shows
  configured printers, default-printer status, enabled/disabled state, and
  queued job counts. It can pause/enable printers through CUPS helpers and
  cancel queued jobs for a printer through `cupsenable`, `cupsdisable`, and
  `cancel`; those action paths recheck the current CUPS printer list before
  running, so stale or arbitrary printer names are rejected. The package
  depends on `cups-client` and the desktop doctor now verifies those action
  helpers alongside `lpstat`, including the common `/usr/sbin` CUPS helper
  locations when they are not on a regular user's PATH.
  Add/remove/configuration flows remain delegated to the installed printer
  settings app.
- VPN: quick settings reads NetworkManager connections through `nmcli`, shows
  configured VPN profiles, active state, and the active interface when
  available. It can connect or disconnect configured VPN profiles through
  `nmcli connection up/down`, and the action path rechecks that the selected
  connection is a configured VPN before invoking NetworkManager, while keeping
  VPN creation/editing delegated to the system network settings app.
- Accessibility: quick settings reads common desktop accessibility state
  through `gsettings`, including screen reader, high contrast, sticky keys,
  slow keys, and reduced animation. It can toggle those common features
  directly through `gsettings`, with feature identifiers normalized to the
  exposed quick-settings set before any write, while keeping full
  configuration delegated to the system accessibility settings app. The
  package and desktop doctor cover
  the GNOME desktop interface and accessibility schemas those controls use.
- System tray: the session starts a tray-only Waybar instance with a bundled
  transparent Salmon-style config, giving StatusNotifier/AppIndicator
  applications a host without replacing Salmon's own top bar. The autostart
  script checks for an existing Salmon tray host before spawning Waybar again,
  so repeated session startup does not stack duplicate tray bridges.
- Input methods: session startup prefers fcitx5, falls back to IBus, imports
  a complete GTK/Qt/XIM environment group into systemd/dbus, autostarts the
  selected daemon even when only one input-method variable was inherited from
  the display manager, and binds Super+Space to `salmon-input-toggle`. The
  autostart script checks for an existing `fcitx5` or `ibus-daemon` process
  before starting the selected daemon, avoiding duplicate input-method
  instances when the session startup path is re-entered. The desktop doctor
  now fails incomplete mixed input-method environments instead of accepting a
  single variable as sufficient, and treats the input-method daemon, switch
  command, and settings tool as baseline checks because the package declares
  them as core desktop dependencies. The top bar reads the current
  fcitx/IBus engine when available instead of only showing the configured
  input-method framework. Quick settings can list IBus engines and switch
  directly; the IBus Super+Space fallback toggles back to the first XKB layout
  reported by IBus instead of assuming a US keyboard, preserving non-US
  keyboard layouts. It can also list configured Fcitx5 engines from the user's
  profile and switch them through `fcitx5-remote -s`; direct switch actions
  recheck that the requested engine is present in the current quick-settings
  engine list before invoking fcitx/IBus. The full configuration tool is kept
  available for adding/removing engines. Packaging includes an input-method
  configuration-tool dependency alternative (`fcitx5-config-qt | ibus`) and
  the desktop doctor checks for a usable input-method settings command,
  including both common Fcitx5 config-tool binary names.
- Portals and notifications: autostart brings up xdg-desktop-portal from the
  usual `/usr/libexec`, `/usr/lib`, or PATH locations, plus a notification
  daemon and a Polkit authentication agent when installed, while skipping
  portal, notification, and Polkit startup when an equivalent process is
  already running;
  packaging depends on portal, notification, and Polkit agent implementations,
  and the desktop doctor now treats missing notification daemon/control and
  Polkit agent pieces as baseline failures rather than optional warnings.
  When `mako` is used, Salmon starts it with a runtime config that preserves
  the user's mako config and appends a `do-not-disturb` mode that hides
  notifications, so the top-bar toggle has a real daemon-side effect. The
  notification DND command now targets the currently detected daemon instead
  of trying every installed control tool, and verifies after each toggle that
  the same daemon reports the requested DND state before reporting success to
  the top bar.
  SalmonApp ships its own `salmonapp-portals.conf` plus a matching
  `SalmonApp-portals.conf` case alias, so the Salmon/wlroots session prefers
  the wlr backend for screenshot/screencast/remote-desktop portals and gtk for
  file chooser, app chooser, print, notification, and settings portals even if
  a distro's portal lookup preserves the case of `XDG_CURRENT_DESKTOP`.
  Packaging depends on both `xdg-desktop-portal-wlr` and
  `xdg-desktop-portal-gtk`, and the desktop doctor verifies both backend
  implementations through the standard distro service/backend locations,
  matching the configured portal preference file.
- Removable media: the package explicitly depends on `util-linux` for
  `lsblk`, `udisks2` for `udisksctl`, and starts `udiskie` on top of UDisks
  when available and not already running, with tray UI disabled,
  notifications enabled, and `xdg-open` as the file-manager handoff for
  removable drives. Quick settings also lists useful mounted/removable block
  volumes from `lsblk` and provides native mount, open, unmount, and
  safe-remove/power-off actions through `udisksctl` plus the system opener.
  Mount, open, and unmount actions are constrained to devices and mountpoints
  currently reported by the storage volume list, mounted root/system volumes
  are not exposed to the quick-settings unmount path, and safe-remove remains
  limited to removable devices.
- Idle/security: swayidle locks the session after idle timeout and before
  sleep, then uses wlopm to power off outputs during longer idle and power them
  back on when activity resumes. Autostart skips starting another `swayidle`
  when one is already present. Lock, suspend, reboot, poweroff, and sign-out
  actions are centralized through the bundled `salmon-session-action` helper,
  and the Tauri session command validates against the same strict action set,
  so compositor keybindings, the labwc fallback menu, idle hooks, and the
  Salmon top bar share the same `swaylock`/`gtklock`/`loginctl` and
  `systemctl`/`loginctl` fallback behavior. The labwc root fallback menu
  exposes lock, suspend, reboot, poweroff, and sign-out actions for cases
  where the Salmon WebView is unavailable.
- Display hotplug: the session starts kanshi when the user provides
  `~/.config/salmon-desktop/kanshi` or `~/.config/kanshi/config`, enabling
  wlroots output profiles for docked/undocked monitor layouts, while avoiding
  duplicate `kanshi` processes if one is already running. The top bar's quick
  settings panel reads current outputs through `wlr-randr --json`,
  shows mode/scale/transform/position state, lets users choose an advertised
  output mode, scale, and transform through `wlr-randr`, provides a draggable
  monitor layout editor backed by `wlr-randr --pos`, can enable/disable
  non-last outputs, and rechecks the current output list before running
  output toggle, position, scale, or transform actions. It can save the current
  layout into
  `~/.config/salmon-desktop/kanshi`, and can list/apply/rename/delete
  Salmon-saved layouts while leaving hand-written kanshi profiles untouched.
  Applying a saved Salmon layout now preflights every output line against the
  current `wlr-randr` output list, rejects modes not advertised by that output,
  rejects unknown profile output options, and refuses profiles that would leave
  no output enabled.
  Saved layout names are de-duplicated against the existing Salmon-managed
  profiles, so repeated saves in the same second do not create ambiguous
  `kanshi` profile names.
  After saving, renaming, or deleting a Salmon layout, Salmon sends SIGHUP to
  an already-running kanshi process so it rereads the config immediately, or
  starts kanshi with the Salmon config when it is not already running.
  `wdisplays`, GNOME Display, or arandr remain available for advanced display
  settings.
- Display comfort: the Debian package depends on `gammastep`, the desktop
  doctor verifies it, and quick settings can toggle a persistent warm-screen
  night-light mode with an adjustable color temperature.
- Packaging: the Debian package includes the session entry, labwc config,
  shell launcher, screenshot helper, desktop doctor, and dependencies for the
  desktop baseline. `salmon-desktop-doctor` checks installed files, required
  commands, common optional desktop services, session environment, and labwc
  XML parsing. It now also checks that the session launcher starts labwc with
  the Salmon/wlroots identity, exports desktop discovery and complete input
  method environments, that autostart imports environment into dbus/systemd,
  duplicate-guards baseline daemons, and that the tray-only Waybar and portal
  preference configs contain the expected desktop integration entries. When
  run from inside a real SalmonApp Desktop Wayland session, the doctor also
  verifies the compositor, Salmon shell, portals, notification daemon, tray
  host, clipboard watcher, Polkit agent, UDisks helper, idle manager, input
  method daemon, and display-profile helper process state; outside that
  session it skips these runtime checks with a warning. The
  package verifier also asserts the critical desktop
  dependency set for XWayland, wlroots window/output control, tray hosting,
  XDG user directories, dbus activation environment updates, portals,
  fontconfig, clipboard, trash, screenshots,
  UDisks/removable media, NetworkManager, CUPS, input methods, notification
  daemons, WirePlumber/PulseAudio audio tools, sound settings alternatives,
  Polkit agent alternatives, idle/lock/display-profile helpers, brightness,
  night-light, media-key and power-profile helpers, Bluetooth, notification
  helper binaries, display/network/printer settings alternatives, CUPS queue
  action helpers, gsettings desktop schemas, and a general system settings
  surface.

## Still Requires Runtime Verification

- Login from GDM into the SalmonApp Desktop session and verify labwc loads the
  intended config instead of falling back to defaults.
- Confirm the GDM/SDDM session chooser shows "SalmonApp Desktop" only when
  `/usr/bin/salmon-session` exists, and that the installed
  `salmon-shell.desktop` entry includes the GDM-required Exec, TryExec, Type,
  and DesktopNames fields.
- Run `salmon-desktop-doctor` after install and resolve any FAIL items before
  judging the session.
- Confirm Alt-Tab, the Salmon window strip, and labwc window focus behavior
  with external apps, not only Salmon Tauri windows. Verify the target distro's
  `wlrctl toplevel list` output is available and parseable, and verify
  duplicate external windows are labeled without offering ambiguous close or
  minimize/maximize/fullscreen controls.
- Confirm Super+1..4 switches the four Salmon workspaces, Super+Shift+1..4
  sends focused windows to workspaces without following them, Super+PageUp and
  Super+PageDown move between adjacent workspaces, and Super+arrow/D/F11/M/R
  window shortcuts plus Alt+F4 close work with both Salmon and external windows, including
  Super+D show-desktop toggle/restore. Confirm the quick settings workspace
  panel can switch workspaces and send the focused window to a workspace; note
  that the active marker is best-effort until a compositor workspace-state
  protocol or direct labwc IPC is available.
- Confirm Alt+Space opens the compositor client menu, and right-clicking the
  compositor root surface when Salmon's WebView is unavailable opens the labwc
  fallback menu with terminal/files/browser/workspace/session actions.
- Confirm at least one X11-only or forced-X11 app can open through XWayland.
- Confirm the notification daemon displays Salmon/Tauri notifications.
- Confirm the clock/calendar popover highlights today, shows a valid month
  grid, opens the Salmon calendar view, opens system date/time settings, and
  shows the next Brief calendar item when one is available.
- Confirm the Salmon notification center lists mail/calendar/task/AI reminder
  rows from real accounts, opens the correct Salmon app window from each row,
  and that clearing the current batch does not suppress newly arrived items.
  Confirm the notification center's do-not-disturb toggle pauses/resumes
  `dunst` or activates/removes mako's `do-not-disturb` mode.
- Confirm StatusNotifier/AppIndicator tray icons appear in the tray-only
  Waybar host and remain clickable without blocking Salmon top-bar controls.
- Confirm privileged operations such as network changes, printer setup, disk
  mounting, or system settings produce a Polkit authentication prompt when
  needed.
- Confirm removable USB storage automounts through UDisks/udiskie, encrypted
  volumes request credentials through Polkit as needed, and the mounted volume
  can open in the configured file manager. Confirm the quick settings storage
  panel lists mounted/removable volumes, can manually mount an unmounted USB
  volume, open the mounted path, unmount it, and safely remove/power off a
  removable device without leaving stale UI state.
- Confirm xdg-desktop-portal works for file pickers, screenshots/screencopy,
  and app integration in the Salmon session, including that
  `salmonapp-portals.conf` or its `SalmonApp-portals.conf` case alias is
  selected for `XDG_CURRENT_DESKTOP=SalmonApp:wlroots`.
  Confirm user systemd/dbus activation receives `XDG_DATA_DIRS` and
  `XDG_CONFIG_DIRS`, and that Flatpak/Snap exported `.desktop` files are
  visible to both the launcher and dbus-activated apps. Confirm the gtk portal
  backend is available for file chooser/app chooser/print/settings portals and
  the wlr backend is available for screenshot/screencast/remote-desktop
  portals.
- Confirm fcitx5 or IBus can actually input Chinese/Japanese/Korean text inside
  WebKitGTK, terminal, and external GTK/Qt apps, and confirm Super+Space toggles
  between English and the configured non-English engine. Confirm the quick
  settings input-method panel lists configured IBus/Fcitx5 engines, switches
  engines directly, updates the top-bar label, and opens the full input-method
  configuration tool for add/remove flows (`fcitx5-configtool`,
  `fcitx5-config-qt`, `ibus-setup`, or the system keyboard settings fallback).
- Confirm volume, microphone mute, and media-player keys through `wpctl`/`pactl`
  and `playerctl`, brightness keys, Ctrl+Alt+T terminal launch, lock, suspend,
  sign out, idle lock, idle display power-off/resume, screenshot shortcuts, and
  quick settings full/area screenshot actions on target hardware. Confirm
  screenshots are written under the localized/custom XDG Pictures directory,
  not only hard-coded `~/Pictures`, repeated screenshots do not overwrite each
  other, and the latest screenshot can be pasted from the clipboard when
  `wl-copy` is available.
- Confirm the quick settings night-light control can apply/reset gamma through
  `gammastep`, persists enabled state and temperature, and restores the warm
  color temperature after the Salmon shell restarts.
- Confirm the quick settings power panel shows battery/AC status accurately on
  laptop and desktop hardware, including charging/discharging/full states and
  the fallback behavior when time estimates are unavailable. Confirm supported
  power profiles are listed through `powerprofilesctl`, switching between
  power-saver/balanced/performance works when the hardware exposes them, and
  unsupported profiles are not shown.
- Confirm quick settings lists PipeWire audio outputs and microphone inputs,
  switches default output/input through `wpctl`, toggles microphone mute, and
  keeps volume/mute media keys in sync with the top-bar status.
- Confirm quick settings can toggle Wi-Fi and Bluetooth power, list nearby
  Wi-Fi networks, connect to an open network and a WPA/WPA2 passphrase network,
  list known Bluetooth devices, connect/disconnect a paired Bluetooth device,
  and that disabled hardware or missing radio devices fail without trapping
  the user.
- Confirm move-to-trash behavior across filesystems and when `gio trash` is
  the selected backend. Confirm the desktop context menu can open and empty
  trash through the installed trash backend.
- Confirm desktop context menus can create folders and blank documents in the
  XDG Desktop directory, avoid clobbering existing names, refresh the icon
  grid, reject invalid filenames, and keep all desktop entries reachable when
  the directory contains more files than fit in the visible icon area. Confirm
  opening desktop files, folders, URLs, and mounted volumes uses the expected
  default app through `gio open` or `xdg-open`, and reports failure cleanly if
  no opener is available. Confirm localized/custom XDG Desktop directories
  from `xdg-user-dir DESKTOP` or `~/.config/user-dirs.dirs` are used instead
  of incorrectly creating a separate `~/Desktop`.
- Confirm clipboard contents persist after closing the source application, and
  confirm image copy/paste works when `cliphist` is installed. Confirm the
  quick settings clipboard panel lists recent text/image entries and restores a
  selected entry to the clipboard for pasting into WebKitGTK, terminal, and
  external GTK/Qt apps.
- Confirm the launcher lists normal system apps plus Flatpak/Snap-installed
  apps, hides broken `.desktop` entries with missing `TryExec` or incompatible
  `OnlyShowIn`/`NotShowIn`, and can launch apps whose Exec line contains
  quoted paths, spaces in arguments, Terminal=true, Path working directories,
  nested application-directory IDs, or standard `%f/%F/%u/%U/%i/%c/%k` field
  codes.
- Confirm the compositor background appears behind windows if the Salmon shell
  is restarted or temporarily unmapped.
- Confirm built-in and user-image desktop appearance choices survive a Salmon
  shell restart and a full SalmonApp Desktop session logout/login, and that
  missing/deleted image files fall back cleanly to a built-in wallpaper.
  Confirm wallpaper fit, system/dark/light theme, and accent color choices
  persist across restart/login and remain legible against the top bar,
  launcher, dock, appearance panel, and AI desktop widgets. Confirm the
  wallpaper rotation interval persists and rotates built-in wallpapers without
  overriding a selected local image. Confirm dark/light theme changes update
  the desktop shell and the `org.gnome.desktop.interface color-scheme`
  preference. Confirm installed GTK, icon, and cursor themes are listed from
  user/system theme directories, can be applied through the appearance panel,
  survive logout/login via gsettings, and fail cleanly for missing theme
  packages. Confirm installed proportional and monospace font families are
  listed, can be applied to GTK/portal-aware apps, text scaling updates
  external app UI size, and invalid or removed font families fail cleanly
  without changing Salmon's own desktop typography.
- Confirm high-DPI defaults on the target display and user override behavior
  through `~/.config/salmon-desktop/env`.
- Confirm kanshi applies expected monitor profiles when an external display is
  connected or disconnected.
- Confirm the quick settings display panel lists internal/external outputs
  through `wlr-randr`, refuses to turn off the final active output, can toggle
  an external output, can drag a monitor tile to update its `wlr-randr`
  position, can apply an advertised resolution/refresh mode, can adjust scale,
  can rotate/flip through supported transforms, saves the current layout as a
  kanshi profile, can delete Salmon-saved profiles, can apply and rename
  Salmon-saved profiles, and still opens an advanced display settings tool.
- Confirm the quick settings printer panel lists CUPS printers through
  `lpstat`, marks the default printer, shows queued jobs, handles an empty
  printer setup cleanly, can pause/enable a printer, can cancel queued jobs
  for a printer, and opens the printer configuration tool.
- Confirm the quick settings VPN panel lists active NetworkManager VPN
  connections, handles configured-but-disconnected and empty VPN setups
  cleanly, can connect/disconnect a configured VPN profile with appropriate
  Polkit/secret prompts when needed, and opens the VPN/network configuration
  tool.
- Confirm the quick settings accessibility panel reflects the target desktop's
  screen reader, high contrast, keyboard accessibility, and reduced-animation
  settings through `gsettings`, can toggle screen reader, high contrast,
  sticky keys, slow keys, and reduced animation, restores the prior GTK theme
  when high contrast is disabled, and opens the accessibility configuration
  tool.

## Known Remaining Gaps

- External windows are listed through `wlrctl toplevel list` when that command
  is available, but the protocol surface exposed by `wlrctl` is still weaker
  than a native taskbar client: duplicate windows with the same app-id/title
  cannot be uniquely targeted. Salmon now detects those duplicate matches and
  avoids ambiguous strip actions including focus, but
  close/minimize/maximize/fullscreen/focus behavior still depends on the
  installed `wlrctl` and compositor support.
- Workspace switching is exposed in quick settings through the same
  Super+number labwc bindings used by the keyboard shortcuts. Salmon records
  the workspace after its own UI switches, but direct keyboard/compositor
  switches cannot yet be observed as authoritative active state without a
  workspace-state protocol client or labwc IPC.
- System tray hosting is provided through a tray-only Waybar bridge rather
  than a native React/Tauri StatusNotifier implementation, so the visual
  integration is intentionally small and must be runtime-checked against apps
  with complex tray menus.
- Display configuration now has a native Salmon status/toggle surface,
  advertised mode selection, scale selection, transform selection, a draggable
  position editor, and saved-profile apply/rename/delete. Advanced display
  tools remain available for vendor-specific or compositor-specific settings
  beyond wlroots output management.
- Desktop appearance supports persistent built-in wallpaper variants, local
  image wallpapers, wallpaper fit modes, system/dark/light shell theme,
  accent color controls, scheduled rotation across built-in wallpapers, and
  installed GTK/icon/cursor theme selection, system font-family selection, and
  text scaling through gsettings. Theme/font package installation, Qt-specific
  theme engines, detailed fontconfig rules, and detailed toolkit-specific
  appearance settings remain delegated to system appearance tools.
- Printer configuration, VPN configuration, and detailed accessibility setup
  are delegated to installed system settings tools rather than full native
  Salmon Desktop setup panels. Printer status, pause/enable, and queue
  cancellation are now native in quick settings, VPN visibility and
  connect/disconnect are now native, and common accessibility toggles are now
  native, but adding/removing printers, creating/editing VPN profiles, and
  changing detailed accessibility settings still belong to system tools.
- Storage volume discovery and mount/open/unmount are native in quick
  settings, and removable devices can be safely powered off through
  `udisksctl`. Formatting, partition editing, encrypted-volume setup, and
  detailed disk management remain delegated to UDisks/Polkit and system disk
  utilities.
