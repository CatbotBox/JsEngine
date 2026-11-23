import {System} from "@jsengine/engine/core";
import {PixelsRenderBackend} from "@jsengine/engine/rendering";
import {MeshPixelPassSettings} from "@jsengine/backends/pixels/3d";
import {SupersamplePresetKeys} from "../../supersamplePresetKeys";
import {Demo3dTuning} from "../../tuning";

const PIXELS_CONTROLS_PRIORITY = -20;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

export class Demo3dPixelsControlsSystem extends System {
    private _settings = this.createEntityQuery([MeshPixelPassSettings]);
    private _supersamplePresets!: SupersamplePresetKeys;

    override priority(): number {
        return PIXELS_CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(PixelsRenderBackend);
        this.requireResourceForUpdate(Demo3dTuning);
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
