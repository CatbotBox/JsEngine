import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import {ComponentType, World} from "../../core";
import {ComponentSchemaRegistry} from "../../scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../scene/sceneSerialization";
import {parseSceneDocument} from "../../scene/sceneDocument";
import {MeshRenderSettings} from "./meshRenderSettings";

const LOD_BIAS = 2;
const SUPERSAMPLE_X = 4;

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

describe("MeshRenderSettings", () => {
    test("defaults to textures and LOD on, no bias, and each backend's own supersampling", () => {
        const settings = new MeshRenderSettings();
        expect([settings.textures, settings.lod, settings.lodBias, settings.supersampleX, settings.supersampleY]).toEqual([true, true, 0, undefined, undefined]);
    });

    test("the engine registers it as a Settings component whose supersampling may be unset", () => {
        const schema = engineRegistry().byType(ComponentType.of(MeshRenderSettings))!;
        expect(schema.category).toBe("Settings");
        expect(schema.fields).toEqual([
            {key: "textures", kind: "boolean"},
            {key: "lod", kind: "boolean"},
            {key: "lodBias", kind: "number"},
            {key: "supersampleX", kind: "integer", nullable: true},
            {key: "supersampleY", kind: "integer", nullable: true},
        ]);
    });

    test("round-trips explicit values, and unset supersampling as null", () => {
        const registry = engineRegistry();
        const settings = Object.assign(new MeshRenderSettings(), {textures: false, lodBias: LOD_BIAS, supersampleX: SUPERSAMPLE_X});
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [settings]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.MeshRenderSettings).toEqual({
            textures: false, lod: true, lodBias: LOD_BIAS, supersampleX: SUPERSAMPLE_X, supersampleY: null,
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedSettings = target.entityManager.getComponent<MeshRenderSettings>(loaded.entities[0], MeshRenderSettings)!;
        expect([loadedSettings.supersampleX, loadedSettings.supersampleY, loadedSettings.textures]).toEqual([SUPERSAMPLE_X, undefined, false]);
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
