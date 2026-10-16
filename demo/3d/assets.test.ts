import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {describe, expect, test} from "../../src/js_engine/testing/harness";
import {buildDemo3dManifest} from "./assets";
import type {Demo3dManifest, ManifestModel} from "./assets";

/** A strip of `triangles` triangles using material `m` from shared.mtl. */
function stripObj(triangles: number): string {
    const lines = ["mtllib shared.mtl", "usemtl m"];
    for (let i = 0; i < triangles + 2; i++) lines.push(`v ${i} ${i % 2} ${i * 0.5}`);
    for (let i = 1; i <= triangles; i++) lines.push(`f ${i} ${i + 1} ${i + 2}`);
    return lines.join("\n") + "\n";
}

function fetchedBytes(manifest: Demo3dManifest, model: ManifestModel): number {
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    return model.files.map(path => byPath.get(path)!).filter(file => file.statOnly !== true).reduce((sum, file) => sum + file.size, 0);
}

describe("buildDemo3dManifest", () => {
    test("a model over the byte threshold is lazy: its own files only, never a shared or stat-only one", () => {
        const root = mkdtempSync(join(tmpdir(), "jsengine-manifest-"));
        try {
            mkdirSync(join(root, "demo", "3d"), {recursive: true});
            writeFileSync(join(root, "demo", "3d", "shared.mtl"), "newmtl m\nKd 1 1 1\n");
            writeFileSync(join(root, "demo", "3d", "small.obj"), stripObj(1));
            writeFileSync(join(root, "demo", "3d", "big.obj"), stripObj(400));

            const eager = buildDemo3dManifest(root, {lazyModelBytes: Number.POSITIVE_INFINITY});
            expect(eager.files.some(file => file.lazy === true)).toBe(false);
            const [big, small] = eager.models;
            expect(eager.models.map(model => model.name)).toEqual(["big", "small"]);
            expect(big.files).toEqual(["demo/3d/big.obj", "demo/3d/big.obj.meshcache", "demo/3d/shared.mtl"]);
            const threshold = (fetchedBytes(eager, small) + fetchedBytes(eager, big)) / 2;
            expect(fetchedBytes(eager, big)).toBeGreaterThan(threshold);

            const manifest = buildDemo3dManifest(root, {lazyModelBytes: threshold});
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
