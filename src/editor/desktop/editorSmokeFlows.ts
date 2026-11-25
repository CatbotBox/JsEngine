import {join} from "path";
import {
    BUILD_ACTION_HOOK,
    BUILD_TARGET_HOOK,
    BUILD_TARGET_STATE_HOOK,
    CHOICE_HOOK,
    CHOICE_POPUP_HOOK,
    CHOICE_VALUE_HOOK,
    COMMAND_HOOK,
    COMMAND_PALETTE_HOOK,
    COMMAND_PALETTE_SEARCH_HOOK,
    CONSOLE_ACTION_HOOK,
    CONSOLE_ENTRY_HOOK,
    CONSOLE_EXPANDER_HOOK,
    CONSOLE_LEVEL_HOOK,
    CONSOLE_REPEAT_HOOK,
    CONSOLE_SEARCH_HOOK,
    CONSOLE_STACK_HOOK,
    DATA_ASSET_DIRTY_HOOK,
    DATA_ASSET_FIELDS_HOOK,
    DATA_ASSET_HOOK,
    DATA_ASSETS_ACTION_HOOK,
    DOCK_PANEL_HOOK,
    DOCK_STACK_HOOK,
    DOCK_TAB_CLOSE_HOOK,
    DOCK_TAB_HOOK,
    DOCK_WINDOW_HOOK,
    DROPDOWN_HOOK,
    EDITOR_MENU_IDS,
    EDITOR_TITLE_HOOK,
    FIELD_INPUT_HOOK,
    HIERARCHY_ENTITY_HOOK,
    HISTORY_STATE_HOOK,
    HISTORY_STEP_HOOK,
    hookSelector,
    MENU_HOOK,
    MODAL_HOOK,
    MODAL_INPUT_HOOK,
    POPUP_MENU_HOOK,
    PREFAB_BREADCRUMB_HOOK,
    PROJECT_ITEM_HOOK,
    RECENT_PROJECT_HOOK,
    SCENE_TAB_CLOSE_HOOK,
    SCENE_TAB_HOOK,
    START_ACTION_HOOK,
    START_MESSAGE_ACTION_HOOK,
    SUBMENU_HOOK,
    MAIN_DOCK_WINDOW,
    TOOLBAR_HOOK,
} from "../project/editorUiHooks";
import type {DockPanelId, EditorMenuId, ModalKind} from "../project/editorUiHooks";
import {DOCK_LAYOUT_STORAGE_KEY} from "../project/dockWindows";
import type {ScreenBounds} from "../project/dockWindows";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import type {SmokeFlow, SmokeHost, SmokeWindowPage} from "./smokeFlows";
import {SmokeFailure} from "./smokeUi";
import type {SmokeUi} from "./smokeUi";

interface TemplateCommand {
    readonly command: string;
    readonly name: string;
}

interface SmokeProject {
    readonly folder: string;
    readonly name: string;
}

const POPUP = hookSelector(POPUP_MENU_HOOK);
const PALETTE = hookSelector(COMMAND_PALETTE_HOOK);
const PALETTE_SEARCH = `${PALETTE} ${hookSelector(COMMAND_PALETTE_SEARCH_HOOK)}`;
const PALETTE_COMMANDS = `${PALETTE} ${hookSelector(COMMAND_HOOK)}`;
const PALETTE_HIGHLIGHTED = `${PALETTE_COMMANDS}[aria-selected="true"]`;
const TOOLBAR = hookSelector(TOOLBAR_HOOK);
const DOCK_STACK = hookSelector(DOCK_STACK_HOOK);
const ENTITY_ROWS = `${hookSelector(DOCK_PANEL_HOOK, "hierarchy")} ${hookSelector(HIERARCHY_ENTITY_HOOK)}`;
const SELECTED_ENTITY_ROWS = `${ENTITY_ROWS}[aria-selected="true"]`;
const SCENE_TABS = hookSelector(SCENE_TAB_HOOK);
const ACTIVE_SCENE_TAB = `${SCENE_TABS}[aria-selected="true"]`;
const PREFAB_BREADCRUMB = hookSelector(PREFAB_BREADCRUMB_HOOK);
const CHOICE_POPUP = hookSelector(CHOICE_POPUP_HOOK);
const EDITOR_TITLE = hookSelector(EDITOR_TITLE_HOOK);
const PAGE_STATE_SCRIPT = "document.documentElement.dataset.editorState ?? null";
const READY_STATE = "ready";
const START_STATE = "start";
const OPEN_PROJECT_BUTTON = hookSelector(START_ACTION_HOOK, "open");
const CREATE_PROJECT_BUTTON = hookSelector(START_MESSAGE_ACTION_HOOK, "createProject");
const RECENT_PROJECTS = hookSelector(RECENT_PROJECT_HOOK);
const SMOKE_PROJECT_NAME = "Smoke Project";
const BROKEN_PREFAB_FILE = "Broken.prefab.json";
const BROKEN_PREFAB_TEXT = "{\"format\": \"jsengine-scene\", \"entities\": [";
const FAILED_LOAD_TEXT = "\"loadScene\" failed";
const STACK_FRAME = /^\s*at /m;
const ARIA_EXPANDED = "aria-expanded";
const ARIA_SELECTED = "aria-selected";
const ARIA_PRESSED = "aria-pressed";
const ARIA_CHECKED = "aria-checked";
const TRUE_TEXT = "true";
const FALSE_TEXT = "false";
const NO_SUCH_COMMAND_TEXT = "zqxj no such command";
const INSPECTOR_QUERY = "Inspector";
const PALETTE_MIN_COMMANDS = 10;
const DEFAULT_SHOWN_PANELS: readonly DockPanelId[] = ["hierarchy", "scene", "game", "inspector", "project"];
const FIELDS_OPEN_TIMEOUT_MS = 5_000;
const SAVE_WHILE_PLAYING_PRESSES = 3;
const SAVE_WHILE_PLAYING_SEARCH = "saved while editing";
const NO_MATCH_SEARCH = "zqxj no such message";
const PREFERRED_BUILD_TARGET = "terminal";
const BUILD_BUDGET_MS = 180_000;
const BUILD_TIMEOUT_MS = 150_000;
const PROJECT_BUDGET_MS = 180_000;
const PROJECT_OPEN_TIMEOUT_MS = 120_000;
const PREFAB_SUFFIX = ".prefab.json";
const UNDO_CHORD = "Ctrl+Z";
const PALETTE_CHORD = "Ctrl+Shift+P";
const SAVE_CHORD = "Ctrl+S";
const SELECT_ALL_CHORD = "Ctrl+A";
const STEP_UP_CHORD = "ArrowUp";
const ESCAPE_CHORD = "Escape";
const ENTER_CHORD = "Enter";
const BACKSPACE_CHORD = "Backspace";
const TAB_CHORD = "Tab";
const DISABLED_ATTRIBUTE = "disabled";
const TITLE_ATTRIBUTE = "title";
const MOVE_SNAP_SUBMENU = "snap.move3d";
const CREATE_SUBMENU = "create";
const DATA_ASSET_SUBMENU = "createDataAsset";
const COMMANDS = {
    undo: "edit.undo",
    redo: "edit.redo",
    undoHistory: "edit.undoHistory",
    keyboardShortcuts: "help.keyboardShortcuts",
    showInspector: "window.inspector",
    resetLayout: "window.resetLayout",
    floatTab: "window.floatTab",
    dockTab: "window.dockTab",
    showConsole: "window.console",
    showDataAssets: "window.assets",
    pivotCenter: "tools.togglePivotCenter",
    localGlobal: "tools.toggleLocalGlobal",
    moveTool: "tools.move",
    snap: "tools.toggleSnap",
    snapStep: "tools.snapStep",
    play: "play.play",
    newScene: "file.newScene",
    openScene: "file.openScene",
    build: "file.build",
    closeProject: "file.closeProject",
    createEmpty: "entity.createEmpty",
    createDataAsset: "assets.createDataAsset",
    createScript: "assets.createScript",
    openAsset: "assets.open",
} as const;
const PATH_SEPARATORS = /[\\/]+/g;
const NORMALIZED_SEPARATOR = "/";
const ENTITY_TEMPLATES: readonly TemplateCommand[] = [
    {command: "entity.createCamera", name: "Camera"},
    {command: "entity.createSprite", name: "Sprite"},
    {command: "entity.createText", name: "Text"},
    {command: "entity.createMesh", name: "Mesh"},
    {command: "entity.createDirectionalLight", name: "Directional Light"},
    {command: "entity.createPointLight", name: "Point Light"},
    {command: "entity.createAmbientLight", name: "Ambient Light"},
];
const ROTATED_TEMPLATE: TemplateCommand = {command: "entity.createDirectionalLight", name: "Directional Light"};
const SPRITE_TEMPLATE: TemplateCommand = {command: "entity.createSprite", name: "Sprite"};
const EDITED_PATTERN_ROW = "#";
const CREATED_ASSETS: readonly {readonly command: string, readonly name: string, readonly path: string}[] = [
    {command: "assets.createFolder", name: "Smoke Folder", path: "Smoke Folder"},
    {command: "assets.createScene", name: "Smoke Scene", path: "Smoke Scene.scene.json"},
    {command: "assets.createPrefab", name: "Smoke Prefab", path: "Smoke Prefab.prefab.json"},
];
const CREATED_DATA_ASSET_NAME = "Smoke Data";
const CREATED_DATA_ASSET_PATH = "Smoke Data.asset.json";
const CREATED_SCRIPT_NAME = "SmokeSpin";
const RECOVERY_ESCAPES = 3;
const SCRIPT_EXTENSION = ".ts";
const ENABLED_NUMBER_FIELD = `${hookSelector(FIELD_INPUT_HOOK, "number")}:not(:disabled)`;
const MAIN_DOCK = hookSelector(DOCK_WINDOW_HOOK, MAIN_DOCK_WINDOW);
const FLOATING_DOCK = `${hookSelector(DOCK_WINDOW_HOOK)}:not(${MAIN_DOCK})`;
const MOVED_FLOATING_BOUNDS: ScreenBounds = {x: 40, y: 40, width: 460, height: 340};
const CONSOLE_WARNINGS = `${hookSelector(DOCK_PANEL_HOOK, "console")} ${hookSelector(CONSOLE_ENTRY_HOOK, "warn")}`;
const POPUP_BLOCKED_TEXT = "could not open";
const BLOCKED_OPEN_PROPERTY = "__smokeUnblockedOpen";
const BLOCK_POPUPS_SCRIPT = `(() => {
    window.${BLOCKED_OPEN_PROPERTY} = window.open;
    window.open = () => null;
    return true;
})()`;
const UNBLOCK_POPUPS_SCRIPT = `(() => {
    if (window.${BLOCKED_OPEN_PROPERTY} !== undefined) window.open = window.${BLOCKED_OPEN_PROPERTY};
    delete window.${BLOCKED_OPEN_PROPERTY};
    return true;
})()`;
const SAVED_FLOATING_BOUNDS_SCRIPT = `(() => {
    try {
        return JSON.parse(localStorage.getItem(${JSON.stringify(DOCK_LAYOUT_STORAGE_KEY)}) ?? "null")?.floating?.[0]?.bounds ?? null;
    } catch {
        return null;
    }
})()`;
const INSPECTOR_TEXT_LINES_FIELD = `${hookSelector(DOCK_PANEL_HOOK, "inspector")} ${hookSelector(FIELD_INPUT_HOOK, "textLines")}`;

