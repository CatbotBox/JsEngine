import {describe, expect, test} from "../../engine/testing/harness";
import {decodeMappings, displaySourcePath, inlineSourceMapText, parseStackFrame, projectRootOf, rewriteStack, SourceMap, stackFrameUrls} from "./sourceMaps";

const BUNDLE_URL = "http://localhost:4000/api/projects/demo/editor.worker.js?v=3";
const BLOB_BUNDLE_URL = "blob:http://localhost:4000/0b5e5c1e-1111-2222-3333-444455556666";
const OTHER_URL = "http://localhost:4000/editor.js";

const MAP_JSON = {
    version: 3,
    sources: ["../../Projects/Game/generated/main.editor-gpu.worker.ts", "../../Projects/Game/src/player.ts", "src/engine/core/world.ts"],
    names: ["move"],
    mappings: "AAAA;ACCA,QAAEA;;ACCD",
};

function utf8Base64(text: string): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function bundleText(map: object, mediaType: string = "data:application/json;base64,"): string {
    return `console.log("bundle");\n//# debugId=ABC\n//# sourceMappingURL=${mediaType}${utf8Base64(JSON.stringify(map))}\n`;
}

function sampleMap(): SourceMap {
    const map = SourceMap.parse(JSON.stringify(MAP_JSON));
    if (map === undefined) throw new Error("the sample map did not parse");
    return map;
}

describe("source map mappings", () => {
    test("segments decode per generated line with relative fields and negative deltas", () => {
        const decoded = decodeMappings(MAP_JSON.mappings);
        expect([...decoded.lineStarts]).toEqual([0, 1, 3, 3, 4]);
        expect([...decoded.segments]).toEqual([
            0, 0, 0, 0, -1,
            0, 1, 1, 0, -1,
            8, 1, 1, 2, 0,
            0, 2, 2, 1, -1,
        ]);
    });

    test("multi-digit values decode with continuation bits", () => {
        const decoded = decodeMappings("gBAAgB");
        expect([...decoded.segments]).toEqual([16, 0, 0, 16, -1]);
    });

    test("a one-field segment maps a generated column to no source", () => {
        const decoded = decodeMappings("AAAA,E;");
        expect([...decoded.lineStarts]).toEqual([0, 2, 2]);
        expect([...decoded.segments]).toEqual([0, 0, 0, 0, -1, 2, -1, -1, -1, -1]);
    });

    test("invalid characters are rejected", () => {
        expect(() => decodeMappings("AA!A")).toThrow();
        expect(SourceMap.parse(JSON.stringify({...MAP_JSON, mappings: "AA!A"}))).toBeUndefined();
    });
});

