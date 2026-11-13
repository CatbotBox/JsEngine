import {Component} from "../../engine/core";
import {TextColor} from "../../engine/rendering/textColor";
import type {CellBackgroundStyle} from "./cellFrame";

const SPACE = " ";
const SPACE_CODE_POINT = 0x20;

export class CellRenderSettings extends Component {
    public static readonly DEFAULT_BACKGROUND_STYLE: CellBackgroundStyle = Object.freeze({
        glyph: SPACE_CODE_POINT,
        foreground: TextColor.BLACK,
        background: TextColor.BLACK,
    });

    public backgroundGlyph: string = SPACE;
    public backgroundGlyphColor: TextColor = TextColor.BLACK;
    public backgroundColor: TextColor = TextColor.BLACK;

    public backgroundGlyphCodePoint(): number {
        return this.backgroundGlyph.codePointAt(0) ?? SPACE_CODE_POINT;
    }
}
