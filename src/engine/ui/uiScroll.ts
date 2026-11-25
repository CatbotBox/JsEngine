import {UiNodeComponent} from "./uiNodeComponent";
import type {FlexScrollStyle, UiScrollAxes} from "./layout/flexStyle";

export class UiScroll extends UiNodeComponent implements FlexScrollStyle {
    public scrollX = 0;
    public scrollY = 0;
    public axes: UiScrollAxes = "vertical";
    public contentWidth = 0;
    public contentHeight = 0;
}