function menuButton(menu: EditorMenuId): string {
    return hookSelector(MENU_HOOK, menu);
}

function popupCommand(command: string): string {
    return `${POPUP} ${hookSelector(COMMAND_HOOK, command)}`;
}

function popupSubmenu(id: string): string {
    return `${POPUP} ${hookSelector(SUBMENU_HOOK, id)}`;
}

function toolbarCommand(command: string): string {
    return `${TOOLBAR} ${hookSelector(COMMAND_HOOK, command)}`;
}

function dockPanel(panel: DockPanelId): string {
    return hookSelector(DOCK_PANEL_HOOK, panel);
}

function dockTab(panel: DockPanelId): string {
    return hookSelector(DOCK_TAB_HOOK, panel);
}

function sameStackScript(first: DockPanelId, second: DockPanelId): string {
    const stackOf = (panel: DockPanelId): string => `document.querySelector(${JSON.stringify(dockTab(panel))})?.closest(${JSON.stringify(DOCK_STACK)})`;
    return `(() => {
        const first = ${stackOf(first)};
        return first !== null && first !== undefined && first === ${stackOf(second)};
    })()`;
}

function modal(kind: ModalKind): string {
    return hookSelector(MODAL_HOOK, kind);
}

function sceneTab(key: string): string {
    return hookSelector(SCENE_TAB_HOOK, key);
}

function projectItem(path: string): string {
    return `${dockPanel("project")} ${hookSelector(PROJECT_ITEM_HOOK, path)}`;
}

function samePath(a: string, b: string): boolean {
    const normalized = (path: string): string => path.replace(PATH_SEPARATORS, NORMALIZED_SEPARATOR).toLowerCase();
    return normalized(a) === normalized(b);
}

async function pageState(ui: SmokeUi): Promise<string | null> {
    return await ui.read<string | null>(PAGE_STATE_SCRIPT);
}

async function waitForPageState(ui: SmokeUi, state: string, timeoutMs?: number): Promise<void> {
    let seen: string | null = null;
    await ui.waitFor(`the editor page to be ${state}`, async () => (seen = await pageState(ui)) === state, timeoutMs).catch(error => {
        throw new SmokeFailure(`${error instanceof Error ? error.message : String(error)}; it was ${String(seen)}`);
    });
}

async function openMenu(ui: SmokeUi, menu: EditorMenuId): Promise<void> {
    await ui.click(menuButton(menu), `the ${menu} menu`);
    await ui.waitForVisible(POPUP, `the ${menu} menu popup`);
}

async function closeMenus(ui: SmokeUi): Promise<void> {
    await ui.press(ESCAPE_CHORD);
    await ui.waitForNone(POPUP, "the popup menu");
}

async function runFromMenu(ui: SmokeUi, menu: EditorMenuId, command: string, submenus: readonly string[] = []): Promise<void> {
    await openMenu(ui, menu);
    for (const submenu of submenus) await ui.click(popupSubmenu(submenu), `the ${submenu} submenu`);
    await ui.click(popupCommand(command), command);
    await ui.waitForNone(POPUP, "the popup menu");
}

