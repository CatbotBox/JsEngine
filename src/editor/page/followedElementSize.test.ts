import {describe, expect, test} from "../../engine/testing/harness";
import {FollowedElementSize} from "./followedElementSize";
import type {SizedElement, SizeObservation, SizeObserverWindow} from "./followedElementSize";

class FakeWindow implements SizeObserverWindow {
    public readonly document = {defaultView: this as SizeObserverWindow | null};
    public readonly observers: FakeObserver[] = [];
    private frames: (() => void)[] = [];
    public readonly ResizeObserver: new (callback: () => void) => SizeObservation;

    public constructor() {
        const window = this;
        this.ResizeObserver = class extends FakeObserver {
            public constructor(callback: () => void) {
                super(callback);
                window.observers.push(this);
            }
        };
    }

    public get connected(): FakeObserver[] {
        return this.observers.filter(observer => observer.target !== undefined);
    }

    public requestAnimationFrame(callback: () => void): number {
        this.frames.push(callback);
        return this.frames.length;
    }

    public notify(): void {
        for (const observer of this.connected) observer.callback();
    }

    public runFrames(): void {
        const frames = this.frames;
        this.frames = [];
        for (const frame of frames) frame();
    }
}

class FakeObserver implements SizeObservation {
    public target: SizedElement | undefined;

    public constructor(public readonly callback: () => void) {
    }

    public observe(target: SizedElement): void {
        this.target = target;
    }

    public disconnect(): void {
        this.target = undefined;
    }
}

class FakeElement implements SizedElement {
    public width = 0;
    public height = 0;

    public constructor(public ownerDocument: FakeWindow["document"]) {
    }

    public getBoundingClientRect(): {readonly width: number, readonly height: number} {
        return {width: this.width, height: this.height};
    }

    public resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }
}

describe("following an element's size across windows", () => {
    test("a size change reports once, on the element's window's next frame", () => {
        const main = new FakeWindow();
        const element = new FakeElement(main.document);
        let changes = 0;
        new FollowedElementSize(element, () => changes++);
        expect(main.connected.map(observer => observer.target)).toEqual([element]);
        element.resize(400, 300);
        main.notify();
        main.notify();
        expect(changes).toBe(0);
        main.runFrames();
        expect(changes).toBe(1);
        main.notify();
        main.runFrames();
        expect(changes).toBe(1);
    });

    test("an element moved into a floating window is observed there, so a resize inside that window reaches it", () => {
        const main = new FakeWindow();
        const floating = new FakeWindow();
        const element = new FakeElement(main.document);
        let changes = 0;
        const size = new FollowedElementSize(element, () => changes++);
        element.ownerDocument = floating.document;
        size.follow();
        expect([main.connected.length, floating.connected.map(observer => observer.target)]).toEqual([0, [element]]);
        element.resize(630, 632);
        floating.notify();
        floating.runFrames();
        expect(changes).toBe(1);
        size.follow();
        expect([floating.observers.length, floating.connected.length]).toEqual([1, 1]);
        element.ownerDocument = main.document;
        size.follow();
        element.resize(1265, 632);
        main.notify();
        main.runFrames();
        expect([changes, main.connected.length, floating.connected.length]).toEqual([2, 1, 0]);
    });

    test("disposing stops observing and drops a frame already scheduled", () => {
        const main = new FakeWindow();
        const element = new FakeElement(main.document);
        let changes = 0;
        const size = new FollowedElementSize(element, () => changes++);
        element.resize(10, 10);
        main.notify();
        size.dispose();
        main.runFrames();
        size.follow();
        expect([changes, main.connected.length]).toEqual([0, 0]);
    });
});
