import {UiNodeComponent} from "./uiNodeComponent";
import {TextColor} from "../rendering/textColor";
import type {FlexScrollStyle, UiScrollAxes, UiScrollbarMode} from "./layout/flexStyle";

export const DEFAULT_WHEEL_STEP_UNITS = 3;

export class UiScroll extends UiNodeComponent implements FlexScrollStyle {
    public scrollX = 0;
    public scrollY = 0;
    public axes: UiScrollAxes = "vertical";
    public wheelStepUnits = DEFAULT_WHEEL_STEP_UNITS;
    public scrollbar: UiScrollbarMode = "auto";
    public trackColor: TextColor = TextColor.BRIGHT_BLACK;
    public thumbColor: TextColor = TextColor.WHITE;
    public contentWidth = 0;
    public contentHeight = 0;
    public verticalTrackX = 0;
    public verticalTrackY = 0;
    public verticalTrackLength = 0;
    public verticalThumbStart = 0;
    public verticalThumbLength = 0;
    public horizontalTrackX = 0;
    public horizontalTrackY = 0;
    public horizontalTrackLength = 0;
    public horizontalThumbStart = 0;
    public horizontalThumbLength = 0;
}
