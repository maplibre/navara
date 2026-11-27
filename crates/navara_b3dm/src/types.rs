pub enum DataType {
    Scalar,
    Vec2,
    Vec3,
    Vec4,
}

impl DataType {
    /// `None` for a `type` the batch table spec does not list.
    pub fn parse(v: &str) -> Option<Self> {
        match v {
            "SCALAR" => Some(DataType::Scalar),
            "VEC2" => Some(DataType::Vec2),
            "VEC3" => Some(DataType::Vec3),
            "VEC4" => Some(DataType::Vec4),
            _ => None,
        }
    }

    pub fn size(&self) -> usize {
        match self {
            Self::Scalar => 1,
            Self::Vec2 => 2,
            Self::Vec3 => 3,
            Self::Vec4 => 4,
        }
    }
}

pub enum ComponentType {
    Byte,
    UnsignedByte,
    Short,
    UnsignedShort,
    Int,
    UnsignedInt,
    Float,
    Double,
}

impl ComponentType {
    /// `None` for a `componentType` the batch table spec does not list.
    pub fn parse(v: &str) -> Option<Self> {
        match v {
            "BYTE" => Some(ComponentType::Byte),
            "UNSIGNED_BYTE" => Some(ComponentType::UnsignedByte),
            "SHORT" => Some(ComponentType::Short),
            "UNSIGNED_SHORT" => Some(ComponentType::UnsignedShort),
            "INT" => Some(ComponentType::Int),
            "UNSIGNED_INT" => Some(ComponentType::UnsignedInt),
            "FLOAT" => Some(ComponentType::Float),
            "DOUBLE" => Some(ComponentType::Double),
            _ => None,
        }
    }

    pub fn size(&self) -> usize {
        match self {
            Self::Byte => 1,
            Self::UnsignedByte => 1,
            Self::Short => 2,
            Self::UnsignedShort => 2,
            Self::Int => 4,
            Self::UnsignedInt => 4,
            Self::Float => 4,
            Self::Double => 8,
        }
    }
}
