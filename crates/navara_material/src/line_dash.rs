//! Dash patterns of polylines, resolved from a material's `dash_array` and
//! `cap` into rows of a line dash atlas, the table the polyline shaders cut
//! each fragment against. See `guide/POLYLINE_DASH.md`.

use std::collections::HashMap;

use crate::LineCap;

/// A period is a whole number of these fractions of a line width. The shader
/// takes a line's length modulo the period in integer arithmetic, which needs
/// the period to be a ratio of integers.
pub const DASH_PERIOD_STEPS_PER_LINE_WIDTH: f64 = 64.;
/// Maximum number of dashes in one pattern.
pub const MAX_DASH_RANGES: usize = 16;
/// Maximum number of patterns in use at once, the solid row included.
pub const MAX_DASH_ROWS: usize = 256;
/// Row every atlas reserves for a solid line with butt ends.
pub const SOLID_DASH_ROW: u32 = 0;
/// Longest period, in steps of `1 / DASH_PERIOD_STEPS_PER_LINE_WIDTH` line
/// widths: the shader squares numbers below the period's step count in 32-bit
/// unsigned integers.
pub const MAX_DASH_PERIOD_STEPS: f64 = 65535.;
/// RGBA texels per atlas row: two header texels, then two dashes per texel.
pub const LINE_DASH_ROW_TEXELS: usize = 2 + MAX_DASH_RANGES / 2;

const ROW_FLOATS: usize = LINE_DASH_ROW_TEXELS * 4;
const INITIAL_ROWS: usize = 16;

/// A dash array resolved into the dashes of one period, in line widths.
#[derive(Debug, Clone, PartialEq)]
pub struct LineDashPattern {
    /// Length of one repetition: the sum of the dash array, rounded to a
    /// multiple of `1 / DASH_PERIOD_STEPS_PER_LINE_WIDTH`. The dashes are
    /// scaled by the same rounding.
    pub period: f64,
    /// Whether each dash ends in a half circle one half line width in radius.
    pub round: bool,
    /// `[start, end]` of each dash along the period, flattened and sorted by
    /// start. A dash crossing the period boundary starts below zero.
    pub ranges: Vec<f64>,
    /// Middle of the longest gap, in `[0, period)`: the one point of the
    /// period farthest from any dash, where the pattern can change size
    /// without cutting one.
    pub gap_center: f64,
}

/// A solid line whose ends take a cap: one dash per period, reaching past both
/// ends of it so that no dash edge falls inside the line.
fn solid_pattern() -> LineDashPattern {
    LineDashPattern {
        period: 1.,
        round: false,
        ranges: vec![-1., 2.],
        gap_center: 0.,
    }
}

/// Resolves a dash array (alternating dash and gap lengths in line widths)
/// into its dashes. Returns `None` for an array that draws a solid line.
///
/// Follows MapLibre's `line-dasharray`: the period is the sum of the entries,
/// so an odd-length array is not repeated to make it even — its last dash runs
/// into the first one. Zero-length dashes are dropped unless `cap` is
/// [`LineCap::Round`], where each becomes a dot.
/// ref: https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/line_atlas.ts
pub fn normalize_dash_array(dash_array: &[f32], cap: LineCap) -> Option<LineDashPattern> {
    let mut total = 0.;
    for &length in dash_array {
        if !length.is_finite() || length < 0. {
            return None;
        }
        total += length as f64;
    }
    let period =
        (total * DASH_PERIOD_STEPS_PER_LINE_WIDTH).round() / DASH_PERIOD_STEPS_PER_LINE_WIDTH;
    if period <= 0. {
        return None;
    }

    let round = cap == LineCap::Round;
    let mut ranges: Vec<f64> = Vec::with_capacity(dash_array.len());
    let mut start = 0.;
    for (i, &length) in dash_array.iter().enumerate() {
        let end = start + length as f64;
        let is_dash = i % 2 == 0;
        if is_dash && (round || end > start) {
            if ranges.last() == Some(&start) {
                // No gap since the previous dash: one longer dash.
                *ranges.last_mut().unwrap() = end;
            } else {
                ranges.push(start);
                ranges.push(end);
            }
        }
        start = end;
    }

    // A dash ending on the period boundary runs into one starting on it.
    if ranges.first() == Some(&0.) && ranges.last() == Some(&total) {
        if ranges.len() == 2 {
            return None;
        }
        ranges[0] = ranges[ranges.len() - 2] - total;
        ranges.truncate(ranges.len() - 2);
    }
    // The shader wraps positions by the rounded period, so the dashes are
    // stretched to fill it exactly.
    let scale = period / total;
    for value in &mut ranges {
        *value *= scale;
    }

    let gap_center = longest_gap_center(&ranges, period);
    Some(LineDashPattern {
        period,
        round,
        ranges,
        gap_center,
    })
}

