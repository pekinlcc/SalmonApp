// wlr-layer-shell-v1: panel surfaces that pin to screen edges.
//
// Critical for SalmonApp Desktop: this is the protocol salmon-app
// uses (when spawned with $SALMON_LAYER_SHELL=1, see ui_layer.rs)
// to anchor its full-screen UI as a layer surface BELOW any app
// windows. Other consumers: GNOME-style top bars (waybar), notification
// daemons (mako), wallpaper apps (swaybg).
//
// Layer ordering, top → bottom:
//   Overlay   — system modals, lock screens
//   Top       — fullscreen panels, on-screen keyboards
//   Bottom    — wallpaper-style backgrounds (where SalmonApp UI sits)
//   Background — solid colour fill behind everything
//
// We anchor salmon-app to Background or Bottom so real app windows
// composit above it.

use smithay::{
    delegate_layer_shell,
    desktop::LayerSurface,
    output::Output,
    reexports::wayland_server::protocol::wl_output::WlOutput,
    wayland::shell::wlr_layer::{
        Layer, LayerSurface as WlrLayerSurface, WlrLayerShellHandler, WlrLayerShellState,
    },
};

use crate::state::SalmonState;

impl WlrLayerShellHandler for SalmonState {
    fn shell_state(&mut self) -> &mut WlrLayerShellState {
        &mut self.layer_shell_state
    }

    fn new_layer_surface(
        &mut self,
        surface: WlrLayerSurface,
        wl_output: Option<WlOutput>,
        _layer: Layer,
        namespace: String,
    ) {
        tracing::info!(namespace = %namespace, "new layer surface");

        // Pick the target output — the first one we know about, or
        // the client-requested one if specified.
        let output: Option<Output> = wl_output
            .as_ref()
            .and_then(|w| Output::from_resource(w))
            .or_else(|| self.space.outputs().next().cloned());

        let Some(output) = output else {
            tracing::warn!("layer surface arrived with no output to attach to");
            return;
        };

        let layer_surface = LayerSurface::new(surface, namespace);
        if let Some(map) = smithay::desktop::layer_map_for_output(&output)
            .map_layer(&layer_surface)
            .err()
        {
            tracing::warn!(?map, "failed to map layer surface");
        }
    }

    fn layer_destroyed(&mut self, surface: WlrLayerSurface) {
        // Find the wrapping LayerSurface, then remove it from every
        // output's layer map.
        for output in self.space.outputs() {
            let mut map = smithay::desktop::layer_map_for_output(output);
            if let Some(ls) = map
                .layers()
                .find(|l| l.layer_surface() == &surface)
                .cloned()
            {
                map.unmap_layer(&ls);
            }
        }
    }
}
delegate_layer_shell!(SalmonState);
