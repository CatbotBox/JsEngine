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
import {SpriteCellPassSettings} from "./2d/spriteCellPassSettings";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

const FIXED_WORKERS = 3;
const FIVE_BITS_PER_CHANNEL_MASK = 0xF8F8F8;
const LOD_TRIANGLES_PER_CELL = 8;
const SUPERSAMPLE_X = 4;
const SUPERSAMPLE_Y = 1;

describe("cells component schemas", () => {
    test("the cells settings round-trip at non-default values; workerCount is not saved and CellAspectRatio is implied", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        registerCellsComponentSchemas(registry);

        const render = new CellRenderSettings();
        render.backgroundGlyph = ".";
        render.backgroundGlyphColor = TextColor.BRIGHT_BLUE;
        render.backgroundColor = TextColor.rgb(10, 20, 30);
        const sprites = new SpriteCellPassSettings();
        sprites.maxDepthFade = 12;
        sprites.colorQuantMask = 0xF0F0F0;
        sprites.backgroundColor = 0x102030;
        sprites.halfBlockCells = false;
        const meshes = new MeshCellPassSettings();
        meshes.colorQuantMask = FIVE_BITS_PER_CHANNEL_MASK;
        meshes.supersampleX = SUPERSAMPLE_X;
        meshes.supersampleY = SUPERSAMPLE_Y;
        meshes.threadAreaThreshold = Number.POSITIVE_INFINITY;
        meshes.halfBlockCells = false;
        meshes.lodTrianglesPerCell = LOD_TRIANGLES_PER_CELL;
        meshes.workerCount = FIXED_WORKERS;

        const source = new World({platform: new MemoryPlatform()});
        source.entityManager.createEntity("settings", [render, sprites, meshes, new CellAspectRatio()]);
        const saved = serializeWorld(source, registry);
        const components = saved.document.entities[0].components;
        expect(Object.keys(components)).toEqual(["CellRenderSettings", "SpriteCellPassSettings", "MeshCellPassSettings"]);
        expect(components.CellRenderSettings).toEqual({backgroundGlyph: ".", backgroundGlyphColor: {palette: 12}, backgroundColor: "#0a141e"});
        expect(components.MeshCellPassSettings.threadAreaThreshold).toBe("Infinity");
        expect(components.MeshCellPassSettings.workerCount).toBeUndefined();

        const target = new World({platform: new MemoryPlatform()});
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        const loadedMeshes = target.entityManager.getComponent<MeshCellPassSettings>(loaded.entities[0], MeshCellPassSettings)!;
        expect([loadedMeshes.colorQuantMask, loadedMeshes.halfBlockCells, loadedMeshes.lodTrianglesPerCell]).toEqual([FIVE_BITS_PER_CHANNEL_MASK, false, LOD_TRIANGLES_PER_CELL]);
        expect([loadedMeshes.supersampleX, loadedMeshes.supersampleY]).toEqual([SUPERSAMPLE_X, SUPERSAMPLE_Y]);
        expect(loadedMeshes.workerCount).toBe("auto");
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });
});
