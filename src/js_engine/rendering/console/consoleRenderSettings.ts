import {Component} from "../../core";
import {Ansi} from "./ansi";

export class ConsoleRenderSettings extends Component {
    public static readonly DEFAULT_BACKGROUND_CHAR = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

    public backgroundChar: string = ConsoleRenderSettings.DEFAULT_BACKGROUND_CHAR;
}
