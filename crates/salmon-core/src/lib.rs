// SalmonApp shared backend.
//
// Phase 2c-stage1: only `types` is here. As later stages land, this lib.rs
// will grow `pub mod db; pub mod engine; pub mod mail; …` etc. and the
// binary crates will shrink accordingly.
pub mod types;
