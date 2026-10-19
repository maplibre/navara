use rustc_hash::FxHashMap;

use bevy_ecs::message::{Message, MessageReader, MessageWriter};
use bevy_ecs::resource::Resource;
use bevy_ecs::system::{Res, ResMut};

use navara_math::{EqualEpsilon, Vec2};
use navara_window::Window;

/// Epsilon threshold for detecting parallel finger movement in double swipe gestures.
/// A dot product within this range of 1.0 indicates nearly parallel vectors.
const PARALLEL_DOT_EPSILON: f64 = 0.1;

/// Minimum per-frame delta (in pixels) to consider a swipe gesture.
const MIN_SWIPE_DELTA_PX: f64 = 1.0;

/// Minimum per-frame delta (in pixels) to consider a double swipe gesture.
const MIN_DOUBLE_SWIPE_DELTA_PX: f64 = 1.0;

/// Minimum per-frame distance change (in pixels) to consider a pinch or spread gesture.
const MIN_SPREAD_PINCH_DELTA_PX: f64 = 1.0;

/// Minimum per-frame angle change (in degrees) to consider a rotation gesture.
const MIN_ROTATE_DELTA_DEGREES: f64 = 0.5;

/// Full rotation in degrees, used for angle normalization.
const FULL_ROTATION_DEGREES: f64 = 360.0;

/// Half rotation in degrees, used for angle wrapping.
const HALF_ROTATION_DEGREES: f64 = 180.0;

/// Represents the current state of a touch point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TouchState {
    Start,
    End,
    Move,
}

/// Recognized touch gesture types for multi-touch interaction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TouchGesture {
    /// Single finger drag movement
    Swipe,
    /// Two finger parallel movement (typically for tilting)
    DoubleSwipe,
    /// Two fingers moving apart (zoom in)
    Spread,
    /// Two fingers moving together (zoom out)
    Pinch,
    /// Two finger rotation
    Rotate,
}

/// A tracked touch point with current and previous positions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TouchPoint {
    pub position: Vec2,
    pub prev_position: Option<Vec2>,
}

/// Resource tracking all active touch points by their unique identifiers.
#[derive(Default, Debug, Clone, PartialEq, Resource)]
pub struct TouchList {
    pub touches: FxHashMap<i32, TouchPoint>,
}

/// Event representing raw touch input from the platform.
#[derive(Debug, Clone, PartialEq, Message)]
pub struct TouchInput {
    pub state: TouchState,
    pub position: Vec2,
    pub id: i32,
}

/// Event representing a recognized touch gesture with its delta.
#[derive(Debug, Clone, PartialEq, Message)]
pub struct TouchControl {
    pub gesture: TouchGesture,
    pub delta: Vec2,
}

/// Processes raw touch input events and emits at most one recognized gesture per frame.
///
/// This system maintains the touch list state and performs gesture recognition
/// for single-finger swipes and two-finger gestures (pinch, spread, rotate, double swipe).
///
/// Gestures are recognized from the displacement over the whole frame, since
/// several `touchmove` events can arrive per frame while the camera consumes a
/// single gesture per frame.
pub fn process_touch_input_events(
    mut ev: MessageReader<TouchInput>,
    mut touch_list: ResMut<TouchList>,
    mut gesture_ev: MessageWriter<TouchControl>,
    window: Res<Window>,
) {
    let mut finger_count_changed = false;

    for touch in ev.read() {
        match touch.state {
            TouchState::Start => {
                touch_list.touches.insert(
                    touch.id,
                    TouchPoint {
                        position: touch.position,
                        prev_position: None,
                    },
                );
                finger_count_changed = true;
            }
            TouchState::Move => {
                if let Some(point) = touch_list.touches.get_mut(&touch.id) {
                    point.position = touch.position;
                }
            }
            TouchState::End => {
                touch_list.touches.remove(&touch.id);
                finger_count_changed = true;
            }
        }
    }

    // A finger landing or lifting switches the gesture (e.g. pinch -> swipe),
    // so that frame's displacement belongs to no gesture.
    if !finger_count_changed && let Some(gesture) = recognize_gesture(&touch_list, &window) {
        gesture_ev.write(gesture);
    }

    commit_positions(&mut touch_list);
}

