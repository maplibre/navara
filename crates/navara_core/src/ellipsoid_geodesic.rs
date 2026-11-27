use navara_math::EPSILON12;
use radians::{Angle, Radians};

use crate::{Ellipsoid, LLE, Meters, WGS84_FE_64};

// Ref: https://github.com/CesiumGS/cesium/blob/16696798115dbc7412453f3ea589f3f42a666315/packages/engine/Source/Core/EllipsoidGeodesic.js
pub struct EllipsoidGeodesic {
    pub start: LLE<f64, Radians>,
    pub end: LLE<f64, Radians>,
    pub distance: f64,
    pub start_heading: f64,
    pub end_heading: f64,
    /// Whether Vincenty's inverse iteration converged. `false` for
    /// near-antipodal endpoints (or NaN input), where `distance` is only a
    /// rough estimate and interpolation would follow an incorrect route, so
    /// callers must not interpolate along a non-converged geodesic.
    pub converged: bool,
    pub constants: VincentyDirectFormulaConstants,
}

impl EllipsoidGeodesic {
    pub fn new(
        start: LLE<f64, Radians>,
        end: LLE<f64, Radians>,
        ellipsoid: &Ellipsoid<f64>,
    ) -> Self {
        let inverse_formula_result =
            vincenty_inverse_formula(ellipsoid.a, ellipsoid.b, &start, &end);
        let constants =
            prepare_vincenty_direct_formula_constants(start.lat.val(), &inverse_formula_result);

        Self {
            start,
            end,
            constants,
            distance: inverse_formula_result.distance,
            start_heading: inverse_formula_result.start_heading,
            end_heading: inverse_formula_result.end_heading,
            converged: inverse_formula_result.converged,
        }
    }

    pub fn from(
        start: LLE<f64, Radians>,
        end: LLE<f64, Radians>,
        distance: f64,
        start_heading: f64,
        end_heading: f64,
        converged: bool,
        constants: VincentyDirectFormulaConstants,
    ) -> Self {
        Self {
            start,
            end,
            distance,
            start_heading,
            end_heading,
            converged,
            constants,
        }
    }

    pub fn interpolate_distance(
        &self,
        ellipsoid: &Ellipsoid<f64>,
        distance: f64,
    ) -> LLE<f64, Radians> {
        let constants = &self.constants;

        let s = constants.distance_ratio + distance / ellipsoid.b;

        let cosine_2s = (2. * s).cos();
        let cosine_4s = (4. * s).cos();
        let cosine_6s = (6. * s).cos();
        let sine_2s = (2. * s).sin();
        let sine_4s = (4. * s).sin();
        let sine_6s = (6. * s).sin();
        let sine_8s = (8. * s).sin();

        let s2 = s * s;
        let s3 = s * s2;

        let u2_over4 = constants.u2_over4;
        let u4_over16 = constants.u4_over16;
        let u6_over64 = constants.u6_over64;
        let u8_over256 = constants.u8_over256;

        let sigma = (2. * s3 * u8_over256 * cosine_2s) / 3.
            + s * (1. - u2_over4 + (7. * u4_over16) / 4. - (15. * u6_over64) / 4.
                + (579. * u8_over256) / 64.
                - (u4_over16 - (15. * u6_over64) / 4. + (187. * u8_over256) / 16.) * cosine_2s
                - ((5. * u6_over64) / 4. - (115. * u8_over256) / 16.) * cosine_4s
                - (29. * u8_over256 * cosine_6s) / 16.)
            + (u2_over4 / 2. - u4_over16 + (71. * u6_over64) / 32. - (85. * u8_over256) / 16.)
                * sine_2s
            + ((5. * u4_over16) / 16. - (5. * u6_over64) / 4. + (383. * u8_over256) / 96.)
                * sine_4s
            - s2 * ((u6_over64 - (11. * u8_over256) / 2.) * sine_2s
                + (5. * u8_over256 * sine_4s) / 2.)
            + ((29. * u6_over64) / 96. - (29. * u8_over256) / 16.) * sine_6s
            + (539. * u8_over256 * sine_8s) / 1536.;

        let theta = (sigma.sin() * constants.cosine_alpha).asin();
        let latitude = ((ellipsoid.a / ellipsoid.b) * theta.tan()).atan();

        // Redefine in terms of relative argument of latitude.
        let sigma = sigma - constants.sigma;

        let cosine_twice_sigma_midpoint = (2. * constants.sigma + sigma).cos();

        let sine_sigma = sigma.sin();
        let cosine_sigma = sigma.cos();

        let cc = constants.cosine_u * cosine_sigma;
        let ss = constants.sine_u * sine_sigma;

        let lambda =
            (sine_sigma * constants.sine_heading).atan2(cc - ss * constants.cosine_heading);

        let l = lambda
            - compute_delta_lambda(
                constants.f,
                constants.sine_alpha,
                constants.cosine_squared_alpha,
                sigma,
                sine_sigma,
                cosine_sigma,
                cosine_twice_sigma_midpoint,
            );

        LLE {
            lng: Angle::new(self.start.lng.val() + l),
            lat: Angle::new(latitude),
            height: Meters::new(0.),
        }
    }
}

