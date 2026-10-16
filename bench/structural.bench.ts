/**
 * Structural ECS operations: spawning (one by one, batch, through a command buffer),
 * tag toggles (archetype moves), command-buffer moves of existing entities
 * (multi-type moves), enable/disable (boundary swaps, the control), despawn, and
 * Parent hierarchies (setup() cascades).
 *
 * Increment 1.0 of docs/roadmap-plan.md: the baseline Phase 1 is judged against.
 * Phase 2 added the command-buffer move scenario (the 1.0 baseline lacks it).
 * Every sample builds a fresh World, never starts its loop, and calls the
 * EntityManager directly. Scenarios are interleaved round-robin and reported as
 * medians; one untimed warm-up round runs first.
 *
 * Run: bun bench/structural.bench.ts [--rounds N]
 *      npm run bench:structural            (node, --expose-gc)
 */
import * as os from "node:os";
import {Component, Entity, EntityCommandBufferSystem, EntityManager, World} from "../src/js_engine/core";
import type {ComponentCtor} from "../src/js_engine/core";
import {
    Children,
    LocalPosition,
    LocalRotation,
    LocalScale,
    LocalToWorld,
    Parent,
    ParentTransform
} from "../src/js_engine/translation";
import {fmt, median} from "./_harness";

class Velocity extends Component {
    constructor(public dx: number = 0, public dy: number = 0) {
        super();
    }
}

class Marker extends Component {
}

const SPAWN_COUNT = 100_000;
const TOGGLE_COUNT = 10_000;
const TOGGLE_FRAMES = 300;
const ECB_MOVE_FRAMES = 60;
const HIERARCHY_COUNT = 10_000;
const HIERARCHY_DEPTH = 4;
const MIN_SAMPLE_MS = 50;

const SPAWN_TYPES: ComponentCtor<Component>[] = [LocalPosition, LocalRotation, LocalScale, LocalToWorld, Velocity, Marker];
const TOGGLE_BASE_TYPES: ComponentCtor<Component>[] = [LocalPosition, LocalRotation, LocalScale, LocalToWorld, Velocity];
const ECB_MOVE_BASE_TYPES: ComponentCtor<Component>[] = [LocalPosition, LocalRotation, LocalScale, LocalToWorld];

function spawnComponents(i: number): Component[] {
    return [
        new LocalPosition(i, i * 0.5, 0),
        new LocalRotation(),
        new LocalScale(),
        new LocalToWorld(),
        new Velocity(1, -1),
        new Marker(),
    ];
}

function toggleBaseComponents(i: number): Component[] {
    return spawnComponents(i).slice(0, TOGGLE_BASE_TYPES.length);
}

function ecbMoveBaseComponents(i: number): Component[] {
    return spawnComponents(i).slice(0, ECB_MOVE_BASE_TYPES.length);
}

interface Fixture {
    world: World;
    em: EntityManager;
    entities: Entity[];
}

interface Scenario {
    name: string;
    ops: number;
    opUnit: string;
    /** Runs per sample, each on a fresh fixture; the reported time is per run. For scenarios under MIN_SAMPLE_MS. */
    repeat?: number;
    unavailable?: (fixture: Fixture) => string | undefined;
    setup?: (fixture: Fixture) => void;
    run: (fixture: Fixture) => void;
    verify: (fixture: Fixture) => void;
}

function newFixture(): Fixture {
    const world = new World();
    return {world, em: world.entityManager, entities: []};
}

function teardown(fixture: Fixture) {
    const {em, entities} = fixture;
    for (let i = 0; i < entities.length; i++) em.destroyEntity(entities[i]);
    entities.length = 0;
}

function expectCount(fixture: Fixture, types: ComponentCtor<Component>[], expected: number, label: string) {
    const actual = fixture.world.archetypes.getOrCreate(types).entityCountUnfiltered;
    if (actual !== expected) throw new Error(`${label}: expected ${expected} entities in archetype, found ${actual}`);
}

function expectWorldCount(fixture: Fixture, expected: number, label: string) {
    const actual = fixture.world.entityCount;
    if (actual !== expected) throw new Error(`${label}: expected ${expected} enabled entities in world, found ${actual}`);
}

function spawnOneByOne(fixture: Fixture, count: number, components: (i: number) => Component[]) {
    const {em, entities} = fixture;
    for (let i = 0; i < count; i++) {
        const e = em.createEntity();
        const comps = components(i);
        for (let c = 0; c < comps.length; c++) em.addComponent(e, comps[c]);
        entities.push(e);
    }
}

type BatchEntityManager = EntityManager & {
    createEntity(name: string | undefined, components: Component[]): Entity;
    addComponents(entity: Entity, components: Component[]): void;
};

function hasBatchApi(em: EntityManager): em is BatchEntityManager {
    return typeof (em as Partial<BatchEntityManager>).addComponents === "function";
}

