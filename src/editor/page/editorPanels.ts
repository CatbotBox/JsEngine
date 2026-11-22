export type BottomTab = "project" | "console" | "history" | "settings" | "assets";

export const BOTTOM_TABS: readonly BottomTab[] = ["project", "console", "history", "settings", "assets"];
export const DEFAULT_BOTTOM_TAB: BottomTab = "project";
export const BOTTOM_TAB_LABELS: Readonly<Record<BottomTab, string>> = {project: "Project", console: "Console", history: "History", settings: "Settings", assets: "Data Assets"};
