import type {World} from "../../engine/core";
import {insertRenderBackendMarker} from "../../engine/rendering/renderBackend";
import {createRenderPasses} from "../../engine/rendering/renderPasses";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import type {PixelPresenter} from "../pixels/pixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import type {GpuDeviceResource} from "./gpuDeviceResource";

export function installGpuBackend(world: World, device: GpuDeviceResource, presenter: PixelPresenter, passes: readonly RenderPassCtor[]): void {
    insertRenderBackendMarker(world, "gpu");
    world.resources.insert(device);
    world.resources.insert(new PixelPresenterResource(presenter));
    createRenderPasses(world, passes);
}
