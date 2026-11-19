import * as os from "node:os";
import {Component, EntityQuery, System, World} from "../src/engine/core";
import type {ComponentCtor} from "../src/engine/core";
import type {SystemCtor} from "../src/engine/core/system";
import {formatMs, median} from "./_harness";
import {nodePlatform} from "../src/hosts/terminal";

interface CountingSystem extends System {
    readonly updateCount: number;
}

const SYSTEM_COUNTS = [0, 100, 500];
const ALWAYS_RUN_TICKS_BY_SYSTEM_COUNT = new Map<number, number>([[0, 200_000], [100, 20_000], [500, 4_000]]);
const IDLE_TICKS_BY_SYSTEM_COUNT = new Map<number, number>([[0, 200_000], [100, 200_000], [500, 200_000]]);
const QUERY_COUNTS = [0, 100, 500];
const ARCHETYPE_COUNT = 1000;
const ARCHETYPE_RUNS_BY_QUERY_COUNT = new Map<number, number>([[0, 80], [100, 4], [500, 1]]);
const LEAKED_LISTENER_RUNS = ARCHETYPE_RUNS_BY_QUERY_COUNT.get(0)!;
const LEAKED_SYSTEM_COUNT = 1000;
const TICK_DELTA_MS = 1000 / 60;
const INTERLEAVE_DEADLINE_OFFSET_MS = 24 * 60 * 60 * 1000;
const MIN_SAMPLE_MS = 20;
const DEFAULT_ROUNDS = 7;
const US_PER_MS = 1000;
const BLOCKING_GC = true;
const WITH_BOUNDARY_LISTENER = true;
const WITHOUT_BOUNDARY_LISTENER = false;
const NOT_UPDATED = 0;

interface Fixture {
    world: World;
    systems: CountingSystem[];
    boundaryCallCount: number;
    nextInterleaveAtMs: number;
    archetypeCountBeforeRun: number;
    systemCountBeforeRun: number;
}

interface Scenario {
    name: string;
    ops: number;
    opUnit: string;
    runsPerSample?: number;
    setup: (fixture: Fixture) => void;
    run: (fixture: Fixture) => void;
    verify: (fixture: Fixture) => void;
}

function componentClasses(count: number): ComponentCtor<Component>[] {
    return Array.from({length: count}, () => class extends Component {
    });
}

function pairComponentCountFor(pairCount: number): number {
    let count = 2;
    while (count * (count - 1) / 2 < pairCount) count++;
    return count;
}

function componentPairs(components: ComponentCtor<Component>[], pairCount: number): ComponentCtor<Component>[][] {
    const pairs: ComponentCtor<Component>[][] = [];
    for (let a = 0; a < components.length && pairs.length < pairCount; a++) {
        for (let b = a + 1; b < components.length && pairs.length < pairCount; b++) pairs.push([components[a], components[b]]);
    }
    return pairs;
}

function idleSystemClass(required: ComponentCtor<Component>): SystemCtor<CountingSystem> {
    return class extends System {
        public updateCount = NOT_UPDATED;

        protected override onCreate(): void {
            this.requireAnyForUpdate([required]);
        }

        public onUpdate(): void {
            this.updateCount++;
        }
    };
}

function alwaysRunSystemClass(): SystemCtor<CountingSystem> {
    return class extends System {
        public updateCount = NOT_UPDATED;

        public onUpdate(): void {
            this.updateCount++;
        }
    };
}

function queryOwnerSystemClass(queried: ComponentCtor<Component>): SystemCtor<System> {
    return class extends System {
        protected override onCreate(): void {
            this.createEntityQuery([queried]).hasEntity();
        }

        public onUpdate(): void {
        }
    };
}

const MAX_SYSTEM_COUNT = Math.max(...SYSTEM_COUNTS);
const MAX_QUERY_COUNT = Math.max(...QUERY_COUNTS);
const OWN_COMPONENTS = componentClasses(Math.max(MAX_SYSTEM_COUNT, MAX_QUERY_COUNT, LEAKED_SYSTEM_COUNT));
const ARCHETYPE_TYPE_SETS = componentPairs(componentClasses(pairComponentCountFor(ARCHETYPE_COUNT)), ARCHETYPE_COUNT);
const IDLE_SYSTEMS = OWN_COMPONENTS.slice(0, MAX_SYSTEM_COUNT).map(idleSystemClass);
const ALWAYS_RUN_SYSTEMS = Array.from({length: MAX_SYSTEM_COUNT}, alwaysRunSystemClass);
const QUERY_OWNER_SYSTEMS = OWN_COMPONENTS.slice(0, LEAKED_SYSTEM_COUNT).map(queryOwnerSystemClass);

