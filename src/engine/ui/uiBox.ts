import {UiNodeComponent} from "./uiNodeComponent";
import {TextColor} from "../rendering/textColor";
import type {FlexBoxStyle, UiBorderStyle} from "./layout/flexStyle";

export class UiBox extends UiNodeComponent implements FlexBoxStyle {
    public background: TextColor = TextColor.DEFAULT;
    public border: UiBorderStyle = "none";
    public borderColor: TextColor = TextColor.DEFAULT;
}
