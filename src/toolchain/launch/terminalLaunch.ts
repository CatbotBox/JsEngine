import {CliError} from "../cliArguments";
import {REPO_ROOT} from "../repoPaths";

export interface TerminalLaunchOptions {
    readonly node: boolean;
    readonly watch: boolean;
}

const NODE_COMMAND: readonly string[] = ["node", "-r", "ts-node/register/transpile-only"];
const WATCH_FLAG = "--watch";
const INTERRUPT_SIGNAL = "SIGINT";

function commandFor(entry: string, options: TerminalLaunchOptions): string[] {
    if (options.node) return [...NODE_COMMAND, entry];
    return [process.execPath, ...(options.watch ? [WATCH_FLAG] : []), entry];
}

export async function launchTerminal(entry: string, options: TerminalLaunchOptions): Promise<number> {
    let child: ReturnType<typeof Bun.spawn>;
    try {
        child = Bun.spawn(commandFor(entry, options), {cwd: REPO_ROOT, stdio: ["inherit", "inherit", "inherit"]});
    } catch (error) {
        const fix = options.node ? "install node >= 22 or drop --node" : "check that bun can start";
        throw new CliError(`could not start the game: ${error instanceof Error ? error.message : String(error)}; ${fix}`);
    }
    const ignoreInterrupt = (): void => undefined;
    process.on(INTERRUPT_SIGNAL, ignoreInterrupt);
    try {
        return await child.exited;
    } finally {
        process.off(INTERRUPT_SIGNAL, ignoreInterrupt);
    }
}
