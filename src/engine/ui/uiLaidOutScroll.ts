import type {FlexLayout} from "./layout/flexLayout";
import type {UiScroll} from "./uiScroll";

type LaidOutScrollField =
    | "scrollX" | "scrollY" | "contentWidth" | "contentHeight"
    | "verticalTrackX" | "verticalTrackY" | "verticalTrackLength" | "verticalThumbStart" | "verticalThumbLength"
    | "horizontalTrackX" | "horizontalTrackY" | "horizontalTrackLength" | "horizontalThumbStart" | "horizontalThumbLength";

function store(scroll: UiScroll, field: LaidOutScrollField, value: number): boolean {
    if (scroll[field] === value) return false;
    scroll[field] = value;
    return true;
}

export function storeLaidOutScroll(scroll: UiScroll, layout: FlexLayout, node: number): boolean {
    const bars = layout.scrollbars;
    let changed = store(scroll, "scrollX", layout.scrollX[node]);
    changed = store(scroll, "scrollY", layout.scrollY[node]) || changed;
    changed = store(scroll, "contentWidth", layout.contentWidth[node]) || changed;
    changed = store(scroll, "contentHeight", layout.contentHeight[node]) || changed;
    changed = store(scroll, "verticalTrackX", bars.verticalTrackX[node]) || changed;
    changed = store(scroll, "verticalTrackY", bars.verticalTrackY[node]) || changed;
    changed = store(scroll, "verticalTrackLength", bars.verticalTrackLength[node]) || changed;
    changed = store(scroll, "verticalThumbStart", bars.verticalThumbStart[node]) || changed;
    changed = store(scroll, "verticalThumbLength", bars.verticalThumbLength[node]) || changed;
    changed = store(scroll, "horizontalTrackX", bars.horizontalTrackX[node]) || changed;
    changed = store(scroll, "horizontalTrackY", bars.horizontalTrackY[node]) || changed;
    changed = store(scroll, "horizontalTrackLength", bars.horizontalTrackLength[node]) || changed;
    changed = store(scroll, "horizontalThumbStart", bars.horizontalThumbStart[node]) || changed;
    return store(scroll, "horizontalThumbLength", bars.horizontalThumbLength[node]) || changed;
}