/// Marks the current positions as the baseline of the next frame.
fn commit_positions(touch_list: &mut TouchList) {
    for point in touch_list.touches.values_mut() {
        point.prev_position = Some(point.position);
    }
}

/// Attempts to recognize a gesture from the current touch state.
///
/// Returns `Some(TouchControl)` if a gesture is recognized, `None` otherwise.
fn recognize_gesture(touch_list: &TouchList, window: &Window) -> Option<TouchControl> {
    match touch_list.touches.len() {
        2 => recognize_two_finger_gesture(touch_list, window),
        1 => recognize_single_finger_gesture(touch_list, window),
        _ => None,
    }
}

/// Recognizes gestures from two simultaneous touch points.
fn recognize_two_finger_gesture(touch_list: &TouchList, window: &Window) -> Option<TouchControl> {
    let mut touches: Vec<_> = touch_list.touches.iter().collect();
    touches.sort_by_key(|(id, _)| *id);

    let p1 = *touches.first()?.1;
    let p2 = *touches.get(1)?.1;

    let gesture_candidates = GestureCandidates {
        double_swipe: recognize_double_swipe_gesture(&p1, &p2),
        rotate: recognize_rotate_gesture(&p1, &p2),
        spread_pinch: recognize_spread_pinch_gesture(&p1, &p2),
    };

    let dominant_gesture = gesture_candidates.disambiguate(&p1, &p2)?;

    let control = match dominant_gesture {
        TouchGesture::Rotate => TouchControl {
            gesture: TouchGesture::Rotate,
            delta: Vec2::new(gesture_candidates.rotate? / FULL_ROTATION_DEGREES, 0.0),
        },
        TouchGesture::Pinch | TouchGesture::Spread => TouchControl {
            gesture: dominant_gesture,
            delta: Vec2::splat(gesture_candidates.spread_pinch?),
        },
        TouchGesture::DoubleSwipe => TouchControl {
            gesture: TouchGesture::DoubleSwipe,
            delta: Vec2::new(0.0, gesture_candidates.double_swipe? / window.height),
        },
        TouchGesture::Swipe => return None, // Not applicable for two fingers
    };

    Some(control)
}

/// Recognizes single finger swipe gesture.
fn recognize_single_finger_gesture(
    touch_list: &TouchList,
    window: &Window,
) -> Option<TouchControl> {
    let p = touch_list.touches.values().next()?;
    let delta = recognize_swipe_gesture(p)?;

    Some(TouchControl {
        gesture: TouchGesture::Swipe,
        delta: Vec2::new(delta.x / window.width, delta.y / window.height),
    })
}

/// Holds candidate gesture deltas for disambiguation.
struct GestureCandidates {
    rotate: Option<f64>,
    spread_pinch: Option<f64>,
    double_swipe: Option<f64>,
}

impl GestureCandidates {
    /// Determines the dominant gesture by comparing the magnitude of each gesture's delta.
    ///
    /// For rotation, we convert the angular delta to arc length (pixels) for fair comparison.
    /// The gesture with the largest magnitude wins.
    fn disambiguate(&self, p1: &TouchPoint, p2: &TouchPoint) -> Option<TouchGesture> {
        let rotate_magnitude = self.rotate.map(|degrees| {
            let circle_radius = (p1.position - p2.position).length();
            (degrees.to_radians() * circle_radius).abs()
        });

        let spread_pinch_magnitude = self.spread_pinch.map(|d| d.abs());
        let double_swipe_magnitude = self.double_swipe.map(|d| d.abs());

        // Find the gesture with maximum magnitude
        let mut max_magnitude: Option<f64> = None;
        let mut dominant = None;

        if let Some(mag) = rotate_magnitude
            && max_magnitude.map(|m| mag > m).unwrap_or(true)
        {
            max_magnitude = Some(mag);
            dominant = Some(TouchGesture::Rotate);
        }

        if let Some(mag) = spread_pinch_magnitude
            && max_magnitude.map(|m| mag > m).unwrap_or(true)
        {
            max_magnitude = Some(mag);
            // Positive delta means prev_distance > current_distance (fingers moving together)
            dominant = if self.spread_pinch.unwrap_or(0.0) > 0.0 {
                Some(TouchGesture::Pinch)
            } else {
                Some(TouchGesture::Spread)
            };
        }

        if let Some(mag) = double_swipe_magnitude
            && max_magnitude.map(|m| mag > m).unwrap_or(true)
        {
            dominant = Some(TouchGesture::DoubleSwipe);
        }

        dominant
    }
}

