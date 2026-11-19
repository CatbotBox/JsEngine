import type {World} from "../../engine/core";
import {insertRenderBackendMarker} from "../../engine/rendering/renderBackend";
import {createRenderPasses} from "../../engine/rendering/renderPasses";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import type {PixelPresenter} from "./pixelPresenter";
import {PixelPresenterResource} from "./pixelPresenterResource";

export function installPixelsBackend(world: World, presenter: PixelPresenter, passes: readonly RenderPassCtor[]): void {
    insertRenderBackendMarker(world, "pixels");
    world.resources.insert(new PixelPresenterResource(presenter));
    createRenderPasses(world, passes);
}
