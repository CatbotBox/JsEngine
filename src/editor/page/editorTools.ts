export type EditorTool = "hand" | "move" | "rotate" | "scale";

export const EDITOR_TOOLS: readonly EditorTool[] = ["hand", "move", "rotate", "scale"];

export const TOOL_SHORTCUT_KEYS: Readonly<Record<string, EditorTool>> = {q: "hand", w: "move", e: "rotate", r: "scale"};
