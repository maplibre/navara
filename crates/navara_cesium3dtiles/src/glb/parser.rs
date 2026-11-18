//! GLB format parser implementation for the `TileContentParser` trait.

use navara_buffer_store::Handle;
use navara_core::CRS;
use navara_feature_component::batch::{FeatureBatchId, GlobalBatchIds};
use navara_math::Vec3;

use crate::tile_content_parser::{
    ParseContext, ParsedTileContent, TileContentParser, gltf_placement,
};

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
        let (coords, transform) = gltf_placement(ctx.tile_transform, Vec3::ZERO);
        Some(ParsedTileContent {
            coords,
            crs: CRS::Geocentric,
            model_bin_handle: ctx.requester_handle,
            transform,
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
