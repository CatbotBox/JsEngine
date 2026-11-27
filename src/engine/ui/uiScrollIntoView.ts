import type {Entity, World} from "../core";
import {borderInsetOf, scrollsHorizontally, scrollsVertically} from "./layout/flexStyle";
import {clampScrollOffset, maxScrollOffset, NO_SCROLLBAR_UNITS, revealScrollDelta, SCROLLBAR_THICKNESS_UNITS} from "./layout/scrollbarGeometry";
import {UiBox} from "./uiBox";
import {UiRect} from "./uiRect";
import {UiScroll} from "./uiScroll";
import {NO_PARENT_INDEX, NOT_IN_TREE, UiTreeIndex} from "./uiTreeIndex";

function reservedBy(trackLength: number): number {
    return trackLength > NO_SCROLLBAR_UNITS ? SCROLLBAR_THICKNESS_UNITS : NO_SCROLLBAR_UNITS;
}

export function scrollIntoView(world: World, entity: Entity): void {
    const tree = world.resources.tryGet(UiTreeIndex);
    const node = tree?.indexOf(entity) ?? NOT_IN_TREE;
    const entityManager = world.entityManager;
    const rect = entityManager.getComponent<UiRect>(entity, UiRect);
    if (tree === undefined || node === NOT_IN_TREE || rect === undefined) return;
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    for (let ancestor = tree.parentIndex[node]; ancestor !== NO_PARENT_INDEX; ancestor = tree.parentIndex[ancestor]) {
        const scrollEntity = tree.entities[ancestor];
        const scroll = entityManager.getComponent<UiScroll>(scrollEntity, UiScroll);
        const view = entityManager.getComponent<UiRect>(scrollEntity, UiRect);
        if (scroll === undefined || view === undefined) continue;
        const inset = borderInsetOf(entityManager.getComponent<UiBox>(scrollEntity, UiBox));
        let shiftX = 0, shiftY = 0;
        if (scrollsHorizontally(scroll.axes)) {
            const viewRight = view.x + view.width - inset - reservedBy(scroll.verticalTrackLength);
            const scrollX = clampScrollOffset(scroll.scrollX + revealScrollDelta(left, right, view.x + inset, viewRight), maxScrollOffset(scroll.contentWidth, view.width));
            shiftX = scrollX - scroll.scrollX;
            if (shiftX !== 0) scroll.scrollX = scrollX;
        }
        if (scrollsVertically(scroll.axes)) {
            const viewBottom = view.y + view.height - inset - reservedBy(scroll.horizontalTrackLength);
            const scrollY = clampScrollOffset(scroll.scrollY + revealScrollDelta(top, bottom, view.y + inset, viewBottom), maxScrollOffset(scroll.contentHeight, view.height));
            shiftY = scrollY - scroll.scrollY;
            if (shiftY !== 0) scroll.scrollY = scrollY;
        }
        left -= shiftX;
        right -= shiftX;
        top -= shiftY;
        bottom -= shiftY;
    }
}
