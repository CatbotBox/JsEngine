import {describe, expect, test} from "../../engine/testing/harness";
import {FollowedDocumentVisibility, isDocumentVisible, isSceneViewVisible} from "./sceneViewVisibility";
import type {VisibilityDocument} from "./sceneViewVisibility";

class FakeDocument implements VisibilityDocument {
    private readonly listeners = new Set<() => void>();

    public constructor(public visibilityState: DocumentVisibilityState) {
    }

    public get listenerCount(): number {
        return this.listeners.size;
    }

    public addEventListener(_type: "visibilitychange", listener: () => void): void {
        this.listeners.add(listener);
    }

    public removeEventListener(_type: "visibilitychange", listener: () => void): void {
        this.listeners.delete(listener);
    }

    public change(visibilityState: DocumentVisibilityState): void {
        this.visibilityState = visibilityState;
        for (const listener of [...this.listeners]) listener();
    }
}

describe("scene view visibility", () => {
    test("a Scene view is visible only while its panel is shown, the layout shows it and its document is visible", () => {
        const all = {panelShown: true, layoutShowsSceneView: true, documentVisible: true};
        expect(isSceneViewVisible(all)).toBe(true);
        expect(isSceneViewVisible({...all, panelShown: false})).toBe(false);
        expect(isSceneViewVisible({...all, layoutShowsSceneView: false})).toBe(false);
        expect(isSceneViewVisible({...all, documentVisible: false})).toBe(false);
        expect(isSceneViewVisible({panelShown: false, layoutShowsSceneView: false, documentVisible: false})).toBe(false);
    });

    test("only a visible document counts as visible", () => {
        expect(isDocumentVisible({visibilityState: "visible"})).toBe(true);
        expect(isDocumentVisible({visibilityState: "hidden"})).toBe(false);
    });

    test("following a document reports its visibility changes, and following another one stops listening to the first", () => {
        let changes = 0;
        const followed = new FollowedDocumentVisibility(() => changes++);
        const main = new FakeDocument("visible");
        const popup = new FakeDocument("visible");
        expect(followed.visible).toBe(true);
        followed.follow(main);
        expect([followed.visible, changes]).toEqual([true, 0]);
        main.change("hidden");
        expect([followed.visible, changes]).toEqual([false, 1]);
        main.change("hidden");
        expect(changes).toBe(1);
        followed.follow(popup);
        expect([followed.visible, changes, main.listenerCount, popup.listenerCount]).toEqual([true, 2, 0, 1]);
        main.change("visible");
        main.change("hidden");
        expect(changes).toBe(2);
        popup.change("hidden");
        expect([followed.visible, changes]).toEqual([false, 3]);
        popup.change("visible");
        expect([followed.visible, changes]).toEqual([true, 4]);
    });

    test("following a hidden document reports it at once, and disposing stops listening", () => {
        let changes = 0;
        const followed = new FollowedDocumentVisibility(() => changes++);
        const minimized = new FakeDocument("hidden");
        followed.follow(minimized);
        expect([followed.visible, changes]).toEqual([false, 1]);
        followed.follow(minimized);
        expect([changes, minimized.listenerCount]).toEqual([1, 1]);
        followed.dispose();
        minimized.change("visible");
        expect([followed.visible, changes, minimized.listenerCount]).toEqual([false, 1, 0]);
    });
});
