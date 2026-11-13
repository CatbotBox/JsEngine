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
        meshes.supersampleX = 3;
        meshes.textures = false;
        meshes.lodTrianglesPerPixel = 0.5;
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
        expect(loadedMeshes.supersampleX).toBe(3);
        expect(loadedMeshes.textures).toBe(false);
        expect(loadedMeshes.framebufferPixelsPerRasterPixel).toBe("fitWorkerPool");
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
