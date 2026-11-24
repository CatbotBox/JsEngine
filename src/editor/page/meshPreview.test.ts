import {describe, expect, test} from "../../engine/testing/harness";
import {
    MAX_ORBIT_PITCH_RADIANS,
    MESH_PREVIEW_SIZE_PX,
    meshFacts,
    MeshOrbitPreview,
    MIN_ORBIT_PITCH_RADIANS,
    ORBIT_RADIANS_PER_PIXEL,
    orbitedView,
} from "./meshPreview";
import {DEFAULT_MESH_VIEW, parseObjBytes} from "./projectThumbnails";

const CUBE_OBJ = [
    "v -1 -1 -1", "v 1 -1 -1", "v 1 1 -1", "v -1 1 -1", "v -1 -1 1", "v 1 -1 1", "v 1 1 1", "v -1 1 1",
    "f 1 2 3 4", "f 5 8 7 6", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 5 1 4 8",
].join("\n");
const POINTER_ID = 7;
const OTHER_POINTER_ID = 8;
const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;
const DRAG_PIXELS = 40;
const FAR_PIXELS = 10_000;

type Listener = (event: Partial<PointerEvent>) => void;

interface FakeCanvas {
    className: string;
    title: string;
    width: number;
    height: number;
    paints: number;
    readonly captured: Set<number>;
    readonly listeners: Map<string, Listener>;
    readonly ownerDocument: {readonly defaultView: {requestAnimationFrame?: (callback: () => void) => number} | null};
}

function fakeDocument(defaultView: FakeCanvas["ownerDocument"]["defaultView"]): {document: Document, canvases: FakeCanvas[]} {
    const canvases: FakeCanvas[] = [];
    const ownerDocument = {defaultView};
    const createElement = (): FakeCanvas => {
        const canvas: FakeCanvas & Record<string, unknown> = {
            className: "",
            title: "",
            width: 0,
            height: 0,
            paints: 0,
            captured: new Set(),
            listeners: new Map(),
            ownerDocument,
            addEventListener: (type: string, listener: Listener) => void canvas.listeners.set(type, listener),
            setPointerCapture: (pointerId: number) => void canvas.captured.add(pointerId),
            hasPointerCapture: (pointerId: number) => canvas.captured.has(pointerId),
            releasePointerCapture: (pointerId: number) => void canvas.captured.delete(pointerId),
            getContext: () => ({
                createImageData: (width: number, height: number) => ({data: new Uint8ClampedArray(width * height * 4)}),
                putImageData: () => void canvas.paints++,
            }),
        };
        canvases.push(canvas);
        return canvas;
    };
    return {document: {createElement} as unknown as Document, canvases};
}

function pointer(canvas: FakeCanvas, type: string, clientX: number, clientY: number, pointerId = POINTER_ID, button = PRIMARY_BUTTON): void {
    canvas.listeners.get(type)?.({pointerId, button, clientX, clientY, preventDefault: () => undefined});
}

function cubePreview(defaultView: FakeCanvas["ownerDocument"]["defaultView"] = null): {preview: MeshOrbitPreview, canvas: FakeCanvas} {
    const cube = parseObjBytes(new TextEncoder().encode(CUBE_OBJ));
    const {document, canvases} = fakeDocument(defaultView);
    const preview = new MeshOrbitPreview(document, cube.vertices.raw, cube.triangles.raw);
    return {preview, canvas: canvases[0]};
}

describe("mesh preview orbit", () => {
    test("dragging right turns the yaw and dragging down tilts the pitch, which stops at its limits", () => {
        const turned = orbitedView(DEFAULT_MESH_VIEW, DRAG_PIXELS, DRAG_PIXELS);
        expect(turned.yawRadians).toBeCloseTo(DEFAULT_MESH_VIEW.yawRadians + DRAG_PIXELS * ORBIT_RADIANS_PER_PIXEL);
        expect(turned.pitchRadians).toBeCloseTo(DEFAULT_MESH_VIEW.pitchRadians + DRAG_PIXELS * ORBIT_RADIANS_PER_PIXEL);
        expect(orbitedView(DEFAULT_MESH_VIEW, 0, FAR_PIXELS).pitchRadians).toBe(MAX_ORBIT_PITCH_RADIANS);
        expect(orbitedView(DEFAULT_MESH_VIEW, 0, -FAR_PIXELS).pitchRadians).toBe(MIN_ORBIT_PITCH_RADIANS);
    });

    test("the facts count vertices and triangles and give the bounds' size", () => {
        const cube = parseObjBytes(new TextEncoder().encode(CUBE_OBJ));
        const facts = new Map(meshFacts(cube));
        expect(facts.get("Vertices")).toBe(String(cube.vertCount));
        expect(facts.get("Triangles")).toBe("12");
        expect(facts.get("Bounds")).toBe("2 × 2 × 2");
    });

    test("the canvas paints the mesh once, then again as a captured primary-button drag orbits it", () => {
        const {preview, canvas} = cubePreview();
        expect([canvas.width, canvas.height, canvas.paints]).toEqual([MESH_PREVIEW_SIZE_PX, MESH_PREVIEW_SIZE_PX, 1]);
        pointer(canvas, "pointerdown", 0, 0, POINTER_ID, SECONDARY_BUTTON);
        pointer(canvas, "pointermove", DRAG_PIXELS, 0);
        expect([preview.view, canvas.paints]).toEqual([DEFAULT_MESH_VIEW, 1]);
        pointer(canvas, "pointerdown", 0, 0);
        expect(canvas.captured.has(POINTER_ID)).toBe(true);
        pointer(canvas, "pointermove", DRAG_PIXELS, 0, OTHER_POINTER_ID);
        expect(canvas.paints).toBe(1);
        pointer(canvas, "pointermove", DRAG_PIXELS, 0);
        expect(preview.view.yawRadians).toBeCloseTo(DEFAULT_MESH_VIEW.yawRadians + DRAG_PIXELS * ORBIT_RADIANS_PER_PIXEL);
        expect(canvas.paints).toBe(2);
        pointer(canvas, "pointerup", DRAG_PIXELS, 0);
        expect(canvas.captured.has(POINTER_ID)).toBe(false);
        pointer(canvas, "pointermove", 2 * DRAG_PIXELS, 0);
        expect(canvas.paints).toBe(2);
    });

    test("moves within one animation frame repaint once", () => {
        const frames: (() => void)[] = [];
        const {preview, canvas} = cubePreview({requestAnimationFrame: callback => frames.push(callback)});
        pointer(canvas, "pointerdown", 0, 0);
        pointer(canvas, "pointermove", DRAG_PIXELS, 0);
        pointer(canvas, "pointermove", DRAG_PIXELS, DRAG_PIXELS);
        expect([frames.length, canvas.paints]).toEqual([1, 1]);
        frames.splice(0)[0]();
        expect(canvas.paints).toBe(2);
        expect(preview.view.pitchRadians).toBeCloseTo(DEFAULT_MESH_VIEW.pitchRadians + DRAG_PIXELS * ORBIT_RADIANS_PER_PIXEL);
    });
});
