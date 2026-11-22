import {originalConsole} from "./originalConsole";

const ConsoleEventListeners: Console[] = [originalConsole];
let installed = false;

function consoleFallingBackToOriginal(): Console {
    const fallingBack = Object.create(originalConsole);
    for (let key in originalConsole) {
        fallingBack[key] = (...args: unknown[]) => ConsoleEventListeners.forEach(listener => (listener as any)[key](...args));
    }
    return Object.freeze(fallingBack);
}

export function installConsoleOverride(): void {
    if (installed) return;
    installed = true;
    console = consoleFallingBackToOriginal();
}

function removeConsoleEventListener(listener: Console) {
    installConsoleOverride();
    const index = ConsoleEventListeners.findIndex(l => listener === l);
    if (index > -1) ConsoleEventListeners.splice(index, 1);
}

function addConsoleEventListener(listener: Console) {
    installConsoleOverride();
    const index = ConsoleEventListeners.findIndex(l => listener === l);
    if (index === -1) ConsoleEventListeners.push(listener);
}

export const consoleOverride = {
    removeConsoleEventListener,
    addConsoleEventListener,
}
