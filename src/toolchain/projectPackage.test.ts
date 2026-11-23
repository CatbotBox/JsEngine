import {mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {describe, expect, test} from "../engine/testing/harness";
import {linkedPackageManifest, PROJECT_COMPILER_SETTINGS, projectTsconfig} from "./projectPackage";
import {ENGINE_PACKAGES, PACKAGE_MANIFEST_FILE} from "./publicEntryPoints";
import {slashed} from "./repoPaths";

const FIXTURE_PREFIX = join(tmpdir(), "jsengine-project-package-");
const LINK_PROTOCOL = "link:";

function withFolder<T>(body: (folder: string) => T): T {
    const folder = mkdtempSync(FIXTURE_PREFIX);
    try {
        return body(folder);
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

function linkedEngine(): Record<string, string> {
    return Object.fromEntries(ENGINE_PACKAGES.map(enginePackage => [enginePackage.name, LINK_PROTOCOL + slashed(enginePackage.folder)]));
}

describe("project package", () => {
    test("a project without a package.json gets a private commonjs one linking every engine package of this checkout", () => {
        const manifest = withFolder(folder => linkedPackageManifest(folder));
        expect(manifest.private).toBe(true);
        expect(manifest.type).toBe("commonjs");
        expect(typeof manifest.name).toBe("string");
        expect(manifest.dependencies).toEqual(linkedEngine());
    });

    test("an existing package.json keeps its fields and other dependencies, and its engine links point at this checkout", () => {
        const manifest = withFolder(folder => {
            const existing = {name: "my-game", version: "1.2.3", scripts: {start: "bun jsengine run"}, dependencies: {"@jsengine/engine": "link:/elsewhere/src/engine", "left-pad": "^1.3.0"}};
            writeFileSync(join(folder, PACKAGE_MANIFEST_FILE), JSON.stringify(existing));
            return linkedPackageManifest(folder);
        });
        expect(manifest.name).toBe("my-game");
        expect(manifest.version).toBe("1.2.3");
        expect(manifest.scripts).toEqual({start: "bun jsengine run"});
        expect(manifest.dependencies).toEqual({...linkedEngine(), "left-pad": "^1.3.0"});
    });

    test("the project tsconfig uses the generator's compiler settings, so its typecheck resolves the engine through the packages' exports", () => {
        const options = projectTsconfig().compilerOptions as Readonly<Record<string, unknown>>;
        for (const [key, value] of Object.entries(PROJECT_COMPILER_SETTINGS)) expect(options[key]).toBe(value);
        expect(options.moduleResolution).toBe("Bundler");
    });
});
