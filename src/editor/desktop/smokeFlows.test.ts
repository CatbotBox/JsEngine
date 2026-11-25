import {describe, expect, test} from "../../engine/testing/harness";
import {runSmokeFlows, selectFlows, smokeFlowsPassed} from "./smokeFlows";
import type {SmokeFlow, SmokeFlowResult, SmokeFlowRunOptions, SmokeHost} from "./smokeFlows";
import type {SmokeInputEvent} from "./smokeInput";
import type {SmokeClock, SmokePage, SmokeUi} from "./smokeUi";

const STEP_MS = 5;
const BUDGET_MS = 1000;

class TickingClock implements SmokeClock {
    private nowMs = 0;

    public now(): number {
        this.nowMs += STEP_MS;
        return this.nowMs;
    }

    public async sleep(ms: number): Promise<void> {
        this.nowMs += ms;
    }
}

const QUIET_PAGE: SmokePage = {
    evaluate: async <T>() => true as T,
    sendInput: (_event: SmokeInputEvent) => undefined,
    insertText: async () => undefined,
    zoomFactor: () => 1,
};

const NO_HOST: SmokeHost = {
    createTempFolder: async () => "",
    answerFolderPick: () => undefined,
    fileExists: async () => false,
    writeFile: async () => undefined,
    floatingWindows: () => [],
    reloadPage: async () => undefined,
};

function flow(name: string, run: SmokeFlow["run"], requires?: readonly string[]): SmokeFlow {
    return requires === undefined ? {name, run} : {name, run, requires};
}

function options(pageErrors: string[], recovered: string[] = []): SmokeFlowRunOptions {
    return {
        page: QUIET_PAGE,
        clock: new TickingClock(),
        host: NO_HOST,
        defaultBudgetMs: BUDGET_MS,
        waitTimeoutMs: BUDGET_MS,
        pollMs: STEP_MS,
        pageErrors: () => pageErrors,
        recover: async (_ui: SmokeUi) => {
            recovered.push("recovered");
        },
    };
}

function outcomes(results: readonly SmokeFlowResult[]): [string, boolean, string | undefined][] {
    return results.map(result => [result.name, result.passed, result.reason]);
}

describe("runSmokeFlows", () => {
    test("each flow passes or fails with its reason, in order, and later flows still run", async () => {
        const ran: string[] = [];
        const results = await runSmokeFlows([
            flow("menus", async () => void ran.push("menus")),
            flow("palette", async ({ui}) => {
                ran.push("palette");
                ui.fail("the palette never opened");
            }),
            flow("tabs", async () => void ran.push("tabs")),
        ], options([]));
        expect(ran).toEqual(["menus", "palette", "tabs"]);
        expect(outcomes(results)).toEqual([["menus", true, undefined], ["palette", false, "the palette never opened"], ["tabs", true, undefined]]);
        expect(results.every(result => result.durationMs > 0)).toBe(true);
        expect(smokeFlowsPassed(results)).toBe(false);
    });

    test("errors the page logs during a flow fail it, and join a failure's reason", async () => {
        const pageErrors = ["logged before the flows"];
        const results = await runSmokeFlows([
            flow("clean", async () => undefined),
            flow("noisy", async () => void pageErrors.push("Uncaught TypeError: x is undefined")),
            flow("broken", async ({ui}) => {
                pageErrors.push("Uncaught (in promise) Error: boom");
                ui.fail("the dialog never opened");
            }),
        ], options(pageErrors));
        expect(outcomes(results)).toEqual([
            ["clean", true, undefined],
            ["noisy", false, "the page logged errors: Uncaught TypeError: x is undefined"],
            ["broken", false, "the dialog never opened; the page logged errors: Uncaught (in promise) Error: boom"],
        ]);
    });

    test("a flow whose prerequisite did not pass is reported as not run", async () => {
        const ran: string[] = [];
        const results = await runSmokeFlows([
            flow("newProject", async () => {
                throw new Error("the project did not open");
            }),
            flow("createMenu", async () => void ran.push("createMenu"), ["newProject"]),
            flow("openProject", async () => void ran.push("openProject"), ["createMenu"]),
        ], options([]));
        expect(ran).toEqual([]);
        expect(outcomes(results).slice(1)).toEqual([
            ["createMenu", false, "not run: it needs newProject to pass first"],
            ["openProject", false, "not run: it needs createMenu to pass first"],
        ]);
    });

    test("the page is recovered after each failed flow only", async () => {
        const recovered: string[] = [];
        await runSmokeFlows([
            flow("good", async () => undefined),
            flow("bad", async ({ui}) => ui.fail("no")),
        ], options([], recovered));
        expect(recovered).toEqual(["recovered"]);
    });

    test("notes a flow records are reported with its result", async () => {
        const results = await runSmokeFlows([flow("templates", async ({note}) => note("not offered by this game: Mesh"))], options([]));
        expect(results[0].notes).toEqual(["not offered by this game: Mesh"]);
    });

    test("a flow's budget bounds its waits", async () => {
        const results = await runSmokeFlows([{
            name: "slow",
            budgetMs: STEP_MS * 4,
            run: async ({ui}) => ui.waitFor("something that never happens", async () => false),
        }], options([]));
        expect(outcomes(results)).toEqual([["slow", false, "the flow ran out of its time budget waiting for something that never happens"]]);
    });
});

describe("selectFlows", () => {
    const flows = [flow("menus", async () => undefined), flow("palette", async () => undefined), flow("tabs", async () => undefined)];

    test("no names keeps every flow; names keep those flows in their run order", () => {
        expect(selectFlows(flows, undefined).map(each => each.name)).toEqual(["menus", "palette", "tabs"]);
        expect(selectFlows(flows, ["tabs", "menus"]).map(each => each.name)).toEqual(["menus", "tabs"]);
        expect(selectFlows(flows, [])).toEqual([]);
    });

    test("an unknown name is refused with the known ones", () => {
        expect(() => selectFlows(flows, ["menu"])).toThrow("unknown smoke flows: menu; known: menus, palette, tabs");
    });
});
