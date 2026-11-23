import type {SceneJsonObject} from "./sceneDocument";

export interface DocumentMigration {
    readonly fromVersion: number;
    readonly migrate: (document: SceneJsonObject) => SceneJsonObject;
}

export interface DocumentMigrations {
    readonly currentVersion: number;
    readonly steps: readonly DocumentMigration[];
}

export function oldestMigratedVersion(migrations: DocumentMigrations): number {
    return migrations.steps.reduce((oldest, step) => Math.min(oldest, step.fromVersion), migrations.currentVersion);
}

export function migrateDocumentJson(document: SceneJsonObject, version: number, migrations: DocumentMigrations, label: string): SceneJsonObject {
    const {currentVersion} = migrations;
    if (version > currentVersion) throw new Error(`${label}: version ${version} is newer than the supported version ${currentVersion}`);
    const oldest = oldestMigratedVersion(migrations);
    if (version < oldest) throw new Error(`${label}: version ${version} is older than the oldest version this engine migrates (${oldest})`);
    let migrated = document;
    for (let fromVersion = version; fromVersion < currentVersion; fromVersion++) {
        const step = migrations.steps.find(candidate => candidate.fromVersion === fromVersion);
        if (step === undefined) throw new Error(`${label}: no migration from version ${fromVersion} to ${fromVersion + 1}`);
        migrated = {...step.migrate(migrated), version: fromVersion + 1};
    }
    return migrated;
}

export function withRenamedKey(object: SceneJsonObject, from: string, to: string): SceneJsonObject {
    if (!Object.hasOwn(object, from)) return object;
    const renamed: SceneJsonObject = {};
    for (const key of Object.keys(object)) renamed[key === from ? to : key] = object[key];
    return renamed;
}
