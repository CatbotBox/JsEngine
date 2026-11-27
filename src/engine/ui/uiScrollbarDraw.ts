import {TextColor} from "../rendering/textColor";
import {NO_SCROLLBAR_UNITS, SCROLLBAR_THICKNESS_UNITS} from "./layout/scrollbarGeometry";
import type {UiDrawList} from "./uiDrawList";
import type {UiScroll} from "./uiScroll";

function fillIfColored(list: UiDrawList, x: number, y: number, width: number, height: number, color: TextColor): void {
    if (!TextColor.isDefault(color)) list.fillRect(x, y, width, height, color);
}

export function emitScrollbars(list: UiDrawList, scroll: Readonly<UiScroll>): void {
    if (scroll.verticalTrackLength > NO_SCROLLBAR_UNITS) {
        const x = scroll.verticalTrackX;
        fillIfColored(list, x, scroll.verticalTrackY, SCROLLBAR_THICKNESS_UNITS, scroll.verticalTrackLength, scroll.trackColor);
        fillIfColored(list, x, scroll.verticalThumbStart, SCROLLBAR_THICKNESS_UNITS, scroll.verticalThumbLength, scroll.thumbColor);
    }
    if (scroll.horizontalTrackLength > NO_SCROLLBAR_UNITS) {
        const y = scroll.horizontalTrackY;
        fillIfColored(list, scroll.horizontalTrackX, y, scroll.horizontalTrackLength, SCROLLBAR_THICKNESS_UNITS, scroll.trackColor);
        fillIfColored(list, scroll.horizontalThumbStart, y, scroll.horizontalThumbLength, SCROLLBAR_THICKNESS_UNITS, scroll.thumbColor);
    }
}
