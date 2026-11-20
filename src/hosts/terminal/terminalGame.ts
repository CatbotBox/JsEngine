import {App} from "../../engine/core";
import type {DebugWorld} from "../../engine/core";
import {consoleOverride} from "../../engine/debugging";
import {Input} from "../../engine/input";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import {AnsiCellPresenter} from "./ansi/ansiCellPresenter";
import {TerminalInput} from "./ansi/terminalInput";
import {fileLogger} from "./fileLogger";
import {nodePlatform} from "./nodePlatform";
import {nodeTerminal} from "./nodeTerminal";

export type TerminalGameStart = (world: DebugWorld, presenter: CellPresenter) => Promise<unknown>;

const NOT_A_TERMINAL_EXIT_CODE = 1;
const LAUNCH_FAILED_EXIT_CODE = 1;
const MOUSE_REPORTING = true;
const CURSOR_HIDDEN = true;

export function exitUnlessInteractiveTerminal(gameName: string): void {
    if (process.stdin.isTTY === true && process.stdout.isTTY === true) return;
    process.stderr.write(`${gameName} needs an interactive terminal (stdin and stdout must be a TTY); run it directly in a terminal, not through a pipe.\n`);
    process.exit(NOT_A_TERMINAL_EXIT_CODE);
}

export function exitAfterLaunchFailure(gameName: string, error: unknown): never {
    process.stderr.write(`${gameName} could not start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(LAUNCH_FAILED_EXIT_CODE);
}

export function runTerminalGame(gameName: string, start: TerminalGameStart): void {
    exitUnlessInteractiveTerminal(gameName);
    consoleOverride.addConsoleEventListener(fileLogger);
    const terminal = nodeTerminal();
    const world = new App({platform: nodePlatform()}).createDebugWorld();
    const presenter = new AnsiCellPresenter(terminal);
    const terminalInput = new TerminalInput({
        terminal,
        platform: world.platform,
        sink: world.resources.getOrCreate(Input),
        mouse: MOUSE_REPORTING,
        hideCursor: CURSOR_HIDDEN,
    });
    start(world, presenter).then(() => {
        world.startLoop();
        terminalInput.start();
    }, error => exitAfterLaunchFailure(gameName, error));
}
