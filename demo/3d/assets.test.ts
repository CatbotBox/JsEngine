import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join} from "path";
import {describe, expect, test} from "../../src/engine/testing/harness";
import {buildDemo3dManifest} from "./assets";
import type {Demo3dManifest, ManifestModel} from "./assets";
import {inflate} from "../../src/engine/rendering/3d";
import {ComponentSchemaRegistry, PrefabAsset, registerEngineComponentSchemas, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, serializeDataAsset} from "../../src/engine/scene";
import type {SceneDocument} from "../../src/engine/scene";
import {fsFileSource} from "../../src/engine/testing/fsFileSource";
import type {SyncFileSystem} from "../../src/engine/testing/fsFileSource";
import {DEMO_3D_TUNING_FILE} from "./modelCatalog";
import {registerGeneratedSchemas} from "./schemas.generated";
import {Demo3dTuning, ModelEntry} from "./tuning";

const PROJECT_DIRECTORY = "demo/3d";
const SMALL_STRIP_TRIANGLES = 1;
const BIG_STRIP_TRIANGLES = 400;
const ROOT_ENTITY_ID = 1;
const LOADED_UP_FRONT = false;
const LOADED_ON_DEMAND = true;
const disk = {files: fsFileSource(require("fs") as SyncFileSystem), inflate};

interface ModelFixture {
    readonly name: string;
    readonly triangles: number;
}

const SMALL: ModelFixture = {name: "small", triangles: SMALL_STRIP_TRIANGLES};
const BIG: ModelFixture = {name: "big", triangles: BIG_STRIP_TRIANGLES};

function triangleStripObj(triangles: number): string {
    const lines = ["mtllib shared.mtl", "usemtl m"];
    for (let i = 0; i < triangles + 2; i++) lines.push(`v ${i} ${i % 2} ${i * 0.5}`);
    for (let i = 1; i <= triangles; i++) lines.push(`f ${i} ${i + 1} ${i + 2}`);
    return lines.join("\n") + "\n";
}

function prefabPathOf(model: ModelFixture): string {
    return `prefabs/${model.name}.prefab.json`;
}

function modelPrefab(model: ModelFixture): SceneDocument {
    return {
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DOCUMENT_VERSION,
        entities: [{
            id: ROOT_ENTITY_ID,
            name: model.name,
            enabled: true,
            components: {RenderMesh: {mesh: {path: `${model.name}.obj`}, color: "#ffffff", faceCulling: "BackFaces"}},
        }],
    };
}

function writeProjectFile(root: string, path: string, text: string): void {
    const target = join(root, PROJECT_DIRECTORY, path);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, text);
}

function tuningText(models: readonly (readonly [ModelFixture, boolean])[]): string {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerGeneratedSchemas(registry);
    const tuning = new Demo3dTuning();
    tuning.models = models.map(([model, loadOnDemand]) => {
        const entry = new ModelEntry();
        entry.prefab = new PrefabAsset(prefabPathOf(model), modelPrefab(model));
        entry.loadOnDemand = loadOnDemand;
        return entry;
    });
    return serializeDataAsset(registry, tuning);
}

function fetchedBytes(manifest: Demo3dManifest, model: ManifestModel): number {
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    return model.files.map(path => byPath.get(path)!).filter(file => file.statOnly !== true).reduce((sum, file) => sum + file.size, 0);
}

describe("buildDemo3dManifest", () => {
    test("lists the tuning asset's model prefabs; a model loaded on demand is lazy: its own files only, never a shared or stat-only one", () => {
        const root = mkdtempSync(join(tmpdir(), "jsengine-manifest-"));
        try {
            writeProjectFile(root, "shared.mtl", "newmtl m\nKd 1 1 1\n");
            for (const model of [SMALL, BIG]) {
                writeProjectFile(root, `${model.name}.obj`, triangleStripObj(model.triangles));
                writeProjectFile(root, prefabPathOf(model), JSON.stringify(modelPrefab(model)));
            }

            writeProjectFile(root, DEMO_3D_TUNING_FILE, tuningText([[SMALL, LOADED_UP_FRONT], [BIG, LOADED_UP_FRONT]]));
            const eager = buildDemo3dManifest(root, PROJECT_DIRECTORY, disk);
            expect(eager.files.some(file => file.lazy === true)).toBe(false);
            const [small, big] = eager.models;
            expect(eager.models.map(model => [model.name, model.path, model.meshes])).toEqual([
                ["small", prefabPathOf(SMALL), ["demo/3d/small.obj"]],
                ["big", prefabPathOf(BIG), ["demo/3d/big.obj"]],
            ]);
            expect(big.files).toEqual(["demo/3d/big.obj", "demo/3d/big.obj.meshcache", "demo/3d/shared.mtl"]);
            expect(fetchedBytes(eager, big)).toBeGreaterThan(fetchedBytes(eager, small));

            writeProjectFile(root, DEMO_3D_TUNING_FILE, tuningText([[SMALL, LOADED_UP_FRONT], [BIG, LOADED_ON_DEMAND]]));
            const manifest = buildDemo3dManifest(root, PROJECT_DIRECTORY, disk);
            const flags = Object.fromEntries(manifest.files.map(file => [file.path, file.statOnly === true ? "stat-only" : file.lazy === true ? "lazy" : "eager"]));
            expect(flags).toEqual({
                "demo/3d/big.obj": "stat-only",
                "demo/3d/big.obj.meshcache": "lazy",
                "demo/3d/shared.mtl": "eager",
                "demo/3d/small.obj": "stat-only",
                "demo/3d/small.obj.meshcache": "eager",
            });
            expect(manifest.models).toEqual(eager.models);
        } finally {
            rmSync(root, {recursive: true, force: true});
        }
    });
});
