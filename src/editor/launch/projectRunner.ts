import type {Entity} from "../../engine/core";
import {errorFramesOf} from "../../engine/debugging/errorStack";
import type {InputEvent, InputEventSink} from "../../engine/input/inputEvent";
import {describeSchemaChange} from "../../engine/scene/schemaChanges";
import type {SceneLoadReport} from "../../engine/scene/sceneSerialization";
import type {EditorNoticeLevel, EditorProject, EditorSession, EditorShell, EntityRemap, SceneViewSlot, SceneViewSlotWatcher} from "../page/editorSession";
import type {CellArea} from "../../hosts/web/domInput";
import {sameGameTarget} from "../project/editorSettings";
import type {GameTarget} from "../project/editorSettings";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {SceneViewId} from "../project/dockPanelIds";
import {BundleStackMapper} from "../page/stackMapper";
import {gameTargetLabelText} from "./gameTargets";
import {ProjectWorkerSession} from "./projectWorkerSession";
import type {EditorViewports, SessionVisibility} from "./projectWorkerSession";
import type {EditorViewport, SceneViewport} from "./editorViewport";

export const RELOAD_WORKER_START_TIMEOUT_MS = 120_000;

export interface ReloadNotice {
    readonly level: EditorNoticeLevel;
    readonly text: string;
}

export interface WorkerBuild {
    readonly workerUrl: string;
    readonly gameTarget: GameTarget;
}

export type EditorViewportFactory = (gameTarget: GameTarget, container: HTMLElement, visible: boolean) => EditorViewport;
export type SceneViewportFactory = (gameTarget: GameTarget, container: HTMLElement, visible: boolean) => SceneViewport;

export interface ProjectRunnerOptions {
    readonly shell: EditorShell;
    readonly gameTarget: GameTarget;
    readonly gameContainer: HTMLElement;
    readonly viewportFor: EditorViewportFactory;
    readonly sceneViewportFor: SceneViewportFactory;
    readonly onTargetChanged: (gameTarget: GameTarget) => void;
    readonly files: ProjectFileSystem;
    readonly project: EditorProject;
    readonly search: string;
    readonly onReady: () => void;
    readonly onStopped: () => void;
}

const VISIBLE: SessionVisibility = {visible: true};
const HIDDEN: SessionVisibility = {visible: false};
const VISIBLE_VIEWPORT = true;
const HIDDEN_VIEWPORT = false;
const RELOADED_SUMMARY = "Reloaded the game code";

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function entityRemapOf(before: readonly Entity[], after: readonly Entity[]): Map<Entity, Entity> {
    const remap = new Map<Entity, Entity>();
    const count = Math.min(before.length, after.length);
    for (let index = 0; index < count; index++) remap.set(before[index], after[index]);
    return remap;
}

function listed(names: readonly string[]): string {
    return names.join(", ");
}

export function switchedTargetSummary(gameTarget: GameTarget): string {
    return `Switched to ${gameTargetLabelText(gameTarget)}`;
}

export function reloadNotices(report: SceneLoadReport, entityCount: number, summary: string = RELOADED_SUMMARY): ReloadNotice[] {
    const notices: ReloadNotice[] = [{level: "info", text: `${summary} (${entityCount} entities carried over)`}];
    for (const change of report.changedSchemas) notices.push({level: "warn", text: describeSchemaChange(change)});
    for (const skipped of report.skippedComponentTypes) {
        notices.push({level: "warn", text: `${skipped.typeName} was dropped from ${skipped.entityCount} entities: it has no registered schema in the new code`});
    }
    for (const name of report.skippedResourceTypes) {
        notices.push({level: "warn", text: `Resource ${name} was reset: it has no registered schema in the new code`});
    }
    if (report.droppedComponents.length > 0) notices.push({level: "warn", text: `Dropped components: ${listed(report.droppedComponents)}`});
    if (report.danglingEntityRefs.length > 0) notices.push({level: "warn", text: `References to missing entities were cleared: ${listed(report.danglingEntityRefs)}`});
    return notices;
}

