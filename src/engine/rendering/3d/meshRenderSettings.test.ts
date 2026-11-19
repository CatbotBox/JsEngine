import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import {ComponentType, World} from "../../core";
import {ComponentSchemaRegistry} from "../../scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../scene/sceneSerialization";
import {parseSceneDocument} from "../../scene/sceneDocument";
import {MeshRenderSettings} from "./meshRenderSettings";

const LOD_BIAS = 2;

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

describe("MeshRenderSettings", () => {
    test("defaults to textures and LOD on, no bias", () => {
        const settings = new MeshRenderSettings();
        expect([settings.textures, settings.lod, settings.lodBias]).toEqual([true, true, 0]);
    });

    test("the engine registers it as a Settings component", () => {
        const schema = engineRegistry().byType(ComponentType.of(MeshRenderSettings))!;
        expect(schema.category).toBe("Settings");
        expect(schema.fields).toEqual([
            {key: "textures", kind: "boolean"},
            {key: "lod", kind: "boolean"},
            {key: "lodBias", kind: "number"},
        ]);
    });

    test("round-trips explicit values", () => {
        const registry = engineRegistry();
        const settings = Object.assign(new MeshRenderSettings(), {textures: false, lod: false, lodBias: LOD_BIAS});
        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [settings]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities[0].components.MeshRenderSettings).toEqual({
            textures: false, lod: false, lodBias: LOD_BIAS,
        });

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedSettings = target.entityManager.getComponent<MeshRenderSettings>(loaded.entities[0], MeshRenderSettings)!;
        expect([loadedSettings.textures, loadedSettings.lod, loadedSettings.lodBias]).toEqual([false, false, LOD_BIAS]);
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
