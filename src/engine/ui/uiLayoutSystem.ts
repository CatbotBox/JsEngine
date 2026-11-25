import {getEntityCreationOrder, System, Unchanged} from "../core";
import type {Entity} from "../core";
import {Camera} from "../rendering/camera";
import {RenderingSystemGroup} from "../rendering/renderingSystemGroup";
import {ScreenSize} from "../rendering/screenSize";
import {Children} from "../translation/children";
import {HierarchySyncSystem} from "../translation/hierarchySyncSystem";
import {Parent} from "../translation/parent";
import {FlexLayout} from "./layout/flexLayout";
import type {FlexLayoutTree} from "./layout/flexLayout";
import type {FlexBoxStyle, FlexContainerStyle, FlexOffsetStyle, FlexScrollStyle, FlexSizeStyle, FlexTextContent} from "./layout/flexStyle";
import {UiBox} from "./uiBox";
import {UiLayout} from "./uiLayout";
import {UiOffset} from "./uiOffset";
import {
    UI_RECT_CLIP_BOTTOM,
    UI_RECT_CLIP_LEFT,
    UI_RECT_CLIP_RIGHT,
    UI_RECT_CLIP_TOP,
    UI_RECT_FLOATS,
    UI_RECT_HEIGHT,
    UI_RECT_WIDTH,
    UI_RECT_X,
    UI_RECT_Y,
    UiRect,
} from "./uiRect";
import {UiRoot} from "./uiRoot";
import {UiScaleSnapping} from "./uiScaleSnapping";
import {UI_LAYOUT_PRIORITY} from "./uiSystemPriorities";
import {UiScroll} from "./uiScroll";
import {UiSize} from "./uiSize";
import {UiText} from "./uiText";
import {NOT_IN_TREE, UiTreeIndex} from "./uiTreeIndex";

const INCLUDE_DISABLED = true;
const NEVER_LAID_OUT = -1;
const NO_SNAPPING_VERSION = -1;
const UNKNOWN_CREATION_ORDER = 0;

const WATCHED_NODE_COMPONENTS = {
    root: UiRoot,
    layout: UiLayout,
    size: UiSize,
    offset: UiOffset,
    text: UiText,
    scroll: UiScroll,
    box: UiBox,
    children: Children,
    parent: Parent,
};

interface RootOrder {
    readonly slot: number;
    readonly sortOrder: number;
    readonly creationOrder: number;
}

function compareRoots(a: RootOrder, b: RootOrder): number {
    return a.sortOrder - b.sortOrder || a.creationOrder - b.creationOrder;
}

function storeIfChanged(column: Float32Array, offset: number, value: number): boolean {
    const stored = Math.fround(value);
    if (column[offset] === stored) return false;
    column[offset] = stored;
    return true;
}

function storeLaidOutRect(column: Float32Array, base: number, layout: FlexLayout, node: number): boolean {
    let changed = storeIfChanged(column, base + UI_RECT_X, layout.x[node]);
    changed = storeIfChanged(column, base + UI_RECT_Y, layout.y[node]) || changed;
    changed = storeIfChanged(column, base + UI_RECT_WIDTH, layout.width[node]) || changed;
    changed = storeIfChanged(column, base + UI_RECT_HEIGHT, layout.height[node]) || changed;
    changed = storeIfChanged(column, base + UI_RECT_CLIP_LEFT, layout.clipLeft[node]) || changed;
    changed = storeIfChanged(column, base + UI_RECT_CLIP_TOP, layout.clipTop[node]) || changed;
    changed = storeIfChanged(column, base + UI_RECT_CLIP_RIGHT, layout.clipRight[node]) || changed;
    return storeIfChanged(column, base + UI_RECT_CLIP_BOTTOM, layout.clipBottom[node]) || changed;
}

function storeEmptyRect(column: Float32Array, base: number): boolean {
    let changed = false;
    for (let offset = base; offset < base + UI_RECT_FLOATS; offset++) {
        if (storeIfChanged(column, offset, 0)) changed = true;
    }
    return changed;
}

export class UiLayoutSystem extends System {
    private readonly _nodes = this.createEntityQuery([UiRect]);
    private readonly _roots = this.createEntityQuery([UiRoot, UiRect]);
    private readonly _scrolls = this.createEntityQuery([UiScroll, UiRect]);
    private readonly _cameras = this.createEntityQuery([Camera, ScreenSize]);
    private readonly _flexLayout = new FlexLayout();
    private _laidOutStamp = 0;
    private _laidOutNodeCount = NEVER_LAID_OUT;
    private _laidOutSnappingVersion = NO_SNAPPING_VERSION;

