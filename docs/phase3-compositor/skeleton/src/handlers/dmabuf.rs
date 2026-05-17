// linux-dmabuf-v1: GPU-side buffer protocol.
//
// Critical for performance. Without dmabuf, Firefox / Chrome / Electron
// apps fall back to copying every frame from GPU → CPU → wl_shm → CPU
// → GPU (compositor texture). On a 4K HiDPI laptop this is the
// difference between fluid 60fps and choppy 15fps.
//
// Smithay's helper does most of the GBM / EGL plumbing; we provide
// the trait impl + register a default feedback (which GPU + which
// formats we can ingest).
//
// Wiring it depends on the renderer:
//   - GlesRenderer (current): supports importing dmabufs via EGL.
//     Call `renderer.bind_dmabuf()` for each surface that hands us a
//     dmabuf buffer. The "default feedback" we advertise must match
//     the formats the renderer accepts.
//   - VulkanRenderer (future): different code path entirely.

use smithay::{
    backend::allocator::dmabuf::Dmabuf,
    delegate_dmabuf,
    wayland::dmabuf::{DmabufFeedback, DmabufFeedbackBuilder, DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier},
};

use crate::state::SalmonState;

impl DmabufHandler for SalmonState {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        // TODO(verify): single global dmabuf state stored on
        // SalmonState. Add to state.rs as `dmabuf_state: DmabufState`
        // and initialize in new().
        &mut self.dmabuf_state
    }

    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        // Try to import on the active renderer. Success → notify(ok),
        // failure → notify(err) so the client can fall back to shm.
        //
        // TODO(verify): the active renderer lives on the backend
        // (winit / udev). For nested mode, fetch via
        // `state.renderer_ref()` (you'll need to add an accessor).
        // For TTY mode, the active renderer is per-output.
        match self.try_import_dmabuf(&dmabuf) {
            Ok(()) => {
                let _ = notifier.successful::<Self>();
            }
            Err(e) => {
                tracing::warn!(?e, "dmabuf import failed; client will fall back to shm");
                notifier.failed();
            }
        }
    }
}
delegate_dmabuf!(SalmonState);

impl SalmonState {
    /// Try to import a client-provided dmabuf into the renderer's
    /// EGL context. Stub — wire when state.rs gains a renderer accessor.
    fn try_import_dmabuf(&mut self, _dmabuf: &Dmabuf) -> Result<(), DmabufImportError> {
        // Real impl outline (from anvil):
        //
        //   let renderer = self.gles_renderer.as_mut()
        //       .ok_or(DmabufImportError::NoRenderer)?;
        //   renderer.import_dmabuf(dmabuf, None)
        //       .map_err(DmabufImportError::Gles)?;
        //   Ok(())
        Err(DmabufImportError::NotImplemented)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DmabufImportError {
    #[error("renderer not yet accessible from SalmonState (see TODO)")]
    NotImplemented,
    #[error("no renderer on state")]
    NoRenderer,
    #[error("gles: {0}")]
    Gles(String),
}

/// Build the dmabuf default feedback (formats + modifiers we accept).
/// Called from state.rs::new() once the renderer is up.
#[allow(dead_code)]
pub fn build_default_feedback(
    main_device_path: std::path::PathBuf,
) -> Result<DmabufFeedback, anyhow::Error> {
    // TODO(verify): real format enumeration from the GLES renderer.
    // Anvil's pattern:
    //
    //   let formats = renderer.dmabuf_formats().collect::<Vec<_>>();
    //   DmabufFeedbackBuilder::new(main_device, formats).build()
    //
    // For now we hand back a minimal feedback advertising NV12 +
    // ARGB8888 which are the two formats every consumer client expects.
    let formats: Vec<smithay::backend::allocator::Format> = vec![
        smithay::backend::allocator::Format {
            code: smithay::backend::allocator::Fourcc::Argb8888,
            modifier: smithay::backend::allocator::Modifier::Invalid,
        },
        smithay::backend::allocator::Format {
            code: smithay::backend::allocator::Fourcc::Nv12,
            modifier: smithay::backend::allocator::Modifier::Invalid,
        },
    ];
    let dev_node = libc_makedev(&main_device_path);
    DmabufFeedbackBuilder::new(dev_node, formats)
        .build()
        .map_err(|e| anyhow::anyhow!("dmabuf feedback build: {e:?}"))
}

// libc dev_t isn't trivially convertible from a path; this stub
// keeps compile happy while pointing at the real path: use rustix or
// libc to stat the DRM device node and get the rdev.
fn libc_makedev(_path: &std::path::Path) -> u64 {
    // TODO(verify): use rustix::fs::stat or libc::stat to read the
    // device node's rdev. Returning 0 makes the global advertise an
    // invalid device which clients ignore — non-fatal but means
    // dmabuf is effectively disabled until this is real.
    0
}
