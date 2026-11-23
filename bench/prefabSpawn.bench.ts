import * as os from "node:os";
import * as path from "node:path";
import {Component, EntityCommandBufferSystem, World} from "../src/engine/core";
import type {Entity, EntityCommandBuffer} from "../src/engine/core";
import {Lifetime, Velocity} from "../src/engine/motion";
import {RenderBounds} from "../src/engine/rendering";
import {Sprite, SpritePattern, SpritePatternColor} from "../src/engine/rendering/2d";
import {ComponentSchemaRegistry, platformSceneAssetLoader, prefabSpawnerOf, registerEngineComponentSchemas} from "../src/engine/scene";
import type {PrefabAsset, PrefabSpawner} from "../src/engine/scene";
import {LocalPosition, LocalToWorld} from "../src/engine/translation";
import {nodePlatform} from "../src/hosts/terminal";
import {formatMs, median} from "./_harness";

class Spark extends Component {
}

const SPARK_PREFAB_PATH = path.join(__dirname, "..", "demo", "swarm", "prefabs", "spark.prefab.json");
const SPARK_NAME = "spark";
const SPARK_DEPTH = 2;
const SPARK_ROW = "#";
const SPARK_CHAR = "#";
const SPARK_PATTERN_RGB = 0xFFFFFF;
const SPARK_TINTS = [0xFFD040, 0xFF8020, 0xFFFFFF];
const SPARKS_PER_BOMB = 240;
const BOMBS_PER_SAMPLE = 250;
const DEFAULT_ROUNDS = 7;
const US_PER_MS = 1000;
const BLOCKING_GC = true;
const RANDOM_SEED = 20261124;
const MIN_LIFETIME_MS = 300;
const MAX_LIFETIME_MS = 600;
const REACH_UNITS = 30;
const MS_PER_SECOND = 1000;
const FULL_TURN_RAD = 2 * Math.PI;
const UINT32_RANGE = 4294967296;
const MULBERRY_INCREMENT = 0x6D2B79F5;

interface Fixture {
    readonly world: World;
    readonly buffer: EntityCommandBuffer;
    readonly spawner: PrefabSpawner;
    readonly prefab: PrefabAsset;
    readonly spawned: Entity[];
    seed: number;
}

type SparkSpawn = (fixture: Fixture, x: number, y: number) => void;

interface Scenario {
    readonly name: string;
    readonly spawn: SparkSpawn;
    readonly playsBack: boolean;
}

function nextRandom(fixture: Fixture): number {
    let t = fixture.seed = (fixture.seed + MULBERRY_INCREMENT) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
}

function between(fixture: Fixture, min: number, max: number): number {
    return min + nextRandom(fixture) * (max - min);
}

function tintOf(fixture: Fixture): number {
    return SPARK_TINTS[Math.floor(nextRandom(fixture) * SPARK_TINTS.length)];
}

const handBuiltSpark: SparkSpawn = (fixture, x, y) => {
    const angle = nextRandom(fixture) * FULL_TURN_RAD;
    const lifetimeMs = between(fixture, MIN_LIFETIME_MS, MAX_LIFETIME_MS);
    const speed = REACH_UNITS * MS_PER_SECOND / lifetimeMs;
    const velocity = new Velocity();
    velocity.xUnitsPerSecond = Math.cos(angle) * speed;
    velocity.yUnitsPerSecond = Math.sin(angle) * speed;
    const lifetime = new Lifetime();
    lifetime.durationMs = lifetimeMs;
    lifetime.remainingMs = lifetimeMs;
    fixture.spawned.push(fixture.buffer.createEntity(SPARK_NAME, [
        new LocalPosition(x, y, SPARK_DEPTH),
        new Sprite(undefined, tintOf(fixture)),
        new SpritePattern([SPARK_ROW], [new SpritePatternColor(SPARK_CHAR, SPARK_PATTERN_RGB)]),
        new LocalToWorld(),
        new RenderBounds(),
        lifetime,
        new Spark(),
        velocity,
    ]));
};

const prefabSpark: SparkSpawn = (fixture, x, y) => {
    const angle = nextRandom(fixture) * FULL_TURN_RAD;
    const lifetimeMs = between(fixture, MIN_LIFETIME_MS, MAX_LIFETIME_MS);
    const speed = REACH_UNITS * MS_PER_SECOND / lifetimeMs;
    const spark = fixture.spawner.spawn(fixture.buffer, fixture.prefab);
    const velocity = spark.rootComponent(Velocity);
    velocity.xUnitsPerSecond = Math.cos(angle) * speed;
    velocity.yUnitsPerSecond = Math.sin(angle) * speed;
    const lifetime = spark.rootComponent(Lifetime);
    lifetime.durationMs = lifetimeMs;
    lifetime.remainingMs = lifetimeMs;
    spark.rootComponent(Sprite).tint = tintOf(fixture);
    const position = spark.rootComponent(LocalPosition);
    position.x = x;
    position.y = y;
    fixture.spawned.push(spark.root);
};

