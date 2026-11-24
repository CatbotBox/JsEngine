import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {startingStatus} from "../../hosts/web/worldWorkerPage";
import type {GpuWorldDisplay, PageTransferable, WorldDisplay} from "../../hosts/web/worldWorkerPage";
import {isWorldToPageMessage} from "../../hosts/web/worldWorkerProtocol";
import type {SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import {isSceneViewWorkerMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewPageMessage} from "./sceneViewProtocol";

export interface SceneViewWorker {
    postMessage(message: SceneViewPageMessage, transfer: PageTransferable[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface SceneViewConnection {
    setShown(shown: boolean): void;
    close(): void;
}

const READY_MESSAGE = "ready";
const SHOWN = true;
const NOTHING = 0;

function isGpuDisplay(display: WorldDisplay): display is GpuWorldDisplay {
    return "transferCanvas" in display;
}

function emptySurfaceLike(surface: SurfaceSize): SurfaceSize {
    return surface.kind === "cells" ? {kind: "cells", columns: NOTHING, rows: NOTHING} : {kind: "pixels", widthPx: NOTHING, heightPx: NOTHING};
}

export function sceneViewMismatchMessage(name: string, sent: string): string {
    return `${name} sent ${sent} frames to the Scene view, which cannot show them`;
}

export function sceneViewFailureMessage(name: string, reason: string): string {
    return `The Scene view of ${name} could not start: ${reason}`;
}

export function connectSceneView(display: WorldDisplay, worker: SceneViewWorker, name: string): SceneViewConnection {
    let closed = false;
    let shown = SHOWN;
    const post = (message: SceneViewPageMessage, transfer: PageTransferable[] = []): void => {
        if (!closed) worker.postMessage(message, transfer);
    };
    const acknowledge = (): void => post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "presented"});
    const acknowledgeReturningBufferOf = (frame: PixelFrame) => (): void => {
        const returnedBuffer = frame.rgba.buffer as ArrayBuffer;
        post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "presented", returnedBuffer}, [returnedBuffer]);
    };

    worker.addEventListener("message", event => {
        const message = event.data;
        if (closed) return;
        if (!isSceneViewWorkerMessage(message)) {
            if (isWorldToPageMessage(message) && message.type === READY_MESSAGE) display.hideStatus();
            return;
        }
        switch (message.kind) {
            case "frame":
                if ("presentCells" in display) display.presentCells(message.frame, acknowledge);
                else display.showError(sceneViewMismatchMessage(name, "cells"));
                break;
            case "pixelFrame":
                if ("presentPixels" in display) display.presentPixels(message.frame, acknowledgeReturningBufferOf(message.frame));
                else display.showError(sceneViewMismatchMessage(name, "pixels"));
                break;
            case "screenUnit":
                if (isGpuDisplay(display)) display.showScreenUnit(message.pixelsPerScreenUnitX, message.pixelsPerScreenUnitY);
                break;
            case "error":
                display.showError(sceneViewFailureMessage(name, message.message));
                break;
        }
    });

    display.showStatus(startingStatus(name));
    const surface = display.surfaceSize();
    if (isGpuDisplay(display)) {
        const canvas = display.transferCanvas();
        post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface, canvas}, [canvas]);
    } else {
        post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface});
    }
    const postSurface = (): void => {
        const current = display.surfaceSize();
        post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: shown ? current : emptySurfaceLike(current)});
    };
    const stopWatchingResize = display.onResize(() => {
        if (shown) postSurface();
    });

    return {
        setShown: next => {
            if (next === shown) return;
            shown = next;
            postSurface();
        },
        close: () => {
            closed = true;
            stopWatchingResize();
        },
    };
}
