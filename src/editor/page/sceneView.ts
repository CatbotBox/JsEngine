import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import type {EditorEntityDetails, EditorFieldValue, EditorViewInfo} from "../editorProtocol";
import {capturePointer, errorText, hasCommandModifier, readStorage, releasePointer, visualScaleOf, writeStorage} from "./dom";
import {
    addVectors,
    degreesToRadians,
    dollyCamera,
    dotVectors,
    flyCamera,
    focusCamera2d,
    focusOrbitCamera,
    IDENTITY_QUATERNION,
    lookAround,
    orbitAroundPivot,
    orbitCameraFromPose,
    panCamera2d,
    panOrbitCamera,
    poseOfOrbitCamera,
    scaleVector,
    unionOfBounds,
} from "./editorCameraMath";
import type {CameraPose, Quaternion, Vector3} from "./editorCameraMath";
import type {EditorTool} from "./editorTools";
import {MAX_SELECTION_BOUNDS} from "./editorWorkspace";
import type {EditorWorkspace} from "./editorWorkspace";
import {numberOfWire} from "./fieldValueText";
import {parentLookupOf, topmostEntities, UNPARENT_TARGET} from "./hierarchyDrop";
import {LatestOnly} from "./latestOnly";
import {isAssetKind} from "./projectFiles";
import {SceneOverlayInfo} from "./sceneOverlayInfo";
import {
    chainLinear,
    chainRotation,
    handleAxes,
    handleAxisRotation,
    handleOrigin,
    IDENTITY_MATRIX3,
    localDeltaOf,
    isRotated,
    isWorldAxis,
    rotatedAboutWorldAxis,
    snappedDeltaFrom,
    snappedMoveDelta,
    snapToIncrement,
    twistRadians,
    UNIT_SCALE,
    WORLD_AXES,
} from "./transformMath";
import type {LocalTransform, Matrix3} from "./transformMath";
import {snapsThisDrag} from "./snapSteps";
import {SCENE_VIEW_CAMERAS_STORAGE_KEY, sceneViewCameraPose, sceneViewCameraText, storedSceneViewCamera, withoutSceneViewCamera, withSceneViewCamera} from "./sceneViewCameras";
import type {SceneViewCamera} from "./sceneViewCameras";
import {SCENE_BOUNDS_HOOK, SCENE_CAMERA_HOOK, SCENE_FRAMES_HOOK, SCENE_INFO_SOURCE_HOOK, SCENE_VIEWS_HOOK, SCENE_VIEWS_SEPARATOR} from "../project/editorUiHooks";
import type {SceneInfoSource} from "../project/editorUiHooks";
import type {SceneViewId} from "../project/dockPanelIds";
import {HOLDS_NO_ENTITIES} from "./undoStack";
import type {FieldChange} from "./undoStack";
import {
    amountAlongScreenAxis,
    distanceToSegmentPx,
    overlayPointOf,
    overlayRectOf,
    overlayScaleOf,
    pointerAngleRadians,
    pointOnViewPlane,
    projectedBoundsRect,
    projectedBoxEdges,
    projectPoint,
    isInFront,
    layoutRectOf,
    rectContains,
    screenAxisPx,
    screenPointOf,
    viewAxisOf,
    viewPlaneDelta,
    viewRotationSign,
    wrapAngleRadians,
} from "./viewProjection";
import type {OverlayScale, ScreenPoint, ScreenSegment, ViewInfoGeometry} from "./viewProjection";

export const CLICK_SLOP_PX = 4;
export const HANDLE_LENGTH_PX = 72;
export const HANDLE_HIT_PX = 7;
export const HANDLE_END_SIZE_PX = 8;
export const ROTATE_RING_RADIUS_PX = 64;
export const MIN_SCALE_FACTOR = 0.01;
export const WHEEL_PIXELS_PER_NOTCH = 100;
export const WHEEL_LINES_PER_NOTCH = 3;
export const POINT_MARKER_RADIUS_PX = 5;
export const DEFAULT_FIELD_OF_VIEW_DEGREES = 60;
export const CAMERA_STORE_DELAY_MS = 250;

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
const WHEEL_DELTA_LINES = 1;
const WHEEL_DELTA_PAGES = 2;
const MS_PER_SECOND = 1000;
const AXES_IN_2D = 2;
const AXIS_COLORS = ["#ff5f57", "#5ad65a", "#4fa3f7"];
const SELECTION_COLOR = "#ffb347";
const HOVER_COLOR = "#ffe066";
const RING_COLOR = "#ffd166";
const CENTER_COLOR = "#d8dee9";
const MESSAGE_COLOR = "#8a96a8";
const MESSAGE_FONT = "13px system-ui, sans-serif";
const MESSAGE_MARGIN_PX = 10;
const LINE_WIDTH_PX = 2;
const OUTLINE_WIDTH_PX = 1.5;
const INTERACTIVE_CLASS = "interactive";
const PICKING_CLASS = "picking-entity";
const FRAME_INFO: SceneInfoSource = "frame";
const REQUESTED_INFO: SceneInfoSource = "request";
const LOCAL_POSITION = "LocalPosition";
const LOCAL_ROTATION = "LocalRotation";
const LOCAL_SCALE = "LocalScale";
const VEC3_KEY = "xyz";
const QUATERNION_KEY = "xyzw";
const FLY_KEYS: ReadonlySet<string> = new Set(["w", "a", "s", "d", "q", "e"]);

export interface SceneViewOptions {
    readonly view: SceneViewId;

    activated(): void;

    isFocusTarget(): boolean;
}

type Handle =
    | {readonly kind: "moveAxis", readonly axis: Vector3, readonly screenPerUnit: ScreenPoint, readonly segment: ScreenSegment, readonly color: string}
    | {readonly kind: "scaleAxis", readonly axisIndex: number, readonly direction: ScreenPoint, readonly segment: ScreenSegment, readonly color: string}
    | {readonly kind: "scaleCenter", readonly center: ScreenPoint}
    | {readonly kind: "ring", readonly center: ScreenPoint, readonly radius: number}
    | {readonly kind: "free"};

