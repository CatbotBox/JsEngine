import {System} from "../../../../src/engine/core";
import {PixelsRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {MeshPixelPassSettings} from "../../../../src/backends/pixels/3d/meshPixelPassSettings";
import {SupersamplePresetKeys} from "../../supersamplePresetKeys";

const BEFORE_SIMULATION_PRIORITY = -1;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

export class Demo3dPixelsControlsSystem extends System {
    private _settings = this.createEntityQuery([MeshPixelPassSettings]);
    private _supersamplePresets!: SupersamplePresetKeys;

    override priority(): number {
        return BEFORE_SIMULATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(PixelsRenderBackend);
        this._supersamplePresets = new SupersamplePresetKeys(this.world);
    }

    onUpdate(): void {
        const preset = this._supersamplePresets.pressedPreset();
        if (preset === undefined) return;
        this._settings.stream({write: {settings: MeshPixelPassSettings}}, INCLUDING_DISABLED).consume(({settings}) => {
            settings.supersampleX = preset.x;
            settings.supersampleY = preset.y;
        });
    }
}
