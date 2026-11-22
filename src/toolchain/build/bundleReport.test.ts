import {describe, expect, test} from "../../engine/testing/harness";
import {bundleBaselineText, compareBundles, parseBundleBaseline} from "./bundleReport";
import type {BundleRecord} from "./bundleReport";

const WORKER_KEY = "demo/swarm web pixels worker";
const MAIN_KEY = "demo/swarm terminal cells main";
const GONE_KEY = "demo/old web pixels worker";
const BEFORE_BYTES = 300;
const AFTER_BYTES = 200;
const BUN_VERSION = "1.4.4";

const WORKER_BEFORE: BundleRecord = {key: WORKER_KEY, modules: ["src/a.ts", "src/mesh.ts", "src/sprite.ts"], minifiedBytes: BEFORE_BYTES};

describe("bundle baseline", () => {
    test("records round-trip through the baseline text, under the bun version that recorded them", () => {
        const records: BundleRecord[] = [WORKER_BEFORE, {key: MAIN_KEY, modules: ["src/a.ts"], minifiedBytes: AFTER_BYTES}];
        const text = bundleBaselineText(records, BUN_VERSION);
        expect(text.split("\n").slice(0, 2)).toEqual([`recorded with bun ${BUN_VERSION}`, `${WORKER_KEY}: 3 modules, ${BEFORE_BYTES} bytes minified`]);
        const baseline = parseBundleBaseline(text);
        expect(baseline.bunVersion).toBe(BUN_VERSION);
        expect([...baseline.records.values()]).toEqual(records);
    });

    test("an added module is reported, a removed one is an improvement, and bundles on one side only are named", () => {
        const after: BundleRecord[] = [
            {key: WORKER_KEY, modules: ["src/a.ts", "src/cells.ts", "src/sprite.ts"], minifiedBytes: AFTER_BYTES},
            {key: MAIN_KEY, modules: ["src/a.ts"], minifiedBytes: AFTER_BYTES},
        ];
        const baseline = parseBundleBaseline(bundleBaselineText([WORKER_BEFORE, {key: GONE_KEY, modules: [], minifiedBytes: 0}], BUN_VERSION));
        const report = compareBundles(after, baseline.records);
        expect(report.comparisons.map(comparison => [comparison.record.key, comparison.added, comparison.removed])).toEqual([[WORKER_KEY, ["src/cells.ts"], ["src/mesh.ts"]]]);
        expect(report.missingFromBaseline).toEqual([MAIN_KEY]);
        expect(report.missingFromBuild).toEqual([GONE_KEY]);
    });
});
