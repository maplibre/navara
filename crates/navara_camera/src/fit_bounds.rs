//! Solving `fitBounds`: the camera that frames a box or a set of positions in
//! the padded canvas.

use std::collections::HashMap;

use bevy_ecs::prelude::Resource;
use navara_core::{CRS, WGS84_64, vec3_to_xyz, xyz_to_vec3};
use navara_math::{FloatType, Transform, Vec3};
use navara_window::Window;

use crate::{
    CameraEvent, CameraFrustum, CameraOrientation, FlyToEasing,
    system::{apply_orientation_changes, calculate_world_quat},
};

/// Every position stays at least this far (meters) in front of the camera
/// along its forward direction, so a single position or coinciding ones get a
/// close-up view and the camera never sits on a position.
pub const MIN_FIT_DISTANCE: FloatType = 300.;

/// The camera change raises a camera below this height (meters above the
/// ellipsoid) to it, which would no longer be the solved camera.
const MIN_CAMERA_HEIGHT: FloatType = 1.;

/// Heading and pitch (degrees) when the camera has not been placed yet:
/// north up, looking straight down.
const UNPLACED_HEADING: FloatType = 0.;
const UNPLACED_PITCH: FloatType = -90.;

/// Segments sampled along each edge of a box.
const BOX_EDGE_SEGMENTS: usize = 16;

/// The camera's frame depends on where the camera ends up; iterate until its
/// position moves less than this (meters). Extents of a few thousand km take
/// a few dozen iterations.
const CONVERGENCE_METERS: FloatType = 1e-3;
const MAX_ITERATIONS: usize = 200;
const CENTERING_STEPS: usize = 48;

/// What to frame. Angles in degrees, heights in meters above the ellipsoid.
#[derive(Debug, Clone, PartialEq)]
pub enum FitBoundsTarget {
    /// `[lng, lat, height]` per position.
    Positions(Vec<Vec3>),
    /// `west > east` crosses the antimeridian.
    Box {
        west: FloatType,
        south: FloatType,
        east: FloatType,
        north: FloatType,
    },
}

/// The view a fit is solved for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FitBoundsFrame {
    /// Canvas size in CSS pixels.
    pub width: FloatType,
    pub height: FloatType,
    /// Vertical field of view, radians.
    pub fov: FloatType,
    /// Degrees clockwise from north, in the camera's local frame.
    pub heading: FloatType,
    /// Degrees; -90 looks straight down.
    pub pitch: FloatType,
    /// CSS pixels: top, right, bottom, left.
    pub padding: [FloatType; 4],
}

/// The solved camera: `[lng, lat, height]` and the frame's heading and pitch;
/// roll is 0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FitBoundsPose {
    pub position: Vec3,
    pub heading: FloatType,
    pub pitch: FloatType,
}

/// The positions of each queued `CameraEvent::FitBounds`, keyed by its
/// flight id: the event itself stays `Copy`.
#[derive(Debug, Default, Resource)]
pub struct FitBoundsTargets(HashMap<u32, Vec<Vec3>>);

impl FitBoundsTargets {
    /// Queues the positions (`[lng, lat, height]`) of the fit `id`.
    pub fn insert(&mut self, id: u32, positions: Vec<Vec3>) {
        self.0.insert(id, positions);
    }

    pub(crate) fn take(&mut self, id: u32) -> Vec<Vec3> {
        self.0.remove(&id).unwrap_or_default()
    }
}

/// A fit whose flight is in progress, kept to re-solve it for a new canvas
/// size.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ActiveFit {
    pub id: u32,
    pub positions: Vec<Vec3>,
    pub padding: [FloatType; 4],
    pub heading: FloatType,
    pub pitch: FloatType,
}

impl ActiveFit {
    /// The fit solved for the current canvas and field of view.
    pub fn solve(&self, window: &Window, frustum: &CameraFrustum) -> Option<FitBoundsPose> {
        compute_fit_bounds_camera(
            &self.positions,
            &FitBoundsFrame {
                width: window.raw_width(),
                height: window.raw_height(),
                fov: frustum.fov,
                heading: self.heading,
                pitch: self.pitch,
                padding: self.padding,
            },
        )
    }

    /// The flight to the solved camera, as `flyTo` would start it.
    pub fn fly_to(
        &self,
        pose: &FitBoundsPose,
        duration: Option<FloatType>,
        max_height: Option<FloatType>,
        easing: Option<FlyToEasing>,
    ) -> CameraEvent {
        CameraEvent::FlyTo {
            position: Some(pose.position),
            orientation: Some(CameraOrientation {
                pitch: Some(pose.pitch),
                heading: Some(pose.heading),
                roll: Some(0.),
            }),
            duration,
            max_height,
            distance: None,
            easing,
            id: self.id,
        }
    }
}

