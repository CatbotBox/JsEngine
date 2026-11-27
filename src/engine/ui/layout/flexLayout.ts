import {AXES, AXIS_X, AXIS_Y, axisArrays, crossOf} from "./flexAxis";
import type {Axis, AxisArrays} from "./flexAxis";
import {FlexScrollbars} from "./flexScrollbars";
import {borderInsetOf} from "./flexStyle";
import type {FlexBoxStyle, FlexContainerStyle, FlexOffsetStyle, FlexScrollStyle, FlexSizeStyle, FlexTextContent, UiAlign, UiSizeMode} from "./flexStyle";
import {clampScrollOffset, maxScrollOffset, NO_SCROLLBAR_UNITS, SCROLLBAR_THICKNESS_UNITS, scrollbarReservation, scrollbarThumbLength, scrollbarThumbStart} from "./scrollbarGeometry";
import {measureTextExtent} from "../text/textColumns";
import {wrapTextLines} from "../text/wrapTextLines";

export interface FlexLayoutTree {
    readonly count: number;
    readonly subtreeEnd: Int32Array;
    readonly containers: readonly (FlexContainerStyle | undefined)[];
    readonly sizes: readonly (FlexSizeStyle | undefined)[];
    readonly offsets: readonly (FlexOffsetStyle | undefined)[];
    readonly texts: readonly (FlexTextContent | undefined)[];
    readonly scrolls: readonly (FlexScrollStyle | undefined)[];
    readonly boxes: readonly (FlexBoxStyle | undefined)[];
}

const HALF = 0.5;
const INITIAL_CAPACITY_NODES = 16;
const CAPACITY_GROWTH_FACTOR = 2;
const NOT_FROZEN = 0;
const FROZEN = 1;
const INSET_SIDES_PER_AXIS = 2;
const OVERFLOW_EPSILON_UNITS = 1e-6;
const IGNORE_OVERFLOW = false;
const RESERVE_ON_OVERFLOW = true;

export const DEFAULT_FLEX_CONTAINER: FlexContainerStyle = {
    direction: "column",
    paddingLeft: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    gap: 0,
    justify: "start",
    align: "stretch",
    clip: false,
};

export const DEFAULT_FLEX_SIZE: FlexSizeStyle = {
    widthMode: "fit",
    heightMode: "fit",
    width: 1,
    height: 1,
    minWidth: 0,
    maxWidth: Infinity,
    minHeight: 0,
    maxHeight: Infinity,
};

function mainAxisOf(container: FlexContainerStyle): Axis {
    return container.direction === "row" ? AXIS_X : AXIS_Y;
}

function modeOn(size: FlexSizeStyle, axis: Axis): UiSizeMode {
    return axis === AXIS_X ? size.widthMode : size.heightMode;
}

function valueOn(size: FlexSizeStyle, axis: Axis): number {
    return axis === AXIS_X ? size.width : size.height;
}

function clampOn(size: FlexSizeStyle, axis: Axis, value: number): number {
    const min = axis === AXIS_X ? size.minWidth : size.minHeight;
    const max = axis === AXIS_X ? size.maxWidth : size.maxHeight;
    return Math.max(min, Math.min(value, max));
}

function paddingStartOn(container: FlexContainerStyle, inset: number, axis: Axis): number {
    return (axis === AXIS_X ? container.paddingLeft : container.paddingTop) + inset;
}

function paddingEndOn(container: FlexContainerStyle, inset: number, axis: Axis): number {
    return (axis === AXIS_X ? container.paddingRight : container.paddingBottom) + inset;
}

function paddingOn(container: FlexContainerStyle, inset: number, axis: Axis): number {
    return paddingStartOn(container, inset, axis) + paddingEndOn(container, inset, axis);
}

function scrollsOn(scroll: FlexScrollStyle | undefined, axis: Axis): boolean {
    if (scroll === undefined) return false;
    return scroll.axes === "both" || scroll.axes === (axis === AXIS_X ? "horizontal" : "vertical");
}

function scrollOffsetOn(scroll: FlexScrollStyle, axis: Axis): number {
    return axis === AXIS_X ? scroll.scrollX : scroll.scrollY;
}

function alwaysReservedOn(scroll: FlexScrollStyle | undefined, axis: Axis): number {
    return scroll !== undefined && scrollsOn(scroll, crossOf(axis)) ? scrollbarReservation(scroll.scrollbar, IGNORE_OVERFLOW) : NO_SCROLLBAR_UNITS;
}

