import {describe, expect, test} from "../../engine/testing/harness";
import {orbitCameraFromPose} from "./editorCameraMath";
import {MAX_CAMERA_PROJECTS, sceneViewCameraPose, sceneViewCameraText, storedSceneViewCamera, withoutSceneViewCamera, withSceneViewCamera} from "./sceneViewCameras";
import type {SceneViewCamera} from "./sceneViewCameras";

const PROJECT = "Demo\n/demo";
const OTHER_PROJECT = "Other\n/other";
const FLAT: SceneViewCamera = {kind: "2d", position: [1, 2, 0], rotation: [0, 0, 0, 1]};
const ORBIT: SceneViewCamera = {kind: "3d", orbit: {pivot: [0, 1, 0], yawDegrees: 30, pitchDegrees: -15, distance: 8}, fieldOfViewDegrees: 60};

describe("scene view cameras", () => {
    test("each Scene view of each project keeps its own camera", () => {
        let text: string | null = null;
        text = withSceneViewCamera(text, PROJECT, "scene", FLAT);
        text = withSceneViewCamera(text, PROJECT, "scene:2", ORBIT);
        text = withSceneViewCamera(text, OTHER_PROJECT, "scene", ORBIT);
        expect(storedSceneViewCamera(text, PROJECT, "scene")).toEqual(FLAT);
        expect(storedSceneViewCamera(text, PROJECT, "scene:2")).toEqual(ORBIT);
        expect(storedSceneViewCamera(text, OTHER_PROJECT, "scene")).toEqual(ORBIT);
        expect(storedSceneViewCamera(text, OTHER_PROJECT, "scene:2")).toBeUndefined();
    });

    test("forgetting a view's camera keeps the others, and a project without cameras is dropped", () => {
        let text = withSceneViewCamera(null, PROJECT, "scene", FLAT);
        text = withSceneViewCamera(text, PROJECT, "scene:2", ORBIT);
        text = withoutSceneViewCamera(text, PROJECT, "scene:2");
        expect([storedSceneViewCamera(text, PROJECT, "scene"), storedSceneViewCamera(text, PROJECT, "scene:2")]).toEqual([FLAT, undefined]);
        expect(JSON.parse(withoutSceneViewCamera(text, PROJECT, "scene"))).toEqual({});
    });

    test("unreadable text, unknown views and malformed cameras are ignored", () => {
        expect(storedSceneViewCamera("not json", PROJECT, "scene")).toBeUndefined();
        const malformed = JSON.stringify({[PROJECT]: {
            "scene": {kind: "3d", orbit: {pivot: [0, 0], yawDegrees: 0, pitchDegrees: 0, distance: 1}, fieldOfViewDegrees: 60},
            "scene:2": {kind: "2d", position: [0, 0, Number.NaN], rotation: [0, 0, 0, 1]},
            "game": FLAT,
        }});
        expect([storedSceneViewCamera(malformed, PROJECT, "scene"), storedSceneViewCamera(malformed, PROJECT, "scene:2")]).toEqual([undefined, undefined]);
        expect(storedSceneViewCamera(withSceneViewCamera(malformed, PROJECT, "scene:3", FLAT), PROJECT, "scene:3")).toEqual(FLAT);
    });

    test("only the most recently used projects are remembered", () => {
        let text: string | null = null;
        for (let project = 0; project <= MAX_CAMERA_PROJECTS; project++) text = withSceneViewCamera(text, `project ${project}`, "scene", FLAT);
        expect(storedSceneViewCamera(text, "project 0", "scene")).toBeUndefined();
        expect(storedSceneViewCamera(text, `project ${MAX_CAMERA_PROJECTS}`, "scene")).toEqual(FLAT);
        expect(Object.keys(JSON.parse(text!)).length).toBe(MAX_CAMERA_PROJECTS);
    });

    test("the camera text is the rounded pose, so equal poses read the same whatever their sign or orbit", () => {
        expect(sceneViewCameraText(FLAT)).toBe("2d 1.00 2.00 0.00 0.00 0.00 0.00 1.00");
        expect(sceneViewCameraText({...FLAT, rotation: [-0, -0, -1e-9, -1]})).toBe(sceneViewCameraText(FLAT));
        const pose = sceneViewCameraPose(ORBIT);
        const rederived: SceneViewCamera = {...ORBIT, orbit: orbitCameraFromPose(pose)};
        expect(sceneViewCameraText(rederived)).toBe(sceneViewCameraText(ORBIT));
        expect(sceneViewCameraText({...ORBIT, orbit: {...ORBIT.orbit, yawDegrees: 31}})).not.toBe(sceneViewCameraText(ORBIT));
    });
});
