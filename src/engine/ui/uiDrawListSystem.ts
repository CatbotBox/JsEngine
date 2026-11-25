import {System} from "../core";
import {RenderingSystemGroup} from "../rendering/renderingSystemGroup";
import {TextColor} from "../rendering/textColor";
import {DEFAULT_FLEX_CONTAINER} from "./layout/flexLayout";
import {borderInsetOf} from "./layout/flexStyle";
import type {FlexContainerStyle} from "./layout/flexStyle";
import {glyphColumnsOf, lineColumns, textLines} from "./text/textColumns";
import {wrapTextLines} from "./text/wrapTextLines";
import {UiBox} from "./uiBox";
import {UiDrawList} from "./uiDrawList";
import {UiLayout} from "./uiLayout";
import {UiLayoutSystem} from "./uiLayoutSystem";
import {UI_DRAW_LIST_PRIORITY} from "./uiSystemPriorities";
import {UI_RECT_CLIP_BOTTOM, UI_RECT_CLIP_LEFT, UI_RECT_CLIP_RIGHT, UI_RECT_CLIP_TOP, UI_RECT_FLOATS, UI_RECT_HEIGHT, UI_RECT_WIDTH, UI_RECT_X, UI_RECT_Y, UiRect} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiText} from "./uiText";
import {NOT_IN_TREE, UiTreeIndex} from "./uiTreeIndex";

export const ELLIPSIS_CODE_POINT = 0x2026;

const NEVER_BUILT = -1;
const INCLUDE_DISABLED = true;
const HALF = 0.5;
const INSET_SIDES_PER_AXIS = 2;
const COLUMN_EPSILON_UNITS = 1e-4;
const INITIAL_CAPACITY_NODES = 16;
const CAPACITY_GROWTH_FACTOR = 2;
const SURROGATE_PAIR_MIN_CODE_POINT = 0x10000;
const SURROGATE_PAIR_LENGTH = 2;
const SINGLE_UNIT_LENGTH = 1;

const DRAWN_NODE_COMPONENTS = {
    box: UiBox,
    text: UiText,
    layout: UiLayout,
};

const STYLE_COMPONENTS = {
    box: UiBox,
    text: UiText,
};

function codeUnitLength(codePoint: number): number {
    return codePoint >= SURROGATE_PAIR_MIN_CODE_POINT ? SURROGATE_PAIR_LENGTH : SINGLE_UNIT_LENGTH;
}

function wholeColumnsIn(widthUnits: number): number {
    return Math.max(0, Math.floor(widthUnits + COLUMN_EPSILON_UNITS));
}

