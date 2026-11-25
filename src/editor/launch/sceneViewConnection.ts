import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {BitmapWorldDisplay} from "../../hosts/web/bitmapCanvasDisplay";
import {discardBitmapFrame} from "../../hosts/web/bitmapFrame";
import {startingStatus} from "../../hosts/web/worldWorkerPage";
import type {CellWorldDisplay, PageTransferable, PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import {isWorldToPageMessage} from "../../hosts/web/worldWorkerProtocol";
import type {SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {EditorViewInfo} from "../editorProtocol";
import type {SceneViewId} from "../project/dockPanelIds";
import {isSceneViewWorkerMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewPageMessage} from "./sceneViewProtocol";

type WorkerMessageListener = (event: {readonly data: unknown}) => void;

export type SceneViewDisplay = CellWorldDisplay | PixelWorldDisplay | BitmapWorldDisplay;

export interface SceneViewWorker {
    postMessage(message: SceneViewPageMessage, transfer: PageTransferable[]): void;
    addEventListener(type: "message", listener: WorkerMessageListener): void;
    removeEventListener(type: "message", listener: WorkerMessageListener): void;
}

export interface SceneViewConnection {
    setShown(shown: boolean): void;
    close(): void;
}

export interface SceneViewConnectionOptions {
    readonly view: SceneViewId;
    readonly name: string;
    readonly shown: boolean;
    readonly frameInfo?: (info: EditorViewInfo) => void;
}

const READY_MESSAGE = "ready";
const NOTHING = 0;

function emptySurfaceLike(surface: SurfaceSize): SurfaceSize {
    return surface.kind === "cells" ? {kind: "cells", columns: NOTHING, rows: NOTHING} : {kind: "pixels", widthPx: NOTHING, heightPx: NOTHING};
}

export function sceneViewMismatchMessage(name: string, sent: string): string {
    return `${name} sent ${sent} frames to the Scene view, which cannot show them`;
}

export function sceneViewFailureMessage(name: string, reason: string): string {
    return `The Scene view of ${name} could not start: ${reason}`;
}

export function connectSceneView(display: SceneViewDisplay, worker: SceneViewWorker, options: SceneViewConnectionOptions): SceneViewConnection {
    const {view, name} = options;
    const showFrameInfo = (info: EditorViewInfo | undefined): void => {
        if (info !== undefined) options.frameInfo?.(info);
    };
    let closed = false;
    let shown = options.shown;
    const post = (message: SceneViewPageMessage, transfer: PageTransferable[] = []): void => {
        if (!closed) worker.postMessage(message, transfer);
    };
    const acknowledge = (): void => post({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "presented"});
    const acknowledgeReturningBufferOf = (frame: PixelFrame) => (): void => {
        const returnedBuffer = frame.rgba.buffer as ArrayBuffer;
        post({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "presented", returnedBuffer}, [returnedBuffer]);
    };

    const receive = (event: {readonly data: unknown}): void => {
        const message = event.data;
        if (closed) return;
        if (!isSceneViewWorkerMessage(message)) {
            if (isWorldToPageMessage(message) && message.type === READY_MESSAGE) display.hideStatus();
            return;
        }
        if (message.view !== view) return;
        switch (message.kind) {
            case "frame":
                if ("presentCells" in display) display.presentCells(message.frame, acknowledge);
                else display.showError(sceneViewMismatchMessage(name, "cells"));
                showFrameInfo(message.info);
                break;
            case "pixelFrame":
                if ("presentPixels" in display) display.presentPixels(message.frame, acknowledgeReturningBufferOf(message.frame));
                else display.showError(sceneViewMismatchMessage(name, "pixels"));
                showFrameInfo(message.info);
                break;
            case "bitmapFrame":
                if ("presentBitmap" in display) {
                    display.presentBitmap(message.frame, acknowledge);
                } else {
                    discardBitmapFrame(message.frame);
                    display.showError(sceneViewMismatchMessage(name, "bitmap"));
                }
                showFrameInfo(message.info);
                break;
            case "error":
                display.showError(sceneViewFailureMessage(name, message.message));
                break;
        }
    };
    worker.addEventListener("message", receive);

    display.showStatus(startingStatus(name));
    const shownSurface = (): SurfaceSize => {
        const current = display.surfaceSize();
        return shown ? current : emptySurfaceLike(current);
    };
    post({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "open", surface: shownSurface()});
    const postSurface = (): void => post({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "resize", surface: shownSurface()});
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
            if (closed) return;
            post({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "close"});
            closed = true;
            stopWatchingResize();
            worker.removeEventListener("message", receive);
        },
    };
}
