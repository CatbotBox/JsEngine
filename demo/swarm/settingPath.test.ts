import {describe, expect, test} from "@jsengine/engine/testing";
import {readSetting, roundToDecimals, steppedSetting, writeSetting} from "./settingPath";

const ROOT_NAME = "Tuning";
const STEP = 0.05;
const TWO_DECIMALS = 2;
const NO_DECIMALS = 0;

function tuning() {
    return {seed: undefined as number | undefined, ship: {lives: 3, name: "ship"}, waves: {jitter: 0.25}};
}

describe("setting paths", () => {
    test("read and write follow a dotted path, an unset value reading as undefined", () => {
        const root = tuning();
        expect(readSetting(root, "ship.lives", ROOT_NAME)).toBe(3);
        expect(readSetting(root, "seed", ROOT_NAME)).toBeUndefined();
        writeSetting(root, "ship.lives", ROOT_NAME, 5);
        writeSetting(root, "seed", ROOT_NAME, 7);
        expect(root.ship.lives).toBe(5);
        expect(root.seed).toBe(7);
        writeSetting(root, "seed", ROOT_NAME, undefined);
        expect(root.seed).toBeUndefined();
    });

    test("a path to a missing or non-number field throws naming the path and the root", () => {
        const root = tuning();
        expect(() => readSetting(root, "ship.livs", ROOT_NAME)).toThrow(`"ship.livs" names no number field of ${ROOT_NAME}`);
        expect(() => readSetting(root, "hull.lives", ROOT_NAME)).toThrow(`"hull.lives" names no number field of ${ROOT_NAME}`);
        expect(() => readSetting(root, "ship.name", ROOT_NAME)).toThrow(`"ship.name" names no number field of ${ROOT_NAME}`);
        expect(() => writeSetting(root, "ship", ROOT_NAME, 1)).toThrow(`"ship" names no number field of ${ROOT_NAME}`);
    });

    test("a step is rounded to the setting's decimals and clamped to its range", () => {
        expect(steppedSetting(0.25, STEP, 0, 1, TWO_DECIMALS)).toBe(0.3);
        expect(steppedSetting(0.3, -STEP, 0, 1, TWO_DECIMALS)).toBe(0.25);
        expect(steppedSetting(0.98, STEP, 0, 1, TWO_DECIMALS)).toBe(1);
        expect(steppedSetting(0.02, -STEP, 0, 1, TWO_DECIMALS)).toBe(0);
        expect(steppedSetting(3, 1, 1, 9, NO_DECIMALS)).toBe(4);
        expect(steppedSetting(9, 1, 1, 9, NO_DECIMALS)).toBe(9);
        expect(Number.isInteger(steppedSetting(2.6, 1, 0, 9, NO_DECIMALS))).toBe(true);
        expect(roundToDecimals(0.1 + 0.2, TWO_DECIMALS)).toBe(0.3);
    });
});
