import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../engine/rendering/screenUnits";
import type {EditorViewInfo} from "../editorProtocol";
import {addVectors, degreesToRadians, forwardOf, rightOf, rotateVector, scaleVector, upOf} from "./editorCameraMath";
import type {Vector3} from "./editorCameraMath";

export interface ProjectedPoint {
    readonly x: number;
    readonly y: number;
    readonly w: number;
}

export interface ScreenPoint {
    readonly x: number;
    readonly y: number;
}

export interface ScreenRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface ScreenSegment {
    readonly from: ScreenPoint;
    readonly to: ScreenPoint;
}

export interface OverlayScale {
    readonly originLeftPx: number;
    readonly originTopPx: number;
    readonly pxPerUnitX: number;
    readonly pxPerUnitY: number;
}

export interface CssRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export type ViewInfoGeometry = Pick<EditorViewInfo, "projection" | "worldToScreen" | "screenWidth" | "screenHeight" | "camera">;

export const MIN_PROJECTED_W = 1e-4;
export const AXIS_PROBE_WORLD_UNITS = 0.01;

const HALF = 0.5;
const MAT4_SIZE = 4;
const BOX_CORNER_COUNT = 8;
const X_BIT = 1;
const Y_BIT = 2;
const Z_BIT = 4;

export const BOX_EDGES: readonly (readonly [number, number])[] = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

function element(matrix: readonly number[], row: number, column: number): number {
    return matrix[column * MAT4_SIZE + row];
}

export function projectPoint(worldToScreen: readonly number[], point: Vector3): ProjectedPoint {
    const [px, py, pz] = point;
    const row = (index: number) => element(worldToScreen, index, 0) * px + element(worldToScreen, index, 1) * py + element(worldToScreen, index, 2) * pz + element(worldToScreen, index, 3);
    const w = row(3);
    return {x: row(0) / w, y: row(1) / w, w};
}

export function isInFront(point: ProjectedPoint): boolean {
    return point.w > MIN_PROJECTED_W && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function boxCorners(min: Vector3, max: Vector3): Vector3[] {
    const corners: Vector3[] = [];
    for (let index = 0; index < BOX_CORNER_COUNT; index++) {
        corners.push([(index & X_BIT) === 0 ? min[0] : max[0], (index & Y_BIT) === 0 ? min[1] : max[1], (index & Z_BIT) === 0 ? min[2] : max[2]]);
    }
    return corners;
}

export function projectedBoundsRect(worldToScreen: readonly number[], min: Vector3, max: Vector3): ScreenRect | undefined {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const corner of boxCorners(min, max)) {
        const projected = projectPoint(worldToScreen, corner);
        if (!isInFront(projected)) continue;
        left = Math.min(left, projected.x);
        right = Math.max(right, projected.x);
        top = Math.min(top, projected.y);
        bottom = Math.max(bottom, projected.y);
    }
    return left === Infinity ? undefined : {left, top, right, bottom};
}

export function projectedBoxEdges(worldToScreen: readonly number[], min: Vector3, max: Vector3): ScreenSegment[] {
    const projected = boxCorners(min, max).map(corner => projectPoint(worldToScreen, corner));
    return BOX_EDGES
        .filter(([a, b]) => isInFront(projected[a]) && isInFront(projected[b]))
        .map(([a, b]) => ({from: {x: projected[a].x, y: projected[a].y}, to: {x: projected[b].x, y: projected[b].y}}));
}

export function overlayScaleOf(info: Pick<EditorViewInfo, "screenWidth" | "screenHeight">, canvas: CssRect, overlay: CssRect): OverlayScale | undefined {
    if (!(info.screenWidth > 0) || !(info.screenHeight > 0) || !(canvas.width > 0) || !(canvas.height > 0)) return undefined;
    return {
        originLeftPx: canvas.left - overlay.left,
        originTopPx: canvas.top - overlay.top,
        pxPerUnitX: canvas.width / info.screenWidth,
        pxPerUnitY: canvas.height / info.screenHeight,
    };
}

export function layoutRectOf(visual: CssRect, visualScale: number): CssRect {
    return {left: visual.left / visualScale, top: visual.top / visualScale, width: visual.width / visualScale, height: visual.height / visualScale};
}

export function overlayPointOf(scale: OverlayScale, point: ScreenPoint): ScreenPoint {
    return {x: scale.originLeftPx + point.x * scale.pxPerUnitX, y: scale.originTopPx + point.y * scale.pxPerUnitY};
}

export function screenPointOf(scale: OverlayScale, overlayPoint: ScreenPoint): ScreenPoint {
    return {x: (overlayPoint.x - scale.originLeftPx) / scale.pxPerUnitX, y: (overlayPoint.y - scale.originTopPx) / scale.pxPerUnitY};
}

