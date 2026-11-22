import {relative, resolve} from "path";
import type {GenerateProjectReport} from "../../editor/project/projectServerApi";
import {CliError, EXIT_FAILURE, EXIT_SUCCESS, parseOptions, usageError} from "../cliArguments";
import {checkGeneratedFiles, writeGeneratedFiles} from "../generate/generatedFiles";
import type {GeneratedFiles} from "../generate/generatedFiles";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {displayPath, projectFolderOf} from "../project";
import {slashed} from "../repoPaths";
import {PROJECT_OPTION} from "../targets";
import type {CommandResult} from "./command";

const JSON_REPORT = "json";

const OPTIONS = {
    project: PROJECT_OPTION,
    check: {kind: "flag"},
    print: {kind: "flag"},
    report: {kind: "value", values: [JSON_REPORT]},
} as const;

function generateCommandFor(folder: string): string {
    const isCurrentFolder = resolve(folder) === resolve(".");
    return isCurrentFolder ? "jsengine generate" : `jsengine generate --project ${displayPath(folder)}`;
}

function errorLines(error: unknown): string[] {
    if (error instanceof CliError) return error.details.length > 0 ? [...error.details] : [error.message];
    return [error instanceof Error ? error.message : String(error)];
}

function projectPaths(folder: string, generated: GeneratedFiles, written: boolean): string[] {
    return generated.files.filter(file => (file.state !== "upToDate") === written).map(file => slashed(relative(folder, file.path)));
}

export function generateReport(projectOption: string | undefined): GenerateProjectReport {
    try {
        const folder = projectFolderOf(projectOption);
        const generated = writeGeneratedFiles(folder);
        return {ok: true, written: projectPaths(folder, generated, true), unchanged: projectPaths(folder, generated, false), warnings: [...generated.warnings]};
    } catch (error) {
        return {ok: false, errors: errorLines(error)};
    }
}

export async function generateCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("generate", args, OPTIONS);
    const modes = (["check", "print"] as const).filter(mode => options.flag(mode));
    if (modes.length > 1) throw usageError("--check compares and --print prints; pick one");
    if (options.has("report") && modes.length > 0) throw usageError(`--report ${JSON_REPORT} reports a generate run; drop --${modes[0]}`);
    if (options.value("report") === JSON_REPORT) {
        const report = generateReport(options.value("project"));
        process.stdout.write(JSON.stringify(report) + "\n");
        return report.ok ? EXIT_SUCCESS : EXIT_FAILURE;
    }
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
