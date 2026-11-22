import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {dirname, join, relative, resolve} from "path";
import {PROJECT_MANIFEST_FILE} from "../src/engine/project/projectManifest";
import {runCli} from "../src/toolchain/cli";
import {EXIT_FAILURE, EXIT_SUCCESS} from "../src/toolchain/cliArguments";
import {sampleProjectPaths} from "../src/toolchain/projectSites";
import {checkGeneratedFiles} from "../src/toolchain/generate/generatedFiles";
import {generatedFileHeader} from "../src/toolchain/generate/generatedHeader";
import {SCHEMAS_GENERATOR_NAME, SCHEMAS_GENERATOR_VERSION} from "../src/toolchain/generate/schemas";
import {SYSTEMS_GENERATOR_NAME, SYSTEMS_GENERATOR_VERSION} from "../src/toolchain/generate/systems";
import {GAME_GENERATOR_NAME, GAME_GENERATOR_VERSION} from "../src/toolchain/generate/gameModule";
import {MAINS_GENERATOR_NAME, MAINS_GENERATOR_VERSION} from "../src/toolchain/generate/mains";
import {
    editorWorkerMainFile,
    GENERATED_GAME_FILE,
    GENERATED_SCHEMAS_FILE,
    GENERATED_SYSTEMS_FILE,
    generatedBackendSystemsFile,
    TERMINAL_MAIN_FILE,
    webWorkerMainFile,
} from "../src/toolchain/projectLayout";

const ROOT = resolve(__dirname, "..");
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "generatedFiles-fixture-";
const OTHER_VERSION = SCHEMAS_GENERATOR_VERSION + 1;
const OTHER_SYSTEMS_VERSION = SYSTEMS_GENERATOR_VERSION + 1;
const HAND_EDIT = "// edited by hand\r\n";
const CELLS_BACKEND = "cells";
const SHARED_SYSTEM = "HealthSystem";
const CELLS_SYSTEM = "CellsHealthSystem";
const GAME_FILE = "game.ts";
const CELLS_SYSTEM_FILE = `backend/${CELLS_BACKEND}/cellsHealthSystem.ts`;
const START_SCENE = "scenes/start.scene.json";
const RESOURCE_BINDING = {type: "InputMap", path: "assets/input.asset.json"};
const OWN_ENTRY = "src/ownGame.ts";
const OWN_ENTRY_SOURCE = `export {startProject} from "../generated/game";\r\n`;

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function engineFrom(folder: string, file: string): string {
    return relative(dirname(join(folder, file)), join(ROOT, "src", "engine")).replace(/\\/g, "/");
}

function fixtureFiles(folder: string): Readonly<Record<string, string>> {
    return {
        [PROJECT_MANIFEST_FILE]: JSON.stringify({name: "Generated files fixture", startScene: START_SCENE, resources: [RESOURCE_BINDING]}),
        [GAME_FILE]: [
            `import {Component, System} from "${engineFrom(folder, GAME_FILE)}/core";`,
            `export class Health extends Component {`,
            `    public current = 3;`,
            `}`,
            `export class ${SHARED_SYSTEM} extends System {`,
            `}`,
            ``,
        ].join("\n"),
        [CELLS_SYSTEM_FILE]: [
            `import {System} from "${engineFrom(folder, CELLS_SYSTEM_FILE)}/core";`,
            `export class ${CELLS_SYSTEM} extends System {`,
            `}`,
            ``,
        ].join("\n"),
    };
}

function writeFixture(folder: string): void {
    for (const [path, text] of Object.entries(fixtureFiles(folder))) {
        mkdirSync(dirname(join(folder, path)), {recursive: true});
        writeFileSync(join(folder, path), text);
    }
}

async function checkDemosAreCurrent(): Promise<void> {
    for (const project of sampleProjectPaths()) {
        const exitCode = await runCli(["generate", "--check", "--project", join(ROOT, project)]);
        expect(exitCode === EXIT_SUCCESS, `${project}: jsengine generate --check passes (regenerate with bun run jsengine generate --project ${project})`);
    }
}

function stateOf(folder: string, generatedFile: string): string | undefined {
    return checkGeneratedFiles(folder).files.find(file => file.path === join(folder, generatedFile))?.state;
}

async function checkDetectsOutdatedFiles(): Promise<void> {
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    const generated = join(folder, GENERATED_SCHEMAS_FILE);
    try {
        writeFixture(folder);
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_FAILURE, "--check fails while the generated file is missing");
        expect(stateOf(folder, GENERATED_SCHEMAS_FILE) === "missing", "a missing generated file is reported as missing");

        expect(await runCli(["generate", "--project", folder]) === EXIT_SUCCESS, "generate writes the file");
        const written = readFileSync(generated, "utf8");
        expect(written.startsWith(generatedFileHeader(SCHEMAS_GENERATOR_NAME, SCHEMAS_GENERATOR_VERSION)), "the file starts with the generator name and version");
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_SUCCESS, "--check passes on the file generate wrote");

        writeFileSync(generated, written + HAND_EDIT);
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_FAILURE, "--check fails on a hand-edited file");
        expect(stateOf(folder, GENERATED_SCHEMAS_FILE) === "stale", "a hand-edited file is reported as stale");

        const header = generatedFileHeader(SCHEMAS_GENERATOR_NAME, SCHEMAS_GENERATOR_VERSION);
        writeFileSync(generated, written.replace(header, generatedFileHeader(SCHEMAS_GENERATOR_NAME, OTHER_VERSION)));
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_FAILURE, "--check fails on a file from another generator version");
        expect(stateOf(folder, GENERATED_SCHEMAS_FILE) === "otherVersion", "a file from another generator version is reported as a version mismatch");

        expect(await runCli(["generate", "--project", folder]) === EXIT_SUCCESS && readFileSync(generated, "utf8") === written, "generate rewrites an outdated file to the current output");
        expect(await runCli(["generate", "--check", "--project", join(folder, "missing")]) !== EXIT_SUCCESS, "a folder without a manifest is refused");
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

