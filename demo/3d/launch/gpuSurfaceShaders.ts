import {EntityCommandBufferSystem, System} from "../../../src/engine/core";
import {RenderMesh} from "../../../src/engine/rendering/3d";
import {GpuShaderLibrary, GpuSurfaceShader, LIT_SURFACE_SHADER, SURFACE_FUNCTION_SIGNATURE} from "../../../src/backends/gpu";

export const TOON_SURFACE_SHADER = "toon";
export const HOLOGRAM_SURFACE_SHADER = "hologram";

const TOON_BANDS = 3;
const TOON_RIM_WIDTH = 0.35;
const TOON_RIM_STRENGTH = 0.45;
const TOON_HIGHLIGHT_THRESHOLD = 0.4;
const TOON_PARAMS = [TOON_BANDS, TOON_RIM_WIDTH, TOON_RIM_STRENGTH, TOON_HIGHLIGHT_THRESHOLD];

const HOLOGRAM_RED = 0.3, HOLOGRAM_GREEN = 0.9, HOLOGRAM_BLUE = 1;
const HOLOGRAM_PIXELS_PER_LINE = 8;
const HOLOGRAM_SCROLL_LINES_PER_SECOND = 2.5;
const HOLOGRAM_PULSES_PER_SECOND = 0.5;
const HOLOGRAM_LIT_MIX = 0.25;
const HOLOGRAM_PHASE_PARAM = 3;
const HOLOGRAM_PHASE_STEP_SECONDS = 0.4;
const NO_PHASE = 0;
const HOLOGRAM_PARAMS = [
    HOLOGRAM_RED, HOLOGRAM_GREEN, HOLOGRAM_BLUE, NO_PHASE,
    HOLOGRAM_PIXELS_PER_LINE, HOLOGRAM_SCROLL_LINES_PER_SECOND, HOLOGRAM_PULSES_PER_SECOND, HOLOGRAM_LIT_MIX,
];

const TOON_WGSL = `
const TOON_SMALLEST_BRIGHTNESS: f32 = 1e-4;
const TOON_ROUND_TO_NEAREST_BAND: f32 = 0.5;

fn brightnessOf(rgb: vec3f) -> f32 {
    return max(rgb.r, max(rgb.g, rgb.b));
}

${SURFACE_FUNCTION_SIGNATURE} {
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
`;

const HOLOGRAM_WGSL = `
const HOLOGRAM_TAU: f32 = 6.283185307;
const HOLOGRAM_LINE_EDGE: f32 = 0.15;
const HOLOGRAM_LINE_WIDTH: f32 = 0.5;
const HOLOGRAM_DIM_LINE: f32 = 0.2;
const HOLOGRAM_FRESNEL_POWER: f32 = 2.0;
const HOLOGRAM_PULSE_DEPTH: f32 = 0.35;

${SURFACE_FUNCTION_SIGNATURE} {
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
`;

interface SurfaceShaderChoice {
    readonly name: string;
    writeParams(params: Float32Array, instanceIndex: number): void;
}

const SURFACE_SHADER_CYCLE: readonly SurfaceShaderChoice[] = [
    {name: LIT_SURFACE_SHADER, writeParams: params => params.fill(0)},
    {name: TOON_SURFACE_SHADER, writeParams: params => {
        params.fill(0);
        params.set(TOON_PARAMS);
    }},
    {name: HOLOGRAM_SURFACE_SHADER, writeParams: (params, instanceIndex) => {
        params.set(HOLOGRAM_PARAMS);
        params[HOLOGRAM_PHASE_PARAM] = instanceIndex * HOLOGRAM_PHASE_STEP_SECONDS;
    }},
];

export function registerDemoSurfaceShaders(library: GpuShaderLibrary): void {
    library.register(TOON_SURFACE_SHADER, TOON_WGSL);
    library.register(HOLOGRAM_SURFACE_SHADER, HOLOGRAM_WGSL);
}

export class DemoSurfaceShaderSystem extends System {
    private readonly _unassigned = this.createEntityQuery([RenderMesh], [GpuSurfaceShader]);
    private readonly _assigned = this.createEntityQuery([RenderMesh, GpuSurfaceShader]);
    private _selected = 0;
    private _applied = 0;
    private _nextInstanceIndex = 0;

    public cycle(): void {
        this._selected = (this._selected + 1) % SURFACE_SHADER_CYCLE.length;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._unassigned);
        this.requireAnyForUpdate(this._assigned);
    }

    onUpdate(): void {
        const choice = SURFACE_SHADER_CYCLE[this._selected];
        if (this._applied !== this._selected) {
            this._applied = this._selected;
            this._assigned.stream({write: {surfaceShader: GpuSurfaceShader}}).consume(({surfaceShader}) => {
                surfaceShader.name = choice.name;
                choice.writeParams(surfaceShader.params, this._nextInstanceIndex++);
            });
        }
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        this._unassigned.stream({read: {renderMesh: RenderMesh}}).consumeSpans(({start, end, entities}) => {
            for (let row = start; row < end; row++) {
                const shader = new GpuSurfaceShader(choice.name);
                choice.writeParams(shader.params, this._nextInstanceIndex++);
                buffer.addComponent(entities[row], shader);
            }
        });
    }
}
