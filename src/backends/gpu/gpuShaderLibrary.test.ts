import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {GpuShaderLibrary, unknownSurfaceShaderMessage} from "./gpuShaderLibrary";
import {LIT_SURFACE_SHADER} from "./gpuSurfaceShader";
import {assembleSurfaceShader, BASIC_LIT, SURFACE_FUNCTION_SIGNATURE} from "./shaders/basicLitShader";
import {ConsoleRecorder} from "./testing/consoleRecorder";

const TOON = "toon";
const MISSING = "missing";
const ALSO_MISSING = "also missing";
const LOOKUPS = 3;
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * 0.5, 1.0);
}`;
const BRIGHTER_TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * 0.75, 1.0);
}`;

const recorders: ConsoleRecorder[] = [];

function recordConsole(): ConsoleRecorder {
    const recorder = new ConsoleRecorder();
    recorders.push(recorder);
    return recorder;
}

afterEach(() => {
    for (const recorder of recorders.splice(0)) recorder.detach();
});

describe("GpuShaderLibrary", () => {
    test("holds the built-in lit shader under the reserved name lit, and refuses to replace it", () => {
        const library = new GpuShaderLibrary();
        expect([library.has(LIT_SURFACE_SHADER), library.shaderNamed(LIT_SURFACE_SHADER)]).toEqual([true, BASIC_LIT]);
        expect(library.names).toEqual([LIT_SURFACE_SHADER]);
        expect(() => library.register(LIT_SURFACE_SHADER, TOON_SOURCE)).toThrow();
        expect(library.shaderNamed(LIT_SURFACE_SHADER)).toBe(BASIC_LIT);
    });

    test("register assembles the snippet into the lit template under its name", () => {
        const library = new GpuShaderLibrary();
        const toon = library.register(TOON, TOON_SOURCE);
        expect(toon).toEqual(assembleSurfaceShader(TOON, TOON_SOURCE));
        expect(library.shaderNamed(TOON)).toBe(toon);
        expect(library.names).toEqual([LIT_SURFACE_SHADER, TOON]);
    });

    test("registering a name again replaces its shader with a new one", () => {
        const library = new GpuShaderLibrary();
        const first = library.register(TOON, TOON_SOURCE);
        const second = library.register(TOON, BRIGHTER_TOON_SOURCE);
        expect(second).not.toBe(first);
        expect(library.shaderNamed(TOON)).toBe(second);
        expect(second.code.endsWith(BRIGHTER_TOON_SOURCE)).toBe(true);
    });

    test("an unknown name warns once per name and resolves to the built-in lit shader until it is registered", () => {
        const recorder = recordConsole();
        const library = new GpuShaderLibrary();
        for (let i = 0; i < LOOKUPS; i++) {
            expect(library.shaderNamed(MISSING)).toBe(BASIC_LIT);
            expect(library.shaderNamed(ALSO_MISSING)).toBe(BASIC_LIT);
        }
        expect(recorder.warnings).toEqual([unknownSurfaceShaderMessage(MISSING), unknownSurfaceShaderMessage(ALSO_MISSING)]);
        const registered = library.register(MISSING, TOON_SOURCE);
        expect(library.shaderNamed(MISSING)).toBe(registered);
        expect(recorder.warnings.length).toBe(2);
    });
});
