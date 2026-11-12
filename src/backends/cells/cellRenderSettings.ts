import {Component} from "../../engine/core";
import {Ansi} from "./ansiEncoding";

export class CellRenderSettings extends Component {
    public static readonly DEFAULT_BACKGROUND_CHAR = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

    public backgroundChar: string = CellRenderSettings.DEFAULT_BACKGROUND_CHAR;
}
