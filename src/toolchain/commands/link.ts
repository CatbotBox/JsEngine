import {EXIT_SUCCESS, parseOptions} from "../cliArguments";
import {displayPath, projectFolderOf} from "../project";
import {linkProject} from "../projectPackage";
import {REPO_ROOT} from "../repoPaths";
import {PROJECT_OPTION} from "../targets";
import type {CommandResult} from "./command";

const OPTIONS = {
    project: PROJECT_OPTION,
} as const;

export async function linkCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("link", args, OPTIONS);
    const folder = projectFolderOf(options.value("project"));
    await linkProject(folder);
    console.log(`${displayPath(folder)} uses the engine packages of ${displayPath(REPO_ROOT)}`);
    return EXIT_SUCCESS;
}
