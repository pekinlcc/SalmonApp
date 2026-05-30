// wl_shm: shared-memory buffers. Every client that draws via CPU pixels
// (most GTK4 apps, many older Electron apps) uses this. Smithay handles
// the buffer plumbing — we just expose the ShmState.

use smithay::{
    delegate_shm,
    wayland::shm::{ShmHandler, ShmState},
};

use crate::state::SalmonState;

impl ShmHandler for SalmonState {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}
delegate_shm!(SalmonState);
