use wasm_bindgen::prelude::*;

use navara_math::FloatType;

use crate::LLE;

#[wasm_bindgen]
pub struct EllipsoidGeodesic {
    pub start: LLE,
    pub end: LLE,
    pub distance: FloatType,
    pub start_heading: FloatType,
    pub end_heading: FloatType,
    /// Whether Vincenty's inverse iteration converged. `false` for
    /// near-antipodal endpoints, where `distance` is only a rough estimate
    /// and interpolation snaps to the endpoints instead of following the
    /// (unreliable) capped solution.
    pub converged: bool,
    constants: navara_core::VincentyDirectFormulaConstants,
}

#[wasm_bindgen]
impl EllipsoidGeodesic {
    #[wasm_bindgen(constructor)]
    pub fn new(start: LLE, end: LLE) -> EllipsoidGeodesic {
        let start_lle: navara_core::LLE<f64, navara_core::Radians> = (&start).into();
        let end_lle: navara_core::LLE<f64, navara_core::Radians> = (&end).into();

        let inner = navara_core::EllipsoidGeodesic::new(start_lle, end_lle, &navara_core::WGS84_64);

        EllipsoidGeodesic {
            start,
            end,
            distance: inner.distance,
            start_heading: inner.start_heading,
            end_heading: inner.end_heading,
            converged: inner.converged,
            constants: inner.constants,
        }
    }

    fn inner(&self) -> navara_core::EllipsoidGeodesic {
        navara_core::EllipsoidGeodesic::from(
            (&self.start).into(),
            (&self.end).into(),
            self.distance,
            self.start_heading,
            self.end_heading,
            self.converged,
            self.constants.clone(),
        )
    }

    #[wasm_bindgen(js_name = "interpolateGeodeticPoints")]
    pub fn interpolate_geodetic_points(&self, granularity: Option<f64>) -> Vec<LLE> {
        let granularity = granularity.unwrap_or(9999.0);

        // A non-converged solve (near-antipodal endpoints) would interpolate
        // an incorrect route; a non-finite distance would underflow
        // `segments - 1` below.
        if !self.converged
            || !self.distance.is_finite()
            || granularity == 0.0
            || self.distance < granularity
        {
            return vec![self.start, self.end];
        }

        let ellipsoid_line = self.inner();

        let segments = (self.distance / granularity).ceil() as usize;
        let interpoint_distance = self.distance / segments as f64;
        let mut distance_from_start = interpoint_distance;
        let points_to_add = segments - 1;

        let mut result = vec![self.start];

        for _ in 0..points_to_add {
            let interpolated_cartographic =
                ellipsoid_line.interpolate_distance(&navara_core::WGS84_64, distance_from_start);
            result.push(interpolated_cartographic.into());
            distance_from_start += interpoint_distance;
        }

        result.push(self.end);
        result
    }

    #[wasm_bindgen(js_name = "interpolateDistance")]
    pub fn interpolate_distance(&self, distance: f64) -> LLE {
        // Without convergence there is no trustworthy route between the
        // endpoints, so snap to the nearest endpoint instead of emitting a
        // point from the capped, incorrect solution. Callers can detect the
        // case via `converged`.
        if !self.converged {
            return if distance * 2. < self.distance {
                self.start
            } else {
                self.end
            };
        }

        let inner = self.inner();
        inner
            .interpolate_distance(&navara_core::WGS84_64, distance)
            .into()
    }
}
