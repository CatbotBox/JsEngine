import {describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_TARGETS} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import type {EditorConsoleLevel} from "../editorProtocol";
import type {PackageResult, TargetFeatureReport, TargetReportResult} from "../project/projectServerApi";
import {BuildWindowModel, buildTargetsOf, missingFeaturesText, packageConsoleLines, targetReportConsoleLines, targetReportView} from "./buildWindowModel";

const SCENE = "scenes/main.scene.json";
const MANIFEST_WITH_TARGETS = JSON.stringify({name: "Game", startScene: SCENE, targets: {window: {backend: "gpu"}, terminal: {}}});
const MANIFEST_WITHOUT_TARGETS = JSON.stringify({name: "Game", startScene: SCENE});
const FAILING_TERMINAL: TargetFeatureReport = {
    ok: false,
    target: "terminal",
    bundles: [
        {bundle: "game terminal", target: "terminal", modules: 40, problems: [
            {symbol: "document", file: "src/hud.ts", line: 4, column: 9, missing: {anyOf: [], allOf: ["dom"]}, chain: ["src/main.ts", "src/ui.ts", "src/hud.ts"]},
            {symbol: "AudioContext", file: "src/sound.ts", line: 2, column: 1, missing: {anyOf: ["audio", "dom"], allOf: ["workers"]}, chain: ["src/sound.ts"]},
        ]},
    ],
    errors: [],
};

interface LoggedLine {
    readonly level: EditorConsoleLevel;
    readonly text: string;
}

function passing(target: ProjectTarget): TargetFeatureReport {
    return {ok: true, target, bundles: [{bundle: `${target}.js`, target, modules: 5, problems: []}, {bundle: `editor.js`, target, modules: 7, problems: []}], errors: []};
}

function harness(manifest: string, reportOf: (target: ProjectTarget) => Promise<TargetReportResult> = async target => ({report: passing(target), output: []})) {
    const logged: LoggedLine[] = [];
    const requested: string[] = [];
    let releasePackage: ((result: PackageResult) => void) | undefined;
    const model = new BuildWindowModel({
        readManifest: async () => manifest,
        targetReport: target => {
            requested.push(`build ${target}`);
            return reportOf(target);
        },
        packageProject: () => {
            requested.push("package");
            return new Promise(resolvePackage => releasePackage = resolvePackage);
        },
        log: (level, text) => logged.push({level, text}),
    });
    return {model, logged, requested, finishPackage: (result: PackageResult) => releasePackage?.(result)};
}

describe("build window targets", () => {
    test("the manifest's declared targets are listed in target order, every target when it declares none", () => {
        expect(buildTargetsOf(MANIFEST_WITH_TARGETS)).toEqual({targets: ["window", "terminal"]});
        expect(buildTargetsOf(MANIFEST_WITHOUT_TARGETS)).toEqual({targets: PROJECT_TARGETS});
    });

    test("a broken or unreadable manifest lists every target and says why", () => {
        const broken = buildTargetsOf("{not json");
        expect(broken.targets).toEqual(PROJECT_TARGETS);
        expect(broken.problem?.includes("has problems")).toBe(true);
        expect(buildTargetsOf(undefined).problem?.includes("Could not read")).toBe(true);
    });
});

describe("target report view", () => {
    test("a failing report lists each problem's feature, symbol, location and import chain", () => {
        const view = targetReportView(FAILING_TERMINAL);
        expect(view.ok).toBe(false);
        expect(view.summary).toBe("2 use(s) of features the terminal lacks");
        expect(view.problems).toEqual([
            {bundle: "game terminal", feature: "dom", symbol: "document", location: "src/hud.ts:4:9", chain: ["src/main.ts", "src/ui.ts", "src/hud.ts"]},
            {bundle: "game terminal", feature: "workers and one of audio, dom", symbol: "AudioContext", location: "src/sound.ts:2:1", chain: ["src/sound.ts"]},
        ]);
    });

    test("a passing report sums its bundles and an erroring one says the build failed", () => {
        expect(targetReportView(passing("web")).summary).toBe("features OK: 2 bundle(s), 12 modules");
        const failed = targetReportView({ok: false, target: "window", bundles: [], errors: ["bundling failed"]});
        expect(failed.summary).toBe("the window build failed");
        expect(failed.errors).toEqual(["bundling failed"]);
    });

    test("missing features read as all of them and one of the alternatives", () => {
        expect(missingFeaturesText({anyOf: ["gpu"], allOf: []})).toBe("gpu");
        expect(missingFeaturesText({anyOf: [], allOf: ["dom", "node"]})).toBe("dom and node");
    });

    test("console lines carry the CLI output, a summary and one error per problem", () => {
        expect(targetReportConsoleLines({report: FAILING_TERMINAL, output: ["regenerate generated/"]})).toEqual([
            {level: "log", text: "regenerate generated/"},
            {level: "error", text: "jsengine build --target terminal: 2 use(s) of features the terminal lacks"},
            {level: "error", text: "terminal lacks dom: src/hud.ts:4:9 uses document, via src/main.ts -> src/ui.ts"},
            {level: "error", text: "terminal lacks workers and one of audio, dom: src/sound.ts:2:1 uses AudioContext"},
        ]);
        expect(packageConsoleLines({ok: false, output: ["jsengine: demo/x has no web page"]})).toEqual([
            {level: "log", text: "jsengine: demo/x has no web page"},
            {level: "error", text: "jsengine package --target window failed"},
        ]);
    });
});

describe("build window model", () => {
    test("build records the report and logs what the build said", async () => {
        const {model, logged} = harness(MANIFEST_WITH_TARGETS, async target => ({report: target === "terminal" ? FAILING_TERMINAL : passing(target), output: []}));
        await model.load();
        await model.build("terminal");
        expect(model.reportOf("terminal")?.ok).toBe(false);
        expect(model.reportOf("window")).toBe(undefined);
        expect(logged[0]).toEqual({level: "info", text: "jsengine build --target terminal…"});
        expect(logged.filter(line => line.level === "error").length).toBe(3);
        expect(model.busy).toBe(false);
    });

    test("build all runs each listed target in turn", async () => {
        const {model, requested} = harness(MANIFEST_WITH_TARGETS);
        await model.load();
        await model.buildAll();
        expect(requested).toEqual(["build window", "build terminal"]);
        expect(model.reportOf("window")?.ok).toBe(true);
        expect(model.reportOf("terminal")?.ok).toBe(true);
    });

    test("nothing else starts while a run is going", async () => {
        const {model, requested, finishPackage} = harness(MANIFEST_WITH_TARGETS);
        await model.load();
        const packaging = model.packageWindow();
        expect(model.busy).toBe(true);
        expect(model.running).toEqual({target: "window", action: "package"});
        await model.build("terminal");
        await model.buildAll();
        await model.packageWindow();
        finishPackage({ok: true, output: ["wrote release/game.zip"]});
        await packaging;
        expect(requested).toEqual(["package"]);
        expect(model.packaged).toBe(true);
        expect(model.busy).toBe(false);
        expect(model.running).toBe(undefined);
    });

    test("a request that throws becomes a failed report", async () => {
        const {model, logged} = harness(MANIFEST_WITHOUT_TARGETS, async () => {
            throw new Error("the project server is gone");
        });
        await model.load();
        await model.build("web");
        expect(model.reportOf("web")?.errors).toEqual(["the project server is gone"]);
        expect(logged.some(line => line.level === "error" && line.text === "the project server is gone")).toBe(true);
    });
});
