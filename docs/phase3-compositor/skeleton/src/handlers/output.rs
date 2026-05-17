// wl_output + xdg-output-v1: monitor configuration.
//
// In nested mode there's exactly one "fake" output backed by the
// winit window. In TTY mode there's one per connected DRM CRTC.
// Either way, OutputManagerState handles the protocol-level
// bookkeeping; we just need to provide the trait impl.

use smithay::{delegate_output, wayland::output::OutputHandler};

use crate::state::SalmonState;

impl OutputHandler for SalmonState {}
delegate_output!(SalmonState);
