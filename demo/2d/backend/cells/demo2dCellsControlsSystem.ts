import {System} from "../../../../src/engine/core";
import {Input, resolveInputActions} from "../../../../src/engine/input";
import type {ResolvedInputActions} from "../../../../src/engine/input";
import {CellsRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {SpriteCellPassSettings} from "../../../../src/backends/cells/2d/spriteCellPassSettings";

const CELLS_CONTROLS_PRIORITY = -20;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

const Demo2dCellsAction = {
    ToggleHalfBlockCells: "toggleHalfBlockCells",
} as const;

export class Demo2dCellsControlsSystem extends System {
    private _settings = this.createEntityQuery([SpriteCellPassSettings]);
    private _actions!: ResolvedInputActions<typeof Demo2dCellsAction>;

    override priority(): number {
        return CELLS_CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(CellsRenderBackend);
        this._actions = resolveInputActions(this.world, Demo2dCellsAction);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        for (const event of input.events) {
            if (event.type === "keyDown" && input.isActionEvent(event, this._actions.ToggleHalfBlockCells)) this.toggleHalfBlockCells();
        }
    }

    private toggleHalfBlockCells(): void {
        this._settings.stream({write: {settings: SpriteCellPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
            settings.halfBlockCells = !settings.halfBlockCells;
        });
    }
}
