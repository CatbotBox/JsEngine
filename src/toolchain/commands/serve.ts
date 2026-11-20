import {parseOptions} from "../cliArguments";
import {serveSite} from "../serve/devServer";
import {KEEP_RUNNING} from "./command";
import type {CommandResult} from "./command";

const OPTIONS = {
    prod: {kind: "flag"},
    "no-build": {kind: "flag"},
    "no-coi": {kind: "flag"},
} as const;

export async function serveCommand(args: readonly string[]): Promise<CommandResult> {
    const options = parseOptions("serve", args, OPTIONS);
    serveSite({prod: options.flag("prod"), build: !options.flag("no-build"), isolated: !options.flag("no-coi")});
    return KEEP_RUNNING;
}
