import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join} from "path";
import {afterEach, beforeEach, describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene";
import {CliError, EXIT_FAILURE, EXIT_SUCCESS, EXIT_USAGE} from "../cliArguments";
import {migrateCommand} from "./migrate";

const OLD_SCENE_VERSION = 1;
const EVICT_AFTER_FRAMES = 600;
const INDENT_SPACES = 2;
const CRLF = "\r\n";
const LF = "\n";
const SCENE_PATH = "scenes/main.scene.json";
const PREFAB_PATH = "prefabs/ship.prefab.json";
const ASSET_PATH = "assets/tuning.asset.json";
const GENERATED_SCENE_PATH = "generated/copy.scene.json";

let root = "";

function sceneJson(version: number, evictKey: string): object {
    return {
        format: SCENE_DOCUMENT_FORMAT,
        version,
        entities: [{id: 1, name: "settings", enabled: true, components: {GpuMeshPassSettings: {[evictKey]: EVICT_AFTER_FRAMES, sampleCount: "single"}}}],
    };
}

function formatted(value: object, lineBreak: string, end: string): string {
    return JSON.stringify(value, null, INDENT_SPACES).split(LF).join(lineBreak) + end;
}

function writeProjectFile(path: string, text: string): void {
    const target = join(root, path);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, text);
}

function readProjectFile(path: string): string {
    return readFileSync(join(root, path), "utf8");
}

async function failureOf(args: readonly string[]): Promise<CliError> {
    try {
        await migrateCommand(args);
    } catch (error) {
        if (error instanceof CliError) return error;
        throw error;
    }
    throw new Error("expected jsengine migrate to fail");
}

const OLD_SCENE_TEXT = formatted(sceneJson(OLD_SCENE_VERSION, "evictUnusedMeshAfterFrames"), CRLF, "");
const MIGRATED_SCENE_TEXT = formatted(sceneJson(SCENE_DOCUMENT_VERSION, "evictUnusedAfterFrames"), CRLF, "");
const CURRENT_PREFAB_TEXT = formatted({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}, LF, LF);
const ASSET_TEXT = formatted({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields: {}}, LF, LF);
const GENERATED_SCENE_TEXT = formatted(sceneJson(OLD_SCENE_VERSION, "evictUnusedMeshAfterFrames"), LF, "");

describe("jsengine migrate", () => {
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "jsengine-migrate-"));
        writeProjectFile(PROJECT_MANIFEST_FILE, "{}");
        writeProjectFile(SCENE_PATH, OLD_SCENE_TEXT);
        writeProjectFile(PREFAB_PATH, CURRENT_PREFAB_TEXT);
        writeProjectFile(ASSET_PATH, ASSET_TEXT);
        writeProjectFile(GENERATED_SCENE_PATH, GENERATED_SCENE_TEXT);
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    test("--check fails listing the older documents and writes nothing", async () => {
        const failure = await failureOf(["--project", root, "--check"]);
        expect(failure.exitCode).toBe(EXIT_FAILURE);
        expect(failure.details.length).toBe(1);
        expect(failure.details[0].endsWith(`${SCENE_PATH} (version ${OLD_SCENE_VERSION} -> ${SCENE_DOCUMENT_VERSION})`)).toBe(true);
        expect(readProjectFile(SCENE_PATH)).toBe(OLD_SCENE_TEXT);
    });

    test("rewrites older documents in the writer's format, keeping line breaks, and leaves current ones alone", async () => {
        expect(await migrateCommand(["--project", root])).toBe(EXIT_SUCCESS);
        expect(readProjectFile(SCENE_PATH)).toBe(MIGRATED_SCENE_TEXT);
        expect(readProjectFile(PREFAB_PATH)).toBe(CURRENT_PREFAB_TEXT);
        expect(readProjectFile(ASSET_PATH)).toBe(ASSET_TEXT);
        expect(readProjectFile(GENERATED_SCENE_PATH)).toBe(GENERATED_SCENE_TEXT);
        expect(await migrateCommand(["--project", root, "--check"])).toBe(EXIT_SUCCESS);
    });

    test("a document it cannot migrate fails the run before anything is written", async () => {
        const newer = formatted({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION + 1, type: "Tuning", fields: {}}, LF, LF);
        writeProjectFile(ASSET_PATH, newer);
        const failure = await failureOf(["--project", root]);
        expect(failure.exitCode).toBe(EXIT_FAILURE);
        expect(failure.details).toEqual([`Data asset "${ASSET_PATH}": version ${DATA_ASSET_VERSION + 1} is newer than the supported version ${DATA_ASSET_VERSION}`]);
        expect(readProjectFile(SCENE_PATH)).toBe(OLD_SCENE_TEXT);
    });

    test("a folder without a project manifest is a usage error", async () => {
        rmSync(join(root, PROJECT_MANIFEST_FILE));
        expect((await failureOf(["--project", root])).exitCode).toBe(EXIT_USAGE);
    });
});
