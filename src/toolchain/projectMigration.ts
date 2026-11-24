import {readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {isSpritePatternFile, migrateSpritePatternJson, parseSpritePatternFile, spritePatternFileText} from "../engine/rendering/2d/spritePatternFile";
import {
    dataAssetDocumentText,
    migrateDataAssetJson,
    migrateSceneJson,
    parseDataAssetDocument,
    parseSceneDocument,
    sceneDocumentText,
} from "../engine/scene";
import type {SceneJsonObject} from "../engine/scene";
import {CliError} from "./cliArguments";
import {displayPath} from "./project";
import {documentPathsUnder, isSceneOrPrefab, isVersionedProjectFile} from "./projectDocuments";

const LF = "\n";
const CRLF = "\r\n";

export interface MigratedDocument {
    readonly path: string;
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly text: string;
}

interface VersionedFileKind {
    migrate(source: unknown, path: string): SceneJsonObject;
    validate(migrated: SceneJsonObject, path: string): void;
    text(migrated: SceneJsonObject): string;
}

const SCENE_FILES: VersionedFileKind = {
    migrate: migrateSceneJson,
    validate: (migrated, path) => void parseSceneDocument(migrated, path),
    text: sceneDocumentText,
};

const DATA_ASSET_FILES: VersionedFileKind = {
    migrate: migrateDataAssetJson,
    validate: (migrated, path) => void parseDataAssetDocument(migrated, path),
    text: dataAssetDocumentText,
};

const SPRITE_PATTERN_FILES: VersionedFileKind = {
    migrate: migrateSpritePatternJson,
    validate: (migrated, path) => void parseSpritePatternFile(migrated, path),
    text: spritePatternFileText,
};

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function withLineBreaksOf(original: string, text: string): string {
    const lineBreak = original.includes(CRLF) ? CRLF : LF;
    const body = text.endsWith(LF) ? text.slice(0, -LF.length) : text;
    const end = original.endsWith(LF) ? lineBreak : "";
    return body.split(LF).join(lineBreak) + end;
}

function parsedJson(path: string, text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`${path} is not valid JSON: ${describeError(error)}`);
    }
}

function fileKindOf(path: string): VersionedFileKind {
    if (isSceneOrPrefab(path)) return SCENE_FILES;
    return isSpritePatternFile(path) ? SPRITE_PATTERN_FILES : DATA_ASSET_FILES;
}

function migratedDocument(path: string, original: string): MigratedDocument | undefined {
    const source = parsedJson(path, original);
    const kind = fileKindOf(path);
    const migrated = kind.migrate(source, path);
    const fromVersion = (source as SceneJsonObject).version as number;
    if (migrated.version === fromVersion) return undefined;
    kind.validate(migrated, path);
    return {path, fromVersion, toVersion: migrated.version as number, text: withLineBreaksOf(original, kind.text(migrated))};
}

export function pendingMigrations(folder: string): MigratedDocument[] {
    const migrated: MigratedDocument[] = [];
    const problems: string[] = [];
    for (const path of documentPathsUnder(folder, isVersionedProjectFile)) {
        try {
            const document = migratedDocument(path, readFileSync(join(folder, path), "utf8"));
            if (document !== undefined) migrated.push(document);
        } catch (error) {
            problems.push(describeError(error));
        }
    }
    if (problems.length > 0) throw new CliError(`${displayPath(folder)} has documents that cannot be migrated; fix them and try again`, problems);
    return migrated;
}

export function writeMigrations(folder: string, documents: readonly MigratedDocument[]): void {
    for (const document of documents) writeFileSync(join(folder, document.path), document.text);
}
