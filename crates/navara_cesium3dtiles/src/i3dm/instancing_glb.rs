//! Rewrites the glTF of an I3DM so it draws its instances itself with
//! `EXT_mesh_gpu_instancing`.

use navara_math::{Mat4, PI_OVER_TWO, Quat, Vec3};
use navara_parser::cesium3dtiles::property_table::GlbSchemaParser;
use serde_json::{Value, json};

use super::instances::Instances;

const CHUNK_JSON: u32 = 0x4E4F534A;
const CHUNK_BIN: u32 = 0x004E4942;

/// Instance attribute holding each instance's feature index, named by
/// `EXT_instance_features` as 3D Tiles 1.1 instancing does.
const FEATURE_ID_ATTRIBUTE: &str = "_FEATURE_ID_0";

/// Returns `glb` with every mesh of its scene instanced by `instances`.
///
/// A glTF placed in a tile is `Y_UP_TO_Z_UP * W * v` for a node with the
/// world matrix `W`; an I3DM instance applies its transform `M` in the tile
/// frame after that. Each mesh node is moved to the scene root with the
/// instance transforms `Y_UP_TO_Z_UP⁻¹ * M * Y_UP_TO_Z_UP * W`, so the
/// placement of the glTF stays as is. A transform with non-uniform scale
/// under a rotated node is sheared, which instance TRS cannot express; it is
/// approximated.
///
/// `None` when `glb` is malformed or has no scene.
pub(crate) fn instance_glb(glb: &[u8], instances: &Instances) -> Option<Vec<u8>> {
    let GlbSchemaParser {
        json: mut gltf,
        binary: bin,
        ..
    } = GlbSchemaParser::new(glb)?;

    let scene_index = gltf.get("scene").and_then(Value::as_u64).unwrap_or(0) as usize;
    let roots: Vec<usize> = gltf
        .get("scenes")?
        .get(scene_index)?
        .get("nodes")?
        .as_array()?
        .iter()
        .map(|n| Some(n.as_u64()? as usize))
        .collect::<Option<_>>()?;
    let mesh_nodes = mesh_nodes(gltf.get("nodes")?.as_array()?, &roots)?;

    let y_up_to_z_up = Mat4::from_quat(Quat::from_rotation_x(PI_OVER_TWO));
    let z_up_to_y_up = y_up_to_z_up.inverse();
    let tile_frame: Vec<Mat4> = instances
        .transforms
        .iter()
        .map(|m| z_up_to_y_up * *m * y_up_to_z_up)
        .collect();

    let mut data = Vec::new();
    let mut accessors = Vec::new();
    let count = instances.batch_ids.len();
    let mut push_accessor = |accessors: &mut Vec<Value>, values: &[f32], type_: &str| {
        accessors.push(json!({
            "byteOffset": data.len(),
            "componentType": 5126,
            "count": count,
            "type": type_,
        }));
        data.extend(values.iter().flat_map(|v| v.to_le_bytes()));
    };

    let batch_ids: Vec<f32> = instances.batch_ids.iter().map(|&id| id as f32).collect();
    push_accessor(&mut accessors, &batch_ids, "SCALAR");
    // Nodes with the same world matrix share their TRS accessors.
    let mut trs_by_world: Vec<(Mat4, usize)> = Vec::new();
    let mut node_trs = Vec::with_capacity(mesh_nodes.len());
    for (_, world) in &mesh_nodes {
        let first = match trs_by_world.iter().find(|(w, _)| w == world) {
            Some(&(_, first)) => first,
            None => {
                let mut translations = Vec::with_capacity(3 * count);
                let mut rotations = Vec::with_capacity(4 * count);
                let mut scales = Vec::with_capacity(3 * count);
                for m in &tile_frame {
                    let (s, r, t) = (*m * *world).to_scale_rotation_translation();
                    translations.extend(t.to_array().map(|v| v as f32));
                    rotations.extend(r.normalize().to_array().map(|v| v as f32));
                    scales.extend(s.to_array().map(|v| v as f32));
                }
                let first = accessors.len();
                push_accessor(&mut accessors, &translations, "VEC3");
                push_accessor(&mut accessors, &rotations, "VEC4");
                push_accessor(&mut accessors, &scales, "VEC3");
                trs_by_world.push((*world, first));
                first
            }
        };
        node_trs.push(first);
    }

    let buffer_view = append_buffer_view(&mut gltf, bin.map(<[u8]>::len), data.len())?;
    let accessor_base = array_mut(&mut gltf, "accessors").len();
    let gltf_accessors = array_mut(&mut gltf, "accessors");
    for mut accessor in accessors {
        accessor["bufferView"] = json!(buffer_view.index);
        gltf_accessors.push(accessor);
    }

    let nodes = array_mut(&mut gltf, "nodes");
    let mut instanced_roots = Vec::with_capacity(mesh_nodes.len());
    for ((node, _), first) in mesh_nodes.iter().zip(node_trs) {
        let source = &nodes[*node];
        let mut instanced = json!({
            "mesh": source["mesh"],
            "extensions": {
                "EXT_mesh_gpu_instancing": {
                    "attributes": {
                        "TRANSLATION": accessor_base + first,
                        "ROTATION": accessor_base + first + 1,
                        "SCALE": accessor_base + first + 2,
                        FEATURE_ID_ATTRIBUTE: accessor_base,
                    }
                },
                "EXT_instance_features": {
                    "featureIds": [{
                        "featureCount": instances.batch_length,
                        "attribute": 0,
                    }]
                }
            }
        });
        if let Some(weights) = source.get("weights") {
            instanced["weights"] = weights.clone();
        }
        instanced_roots.push(nodes.len());
        nodes.push(instanced);
    }
    gltf["scenes"][scene_index]["nodes"] = json!(instanced_roots);

    let used = array_mut(&mut gltf, "extensionsUsed");
    for extension in ["EXT_mesh_gpu_instancing", "EXT_instance_features"] {
        if !used.iter().any(|e| e == extension) {
            used.push(json!(extension));
        }
    }

    Some(join_glb(
        &gltf,
        bin.unwrap_or_default(),
        buffer_view.byte_offset,
        &data,
    ))
}

