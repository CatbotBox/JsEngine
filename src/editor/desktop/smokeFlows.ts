import {SmokeUi} from "./smokeUi";
import type {SmokeClock, SmokePage} from "./smokeUi";

export interface SmokeHost {
    createTempFolder(): Promise<string>;

    answerFolderPick(path: string): void;

    fileExists(path: string): Promise<boolean>;

    writeFile(path: string, text: string): Promise<void>;
}

export interface SmokeFlowContext {
    readonly ui: SmokeUi;
    readonly host: SmokeHost;

    note(text: string): void;
}

export interface SmokeFlow {
    readonly name: string;
    readonly requires?: readonly string[];
    readonly budgetMs?: number;

    run(context: SmokeFlowContext): Promise<void>;
}

export interface SmokeFlowResult {
    readonly name: string;
    readonly passed: boolean;
    readonly durationMs: number;
    readonly reason?: string;
    readonly notes?: readonly string[];
}

export interface SmokeFlowRunOptions {
    readonly page: SmokePage;
    readonly clock: SmokeClock;
    readonly host: SmokeHost;
    readonly defaultBudgetMs: number;
    readonly waitTimeoutMs: number;
    readonly pollMs: number;

    pageErrors(): readonly string[];

    recover(ui: SmokeUi): Promise<void>;
}

const NO_DURATION = 0;

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function selectFlows(flows: readonly SmokeFlow[], names: readonly string[] | undefined): SmokeFlow[] {
    if (names === undefined) return [...flows];
    const unknown = names.filter(name => !flows.some(flow => flow.name === name));
    if (unknown.length > 0) throw new Error(`unknown smoke flows: ${unknown.join(", ")}; known: ${flows.map(flow => flow.name).join(", ")}`);
    return flows.filter(flow => names.includes(flow.name));
}

export function smokeFlowsPassed(results: readonly SmokeFlowResult[]): boolean {
    return results.every(result => result.passed);
}

export async function runSmokeFlows(flows: readonly SmokeFlow[], options: SmokeFlowRunOptions): Promise<SmokeFlowResult[]> {
    const results: SmokeFlowResult[] = [];
    for (const flow of flows) {
        const missing = (flow.requires ?? []).find(name => results.find(result => result.name === name)?.passed !== true);
        if (missing !== undefined) {
            results.push({name: flow.name, passed: false, durationMs: NO_DURATION, reason: `not run: it needs ${missing} to pass first`});
            continue;
        }
        const started = options.clock.now();
        const ui = new SmokeUi(options.page, options.clock, {
            deadlineMs: started + (flow.budgetMs ?? options.defaultBudgetMs),
            waitTimeoutMs: options.waitTimeoutMs,
            pollMs: options.pollMs,
        });
        const errorsBefore = options.pageErrors().length;
        const notes: string[] = [];
        let reason: string | undefined;
        try {
            await flow.run({ui, host: options.host, note: text => notes.push(text)});
        } catch (error) {
            reason = reasonOf(error);
        }
        const newErrors = options.pageErrors().slice(errorsBefore);
        if (newErrors.length > 0) {
            const logged = `the page logged errors: ${newErrors.join(" | ")}`;
            reason = reason === undefined ? logged : `${reason}; ${logged}`;
        }
        const durationMs = options.clock.now() - started;
        const noted = notes.length === 0 ? {} : {notes};
        results.push(reason === undefined ? {name: flow.name, passed: true, durationMs, ...noted} : {name: flow.name, passed: false, durationMs, reason, ...noted});
        if (reason !== undefined) {
            const recovery = new SmokeUi(options.page, options.clock, {deadlineMs: options.clock.now() + options.defaultBudgetMs, waitTimeoutMs: options.waitTimeoutMs, pollMs: options.pollMs});
            await options.recover(recovery).catch(() => undefined);
        }
    }
    return results;
}
