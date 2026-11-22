export type BottomTab = "project" | "console" | "settings" | "assets";

export const BOTTOM_TABS: readonly BottomTab[] = ["project", "console", "settings", "assets"];
export const DEFAULT_BOTTOM_TAB: BottomTab = "project";
export const BOTTOM_TAB_LABELS: Readonly<Record<BottomTab, string>> = {project: "Project", console: "Console", settings: "Settings", assets: "Data Assets"};
