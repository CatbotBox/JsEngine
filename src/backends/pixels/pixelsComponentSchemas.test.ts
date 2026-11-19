import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core";
import {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../engine/scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../engine/scene/sceneSerialization";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {registerPixelsComponentSchemas} from "./pixelsComponentSchemas";
import {PixelRenderSettings} from "./pixelRenderSettings";
import {SpritePixelPassSettings} from "./2d/spritePixelPassSettings";
import {MeshPixelPassSettings} from "./3d/meshPixelPassSettings";

const FIXED_WORKERS = 2;
const FIXED_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL = 3;
const MAX_DEPTH_FADE = 30;
const THREAD_TRIANGLE_THRESHOLD = 512;
const LOD_TRIANGLES_PER_PIXEL = 0.5;
const SUPERSAMPLE_X = 3;

describe("pixels component schemas", () => {
    test("the pixels settings round-trip at non-default values; workerCount and framebufferPixelsPerRasterPixel are not saved", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registerPixelsComponentSchemas(registry);

        const render = new PixelRenderSettings();
        render.backgroundColor = 0x203040;
        render.pixelsPerScreenUnitX = 4;
        const sprites = new SpritePixelPassSettings();
        sprites.maxDepthFade = 20;
        const meshes = new MeshPixelPassSettings();
        meshes.maxDepthFade = MAX_DEPTH_FADE;
        meshes.supersampleX = SUPERSAMPLE_X;
        meshes.threadTriangleThreshold = THREAD_TRIANGLE_THRESHOLD;
        meshes.lodTrianglesPerPixel = LOD_TRIANGLES_PER_PIXEL;
        meshes.workerCount = FIXED_WORKERS;
        meshes.framebufferPixelsPerRasterPixel = FIXED_FRAMEBUFFER_PIXELS_PER_RASTER_PIXEL;

        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [render, sprites, meshes]);
        const saved = serializeWorld(source, registry);
        const components = saved.document.entities[0].components;
        expect(components.PixelRenderSettings).toEqual({backgroundColor: "#203040", pixelsPerScreenUnitX: 4});
        expect(components.SpritePixelPassSettings).toEqual({maxDepthFade: 20});
        expect(Object.keys(components.MeshPixelPassSettings).includes("workerCount")).toBe(false);
        expect(Object.keys(components.MeshPixelPassSettings).includes("framebufferPixelsPerRasterPixel")).toBe(false);

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedMeshes = target.entityManager.getComponent<MeshPixelPassSettings>(loaded.entities[0], MeshPixelPassSettings)!;
        expect([loadedMeshes.maxDepthFade, loadedMeshes.threadTriangleThreshold, loadedMeshes.lodTrianglesPerPixel]).toEqual([MAX_DEPTH_FADE, THREAD_TRIANGLE_THRESHOLD, LOD_TRIANGLES_PER_PIXEL]);
        expect(loadedMeshes.supersampleX).toBe(SUPERSAMPLE_X);
        expect(loadedMeshes.framebufferPixelsPerRasterPixel).toBe("fitWorkerPool");
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
