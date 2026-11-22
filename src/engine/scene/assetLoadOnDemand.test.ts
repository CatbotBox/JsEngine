import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {Resource} from "../core";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {resourceSchema, structFields} from "./componentSchemaBuilder";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "./dataAssetDocument";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import type {PrefabAsset} from "./prefabAsset";
import {assetReferencesOfFields, LOAD_ON_DEMAND_FIELD_KEY, preloadAssetReferences} from "./sceneAssets";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";

const CATALOG_PATH = "assets/catalog.asset.json";
const SMALL_PREFAB_PATH = "prefabs/small.prefab.json";
const HUGE_PREFAB_PATH = "prefabs/huge.prefab.json";
const SMALL_MESH_PATH = "models/small.obj";
const HUGE_MESH_PATH = "models/huge.obj";

class CatalogEntry {
    public model: PrefabAsset | undefined = undefined;
    public loadOnDemand = false;
}

class LabelledEntry {
    public model: PrefabAsset | undefined = undefined;
    public loadOnDemand = "";
}

class Catalog extends Resource {
    public static readonly schema = resourceSchema(Catalog, "Catalog")
        .list("models", {kind: "struct", typeName: "CatalogEntry", create: () => new CatalogEntry(), fields: structFields<CatalogEntry>().prefab("model").boolean("loadOnDemand").build()})
        .list("labelled", {kind: "struct", typeName: "LabelledEntry", create: () => new LabelledEntry(), fields: structFields<LabelledEntry>().prefab("model").string("loadOnDemand").build()})
        .build();

    public models: CatalogEntry[] = [];
    public labelled: LabelledEntry[] = [];
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    result.registerResourceClass(Catalog);
    return result;
}

function prefabWithMesh(meshPath: string): string {
    return JSON.stringify({
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DOCUMENT_VERSION,
        entities: [{id: 1, name: "model", enabled: true, components: {RenderMesh: {mesh: {path: meshPath}, color: "#ffffff", faceCulling: "BackFaces"}}}],
    });
}

function catalogText(models: readonly {readonly model: {readonly path: string}, readonly loadOnDemand: boolean}[]): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Catalog", fields: {models, labelled: []}});
}

async function preloadBatches(catalog: string): Promise<string[][]> {
    const platform = new MemoryPlatform({files: {
        [CATALOG_PATH]: catalog,
        [SMALL_PREFAB_PATH]: prefabWithMesh(SMALL_MESH_PATH),
        [HUGE_PREFAB_PATH]: prefabWithMesh(HUGE_MESH_PATH),
    }});
    const batches: string[][] = [];
    await preloadAssetReferences([{kind: "Catalog", path: CATALOG_PATH}], registry(), platform.files, async paths => {
        batches.push([...paths]);
    });
    return batches;
}

describe("assets loaded on demand", () => {
    test("references in a struct whose boolean loadOnDemand is true are marked; other references are not", () => {
        const fields = registry().resourceByName("Catalog")!.fields;
        const references = assetReferencesOfFields(fields, {
            models: [{model: {path: SMALL_PREFAB_PATH}, [LOAD_ON_DEMAND_FIELD_KEY]: false}, {model: {path: HUGE_PREFAB_PATH}, [LOAD_ON_DEMAND_FIELD_KEY]: true}],
            labelled: [],
        });
        expect(references).toEqual([
            {kind: "prefab", path: SMALL_PREFAB_PATH},
            {kind: "prefab", path: HUGE_PREFAB_PATH, loadOnDemand: true},
        ]);
    });

    test("a loadOnDemand field that is not a boolean does not mark anything", () => {
        const fields = registry().resourceByName("Catalog")!.fields;
        const references = assetReferencesOfFields(fields, {models: [], labelled: [{model: {path: HUGE_PREFAB_PATH}, [LOAD_ON_DEMAND_FIELD_KEY]: true}]});
        expect(references).toEqual([{kind: "prefab", path: HUGE_PREFAB_PATH}]);
    });

    test("an asset referenced both on demand and up front counts as up front", () => {
        const fields = registry().resourceByName("Catalog")!.fields;
        const references = assetReferencesOfFields(fields, {
            models: [{model: {path: HUGE_PREFAB_PATH}, [LOAD_ON_DEMAND_FIELD_KEY]: true}, {model: {path: HUGE_PREFAB_PATH}, [LOAD_ON_DEMAND_FIELD_KEY]: false}],
            labelled: [],
        });
        expect(references).toEqual([{kind: "prefab", path: HUGE_PREFAB_PATH}]);
    });

    test("preloading fetches an on-demand prefab's own file but not what it references", async () => {
        const batches = await preloadBatches(catalogText([
            {model: {path: SMALL_PREFAB_PATH}, loadOnDemand: false},
            {model: {path: HUGE_PREFAB_PATH}, loadOnDemand: true},
        ]));
        expect(batches).toEqual([[CATALOG_PATH], [SMALL_PREFAB_PATH, HUGE_PREFAB_PATH], [SMALL_MESH_PATH]]);
    });

    test("without the flag every prefab is preloaded all the way down", async () => {
        const batches = await preloadBatches(catalogText([
            {model: {path: SMALL_PREFAB_PATH}, loadOnDemand: false},
            {model: {path: HUGE_PREFAB_PATH}, loadOnDemand: false},
        ]));
        expect(batches).toEqual([[CATALOG_PATH], [SMALL_PREFAB_PATH, HUGE_PREFAB_PATH], [SMALL_MESH_PATH, HUGE_MESH_PATH]]);
    });
});