function recordEcbSpawn(fixture: Fixture) {
    const ecb = fixture.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    for (let i = 0; i < SPAWN_COUNT; i++) {
        const e = ecb.createEntity();
        const comps = spawnComponents(i);
        for (let c = 0; c < comps.length; c++) ecb.addComponent(e, comps[c]);
        fixture.entities.push(e);
    }
    return ecb;
}

function verifySpawn(label: string) {
    return (fixture: Fixture) => {
        expectCount(fixture, SPAWN_TYPES, SPAWN_COUNT, label);
        expectWorldCount(fixture, SPAWN_COUNT, label);
    };
}

const scenarios: Scenario[] = [
    {
        name: "spawn 100k x6, one by one",
        ops: SPAWN_COUNT,
        opUnit: "entity",
        run: fixture => spawnOneByOne(fixture, SPAWN_COUNT, spawnComponents),
        verify: verifySpawn("spawn one by one"),
    },
    {
        name: "spawn 100k x6, batch",
        ops: SPAWN_COUNT,
        opUnit: "entity",
        unavailable: fixture => hasBatchApi(fixture.em) ? undefined : "n/a (batch API not present)",
        run: fixture => {
            const em = fixture.em as BatchEntityManager;
            const entities = fixture.entities;
            for (let i = 0; i < SPAWN_COUNT; i++) entities.push(em.createEntity(undefined, spawnComponents(i)));
        },
        verify: verifySpawn("spawn batch"),
    },
    {
        name: "spawn 100k x6, ECB record+playback",
        ops: SPAWN_COUNT,
        opUnit: "entity",
        run: fixture => recordEcbSpawn(fixture).playback(fixture.em),
        verify: verifySpawn("ECB record+playback"),
    },
    {
        name: "spawn 100k x6, ECB playback only",
        ops: SPAWN_COUNT,
        opUnit: "entity",
        setup: fixture => {
            recordEcbSpawn(fixture);
        },
        run: fixture => fixture.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(fixture.em),
        verify: verifySpawn("ECB playback"),
    },
    {
        name: "toggle tag 10k x 300 frames",
        ops: TOGGLE_COUNT * TOGGLE_FRAMES,
        opUnit: "move",
        setup: fixture => spawnOneByOne(fixture, TOGGLE_COUNT, toggleBaseComponents),
        run: fixture => {
            const {em, entities} = fixture;
            for (let f = 0; f < TOGGLE_FRAMES; f++) {
                if (f % 2 === 0) for (let i = 0; i < entities.length; i++) em.addComponent(entities[i], new Marker());
                else for (let i = 0; i < entities.length; i++) em.removeComponent(entities[i], Marker);
            }
        },
        verify: fixture => {
            expectCount(fixture, TOGGLE_BASE_TYPES, TOGGLE_COUNT, "toggle tag");
            expectCount(fixture, SPAWN_TYPES, 0, "toggle tag");
        },
    },
    {
        name: "ECB move 10k x 60 frames, +2/-2 types",
        ops: TOGGLE_COUNT * ECB_MOVE_FRAMES,
        opUnit: "move",
        setup: fixture => spawnOneByOne(fixture, TOGGLE_COUNT, ecbMoveBaseComponents),
        run: fixture => {
            const {world, em, entities} = fixture;
            const ecb = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
            for (let f = 0; f < ECB_MOVE_FRAMES; f++) {
                if (f % 2 === 0) {
                    for (let i = 0; i < entities.length; i++) {
                        ecb.addComponent(entities[i], new Velocity(1, -1));
                        ecb.addComponent(entities[i], new Marker());
                    }
                } else {
                    for (let i = 0; i < entities.length; i++) {
                        ecb.removeComponent(entities[i], Velocity);
                        ecb.removeComponent(entities[i], Marker);
                    }
                }
                ecb.playback(em);
            }
        },
        verify: fixture => {
            expectCount(fixture, ECB_MOVE_BASE_TYPES, TOGGLE_COUNT, "ECB move");
            expectCount(fixture, SPAWN_TYPES, 0, "ECB move");
        },
    },
    {
        name: "enable/disable 10k x 300 frames",
        ops: TOGGLE_COUNT * TOGGLE_FRAMES,
        opUnit: "toggle",
        setup: fixture => spawnOneByOne(fixture, TOGGLE_COUNT, spawnComponents),
        run: fixture => {
            const {em, entities} = fixture;
            for (let f = 0; f < TOGGLE_FRAMES; f++) {
                const enabled = f % 2 === 1;
                for (let i = 0; i < entities.length; i++) em.setEnabledState(entities[i], enabled);
            }
        },
        verify: fixture => {
            expectCount(fixture, SPAWN_TYPES, TOGGLE_COUNT, "enable/disable");
            expectWorldCount(fixture, TOGGLE_COUNT, "enable/disable");
        },
    },
    {
        name: "despawn 100k x6",
        ops: SPAWN_COUNT,
        opUnit: "entity",
        repeat: 3,
        setup: fixture => spawnOneByOne(fixture, SPAWN_COUNT, spawnComponents),
        run: fixture => {
            const {em, entities} = fixture;
            for (let i = 0; i < entities.length; i++) em.destroyEntity(entities[i]);
        },
        verify: fixture => {
            expectCount(fixture, SPAWN_TYPES, 0, "despawn");
            expectWorldCount(fixture, 0, "despawn");
        },
    },
    {
        name: "spawn 10k Parent hierarchies, depth 4",
        ops: HIERARCHY_COUNT * HIERARCHY_DEPTH,
        opUnit: "entity",
        repeat: 2,
        run: fixture => {
            const {em, entities} = fixture;
            for (let h = 0; h < HIERARCHY_COUNT; h++) {
                let parent = em.createEntity();
                em.addComponent(parent, new LocalPosition(h, 0, 0));
                entities.push(parent);
                for (let d = 1; d < HIERARCHY_DEPTH; d++) {
                    const child = em.createEntity();
                    em.addComponent(child, new LocalPosition(0, d, 0));
                    em.addComponent(child, new Parent(parent));
                    entities.push(child);
                    parent = child;
                }
            }
        },
        verify: fixture => {
            const label = "hierarchy";
            expectCount(fixture, [LocalPosition, Children], HIERARCHY_COUNT, label);
            expectCount(fixture, [LocalPosition, Parent, ParentTransform, Children], HIERARCHY_COUNT * (HIERARCHY_DEPTH - 2), label);
            expectCount(fixture, [LocalPosition, Parent, ParentTransform], HIERARCHY_COUNT, label);
            expectWorldCount(fixture, HIERARCHY_COUNT * HIERARCHY_DEPTH, label);
        },
    },
];

