import {describe, expect, test} from "../../engine/testing/harness";
import {
    DOCK_PANEL_KINDS,
    dockPanelInstanceId,
    dockPanelInstanceOf,
    dockPanelKindOf,
    dockPanelTitle,
    isDockPanelId,
    isFirstDockPanelInstance,
    isSceneViewId,
    nextDockPanelInstance,
} from "./dockPanelIds";

describe("dock panel ids", () => {
    test("every fixed panel is its own first instance, and only Scene views take numbered instances", () => {
        expect(DOCK_PANEL_KINDS.every(isDockPanelId)).toBe(true);
        expect(["scene:2", "scene:10"].every(isDockPanelId)).toBe(true);
        expect(["scene:1", "scene:0", "scene:-2", "scene:02", "scene:2.5", "scene:", "game:2", "inspector:3", "nope", "", 2, null].some(isDockPanelId)).toBe(false);
    });

    test("an instance id names its kind and number, and the first instance is the bare kind", () => {
        expect(dockPanelInstanceId("scene", 1)).toBe("scene");
        expect(dockPanelInstanceId("scene", 3)).toBe("scene:3");
        expect([dockPanelKindOf("scene:3"), dockPanelInstanceOf("scene:3")]).toEqual(["scene", 3]);
        expect([dockPanelKindOf("console"), dockPanelInstanceOf("console")]).toEqual(["console", 1]);
        expect([isFirstDockPanelInstance("scene"), isFirstDockPanelInstance("scene:2"), isFirstDockPanelInstance("game")]).toEqual([true, false, true]);
    });

    test("only Scene view ids are scene view ids", () => {
        expect(["scene", "scene:2"].every(isSceneViewId)).toBe(true);
        expect(["game", "inspector", "scene:1", "scene:x"].some(isSceneViewId)).toBe(false);
    });

    test("the next instance is the lowest number not taken, so closed numbers are reused", () => {
        expect(nextDockPanelInstance("scene", [])).toBe("scene");
        expect(nextDockPanelInstance("scene", ["scene", "game"])).toBe("scene:2");
        expect(nextDockPanelInstance("scene", ["scene", "scene:2", "scene:4"])).toBe("scene:3");
        expect(nextDockPanelInstance("scene", ["scene:2"])).toBe("scene");
    });

    test("titles number every instance after the first", () => {
        expect([dockPanelTitle("scene", "Scene"), dockPanelTitle("scene:2", "Scene")]).toEqual(["Scene", "Scene (2)"]);
    });
});
