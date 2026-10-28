use maplibre_expr::{EvaluationContext, Expr, Feature, Type, Value, evaluate, parse, typecheck};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, HashSet};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CompiledExpression {
    expr: Expr,
}

#[wasm_bindgen]
impl CompiledExpression {
    /// Compile a MapLibre expression from JSON with optional expected type
    ///
    /// # Arguments
    /// * `expr_json` - Expression array (e.g., ["get", "name"])
    /// * `expected_type` - Optional expected type string: "color", "number", "boolean", "string", "array"
    ///
    /// Type checking ensures expressions return the correct type for their property,
    /// matching JsStyleEngine's behavior with createExpression(expr, spec).
    #[wasm_bindgen(constructor)]
    pub fn new(
        expr_json: JsValue,
        expected_type: Option<String>,
    ) -> Result<CompiledExpression, JsValue> {
        // 1. Deserialize JSON to serde_json::Value
        let json: JsonValue = serde_wasm_bindgen::from_value(expr_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid JSON: {}", e)))?;

        // 2. Parse expression using maplibre-expr
        let expr = parse(&json).map_err(|e| JsValue::from_str(&format!("Parse error: {:?}", e)))?;

        // 3. Map expected type string to maplibre-expr Type
        let expected = expected_type.as_ref().and_then(|t| match t.as_str() {
            "color" => Some(Type::Color),
            "number" => Some(Type::Number),
            "boolean" => Some(Type::Boolean),
            "string" => Some(Type::String),
            // "array" => Type::Array requires element type parameter, but MapLibre style specs
            // only specify "array" without element type info. Skip type checking for generic arrays.
            "array" => None,
            _ => None,
        });

        // 4. Type-check expression with expected type
        let expr = typecheck(&expr, expected.as_ref(), false)
            .map_err(|e| JsValue::from_str(&format!("Type error: {:?}", e)))?;

        Ok(CompiledExpression { expr })
    }

    /// Evaluate expression with given context
    ///
    /// # Arguments
    /// * `properties_json` - Feature properties as JSON object
    /// * `zoom` - Current zoom level
    /// * `geometry_type` - Optional geometry type string (e.g., "Point", "Polygon")
    /// * `elevation` - Optional terrain elevation in meters for `["elevation"]`
    ///
    /// # Returns
    /// Evaluated value as JsValue. Supported types:
    /// - Null, Bool, Number, String (primitives)
    /// - Color: `{r, g, b, a}` object
    /// - Array, Object: nested structures
    /// - NumberArray: returned as a JS `number[]`
    ///
    /// Unsupported types return `null` with a console warning.
    #[wasm_bindgen]
    pub fn evaluate(
        &self,
        properties_json: JsValue,
        zoom: f64,
        geometry_type: Option<String>,
        elevation: Option<f64>,
    ) -> Result<JsValue, JsValue> {
        // 1. Deserialize properties from JSON
        let properties_json: JsonValue = serde_wasm_bindgen::from_value(properties_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid properties: {}", e)))?;

        // 2. Convert JSON properties to BTreeMap<String, Value>
        let properties = json_to_value_map(&properties_json)?;

        // 3. Create Feature and EvaluationContext
        let feature = Feature {
            id: None,               // Not needed for property-based styling
            properties,             // Main data: feature attributes from GeoJSON
            geometry_type,          // Geometry type for ["geometry-type"] expressions
            state: BTreeMap::new(), // Interactive states (hover/selected) set by renderer
            geometry: Vec::new(),   // Coordinates for geometric expressions (distance, area)
        };
        let context = expression_context(zoom, feature, elevation);

        // 4. Evaluate expression
        let result = evaluate(&self.expr, &context)
            .map_err(|e| JsValue::from_str(&format!("Eval error: {:?}", e)))?;

        // 5. Convert result to JsValue
        value_to_jsvalue(&result)
    }

    /// Extract all feature property names accessed by this expression.
    /// Returns a JavaScript array of property name strings.
    /// This allows filtering properties before evaluation to reduce serialization overhead.
    #[wasm_bindgen(js_name = getRequiredProperties)]
    pub fn get_required_properties(&self) -> js_sys::Array {
        let mut properties = HashSet::new();
        collect_properties(&self.expr, &mut properties);

        let js_arr = js_sys::Array::new();
        for prop in properties {
            js_arr.push(&JsValue::from_str(&prop));
        }
        js_arr
    }
}

#[wasm_bindgen]
pub struct CompiledFilter {
    expr: Expr,
}

#[wasm_bindgen]
impl CompiledFilter {
    /// Compile a MapLibre filter from JSON
    /// filter_json: Filter expression (e.g., ["==", ["get", "type"], "park"])
    #[wasm_bindgen(constructor)]
    pub fn new(filter_json: JsValue) -> Result<CompiledFilter, JsValue> {
        // Parse and type-check filter expression
        let json: JsonValue = serde_wasm_bindgen::from_value(filter_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid JSON: {}", e)))?;

        let expr = parse(&json).map_err(|e| JsValue::from_str(&format!("Parse error: {:?}", e)))?;

        // Filters must type-check to boolean
        let expr = typecheck(&expr, Some(&Type::Boolean), false)
            .map_err(|e| JsValue::from_str(&format!("Type error: {:?}", e)))?;

        Ok(CompiledFilter { expr })
    }

    /// Test if feature matches filter
    ///
    /// # Arguments
    /// * `properties_json` - Feature properties as JSON object
    /// * `zoom` - Current zoom level
    /// * `geometry_type` - Optional geometry type string (e.g., "Point", "Polygon")
    #[wasm_bindgen]
    pub fn test(
        &self,
        properties_json: JsValue,
        zoom: f64,
        geometry_type: Option<String>,
    ) -> Result<bool, JsValue> {
        // Deserialize properties from JSON
        let properties_json: JsonValue = serde_wasm_bindgen::from_value(properties_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid properties: {}", e)))?;

        let properties = json_to_value_map(&properties_json)?;

        // Create context and evaluate
        let feature = Feature {
            id: None,               // Not needed for property-based filtering
            properties,             // Main data: feature attributes from GeoJSON
            geometry_type,          // Geometry type for ["geometry-type"] filters
            state: BTreeMap::new(), // Interactive states not used in filters
            geometry: Vec::new(),   // Coordinates not used in property filters
        };
        let context = EvaluationContext::new()
            .with_zoom(zoom)
            .with_feature(feature);

        let result = evaluate(&self.expr, &context)
            .map_err(|e| JsValue::from_str(&format!("Eval error: {:?}", e)))?;

        // Convert result to boolean
        match result {
            Value::Bool(b) => Ok(b),
            _ => Err(JsValue::from_str("Filter did not return boolean")),
        }
    }
}

// Helper functions to convert between JSON and maplibre-expr Value types

/// Evaluation context for a compiled expression; `elevation` feeds
/// `["elevation"]` (maplibre-expr has no builder for it).
fn expression_context(zoom: f64, feature: Feature, elevation: Option<f64>) -> EvaluationContext {
    let mut context = EvaluationContext::new()
        .with_zoom(zoom)
        .with_feature(feature);
    context.elevation = elevation;
    context
}

fn json_to_value_map(json: &JsonValue) -> Result<BTreeMap<String, Value>, JsValue> {
    match json {
        JsonValue::Object(obj) => {
            let mut map = BTreeMap::new();
            for (k, v) in obj.iter() {
                map.insert(k.clone(), json_to_value(v)?);
            }
            Ok(map)
        }
        _ => Err(JsValue::from_str("Properties must be an object")),
    }
}

fn json_to_value(json: &JsonValue) -> Result<Value, JsValue> {
    match json {
        JsonValue::Null => Ok(Value::Null),
        JsonValue::Bool(b) => Ok(Value::Bool(*b)),
        JsonValue::Number(n) => n
            .as_f64()
            .map(Value::Number)
            .ok_or_else(|| JsValue::from_str("Invalid number: out of range")),
        JsonValue::String(s) => Ok(Value::String(s.clone())),
        JsonValue::Array(arr) => {
            let values: Result<Vec<_>, _> = arr.iter().map(json_to_value).collect();
            Ok(Value::Array(values?))
        }
        JsonValue::Object(obj) => {
            let mut map = BTreeMap::new();
            for (k, v) in obj.iter() {
                map.insert(k.clone(), json_to_value(v)?);
            }
            Ok(Value::Object(map))
        }
    }
}

fn value_to_jsvalue(value: &Value) -> Result<JsValue, JsValue> {
    match value {
        Value::Null => Ok(JsValue::NULL),
        Value::Bool(b) => Ok(JsValue::from(*b)),
        Value::Number(n) => Ok(JsValue::from(*n)),
        Value::String(s) => Ok(JsValue::from_str(s)),
        Value::Color(c) => {
            // Convert Color { r, g, b, a } to JsValue object
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &JsValue::from_str("r"), &JsValue::from(c.r))?;
            js_sys::Reflect::set(&obj, &JsValue::from_str("g"), &JsValue::from(c.g))?;
            js_sys::Reflect::set(&obj, &JsValue::from_str("b"), &JsValue::from(c.b))?;
            js_sys::Reflect::set(&obj, &JsValue::from_str("a"), &JsValue::from(c.a))?;
            Ok(obj.into())
        }
        Value::Array(arr) => {
            let js_arr = js_sys::Array::new();
            for v in arr {
                js_arr.push(&value_to_jsvalue(v)?);
            }
            Ok(js_arr.into())
        }
        Value::Object(obj) => {
            let js_obj = js_sys::Object::new();
            for (k, v) in obj {
                js_sys::Reflect::set(&js_obj, &JsValue::from_str(k), &value_to_jsvalue(v)?)?;
            }
            Ok(js_obj.into())
        }
        Value::NumberArray(arr) => {
            let js_arr = js_sys::Array::new();
            for n in arr {
                js_arr.push(&JsValue::from(*n));
            }
            Ok(js_arr.into())
        }
        // [top, right, bottom, left], as maplibre-gl's `Padding.values`.
        Value::Padding(values) => {
            let js_arr = js_sys::Array::new();
            for n in values {
                js_arr.push(&JsValue::from(*n));
            }
            Ok(js_arr.into())
        }
        // Fallback for unsupported types: log warning and return null
        // This prevents valid MapLibre expressions from failing at runtime
        _ => {
            bevy_log::warn!(
                "Unsupported maplibre-expr value type '{}'.",
                value.type_name()
            );
            Ok(JsValue::NULL)
        }
    }
}

/// Recursively traverse expression tree and collect property names.
/// Extracts property names from ["get", "propertyName"] and ["has", "propertyName"] expressions.
fn collect_properties(expr: &Expr, properties: &mut HashSet<String>) {
    match expr {
        // Handle "get" expression
        Expr::Call { op, args } if op == "get" => {
            if !args.is_empty() {
                // Extract property name if first arg is a string literal
                // Works for both ["get", "prop"] and ["get", "key", object]
                if let Expr::Literal(Value::String(prop_name)) = &args[0] {
                    properties.insert(prop_name.clone());
                }

                // Recurse into non-literal arguments to handle:
                // - 2-arg form: ["get", key, object] - recurse into object (args[1])
                // - Dynamic access: ["get", ["concat", ...]] - recurse into args[0]
                for arg in args {
                    if !matches!(arg, Expr::Literal(_)) {
                        collect_properties(arg, properties);
                    }
                }
            }
        }

        // Handle "has" expression (same logic as "get")
        Expr::Call { op, args } if op == "has" => {
            if !args.is_empty() {
                // Extract property name if first arg is a string literal
                if let Expr::Literal(Value::String(prop_name)) = &args[0] {
                    properties.insert(prop_name.clone());
                }

                // Recurse into non-literal arguments (consistent with "get")
                for arg in args {
                    if !matches!(arg, Expr::Literal(_)) {
                        collect_properties(arg, properties);
                    }
                }
            }
        }

        // Other function calls: recurse into all arguments
        Expr::Call { args, .. } => {
            for arg in args {
                collect_properties(arg, properties);
            }
        }

        // Recursive cases for complex expressions
        Expr::Assert(_, inner) | Expr::Coerce(_, inner) => {
            collect_properties(inner, properties);
        }
        Expr::Let { bindings, body } => {
            for (_, expr) in bindings {
                collect_properties(expr, properties);
            }
            collect_properties(body, properties);
        }
        Expr::Match {
            input,
            arms,
            default,
        } => {
            collect_properties(input, properties);
            for (_, expr) in arms {
                collect_properties(expr, properties);
            }
            collect_properties(default, properties);
        }
        Expr::Step {
            input,
            output0,
            stops,
        } => {
            collect_properties(input, properties);
            collect_properties(output0, properties);
            for (_, expr) in stops {
                collect_properties(expr, properties);
            }
        }
        Expr::Interpolate { input, stops, .. } => {
            collect_properties(input, properties);
            for (_, expr) in stops {
                collect_properties(expr, properties);
            }
        }

        Expr::Format(args) => {
            for a in args {
                collect_properties(&a.content, properties);
                if let Some(e) = &a.scale {
                    collect_properties(e, properties);
                }
                if let Some(e) = &a.font {
                    collect_properties(e, properties);
                }
                if let Some(e) = &a.text_color {
                    collect_properties(e, properties);
                }
                if let Some(e) = &a.vertical_align {
                    collect_properties(e, properties);
                }
            }
        }
        Expr::NumberFormat {
            value,
            locale,
            currency,
            min_fraction_digits,
            max_fraction_digits,
            unit,
        } => {
            collect_properties(value, properties);
            for e in [
                locale.as_deref(),
                currency.as_deref(),
                min_fraction_digits.as_deref(),
                max_fraction_digits.as_deref(),
                unit.as_deref(),
            ]
            .into_iter()
            .flatten()
            {
                collect_properties(e, properties);
            }
        }
        Expr::Collator {
            case_sensitive,
            diacritic_sensitive,
            locale,
        } => {
            for e in [
                case_sensitive.as_deref(),
                diacritic_sensitive.as_deref(),
                locale.as_deref(),
            ]
            .into_iter()
            .flatten()
            {
                collect_properties(e, properties);
            }
        }
        // Terminal nodes with no sub-expressions
        Expr::Literal(_) | Expr::Var(_) | Expr::Within(_) | Expr::Distance(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_json_to_value_primitives() {
        // Test basic types
        assert!(matches!(json_to_value(&json!(null)).unwrap(), Value::Null));
        assert!(matches!(
            json_to_value(&json!(true)).unwrap(),
            Value::Bool(true)
        ));
        assert!(matches!(json_to_value(&json!(42.5)).unwrap(), Value::Number(n) if n == 42.5));
        assert!(
            matches!(json_to_value(&json!("hello")).unwrap(), Value::String(s) if s == "hello")
        );
    }

    #[test]
    fn test_json_to_value_array() {
        let result = json_to_value(&json!([1, 2, 3])).unwrap();
        match result {
            Value::Array(arr) => {
                assert_eq!(arr.len(), 3);
                assert!(matches!(arr[0], Value::Number(n) if n == 1.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_json_to_value_object() {
        let result = json_to_value(&json!({"name": "test", "value": 42})).unwrap();
        match result {
            Value::Object(map) => {
                assert_eq!(map.len(), 2);
                assert!(matches!(map.get("name"), Some(Value::String(s)) if s == "test"));
                assert!(matches!(map.get("value"), Some(Value::Number(n)) if *n == 42.0));
            }
            _ => panic!("Expected object"),
        }
    }

    #[test]
    fn test_compiled_expression_constant() {
        // Test constant value expression
        let expr_json = json!(5);
        let expr = parse(&expr_json).expect("Failed to parse");
        let expr = typecheck(&expr, None, false).expect("Failed to typecheck");

        let properties = BTreeMap::new();
        let feature = Feature {
            id: None,
            properties,
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };
        let context = EvaluationContext::new()
            .with_zoom(0.0)
            .with_feature(feature);

        let result = evaluate(&expr, &context).expect("Failed to evaluate");
        assert!(matches!(result, Value::Number(n) if n == 5.0));
    }

    #[test]
    fn test_elevation_is_passed_to_the_context() {
        // A color-relief style expression: elevation in feet as the input.
        let expr_json = json!(["*", ["elevation"], 3.28]);
        let expr = parse(&expr_json).expect("Failed to parse");
        let expr = typecheck(&expr, None, false).expect("Failed to typecheck");
        let feature = Feature {
            id: None,
            properties: BTreeMap::new(),
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };

        let context = super::expression_context(0.0, feature, Some(100.0));
        let result = evaluate(&expr, &context).expect("Failed to evaluate");
        assert!(matches!(result, Value::Number(n) if (n - 328.0).abs() < 1e-9));
    }

    #[test]
    fn test_compiled_expression_get_property() {
        // Test ["get", "name"] expression
        let expr_json = json!(["get", "name"]);
        let expr = parse(&expr_json).expect("Failed to parse");
        let expr = typecheck(&expr, None, false).expect("Failed to typecheck");

        let mut properties = BTreeMap::new();
        properties.insert("name".to_string(), Value::String("test".to_string()));

        let feature = Feature {
            id: None,
            properties,
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };
        let context = EvaluationContext::new()
            .with_zoom(0.0)
            .with_feature(feature);

        let result = evaluate(&expr, &context).expect("Failed to evaluate");
        assert!(matches!(result, Value::String(s) if s == "test"));
    }

    #[test]
    fn test_compiled_filter_equality() {
        // Test ["==", ["get", "type"], "park"] filter
        let filter_json = json!(["==", ["get", "type"], "park"]);
        let expr = parse(&filter_json).expect("Failed to parse");
        let expr = typecheck(&expr, Some(&Type::Boolean), false).expect("Failed to typecheck");

        // Test matching feature
        let mut properties = BTreeMap::new();
        properties.insert("type".to_string(), Value::String("park".to_string()));

        let feature = Feature {
            id: None,
            properties,
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };
        let context = EvaluationContext::new()
            .with_zoom(0.0)
            .with_feature(feature);

        let result = evaluate(&expr, &context).expect("Failed to evaluate");
        assert!(matches!(result, Value::Bool(true)));

        // Test non-matching feature
        let mut properties = BTreeMap::new();
        properties.insert("type".to_string(), Value::String("water".to_string()));

        let feature = Feature {
            id: None,
            properties,
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };
        let context = EvaluationContext::new()
            .with_zoom(0.0)
            .with_feature(feature);

        let result = evaluate(&expr, &context).expect("Failed to evaluate");
        assert!(matches!(result, Value::Bool(false)));
    }

    #[test]
    fn test_color_expression_evaluation() {
        // Test color literal expression: "rgb(255, 128, 0)"
        // MapLibre color literals are parsed as strings and converted to Color values
        let expr_json = json!(["rgb", 255, 128, 0]);
        let expr = parse(&expr_json).expect("Failed to parse color expression");
        let expr = typecheck(&expr, None, false).expect("Failed to typecheck color");

        let properties = BTreeMap::new();
        let feature = Feature {
            id: None,
            properties,
            geometry_type: None,
            state: BTreeMap::new(),
            geometry: Vec::new(),
        };
        let context = EvaluationContext::new()
            .with_zoom(0.0)
            .with_feature(feature);

        let result = evaluate(&expr, &context).expect("Failed to evaluate color");

        // Verify it's a Color value with expected components
        match result {
            Value::Color(c) => {
                // Colors are normalized to 0-1 range
                assert!((c.r - 1.0).abs() < 0.01, "Expected r=1.0, got {}", c.r);
                assert!((c.g - 0.5).abs() < 0.01, "Expected g≈0.5, got {}", c.g);
                assert!((c.b - 0.0).abs() < 0.01, "Expected b=0.0, got {}", c.b);
                assert!((c.a - 1.0).abs() < 0.01, "Expected a=1.0, got {}", c.a);
            }
            _ => panic!("Expected Color value, got {:?}", result.type_name()),
        }
    }

    #[test]
    fn test_collect_properties_simple_get() {
        // Test simple ["get", "propertyName"]
        let expr_json = json!(["get", "name"]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 1);
        assert!(properties.contains("name"));
    }

    #[test]
    fn test_collect_properties_multiple() {
        // Test expression with multiple property accesses: ["+", ["get", "x"], ["get", "y"]]
        let expr_json = json!(["+", ["get", "x"], ["get", "y"]]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 2);
        assert!(properties.contains("x"));
        assert!(properties.contains("y"));
    }

    #[test]
    fn test_collect_properties_has() {
        // Test ["has", "propertyName"]
        let expr_json = json!(["has", "type"]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 1);
        assert!(properties.contains("type"));
    }

    #[test]
    fn test_collect_properties_nested() {
        // Test nested expression: ["*", ["get", "width"], 2]
        let expr_json = json!(["*", ["get", "width"], 2]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 1);
        assert!(properties.contains("width"));
    }

    #[test]
    fn test_collect_properties_constant() {
        // Test constant expression (no properties)
        let expr_json = json!(42);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 0);
    }

    #[test]
    fn test_collect_properties_case_expression() {
        // Test case expression with multiple branches
        let expr_json = json!([
            "case",
            ["==", ["get", "type"], "park"],
            ["get", "park_color"],
            ["==", ["get", "type"], "water"],
            ["get", "water_color"],
            "#cccccc"
        ]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        // Should collect: type, park_color, water_color
        assert_eq!(properties.len(), 3);
        assert!(properties.contains("type"));
        assert!(properties.contains("park_color"));
        assert!(properties.contains("water_color"));
    }

    #[test]
    fn test_collect_properties_interpolate() {
        // Test interpolate expression with zoom and property
        let expr_json = json!([
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["get", "min_height"],
            15,
            ["get", "max_height"]
        ]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        assert_eq!(properties.len(), 2);
        assert!(properties.contains("min_height"));
        assert!(properties.contains("max_height"));
    }

    #[test]
    fn test_collect_properties_no_duplicates() {
        // Test that duplicate property names are not counted twice
        let expr_json = json!(["+", ["get", "value"], ["get", "value"]]);
        let expr = parse(&expr_json).expect("Failed to parse");

        let mut properties = HashSet::new();
        collect_properties(&expr, &mut properties);

        // Should only have one "value" entry
        assert_eq!(properties.len(), 1);
        assert!(properties.contains("value"));
    }
}