interface TransformTarget {
    readonly entity: Entity;
    readonly position: Vector3 | undefined;
    readonly positionJson: SceneJsonValue | undefined;
    readonly rotation: Quaternion;
    readonly rotationJson: SceneJsonValue;
    readonly scale: Vector3;
    readonly scaleJson: SceneJsonValue;
    readonly parentLinear: Matrix3;
    readonly parentRotation: Quaternion;
}

interface TransformGesture {
    readonly kind: "transform";
    readonly handle: Handle;
    readonly start: ScreenPoint;
    readonly key: string;
    readonly sender: LatestOnly;
    readonly origin: ScreenPoint;
    readonly worldOrigin: Vector3;
    readonly startTwist: number | undefined;
    readonly depth: number;
    readonly info: EditorViewInfo;
    readonly scale: OverlayScale;
    current: ScreenPoint;
    snapping: boolean;
    targets: readonly TransformTarget[] | undefined;
    released: boolean;
}

interface CameraGesture {
    readonly kind: "camera";
    readonly button: number;
    mode: "pan" | "orbit" | "look";
    last: ScreenPoint;
}

interface PendingClick {
    readonly kind: "pending";
    readonly start: ScreenPoint;
    readonly overSelection: boolean;
    readonly toggle: boolean;
    readonly add: boolean;
    readonly forEntityPick: boolean;
}

type Gesture = TransformGesture | CameraGesture | PendingClick;

interface PickCycle {
    readonly point: ScreenPoint;
    readonly hits: readonly Entity[];
}

function numbersOf(value: EditorFieldValue | undefined, length: number): number[] | undefined {
    if (!Array.isArray(value) || value.length !== length) return undefined;
    const numbers = value.map(component => numberOfWire(component as SceneJsonValue));
    return numbers.every((component): component is number => component !== undefined && Number.isFinite(component)) ? numbers : undefined;
}

function componentField(details: EditorEntityDetails, typeName: string, key: string): EditorFieldValue | undefined {
    return details.components.find(component => component.typeName === typeName)?.fields[key];
}

function localTransformOf(details: EditorEntityDetails): LocalTransform {
    const rotation = numbersOf(componentField(details, LOCAL_ROTATION, QUATERNION_KEY), 4);
    const scale = numbersOf(componentField(details, LOCAL_SCALE, VEC3_KEY), 3);
    return {
        rotation: rotation === undefined ? IDENTITY_QUATERNION : [rotation[0], rotation[1], rotation[2], rotation[3]],
        scale: scale === undefined ? UNIT_SCALE : [scale[0], scale[1], scale[2]],
    };
}

