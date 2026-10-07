//! Polygon geometry for standalone meshes, built with the vector layer's
//! per-feature construction.

use navara_core::{Angle, CRS, Extent};
use navara_geometry::{Hierarchy, PolygonResource, WindingOrder};
use navara_wasm_types::{
    PolygonMaterial,
    polygon::{ConstructedPolygonGeometry, ConstructedPolygonOutlineGeometry, PolygonGeometry},
};
use wasm_bindgen::prelude::*;

/// Splits concatenated rings into the outer ring and holes. Winding is left
/// `Unknown` so `align_winding_order` decides it per ring.
pub(crate) fn hierarchy_from_rings(coordinates: &[f64], ring_lengths: &[u32]) -> Option<Hierarchy> {
    let mut offset = 0usize;
    let mut rings = Vec::with_capacity(ring_lengths.len());
    for length in ring_lengths {
        let end = offset + (*length as usize) * 3;
        if end > coordinates.len() {
            return None;
        }
        rings.push(coordinates[offset..end].to_vec());
        offset = end;
    }

    let mut rings = rings.into_iter();
    let outer_ring = rings.next()?;
    let holes: Vec<Hierarchy> = rings
        .map(|outer_ring| Hierarchy {
            outer_ring,
            holes: None,
            expected_winding_order: WindingOrder::Unknown,
        })
        .collect();

    Some(Hierarchy {
        outer_ring,
        holes: (!holes.is_empty()).then_some(holes),
        expected_winding_order: WindingOrder::Unknown,
    })
}

/// Builds the geometry of one standalone polygon.
///
/// `coordinates` holds the outer ring then the holes as `[x, y, z, ...]`, with
/// vertex counts in `ring_lengths`. `geocentric` reads them as ECEF metres
/// instead of lng/lat/height. `material` is a `polygon` layer material.
///
/// Throws when `material` does not deserialize. Returns `undefined` when the
/// outer ring has fewer than three vertices or is collinear.
#[wasm_bindgen(js_name = buildPolygonGeometry)]
pub fn build_polygon_geometry(
    coordinates: &[f64],
    ring_lengths: &[u32],
    geocentric: bool,
    material: JsValue,
) -> Result<Option<ConstructedPolygonGeometry>, JsError> {
    let material: PolygonMaterial = serde_wasm_bindgen::from_value(material)?;
    Ok(build_polygon(
        coordinates,
        ring_lengths,
        geocentric,
        material,
    ))
}

fn build_polygon(
    coordinates: &[f64],
    ring_lengths: &[u32],
    geocentric: bool,
    material: PolygonMaterial,
) -> Option<ConstructedPolygonGeometry> {
    let material: navara_material::PolygonMaterial = material.into();
    let hierarchy = hierarchy_from_rings(coordinates, ring_lengths)?;
    let crs = if geocentric {
        CRS::Geocentric
    } else {
        CRS::Geographic
    };

    let mut polygon_resource = PolygonResource::new();
    let (extent, result) = navara_feature_component::polygon::construct_polygon_feature(
        hierarchy,
        &crs,
        &material,
        &mut polygon_resource,
        // No tile center to be relative to, so RTE.
        true,
    );
    let (extent, result) = (extent?, result?);

    let outline = result.outline.map(|outline| {
        ConstructedPolygonOutlineGeometry::new(
            outline.position.into(),
            outline.position_3d_high.map(Into::into),
            outline.position_3d_low.map(Into::into),
            outline.scale_normal_and_cap.into(),
            outline.skip_indices,
            None,
        )
    });

    Some(ConstructedPolygonGeometry::new(
        PolygonGeometry::new(result.geometry.attributes.into(), result.geometry.indices),
        Some((&extent).into()),
        None,
        outline,
    ))
}

/// `[min, max]` height a clamp-to-ground polygon volume over the extent (radians)
/// must span to enclose ground heights from `min_height` to `max_height`.
#[wasm_bindgen(js_name = polygonGroundVolume)]
pub fn polygon_ground_volume(
    min_height: f64,
    max_height: f64,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
) -> Vec<f64> {
    let (min, max) = navara_geometry::polygon_ground_volume(
        (min_height, max_height),
        Extent {
            west: Angle::new(west),
            south: Angle::new(south),
            east: Angle::new(east),
            north: Angle::new(north),
        },
    );
    vec![min, max]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_rings_by_length() {
        let coordinates = [
            // outer ring
            0., 0., 0., 1., 0., 0., 1., 1., 0., //
            // hole
            0.2, 0.2, 0., 0.4, 0.2, 0., 0.4, 0.4, 0.,
        ];
        let hierarchy = hierarchy_from_rings(&coordinates, &[3, 3]).unwrap();

        assert_eq!(hierarchy.outer_ring, coordinates[..9]);
        let holes = hierarchy.holes.unwrap();
        assert_eq!(holes.len(), 1);
        assert_eq!(holes[0].outer_ring, coordinates[9..]);
    }

    #[test]
    fn leaves_holes_unset_for_a_single_ring() {
        let coordinates = [0., 0., 0., 1., 0., 0., 1., 1., 0.];
        let hierarchy = hierarchy_from_rings(&coordinates, &[3]).unwrap();

        assert!(hierarchy.holes.is_none());
    }

    #[test]
    fn rejects_lengths_past_the_buffer() {
        let coordinates = [0., 0., 0., 1., 0., 0.];
        assert!(hierarchy_from_rings(&coordinates, &[3]).is_none());
    }
}
