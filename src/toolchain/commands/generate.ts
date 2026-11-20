import {resolve} from "path";
import {CliError, EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import {checkGeneratedFiles, writeGeneratedFiles} from "../generate/generatedFiles";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {displayPath, projectFolderOf} from "../project";
import {PROJECT_OPTION} from "../targets";
import type {CommandResult} from "./command";

const OPTIONS = {
    project: PROJECT_OPTION,
    check: {kind: "flag"},
    print: {kind: "flag"},
} as const;

function generateCommandFor(folder: string): string {
    const isCurrentFolder = resolve(folder) === resolve(".");
    return isCurrentFolder ? "jsengine generate" : `jsengine generate --project ${displayPath(folder)}`;
}

export async function generateCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("generate", args, OPTIONS);
    if (options.flag("check") && options.flag("print")) throw usageError("--check compares and --print prints; pick one");
    const folder = projectFolderOf(options.value("project"));
    if (options.flag("print")) {
        const generated = checkGeneratedFiles(folder);
        for (const warning of generated.warnings) console.warn(`warning: ${warning}`);
        for (const file of generated.files) process.stdout.write(file.source);
        return EXIT_SUCCESS;
    }
    if (!options.flag("check")) {
        reportGeneratedFiles(writeGeneratedFiles(folder), "generate");
        return EXIT_SUCCESS;
    }
    const problems = reportGeneratedFiles(checkGeneratedFiles(folder), "check");
    if (problems.length > 0) throw new CliError(`${problems.join("; ")}; run ${generateCommandFor(folder)}`);
    return EXIT_SUCCESS;
}