/// The heading and pitch (degrees) of `transform` in the frame a camera
/// change builds at its position: the geodetic up of the ground point below
/// it. Reading the defaults here keeps repeated fits from drifting; the ENU
/// frame of the camera's own position (`get_heading` / `get_pitch`) tilts
/// away from it with altitude. Before the camera is first placed (still at
/// the Earth's center), north up, looking straight down.
pub(crate) fn current_orientation(transform: &Transform) -> (FloatType, FloatType) {
    if transform.translation == Vec3::ZERO {
        return (UNPLACED_HEADING, UNPLACED_PITCH);
    }
    let lle = to_geodetic(transform.translation);
    let up = geodetic_up(lle.x, lle.y);
    let east = Vec3::Z.cross(up).normalize_or_zero();
    let north = up.cross(east);
    let forward = transform.forward();
    let pitch = forward.dot(up).clamp(-1., 1.).asin().to_degrees();
    // Straight down or up, the heading is where the camera's up points.
    let toward = if forward.dot(up).abs() > 1. - 1e-12 {
        transform.up()
    } else {
        forward
    };
    let heading = toward
        .dot(east)
        .atan2(toward.dot(north))
        .to_degrees()
        .rem_euclid(360.);
    (heading, pitch)
}

/// The positions (`[lng, lat, height]`) a fit must keep in view: a target's
/// own, or the corners of a box and points along its edges.
pub fn fit_bounds_positions(target: &FitBoundsTarget) -> Vec<Vec3> {
    match *target {
        FitBoundsTarget::Positions(ref positions) => positions.clone(),
        FitBoundsTarget::Box {
            west,
            south,
            east,
            north,
        } => {
            let east = if east < west { east + 360. } else { east };
            let mut positions = Vec::with_capacity(BOX_EDGE_SEGMENTS * 4);
            for i in 0..BOX_EDGE_SEGMENTS {
                let t = i as FloatType / BOX_EDGE_SEGMENTS as FloatType;
                positions.extend([
                    Vec3::new(west + (east - west) * t, south, 0.),
                    Vec3::new(east, south + (north - south) * t, 0.),
                    Vec3::new(east - (east - west) * t, north, 0.),
                    Vec3::new(west, north - (north - south) * t, 0.),
                ]);
            }
            positions
        }
    }
}

/// `[lng, lat, height]` (degrees, meters) of an ECEF position, iterated to
/// full precision: the engine's one-step conversion is off by up to 2e-7° of
/// latitude at 3,000 km, which tilts the frame read back from a camera.
fn to_geodetic(p: Vec3) -> Vec3 {
    let a = WGS84_64.a;
    let e2 = WGS84_64.eccentricity_squared();
    let r = (p.x * p.x + p.y * p.y).sqrt();
    let mut lat = p.z.atan2(r * (1. - e2));
    let mut height = 0.;
    for _ in 0..10 {
        let n = a / (1. - e2 * lat.sin().powi(2)).sqrt();
        height = if lat.cos().abs() > 1e-9 {
            r / lat.cos() - n
        } else {
            p.z.abs() - n * (1. - e2)
        };
        lat = p.z.atan2(r * (1. - e2 * n / (n + height)));
    }
    Vec3::new(p.y.atan2(p.x).to_degrees(), lat.to_degrees(), height)
}

/// The geodetic up direction at a longitude/latitude (degrees), as
/// `apply_camera_change` takes it.
fn geodetic_up(lng: FloatType, lat: FloatType) -> Vec3 {
    let ground = CRS::Geographic.to_vec3(WGS84_64, Vec3::new(lng, lat, 0.), 0.0);
    xyz_to_vec3(WGS84_64.geodetic_surface_normal_from_vec3(vec3_to_xyz(ground))).normalize_or_zero()
}

/// The camera's `(right, up, forward)` at `camera` (ECEF) for a heading and
/// pitch (degrees) with roll 0, built the way `apply_camera_change` orients a
/// camera placed at a position.
fn camera_axes(camera: Vec3, heading: FloatType, pitch: FloatType) -> (Vec3, Vec3, Vec3) {
    let lle = to_geodetic(camera);
    let world_quat = calculate_world_quat(geodetic_up(lle.x, lle.y), -heading);
    let (forward, up) = apply_orientation_changes(world_quat, Vec3::Y, Vec3::Z, pitch + 90., 0.);
    (forward.cross(up).normalize_or_zero(), up, forward)
}