/// Mesh nodes reachable from `roots`, with their world matrices.
fn mesh_nodes(nodes: &[Value], roots: &[usize]) -> Option<Vec<(usize, Mat4)>> {
    let mut visited = vec![false; nodes.len()];
    let mut stack: Vec<(usize, Mat4)> = roots.iter().rev().map(|&n| (n, Mat4::IDENTITY)).collect();
    let mut found = Vec::new();
    while let Some((index, parent)) = stack.pop() {
        if std::mem::replace(visited.get_mut(index)?, true) {
            return None;
        }
        let node = &nodes[index];
        let world = parent * local_matrix(node)?;
        if node.get("mesh").is_some() {
            found.push((index, world));
        }
        if let Some(children) = node.get("children").and_then(Value::as_array) {
            for child in children.iter().rev() {
                stack.push((child.as_u64()? as usize, world));
            }
        }
    }
    Some(found)
}

fn local_matrix(node: &Value) -> Option<Mat4> {
    let floats = |key: &str| -> Option<Option<Vec<f64>>> {
        let Some(value) = node.get(key) else {
            return Some(None);
        };
        value
            .as_array()?
            .iter()
            .map(Value::as_f64)
            .collect::<Option<Vec<_>>>()
            .map(Some)
    };
    if let Some(m) = floats("matrix")? {
        return Some(Mat4::from_cols_slice(m.get(..16)?));
    }
    let t =
        floats("translation")?.map_or(Some(Vec3::ZERO), |t| Some(Vec3::from_slice(t.get(..3)?)))?;
    let r = match floats("rotation")? {
        Some(r) => Quat::from_slice(r.get(..4)?),
        None => Quat::IDENTITY,
    };
    let s = floats("scale")?.map_or(Some(Vec3::ONE), |s| Some(Vec3::from_slice(s.get(..3)?)))?;
    Some(Mat4::from_scale_rotation_translation(s, r, t))
}

struct BufferViewSlot {
    index: usize,
    /// Where the appended data starts in the BIN chunk.
    byte_offset: usize,
}

