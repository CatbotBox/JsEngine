import type {UiScrollbarMode} from "./flexStyle";

export const SCROLLBAR_THICKNESS_UNITS = 1;
export const MIN_SCROLLBAR_THUMB_UNITS = 1;
export const NO_SCROLLBAR_UNITS = 0;

export function scrollbarReservation(mode: UiScrollbarMode, overflows: boolean): number {
    return mode === "always" || (mode === "auto" && overflows) ? SCROLLBAR_THICKNESS_UNITS : NO_SCROLLBAR_UNITS;
}

export function maxScrollOffset(content: number, viewport: number): number {
    return Math.max(0, content - viewport);
}

export function clampScrollOffset(offset: number, maxScroll: number): number {
    return Math.max(0, Math.min(offset, maxScroll));
}

export function scrollbarThumbLength(trackLength: number, viewport: number, content: number): number {
    if (content <= viewport) return trackLength;
    const proportional = Math.round(viewport / content * trackLength);
    return Math.min(trackLength, Math.max(MIN_SCROLLBAR_THUMB_UNITS, proportional));
}

export function scrollbarThumbStart(trackStart: number, trackLength: number, thumbLength: number, offset: number, maxScroll: number): number {
    if (maxScroll <= 0) return trackStart;
    return trackStart + (trackLength - thumbLength) * clampScrollOffset(offset, maxScroll) / maxScroll;
}

export function scrollPerThumbUnit(trackLength: number, thumbLength: number, maxScroll: number): number {
    const travel = trackLength - thumbLength;
    return travel > 0 ? maxScroll / travel : 0;
}

export function pagedScrollOffset(offset: number, page: number, towardEnd: boolean, maxScroll: number): number {
    return clampScrollOffset(towardEnd ? offset + page : offset - page, maxScroll);
}

export function wheelScrollOffset(offset: number, wheelDelta: number, stepUnits: number, maxScroll: number): number {
    return clampScrollOffset(offset - wheelDelta * stepUnits, maxScroll);
}

export function revealScrollDelta(start: number, end: number, viewStart: number, viewEnd: number): number {
    if (start < viewStart) return start - viewStart;
    if (end > viewEnd) return Math.min(end - viewEnd, start - viewStart);
    return 0;
}