/// Along one camera axis, `-lo ≤ (a_i - s) / (z_i + d) ≤ hi` for every point
/// is linear in the camera offset `s` and the distance `d` behind the origin:
/// `s + hi·d ≥ a_i - hi·z_i` and `-s + lo·d ≥ -a_i - lo·z_i`.
struct AxisBounds {
    max_hi: FloatType,
    max_lo: FloatType,
    lo: FloatType,
    hi: FloatType,
}

impl AxisBounds {
    fn new(a: &[FloatType], z: &[FloatType], lo: FloatType, hi: FloatType) -> Self {
        let (mut max_hi, mut max_lo) = (FloatType::NEG_INFINITY, FloatType::NEG_INFINITY);
        for (a, z) in a.iter().zip(z) {
            max_hi = max_hi.max(a - hi * z);
            max_lo = max_lo.max(-a - lo * z);
        }
        Self {
            max_hi,
            max_lo,
            lo,
            hi,
        }
    }

    /// The smallest `d` that fits along this axis.
    fn distance(&self) -> FloatType {
        (self.max_hi + self.max_lo) / (self.lo + self.hi)
    }

    /// The `s` that fits at `d` and leaves equal margins (in tangent space,
    /// so in pixels) on both sides. The low margin shrinks and the high one
    /// grows as `s` increases, so their difference is monotonic.
    fn center(&self, a: &[FloatType], z: &[FloatType], d: FloatType) -> FloatType {
        let margin_difference = |s: FloatType| {
            let (mut low, mut high) = (FloatType::INFINITY, FloatType::NEG_INFINITY);
            for (a, z) in a.iter().zip(z) {
                let v = (a - s) / (z + d);
                low = low.min(v);
                high = high.max(v);
            }
            low + self.lo - (self.hi - high)
        };
        let (mut min, mut max) = (self.max_hi - self.hi * d, self.lo * d - self.max_lo);
        for _ in 0..CENTERING_STEPS {
            let mid = (min + max) / 2.;
            if margin_difference(mid) > 0. {
                min = mid;
            } else {
                max = mid;
            }
        }
        (min + max) / 2.
    }
}

/// The camera that frames `positions` (`[lng, lat, height]`) in the padded
/// canvas with the frame's heading and pitch, as close as the fit allows:
/// every position projects inside the padded frame and at least
/// `MIN_FIT_DISTANCE` in front of the camera, the positions touch the frame
/// on one axis (unless that minimum keeps the camera farther) and are
/// centered on the other.
///
/// `None` when there are no positions, the padding leaves no room in the
/// canvas, the pitch is outside `[-90, 0)`, or no camera above the
/// ground sees every position: one would hide a position behind the Earth's
/// horizon, sit below `MIN_CAMERA_HEIGHT`, or the fit does not converge.
pub fn compute_fit_bounds_camera(
    positions: &[Vec3],
    frame: &FitBoundsFrame,
) -> Option<FitBoundsPose> {
    let [top, right, bottom, left] = frame.padding;
    if positions.is_empty()
        || !(-90. ..0.).contains(&frame.pitch)
        || left + right >= frame.width
        || top + bottom >= frame.height
    {
        return None;
    }

    let tan_y = (frame.fov / 2.).tan();
    let tan_x = tan_y * frame.width / frame.height;
    let left = tan_x * (1. - 2. * left / frame.width);
    let right = tan_x * (1. - 2. * right / frame.width);
    let top = tan_y * (1. - 2. * top / frame.height);
    let bottom = tan_y * (1. - 2. * bottom / frame.height);

    let points: Vec<Vec3> = positions
        .iter()
        .map(|p| CRS::Geographic.to_vec3(WGS84_64, *p, 0.0))
        .collect();
    let origin = points.iter().copied().sum::<Vec3>() / points.len() as FloatType;

    let mut x = vec![0.; points.len()];
    let mut y = vec![0.; points.len()];
    let mut z = vec![0.; points.len()];
    let mut camera = origin;
    let mut converged = false;
    for _ in 0..MAX_ITERATIONS {
        let (axis_right, axis_up, forward) = camera_axes(camera, frame.heading, frame.pitch);
        for (i, p) in points.iter().enumerate() {
            let relative = *p - origin;
            x[i] = relative.dot(axis_right);
            y[i] = relative.dot(axis_up);
            z[i] = relative.dot(forward);
        }

        let horizontal = AxisBounds::new(&x, &z, left, right);
        let vertical = AxisBounds::new(&y, &z, bottom, top);
        let nearest = z.iter().copied().fold(FloatType::INFINITY, FloatType::min);
        let d = horizontal
            .distance()
            .max(vertical.distance())
            .max(MIN_FIT_DISTANCE - nearest);
        let s = horizontal.center(&x, &z, d);
        let t = vertical.center(&y, &z, d);

        let next = origin + axis_right * s + axis_up * t - forward * d;
        converged = next.distance(camera) < CONVERGENCE_METERS;
        camera = next;
        if converged {
            break;
        }
    }

    let above_every_horizon = positions
        .iter()
        .zip(&points)
        .all(|(lle, p)| (camera - *p).dot(geodetic_up(lle.x, lle.y)) > 0.);
    if !converged || !above_every_horizon {
        return None;
    }

    let position = to_geodetic(camera);
    if position.z < MIN_CAMERA_HEIGHT {
        return None;
    }
    Some(FitBoundsPose {
        position,
        heading: frame.heading,
        pitch: frame.pitch,
    })
}