async function menuCommandEnabled(ui: SmokeUi, menu: EditorMenuId, command: string): Promise<boolean> {
    await openMenu(ui, menu);
    await ui.waitForVisible(popupCommand(command), command);
    return await ui.attribute(popupCommand(command), DISABLED_ATTRIBUTE) === null;
}

async function showDockTab(ui: SmokeUi, panel: DockPanelId): Promise<void> {
    await ui.click(dockTab(panel), `the ${panel} tab`);
    await ui.waitForAttribute(dockTab(panel), ARIA_SELECTED, TRUE_TEXT, `the ${panel} tab`);
    await ui.waitForVisible(dockPanel(panel), `the ${panel} panel`);
}

async function inSameStack(ui: SmokeUi, first: DockPanelId, second: DockPanelId): Promise<boolean> {
    return await ui.read<boolean>(sameStackScript(first, second));
}

async function answerTextPrompt(ui: SmokeUi, text: string): Promise<void> {
    const input = `${modal("text")} ${hookSelector(MODAL_INPUT_HOOK)}`;
    await ui.waitForVisible(modal("text"), "the name prompt");
    await ui.waitForFocus(input, "the name prompt's field");
    await ui.press(SELECT_ALL_CHORD);
    await ui.type(text);
    await ui.press(ENTER_CHORD);
    await ui.waitForNone(modal("text"), "the name prompt");
}

async function createFromTemplate(ui: SmokeUi, template: TemplateCommand, rowsBefore: number): Promise<void> {
    await ui.click(popupCommand(template.command), template.command);
    await ui.waitForCount(ENTITY_ROWS, rowsBefore + 1, "hierarchy entity rows");
    await ui.waitFor(`the new ${template.name} to be selected in the hierarchy`, async () => (await ui.texts(SELECTED_ENTITY_ROWS)).includes(template.name));
}

async function undoCreation(ui: SmokeUi, rowsBefore: number): Promise<void> {
    await ui.press(UNDO_CHORD);
    await ui.waitForCount(ENTITY_ROWS, rowsBefore, "hierarchy entity rows after undo");
}

const menusFlow: SmokeFlow = {
    name: "menus",
    async run({ui}) {
        for (const menu of EDITOR_MENU_IDS) {
            await openMenu(ui, menu);
            await ui.waitForAttribute(menuButton(menu), ARIA_EXPANDED, TRUE_TEXT, `the ${menu} menu button`);
            ui.expect(await ui.visibleCount(`${POPUP} ${hookSelector(COMMAND_HOOK)}`) > 0, `the ${menu} menu lists no commands`);
            await closeMenus(ui);
            await ui.waitForAttribute(menuButton(menu), ARIA_EXPANDED, FALSE_TEXT, `the ${menu} menu button`);
        }
        await openMenu(ui, "file");
        await ui.hover(menuButton("edit"), "the edit menu");
        await ui.waitForAttribute(menuButton("edit"), ARIA_EXPANDED, TRUE_TEXT, "the edit menu after hovering it with the file menu open");
        await ui.waitForAttribute(menuButton("file"), ARIA_EXPANDED, FALSE_TEXT, "the file menu after hovering away");
        await ui.waitForVisible(popupCommand(COMMANDS.undo), "Undo in the edit menu");
        await ui.click(menuButton("edit"), "the open edit menu");
        await ui.waitForNone(POPUP, "the popup menu after clicking its menu again");
        await runFromMenu(ui, "help", COMMANDS.keyboardShortcuts);
        await ui.waitForVisible(modal("shortcuts"), "the keyboard shortcuts dialog");
        await ui.press(ESCAPE_CHORD);
        await ui.waitForNone(modal("shortcuts"), "the keyboard shortcuts dialog after Escape");
    },
};

const commandPaletteFlow: SmokeFlow = {
    name: "commandPalette",
    async run({ui}) {
        await ui.press(PALETTE_CHORD);
        await ui.waitForVisible(PALETTE, "the command palette");
        await ui.waitForFocus(PALETTE_SEARCH, "the palette search");
        ui.expect(await ui.visibleCount(PALETTE_COMMANDS) >= PALETTE_MIN_COMMANDS, "the palette lists too few commands");
        await ui.type(NO_SUCH_COMMAND_TEXT);
        await ui.waitForCount(PALETTE_COMMANDS, 0, "palette commands matching nonsense");
        await ui.press(ESCAPE_CHORD);
        await ui.waitForNone(PALETTE, "the command palette after Escape");
        await ui.middleClick(dockTab("inspector"), "the Inspector tab");
        await ui.waitForNone(dockPanel("inspector"), "the inspector after middle-clicking its tab");
        await ui.press(PALETTE_CHORD);
        await ui.waitForFocus(PALETTE_SEARCH, "the palette search");
        await ui.type(INSPECTOR_QUERY);
        await ui.waitForAttribute(PALETTE_HIGHLIGHTED, COMMAND_HOOK, COMMANDS.showInspector, "the highlighted palette command");
        await ui.press(ENTER_CHORD);
        await ui.waitForNone(PALETTE, "the command palette after running a command");
        await ui.waitForVisible(dockPanel("inspector"), "the inspector reopened from the palette");
    },
};

const dockingFlow: SmokeFlow = {
    name: "docking",
    async run({ui}) {
        await ui.waitForVisible(dockPanel("inspector"), "the inspector");
        await ui.click(`${dockTab("inspector")} ${hookSelector(DOCK_TAB_CLOSE_HOOK)}`, "the Inspector tab's close button");
        await ui.waitForNone(dockTab("inspector"), "the Inspector tab after closing it");
        await ui.waitForNone(dockPanel("inspector"), "the inspector after closing its tab");
        await runFromMenu(ui, "window", COMMANDS.showInspector);
        await ui.waitForAttribute(dockTab("inspector"), ARIA_SELECTED, TRUE_TEXT, "the reopened Inspector tab");
        await ui.waitForVisible(dockPanel("inspector"), "the inspector after Window > Inspector");
        ui.expect(!await inSameStack(ui, "console", "hierarchy"), "the Console tab already shares the Hierarchy's stack");
        await ui.drag(dockTab("console"), dockTab("hierarchy"), "dragging the Console tab onto the Hierarchy tab");
        await ui.waitFor("the Console tab to join the Hierarchy's stack", () => inSameStack(ui, "console", "hierarchy"));
        await ui.waitForAttribute(dockTab("console"), ARIA_SELECTED, TRUE_TEXT, "the moved Console tab");
        await ui.waitForVisible(dockPanel("console"), "the console in the Hierarchy's stack");
        await ui.waitForNone(dockPanel("hierarchy"), "the hierarchy behind the Console tab");
        await runFromMenu(ui, "window", COMMANDS.resetLayout);
        await ui.waitFor("Reset Layout to put the Console tab back beside the Project tab", () => inSameStack(ui, "console", "project"));
        ui.expect(!await inSameStack(ui, "console", "hierarchy"), "the Console tab stayed in the Hierarchy's stack after Reset Layout");
        for (const panel of DEFAULT_SHOWN_PANELS) await ui.waitForVisible(dockPanel(panel), `the ${panel} panel after Reset Layout`);
    },
};