function newFixture(): Fixture {
    return {
        world: new World({platform: nodePlatform()}),
        systems: [],
        boundaryCallCount: 0,
        nextInterleaveAtMs: performance.now() + INTERLEAVE_DEADLINE_OFFSET_MS,
        archetypeCountBeforeRun: 0,
        systemCountBeforeRun: 0,
    };
}

function installBoundaryListener(fixture: Fixture) {
    fixture.world.presentationBarriers.listenAtSystemBoundaries(() => {
        fixture.boundaryCallCount++;
        if (performance.now() < fixture.nextInterleaveAtMs) return;
        throw new Error("boundary listener: interleave deadline reached during bench");
    });
}

function rootSystemCount(fixture: Fixture): number {
    return fixture.world.rootSystemGroup!.systems.length;
}

function runningRootSystemCount(fixture: Fixture): number {
    return fixture.world.rootSystemGroup!.systems.filter(system => system.enabled && system.requirementsMet).length;
}

function expectRootSystemCount(fixture: Fixture, expected: number, label: string) {
    const actual = rootSystemCount(fixture);
    if (actual !== expected) throw new Error(`${label}: expected ${expected} systems in root group, found ${actual}`);
}

function expectUpdateCounts(fixture: Fixture, expected: number, label: string) {
    for (const system of fixture.systems) {
        if (system.updateCount !== expected) throw new Error(`${label}: expected onUpdate to run ${expected} times, ran ${system.updateCount}`);
    }
}

function expectBoundaryCalls(fixture: Fixture, expected: number, label: string) {
    if (fixture.boundaryCallCount !== expected) throw new Error(`${label}: expected ${expected} boundary listener calls, found ${fixture.boundaryCallCount}`);
}

function expectArchetypesCreated(fixture: Fixture, label: string) {
    const created = fixture.world.archetypes.loadedArchetypes - fixture.archetypeCountBeforeRun;
    if (created !== ARCHETYPE_COUNT) throw new Error(`${label}: expected ${ARCHETYPE_COUNT} new archetypes, found ${created}`);
}

function stepTicks(fixture: Fixture, ticks: number) {
    const world = fixture.world;
    for (let t = 0; t < ticks; t++) world.step(TICK_DELTA_MS);
}

function createArchetypes(fixture: Fixture) {
    const archetypes = fixture.world.archetypes;
    for (let i = 0; i < ARCHETYPE_TYPE_SETS.length; i++) archetypes.getOrCreate(ARCHETYPE_TYPE_SETS[i]);
}

function tickScenario(kind: string, systemClasses: SystemCtor<CountingSystem>[], ticksBySystemCount: Map<number, number>, systemCount: number, withBoundaryListener: boolean, updatesPerTick: number): Scenario {
    const ticks = ticksBySystemCount.get(systemCount)!;
    const listenerLabel = withBoundaryListener ? "boundary listener" : "no listener";
    const label = `${kind} x${systemCount}, ${listenerLabel}`;
    return {
        name: `${label}, ${ticks} ticks`,
        ops: ticks,
        opUnit: "tick",
        setup: fixture => {
            for (let i = 0; i < systemCount; i++) fixture.systems.push(fixture.world.createSystem(systemClasses[i]));
            if (withBoundaryListener) installBoundaryListener(fixture);
            fixture.systemCountBeforeRun = rootSystemCount(fixture);
        },
        run: fixture => stepTicks(fixture, ticks),
        verify: fixture => {
            expectRootSystemCount(fixture, fixture.systemCountBeforeRun, label);
            if (fixture.systemCountBeforeRun < systemCount) throw new Error(`${label}: systems missing from root group`);
            expectUpdateCounts(fixture, ticks * updatesPerTick, label);
            const boundariesPerTick = runningRootSystemCount(fixture) - 1;
            expectBoundaryCalls(fixture, withBoundaryListener ? ticks * boundariesPerTick : 0, label);
        },
    };
}

function liveQueryScenario(queryCount: number): Scenario {
    const label = `${ARCHETYPE_COUNT} archetypes, ${queryCount} live queries`;
    return {
        name: label,
        ops: ARCHETYPE_COUNT,
        opUnit: "archetype",
        runsPerSample: ARCHETYPE_RUNS_BY_QUERY_COUNT.get(queryCount)!,
        setup: fixture => {
            const world = fixture.world;
            for (let i = 0; i < queryCount; i++) new EntityQuery(world, [OWN_COMPONENTS[i]]).hasEntity();
            fixture.archetypeCountBeforeRun = world.archetypes.loadedArchetypes;
        },
        run: createArchetypes,
        verify: fixture => expectArchetypesCreated(fixture, label),
    };
}

