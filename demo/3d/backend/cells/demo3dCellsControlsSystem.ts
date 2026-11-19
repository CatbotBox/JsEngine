import {System} from "../../../../src/engine/core";
import {Input, resolveInputActions} from "../../../../src/engine/input";
import type {ResolvedInputActions} from "../../../../src/engine/input";
import {CellsRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {MeshCellPassSettings} from "../../../../src/backends/cells/3d/meshCellPassSettings";

const BEFORE_SIMULATION_PRIORITY = -1;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

const Demo3dCellsAction = {
    ToggleHalfBlock: "toggleHalfBlock",
} as const;

export class Demo3dCellsControlsSystem extends System {
    private _settings = this.createEntityQuery([MeshCellPassSettings]);
    private _actions!: ResolvedInputActions<typeof Demo3dCellsAction>;

    override priority(): number {
        return BEFORE_SIMULATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(CellsRenderBackend);
        this._actions = resolveInputActions(this.world, Demo3dCellsAction);
    }

    onUpdate(): void {
        if (!this.world.resources.get(Input).actionPressed(this._actions.ToggleHalfBlock)) return;
        this._settings.stream({write: {settings: MeshCellPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
            settings.halfBlockCells = !settings.halfBlockCells;
        });
    }
}