struct VincentyInverseFormulaResult {
    distance: f64,
    start_heading: f64,
    end_heading: f64,
    u_squared: f64,
    eff: f64,
    converged: bool,
}

// Ref: https://en.wikipedia.org/wiki/Vincenty%27s_formulae#Inverse%20problem:~:text=and%20the%20equator-,Inverse%20problem,-%5Bedit%5D
fn vincenty_inverse_formula(
    a: f64,
    b: f64,
    first: &LLE<f64, Radians>,
    second: &LLE<f64, Radians>,
) -> VincentyInverseFormulaResult {
    let eff = WGS84_FE_64;
    let l = second.lng.val() - first.lng.val();

    let u1 = ((1. - eff) * first.lat.tan()).atan();
    let u2 = ((1. - eff) * second.lat.tan()).atan();

    let cosine_u1 = u1.cos();
    let sine_u1 = u1.sin();
    let cosine_u2 = u2.cos();
    let sine_u2 = u2.sin();

    let cc = cosine_u1 * cosine_u2;
    let cs = cosine_u1 * sine_u2;
    let ss = sine_u1 * sine_u2;
    let sc = sine_u1 * cosine_u2;

    let mut lambda = l;
    let mut lambda_dot: f64;

    let mut cosine_lambda: f64;
    let mut sine_lambda: f64;

    let mut sigma: f64;
    let mut cosine_sigma: f64;
    let mut sine_sigma: f64;
    let mut cosine_squared_alpha: f64;
    let mut cosine_twice_sigma_midpoint: f64;

    // Vincenty's inverse method oscillates without converging for
    // near-antipodal endpoints, and a NaN lambda can never satisfy the
    // epsilon check, then the loop must be bounded or it hangs. Past the cap the
    // last estimate is still a usable approximation of the geodesic.
    const MAX_ITERATIONS: u32 = 200;
    let mut iterations = 0;

    let converged = loop {
        cosine_lambda = lambda.cos();
        sine_lambda = lambda.sin();

        let temp = cs - sc * cosine_lambda;
        sine_sigma = (cosine_u2 * cosine_u2 * sine_lambda * sine_lambda + temp * temp).sqrt();
        cosine_sigma = ss + cc * cosine_lambda;

        sigma = sine_sigma.atan2(cosine_sigma);

        let sine_alpha: f64;

        if sine_sigma == 0. {
            sine_alpha = 0.;
            cosine_squared_alpha = 1.;
        } else {
            sine_alpha = (cc * sine_lambda) / sine_sigma;
            cosine_squared_alpha = 1. - sine_alpha * sine_alpha;
        }

        lambda_dot = lambda;

        cosine_twice_sigma_midpoint = cosine_sigma - (2. * ss) / cosine_squared_alpha;

        if !cosine_twice_sigma_midpoint.is_finite() {
            cosine_twice_sigma_midpoint = 0.;
        }

        lambda = l + compute_delta_lambda(
            eff,
            sine_alpha,
            cosine_squared_alpha,
            sigma,
            sine_sigma,
            cosine_sigma,
            cosine_twice_sigma_midpoint,
        );

        if ((lambda - lambda_dot).abs()) <= EPSILON12 {
            break true;
        }

        iterations += 1;
        if iterations >= MAX_ITERATIONS || !lambda.is_finite() {
            break false;
        }
    };

    let u_squared = (cosine_squared_alpha * (a * a - b * b)) / (b * b);

    #[allow(non_snake_case)]
    let A = 1.
        + (u_squared * (4096. + u_squared * (u_squared * (320. - 175. * u_squared) - 768.)))
            / 16384.;
    #[allow(non_snake_case)]
    let B = (u_squared * (256. + u_squared * (u_squared * (74. - 47. * u_squared) - 128.))) / 1024.;

    let cosine_squared_twice_sigma_midpoint =
        cosine_twice_sigma_midpoint * cosine_twice_sigma_midpoint;
    let delta_sigma = B
        * sine_sigma
        * (cosine_twice_sigma_midpoint
            + (B * (cosine_sigma * (2. * cosine_squared_twice_sigma_midpoint - 1.)
                - (B * cosine_twice_sigma_midpoint
                    * (4. * sine_sigma * sine_sigma - 3.)
                    * (4. * cosine_squared_twice_sigma_midpoint - 3.))
                    / 6.))
                / 4.);

    let distance = b * A * (sigma - delta_sigma);

    let start_heading = (cosine_u2 * sine_lambda).atan2(cs - sc * cosine_lambda);
    let end_heading = (cosine_u1 * sine_lambda).atan2(cs * cosine_lambda - sc);

    VincentyInverseFormulaResult {
        distance,
        start_heading,
        end_heading,
        u_squared,
        eff,
        converged,
    }
}

