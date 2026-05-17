// Input event routing — keyboard + pointer + (eventually) touch.
//
// The nested backend's winit loop produces backend-agnostic InputEvent
// values; the TTY backend's libinput loop produces the same shape. This
// module's job is to translate those into the right `seat` method
// calls (motion, button, key) and update focus.
//
// v0 is mostly empty; it exists so nested.rs and tty.rs can both call
// `input::dispatch(state, event)` without each duplicating the logic.

use smithay::{
    backend::input::{
        AbsolutePositionEvent, ButtonState, Event, InputBackend, InputEvent, KeyState,
        KeyboardKeyEvent, PointerButtonEvent, PointerMotionEvent,
    },
    input::{
        keyboard::FilterResult,
        pointer::{ButtonEvent, MotionEvent, RelativeMotionEvent},
    },
    utils::SERIAL_COUNTER,
};

use crate::state::SalmonState;

#[allow(dead_code)]
pub fn dispatch<B: InputBackend>(state: &mut SalmonState, event: InputEvent<B>) {
    match event {
        InputEvent::Keyboard { event } => {
            let serial = SERIAL_COUNTER.next_serial();
            let time = event.time_msec();
            if let Some(keyboard) = state.seat.get_keyboard() {
                let _: Option<()> = keyboard.input::<(), _>(
                    state,
                    event.key_code(),
                    if event.state() == KeyState::Pressed {
                        smithay::backend::input::KeyState::Pressed
                    } else {
                        smithay::backend::input::KeyState::Released
                    },
                    serial,
                    time,
                    |_, _, _| FilterResult::Forward,
                );
            }
        }
        InputEvent::PointerMotion { event } => {
            let serial = SERIAL_COUNTER.next_serial();
            let time = event.time_msec();
            if let Some(pointer) = state.seat.get_pointer() {
                let delta = (event.delta_x(), event.delta_y()).into();
                let absolute = pointer.current_location() + delta;
                pointer.motion(
                    state,
                    None,
                    &MotionEvent {
                        location: absolute,
                        serial,
                        time,
                    },
                );
                pointer.relative_motion(
                    state,
                    None,
                    &RelativeMotionEvent {
                        delta,
                        delta_unaccel: delta,
                        utime: event.time(),
                    },
                );
                pointer.frame(state);
            }
        }
        InputEvent::PointerMotionAbsolute { event } => {
            let serial = SERIAL_COUNTER.next_serial();
            let time = event.time_msec();
            if let Some(pointer) = state.seat.get_pointer() {
                let pos = (event.x_transformed(800), event.y_transformed(600)).into();
                // TODO(verify): real output size; for nested we want the
                // winit window size. Hardcoded fallback until the first
                // Resized event lands.
                pointer.motion(
                    state,
                    None,
                    &MotionEvent {
                        location: pos,
                        serial,
                        time,
                    },
                );
                pointer.frame(state);
            }
        }
        InputEvent::PointerButton { event } => {
            let serial = SERIAL_COUNTER.next_serial();
            let time = event.time_msec();
            if let Some(pointer) = state.seat.get_pointer() {
                let button = event.button_code();
                let state_btn = if event.state() == ButtonState::Pressed {
                    smithay::backend::input::ButtonState::Pressed
                } else {
                    smithay::backend::input::ButtonState::Released
                };
                pointer.button(
                    state,
                    &ButtonEvent {
                        button,
                        state: state_btn,
                        serial,
                        time,
                    },
                );
                pointer.frame(state);
            }
        }
        // TODO(verify): scroll wheels (PointerAxis), touch, gestures,
        // tablet — implement as you hit clients that need them.
        _ => {}
    }
}
