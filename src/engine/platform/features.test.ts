import {describe, expect, test} from "../testing/harness";
import type * as Fs from "fs";
import type * as Path from "path";
import {hasFeature, optionalFeature, PLATFORM_FEATURE_CONSTANTS, PLATFORM_FEATURES} from "./platform";

const fs = require("fs") as typeof Fs;
const path = require("path") as typeof Path;

const FEATURE_CONSTANTS_DECLARATION = path.join(__dirname, "features.d.ts");
const DECLARED_BOOLEAN_CONSTANT = /^declare const (\w+): boolean;\r?$/gm;

describe("platform features", () => {
    test("features.d.ts declares one boolean constant per feature, under the names the toolchain defines", () => {
        const declared = [...fs.readFileSync(FEATURE_CONSTANTS_DECLARATION, "utf8").matchAll(DECLARED_BOOLEAN_CONSTANT)].map(match => match[1]);
        expect(declared.sort()).toEqual(PLATFORM_FEATURES.map(feature => PLATFORM_FEATURE_CONSTANTS[feature]).sort());
    });

    test("unbundled, no constant is defined, so optionalFeature runs every probe and returns its result", () => {
        expect(PLATFORM_FEATURES.map(feature => optionalFeature(feature, () => feature))).toEqual([...PLATFORM_FEATURES]);
    });

    test("unbundled, hasFeature detects the runtime: a node-compatible process with shared memory and no DOM, WebGPU or audio", () => {
        expect(hasFeature("node")).toBe(true);
        expect(hasFeature("workers")).toBe(true);
        expect(hasFeature("sharedMemory")).toBe(true);
        expect(hasFeature("dom")).toBe(false);
        expect(hasFeature("gpu")).toBe(false);
        expect(hasFeature("audio")).toBe(false);
    });
});
