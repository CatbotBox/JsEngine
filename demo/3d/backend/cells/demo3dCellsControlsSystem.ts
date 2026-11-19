import {System} from "../../../../src/engine/core";
import {Input, resolveInputActions} from "../../../../src/engine/input";
import type {ResolvedInputActions} from "../../../../src/engine/input";
import {CellsRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {MeshCellPassSettings} from "../../../../src/backends/cells/3d/meshCellPassSettings";
import {SupersamplePresetKeys} from "../../supersamplePresetKeys";

const BEFORE_SIMULATION_PRIORITY = -1;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

const Demo3dCellsAction = {
    ToggleHalfBlock: "toggleHalfBlock",
} as const;

export class Demo3dCellsControlsSystem extends System {
    private _settings = this.createEntityQuery([MeshCellPassSettings]);
    private _actions!: ResolvedInputActions<typeof Demo3dCellsAction>;
    private _supersamplePresets!: SupersamplePresetKeys;

    override priority(): number {
        return BEFORE_SIMULATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(CellsRenderBackend);
        this._actions = resolveInputActions(this.world, Demo3dCellsAction);
        this._supersamplePresets = new SupersamplePresetKeys(this.world);
    }

    onUpdate(): void {
        if (this.world.resources.get(Input).actionPressed(this._actions.ToggleHalfBlock)) {
            this.changeSettings(settings => settings.halfBlockCells = !settings.halfBlockCells);
        }
        const preset = this._supersamplePresets.pressedPreset();
        if (preset === undefined) return;
        this.changeSettings(settings => {
            settings.supersampleX = preset.x;
            settings.supersampleY = preset.y;
        });
    }

    private changeSettings(change: (settings: MeshCellPassSettings) => void): void {
        this._settings.stream({write: {settings: MeshCellPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => change(settings));
    }
}
