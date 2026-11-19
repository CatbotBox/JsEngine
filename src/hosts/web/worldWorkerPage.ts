import type {CellFrame} from "../../backends/cells/cellFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {InputEvent, InputEventSink} from "../../engine/input/inputEvent";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import type {CellSurfaceSize, PageToWorldMessage, PixelSurfaceSize} from "./worldWorkerProtocol";
import {isWorldToPageMessage} from "./worldWorkerProtocol";

interface WorldDisplaySurface {
    onResize(listener: () => void): () => void;
    showStatus(text: string): void;
    showError(text: string): void;
}

export interface CellWorldDisplay extends WorldDisplaySurface {
    surfaceSize(): CellSurfaceSize;
    presentCells(frame: CellFrame, onPresented: () => void): void;
}

export interface PixelWorldDisplay extends WorldDisplaySurface {
    surfaceSize(): PixelSurfaceSize;
    presentPixels(frame: PixelFrame, onPresented: () => void): void;
}

export interface GpuWorldDisplay extends WorldDisplaySurface {
    surfaceSize(): PixelSurfaceSize;
    transferCanvas(): OffscreenCanvas;
    showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void;
}

export type WorldDisplay = CellWorldDisplay | PixelWorldDisplay | GpuWorldDisplay;

export type PageTransferable = ArrayBuffer | OffscreenCanvas;

export interface WorldWorker {
    postMessage(message: PageToWorldMessage, transfer: PageTransferable[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    addEventListener(type: "error", listener: (event: {readonly message?: string}) => void): void;
    terminate(): void;
}

export interface WorldWorkerPageOptions {
    readonly name: string;
    readonly requestedRasterWorkers?: number;
    readonly onQuit?: () => void;
}

export interface WorldWorkerPage {
    readonly input: InputEventSink;
    exit(): void;

    close(): void;
}

export const STOPPED_STATUS = "Stopped. Reload the page to restart.";

const GPU_BACKEND: RenderBackendKind = "gpu";

export function startingStatus(name: string): string {
    return `Starting ${name}...`;
}

export function surfaceMismatchMessage(name: string, sent: RenderBackendKind, shown: RenderBackendKind): string {
    return `${name} sent ${sent} frames, but this page shows ${shown}`;
}

function isGpuDisplay(display: WorldDisplay): display is GpuWorldDisplay {
    return "transferCanvas" in display;
}

export function displayBackendOf(display: WorldDisplay): RenderBackendKind {
    return isGpuDisplay(display) ? GPU_BACKEND : display.surfaceSize().kind;
}

export function connectWorldWorker(display: WorldDisplay, worker: WorldWorker, options: WorldWorkerPageOptions): WorldWorkerPage {
    let stopWatchingResize: (() => void) | undefined;
    let closed = false;
    const post = (message: PageToWorldMessage, transfer: PageTransferable[] = []): void => {
        if (!closed) worker.postMessage(message, transfer);
    };
    const pendingInput: InputEvent[] = [];
    const flushInput = (): void => {
        if (pendingInput.length > 0) post({type: "inputEvents", events: pendingInput.splice(0)});
    };
    const input: InputEventSink = {
        enqueue(event: InputEvent): void {
            if (closed) return;
            pendingInput.push(event);
            if (pendingInput.length === 1) queueMicrotask(flushInput);
        },
    };
    const close = (): void => {
        closed = true;
        pendingInput.length = 0;
        stopWatchingResize?.();
        stopWatchingResize = undefined;
        worker.terminate();
    };
    const acknowledge = (): void => post({type: "presented"});
    const acknowledgeReturningBufferOf = (frame: PixelFrame) => (): void => {
        const returnedBuffer = frame.rgba.buffer as ArrayBuffer;
        post({type: "presented", returnedBuffer}, [returnedBuffer]);
    };
    const failOnMismatch = (sent: RenderBackendKind): void => {
        close();
        display.showError(surfaceMismatchMessage(options.name, sent, displayBackendOf(display)));
    };

    worker.addEventListener("message", event => {
        const message = event.data;
        if (closed || !isWorldToPageMessage(message)) return;
        switch (message.type) {
            case "frame":
                if ("presentCells" in display) display.presentCells(message.frame, acknowledge);
                else failOnMismatch("cells");
                break;
            case "pixelFrame":
                if ("presentPixels" in display) display.presentPixels(message.frame, acknowledgeReturningBufferOf(message.frame));
                else failOnMismatch("pixels");
                break;
            case "status":
                display.showStatus(message.text);
                break;
            case "screenUnit":
                if (isGpuDisplay(display)) display.showScreenUnit(message.pixelsPerScreenUnitX, message.pixelsPerScreenUnitY);
                else failOnMismatch(GPU_BACKEND);
                break;
            case "quit":
                close();
                display.showStatus(STOPPED_STATUS);
                options.onQuit?.();
                break;
            case "error":
                close();
                display.showError(`Could not start ${options.name}: ${message.message}`);
                break;
        }
    });
    worker.addEventListener("error", event => {
        if (!closed) display.showError(`Error in ${options.name}: ${event.message ?? "the world worker failed"}`);
    });

    display.showStatus(startingStatus(options.name));
    const init = {type: "init", surface: display.surfaceSize(), requestedRasterWorkers: options.requestedRasterWorkers} as const;
    if (isGpuDisplay(display)) {
        const canvas = display.transferCanvas();
        post({...init, canvas}, [canvas]);
    } else {
        post(init);
    }
    stopWatchingResize = display.onResize(() => post({type: "resize", surface: display.surfaceSize()}));

    return {
        input,
        exit: () => post({type: "exit"}),
        close,
    };
}
