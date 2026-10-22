// Dash patterns of the view, one per row; see LineDashAtlas in
// crates/navara_material/src/line_dash.rs for the row layout.
uniform sampler2D tLineDashAtlas;

// Must match MAX_DASH_RANGES in crates/navara_material/src/line_dash.rs.
#define NVR_LINE_DASH_MAX_RANGES 16
// The cap codes of a row's header; see line_cap_code in
// crates/navara_material/src/line_dash.rs.
#define NVR_LINE_CAP_BUTT 0
#define NVR_LINE_CAP_ROUND 1
#define NVR_LINE_CAP_SQUARE 2

// (start, end) of dash `index` of atlas row `row`, in line widths.
vec2 nvr_lineDashRange(int row, int index) {
    vec4 texel = texelFetch(tLineDashAtlas, ivec2(2 + index / 2, row), 0);
    return (index & 1) == 0 ? texel.xy : texel.zw;
}

// Middle of the longest gap of atlas row `row`, in line widths along the
// pattern.
float nvr_lineDashGapCenter(int row) {
    return texelFetch(tLineDashAtlas, ivec2(1, row), 0).x;
}

// Whether the dashes of atlas row `row` end in round caps.
bool nvr_lineDashRound(int row) {
    return int(texelFetch(tLineDashAtlas, ivec2(0, row), 0).z + 0.5) == NVR_LINE_CAP_ROUND;
}

// Signed distance from a point to round dash `dash`, cut to the line between
// `lineEnds`: a dash past an end is not drawn, and one crossing an end ends
// in a round cap there, which is the line's own. A dash within `atEnd` of an
// end counts as reaching it.
float nvr_lineDashRoundDistance(vec2 dash, float position, float across, float capRadius, vec2 lineEnds, float atEnd) {
    if (dash.y < lineEnds.x - atEnd || dash.x > lineEnds.y + atEnd) {
        return 1.0e20;
    }
    dash = clamp(dash, lineEnds.x, lineEnds.y);
    float outside = max(max(dash.x - position, position - dash.y), 0.0);
    // A dash keeps the full line width between its ends, so the line's own
    // edge stays the only edge there.
    return outside == 0.0 ? -capRadius : length(vec2(outside, across)) - capRadius;
}

// Signed distance from a point to the dashes of atlas row `row`: negative
// inside a dash, positive in a gap.
//
// `position` is the point's position along the pattern, whose period starts
// at zero, and `across` its signed distance from the line's center line.
// Both, `lineWidthUnit` (the length the pattern takes for one line width),
// `capRadius` (the radius of a round cap), `lineEnds` and the result share one
// length unit.
//
// `lineEnds` are the positions of the line's own ends along the pattern. A
// dash that does not reach into the line is not drawn. A square-ended dash
// reaching an end continues to it, and into its cap, without an edge there; a
// round one is cut there and ends in the line's round cap.
// ref: https://jcgt.org/published/0002/02/08/
float nvr_lineDashDistance(int row, float position, float across, float lineWidthUnit, float capRadius, vec2 lineEnds) {
    vec4 header = texelFetch(tLineDashAtlas, ivec2(0, row), 0);
    int rangeCount = int(header.y);
    // Every dash had zero length: nothing to draw.
    if (rangeCount == 0) {
        return 1.0e20;
    }
    float period = header.x * lineWidthUnit;
    bool roundCap = int(header.z + 0.5) == NVR_LINE_CAP_ROUND;
    float wrapped = mod(position, period);
    // The line's ends move with the periods the wrap takes off.
    lineEnds -= position - wrapped;
    position = wrapped;
    // A dash that starts or ends right at a line's end lands a rounding error
    // to either side of it, which would flip between neighboring fragments.
    // Within a hundredth of a line width counts as at the end.
    float atEnd = 1.0e-2 * lineWidthUnit;

    // The dashes are sorted, so the point lies in the last one starting at or
    // before it, or in the gap after that one. The dashes either side of the
    // period come from the neighboring periods.
    vec2 previous = nvr_lineDashRange(row, rangeCount - 1) * lineWidthUnit - period;
    vec2 next = nvr_lineDashRange(row, 0) * lineWidthUnit + period;
    for (int i = 0; i < NVR_LINE_DASH_MAX_RANGES; i++) {
        if (i >= rangeCount) {
            break;
        }
        vec2 range = nvr_lineDashRange(row, i) * lineWidthUnit;
        if (range.x > position) {
            next = range;
            break;
        }
        previous = range;
    }
    // A first dash starting below zero continues at the end of the period.
    // Where both hold the point, the one it lies deeper in decides.
    if (next.x <= position
            && min(position - next.x, next.y - position) > min(position - previous.x, previous.y - position)) {
        previous = next;
    }

    if (roundCap) {
        return min(
            nvr_lineDashRoundDistance(previous, position, across, capRadius, lineEnds, atEnd),
            nvr_lineDashRoundDistance(next, position, across, capRadius, lineEnds, atEnd)
        );
    }
    bool previousOnLine = previous.y > lineEnds.x - atEnd && previous.x < lineEnds.y + atEnd;
    bool nextOnLine = next.y > lineEnds.x - atEnd && next.x < lineEnds.y + atEnd;
    if (previousOnLine && position <= previous.y) {
        // A dash keeps the full line width between its ends, so the line's own
        // edge stays the only edge there.
        float fromStart = previous.x <= lineEnds.x + atEnd ? 1.0e20 : position - previous.x;
        float toEnd = previous.y >= lineEnds.y - atEnd ? 1.0e20 : previous.y - position;
        return -min(fromStart, toEnd);
    }
    return min(
        previousOnLine ? position - previous.y : 1.0e20,
        nextOnLine ? next.x - position : 1.0e20
    );
}

