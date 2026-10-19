//! Standalone host mimicking Tauri command dispatch against the native core.
use scriptca_tauri::{scriptca_add, scriptca_greet, scriptca_mul, ArgsF64, ArgsString};

fn main() {
    let sum = scriptca_add(ArgsF64 {
        args: vec![20.0, 22.0],
    })
    .expect("add");
    let product = scriptca_mul(ArgsF64 {
        args: vec![6.0, 7.0],
    })
    .expect("mul");
    let hi = scriptca_greet(ArgsString {
        args: vec!["tauri".into()],
    })
    .expect("greet");
    println!(
        "{}",
        serde_json::json!({ "sum": sum, "product": product, "hi": hi })
    );
}
