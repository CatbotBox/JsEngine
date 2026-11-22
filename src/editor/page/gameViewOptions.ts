import type {EditorMode} from "../editorProtocol";

export type GameViewOption = "maximizeOnPlay" | "stats";

export type GameViewOptions = Readonly<Record<GameViewOption, boolean>>;

export interface GameViewOptionChoice {
    readonly option: GameViewOption;
    readonly enabled: boolean;
}

export const GAME_VIEW_OPTIONS_STORAGE_KEY = "jsengine.editor.gameViewOptions";
export const GAME_VIEW_OPTIONS: readonly GameViewOption[] = ["maximizeOnPlay", "stats"];
export const DEFAULT_GAME_VIEW_OPTIONS: GameViewOptions = {maximizeOnPlay: false, stats: false};
export const GAME_VIEW_OPTION_LABELS: Readonly<Record<GameViewOption, string>> = {maximizeOnPlay: "Maximize on Play", stats: "Stats"};

const EDIT_MODE: EditorMode = "edit";

export function parseGameViewOptions(text: string | null): GameViewOptions {
    if (text === null) return DEFAULT_GAME_VIEW_OPTIONS;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return DEFAULT_GAME_VIEW_OPTIONS;
    }
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_GAME_VIEW_OPTIONS;
    const record = parsed as Record<string, unknown>;
    const options: Record<GameViewOption, boolean> = {...DEFAULT_GAME_VIEW_OPTIONS};
    for (const option of GAME_VIEW_OPTIONS) {
        const value = record[option];
        if (typeof value === "boolean") options[option] = value;
    }
    return options;
}

export function gameViewOptionsText(options: GameViewOptions): string {
    return JSON.stringify(options);
}

export function withGameViewOption(options: GameViewOptions, choice: GameViewOptionChoice): GameViewOptions {
    return {...options, [choice.option]: choice.enabled};
}

export function isLayoutMaximized(options: GameViewOptions, mode: EditorMode): boolean {
    return options.maximizeOnPlay && mode !== EDIT_MODE;
}
