import type {SceneLoadReport, SceneSaveReport, SkippedComponentType} from "../../engine/scene";
import type {EditorMode, EditorPlayState, LoadSceneResult} from "../editorProtocol";
import {commandButton, dropdownButton} from "./commandButtons";
import type {MenuEntry} from "./commandMenus";
import {createElement} from "./dom";
import type {EditorCommands} from "./editorCommands";
import {gameViewAspectMenu, snapMenu} from "./editorMenus";
import {EDITOR_TOOLS} from "./editorTools";
import type {EditorTool} from "./editorTools";
import type {EditorWorkspace} from "./editorWorkspace";
import {GAME_VIEW_OPTIONS} from "./gameViewOptions";
import {HANDLE_POSITION_LABELS, HANDLE_ROTATION_LABELS} from "./handleModes";
import type {HandleModes} from "./handleModes";
import type {GameViewOption} from "./gameViewOptions";
import {EDITOR_TITLE_HOOK} from "../project/editorUiHooks";
import type {DropdownId} from "../project/editorUiHooks";

export const SCENE_FILE_NAME = "scene.json";
export const MAX_LISTED_REPORT_PATHS = 3;

const MODE_LABELS: Readonly<Record<EditorMode, string>> = {edit: "Editing", play: "Playing", paused: "Paused"};
const HANDLE_POSITION_HINT = "where the handles sit: the primary selection's pivot or the selection's bounds centre";
const HANDLE_ROTATION_HINT = "which way the move handles point: along the primary selection's rotation (Local) or along the world axes (Global)";
const SNAP_HINT = "moves land on the grid, rotation on angle steps and scale on scale steps; hold Ctrl while dragging to flip it for that drag";
const SNAP_STEPS_TEXT = "Steps";
const SNAP_STEPS_TITLE = "Choose the move, rotate and scale snap steps";
const PLAY_HINT = "press again to stop and restore the scene";
const PAUSE_HINT = "pause or resume gameplay";
const STEP_HINT = "run one gameplay tick";
const TARGET_TITLE = "The target the Scene and Game views simulate, both through one renderer (?backend= in the page address overrides it when the editor opens)";
const ASPECT_TITLE = "The Game view's aspect ratio";
const GAME_VIEW_OPTION_BUTTON_TEXT: Readonly<Record<GameViewOption, string>> = {maximizeOnPlay: "Maximize", stats: "Stats"};
const GAME_VIEW_OPTION_HINTS: Readonly<Record<GameViewOption, string>> = {
    maximizeOnPlay: "hide the other panels while the game plays",
    stats: "show ticks per second, tick time, entity count and viewport size over the Game view",
};
const TOOL_HINTS: Readonly<Record<EditorTool, string>> = {
    hand: "Drag to pan the Scene view",
    move: "Drag the selection or its axis handles to move it (Ctrl flips snapping)",
    rotate: "Drag the ring to rotate about the view axis (Ctrl flips snapping)",
    scale: "Drag the axis handles or the centre to scale (Ctrl flips snapping)",
};
const ERROR_CLASS = "error";
const WARNING_CLASS = "warn";
const DIRTY_MARK = " *";
const TITLE_SEPARATOR = " - ";
const NOT_SAVED_TITLE = "Not saved yet";
const DROPDOWN_IDS: Readonly<Record<DropdownId, DropdownId>> = {snapSteps: "snapSteps", gameTarget: "gameTarget", gameViewAspect: "gameViewAspect"};

interface CountedPhrase {
    readonly one: string;
    readonly many: string;
}

const ENTITIES: CountedPhrase = {one: "entity", many: "entities"};
const DANGLING_SAVED: CountedPhrase = {one: "dangling reference saved as null", many: "dangling references saved as null"};
const UNSAVED_ASSETS: CountedPhrase = {one: "asset without a file saved as null", many: "assets without a file saved as null"};
const DANGLING_LOADED: CountedPhrase = {one: "dangling reference loaded as null", many: "dangling references loaded as null"};
const DROPPED_COMPONENTS: CountedPhrase = {one: "dropped component", many: "dropped components"};