function leakedListenerScenario(): Scenario {
    const label = `${ARCHETYPE_COUNT} archetypes, ${LEAKED_SYSTEM_COUNT} destroyed query systems`;
    return {
        name: label,
        ops: ARCHETYPE_COUNT,
        opUnit: "archetype",
        runsPerSample: LEAKED_LISTENER_RUNS,
        setup: fixture => {
            const world = fixture.world;
            const systemCountBefore = world.systemCount;
            for (const systemClass of QUERY_OWNER_SYSTEMS) world.createSystem(systemClass);
            if (world.systemCount !== systemCountBefore + LEAKED_SYSTEM_COUNT) throw new Error(`${label}: query systems not created`);
            for (const systemClass of QUERY_OWNER_SYSTEMS) world.removeSystem(systemClass);
            if (world.systemCount !== systemCountBefore) throw new Error(`${label}: query systems not removed`);
            fixture.archetypeCountBeforeRun = world.archetypes.loadedArchetypes;
        },
        run: createArchetypes,
        verify: fixture => expectArchetypesCreated(fixture, label),
    };
}

const IDLE_UPDATES_PER_TICK = 0;
const ALWAYS_RUN_UPDATES_PER_TICK = 1;

const scenarios: Scenario[] = [
    ...SYSTEM_COUNTS.flatMap(count => [WITHOUT_BOUNDARY_LISTENER, WITH_BOUNDARY_LISTENER].map(listener =>
        tickScenario("idle", IDLE_SYSTEMS, IDLE_TICKS_BY_SYSTEM_COUNT, count, listener, IDLE_UPDATES_PER_TICK))),
    ...SYSTEM_COUNTS.flatMap(count => [WITHOUT_BOUNDARY_LISTENER, WITH_BOUNDARY_LISTENER].map(listener =>
        tickScenario("always-run", ALWAYS_RUN_SYSTEMS, ALWAYS_RUN_TICKS_BY_SYSTEM_COUNT, count, listener, ALWAYS_RUN_UPDATES_PER_TICK))),
    ...QUERY_COUNTS.map(liveQueryScenario),
    leakedListenerScenario(),
];

type GcMode = { label: string, collect: () => void };

function detectGc(): GcMode {
    const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
    if (bun) return {label: "forced before each sample (Bun.gc)", collect: () => bun.gc(BLOCKING_GC)};
    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc) return {label: "forced before each sample (global.gc)", collect: gc};
    return {label: "not forced (run node with --expose-gc)", collect: () => {}};
}

function runtimeLabel(): string {
    const bunVersion = (process.versions as Record<string, string | undefined>).bun;
    return bunVersion ? `bun ${bunVersion}` : `node ${process.version}`;
}

function parseRounds(): number {
    const i = process.argv.indexOf("--rounds");
    if (i < 0) return DEFAULT_ROUNDS;
    const n = Number(process.argv[i + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error("--rounds expects a positive integer");
    return n;
}

function runOnce(scenario: Scenario, gc: GcMode): number {
    const fixture = newFixture();
    scenario.setup(fixture);
    gc.collect();
    const t0 = performance.now();
    scenario.run(fixture);
    const ms = performance.now() - t0;
    scenario.verify(fixture);
    return ms;
}

function sample(scenario: Scenario, gc: GcMode): number {
    const repeat = scenario.runsPerSample ?? 1;
    let total = 0;
    for (let r = 0; r < repeat; r++) total += runOnce(scenario, gc);
    return total / repeat;
}

function main() {
    const rounds = parseRounds();
    const gc = detectGc();
    const cpu = os.cpus()[0]?.model.trim() ?? "unknown cpu";

    console.log(`idle systems bench | ${runtimeLabel()} | ${os.platform()} ${os.arch()} | ${cpu}`);
    console.log(`rounds: ${rounds} (+1 warm-up), interleaved | gc: ${gc.label}`);
    console.log("");

    for (const scenario of scenarios) sample(scenario, gc);

    const samples: number[][] = scenarios.map(() => []);
    for (let r = 0; r < rounds; r++) {
        for (let s = 0; s < scenarios.length; s++) samples[s].push(sample(scenarios[s], gc));
    }

    const nameWidth = Math.max(...scenarios.map(s => s.name.length)) + 2;
    console.log("scenario".padEnd(nameWidth) + " median ms     min     max   per op");
    for (let s = 0; s < scenarios.length; s++) {
        const scenario = scenarios[s];
        const xs = samples[s];
        const mid = median(xs);
        const perOpUs = (mid * US_PER_MS / scenario.ops).toFixed(3);
        const repeat = scenario.runsPerSample ?? 1;
        const note = mid * repeat < MIN_SAMPLE_MS ? `  (sample under ${MIN_SAMPLE_MS} ms)`
            : repeat > 1 ? `  (mean of ${repeat} runs per sample)` : "";
        console.log(`${scenario.name.padEnd(nameWidth)}   ${formatMs(mid)} ${formatMs(Math.min(...xs))} ${formatMs(Math.max(...xs))}   ${perOpUs} us/${scenario.opUnit}${note}`);
    }
}

main();
