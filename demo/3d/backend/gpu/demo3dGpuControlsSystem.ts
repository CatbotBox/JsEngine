import {EntityCommandBufferSystem, System} from "@jsengine/engine/core";
import type {Component, ComponentCtor, Entity} from "@jsengine/engine/core";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {ResolvedInputActions} from "@jsengine/engine/input";
import {GpuRenderBackend} from "@jsengine/engine/rendering";
import {
    GpuMeshPassSettings,
    GpuPostProcessSettings,
    GpuShadowSettings,
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
import {ENTITIES_INCLUDING_DISABLED, INCLUDING_DISABLED} from "../../worldAccess";

const GPU_CONTROLS_PRIORITY = -20;
const SINGLE_SAMPLE_PER_PIXEL = 1;
const SHADOW_SETTINGS_ENTITY_NAME = "gpu shadow settings";
const POST_PROCESS_SETTINGS_ENTITY_NAME = "gpu post-process settings";

const Demo3dGpuAction = {
    ToggleTextureFiltering: "toggleTextureFiltering",
    CycleSurfaceShader: "cycleSurfaceShader",
    ToggleShadows: "toggleShadows",
    TogglePostProcessing: "togglePostProcessing",
} as const;

interface PlacedSettings<T extends Component> {
    readonly entity: Entity;
    readonly settings: T;
}

function otherTextureFiltering(filtering: GpuTextureFiltering): GpuTextureFiltering {
    return filtering === LINEAR_TEXTURE_FILTERING ? NEAREST_TEXTURE_FILTERING : LINEAR_TEXTURE_FILTERING;
}

function sampleCountOf(preset: SupersamplePreset): GpuSampleCount {
    return preset.x * preset.y > SINGLE_SAMPLE_PER_PIXEL ? MULTISAMPLE_COUNT : SINGLE_SAMPLE_COUNT;
}

export class Demo3dGpuControlsSystem extends System {
    private _settings = this.createEntityQuery([GpuMeshPassSettings]);
    private _shadowSettings = this.createEntityQuery([GpuShadowSettings]);
    private _postProcessSettings = this.createEntityQuery([GpuPostProcessSettings]);
    private _actions!: ResolvedInputActions<typeof Demo3dGpuAction>;
    private _supersamplePresets!: SupersamplePresetKeys;
    private _parkedShadowSettings: GpuShadowSettings | undefined;
    private _parkedPostProcessSettings: GpuPostProcessSettings | undefined;

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
        if (input.actionPressed(this._actions.ToggleShadows)) this.toggleShadows();
        if (input.actionPressed(this._actions.TogglePostProcessing)) this.togglePostProcessing();
        const preset = this._supersamplePresets.pressedPreset();
        if (preset === undefined) return;
        this.changeSettings(settings => settings.sampleCount = sampleCountOf(preset));
    }

    private changeSettings(change: (settings: GpuMeshPassSettings) => void): void {
        this._settings.stream({write: {settings: GpuMeshPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => change(settings));
    }

    private toggleShadows(): void {
        const current = this._shadowSettings.tryGetSingleton({settings: GpuShadowSettings}, ENTITIES_INCLUDING_DISABLED);
        this._parkedShadowSettings = this.toggle(current, GpuShadowSettings, this._parkedShadowSettings, SHADOW_SETTINGS_ENTITY_NAME);
    }

    private togglePostProcessing(): void {
        const current = this._postProcessSettings.tryGetSingleton({settings: GpuPostProcessSettings}, ENTITIES_INCLUDING_DISABLED);
        this._parkedPostProcessSettings = this.toggle(current, GpuPostProcessSettings, this._parkedPostProcessSettings, POST_PROCESS_SETTINGS_ENTITY_NAME);
    }

    private toggle<T extends Component>(current: PlacedSettings<T> | undefined, type: ComponentCtor<T>, parked: T | undefined, entityName: string): T | undefined {
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        if (current !== undefined) {
            buffer.removeComponent(current.entity, type);
            return current.settings;
        }
        const restored = parked ?? new type();
        const host = this._settings.tryGetSingleton({settings: GpuMeshPassSettings}, ENTITIES_INCLUDING_DISABLED);
        if (host === undefined) buffer.createEntity(entityName, [restored]);
        else buffer.addComponent(host.entity, restored);
        return undefined;
    }
}
