import {describe, expect, test} from "../../engine/testing/harness";
import {boundsOfDockWindowFeatures, clampedScreenBounds, dockWindowFeatures, dockWindowName, isDockWindowName, isScreenBounds} from "./dockWindows";

const SCREEN = {x: 0, y: 0, width: 1920, height: 1040};

describe("dock windows", () => {
    test("a floating window's name carries its id and is told apart from other names", () => {
        expect(isDockWindowName(dockWindowName("float-3"))).toBe(true);
        expect(isDockWindowName("")).toBe(false);
        expect(isDockWindowName("_blank")).toBe(false);
        expect(isDockWindowName(dockWindowName(""))).toBe(false);
    });

    test("bounds survive a round trip through window.open features, rounded to whole pixels", () => {
        expect(dockWindowFeatures({x: 10.4, y: -20.6, width: 640, height: 480})).toBe("left=10,top=-21,width=640,height=480");
        expect(boundsOfDockWindowFeatures("left=10,top=-21,width=640,height=480")).toEqual({x: 10, y: -21, width: 640, height: 480});
        expect(boundsOfDockWindowFeatures(" width = 300 , height=200, left=5, top=6, popup")).toEqual({x: 5, y: 6, width: 300, height: 200});
    });

    test("features without a position or a positive size are no bounds", () => {
        expect(boundsOfDockWindowFeatures("")).toBeUndefined();
        expect(boundsOfDockWindowFeatures("width=300,height=200")).toBeUndefined();
        expect(boundsOfDockWindowFeatures("left=0,top=0,width=0,height=200")).toBeUndefined();
        expect(boundsOfDockWindowFeatures("left=a,top=0,width=10,height=200")).toBeUndefined();
    });

    test("only finite bounds with a positive size count", () => {
        expect(isScreenBounds({x: -5, y: 0, width: 1, height: 1})).toBe(true);
        expect(isScreenBounds({x: 0, y: 0, width: -1, height: 1})).toBe(false);
        expect(isScreenBounds({x: Number.NaN, y: 0, width: 1, height: 1})).toBe(false);
        expect(isScreenBounds({x: 0, y: 0, width: 1})).toBe(false);
        expect(isScreenBounds(null)).toBe(false);
    });

    test("clamping keeps a window inside the screen area and shrinks one larger than it", () => {
        expect(clampedScreenBounds({x: 100, y: 100, width: 400, height: 300}, SCREEN)).toEqual({x: 100, y: 100, width: 400, height: 300});
        expect(clampedScreenBounds({x: -300, y: 2000, width: 400, height: 300}, SCREEN)).toEqual({x: 0, y: 740, width: 400, height: 300});
        expect(clampedScreenBounds({x: 1800, y: -50, width: 400, height: 300}, SCREEN)).toEqual({x: 1520, y: 0, width: 400, height: 300});
        expect(clampedScreenBounds({x: 50, y: 50, width: 4000, height: 3000}, {x: 1920, y: 0, width: 1280, height: 1000})).toEqual({x: 1920, y: 0, width: 1280, height: 1000});
    });
});
