import {describe, expect, test} from "../../engine/testing/harness";
import {renderBackendMatches, requestedRenderBackend} from "./smokeBackend";

describe("requestedRenderBackend", () => {
    test("reads the backend query of a page path", () => {
        expect(requestedRenderBackend("projects/3d/index.html?backend=gpu&pixelScale=2")).toBe("gpu");
        expect(requestedRenderBackend("editor/index.html?project=%2Fa&backend=pixels")).toBe("pixels");
    });

    test("is undefined without a known backend query", () => {
        expect(requestedRenderBackend("index.html")).toBeUndefined();
        expect(requestedRenderBackend("index.html?pixelScale=2")).toBeUndefined();
        expect(requestedRenderBackend("index.html?backend=vulkan")).toBeUndefined();
    });
});

describe("renderBackendMatches", () => {
    test("fails a gpu request that rendered with the fallback", () => {
        expect(renderBackendMatches("gpu", "pixels")).toBe(false);
        expect(renderBackendMatches("gpu", undefined)).toBe(false);
    });

    test("passes the requested backend, or any backend when none was requested", () => {
        expect(renderBackendMatches("gpu", "gpu")).toBe(true);
        expect(renderBackendMatches(undefined, "pixels")).toBe(true);
    });
});
