import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {inflate} from "../../engine/rendering/3d";
import {ComponentSchemaRegistry, registerEngineComponentSchemas, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene";
import type {SceneDocument} from "../../engine/scene";
import {fsFileSource} from "../../engine/testing/fsFileSource";
import type {SyncFileSystem} from "../../engine/testing/fsFileSource";
import type {AssetManifestPrefab, ProjectAssetManifest} from "../../hosts/web/webProjectAssets";
import {buildProjectAssetManifest} from "./projectAssets";

const PROJECT_DIRECTORY = "games/demo";
const SMALL_STRIP_TRIANGLES = 1;
const BIG_STRIP_TRIANGLES = 400;
const ROOT_ENTITY_ID = 1;
const ON_DEMAND_BYTES = 4096;
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

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function fetchedBytes(manifest: ProjectAssetManifest, prefab: AssetManifestPrefab): number {
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    return prefab.files.map(path => byPath.get(path)!).filter(file => file.statOnly !== true).reduce((sum, file) => sum + file.size, 0);
}

function flagsOf(manifest: ProjectAssetManifest): Readonly<Record<string, string>> {
    return Object.fromEntries(manifest.files.map(file => [file.path, file.statOnly === true ? "stat-only" : file.lazy === true ? "lazy" : "up front"]));
}

function withModels(run: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), "jsengine-assets-"));
    try {
        writeProjectFile(root, "shared.mtl", "newmtl m\nKd 1 1 1\n");
        for (const model of [SMALL, BIG]) {
            writeProjectFile(root, `${model.name}.obj`, triangleStripObj(model.triangles));
            writeProjectFile(root, prefabPathOf(model), JSON.stringify(modelPrefab(model)));
        }
        run(root);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
}

describe("buildProjectAssetManifest", () => {
    test("records the files each prefab's meshes read, keeping the sources behind a fresh mesh cache stat-only", () => {
        withModels(root => {
            const manifest = buildProjectAssetManifest(root, PROJECT_DIRECTORY, disk, engineRegistry());
            expect(manifest.prefabs.map(prefab => [prefab.name, prefab.path, prefab.meshes])).toEqual([
                ["big", prefabPathOf(BIG), [`${PROJECT_DIRECTORY}/big.obj`]],
                ["small", prefabPathOf(SMALL), [`${PROJECT_DIRECTORY}/small.obj`]],
            ]);
            const [big, small] = manifest.prefabs;
            expect(big.files).toEqual([`${PROJECT_DIRECTORY}/big.obj`, `${PROJECT_DIRECTORY}/big.obj.meshcache`, `${PROJECT_DIRECTORY}/shared.mtl`]);
            expect(fetchedBytes(manifest, big)).toBeGreaterThan(fetchedBytes(manifest, small));
            expect(Object.values(flagsOf(manifest)).includes("lazy")).toBe(false);
        });
    });

    test("a prefab whose own files pass the on-demand size is fetched when the game loads it; shared and stat-only files are not", () => {
        withModels(root => {
            expect(flagsOf(buildProjectAssetManifest(root, PROJECT_DIRECTORY, disk, engineRegistry(), ON_DEMAND_BYTES))).toEqual({
                [`${PROJECT_DIRECTORY}/big.obj`]: "stat-only",
                [`${PROJECT_DIRECTORY}/big.obj.meshcache`]: "lazy",
                [`${PROJECT_DIRECTORY}/shared.mtl`]: "up front",
                [`${PROJECT_DIRECTORY}/small.obj`]: "stat-only",
                [`${PROJECT_DIRECTORY}/small.obj.meshcache`]: "up front",
            });
        });
    });

    test("a mesh a scene names directly is fetched up front even when it is large", () => {
        withModels(root => {
            writeProjectFile(root, "scenes/main.scene.json", JSON.stringify(modelPrefab(BIG)));
            expect(flagsOf(buildProjectAssetManifest(root, PROJECT_DIRECTORY, disk, engineRegistry(), ON_DEMAND_BYTES))[`${PROJECT_DIRECTORY}/big.obj.meshcache`]).toBe("up front");
        });
    });

    test("a project without meshes lists no files", () => {
        const root = mkdtempSync(join(tmpdir(), "jsengine-assets-"));
        try {
            writeProjectFile(root, "scenes/main.scene.json", JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}));
            expect(buildProjectAssetManifest(root, PROJECT_DIRECTORY, disk, engineRegistry())).toEqual({prefabs: [], files: []});
        } finally {
            rmSync(root, {recursive: true, force: true});
        }
    });
});