fn longest_gap_center(ranges: &[f64], period: f64) -> f64 {
    let mut longest = -1.;
    let mut center = 0.;
    for i in (0..ranges.len()).step_by(2) {
        let end = ranges[i + 1];
        let next = if i + 2 < ranges.len() {
            ranges[i + 2]
        } else {
            ranges[0] + period
        };
        if next - end > longest {
            longest = next - end;
            center = end + (next - end) / 2.;
        }
    }
    center.rem_euclid(period)
}

/// A row header's cap code; the shaders' `NVR_LINE_CAP_*` defines.
fn line_cap_code(cap: LineCap) -> u8 {
    match cap {
        LineCap::Butt => 0,
        LineCap::Round => 1,
        LineCap::Square => 2,
    }
}

/// Why a pattern could not get a row of its own, and is drawn solid instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineDashRejection {
    /// More than [`MAX_DASH_RANGES`] dashes, or a period longer than
    /// [`MAX_DASH_PERIOD_STEPS`].
    TooLong,
    /// [`MAX_DASH_ROWS`] rows are in use.
    AtlasFull,
}

/// The dash patterns of one view, one per row of an RGBA float texture,
/// shared by every polyline material of that view.
///
/// Row layout (lengths in line widths):
/// - texel 0: `(period, dash count, cap code, period in steps of
///   1 / DASH_PERIOD_STEPS_PER_LINE_WIDTH)`. The cap shapes the ends of the
///   line itself, and with [`LineCap::Round`] those of every dash too.
/// - texel 1: `(middle of the longest gap, unused, unused, unused)`
/// - texel 2..: `(start, end, start, end)` — two dashes per texel
///
/// Every [`LineDashAtlas::register`] holds its row until a matching
/// [`LineDashAtlas::release`]: a row number stored per feature must not change
/// pattern while it is in use. A row nobody holds is reused for the next new
/// pattern.
/// ref: https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/line_atlas.ts
/// ref: https://jcgt.org/published/0002/02/08/
#[derive(Debug, Clone)]
pub struct LineDashAtlas {
    rows: HashMap<RowKey, u32>,
    /// Per row, the pattern and the number of registrations holding it.
    /// [`SOLID_DASH_ROW`] is never held.
    row_holds: Vec<Option<(RowKey, u32)>>,
    free_rows: Vec<u32>,
    data: Vec<f32>,
    data_version: u32,
}

type RowKey = (Vec<u32>, u8);

impl Default for LineDashAtlas {
    fn default() -> Self {
        Self {
            rows: HashMap::new(),
            row_holds: vec![None],
            free_rows: vec![],
            data: vec![0.; INITIAL_ROWS * ROW_FLOATS],
            data_version: 0,
        }
    }
}