#[cfg(test)]
mod test {
    use bevy_app::{App, Startup, Update};
    use bevy_ecs::schedule::IntoScheduleConfigs;
    use bevy_input::{
        ButtonInput,
        keyboard::KeyCode,
        mouse::{MouseButton, MouseMotion, MouseWheel},
    };
    use navara_core::east_north_up_to_fixed_frame;
    use navara_event_store::{CameraFlightEnded, EventStore};
    use navara_frame::FrameManager;
    use navara_input::TouchControl;

    use super::*;
    use crate::{
        CameraMarker, Orbit, get_heading, get_pitch,
        system::{apply_camera_change, startup, sync_flight_events, update},
    };

    /// Pixel tolerance for "on the edge" and "inside".
    const TOLERANCE_PX: FloatType = 0.05;

    struct View {
        width: FloatType,
        height: FloatType,
        fov_deg: FloatType,
    }
    const WIDE: View = View {
        width: 1600.,
        height: 600.,
        fov_deg: 60.,
    };
    const TALL: View = View {
        width: 600.,
        height: 1200.,
        fov_deg: 45.,
    };
    /// The debug page's 1280×720 canvas with the engine's default fov.
    const PAGE: View = View {
        width: 1280.,
        height: 720.,
        fov_deg: 50.,
    };

    fn frame(
        view: &View,
        heading: FloatType,
        pitch: FloatType,
        padding: [FloatType; 4],
    ) -> FitBoundsFrame {
        FitBoundsFrame {
            width: view.width,
            height: view.height,
            fov: view.fov_deg.to_radians(),
            heading,
            pitch,
            padding,
        }
    }

    fn positions(lng_lat_height: &[(FloatType, FloatType, FloatType)]) -> FitBoundsTarget {
        FitBoundsTarget::Positions(
            lng_lat_height
                .iter()
                .map(|&(lng, lat, h)| Vec3::new(lng, lat, h))
                .collect(),
        )
    }

    fn bbox(
        west: FloatType,
        south: FloatType,
        east: FloatType,
        north: FloatType,
    ) -> FitBoundsTarget {
        FitBoundsTarget::Box {
            west,
            south,
            east,
            north,
        }
    }

    fn fit(target: &FitBoundsTarget, frame: &FitBoundsFrame) -> Option<FitBoundsPose> {
        compute_fit_bounds_camera(&fit_bounds_positions(target), frame)
    }

    /// A start point and shelters around Tokyo Station.
    fn shelters() -> FitBoundsTarget {
        positions(&[
            (139.7671, 35.6812, 0.),
            (139.7745, 35.6866, 0.),
            (139.7596, 35.6853, 0.),
            (139.7702, 35.6751, 0.),
            (139.7634, 35.6779, 120.),
        ])
    }

    fn cities() -> FitBoundsTarget {
        positions(&[
            (135.5, 34.693, 0.),
            (136.881, 35.17, 0.),
            (139.767, 35.681, 0.),
            (140.882, 38.268, 0.),
        ])
    }

    /// The oracle camera: the transform the camera system builds for the pose
    /// (`apply_camera_change`, as the instant `FlyTo` path and every flight
    /// frame apply it), independent of the solver's own axes.
    fn oracle_camera(pose: &FitBoundsPose, frame: &FitBoundsFrame) -> Transform {
        let window = Window {
            width: frame.width,
            height: frame.height,
            pixel_ratio: 1.,
        };
        let frustum = CameraFrustum::new(
            &Transform::default(),
            1.,
            1e9,
            frame.fov,
            frame.width / frame.height,
        );
        let mut transform = Transform::default();
        let mut orbit = Orbit::default();
        apply_camera_change(
            &window,
            &frustum,
            &mut transform,
            &mut orbit,
            &Some(pose.position),
            &Some(CameraOrientation {
                pitch: Some(pose.pitch),
                heading: Some(pose.heading),
                roll: Some(0.),
            }),
            None,
        );
        transform
    }

