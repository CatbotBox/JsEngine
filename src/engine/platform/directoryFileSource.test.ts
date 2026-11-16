import {describe, expect, test} from "../testing/harness";
import {MemoryFileSource} from "../testing/memoryPlatform";
import {directoryFileSource} from "./directoryFileSource";
import type {FileSource} from "./platform";

const MANIFEST_TEXT = "{\"name\": \"demo\"}";
const ASSET_TEXT = "{}";
const WRITTEN = new Uint8Array([1, 2, 3]);

function memoryFiles(): MemoryFileSource {
    return new MemoryFileSource({
        "demo/swarm/jsengine.project.json": MANIFEST_TEXT,
        "demo/swarm/assets/input.asset.json": ASSET_TEXT,
    });
}

describe("directoryFileSource", () => {
    test("reads, checks and stats paths relative to the directory", () => {
        const files = directoryFileSource(memoryFiles(), "demo/swarm");
        expect(files.readText("jsengine.project.json")).toBe(MANIFEST_TEXT);
        expect(files.exists("assets/input.asset.json")).toBe(true);
        expect(files.exists("demo/swarm/assets/input.asset.json")).toBe(false);
        expect(files.stat?.("assets/input.asset.json").size).toBe(ASSET_TEXT.length);
    });

    test("writes below the directory when the source can write", () => {
        const memory = memoryFiles();
        directoryFileSource(memory, "./demo/swarm/").write?.("assets/new.asset.json", WRITTEN);
        expect(memory.readBytes("demo/swarm/assets/new.asset.json")).toEqual(WRITTEN);
    });

    test("the current directory is the source itself, and a source without stat or write gets neither", () => {
        const memory = memoryFiles();
        expect(directoryFileSource(memory, ".")).toBe(memory);
        expect(directoryFileSource(memory, "")).toBe(memory);
        const readOnly: FileSource = {readBytes: path => memory.readBytes(path), readText: path => memory.readText(path), exists: path => memory.exists(path)};
        const viewed = directoryFileSource(readOnly, "demo");
        expect([viewed.stat, viewed.write]).toEqual([undefined, undefined]);
    });
});
