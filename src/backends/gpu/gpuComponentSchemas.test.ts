import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core";
import {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../engine/scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../engine/scene/sceneSerialization";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {registerPixelsComponentSchemas} from "../pixels/pixelsComponentSchemas";
import {registerGpuComponentSchemas} from "./gpuComponentSchemas";
import {GpuMeshPassSettings, LINEAR_TEXTURE_FILTERING, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";

const DEPTH_RANGE = 250;
const EVICT_AFTER_FRAMES = 30;
const LOD_BIAS = -1;
const LOD_TRIANGLES_PER_PIXEL = 0.5;

describe("gpu component schemas", () => {
    test("GpuMeshPassSettings round-trips at non-default values", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registerPixelsComponentSchemas(registry);
        registerGpuComponentSchemas(registry);

        const settings = new GpuMeshPassSettings();
        settings.textures = false;
        settings.sampleCount = SINGLE_SAMPLE_COUNT;
        settings.orthographicDepthRange = DEPTH_RANGE;
        settings.evictUnusedMeshAfterFrames = EVICT_AFTER_FRAMES;
        settings.lod = false;
        settings.textureFiltering = LINEAR_TEXTURE_FILTERING;
        settings.lodBias = LOD_BIAS;
        settings.lodTrianglesPerPixel = LOD_TRIANGLES_PER_PIXEL;
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [settings]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.GpuMeshPassSettings).toEqual({
            textures: false, textureFiltering: "linear", sampleCount: "single", orthographicDepthRange: DEPTH_RANGE, evictUnusedMeshAfterFrames: EVICT_AFTER_FRAMES,
            lod: false, lodBias: LOD_BIAS, lodTrianglesPerPixel: LOD_TRIANGLES_PER_PIXEL,
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedSettings = target.entityManager.getComponent<GpuMeshPassSettings>(loaded.entities[0], GpuMeshPassSettings)!;
        expect([loadedSettings.sampleCount, loadedSettings.textures, loadedSettings.textureFiltering]).toEqual([SINGLE_SAMPLE_COUNT, false, LINEAR_TEXTURE_FILTERING]);
        expect([loadedSettings.lod, loadedSettings.lodBias, loadedSettings.lodTrianglesPerPixel]).toEqual([false, LOD_BIAS, LOD_TRIANGLES_PER_PIXEL]);
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