function sameBounds(a: ScreenBounds | null, b: ScreenBounds): boolean {
    return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function boundsText(bounds: ScreenBounds | null): string {
    return bounds === null ? "none" : `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
}

async function onlyFloatingWindow(ui: SmokeUi, host: SmokeHost, description: string, replacing?: SmokeWindowPage): Promise<SmokeWindowPage> {
    const fresh = (): SmokeWindowPage[] => host.floatingWindows().filter(window => window.id !== replacing?.id);
    await ui.waitFor(`${description} to be the only floating window`, async () => host.floatingWindows().length === 1 && fresh().length === 1);
    return fresh()[0];
}

async function noFloatingWindows(ui: SmokeUi, host: SmokeHost, description: string): Promise<void> {
    await ui.waitFor(description, async () => host.floatingWindows().length === 0);
}

async function floatFromTabMenu(ui: SmokeUi, panel: DockPanelId): Promise<void> {
    await ui.rightClick(dockTab(panel), `the ${panel} tab`);
    await ui.click(popupCommand(COMMANDS.floatTab), `Float Tab in the ${panel} tab's menu`);
    await ui.waitForNone(POPUP, "the tab menu");
}

async function withPopupsBlocked(ui: SmokeUi, blocked: () => Promise<void>): Promise<void> {
    await ui.read<boolean>(BLOCK_POPUPS_SCRIPT);
    try {
        await blocked();
    } finally {
        await ui.read<boolean>(UNBLOCK_POPUPS_SCRIPT);
    }
}

async function floatingWindowFlowSteps(ui: SmokeUi, host: SmokeHost, note: (text: string) => void): Promise<void> {
    ui.expect(host.floatingWindows().length === 0, "a floating window was already open");
    const floatingConsole = `${FLOATING_DOCK} ${dockPanel("console")}`;
    const search = `${dockPanel("console")} ${hookSelector(CONSOLE_SEARCH_HOOK)}`;
    const entries = `${dockPanel("console")} ${hookSelector(CONSOLE_ENTRY_HOOK)}`;
    await showDockTab(ui, "console");
    await floatFromTabMenu(ui, "console");
    const floating = await onlyFloatingWindow(ui, host, "the Console's window");
    const floatingUi = ui.onPage(floating);
    await floatingUi.waitForVisible(floatingConsole, "the console in its floating window");
    await ui.waitForNone(dockTab("console"), "the Console tab in the main window");
    ui.expect(await ui.read<boolean>("crossOriginIsolated"), "the main window lost cross-origin isolation once a floating window opened");
    await floatingUi.click(search, "the floating console's search");
    await floatingUi.waitForFocus(search, "the floating console's search");
    await floatingUi.type(NO_MATCH_SEARCH);
    await floatingUi.waitForCount(entries, 0, "floating console entries matching nonsense");
    await floatingUi.press(SELECT_ALL_CHORD);
    await floatingUi.press(BACKSPACE_CHORD);
    await floatingUi.press(PALETTE_CHORD);
    await floatingUi.waitForVisible(PALETTE, "the command palette opened from the floating window");
    await floatingUi.press(ESCAPE_CHORD);
    await floatingUi.waitForNone(PALETTE, "the floating window's command palette after Escape");
    floating.setBounds(MOVED_FLOATING_BOUNDS);
    const moved = floating.bounds();
    let saved: ScreenBounds | null = null;
    await ui.waitFor(`the layout to save the moved window at ${boundsText(moved)}`, async () => sameBounds(saved = await ui.read<ScreenBounds | null>(SAVED_FLOATING_BOUNDS_SCRIPT), moved))
        .catch(error => ui.fail(`${error instanceof Error ? error.message : String(error)}; saved ${boundsText(saved)}`));
    await host.reloadPage();
    await waitForPageState(ui, READY_STATE, PROJECT_OPEN_TIMEOUT_MS);
    const restored = await onlyFloatingWindow(ui, host, "the Console's window reopened after a reload", floating);
    ui.expect(sameBounds(restored.bounds(), moved), `the reopened window is at ${boundsText(restored.bounds())}, not ${boundsText(moved)}`);
    note(`window ${floating.id} moved to ${boundsText(moved)}; window ${restored.id} reopened at ${boundsText(restored.bounds())} after a reload`);
    const restoredUi = ui.onPage(restored);
    await restoredUi.waitForVisible(floatingConsole, "the console in the reopened floating window");
    await restoredUi.rightClick(dockTab("console"), "the floating Console tab");
    await restoredUi.click(popupCommand(COMMANDS.dockTab), "Dock Tab in the floating Console tab's menu");
    await noFloatingWindows(ui, host, "the floating window to close once its last tab docked");
    await ui.waitFor("the docked Console tab to join the Project tab", () => inSameStack(ui, "console", "project"));
    await ui.dragOutside(dockTab("console"), "dragging the Console tab out of the main window");
    const dragged = await onlyFloatingWindow(ui, host, "the window the dragged Console tab opened");
    await ui.onPage(dragged).waitForVisible(floatingConsole, "the dragged console in its floating window");
    dragged.close();
    await noFloatingWindows(ui, host, "the floating window to close from its frame");
    await ui.waitForNone(dockTab("console"), "the Console tab once its window closed");
    await runFromMenu(ui, "window", COMMANDS.showConsole);
    await ui.waitFor("Window > Console to reopen the Console beside the Project tab", () => inSameStack(ui, "console", "project"));
    await floatFromTabMenu(ui, "console");
    await onlyFloatingWindow(ui, host, "the Console's window, floated again");
    await runFromMenu(ui, "window", COMMANDS.resetLayout);
    await noFloatingWindows(ui, host, "Reset Layout to close the floating window");
    await ui.waitFor("Reset Layout to put the Console tab back beside the Project tab", () => inSameStack(ui, "console", "project"));
    await withPopupsBlocked(ui, async () => {
        await floatFromTabMenu(ui, "console");
        await ui.waitFor("a warning that the blocked window sent the Console back", async () => (await ui.texts(CONSOLE_WARNINGS)).some(text => text.includes(POPUP_BLOCKED_TEXT)));
    });
    ui.expect(host.floatingWindows().length === 0, "a floating window opened while pop-ups were blocked");
    await ui.waitFor("the blocked Console to stay beside the Project tab", () => inSameStack(ui, "console", "project"));
    await ui.dragOutside(dockTab("scene"), "dragging the Scene tab out of the main window");
    await openMenu(ui, "window");
    await closeMenus(ui);
    ui.expect(host.floatingWindows().length === 0, "the Scene view floated, though its canvas cannot leave the main window");
    await ui.waitForVisible(`${MAIN_DOCK} ${dockTab("scene")}`, "the Scene tab still in the main window");
}

const floatingWindowFlow: SmokeFlow = {
    name: "floatingWindow",
    budgetMs: PROJECT_BUDGET_MS,
    async run({ui, host, note}) {
        try {
            await floatingWindowFlowSteps(ui, host, note);
        } finally {
            if (host.floatingWindows().length > 0) await runFromMenu(ui, "window", COMMANDS.resetLayout).catch(() => undefined);
        }
    },
};

const pivotCenterFlow: SmokeFlow = {
    name: "pivotCenter",
    async run({ui}) {
        const button = toolbarCommand(COMMANDS.pivotCenter);
        const before = await ui.text(button);
        ui.expect(before !== undefined && before.length > 0, "the Pivot/Center button shows no mode");
        await ui.click(button, "the Pivot/Center button");
        await ui.waitFor("the Pivot/Center button to switch mode", async () => await ui.text(button) !== before);
        await ui.click(button, "the Pivot/Center button");
        await ui.waitFor(`the Pivot/Center button to show ${before} again`, async () => await ui.text(button) === before);
    },
};

async function pickSnapStep(ui: SmokeUi, submenu: string): Promise<void> {
    await ui.click(hookSelector(DROPDOWN_HOOK, "snapSteps"), "the snap steps dropdown");
    await ui.waitForVisible(POPUP, "the snap steps menu");
    await ui.click(popupSubmenu(submenu), `the ${submenu} submenu`);
    await ui.waitForVisible(popupCommand(COMMANDS.snapStep), "snap step choices");
}

const snapFlow: SmokeFlow = {
    name: "snap",
    async run({ui}) {
        const snap = toolbarCommand(COMMANDS.snap);
        const before = await ui.attribute(snap, ARIA_PRESSED);
        ui.expect(before === TRUE_TEXT || before === FALSE_TEXT, `the Snap button is not a toggle (aria-pressed ${String(before)})`);
        const flipped = before === TRUE_TEXT ? FALSE_TEXT : TRUE_TEXT;
        await ui.click(snap, "the Snap button");
        await ui.waitForAttribute(snap, ARIA_PRESSED, flipped, "the Snap button");
        await ui.click(snap, "the Snap button");
        await ui.waitForAttribute(snap, ARIA_PRESSED, before, "the Snap button");
        const submenu = MOVE_SNAP_SUBMENU;
        const checked = `${popupCommand(COMMANDS.snapStep)}[${ARIA_CHECKED}="${TRUE_TEXT}"]`;
        const unchecked = `${popupCommand(COMMANDS.snapStep)}[${ARIA_CHECKED}="${FALSE_TEXT}"]`;
        await pickSnapStep(ui, submenu);
        const original = await ui.attribute(checked, CHOICE_HOOK);
        const other = await ui.attribute(unchecked, CHOICE_HOOK);
        ui.expect(original !== null && other !== null, "the move step menu marks no current step or offers no other one");
        await ui.click(`${popupCommand(COMMANDS.snapStep)}${hookSelector(CHOICE_HOOK, other!)}`, "another move step");
        await ui.waitForNone(POPUP, "the snap steps menu");
        await pickSnapStep(ui, submenu);
        await ui.waitForAttribute(checked, CHOICE_HOOK, other, "the checked move step");
        await ui.click(`${popupCommand(COMMANDS.snapStep)}${hookSelector(CHOICE_HOOK, original!)}`, "the original move step");
        await ui.waitForNone(POPUP, "the snap steps menu");
        await pickSnapStep(ui, submenu);
        await ui.waitForAttribute(checked, CHOICE_HOOK, original, "the checked move step after restoring it");
        await closeMenus(ui);
    },
};

const entityTemplatesFlow: SmokeFlow = {
    name: "entityTemplates",
    async run({ui, note}) {
        let created = 0;
        const unavailable: string[] = [];
        for (const template of ENTITY_TEMPLATES) {
            const rowsBefore = await ui.visibleCount(ENTITY_ROWS);
            if (!await menuCommandEnabled(ui, "entity", template.command)) {
                const reason = await ui.attribute(popupCommand(template.command), TITLE_ATTRIBUTE);
                ui.expect(reason !== null && reason.length > 0, `${template.name} is disabled without saying why`);
                unavailable.push(template.name);
                await closeMenus(ui);
                continue;
            }
            await createFromTemplate(ui, template, rowsBefore);
            await undoCreation(ui, rowsBefore);
            created++;
        }
        ui.expect(created > 0, "no entity template can be created in this project");
        if (unavailable.length > 0) note(`not offered by this game: ${unavailable.join(", ")}`);
    },
};

const spritePatternFlow: SmokeFlow = {
    name: "spritePattern",
    async run({ui, note}) {
        const rowsBefore = await ui.visibleCount(ENTITY_ROWS);
        if (!await menuCommandEnabled(ui, "entity", SPRITE_TEMPLATE.command)) {
            await closeMenus(ui);
            note(`this game offers no ${SPRITE_TEMPLATE.name}, so no inline sprite pattern was edited`);
            return;
        }
        await createFromTemplate(ui, SPRITE_TEMPLATE, rowsBefore);
        const rows = INSPECTOR_TEXT_LINES_FIELD;
        const rowsText = async (): Promise<string | null> => await ui.read<string | null>(`document.querySelector(${JSON.stringify(rows)})?.value ?? null`);
        await ui.waitForVisible(rows, "the new sprite's pattern rows in the inspector");
        const templateRows = await rowsText();
        ui.expect(templateRows !== null && templateRows.length > 0 && templateRows !== EDITED_PATTERN_ROW, `the new sprite's pattern rows are ${JSON.stringify(templateRows)}`);
        await ui.click(rows, "the pattern rows");
        await ui.waitForFocus(rows, "the pattern rows");
        await ui.press(SELECT_ALL_CHORD);
        await ui.type(EDITED_PATTERN_ROW);
        await ui.press(TAB_CHORD);
        await ui.waitFor("the edited pattern rows to stay after leaving the field", async () => await rowsText() === EDITED_PATTERN_ROW);
        await runFromMenu(ui, "edit", COMMANDS.undo);
        await ui.waitFor("Undo to bring back the template's pattern rows", async () => await rowsText() === templateRows);
        await runFromMenu(ui, "edit", COMMANDS.redo);
        await ui.waitFor("Redo to bring back the edited pattern rows", async () => await rowsText() === EDITED_PATTERN_ROW);
        await runFromMenu(ui, "edit", COMMANDS.undo);
        await ui.waitFor("Undo to bring back the template's pattern rows again", async () => await rowsText() === templateRows);
        await runFromMenu(ui, "edit", COMMANDS.undo);
        await ui.waitForCount(ENTITY_ROWS, rowsBefore, "hierarchy entity rows after undoing the sprite");
    },
};

const localGlobalFlow: SmokeFlow = {
    name: "localGlobal",
    async run({ui, note}) {
        const handles = toolbarCommand(COMMANDS.localGlobal);
        const move = toolbarCommand(COMMANDS.moveTool);
        await ui.click(move, "the Move tool");
        await ui.waitForAttribute(move, ARIA_PRESSED, TRUE_TEXT, "the Move tool");
        const rowsBefore = await ui.visibleCount(ENTITY_ROWS);
        if (!await menuCommandEnabled(ui, "entity", ROTATED_TEMPLATE.command)) {
            await closeMenus(ui);
            ui.expect(await ui.attribute(handles, DISABLED_ATTRIBUTE) !== null, "Local/Global is enabled without a rotated selection");
            note(`this game offers no ${ROTATED_TEMPLATE.name}, so only the disabled Local/Global button was checked`);
            return;
        }
        await createFromTemplate(ui, ROTATED_TEMPLATE, rowsBefore);
        await ui.waitFor("Local/Global to be enabled for the rotated selection", async () => await ui.attribute(handles, DISABLED_ATTRIBUTE) === null);
        const before = await ui.text(handles);
        await ui.click(handles, "the Local/Global button");
        await ui.waitFor("the Local/Global button to switch", async () => await ui.text(handles) !== before);
        await ui.click(handles, "the Local/Global button");
        await ui.waitFor(`the Local/Global button to show ${String(before)} again`, async () => await ui.text(handles) === before);
        await undoCreation(ui, rowsBefore);
    },
};

const undoHistoryFlow: SmokeFlow = {
    name: "undoHistory",
    async run({ui}) {
        await runFromMenu(ui, "edit", COMMANDS.undoHistory);
        await ui.waitForAttribute(dockTab("history"), ARIA_SELECTED, TRUE_TEXT, "the history tab");
        const steps = `${dockPanel("history")} ${hookSelector(HISTORY_STEP_HOOK)}`;
        const current = `${dockPanel("history")} ${hookSelector(HISTORY_STATE_HOOK, "current")}`;
        const undone = `${dockPanel("history")} ${hookSelector(HISTORY_STATE_HOOK, "undone")}`;
        await ui.waitForVisible(current, "the current history step");
        const startDepth = Number(await ui.attribute(current, HISTORY_STEP_HOOK));
        const rowsBefore = await ui.visibleCount(ENTITY_ROWS);
        const createEmpty = `${dockPanel("hierarchy")} ${hookSelector(COMMAND_HOOK, COMMANDS.createEmpty)}`;
        for (const depth of [startDepth + 1, startDepth + 2]) {
            await ui.click(createEmpty, "the hierarchy's Create button");
            await ui.waitForAttribute(current, HISTORY_STEP_HOOK, String(depth), "the current history step");
        }
        await ui.waitForCount(ENTITY_ROWS, rowsBefore + 2, "hierarchy entity rows");
        await ui.waitForCount(undone, 0, "undone history steps");
        await ui.click(`${steps}${hookSelector(HISTORY_STEP_HOOK, startDepth)}`, "the history step before both edits");
        await ui.waitForAttribute(current, HISTORY_STEP_HOOK, String(startDepth), "the current history step");
        await ui.waitForCount(undone, 2, "undone history steps");
        await ui.waitForCount(ENTITY_ROWS, rowsBefore, "hierarchy entity rows after jumping back");
        await ui.click(`${steps}${hookSelector(HISTORY_STEP_HOOK, startDepth + 2)}`, "the last history step");
        await ui.waitForAttribute(current, HISTORY_STEP_HOOK, String(startDepth + 2), "the current history step");
        await ui.waitForCount(ENTITY_ROWS, rowsBefore + 2, "hierarchy entity rows after jumping forward");
        await ui.click(`${steps}${hookSelector(HISTORY_STEP_HOOK, startDepth)}`, "the history step before both edits");
        await ui.waitForCount(ENTITY_ROWS, rowsBefore, "hierarchy entity rows after jumping back again");
    },
};

const sceneTabsFlow: SmokeFlow = {
    name: "sceneTabs",
    async run({ui, note}) {
        const startTabs = await ui.visibleCount(SCENE_TABS);
        const firstKey = await ui.attribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK);
        ui.expect(firstKey !== null, "no scene tab is active");
        const rowsBefore = await ui.visibleCount(ENTITY_ROWS);
        await runFromMenu(ui, "file", COMMANDS.newScene);
        await ui.waitForCount(SCENE_TABS, startTabs + 1, "scene tabs");
        await ui.waitFor("the new scene's tab to be active", async () => await ui.attribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK) !== firstKey);
        const newKey = (await ui.attribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK))!;
        await ui.waitForCount(ENTITY_ROWS, 0, "entity rows of the new empty scene");
        await ui.click(sceneTab(firstKey!), "the first scene tab");
        await ui.waitForAttribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK, firstKey, "the active scene tab");
        await ui.waitForCount(ENTITY_ROWS, rowsBefore, "entity rows of the first scene");
        await runFromMenu(ui, "file", COMMANDS.openScene);
        await ui.waitForVisible(CHOICE_POPUP, "the scene chooser");
        const prefabChoice = `${CHOICE_POPUP} ${hookSelector(CHOICE_VALUE_HOOK)}[${CHOICE_VALUE_HOOK}$="${PREFAB_SUFFIX}"]`;
        await ui.waitFor("the scene chooser to list files", async () => await ui.visibleCount(`${CHOICE_POPUP} ${hookSelector(CHOICE_VALUE_HOOK)}`) > 0);
        if (await ui.visibleCount(prefabChoice) === 0) {
            await ui.press(ESCAPE_CHORD);
            await ui.waitForNone(CHOICE_POPUP, "the scene chooser");
            note("the project has no prefab to open in a tab");
        } else {
            await ui.click(prefabChoice, "a prefab in the scene chooser");
            await ui.waitForCount(SCENE_TABS, startTabs + 2, "scene tabs");
            await ui.waitForVisible(PREFAB_BREADCRUMB, "the prefab breadcrumb");
            const prefabKey = (await ui.attribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK))!;
            ui.expect(prefabKey !== firstKey && prefabKey !== newKey, "the prefab did not open in its own tab");
            await ui.click(`${sceneTab(prefabKey)} ${hookSelector(SCENE_TAB_CLOSE_HOOK)}`, "the prefab tab's close button");
            await ui.waitForCount(SCENE_TABS, startTabs + 1, "scene tabs after closing the prefab");
            await ui.waitForNone(PREFAB_BREADCRUMB, "the prefab breadcrumb");
        }
        await ui.click(`${sceneTab(newKey)} ${hookSelector(SCENE_TAB_CLOSE_HOOK)}`, "the new scene tab's close button");
        await ui.waitForCount(SCENE_TABS, startTabs, "scene tabs after closing the new scene");
        await ui.waitForAttribute(ACTIVE_SCENE_TAB, SCENE_TAB_HOOK, firstKey, "the active scene tab");
        await ui.waitForCount(ENTITY_ROWS, rowsBefore, "entity rows of the first scene");
    },
};

