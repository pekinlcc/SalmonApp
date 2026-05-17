// SalmonApp shared backend.
//
// Stage 1: types.
// Stage 2: path_dirs + platform (pure std utility modules).
// Stage 3: db (rusqlite-backed local store).
// Future stages: engine, mail, calendar, tasks, briefing, etc.
pub mod types;
pub mod path_dirs;
pub mod platform;
pub mod db;
