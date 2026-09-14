use bevy_ecs::{component::Component, entity::Entity, system::ResMut};
use navara_buffer_store::{BufferStore, Handle};
use navara_core::{Aabb, BoundingSphere, CRS, Extent, Radians};
use navara_geometry::{TransferableFloatAttribute, TransferableUintAttribute};
use navara_layer::LayerId;
use navara_material::{
    BillboardMaterial, ModelMaterial, PointMaterial, PolygonMaterial, PolylineMaterial,
    TextMaterial,
};
use navara_math::{FloatType, Transform, Vec3};

use crate::model::ModelBin;

use crate::batch::BatchTable;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PointRenderInformation {
    pub terrain_heights: Handle,
    pub should_recalculate_height: bool,
    pub is_rendered: bool,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModelRenderInformation {
    pub is_rendered: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolygonRenderInformation {
    pub should_recalculate_height: bool,
    pub distance_to_center_from_ellipsoid_surface: Option<FloatType>,
    pub is_rendered: bool,
    pub should_be_texturized: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolylineRenderInformation {
    pub should_recalculate_height: bool,
    pub is_rendered: bool,
    pub should_be_texturized: bool,
}

// From data oriented design perspective, this is too bad structure.
// But this is necessary to communicate with WASM.
#[derive(Component, Clone, Debug, Default)]
#[require(LayerId)]
pub enum RenderableFeature {
    Point {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: PointMaterial,
        transform: Transform,
        feature_id: Entity,
        render_info: PointRenderInformation,
        geometry: TransferablePointGeometry,
        feature_batch_id: u32,
        batch_length: u32,
    },
    Billboard {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: BillboardMaterial,
        transform: Transform,
        feature_id: Entity,
        render_info: PointRenderInformation,
        geometry: TransferablePointGeometry,
        feature_batch_id: u32,
        batch_length: u32,
    },
    Text {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: TextMaterial,
        transform: Transform,
        feature_id: Entity,
        render_info: PointRenderInformation,
        geometry: TransferablePointGeometry,
        feature_batch_id: u32,
        batch_length: u32,
    },
    Polyline {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: PolylineMaterial,
        geometry: TransferablePolylineGeometry,
        transform: Transform,
        feature_id: Entity,
        render_info: PolylineRenderInformation,
        extent: Extent<f64, Radians>,
        feature_batch_id: u32,
        batch_length: u32,
    },
    Polygon {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: PolygonMaterial,
        geometry: TransferablePolygonGeometry,
        outline_geometry: Option<TransferablePolygonOutlineGeometry>,
        transform: Transform,
        feature_id: Entity,
        render_info: PolygonRenderInformation,
        extent: Option<Extent<f64, Radians>>,
        bounding_sphere: Option<BoundingSphere>,
        feature_batch_id: u32,
        batch_length: u32,
    },
    Model {
        coordinates: Vec3,
        crs: CRS,
        active: bool,
        material: ModelMaterial,
        transform: Transform,
        feature_id: Entity,
        render_info: ModelRenderInformation,
        bin: Option<ModelBin>,
        geometry: TransferableModelGeometry,
        aabb: Aabb,
        feature_batch_id: u32,
        batch_length: u32,
    },
    #[default]
    Unknown,
}

impl RenderableFeature {
    pub fn activate(&mut self, v: bool) {
        match self {
            RenderableFeature::Point { active, .. } => *active = v,
            RenderableFeature::Billboard { active, .. } => *active = v,
            RenderableFeature::Text { active, .. } => *active = v,
            RenderableFeature::Polyline { active, .. } => *active = v,
            RenderableFeature::Polygon { active, .. } => *active = v,
            RenderableFeature::Model { active, .. } => *active = v,
            RenderableFeature::Unknown => {}
        }
    }

    pub fn is_active(&self) -> bool {
        match self {
            RenderableFeature::Point { active, .. } => *active,
            RenderableFeature::Billboard { active, .. } => *active,
            RenderableFeature::Text { active, .. } => *active,
            RenderableFeature::Polyline { active, .. } => *active,
            RenderableFeature::Polygon { active, .. } => *active,
            RenderableFeature::Model { active, .. } => *active,
            RenderableFeature::Unknown => unreachable!(),
        }
    }

    pub fn is_rendered(&self) -> bool {
        match self {
            RenderableFeature::Point { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Billboard { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Text { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Polyline { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Polygon { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Model { render_info, .. } => render_info.is_rendered,
            RenderableFeature::Unknown => unreachable!(),
        }
    }

    pub fn destroy(&mut self, buf: &mut BufferStore, batch_table_res: &mut BatchTable) {
        match self {
            RenderableFeature::Point {
                geometry,
                feature_batch_id,
                render_info,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);
                buf.remove(&render_info.terrain_heights);
            }
            RenderableFeature::Billboard {
                geometry,
                feature_batch_id,
                render_info,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);
                buf.remove(&render_info.terrain_heights);
            }
            RenderableFeature::Text {
                geometry,
                feature_batch_id,
                render_info,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);
                buf.remove(&render_info.terrain_heights);
            }
            RenderableFeature::Polyline {
                geometry,
                feature_batch_id,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);
            }
            RenderableFeature::Polygon {
                geometry,
                outline_geometry,
                feature_batch_id,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);

                if let Some(outline_geometry) = outline_geometry {
                    outline_geometry.remove_from_buf(buf);
                }
            }
            RenderableFeature::Model {
                geometry,
                feature_batch_id,
                ..
            } => {
                geometry.remove_from_buf(buf, batch_table_res);
                batch_table_res.remove(feature_batch_id);
            }
            _ => (),
        }
    }
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferablePolylineGeometry {
    pub position: TransferableFloatAttribute,
    pub position_high: Option<TransferableFloatAttribute>,
    pub position_low: Option<TransferableFloatAttribute>,
    pub start: Option<TransferableFloatAttribute>,
    pub start_high: Option<TransferableFloatAttribute>,
    pub start_low: Option<TransferableFloatAttribute>,
    pub forward_offset: Option<TransferableFloatAttribute>,
    pub end_high: Option<TransferableFloatAttribute>,
    pub end_low: Option<TransferableFloatAttribute>,
    pub start_normals: Option<TransferableFloatAttribute>,
    pub end_normal_and_texture_coordinate_normalization_x: Option<TransferableFloatAttribute>,
    pub right_normal_and_texture_coordinate_normalization_y: TransferableFloatAttribute,
    pub batch_ids: Option<TransferableFloatAttribute>,
    pub batch_index: Option<TransferableUintAttribute>,
    pub indices: Handle,
}

impl TransferablePolylineGeometry {
    pub fn with_buf(
        buf: &mut ResMut<BufferStore>,
        geo: navara_geometry::PolylineGeometry,
    ) -> TransferablePolylineGeometry {
        let position = buf.new_f32(geo.attributes.position.data);
        let right_normal_and_texture_coordinate_normalization_y = buf.new_f32(
            geo.attributes
                .right_normal_and_texture_coordinate_normalization_y
                .data,
        );
        let indices = buf.new_u32(geo.indices);

        TransferablePolylineGeometry {
            position: TransferableFloatAttribute {
                data: position,
                size: geo.attributes.position.size,
            },
            position_high: geo
                .attributes
                .position_high
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            position_low: geo
                .attributes
                .position_low
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            start: geo.attributes.start.map(|attr| TransferableFloatAttribute {
                data: buf.new_f32(attr.data),
                size: attr.size,
            }),
            start_high: geo
                .attributes
                .start_high
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            start_low: geo
                .attributes
                .start_low
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            forward_offset: geo
                .attributes
                .forward_offset
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            end_high: geo
                .attributes
                .end_high
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            end_low: geo
                .attributes
                .end_low
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            start_normals: geo
                .attributes
                .start_normals
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            end_normal_and_texture_coordinate_normalization_x: geo
                .attributes
                .end_normal_and_texture_coordinate_normalization_x
                .map(|attr| TransferableFloatAttribute {
                    data: buf.new_f32(attr.data),
                    size: attr.size,
                }),
            right_normal_and_texture_coordinate_normalization_y: TransferableFloatAttribute {
                data: right_normal_and_texture_coordinate_normalization_y,
                size: geo
                    .attributes
                    .right_normal_and_texture_coordinate_normalization_y
                    .size,
            },
            batch_ids: geo
                .attributes
                .batch_ids
                .map(|batch_ids| TransferableFloatAttribute {
                    data: buf.new_f32(batch_ids.data),
                    size: batch_ids.size,
                }),
            batch_index: geo
                .attributes
                .batch_index
                .map(|batch_idx| TransferableUintAttribute {
                    data: buf.new_u32(batch_idx.data),
                    size: batch_idx.size,
                }),
            indices,
        }
    }

    pub fn remove_from_buf(&mut self, buf: &mut BufferStore, batch_table: &mut BatchTable) {
        for id in self.remove_buffers(buf) {
            batch_table.release_global_batch_id(id);
        }
    }

    /// Free the geometry's BufferStore entries and return the global batch ids
    /// found in the batch_ids attribute. The caller must release the returned
    /// ids via `BatchTable::release_global_batch_id`; the split lets component
    /// `on_remove` hooks free the two resources without borrowing them at the
    /// same time.
    pub fn remove_buffers(&mut self, buf: &mut BufferStore) -> Vec<u32> {
        buf.remove(&self.position.data);
        if let Some(position_high) = &self.position_high {
            buf.remove(&position_high.data);
        }
        if let Some(position_low) = &self.position_low {
            buf.remove(&position_low.data);
        }
        if let Some(start) = &self.start {
            buf.remove(&start.data);
        }
        if let Some(start_high) = &self.start_high {
            buf.remove(&start_high.data);
        }
        if let Some(start_low) = &self.start_low {
            buf.remove(&start_low.data);
        }
        if let Some(end_high) = &self.end_high {
            buf.remove(&end_high.data);
        }
        if let Some(end_low) = &self.end_low {
            buf.remove(&end_low.data);
        }
        if let Some(forward_offset) = &self.forward_offset {
            buf.remove(&forward_offset.data);
        }
        if let Some(start_normals) = &self.start_normals {
            buf.remove(&start_normals.data);
        }
        if let Some(end_normal) = &self.end_normal_and_texture_coordinate_normalization_x {
            buf.remove(&end_normal.data);
        }
        buf.remove(
            &self
                .right_normal_and_texture_coordinate_normalization_y
                .data,
        );
        let mut removed_batch_ids = Vec::new();
        if let Some(batch_ids) = &self.batch_ids
            && let Some(vec_ids) = buf.remove_f32(&batch_ids.data)
        {
            for i in (0..vec_ids.len()).step_by(batch_ids.size as usize) {
                removed_batch_ids.push(vec_ids[i] as u32);
            }
        }
        if let Some(batch_index) = &self.batch_index {
            buf.remove(&batch_index.data);
        }
        buf.remove(&self.indices);
        removed_batch_ids
    }
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferablePolygonGeometry {
    pub position: Option<TransferableFloatAttribute>,
    pub position_3d_high: Option<TransferableFloatAttribute>,
    pub position_3d_low: Option<TransferableFloatAttribute>,
    pub normal: Option<TransferableFloatAttribute>,
    pub scale_normal_and_cap: Option<TransferableFloatAttribute>,
    pub batch_ids: Option<TransferableFloatAttribute>,
    pub batch_index: Option<TransferableUintAttribute>,
    pub indices: Handle,
}

impl TransferablePolygonGeometry {
    pub fn with_buf(
        buf: &mut BufferStore,
        geo: navara_geometry::PolygonGeometry,
    ) -> TransferablePolygonGeometry {
        let position = geo
            .attributes
            .position
            .map(|p| (buf.new_f32(p.data), p.size));
        let position_3d_high = geo
            .attributes
            .position_3d_high
            .map(|p| (buf.new_f32(p.data), p.size));
        let position_3d_low = geo
            .attributes
            .position_3d_low
            .map(|p| (buf.new_f32(p.data), p.size));
        let normal = geo.attributes.normal.map(|n| (buf.new_f32(n.data), n.size));
        let scale_normal_and_cap = geo
            .attributes
            .scale_normal_and_cap
            .map(|n| (buf.new_f32(n.data), n.size));
        let batch_ids = geo
            .attributes
            .batch_ids
            .map(|n| (buf.new_f32(n.data), n.size));
        let batch_index = geo
            .attributes
            .batch_index
            .map(|n| (buf.new_u32(n.data), n.size));
        let indices = buf.new_u32(geo.indices);

        TransferablePolygonGeometry {
            position: position.map(|(position, size)| TransferableFloatAttribute {
                data: position,
                size,
            }),
            position_3d_high: position_3d_high
                .map(|(data, size)| TransferableFloatAttribute { data, size }),
            position_3d_low: position_3d_low
                .map(|(data, size)| TransferableFloatAttribute { data, size }),
            normal: normal.map(|(normal, size)| TransferableFloatAttribute { data: normal, size }),
            scale_normal_and_cap: scale_normal_and_cap.map(|(scale_normal_and_cap, size)| {
                TransferableFloatAttribute {
                    data: scale_normal_and_cap,
                    size,
                }
            }),
            batch_ids: batch_ids.map(|(batch_ids, size)| TransferableFloatAttribute {
                data: batch_ids,
                size,
            }),
            batch_index: batch_index.map(|(batch_index, size)| TransferableUintAttribute {
                data: batch_index,
                size,
            }),
            indices,
        }
    }
}

impl TransferablePolygonGeometry {
    pub fn remove_from_buf(&mut self, buf: &mut BufferStore, batch_table: &mut BatchTable) {
        for id in self.remove_buffers(buf) {
            batch_table.release_global_batch_id(id);
        }
    }

    /// Free the geometry's BufferStore entries and return the global batch ids
    /// found in the batch_ids attribute. The caller must release the returned
    /// ids via `BatchTable::release_global_batch_id`; the split lets component
    /// `on_remove` hooks free the two resources without borrowing them at the
    /// same time.
    pub fn remove_buffers(&mut self, buf: &mut BufferStore) -> Vec<u32> {
        if let Some(position) = &self.position {
            buf.remove(&position.data);
        }
        if let Some(position_3d_high) = &self.position_3d_high {
            buf.remove(&position_3d_high.data);
        }
        if let Some(position_3d_low) = &self.position_3d_low {
            buf.remove(&position_3d_low.data);
        }
        buf.remove(&self.indices);

        if let Some(normal) = &self.normal {
            buf.remove(&normal.data);
        }
        if let Some(normal) = &self.scale_normal_and_cap {
            buf.remove(&normal.data);
        }
        let mut removed_batch_ids = Vec::new();
        if let Some(batch_ids) = &self.batch_ids
            && let Some(vec_ids) = buf.remove_f32(&batch_ids.data)
        {
            for i in (0..vec_ids.len()).step_by(batch_ids.size as usize) {
                removed_batch_ids.push(vec_ids[i] as u32);
            }
        }
        if let Some(batch_index) = &self.batch_index {
            buf.remove(&batch_index.data);
        }
        removed_batch_ids
    }
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferablePolygonOutlineGeometry {
    pub position: Option<TransferableFloatAttribute>,
    pub position_3d_high: Option<TransferableFloatAttribute>,
    pub position_3d_low: Option<TransferableFloatAttribute>,
    pub scale_normal_and_cap: Option<TransferableFloatAttribute>,
    pub skip_indices: Option<Handle>,
    pub batch_index: Option<TransferableFloatAttribute>,
}

impl TransferablePolygonOutlineGeometry {
    pub fn with_buf(
        buf: &mut BufferStore,
        geo: Option<navara_geometry::PolygonOutlineGeometry>,
    ) -> TransferablePolygonOutlineGeometry {
        let Some(geo) = geo else {
            return TransferablePolygonOutlineGeometry::default();
        };

        let position = TransferableFloatAttribute {
            data: buf.new_f32(geo.position.data),
            size: geo.position.size,
        };

        let position_3d_high = geo.position_3d_high.map(|p| TransferableFloatAttribute {
            data: buf.new_f32(p.data),
            size: p.size,
        });

        let position_3d_low = geo.position_3d_low.map(|p| TransferableFloatAttribute {
            data: buf.new_f32(p.data),
            size: p.size,
        });

        let scale_normal_and_cap = TransferableFloatAttribute {
            data: buf.new_f32(geo.scale_normal_and_cap.data),
            size: geo.scale_normal_and_cap.size,
        };

        let skip_indices = buf.new_u32(geo.skip_indices);

        TransferablePolygonOutlineGeometry {
            position: Some(position),
            position_3d_high,
            position_3d_low,
            scale_normal_and_cap: Some(scale_normal_and_cap),
            skip_indices: Some(skip_indices),
            batch_index: None,
        }
    }
}

impl TransferablePolygonOutlineGeometry {
    pub fn remove_from_buf(&mut self, buf: &mut BufferStore) {
        if let Some(position) = &self.position {
            buf.remove(&position.data);
        }

        if let Some(position_3d_high) = &self.position_3d_high {
            buf.remove(&position_3d_high.data);
        }

        if let Some(position_3d_low) = &self.position_3d_low {
            buf.remove(&position_3d_low.data);
        }

        if let Some(scale_normal_and_cap) = &self.scale_normal_and_cap {
            buf.remove(&scale_normal_and_cap.data);
        }

        if let Some(skip_indices) = &self.skip_indices {
            buf.remove(skip_indices);
        }

        if let Some(batch_index) = &self.batch_index {
            buf.remove(&batch_index.data);
        }
    }
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferablePointGeometry {
    pub position: Option<TransferableFloatAttribute>,
    pub position_3d_high: Option<TransferableFloatAttribute>,
    pub position_3d_low: Option<TransferableFloatAttribute>,
    pub batch_ids: TransferableFloatAttribute,
    pub batch_index: TransferableUintAttribute,
}

impl TransferablePointGeometry {
    /// Create TransferablePointGeometry with RTC (Relative To Center) positions
    /// Used for MVT points and single points with relative coordinates
    pub fn with_buf_rtc(
        buf: &mut BufferStore,
        positions: Vec<f32>,
        batch_indices: Vec<u32>,
        batch_ids: Vec<f32>,
    ) -> Self {
        Self {
            position: Some(TransferableFloatAttribute {
                data: buf.new_f32(positions),
                size: 3, // x, y, z for each point
            }),
            position_3d_high: None,
            position_3d_low: None,
            batch_ids: TransferableFloatAttribute {
                data: buf.new_f32(batch_ids),
                size: 1, // batch_id
            },
            batch_index: TransferableUintAttribute {
                data: buf.new_u32(batch_indices),
                size: 1,
            },
        }
    }

    /// Create TransferablePointGeometry with RTE (Relative To Eye) positions
    /// Used for GeoJSON points with absolute world coordinates
    /// Callers are responsible for encoding positions into high/low f32 vectors
    /// via `EncodedVec3` before calling this method.
    pub fn with_buf_rte(
        buf: &mut BufferStore,
        positions_high: Vec<f32>,
        positions_low: Vec<f32>,
        batch_indices: Vec<u32>,
        batch_ids: Vec<f32>,
    ) -> Self {
        Self {
            position: None,
            position_3d_high: Some(TransferableFloatAttribute {
                data: buf.new_f32(positions_high),
                size: 3,
            }),
            position_3d_low: Some(TransferableFloatAttribute {
                data: buf.new_f32(positions_low),
                size: 3,
            }),
            batch_ids: TransferableFloatAttribute {
                data: buf.new_f32(batch_ids),
                size: 1,
            },
            batch_index: TransferableUintAttribute {
                data: buf.new_u32(batch_indices),
                size: 1,
            },
        }
    }

    pub fn remove_from_buf(&mut self, buf: &mut BufferStore, batch_table: &mut BatchTable) {
        // Remove position data (RTC or RTE)
        if let Some(position) = &self.position {
            buf.remove(&position.data);
        }
        if let Some(position_3d_high) = &self.position_3d_high {
            buf.remove(&position_3d_high.data);
        }
        if let Some(position_3d_low) = &self.position_3d_low {
            buf.remove(&position_3d_low.data);
        }

        if let Some(vec_ids) = buf.remove_f32(&self.batch_ids.data) {
            for i in (0..vec_ids.len()).step_by(self.batch_ids.size as usize) {
                batch_table.release_global_batch_id(vec_ids[i] as u32);
            }
        };

        buf.remove(&self.batch_index.data);
    }
}

impl From<&crate::batched_geometry::BatchedPointGeometry> for TransferablePointGeometry {
    fn from(geom: &crate::batched_geometry::BatchedPointGeometry) -> Self {
        use crate::batched_geometry::PointEncoding;
        match geom.encoding {
            PointEncoding::Rtc => Self {
                position: Some(TransferableFloatAttribute {
                    data: geom.encoded_a,
                    size: 3,
                }),
                position_3d_high: None,
                position_3d_low: None,
                batch_ids: TransferableFloatAttribute {
                    data: geom.batch_ids,
                    size: 1,
                },
                batch_index: TransferableUintAttribute {
                    data: geom.batch_indices,
                    size: 1,
                },
            },
            PointEncoding::Rte => Self {
                position: None,
                position_3d_high: Some(TransferableFloatAttribute {
                    data: geom.encoded_a,
                    size: 3,
                }),
                position_3d_low: Some(TransferableFloatAttribute {
                    data: geom.encoded_b.unwrap(),
                    size: 3,
                }),
                batch_ids: TransferableFloatAttribute {
                    data: geom.batch_ids,
                    size: 1,
                },
                batch_index: TransferableUintAttribute {
                    data: geom.batch_indices,
                    size: 1,
                },
            },
        }
    }
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferableSingleGeometry {
    pub batch_id: Option<u32>,
    pub selected: Option<u32>,
}

#[derive(Component, Clone, Debug, Default, PartialEq)]
pub struct TransferableModelGeometry {
    pub batch_ids: Option<TransferableFloatAttribute>,
}

impl TransferableModelGeometry {
    pub fn remove_from_buf(&mut self, buf: &mut BufferStore, batch_table: &mut BatchTable) {
        let Some(ids) = &self.batch_ids else {
            return;
        };

        let Some(vec_ids) = buf.get_u32(&ids.data) else {
            return;
        };

        for i in (0..vec_ids.len()).step_by(ids.size as usize) {
            batch_table.release_global_batch_id(vec_ids[i]);
        }

        buf.remove(&ids.data);
    }
}