function anchorOn(offset: FlexOffsetStyle, axis: Axis): number {
    return axis === AXIS_X ? offset.anchorX : offset.anchorY;
}

function displacementOn(offset: FlexOffsetStyle, axis: Axis): number {
    return axis === AXIS_X ? offset.x : offset.y;
}

function alignedStart(align: UiAlign, freeSpace: number): number {
    const free = Math.max(0, freeSpace);
    if (align === "center") return free * HALF;
    if (align === "end") return free;
    return 0;
}

export class FlexLayout {
    private _capacity = 0;
    private _position: AxisArrays = axisArrays(0);
    private _extent: AxisArrays = axisArrays(0);
    private _clipStart: AxisArrays = axisArrays(0);
    private _clipEnd: AxisArrays = axisArrays(0);
    private _scroll: AxisArrays = axisArrays(0);
    private _content: AxisArrays = axisArrays(0);
    private _fit: AxisArrays = axisArrays(0);
    private _stack: AxisArrays = axisArrays(0);
    private _reserve: AxisArrays = axisArrays(0);
    private readonly _scrollbars = new FlexScrollbars();
    private readonly _inFlow: number[] = [];
    private readonly _outOfFlow: number[] = [];
    private readonly _fills: number[] = [];
    private readonly _fillTargets: number[] = [];
    private readonly _fillFrozen: number[] = [];
    private _availableMain = 0;
    private _availableCross = 0;

    public get x(): Float64Array {
        return this._position[AXIS_X];
    }

    public get y(): Float64Array {
        return this._position[AXIS_Y];
    }

    public get width(): Float64Array {
        return this._extent[AXIS_X];
    }

    public get height(): Float64Array {
        return this._extent[AXIS_Y];
    }

    public get clipLeft(): Float64Array {
        return this._clipStart[AXIS_X];
    }

    public get clipTop(): Float64Array {
        return this._clipStart[AXIS_Y];
    }

    public get clipRight(): Float64Array {
        return this._clipEnd[AXIS_X];
    }

    public get clipBottom(): Float64Array {
        return this._clipEnd[AXIS_Y];
    }

    public get scrollX(): Float64Array {
        return this._scroll[AXIS_X];
    }

    public get scrollY(): Float64Array {
        return this._scroll[AXIS_Y];
    }

    public get contentWidth(): Float64Array {
        return this._content[AXIS_X];
    }

    public get contentHeight(): Float64Array {
        return this._content[AXIS_Y];
    }

    public get scrollbars(): FlexScrollbars {
        return this._scrollbars;
    }

    public layout(tree: FlexLayoutTree, rootIndex: number, rootWidth: number, rootHeight: number): void {
        this.ensureCapacity(tree.count);
        const end = tree.subtreeEnd[rootIndex];
        for (let node = end - 1; node >= rootIndex; node--) this.measure(tree, node);
        for (const axis of AXES) {
            const extent = axis === AXIS_X ? rootWidth : rootHeight;
            this._position[axis][rootIndex] = 0;
            this._extent[axis][rootIndex] = extent;
            this._clipStart[axis][rootIndex] = 0;
            this._clipEnd[axis][rootIndex] = extent;
        }
        for (let node = rootIndex; node < end; node++) this.arrange(tree, node);
    }

    private ensureCapacity(count: number): void {
        if (count <= this._capacity) return;
        let capacity = Math.max(this._capacity, INITIAL_CAPACITY_NODES);
        while (capacity < count) capacity *= CAPACITY_GROWTH_FACTOR;
        this._capacity = capacity;
        this._position = axisArrays(capacity);
        this._extent = axisArrays(capacity);
        this._clipStart = axisArrays(capacity);
        this._clipEnd = axisArrays(capacity);
        this._scroll = axisArrays(capacity);
        this._content = axisArrays(capacity);
        this._fit = axisArrays(capacity);
        this._stack = axisArrays(capacity);
        this._reserve = axisArrays(capacity);
        this._scrollbars.allocate(capacity);
    }

