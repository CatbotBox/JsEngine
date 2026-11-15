import {describe, expect, test} from "../../engine/testing/harness";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {
    createProjectFiles,
    ENGINE_IMPORT_PREFIX,
    PROJECT_MANIFEST_FILE,
    STARTER_ENTRY_FILE,
    STARTER_SCENE_FILE,
    validateProjectManifest,
} from "./projectManifest";
import type {ProjectManifestValidation} from "./projectManifest";
import {projectFileExtension, projectRelativePath} from "./projectPaths";

function problemsOf(validation: ProjectManifestValidation): readonly string[] {
    return validation.ok ? [] : validation.problems;
}

const EXISTING_ENTRY = (path: string) => path === "src/game.ts";

describe("project paths", () => {
    test("relative paths normalise and anything leaving the folder is rejected", () => {
        expect(projectRelativePath("./src//game.ts")).toBe("src/game.ts");
        expect(projectRelativePath("src\\game.ts")).toBe("src/game.ts");
        expect(projectRelativePath("../game.ts")).toBeUndefined();
        expect(projectRelativePath("src/../../game.ts")).toBeUndefined();
        expect(projectRelativePath("/etc/passwd")).toBeUndefined();
        expect(projectRelativePath("C:/game.ts")).toBeUndefined();
        expect(projectRelativePath("..\\game.ts")).toBeUndefined();
        expect(projectRelativePath("game\0.ts")).toBeUndefined();
        expect(projectRelativePath(".")).toBeUndefined();
        expect(projectRelativePath("")).toBeUndefined();
    });

    test("extensions are lower-cased and a leading dot is not an extension", () => {
        expect(projectFileExtension("a/B.TS")).toBe(".ts");
        expect(projectFileExtension("scenes/main.scene.json")).toBe(".json");
        expect(projectFileExtension(".gitignore")).toBe("");
    });
});

describe("validateProjectManifest", () => {
    test("a valid manifest comes back normalised", () => {
        const validation = validateProjectManifest(JSON.stringify({name: " Game ", entry: "./src/game.ts", startScene: "scenes/main.scene.json"}), EXISTING_ENTRY);
        expect(validation).toEqual({ok: true, manifest: {name: "Game", entry: "src/game.ts", startScene: "scenes/main.scene.json"}});
    });

    test("startScene is optional", () => {
        expect(validateProjectManifest(JSON.stringify({name: "Game", entry: "src/game.ts"}), EXISTING_ENTRY))
            .toEqual({ok: true, manifest: {name: "Game", entry: "src/game.ts"}});
    });

    test("a missing file, invalid JSON and a non-object each name the problem", () => {
        expect(problemsOf(validateProjectManifest(undefined))[0]).toBe(`${PROJECT_MANIFEST_FILE} is missing: this folder is not a JsEngine project`);
        expect(problemsOf(validateProjectManifest("{name: 1"))[0].startsWith(`${PROJECT_MANIFEST_FILE} is not valid JSON`)).toBe(true);
        expect(problemsOf(validateProjectManifest("[1]"))[0]).toBe(`${PROJECT_MANIFEST_FILE} must hold a JSON object, got [1]`);
    });

    test("every field problem is listed at once", () => {
        const problems = problemsOf(validateProjectManifest(JSON.stringify({name: "", entry: "../outside.ts", startScene: 3})));
        expect(problems).toEqual([
            `"name" must be a non-empty string, got ""`,
            `"entry" "../outside.ts" must be a relative path that stays inside the project folder`,
            `"startScene" must be a non-empty string path when present, got 3`,
        ]);
    });

    test("missing fields are named", () => {
        expect(problemsOf(validateProjectManifest("{}"))).toEqual([
            `"name" is missing: give the project a name`,
            `"entry" is missing: name the game entry module, e.g. "${STARTER_ENTRY_FILE}"`,
        ]);
    });

    test("the entry must be a module that exists", () => {
        expect(problemsOf(validateProjectManifest(JSON.stringify({name: "Game", entry: "game.json"}), EXISTING_ENTRY)))
            .toEqual([`"entry" "game.json" must name a .ts, .tsx, .js, .mjs module`]);
        expect(problemsOf(validateProjectManifest(JSON.stringify({name: "Game", entry: "missing.ts"}), EXISTING_ENTRY)))
            .toEqual([`"entry" names missing.ts, which does not exist in the project folder`]);
        expect(validateProjectManifest(JSON.stringify({name: "Game", entry: "missing.ts"})).ok).toBe(true);
    });

    test("the start scene must be a .scene.json inside the folder", () => {
        expect(problemsOf(validateProjectManifest(JSON.stringify({name: "Game", entry: "src/game.ts", startScene: "main.json"}), EXISTING_ENTRY)))
            .toEqual([`"startScene" "main.json" must name a .scene.json file`]);
        expect(problemsOf(validateProjectManifest(JSON.stringify({name: "Game", entry: "src/game.ts", startScene: "/main.scene.json"}), EXISTING_ENTRY)))
            .toEqual([`"startScene" "/main.scene.json" must be a relative path that stays inside the project folder`]);
    });
});

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