interface SceneSlotState {
    readonly slot: SceneViewSlot;
    shown: boolean;
}

function disposeViewports(viewports: EditorViewports): void {
    for (const viewport of viewports.scenes.values()) viewport.dispose();
    viewports.game.dispose();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} did not finish within ${timeoutMs} ms`)), timeoutMs);
        promise.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

export class ProjectRunner {
    public readonly input: InputEventSink = {
        enqueue: (event: InputEvent) => this.current?.input.enqueue(event),
    };

    public readonly sceneViews: SceneViewSlotWatcher = {
        opened: (slot, shown) => this.sceneViewOpened(slot, shown),
        shown: (view, shown) => this.sceneViewShown(view, shown),
        closed: view => this.sceneViewClosed(view),
    };

    private readonly stackMapper = new BundleStackMapper(location.href);
    private readonly sceneSlots = new Map<SceneViewId, SceneSlotState>();
    private current: ProjectWorkerSession | undefined;
    private viewports: EditorViewports;
    private mounted = false;
    private reloading = false;
    private queuedBuild: WorkerBuild | undefined;
    private stopped = false;

    public constructor(private readonly options: ProjectRunnerOptions) {
        this.viewports = {game: options.viewportFor(options.gameTarget, options.gameContainer, VISIBLE_VIEWPORT), scenes: new Map()};
    }

    public get gameTarget(): GameTarget {
        return this.viewports.game.gameTarget;
    }

    public cellArea(): CellArea {
        return this.viewports.game.cellArea();
    }

    public showError(text: string): void {
        this.viewports.game.showError(text);
    }


    public async start(workerUrl: string): Promise<void> {
        const session = await this.startSession(workerUrl, this.viewports, VISIBLE);
        this.current = session;
        await this.options.shell.mount(this.editorSession(session));
        this.mounted = true;
        this.options.onReady();
        this.runQueuedReload();
    }

    public reload(build: WorkerBuild): void {
        if (this.stopped) return;
        if (!this.mounted || this.reloading) {
            this.queuedBuild = build;
            return;
        }
        void this.performReload(build);
    }

    public exit(): void {
        this.current?.exit();
    }

    private sceneViewOpened(slot: SceneViewSlot, shown: boolean): void {
        if (this.sceneSlots.has(slot.view)) return;
        this.sceneSlots.set(slot.view, {slot, shown});
        const viewport = this.options.sceneViewportFor(this.gameTarget, slot.viewport, VISIBLE_VIEWPORT);
        this.viewports.scenes.set(slot.view, viewport);
        this.current?.openSceneView(slot.view, viewport, shown);
    }

    private sceneViewShown(view: SceneViewId, shown: boolean): void {
        const state = this.sceneSlots.get(view);
        if (state === undefined) return;
        state.shown = shown;
        this.current?.setSceneViewShown(view, shown);
    }

    private sceneViewClosed(view: SceneViewId): void {
        if (!this.sceneSlots.delete(view)) return;
        this.current?.closeSceneView(view);
        this.viewports.scenes.get(view)?.dispose();
        this.viewports.scenes.delete(view);
    }

    private scenesShown(): Map<SceneViewId, boolean> {
        return new Map([...this.sceneSlots].map(([view, state]) => [view, state.shown]));
    }

    private hiddenViewports(gameTarget: GameTarget): EditorViewports {
        const {viewportFor, sceneViewportFor} = this.options;
        return {
            game: viewportFor(gameTarget, this.options.gameContainer, HIDDEN_VIEWPORT),
            scenes: new Map([...this.sceneSlots].map(([view, state]) => [view, sceneViewportFor(gameTarget, state.slot.viewport, HIDDEN_VIEWPORT)])),
        };
    }

    private matchSceneViews(session: ProjectWorkerSession, viewports: EditorViewports): void {
        for (const view of session.sceneViewIds) {
            if (this.sceneSlots.has(view)) continue;
            session.closeSceneView(view);
            viewports.scenes.get(view)?.dispose();
            viewports.scenes.delete(view);
        }
        for (const [view, state] of this.sceneSlots) {
            let viewport = viewports.scenes.get(view);
            if (viewport === undefined) {
                viewport = this.options.sceneViewportFor(viewports.game.gameTarget, state.slot.viewport, VISIBLE_VIEWPORT);
                viewports.scenes.set(view, viewport);
            }
            session.openSceneView(view, viewport, state.shown);
            session.setSceneViewShown(view, state.shown);
        }
    }

    private async startSession(workerUrl: string, viewports: EditorViewports, visibility: SessionVisibility): Promise<ProjectWorkerSession> {
        this.stackMapper.addBundle(workerUrl);
        const session = await ProjectWorkerSession.start({
            workerUrl,
            viewports,
            scenesShown: this.scenesShown(),
            files: this.options.files,
            name: this.options.project.name,
            search: this.options.search,
            visibility,
            onQuit: () => {
                this.stopped = true;
                this.options.onStopped();
            },
        });
        return session;
    }

    private editorSession(session: ProjectWorkerSession): EditorSession {
        return {client: session.client, events: session.events, files: this.options.files, project: this.options.project, stackMapper: this.stackMapper, sceneFrames: session.sceneFrames};
    }

    private notice(level: EditorNoticeLevel, text: string, stack?: string): void {
        this.options.shell.notice(level, text, stack);
    }

    private async performReload(build: WorkerBuild): Promise<void> {
        const previous = this.current;
        if (previous === undefined) return;
        this.reloading = true;
        const previousViewports = this.viewports;
        const switching = !sameGameTarget(build.gameTarget, previousViewports.game.gameTarget);
        const viewports = switching ? this.hiddenViewports(build.gameTarget) : previousViewports;
        let next: ProjectWorkerSession | undefined;
        try {
            this.notice("info", switching ? `Switching to ${gameTargetLabelText(build.gameTarget)}...` : "Reloading the game code...");
            const exported = await previous.client.request({op: "exportSnapshot"});
            next = await withTimeout(this.startSession(build.workerUrl, viewports, HIDDEN), RELOAD_WORKER_START_TIMEOUT_MS, "The rebuilt game");
            const imported = await next.client.request({
                op: "importSnapshot",
                documentText: exported.documentText,
                editSnapshotText: exported.editSnapshotText,
                editSnapshotRecords: exported.editSnapshotRecords,
                mode: exported.mode,
                gameplayTicks: exported.gameplayTicks,
            });
            const remap: EntityRemap = entityRemapOf(exported.entities, imported.entities);
            await this.options.shell.replaceSession(this.editorSession(next), remap);
            previous.hide();
            next.show();
            this.current = next;
            this.matchSceneViews(next, viewports);
            previous.dispose();
            if (switching) {
                this.viewports = viewports;
                disposeViewports(previousViewports);
                this.options.onTargetChanged(viewports.game.gameTarget);
            }
            const summary = switching ? switchedTargetSummary(viewports.game.gameTarget) : RELOADED_SUMMARY;
            for (const notice of reloadNotices(imported.report, imported.entities.length, summary)) this.notice(notice.level, notice.text);
        } catch (error) {
            if (next !== undefined && this.current !== next) next.dispose();
            if (viewports !== this.viewports) disposeViewports(viewports);
            const failure = switching ? `Switching to ${gameTargetLabelText(build.gameTarget)} failed` : "Hot reload failed";
            this.notice("error", `${failure}, the previous game code keeps running: ${describeError(error)}`, errorFramesOf(error));
        } finally {
            this.reloading = false;
            this.runQueuedReload();
        }
    }

    private runQueuedReload(): void {
        const queued = this.queuedBuild;
        if (queued === undefined) return;
        this.queuedBuild = undefined;
        this.reload(queued);
    }
}
