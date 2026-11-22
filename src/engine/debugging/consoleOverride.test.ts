import {describe, expect, test} from "../testing/harness";
import {consoleOverride, installConsoleOverride} from "./consoleOverride";
import {originalConsole} from "./originalConsole";

const GREETING = "hello";
const COUNT = 1;

describe("console override", () => {
    test("installs once, and what the console logs reaches its listeners", () => {
        installConsoleOverride();
        const installed = console;
        installConsoleOverride();
        expect(console).toBe(installed);
        expect(console === originalConsole).toBe(false);
        const seen: string[] = [];
        const recorder: Console = Object.create(originalConsole);
        recorder.info = (...data: unknown[]) => seen.push(data.map(String).join(" "));
        consoleOverride.removeConsoleEventListener(originalConsole);
        consoleOverride.addConsoleEventListener(recorder);
        try {
            console.info(GREETING, COUNT);
        } finally {
            consoleOverride.removeConsoleEventListener(recorder);
            consoleOverride.addConsoleEventListener(originalConsole);
        }
        expect(seen).toEqual([`${GREETING} ${COUNT}`]);
    });
});
