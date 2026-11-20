import {describe, expect, test} from "../../engine/testing/harness";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import {createProjectFiles, STARTER_SCENE_FILE} from "./projectTemplate";

describe("createProjectFiles", () => {
    test("writes only a manifest that starts the starter scene, and the scene", () => {
        const files = createProjectFiles("My Game");
        expect(files.map(file => file.path)).toEqual([PROJECT_MANIFEST_FILE, STARTER_SCENE_FILE]);
        const validation = validateProjectManifest(files[0].contents, path => files.some(file => file.path === path));
        expect(validation).toEqual({ok: true, manifest: {name: "My Game", startScene: STARTER_SCENE_FILE}});
    });

    test("the starter scene is an empty scene document", () => {
        expect(parseSceneDocument(createProjectFiles("Game")[1].contents).entities).toEqual([]);
    });

    test("an empty name throws", () => {
        expect(() => createProjectFiles("  ")).toThrow("A new project needs a non-empty name");
    });
});
