import type {Entity} from "../../engine/core";
import type {InputEvent, InputEventSink} from "../../engine/input/inputEvent";
import type {SceneLoadReport} from "../../engine/scene/sceneSerialization";
import type {EditorNoticeLevel, EditorProject, EditorSession, EditorShell, EntityRemap} from "../page/editorSession";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorViewport} from "./editorViewport";
import {ProjectWorkerSession} from "./projectWorkerSession";
import type {SessionVisibility} from "./projectWorkerSession";

export const RELOAD_WORKER_START_TIMEOUT_MS = 120_000;

export interface ReloadNotice {
    readonly level: EditorNoticeLevel;
    readonly text: string;
}

export interface ProjectRunnerOptions {
    readonly shell: EditorShell;
    readonly viewport: EditorViewport;
    readonly files: ProjectFileSystem;
    readonly project: EditorProject;
    readonly search: string;
    readonly onReady: () => void;
    readonly onStopped: () => void;
}

const VISIBLE: SessionVisibility = {visible: true};
const HIDDEN: SessionVisibility = {visible: false};

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

export function reloadNotices(report: SceneLoadReport, entityCount: number): ReloadNotice[] {
    const notices: ReloadNotice[] = [{level: "info", text: `Reloaded the game code (${entityCount} entities carried over)`}];
    for (const change of report.changedSchemas) {
        const parts: string[] = [];
        if (change.addedKeys.length > 0) parts.push(`new fields ${listed(change.addedKeys)} start at their defaults`);
        if (change.removedKeys.length > 0) parts.push(`removed fields ${listed(change.removedKeys)} were dropped`);
        notices.push({level: "warn", text: `${change.typeName} changed: ${parts.join("; ")}`});
    }
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
        enqueue: (event: InputEvent) => this.current?.page.input.enqueue(event),
    };

    private current: ProjectWorkerSession | undefined;
    private mounted = false;
    private reloading = false;
    private queuedWorkerUrl: string | undefined;
    private stopped = false;

    public constructor(private readonly options: ProjectRunnerOptions) {
    }

    public async start(workerUrl: string): Promise<void> {
        const session = await this.startSession(workerUrl, VISIBLE);
        this.current = session;
        await this.options.shell.mount(this.editorSession(session));
        this.mounted = true;
        this.options.onReady();
        this.runQueuedReload();
    }

    public reload(workerUrl: string): void {
        if (this.stopped) return;
        if (!this.mounted || this.reloading) {
            this.queuedWorkerUrl = workerUrl;
            return;
        }
        void this.performReload(workerUrl);
    }

    public exit(): void {
        this.current?.exit();
    }

    private startSession(workerUrl: string, visibility: SessionVisibility): Promise<ProjectWorkerSession> {
        return ProjectWorkerSession.start({
            workerUrl,
            viewport: this.options.viewport,
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
        return {client: session.client, events: session.events, files: this.options.files, project: this.options.project};
    }

    private notice(level: EditorNoticeLevel, text: string): void {
        this.options.shell.notice(level, text);
    }

    private async performReload(workerUrl: string): Promise<void> {
        const previous = this.current;
        if (previous === undefined) return;
        this.reloading = true;
        let next: ProjectWorkerSession | undefined;
        try {
            this.notice("info", "Reloading the game code...");
            const exported = await previous.client.request({op: "exportSnapshot"});
            next = await withTimeout(this.startSession(workerUrl, HIDDEN), RELOAD_WORKER_START_TIMEOUT_MS, "The rebuilt game");
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
            for (const notice of reloadNotices(imported.report, imported.entities.length)) this.notice(notice.level, notice.text);
        } catch (error) {
            if (next !== undefined && this.current !== next) next.dispose();
            this.notice("error", `Hot reload failed, the previous game code keeps running: ${describeError(error)}`);
        } finally {
            this.reloading = false;
            this.runQueuedReload();
        }
    }

    private runQueuedReload(): void {
        const queued = this.queuedWorkerUrl;
        if (queued === undefined) return;
        this.queuedWorkerUrl = undefined;
        this.reload(queued);
    }
}
