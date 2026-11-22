import {describe, expect, test} from "../../engine/testing/harness";
import {DEFAULT_ZOOM_FACTOR, nearestZoomFactor, nextZoomFactor, storedZoomFactor, ZOOM_FACTORS, zoomCommandOf, zoomFactorOfText, zoomSettingsText} from "./windowZoom";

const KEY_DOWN = {type: "keyDown", control: false, meta: false, alt: false};
const MIN_ZOOM = ZOOM_FACTORS[0];
const MAX_ZOOM = ZOOM_FACTORS[ZOOM_FACTORS.length - 1];

describe("windowZoom", () => {
    test("ctrl or cmd with =, -, 0 maps to zoom commands", () => {
        expect(zoomCommandOf({...KEY_DOWN, control: true, key: "="})).toBe("in");
        expect(zoomCommandOf({...KEY_DOWN, control: true, key: "+"})).toBe("in");
        expect(zoomCommandOf({...KEY_DOWN, meta: true, key: "-"})).toBe("out");
        expect(zoomCommandOf({...KEY_DOWN, control: true, key: "0"})).toBe("reset");
    });

    test("unmodified, alt chords and key-up are not zoom commands", () => {
        expect(zoomCommandOf({...KEY_DOWN, key: "="})).toBeUndefined();
        expect(zoomCommandOf({...KEY_DOWN, control: true, alt: true, key: "="})).toBeUndefined();
        expect(zoomCommandOf({...KEY_DOWN, type: "keyUp", control: true, key: "="})).toBeUndefined();
        expect(zoomCommandOf({...KEY_DOWN, control: true, key: "s"})).toBeUndefined();
    });

    test("zooming steps through the factor list and clamps at its ends", () => {
        expect(nextZoomFactor(1, "in")).toBe(1.1);
        expect(nextZoomFactor(1, "out")).toBe(0.9);
        expect(nextZoomFactor(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
        expect(nextZoomFactor(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
        expect(nextZoomFactor(1.3, "in")).toBe(1.5);
        expect(nextZoomFactor(1.3, "out")).toBe(1.25);
        expect(nextZoomFactor(2.5, "reset")).toBe(DEFAULT_ZOOM_FACTOR);
    });

    test("stored settings round-trip and fall back to the default when missing or invalid", () => {
        expect(storedZoomFactor(zoomSettingsText(1.75))).toBe(1.75);
        expect(storedZoomFactor(undefined)).toBe(DEFAULT_ZOOM_FACTOR);
        expect(storedZoomFactor("not json")).toBe(DEFAULT_ZOOM_FACTOR);
        expect(storedZoomFactor(zoomSettingsText(MAX_ZOOM * 2))).toBe(DEFAULT_ZOOM_FACTOR);
        expect(storedZoomFactor(JSON.stringify({zoomFactor: "2"}))).toBe(DEFAULT_ZOOM_FACTOR);
    });

    test("a zoom request names a factor in range or nothing; any factor snaps to the nearest listed one", () => {
        expect(zoomFactorOfText(zoomSettingsText(1.25))).toBe(1.25);
        expect(zoomFactorOfText("null")).toBeUndefined();
        expect(zoomFactorOfText("<!doctype html>")).toBeUndefined();
        expect(zoomFactorOfText(zoomSettingsText(MIN_ZOOM / 2))).toBeUndefined();
        expect(nearestZoomFactor(1.3)).toBe(1.25);
        expect(nearestZoomFactor(MAX_ZOOM * 2)).toBe(MAX_ZOOM);
        expect(nearestZoomFactor(1)).toBe(DEFAULT_ZOOM_FACTOR);
    });
});
