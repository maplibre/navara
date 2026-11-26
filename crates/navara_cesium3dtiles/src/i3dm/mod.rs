#[cfg(test)]
macro_rules! assert_close {
    ($a:expr, $b:expr $(,)?) => {
        assert_close!($a, $b, epsilon = 1e-9)
    };
    ($a:expr, $b:expr, epsilon = $e:expr $(,)?) => {{
        let (a, b) = ($a, $b);
        assert!(a.abs_diff_eq(b, $e), "{a} != {b}");
    }};
}

mod component;
mod instances;
mod instancing_glb;
pub(crate) mod parser;
mod requester;

pub use component::*;
pub use requester::*;
