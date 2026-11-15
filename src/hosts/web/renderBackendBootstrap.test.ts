import {describe, expect, test} from "../../engine/testing/harness";
import {chooseRenderBackend, gpuFallbackWarning, webGpuUsable} from "./renderBackendBootstrap";
import type {OffscreenTransferCanvas, WebGpuNavigator} from "./renderBackendBootstrap";

const TRANSFERABLE_CANVAS: OffscreenTransferCanvas = {transferControlToOffscreen: () => undefined};
const OLD_CANVAS: OffscreenTransferCanvas = {};
const AN_ADAPTER = {};

function navigatorWithAdapter(adapter: unknown): WebGpuNavigator {
    return {gpu: {requestAdapter: () => Promise.resolve(adapter)}};
}

describe("chooseRenderBackend", () => {
    test("cells and pixels requests are taken as they are", () => {
        expect(chooseRenderBackend("cells", {gpuScript: true, webGpuUsable: true})).toEqual({backend: "cells"});
        expect(chooseRenderBackend("pixels", {gpuScript: false, webGpuUsable: false})).toEqual({backend: "pixels"});
    });

    test("gpu is chosen only when the page has a gpu script and WebGPU is usable; otherwise pixels, with a reason", () => {
        expect(chooseRenderBackend("gpu", {gpuScript: true, webGpuUsable: true})).toEqual({backend: "gpu"});
        const noScript = chooseRenderBackend("gpu", {gpuScript: false, webGpuUsable: true});
        const unusable = chooseRenderBackend("gpu", {gpuScript: true, webGpuUsable: false});
        expect([noScript.backend, unusable.backend]).toEqual(["pixels", "pixels"]);
        expect(noScript.fallbackReason).toBeDefined();
        expect(unusable.fallbackReason).toBeDefined();
        expect(noScript.fallbackReason).not.toBe(unusable.fallbackReason);
        expect(gpuFallbackWarning(unusable.fallbackReason!).includes("?backend=pixels")).toBe(true);
    });
});

describe("webGpuUsable", () => {
    test("needs navigator.gpu, an adapter and a canvas that transfers to an OffscreenCanvas", async () => {
        expect(await webGpuUsable(navigatorWithAdapter(AN_ADAPTER), TRANSFERABLE_CANVAS)).toBe(true);
        expect(await webGpuUsable({}, TRANSFERABLE_CANVAS)).toBe(false);
        expect(await webGpuUsable(navigatorWithAdapter(null), TRANSFERABLE_CANVAS)).toBe(false);
        expect(await webGpuUsable(navigatorWithAdapter(AN_ADAPTER), OLD_CANVAS)).toBe(false);
    });

    test("a throwing or rejecting adapter request means unusable, not an error", async () => {
        const throwing: WebGpuNavigator = {gpu: {requestAdapter: () => {
            throw new Error("blocked");
        }}};
        const rejecting: WebGpuNavigator = {gpu: {requestAdapter: () => Promise.reject(new Error("lost"))}};
        const throwingGetter = Object.defineProperty({}, "gpu", {get: () => {
            throw new Error("denied");
        }}) as WebGpuNavigator;
        expect(await webGpuUsable(throwing, TRANSFERABLE_CANVAS)).toBe(false);
        expect(await webGpuUsable(rejecting, TRANSFERABLE_CANVAS)).toBe(false);
        expect(await webGpuUsable(throwingGetter, TRANSFERABLE_CANVAS)).toBe(false);
    });
});
