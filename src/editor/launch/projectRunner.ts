import type {Entity} from "../../engine/core";
import type {InputEvent, InputEventSink} from "../../engine/input/inputEvent";
import {describeSchemaChange} from "../../engine/scene/schemaChanges";
import type {SceneLoadReport} from "../../engine/scene/sceneSerialization";
import type {EditorNoticeLevel, EditorProject, EditorSession, EditorShell, EntityRemap} from "../page/editorSession";
import type {CellArea} from "../../hosts/web/domInput";
import {sameGameTarget} from "../project/editorSettings";
import type {GameTarget} from "../project/editorSettings";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {BundleStackMapper} from "../page/stackMapper";
import type {EditorViewport} from "./editorViewport";
import {gameTargetLabelText} from "./gameTargets";
import {ProjectWorkerSession} from "./projectWorkerSession";
import type {SessionVisibility} from "./projectWorkerSession";

export const RELOAD_WORKER_START_TIMEOUT_MS = 120_000;

export interface ReloadNotice {
    readonly level: EditorNoticeLevel;
    readonly text: string;
}

export interface WorkerBuild {
    readonly workerUrl: string;
    readonly gameTarget: GameTarget;
}

export interface ProjectRunnerOptions {
    readonly shell: EditorShell;
    readonly viewport: EditorViewport;
    readonly createHiddenViewport: (gameTarget: GameTarget) => EditorViewport;
    readonly onTargetChanged: (gameTarget: GameTarget) => void;
    readonly files: ProjectFileSystem;
    readonly project: EditorProject;
    readonly search: string;
    readonly onReady: () => void;
    readonly onStopped: () => void;
}

const VISIBLE: SessionVisibility = {visible: true};
const HIDDEN: SessionVisibility = {visible: false};
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

    private readonly stackMapper = new BundleStackMapper(location.href);
    private current: ProjectWorkerSession | undefined;
    private viewport: EditorViewport;
    private mounted = false;
    private reloading = false;
    private queuedBuild: WorkerBuild | undefined;
    private stopped = false;

    public constructor(private readonly options: ProjectRunnerOptions) {
        this.viewport = options.viewport;
    }

    public get gameTarget(): GameTarget {
        return this.viewport.gameTarget;
    }

    public cellArea(): CellArea {
        return this.viewport.cellArea();
    }

    public showError(text: string): void {
        this.viewport.showError(text);
    }

    public async start(workerUrl: string): Promise<void> {
        const session = await this.startSession(workerUrl, this.viewport, VISIBLE);
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

    private startSession(workerUrl: string, viewport: EditorViewport, visibility: SessionVisibility): Promise<ProjectWorkerSession> {
        this.stackMapper.addBundle(workerUrl);
        return ProjectWorkerSession.start({
            workerUrl,
            viewport,
            files: this.options.files,
            name: this.options.project.name,
            search: this.options.search,
            visibility,
            onQuit: () => {
                this.stopped = true;
                this.options.onStopped();
            },
        });
    }

    private editorSession(session: ProjectWorkerSession): EditorSession {
        return {client: session.client, events: session.events, files: this.options.files, project: this.options.project, stackMapper: this.stackMapper};
    }

    private notice(level: EditorNoticeLevel, text: string): void {
        this.options.shell.notice(level, text);
    }

    private async performReload(build: WorkerBuild): Promise<void> {
        const previous = this.current;
        if (previous === undefined) return;
        this.reloading = true;
        const previousViewport = this.viewport;
        const switching = !sameGameTarget(build.gameTarget, previousViewport.gameTarget);
        const viewport = switching ? this.options.createHiddenViewport(build.gameTarget) : previousViewport;
        let next: ProjectWorkerSession | undefined;
        try {
            this.notice("info", switching ? `Switching to ${gameTargetLabelText(build.gameTarget)}...` : "Reloading the game code...");
            const exported = await previous.client.request({op: "exportSnapshot"});
            next = await withTimeout(this.startSession(build.workerUrl, viewport, HIDDEN), RELOAD_WORKER_START_TIMEOUT_MS, "The rebuilt game");
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
            previous.dispose();
            if (switching) {
                this.viewport = viewport;
                previousViewport.dispose();
                this.options.onTargetChanged(viewport.gameTarget);
            }
            const summary = switching ? switchedTargetSummary(viewport.gameTarget) : RELOADED_SUMMARY;
            for (const notice of reloadNotices(imported.report, imported.entities.length, summary)) this.notice(notice.level, notice.text);
        } catch (error) {
            if (next !== undefined && this.current !== next) next.dispose();
            if (viewport !== this.viewport) viewport.dispose();
            const failure = switching ? `Switching to ${gameTargetLabelText(build.gameTarget)} failed` : "Hot reload failed";
            this.notice("error", `${failure}, the previous game code keeps running: ${describeError(error)}`);
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
