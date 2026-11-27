import {NO_SCROLLBAR_UNITS, SCROLLBAR_THICKNESS_UNITS} from "./layout/scrollbarGeometry";
import type {UiScroll} from "./uiScroll";
import {snappedUiEdge} from "./uiSnapping";

const VERTICAL_X = 0;
const VERTICAL_Y = 1;
const VERTICAL_LENGTH = 2;
const HORIZONTAL_X = 3;
const HORIZONTAL_Y = 4;
const HORIZONTAL_LENGTH = 5;
const SCROLLBAR_FLOATS = 6;
const INITIAL_CAPACITY_NODES = 16;
const CAPACITY_GROWTH_FACTOR = 2;

export function showsScrollbar(scroll: Readonly<UiScroll> | undefined): boolean {
    return scroll !== undefined && (scroll.verticalTrackLength > NO_SCROLLBAR_UNITS || scroll.horizontalTrackLength > NO_SCROLLBAR_UNITS);
}

function coversTrack(x: number, y: number, width: number, height: number, deviceX: number, deviceY: number, unitX: number, unitY: number): boolean {
    if (width <= NO_SCROLLBAR_UNITS || height <= NO_SCROLLBAR_UNITS) return false;
    if (deviceX < snappedUiEdge(x, unitX) || deviceX >= snappedUiEdge(x + width, unitX)) return false;
    return deviceY >= snappedUiEdge(y, unitY) && deviceY < snappedUiEdge(y + height, unitY);
}

export class UiPointerScrollbars {
    private _tracks = new Float64Array(INITIAL_CAPACITY_NODES * SCROLLBAR_FLOATS);

    public ensureCapacity(count: number): void {
        const required = count * SCROLLBAR_FLOATS;
        if (required <= this._tracks.length) return;
        let capacity = this._tracks.length;
        while (capacity < required) capacity *= CAPACITY_GROWTH_FACTOR;
        this._tracks = new Float64Array(capacity);
    }

    public set(node: number, scroll: Readonly<UiScroll> | undefined): void {
        const tracks = this._tracks, base = node * SCROLLBAR_FLOATS;
        tracks[base + VERTICAL_X] = scroll?.verticalTrackX ?? NO_SCROLLBAR_UNITS;
        tracks[base + VERTICAL_Y] = scroll?.verticalTrackY ?? NO_SCROLLBAR_UNITS;
        tracks[base + VERTICAL_LENGTH] = scroll?.verticalTrackLength ?? NO_SCROLLBAR_UNITS;
        tracks[base + HORIZONTAL_X] = scroll?.horizontalTrackX ?? NO_SCROLLBAR_UNITS;
        tracks[base + HORIZONTAL_Y] = scroll?.horizontalTrackY ?? NO_SCROLLBAR_UNITS;
        tracks[base + HORIZONTAL_LENGTH] = scroll?.horizontalTrackLength ?? NO_SCROLLBAR_UNITS;
    }

    public covers(node: number, deviceX: number, deviceY: number, unitX: number, unitY: number): boolean {
        const tracks = this._tracks, base = node * SCROLLBAR_FLOATS;
        const vertical = coversTrack(tracks[base + VERTICAL_X], tracks[base + VERTICAL_Y], SCROLLBAR_THICKNESS_UNITS, tracks[base + VERTICAL_LENGTH], deviceX, deviceY, unitX, unitY);
        return vertical || coversTrack(tracks[base + HORIZONTAL_X], tracks[base + HORIZONTAL_Y], tracks[base + HORIZONTAL_LENGTH], SCROLLBAR_THICKNESS_UNITS, deviceX, deviceY, unitX, unitY);
    }
}
