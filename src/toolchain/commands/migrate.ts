import {join, resolve} from "path";
import {CliError, EXIT_SUCCESS, parseOptions} from "../cliArguments";
import {displayPath, projectFolderOf} from "../project";
import {pendingMigrations, writeMigrations} from "../projectMigration";
import type {MigratedDocument} from "../projectMigration";
import {PROJECT_OPTION} from "../targets";
import type {CommandResult} from "./command";

const UP_TO_DATE_TEXT = "every scene, prefab and data asset is at the current version";

const OPTIONS = {
    project: PROJECT_OPTION,
    check: {kind: "flag"},
} as const;

function migrateCommandFor(folder: string): string {
    const isCurrentFolder = resolve(folder) === resolve(".");
    return isCurrentFolder ? "jsengine migrate" : `jsengine migrate --project ${displayPath(folder)}`;
}

function describeMigration(folder: string, document: MigratedDocument): string {
    return `${displayPath(join(folder, document.path))} (version ${document.fromVersion} -> ${document.toVersion})`;
}

export async function migrateCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("migrate", args, OPTIONS);
    const folder = projectFolderOf(options.value("project"));
    const pending = pendingMigrations(folder);
    if (pending.length === 0) {
        console.log(`${displayPath(folder)}: ${UP_TO_DATE_TEXT}`);
        return EXIT_SUCCESS;
    }
    const described = pending.map(document => describeMigration(folder, document));
    if (options.flag("check")) throw new CliError(`${pending.length} document(s) need migrating; run ${migrateCommandFor(folder)}`, described);
    writeMigrations(folder, pending);
    for (const line of described) console.log(`migrated ${line}`);
    return EXIT_SUCCESS;
}