/// Adds a buffer view of `byte_length` bytes after the BIN chunk's data,
/// creating the GLB buffer when there is no BIN chunk.
fn append_buffer_view(
    gltf: &mut Value,
    bin_length: Option<usize>,
    byte_length: usize,
) -> Option<BufferViewSlot> {
    let byte_offset = bin_length.map_or(0, |len| len.next_multiple_of(4));
    if bin_length.is_some() {
        array_mut(gltf, "buffers")
            .first_mut()?
            .as_object_mut()?
            .insert("byteLength".into(), json!(byte_offset + byte_length));
    } else {
        // Only the first buffer can be the BIN chunk.
        array_mut(gltf, "buffers").insert(0, json!({ "byteLength": byte_length }));
        for view in array_mut(gltf, "bufferViews") {
            for pointer in [
                "/buffer",
                "/extensions/EXT_meshopt_compression/buffer",
                "/extensions/KHR_meshopt_compression/buffer",
            ] {
                if let Some(buffer) = view.pointer_mut(pointer) {
                    *buffer = json!(buffer.as_u64()? + 1);
                }
            }
        }
    }
    let views = array_mut(gltf, "bufferViews");
    views.push(json!({
        "buffer": 0,
        "byteOffset": byte_offset,
        "byteLength": byte_length,
    }));
    Some(BufferViewSlot {
        index: views.len() - 1,
        byte_offset,
    })
}

/// The top-level array `key` of `gltf`, created when missing.
fn array_mut<'a>(gltf: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    let value = &mut gltf[key];
    if !value.is_array() {
        *value = json!([]);
    }
    value.as_array_mut().unwrap()
}

/// A GLB of `gltf` whose BIN chunk is `bin`, then `data` at `data_offset`.
fn join_glb(gltf: &Value, bin: &[u8], data_offset: usize, data: &[u8]) -> Vec<u8> {
    let mut json = serde_json::to_vec(gltf).unwrap();
    json.resize(json.len().next_multiple_of(4), b' ');
    let bin_length = (data_offset + data.len()).next_multiple_of(4);
    let total = 12 + 8 + json.len() + 8 + bin_length;
    let mut glb = Vec::with_capacity(total);
    glb.extend_from_slice(b"glTF");
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&(total as u32).to_le_bytes());
    glb.extend_from_slice(&(json.len() as u32).to_le_bytes());
    glb.extend_from_slice(&CHUNK_JSON.to_le_bytes());
    glb.extend_from_slice(&json);
    glb.extend_from_slice(&(bin_length as u32).to_le_bytes());
    glb.extend_from_slice(&CHUNK_BIN.to_le_bytes());
    let bin_start = glb.len();
    glb.extend_from_slice(bin);
    glb.resize(bin_start + data_offset, 0);
    glb.extend_from_slice(data);
    glb.resize(total, 0);
    glb
}

#[cfg(test)]
mod tests {

    use super::*;

    /// The glTF JSON and the BIN chunk data of a GLB.
    fn split_glb(glb: &[u8]) -> (Value, Option<&[u8]>) {
        let parser = GlbSchemaParser::new(glb).unwrap();
        (parser.json, parser.binary)
    }

    fn instances(transforms: Vec<Mat4>) -> Instances {
        let count = transforms.len() as u32;
        Instances {
            center: Vec3::ZERO,
            transforms,
            batch_ids: (0..count).collect(),
            batch_length: count,
        }
    }

