import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core";
import {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../engine/scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../engine/scene/sceneSerialization";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {MESH_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY} from "../pixels/3d/schemas";
import {PIXELS_SCHEMAS, registerPixelsComponentSchemas} from "../pixels/pixelsComponentSchemas";
import {GPU_HOST_SCHEMAS, GPU_SCHEMAS, registerGpuComponentSchemas} from "./gpuComponentSchemas";
import {GpuMeshPassSettings, LINEAR_TEXTURE_FILTERING, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import {GpuSurfaceShader, LIT_SURFACE_SHADER} from "./gpuSurfaceShader";
import {GpuShadowSettings} from "./gpuShadowSettings";

const DEPTH_RANGE = 250;
const EVICT_AFTER_FRAMES = 30;
const LOD_TRIANGLES_PER_PIXEL = 0.5;
const RENDER_SCALE = 2;
const SHADOW_MAP_SIZE = 1024;
const SHADOW_MAX_DISTANCE = 35;
const SHADOW_FADE_FRACTION = 0.2;
const SHADOW_DEPTH_BIAS_TEXELS = 0.25;
const SHADOW_NORMAL_BIAS_TEXELS = 2.5;
const SHADOW_SLOPE_BIAS = 1.5;
const SHADOW_FILTER_RADIUS_TEXELS = 2;
const SHADOW_STRENGTH = 0.75;
const HOLOGRAM = "hologram";
const HOLOGRAM_PARAMS = [0.25, 0.5, 1, 1.75, -2, 0, 8, 0.125];

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    registerPixelsComponentSchemas(result);
    registerGpuComponentSchemas(result);
    return result;
}

describe("gpu component schemas", () => {
    test("a gpu host registers the pixels types but the pixel mesh pass settings, then the gpu types", () => {
        expect(GPU_HOST_SCHEMAS).toEqual([...PIXELS_SCHEMAS.filter(entry => entry !== MESH_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY), ...GPU_SCHEMAS]);
    });

    test("GpuMeshPassSettings round-trips at non-default values", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registerPixelsComponentSchemas(registry);
        registerGpuComponentSchemas(registry);

        const settings = new GpuMeshPassSettings();
        settings.sampleCount = SINGLE_SAMPLE_COUNT;
        settings.orthographicDepthRange = DEPTH_RANGE;
        settings.evictUnusedAfterFrames = EVICT_AFTER_FRAMES;
        settings.textureFiltering = LINEAR_TEXTURE_FILTERING;
        settings.lodTrianglesPerPixel = LOD_TRIANGLES_PER_PIXEL;
        settings.renderScale = RENDER_SCALE;
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [settings]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.GpuMeshPassSettings).toEqual({
            textureFiltering: "linear", sampleCount: "single", orthographicDepthRange: DEPTH_RANGE, evictUnusedAfterFrames: EVICT_AFTER_FRAMES, lodTrianglesPerPixel: LOD_TRIANGLES_PER_PIXEL, renderScale: RENDER_SCALE,
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedSettings = target.entityManager.getComponent<GpuMeshPassSettings>(loaded.entities[0], GpuMeshPassSettings)!;
        expect([loadedSettings.textureFiltering, loadedSettings.sampleCount, loadedSettings.orthographicDepthRange, loadedSettings.lodTrianglesPerPixel, loadedSettings.renderScale])
            .toEqual([LINEAR_TEXTURE_FILTERING, SINGLE_SAMPLE_COUNT, DEPTH_RANGE, LOD_TRIANGLES_PER_PIXEL, RENDER_SCALE]);
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });

    test("GpuShadowSettings round-trips at non-default values", () => {
        const schemas = registry();
        const shadows = Object.assign(new GpuShadowSettings(), {
            mapSize: SHADOW_MAP_SIZE, maxDistance: SHADOW_MAX_DISTANCE, fadeFraction: SHADOW_FADE_FRACTION, depthBiasTexels: SHADOW_DEPTH_BIAS_TEXELS,
            normalBiasTexels: SHADOW_NORMAL_BIAS_TEXELS, slopeBias: SHADOW_SLOPE_BIAS, filterRadiusTexels: SHADOW_FILTER_RADIUS_TEXELS, strength: SHADOW_STRENGTH,
        });
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [shadows]);
        const saved = serializeWorld(source, schemas);
        expect(saved.document.entities[0].components.GpuShadowSettings).toEqual({
            mapSize: SHADOW_MAP_SIZE, maxDistance: SHADOW_MAX_DISTANCE, fadeFraction: SHADOW_FADE_FRACTION, depthBiasTexels: SHADOW_DEPTH_BIAS_TEXELS,
            normalBiasTexels: SHADOW_NORMAL_BIAS_TEXELS, slopeBias: SHADOW_SLOPE_BIAS, filterRadiusTexels: SHADOW_FILTER_RADIUS_TEXELS, strength: SHADOW_STRENGTH,
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, schemas, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedShadows = target.entityManager.getComponent<GpuShadowSettings>(loaded.entities[0], GpuShadowSettings)!;
        expect({...loadedShadows}).toEqual({...shadows});
        expect(serializeWorld(target, schemas).document).toEqual(saved.document);
    });

    test("GpuSurfaceShader saves its name and its eight params, and loads them back", () => {
        const schemas = registry();
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("hologram", [new GpuSurfaceShader(HOLOGRAM, HOLOGRAM_PARAMS)]);
        source.entityManager.createEntity("default", [new GpuSurfaceShader()]);
        const saved = serializeWorld(source, schemas);
        expect(saved.document.entities[0].components.GpuSurfaceShader).toEqual({
            name: HOLOGRAM,
            param0: HOLOGRAM_PARAMS[0], param1: HOLOGRAM_PARAMS[1], param2: HOLOGRAM_PARAMS[2], param3: HOLOGRAM_PARAMS[3],
            param4: HOLOGRAM_PARAMS[4], param5: HOLOGRAM_PARAMS[5], param6: HOLOGRAM_PARAMS[6], param7: HOLOGRAM_PARAMS[7],
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, schemas, parseSceneDocument(JSON.stringify(saved.document)));
        const hologram = target.entityManager.getComponent<GpuSurfaceShader>(loaded.entities[0], GpuSurfaceShader)!;
        const fallback = target.entityManager.getComponent<GpuSurfaceShader>(loaded.entities[1], GpuSurfaceShader)!;
        expect([hologram.name, Array.from(hologram.params)]).toEqual([HOLOGRAM, HOLOGRAM_PARAMS]);
        expect([fallback.name, Array.from(fallback.params)]).toEqual([LIT_SURFACE_SHADER, new Array(HOLOGRAM_PARAMS.length).fill(0)]);
        expect(serializeWorld(target, schemas).document).toEqual(saved.document);
    });
});
