import {DebugWorld} from "../../src/engine";
import {Input} from "../../src/engine/input";
import {consoleOverride} from "../../src/engine/debugging";
import {CellPresenterResource} from "../../src/backends/cells";
import {AnsiCellPresenter, nodePlatform, nodeTerminal, TerminalInput} from "../../src/hosts/terminal";
import {fileLogger} from "../../src/hosts/terminal/fileLogger";
import {exitAfterLaunchFailure, exitUnlessInteractiveTerminal} from "../_shared/interactiveTerminal";
import {installCellRenderingSwarm} from "./launch/cellRendering";
import {launchSwarm} from "./launch/swarmLaunch";

const DEMO_NAME = "Swarm";

exitUnlessInteractiveTerminal(DEMO_NAME);

consoleOverride.addConsoleEventListener(fileLogger);

const terminal = nodeTerminal();
const world = new DebugWorld({platform: nodePlatform()});
world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(terminal)));
const terminalInput = new TerminalInput({
    terminal,
    platform: world.platform,
    sink: world.resources.getOrCreate(Input),
    mouse: false,
});

launchSwarm(world, {
    renderBackend: "cells",
    directory: __dirname,
    installRendering: installCellRenderingSwarm,
    quit: () => {
        terminalInput.stop();
        process.exit(0);
    },
}).then(() => {
    world.startLoop();
    terminalInput.start();
}, error => exitAfterLaunchFailure(DEMO_NAME, error));
