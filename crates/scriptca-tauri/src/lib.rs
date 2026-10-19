//! Helpers for wiring a scriptca native core into Tauri.
//!
//! In a full Tauri app you would `#[tauri::command]`-wrap these. Here we expose
//! plain functions so `cargo test` works without the Tauri GUI stack on CI/Linux.

use serde::{Deserialize, Serialize};
use scriptca_sys as sys;

#[derive(Debug, Serialize, Deserialize)]
pub struct ArgsF64 {
    pub args: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArgsString {
    pub args: Vec<String>,
}

/// Call once when the Tauri app starts (or lazy on first command).
pub fn ensure_init() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| sys::init());
}

pub fn scriptca_add(payload: ArgsF64) -> Result<f64, String> {
    ensure_init();
    let a = *payload.args.get(0).ok_or("missing arg0")?;
    let b = *payload.args.get(1).ok_or("missing arg1")?;
    Ok(sys::add(a, b))
}

pub fn scriptca_mul(payload: ArgsF64) -> Result<f64, String> {
    ensure_init();
    let a = *payload.args.get(0).ok_or("missing arg0")?;
    let b = *payload.args.get(1).ok_or("missing arg1")?;
    Ok(sys::mul(a, b))
}

pub fn scriptca_greet(payload: ArgsString) -> Result<String, String> {
    ensure_init();
    let name = payload.args.get(0).ok_or("missing arg0")?;
    Ok(sys::greet(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invoke_style() {
        assert_eq!(
            scriptca_add(ArgsF64 { args: vec![20.0, 22.0] }).unwrap(),
            42.0
        );
        assert_eq!(
            scriptca_greet(ArgsString {
                args: vec!["tauri".into()]
            })
            .unwrap(),
            "hello, tauri"
        );
    }
}