fn compute_delta_lambda(
    f: f64,
    sine_alpha: f64,
    cosine_squared_alpha: f64,
    sigma: f64,
    sine_sigma: f64,
    cosine_sigma: f64,
    cosine_twice_sigma_midpoint: f64,
) -> f64 {
    let c = compute_c(f, cosine_squared_alpha);

    (1. - c)
        * f
        * sine_alpha
        * (sigma
            + c * sine_sigma
                * (cosine_twice_sigma_midpoint
                    + c * cosine_sigma
                        * (2. * cosine_twice_sigma_midpoint * cosine_twice_sigma_midpoint - 1.)))
}

fn compute_c(f: f64, cosine_squared_alpha: f64) -> f64 {
    (f * cosine_squared_alpha * (4. + f * (4. - 3. * cosine_squared_alpha))) / 16.
}

#[derive(Clone)]
pub struct VincentyDirectFormulaConstants {
    f: f64,
    cosine_heading: f64,
    sine_heading: f64,
    cosine_u: f64,
    sine_u: f64,
    sigma: f64,
    sine_alpha: f64,
    cosine_squared_alpha: f64,
    cosine_alpha: f64,
    u2_over4: f64,
    u4_over16: f64,
    u6_over64: f64,
    u8_over256: f64,
    distance_ratio: f64,
}

// Calculate constants of vincenty direct formula.
// Ref: https://en.wikipedia.org/wiki/Vincenty%27s_formulae#Inverse%20problem:~:text=in%20absolute%20value.-,Direct%20problem,-%5Bedit%5D
fn prepare_vincenty_direct_formula_constants(
    start_lat: f64,
    inverse_formula: &VincentyInverseFormulaResult,
) -> VincentyDirectFormulaConstants {
    let u_squared = inverse_formula.u_squared;
    let f = inverse_formula.eff;

    let cosine_heading = inverse_formula.start_heading.cos();
    let sine_heading = inverse_formula.start_heading.sin();

    let tan_u = (1. - f) * start_lat.tan();

    let cosine_u = 1. / (1. + tan_u * tan_u).sqrt();
    let sine_u = cosine_u * tan_u;

    let sigma = tan_u.atan2(cosine_heading);

    let sine_alpha = cosine_u * sine_heading;
    let sine_squared_alpha = sine_alpha * sine_alpha;

    let cosine_squared_alpha = 1. - sine_squared_alpha;
    let cosine_alpha = cosine_squared_alpha.sqrt();

    let u2_over4 = u_squared / 4.;
    let u4_over16 = u2_over4 * u2_over4;
    let u6_over64 = u4_over16 * u2_over4;
    let u8_over256 = u4_over16 * u4_over16;

    let a0 =
        1. + u2_over4 - (3. * u4_over16) / 4. + (5. * u6_over64) / 4. - (175. * u8_over256) / 64.;
    let a1 = 1. - u2_over4 + (15. * u4_over16) / 8. - (35. * u6_over64) / 8.;
    let a2 = 1. - 3. * u2_over4 + (35. * u4_over16) / 4.;
    let a3 = 1. - 5. * u2_over4;

    let distance_ratio = a0 * sigma
        - (a1 * (2. * sigma).sin() * u2_over4) / 2.
        - (a2 * (4. * sigma).sin() * u4_over16) / 16.
        - (a3 * (6. * sigma).sin() * u6_over64) / 48.
        - ((8. * sigma).sin() * 5. * u8_over256) / 512.;

    VincentyDirectFormulaConstants {
        f,
        cosine_heading,
        sine_heading,
        cosine_u,
        sine_u,
        sigma,
        sine_alpha,
        cosine_squared_alpha,
        cosine_alpha,
        u2_over4,
        u4_over16,
        u6_over64,
        u8_over256,
        distance_ratio,
    }
}

