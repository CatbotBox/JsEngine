import {describe, expect, test} from "../testing/harness";
import {adoptStackFrames, errorFrames, errorFramesOf, errorHeadline} from "./errorStack";

const FRAMES = "    at thrower (origin.ts:3:9)\n    at caller (origin.ts:8:2)";

class NamedError extends Error {
    public override readonly name = "NamedError";
}

describe("error stacks", () => {
    test("the frames of an error are its stack below the headline", () => {
        const error = new Error("broke");
        error.stack = `Error: broke\n${FRAMES}`;
        expect(errorFrames(error)).toBe(FRAMES);
        expect(errorFramesOf(error)).toBe(FRAMES);
    });

    test("a stack holding only the headline, or a thrown non-error, has no frames", () => {
        const error = new Error("broke");
        error.stack = "Error: broke";
        expect(errorFrames(error)).toBeUndefined();
        expect(errorFramesOf("broke")).toBeUndefined();
    });

    test("adopted frames replace the local stack under the error's own headline", () => {
        const error = adoptStackFrames(new NamedError("remote failure"), FRAMES);
        expect(error.stack).toBe(`${errorHeadline(error)}\n${FRAMES}`);
        expect(errorHeadline(error)).toBe("NamedError: remote failure");
        expect(errorFrames(error)).toBe(FRAMES);
    });

    test("adopting no frames keeps the local stack", () => {
        const error = new Error("local");
        const local = error.stack;
        expect(adoptStackFrames(error, undefined).stack).toBe(local);
    });
});
