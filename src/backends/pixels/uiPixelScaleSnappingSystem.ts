import {System} from "../../engine/core";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import {UI_SCALE_SNAPPING_PRIORITY} from "../../engine/ui/uiSystemPriorities";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiScaleSnapping} from "../../engine/ui/uiScaleSnapping";
import type {UiScaleRule} from "../../engine/ui/uiScaleSnapping";
import {PixelRenderSettings, pixelsPerScreenUnitXOf} from "./pixelRenderSettings";

const MIN_UNIT_WIDTH_PX = 1;
const NO_RULE_INSTALLED = 0;

export function uiUnitWidthPx(scale: number, pixelsPerScreenUnitX: number): number {
    return Math.max(MIN_UNIT_WIDTH_PX, Math.round(scale * pixelsPerScreenUnitX));
}

export class WholePixelUiScaleRule implements UiScaleRule {
    public constructor(public readonly pixelsPerScreenUnitX: number) {
    }

    public effectiveScale(requestedScale: number): number {
        return uiUnitWidthPx(requestedScale, this.pixelsPerScreenUnitX) / this.pixelsPerScreenUnitX;
    }

    public deviceUnitsPerUiUnitX(effectiveScale: number): number {
        return uiUnitWidthPx(effectiveScale, this.pixelsPerScreenUnitX);
    }

    public deviceUnitsPerUiUnitY(effectiveScale: number): number {
        return uiUnitWidthPx(effectiveScale, this.pixelsPerScreenUnitX) * SCREEN_UNIT_HEIGHT_PER_WIDTH;
    }
}

export class UiPixelScaleSnappingSystem extends System {
    private readonly _roots = this.createEntityQuery([UiRoot]);
    private readonly _settings = this.createEntityQuery([PixelRenderSettings]);
    private _rulePixelsPerScreenUnitX = NO_RULE_INSTALLED;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return UI_SCALE_SNAPPING_PRIORITY;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._roots);
        this.useCurrentUnit();
    }

    onUpdate() {
        this.useCurrentUnit();
    }

    private useCurrentUnit(): void {
        const pixelsPerScreenUnitX = pixelsPerScreenUnitXOf(this._settings.tryGetSingleton({settings: PixelRenderSettings})?.settings);
        if (pixelsPerScreenUnitX === this._rulePixelsPerScreenUnitX) return;
        this._rulePixelsPerScreenUnitX = pixelsPerScreenUnitX;
        this.world.resources.getOrCreate(UiScaleSnapping).use(new WholePixelUiScaleRule(pixelsPerScreenUnitX));
    }
}
