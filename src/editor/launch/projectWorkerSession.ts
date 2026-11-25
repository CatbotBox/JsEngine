import {connectWorldWorker} from "../../hosts/web/worldWorkerPage";
import type {WorldWorkerPage} from "../../hosts/web/worldWorkerPage";
import {requestedRasterWorkersFromQuery} from "../../hosts/web/worldWorkerProtocol";
import {isEditorEventMessage} from "../editorProtocol";
import type {EditorEvent, EditorViewInfo} from "../editorProtocol";
import {EditorClient} from "../page/editorClient";
import type {EditorEventSource, SceneFrameSource} from "../page/editorSession";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {serveProjectFiles} from "../project/projectFileServing";
import type {ProjectFileServing} from "../project/projectFileServing";
import type {SceneViewId} from "../project/dockPanelIds";
import type {InputEventSink} from "../../engine/input/inputEvent";
import type {EditorSessionDisplay, EditorViewport, SceneSessionDisplay, SceneViewport, SessionDisplayEvents} from "./editorViewport";
import {connectSceneView} from "./sceneViewConnection";
import type {SceneViewConnection} from "./sceneViewConnection";
import {terminalInputMessage} from "./terminalInputChannel";

export const EDITOR_REQUEST_TIMEOUT_MS = 60_000;
export const BUFFERED_EDITOR_EVENT_LIMIT = 1000;

const MODULE_WORKER: WorkerOptions = {type: "module"};
const SCENE_VIEW_FAILURES_KEEP_THE_SESSION: SessionDisplayEvents = {failed: () => undefined};
const SCENE_VIEW_SHOWN = true;

export interface SessionVisibility {
    readonly visible: boolean;
}

export interface EditorViewports {
    readonly game: EditorViewport;
    readonly scenes: Map<SceneViewId, SceneViewport>;
}

export interface ProjectWorkerSessionOptions {
    readonly workerUrl: string;
    readonly viewports: EditorViewports;
    readonly scenesShown: ReadonlyMap<SceneViewId, boolean>;
    readonly files: ProjectFileSystem;
    readonly name: string;
    readonly search: string;
    readonly visibility: SessionVisibility;
    readonly onQuit: () => void;
}

export class WorkerEditorEvents implements EditorEventSource {
    private readonly listeners = new Set<(event: EditorEvent) => void>();
    private buffered: EditorEvent[] | undefined = [];

    public constructor(worker: {addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void}) {
        worker.addEventListener("message", event => {
            if (isEditorEventMessage(event.data)) this.deliver(event.data.event);
        });
    }

    public onEvent(listener: (event: EditorEvent) => void): () => void {
        const entry = (event: EditorEvent) => listener(event);
        this.listeners.add(entry);
        const buffered = this.buffered;
        this.buffered = undefined;
        if (buffered !== undefined) for (const event of buffered) entry(event);
        return () => {
            this.listeners.delete(entry);
        };
    }

    private deliver(event: EditorEvent): void {
        const buffered = this.buffered;
        if (buffered !== undefined) {
            buffered.push(event);
            if (buffered.length > BUFFERED_EDITOR_EVENT_LIMIT) buffered.shift();
            return;
        }
        for (const listener of [...this.listeners]) listener(event);
    }
}

export class SceneFrameListeners implements SceneFrameSource {
    private readonly listeners = new Set<(info: EditorViewInfo) => void>();

    public onFrameInfo(listener: (info: EditorViewInfo) => void): () => void {
        const entry = (info: EditorViewInfo): void => listener(info);
        this.listeners.add(entry);
        return () => {
            this.listeners.delete(entry);
        };
    }

    public deliver(info: EditorViewInfo): void {
        for (const listener of [...this.listeners]) listener(info);
    }
}

interface SessionSceneView {
    readonly display: SceneSessionDisplay;
    readonly connection: SceneViewConnection;
}

interface SceneViewOpening {
    readonly worker: Worker;
    readonly name: string;
    readonly frames: SceneFrameListeners;
}

function openSessionSceneView(opening: SceneViewOpening, view: SceneViewId, viewport: SceneViewport, visible: boolean, shown: boolean): SessionSceneView {
    const display = viewport.sessionDisplay(visible, SCENE_VIEW_FAILURES_KEEP_THE_SESSION);
    return {display, connection: connectSceneView(display, opening.worker, {view, name: opening.name, shown, frameInfo: info => opening.frames.deliver(info)})};
}