export class UiDrawListSystem extends System {
    private readonly _nodes = this.createEntityQuery([UiRect]);
    private readonly _roots = this.createEntityQuery([UiRoot, UiRect]);
    private _builtTreeVersion = NEVER_BUILT;
    private _builtStamp = 0;
    private _rects = new Float64Array(INITIAL_CAPACITY_NODES * UI_RECT_FLOATS);
    private readonly _boxes: (Readonly<UiBox> | undefined)[] = [];
    private readonly _texts: (Readonly<UiText> | undefined)[] = [];
    private readonly _layouts: (FlexContainerStyle | undefined)[] = [];

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return UI_DRAW_LIST_PRIORITY;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._roots);
        this.world.ensureSystemExists(UiLayoutSystem);
        this.world.resources.getOrCreate(UiDrawList);
    }

    onUpdate() {
        const index = this.world.resources.tryGet(UiTreeIndex);
        if (index === undefined || (index.version === this._builtTreeVersion && !this.stylesChanged())) return;
        const list = this.world.resources.getOrCreate(UiDrawList);
        this.gatherNodes(index);
        this.build(index, list);
        this._builtTreeVersion = index.version;
        this._builtStamp = this.world.changeStamps.advance();
    }

    private stylesChanged(): boolean {
        return this._nodes.stream({optional: STYLE_COMPONENTS}, {filterLastUpdated: this._builtStamp, includeDisabled: INCLUDE_DISABLED}).hasAny();
    }

    private gatherNodes(index: UiTreeIndex): void {
        const count = index.count;
        this.ensureCapacity(count);
        this._boxes.length = count;
        this._texts.length = count;
        this._layouts.length = count;
        this._boxes.fill(undefined);
        this._texts.fill(undefined);
        this._layouts.fill(undefined);
        const rects = this._rects;
        this._nodes.stream({read: {rect: UiRect}, optional: DRAWN_NODE_COMPONENTS}, {includeEntity: true}).consume(({entity, rect, box, text, layout}) => {
            const node = index.indexOf(entity);
            if (node === NOT_IN_TREE) return;
            const base = node * UI_RECT_FLOATS;
            rects[base + UI_RECT_X] = rect.x;
            rects[base + UI_RECT_Y] = rect.y;
            rects[base + UI_RECT_WIDTH] = rect.width;
            rects[base + UI_RECT_HEIGHT] = rect.height;
            rects[base + UI_RECT_CLIP_LEFT] = rect.clipLeft;
            rects[base + UI_RECT_CLIP_TOP] = rect.clipTop;
            rects[base + UI_RECT_CLIP_RIGHT] = rect.clipRight;
            rects[base + UI_RECT_CLIP_BOTTOM] = rect.clipBottom;
            this._boxes[node] = box;
            this._texts[node] = text;
            this._layouts[node] = layout;
        });
    }

    private build(index: UiTreeIndex, list: UiDrawList): void {
        list.clear();
        const roots = index.roots, scales = index.rootScales, subtreeEnd = index.subtreeEnd;
        for (let i = 0; i < roots.length; i++) {
            list.beginRoot(scales[i]);
            const root = roots[i];
            for (let node = root; node < subtreeEnd[root]; node++) this.emitNode(list, node);
        }
        list.finish();
    }

    private emitNode(list: UiDrawList, node: number): void {
        const rects = this._rects, base = node * UI_RECT_FLOATS;
        const x = rects[base + UI_RECT_X], y = rects[base + UI_RECT_Y];
        const width = rects[base + UI_RECT_WIDTH], height = rects[base + UI_RECT_HEIGHT];
        const clipLeft = rects[base + UI_RECT_CLIP_LEFT], clipTop = rects[base + UI_RECT_CLIP_TOP];
        const clipRight = rects[base + UI_RECT_CLIP_RIGHT], clipBottom = rects[base + UI_RECT_CLIP_BOTTOM];
        list.clipTo(clipLeft, clipTop, clipRight, clipBottom);
        const box = this._boxes[node];
        if (box !== undefined) {
            if (!TextColor.isDefault(box.background)) list.fillRect(x, y, width, height, box.background);
            if (box.border !== "none") list.border(x, y, width, height, box.border, box.borderColor);
        }
        const text = this._texts[node];
        if (text === undefined) return;
        const container = this._layouts[node] ?? DEFAULT_FLEX_CONTAINER;
        const inset = borderInsetOf(box);
        const left = x + container.paddingLeft + inset, top = y + container.paddingTop + inset;
        const contentWidth = Math.max(0, width - container.paddingLeft - container.paddingRight - INSET_SIDES_PER_AXIS * inset);
        const contentHeight = Math.max(0, height - container.paddingTop - container.paddingBottom - INSET_SIDES_PER_AXIS * inset);
        list.clipTo(Math.max(clipLeft, left), Math.max(clipTop, top), Math.min(clipRight, left + contentWidth), Math.min(clipBottom, top + contentHeight));
        this.emitText(list, text, left, top, contentWidth, contentHeight);
    }

    private emitText(list: UiDrawList, text: Readonly<UiText>, left: number, top: number, contentWidth: number, contentHeight: number): void {
        const lines = text.wrap === "word" ? wrapTextLines(text.text, contentWidth) : textLines(text.text);
        const maxColumns = wholeColumnsIn(contentWidth);
        for (let row = 0; row < lines.length && row < contentHeight; row++) {
            const line = lines[row];
            const columns = lineColumns(line);
            const visible = Math.min(columns, maxColumns);
            if (visible === 0) continue;
            const ellipsis = text.overflow === "ellipsis" && columns > maxColumns;
            const free = contentWidth - visible;
            const offset = text.alignX === "center" ? free * HALF : text.alignX === "end" ? free : 0;
            list.beginText(left + offset, top + row, text.foreground);
            this.addGlyphs(list, line, ellipsis ? visible - glyphColumnsOf(ELLIPSIS_CODE_POINT) : visible);
            if (ellipsis) list.addGlyph(ELLIPSIS_CODE_POINT, glyphColumnsOf(ELLIPSIS_CODE_POINT));
        }
    }

    private addGlyphs(list: UiDrawList, line: string, maxColumns: number): void {
        let used = 0;
        for (let i = 0; i < line.length;) {
            const codePoint = line.codePointAt(i)!;
            const columns = glyphColumnsOf(codePoint);
            if (used + columns > maxColumns) return;
            list.addGlyph(codePoint, columns);
            used += columns;
            i += codeUnitLength(codePoint);
        }
    }

    private ensureCapacity(count: number): void {
        const required = count * UI_RECT_FLOATS;
        if (required <= this._rects.length) return;
        let capacity = this._rects.length;
        while (capacity < required) capacity *= CAPACITY_GROWTH_FACTOR;
        this._rects = new Float64Array(capacity);
    }
}
