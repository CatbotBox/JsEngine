import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import type {Mesh} from "../../engine/rendering/3d/mesh";
import {capturePointer, createElement, releasePointer} from "./dom";
import {DEFAULT_MESH_VIEW, renderMeshThumbnail} from "./projectThumbnails";
import type {MeshView} from "./projectThumbnails";

export const MESH_PREVIEW_SIZE_PX = 256;
export const ORBIT_RADIANS_PER_PIXEL = Math.PI / 180;
export const MAX_ORBIT_PITCH_RADIANS = Math.PI * 0.45;
export const MIN_ORBIT_PITCH_RADIANS = -MAX_ORBIT_PITCH_RADIANS;
export const MESH_PREVIEW_CLASS_NAME = "project-preview-image project-preview-orbit";
export const ORBIT_HINT_TEXT = "Drag to orbit";

const PRIMARY_BUTTON = 0;
const BOUNDS_DECIMALS = 3;
const MIN_X = 0, MIN_Y = 1, MIN_Z = 2, MAX_X = 3, MAX_Y = 4, MAX_Z = 5;

interface OrbitDrag {
    readonly pointerId: number;
    x: number;
    y: number;
}

export function orbitedView(view: MeshView, deltaX: number, deltaY: number): MeshView {
    const pitchRadians = view.pitchRadians + deltaY * ORBIT_RADIANS_PER_PIXEL;
    return {
        yawRadians: view.yawRadians + deltaX * ORBIT_RADIANS_PER_PIXEL,
        pitchRadians: Math.min(MAX_ORBIT_PITCH_RADIANS, Math.max(MIN_ORBIT_PITCH_RADIANS, pitchRadians)),
    };
}

function formatLength(value: number): string {
    return String(Number(value.toFixed(BOUNDS_DECIMALS)));
}

export function meshFacts(mesh: Mesh): readonly (readonly [label: string, value: string])[] {
    const bounds = mesh.bounds;
    const size = [bounds[MAX_X] - bounds[MIN_X], bounds[MAX_Y] - bounds[MIN_Y], bounds[MAX_Z] - bounds[MIN_Z]];
    return [["Vertices", String(mesh.vertCount)], ["Triangles", String(mesh.triangleCount)], ["Bounds", size.map(formatLength).join(" × ")]];
}

export function paintImage(canvas: HTMLCanvasElement, image: DecodedImage): void {
    if (canvas.width !== image.width) canvas.width = image.width;
    if (canvas.height !== image.height) canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null || image.width === 0 || image.height === 0) return;
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.rgba);
    context.putImageData(pixels, 0, 0);
}

export class MeshOrbitPreview {
    public readonly element: HTMLCanvasElement;
    private currentView: MeshView = DEFAULT_MESH_VIEW;
    private drag: OrbitDrag | undefined;
    private framePending = false;

    public constructor(document: Document, private readonly positions: Float32Array, private readonly cornerIndices: Float32Array) {
        this.element = createElement(document, "canvas", MESH_PREVIEW_CLASS_NAME);
        this.element.title = ORBIT_HINT_TEXT;
        this.element.addEventListener("pointerdown", event => this.beginDrag(event));
        this.element.addEventListener("pointermove", event => this.moveDrag(event));
        this.element.addEventListener("pointerup", event => this.endDrag(event));
        this.element.addEventListener("pointercancel", event => this.endDrag(event));
        this.element.addEventListener("lostpointercapture", () => this.drag = undefined);
        this.paint();
    }

    public get view(): MeshView {
        return this.currentView;
    }

    private beginDrag(event: PointerEvent): void {
        if (event.button !== PRIMARY_BUTTON) return;
        event.preventDefault();
        capturePointer(this.element, event.pointerId);
        this.drag = {pointerId: event.pointerId, x: event.clientX, y: event.clientY};
    }

    private moveDrag(event: PointerEvent): void {
        const drag = this.drag;
        if (drag === undefined || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.x, deltaY = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (deltaX === 0 && deltaY === 0) return;
        this.currentView = orbitedView(this.currentView, deltaX, deltaY);
        this.schedulePaint();
    }

    private endDrag(event: PointerEvent): void {
        if (this.drag === undefined || this.drag.pointerId !== event.pointerId) return;
        this.drag = undefined;
        releasePointer(this.element, event.pointerId);
    }

    private schedulePaint(): void {
        if (this.framePending) return;
        const window = this.element.ownerDocument.defaultView;
        if (window === null || typeof window.requestAnimationFrame !== "function") {
            this.paint();
            return;
        }
        this.framePending = true;
        window.requestAnimationFrame(() => {
            this.framePending = false;
            this.paint();
        });
    }

    private paint(): void {
        paintImage(this.element, renderMeshThumbnail(this.positions, this.cornerIndices, MESH_PREVIEW_SIZE_PX, this.currentView, "sphere"));
    }
}
