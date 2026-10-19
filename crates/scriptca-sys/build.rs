use std::env;
use std::path::PathBuf;

fn main() {
    let lib_dir = env::var("SCRIPTCA_LIB_DIR").unwrap_or_else(|_| {
        let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        manifest
            .join("../../examples/calculator-core/.scriptca")
            .canonicalize()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| ".".into())
    });
    let lib_dir = PathBuf::from(&lib_dir);
    println!("cargo:rerun-if-env-changed=SCRIPTCA_LIB_DIR");
    println!("cargo:rerun-if-changed={}", lib_dir.display());

    let lib_a = lib_dir.join("libcalculator.a");
    if !lib_a.exists() {
        panic!(
            "Missing {} — run `scriptca build` in the core project first.\n\
             scriptca emits a self-contained lib{{name}}.a for Rust/C++ hosts.",
            lib_a.display()
        );
    }

    // Propagates to dependents (unlike rustc-link-arg).
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=calculator");
    println!("cargo:rustc-link-lib=dylib=m");
    println!("cargo:rustc-link-lib=dylib=pthread");
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-lib=dylib=dl");
}