impl LineDashAtlas {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the row holding the pattern of `dash_array` drawn with `cap`,
    /// adding it on first use, and holds it until [`LineDashAtlas::release`].
    /// A solid line with butt ends is [`SOLID_DASH_ROW`]. A rejected pattern
    /// is drawn on [`SOLID_DASH_ROW`].
    pub fn register(&mut self, dash_array: &[f32], cap: LineCap) -> Result<u32, LineDashRejection> {
        let key = (
            dash_array.iter().map(|length| length.to_bits()).collect(),
            line_cap_code(cap),
        );
        if let Some(&row) = self.rows.get(&key) {
            self.row_holds[row as usize]
                .as_mut()
                .expect("a registered dash row is held")
                .1 += 1;
            return Ok(row);
        }
        let row = self.add_row(dash_array, cap)?;
        if row != SOLID_DASH_ROW {
            self.rows.insert(key.clone(), row);
            self.row_holds[row as usize] = Some((key, 1));
        }
        Ok(row)
    }

    /// Ends one [`LineDashAtlas::register`] of `row`. The last one frees the
    /// row for another pattern. Returns `false`, changing nothing, for a row
    /// nobody holds.
    pub fn release(&mut self, row: u32) -> bool {
        if row == SOLID_DASH_ROW {
            return true;
        }
        let Some(entry) = self.row_holds.get_mut(row as usize) else {
            return false;
        };
        let Some((_, holds)) = entry.as_mut() else {
            return false;
        };
        *holds -= 1;
        if *holds == 0 {
            let (key, _) = entry.take().unwrap();
            self.rows.remove(&key);
            self.free_rows.push(row);
        }
        true
    }

    /// The rows as RGBA float texels, [`LINE_DASH_ROW_TEXELS`] per row and
    /// [`LineDashAtlas::row_capacity`] rows. Rows never written are zero.
    pub fn data(&self) -> &[f32] {
        &self.data
    }

    /// Changes whenever a row is written into [`LineDashAtlas::data`].
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    /// Rows [`LineDashAtlas::data`] holds; it doubles when a row is added past
    /// it.
    pub fn row_capacity(&self) -> usize {
        self.data.len() / ROW_FLOATS
    }

