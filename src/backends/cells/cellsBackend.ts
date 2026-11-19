import type {World} from "../../engine/core";
import {insertRenderBackendMarker} from "../../engine/rendering/renderBackend";
import {createRenderPasses} from "../../engine/rendering/renderPasses";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import type {CellPresenter} from "./cellPresenter";
import {CellPresenterResource} from "./cellPresenterResource";

export function installCellsBackend(world: World, presenter: CellPresenter, passes: readonly RenderPassCtor[]): void {
    insertRenderBackendMarker(world, "cells");
    world.resources.insert(new CellPresenterResource(presenter));
    createRenderPasses(world, passes);
}
