import {KEEP_MANIFEST_KEY, SCHEMAS_MANIFEST_KEY, SYSTEMS_MANIFEST_KEY, validateProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectResourceBinding} from "../../engine/project/projectManifest";
import {isProjectTarget, PROJECT_TARGETS, TARGET_BACKEND_KEY, TARGET_PIXEL_SCALE_KEY, TARGETS_MANIFEST_KEY} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {sceneJsonEquals} from "../../engine/scene/sceneDocument";
import type {SceneJsonValue} from "../../engine/scene";
import {normalizeProjectPath} from "./projectFiles";

export type ManifestEdit =
    | {readonly ok: true, readonly text: string}
    | {readonly ok: false, readonly problems: readonly string[]};

export interface TargetDraft {
    readonly declared: boolean;
    readonly backend: string;
    readonly pixelScale: string;
}

export interface ManifestDraft {
    readonly name: string;
    readonly entry: string | null;
    readonly startScene: string;
    readonly targets: Readonly<Record<ProjectTarget, TargetDraft>>;
    readonly schemasExclude: readonly string[];
    readonly systemsExclude: readonly string[];
    readonly keep: readonly string[];
}

export type ManifestDraftOpening =
    | {readonly ok: true, readonly draft: ManifestDraft}
    | {readonly ok: false, readonly problems: readonly string[]};

export type ManifestProblemArea =
    | "general"
    | "name"
    | "entry"
    | "startScene"
    | "targets"
    | `targets.${ProjectTarget}`
    | "schemasExclude"
    | "systemsExclude"
    | "keep";

export interface ManifestDraftCheck {
    readonly text: string;
    readonly valid: boolean;
    readonly problems: ReadonlyMap<ManifestProblemArea, readonly string[]>;
}

export const DEFAULT_TARGET_SETTING = "";

const WINDOWS_LINE_END = "\r\n";
const UNIX_LINE_END = "\n";
const DEFAULT_INDENT = "  ";
const NAME_KEY = "name";
const ENTRY_KEY = "entry";
const START_SCENE_KEY = "startScene";
const RESOURCES_KEY = "resources";
const EXCLUDE_KEY = "exclude";
const INDENTED_LINE = /\n([ \t]+)\S/;
const TRAILING_LINE_END = /\r?\n$/;
const WHOLE_NUMBER = /^\d+$/;
const PROBLEM_PATH = /^"([A-Za-z]+)(?:[.[]([A-Za-z]+))?/;
const NOT_AN_OBJECT_PROBLEM = "The project manifest must hold a JSON object";

const AREA_BY_KEY: Readonly<Record<string, ManifestProblemArea>> = {
    [NAME_KEY]: "name",
    [ENTRY_KEY]: "entry",
    [START_SCENE_KEY]: "startScene",
    [TARGETS_MANIFEST_KEY]: "targets",
    [SCHEMAS_MANIFEST_KEY]: "schemasExclude",
    [SYSTEMS_MANIFEST_KEY]: "systemsExclude",
    [KEEP_MANIFEST_KEY]: "keep",
};

type ManifestObject = {[key: string]: unknown};

type DraftField = keyof ManifestDraft;

interface FieldWriter {
    readonly key: string;
    readonly value: (draft: ManifestDraft, original: ManifestObject) => unknown;
}

function isManifestObject(value: unknown): value is ManifestObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
    if (a === undefined || b === undefined) return a === b;
    return sceneJsonEquals(a as SceneJsonValue, b as SceneJsonValue);
}

function formattedLike(original: string, value: ManifestObject): string {
    const lineEnd = original.includes(WINDOWS_LINE_END) ? WINDOWS_LINE_END : UNIX_LINE_END;
    const indent = INDENTED_LINE.exec(original)?.[1] ?? DEFAULT_INDENT;
    const text = JSON.stringify(value, null, indent).split(UNIX_LINE_END).join(lineEnd);
    return TRAILING_LINE_END.test(original) ? text + lineEnd : text;
}

