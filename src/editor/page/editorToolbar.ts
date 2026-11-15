import type {SceneLoadReport, SceneSaveReport, SkippedComponentType} from "../../engine/scene";
import type {EditorMode, EditorPlayState, LoadSceneResult} from "../editorProtocol";
import {createButton, createElement} from "./dom";
import {EDITOR_TOOLS} from "./editorTools";
import type {EditorTool} from "./editorTools";
import type {EditorWorkspace} from "./editorWorkspace";

export const SCENE_FILE_NAME = "scene.json";
export const MAX_LISTED_REPORT_PATHS = 3;

const MODE_LABELS: Readonly<Record<EditorMode, string>> = {edit: "Editing", play: "Playing", paused: "Paused"};
const TOOL_LABELS: Readonly<Record<EditorTool, string>> = {hand: "Hand", move: "Move", rotate: "Rotate", scale: "Scale"};
const TOOL_SHORTCUTS: Readonly<Record<EditorTool, string>> = {hand: "Q", move: "W", rotate: "E", scale: "R"};
const TOOL_HINTS: Readonly<Record<EditorTool, string>> = {
    hand: "Drag to pan the Scene view",
    move: "Drag the selection or its axis handles to move it (Ctrl snaps)",
    rotate: "Drag the ring to rotate about the view axis (Ctrl snaps)",
    scale: "Drag the axis handles or the centre to scale (Ctrl snaps)",
};
const ERROR_CLASS = "error";
const WARNING_CLASS = "warn";
const DIRTY_MARK = " *";
const TITLE_SEPARATOR = " - ";

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

export class ToolbarView {
    private readonly play: HTMLButtonElement;
    private readonly pause: HTMLButtonElement;
    private readonly stepButton: HTMLButtonElement;
    private readonly toolButtons = new Map<EditorTool, HTMLButtonElement>();
    private readonly title: HTMLElement;
    private readonly mode: HTMLElement;
    private readonly stopped: HTMLElement;
    private readonly status: HTMLOutputElement;

    public constructor(container: HTMLElement, private readonly workspace: EditorWorkspace) {
        const document = container.ownerDocument;
        this.play = createButton(document, {className: "toolbar-play", text: "Play", title: "Play the scene (Ctrl+P); press again to stop and restore it", onClick: () => this.togglePlay()});
        this.pause = createButton(document, {className: "toolbar-pause", text: "Pause", title: "Pause or resume gameplay", onClick: () => this.togglePause()});
        this.stepButton = createButton(document, {className: "toolbar-step", text: "Step", title: "Run one gameplay tick", onClick: () => void workspace.step()});
        const playback = createElement(document, "div", "toolbar-group");
        playback.append(this.play, this.pause, this.stepButton);

        const tools = createElement(document, "div", "toolbar-group toolbar-tools");
        tools.setAttribute("role", "group");
        tools.setAttribute("aria-label", "Scene tools");
        for (const tool of EDITOR_TOOLS) {
            const button = createButton(document, {
                className: `toolbar-tool tool-${tool}`,
                text: TOOL_LABELS[tool],
                title: `${TOOL_LABELS[tool]} (${TOOL_SHORTCUTS[tool]}): ${TOOL_HINTS[tool]}`,
                onClick: () => workspace.setTool(tool),
            });
            this.toolButtons.set(tool, button);
            tools.append(button);
        }

        const file = createElement(document, "div", "toolbar-group");
        file.append(createButton(document, {className: "toolbar-save", text: "Save", title: "Save the scene (Ctrl+S)", onClick: () => void workspace.saveDocument()}));

        this.title = createElement(document, "span", "toolbar-title");
        this.mode = createElement(document, "span", "toolbar-mode");
        this.stopped = createElement(document, "span", "toolbar-stopped");
        this.stopped.hidden = true;
        this.status = createElement(document, "output", "toolbar-status");
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        container.replaceChildren(playback, tools, file, this.title, this.mode, this.stopped, this.status);

        workspace.on("state", () => this.showState());
        workspace.on("document", () => this.showTitle());
        workspace.on("status", () => this.showStatus());
        this.showState();
        this.showTitle();
    }

    private togglePlay(): void {
        void this.workspace.setMode(this.workspace.mode === "edit" ? "play" : "edit");
    }

    private togglePause(): void {
        void this.workspace.setMode(this.workspace.mode === "paused" ? "play" : "paused");
    }

    private showState(): void {
        const {mode, gameplayTicks, worldStoppedError, closed} = this.workspace;
        const stopped = worldStoppedError !== null;
        this.play.textContent = mode === "edit" ? "Play" : "Stop";
        this.play.classList.toggle("active", mode !== "edit");
        this.play.disabled = closed || (mode === "edit" && stopped);
        this.pause.classList.toggle("active", mode === "paused");
        this.pause.setAttribute("aria-pressed", String(mode === "paused"));
        this.pause.disabled = closed || stopped;
        this.stepButton.disabled = closed || stopped;
        for (const [tool, button] of this.toolButtons) {
            const active = tool === this.workspace.tool;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        this.mode.textContent = playStateText({mode, gameplayTicks});
        this.mode.dataset.mode = mode;
        this.stopped.hidden = !stopped;
        this.stopped.textContent = stopped ? `World stopped: ${worldStoppedError}` : "";
        this.stopped.title = stopped ? `World stopped: ${worldStoppedError}. Load a scene to reset it.` : "";
    }

    private showTitle(): void {
        const text = editorTitleText(this.workspace.session.project.name, this.workspace.documentName, this.workspace.dirty);
        this.title.textContent = text;
        this.title.title = this.workspace.documentPath ?? "Not saved yet";
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