    private measure(tree: FlexLayoutTree, node: number): void {
        const container = tree.containers[node] ?? DEFAULT_FLEX_CONTAINER;
        const size = tree.sizes[node] ?? DEFAULT_FLEX_SIZE;
        const inset = borderInsetOf(tree.boxes[node]);
        const main = mainAxisOf(container), cross = crossOf(main);
        const subtreeEnd = tree.subtreeEnd;
        let mainSum = 0, crossMax = 0, inFlow = 0;
        for (let child = node + 1; child < subtreeEnd[node]; child = subtreeEnd[child]) {
            if (tree.offsets[child] !== undefined) continue;
            mainSum += this._fit[main][child];
            crossMax = Math.max(crossMax, this._fit[cross][child]);
            inFlow++;
        }
        if (inFlow > 1) mainSum += container.gap * (inFlow - 1);
        this._stack[main][node] = mainSum;
        this._stack[cross][node] = crossMax;

        const scroll = tree.scrolls[node];
        const text = tree.texts[node];
        const textExtent = text === undefined ? undefined : measureTextExtent(text.text);
        for (const axis of AXES) {
            const textSize = textExtent === undefined ? 0 : axis === AXIS_X ? textExtent.columns : textExtent.lines;
            const inner = Math.max(this._stack[axis][node], textSize);
            const preferred = modeOn(size, axis) === "fixed" ? valueOn(size, axis) : inner + paddingOn(container, inset, axis) + alwaysReservedOn(scroll, axis);
            this._fit[axis][node] = clampOn(size, axis, preferred);
        }
    }

    private arrange(tree: FlexLayoutTree, node: number): void {
        const container = tree.containers[node] ?? DEFAULT_FLEX_CONTAINER;
        const scroll = tree.scrolls[node];
        const inset = borderInsetOf(tree.boxes[node]);
        const main = mainAxisOf(container);
        this.collectChildren(tree, node);
        this.reserveScrollbars(node, scroll, IGNORE_OVERFLOW);
        this.arrangeChildren(tree, node, container, inset, scroll, main);
        if (this.reserveScrollbars(node, scroll, RESERVE_ON_OVERFLOW)) this.arrangeChildren(tree, node, container, inset, scroll, main);
        this.scrollChildren(node, scroll);
        this.placeScrollbars(node, inset, scroll);
        this.clipChildren(node, inset, container.clip || scroll !== undefined);
    }

    private arrangeChildren(tree: FlexLayoutTree, node: number, container: FlexContainerStyle, inset: number, scroll: FlexScrollStyle | undefined, main: Axis): void {
        this.sizeChildren(tree, node, container, inset, scroll, main);
        if (this.rewrapChildren(tree)) this.sizeChildren(tree, node, container, inset, scroll, main);
        this.placeChildren(tree, node, container, inset, main);
        this.measureContent(node, container, inset, scroll);
    }

    private reserveScrollbars(node: number, scroll: FlexScrollStyle | undefined, onOverflow: boolean): boolean {
        let changed = false;
        for (const axis of AXES) {
            const overflows = onOverflow && this._content[axis][node] > this._extent[axis][node] + OVERFLOW_EPSILON_UNITS;
            const reserved = scroll !== undefined && scrollsOn(scroll, axis) ? scrollbarReservation(scroll.scrollbar, overflows) : NO_SCROLLBAR_UNITS;
            const reserve = this._reserve[crossOf(axis)];
            if (reserve[node] !== reserved) changed = true;
            reserve[node] = reserved;
        }
        return changed;
    }

    private collectChildren(tree: FlexLayoutTree, node: number): void {
        const inFlow = this._inFlow, outOfFlow = this._outOfFlow, subtreeEnd = tree.subtreeEnd;
        inFlow.length = 0;
        outOfFlow.length = 0;
        for (let child = node + 1; child < subtreeEnd[node]; child = subtreeEnd[child]) {
            if (tree.offsets[child] === undefined) inFlow.push(child);
            else outOfFlow.push(child);
        }
    }

    private innerExtent(node: number, container: FlexContainerStyle, inset: number, axis: Axis): number {
        return Math.max(0, this._extent[axis][node] - paddingOn(container, inset, axis) - this._reserve[axis][node]);
    }

