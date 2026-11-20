import {join} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {describeBuildErrors} from "./editorBuild";

describe("editor build errors", () => {
    test("an entry that does not export startProject names the entry and the export", () => {
        const projectFolder = join(process.cwd(), "demo", "game");
        const editorMain = join(projectFolder, "generated", "main.editor.worker.ts");
        const described = describeBuildErrors([
            {message: `No matching export in "demo/game/src/game.ts" for import "startProject"`, file: editorMain, line: 2, column: 9},
            {message: `Could not resolve: "./missing"`, file: join(projectFolder, "src", "game.ts"), line: 3, column: 20},
        ], {folder: projectFolder, entry: "src/game.ts", editorMain});
        expect(described).toEqual([
            "entry src/game.ts does not export startProject",
            `src/game.ts:3:20: Could not resolve: "./missing"`,
        ]);
    });
});
