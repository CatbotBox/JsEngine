import {describe, expect, test} from "../../engine/testing/harness";
import {WINDOW_ZOOM_PATH, ZOOM_FACTORS, zoomSettingsText} from "../project/windowZoom";
import {uiScaleChoices, windowUiScale} from "./uiScale";
import type {UiScaleFetch, UiScaleResponse} from "./uiScale";

const HTML_FALLBACK = "<!doctype html><title>editor</title>";

function response(ok: boolean, text: string): UiScaleResponse {
    return {ok, text: () => Promise.resolve(text)};
}

function desktopWindow(initial: number, requests: string[]): UiScaleFetch {
    let factor = initial;
    return (path, init) => {
        requests.push(`${init?.method ?? "GET"} ${path}${init === undefined ? "" : ` ${init.body}`}`);
        if (init !== undefined) factor = JSON.parse(init.body).zoomFactor;
        return Promise.resolve(response(true, zoomSettingsText(factor)));
    };
}

describe("UI scale", () => {
    test("the choices are the desktop zoom factors as percentages", () => {
        const choices = uiScaleChoices();
        expect(choices.map(choice => choice.factor)).toEqual([...ZOOM_FACTORS]);
        expect(choices.find(choice => choice.factor === 1.25)?.label).toBe("125%");
        expect(choices.find(choice => choice.factor === 0.67)?.label).toBe("67%");
    });

    test("the desktop window answers the zoom path, so the scale goes through the window's zoom", async () => {
        const requests: string[] = [];
        const scale = await windowUiScale(desktopWindow(1.3, requests));
        expect([scale?.scalesWindow, scale?.factor]).toEqual([true, 1.25]);
        await scale?.set(1.5);
        expect(requests).toEqual([`GET ${WINDOW_ZOOM_PATH}`, `PUT ${WINDOW_ZOOM_PATH} ${zoomSettingsText(1.5)}`]);
    });

    test("a browser page has no window zoom: missing routes, page fallbacks and network errors all say so", async () => {
        expect(await windowUiScale(() => Promise.resolve(response(false, "Not found")))).toBeUndefined();
        expect(await windowUiScale(() => Promise.resolve(response(true, HTML_FALLBACK)))).toBeUndefined();
        expect(await windowUiScale(() => Promise.reject(new Error("offline")))).toBeUndefined();
    });

    test("a refused window zoom is reported", async () => {
        let calls = 0;
        const scale = await windowUiScale(() => Promise.resolve(calls++ === 0 ? response(true, zoomSettingsText(1)) : response(false, "bad")));
        let refused: unknown;
        await scale?.set(2).catch(error => refused = error);
        expect(refused instanceof Error).toBe(true);
    });
});
