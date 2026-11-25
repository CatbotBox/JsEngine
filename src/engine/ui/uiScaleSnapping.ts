import {Resource} from "../core";

export interface UiScaleRule {
    effectiveScale(requestedScale: number): number;
    deviceUnitsPerUiUnitX(effectiveScale: number): number;
    deviceUnitsPerUiUnitY(effectiveScale: number): number;
}

export const REQUESTED_UI_SCALE_RULE: UiScaleRule = {
    effectiveScale: requestedScale => requestedScale,
    deviceUnitsPerUiUnitX: effectiveScale => effectiveScale,
    deviceUnitsPerUiUnitY: effectiveScale => effectiveScale,
};

export class UiScaleSnapping extends Resource {
    private _rule: UiScaleRule = REQUESTED_UI_SCALE_RULE;
    private _version = 0;

    public get version(): number {
        return this._version;
    }

    public effectiveScale(requestedScale: number): number {
        return this._rule.effectiveScale(requestedScale);
    }

    public deviceUnitsPerUiUnitX(effectiveScale: number): number {
        return this._rule.deviceUnitsPerUiUnitX(effectiveScale);
    }

    public deviceUnitsPerUiUnitY(effectiveScale: number): number {
        return this._rule.deviceUnitsPerUiUnitY(effectiveScale);
    }

    public use(rule: UiScaleRule): void {
        this._rule = rule;
        this._version++;
    }
}