// log2 of LINE_LENGTH_HIGH_STEP and FLAT_LINE_DISTANCE_HIGH_STEP in
// crates/navara_geometry/src/polyline/constants.rs.
#define NVR_LINE_LENGTH_HIGH_STEP_LOG2 14
#define NVR_FLAT_LINE_DISTANCE_HIGH_STEP_LOG2 0
// log2 of DASH_PERIOD_STEPS_PER_LINE_WIDTH in
// crates/navara_material/src/line_dash.rs.
#define NVR_LINE_DASH_PERIOD_STEPS_LOG2 6

// 2^exponent modulo `modulus`, for an exponent below 64 and a modulus that
// MAX_DASH_PERIOD_STEPS keeps small enough to square in 32 bits.
uint nvr_lineDashPowerOfTwoMod(uint exponent, uint modulus) {
    uint result = 1u % modulus;
    uint base = 2u % modulus;
    for (int i = 0; i < 6; i++) {
        if ((exponent & 1u) != 0u) {
            result = (result * base) % modulus;
        }
        base = (base * base) % modulus;
        exponent >>= 1u;
    }
    return result;
}

// Fraction of one period that the high part of a line's length has advanced
// into it. The high part is a multiple of `2^highStepLog2`, and the period is
// `periodSteps / 2^NVR_LINE_DASH_PERIOD_STEPS_LOG2` line widths of
// `2^lineWidthUnitLog2` each, all in one length unit.
//
// The high part is a whole number of steps and the period a ratio of
// integers, so the remainder is taken in integer arithmetic: floats lose it
// once the line is thousands of periods long.
float nvr_lineDashHighPhase(float lengthHigh, int highStepLog2, int lineWidthUnitLog2, uint periodSteps) {
    uint steps = uint(lengthHigh * exp2(-float(highStepLog2)) + 0.5);
    // lengthHigh / period = steps * 2^exponent / periodSteps
    int exponent = highStepLog2 + NVR_LINE_DASH_PERIOD_STEPS_LOG2 - lineWidthUnitLog2;
    if (exponent < 0) {
        return fract(float(steps) * exp2(float(exponent)) / float(periodSteps));
    }
    uint remainder = ((steps % periodSteps) * nvr_lineDashPowerOfTwoMod(uint(exponent), periodSteps)) % periodSteps;
    return float(remainder) / float(periodSteps);
}

// Fraction of one period of atlas row `row` that a line's length has
// advanced, for a line width unit of 2^lineWidthUnitLog2. The length is split
// as `lengthHigh + lengthLow` with `lengthHigh` a multiple of `2^highStepLog2`
// (see LINE_LENGTH_HIGH_STEP). Periods start where the length is a multiple of
// the period, for every unit at once.
float nvr_lineDashPhase(int row, float lengthHigh, float lengthLow, int highStepLog2, int lineWidthUnitLog2) {
    vec4 header = texelFetch(tLineDashAtlas, ivec2(0, row), 0);
    return fract(
        nvr_lineDashHighPhase(lengthHigh, highStepLog2, lineWidthUnitLog2, uint(header.w + 0.5))
        + lengthLow / (header.x * exp2(float(lineWidthUnitLog2)))
    );
}
