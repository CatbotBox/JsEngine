import {EntityCommandBufferSystem, System} from "../../../src/engine/core";
import type {ShaderSource} from "../../../src/engine/rendering";
import {RenderMesh} from "../../../src/engine/rendering/3d";
import {GpuShaderLibrary, GpuSurfaceShader} from "../../../src/backends/gpu";
import {Demo3dTuning} from "../tuning";
import type {SurfaceShaderChoice} from "../tuning";

const FIRST_CHOICE = 0;
const NEXT_CHOICE_STEP = 1;
const CLEARED_PARAM = 0;

function writeParams(choice: SurfaceShaderChoice, params: Float32Array, instanceIndex: number): void {
    params.fill(CLEARED_PARAM);
    params.set(choice.params.length > params.length ? choice.params.slice(0, params.length) : choice.params);
    if (choice.instancePhaseParam !== undefined) params[choice.instancePhaseParam] = instanceIndex * choice.instancePhaseStepSeconds;
}

export class DemoSurfaceShaderSystem extends System {
    private readonly _unassigned = this.createEntityQuery([RenderMesh], [GpuSurfaceShader]);
    private readonly _assigned = this.createEntityQuery([RenderMesh, GpuSurfaceShader]);
    private readonly _registered = new Map<string, ShaderSource>();
    private _selected = FIRST_CHOICE;
    private _applied = FIRST_CHOICE;
    private _nextInstanceIndex = 0;

    public cycle(): void {
        const count = this.choices().length;
        if (count > 0) this._selected = (this._selected + NEXT_CHOICE_STEP) % count;
    }

    protected onCreate(): void {
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
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        this._unassigned.stream({read: {renderMesh: RenderMesh}}).consumeSpans(({start, end, entities}) => {
            for (let row = start; row < end; row++) {
                const shader = new GpuSurfaceShader(choice.name);
                writeParams(choice, shader.params, this._nextInstanceIndex++);
                buffer.addComponent(entities[row], shader);
            }
        });
    }

    private choices(): readonly SurfaceShaderChoice[] {
        return this.world.resources.get(Demo3dTuning).surfaceShaders;
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
