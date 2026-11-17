//! GLB format parser implementation for the `TileContentParser` trait.

use navara_buffer_store::Handle;
use navara_core::CRS;
use navara_feature_component::batch::{FeatureBatchId, GlobalBatchIds};
use navara_math::{PI_OVER_TWO, Quat, Transform, Vec3};

use crate::tile_content_parser::{ParseContext, ParsedTileContent, TileContentParser};

use super::{RenderedCesium3dTileContentGlbMarker, requester::GlbDataRequesterMarker};

/// GLB tile content parser.
///
/// GLB is the simplest format — no parsing needed. The requester handle
/// points directly to the GLB binary which is reused as-is.
pub struct GlbParser;

impl TileContentParser for GlbParser {
    type RenderedMarker = RenderedCesium3dTileContentGlbMarker;
    type RequesterMarker = GlbDataRequesterMarker;
    const BIN_IS_GLTF: bool = true;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        Some(ParsedTileContent {
            coords: Vec3::ZERO,
            crs: CRS::Geocentric,
            model_bin_handle: ctx.requester_handle,
            transform: Transform::from_rotation(Quat::from_rotation_x(PI_OVER_TWO)),
            feature_batch_id: FeatureBatchId(0),
            global_batch_ids: GlobalBatchIds {
                handle: Handle::default(),
                batch_length: 0,
                instance_feature_indices: None,
            },
            appearance_modifier: None,
            extra_components: None,
        })
    }
}
