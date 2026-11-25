import {uiBoxDrawsInAnyState} from "./uiBox";
import type {UiBox} from "./uiBox";
import type {UiInteractable} from "./uiInteractable";
import {UI_RECT_CLIP_BOTTOM, UI_RECT_CLIP_LEFT, UI_RECT_CLIP_RIGHT, UI_RECT_CLIP_TOP, UI_RECT_FLOATS, UI_RECT_HEIGHT, UI_RECT_WIDTH, UI_RECT_X, UI_RECT_Y} from "./uiRect";
import type {UiRect} from "./uiRect";
import type {UiRoot} from "./uiRoot";
import type {UiScaleSnapping} from "./uiScaleSnapping";
import type {UiScroll} from "./uiScroll";
import {snappedUiEdge} from "./uiSnapping";
import type {UiText} from "./uiText";
import {NO_PARENT_INDEX} from "./uiTreeIndex";
import type {UiTreeIndex} from "./uiTreeIndex";

export const NO_HIT = -1;

export const NO_POINTER_FLAGS = 0;
export const POINTER_NODE_PRESENT = 1;
export const POINTER_NODE_HITTABLE = 2;
export const POINTER_NODE_INTERACTIVE = 4;
export const POINTER_NODE_DISABLED = 8;
export const POINTER_NODE_HOVERABLE = 16;
export const POINTER_NODE_DECLARES_PRESS = 32;
export const POINTER_NODE_DECLARES_CLICK = 64;
export const POINTER_NODE_DECLARES_DRAG = 128;
export const POINTER_NODE_DECLARES_WHEEL = 256;
export const POINTER_NODE_BLOCKS_GAME_INPUT = 512;
export const POINTER_NODE_ACCEPTS_PRESS = 160;

const INITIAL_CAPACITY_NODES = 16;
const CAPACITY_GROWTH_FACTOR = 2;
const DEVICE_POSITION_EPSILON = 1e-6;

export interface PointerNodeComponents {
    readonly interactable: Readonly<UiInteractable> | undefined;
    readonly scroll: Readonly<UiScroll> | undefined;
    readonly box: Readonly<UiBox> | undefined;
    readonly text: Readonly<UiText> | undefined;
    readonly root: Readonly<UiRoot> | undefined;
}

function flagIf(condition: boolean, flag: number): number {
    return condition ? flag : NO_POINTER_FLAGS;
}

export function pointerFlagsOf({interactable, scroll, box, text, root}: PointerNodeComponents): number {
    const interactive = interactable !== undefined || scroll !== undefined;
    const draws = (box !== undefined && uiBoxDrawsInAnyState(box)) || (text !== undefined && text.text.length > 0);
    let flags = POINTER_NODE_PRESENT | flagIf(interactive || draws, POINTER_NODE_HITTABLE) | flagIf(interactive, POINTER_NODE_INTERACTIVE);
    flags |= flagIf(root?.blocksGameInput === true, POINTER_NODE_BLOCKS_GAME_INPUT) | flagIf(scroll !== undefined, POINTER_NODE_DECLARES_WHEEL);
    if (interactable === undefined) return flags;
    flags |= flagIf(interactable.press, POINTER_NODE_DECLARES_PRESS) | flagIf(interactable.click, POINTER_NODE_DECLARES_CLICK);
    flags |= flagIf(interactable.drag, POINTER_NODE_DECLARES_DRAG) | flagIf(interactable.wheel, POINTER_NODE_DECLARES_WHEEL);
    return flags | (interactable.disabled ? POINTER_NODE_DISABLED : POINTER_NODE_HOVERABLE);
}

function devicePosition(uiUnits: number, deviceUnitsPerUiUnit: number): number {
    return Math.floor(uiUnits * deviceUnitsPerUiUnit + DEVICE_POSITION_EPSILON);
}

export class UiPointerNodes {
    private _count = 0;
    private _flags = new Uint16Array(INITIAL_CAPACITY_NODES);
    private _rects = new Float64Array(INITIAL_CAPACITY_NODES * UI_RECT_FLOATS);
    private _hitRoot = NO_HIT;

    public get count(): number {
        return this._count;
    }

    public get flags(): Uint16Array {
        return this._flags;
    }

