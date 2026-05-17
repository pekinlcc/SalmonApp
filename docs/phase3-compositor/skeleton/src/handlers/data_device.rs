// wl_data_device_manager: clipboard + drag-and-drop.
//
// v0 supports the bare minimum for clients not to crash. Real DnD
// (between clients, with custom mime types, with serialised drag
// previews) is a multi-week protocol implementation; see the
// SelectionTarget / DnDGrab examples in anvil for what real support
// looks like.

use smithay::{
    delegate_data_device,
    wayland::selection::{
        data_device::{
            ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
        },
        SelectionHandler,
    },
};

use crate::state::SalmonState;

impl SelectionHandler for SalmonState {
    type SelectionUserData = ();
}

impl DataDeviceHandler for SalmonState {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}

impl ClientDndGrabHandler for SalmonState {}
impl ServerDndGrabHandler for SalmonState {}

delegate_data_device!(SalmonState);
