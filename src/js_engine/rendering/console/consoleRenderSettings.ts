import {Component} from "../../core";
import {Ansi} from "./ansi";

/**
 * Singleton configuration for ConsoleRenderPassSystemGroup. The group is the
 * whole console output pipeline, so it keeps running without this entity and
 * falls back to these defaults.
 */
export class ConsoleRenderSettings extends Component {
    public static readonly DEFAULT_BACKGROUND_CHAR = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

    /** ANSI-decorated single glyph painted on every cell nothing else draws. */
    public backgroundChar: string = ConsoleRenderSettings.DEFAULT_BACKGROUND_CHAR;
}