const consoleFlow: SmokeFlow = {
    name: "console",
    async run({ui}) {
        const play = toolbarCommand(COMMANDS.play);
        const warnings = `${dockPanel("console")} ${hookSelector(CONSOLE_ENTRY_HOOK, "warn")}`;
        const repeat = `${warnings} ${hookSelector(CONSOLE_REPEAT_HOOK)}`;
        const collapse = `${dockPanel("console")} ${hookSelector(CONSOLE_ACTION_HOOK, "collapse")}`;
        const search = `${dockPanel("console")} ${hookSelector(CONSOLE_SEARCH_HOOK)}`;
        const warnFilter = `${dockPanel("console")} ${hookSelector(CONSOLE_LEVEL_HOOK, "warn")}`;
        const entries = `${dockPanel("console")} ${hookSelector(CONSOLE_ENTRY_HOOK)}`;
        await showDockTab(ui, "console");
        await ui.click(`${dockPanel("console")} ${hookSelector(CONSOLE_ACTION_HOOK, "clear")}`, "the console's Clear button");
        await ui.waitForCount(entries, 0, "console entries after Clear");
        await ui.click(play, "the Play button");
        await ui.waitForAttribute(play, ARIA_PRESSED, TRUE_TEXT, "the Play button");
        await ui.click(search, "the console search");
        await ui.waitForFocus(search, "the console search");
        await ui.press(SELECT_ALL_CHORD);
        await ui.type(SAVE_WHILE_PLAYING_SEARCH);
        for (let press = 0; press < SAVE_WHILE_PLAYING_PRESSES; press++) await ui.press(SAVE_CHORD);
        await ui.click(play, "the Stop button");
        await ui.waitForAttribute(play, ARIA_PRESSED, FALSE_TEXT, "the Play button");
        await showDockTab(ui, "console");
        await ui.waitForCount(warnings, SAVE_WHILE_PLAYING_PRESSES, "warnings about saving while playing");
        await ui.click(collapse, "the console's Collapse button");
        await ui.waitForAttribute(collapse, ARIA_PRESSED, TRUE_TEXT, "the Collapse button");
        await ui.waitForCount(warnings, 1, "collapsed warnings");
        await ui.waitFor(`the collapsed warning to count ${SAVE_WHILE_PLAYING_PRESSES}`, async () => await ui.text(repeat) === String(SAVE_WHILE_PLAYING_PRESSES));
        await ui.click(warnFilter, "the Warnings filter");
        await ui.waitForAttribute(warnFilter, ARIA_PRESSED, FALSE_TEXT, "the Warnings filter");
        await ui.waitForCount(warnings, 0, "warnings with the Warnings filter off");
        await ui.click(warnFilter, "the Warnings filter");
        await ui.waitForCount(warnings, 1, "warnings with the Warnings filter on");
        await ui.click(collapse, "the console's Collapse button");
        await ui.waitForCount(warnings, SAVE_WHILE_PLAYING_PRESSES, "expanded warnings");
        await ui.click(search, "the console search");
        await ui.press(SELECT_ALL_CHORD);
        await ui.type(NO_MATCH_SEARCH);
        await ui.waitForCount(entries, 0, "console entries matching nonsense");
        await ui.press(SELECT_ALL_CHORD);
        await ui.press(BACKSPACE_CHORD);
        await ui.waitFor("the messages to show again with the search cleared", async () => await ui.visibleCount(entries) >= SAVE_WHILE_PLAYING_PRESSES);
    },
};

