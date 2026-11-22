import {INPUT_MAP_RESOURCE_NAME} from "../../engine/input/inputMap";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import type {GenerateProjectReport} from "../project/projectServerApi";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorNoticeLevel} from "./editorSession";
import {EMPTY_INPUT_MAP, inputMapProblems, inputMapText, isInputMapDirty, openInputMapDraft} from "./inputMapDraft";
import type {InputMapDraft} from "./inputMapDraft";
import {normalizeProjectPath} from "./projectFiles";
import {checkManifestDraft, isManifestDraftDirty, manifestWithResource, openManifestDraft} from "./projectManifestEdits";
import type {ManifestDraft, ManifestDraftCheck} from "./projectManifestEdits";

export interface ProjectSettingsServices {
    readonly files: () => ProjectFileSystem;
    readonly report: (level: EditorNoticeLevel, text: string) => void;
    readonly generate?: () => Promise<GenerateProjectReport>;
    readonly manifestSaved?: () => Promise<void>;
}

export type ManifestState =
    | {readonly kind: "loaded", readonly savedText: string, readonly draft: ManifestDraft}
    | {readonly kind: "broken", readonly problems: readonly string[]};

export type InputMapState =
    | {readonly kind: "unbound"}
    | {readonly kind: "missing", readonly path: string}
    | {readonly kind: "broken", readonly path: string, readonly problems: readonly string[]}
    | {readonly kind: "loaded", readonly path: string, readonly savedText: string, readonly saved: InputMapDraft, readonly draft: InputMapDraft};

export type ProjectSettingsDocument = "manifest" | "inputMap";

export interface GenerateReportLine {
    readonly level: EditorNoticeLevel;
    readonly text: string;
}

export const DEFAULT_INPUT_MAP_PATH = "assets/input.asset.json";
export const GENERATE_UNAVAILABLE_TEXT = `Saved ${PROJECT_MANIFEST_FILE}, but this editor has no project server to run jsengine generate; run it in a terminal to update generated/`;

const RESOURCES_KEY = "resources";
const GENERATE_LABEL = "jsengine generate";
const LINE_BREAK = "\n";

function isRecord(value: unknown): value is {readonly [key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inputMapPathOf(manifestText: string): string | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(manifestText);
    } catch {
        return undefined;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed[RESOURCES_KEY])) return undefined;
    const binding = (parsed[RESOURCES_KEY] as unknown[]).find(entry => isRecord(entry) && entry.type === INPUT_MAP_RESOURCE_NAME && typeof entry.path === "string");
    return isRecord(binding) ? normalizeProjectPath(binding.path as string) : undefined;
}

