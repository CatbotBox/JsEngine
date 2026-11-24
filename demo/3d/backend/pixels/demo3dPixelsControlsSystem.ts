import {System} from "@jsengine/engine/core";
import {PixelsRenderBackend} from "@jsengine/engine/rendering";
import {MeshPixelPassSettings} from "@jsengine/backends/pixels/3d";
import {SupersamplePresetKeys} from "../../supersamplePresetKeys";
import {Demo3dConfig} from "../../config";
import {INCLUDING_DISABLED} from "../../worldAccess";

const PIXELS_CONTROLS_PRIORITY = -20;

export class Demo3dPixelsControlsSystem extends System {
    private _settings = this.createEntityQuery([MeshPixelPassSettings]);
    private _supersamplePresets!: SupersamplePresetKeys;

    override priority(): number {
        return PIXELS_CONTROLS_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(PixelsRenderBackend);
        this.requireResourceForUpdate(Demo3dConfig);
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
