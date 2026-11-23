import {describe, expect, test} from "../../engine/testing/harness";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import {createProjectFiles, STARTER_CAMERA_NAME, STARTER_SCENE_FILE} from "./projectTemplate";

describe("createProjectFiles", () => {
    test("writes only a manifest that starts the starter scene, and the scene", () => {
        const files = createProjectFiles("My Game");
        expect(files.map(file => file.path)).toEqual([PROJECT_MANIFEST_FILE, STARTER_SCENE_FILE]);
        const validation = validateProjectManifest(files[0].contents, path => files.some(file => file.path === path));
        expect(validation).toEqual({ok: true, manifest: {name: "My Game", startScene: STARTER_SCENE_FILE}});
    });

    test("the starter scene holds just a camera, since a world with nothing to render never shows its first frame and the editor would wait for it forever", () => {
        const entities = parseSceneDocument(createProjectFiles("Game")[1].contents).entities;
        expect(entities.map(entity => [entity.name, Object.keys(entity.components).sort()])).toEqual([[STARTER_CAMERA_NAME, ["Camera", "LocalPosition"]]]);
    });

    test("an empty name throws", () => {
        expect(() => createProjectFiles("  ")).toThrow("A new project needs a non-empty name");
    });
});