#[cfg(test)]
mod test {
    use std::f64::consts::PI;

    use approx::assert_abs_diff_eq;
    use navara_math::EPSILON11;

    use radians::{Angle, Radians};

    use crate::{LLE, Meters, WGS84_64};

    use super::EllipsoidGeodesic;

    #[test]
    fn it_should_get_zero_distance_if_zero() {
        let start = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert_eq!(g.distance, 0.);
    }

    #[test]
    fn it_computes_distance_at_equator() {
        let pi_over_two = PI / 2.;
        let start = LLE {
            lng: Angle::new(pi_over_two),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(PI),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert_abs_diff_eq!(g.start_heading, pi_over_two, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.end_heading, pi_over_two, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.distance, 10018754., epsilon = 1.);
    }

    #[test]
    fn it_computes_distance_at_meridian() {
        let pi_over_two = PI / 2.;
        let start = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(pi_over_two),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(PI),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert_abs_diff_eq!(g.start_heading, PI, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.end_heading, PI, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.distance, 10001966., epsilon = 1.1);
    }

    #[test]
    fn it_compute_distance_at_meridian() {
        let pi_over_two = PI / 2.;
        let start = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(pi_over_two),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(PI),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert_abs_diff_eq!(g.start_heading, PI, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.end_heading, PI, epsilon = EPSILON11);
        assert_abs_diff_eq!(g.distance, 10001966., epsilon = 1.1);
    }

    fn lle_degrees(lat: f64, lng: f64) -> LLE<f64, Radians> {
        LLE {
            lng: Angle::new(lng.to_radians()),
            lat: Angle::new(lat.to_radians()),
            height: Meters::new(0.),
        }
    }

    fn surface_gap(p: LLE<f64, Radians>, q: LLE<f64, Radians>) -> f64 {
        let (p, q) = (WGS84_64.lle_to_xyz(p), WGS84_64.lle_to_xyz(q));
        ((p.x.val() - q.x.val()).powi(2)
            + (p.y.val() - q.y.val()).powi(2)
            + (p.z.val() - q.z.val()).powi(2))
        .sqrt()
    }

    const MILLIMETER: f64 = 1e-3;

    // standard: WGS84 geodesics, endpoint identity of the direct problem, over a
    // grid including poles, the equator, coincident points and the antimeridian.
    #[test]
    fn it_starts_and_ends_at_its_endpoints() {
        let lats = [-90., -89.9, -60., -15., 0., 0.001, 30., 60., 89.9, 90.];
        let lng_offsets = [0., 0.001, 15., 90., 135., 179., 180., -90.];
        let mut failures = Vec::new();
        for lat1 in lats {
            for lat2 in lats {
                for lng_offset in lng_offsets {
                    let start = lle_degrees(lat1, 15.);
                    let end = lle_degrees(lat2, 15. + lng_offset);
                    let g = EllipsoidGeodesic::new(start, end, &WGS84_64);
                    if !g.converged {
                        continue;
                    }
                    let start_error = surface_gap(g.interpolate_distance(&WGS84_64, 0.), start);
                    let end_error = surface_gap(g.interpolate_distance(&WGS84_64, g.distance), end);
                    if start_error.max(end_error) >= MILLIMETER {
                        failures.push(format!(
                            "({lat1}, 15) to ({lat2}, {}): start off by {start_error} m, end by {end_error} m",
                            15. + lng_offset
                        ));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{failures:#?}");
    }

    // standard: WGS84 geodesics, Vincenty's direct problem.
    // Reference values from GeographicLib 2.1 (Python), `Geodesic.WGS84.Direct`
    // at 1/2 and 1 of the distance.
    // ref: https://geographiclib.sourceforge.io/Python/
    #[test]
    fn it_interpolates_along_geographiclib_geodesics() {
        // (lat1, lng1, s12, [(lat, lng) at s12 / 2, (lat, lng) at s12]) in degrees and meters.
        let cases = [
            // Meridian, azimuth 180.
            (
                0.0,
                0.0,
                9500000.0,
                [(-42.88550095915056, 0.0), (-85.50579068305177, 0.0)],
            ),
            // Equator, azimuth 90.
            (
                0.0,
                0.0,
                5000000.0,
                [(0.0, 22.457882102988037), (0.0, 44.915764205976075)],
            ),
            // Tokyo to San Francisco, azimuth 54.404407837111684.
            (
                35.681,
                139.767,
                8284545.286908689,
                [
                    (48.66622042752116, -172.21872161140269),
                    (37.77490000000001, -122.4194),
                ],
            ),
            // 1 km at mid-latitude, azimuth 37.
            (
                48.8566,
                2.3522,
                1000.0,
                [
                    (48.860190688252764, 2.3563008772363),
                    (48.86378122838547, 2.360402341172884),
                ],
            ),
            // Passing near the pole, azimuth 10.
            (
                80.0,
                -30.0,
                3000000.0,
                [
                    (86.02577321360971, 114.41553757131211),
                    (72.90098296867136, 134.51988073246181),
                ],
            ),
            // Southern hemisphere, azimuth 250.
            (
                -33.86,
                151.21,
                12000000.0,
                [
                    (-33.915262637825556, 85.10324721584904),
                    (-5.6360432623899985, 35.34557606796527),
                ],
            ),
        ];
        let mut failures = Vec::new();
        for (lat1, lng1, s12, [(mid_lat, mid_lng), (lat2, lng2)]) in cases {
            let start = lle_degrees(lat1, lng1);
            let end = lle_degrees(lat2, lng2);
            let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

            assert!(g.converged);
            let distance_error = (g.distance - s12).abs();
            let mid_error = surface_gap(
                g.interpolate_distance(&WGS84_64, s12 / 2.),
                lle_degrees(mid_lat, mid_lng),
            );
            let end_error = surface_gap(g.interpolate_distance(&WGS84_64, s12), end);
            if distance_error.max(mid_error).max(end_error) >= MILLIMETER {
                failures.push(format!(
                    "from ({lat1}, {lng1}) over {s12} m: distance off by {distance_error} m, \
                     midpoint by {mid_error} m, end by {end_error} m"
                ));
            }
        }
        assert!(failures.is_empty(), "{failures:#?}");
    }

    // Vincenty's inverse method oscillates without ever converging for this
    // near-antipodal pair (verified far beyond 100k iterations on the
    // unbounded loop); the iteration bound must terminate it with a finite
    // estimate instead of hanging.
    #[test]
    fn it_terminates_for_near_antipodal_points() {
        let start = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(0.5_f64.to_radians()),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(179.8_f64.to_radians()),
            lat: Angle::new((-0.4_f64).to_radians()),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert!(!g.converged);
        assert!(g.distance.is_finite());
        // Roughly half the circumference; the capped estimate only needs to
        // be in the right ballpark.
        assert!(
            g.distance > 19_000_000. && g.distance < 21_000_000.,
            "got {}",
            g.distance
        );
    }

    #[test]
    fn it_reports_convergence_for_regular_points() {
        let start = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let end = LLE {
            lng: Angle::new(PI / 2.),
            lat: Angle::new(0.),
            height: Meters::new(0.),
        };
        let g = EllipsoidGeodesic::new(start, end, &WGS84_64);

        assert!(g.converged);
    }
}
