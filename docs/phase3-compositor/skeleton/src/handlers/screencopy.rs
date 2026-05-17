// wlr-screencopy-v1: screenshots + screen recording + screen sharing.
//
// Without this protocol:
//   - `grim` / `slurp` (Wayland screenshot tools) fail
//   - Zoom / Google Meet / Discord screen share fail (they go through
//     xdg-desktop-portal which calls into us via screencopy or
//     pipewire+screencast — both ultimately need screencopy to work)
//   - OBS Studio can't capture
//
// Smithay's wlr-screencopy implementation: copy the contents of an
// output (or a region of one) into a client-provided buffer (wl_shm
// or dmabuf). The compositor renders one extra frame into that buffer
// per request.
//
// Performance: a single-shot screenshot is cheap. Continuous capture
// (Zoom screen share) is expensive — every frame we render to the
// display, we also render to the client's buffer. For SalmonApp
// Desktop v1 this is acceptable; v2 should use pipewire + portal
// instead, which lets the kernel DMA the framebuffer to the consumer
// without going through us at all.

use smithay::{
    delegate_screencopy,
    output::Output,
    wayland::screencopy::{
        BufferConstraints, BufferParams, FrameId, Screencopy, ScreencopyHandler,
        ScreencopyState,
    },
};

use crate::state::SalmonState;

impl ScreencopyHandler for SalmonState {
    fn screencopy_state(&mut self) -> &mut ScreencopyState {
        &mut self.screencopy_state
    }

    fn frame_constraints(&mut self, output: &Output) -> Option<BufferConstraints> {
        // What pixel formats can clients hand us for THIS output?
        // For nested mode, mirror the format the host gave us. For
        // TTY mode, fetch from the active DRM plane.
        //
        // v0 returns argb8888 only — every consumer client supports
        // it. Adding dmabuf formats is a perf win once dmabuf import
        // is working in handlers/dmabuf.rs.
        let mode = output.current_mode()?;
        Some(BufferConstraints {
            size: mode.size,
            shm_formats: vec![smithay::wayland::shm::ShmFormat::Argb8888],
            dma_formats: vec![],
        })
    }

    fn frame(&mut self, screencopy: Screencopy) {
        // The client wants a frame of `screencopy.output` copied into
        // `screencopy.buffer`. Real impl renders the same scene the
        // display shows, but into the client's buffer instead of the
        // backbuffer.
        //
        // For nested mode, we need to render-to-texture and read back
        // the pixels. For TTY mode we can read the front buffer.
        //
        // Stub for now — clients will see "frame failed" and either
        // retry or fall back. Anvil has a working impl that's the port
        // target.
        let _ = screencopy;
        tracing::warn!("screencopy frame request: not implemented yet");
    }
}
delegate_screencopy!(SalmonState);

#[allow(dead_code, unused_variables)]
const _UNUSED: fn(&FrameId, &BufferParams) = |_, _| {};