function closeSessionSceneView(sceneView: SessionSceneView): void {
    sceneView.connection.close();
    sceneView.display.dispose();
}

export class ProjectWorkerSession {
    public readonly input: InputEventSink;
    private disposed = false;

    private constructor(
        private readonly opening: SceneViewOpening,
        private visible: boolean,
        private readonly display: EditorSessionDisplay,
        private readonly sceneViews: Map<SceneViewId, SessionSceneView>,
        private readonly fileServing: ProjectFileServing,
        public readonly page: WorldWorkerPage,
        public readonly client: EditorClient,
        public readonly events: WorkerEditorEvents,
        viewport: EditorViewport,
    ) {
        this.input = viewport.sessionInput({events: page.input, terminalBytes: data => this.sendTerminalBytes(data)});
    }

    public get sceneFrames(): SceneFrameSource {
        return this.opening.frames;
    }

    public static start(options: ProjectWorkerSessionOptions): Promise<ProjectWorkerSession> {
        const worker = new Worker(options.workerUrl, MODULE_WORKER);
        const events = new WorkerEditorEvents(worker);
        const opening: SceneViewOpening = {worker, name: options.name, frames: new SceneFrameListeners()};
        const fileServing = serveProjectFiles(worker, options.files);
        return new Promise<ProjectWorkerSession>((resolve, reject) => {
            let settled = false;
            let session: ProjectWorkerSession | undefined;
            const fail = (text: string): void => {
                if (settled) return;
                settled = true;
                fileServing.dispose();
                for (const sceneView of sceneViews.values()) sceneView.connection.close();
                worker.terminate();
                if (!options.visibility.visible) {
                    display.dispose();
                    for (const sceneView of sceneViews.values()) sceneView.display.dispose();
                }
                reject(new Error(text));
            };
            const sceneViews = new Map<SceneViewId, SessionSceneView>();
            for (const [view, viewport] of options.viewports.scenes) {
                sceneViews.set(view, openSessionSceneView(opening, view, viewport, options.visibility.visible, options.scenesShown.get(view) ?? SCENE_VIEW_SHOWN));
            }
            const display = options.viewports.game.sessionDisplay(options.visibility.visible, {
                failed: text => {
                    if (!settled) fail(text);
                    else session?.client.close();
                },
            });
            const page = connectWorldWorker(display, worker, {
                name: options.name,
                requestedRasterWorkers: requestedRasterWorkersFromQuery(options.search),
// The client is created on ready: requests sent before the worker attached the editor service are lost.
                onReady: () => {
                    if (settled) return;
                    settled = true;
                    session = new ProjectWorkerSession(opening, options.visibility.visible, display, sceneViews, fileServing, page, new EditorClient(worker, {timeoutMs: EDITOR_REQUEST_TIMEOUT_MS}), events, options.viewports.game);
                    resolve(session);
                },
                onQuit: () => {
                    session?.client.close();
                    options.onQuit();
                },
            });
        });
    }

    public get sceneViewIds(): SceneViewId[] {
        return [...this.sceneViews.keys()];
    }

    public show(): void {
        this.visible = true;
        for (const sceneView of this.sceneViews.values()) sceneView.display.show();
        this.display.show();
    }

    public hide(): void {
        this.visible = false;
        for (const sceneView of this.sceneViews.values()) sceneView.display.hide();
        this.display.hide();
    }

    public openSceneView(view: SceneViewId, viewport: SceneViewport, shown: boolean): void {
        if (this.disposed || this.sceneViews.has(view)) return;
        this.sceneViews.set(view, openSessionSceneView(this.opening, view, viewport, this.visible, shown));
    }

    public closeSceneView(view: SceneViewId): void {
        const sceneView = this.sceneViews.get(view);
        if (sceneView === undefined) return;
        this.sceneViews.delete(view);
        closeSessionSceneView(sceneView);
    }

    public setSceneViewShown(view: SceneViewId, shown: boolean): void {
        this.sceneViews.get(view)?.connection.setShown(shown);
    }

    public exit(): void {
        this.page.exit();
    }

    private sendTerminalBytes(data: string): void {
        if (!this.disposed) this.opening.worker.postMessage(terminalInputMessage(data));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.client.close();
        this.fileServing.dispose();
        for (const sceneView of this.sceneViews.values()) closeSessionSceneView(sceneView);
        this.sceneViews.clear();
        this.page.close();
        this.display.dispose();
    }
}