    fn accessor_f32s(gltf: &Value, bin: &[u8], accessor: &Value) -> Vec<f32> {
        let accessor = &gltf["accessors"][accessor.as_u64().unwrap() as usize];
        let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().unwrap() as usize];
        let start = (view["byteOffset"].as_u64().unwrap()
            + accessor["byteOffset"].as_u64().unwrap()) as usize;
        let components = match accessor["type"].as_str().unwrap() {
            "SCALAR" => 1,
            "VEC3" => 3,
            _ => 4,
        };
        let length = components * accessor["count"].as_u64().unwrap() as usize;
        bin[start..start + 4 * length]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect()
    }

    /// Applies the instance TRS of `node` to `v`, then `Y_UP_TO_Z_UP`.
    fn place(gltf: &Value, bin: &[u8], node: &Value, instance: usize, v: Vec3) -> Vec3 {
        let attributes = &node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"];
        let t = accessor_f32s(gltf, bin, &attributes["TRANSLATION"]);
        let r = accessor_f32s(gltf, bin, &attributes["ROTATION"]);
        let s = accessor_f32s(gltf, bin, &attributes["SCALE"]);
        let f = |a: &[f32], n: usize| -> Vec<f64> {
            a[n * instance..n * instance + n]
                .iter()
                .map(|&v| f64::from(v))
                .collect()
        };
        let m = Mat4::from_scale_rotation_translation(
            Vec3::from_slice(&f(&s, 3)),
            Quat::from_slice(&f(&r, 4)),
            Vec3::from_slice(&f(&t, 3)),
        );
        Quat::from_rotation_x(PI_OVER_TWO) * m.transform_point3(v)
    }

    #[test]
    fn instances_apply_after_the_node_and_up_axis_transforms() {
        let gltf = json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "children": [1], "translation": [0., 0., 5.] },
                { "mesh": 0, "scale": [2., 2., 2.] },
            ],
            "meshes": [{ "primitives": [] }],
            "buffers": [{ "byteLength": 3 }],
            "bufferViews": [{ "buffer": 0, "byteLength": 3 }],
        });
        let glb = join_glb(&gltf, &[1, 2, 3], 3, &[]);
        let transforms = vec![
            Mat4::IDENTITY,
            Mat4::from_translation(Vec3::new(10., 0., 0.))
                * Mat4::from_rotation_z(PI_OVER_TWO)
                * Mat4::from_scale(Vec3::new(1., 3., 1.)),
        ];
        let out = instance_glb(&glb, &instances(transforms.clone())).unwrap();
        let (out_gltf, out_bin) = split_glb(&out);
        let out_bin = out_bin.unwrap();

        assert_eq!(&out_bin[..3], &[1, 2, 3]);
        assert_eq!(
            out_gltf["extensionsUsed"],
            json!(["EXT_mesh_gpu_instancing", "EXT_instance_features"])
        );
        let roots = out_gltf["scenes"][0]["nodes"].as_array().unwrap();
        assert_eq!(roots.len(), 1);
        let node = &out_gltf["nodes"][roots[0].as_u64().unwrap() as usize];
        assert_eq!(node["mesh"], json!(0));

        let y_up_to_z_up = Quat::from_rotation_x(PI_OVER_TWO);
        let node_world =
            Mat4::from_translation(Vec3::new(0., 0., 5.)) * Mat4::from_scale(Vec3::splat(2.));
        let v = Vec3::new(1., 0.5, 0.25);
        for (i, m) in transforms.iter().enumerate() {
            let expected = m.transform_point3(y_up_to_z_up * node_world.transform_point3(v));
            assert_close!(
                place(&out_gltf, out_bin, node, i, v),
                expected,
                epsilon = 1e-5
            );
        }
        let batch_ids = accessor_f32s(
            &out_gltf,
            out_bin,
            &node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"][FEATURE_ID_ATTRIBUTE],
        );
        assert_eq!(batch_ids, [0., 1.]);
        assert_eq!(
            node["extensions"]["EXT_instance_features"]["featureIds"],
            json!([{ "featureCount": 2, "attribute": 0 }])
        );
    }

    #[test]
    fn a_glb_without_bin_chunk_gets_the_first_buffer() {
        let gltf = json!({
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0 }],
            "buffers": [{ "uri": "external.bin", "byteLength": 8 }, { "byteLength": 16 }],
            "bufferViews": [{
                "buffer": 1,
                "byteLength": 16,
                "extensions": { "EXT_meshopt_compression": { "buffer": 0, "byteLength": 8 } },
            }],
        });
        let mut glb = join_glb(&gltf, &[], 0, &[]);
        // Drop the empty BIN chunk.
        glb.truncate(glb.len() - 8);
        let out = instance_glb(&glb, &instances(vec![Mat4::IDENTITY])).unwrap();
        let (out_gltf, _) = split_glb(&out);
        assert_eq!(out_gltf["buffers"][0]["uri"], Value::Null);
        assert_eq!(out_gltf["buffers"][1]["uri"], json!("external.bin"));
        let view = &out_gltf["bufferViews"][0];
        assert_eq!(view["buffer"], json!(2));
        assert_eq!(
            view["extensions"]["EXT_meshopt_compression"]["buffer"],
            json!(1)
        );
        assert_eq!(out_gltf["bufferViews"][1]["buffer"], json!(0));
    }
}
