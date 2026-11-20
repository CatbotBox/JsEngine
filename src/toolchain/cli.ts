#!/usr/bin/env bun
import {CliError, EXIT_FAILURE, EXIT_USAGE, usageError} from "./cliArguments";
import {KEEP_RUNNING} from "./commands/command";
import type {Command, CommandResult} from "./commands/command";
import {helpCommand} from "./commands/help";

const COMMANDS: Readonly<Record<string, Command>> = {
    run: async args => (await import("./commands/run")).runCommand(args),
    build: async args => (await import("./commands/build")).buildCommand(args),
    package: async args => (await import("./commands/package")).packageCommand(args),
    generate: async args => (await import("./commands/generate")).generateCommand(args),
    serve: async args => (await import("./commands/serve")).serveCommand(args),
    edit: async args => (await import("./commands/edit")).editCommand(args),
    help: helpCommand,
};

const HELP_FLAGS: readonly string[] = ["--help", "-h"];
const ERROR_PREFIX = "jsengine: ";
const DETAIL_INDENT = "  ";

function printError(error: unknown): number {
    if (!(error instanceof CliError)) {
        console.error(ERROR_PREFIX + (error instanceof Error ? error.stack ?? error.message : String(error)));
        return EXIT_FAILURE;
    }
    console.error(ERROR_PREFIX + error.message);
    for (const detail of error.details) console.error(DETAIL_INDENT + detail);
    return error.exitCode;
}

export async function runCli(argv: readonly string[]): Promise<CommandResult> {
    const [name, ...args] = argv;
    try {
        if (name === undefined || HELP_FLAGS.includes(name)) return await helpCommand();
        const command = COMMANDS[name];
        if (command === undefined) throw usageError(`unknown command "${name}"; use one of ${Object.keys(COMMANDS).join(", ")}`);
        return await command(args);
    } catch (error) {
        return printError(error);
    }
}

async function main(): Promise<void> {
    if (typeof Bun === "undefined") {
        console.error(`${ERROR_PREFIX}jsengine runs under bun (https://bun.sh); start it with bun`);
        process.exit(EXIT_USAGE);
    }
    const result = await runCli(process.argv.slice(2));
    if (result !== KEEP_RUNNING) process.exitCode = result;
}

if (require.main === module) void main();