type GcMode = { label: string, collect: () => void };

function detectGc(): GcMode {
    const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
    if (bun) return {label: "forced before each sample (Bun.gc)", collect: () => bun.gc(true)};
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
    if (i < 0) return 7;
    const n = Number(process.argv[i + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error("--rounds expects a positive integer");
    return n;
}

function runOnce(scenario: Scenario, gc: GcMode): number | string {
    const fixture = newFixture();
    try {
        const reason = scenario.unavailable?.(fixture);
        if (reason !== undefined) return reason;
        scenario.setup?.(fixture);
        gc.collect();
        const t0 = performance.now();
        scenario.run(fixture);
        const ms = performance.now() - t0;
        scenario.verify(fixture);
        return ms;
    } finally {
        teardown(fixture);
    }
}

function sample(scenario: Scenario, gc: GcMode): number | string {
    const repeat = scenario.repeat ?? 1;
    let total = 0;
    for (let r = 0; r < repeat; r++) {
        const result = runOnce(scenario, gc);
        if (typeof result === "string") return result;
        total += result;
    }
    return total / repeat;
}

function main() {
    const rounds = parseRounds();
    const gc = detectGc();
    const cpu = os.cpus()[0]?.model.trim() ?? "unknown cpu";

    console.log(`structural bench | ${runtimeLabel()} | ${os.platform()} ${os.arch()} | ${cpu}`);
    console.log(`rounds: ${rounds} (+1 warm-up), interleaved | gc: ${gc.label}`);
    console.log("");

    for (const scenario of scenarios) sample(scenario, gc);

    const samples: number[][] = scenarios.map(() => []);
    const unavailable: (string | undefined)[] = scenarios.map(() => undefined);
    for (let r = 0; r < rounds; r++) {
        for (let s = 0; s < scenarios.length; s++) {
            const result = sample(scenarios[s], gc);
            if (typeof result === "string") unavailable[s] = result;
            else samples[s].push(result);
        }
    }

    const nameWidth = Math.max(...scenarios.map(s => s.name.length)) + 2;
    console.log("scenario".padEnd(nameWidth) + " median ms     min     max   per op");
    for (let s = 0; s < scenarios.length; s++) {
        const scenario = scenarios[s];
        const row = scenario.name.padEnd(nameWidth);
        if (unavailable[s] !== undefined) {
            console.log(row + unavailable[s]);
            continue;
        }
        const xs = samples[s];
        const mid = median(xs);
        const perOpUs = (mid * 1000 / scenario.ops).toFixed(3);
        const repeat = scenario.repeat ?? 1;
        const note = mid * repeat < MIN_SAMPLE_MS ? `  (sample under ${MIN_SAMPLE_MS} ms)`
            : repeat > 1 ? `  (mean of ${repeat} runs per sample)` : "";
        console.log(`${row}   ${fmt(mid)} ${fmt(Math.min(...xs))} ${fmt(Math.max(...xs))}   ${perOpUs} us/${scenario.opUnit}${note}`);
    }
}

main();
