import {usageError} from "../cliArguments";
import type {ParsedOptions} from "../cliArguments";

export const KEEP_RUNNING = "keepRunning";

export type CommandResult = number | typeof KEEP_RUNNING;

export type Command = (args: readonly string[]) => Promise<CommandResult>;

export function requireScope(options: ParsedOptions, names: readonly string[], inScope: boolean, scope: string): void {
    const outOfScope = inScope ? undefined : names.find(name => options.has(name));
    if (outOfScope !== undefined) throw usageError(`--${outOfScope} applies to ${scope} only; drop it`);
}