    /// Projects like the engine's `worldToScreen`: CSS pixels from the top
    /// left, and the depth along the forward axis.
    fn project(
        camera: &Transform,
        frame: &FitBoundsFrame,
        point: Vec3,
    ) -> (FloatType, FloatType, FloatType) {
        let to = point - camera.translation;
        let depth = to.dot(camera.forward());
        let tan_y = (frame.fov / 2.).tan();
        let tan_x = tan_y * frame.width / frame.height;
        let ndc_x = to.dot(camera.right()) / depth / tan_x;
        let ndc_y = to.dot(camera.up()) / depth / tan_y;
        (
            (ndc_x + 1.) / 2. * frame.width,
            (1. - ndc_y) / 2. * frame.height,
            depth,
        )
    }

    /// Checks a pose through the oracle: the camera keeps the requested
    /// heading and pitch (as `getCamera()` reads them), is at least 1 m above
    /// the ellipsoid, above the tangent plane at every position (none behind
    /// the Earth's horizon); every position is at least `MIN_FIT_DISTANCE` in
    /// front of it and projects inside the padded frame.
    /// Returns the margins `[left, right, top, bottom]` in pixels.
    fn expect_framed(
        pose: &FitBoundsPose,
        target: &FitBoundsTarget,
        frame: &FitBoundsFrame,
    ) -> [FloatType; 4] {
        let camera = oracle_camera(pose, frame);
        // `get_pitch` / `get_heading` read the orientation in the ENU frame
        // of the camera's own position, while the camera change builds it on
        // the geodetic normal of the ground point below; the two drift apart
        // with altitude (0.05° at 3,400 km).
        assert!(
            (get_pitch(&camera) - frame.pitch).abs() < 0.1,
            "pitch {}",
            get_pitch(&camera)
        );
        if frame.pitch > -89. {
            let heading_diff = (get_heading(&camera) - frame.heading).rem_euclid(360.);
            assert!(
                heading_diff.min(360. - heading_diff) < 0.1,
                "heading {}",
                get_heading(&camera)
            );
        }
        assert!(pose.position.z >= MIN_CAMERA_HEIGHT);

        let [top, right, bottom, left] = frame.padding;
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (
            FloatType::INFINITY,
            FloatType::NEG_INFINITY,
            FloatType::INFINITY,
            FloatType::NEG_INFINITY,
        );
        for lle in fit_bounds_positions(target) {
            let p = CRS::Geographic.to_vec3(WGS84_64, lle, 0.0);
            let up = east_north_up_to_fixed_frame(p, WGS84_64).z_axis.truncate();
            assert!(
                (camera.translation - p).dot(up) > 0.,
                "{lle} behind the horizon"
            );
            let (x, y, depth) = project(&camera, frame, p);
            assert!(depth > MIN_FIT_DISTANCE - 1e-6, "{lle} at depth {depth}");
            (min_x, max_x) = (min_x.min(x), max_x.max(x));
            (min_y, max_y) = (min_y.min(y), max_y.max(y));
        }
        let margins = [
            min_x - left,
            frame.width - right - max_x,
            min_y - top,
            frame.height - bottom - max_y,
        ];
        for margin in margins {
            assert!(margin > -TOLERANCE_PX, "margins {margins:?}");
        }
        margins
    }

    /// Fits, checks the pose with `expect_framed`, and checks the positions
    /// fill the padded frame: touching it on one axis, centered on the other.
    fn expect_tight_fit(target: &FitBoundsTarget, frame: &FitBoundsFrame) -> FitBoundsPose {
        let pose = fit(target, frame).expect("a fit");
        let [left, right, top, bottom] = expect_framed(&pose, target, frame);
        let horizontal_tight = left < TOLERANCE_PX && right < TOLERANCE_PX;
        let vertical_tight = top < TOLERANCE_PX && bottom < TOLERANCE_PX;
        assert!(
            horizontal_tight || vertical_tight,
            "not tight: {:?}",
            [left, right, top, bottom]
        );
        if !horizontal_tight {
            assert!((left - right).abs() < TOLERANCE_PX, "{left} {right}");
        }
        if !vertical_tight {
            assert!((top - bottom).abs() < TOLERANCE_PX, "{top} {bottom}");
        }
        pose
    }

    #[test]
    fn frames_positions_top_down_on_a_wide_canvas() {
        expect_tight_fit(&shelters(), &frame(&WIDE, 0., -90., [40.; 4]));
    }

    #[test]
    fn frames_positions_at_an_oblique_pitch_and_a_heading() {
        expect_tight_fit(&shelters(), &frame(&WIDE, 30., -45., [40.; 4]));
    }

