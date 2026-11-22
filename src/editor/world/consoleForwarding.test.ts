import {consoleOverride} from "../../engine/debugging";
import {originalConsole} from "../../engine/debugging/originalConsole";
import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorConsoleEvent} from "../editorProtocol";
import {errorFrames} from "../../engine/debugging/errorStack";
import {ConsoleForwarder, consoleText} from "./consoleForwarding";

const FORWARDING_SOURCES: readonly string[] = ["consoleForwarding.ts:", "consoleOverride.ts:"];
const FRAME_PREFIX = "    at ";

function forwardedWhile(body: () => void): EditorConsoleEvent[] {
    const events: EditorConsoleEvent[] = [];
    const forwarder = new ConsoleForwarder(event => events.push(event));
    forwarder.attach();
    consoleOverride.removeConsoleEventListener(originalConsole);
    try {
        body();
    } finally {
        consoleOverride.addConsoleEventListener(originalConsole);
        forwarder.detach();
    }
    return events;
}

function warnFromGameCode(): void {
    console.warn("careful");
}

function errorFromGameCode(): void {
    console.error("broken", 3);
}

describe("console forwarding", () => {
    test("an error argument contributes its name and message to the text and its frames to the stack", () => {
        const error = new TypeError("bad value");
        const [event] = forwardedWhile(() => console.log("failed:", error));
        expect(event.text).toBe("failed: TypeError: bad value");
        expect(event.stack).toBe(errorFrames(error));
        expect(event.stack?.startsWith(FRAME_PREFIX)).toBe(true);
        expect(event.stack?.includes("bad value")).toBe(false);
    });

    test("warnings and errors without an error capture the caller's stack, without the forwarding frames", () => {
        const events = forwardedWhile(() => {
            warnFromGameCode();
            errorFromGameCode();
        });
        expect(events.map(event => event.text)).toEqual(["careful", "broken 3"]);
        const [warning, error] = events;
        expect(warning.stack?.includes("warnFromGameCode")).toBe(true);
        expect(error.stack?.includes("errorFromGameCode")).toBe(true);
        for (const event of events) {
            for (const source of FORWARDING_SOURCES) expect(event.stack?.includes(source)).toBe(false);
            expect(event.stack?.startsWith("Error")).toBe(false);
        }
    });

    test("log, info and debug messages without an error carry no stack", () => {
        const events = forwardedWhile(() => {
            console.log("frame");
            console.info("loaded");
            console.debug("detail");
        });
        expect(events.map(event => event.level)).toEqual(["log", "info", "debug"]);
        expect(events.every(event => !("stack" in event))).toBe(true);
    });

    test("an error with an empty message reads as its name", () => {
        expect(consoleText([new RangeError()])).toBe("RangeError");
    });
});
