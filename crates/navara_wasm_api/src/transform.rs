use wasm_bindgen::prelude::*;

use navara_camera::{get_pick_ray_from_camera, ray_ellipsoid_intersect};
use navara_core::{CRS, WGS84_64, xyz_to_vec3};
use navara_math::{FloatType, Vec3};
use navara_wasm_types::{
    CameraFrustum, LLE, Transform as TransformWasm, Vec2 as Vec2Wasm, Vec3 as Vec3Wasm, Window,
};

#[wasm_bindgen(js_name = geodeticToXyz)]
pub fn geodetic_to_ecef(lle: LLE) -> Vec3Wasm {
    let lle_pt = Vec3::new(lle.lng.to_degrees(), lle.lat.to_degrees(), lle.height);

    let ecef_pt = CRS::Geographic.to_vec3(WGS84_64, lle_pt, 0.0);

    Vec3Wasm {
        x: ecef_pt.x,
        y: ecef_pt.y,
        z: ecef_pt.z,
    }
}

#[wasm_bindgen(js_name = xyzToGeodetic)]
pub fn ecef_to_geodetic(vec3: Vec3Wasm) -> LLE {
    let lle = CRS::Geocentric.to_lle(WGS84_64, vec3.into(), 0.0);
    lle.into()
}

#[wasm_bindgen(js_name = angleToRadian)]
pub fn angle_to_radian(degree: FloatType) -> FloatType {
    degree.to_radians()
}

#[wasm_bindgen(js_name = angleToDegree)]
pub fn angle_to_degree(radian: FloatType) -> FloatType {
    radian.to_degrees()
}

#[wasm_bindgen(js_name = screenToWorld)]
pub fn screen_to_world(
    window: Window,
    transform: TransformWasm,
    frustum: CameraFrustum,
    screen_pos: Vec2Wasm,
) -> Option<Vec3Wasm> {
    let window: navara_window::Window = (&window).into();
    let transform: navara_math::Transform = (&transform).into();
    let frustum: navara_camera::CameraFrustum = navara_camera::CameraFrustum::new(
        &transform,
        frustum.near,
        frustum.far,
        frustum.fov,
        frustum.aspect_ratio,
    );

    let ray = get_pick_ray_from_camera(&window, &transform, &frustum, screen_pos.into());

    let Some(point) = ray_ellipsoid_intersect(&ray, WGS84_64) else {
        // If no intersection, return the origin point
        return None;
    };

    Some(ray.get_point(point).into())
}

#[wasm_bindgen(js_name = geodeticSurfaceNormal)]
pub fn geodetic_surface_normal(lle: LLE) -> Vec3Wasm {
    let normal = WGS84_64.geodetic_surface_normal_from_lle((&lle).into());
    let normal_vec3 = xyz_to_vec3(normal).normalize();
    normal_vec3.into()
}

#[wasm_bindgen(js_name = scaleToGeodeticSurface)]
pub fn scale_to_geodetic_surface(vec3: Vec3Wasm) -> Option<Vec3Wasm> {
    WGS84_64
        .scale_to_geodetic_surface(vec3.into())
        .map(Into::into)
}

#[wasm_bindgen(js_name = eastNorthUpToFixedFrame)]
pub fn east_north_up_to_fixed_frame(origin: Vec3Wasm) -> Vec<f64> {
    let mat4 = navara_core::east_north_up_to_fixed_frame(origin.into(), WGS84_64);
    mat4.to_cols_array().to_vec()
}

#[wasm_bindgen(js_name = northEastDownToFixedFrame)]
pub fn north_east_down_to_fixed_frame(origin: Vec3Wasm) -> Vec<f64> {
    let mat4 = navara_core::north_east_down_to_fixed_frame(origin.into(), WGS84_64);
    mat4.to_cols_array().to_vec()
}

#[wasm_bindgen(js_name = northUpEastToFixedFrame)]
pub fn north_up_east_to_fixed_frame(origin: Vec3Wasm) -> Vec<f64> {
    let mat4 = navara_core::north_up_east_to_fixed_frame(origin.into(), WGS84_64);
    mat4.to_cols_array().to_vec()
}

#[wasm_bindgen(js_name = northWestUpToFixedFrame)]
pub fn north_west_up_to_fixed_frame(origin: Vec3Wasm) -> Vec<f64> {
    let mat4 = navara_core::north_west_up_to_fixed_frame(origin.into(), WGS84_64);
    mat4.to_cols_array().to_vec()
}

#[wasm_bindgen(js_name = worldToScreen)]
pub fn world_to_screen(
    window: Window,
    transform: TransformWasm,
    frustum: CameraFrustum,
    world_pos: Vec3Wasm,
) -> Option<Vec2Wasm> {
    let window: navara_window::Window = (&window).into();
    let transform: navara_math::Transform = (&transform).into();
    let frustum: navara_camera::CameraFrustum = navara_camera::CameraFrustum::new(
        &transform,
        frustum.near,
        frustum.far,
        frustum.fov,
        frustum.aspect_ratio,
    );

    let world_pos: Vec3 = world_pos.into();

    let camera_pos = transform.transform_point(Vec3::ZERO);
    let forward = transform.forward();
    let right = transform.right();
    let up = transform.up();

    // Vector from camera to world position
    let to_world = world_pos - camera_pos;

    // Check if point is behind camera
    let distance_along_forward = to_world.dot(forward);
    if distance_along_forward <= frustum.near {
        return None;
    }

    // Project to camera's near plane
    let scale = frustum.near / distance_along_forward;
    let near_point = camera_pos + forward * frustum.near;
    let projected_point = camera_pos + to_world * scale;

    // Get offset from near plane center
    let offset = projected_point - near_point;

    // Convert to camera coordinates
    let x_offset = offset.dot(right);
    let y_offset = offset.dot(up);

    // Calculate screen coordinates using perspective projection. `fov` is
    // the vertical field of view, so `tan_phi` is the vertical near-plane
    // half-extent.
    let tan_phi = (frustum.fov * 0.5).tan() as f64;
    let tan_theta = frustum.aspect_ratio * tan_phi as f64;

    let near = frustum.near;
    let x_ndc = x_offset / (near * tan_theta);
    let y_ndc = y_offset / (near * tan_phi);

    // Check if point is within view frustum
    if x_ndc.abs() > 1.0 || y_ndc.abs() > 1.0 {
        return None;
    }

    // Convert NDC to screen coordinates
    let width = window.raw_width();
    let height = window.raw_height();

    let screen_x = (x_ndc + 1.0) * width * 0.5;
    let screen_y = height - ((y_ndc + 1.0) * height * 0.5);

    Some(Vec2Wasm {
        x: screen_x,
        y: screen_y,
    })
}
