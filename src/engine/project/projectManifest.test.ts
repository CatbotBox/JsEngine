import {describe, expect, test} from "../testing/harness";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "./projectManifest";
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

    test("a missing name is named", () => {
        expect(problemsOf(validateProjectManifest("{}"))).toEqual([`"name" is missing: give the project a name`]);
    });

    test("the entry is optional, so the generated bootstrap runs", () => {
        expect(validateProjectManifest(JSON.stringify({name: "Game"}), EXISTING_ENTRY)).toEqual({ok: true, manifest: {name: "Game"}});
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

describe("validateProjectManifest resources", () => {
    const base = {name: "Game", entry: "src/game.ts"};

    test("resource bindings come back normalised", () => {
        const resources = [{type: " SwarmTuning ", path: "./data\\swarm.tuning.asset.json"}, {type: "SwarmState", path: "data/state.asset.json"}];
        expect(validateProjectManifest(JSON.stringify({...base, resources}), EXISTING_ENTRY)).toEqual({ok: true, manifest: {...base, resources: [
            {type: "SwarmTuning", path: "data/swarm.tuning.asset.json"},
            {type: "SwarmState", path: "data/state.asset.json"},
        ]}});
        expect(validateProjectManifest(JSON.stringify({...base, resources: []}), EXISTING_ENTRY)).toEqual({ok: true, manifest: {...base, resources: []}});
    });

    test("every binding problem is named", () => {
        expect(problemsOf(validateProjectManifest(JSON.stringify({...base, resources: {type: "A"}}), EXISTING_ENTRY)))
            .toEqual([`"resources" must be an array of {"type", "path"} objects when present, got {"type":"A"}`]);
        const resources = [
            "data/a.asset.json",
            {path: "data/a.asset.json"},
            {type: "Tuning", path: "../outside.asset.json"},
            {type: "Other", path: "data/other.json"},
            {type: "Tuning", path: 3},
            {type: "Fine", path: "data/fine.asset.json"},
        ];
        expect(problemsOf(validateProjectManifest(JSON.stringify({...base, resources}), EXISTING_ENTRY))).toEqual([
            `"resources[0]" must be an object {"type", "path"}, got "data/a.asset.json"`,
            `"resources[1].type" must name a registered resource type, got undefined`,
            `"resources[2].path" "../outside.asset.json" must be a relative path that stays inside the project folder`,
            `"resources[3].path" "data/other.json" must name a .asset.json file`,
            `"resources[4].type" "Tuning" is already bound by "resources[2]"`,
            `"resources[4].path" must be a non-empty string path, got 3`,
        ]);
    });
});

describe("validateProjectManifest schemas", () => {
    const base = {name: "Game", entry: "src/game.ts"};

    test("the exclude list comes back trimmed, an empty object excludes nothing, and leaving it out is fine", () => {
        expect(validateProjectManifest(JSON.stringify({...base, schemas: {exclude: [" Debug ", "Cheat"]}}), EXISTING_ENTRY))
            .toEqual({ok: true, manifest: {...base, schemas: {exclude: ["Debug", "Cheat"]}}});
        expect(validateProjectManifest(JSON.stringify({...base, schemas: {}}), EXISTING_ENTRY)).toEqual({ok: true, manifest: {...base, schemas: {exclude: []}}});
        expect(validateProjectManifest(JSON.stringify(base), EXISTING_ENTRY)).toEqual({ok: true, manifest: base});
    });

    test("anything else is named", () => {
        const problems = (schemas: unknown) => problemsOf(validateProjectManifest(JSON.stringify({...base, schemas}), EXISTING_ENTRY));
        expect(problems(["Debug"])).toEqual([`"schemas" must be an object {"exclude": [type names]} when present, got ["Debug"]`]);
        expect(problems({exclude: "Debug"})).toEqual([`"schemas.exclude" must be an array of type names, got "Debug"`]);
        expect(problems({exclude: ["Debug", " ", 3]})).toEqual([
            `"schemas.exclude[1]" must be a non-empty type name, got " "`,
            `"schemas.exclude[2]" must be a non-empty type name, got 3`,
        ]);
    });
});

describe("validateProjectManifest systems", () => {
    const base = {name: "Game", entry: "src/game.ts"};

    test("the exclude list comes back trimmed beside the schema list, and leaving it out is fine", () => {
        expect(validateProjectManifest(JSON.stringify({...base, schemas: {exclude: ["Cheat"]}, systems: {exclude: [" DebugSystem "]}}), EXISTING_ENTRY))
            .toEqual({ok: true, manifest: {...base, schemas: {exclude: ["Cheat"]}, systems: {exclude: ["DebugSystem"]}}});
        expect(validateProjectManifest(JSON.stringify({...base, systems: {}}), EXISTING_ENTRY)).toEqual({ok: true, manifest: {...base, systems: {exclude: []}}});
        expect(validateProjectManifest(JSON.stringify(base), EXISTING_ENTRY)).toEqual({ok: true, manifest: base});
    });

    test("anything else is named under systems", () => {
        const problems = (systems: unknown) => problemsOf(validateProjectManifest(JSON.stringify({...base, systems}), EXISTING_ENTRY));
        expect(problems("DebugSystem")).toEqual([`"systems" must be an object {"exclude": [type names]} when present, got "DebugSystem"`]);
        expect(problems({exclude: [""]})).toEqual([`"systems.exclude[0]" must be a non-empty type name, got ""`]);
    });
});

describe("validateProjectManifest editorExtensions", () => {
    const base = {name: "Game", entry: "src/game.ts"};
    const existing = (path: string) => path === "src/game.ts" || path === "editor/extensions.ts";

    test("an existing code module inside the project comes back normalised, and leaving it out is fine", () => {
        expect(validateProjectManifest(JSON.stringify({...base, editorExtensions: " ./editor\\extensions.ts "}), existing))
            .toEqual({ok: true, manifest: {...base, editorExtensions: "editor/extensions.ts"}});
        expect(validateProjectManifest(JSON.stringify(base), existing)).toEqual({ok: true, manifest: base});
    });

    test("anything else is named", () => {
        const problems = (editorExtensions: unknown) => problemsOf(validateProjectManifest(JSON.stringify({...base, editorExtensions}), existing));
        expect(problems("")).toEqual([`"editorExtensions" must be a non-empty string path, got ""`]);
        expect(problems(3)).toEqual([`"editorExtensions" must be a non-empty string path, got 3`]);
        expect(problems("../shared/extensions.ts")).toEqual([`"editorExtensions" "../shared/extensions.ts" must be a relative path that stays inside the project folder`]);
        expect(problems("C:/tools/extensions.ts")).toEqual([`"editorExtensions" "C:/tools/extensions.ts" must be a relative path that stays inside the project folder`]);
        expect(problems("editor/extensions.json")).toEqual([`"editorExtensions" "editor/extensions.json" must name a .ts, .tsx, .js, .mjs module`]);
        expect(problems("editor/missing.ts")).toEqual([`"editorExtensions" names editor/missing.ts, which does not exist in the project folder`]);
    });
});
