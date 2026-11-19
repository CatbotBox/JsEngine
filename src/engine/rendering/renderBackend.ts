import {Resource} from "../core/resource";
import type {ResourceCtor} from "../core/resource";
import type {World} from "../core/world";

export type RenderBackendKind = "cells" | "pixels" | "gpu";

export const RENDER_BACKEND_KINDS: readonly RenderBackendKind[] = ["cells", "pixels", "gpu"];

export function isRenderBackendKind(value: string | undefined): value is RenderBackendKind {
    return RENDER_BACKEND_KINDS.some(kind => kind === value);
}

export class CellsRenderBackend extends Resource {
}

export class PixelsRenderBackend extends Resource {
}

export class GpuRenderBackend extends Resource {
}

export const RENDER_BACKEND_MARKERS: Readonly<Record<RenderBackendKind, ResourceCtor<Resource>>> = {
    cells: CellsRenderBackend,
    pixels: PixelsRenderBackend,
    gpu: GpuRenderBackend,
};

export function activeRenderBackend(world: World): RenderBackendKind | undefined {
    return RENDER_BACKEND_KINDS.find(kind => world.resources.tryGet(RENDER_BACKEND_MARKERS[kind]) !== undefined);
}

export function insertRenderBackendMarker(world: World, kind: RenderBackendKind): void {
    const active = activeRenderBackend(world);
    if (active !== undefined && active !== kind) {
        throw new Error(`This world already renders through the ${active} backend, so it cannot install the ${kind} backend as well`);
    }
    world.resources.insert(new RENDER_BACKEND_MARKERS[kind]());
}
