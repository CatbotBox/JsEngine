import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core";
import {TextColor} from "../../engine/rendering/textColor";
import {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerEngineComponentSchemas} from "../../engine/scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../engine/scene/sceneSerialization";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {registerCellsComponentSchemas} from "./cellsComponentSchemas";
import {CellRenderSettings} from "./cellRenderSettings";
import {CellAspectRatio} from "./cellAspectRatio";
import {TextSpriteCellPassSettings} from "./2d/textSpriteCellPassSettings";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

const FIXED_WORKERS = 3;

describe("cells component schemas", () => {
    test("the cells settings round-trip at non-default values; workerCount is not saved and CellAspectRatio is implied", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registerCellsComponentSchemas(registry);

        const render = new CellRenderSettings();
        render.backgroundGlyph = ".";
        render.backgroundGlyphColor = TextColor.BRIGHT_BLUE;
        render.backgroundColor = TextColor.rgb(10, 20, 30);
        const sprites = new TextSpriteCellPassSettings();
        sprites.maxDepthFade = 12;
        sprites.colorQuantMask = 0xF0F0F0;
        sprites.backgroundColor = 0x102030;
        sprites.halfBlockCells = false;
        const meshes = new MeshCellPassSettings();
        meshes.supersampleX = 4;
        meshes.supersampleY = 1;
        meshes.threadAreaThreshold = Number.POSITIVE_INFINITY;
        meshes.lod = false;
        meshes.lodBias = -1;
        meshes.workerCount = FIXED_WORKERS;

        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [render, sprites, meshes, new CellAspectRatio()]);
        const saved = serializeWorld(source, registry);
        const components = saved.document.entities[0].components;
        expect(Object.keys(components)).toEqual(["CellRenderSettings", "TextSpriteCellPassSettings", "MeshCellPassSettings"]);
        expect(components.CellRenderSettings).toEqual({backgroundGlyph: ".", backgroundGlyphColor: {palette: 12}, backgroundColor: "#0a141e"});
        expect(components.MeshCellPassSettings.threadAreaThreshold).toBe("Infinity");
        expect(components.MeshCellPassSettings.workerCount).toBeUndefined();

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedMeshes = target.entityManager.getComponent<MeshCellPassSettings>(loaded.entities[0], MeshCellPassSettings)!;
        expect(loadedMeshes.supersampleX).toBe(4);
        expect(loadedMeshes.workerCount).toBe("auto");
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
