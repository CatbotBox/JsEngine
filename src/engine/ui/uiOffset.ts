import {UiNodeComponent} from "./uiNodeComponent";
import type {FlexOffsetStyle} from "./layout/flexStyle";

export class UiOffset extends UiNodeComponent implements FlexOffsetStyle {
    public x = 0;
    public y = 0;
    public anchorX = 0;
    public anchorY = 0;
}
