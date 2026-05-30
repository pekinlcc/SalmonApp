// Rendering helpers shared between backends.
//
// v0: empty shim. nested.rs and tty.rs both inline their own render
// loops because the backends differ enough (winit gives you a Bind
// target; udev gives you a swapchain) that abstracting them under
// one fn isn't a clear win yet.
//
// When you start drawing the desktop shell (wallpaper rect + cursor
// + layer surfaces) here, factor render_frame() so both backends call
// the same code path.

#[allow(dead_code)]
pub const CLEAR_COLOR: [f32; 4] = [0.05, 0.05, 0.08, 1.0];