/// Detects parallel two-finger swipe movement.
///
/// Returns the Y-axis delta if both fingers are moving in nearly the same direction.
fn recognize_double_swipe_gesture(p1: &TouchPoint, p2: &TouchPoint) -> Option<f64> {
    let p1_prev = p1.prev_position?;
    let p2_prev = p2.prev_position?;

    let p1_delta = p1.position - p1_prev;
    let p2_delta = p2.position - p2_prev;
    let p1_len = p1_delta.length();
    let p2_len = p2_delta.length();

    if p1_len < MIN_DOUBLE_SWIPE_DELTA_PX || p2_len < MIN_DOUBLE_SWIPE_DELTA_PX {
        return None;
    }

    let p1_dir = p1_delta / p1_len;
    let p2_dir = p2_delta / p2_len;

    let dot = p1_dir.dot(p2_dir);

    // Both directions are almost parallel when cos(theta) ~ 1.0
    if dot.equal_diff_epsilon(1.0, PARALLEL_DOT_EPSILON) {
        let delta_y = p1.position.y - p1_prev.y;
        if delta_y.abs() >= MIN_DOUBLE_SWIPE_DELTA_PX {
            return Some(delta_y);
        }
    }

    None
}

/// Detects pinch or spread gesture based on distance change between fingers.
///
/// Returns positive delta when fingers move together (pinch),
/// negative delta when fingers move apart (spread).
fn recognize_spread_pinch_gesture(p1: &TouchPoint, p2: &TouchPoint) -> Option<f64> {
    let p1_prev = p1.prev_position?;
    let p2_prev = p2.prev_position?;

    let prev_distance = (p1_prev - p2_prev).length();
    let current_distance = (p1.position - p2.position).length();

    let delta = prev_distance - current_distance;

    // Only return a delta if there's actual movement beyond noise
    if delta.abs() >= MIN_SPREAD_PINCH_DELTA_PX {
        return Some(delta);
    }

    None
}

/// Detects rotation gesture based on angular change between two touch points.
///
/// Returns the rotation delta in degrees, normalized to [-180, 180] range.
fn recognize_rotate_gesture(p1: &TouchPoint, p2: &TouchPoint) -> Option<f64> {
    let p1_prev = p1.prev_position?;
    let p2_prev = p2.prev_position?;

    let current_angle = (p1.position.y - p2.position.y).atan2(p1.position.x - p2.position.x);
    let prev_angle = (p1_prev.y - p2_prev.y).atan2(p1_prev.x - p2_prev.x);

    let mut delta = (current_angle - prev_angle).to_degrees();

    // Normalize to [-180, 180] range
    if delta > HALF_ROTATION_DEGREES {
        delta -= FULL_ROTATION_DEGREES;
    } else if delta < -HALF_ROTATION_DEGREES {
        delta += FULL_ROTATION_DEGREES;
    }

    (delta.abs() >= MIN_ROTATE_DELTA_DEGREES).then_some(-delta)
}

/// Detects single finger swipe movement.
///
/// Returns the position delta vector if there's a previous position to compare against.
fn recognize_swipe_gesture(p: &TouchPoint) -> Option<Vec2> {
    p.prev_position
        .map(|prev_pos| p.position - prev_pos)
        .filter(|delta| delta.length() >= MIN_SWIPE_DELTA_PX)
}

#[cfg(test)]
mod tests {
    use bevy_ecs::{message::Messages, system::RunSystemOnce, world::World};

    use super::*;

    fn setup_world() -> World {
        let mut world = World::new();
        world.init_resource::<TouchList>();
        world.init_resource::<Messages<TouchInput>>();
        world.init_resource::<Messages<TouchControl>>();
        world.insert_resource(Window {
            width: 400.0,
            height: 800.0,
            pixel_ratio: 1.0,
        });
        world
    }

