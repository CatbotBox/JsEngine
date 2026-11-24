import {System} from "@jsengine/engine/core";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {ResolvedInputActions} from "@jsengine/engine/input";
import {GpuRenderBackend} from "@jsengine/engine/rendering";
import {
    GpuMeshPassSettings,
    LINEAR_TEXTURE_FILTERING,
    MULTISAMPLE_COUNT,
    NEAREST_TEXTURE_FILTERING,
    SINGLE_SAMPLE_COUNT,
} from "@jsengine/backends/gpu";
import type {GpuSampleCount, GpuTextureFiltering} from "@jsengine/backends/gpu";
import {Demo3dConfig} from "../../config";
import type {SupersamplePreset} from "../../config";
import {SupersamplePresetKeys} from "../../supersamplePresetKeys";
import {DemoSurfaceShaderSystem} from "./gpuSurfaceShaders";
import {INCLUDING_DISABLED} from "../../worldAccess";

const GPU_CONTROLS_PRIORITY = -20;
const SINGLE_SAMPLE_PER_PIXEL = 1;

const Demo3dGpuAction = {
    ToggleTextureFiltering: "toggleTextureFiltering",
    CycleSurfaceShader: "cycleSurfaceShader",
} as const;

function otherTextureFiltering(filtering: GpuTextureFiltering): GpuTextureFiltering {
    return filtering === LINEAR_TEXTURE_FILTERING ? NEAREST_TEXTURE_FILTERING : LINEAR_TEXTURE_FILTERING;
}

function sampleCountOf(preset: SupersamplePreset): GpuSampleCount {
    return preset.x * preset.y > SINGLE_SAMPLE_PER_PIXEL ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
}

export class Demo3dGpuControlsSystem extends System {
    private _settings = this.createEntityQuery([GpuMeshPassSettings]);
    private _actions!: ResolvedInputActions<typeof Demo3dGpuAction>;
    private _supersamplePresets!: SupersamplePresetKeys;

    override priority(): number {
        return GPU_CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(GpuRenderBackend);
        this.requireResourceForUpdate(Demo3dConfig);
        this._actions = resolveInputActions(this.world, Demo3dGpuAction);
        this._supersamplePresets = new SupersamplePresetKeys(this.world);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        if (input.actionPressed(this._actions.ToggleTextureFiltering)) {
            this.changeSettings(settings => settings.textureFiltering = otherTextureFiltering(settings.textureFiltering));
        }
        if (input.actionPressed(this._actions.CycleSurfaceShader)) this.world.tryGetSystem(DemoSurfaceShaderSystem)?.cycle();
        const preset = this._supersamplePresets.pressedPreset();
        if (preset === undefined) return;
        this.changeSettings(settings => settings.sampleCount = sampleCountOf(preset));
    }

    private changeSettings(change: (settings: GpuMeshPassSettings) => void): void {
        this._settings.stream({write: {settings: GpuMeshPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => change(settings));
    }
}