function parsedManifest(text: string): ManifestObject | undefined {
    try {
        const parsed = JSON.parse(text) as unknown;
        return isManifestObject(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function textOf(value: unknown): string {
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
}

function namesOf(value: unknown): string[] {
    return Array.isArray(value) ? value.map(textOf) : [];
}

function excludeOf(value: unknown): string[] {
    return isManifestObject(value) ? namesOf(value[EXCLUDE_KEY]) : [];
}

function targetDraftOf(targets: unknown, target: ProjectTarget): TargetDraft {
    if (!isManifestObject(targets)) return {declared: targets === undefined, backend: DEFAULT_TARGET_SETTING, pixelScale: DEFAULT_TARGET_SETTING};
    const settings = targets[target];
    if (settings === undefined) return {declared: false, backend: DEFAULT_TARGET_SETTING, pixelScale: DEFAULT_TARGET_SETTING};
    const fields = isManifestObject(settings) ? settings : {};
    return {declared: true, backend: textOf(fields[TARGET_BACKEND_KEY]), pixelScale: textOf(fields[TARGET_PIXEL_SCALE_KEY])};
}

function draftOfObject(manifest: ManifestObject): ManifestDraft {
    const entry = manifest[ENTRY_KEY];
    const targets = manifest[TARGETS_MANIFEST_KEY];
    return {
        name: textOf(manifest[NAME_KEY]),
        entry: entry === undefined ? null : textOf(entry),
        startScene: textOf(manifest[START_SCENE_KEY]),
        targets: {
            web: targetDraftOf(targets, "web"),
            window: targetDraftOf(targets, "window"),
            terminal: targetDraftOf(targets, "terminal"),
        },
        schemasExclude: excludeOf(manifest[SCHEMAS_MANIFEST_KEY]),
        systemsExclude: excludeOf(manifest[SYSTEMS_MANIFEST_KEY]),
        keep: namesOf(manifest[KEEP_MANIFEST_KEY]),
    };
}

export function openManifestDraft(text: string): ManifestDraftOpening {
    const parsed = parsedManifest(text);
    if (parsed !== undefined) return {ok: true, draft: draftOfObject(parsed)};
    const validation = validateProjectManifest(text);
    return {ok: false, problems: validation.ok ? [NOT_AN_OBJECT_PROBLEM] : validation.problems};
}

function trimmedNames(names: readonly string[]): string[] {
    return names.map(name => name.trim()).filter(name => name.length > 0);
}

function pixelScaleValue(text: string): unknown {
    const trimmed = text.trim();
    return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : trimmed;
}

function hasTargetSettings(target: TargetDraft): boolean {
    return target.backend.trim().length > 0 || target.pixelScale.trim().length > 0;
}

function targetsValue(draft: ManifestDraft): unknown {
    const entries = PROJECT_TARGETS.map(target => [target, draft.targets[target]] as const);
    if (entries.every(([, target]) => target.declared && !hasTargetSettings(target))) return undefined;
    const value: ManifestObject = {};
    for (const [name, target] of entries) {
        if (!target.declared) continue;
        const settings: ManifestObject = {};
        if (target.backend.trim().length > 0) settings[TARGET_BACKEND_KEY] = target.backend.trim();
        if (target.pixelScale.trim().length > 0) settings[TARGET_PIXEL_SCALE_KEY] = pixelScaleValue(target.pixelScale);
        value[name] = settings;
    }
    return value;
}

function excludeValue(names: readonly string[], original: unknown): unknown {
    const kept: ManifestObject = isManifestObject(original) ? {...original} : {};
    const exclude = trimmedNames(names);
    if (exclude.length > 0) kept[EXCLUDE_KEY] = exclude;
    else delete kept[EXCLUDE_KEY];
    return Object.keys(kept).length === 0 ? undefined : kept;
}

function optionalText(text: string): string | undefined {
    const trimmed = text.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

const FIELD_WRITERS: Readonly<Record<DraftField, FieldWriter>> = {
    name: {key: NAME_KEY, value: draft => draft.name.trim()},
    entry: {key: ENTRY_KEY, value: draft => draft.entry === null ? undefined : draft.entry.trim()},
    startScene: {key: START_SCENE_KEY, value: draft => optionalText(draft.startScene)},
    targets: {key: TARGETS_MANIFEST_KEY, value: targetsValue},
    schemasExclude: {key: SCHEMAS_MANIFEST_KEY, value: (draft, original) => excludeValue(draft.schemasExclude, original[SCHEMAS_MANIFEST_KEY])},
    systemsExclude: {key: SYSTEMS_MANIFEST_KEY, value: (draft, original) => excludeValue(draft.systemsExclude, original[SYSTEMS_MANIFEST_KEY])},
    keep: {key: KEEP_MANIFEST_KEY, value: draft => {
        const keep = trimmedNames(draft.keep);
        return keep.length === 0 ? undefined : keep;
    }},
};

const DRAFT_FIELDS = Object.keys(FIELD_WRITERS) as DraftField[];

export function changedManifestFields(text: string, draft: ManifestDraft): DraftField[] {
    const original = parsedManifest(text);
    if (original === undefined) return [...DRAFT_FIELDS];
    const saved = draftOfObject(original);
    return DRAFT_FIELDS.filter(field => {
        const writer = FIELD_WRITERS[field];
        return !sameJson(writer.value(draft, original), writer.value(saved, original));
    });
}

export function isManifestDraftDirty(text: string, draft: ManifestDraft): boolean {
    return changedManifestFields(text, draft).length > 0;
}

export function manifestTextWithDraft(text: string, draft: ManifestDraft): string {
    const original = parsedManifest(text);
    if (original === undefined) return text;
    const changed = changedManifestFields(text, draft);
    if (changed.length === 0) return text;
    const edited: ManifestObject = {...original};
    for (const field of changed) {
        const writer = FIELD_WRITERS[field];
        const value = writer.value(draft, original);
        if (value === undefined) delete edited[writer.key];
        else edited[writer.key] = value;
    }
    return formattedLike(text, edited);
}

export function manifestProblemArea(problem: string): ManifestProblemArea {
    const match = PROBLEM_PATH.exec(problem);
    if (match === null) return "general";
    const [, key, member] = match;
    if (key === TARGETS_MANIFEST_KEY && isProjectTarget(member)) return `targets.${member}`;
    return AREA_BY_KEY[key] ?? "general";
}

export function checkManifestDraft(text: string, draft: ManifestDraft, fileExists?: (path: string) => boolean): ManifestDraftCheck {
    const edited = manifestTextWithDraft(text, draft);
    const validation = validateProjectManifest(edited, fileExists);
    const problems = new Map<ManifestProblemArea, string[]>();
    for (const problem of validation.ok ? [] : validation.problems) {
        const area = manifestProblemArea(problem);
        const listed = problems.get(area);
        if (listed === undefined) problems.set(area, [problem]);
        else listed.push(problem);
    }
    return {text: edited, valid: validation.ok, problems};
}

function editedManifest(text: string, edit: (manifest: ManifestObject) => void): ManifestEdit {
    const current = validateProjectManifest(text);
    if (!current.ok) return current;
    const parsed = parsedManifest(text);
    if (parsed === undefined) return {ok: false, problems: [NOT_AN_OBJECT_PROBLEM]};
    const edited: ManifestObject = {...parsed};
    edit(edited);
    const editedText = formattedLike(text, edited);
    const validated = validateProjectManifest(editedText);
    return validated.ok ? {ok: true, text: editedText} : validated;
}

export function manifestWithStartScene(text: string, startScene: string | null): ManifestEdit {
    return editedManifest(text, edited => {
        if (startScene === null) delete edited[START_SCENE_KEY];
        else edited[START_SCENE_KEY] = normalizeProjectPath(startScene);
    });
}

export function manifestWithResource(text: string, binding: ProjectResourceBinding): ManifestEdit {
    return editedManifest(text, edited => {
        const bindings = Array.isArray(edited[RESOURCES_KEY]) ? edited[RESOURCES_KEY] as unknown[] : [];
        edited[RESOURCES_KEY] = [...bindings, {type: binding.type, path: normalizeProjectPath(binding.path)}];
    });
}

export function manifestStartScene(text: string): string | null {
    const validated = validateProjectManifest(text);
    return validated.ok ? validated.manifest.startScene ?? null : null;
}