export function generateReportLines(report: GenerateProjectReport): GenerateReportLine[] {
    if (!report.ok) return [{level: "error", text: `${GENERATE_LABEL} failed:${LINE_BREAK}${report.errors.join(LINE_BREAK)}`}];
    const summary = report.written.length === 0
        ? `${GENERATE_LABEL}: generated/ is up to date (${report.unchanged.length} files)`
        : `${GENERATE_LABEL} wrote ${report.written.join(", ")}; the game code reloads once the editor worker rebuilds`;
    return [{level: "info", text: summary}, ...report.warnings.map((warning): GenerateReportLine => ({level: "warn", text: `${GENERATE_LABEL}: ${warning}`}))];
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class ProjectSettingsModel {
    public manifest: ManifestState | undefined;
    public inputMap: InputMapState = {kind: "unbound"};
    public projectFiles: ReadonlySet<string> = new Set();
    public readonly changedOnDisk = new Set<ProjectSettingsDocument>();
    public saving = false;
    public revision = 0;
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly services: ProjectSettingsServices) {
    }

    public onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public get manifestDirty(): boolean {
        const manifest = this.manifest;
        return manifest?.kind === "loaded" && isManifestDraftDirty(manifest.savedText, manifest.draft);
    }

    public get inputMapDirty(): boolean {
        const inputMap = this.inputMap;
        return inputMap.kind === "loaded" && isInputMapDirty(inputMap.saved, inputMap.draft);
    }

    public get dirty(): boolean {
        return this.manifestDirty || this.inputMapDirty;
    }

    public manifestCheck(): ManifestDraftCheck | undefined {
        const manifest = this.manifest;
        if (manifest?.kind !== "loaded") return undefined;
        return checkManifestDraft(manifest.savedText, manifest.draft, path => this.projectFiles.has(normalizeProjectPath(path)));
    }

    public inputMapProblems(): ReadonlyMap<number, readonly string[]> {
        return this.inputMap.kind === "loaded" ? inputMapProblems(this.inputMap.draft) : new Map();
    }

    public get savable(): boolean {
        if (!this.dirty || this.saving) return false;
        const manifestValid = !this.manifestDirty || this.manifestCheck()?.valid === true;
        const inputMapValid = !this.inputMapDirty || this.inputMapProblems().size === 0;
        return manifestValid && inputMapValid;
    }

    public async load(): Promise<void> {
        this.changedOnDisk.clear();
        await this.refreshFiles();
        await this.loadManifest();
        await this.loadInputMap();
        this.changed();
    }

    public setManifestDraft(draft: ManifestDraft): void {
        const manifest = this.manifest;
        if (manifest?.kind !== "loaded") return;
        this.manifest = {...manifest, draft};
        this.changed();
    }

    public setInputMapDraft(draft: InputMapDraft): void {
        const inputMap = this.inputMap;
        if (inputMap.kind !== "loaded") return;
        this.inputMap = {...inputMap, draft};
        this.changed();
    }

    public async save(): Promise<boolean> {
        if (!this.savable) return false;
        this.saving = true;
        this.changed();
        try {
            if (this.inputMapDirty) await this.saveInputMap();
            if (this.manifestDirty) await this.saveManifest();
            this.changedOnDisk.clear();
            return true;
        } catch (error) {
            this.services.report("error", `Could not save the project settings: ${describeError(error)}`);
            return false;
        } finally {
            this.saving = false;
            this.changed();
        }
    }

    public async createInputMap(): Promise<void> {
        const manifest = this.manifest;
        const inputMap = this.inputMap;
        if (manifest?.kind !== "loaded" || this.manifestDirty || (inputMap.kind !== "unbound" && inputMap.kind !== "missing")) return;
        const path = inputMap.kind === "missing" ? inputMap.path : DEFAULT_INPUT_MAP_PATH;
        const files = this.services.files();
        try {
            if (!this.projectFiles.has(path)) await files.write(path, inputMapText(EMPTY_INPUT_MAP));
            else if (!openInputMapDraft(await files.readText(path), path).ok) throw new Error(`${path} already exists and is not an ${INPUT_MAP_RESOURCE_NAME} data asset`);
            if (inputMap.kind === "unbound") {
                const edit = manifestWithResource(manifest.savedText, {type: INPUT_MAP_RESOURCE_NAME, path});
                if (!edit.ok) throw new Error(`${PROJECT_MANIFEST_FILE}: ${edit.problems.join("; ")}`);
                await this.writeManifest(edit.text);
                await this.afterManifestSaved();
            }
            this.services.report("info", `${path} holds the project's input map`);
        } catch (error) {
            this.services.report("error", `Could not create the input map: ${describeError(error)}`);
        }
        await this.load();
    }

    public async filesChanged(paths: readonly string[]): Promise<void> {
        const changed = new Set(paths.map(normalizeProjectPath));
        await this.refreshFiles();
        if (changed.has(PROJECT_MANIFEST_FILE)) await this.manifestChangedOnDisk();
        const inputMap = this.inputMap;
        if (inputMap.kind !== "unbound" && changed.has(inputMap.path)) await this.inputMapChangedOnDisk();
        this.changed();
    }

    private changed(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private async refreshFiles(): Promise<void> {
        try {
            const entries = await this.services.files().list();
            this.projectFiles = new Set(entries.filter(entry => entry.kind === "file").map(entry => normalizeProjectPath(entry.path)));
        } catch (error) {
            this.services.report("error", `Could not list the project files: ${describeError(error)}`);
        }
    }

    private async readText(path: string): Promise<string | undefined> {
        return await this.services.files().readText(path).catch(() => undefined);
    }

    private async loadManifest(): Promise<void> {
        this.revision++;
        this.changedOnDisk.delete("manifest");
        const text = await this.readText(PROJECT_MANIFEST_FILE);
        if (text === undefined) {
            this.manifest = {kind: "broken", problems: [`${PROJECT_MANIFEST_FILE} could not be read`]};
            return;
        }
        const opened = openManifestDraft(text);
        this.manifest = opened.ok ? {kind: "loaded", savedText: text, draft: opened.draft} : {kind: "broken", problems: opened.problems};
    }

    private async loadInputMap(): Promise<void> {
        this.revision++;
        this.changedOnDisk.delete("inputMap");
        const manifest = this.manifest;
        const path = manifest?.kind === "loaded" ? inputMapPathOf(manifest.savedText) : undefined;
        if (path === undefined) {
            this.inputMap = {kind: "unbound"};
            return;
        }
        if (!this.projectFiles.has(path)) {
            this.inputMap = {kind: "missing", path};
            return;
        }
        const text = await this.readText(path);
        const opened = text === undefined ? {ok: false as const, problems: [`${path} could not be read`]} : openInputMapDraft(text, path);
        this.inputMap = opened.ok && text !== undefined
            ? {kind: "loaded", path, savedText: text, saved: opened.draft, draft: opened.draft}
            : {kind: "broken", path, problems: opened.ok ? [] : opened.problems};
    }

    private async manifestChangedOnDisk(): Promise<void> {
        const manifest = this.manifest;
        const text = await this.readText(PROJECT_MANIFEST_FILE);
        if (manifest?.kind === "loaded" && text === manifest.savedText) return;
        if (manifest?.kind === "loaded" && this.manifestDirty) {
            this.changedOnDisk.add("manifest");
            return;
        }
        await this.loadManifest();
        if (!this.inputMapDirty) await this.loadInputMap();
    }

    private async inputMapChangedOnDisk(): Promise<void> {
        const inputMap = this.inputMap;
        if (inputMap.kind === "loaded") {
            const text = await this.readText(inputMap.path);
            if (text === inputMap.savedText) return;
            if (this.inputMapDirty) {
                this.changedOnDisk.add("inputMap");
                return;
            }
        }
        await this.loadInputMap();
    }

    private async saveInputMap(): Promise<void> {
        const inputMap = this.inputMap;
        if (inputMap.kind !== "loaded") return;
        const text = inputMapText(inputMap.draft);
        await this.services.files().write(inputMap.path, text);
        this.inputMap = {...inputMap, savedText: text, saved: inputMap.draft};
        this.changedOnDisk.delete("inputMap");
        this.services.report("info", `Saved the input map ${inputMap.path}`);
    }

    private async saveManifest(): Promise<void> {
        const check = this.manifestCheck();
        if (check === undefined || !check.valid) return;
        await this.writeManifest(check.text);
        await this.afterManifestSaved();
    }

    private async writeManifest(text: string): Promise<void> {
        await this.services.files().write(PROJECT_MANIFEST_FILE, text);
        const opened = openManifestDraft(text);
        if (opened.ok) this.manifest = {kind: "loaded", savedText: text, draft: opened.draft};
        this.revision++;
        this.changedOnDisk.delete("manifest");
        this.services.report("info", `Saved ${PROJECT_MANIFEST_FILE}`);
        this.changed();
    }

    private async afterManifestSaved(): Promise<void> {
        await this.services.manifestSaved?.();
        await this.generate();
    }

    private async generate(): Promise<void> {
        const generate = this.services.generate;
        if (generate === undefined) {
            this.services.report("info", GENERATE_UNAVAILABLE_TEXT);
            return;
        }
        let report: GenerateProjectReport;
        try {
            report = await generate();
        } catch (error) {
            report = {ok: false, errors: [describeError(error)]};
        }
        for (const line of generateReportLines(report)) this.services.report(line.level, line.text);
    }
}
