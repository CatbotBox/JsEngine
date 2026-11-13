import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {installDomInput} from "../../hosts/web/domInput";
import {pixelCanvasDisplayFromQuery} from "../../hosts/web/pixelCanvasDisplay";
import type {PixelCanvasDisplay} from "../../hosts/web/pixelCanvasDisplay";
import {connectWorldWorker} from "../../hosts/web/worldWorkerPage";
import type {PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import {requestedRasterWorkersFromQuery} from "../../hosts/web/worldWorkerProtocol";
import type {PixelSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import {EditorClient, EditorClientClosedError} from "../page/editorClient";
import {createEditorLayout, mountEditorViews} from "../page/editorLayout";

export interface EditorPageOptions {
    readonly workerUrl: string;
    readonly name: string;
}

export const EDITOR_PAGE_REQUEST_TIMEOUT_MS = 60_000;

const MODULE_WORKER: WorkerOptions = {type: "module"};

interface ViewportEvents {
    firstFrame(): void;

    failed(): void;
}

class EditorViewportDisplay implements PixelWorldDisplay {
    private firstFrameArrived = false;

    public constructor(private readonly display: PixelCanvasDisplay, private readonly events: ViewportEvents) {
    }

    public surfaceSize(): PixelSurfaceSize {
        return this.display.surfaceSize();
    }

    public onResize(listener: () => void): () => void {
        return this.display.onResize(listener);
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.display.presentPixels(frame, onPresented);
        if (this.firstFrameArrived) return;
        this.firstFrameArrived = true;
        this.events.firstFrame();
    }

    public showStatus(text: string): void {
        this.display.showStatus(text);
    }

    public showError(text: string): void {
        this.display.showError(text);
        this.events.failed();
    }
}

export function startEditorPage(options: EditorPageOptions): void {
    const layout = createEditorLayout(document.body);
    const display = pixelCanvasDisplayFromQuery(layout.viewport, location.search);
    const worker = new Worker(options.workerUrl, MODULE_WORKER);
    let client: EditorClient | undefined;
    const closeClient = (): void => client?.close();
    const viewport = new EditorViewportDisplay(display, {
        firstFrame: () => {
            const connected = new EditorClient(worker, {timeoutMs: EDITOR_PAGE_REQUEST_TIMEOUT_MS});
            client = connected;
            mountEditorViews(layout, connected).catch(error => {
                if (error instanceof EditorClientClosedError) return;
                display.showError(`Could not open ${options.name}: ${error instanceof Error ? error.message : String(error)}`);
                connected.close();
            });
        },
        failed: closeClient,
    });
    const page = connectWorldWorker(viewport, worker, {
        name: options.name,
        requestedRasterWorkers: requestedRasterWorkersFromQuery(location.search),
        onQuit: closeClient,
    });
    installDomInput(layout.viewport, {sink: page.input, cellArea: () => display.cellArea()});
    window.addEventListener("pagehide", () => page.exit());
}
