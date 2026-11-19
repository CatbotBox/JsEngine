import {App} from "../../src/engine";
import {Input} from "../../src/engine/input";
import {consoleOverride} from "../../src/engine/debugging";
import {AnsiCellPresenter, nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitAfterLaunchFailure, exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {installCellRendering3d} from "./launch/cellRendering";
import {launchDemo3d} from "./launch/demo3dLaunch";

const DEMO_NAME = "The 3D demo";

exitUnlessInteractiveTerminal(DEMO_NAME);

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new App({platform: nodePlatform()}).createDebugWorld();
const presenter = new AnsiCellPresenter(terminal);
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: true,
    hideCursor: true,
});

launchDemo3d(world, {
    directory: __dirname,
    installRendering: () => installCellRendering3d(world, presenter),
}).then(() => {
    world.startLoop();
    terminalInput.start();
}, error => exitAfterLaunchFailure(DEMO_NAME, error));
