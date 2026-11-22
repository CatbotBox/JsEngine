import {describe, expect, test} from "../../engine/testing/harness";
import {
    MAX_RECENT_SCENES,
    MAX_REMEMBERED_PROJECTS,
    recentScenesOf,
    recentScenesProjectKey,
    withoutRecentScene,
    withoutRecentScenes,
    withRecentScene,
} from "./recentScenes";

const PROJECT = recentScenesProjectKey("Swarm", "demo/swarm");
const OTHER_PROJECT = recentScenesProjectKey("Swarm", "copies/swarm");
const MAIN = "scenes/main.scene.json";
const LEVEL = "scenes/level.scene.json";

describe("recent scenes", () => {
    test("the most recently opened scene comes first, without duplicates, per project", () => {
        let text = withRecentScene(null, PROJECT, MAIN);
        text = withRecentScene(text, PROJECT, LEVEL);
        text = withRecentScene(text, PROJECT, `./${MAIN}`);
        text = withRecentScene(text, OTHER_PROJECT, LEVEL);
        expect(recentScenesOf(text, PROJECT)).toEqual([MAIN, LEVEL]);
        expect(recentScenesOf(text, OTHER_PROJECT)).toEqual([LEVEL]);
        expect(recentScenesOf(text, recentScenesProjectKey("Other", "demo/swarm"))).toEqual([]);
    });

    test("the list keeps the newest scenes up to its limit", () => {
        let text: string | null = null;
        for (let index = 0; index < MAX_RECENT_SCENES + 3; index++) text = withRecentScene(text, PROJECT, `scenes/${index}.scene.json`);
        const recent = recentScenesOf(text, PROJECT);
        expect(recent.length).toBe(MAX_RECENT_SCENES);
        expect(recent[0]).toBe(`scenes/${MAX_RECENT_SCENES + 2}.scene.json`);
    });

    test("only the most recent projects are remembered", () => {
        let text: string | null = null;
        for (let index = 0; index <= MAX_REMEMBERED_PROJECTS; index++) text = withRecentScene(text, recentScenesProjectKey(`p${index}`, ""), MAIN);
        expect(recentScenesOf(text, recentScenesProjectKey("p0", ""))).toEqual([]);
        expect(recentScenesOf(text, recentScenesProjectKey(`p${MAX_REMEMBERED_PROJECTS}`, ""))).toEqual([MAIN]);
    });

    test("a scene or a whole project's list can be forgotten", () => {
        let text = withRecentScene(withRecentScene(null, PROJECT, MAIN), PROJECT, LEVEL);
        text = withRecentScene(text, OTHER_PROJECT, MAIN);
        expect(recentScenesOf(withoutRecentScene(text, PROJECT, LEVEL), PROJECT)).toEqual([MAIN]);
        const cleared = withoutRecentScenes(text, PROJECT);
        expect(recentScenesOf(cleared, PROJECT)).toEqual([]);
        expect(recentScenesOf(cleared, OTHER_PROJECT)).toEqual([MAIN]);
    });

    test("broken or foreign stored text reads as no recent scenes", () => {
        expect(recentScenesOf("not json", PROJECT)).toEqual([]);
        expect(recentScenesOf("[1, 2]", PROJECT)).toEqual([]);
        expect(recentScenesOf(JSON.stringify({[PROJECT]: [MAIN, 3]}), PROJECT)).toEqual([]);
        expect(recentScenesOf(withRecentScene("not json", PROJECT, MAIN), PROJECT)).toEqual([MAIN]);
    });
});