    private readonly _slotOfEntity = new Map<Entity, number>();
    private readonly _slotEntities: Entity[] = [];
    private readonly _slotChildren: (readonly Entity[] | undefined)[] = [];
    private readonly _slotRoots: (Readonly<UiRoot> | undefined)[] = [];
    private readonly _slotContainers: (FlexContainerStyle | undefined)[] = [];
    private readonly _slotSizes: (FlexSizeStyle | undefined)[] = [];
    private readonly _slotOffsets: (FlexOffsetStyle | undefined)[] = [];
    private readonly _slotTexts: (FlexTextContent | undefined)[] = [];
    private readonly _slotScrolls: (FlexScrollStyle | undefined)[] = [];
    private readonly _slotBoxes: (FlexBoxStyle | undefined)[] = [];
    private readonly _rootOrder: RootOrder[] = [];

    private readonly _containers: (FlexContainerStyle | undefined)[] = [];
    private readonly _sizes: (FlexSizeStyle | undefined)[] = [];
    private readonly _offsets: (FlexOffsetStyle | undefined)[] = [];
    private readonly _texts: (FlexTextContent | undefined)[] = [];
    private readonly _scrollStyles: (FlexScrollStyle | undefined)[] = [];
    private readonly _boxes: (FlexBoxStyle | undefined)[] = [];
    private readonly _stackSlots: number[] = [];
    private readonly _stackParents: number[] = [];

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return UI_LAYOUT_PRIORITY;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._roots);
        this.world.ensureSystemExists(HierarchySyncSystem);
        this.world.resources.getOrCreate(UiTreeIndex);
        this.world.resources.getOrCreate(UiScaleSnapping);
    }

    onUpdate() {
        const camera = this._cameras.tryGetSingleton({screenSize: ScreenSize});
        const snapping = this.world.resources.getOrCreate(UiScaleSnapping);
        if (camera === undefined || !this.layoutInputsChanged(snapping)) return;
        const index = this.world.resources.getOrCreate(UiTreeIndex);
        this.gatherNodes();
        this.buildTree(index, snapping);
        this.layoutRoots(index, camera.screenSize.x, camera.screenSize.y);
        this.writeRects(index);
        this.writeScrolls(index);
        this._laidOutNodeCount = this._nodes.entityCountIncludingDisabled();
        this._laidOutSnappingVersion = snapping.version;
        this._laidOutStamp = this.world.changeStamps.advance();
    }

    private layoutInputsChanged(snapping: UiScaleSnapping): boolean {
        if (snapping.version !== this._laidOutSnappingVersion) return true;
        if (this._nodes.entityCountIncludingDisabled() !== this._laidOutNodeCount) return true;
        const options = {filterLastUpdated: this._laidOutStamp, includeDisabled: INCLUDE_DISABLED};
        return this._nodes.stream({optional: WATCHED_NODE_COMPONENTS}, options).hasAny()
            || this._cameras.stream({read: {screenSize: ScreenSize}}, options).hasAny();
    }

    private gatherNodes(): void {
        this._slotOfEntity.clear();
        this._slotEntities.length = 0;
        this._slotChildren.length = 0;
        this._slotRoots.length = 0;
        this._slotContainers.length = 0;
        this._slotSizes.length = 0;
        this._slotOffsets.length = 0;
        this._slotTexts.length = 0;
        this._slotScrolls.length = 0;
        this._slotBoxes.length = 0;
        this._nodes.stream({optional: WATCHED_NODE_COMPONENTS}, {includeEntity: true}).consume(row => {
            this._slotOfEntity.set(row.entity, this._slotEntities.length);
            this._slotEntities.push(row.entity);
            this._slotChildren.push(row.children?.children);
            this._slotRoots.push(row.root);
            this._slotContainers.push(row.layout);
            this._slotSizes.push(row.size);
            this._slotOffsets.push(row.offset);
            this._slotTexts.push(row.text);
            this._slotScrolls.push(row.scroll);
            this._slotBoxes.push(row.box);
        });
    }

    private buildTree(index: UiTreeIndex, snapping: UiScaleSnapping): void {
        index.clear();
        this._containers.length = 0;
        this._sizes.length = 0;
        this._offsets.length = 0;
        this._texts.length = 0;
        this._scrollStyles.length = 0;
        this._boxes.length = 0;
        const roots = this._rootOrder;
        roots.length = 0;
        for (let slot = 0; slot < this._slotEntities.length; slot++) {
            const root = this._slotRoots[slot];
            if (root === undefined) continue;
            const creationOrder = getEntityCreationOrder(this._slotEntities[slot]) ?? UNKNOWN_CREATION_ORDER;
            roots.push({slot, sortOrder: root.sortOrder, creationOrder});
        }
        roots.sort(compareRoots);
        for (const root of roots) {
            const scale = snapping.effectiveScale(this._slotRoots[root.slot]!.scale);
            const rootIndex = index.beginRoot(this._slotEntities[root.slot], scale);
            this.copyStyles(root.slot, rootIndex);
            this.pushChildren(root.slot, rootIndex);
            this.appendStackedNodes(index);
            index.closeSubtrees(rootIndex);
        }
    }

    private pushChildren(slot: number, treeIndex: number): void {
        const children = this._slotChildren[slot];
        if (children === undefined) return;
        for (let i = children.length - 1; i >= 0; i--) {
            const childSlot = this._slotOfEntity.get(children[i]);
            if (childSlot === undefined || this._slotRoots[childSlot] !== undefined) continue;
            this._stackSlots.push(childSlot);
            this._stackParents.push(treeIndex);
        }
    }

    private appendStackedNodes(index: UiTreeIndex): void {
        const slots = this._stackSlots, parents = this._stackParents;
        while (slots.length > 0) {
            const slot = slots.pop()!;
            const parent = parents.pop()!;
            const entity = this._slotEntities[slot];
            if (index.indexOf(entity) !== NOT_IN_TREE) continue;
            const treeIndex = index.append(entity, parent);
            this.copyStyles(slot, treeIndex);
            this.pushChildren(slot, treeIndex);
        }
    }

    private copyStyles(slot: number, treeIndex: number): void {
        this._containers[treeIndex] = this._slotContainers[slot];
        this._sizes[treeIndex] = this._slotSizes[slot];
        this._offsets[treeIndex] = this._slotOffsets[slot];
        this._texts[treeIndex] = this._slotTexts[slot];
        this._scrollStyles[treeIndex] = this._slotScrolls[slot];
        this._boxes[treeIndex] = this._slotBoxes[slot];
    }

    private layoutRoots(index: UiTreeIndex, screenWidth: number, screenHeight: number): void {
        const tree: FlexLayoutTree = {
            count: index.count,
            subtreeEnd: index.subtreeEnd,
            containers: this._containers,
            sizes: this._sizes,
            offsets: this._offsets,
            texts: this._texts,
            scrolls: this._scrollStyles,
            boxes: this._boxes,
        };
        const roots = index.roots, scales = index.rootScales;
        for (let i = 0; i < roots.length; i++) {
            const scale = scales[i];
            this._flexLayout.layout(tree, roots[i], screenWidth / scale, screenHeight / scale);
        }
    }

    private writeRects(index: UiTreeIndex): void {
        const layout = this._flexLayout;
        this._nodes.stream({write: {rect: UiRect}}).consumeSpans(({start, end, entities, cols}) => {
            const rect = cols.rect!;
            let wrote = false;
            for (let row = start; row < end; row++) {
                const node = index.indexOf(entities[row]);
                const base = row * UI_RECT_FLOATS;
                const changed = node === NOT_IN_TREE ? storeEmptyRect(rect, base) : storeLaidOutRect(rect, base, layout, node);
                if (changed) wrote = true;
            }
            return wrote ? undefined : Unchanged;
        });
    }

    private writeScrolls(index: UiTreeIndex): void {
        const layout = this._flexLayout;
        this._scrolls.stream({write: {scroll: UiScroll}}, {includeEntity: true}).consume(({entity, scroll}) => {
            const node = index.indexOf(entity);
            if (node === NOT_IN_TREE) return Unchanged;
            const scrollX = layout.scrollX[node], scrollY = layout.scrollY[node];
            const contentWidth = layout.contentWidth[node], contentHeight = layout.contentHeight[node];
            if (scroll.scrollX === scrollX && scroll.scrollY === scrollY && scroll.contentWidth === contentWidth && scroll.contentHeight === contentHeight) return Unchanged;
            scroll.scrollX = scrollX;
            scroll.scrollY = scrollY;
            scroll.contentWidth = contentWidth;
            scroll.contentHeight = contentHeight;
            return undefined;
        });
    }
}
