import {describe, expect, test} from "../../engine/testing/harness";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {ENGINE_IMPORT_PREFIX, PROJECT_MANIFEST_FILE, STARTER_ENTRY_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import {createProjectFiles, STARTER_SCENE_FILE} from "./projectTemplate";

describe("createProjectFiles", () => {
    test("writes a manifest that validates against its own starter entry", () => {
        const files = createProjectFiles("My Game");
        expect(files.map(file => file.path)).toEqual([PROJECT_MANIFEST_FILE, STARTER_ENTRY_FILE, STARTER_SCENE_FILE]);
        const paths = new Set(files.map(file => file.path));
        const validation = validateProjectManifest(files[0].contents, path => paths.has(path));
        expect(validation).toEqual({ok: true, manifest: {name: "My Game", entry: STARTER_ENTRY_FILE}});
    });

    test("the starter entry exports the entry contract and imports the engine through the alias", () => {
        const entry = createProjectFiles("Game")[1].contents;
        expect(entry.includes("export function registerProjectSchemas(")).toBe(true);
        expect(entry.includes("export function setupProject(")).toBe(true);
        expect(entry.split("\n").filter(line => line.startsWith("import")).every(line => line.includes(`"${ENGINE_IMPORT_PREFIX}`))).toBe(true);
    });

    test("the starter scene is an empty scene document", () => {
        expect(parseSceneDocument(createProjectFiles("Game")[2].contents).entities).toEqual([]);
    });

    test("an empty name throws", () => {
        expect(() => createProjectFiles("  ")).toThrow("A new project needs a non-empty name");
    });
});
