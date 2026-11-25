import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorViewInfo} from "../editorProtocol";
import {SceneOverlayInfo, VIEW_INFO_RETRY_MS} from "./sceneOverlayInfo";

const START_MS = 5_000;
const FRAME_MS = 16;
const PROBLEM = "The Scene view has no camera yet";

function infoOfFrame(presentedFrames: number): EditorViewInfo {
    return {
        view: "scene",
        projection: "orthographic",
        worldToScreen: [],
        screenWidth: 1,
        screenHeight: 1,
        camera: {position: [0, 0, 0], rotation: [0, 0, 0, 1]},
        bounds: [],
        sceneViews: ["scene"],
        presentedFrames,
    };
}

describe("scene overlay info", () => {
    test("shows each frame's own info and asks for none while frames keep arriving", () => {
        const overlay = new SceneOverlayInfo();
        for (let frame = 1; frame <= 3; frame++) {
            overlay.frameShown(infoOfFrame(frame), START_MS + frame * FRAME_MS);
            expect(overlay.info?.presentedFrames).toBe(frame);
            expect(overlay.startRequest(START_MS + frame * FRAME_MS + FRAME_MS)).toBeUndefined();
        }
        expect(overlay.startRequest(START_MS + 3 * FRAME_MS + VIEW_INFO_RETRY_MS - 1)).toBeUndefined();
    });

    test("asks once at a time for info only when no frame came for a while, and drops an answer a frame overtook", () => {
        const overlay = new SceneOverlayInfo();
        const first = overlay.startRequest(START_MS)!;
        expect(first).toBeDefined();
        expect(overlay.startRequest(START_MS)).toBeUndefined();
        overlay.frameShown(infoOfFrame(1), START_MS + FRAME_MS);
        expect(overlay.requestAnswered(first, infoOfFrame(0))).toBe(false);
        expect(overlay.info?.presentedFrames).toBe(1);

        const late = START_MS + FRAME_MS + VIEW_INFO_RETRY_MS;
        const second = overlay.startRequest(late)!;
        expect(overlay.requestAnswered(second, infoOfFrame(1))).toBe(true);
        expect(overlay.info?.presentedFrames).toBe(1);
        expect(overlay.startRequest(late)).toBeDefined();
    });

    test("shows a failed request's problem until a frame or an answer arrives, and waits before asking again", () => {
        const overlay = new SceneOverlayInfo();
        overlay.requestFailed(overlay.startRequest(START_MS)!, PROBLEM, START_MS);
        expect(overlay.problem).toBe(PROBLEM);
        expect(overlay.startRequest(START_MS + VIEW_INFO_RETRY_MS - 1)).toBeUndefined();
        const retry = overlay.startRequest(START_MS + VIEW_INFO_RETRY_MS)!;
        overlay.frameShown(infoOfFrame(1), START_MS + VIEW_INFO_RETRY_MS);
        expect(overlay.problem).toBeUndefined();
        overlay.requestFailed(retry, PROBLEM, START_MS + VIEW_INFO_RETRY_MS);
        expect(overlay.problem).toBeUndefined();
    });

    test("forgetting drops the shown info but keeps waiting for frames", () => {
        const overlay = new SceneOverlayInfo();
        overlay.frameShown(infoOfFrame(1), START_MS);
        overlay.forget();
        expect(overlay.info).toBeUndefined();
        expect(overlay.startRequest(START_MS + FRAME_MS)).toBeUndefined();
        overlay.frameShown(infoOfFrame(2), START_MS + FRAME_MS);
        expect(overlay.info?.presentedFrames).toBe(2);
    });
});