    #[test]
    fn frames_positions_on_a_tall_canvas() {
        expect_tight_fit(&shelters(), &frame(&TALL, 200., -60., [20.; 4]));
    }

    #[test]
    fn shifts_the_camera_so_asymmetric_padding_is_filled() {
        expect_tight_fit(&shelters(), &frame(&WIDE, 0., -50., [20., 300., 150., 10.]));
    }

    #[test]
    fn frames_a_box_of_a_few_hundred_kilometers_on_the_curved_earth() {
        let target = bbox(135., 33., 141., 37.);
        expect_tight_fit(&target, &frame(&WIDE, 0., -90., [30.; 4]));
        expect_tight_fit(&target, &frame(&TALL, 45., -40., [30.; 4]));
    }

    #[test]
    fn frames_a_box_that_crosses_the_antimeridian() {
        let pose = expect_tight_fit(
            &bbox(178., -20., -177., -15.),
            &frame(&WIDE, 0., -90., [20.; 4]),
        );
        // Centered on 180°, not on the far side of the globe.
        assert!(
            (pose.position.x.abs() - 179.5).abs() < 0.5,
            "{}",
            pose.position.x
        );
    }

    #[test]
    fn frames_a_box_spanning_a_continent_top_down() {
        expect_tight_fit(
            &bbox(100., 20., 150., 50.),
            &frame(&WIDE, 0., -90., [0.; 4]),
        );
    }

    #[test]
    fn samples_a_box_along_its_edges_not_only_its_corners() {
        // Seen from above, a parallel bows away from the pole; corners alone
        // leave the middle of the south edge below the frame.
        let frame = frame(&WIDE, 0., -90., [0.; 4]);
        let corners = positions(&[
            (120., 30., 0.),
            (150., 30., 0.),
            (150., 45., 0.),
            (120., 45., 0.),
        ]);
        let corner_pose = fit(&corners, &frame).expect("a fit");
        let south_middle = CRS::Geographic.to_vec3(WGS84_64, Vec3::new(135., 30., 0.), 0.0);
        let (_, y, _) = project(&oracle_camera(&corner_pose, &frame), &frame, south_middle);
        assert!(y > frame.height + 1., "{y}");
        expect_tight_fit(&bbox(120., 30., 150., 45.), &frame);
    }

    #[test]
    fn keeps_a_single_position_centered_at_the_minimum_distance() {
        let target = positions(&[(139.7671, 35.6812, 50.)]);
        let frame = frame(&WIDE, 10., -45., [0., 0., 0., 400.]);
        let pose = fit(&target, &frame).expect("a fit");
        expect_framed(&pose, &target, &frame);
        let point = CRS::Geographic.to_vec3(WGS84_64, Vec3::new(139.7671, 35.6812, 50.), 0.0);
        let (x, y, depth) = project(&oracle_camera(&pose, &frame), &frame, point);
        assert!((depth - MIN_FIT_DISTANCE).abs() < 1e-3, "{depth}");
        // Centered in the padded frame: x between 400 and 1600.
        assert!((x - 1000.).abs() < 1e-3, "{x}");
        assert!((y - 300.).abs() < 1e-3, "{y}");
    }

    #[test]
    fn keeps_every_position_in_front_of_the_camera_not_on_the_nearest_one() {
        // Fitting the far point from the near one would put the camera on it.
        let pair = positions(&[(139.7, 35.6, 0.), (139.7, 35.65, 0.)]);
        let frame = frame(&PAGE, 0., -10., [0.; 4]);
        let pose = fit(&pair, &frame).expect("a fit");
        expect_framed(&pose, &pair, &frame);

        // Seen from Osaka, the other cities fit; the camera must not sit
        // there, and no camera farther back sees them all at this pitch.
        assert_eq!(fit(&cities(), &frame_with(&PAGE, 45., -20., 40.)), None);
        expect_tight_fit(&cities(), &frame_with(&PAGE, 45., -45., 40.));
    }

    fn frame_with(
        view: &View,
        heading: FloatType,
        pitch: FloatType,
        padding: FloatType,
    ) -> FitBoundsFrame {
        frame(view, heading, pitch, [padding; 4])
    }

    #[test]
    fn gives_up_when_the_earth_would_hide_part_of_the_target() {
        let continent = bbox(100., 20., 150., 50.);
        assert_eq!(fit(&continent, &frame_with(&PAGE, 0., -45., 0.)), None);
        let japan = bbox(129., 31., 146., 45.);
        assert_eq!(fit(&japan, &frame_with(&WIDE, 0., -30., 0.)), None);
        let hemisphere = bbox(60., -10., 180., 70.);
        assert_eq!(fit(&hemisphere, &frame_with(&WIDE, 0., -90., 0.)), None);
        assert_eq!(fit(&hemisphere, &frame_with(&WIDE, 0., -30., 0.)), None);
        let globe = bbox(-180., -60., 180., 60.);
        assert_eq!(fit(&globe, &frame_with(&PAGE, 0., -90., 0.)), None);
    }

