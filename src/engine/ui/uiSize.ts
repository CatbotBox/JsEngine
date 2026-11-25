import {UiNodeComponent} from "./uiNodeComponent";
import type {FlexSizeStyle, UiSizeMode} from "./layout/flexStyle";

export class UiSize extends UiNodeComponent implements FlexSizeStyle {
    public widthMode: UiSizeMode = "fit";
    public heightMode: UiSizeMode = "fit";
    public width = 1;
    public height = 1;
    public minWidth = 0;
    public maxWidth = Number.POSITIVE_INFINITY;
    public minHeight = 0;
    public maxHeight = Number.POSITIVE_INFINITY;
}
