// Central compositor state. Every handler trait we implement attaches
// to `SalmonState` via Smithay's `delegate_*!` macros (see handlers/).
//
// The Wayland protocol model: clients send requests → Smithay routes
// them to the right handler → handler mutates this state → next event
// loop tick re-renders.
//
// Field grouping mirrors the protocols we serve. Add a new field when
// you add a new protocol; never let handler logic reach into another
// handler's state directly — go through methods on SalmonState.

use std::ffi::OsString;
use std::time::Instant;

use smithay::{
    desktop::{PopupManager, Space, Window},
    input::{Seat, SeatState},
    reexports::{
        calloop::{LoopHandle, LoopSignal},
        wayland_server::{Display, DisplayHandle},
    },
    wayland::{
        compositor::{CompositorClientState, CompositorState},
        foreign_toplevel_list::ForeignToplevelListState,
        input_method::InputMethodManagerState,
        output::OutputManagerState,
        selection::data_device::DataDeviceState,
        shell::{
            wlr_layer::WlrLayerShellState,
            xdg::{decoration::XdgDecorationState, XdgShellState},
        },
        shm::ShmState,
        socket::ListeningSocketSource,
        text_input::TextInputManagerState,
    },
};

use crate::handlers::keyboard_shortcuts::SuperKeyTracker;

/// Per-client state stored alongside Smithay's CompositorClientState.
/// Currently empty; future protocols (e.g. security-context) bolt extra
/// fields on here. Keep it `Default`-able so client init stays trivial.
#[derive(Default)]
pub struct ClientState {
    pub compositor_state: CompositorClientState,
}

impl smithay::reexports::wayland_server::backend::ClientData for ClientState {
    fn initialized(&self, _client_id: smithay::reexports::wayland_server::backend::ClientId) {}
    fn disconnected(
        &self,
        _client_id: smithay::reexports::wayland_server::backend::ClientId,
        _reason: smithay::reexports::wayland_server::backend::DisconnectReason,
    ) {
    }
}

/// The compositor.
///
/// Smithay's design has one big state struct that every handler delegates
/// into. Anvil (the reference compositor) does the same — see
/// https://github.com/Smithay/smithay/tree/master/anvil/src/state.rs
/// for the pattern this file mirrors.
pub struct SalmonState {
    pub start_time: Instant,
    pub display_handle: DisplayHandle,
    pub loop_handle: LoopHandle<'static, Self>,
    pub loop_signal: LoopSignal,

    // Wayland protocol state. Each handler trait we implement gets
    // its piece of state here.

    // Tier 1 — minimum-viable compositor.
    pub compositor_state: CompositorState,
    pub shm_state: ShmState,
    pub xdg_shell_state: XdgShellState,
    pub seat_state: SeatState<Self>,
    pub data_device_state: DataDeviceState,
    pub output_manager_state: OutputManagerState,

    // Tier 2 — daily-driver protocols.
    pub layer_shell_state: WlrLayerShellState,
    pub xdg_decoration_state: XdgDecorationState,
    pub text_input_manager_state: TextInputManagerState,
    pub input_method_manager_state: InputMethodManagerState,
    pub foreign_toplevel_list_state: ForeignToplevelListState,

    // Shell-level state (not Wayland-protocol state per se).
    pub super_key_tracker: SuperKeyTracker,

    // XWayland — populated after handlers::xwayland::launch_xwayland
    // runs and we receive the Ready event.
    #[cfg(feature = "xwayland")]
    pub xwm_socket: Option<smithay::xwayland::X11Surface>,

    // Desktop layer — windows + popups managed in Smithay's coordinate
    // space. Space tracks every Toplevel; PopupManager handles the
    // nested popup hierarchy (menus, tooltips). Layer surfaces are
    // tracked per-output via smithay::desktop::layer_map_for_output.
    pub space: Space<Window>,
    pub popups: PopupManager,

    // Single seat for v1 — multi-seat would mean multiple keyboards/
    // pointers acting independently. Nice-to-have, not v1.
    pub seat: Seat<Self>,

    // Socket the Wayland clients connect to. We expose its name in
    // $WAYLAND_DISPLAY so spawned children find it.
    pub socket_name: OsString,

    // Tracks the UI layer process (salmon-app spawned as a Wayland
    // client). None when --no-ui or before the child has connected.
    pub ui_pid: Option<u32>,
}

impl SalmonState {
    /// Construct the state + bind the listening socket. The Display is
    /// returned alongside so the caller can register its source on the
    /// event loop (we keep that wiring out of here to avoid leaking
    /// calloop generics into every handler signature).
    pub fn new(
        display: &mut Display<Self>,
        loop_handle: LoopHandle<'static, Self>,
        loop_signal: LoopSignal,
    ) -> anyhow::Result<(Self, ListeningSocketSource)> {
        let dh = display.handle();

        let compositor_state = CompositorState::new::<Self>(&dh);
        let shm_state = ShmState::new::<Self>(&dh, vec![]);
        let xdg_shell_state = XdgShellState::new::<Self>(&dh);
        let mut seat_state = SeatState::new();
        let data_device_state = DataDeviceState::new::<Self>(&dh);
        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&dh);

        let layer_shell_state = WlrLayerShellState::new::<Self>(&dh);
        let xdg_decoration_state = XdgDecorationState::new::<Self>(&dh);
        let text_input_manager_state = TextInputManagerState::new::<Self>(&dh);
        // Filter `|_| true` accepts any client as IME. v2 should
        // whitelist fcitx5 / ibus / nimf binaries.
        let input_method_manager_state =
            InputMethodManagerState::new::<Self, _>(&dh, |_| true);
        let foreign_toplevel_list_state = ForeignToplevelListState::new::<Self>(&dh);

        // Create the seat. The name matters for some clients (e.g.
        // libinput-named seats); "seat0" is the conventional default.
        let mut seat = seat_state.new_wl_seat(&dh, "seat0".to_string());
        // Bind the default xkb keymap. v2 will load a user-config keymap.
        let _ = seat.add_keyboard(Default::default(), 200, 25);
        let _ = seat.add_pointer();

        // Bind the socket. wayland_server picks $XDG_RUNTIME_DIR/$name;
        // we let it auto-assign (wayland-1, wayland-2, …) so a host
        // GNOME's wayland-0 stays untouched in nested mode.
        let listening = ListeningSocketSource::new_auto()
            .map_err(|e| anyhow::anyhow!("bind wayland socket: {e}"))?;
        let socket_name = listening.socket_name().to_os_string();
        tracing::info!(socket = ?socket_name, "wayland socket bound");

        Ok((
            Self {
                start_time: Instant::now(),
                display_handle: dh,
                loop_handle,
                loop_signal,
                compositor_state,
                shm_state,
                xdg_shell_state,
                seat_state,
                data_device_state,
                output_manager_state,
                layer_shell_state,
                xdg_decoration_state,
                text_input_manager_state,
                input_method_manager_state,
                foreign_toplevel_list_state,
                super_key_tracker: SuperKeyTracker::new(),
                #[cfg(feature = "xwayland")]
                xwm_socket: None,
                space: Space::default(),
                popups: PopupManager::default(),
                seat,
                socket_name,
                ui_pid: None,
            },
            listening,
        ))
    }
}
