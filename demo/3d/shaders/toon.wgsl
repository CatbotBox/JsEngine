
const TOON_SMALLEST_BRIGHTNESS: f32 = 1e-4;
const TOON_ROUND_TO_NEAREST_BAND: f32 = 0.5;

fn brightnessOf(rgb: vec3f) -> f32 {
    return max(rgb.r, max(rgb.g, rgb.b));
}

fn surface(input: SurfaceInput) -> vec4f {
    let bands = max(input.params[0], 1.0);
    let rimWidth = input.params[1];
    let rimStrength = input.params[2];
    let highlightThreshold = input.params[3];
    let light = lightDiffuse(input);
    let brightness = brightnessOf(light);
    var darkest = 0.0;
    if (sceneIsLit()) {
        darkest = brightnessOf(ambientLight());
    }
    let banded = max(floor(brightness * bands + TOON_ROUND_TO_NEAREST_BAND) / bands, darkest);
    let toonLight = light * (banded / max(brightness, TOON_SMALLEST_BRIGHTNESS));
    let albedo = input.diffuseColor * input.tint.rgb;
    var rgb = saturate(toonLight * albedo + input.emissiveColor * input.tint.rgb) * input.texel.rgb;
    rgb += step(vec3f(highlightThreshold), lightSpecular(input)) * input.specularColor * input.gloss * input.tint.rgb;
    let edge = 1.0 - saturate(dot(input.viewNormal, input.toCamera));
    rgb += vec3f(step(1.0 - rimWidth, edge) * rimStrength);
    return vec4f(rgb, 1.0);
}
