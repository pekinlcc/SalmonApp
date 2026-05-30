// wl_compositor + wl_subcompositor + surface lifecycle.
//
// `commit` is called every time a client finishes a frame. We walk to
// the toplevel root and tell its Window to re-evaluate its state.
// PopupManager gets its own notification because popups are tracked
// separately from toplevels.

use smithay::{
    delegate_compositor,
    reexports::wayland_server::{protocol::wl_surface::WlSurface, Client},
    wayland::compositor::{
        get_parent, is_sync_subsurface, CompositorClientState, CompositorHandler,
        CompositorState,
    },
};

use crate::state::{ClientState, SalmonState};

impl CompositorHandler for SalmonState {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        if is_sync_subsurface(surface) {
            return;
        }
        let mut root = surface.clone();
        while let Some(parent) = get_parent(&root) {
            root = parent;
        }
        if let Some(window) = self
            .space
            .elements()
            .find(|w| w.toplevel().map(|t| t.wl_surface() == &root).unwrap_or(false))
            .cloned()
        {
            window.on_commit();
        }
        self.popups.commit(surface);
    }
}
delegate_compositor!(SalmonState);
