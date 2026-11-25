import {poseOfOrbitCamera} from "./editorCameraMath";
import type {CameraPose, OrbitCamera, Quaternion, Vector3} from "./editorCameraMath";
import {isSceneViewId} from "../project/dockPanelIds";
import type {SceneViewId} from "../project/dockPanelIds";

export const SCENE_VIEW_CAMERAS_STORAGE_KEY = "jsengine.editor.sceneViewCameras";
export const MAX_CAMERA_PROJECTS = 20;
export const CAMERA_TEXT_DIGITS = 2;

export type SceneViewCamera =
    | {readonly kind: "2d", readonly position: Vector3, readonly rotation: Quaternion}
    | {readonly kind: "3d", readonly orbit: OrbitCamera, readonly fieldOfViewDegrees: number};

type CamerasByView = {readonly [view: string]: SceneViewCamera};
type CamerasByProject = {readonly [projectKey: string]: CamerasByView};

const VECTOR3_LENGTH = 3;
const QUATERNION_LENGTH = 4;
const CAMERA_TEXT_SEPARATOR = " ";
const DECIMAL_BASE = 10;
const NO_SIGN = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isFiniteTuple(value: unknown, length: number): boolean {
    return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isOrbitCamera(value: unknown): value is OrbitCamera {
    return isRecord(value) && isFiniteTuple(value.pivot, VECTOR3_LENGTH)
        && isFiniteNumber(value.yawDegrees) && isFiniteNumber(value.pitchDegrees) && isFiniteNumber(value.distance);
}

export function isSceneViewCamera(value: unknown): value is SceneViewCamera {
    if (!isRecord(value)) return false;
    if (value.kind === "2d") return isFiniteTuple(value.position, VECTOR3_LENGTH) && isFiniteTuple(value.rotation, QUATERNION_LENGTH);
    return value.kind === "3d" && isOrbitCamera(value.orbit) && isFiniteNumber(value.fieldOfViewDegrees);
}

function camerasOf(value: unknown): CamerasByView {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [SceneViewId, SceneViewCamera] => isSceneViewId(entry[0]) && isSceneViewCamera(entry[1])));
}

function parsed(text: string | null): CamerasByProject {
    if (text === null) return {};
    try {
        const value = JSON.parse(text) as unknown;
        if (!isRecord(value)) return {};
        return Object.fromEntries(Object.entries(value).map(([projectKey, cameras]) => [projectKey, camerasOf(cameras)]));
    } catch {
        return {};
    }
}

function withProjectCameras(text: string | null, projectKey: string, cameras: CamerasByView): string {
    const others = Object.entries(parsed(text)).filter(([key]) => key !== projectKey);
    const kept = Object.keys(cameras).length === 0 ? others : [[projectKey, cameras] as const, ...others];
    return JSON.stringify(Object.fromEntries(kept.slice(0, MAX_CAMERA_PROJECTS)));
}

export function storedSceneViewCamera(text: string | null, projectKey: string, view: SceneViewId): SceneViewCamera | undefined {
    return parsed(text)[projectKey]?.[view];
}

export function withSceneViewCamera(text: string | null, projectKey: string, view: SceneViewId, camera: SceneViewCamera): string {
    return withProjectCameras(text, projectKey, {...parsed(text)[projectKey], [view]: camera});
}

export function withoutSceneViewCamera(text: string | null, projectKey: string, view: SceneViewId): string {
    const cameras = Object.entries(parsed(text)[projectKey] ?? {}).filter(([kept]) => kept !== view);
    return withProjectCameras(text, projectKey, Object.fromEntries(cameras));
}

function roundedText(value: number): string {
    const scale = DECIMAL_BASE ** CAMERA_TEXT_DIGITS;
    return (Math.round(value * scale) / scale + NO_SIGN).toFixed(CAMERA_TEXT_DIGITS);
}

function canonicalRotation(rotation: Quaternion): Quaternion {
    return rotation[3] < 0 ? [-rotation[0], -rotation[1], -rotation[2], -rotation[3]] : rotation;
}

export function sceneViewCameraPose(camera: SceneViewCamera): CameraPose {
    return camera.kind === "2d" ? {position: camera.position, rotation: camera.rotation} : poseOfOrbitCamera(camera.orbit);
}

export function sceneViewCameraText(camera: SceneViewCamera): string {
    const pose = sceneViewCameraPose(camera);
    return [camera.kind, ...[...pose.position, ...canonicalRotation(pose.rotation)].map(roundedText)].join(CAMERA_TEXT_SEPARATOR);
}
