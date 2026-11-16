
const HOLOGRAM_TAU: f32 = 6.283185307;
const HOLOGRAM_LINE_EDGE: f32 = 0.15;
const HOLOGRAM_LINE_WIDTH: f32 = 0.5;
const HOLOGRAM_DIM_LINE: f32 = 0.2;
const HOLOGRAM_FRESNEL_POWER: f32 = 2.0;
const HOLOGRAM_PULSE_DEPTH: f32 = 0.35;

fn surface(input: SurfaceInput) -> vec4f {
    let glowColor = vec3f(input.params[0], input.params[1], input.params[2]);
    let time = input.time + input.params[3];
    let pixelsPerLine = max(input.params[4], 1.0);
    let scrollLinesPerSecond = input.params[5];
    let pulsesPerSecond = input.params[6];
    let litMix = input.params[7];
    let stripe = fract(input.pixelPosition.y / pixelsPerLine - time * scrollLinesPerSecond);
    let line = smoothstep(0.0, HOLOGRAM_LINE_EDGE, stripe) * (1.0 - smoothstep(HOLOGRAM_LINE_WIDTH, HOLOGRAM_LINE_WIDTH + HOLOGRAM_LINE_EDGE, stripe));
    let fresnel = pow(1.0 - saturate(dot(input.viewNormal, input.toCamera)), HOLOGRAM_FRESNEL_POWER);
    let pulse = 1.0 - HOLOGRAM_PULSE_DEPTH + HOLOGRAM_PULSE_DEPTH * sin(time * pulsesPerSecond * HOLOGRAM_TAU);
    let glow = glowColor * (mix(HOLOGRAM_DIM_LINE, 1.0, line) + fresnel) * pulse;
    return vec4f(input.lit.rgb * litMix + glow, 1.0);
}