export function overlayRectOf(scale: OverlayScale, rect: ScreenRect): ScreenRect {
    const topLeft = overlayPointOf(scale, {x: rect.left, y: rect.top});
    const bottomRight = overlayPointOf(scale, {x: rect.right, y: rect.bottom});
    return {left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y};
}

export function rectContains(rect: ScreenRect, point: ScreenPoint, marginPx: number = 0): boolean {
    return point.x >= rect.left - marginPx && point.x <= rect.right + marginPx && point.y >= rect.top - marginPx && point.y <= rect.bottom + marginPx;
}

export function focalLengthInScreenRows(screenHeight: number, fieldOfViewDegrees: number): number {
    return screenHeight / (Math.tan(degreesToRadians(fieldOfViewDegrees) * HALF) * 2);
}

function perspectiveFocal(info: ViewInfoGeometry): number | undefined {
    const fieldOfView = info.camera.fieldOfViewDegrees;
    if (info.projection !== "perspective" || fieldOfView === undefined) return undefined;
    const focal = focalLengthInScreenRows(info.screenHeight, fieldOfView);
    return focal > 0 && Number.isFinite(focal) ? focal : undefined;
}

export function viewPlaneDelta(info: ViewInfoGeometry, depth: number, deltaXUnits: number, deltaYUnits: number): Vector3 {
    const focal = perspectiveFocal(info);
    if (focal === undefined) return [deltaXUnits, deltaYUnits, 0];
    const rotation = info.camera.rotation;
    const viewX = deltaXUnits * depth / (SCREEN_UNIT_HEIGHT_PER_WIDTH * focal);
    const viewY = -deltaYUnits * depth / focal;
    return addVectors(scaleVector(rightOf(rotation), viewX), scaleVector(upOf(rotation), viewY));
}

export function pointOnViewPlane(info: ViewInfoGeometry, screen: ScreenPoint, depth: number): Vector3 {
    const focal = perspectiveFocal(info);
    const position = info.camera.position;
    if (focal === undefined) {
        return [position[0] - info.screenWidth * HALF + screen.x, position[1] - info.screenHeight * HALF + screen.y, 0];
    }
    const view: Vector3 = [
        (screen.x - info.screenWidth * HALF) / (SCREEN_UNIT_HEIGHT_PER_WIDTH * focal) * depth,
        (info.screenHeight * HALF - screen.y) / focal * depth,
        depth,
    ];
    return addVectors(position, rotateVector(info.camera.rotation, view));
}

export function viewAxisOf(info: Pick<EditorViewInfo, "projection" | "camera">): Vector3 {
    return info.projection === "perspective" ? forwardOf(info.camera.rotation) : [0, 0, 1];
}

export function screenAxisPx(worldToScreen: readonly number[], scale: OverlayScale, origin: Vector3, axis: Vector3): ScreenPoint | undefined {
    const from = projectPoint(worldToScreen, origin);
    const to = projectPoint(worldToScreen, addVectors(origin, scaleVector(axis, AXIS_PROBE_WORLD_UNITS)));
    if (!isInFront(from) || !isInFront(to)) return undefined;
    const x = (to.x - from.x) * scale.pxPerUnitX / AXIS_PROBE_WORLD_UNITS;
    const y = (to.y - from.y) * scale.pxPerUnitY / AXIS_PROBE_WORLD_UNITS;
    return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : undefined;
}

export function amountAlongScreenAxis(screenAxisPerUnit: ScreenPoint, pointerDeltaPx: ScreenPoint): number {
    const lengthSquared = screenAxisPerUnit.x * screenAxisPerUnit.x + screenAxisPerUnit.y * screenAxisPerUnit.y;
    if (lengthSquared === 0) return 0;
    return (pointerDeltaPx.x * screenAxisPerUnit.x + pointerDeltaPx.y * screenAxisPerUnit.y) / lengthSquared;
}

export function pointerAngleRadians(center: ScreenPoint, pointer: ScreenPoint): number {
    return Math.atan2(pointer.y - center.y, pointer.x - center.x);
}

export function wrapAngleRadians(radians: number): number {
    const fullTurn = Math.PI * 2;
    let wrapped = radians % fullTurn;
    if (wrapped > Math.PI) wrapped -= fullTurn;
    if (wrapped < -Math.PI) wrapped += fullTurn;
    return wrapped;
}

export function viewRotationSign(info: Pick<EditorViewInfo, "projection">): number {
    return info.projection === "perspective" ? -1 : 1;
}

export function distanceToSegmentPx(point: ScreenPoint, segment: ScreenSegment): number {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (segment.from.x + t * dx), point.y - (segment.from.y + t * dy));
}
