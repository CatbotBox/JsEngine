import type {World} from "../../../src/engine/core";
import type {PixelPresenter} from "../../../src/backends/pixels/pixelPresenter";
import {PIXELS_HUD_TEXT_PASSES} from "../../../src/backends/pixels/pixelsHudTextPasses";
import {installGpuBackend} from "../../../src/backends/gpu/gpuBackend";
import type {GpuDeviceResource} from "../../../src/backends/gpu/gpuDeviceResource";
import {GPU_MESH_PASSES} from "../../../src/backends/gpu/gpuMeshPasses";
import {DemoSurfaceShaderSystem} from "../backend/gpu/gpuSurfaceShaders";
import {Demo3dGpuControlsSystem} from "../backend/gpu/demo3dGpuControlsSystem";

export function installGpuRendering3d(world: World, device: GpuDeviceResource, presenter: PixelPresenter): void {
    installGpuBackend(world, device, presenter, [...GPU_MESH_PASSES, ...PIXELS_HUD_TEXT_PASSES]);
    world.ensureSystemExists(DemoSurfaceShaderSystem);
    world.ensureSystemExists(Demo3dGpuControlsSystem);
}