describe("source map lookup", () => {
    test("one-based generated positions map to the closest segment at or before them", () => {
        const map = sampleMap();
        expect(map.originalPosition(1, 1)).toEqual({source: "generated/main.editor-gpu.worker.ts", line: 1, column: 1});
        expect(map.originalPosition(2, 1)).toEqual({source: "src/player.ts", line: 2, column: 1});
        expect(map.originalPosition(2, 8)).toEqual({source: "src/player.ts", line: 2, column: 1});
        expect(map.originalPosition(2, 9)).toEqual({source: "src/player.ts", line: 2, column: 3, name: "move"});
        expect(map.originalPosition(2, 400)).toEqual({source: "src/player.ts", line: 2, column: 3, name: "move"});
        expect(map.originalPosition(4, 5)).toEqual({source: "src/engine/core/world.ts", line: 3, column: 2});
    });

    test("empty, missing and sourceless positions do not map", () => {
        const map = sampleMap();
        expect(map.originalPosition(3, 1)).toBeUndefined();
        expect(map.originalPosition(5, 1)).toBeUndefined();
        expect(map.originalPosition(0, 1)).toBeUndefined();
        const sourceless = SourceMap.parse(JSON.stringify({version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,E"}));
        expect(sourceless?.originalPosition(1, 3)).toBeUndefined();
    });

    test("maps that are not version 3 source maps are rejected", () => {
        expect(SourceMap.parse("not json")).toBeUndefined();
        expect(SourceMap.parse(JSON.stringify({...MAP_JSON, version: 2}))).toBeUndefined();
        expect(SourceMap.parse(JSON.stringify({...MAP_JSON, sources: [1]}))).toBeUndefined();
    });

    test("a source root is joined onto relative sources", () => {
        const map = SourceMap.parse(JSON.stringify({version: 3, sourceRoot: "../../lib/", sources: ["a.ts", "/abs/b.ts"], names: [], mappings: "AAAA"}));
        expect(map?.sources).toEqual(["lib/a.ts", "/abs/b.ts"]);
    });
});

describe("source paths", () => {
    test("the project root comes from the generated editor worker entry", () => {
        expect(projectRootOf(MAP_JSON.sources)).toBe("../../Projects/Game/");
        expect(projectRootOf(["generated/main.editor-cells.worker.ts"])).toBe("");
        expect(projectRootOf(["src/main.ts"])).toBeUndefined();
    });

    test("sources are shown project-relative, else without leading relative segments", () => {
        expect(displaySourcePath("../../Projects/Game/src/player.ts", "../../Projects/Game/")).toBe("src/player.ts");
        expect(displaySourcePath("../../../lib/x.ts", "../../Projects/Game/")).toBe("lib/x.ts");
        expect(displaySourcePath("./src/engine/core/world.ts", undefined)).toBe("src/engine/core/world.ts");
        expect(displaySourcePath("..\\..\\Game\\src\\a.ts", undefined)).toBe("Game/src/a.ts");
    });
});

describe("inline source maps", () => {
    test("the last inline base64 map is extracted and decoded as UTF-8", () => {
        const withText = {...MAP_JSON, sourcesContent: ["// café", "", ""]};
        const extracted = inlineSourceMapText(bundleText(withText));
        expect(extracted === undefined ? undefined : JSON.parse(extracted)).toEqual(withText);
    });

    test("a charset parameter before base64 is accepted", () => {
        const extracted = inlineSourceMapText(bundleText(MAP_JSON, "data:application/json;charset=utf-8;base64,"));
        expect(extracted === undefined ? undefined : JSON.parse(extracted)).toEqual(MAP_JSON);
    });

    test("bundles without an inline map have none", () => {
        expect(inlineSourceMapText("console.log(1);\n//# sourceMappingURL=bundle.js.map\n")).toBeUndefined();
        expect(inlineSourceMapText("console.log(1);")).toBeUndefined();
    });
});

describe("stack frames", () => {
    test("V8 named, V8 bare and Firefox frames parse with URLs containing colons", () => {
        expect(parseStackFrame(`    at Player.move (${BUNDLE_URL}:2:9)`)).toEqual({prefix: "    at Player.move (", url: BUNDLE_URL, line: 2, column: 9, suffix: ")"});
        expect(parseStackFrame(`    at async run (${BLOB_BUNDLE_URL}:4:5)`)).toEqual({prefix: "    at async run (", url: BLOB_BUNDLE_URL, line: 4, column: 5, suffix: ")"});
        expect(parseStackFrame(`    at ${BUNDLE_URL}:1:1`)).toEqual({prefix: "    at ", url: BUNDLE_URL, line: 1, column: 1, suffix: ""});
        expect(parseStackFrame(`move@${BUNDLE_URL}:2:9`)).toEqual({prefix: "move@", url: BUNDLE_URL, line: 2, column: 9, suffix: ""});
        expect(parseStackFrame(`@${BUNDLE_URL}:1:1`)).toEqual({prefix: "@", url: BUNDLE_URL, line: 1, column: 1, suffix: ""});
        expect(parseStackFrame("    at Array.forEach (<anonymous>)")).toBeUndefined();
        expect(parseStackFrame("Error: boom")).toBeUndefined();
    });

    test("frame URLs are collected once each", () => {
        const stack = [`    at a (${BUNDLE_URL}:1:1)`, `    at b (${BUNDLE_URL}:2:1)`, `    at c (${OTHER_URL}:3:1)`, "    at Array.map (<anonymous>)"].join("\n");
        expect([...stackFrameUrls(stack)]).toEqual([BUNDLE_URL, OTHER_URL]);
    });

    test("frames in a mapped bundle are rewritten and keep their raw frame; others stay", () => {
        const map = sampleMap();
        const stack = [
            `    at Player.move (${BUNDLE_URL}:2:9)`,
            `    at ${BUNDLE_URL}:4:5`,
            `    at gone (${BUNDLE_URL}:3:1)`,
            `    at page (${OTHER_URL}:2:9)`,
            "    at Array.forEach (<anonymous>)",
            `tick@${BUNDLE_URL}:1:1`,
        ].join("\r\n");
        const lines = rewriteStack(stack, url => url === BUNDLE_URL ? map : undefined);
        expect(lines).toEqual([
            {text: "    at Player.move (src/player.ts:2:3)", bundleFrame: `    at Player.move (${BUNDLE_URL}:2:9)`},
            {text: "    at src/engine/core/world.ts:3:2", bundleFrame: `    at ${BUNDLE_URL}:4:5`},
            {text: `    at gone (${BUNDLE_URL}:3:1)`, bundleFrame: undefined},
            {text: `    at page (${OTHER_URL}:2:9)`, bundleFrame: undefined},
            {text: "    at Array.forEach (<anonymous>)", bundleFrame: undefined},
            {text: "tick@generated/main.editor-gpu.worker.ts:1:1", bundleFrame: `tick@${BUNDLE_URL}:1:1`},
        ]);
    });
});
