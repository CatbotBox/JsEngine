import type {SceneLoadReport, SceneSaveReport, SkippedComponentType} from "../../engine/scene";
import type {EditorMode, EditorPlayState, LoadSceneResult} from "../editorProtocol";

export interface EditorToolbarActions {
    setMode(mode: EditorMode): void;

    step(): void;

    createEntity(): void;

    save(): void;

    load(sceneText: string): void;
}

export const SCENE_FILE_NAME = "scene.json";
export const MAX_LISTED_REPORT_PATHS = 3;

const SCENE_MEDIA_TYPE = "application/json";
const SCENE_FILE_ACCEPT = ".json,application/json";
const MODE_LABELS: Readonly<Record<EditorMode, string>> = {edit: "Editing", play: "Playing", paused: "Paused"};
const ERROR_CLASS = "error";

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

export function sceneSaveStatus(report: SceneSaveReport): string {
    return withWarnings(`Saved ${SCENE_FILE_NAME}`, [
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

export function downloadText(document: Document, fileName: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], {type: SCENE_MEDIA_TYPE}));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
}

export class EditorToolbar {
    private readonly play: HTMLButtonElement;
    private readonly pause: HTMLButtonElement;
    private readonly stepButton: HTMLButtonElement;
    private readonly stop: HTMLButtonElement;
    private readonly mode: HTMLElement;
    private readonly status: HTMLOutputElement;

    public constructor(container: HTMLElement, private readonly actions: EditorToolbarActions) {
        const document = container.ownerDocument;
        this.play = this.button(document, "Play", "Snapshot the scene and run the game", () => actions.setMode("play"));
        this.pause = this.button(document, "Pause", "Stop running gameplay, keep the state", () => actions.setMode("paused"));
        this.stepButton = this.button(document, "Step", "Run one gameplay tick", () => actions.step());
        this.stop = this.button(document, "Stop", "Back to editing, restoring the snapshot", () => actions.setMode("edit"));
        this.mode = document.createElement("span");
        this.mode.className = "toolbar-mode";
        const playback = this.group(document, this.play, this.pause, this.stepButton, this.stop, this.mode);

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = SCENE_FILE_ACCEPT;
        fileInput.hidden = true;
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.item(0);
            fileInput.value = "";
            if (file === null || file === undefined) return;
            void file.text().then(text => actions.load(text), error => this.showError(`Could not read ${file.name}: ${String(error)}`));
        });
        const scene = this.group(document,
            this.button(document, "New entity", "Create an entity at the origin", () => actions.createEntity()),
            this.button(document, "Save", `Download the scene as ${SCENE_FILE_NAME}`, () => actions.save()),
            this.button(document, "Load", "Replace the scene with a saved scene file", () => fileInput.click()),
            fileInput,
        );

        this.status = document.createElement("output");
        this.status.className = "toolbar-status";
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        container.replaceChildren(playback, scene, this.status);
        this.showPlayState({mode: "edit", gameplayTicks: 0});
    }

    public showPlayState(state: EditorPlayState): void {
        this.mode.textContent = playStateText(state);
        this.mode.dataset.mode = state.mode;
        this.play.disabled = state.mode === "play";
        this.pause.disabled = state.mode === "paused";
        this.stop.disabled = state.mode === "edit";
    }

    public showMessage(text: string): void {
        this.status.classList.remove(ERROR_CLASS);
        this.status.textContent = text;
        this.status.title = text;
    }

    public showError(text: string): void {
        this.status.classList.add(ERROR_CLASS);
        this.status.textContent = text;
        this.status.title = text;
    }

    private button(document: Document, text: string, title: string, onClick: () => void): HTMLButtonElement {
        const created = document.createElement("button");
        created.type = "button";
        created.textContent = text;
        created.title = title;
        created.addEventListener("click", onClick);
        return created;
    }

    private group(document: Document, ...children: HTMLElement[]): HTMLElement {
        const group = document.createElement("div");
        group.className = "toolbar-group";
        group.append(...children);
        return group;
    }
}
