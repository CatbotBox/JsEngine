import {describe, expect, test} from "../testing/harness";
import {validateProjectManifest} from "./projectManifest";
import type {ProjectManifestValidation} from "./projectManifest";
import {
    declaredTargets,
    PIXEL_SCALE_LIMITS,
    PROJECT_TARGETS,
    TARGET_DEFAULT_BACKENDS,
    targetDrawsPixels,
    targetRenderDefaults,
    targetsProblems,
} from "./projectTargets";
import type {ProjectTargets} from "./projectTargets";

function problemsOf(validation: ProjectManifestValidation): readonly string[] {
    return validation.ok ? [] : validation.problems;
}

function manifestWithTargets(targets: unknown): string {
    return JSON.stringify({name: "Game", targets});
}

describe("manifest targets", () => {
    test("leaving targets out declares every target with no settings", () => {
        const validation = validateProjectManifest(JSON.stringify({name: "Game"}));
        expect(validation.ok && validation.manifest.targets === undefined).toBe(true);
        expect(declaredTargets(undefined)).toEqual([...PROJECT_TARGETS]);
    });

    test("listed targets come back with their settings, in target order, and only they are declared", () => {
        const validation = validateProjectManifest(manifestWithTargets({terminal: {}, web: {backend: "gpu", pixelScale: 2}}));
        expect(validation.ok).toBe(true);
        if (!validation.ok) return;
        expect(validation.manifest.targets).toEqual({web: {backend: "gpu", pixelScale: 2}, terminal: {}});
        expect(Object.keys(validation.manifest.targets ?? {})).toEqual(["web", "terminal"]);
        expect(declaredTargets(validation.manifest.targets)).toEqual(["web", "terminal"]);
    });

    test("a target must render with a backend it supports", () => {
        expect(problemsOf(validateProjectManifest(manifestWithTargets({terminal: {backend: "pixels"}})))).toEqual([
            `"targets.terminal.backend" must be one of cells (the backends the terminal target renders with), got "pixels"`,
        ]);
        expect(problemsOf(validateProjectManifest(manifestWithTargets({web: {backend: "vulkan"}})))).toEqual([
            `"targets.web.backend" must be one of cells, pixels, gpu (the backends the web target renders with), got "vulkan"`,
        ]);
    });

    test("the pixel scale is a whole number within the page limits, and a cells-only target has none", () => {
        for (const scale of [0, PIXEL_SCALE_LIMITS.max + 1, 1.5, "2", null]) {
            const problems = problemsOf(validateProjectManifest(manifestWithTargets({window: {pixelScale: scale}})));
            expect(problems.length === 1 && problems[0].startsWith(`"targets.window.pixelScale" must be a whole number`)).toBe(true);
        }
        expect(validateProjectManifest(manifestWithTargets({window: {pixelScale: PIXEL_SCALE_LIMITS.max}})).ok).toBe(true);
        expect(problemsOf(validateProjectManifest(manifestWithTargets({terminal: {pixelScale: 2}})))).toEqual([
            `"targets.terminal.pixelScale": the terminal target draws cells, so it has no pixel scale; remove it`,
        ]);
    });

    test("unknown targets, unknown settings, a non-object and an empty list are each named", () => {
        expect(problemsOf(validateProjectManifest(manifestWithTargets({mobile: {}, web: {zoom: 2}})))).toEqual([
            `"targets.mobile" is not a target; the targets are web, window, terminal`,
            `"targets.web.zoom" is not a target setting; the settings are backend, pixelScale`,
        ]);
        expect(problemsOf(validateProjectManifest(manifestWithTargets(["web"])))[0].startsWith(`"targets" must be an object keyed by target`)).toBe(true);
        expect(problemsOf(validateProjectManifest(manifestWithTargets({web: true})))[0].startsWith(`"targets.web" must be an object`)).toBe(true);
        expect(problemsOf(validateProjectManifest(manifestWithTargets({})))[0].startsWith(`"targets" lists no target`)).toBe(true);
    });

    test("targetsProblems leaves an absent value alone", () => {
        expect(targetsProblems(undefined)).toEqual({problems: []});
    });
});

describe("per-target render defaults", () => {
    test("without settings each target keeps the backend its launches default to and no pixel scale", () => {
        for (const target of PROJECT_TARGETS) {
            expect(targetRenderDefaults(undefined, target)).toEqual({backend: TARGET_DEFAULT_BACKENDS[target]});
        }
        expect(TARGET_DEFAULT_BACKENDS).toEqual({web: "pixels", window: "pixels", terminal: "cells"});
    });

    test("a target's own settings win, and other targets keep their defaults", () => {
        const targets: ProjectTargets = {web: {backend: "cells"}, window: {backend: "gpu", pixelScale: 3}};
        expect(targetRenderDefaults(targets, "web")).toEqual({backend: "cells"});
        expect(targetRenderDefaults(targets, "window")).toEqual({backend: "gpu", pixelScale: 3});
        expect(targetRenderDefaults(targets, "terminal")).toEqual({backend: "cells"});
    });

    test("only targets with a non-cells backend draw pixels", () => {
        expect(PROJECT_TARGETS.filter(targetDrawsPixels)).toEqual(["web", "window"]);
    });
});
