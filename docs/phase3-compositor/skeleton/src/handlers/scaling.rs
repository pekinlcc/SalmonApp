// fractional-scale-v1 + viewporter: HiDPI scaling.
//
// fractional-scale-v1: clients tell the compositor "draw me at scale
// factor 1.25" (or 1.5, 1.75, etc). Compositor honours via the
// `preferred_scale` event per surface. Without this, HiDPI clients on
// laptops see either tiny UI (integer scale 1) or blurry UI (integer
// scale 2 downscaled).
//
// viewporter: lets clients say "this 1200x800 surface should occupy
// 600x400 logical pixels" — used by video players (mpv, gstreamer)
// for sub-pixel-accurate positioning. fractional-scale uses
// viewporter under the hood to deliver fractional-pixel surfaces.
//
// Both are mostly handler-free — Smithay implements them as state
// objects with delegate macros. We just need to declare the globals
// and pick a per-output scale.

use smithay::{
    delegate_fractional_scale, delegate_viewporter,
    wayland::{
        fractional_scale::{FractionalScaleHandler, FractionalScaleManagerState},
        viewporter::ViewporterState,
    },
};

use crate::state::SalmonState;

impl FractionalScaleHandler for SalmonState {
    fn new_fractional_scale(
        &mut self,
        surface: smithay::reexports::wayland_server::protocol::wl_surface::WlSurface,
    ) {
        // Send the preferred scale to the new surface. v0 uses the
        // active output's scale (single-monitor). Multi-monitor needs
        // to send the scale of whichever output the surface lands on.
        let scale = self
            .space
            .outputs()
            .next()
            .map(|o| o.current_scale().fractional_scale())
            .unwrap_or(1.0);
        // Smithay 0.7: `with_fractional_scale` takes `&SurfaceData`, not
        // `&WlSurface`. Bridge via `compositor::with_states`, which gives
        // us the surface's data block.
        smithay::wayland::compositor::with_states(&surface, |states| {
            smithay::wayland::fractional_scale::with_fractional_scale(states, |fs| {
                fs.set_preferred_scale(scale);
            });
        });
    }
}
delegate_fractional_scale!(SalmonState);
delegate_viewporter!(SalmonState);

/// Construct the manager states. Called from state.rs::new().
#[allow(dead_code)]
pub fn build_states(
    dh: &smithay::reexports::wayland_server::DisplayHandle,
) -> (FractionalScaleManagerState, ViewporterState) {
    (
        FractionalScaleManagerState::new::<SalmonState>(dh),
        ViewporterState::new::<SalmonState>(dh),
    )
}
