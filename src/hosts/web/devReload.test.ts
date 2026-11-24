import {describe, expect, test} from "../../engine/testing/harness";
import {
    DEV_DATA_ASSETS_PAGE_EVENT,
    isDevDataAssetsChange,
    offerDevDataAssetsChange,
    parseDevDataAssetsChange,
    projectPathsIn,
    siteFolderOf,
    takeDevDataAssetsChanges,
} from "./devReload";
import type {DevDataAssetsChange} from "./devReload";

const CHANGE: DevDataAssetsChange = {paths: ["/2d/assets/demo2d.asset.json", "/3d/assets/demo3d.asset.json"]};

describe("dev data asset changes on game pages", () => {
    test("the event data is a JSON object with a list of string paths; anything else is rejected", () => {
        expect(parseDevDataAssetsChange(JSON.stringify(CHANGE))).toEqual(CHANGE);
        expect(parseDevDataAssetsChange("{")).toBeUndefined();
        expect(parseDevDataAssetsChange("{}")).toBeUndefined();
        expect(parseDevDataAssetsChange(JSON.stringify({paths: [1]}))).toBeUndefined();
        expect(parseDevDataAssetsChange("null")).toBeUndefined();
        expect(isDevDataAssetsChange({paths: []})).toBe(true);
    });

    test("an offered change nobody takes is unhandled, so the bootstrap reloads the page", () => {
        expect(offerDevDataAssetsChange(new EventTarget(), CHANGE)).toBe(false);
    });

    test("a running world page takes each offered change until it stops listening", () => {
        const page = new EventTarget();
        const taken: DevDataAssetsChange[] = [];
        const stop = takeDevDataAssetsChanges(page, change => {
            taken.push(change);
            return true;
        });
        expect(offerDevDataAssetsChange(page, CHANGE)).toBe(true);
        stop();
        expect(offerDevDataAssetsChange(page, CHANGE)).toBe(false);
        expect(taken).toEqual([CHANGE]);
    });

    test("a page that could not deliver the change leaves it unhandled, and malformed details are ignored", () => {
        const page = new EventTarget();
        let calls = 0;
        takeDevDataAssetsChanges(page, () => {
            calls++;
            return false;
        });
        expect(offerDevDataAssetsChange(page, CHANGE)).toBe(false);
        expect(page.dispatchEvent(new CustomEvent(DEV_DATA_ASSETS_PAGE_EVENT, {detail: {paths: "x"}, cancelable: true}))).toBe(true);
        expect(calls).toBe(1);
    });

    test("the site folder is the folder of the world worker script, decoded", () => {
        expect(siteFolderOf("2d-cells.worker.js", "http://localhost:8080/2d/?backend=cells")).toBe("/2d/");
        expect(siteFolderOf("2d-cells.worker.js", "http://localhost:8080/2d/index.html")).toBe("/2d/");
        expect(siteFolderOf("my%20game-cells.worker.js", "http://localhost:8080/my%20game/")).toBe("/my game/");
    });

    test("site paths under the page's folder become project paths; other projects' are dropped", () => {
        expect(projectPathsIn("/2d/", [...CHANGE.paths, "/2d/"])).toEqual(["assets/demo2d.asset.json"]);
        expect(projectPathsIn("/swarm/", CHANGE.paths)).toEqual([]);
    });
});