    #[test]
    fn gives_up_when_the_pitch_is_outside_minus_90_to_0() {
        assert!(fit(&shelters(), &frame_with(&WIDE, 0., -90., 0.)).is_some());
        for pitch in [-120., -90.5, 0., 20.] {
            assert_eq!(fit(&shelters(), &frame_with(&WIDE, 0., pitch, 0.)), None);
        }
    }

    #[test]
    fn gives_up_without_positions_or_room_in_the_canvas() {
        let top_down = frame_with(&WIDE, 0., -90., 0.);
        assert_eq!(compute_fit_bounds_camera(&[], &top_down), None);
        assert_eq!(
            fit(&shelters(), &frame(&WIDE, 0., -90., [0., 800., 0., 800.])),
            None
        );
        assert_eq!(fit(&shelters(), &frame_with(&WIDE, 0., -90., 300.)), None);
    }

    fn camera_app() -> App {
        let mut app = App::new();
        app.insert_resource(Window {
            width: PAGE.width,
            height: PAGE.height,
            pixel_ratio: 1.,
        })
        .init_resource::<FrameManager>()
        .init_resource::<EventStore>()
        .init_resource::<ButtonInput<MouseButton>>()
        .init_resource::<ButtonInput<KeyCode>>()
        .init_resource::<FitBoundsTargets>()
        .add_message::<MouseMotion>()
        .add_message::<MouseWheel>()
        .add_message::<TouchControl>()
        .add_message::<CameraEvent>()
        .add_systems(Startup, startup)
        .add_systems(Update, (update, sync_flight_events).chain());
        app
    }

    /// Queues a fit the way `Core.fitBounds` does.
    fn queue_fit(
        app: &mut App,
        id: u32,
        target: &FitBoundsTarget,
        orientation: (Option<FloatType>, Option<FloatType>),
        duration: FloatType,
    ) {
        let world = app.world_mut();
        world
            .resource_mut::<FitBoundsTargets>()
            .insert(id, fit_bounds_positions(target));
        world.write_message(CameraEvent::FitBounds {
            padding: [40.; 4],
            heading: orientation.0,
            pitch: orientation.1,
            duration: Some(duration),
            max_height: None,
            easing: None,
            id,
        });
    }

    fn instant(app: &mut App, event: CameraEvent) {
        app.world_mut().write_message(event);
    }

    fn fly_to(id: u32, position: Vec3) -> CameraEvent {
        CameraEvent::FlyTo {
            position: Some(position),
            orientation: Some(CameraOrientation::default()),
            duration: Some(0.),
            max_height: None,
            distance: None,
            easing: None,
            id,
        }
    }

    fn set_camera(position: Vec3, heading: FloatType, pitch: FloatType) -> CameraEvent {
        CameraEvent::Change {
            position: Some(position),
            orientation: Some(CameraOrientation {
                pitch: Some(pitch),
                heading: Some(heading),
                roll: Some(0.),
            }),
            distance: None,
        }
    }

    fn camera_transform(app: &mut App) -> Transform {
        let mut cameras = app.world_mut().query::<(&Transform, &CameraMarker)>();
        *cameras.single(app.world()).expect("one camera").0
    }

    fn camera_lle(app: &mut App) -> Vec3 {
        let lle = CRS::Geocentric
            .to_lle(WGS84_64, camera_transform(app).translation, 0.0)
            .deg();
        Vec3::new(lle.lng.val(), lle.lat.val(), lle.height.val())
    }

    fn take_ended(app: &mut App) -> Vec<CameraFlightEnded> {
        std::mem::take(
            &mut app
                .world_mut()
                .resource_mut::<EventStore>()
                .camera_flight_ended,
        )
    }

    fn assert_close(a: Vec3, b: Vec3, meters: FloatType) {
        let (a, b) = (
            CRS::Geographic.to_vec3(WGS84_64, a, 0.0),
            CRS::Geographic.to_vec3(WGS84_64, b, 0.0),
        );
        assert!(a.distance(b) < meters, "{a} vs {b}");
    }

    fn kanto() -> FitBoundsTarget {
        bbox(138.4, 34.9, 140.9, 36.9)
    }