async function checkSystemLists(): Promise<void> {
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    const shared = join(folder, GENERATED_SYSTEMS_FILE);
    const cellsFile = generatedBackendSystemsFile(CELLS_BACKEND);
    const cells = join(folder, cellsFile);
    try {
        writeFixture(folder);
        expect(await runCli(["generate", "--project", folder]) === EXIT_SUCCESS, "generate writes the system lists");
        const sharedText = readFileSync(shared, "utf8");
        const cellsText = readFileSync(cells, "utf8");
        expect(sharedText.startsWith(generatedFileHeader(SYSTEMS_GENERATOR_NAME, SYSTEMS_GENERATOR_VERSION)), "a system list starts with the systems generator name and version");
        expect(sharedText.includes(`    ${SHARED_SYSTEM},`) && !sharedText.includes(CELLS_SYSTEM), `${GENERATED_SYSTEMS_FILE} lists ${SHARED_SYSTEM} and leaves the backend system out`);
        expect(cellsText.includes(`    ${CELLS_SYSTEM},`) && !cellsText.includes(`    ${SHARED_SYSTEM},`), `${cellsFile} lists ${CELLS_SYSTEM} only`);

        writeFileSync(cells, cellsText + HAND_EDIT);
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_FAILURE, "--check fails on a hand-edited backend system list");
        expect(stateOf(folder, cellsFile) === "stale", "a hand-edited backend system list is reported as stale");

        const header = generatedFileHeader(SYSTEMS_GENERATOR_NAME, SYSTEMS_GENERATOR_VERSION);
        writeFileSync(shared, sharedText.replace(header, generatedFileHeader(SYSTEMS_GENERATOR_NAME, OTHER_SYSTEMS_VERSION)));
        expect(stateOf(folder, GENERATED_SYSTEMS_FILE) === "otherVersion", "a system list from another generator version is reported as a version mismatch");

        const rewritten = await runCli(["generate", "--project", folder]) === EXIT_SUCCESS;
        expect(rewritten && readFileSync(shared, "utf8") === sharedText && readFileSync(cells, "utf8") === cellsText, "generate rewrites outdated system lists to the current output");
        expect(await runCli(["generate", "--check", "--project", folder]) === EXIT_SUCCESS, "--check passes on the rewritten system lists");
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

async function checkBootstraps(): Promise<void> {
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        writeFixture(folder);
        expect(await runCli(["generate", "--project", folder]) === EXIT_SUCCESS, "generate writes the bootstraps");
        const game = readFileSync(join(folder, GENERATED_GAME_FILE), "utf8");
        expect(game.startsWith(generatedFileHeader(GAME_GENERATOR_NAME, GAME_GENERATOR_VERSION)), `${GENERATED_GAME_FILE} starts with the game generator name and version`);
        expect(game.includes(JSON.stringify(START_SCENE)) && game.includes(`{type: "${RESOURCE_BINDING.type}", path: "${RESOURCE_BINDING.path}"}`), `${GENERATED_GAME_FILE} holds the manifest's start scene and resources as literals`);
        expect(game.includes("export function startProject(world: World"), `${GENERATED_GAME_FILE} exports startProject`);
        const terminal = readFileSync(join(folder, TERMINAL_MAIN_FILE), "utf8");
        expect(terminal.startsWith(generatedFileHeader(MAINS_GENERATOR_NAME, MAINS_GENERATOR_VERSION)), `${TERMINAL_MAIN_FILE} starts with the mains generator name and version`);
        const mains = [TERMINAL_MAIN_FILE, webWorkerMainFile(CELLS_BACKEND), editorWorkerMainFile(CELLS_BACKEND)].map(file => readFileSync(join(folder, file), "utf8"));
        expect(mains.every(text => text.includes(`import {startProject} from "./game";`)), "without an entry the mains start the generated game");

        writeFileSync(join(folder, PROJECT_MANIFEST_FILE), JSON.stringify({name: "Generated files fixture", entry: OWN_ENTRY}));
        mkdirSync(dirname(join(folder, OWN_ENTRY)), {recursive: true});
        writeFileSync(join(folder, OWN_ENTRY), OWN_ENTRY_SOURCE);
        expect(await runCli(["generate", "--project", folder]) === EXIT_SUCCESS, "generate follows a manifest entry");
        const ownMains = [TERMINAL_MAIN_FILE, webWorkerMainFile(CELLS_BACKEND), editorWorkerMainFile(CELLS_BACKEND)].map(file => readFileSync(join(folder, file), "utf8"));
        expect(ownMains.every(text => text.includes(`import {startProject} from "../src/ownGame";`)), `the mains start the manifest's entry ${OWN_ENTRY}`);
        expect(readFileSync(join(folder, GENERATED_GAME_FILE), "utf8").includes("export function startProject("), "the generated game is still written beside the dev's entry");
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

async function main(): Promise<void> {
    await checkDemosAreCurrent();
    await checkDetectsOutdatedFiles();
    await checkSystemLists();
    await checkBootstraps();
    if (failures > 0) {
        log(`${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        log("all generated file checks passed");
    }
}

void main();
