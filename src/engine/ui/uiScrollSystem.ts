import {NULL_ENTITY, System, Unchanged} from "../core";
import type {Entity} from "../core";
import {PointerButton} from "../input/pointerButton";
import {scrollsVertically} from "./layout/flexStyle";
import {clampScrollOffset, maxScrollOffset, pagedScrollOffset, SCROLLBAR_THICKNESS_UNITS, scrollPerThumbUnit, wheelScrollOffset} from "./layout/scrollbarGeometry";
import {UiEvents} from "./uiEvents";
import type {UiEvent} from "./uiEvents";
import {UiInputSystemGroup} from "./uiInputSystemGroup";
import {UiRect} from "./uiRect";
import {UiScroll} from "./uiScroll";
import {UI_SCROLL_PRIORITY} from "./uiSystemPriorities";

function withinTrack(x: number, y: number, trackX: number, trackY: number, width: number, height: number): boolean {
    return x >= trackX && x < trackX + width && y >= trackY && y < trackY + height;
}

function maxScrollAlong(scroll: Readonly<UiScroll>, rect: Readonly<UiRect>, vertical: boolean): number {
    return vertical ? maxScrollOffset(scroll.contentHeight, rect.height) : maxScrollOffset(scroll.contentWidth, rect.width);
}

function scrollTo(scroll: UiScroll, vertical: boolean, offset: number): boolean {
    if ((vertical ? scroll.scrollY : scroll.scrollX) === offset) return false;
    if (vertical) scroll.scrollY = offset;
    else scroll.scrollX = offset;
    return true;
}

export class UiScrollSystem extends System {
    private readonly _scrolls = this.createEntityQuery([UiScroll, UiRect]);
    private readonly _pending: UiEvent[] = [];
    private _dragged: Entity = NULL_ENTITY;
    private _dragVertical = true;
    private _dragStartPointer = 0;
    private _dragStartOffset = 0;
    private _dragScrollPerUnit = 0;

    override systemGroup() {
        return UiInputSystemGroup;
    }

    override priority(): number {
        return UI_SCROLL_PRIORITY;
    }

    protected onCreate() {
        this.world.resources.getOrCreate(UiEvents);
    }

    override onEnable(): void {
        this._dragged = NULL_ENTITY;
    }

    onUpdate() {
        if (!this.collectEvents()) return;
        this._scrolls.stream({write: {scroll: UiScroll}, read: {rect: UiRect}}, {includeEntity: true}).consume(({entity, scroll, rect}) => {
            let changed = false;
            for (const event of this._pending) {
                if (event.target === entity && this.apply(entity, event, scroll, rect)) changed = true;
            }
            return changed ? undefined : Unchanged;
        });
        this._pending.length = 0;
    }

    private collectEvents(): boolean {
        const events = this.world.resources.getOrCreate(UiEvents).events;
        for (const event of events) {
            if (event.type === "wheel" || event.type === "press" || event.type === "drag" || event.type === "release") this._pending.push(event);
        }
        return this._pending.length > 0;
    }

    private apply(entity: Entity, event: UiEvent, scroll: UiScroll, rect: Readonly<UiRect>): boolean {
        switch (event.type) {
            case "wheel":
                return this.wheel(scroll, rect, event.delta);
            case "press":
                return event.button === PointerButton.Left && this.press(entity, scroll, rect, event.x, event.y);
            case "drag":
                return entity === this._dragged && event.button === PointerButton.Left && this.drag(scroll, rect, event.x, event.y);
            case "release":
                if (entity === this._dragged && event.button === PointerButton.Left) this._dragged = NULL_ENTITY;
                return false;
        }
        return false;
    }

    private wheel(scroll: UiScroll, rect: Readonly<UiRect>, delta: number): boolean {
        const vertical = scrollsVertically(scroll.axes);
        const offset = vertical ? scroll.scrollY : scroll.scrollX;
        return scrollTo(scroll, vertical, wheelScrollOffset(offset, delta, scroll.wheelStepUnits, maxScrollAlong(scroll, rect, vertical)));
    }

    private press(entity: Entity, scroll: UiScroll, rect: Readonly<UiRect>, x: number, y: number): boolean {
        const vertical = withinTrack(x, y, scroll.verticalTrackX, scroll.verticalTrackY, SCROLLBAR_THICKNESS_UNITS, scroll.verticalTrackLength);
        if (!vertical && !withinTrack(x, y, scroll.horizontalTrackX, scroll.horizontalTrackY, scroll.horizontalTrackLength, SCROLLBAR_THICKNESS_UNITS)) return false;
        const along = vertical ? y : x;
        const trackLength = vertical ? scroll.verticalTrackLength : scroll.horizontalTrackLength;
        const thumbStart = vertical ? scroll.verticalThumbStart : scroll.horizontalThumbStart;
        const thumbLength = vertical ? scroll.verticalThumbLength : scroll.horizontalThumbLength;
        const offset = vertical ? scroll.scrollY : scroll.scrollX;
        const maxScroll = maxScrollAlong(scroll, rect, vertical);
        if (along < thumbStart || along >= thumbStart + thumbLength) return scrollTo(scroll, vertical, pagedScrollOffset(offset, trackLength, along >= thumbStart, maxScroll));
        this._dragged = entity;
        this._dragVertical = vertical;
        this._dragStartPointer = along;
        this._dragStartOffset = offset;
        this._dragScrollPerUnit = scrollPerThumbUnit(trackLength, thumbLength, maxScroll);
        return false;
    }

    private drag(scroll: UiScroll, rect: Readonly<UiRect>, x: number, y: number): boolean {
        const vertical = this._dragVertical;
        const travel = (vertical ? y : x) - this._dragStartPointer;
        return scrollTo(scroll, vertical, clampScrollOffset(this._dragStartOffset + travel * this._dragScrollPerUnit, maxScrollAlong(scroll, rect, vertical)));
    }
}
