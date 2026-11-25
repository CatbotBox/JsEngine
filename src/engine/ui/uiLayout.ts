import {UiNodeComponent} from "./uiNodeComponent";
import type {FlexContainerStyle, UiAlign, UiDirection, UiJustify} from "./layout/flexStyle";

export class UiLayout extends UiNodeComponent implements FlexContainerStyle {
    public direction: UiDirection = "column";
    public paddingLeft = 0;
    public paddingTop = 0;
    public paddingRight = 0;
    public paddingBottom = 0;
    public gap = 0;
    public justify: UiJustify = "start";
    public align: UiAlign = "stretch";
    public clip = false;
}
