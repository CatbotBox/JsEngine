import fileLogger from "./fileLogger";
import {originalConsole} from "./originalConsole";

const ConsoleEventListeners: Console[] = [originalConsole, fileLogger]
const ConsoleEventSource = {} as any;
for (let key in console) {
    ConsoleEventSource[key] = (...args: unknown[]) => ConsoleEventListeners.forEach(listener => (listener as any)[key](...args));
}

function removeConsoleEventListener(listener: Console) {
    const index = ConsoleEventListeners.findIndex(l => listener === l);
    if (index > -1) ConsoleEventListeners.splice(index, 1);
}

function addConsoleEventListener(listener: Console) {
    const index = ConsoleEventListeners.findIndex(l => listener === l);
    if (index === -1) ConsoleEventListeners.push(listener);
}

console = Object.freeze(ConsoleEventSource);

export const consoleOverride = {
    removeConsoleEventListener,
    addConsoleEventListener,
}