function sameHandle(a: Handle, b: Handle): boolean {
    if (a.kind === "moveAxis" && b.kind === "moveAxis") return a.color === b.color;
    if (a.kind === "scaleAxis" && b.kind === "scaleAxis") return a.axisIndex === b.axisIndex;
    return a.kind === b.kind;
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameEntities(a: readonly Entity[], b: readonly Entity[]): boolean {
    return a.length === b.length && a.every((entity, index) => entity === b[index]);
}

function wheelNotches(event: WheelEvent): number {
    if (event.deltaMode === WHEEL_DELTA_LINES) return -event.deltaY / WHEEL_LINES_PER_NOTCH;
    if (event.deltaMode === WHEEL_DELTA_PAGES) return -event.deltaY;
    return -event.deltaY / WHEEL_PIXELS_PER_NOTCH;
}

let nextGestureId = 1;

export class SceneView {
    private readonly overlayInfo = new SceneOverlayInfo();
    private readonly stopSceneFrames: () => void;
    private camera: SceneViewCamera | undefined;
    private rememberedCamera: SceneViewCamera | undefined;
    private cameraStoreTimer: number | undefined;
    private readonly cameraSender = new LatestOnly();
    private gesture: Gesture | undefined;
    private handles: Handle[] = [];
    private hovered: Handle | undefined;
    private pickCycle: PickCycle | undefined;
    private readonly flyKeys = new Set<string>();
    private flyFast = false;
    private lastFrameMs: number | undefined;
    private frameHandle: number | undefined;
    private frameWindow: Window | undefined;
    private disposed = false;
    private shown = false;
    private wasActive = false;
    private shownSelectionRotated = false;

    public constructor(
        private readonly stage: HTMLElement,
        private readonly viewport: HTMLElement,
        private readonly overlay: HTMLCanvasElement,
        private readonly workspace: EditorWorkspace,
        private readonly options: SceneViewOptions,
    ) {
        this.rememberedCamera = storedSceneViewCamera(readStorage(this.storageWindow(), SCENE_VIEW_CAMERAS_STORAGE_KEY), workspace.scenes.projectKey(), options.view);
        overlay.tabIndex = 0;
        overlay.setAttribute("aria-label", "Scene view");
        overlay.addEventListener("focus", () => options.activated());
        overlay.addEventListener("pointerdown", event => this.onPointerDown(event));
        overlay.addEventListener("pointermove", event => this.onPointerMove(event));
        overlay.addEventListener("pointerup", event => this.onPointerUp(event));
        overlay.addEventListener("pointercancel", event => this.onPointerUp(event));
        overlay.addEventListener("wheel", event => this.onWheel(event), {passive: false});
        overlay.addEventListener("contextmenu", event => event.preventDefault());
        overlay.addEventListener("keydown", event => this.onKeyDown(event));
        overlay.addEventListener("keyup", event => this.onKeyUp(event));
        overlay.addEventListener("blur", () => this.flyKeys.clear());
        stage.addEventListener("dragover", event => this.onDragOver(event));
        stage.addEventListener("drop", event => this.onDrop(event));
        workspace.on("sceneLoaded", () => {
            this.camera = undefined;
            this.overlayInfo.forget();
            this.pickCycle = undefined;
        });
        workspace.on("state", () => this.stateChanged());
        workspace.on("selection", () => this.showSelectionRotation());
        workspace.on("entityPick", () => this.overlay.classList.toggle(PICKING_CLASS, workspace.pickingEntity));
        this.stopSceneFrames = workspace.onSceneFrame(options.view, info => this.frameShown(info));
    }

    public get selectionRotated(): boolean {
        return this.shownSelectionRotated;
    }

    public get capturesKeys(): boolean {
        return this.gesture?.kind === "camera" && this.gesture.button === RIGHT_BUTTON;
    }

    public dispose(): void {
        this.disposed = true;
        this.stopSceneFrames();
        this.cancelFrame();
        this.storageWindow()?.clearTimeout(this.cameraStoreTimer);
        this.cameraStoreTimer = undefined;
    }

    public forgetCamera(): void {
        const window = this.storageWindow();
        writeStorage(window, SCENE_VIEW_CAMERAS_STORAGE_KEY, withoutSceneViewCamera(readStorage(window, SCENE_VIEW_CAMERAS_STORAGE_KEY), this.workspace.scenes.projectKey(), this.options.view));
    }

    public setShown(shown: boolean): void {
        if (this.disposed || shown === this.shown) return;
        this.shown = shown;
        this.cancelFrame();
        this.lastFrameMs = undefined;
        if (shown) this.requestFrame();
    }

    public relocated(): void {
        if (this.disposed || !this.shown || this.window() === this.frameWindow) return;
        this.cancelFrame();
        this.lastFrameMs = undefined;
        this.requestFrame();
    }

    public resendCamera(): void {
        this.overlayInfo.forget();
        if (this.camera !== undefined) this.sendCamera();
    }

    public async focusSelection(): Promise<void> {
        const selection = this.workspace.selection;
        if (selection.length === 0 || !this.isActive()) return;
        try {
            const info = await this.workspace.request({op: "getViewInfo", view: this.options.view, entities: selection.slice(0, MAX_SELECTION_BOUNDS)});
            this.adoptView(info);
            const union = unionOfBounds(info.bounds);
            const camera = this.camera;
            if (union === undefined || camera === undefined) return;
            this.changeCamera(camera.kind === "2d"
                ? {...camera, position: focusCamera2d(camera.position, union.min, union.max)}
                : {...camera, orbit: focusOrbitCamera(camera.orbit, union.min, union.max, camera.fieldOfViewDegrees)});
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private get info(): EditorViewInfo | undefined {
        return this.overlayInfo.info;
    }

    private window(): (Window & typeof globalThis) | null {
        return this.overlay.ownerDocument.defaultView;
    }

    private storageWindow(): (Window & typeof globalThis) | null {
        return this.workspace.document.defaultView;
    }

    private requestFrame(): void {
        const window = this.window() ?? undefined;
        this.frameWindow = window;
        this.frameHandle = window?.requestAnimationFrame(this.frame);
    }

    private cancelFrame(): void {
        const window = this.frameWindow;
        if (window !== undefined && this.frameHandle !== undefined && !window.closed) window.cancelAnimationFrame(this.frameHandle);
        this.frameWindow = undefined;
        this.frameHandle = undefined;
    }

    private isActive(): boolean {
        const workspace = this.workspace;
        return workspace.sceneViewShown && !workspace.closed;
    }

    private stateChanged(): void {
        const active = this.isActive();
        if (active === this.wasActive) return;
        this.overlay.classList.toggle(INTERACTIVE_CLASS, active);
        if (!active) {
            this.gesture = undefined;
            this.flyKeys.clear();
        } else if (this.options.isFocusTarget()) {
            this.overlay.focus();
        }
        this.wasActive = active;
    }

    private readonly frame = (timeMs: number): void => {
        this.requestFrame();
        const elapsedSeconds = this.lastFrameMs === undefined ? 0 : (timeMs - this.lastFrameMs) / MS_PER_SECOND;
        this.lastFrameMs = timeMs;
        const active = this.isActive();
        this.overlay.classList.toggle(INTERACTIVE_CLASS, active);
        if (active) {
            this.requestInfoWithoutFrames();
            this.fly(elapsedSeconds);
        }
        this.draw(active);
    };

    private frameShown(info: EditorViewInfo): void {
        if (this.disposed) return;
        this.overlayInfo.frameShown(info, performance.now());
        this.showInfoSource(FRAME_INFO, info);
        this.adoptView(info);
    }

    private requestInfoWithoutFrames(): void {
        const request = this.overlayInfo.startRequest(performance.now());
        if (request === undefined) return;
        const selection = this.workspace.selection.slice(0, MAX_SELECTION_BOUNDS);
        this.workspace.request({op: "getViewInfo", view: this.options.view, entities: selection}).then(info => {
            if (!this.overlayInfo.requestAnswered(request, info) || this.disposed) return;
            this.showInfoSource(REQUESTED_INFO, info);
            this.adoptView(info);
        }, error => this.overlayInfo.requestFailed(request, errorText(error), performance.now()));
    }

    private adoptView(info: EditorViewInfo): void {
        this.showViewHooks(info);
        this.showSelectionRotation();
        const camera = this.camera;
        const wanted = info.projection === "perspective" ? "3d" : "2d";
        if (camera !== undefined && camera.kind === wanted) return;
        const remembered = this.rememberedCamera;
        if (remembered?.kind === wanted) {
            this.changeCamera(remembered);
            return;
        }
        const pose: CameraPose = {position: info.camera.position, rotation: info.camera.rotation};
        this.camera = wanted === "2d"
            ? {kind: "2d", position: pose.position, rotation: pose.rotation}
            : {kind: "3d", orbit: orbitCameraFromPose(pose), fieldOfViewDegrees: info.camera.fieldOfViewDegrees ?? DEFAULT_FIELD_OF_VIEW_DEGREES};
        this.overlay.setAttribute(SCENE_CAMERA_HOOK, sceneViewCameraText(this.camera));
    }

    private showInfoSource(source: SceneInfoSource, info: EditorViewInfo): void {
        this.overlay.setAttribute(SCENE_INFO_SOURCE_HOOK, source);
        this.overlay.setAttribute(SCENE_BOUNDS_HOOK, String(info.bounds.length));
    }

    private showViewHooks(info: EditorViewInfo): void {
        if (info.presentedFrames !== undefined) this.overlay.setAttribute(SCENE_FRAMES_HOOK, String(info.presentedFrames));
        this.overlay.setAttribute(SCENE_VIEWS_HOOK, info.sceneViews.join(SCENE_VIEWS_SEPARATOR));
    }

    private changeCamera(camera: SceneViewCamera): void {
        this.camera = camera;
        this.rememberedCamera = camera;
        this.overlay.setAttribute(SCENE_CAMERA_HOOK, sceneViewCameraText(camera));
        this.scheduleCameraStore();
        this.sendCamera();
    }

    private scheduleCameraStore(): void {
        const window = this.storageWindow();
        if (window === null || this.cameraStoreTimer !== undefined) return;
        this.cameraStoreTimer = window.setTimeout(() => {
            this.cameraStoreTimer = undefined;
            const camera = this.rememberedCamera;
            if (this.disposed || camera === undefined) return;
            writeStorage(window, SCENE_VIEW_CAMERAS_STORAGE_KEY, withSceneViewCamera(readStorage(window, SCENE_VIEW_CAMERAS_STORAGE_KEY), this.workspace.scenes.projectKey(), this.options.view, camera));
        }, CAMERA_STORE_DELAY_MS);
    }

    private sendCamera(): void {
        const camera = this.camera;
        if (camera === undefined) return;
        this.cameraSender.run(async () => {
            const current = this.camera;
            if (current === undefined || this.disposed) return;
            const pose = sceneViewCameraPose(current);
            try {
                await this.workspace.request({op: "setEditorCamera", view: this.options.view, position: pose.position, rotation: pose.rotation});
            } catch (error) {
                if (!this.disposed) this.workspace.reportError(error);
            }
        });
    }

    private overlayScale(info: EditorViewInfo): OverlayScale | undefined {
        const canvas = this.viewport.querySelector("canvas");
        if (canvas === null) return undefined;
        const visualScale = visualScaleOf(this.overlay);
        return overlayScaleOf(info, layoutRectOf(canvas.getBoundingClientRect(), visualScale), layoutRectOf(this.overlay.getBoundingClientRect(), visualScale));
    }

    private pointOf(event: {readonly clientX: number, readonly clientY: number}): ScreenPoint {
        const bounds = this.overlay.getBoundingClientRect();
        const visualScale = visualScaleOf(this.overlay);
        return {x: (event.clientX - bounds.left) / visualScale, y: (event.clientY - bounds.top) / visualScale};
    }

    private selectedBounds(info: EditorViewInfo): EditorViewInfo["bounds"] {
        const selected = new Set(this.workspace.selection);
        return info.bounds.filter(bounds => selected.has(bounds.entity));
    }

    private gizmoOrigin(info: EditorViewInfo): Vector3 | undefined {
        return handleOrigin(this.selectedBounds(info), this.workspace.primary, this.workspace.handleModes.position);
    }

    private showSelectionRotation(): void {
        const info = this.info;
        const rotated = info !== undefined && isRotated(handleAxisRotation(this.selectedBounds(info), this.workspace.primary, true));
        if (rotated === this.shownSelectionRotated) return;
        this.shownSelectionRotated = rotated;
        this.workspace.emit("handles");
    }

    private snapping(event: {readonly ctrlKey: boolean, readonly metaKey: boolean}): boolean {
        return snapsThisDrag(this.workspace.snapEnabled, hasCommandModifier(event));
    }

    private gizmoAxes(info: EditorViewInfo, tool: EditorTool): Vector3[] {
        const alongEntity = tool === "scale" || this.workspace.handleModes.rotation === "local";
        const rotation = handleAxisRotation(this.selectedBounds(info), this.workspace.primary, alongEntity);
        return handleAxes(rotation, info.projection === "perspective" ? WORLD_AXES.length : AXES_IN_2D);
    }

    private moveSnap(info: EditorViewInfo): number {
        const steps = this.workspace.snapSteps;
        return info.projection === "perspective" ? steps.move3d : steps.move2d;
    }

    private buildHandles(info: EditorViewInfo, scale: OverlayScale): Handle[] {
        const tool = this.workspace.tool;
        const origin = this.gizmoOrigin(info);
        if (tool === "hand" || origin === undefined) return [];
        const projected = projectPoint(info.worldToScreen, origin);
        if (!isInFront(projected)) return [];
        const center = overlayPointOf(scale, projected);
        if (tool === "rotate") return [{kind: "ring", center, radius: ROTATE_RING_RADIUS_PX}];
        const handles: Handle[] = [];
        for (const [axisIndex, axis] of this.gizmoAxes(info, tool).entries()) {
            const perUnit = screenAxisPx(info.worldToScreen, scale, origin, axis);
            if (perUnit === undefined) continue;
            const length = Math.hypot(perUnit.x, perUnit.y);
            if (length === 0) continue;
            const direction = {x: perUnit.x / length, y: perUnit.y / length};
            const segment = {from: center, to: {x: center.x + direction.x * HANDLE_LENGTH_PX, y: center.y + direction.y * HANDLE_LENGTH_PX}};
            if (tool === "move") handles.push({kind: "moveAxis", axis, screenPerUnit: perUnit, segment, color: AXIS_COLORS[axisIndex]});
            else handles.push({kind: "scaleAxis", axisIndex, direction, segment, color: AXIS_COLORS[axisIndex]});
        }
        if (tool === "scale") handles.push({kind: "scaleCenter", center});
        return handles;
    }

    private handleAt(point: ScreenPoint): Handle | undefined {
        let best: {readonly handle: Handle, readonly distance: number} | undefined;
        for (const handle of this.handles) {
            let gap: number;
            if (handle.kind === "ring") gap = Math.abs(distance(point, handle.center) - handle.radius);
            else if (handle.kind === "scaleCenter") gap = distance(point, handle.center) - HANDLE_END_SIZE_PX;
            else if (handle.kind === "free") continue;
            else gap = distanceToSegmentPx(point, handle.segment);
            if (gap <= HANDLE_HIT_PX && (best === undefined || gap < best.distance)) best = {handle, distance: gap};
        }
        return best?.handle;
    }

    private isOverSelection(point: ScreenPoint, info: EditorViewInfo, scale: OverlayScale): boolean {
        return this.selectedBounds(info).some(bounds => {
            const rect = projectedBoundsRect(info.worldToScreen, bounds.min, bounds.max);
            return rect !== undefined && rectContains(overlayRectOf(scale, rect), point, HANDLE_HIT_PX);
        });
    }

    private onPointerDown(event: PointerEvent): void {
        if (!this.isActive()) return;
        this.options.activated();
        this.overlay.focus();
        const point = this.pointOf(event);
        const info = this.info;
        const scale = info === undefined ? undefined : this.overlayScale(info);
        capturePointer(this.overlay, event.pointerId);
        event.preventDefault();
        const perspective = this.camera?.kind === "3d";
        if (event.button === MIDDLE_BUTTON) {
            this.gesture = {kind: "camera", button: event.button, mode: "pan", last: point};
            return;
        }
        if (event.button === RIGHT_BUTTON) {
            this.gesture = {kind: "camera", button: event.button, mode: perspective ? "orbit" : "pan", last: point};
            return;
        }
        if (event.button !== LEFT_BUTTON) return;
        if (this.workspace.pickingEntity && !event.altKey) {
            this.gesture = {kind: "pending", start: point, overSelection: false, toggle: false, add: false, forEntityPick: true};
            return;
        }
        if (event.altKey && perspective) {
            this.gesture = {kind: "camera", button: event.button, mode: "orbit", last: point};
            return;
        }
        if (this.workspace.tool === "hand") {
            this.gesture = {kind: "camera", button: event.button, mode: "pan", last: point};
            return;
        }
        const handle = this.handleAt(point);
        if (handle !== undefined && info !== undefined && scale !== undefined) {
            this.startTransform(handle, point, info, scale, this.snapping(event));
            return;
        }
        const overSelection = info !== undefined && scale !== undefined && this.isOverSelection(point, info, scale);
        this.gesture = {kind: "pending", start: point, overSelection, toggle: hasCommandModifier(event), add: event.shiftKey, forEntityPick: false};
    }

    private onPointerMove(event: PointerEvent): void {
        const point = this.pointOf(event);
        const gesture = this.gesture;
        this.flyFast = event.shiftKey;
        if (gesture === undefined) {
            if (!this.isActive()) return;
            this.hovered = this.workspace.tool === "hand" ? undefined : this.handleAt(point);
            return;
        }
        switch (gesture.kind) {
            case "camera":
                this.moveCamera(gesture, point);
                return;
            case "pending": {
                if (distance(point, gesture.start) < CLICK_SLOP_PX) return;
                if (!gesture.overSelection) {
                    this.gesture = undefined;
                    return;
                }
                const info = this.info;
                const scale = info === undefined ? undefined : this.overlayScale(info);
                if (info === undefined || scale === undefined) return;
                this.startTransform({kind: "free"}, gesture.start, info, scale, this.snapping(event));
                const started = this.gesture;
                if (started?.kind === "transform") this.updateTransform(started, point, this.snapping(event));
                return;
            }
            case "transform":
                this.updateTransform(gesture, point, this.snapping(event));
                return;
        }
    }

    private onPointerUp(event: PointerEvent): void {
        const gesture = this.gesture;
        this.gesture = undefined;
        releasePointer(this.overlay, event.pointerId);
        if (gesture === undefined) return;
        if (gesture.kind === "camera" && gesture.button === RIGHT_BUTTON) this.flyKeys.clear();
        if (gesture.kind === "pending" && event.type === "pointerup") void this.pick(gesture);
        if (gesture.kind === "transform") this.finishTransform(gesture);
    }

    private onWheel(event: WheelEvent): void {
        if (!this.isActive()) return;
        event.preventDefault();
        const camera = this.camera;
        if (camera === undefined || camera.kind !== "3d") return;
        this.changeCamera({...camera, orbit: dollyCamera(camera.orbit, wheelNotches(event))});
    }

    private onKeyDown(event: KeyboardEvent): void {
        this.flyFast = event.shiftKey;
        const key = event.key.toLowerCase();
        if (!this.capturesKeys || this.camera?.kind !== "3d" || !FLY_KEYS.has(key)) return;
        event.preventDefault();
        event.stopPropagation();
        this.flyKeys.add(key);
    }

    private onKeyUp(event: KeyboardEvent): void {
        this.flyFast = event.shiftKey;
        this.flyKeys.delete(event.key.toLowerCase());
    }

    private fly(elapsedSeconds: number): void {
        const gesture = this.gesture;
        const camera = this.camera;
        if (this.flyKeys.size === 0 || gesture?.kind !== "camera" || camera?.kind !== "3d") return;
        const held = (key: string): number => this.flyKeys.has(key) ? 1 : 0;
        gesture.mode = "look";
        this.changeCamera({...camera, orbit: flyCamera(camera.orbit, {right: held("d") - held("a"), up: held("e") - held("q"), forward: held("w") - held("s")}, elapsedSeconds, this.flyFast)});
    }

    private moveCamera(gesture: CameraGesture, point: ScreenPoint): void {
        const dx = point.x - gesture.last.x;
        const dy = point.y - gesture.last.y;
        gesture.last = point;
        const camera = this.camera;
        const info = this.info;
        if (camera === undefined || info === undefined || (dx === 0 && dy === 0)) return;
        if (gesture.mode === "pan") {
            const scale = this.overlayScale(info);
            if (scale === undefined) return;
            const dxUnits = dx / scale.pxPerUnitX;
            const dyUnits = dy / scale.pxPerUnitY;
            if (camera.kind === "2d") {
                this.changeCamera({...camera, position: panCamera2d(camera.position, dxUnits, dyUnits * SCREEN_UNIT_HEIGHT_PER_WIDTH)});
            } else {
                const geometry: ViewInfoGeometry = {...info, camera: {...poseOfOrbitCamera(camera.orbit), fieldOfViewDegrees: camera.fieldOfViewDegrees}};
                this.changeCamera({...camera, orbit: panOrbitCamera(camera.orbit, viewPlaneDelta(geometry, camera.orbit.distance, dxUnits, dyUnits))});
            }
        } else if (camera.kind === "3d") {
            this.changeCamera({...camera, orbit: gesture.mode === "orbit" ? orbitAroundPivot(camera.orbit, dx, dy) : lookAround(camera.orbit, dx, dy)});
        }
    }

    private async currentInfo(): Promise<EditorViewInfo | undefined> {
        try {
            const info = await this.workspace.request({op: "getViewInfo", view: this.options.view, entities: this.workspace.selection.slice(0, MAX_SELECTION_BOUNDS)});
            if (!this.disposed) this.adoptView(info);
            return info;
        } catch {
            return this.info;
        }
    }

    private async pick(click: PendingClick): Promise<void> {
        const info = await this.currentInfo();
        const scale = info === undefined || this.disposed ? undefined : this.overlayScale(info);
        if (scale === undefined) return;
        const screen = screenPointOf(scale, click.start);
        try {
            const {entities: hits} = await this.workspace.request({op: "pickEntities", x: screen.x, y: screen.y, view: this.options.view});
            if (click.forEntityPick) {
                const picked = hits[0];
                if (picked !== undefined) this.workspace.finishEntityPick(picked);
                return;
            }
            const previous = this.pickCycle;
            const repeated = previous !== undefined && distance(previous.point, click.start) <= CLICK_SLOP_PX && sameEntities(previous.hits, hits);
            this.pickCycle = {point: click.start, hits};
            const workspace = this.workspace;
            if (hits.length === 0) {
                if (!click.toggle && !click.add) workspace.select([]);
                return;
            }
            const primary = workspace.primary;
            const index = repeated && primary !== undefined ? (hits.indexOf(primary) + 1) % hits.length : 0;
            const hit = hits[index];
            if (click.toggle) workspace.toggleSelected(hit);
            else if (click.add) workspace.select([...workspace.selection.filter(entity => entity !== hit), hit]);
            else workspace.select([hit]);
        } catch (error) {
            this.workspace.reportError(error);
        }
    }

    private startTransform(handle: Handle, start: ScreenPoint, info: EditorViewInfo, scale: OverlayScale, snapping: boolean): void {
        const origin = this.gizmoOrigin(info);
        if (origin === undefined) return;
        const projected = projectPoint(info.worldToScreen, origin);
        const viewAxis = viewAxisOf(info);
        const primaryRotation = handleAxisRotation(this.selectedBounds(info), this.workspace.primary, true);
        const gesture: TransformGesture = {
            kind: "transform",
            handle,
            start,
            current: start,
            key: `gizmo:${nextGestureId++}`,
            sender: new LatestOnly(),
            origin: overlayPointOf(scale, projected),
            worldOrigin: origin,
            startTwist: isWorldAxis(viewAxis) ? twistRadians(primaryRotation, viewAxis) : undefined,
            depth: isInFront(projected) ? projected.w : 1,
            info,
            scale,
            snapping,
            targets: undefined,
            released: false,
        };
        this.gesture = gesture;
        void this.prepareTargets(handle, gesture.key).then(targets => {
            gesture.targets = targets;
            this.applyTransform(gesture);
            if (gesture.released) this.endTransform(gesture);
        }, error => {
            if (this.gesture === gesture) this.gesture = undefined;
            this.workspace.reportError(error);
        });
    }

    private updateTransform(gesture: TransformGesture, point: ScreenPoint, snapping: boolean): void {
        gesture.current = point;
        gesture.snapping = snapping;
        if (gesture.targets !== undefined) this.applyTransform(gesture);
    }

    private finishTransform(gesture: TransformGesture): void {
        gesture.released = true;
        if (gesture.targets !== undefined) this.endTransform(gesture);
    }

    private endTransform(gesture: TransformGesture): void {
        gesture.sender.whenDrained(() => this.workspace.endGesture(gesture.key));
    }

    private async detailsFor(entity: Entity): Promise<EditorEntityDetails> {
        return this.workspace.detailsOf(entity) ?? await this.workspace.request({op: "getEntity", entity});
    }

    private async prepareTargets(handle: Handle, key: string): Promise<TransformTarget[]> {
        const workspace = this.workspace;
        const entities = topmostEntities(workspace.selection, parentLookupOf(workspace.links()));
        const needsRotation = handle.kind === "ring";
        const needsScale = handle.kind === "scaleAxis" || handle.kind === "scaleCenter";
        const targets: TransformTarget[] = [];
        for (const entity of entities) {
            let details = await this.detailsFor(entity);
            const hasRotation = componentField(details, LOCAL_ROTATION, QUATERNION_KEY) !== undefined;
            const hasScale = componentField(details, LOCAL_SCALE, VEC3_KEY) !== undefined;
            if ((needsRotation && !hasRotation) || (needsScale && !hasScale)) {
                await workspace.addComponent([entity], needsRotation ? LOCAL_ROTATION : LOCAL_SCALE, undefined, key);
                details = await workspace.request({op: "getEntity", entity});
            }
            const ancestors: LocalTransform[] = [];
            const visited = new Set<Entity>([entity]);
            for (let parent = workspace.summaryOf(entity)?.parent ?? null; parent !== null && !visited.has(parent); parent = workspace.summaryOf(parent)?.parent ?? null) {
                visited.add(parent);
                ancestors.unshift(localTransformOf(await this.detailsFor(parent)));
            }
            const local = localTransformOf(details);
            const position = numbersOf(componentField(details, LOCAL_POSITION, VEC3_KEY), 3);
            targets.push({
                entity,
                position: position === undefined ? undefined : [position[0], position[1], position[2]],
                positionJson: componentField(details, LOCAL_POSITION, VEC3_KEY) as SceneJsonValue | undefined,
                rotation: local.rotation,
                rotationJson: (componentField(details, LOCAL_ROTATION, QUATERNION_KEY) ?? [...IDENTITY_QUATERNION]) as SceneJsonValue,
                scale: local.scale,
                scaleJson: (componentField(details, LOCAL_SCALE, VEC3_KEY) ?? [...UNIT_SCALE]) as SceneJsonValue,
                parentLinear: ancestors.length === 0 ? IDENTITY_MATRIX3 : chainLinear(ancestors),
                parentRotation: chainRotation(ancestors),
            });
        }
        return targets;
    }

    private applyTransform(gesture: TransformGesture): void {
        const targets = gesture.targets;
        if (targets === undefined || targets.length === 0) return;
        const changes = this.changesFor(gesture, targets);
        if (changes.length === 0) return;
        gesture.sender.run(() => this.workspace.setFields(changes, this.labelFor(gesture.handle), gesture.key));
    }

    private labelFor(handle: Handle): string {
        if (handle.kind === "ring") return "Rotate";
        if (handle.kind === "scaleAxis" || handle.kind === "scaleCenter") return "Scale";
        return "Move";
    }

    private changesFor(gesture: TransformGesture, targets: readonly TransformTarget[]): FieldChange[] {
        const {handle, info, scale} = gesture;
        const pointerDelta = {x: gesture.current.x - gesture.start.x, y: gesture.current.y - gesture.start.y};
        const changes: FieldChange[] = [];
        const field = (target: TransformTarget, typeName: string, key: string, before: SceneJsonValue, after: Vector3 | Quaternion): FieldChange =>
            ({entity: target.entity, typeName, key, before, after: [...after], entityShape: HOLDS_NO_ENTITIES});
        switch (handle.kind) {
            case "free":
            case "moveAxis": {
                const snap = this.moveSnap(info);
                let worldDelta: Vector3;
                if (handle.kind === "free") {
                    worldDelta = viewPlaneDelta(info, gesture.depth, pointerDelta.x / scale.pxPerUnitX, pointerDelta.y / scale.pxPerUnitY);
                    if (gesture.snapping) worldDelta = snappedMoveDelta(gesture.worldOrigin, worldDelta, snap);
                } else {
                    let amount = amountAlongScreenAxis(handle.screenPerUnit, pointerDelta);
                    if (gesture.snapping) amount = snappedDeltaFrom(dotVectors(gesture.worldOrigin, handle.axis), amount, snap);
                    worldDelta = scaleVector(handle.axis, amount);
                }
                for (const target of targets) {
                    if (target.position === undefined || target.positionJson === undefined) continue;
                    changes.push(field(target, LOCAL_POSITION, VEC3_KEY, target.positionJson, addVectors(target.position, localDeltaOf(target.parentLinear, worldDelta))));
                }
                return changes;
            }
            case "ring": {
                const angle = wrapAngleRadians(pointerAngleRadians(gesture.origin, gesture.current) - pointerAngleRadians(gesture.origin, gesture.start));
                const axis = viewAxisOf(info);
                const step = degreesToRadians(this.workspace.snapSteps.rotateDegrees);
                let radians = viewRotationSign(info) * angle;
                if (gesture.snapping) radians = gesture.startTwist === undefined ? snapToIncrement(radians, step) : snappedDeltaFrom(gesture.startTwist, radians, step);
                for (const target of targets) {
                    changes.push(field(target, LOCAL_ROTATION, QUATERNION_KEY, target.rotationJson, rotatedAboutWorldAxis(target.rotation, target.parentRotation, axis, radians)));
                }
                return changes;
            }
            case "scaleAxis":
            case "scaleCenter": {
                const along = handle.kind === "scaleAxis"
                    ? pointerDelta.x * handle.direction.x + pointerDelta.y * handle.direction.y
                    : pointerDelta.x - pointerDelta.y;
                const factor = Math.max(MIN_SCALE_FACTOR, 1 + along / HANDLE_LENGTH_PX);
                const scaleStep = this.workspace.snapSteps.scale;
                for (const target of targets) {
                    const scaled = target.scale.map((component, index) => {
                        if (handle.kind === "scaleAxis" && index !== handle.axisIndex) return component;
                        const value = component * factor;
                        return gesture.snapping ? snapToIncrement(value, scaleStep) : value;
                    });
                    changes.push(field(target, LOCAL_SCALE, VEC3_KEY, target.scaleJson, [scaled[0], scaled[1], scaled[2]]));
                }
                return changes;
            }
        }
    }

    private onDragOver(event: DragEvent): void {
        const drag = this.workspace.drag;
        if (drag?.kind !== "asset" || !isAssetKind(drag.fileKind)) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    }

    private onDrop(event: DragEvent): void {
        const drag = this.workspace.drag;
        if (drag?.kind !== "asset" || !isAssetKind(drag.fileKind)) return;
        event.preventDefault();
        this.workspace.drag = undefined;
        void this.workspace.instantiateAsset(drag.path, {target: UNPARENT_TARGET, position: this.dropPosition(event)});
    }

    private dropPosition(event: DragEvent): Vector3 | undefined {
        const info = this.info;
        const camera = this.camera;
        if (!this.isActive() || info === undefined || camera === undefined) return undefined;
        const scale = this.overlayScale(info);
        if (scale === undefined) return undefined;
        const screen = screenPointOf(scale, this.pointOf(event));
        const pose = sceneViewCameraPose(camera);
        const geometry: ViewInfoGeometry = {...info, camera: {...pose, fieldOfViewDegrees: camera.kind === "3d" ? camera.fieldOfViewDegrees : undefined}};
        return pointOnViewPlane(geometry, screen, camera.kind === "3d" ? camera.orbit.distance : 0);
    }

    private draw(active: boolean): void {
        const canvas = this.overlay;
        const ratio = this.window()?.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const context = canvas.getContext("2d");
        if (context === null) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        if (!active) {
            this.handles = [];
            return;
        }
        const info = this.info;
        const scale = info === undefined ? undefined : this.overlayScale(info);
        if (info === undefined || scale === undefined) {
            const problem = this.overlayInfo.problem;
            if (problem !== undefined) this.drawMessage(context, problem);
            this.handles = [];
            return;
        }
        this.drawOutlines(context, info, scale);
        this.handles = this.buildHandles(info, scale);
        this.drawHandles(context);
    }

    private drawMessage(context: CanvasRenderingContext2D, text: string): void {
        context.fillStyle = MESSAGE_COLOR;
        context.font = MESSAGE_FONT;
        context.fillText(text, MESSAGE_MARGIN_PX, this.overlay.clientHeight - MESSAGE_MARGIN_PX);
    }

    private drawOutlines(context: CanvasRenderingContext2D, info: EditorViewInfo, scale: OverlayScale): void {
        context.strokeStyle = SELECTION_COLOR;
        context.lineWidth = OUTLINE_WIDTH_PX;
        for (const bounds of this.selectedBounds(info)) {
            const isPoint = bounds.min.every((value, index) => value === bounds.max[index]);
            if (isPoint) {
                const projected = projectPoint(info.worldToScreen, bounds.min);
                if (!isInFront(projected)) continue;
                const point = overlayPointOf(scale, projected);
                context.beginPath();
                context.moveTo(point.x, point.y - POINT_MARKER_RADIUS_PX);
                context.lineTo(point.x + POINT_MARKER_RADIUS_PX, point.y);
                context.lineTo(point.x, point.y + POINT_MARKER_RADIUS_PX);
                context.lineTo(point.x - POINT_MARKER_RADIUS_PX, point.y);
                context.closePath();
                context.stroke();
                continue;
            }
            if (info.projection === "orthographic") {
                const rect = projectedBoundsRect(info.worldToScreen, bounds.min, bounds.max);
                if (rect === undefined) continue;
                const overlay = overlayRectOf(scale, rect);
                context.strokeRect(overlay.left, overlay.top, overlay.right - overlay.left, overlay.bottom - overlay.top);
                continue;
            }
            context.beginPath();
            for (const edge of projectedBoxEdges(info.worldToScreen, bounds.min, bounds.max)) {
                const from = overlayPointOf(scale, edge.from);
                const to = overlayPointOf(scale, edge.to);
                context.moveTo(from.x, from.y);
                context.lineTo(to.x, to.y);
            }
            context.stroke();
        }
    }

    private drawHandles(context: CanvasRenderingContext2D): void {
        const active = this.gesture?.kind === "transform" ? this.gesture.handle : this.hovered;
        context.lineWidth = LINE_WIDTH_PX;
        for (const handle of this.handles) {
            const highlighted = active !== undefined && sameHandle(handle, active);
            switch (handle.kind) {
                case "ring":
                    context.strokeStyle = highlighted ? HOVER_COLOR : RING_COLOR;
                    context.beginPath();
                    context.arc(handle.center.x, handle.center.y, handle.radius, 0, Math.PI * 2);
                    context.stroke();
                    break;
                case "scaleCenter":
                    context.fillStyle = highlighted ? HOVER_COLOR : CENTER_COLOR;
                    context.fillRect(handle.center.x - HANDLE_END_SIZE_PX / 2, handle.center.y - HANDLE_END_SIZE_PX / 2, HANDLE_END_SIZE_PX, HANDLE_END_SIZE_PX);
                    break;
                case "moveAxis":
                case "scaleAxis": {
                    const color = highlighted ? HOVER_COLOR : handle.color;
                    const {from, to} = handle.segment;
                    context.strokeStyle = color;
                    context.fillStyle = color;
                    context.beginPath();
                    context.moveTo(from.x, from.y);
                    context.lineTo(to.x, to.y);
                    context.stroke();
                    if (handle.kind === "scaleAxis") {
                        context.fillRect(to.x - HANDLE_END_SIZE_PX / 2, to.y - HANDLE_END_SIZE_PX / 2, HANDLE_END_SIZE_PX, HANDLE_END_SIZE_PX);
                    } else {
                        const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                        const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
                        context.beginPath();
                        context.moveTo(to.x + ux * HANDLE_END_SIZE_PX, to.y + uy * HANDLE_END_SIZE_PX);
                        context.lineTo(to.x - uy * HANDLE_END_SIZE_PX / 2, to.y + ux * HANDLE_END_SIZE_PX / 2);
                        context.lineTo(to.x + uy * HANDLE_END_SIZE_PX / 2, to.y - ux * HANDLE_END_SIZE_PX / 2);
                        context.closePath();
                        context.fill();
                    }
                    break;
                }
                case "free":
                    break;
            }
        }
    }
}
