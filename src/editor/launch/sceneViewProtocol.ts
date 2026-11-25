import {isCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import {isPixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {isBitmapFrame} from "../../hosts/web/bitmapFrame";
import type {BitmapFrame} from "../../hosts/web/bitmapFrame";
import {isSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {EditorViewInfo} from "../editorProtocol";
import {isSceneViewId} from "../project/dockPanelIds";
import type {SceneViewId} from "../project/dockPanelIds";

export const SCENE_VIEW_MESSAGE_TYPE = "jsengine-scene-view";

type SceneViewType = typeof SCENE_VIEW_MESSAGE_TYPE;

interface SceneViewMessage {
    readonly type: SceneViewType;
    readonly view: SceneViewId;
}

export interface SceneViewOpenMessage extends SceneViewMessage {
    readonly kind: "open";
    readonly surface: SurfaceSize;
}

export interface SceneViewResizeMessage extends SceneViewMessage {
    readonly kind: "resize";
    readonly surface: SurfaceSize;
}

export interface SceneViewPresentedMessage extends SceneViewMessage {
    readonly kind: "presented";
    readonly returnedBuffer?: ArrayBuffer;
}

export interface SceneViewCloseMessage extends SceneViewMessage {
    readonly kind: "close";
}

export type SceneViewPageMessage = SceneViewOpenMessage | SceneViewResizeMessage | SceneViewPresentedMessage | SceneViewCloseMessage;

export interface SceneViewCellFrameMessage extends SceneViewMessage {
    readonly kind: "frame";
    readonly frame: CellFrame;
    readonly info?: EditorViewInfo;
}

export interface SceneViewPixelFrameMessage extends SceneViewMessage {
    readonly kind: "pixelFrame";
    readonly frame: PixelFrame;
    readonly info?: EditorViewInfo;
}

export interface SceneViewBitmapFrameMessage extends SceneViewMessage {
    readonly kind: "bitmapFrame";
    readonly frame: BitmapFrame;
    readonly info?: EditorViewInfo;
}

export interface SceneViewErrorMessage extends SceneViewMessage {
    readonly kind: "error";
    readonly message: string;
}

export type SceneViewWorkerMessage = SceneViewCellFrameMessage | SceneViewPixelFrameMessage | SceneViewBitmapFrameMessage | SceneViewErrorMessage;

function sceneViewFields(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const fields = value as Record<string, unknown>;
    return fields.type === SCENE_VIEW_MESSAGE_TYPE && isSceneViewId(fields.view) ? fields : undefined;
}

function isViewInfoOf(view: unknown, value: unknown): value is EditorViewInfo {
    return typeof value === "object" && value !== null && (value as {readonly view?: unknown}).view === view;
}

function isAbsentOrViewInfoOf(view: unknown, value: unknown): boolean {
    return value === undefined || isViewInfoOf(view, value);
}

export function isSceneViewPageMessage(value: unknown): value is SceneViewPageMessage {
    const fields = sceneViewFields(value);
    if (fields === undefined) return false;
    switch (fields.kind) {
        case "open":
        case "resize":
            return isSurfaceSize(fields.surface);
        case "presented":
            return fields.returnedBuffer === undefined || fields.returnedBuffer instanceof ArrayBuffer;
        case "close":
            return true;
        default:
            return false;
    }
}

export function isSceneViewWorkerMessage(value: unknown): value is SceneViewWorkerMessage {
    const fields = sceneViewFields(value);
    if (fields === undefined) return false;
    switch (fields.kind) {
        case "frame":
            return isCellFrame(fields.frame) && isAbsentOrViewInfoOf(fields.view, fields.info);
        case "pixelFrame":
            return isPixelFrame(fields.frame) && isAbsentOrViewInfoOf(fields.view, fields.info);
        case "bitmapFrame":
            return isBitmapFrame(fields.frame) && isAbsentOrViewInfoOf(fields.view, fields.info);
        case "error":
            return typeof fields.message === "string";
        default:
            return false;
    }
}
