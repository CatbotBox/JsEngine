import {describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectEntry, ProjectFileChange, ProjectFileSystem} from "../project/projectFileSystem";
import type {GenerateProjectReport} from "../project/projectServerApi";
import type {EditorNoticeLevel} from "./editorSession";
import {inputMapText, withActionRenamed, withNewAction} from "./inputMapDraft";
import {
    DEFAULT_INPUT_MAP_PATH,
    GENERATE_UNAVAILABLE_TEXT,
    generateReportLines,
    inputMapPathOf,
    ProjectSettingsModel,
} from "./projectSettingsModel";

const INPUT_PATH = "assets/controls.asset.json";
const SCENE_PATH = "scenes/main.scene.json";
const MANIFEST = JSON.stringify({name: "Game", startScene: SCENE_PATH, resources: [{type: "InputMap", path: INPUT_PATH}]}, null, 2) + "\n";
const INPUT_TEXT = inputMapText({fields: {actions: []}, actions: [{name: "jump", bindings: [{kind: "key", key: "Space"}], saved: {}}]});
const GENERATED: GenerateProjectReport = {ok: true, written: ["generated/game.ts"], unchanged: ["generated/schemas.ts"], warnings: ["schemas.exclude names Nothing, which matches no type"]};

class MemoryFiles implements ProjectFileSystem {
    public readonly rootLabel = "game";
    public readonly texts: Map<string, string>;
    public readonly writes: string[] = [];

    public constructor(files: Readonly<Record<string, string>>) {
        this.texts = new Map(Object.entries(files));
    }

    public list(): Promise<readonly ProjectEntry[]> {
        return Promise.resolve([...this.texts].map(([path, text]): ProjectEntry => ({path, kind: "file", size: text.length, mtimeMs: 0})));
    }

    public async read(path: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.readText(path));
    }

    public readText(path: string): Promise<string> {
        const text = this.texts.get(path);
        return text === undefined ? Promise.reject(new Error(`No file ${path}`)) : Promise.resolve(text);
    }

    public write(path: string, contents: Uint8Array | string): Promise<void> {
        this.writes.push(path);
        this.texts.set(path, typeof contents === "string" ? contents : new TextDecoder().decode(contents));
        return Promise.resolve();
    }

    public remove(): Promise<void> {
        return Promise.resolve();
    }

    public rename(): Promise<void> {
        return Promise.resolve();
    }

    public makeDirectory(): Promise<void> {
        return Promise.resolve();
    }

    public onChange(_listener: (change: ProjectFileChange) => void): () => void {
        return () => undefined;
    }
}

interface Harness {
    readonly files: MemoryFiles;
    readonly model: ProjectSettingsModel;
    readonly reports: {level: EditorNoticeLevel, text: string}[];
    readonly events: string[];
}

async function opened(files: Readonly<Record<string, string>>, generate: (() => Promise<GenerateProjectReport>) | null = () => Promise.resolve(GENERATED)): Promise<Harness> {
    const memory = new MemoryFiles(files);
    const reports: {level: EditorNoticeLevel, text: string}[] = [];
    const events: string[] = [];
    const model = new ProjectSettingsModel({
        files: () => memory,
        report: (level, text) => reports.push({level, text}),
        ...(generate === null ? {} : {generate: () => {
            events.push("generate");
            return generate();
        }}),
        manifestSaved: () => {
            events.push("manifestSaved");
            return Promise.resolve();
        },
    });
    await model.load();
    return {files: memory, model, reports, events};
}

function loadedManifest(model: ProjectSettingsModel) {
    const manifest = model.manifest;
    if (manifest?.kind !== "loaded") throw new Error(`the manifest did not load: ${JSON.stringify(manifest)}`);
    return manifest;
}

function loadedInputMap(model: ProjectSettingsModel) {
    const inputMap = model.inputMap;
    if (inputMap.kind !== "loaded") throw new Error(`the input map did not load: ${JSON.stringify(inputMap)}`);
    return inputMap;
}

