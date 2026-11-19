import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {activeRenderBackend, isRenderBackendKind, RENDER_BACKEND_KINDS, RENDER_BACKEND_MARKERS} from "./renderBackend";

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

describe("activeRenderBackend", () => {
    test("is undefined until a backend marker is inserted", () => {
        expect(activeRenderBackend(newWorld())).toBeUndefined();
    });

    test("names the backend whose marker the world holds", () => {
        for (const kind of RENDER_BACKEND_KINDS) {
            const world = newWorld();
            world.resources.insert(new RENDER_BACKEND_MARKERS[kind]());
            expect(activeRenderBackend(world)).toBe(kind);
        }
    });

    test("is undefined again once the marker is removed", () => {
        const world = newWorld();
        world.resources.insert(new RENDER_BACKEND_MARKERS.gpu());
        world.resources.remove(RENDER_BACKEND_MARKERS.gpu);
        expect(activeRenderBackend(world)).toBeUndefined();
    });
});

describe("isRenderBackendKind", () => {
    test("accepts exactly the three backend names", () => {
        expect(RENDER_BACKEND_KINDS.every(kind => isRenderBackendKind(kind))).toBe(true);
        expect(isRenderBackendKind("Pixels")).toBe(false);
        expect(isRenderBackendKind("webgl")).toBe(false);
        expect(isRenderBackendKind(undefined)).toBe(false);
    });
});