    /// Feeds one frame's worth of touch events and returns the emitted gestures.
    fn run_frame(world: &mut World, events: &[(TouchState, i32, f64, f64)]) -> Vec<TouchControl> {
        for &(state, id, x, y) in events {
            world.write_message(TouchInput {
                state,
                position: Vec2::new(x, y),
                id,
            });
        }
        world.run_system_once(process_touch_input_events).unwrap();
        world.resource_mut::<Messages<TouchInput>>().clear();
        world
            .resource_mut::<Messages<TouchControl>>()
            .drain()
            .collect()
    }

    /// iOS Safari dispatches several `touchmove` events per frame; the
    /// emitted swipe must cover all of them, not just the last one.
    #[test]
    fn swipe_accumulates_every_move_in_a_frame() {
        let mut world = setup_world();
        assert!(run_frame(&mut world, &[(TouchState::Start, 7, 100.0, 100.0)]).is_empty());

        let gestures = run_frame(
            &mut world,
            &[
                (TouchState::Move, 7, 110.0, 100.0),
                (TouchState::Move, 7, 120.0, 100.0),
                (TouchState::Move, 7, 140.0, 108.0),
            ],
        );
        assert_eq!(gestures.len(), 1);
        assert_eq!(gestures[0].gesture, TouchGesture::Swipe);
        assert!((gestures[0].delta.x - 40.0 / 400.0).abs() < 1e-9);
        assert!((gestures[0].delta.y - 8.0 / 800.0).abs() < 1e-9);

        // The next frame starts from the committed position.
        let gestures = run_frame(&mut world, &[(TouchState::Move, 7, 144.0, 108.0)]);
        assert_eq!(gestures.len(), 1);
        assert!((gestures[0].delta.x - 4.0 / 400.0).abs() < 1e-9);
    }

    /// Sub-threshold drift is measured per frame, so it never adds up to a
    /// gesture while the fingers' main motion matches none.
    #[test]
    fn sub_threshold_drift_does_not_accumulate_across_frames() {
        let mut world = setup_world();
        run_frame(
            &mut world,
            &[
                (TouchState::Start, 1, 100.0, 400.0),
                (TouchState::Start, 2, 300.0, 400.0),
            ],
        );

        for frame in 1..=5 {
            let dx = 10.0 * frame as f64;
            let dy = 0.3 * frame as f64;
            let gestures = run_frame(
                &mut world,
                &[
                    (TouchState::Move, 1, 100.0 + dx, 400.0 + dy),
                    (TouchState::Move, 2, 300.0 + dx, 400.0 + dy),
                ],
            );
            assert!(gestures.is_empty());
        }
    }

    /// A two-finger `touchmove` reports both fingers as separate events; the
    /// gesture must be measured once both positions are updated.
    #[test]
    fn spread_uses_both_fingers_updated_in_a_frame() {
        let mut world = setup_world();
        run_frame(
            &mut world,
            &[
                (TouchState::Start, 1, 100.0, 400.0),
                (TouchState::Start, 2, 300.0, 400.0),
            ],
        );

        let gestures = run_frame(
            &mut world,
            &[
                (TouchState::Move, 1, 90.0, 400.0),
                (TouchState::Move, 2, 310.0, 400.0),
                (TouchState::Move, 1, 80.0, 400.0),
                (TouchState::Move, 2, 320.0, 400.0),
            ],
        );
        assert_eq!(gestures.len(), 1);
        assert_eq!(gestures[0].gesture, TouchGesture::Spread);
        assert!((gestures[0].delta.x - -40.0).abs() < 1e-9);
    }

    /// Lifting a finger after a pinch must not turn the pinch displacement
    /// into a swipe of the remaining finger.
    #[test]
    fn finger_count_change_resets_gesture_baseline() {
        let mut world = setup_world();
        run_frame(
            &mut world,
            &[
                (TouchState::Start, 1, 100.0, 400.0),
                (TouchState::Start, 2, 300.0, 400.0),
            ],
        );

        let gestures = run_frame(
            &mut world,
            &[
                (TouchState::Move, 1, 150.0, 400.0),
                (TouchState::End, 2, 300.0, 400.0),
            ],
        );
        assert!(gestures.is_empty());

        let gestures = run_frame(&mut world, &[(TouchState::Move, 1, 152.0, 400.0)]);
        assert_eq!(gestures.len(), 1);
        assert_eq!(gestures[0].gesture, TouchGesture::Swipe);
        assert!((gestures[0].delta.x - 2.0 / 400.0).abs() < 1e-9);
    }
}