async function editableDataAsset(ui: SmokeUi): Promise<string | undefined> {
    const items = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_HOOK)}`;
    const count = await ui.visibleCount(items);
    for (let index = 0; index < count; index++) {
        const paths = await ui.read<string[]>(`[...document.querySelectorAll(${JSON.stringify(items)})].map(item => item.getAttribute(${JSON.stringify(DATA_ASSET_HOOK)}))`);
        const path = paths[index];
        const item = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_HOOK, path)}`;
        await ui.click(item, `the data asset ${path}`);
        await ui.waitForAttribute(item, ARIA_SELECTED, TRUE_TEXT, `the data asset ${path}`);
        const fields = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_FIELDS_HOOK, path)}`;
        const opened = await ui.waitFor(`the fields of ${path}`, () => ui.isVisible(fields), FIELDS_OPEN_TIMEOUT_MS).then(() => true, () => false);
        if (opened && await ui.isVisible(`${fields} ${ENABLED_NUMBER_FIELD}`)) return path;
    }
    return undefined;
}

const dataAssetsFlow: SmokeFlow = {
    name: "dataAssets",
    async run({ui}) {
        await runFromMenu(ui, "window", COMMANDS.showDataAssets);
        await ui.waitForAttribute(dockTab("assets"), ARIA_SELECTED, TRUE_TEXT, "the data assets tab");
        const items = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_HOOK)}`;
        await ui.waitFor("the project's data assets to be listed", async () => await ui.visibleCount(items) > 0);
        const path = await editableDataAsset(ui);
        ui.expect(path !== undefined, "no listed data asset has a number field to edit");
        const item = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_HOOK, path)}`;
        const field = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_FIELDS_HOOK, path)} ${ENABLED_NUMBER_FIELD}`;
        const save = `${dockPanel("assets")} ${hookSelector(DATA_ASSETS_ACTION_HOOK, "save")}`;
        const revert = `${dockPanel("assets")} ${hookSelector(DATA_ASSETS_ACTION_HOOK, "revert")}`;
        const valueScript = `document.querySelector(${JSON.stringify(field)})?.value ?? null`;
        const before = await ui.read<string | null>(valueScript);
        await ui.click(field, "the first number field");
        await ui.waitForFocus(field, "the first number field");
        await ui.press(STEP_UP_CHORD);
        await ui.waitFor("the data asset to be marked changed", async () => await ui.attribute(item, DATA_ASSET_DIRTY_HOOK) !== null);
        await ui.waitForAttribute(save, DISABLED_ATTRIBUTE, null, "the Save button");
        ui.expect(await ui.read<string | null>(valueScript) !== before, "stepping the number field did not change it");
        await ui.click(revert, "the Revert button");
        await ui.waitFor("the data asset to be unchanged again", async () => await ui.attribute(item, DATA_ASSET_DIRTY_HOOK) === null);
        await ui.waitFor("the field to show the saved value", async () => await ui.read<string | null>(valueScript) === before);
        ui.expect(await ui.attribute(save, DISABLED_ATTRIBUTE) !== null, "Save stays enabled after Revert");
    },
};

