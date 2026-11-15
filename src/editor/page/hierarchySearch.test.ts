import {describe, expect, test} from "../../engine/testing/harness";
import {isEmptySearch, matchesHierarchySearch, parseHierarchySearch} from "./hierarchySearch";

describe("hierarchy search parsing", () => {
    test("plain words search names, case-insensitively", () => {
        expect(parseHierarchySearch("  Player  Ship ")).toEqual({nameText: "player ship", typeNames: []});
    });

    test("t: terms filter by component type and combine with a name", () => {
        expect(parseHierarchySearch("t:Sprite enemy T:LocalPosition")).toEqual({nameText: "enemy", typeNames: ["sprite", "localposition"]});
    });

    test("an empty t: term and blank text are an empty search", () => {
        expect(isEmptySearch(parseHierarchySearch("t:  "))).toBe(true);
        expect(isEmptySearch(parseHierarchySearch(""))).toBe(true);
        expect(isEmptySearch(parseHierarchySearch("t:Camera"))).toBe(false);
    });
});

describe("hierarchy search matching", () => {
    const types = ["LocalPosition", "Sprite"];

    test("a name term matches a substring of the label", () => {
        expect(matchesHierarchySearch(parseHierarchySearch("ship"), "Player Ship", types)).toBe(true);
        expect(matchesHierarchySearch(parseHierarchySearch("boss"), "Player Ship", types)).toBe(false);
    });

    test("every t: term must match the start of one of the entity's component type names", () => {
        expect(matchesHierarchySearch(parseHierarchySearch("t:spr"), "Ship", types)).toBe(true);
        expect(matchesHierarchySearch(parseHierarchySearch("t:Sprite t:Camera"), "Ship", types)).toBe(false);
        expect(matchesHierarchySearch(parseHierarchySearch("t:Sprite ship"), "Ship", types)).toBe(true);
        expect(matchesHierarchySearch(parseHierarchySearch("t:Sprite boss"), "Ship", types)).toBe(false);
    });
});
