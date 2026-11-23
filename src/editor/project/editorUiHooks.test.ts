import {describe, expect, test} from "../../engine/testing/harness";
import {COMMAND_HOOK, hookSelector, PANEL_HOOK} from "./editorUiHooks";

describe("hookSelector", () => {
    test("selects every element carrying a hook, or those whose hook has a value", () => {
        expect(hookSelector(PANEL_HOOK)).toBe("[data-panel]");
        expect(hookSelector(COMMAND_HOOK, "file.newScene")).toBe("[data-command=\"file.newScene\"]");
        expect(hookSelector("data-history-step", 2)).toBe("[data-history-step=\"2\"]");
    });

    test("quotes and backslashes in a value are escaped, so a Windows path still selects", () => {
        expect(hookSelector("data-recent-project", "C:\\Games\\My \"best\" game")).toBe("[data-recent-project=\"C:\\\\Games\\\\My \\\"best\\\" game\"]");
    });
});