const buildWindowFlow: SmokeFlow = {
    name: "buildWindow",
    budgetMs: BUILD_BUDGET_MS,
    async run({ui}) {
        const build = modal("build");
        const rows = `${build} ${hookSelector(BUILD_TARGET_HOOK)}`;
        await runFromMenu(ui, "file", COMMANDS.build);
        await ui.waitForVisible(build, "the Build window");
        await ui.waitFor("the Build window to list targets", async () => await ui.visibleCount(rows) > 0);
        const targets = await ui.read<string[]>(`[...document.querySelectorAll(${JSON.stringify(rows)})].map(row => row.getAttribute(${JSON.stringify(BUILD_TARGET_HOOK)}))`);
        const target = targets.includes(PREFERRED_BUILD_TARGET) ? PREFERRED_BUILD_TARGET : targets[0];
        const row = `${build} ${hookSelector(BUILD_TARGET_HOOK, target)}`;
        await ui.click(`${row} ${hookSelector(BUILD_ACTION_HOOK, "build")}`, `Build for ${target}`);
        let state: string | null = null;
        await ui.waitFor(`the ${target} build to finish`, async () => {
            state = await ui.attribute(row, BUILD_TARGET_STATE_HOOK);
            return state === "ok" || state === "failing";
        }, BUILD_TIMEOUT_MS);
        if (state !== "ok") ui.fail(`the ${target} build failed: ${(await ui.text(row)) ?? ""}`);
        await ui.click(`${build} ${hookSelector(BUILD_ACTION_HOOK, "close")}`, "the Build window's Close button");
        await ui.waitForNone(build, "the Build window");
    },
};

