import {System} from "../../../../src/engine/core";
import {Input, resolveInputActions} from "../../../../src/engine/input";
import type {ResolvedInputActions} from "../../../../src/engine/input";
import {GpuRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {GpuMeshPassSettings, LINEAR_TEXTURE_FILTERING, NEAREST_TEXTURE_FILTERING} from "../../../../src/backends/gpu/gpuMeshPassSettings";
import type {GpuTextureFiltering} from "../../../../src/backends/gpu/gpuMeshPassSettings";
import {DemoSurfaceShaderSystem} from "./gpuSurfaceShaders";

const BEFORE_SIMULATION_PRIORITY = -1;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

const Demo3dGpuAction = {
    ToggleTextureFiltering: "toggleTextureFiltering",
    CycleSurfaceShader: "cycleSurfaceShader",
} as const;

function otherTextureFiltering(filtering: GpuTextureFiltering): GpuTextureFiltering {
    return filtering === LINEAR_TEXTURE_FILTERING ? NEAREST_TEXTURE_FILTERING : LINEAR_TEXTURE_FILTERING;
}

export class Demo3dGpuControlsSystem extends System {
    private _settings = this.createEntityQuery([GpuMeshPassSettings]);
    private _actions!: ResolvedInputActions<typeof Demo3dGpuAction>;

    override priority(): number {
        return BEFORE_SIMULATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(GpuRenderBackend);
        this._actions = resolveInputActions(this.world, Demo3dGpuAction);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        if (input.actionPressed(this._actions.ToggleTextureFiltering)) {
            this._settings.stream({write: {settings: GpuMeshPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
                settings.textureFiltering = otherTextureFiltering(settings.textureFiltering);
            });
        }
        if (input.actionPressed(this._actions.CycleSurfaceShader)) this.world.tryGetSystem(DemoSurfaceShaderSystem)?.cycle();
    }
}