    private sizeChildren(tree: FlexLayoutTree, node: number, container: FlexContainerStyle, inset: number, scroll: FlexScrollStyle | undefined, main: Axis): void {
        const cross = crossOf(main);
        const inFlow = this._inFlow;
        const fit = this._fit, extent = this._extent;
        let fixedSum = 0, fillFitSum = 0, crossFitMax = 0;
        for (const child of inFlow) {
            const size = tree.sizes[child] ?? DEFAULT_FLEX_SIZE;
            if (modeOn(size, main) === "fill") fillFitSum += fit[main][child];
            else fixedSum += fit[main][child];
            extent[main][child] = fit[main][child];
            crossFitMax = Math.max(crossFitMax, fit[cross][child]);
        }
        const gaps = inFlow.length > 1 ? container.gap * (inFlow.length - 1) : 0;
        let availableMain = this.innerExtent(node, container, inset, main);
        if (scrollsOn(scroll, main)) availableMain = Math.max(availableMain, fixedSum + fillFitSum + gaps);
        let availableCross = this.innerExtent(node, container, inset, cross);
        if (scrollsOn(scroll, cross)) availableCross = Math.max(availableCross, crossFitMax);
        this._availableMain = availableMain;
        this._availableCross = availableCross;

        this.shareFill(tree, main, availableMain - fixedSum - gaps);
        for (const child of inFlow) {
            const size = tree.sizes[child] ?? DEFAULT_FLEX_SIZE;
            const mode = modeOn(size, cross);
            const stretched = mode === "fill" || (mode === "fit" && container.align === "stretch");
            extent[cross][child] = stretched ? clampOn(size, cross, availableCross) : fit[cross][child];
        }
        for (const child of this._outOfFlow) {
            const size = tree.sizes[child] ?? DEFAULT_FLEX_SIZE;
            for (const axis of AXES) {
                extent[axis][child] = modeOn(size, axis) === "fill" ? clampOn(size, axis, this.innerExtent(node, container, inset, axis)) : fit[axis][child];
            }
        }
    }

    private shareFill(tree: FlexLayoutTree, main: Axis, freeSpace: number): void {
        const fills = this._fills, targets = this._fillTargets, frozen = this._fillFrozen;
        const extent = this._extent[main];
        fills.length = 0;
        for (const child of this._inFlow) {
            if (modeOn(tree.sizes[child] ?? DEFAULT_FLEX_SIZE, main) === "fill") fills.push(child);
        }
        targets.length = fills.length;
        frozen.length = fills.length;
        frozen.fill(NOT_FROZEN);
        for (; ;) {
            let weightSum = 0, frozenSum = 0, unfrozen = 0;
            for (let k = 0; k < fills.length; k++) {
                if (frozen[k] === FROZEN) frozenSum += extent[fills[k]];
                else {
                    weightSum += Math.max(0, valueOn(tree.sizes[fills[k]]!, main));
                    unfrozen++;
                }
            }
            if (unfrozen === 0) return;
            const space = Math.max(0, freeSpace - frozenSum);
            let violation = 0;
            for (let k = 0; k < fills.length; k++) {
                if (frozen[k] === FROZEN) continue;
                const size = tree.sizes[fills[k]]!;
                const target = weightSum > 0 ? space * Math.max(0, valueOn(size, main)) / weightSum : 0;
                const clamped = clampOn(size, main, target);
                targets[k] = target;
                extent[fills[k]] = clamped;
                violation += clamped - target;
            }
            if (violation === 0) return;
            let froze = false;
            for (let k = 0; k < fills.length; k++) {
                if (frozen[k] === FROZEN) continue;
                const clamped = extent[fills[k]];
                const violates = violation > 0 ? clamped > targets[k] : clamped < targets[k];
                if (!violates) continue;
                frozen[k] = FROZEN;
                froze = true;
            }
            if (!froze) return;
        }
    }

    private rewrapChildren(tree: FlexLayoutTree): boolean {
        const inFlowChanged = this.rewrapAll(tree, this._inFlow);
        const outOfFlowChanged = this.rewrapAll(tree, this._outOfFlow);
        return inFlowChanged || outOfFlowChanged;
    }

    private rewrapAll(tree: FlexLayoutTree, children: readonly number[]): boolean {
        let changed = false;
        for (const child of children) {
            const text = tree.texts[child];
            const size = tree.sizes[child] ?? DEFAULT_FLEX_SIZE;
            if (text === undefined || text.wrap !== "word" || size.heightMode !== "fit") continue;
            const container = tree.containers[child] ?? DEFAULT_FLEX_CONTAINER;
            const inset = borderInsetOf(tree.boxes[child]);
            const scroll = tree.scrolls[child];
            const textWidth = this._extent[AXIS_X][child] - paddingOn(container, inset, AXIS_X) - alwaysReservedOn(scroll, AXIS_X);
            const lines = wrapTextLines(text.text, textWidth).length;
            const inner = Math.max(this._stack[AXIS_Y][child], lines);
            const wrapped = clampOn(size, AXIS_Y, inner + paddingOn(container, inset, AXIS_Y) + alwaysReservedOn(scroll, AXIS_Y));
            if (wrapped === this._fit[AXIS_Y][child]) continue;
            this._fit[AXIS_Y][child] = wrapped;
            changed = true;
        }
        return changed;
    }