function projectFlows(): SmokeFlow[] {
    let project: SmokeProject | undefined;
    const created = (): SmokeProject => {
        if (project === undefined) throw new Error("no smoke project was created");
        return project;
    };
    const closeProject = async (ui: SmokeUi): Promise<void> => {
        await runFromMenu(ui, "file", COMMANDS.closeProject);
        await waitForPageState(ui, START_STATE, PROJECT_OPEN_TIMEOUT_MS);
    };
    const waitForProject = async (ui: SmokeUi, name: string): Promise<void> => {
        await waitForPageState(ui, READY_STATE, PROJECT_OPEN_TIMEOUT_MS);
        await ui.waitFor(`the editor title to name ${name}`, async () => (await ui.text(EDITOR_TITLE) ?? "").includes(name));
    };
    const newProject: SmokeFlow = {
        name: "newProject",
        budgetMs: PROJECT_BUDGET_MS,
        async run({ui, host}) {
            const folder = await host.createTempFolder();
            await closeProject(ui);
            host.answerFolderPick(folder);
            await ui.click(OPEN_PROJECT_BUTTON, "the start screen's Open project button");
            await ui.click(CREATE_PROJECT_BUTTON, "Create project here");
            await answerTextPrompt(ui, SMOKE_PROJECT_NAME);
            await waitForProject(ui, SMOKE_PROJECT_NAME);
            ui.expect(await host.fileExists(join(folder, PROJECT_MANIFEST_FILE)), `${PROJECT_MANIFEST_FILE} was not written to ${folder}`);
            project = {folder, name: SMOKE_PROJECT_NAME};
        },
    };
    const createMenu: SmokeFlow = {
        name: "createMenu",
        requires: [newProject.name],
        budgetMs: PROJECT_BUDGET_MS,
        async run({ui, host, note}) {
            const {folder} = created();
            await showDockTab(ui, "project");
            for (const asset of CREATED_ASSETS) {
                await runFromMenu(ui, "assets", asset.command, [CREATE_SUBMENU]);
                await answerTextPrompt(ui, asset.name);
                await ui.waitForVisible(projectItem(asset.path), `${asset.path} in the Project panel`);
                ui.expect(await host.fileExists(join(folder, asset.path)), `${asset.path} was not written to disk`);
            }
            await openMenu(ui, "assets");
            await ui.click(popupSubmenu(CREATE_SUBMENU), "the create submenu");
            const dataAssetSubmenu = popupSubmenu(DATA_ASSET_SUBMENU);
            await ui.waitForVisible(dataAssetSubmenu, "the data asset submenu");
            if (await ui.attribute(dataAssetSubmenu, DISABLED_ATTRIBUTE) !== null) {
                note("the new project's code registers no resource type, so Create > Data Asset was not offered");
                await closeMenus(ui);
            } else {
                await ui.click(dataAssetSubmenu, "the data asset submenu");
                await ui.click(popupCommand(COMMANDS.createDataAsset), "the first data asset type");
                await ui.waitForNone(POPUP, "the popup menu");
                await answerTextPrompt(ui, CREATED_DATA_ASSET_NAME);
                const opened = `${dockPanel("assets")} ${hookSelector(DATA_ASSET_HOOK, CREATED_DATA_ASSET_PATH)}`;
                await ui.waitForAttribute(dockTab("assets"), ARIA_SELECTED, TRUE_TEXT, "the data assets tab showing the new asset");
                await ui.waitForAttribute(opened, ARIA_SELECTED, TRUE_TEXT, `${CREATED_DATA_ASSET_PATH} in the Data Assets panel`);
                ui.expect(await host.fileExists(join(folder, CREATED_DATA_ASSET_PATH)), `${CREATED_DATA_ASSET_PATH} was not written to disk`);
                await showDockTab(ui, "project");
                await ui.waitForVisible(projectItem(CREATED_DATA_ASSET_PATH), `${CREATED_DATA_ASSET_PATH} in the Project panel`);
            }
            const scripts = `${dockPanel("project")} ${hookSelector(PROJECT_ITEM_HOOK)}[${PROJECT_ITEM_HOOK}$="${SCRIPT_EXTENSION}"]`;
            const scriptsBefore = await ui.visibleCount(scripts);
            await runFromMenu(ui, "assets", COMMANDS.createScript, [CREATE_SUBMENU]);
            await answerTextPrompt(ui, CREATED_SCRIPT_NAME);
            await ui.waitForCount(scripts, scriptsBefore + 1, "scripts in the Project panel");
        },
    };
    const consoleStacks: SmokeFlow = {
        name: "consoleStacks",
        requires: [newProject.name],
        async run({ui, host}) {
            const {folder} = created();
            const errors = `${dockPanel("console")} ${hookSelector(CONSOLE_ENTRY_HOOK, "error")}`;
            const expander = `${errors} ${hookSelector(CONSOLE_EXPANDER_HOOK)}`;
            const stack = `${errors} ${hookSelector(CONSOLE_STACK_HOOK)}`;
            await showDockTab(ui, "console");
            await ui.click(`${dockPanel("console")} ${hookSelector(CONSOLE_ACTION_HOOK, "clear")}`, "the console's Clear button");
            await ui.waitForCount(errors, 0, "console errors after Clear");
            await host.writeFile(join(folder, BROKEN_PREFAB_FILE), BROKEN_PREFAB_TEXT);
            await showDockTab(ui, "project");
            await ui.waitForVisible(projectItem(BROKEN_PREFAB_FILE), `${BROKEN_PREFAB_FILE} in the Project panel`);
            await ui.rightClick(projectItem(BROKEN_PREFAB_FILE), BROKEN_PREFAB_FILE);
            await ui.click(popupCommand(COMMANDS.openAsset), "Open in the file's context menu");
            await showDockTab(ui, "console");
            await ui.waitForCount(errors, 1, "console errors from opening the broken prefab");
            ui.expect(((await ui.text(errors)) ?? "").includes(FAILED_LOAD_TEXT), `the console error does not report the failed load: ${(await ui.text(errors)) ?? ""}`);
            await ui.waitForVisible(expander, "the error's stack expander");
            await ui.waitForNone(stack, "an expanded stack trace");
            await ui.click(expander, "the error's stack expander");
            await ui.waitForAttribute(expander, ARIA_EXPANDED, TRUE_TEXT, "the stack expander");
            await ui.waitFor("the stack trace to show frames", async () => STACK_FRAME.test((await ui.text(stack)) ?? ""));
            await ui.click(expander, "the error's stack expander");
            await ui.waitForNone(stack, "the collapsed stack trace");
        },
    };
    const openProject: SmokeFlow = {
        name: "openProject",
        requires: [newProject.name],
        budgetMs: PROJECT_BUDGET_MS,
        async run({ui, host}) {
            const {folder, name} = created();
            await closeProject(ui);
            await ui.waitForVisible(RECENT_PROJECTS, "the recent projects list");
            const recent = await ui.attribute(RECENT_PROJECTS, RECENT_PROJECT_HOOK);
            ui.expect(recent !== null && samePath(recent, folder), `the most recent project is ${String(recent)}, not ${folder}`);
            await ui.click(RECENT_PROJECTS, "the most recent project");
            await waitForProject(ui, name);
            await closeProject(ui);
            host.answerFolderPick(folder);
            await ui.click(OPEN_PROJECT_BUTTON, "the start screen's Open project button");
            await waitForProject(ui, name);
        },
    };
    return [newProject, createMenu, consoleStacks, openProject];
}

export function editorSmokeFlows(): SmokeFlow[] {
    return [
        menusFlow,
        commandPaletteFlow,
        dockingFlow,
        floatingWindowFlow,
        pivotCenterFlow,
        snapFlow,
        entityTemplatesFlow,
        spritePatternFlow,
        localGlobalFlow,
        undoHistoryFlow,
        sceneTabsFlow,
        consoleFlow,
        dataAssetsFlow,
        buildWindowFlow,
        ...projectFlows(),
    ];
}

export async function recoverEditor(ui: SmokeUi): Promise<void> {
    for (let press = 0; press < RECOVERY_ESCAPES; press++) await ui.press(ESCAPE_CHORD);
}