function counted(count: number, phrase: CountedPhrase): string {
    return `${count} ${count === 1 ? phrase.one : phrase.many}`;
}

function listedPaths(paths: readonly string[]): string {
    const listed = paths.slice(0, MAX_LISTED_REPORT_PATHS).join(", ");
    const more = paths.length - MAX_LISTED_REPORT_PATHS;
    return more > 0 ? `${listed} and ${more} more` : listed;
}

function skippedText(skipped: readonly SkippedComponentType[]): string[] {
    if (skipped.length === 0) return [];
    return [`skipped ${skipped.map(type => `${type.typeName} (${counted(type.entityCount, ENTITIES)})`).join(", ")}`];
}

function pathsText(paths: readonly string[], phrase: CountedPhrase): string[] {
    return paths.length === 0 ? [] : [`${counted(paths.length, phrase)}: ${listedPaths(paths)}`];
}

function withWarnings(summary: string, warnings: readonly string[]): string {
    return warnings.length === 0 ? summary : `${summary}; ${warnings.join("; ")}`;
}

export function sceneSaveStatus(report: SceneSaveReport, fileName: string = SCENE_FILE_NAME): string {
    return withWarnings(`Saved ${fileName}`, [
        ...skippedText(report.skippedComponentTypes),
        ...pathsText(report.danglingEntityRefs, DANGLING_SAVED),
        ...pathsText(report.unsavedAssets, UNSAVED_ASSETS),
    ]);
}

export function sceneLoadStatus(result: LoadSceneResult): string {
    const report: SceneLoadReport = result.report;
    return withWarnings(`Loaded ${counted(result.entityCount, ENTITIES)}`, [
        ...skippedText(report.skippedComponentTypes),
        ...pathsText(report.danglingEntityRefs, DANGLING_LOADED),
        ...pathsText(report.droppedComponents, DROPPED_COMPONENTS),
    ]);
}

export function playStateText(state: EditorPlayState): string {
    return state.mode === "edit" ? MODE_LABELS.edit : `${MODE_LABELS[state.mode]} (tick ${state.gameplayTicks})`;
}

export function editorTitleText(projectName: string, documentName: string, dirty: boolean): string {
    const document = `${documentName}${dirty ? DIRTY_MARK : ""}`;
    return projectName.length === 0 ? document : `${projectName}${TITLE_SEPARATOR}${document}`;
}

export interface ToolbarOptions {
    gameViewAspectLabel(): string;

    gameTargetLabel(): string;

    gameTargetMenu(): readonly MenuEntry[] | undefined;

    handleModes(): HandleModes;
}

function toolbarGroup(document: Document, className: string, ariaLabel: string, controls: readonly HTMLElement[]): HTMLElement {
    const group = createElement(document, "div", `toolbar-group ${className}`);
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", ariaLabel);
    group.append(...controls);
    return group;
}