    public get hitRoot(): number {
        return this._hitRoot;
    }

    public reset(count: number): void {
        this.ensureCapacity(count);
        this._count = count;
        this._flags.fill(NO_POINTER_FLAGS, 0, count);
    }

    public setNode(node: number, rect: Readonly<UiRect>, flags: number): void {
        const rects = this._rects, base = node * UI_RECT_FLOATS;
        rects[base + UI_RECT_X] = rect.x;
        rects[base + UI_RECT_Y] = rect.y;
        rects[base + UI_RECT_WIDTH] = rect.width;
        rects[base + UI_RECT_HEIGHT] = rect.height;
        rects[base + UI_RECT_CLIP_LEFT] = rect.clipLeft;
        rects[base + UI_RECT_CLIP_TOP] = rect.clipTop;
        rects[base + UI_RECT_CLIP_RIGHT] = rect.clipRight;
        rects[base + UI_RECT_CLIP_BOTTOM] = rect.clipBottom;
        this._flags[node] = flags;
    }

    public hitTest(tree: UiTreeIndex, snapping: UiScaleSnapping, screenX: number, screenY: number): number {
        const roots = tree.roots, scales = tree.rootScales, subtreeEnd = tree.subtreeEnd, flags = this._flags;
        const lastNode = this._count - 1;
        for (let slot = roots.length - 1; slot >= 0; slot--) {
            const root = roots[slot], scale = scales[slot];
            const unitX = snapping.deviceUnitsPerUiUnitX(scale), unitY = snapping.deviceUnitsPerUiUnitY(scale);
            const deviceX = devicePosition(screenX / scale, unitX), deviceY = devicePosition(screenY / scale, unitY);
            for (let node = Math.min(subtreeEnd[root] - 1, lastNode); node >= root; node--) {
                if ((flags[node] & POINTER_NODE_HITTABLE) === NO_POINTER_FLAGS) continue;
                if (!this.covers(node, deviceX, deviceY, unitX, unitY)) continue;
                this._hitRoot = slot;
                return node;
            }
        }
        this._hitRoot = NO_HIT;
        return NO_HIT;
    }

    public acceptor(tree: UiTreeIndex, origin: number, declared: number): number {
        if (origin === NO_HIT) return NO_HIT;
        const parentIndex = tree.parentIndex, flags = this._flags;
        for (let node = origin; node !== NO_PARENT_INDEX; node = parentIndex[node]) {
            const nodeFlags = flags[node];
            if ((nodeFlags & POINTER_NODE_PRESENT) === NO_POINTER_FLAGS || (nodeFlags & declared) === NO_POINTER_FLAGS) continue;
            return (nodeFlags & POINTER_NODE_DISABLED) === NO_POINTER_FLAGS ? node : NO_HIT;
        }
        return NO_HIT;
    }

    private covers(node: number, deviceX: number, deviceY: number, unitX: number, unitY: number): boolean {
        const rects = this._rects, base = node * UI_RECT_FLOATS;
        const x = rects[base + UI_RECT_X], y = rects[base + UI_RECT_Y];
        const left = Math.max(snappedUiEdge(x, unitX), snappedUiEdge(rects[base + UI_RECT_CLIP_LEFT], unitX));
        const right = Math.min(snappedUiEdge(x + rects[base + UI_RECT_WIDTH], unitX), snappedUiEdge(rects[base + UI_RECT_CLIP_RIGHT], unitX));
        if (deviceX < left || deviceX >= right) return false;
        const top = Math.max(snappedUiEdge(y, unitY), snappedUiEdge(rects[base + UI_RECT_CLIP_TOP], unitY));
        const bottom = Math.min(snappedUiEdge(y + rects[base + UI_RECT_HEIGHT], unitY), snappedUiEdge(rects[base + UI_RECT_CLIP_BOTTOM], unitY));
        return deviceY >= top && deviceY < bottom;
    }

    private ensureCapacity(count: number): void {
        if (count <= this._flags.length) return;
        let capacity = this._flags.length;
        while (capacity < count) capacity *= CAPACITY_GROWTH_FACTOR;
        this._flags = new Uint16Array(capacity);
        this._rects = new Float64Array(capacity * UI_RECT_FLOATS);
    }
}