    #[test]
    fn a_fit_before_the_camera_is_placed_looks_straight_down_north_up() {
        let mut app = camera_app();
        queue_fit(&mut app, 7, &kanto(), (None, None), 0.);
        app.update();

        assert_eq!(
            take_ended(&mut app),
            vec![CameraFlightEnded {
                id: 7,
                completed: true
            }]
        );
        let expected = fit(&kanto(), &frame_with(&PAGE, 0., -90., 40.)).expect("a fit");
        assert_close(camera_lle(&mut app), expected.position, 1e-3);
    }

    #[test]
    fn no_fit_ends_the_flight_as_not_completed() {
        let mut app = camera_app();
        app.update();
        let before = camera_transform(&mut app);
        take_ended(&mut app);

        queue_fit(&mut app, 9, &shelters(), (None, Some(0.)), 0.);
        app.update();

        assert_eq!(
            take_ended(&mut app),
            vec![CameraFlightEnded {
                id: 9,
                completed: false
            }]
        );
        assert_eq!(camera_transform(&mut app), before);
    }

    #[test]
    fn camera_events_apply_in_the_order_they_were_sent() {
        let home = Vec3::new(135., 35., 50_000.);

        // A flyTo sent after the fit wins...
        let mut app = camera_app();
        queue_fit(&mut app, 1, &kanto(), (Some(0.), Some(-90.)), 0.);
        instant(&mut app, fly_to(2, home));
        app.update();
        assert_close(camera_lle(&mut app), home, 1e-3);
        assert_eq!(
            take_ended(&mut app),
            vec![
                CameraFlightEnded {
                    id: 1,
                    completed: true
                },
                CameraFlightEnded {
                    id: 2,
                    completed: true
                },
            ]
        );

        // ...and a fit sent after a setCamera lands where it fits.
        let mut app = camera_app();
        instant(&mut app, set_camera(home, 0., -90.));
        queue_fit(&mut app, 3, &kanto(), (Some(0.), Some(-90.)), 0.);
        app.update();
        let expected = fit(&kanto(), &frame_with(&PAGE, 0., -90., 40.)).expect("a fit");
        assert_close(camera_lle(&mut app), expected.position, 1e-3);
    }

    #[test]
    fn a_fit_after_set_camera_defaults_to_its_orientation() {
        let mut app = camera_app();
        instant(
            &mut app,
            set_camera(Vec3::new(139.7, 35.6, 2_000.), 30., -30.),
        );
        queue_fit(&mut app, 4, &shelters(), (None, None), 0.);
        app.update();

        let (heading, pitch) = current_orientation(&camera_transform(&mut app));
        assert!((heading - 30.).abs() < 1e-6, "{heading}");
        assert!((pitch + 30.).abs() < 1e-6, "{pitch}");
        let expected = fit(&shelters(), &frame_with(&PAGE, 30., -30., 40.)).expect("a fit");
        assert_close(camera_lle(&mut app), expected.position, 1e-3);
    }

    #[test]
    fn repeated_default_fits_keep_the_orientation() {
        let continent = bbox(100., 20., 150., 50.);
        let mut app = camera_app();
        queue_fit(&mut app, 1, &continent, (Some(20.), Some(-80.)), 0.);
        app.update();
        for id in 2..7 {
            queue_fit(&mut app, id, &continent, (None, None), 0.);
            app.update();
            let (heading, pitch) = current_orientation(&camera_transform(&mut app));
            assert!((heading - 20.).abs() < 1e-6, "fit {id}: heading {heading}");
            assert!((pitch + 80.).abs() < 1e-6, "fit {id}: pitch {pitch}");
        }
        assert!(take_ended(&mut app).iter().all(|ended| ended.completed));
    }

    #[test]
    fn a_resize_during_the_flight_lands_on_the_new_canvas() {
        let mut app = camera_app();
        app.update();
        queue_fit(&mut app, 5, &kanto(), (Some(0.), Some(-90.)), 1000.);
        let mut now = 0.;
        let mut step = |app: &mut App| {
            now += 16.;
            app.world_mut()
                .resource_mut::<FrameManager>()
                .set_updated_at(now);
            app.update();
        };
        for _ in 0..10 {
            step(&mut app);
        }
        // The canvas loses 56 px of height in the middle of the flight.
        app.world_mut().resource_mut::<Window>().height = 664.;
        while !take_ended(&mut app).iter().any(|ended| ended.id == 5) {
            step(&mut app);
        }

        let short = View {
            width: 1280.,
            height: 664.,
            fov_deg: 50.,
        };
        let refit = fit(&kanto(), &frame_with(&short, 0., -90., 40.)).expect("a fit");
        assert_close(camera_lle(&mut app), refit.position, 1e-3);
        let stale = fit(&kanto(), &frame_with(&PAGE, 0., -90., 40.)).expect("a fit");
        assert!(camera_lle(&mut app).z - stale.position.z > 1000.);
    }
}
