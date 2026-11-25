import {UiNodeComponent} from "./uiNodeComponent";
import {TextColor} from "../rendering/textColor";
import type {FlexBoxStyle, UiBorderStyle} from "./layout/flexStyle";
import {NO_UI_STATE, UI_STATE_DISABLED, UI_STATE_HOVERED, UI_STATE_PRESSED} from "./uiState";

export class UiBox extends UiNodeComponent implements FlexBoxStyle {
    public background: TextColor = TextColor.DEFAULT;
    public hoveredBackground: TextColor = TextColor.DEFAULT;
    public pressedBackground: TextColor = TextColor.DEFAULT;
    public disabledBackground: TextColor = TextColor.DEFAULT;
    public border: UiBorderStyle = "none";
    public borderColor: TextColor = TextColor.DEFAULT;
    public hoveredBorderColor: TextColor = TextColor.DEFAULT;
    public pressedBorderColor: TextColor = TextColor.DEFAULT;
    public disabledBorderColor: TextColor = TextColor.DEFAULT;
}

function hasState(stateBits: number, state: number): boolean {
    return (stateBits & state) !== NO_UI_STATE;
}

function colorForState(stateBits: number, normal: TextColor, hovered: TextColor, pressed: TextColor, disabled: TextColor): TextColor {
    if (hasState(stateBits, UI_STATE_DISABLED)) return TextColor.isDefault(disabled) ? normal : disabled;
    if (hasState(stateBits, UI_STATE_PRESSED) && !TextColor.isDefault(pressed)) return pressed;
    if (hasState(stateBits, UI_STATE_HOVERED) && !TextColor.isDefault(hovered)) return hovered;
    return normal;
}

export function uiBoxBackground(box: Readonly<UiBox>, stateBits: number): TextColor {
    return colorForState(stateBits, box.background, box.hoveredBackground, box.pressedBackground, box.disabledBackground);
}

export function uiBoxBorderColor(box: Readonly<UiBox>, stateBits: number): TextColor {
    return colorForState(stateBits, box.borderColor, box.hoveredBorderColor, box.pressedBorderColor, box.disabledBorderColor);
}

export function uiBoxDrawsInAnyState(box: Readonly<UiBox>): boolean {
    return box.border !== "none" || !TextColor.isDefault(box.background) || !TextColor.isDefault(box.hoveredBackground)
        || !TextColor.isDefault(box.pressedBackground) || !TextColor.isDefault(box.disabledBackground);
}
