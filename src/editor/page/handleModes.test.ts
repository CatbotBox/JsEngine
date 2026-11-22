import {describe, expect, test} from "../../engine/testing/harness";
import {DEFAULT_HANDLE_MODES, handleModesText, parseHandleModes, withHandlePositionToggled, withHandleRotationToggled} from "./handleModes";

describe("handle modes", () => {
    test("each toggle flips only its own mode", () => {
        expect(DEFAULT_HANDLE_MODES).toEqual({position: "center", rotation: "global"});
        expect(withHandlePositionToggled(DEFAULT_HANDLE_MODES)).toEqual({position: "pivot", rotation: "global"});
        expect(withHandleRotationToggled(DEFAULT_HANDLE_MODES)).toEqual({position: "center", rotation: "local"});
        expect(withHandlePositionToggled(withHandlePositionToggled(DEFAULT_HANDLE_MODES))).toEqual(DEFAULT_HANDLE_MODES);
    });

    test("the modes round-trip through storage and bad storage falls back per mode", () => {
        const modes = {position: "pivot", rotation: "local"} as const;
        expect(parseHandleModes(handleModesText(modes))).toEqual(modes);
        expect(parseHandleModes(null)).toEqual(DEFAULT_HANDLE_MODES);
        expect(parseHandleModes("{broken")).toEqual(DEFAULT_HANDLE_MODES);
        expect(parseHandleModes(`{"position": "pivot", "rotation": "sideways"}`)).toEqual({position: "pivot", rotation: "global"});
    });
});
