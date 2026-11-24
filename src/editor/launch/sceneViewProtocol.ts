import {isCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import {isPixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {isSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {SurfaceSize} from "../../hosts/web/worldWorkerProtocol";

export const SCENE_VIEW_MESSAGE_TYPE = "jsengine-scene-view";

type SceneViewType = typeof SCENE_VIEW_MESSAGE_TYPE;

export interface SceneViewOpenMessage {
    readonly type: SceneViewType;
    readonly kind: "open";
    readonly surface: SurfaceSize;
    readonly canvas?: OffscreenCanvas;
}

export interface SceneViewResizeMessage {
    readonly type: SceneViewType;
    readonly kind: "resize";
    readonly surface: SurfaceSize;
}

export interface SceneViewPresentedMessage {
    readonly type: SceneViewType;
    readonly kind: "presented";
    readonly returnedBuffer?: ArrayBuffer;
}

export type SceneViewPageMessage = SceneViewOpenMessage | SceneViewResizeMessage | SceneViewPresentedMessage;

export interface SceneViewCellFrameMessage {
    readonly type: SceneViewType;
    readonly kind: "frame";
    readonly frame: CellFrame;
}

export interface SceneViewPixelFrameMessage {
    readonly type: SceneViewType;
    readonly kind: "pixelFrame";
    readonly frame: PixelFrame;
}

export interface SceneViewScreenUnitMessage {
    readonly type: SceneViewType;
    readonly kind: "screenUnit";
    readonly pixelsPerScreenUnitX: number;
    readonly pixelsPerScreenUnitY: number;
}

export interface SceneViewErrorMessage {
    readonly type: SceneViewType;
    readonly kind: "error";
    readonly message: string;
}

export type SceneViewWorkerMessage = SceneViewCellFrameMessage | SceneViewPixelFrameMessage | SceneViewScreenUnitMessage | SceneViewErrorMessage;

function sceneViewFields(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const fields = value as Record<string, unknown>;
    return fields.type === SCENE_VIEW_MESSAGE_TYPE ? fields : undefined;
}

function isOffscreenCanvas(value: unknown): value is OffscreenCanvas {
    return typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas;
}

function isPositiveScale(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isSceneViewPageMessage(value: unknown): value is SceneViewPageMessage {
    const fields = sceneViewFields(value);
    if (fields === undefined) return false;
    switch (fields.kind) {
        case "open":
            return isSurfaceSize(fields.surface) && (fields.canvas === undefined || isOffscreenCanvas(fields.canvas));
        case "resize":
            return isSurfaceSize(fields.surface);
        case "presented":
            return fields.returnedBuffer === undefined || fields.returnedBuffer instanceof ArrayBuffer;
        default:
            return false;
    }
}

export function isSceneViewWorkerMessage(value: unknown): value is SceneViewWorkerMessage {
    const fields = sceneViewFields(value);
    if (fields === undefined) return false;
    switch (fields.kind) {
        case "frame":
            return isCellFrame(fields.frame);
        case "pixelFrame":
            return isPixelFrame(fields.frame);
        case "screenUnit":
            return isPositiveScale(fields.pixelsPerScreenUnitX) && isPositiveScale(fields.pixelsPerScreenUnitY);
        case "error":
            return typeof fields.message === "string";
        default:
            return false;
    }
}