describe("project settings model", () => {
    test("loads the manifest and the input map the manifest binds, clean", async () => {
        const {model} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, [INPUT_PATH]: INPUT_TEXT, [SCENE_PATH]: "{}"});
        expect(loadedManifest(model).draft.name).toBe("Game");
        expect(loadedInputMap(model).path).toBe(INPUT_PATH);
        expect(model.dirty || model.savable).toBe(false);
        expect(model.projectFiles.has(SCENE_PATH)).toBe(true);
    });

    test("saving a manifest edit writes the file, tells the editor, runs generate and reports its result", async () => {
        const {files, model, reports, events} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, [INPUT_PATH]: INPUT_TEXT});
        model.setManifestDraft({...loadedManifest(model).draft, name: "Renamed", keep: ["Enemy"]});
        expect(model.manifestDirty && model.savable).toBe(true);
        expect(await model.save()).toBe(true);
        const written = files.texts.get(PROJECT_MANIFEST_FILE)!;
        const validation = validateProjectManifest(written);
        expect(validation.ok && validation.manifest.name === "Renamed" && validation.manifest.keep?.[0] === "Enemy").toBe(true);
        expect(files.writes).toEqual([PROJECT_MANIFEST_FILE]);
        expect(events).toEqual(["manifestSaved", "generate"]);
        expect(reports).toEqual([{level: "info", text: `Saved ${PROJECT_MANIFEST_FILE}`}, ...generateReportLines(GENERATED)]);
        expect(model.dirty).toBe(false);
        expect(loadedManifest(model).savedText).toBe(written);
    });

    test("saving an input map edit writes only the asset and runs no generate", async () => {
        const {files, model, events} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, [INPUT_PATH]: INPUT_TEXT});
        model.setInputMapDraft(withNewAction(loadedInputMap(model).draft, "fire"));
        expect(model.inputMapDirty).toBe(true);
        expect(await model.save()).toBe(true);
        expect(files.writes).toEqual([INPUT_PATH]);
        expect(events).toEqual([]);
        expect(files.texts.get(INPUT_PATH)!.includes("\"fire\"")).toBe(true);
        expect(model.dirty).toBe(false);
    });

    test("a draft with problems cannot be saved and writes nothing", async () => {
        const {files, model} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, [INPUT_PATH]: INPUT_TEXT});
        model.setManifestDraft({...loadedManifest(model).draft, startScene: "scenes/missing.json"});
        expect(model.savable).toBe(false);
        expect(model.manifestCheck()?.problems.has("startScene")).toBe(true);
        model.setManifestDraft({...loadedManifest(model).draft, startScene: SCENE_PATH});
        model.setInputMapDraft(withActionRenamed(loadedInputMap(model).draft, 0, ""));
        expect(model.savable).toBe(false);
        expect(await model.save()).toBe(false);
        expect(files.writes).toEqual([]);
    });

    test("the entry must name a module the project holds", async () => {
        const {model} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, "src/main.ts": ""});
        model.setManifestDraft({...loadedManifest(model).draft, entry: "src/other.ts"});
        expect(model.manifestCheck()?.problems.has("entry")).toBe(true);
        model.setManifestDraft({...loadedManifest(model).draft, entry: "src/main.ts"});
        expect(model.savable).toBe(true);
    });

    test("without a project server the save says how to generate by hand, and a failed generate is an error", async () => {
        const offline = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST}, null);
        offline.model.setManifestDraft({...loadedManifest(offline.model).draft, name: "Offline"});
        await offline.model.save();
        expect(offline.reports.at(-1)).toEqual({level: "info", text: GENERATE_UNAVAILABLE_TEXT});
        const failing = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST}, () => Promise.reject(new Error("bun crashed")));
        failing.model.setManifestDraft({...loadedManifest(failing.model).draft, name: "Failing"});
        await failing.model.save();
        expect(failing.reports.at(-1)).toEqual({level: "error", text: "jsengine generate failed:\nbun crashed"});
    });

    test("a change on disk reloads a clean document and flags a dirty one", async () => {
        const {files, model} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST, [INPUT_PATH]: INPUT_TEXT});
        files.texts.set(PROJECT_MANIFEST_FILE, MANIFEST.replace("\"Game\"", "\"Outside\""));
        await model.filesChanged([PROJECT_MANIFEST_FILE]);
        expect(loadedManifest(model).draft.name).toBe("Outside");
        expect(model.changedOnDisk.size).toBe(0);
        model.setInputMapDraft(withNewAction(loadedInputMap(model).draft));
        files.texts.set(INPUT_PATH, inputMapText({fields: {actions: []}, actions: []}));
        await model.filesChanged([`./${INPUT_PATH}`]);
        expect(model.changedOnDisk.has("inputMap") && model.inputMapDirty).toBe(true);
    });

    test("an unbound project gets a new input map bound in its manifest, which runs generate", async () => {
        const manifest = JSON.stringify({name: "Fresh"}, null, 2);
        const {files, model, events} = await opened({[PROJECT_MANIFEST_FILE]: manifest});
        expect(model.inputMap.kind).toBe("unbound");
        await model.createInputMap();
        expect(inputMapPathOf(files.texts.get(PROJECT_MANIFEST_FILE)!)).toBe(DEFAULT_INPUT_MAP_PATH);
        expect(files.texts.get(DEFAULT_INPUT_MAP_PATH)).toBe(inputMapText({fields: {actions: []}, actions: []}));
        expect(events).toEqual(["manifestSaved", "generate"]);
        expect(loadedInputMap(model).path).toBe(DEFAULT_INPUT_MAP_PATH);
    });

    test("a bound input map whose file is missing is created where the manifest points, with no manifest change", async () => {
        const {files, model, events} = await opened({[PROJECT_MANIFEST_FILE]: MANIFEST});
        expect(model.inputMap).toEqual({kind: "missing", path: INPUT_PATH});
        await model.createInputMap();
        expect(files.writes).toEqual([INPUT_PATH]);
        expect(events).toEqual([]);
        expect(loadedInputMap(model).draft.actions.length).toBe(0);
    });

    test("a manifest that is not a JSON object opens broken with the reason", async () => {
        const {model} = await opened({[PROJECT_MANIFEST_FILE]: "[1, 2]"});
        expect(model.manifest?.kind).toBe("broken");
    });

    test("generate results become console lines", () => {
        expect(generateReportLines({ok: true, written: [], unchanged: ["a", "b"], warnings: []})).toEqual([{level: "info", text: "jsengine generate: generated/ is up to date (2 files)"}]);
        expect(generateReportLines(GENERATED).map(line => line.level)).toEqual(["info", "warn"]);
        expect(generateReportLines({ok: false, errors: ["one", "two"]})).toEqual([{level: "error", text: "jsengine generate failed:\none\ntwo"}]);
    });
});