    fn add_row(&mut self, dash_array: &[f32], cap: LineCap) -> Result<u32, LineDashRejection> {
        let pattern = match normalize_dash_array(dash_array, cap) {
            Some(pattern) => pattern,
            None if cap == LineCap::Butt => return Ok(SOLID_DASH_ROW),
            None => solid_pattern(),
        };

        let dash_count = pattern.ranges.len() / 2;
        let period_steps = pattern.period * DASH_PERIOD_STEPS_PER_LINE_WIDTH;
        if dash_count > MAX_DASH_RANGES || period_steps > MAX_DASH_PERIOD_STEPS {
            return Err(LineDashRejection::TooLong);
        }
        let row = match self.free_rows.pop() {
            Some(row) => row as usize,
            None if self.row_holds.len() < MAX_DASH_ROWS => {
                self.row_holds.push(None);
                self.row_holds.len() - 1
            }
            None => return Err(LineDashRejection::AtlasFull),
        };
        if row >= self.row_capacity() {
            self.data.resize(self.data.len() * 2, 0.);
        }
        self.data_version = self.data_version.wrapping_add(1);

        let row_data = &mut self.data[row * ROW_FLOATS..(row + 1) * ROW_FLOATS];
        row_data.fill(0.);
        row_data[0] = pattern.period as f32;
        row_data[1] = dash_count as f32;
        row_data[2] = line_cap_code(cap) as f32;
        row_data[3] = period_steps as f32;
        row_data[4] = pattern.gap_center as f32;
        for (i, &value) in pattern.ranges.iter().enumerate() {
            row_data[8 + i] = value as f32;
        }
        Ok(row as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pattern(period: f64, round: bool, ranges: &[f64], gap_center: f64) -> LineDashPattern {
        LineDashPattern {
            period,
            round,
            ranges: ranges.to_vec(),
            gap_center,
        }
    }

    #[test]
    fn keeps_the_dashes_of_an_even_length_array() {
        assert_eq!(
            normalize_dash_array(&[2., 1., 4., 3.], LineCap::Butt),
            Some(pattern(10., false, &[0., 2., 3., 7.], 8.5))
        );
    }

    #[test]
    fn runs_the_last_dash_of_an_odd_length_array_into_the_first_one() {
        // Period 4, like [2, 2] shifted by one: MapLibre does not repeat the
        // array to make it even.
        assert_eq!(
            normalize_dash_array(&[1., 2., 1.], LineCap::Butt),
            Some(pattern(4., false, &[-1., 1.], 2.))
        );
    }

    #[test]
    fn joins_dashes_separated_by_a_zero_length_gap() {
        assert_eq!(
            normalize_dash_array(&[1., 0., 2., 3.], LineCap::Butt),
            Some(pattern(6., false, &[0., 3.], 4.5))
        );
    }

    #[test]
    fn joins_a_dash_ending_on_the_period_boundary_with_the_first_one() {
        assert_eq!(
            normalize_dash_array(&[2., 1., 2., 0.], LineCap::Butt),
            Some(pattern(5., false, &[-2., 2.], 2.5))
        );
    }

    #[test]
    fn an_array_without_gaps_is_a_solid_line() {
        assert_eq!(normalize_dash_array(&[2., 0.], LineCap::Butt), None);
        assert_eq!(normalize_dash_array(&[3.], LineCap::Round), None);
    }

    #[test]
    fn drops_zero_length_dashes_unless_the_cap_is_round() {
        assert_eq!(
            normalize_dash_array(&[0., 2.], LineCap::Butt),
            Some(pattern(2., false, &[], 0.))
        );
        assert_eq!(
            normalize_dash_array(&[0., 2.], LineCap::Square),
            Some(pattern(2., false, &[], 0.))
        );
        assert_eq!(
            normalize_dash_array(&[0., 2.], LineCap::Round),
            Some(pattern(2., true, &[0., 0.], 1.))
        );
    }

    #[test]
    fn rounds_the_period_to_a_whole_number_of_period_steps() {
        // 0.3 line widths is 19.2 steps of 1/64.
        let resolved = normalize_dash_array(&[0.1, 0.2], LineCap::Butt).unwrap();
        assert_eq!(resolved.period, 19. / 64.);
        // The dashes stretch with the period.
        let dash_end = 0.1f32 as f64 * (19. / 64.) / (0.1f32 as f64 + 0.2f32 as f64);
        assert_eq!(resolved.ranges, [0., dash_end]);
        assert_eq!(resolved.gap_center, dash_end + (19. / 64. - dash_end) / 2.);
        // Shorter than half a step: no period left to repeat.
        assert_eq!(normalize_dash_array(&[0.003, 0.003], LineCap::Butt), None);
    }

    #[test]
    fn a_dash_joined_across_the_boundary_wraps_by_the_rounded_period() {
        // 1.703 line widths rounds to 109 / 64 = 1.703125.
        let resolved = normalize_dash_array(&[1.003, 0.5, 0.2], LineCap::Butt).unwrap();
        assert_eq!(resolved.period, 109. / 64.);
        let [start, end] = resolved.ranges[..] else {
            panic!("expected one dash: {:?}", resolved.ranges);
        };
        // The part of the dash below zero is the end of the period.
        let total = 1.003f32 as f64 + 0.5f32 as f64 + 0.2f32 as f64;
        let scale = resolved.period / total;
        assert!(
            (start + resolved.period - (1.003f32 as f64 + 0.5f32 as f64) * scale).abs() < 1e-12
        );
        assert!((end - 1.003f32 as f64 * scale).abs() < 1e-12);
        assert!(end - start < resolved.period);
    }

    #[test]
    fn an_array_that_cannot_make_a_pattern_is_a_solid_line() {
        assert_eq!(normalize_dash_array(&[], LineCap::Butt), None);
        assert_eq!(normalize_dash_array(&[0., 0.], LineCap::Round), None);
        assert_eq!(normalize_dash_array(&[-1., 2.], LineCap::Butt), None);
        assert_eq!(normalize_dash_array(&[f32::NAN, 2.], LineCap::Butt), None);
    }

    fn row_data(atlas: &LineDashAtlas, row: u32) -> &[f32] {
        let start = row as usize * ROW_FLOATS;
        &atlas.data()[start..start + ROW_FLOATS]
    }

    #[test]
    fn a_solid_line_is_the_reserved_row() {
        let mut atlas = LineDashAtlas::new();
        assert_eq!(atlas.register(&[], LineCap::Butt), Ok(SOLID_DASH_ROW));
        assert_eq!(atlas.register(&[2., 0.], LineCap::Butt), Ok(SOLID_DASH_ROW));
    }

    #[test]
    fn writes_the_pattern_into_its_row() {
        let mut atlas = LineDashAtlas::new();
        let row = atlas.register(&[2., 1., 4., 3.], LineCap::Butt).unwrap();
        assert_eq!(row, 1);
        // (period, dash count, cap code, period steps), (gap center, unused...),
        // then (start, end) pairs.
        assert_eq!(
            row_data(&atlas, row)[..12],
            [10., 2., 0., 640., 8.5, 0., 0., 0., 0., 2., 3., 7.]
        );
    }

    #[test]
    fn the_same_array_and_cap_share_a_row() {
        let mut atlas = LineDashAtlas::new();
        let butt = atlas.register(&[0., 2.], LineCap::Butt).unwrap();
        let round = atlas.register(&[0., 2.], LineCap::Round).unwrap();
        assert_ne!(round, butt);
        assert_eq!(atlas.register(&[0., 2.], LineCap::Round), Ok(round));
        // Square ends differ from butt ones at the ends of the line.
        let square = atlas.register(&[0., 2.], LineCap::Square).unwrap();
        assert_ne!(square, butt);
        assert_eq!(
            row_data(&atlas, round)[..10],
            [2., 1., 1., 128., 1., 0., 0., 0., 0., 0.]
        );
        assert_eq!(row_data(&atlas, square)[..4], [2., 0., 2., 128.]);
    }

    #[test]
    fn a_solid_line_with_capped_ends_gets_a_row_of_one_endless_dash() {
        let mut atlas = LineDashAtlas::new();
        let round = atlas.register(&[], LineCap::Round).unwrap();
        assert_ne!(round, SOLID_DASH_ROW);
        // A dash array without gaps is solid too.
        assert_ne!(
            atlas.register(&[2., 0.], LineCap::Round),
            Ok(SOLID_DASH_ROW)
        );
        assert_eq!(
            row_data(&atlas, round)[..10],
            [1., 1., 1., 64., 0., 0., 0., 0., -1., 2.]
        );
    }

    #[test]
    fn growing_keeps_the_rows() {
        let mut atlas = LineDashAtlas::new();
        assert_eq!(atlas.row_capacity(), INITIAL_ROWS);
        let mut rows = vec![];
        for i in 1..=40 {
            rows.push(atlas.register(&[i as f32, 1.], LineCap::Butt).unwrap());
        }
        assert_eq!(rows, (1..=40).collect::<Vec<u32>>());
        assert_eq!(atlas.row_capacity(), 64);
        assert_eq!(
            row_data(&atlas, rows[0])[..10],
            [2., 1., 0., 128., 1.5, 0., 0., 0., 0., 1.]
        );
        assert_eq!(
            row_data(&atlas, rows[39])[..10],
            [41., 1., 0., 2624., 40.5, 0., 0., 0., 0., 40.]
        );
    }

    #[test]
    fn a_pattern_past_the_row_limit_is_rejected() {
        let mut atlas = LineDashAtlas::new();
        for i in 1..MAX_DASH_ROWS {
            assert_eq!(atlas.register(&[i as f32, 1.], LineCap::Butt), Ok(i as u32));
        }
        assert_eq!(
            atlas.register(&[MAX_DASH_ROWS as f32, 1.], LineCap::Butt),
            Err(LineDashRejection::AtlasFull)
        );
    }

    #[test]
    fn a_row_is_reused_once_every_registration_is_released() {
        let mut atlas = LineDashAtlas::new();
        let long = [1., 1., 1., 1., 1., 1.];
        let row = atlas.register(&long, LineCap::Butt).unwrap();
        assert_eq!(atlas.register(&long, LineCap::Butt), Ok(row));
        let version = atlas.data_version();

        atlas.release(row);
        // Still held by the second registration.
        assert_eq!(atlas.register(&[3., 1.], LineCap::Butt), Ok(row + 1));
        atlas.release(row);

        let reused = atlas.register(&[2., 1.], LineCap::Butt).unwrap();
        assert_eq!(reused, row);
        assert_ne!(atlas.data_version(), version);
        // The shorter pattern clears the dashes the longer one left behind.
        assert_eq!(
            row_data(&atlas, reused)[..12],
            [3., 1., 0., 192., 2.5, 0., 0., 0., 0., 2., 0., 0.]
        );
        // The released pattern no longer resolves to the reused row.
        assert_ne!(atlas.register(&long, LineCap::Butt), Ok(reused));
    }

    #[test]
    fn a_full_atlas_takes_a_pattern_once_a_row_is_released() {
        let mut atlas = LineDashAtlas::new();
        for i in 1..MAX_DASH_ROWS {
            atlas.register(&[i as f32, 1.], LineCap::Butt).unwrap();
        }
        let next = [MAX_DASH_ROWS as f32, 1.];
        assert_eq!(
            atlas.register(&next, LineCap::Butt),
            Err(LineDashRejection::AtlasFull)
        );
        atlas.release(7);
        assert_eq!(atlas.register(&next, LineCap::Butt), Ok(7));
    }

    #[test]
    fn releasing_a_row_nobody_holds_changes_nothing() {
        let mut atlas = LineDashAtlas::new();
        let row = atlas.register(&[2., 1.], LineCap::Butt).unwrap();
        assert!(atlas.release(row));
        assert!(!atlas.release(row));
        assert!(!atlas.release(MAX_DASH_ROWS as u32));
        // The freed row is reused once, not twice.
        assert_eq!(atlas.register(&[3., 1.], LineCap::Butt), Ok(row));
        assert_eq!(atlas.register(&[4., 1.], LineCap::Butt), Ok(row + 1));
    }

    #[test]
    fn releasing_the_solid_row_keeps_it() {
        let mut atlas = LineDashAtlas::new();
        atlas.release(SOLID_DASH_ROW);
        assert_eq!(atlas.register(&[], LineCap::Butt), Ok(SOLID_DASH_ROW));
        assert_eq!(atlas.register(&[2., 1.], LineCap::Butt), Ok(1));
    }

    #[test]
    fn a_pattern_too_long_for_the_shaders_integers_is_rejected() {
        let mut atlas = LineDashAtlas::new();
        // 65535 steps of 1/64 line width is just under 1024 line widths.
        assert!(atlas.register(&[1000., 23.], LineCap::Butt).is_ok());
        assert_eq!(
            atlas.register(&[1000., 24.], LineCap::Butt),
            Err(LineDashRejection::TooLong)
        );
    }

    // Mirror of the phase computation in
    // shaders/glsl/chunks/line_dash_pars_fragment.glsl, in the shader's number
    // types, fed with the length split the geometry builder writes.
    const LINE_LENGTH_HIGH_STEP_LOG2: i32 = 14;
    const PERIOD_STEPS_LOG2: i32 = 6;

    fn fract(x: f32) -> f32 {
        x - x.floor()
    }

    fn power_of_two_mod(mut exponent: u32, modulus: u32) -> u32 {
        let mut result = 1 % modulus;
        let mut base = 2 % modulus;
        for _ in 0..6 {
            if exponent & 1 != 0 {
                result = result.checked_mul(base).unwrap() % modulus;
            }
            base = base.checked_mul(base).unwrap() % modulus;
            exponent >>= 1;
        }
        result
    }

    fn high_phase(length_high: f32, line_width_unit_log2: i32, period_steps: u32) -> f32 {
        let steps = (length_high * (-LINE_LENGTH_HIGH_STEP_LOG2 as f32).exp2() + 0.5) as u32;
        let exponent = LINE_LENGTH_HIGH_STEP_LOG2 + PERIOD_STEPS_LOG2 - line_width_unit_log2;
        if exponent < 0 {
            return fract(steps as f32 * (exponent as f32).exp2() / period_steps as f32);
        }
        let remainder = (steps % period_steps)
            .checked_mul(power_of_two_mod(exponent as u32, period_steps))
            .unwrap()
            % period_steps;
        remainder as f32 / period_steps as f32
    }

    /// Phase of `length` in a period of `period_steps` steps at the given unit.
    fn line_dash_phase(length: f64, line_width_unit_log2: i32, period_steps: u32) -> f32 {
        let step = navara_geometry::LINE_LENGTH_HIGH_STEP;
        let high = (length / step).floor() * step;
        let period = (period_steps as f64 / DASH_PERIOD_STEPS_PER_LINE_WIDTH) as f32
            * (line_width_unit_log2 as f32).exp2();
        fract(
            high_phase(high as f32, line_width_unit_log2, period_steps)
                + (length - high) as f32 / period,
        )
    }

    #[test]
    fn phase_stays_within_a_centimeter_along_a_line_of_any_length() {
        assert_eq!(
            navara_geometry::LINE_LENGTH_HIGH_STEP,
            (LINE_LENGTH_HIGH_STEP_LOG2 as f64).exp2()
        );
        assert_eq!(
            DASH_PERIOD_STEPS_PER_LINE_WIDTH,
            (PERIOD_STEPS_LOG2 as f64).exp2()
        );
        // Periods of 1.5, 2, 6, 7, 11 and 13.5 line widths, with a line width
        // unit from 1.6 cm to 4 km, from one segment up to the equator's length.
        for period_steps in [96, 128, 384, 448, 704, 864] {
            for unit_log2 in -6..=12 {
                let period = period_steps as f64 / DASH_PERIOD_STEPS_PER_LINE_WIDTH
                    * (unit_log2 as f64).exp2();
                for length in [12.345, 9_876.543, 123_456.789, 1_234_567.891, 2.0e7 + 0.123] {
                    let phase = line_dash_phase(length, unit_log2, period_steps) as f64;
                    let difference = (phase - (length / period).fract()).abs();
                    let error = difference.min(1. - difference) * period;
                    assert!(
                        error < 1e-2,
                        "length {length}, period {period} m: {error} m"
                    );
                }
            }
        }
    }

    #[test]
    fn phase_of_the_longest_period_and_the_smallest_unit_stays_inside_32_bits() {
        // A line width unit of 2^-40 m takes the largest exponent the shader's
        // six squarings cover; checked_mul panics where the shader overflows.
        for unit_log2 in [-40, -10, 0, 20] {
            line_dash_phase(2.0e7, unit_log2, MAX_DASH_PERIOD_STEPS as u32);
        }
    }

    #[test]
    fn a_pattern_with_too_many_dashes_is_rejected() {
        let mut atlas = LineDashAtlas::new();
        let dash_array = [1.; (MAX_DASH_RANGES + 1) * 2];
        assert_eq!(
            atlas.register(&dash_array, LineCap::Butt),
            Err(LineDashRejection::TooLong)
        );
    }
}