    private placeChildren(tree: FlexLayoutTree, node: number, container: FlexContainerStyle, inset: number, main: Axis): void {
        const cross = crossOf(main);
        const inFlow = this._inFlow;
        const position = this._position, extent = this._extent;
        let used = 0;
        for (const child of inFlow) used += extent[main][child];
        const gaps = inFlow.length > 1 ? container.gap * (inFlow.length - 1) : 0;
        const leftover = Math.max(0, this._availableMain - used - gaps);
        let cursor = position[main][node] + paddingStartOn(container, inset, main);
        let spacing = container.gap;
        if (container.justify === "center") cursor += leftover * HALF;
        else if (container.justify === "end") cursor += leftover;
        else if (container.justify === "spaceBetween" && inFlow.length > 1) spacing += leftover / (inFlow.length - 1);

        const crossOrigin = position[cross][node] + paddingStartOn(container, inset, cross);
        for (const child of inFlow) {
            position[main][child] = cursor;
            cursor += extent[main][child] + spacing;
            position[cross][child] = crossOrigin + alignedStart(container.align, this._availableCross - extent[cross][child]);
        }
        for (const child of this._outOfFlow) {
            const offset = tree.offsets[child]!;
            for (const axis of AXES) {
                const free = this.innerExtent(node, container, inset, axis) - extent[axis][child];
                position[axis][child] = position[axis][node] + paddingStartOn(container, inset, axis) + anchorOn(offset, axis) * free + displacementOn(offset, axis);
            }
        }
    }

    private measureContent(node: number, container: FlexContainerStyle, inset: number, scroll: FlexScrollStyle | undefined): void {
        for (const axis of AXES) {
            const position = this._position[axis], extent = this._extent[axis];
            if (scroll === undefined) {
                this._content[axis][node] = extent[node];
                continue;
            }
            const origin = position[node];
            let far = origin + paddingStartOn(container, inset, axis);
            for (const child of this._inFlow) far = Math.max(far, position[child] + extent[child]);
            for (const child of this._outOfFlow) far = Math.max(far, position[child] + extent[child]);
            this._content[axis][node] = far - origin + paddingEndOn(container, inset, axis) + this._reserve[axis][node];
        }
    }

    private scrollChildren(node: number, scroll: FlexScrollStyle | undefined): void {
        for (const axis of AXES) {
            const position = this._position[axis];
            const maxScroll = scroll !== undefined && scrollsOn(scroll, axis) ? maxScrollOffset(this._content[axis][node], this._extent[axis][node]) : 0;
            const offset = scroll === undefined ? 0 : clampScrollOffset(scrollOffsetOn(scroll, axis), maxScroll);
            this._scroll[axis][node] = offset;
            if (offset === 0) continue;
            for (const child of this._inFlow) position[child] -= offset;
            for (const child of this._outOfFlow) position[child] -= offset;
        }
    }

    private placeScrollbars(node: number, inset: number, scroll: FlexScrollStyle | undefined): void {
        for (const axis of AXES) {
            const cross = crossOf(axis);
            if (scroll === undefined || this._reserve[cross][node] === NO_SCROLLBAR_UNITS) {
                this._scrollbars.hide(axis, node);
                continue;
            }
            const extent = this._extent[axis][node], content = this._content[axis][node];
            const trackStart = this._position[axis][node] + inset;
            const trackLength = Math.max(0, extent - INSET_SIDES_PER_AXIS * inset - this._reserve[axis][node]);
            const trackCross = this._position[cross][node] + this._extent[cross][node] - inset - SCROLLBAR_THICKNESS_UNITS;
            const thumbLength = scrollbarThumbLength(trackLength, extent, content);
            const thumbStart = scrollbarThumbStart(trackStart, trackLength, thumbLength, this._scroll[axis][node], maxScrollOffset(content, extent));
            this._scrollbars.place(axis, node, trackStart, trackCross, trackLength, thumbStart, thumbLength);
        }
    }

    private clipChildren(node: number, inset: number, clips: boolean): void {
        for (const axis of AXES) {
            const clipStart = this._clipStart[axis], clipEnd = this._clipEnd[axis];
            let start = clipStart[node], end = clipEnd[node];
            if (clips) {
                const position = this._position[axis][node];
                start = Math.max(start, position + inset);
                end = Math.max(start, Math.min(end, position + this._extent[axis][node] - inset - this._reserve[axis][node]));
            }
            for (const child of this._inFlow) {
                clipStart[child] = start;
                clipEnd[child] = end;
            }
            for (const child of this._outOfFlow) {
                clipStart[child] = start;
                clipEnd[child] = end;
            }
        }
    }
}
