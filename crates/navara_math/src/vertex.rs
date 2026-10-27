use std::hash::Hash;

use approx::AbsDiffEq;
pub use bevy_math::{
    DMat2 as RawDMat2, DMat3 as RawDMat3, DMat4 as RawDMat4, DQuat as RawDQuat, DVec2 as RawDVec2,
    DVec3 as RawDVec3, DVec4 as RawDVec4, Dir2 as RawDir2, Dir3A as RawDir3,
    EulerRot as RawEulerRot, Mat2 as RawMat2, Mat3 as RawMat3, Mat4 as RawMat4, Quat as RawQuat,
    Vec2 as RawVec2, Vec2Swizzles, Vec3 as RawVec3, Vec3Swizzles, Vec4 as RawVec4, Vec4Swizzles,
};

use crate::{EPSILON10, FloatType};

pub type Vec4 = RawDVec4;
pub type Vec3 = RawDVec3;
pub type Vec2 = RawDVec2;
pub type Quat = RawDQuat;
pub type EulerRot = RawEulerRot;
pub type Dir2 = RawDir2;
pub type Dir3 = RawDir3;
pub type Mat4 = RawDMat4;
pub type Mat3 = RawDMat3;
pub type Mat2 = RawDMat2;

pub trait EqualEpsilon<V> {
    fn equal_epsilon(&self, f: FloatType) -> bool;
    fn equal_diff_epsilon(&self, v: V, f: FloatType) -> bool;
}

impl EqualEpsilon<Vec3> for Vec3 {
    fn equal_epsilon(&self, f: FloatType) -> bool {
        self.x.abs() <= f && self.y.abs() <= f && self.z.abs() <= f
    }
    fn equal_diff_epsilon(&self, v: Vec3, f: FloatType) -> bool {
        (self.x - v.x).abs() <= f && (self.y - v.y).abs() <= f && (self.z - v.z).abs() <= f
    }
}

impl EqualEpsilon<FloatType> for FloatType {
    fn equal_epsilon(&self, f: FloatType) -> bool {
        self.abs() <= f
    }
    fn equal_diff_epsilon(&self, v: FloatType, f: FloatType) -> bool {
        (self - v).abs() <= f
    }
}

impl EqualEpsilon<Option<FloatType>> for Option<FloatType> {
    fn equal_epsilon(&self, f: FloatType) -> bool {
        match self {
            Some(value) => value.abs() <= f,
            None => false,
        }
    }
    fn equal_diff_epsilon(&self, other: Option<FloatType>, epsilon: FloatType) -> bool {
        match (self, other) {
            (Some(x), Some(y)) => (x - y).abs() <= epsilon,
            (None, None) => true,
            _ => false,
        }
    }
}

#[derive(Debug)]
pub struct AbsDiffEqVec3(pub Vec3);

impl AbsDiffEqVec3 {
    pub fn new(x: FloatType, y: FloatType, z: FloatType) -> Self {
        Self(Vec3::new(x, y, z))
    }
}

impl AbsDiffEq for AbsDiffEqVec3 {
    type Epsilon = Vec3;
    fn default_epsilon() -> Self::Epsilon {
        Vec3::new(EPSILON10, EPSILON10, EPSILON10)
    }

    fn abs_diff_eq(&self, other: &Self, epsilon: Self::Epsilon) -> bool {
        let diff = (self.0.abs() - other.0.abs()).abs();
        diff.x <= epsilon.x && diff.y <= epsilon.y && diff.z <= epsilon.z
    }
}

impl Eq for AbsDiffEqVec3 {}
impl Hash for AbsDiffEqVec3 {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let factor = 10.;
        let integer_vec3 = (self.0 * factor).floor();
        (integer_vec3.x as u32).hash(state);
        (integer_vec3.y as u32).hash(state);
        (integer_vec3.z as u32).hash(state);
    }
}
impl PartialEq for AbsDiffEqVec3 {
    fn eq(&self, other: &Self) -> bool {
        self.abs_diff_eq(other, AbsDiffEqVec3::default_epsilon())
    }
}

#[derive(Debug)]
pub struct DiffEqVec3(pub Vec3);

impl DiffEqVec3 {
    pub fn new(x: FloatType, y: FloatType, z: FloatType) -> Self {
        Self(Vec3::new(x, y, z))
    }

    fn diff_eq(&self, other: &Self, epsilon: FloatType) -> bool {
        let diff = self.0.distance(other.0);
        diff <= epsilon
    }
}

impl Eq for DiffEqVec3 {}
impl Hash for DiffEqVec3 {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let factor = 10u64.pow(10) as f64;
        let integer_vec3 = (self.0 * factor).floor();
        (integer_vec3.x as u32).hash(state);
        (integer_vec3.y as u32).hash(state);
        (integer_vec3.z as u32).hash(state);
    }
}
impl PartialEq for DiffEqVec3 {
    fn eq(&self, other: &Self) -> bool {
        self.diff_eq(other, EPSILON10)
    }
}

#[derive(PartialEq, Debug)]
pub struct AbsDiffEqVec4(pub Vec4);

impl AbsDiffEq for AbsDiffEqVec4 {
    type Epsilon = Vec4;
    fn default_epsilon() -> Self::Epsilon {
        Vec4::new(EPSILON10, EPSILON10, EPSILON10, EPSILON10)
    }

    fn abs_diff_eq(&self, other: &Self, epsilon: Self::Epsilon) -> bool {
        let diff = (self.0.abs() - other.0.abs()).abs();
        diff.x <= epsilon.x && diff.y <= epsilon.y && diff.z <= epsilon.z && diff.w <= epsilon.w
    }
}
