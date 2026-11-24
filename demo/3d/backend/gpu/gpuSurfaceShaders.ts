import {EntityCommandBuffer, System} from "@jsengine/engine/core";
import {GpuRenderBackend} from "@jsengine/engine/rendering";
import type {ShaderSource} from "@jsengine/engine/rendering";
import {RenderMesh} from "@jsengine/engine/rendering/3d";
import {GpuShaderLibrary, GpuSurfaceShader} from "@jsengine/backends/gpu";
import {Demo3dConfig} from "../../config";
import type {SurfaceShaderChoice} from "../../config";

const FIRST_CHOICE = 0;
const NEXT_CHOICE_STEP = 1;
const CLEARED_PARAM = 0;
const SURFACE_SHADER_PRIORITY = 10;

function writeParams(choice: SurfaceShaderChoice, params: Float32Array, instanceIndex: number): void {
    params.fill(CLEARED_PARAM);
    params.set(choice.params.length > params.length ? choice.params.slice(0, params.length) : choice.params);
    if (choice.instancePhaseParam !== undefined) params[choice.instancePhaseParam] = instanceIndex * choice.instancePhaseStepSeconds;
}

export class DemoSurfaceShaderSystem extends System {
    private readonly _unassigned = this.createEntityQuery([RenderMesh], [GpuSurfaceShader]);
    private readonly _assigned = this.createEntityQuery([RenderMesh, GpuSurfaceShader]);
    private readonly _registered = new Map<string, ShaderSource>();
    private readonly _assignments = new EntityCommandBuffer();
    private _selected = FIRST_CHOICE;
    private _applied = FIRST_CHOICE;
    private _nextInstanceIndex = 0;

    override priority(): number {
        return SURFACE_SHADER_PRIORITY;
    }

    public cycle(): void {
        const count = this.choices().length;
        if (count > 0) this._selected = (this._selected + NEXT_CHOICE_STEP) % count;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(GpuRenderBackend);
        this.requireResourceForUpdate(Demo3dConfig);
        this.requireAnyForUpdate(this._unassigned);
        this.requireAnyForUpdate(this._assigned);
    }

    onUpdate(): void {
        const choices = this.choices();
        if (choices.length === 0) return;
        this.registerShaders(choices);
        if (this._selected >= choices.length) this._selected = FIRST_CHOICE;
        const choice = choices[this._selected];
        if (this._applied !== this._selected) {
            this._applied = this._selected;
            this._assigned.stream({write: {surfaceShader: GpuSurfaceShader}}).consume(({surfaceShader}) => {
                surfaceShader.name = choice.name;
                writeParams(choice, surfaceShader.params, this._nextInstanceIndex++);
            });
        }
        if (!this._unassigned.hasEntity()) return;
        this._unassigned.stream({read: {renderMesh: RenderMesh}}).consumeSpans(({start, end, entities}) => {
            for (let row = start; row < end; row++) {
                const shader = new GpuSurfaceShader(choice.name);
                writeParams(choice, shader.params, this._nextInstanceIndex++);
                this._assignments.addComponent(entities[row], shader);
            }
        });
        this._assignments.playback(this.entityManager);
    }

    private choices(): readonly SurfaceShaderChoice[] {
        return this.world.resources.get(Demo3dConfig).surfaceShaders;
    }

    private registerShaders(choices: readonly SurfaceShaderChoice[]): void {
        const library = this.world.resources.getOrCreate(GpuShaderLibrary);
        for (const choice of choices) {
            const shader = choice.shader;
            if (shader === undefined || this._registered.get(choice.name) === shader) continue;
            library.register(choice.name, shader.code);
            this._registered.set(choice.name, shader);
        }
    }
}