const scenarios: Scenario[] = [
    {name: "queue 240 sparks, hand-built", spawn: handBuiltSpark, playsBack: false},
    {name: "queue 240 sparks, prefab", spawn: prefabSpark, playsBack: false},
    {name: "queue + playback, hand-built", spawn: handBuiltSpark, playsBack: true},
    {name: "queue + playback, prefab", spawn: prefabSpark, playsBack: true},
];

const PAIRS: readonly (readonly [number, number])[] = [[0, 1], [2, 3]];

function newFixture(): Fixture {
    const platform = nodePlatform();
    const world = new World({platform});
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registry.registerGeneratedComponent(Spark, "Spark", []);
    const assets = platformSceneAssetLoader({files: platform.files, inflate: platform.inflate});
    const spawner = prefabSpawnerOf(world, registry, assets);
    const prefab = assets.loadPrefab(SPARK_PREFAB_PATH);
    spawner.templateOf(prefab);
    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    return {world, buffer, spawner, prefab, spawned: [], seed: RANDOM_SEED};
}

function clearBomb(fixture: Fixture, playedBack: boolean): void {
    const em = fixture.world.entityManager;
    if (playedBack) {
        for (const entity of fixture.spawned) em.destroyEntity(entity);
    } else {
        fixture.buffer.discard();
    }
    fixture.spawned.length = 0;
}

function verifyBomb(fixture: Fixture, scenario: Scenario): void {
    if (fixture.spawned.length !== SPARKS_PER_BOMB) throw new Error(`${scenario.name}: queued ${fixture.spawned.length} sparks, expected ${SPARKS_PER_BOMB}`);
    if (!scenario.playsBack) return;
    const enabled = fixture.world.enabledEntityCount;
    if (enabled !== SPARKS_PER_BOMB) throw new Error(`${scenario.name}: ${enabled} entities after playback, expected ${SPARKS_PER_BOMB}`);
}

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

function sample(scenario: Scenario, gc: GcMode): number {
    const fixture = newFixture();
    gc.collect();
    let total = 0;
    for (let bomb = 0; bomb < BOMBS_PER_SAMPLE; bomb++) {
        const x = bomb, y = -bomb;
        const t0 = performance.now();
        for (let i = 0; i < SPARKS_PER_BOMB; i++) scenario.spawn(fixture, x, y);
        if (scenario.playsBack) fixture.buffer.playback(fixture.world.entityManager);
        total += performance.now() - t0;
        verifyBomb(fixture, scenario);
        clearBomb(fixture, scenario.playsBack);
    }
    return total / BOMBS_PER_SAMPLE;
}

function main(): void {
    const rounds = parseRounds();
    const gc = detectGc();
    const cpu = os.cpus()[0]?.model.trim() ?? "unknown cpu";

    console.log(`prefab spawn bench | ${runtimeLabel()} | ${os.platform()} ${os.arch()} | ${cpu}`);
    console.log(`swarm spark prefab, ${SPARKS_PER_BOMB} sparks per bomb, ${BOMBS_PER_SAMPLE} bombs per sample`);
    console.log(`rounds: ${rounds} (+1 warm-up), interleaved | gc: ${gc.label}`);
    console.log("");

    for (const scenario of scenarios) sample(scenario, gc);

    const samples: number[][] = scenarios.map(() => []);
    for (let r = 0; r < rounds; r++) {
        for (let s = 0; s < scenarios.length; s++) samples[s].push(sample(scenarios[s], gc));
    }

    const nameWidth = Math.max(...scenarios.map(s => s.name.length)) + 2;
    console.log("scenario".padEnd(nameWidth) + " ms/bomb     min     max   per spark");
    const medians = samples.map(median);
    for (let s = 0; s < scenarios.length; s++) {
        const xs = samples[s];
        const perSparkUs = (medians[s] * US_PER_MS / SPARKS_PER_BOMB).toFixed(3);
        console.log(`${scenarios[s].name.padEnd(nameWidth)}   ${formatMs(medians[s])} ${formatMs(Math.min(...xs))} ${formatMs(Math.max(...xs))}   ${perSparkUs} us`);
    }
    console.log("");
    for (const [handBuilt, prefab] of PAIRS) {
        console.log(`${scenarios[prefab].name} / ${scenarios[handBuilt].name}: ${(medians[prefab] / medians[handBuilt]).toFixed(2)}x`);
    }
}

main();
