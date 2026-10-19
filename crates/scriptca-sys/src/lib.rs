//! Raw FFI to a scriptca/scriptc native shared library.
//!
//! Generated symbols follow the profile prefix (default calculator demo: `calc_`).

use std::os::raw::c_double;

extern "C" {
    pub fn calc_init();
    pub fn calc_add(a: c_double, b: c_double) -> c_double;
    pub fn calc_mul(a: c_double, b: c_double) -> c_double;
    /// string in: (ptr, len); string out written to (*out, *out_len)
    pub fn calc_greet(
        in_ptr: *const u8,
        in_len: i64,
        out_ptr: *mut *mut u8,
        out_len: *mut usize,
    );
}

/// Safe wrappers for the calculator demo core.
pub fn init() {
    unsafe { calc_init() }
}

pub fn add(a: f64, b: f64) -> f64 {
    unsafe { calc_add(a, b) }
}

pub fn mul(a: f64, b: f64) -> f64 {
    unsafe { calc_mul(a, b) }
}

pub fn greet(name: &str) -> String {
    let bytes = name.as_bytes();
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    unsafe {
        calc_greet(
            bytes.as_ptr(),
            bytes.len() as i64,
            &mut out_ptr,
            &mut out_len,
        );
        if out_ptr.is_null() || out_len == 0 {
            return String::new();
        }
        let slice = std::slice::from_raw_parts(out_ptr, out_len);
        String::from_utf8_lossy(slice).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_mul_greet() {
        init();
        assert_eq!(add(20.0, 22.0), 42.0);
        assert_eq!(mul(6.0, 7.0), 42.0);
        assert_eq!(greet("rust"), "hello, rust");
    }
}
