import {UiNodeComponent} from "./uiNodeComponent";
import {TextColor} from "../rendering/textColor";
import type {FlexTextContent, UiTextAlign, UiTextOverflow, UiTextWrap} from "./layout/flexStyle";

export class UiText extends UiNodeComponent implements FlexTextContent {
    public text = "";
    public foreground: TextColor = TextColor.DEFAULT;
    public wrap: UiTextWrap = "none";
    public overflow: UiTextOverflow = "clip";
    public alignX: UiTextAlign = "start";
}