export function buildToolbar(container: HTMLElement, commands: EditorCommands, options: ToolbarOptions): void {
    const document = container.ownerDocument;
    const registry = commands.registry;
    const tools = EDITOR_TOOLS.map(tool => commandButton(document, registry, commands.tools.tools[tool], {className: `toolbar-tool tool-${tool}`, hint: TOOL_HINTS[tool]}));
    const handles = [
        commandButton(document, registry, commands.tools.handlePosition, {className: "toolbar-handle-position", text: () => HANDLE_POSITION_LABELS[options.handleModes().position], hint: HANDLE_POSITION_HINT}),
        commandButton(document, registry, commands.tools.handleRotation, {className: "toolbar-handle-rotation", text: () => HANDLE_ROTATION_LABELS[options.handleModes().rotation], hint: HANDLE_ROTATION_HINT}),
    ];
    const snap = [
        commandButton(document, registry, commands.tools.snap, {className: "toolbar-snap", hint: SNAP_HINT}),
        dropdownButton(document, registry, {id: DROPDOWN_IDS.snapSteps, className: "toolbar-snap-steps", title: SNAP_STEPS_TITLE, text: () => SNAP_STEPS_TEXT, entries: () => snapMenu(commands)}),
    ];
    const playback = [
        commandButton(document, registry, commands.play.play, {className: "toolbar-play", hint: PLAY_HINT}),
        commandButton(document, registry, commands.play.pause, {className: "toolbar-pause", hint: PAUSE_HINT}),
        commandButton(document, registry, commands.play.step, {className: "toolbar-step", hint: STEP_HINT}),
    ];
    const target = dropdownButton(document, registry, {
        id: DROPDOWN_IDS.gameTarget,
        className: "toolbar-target",
        title: TARGET_TITLE,
        text: () => options.gameTargetLabel(),
        entries: () => options.gameTargetMenu() ?? [],
        hidden: () => options.gameTargetMenu() === undefined,
    });
    const aspect = dropdownButton(document, registry, {id: DROPDOWN_IDS.gameViewAspect, className: "toolbar-aspect", title: ASPECT_TITLE, text: () => options.gameViewAspectLabel(), entries: () => gameViewAspectMenu(commands)});
    const gameViewToggles = GAME_VIEW_OPTIONS.map(option => commandButton(document, registry, commands.view.gameViewOptions[option], {
        className: `toolbar-game-option game-option-${option}`,
        text: GAME_VIEW_OPTION_BUTTON_TEXT[option],
        hint: GAME_VIEW_OPTION_HINTS[option],
    }));

    const left = createElement(document, "div", "toolbar-section toolbar-left");
    left.append(
        toolbarGroup(document, "toolbar-tools", "Scene tools", tools),
        toolbarGroup(document, "toolbar-handles", "Handle position and rotation", handles),
        toolbarGroup(document, "toolbar-snapping", "Snapping", snap),
    );
    const center = createElement(document, "div", "toolbar-section toolbar-center");
    center.append(toolbarGroup(document, "toolbar-playback", "Play controls", playback));
    const right = createElement(document, "div", "toolbar-section toolbar-right");
    right.append(toolbarGroup(document, "toolbar-game", "Game target and view", [target, aspect, ...gameViewToggles]));
    container.replaceChildren(left, center, right);
}

export class EditorStatusView {
    private readonly title: HTMLElement;
    private readonly mode: HTMLElement;
    private readonly stopped: HTMLElement;
    private readonly status: HTMLOutputElement;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        this.title = createElement(document, "span", "toolbar-title");
        this.title.setAttribute(EDITOR_TITLE_HOOK, "");
        this.mode = createElement(document, "span", "toolbar-mode");
        this.stopped = createElement(document, "span", "toolbar-stopped");
        this.stopped.hidden = true;
        this.status = createElement(document, "output", "toolbar-status");
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        container.replaceChildren(this.title, this.status, this.mode, this.stopped);

        workspace.on("state", () => this.showState());
        workspace.on("document", () => this.showTitle());
        workspace.on("status", () => this.showStatus());
        this.showState();
        this.showTitle();
        this.showStatus();
    }

    private showState(): void {
        const {mode, gameplayTicks, worldStoppedError} = this.workspace;
        const stopped = worldStoppedError !== null;
        this.mode.textContent = playStateText({mode, gameplayTicks});
        this.mode.dataset.mode = mode;
        this.stopped.hidden = !stopped;
        this.stopped.textContent = stopped ? `World stopped: ${worldStoppedError}` : "";
        this.stopped.title = stopped ? `World stopped: ${worldStoppedError}. Load a scene to reset it.` : "";
    }

    private showTitle(): void {
        const scenes = this.workspace.scenes;
        const tab = scenes.activeTab;
        const text = editorTitleText(this.workspace.session.project.name, tab.name, tab.dirty);
        this.title.textContent = text;
        this.title.title = scenes.activeEntry()?.path ?? NOT_SAVED_TITLE;
        this.title.ownerDocument.title = text;
    }

    private showStatus(): void {
        const {level, text} = this.workspace.status;
        this.status.classList.toggle(ERROR_CLASS, level === "error");
        this.status.classList.toggle(WARNING_CLASS, level === "warn");
        this.status.textContent = text;
        this.status.title = text;
    }
}
