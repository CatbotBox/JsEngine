import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join, relative, resolve} from "path";
import {World} from "../src/engine/core";
import type {Component, ComponentCtor} from "../src/engine/core";
import {MemoryPlatform} from "../src/engine/testing/memoryPlatform";
import {deserializeInto, parseSceneDocument, serializeWorld} from "../src/engine/scene";
import type {SchemaEntry} from "../src/engine/scene";
import {PROJECT_MANIFEST_FILE} from "../src/engine/project/projectManifest";
import {createProjectSchemaRegistry} from "../src/engine/project/projectSchemas";
import {checkGeneratedFiles, writeGeneratedFiles} from "../src/toolchain/generate/generatedFiles";
import {GENERATED_SCHEMAS_FILE} from "../src/toolchain/projectLayout";

const ROOT = resolve(__dirname, "..");
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "projectSchemas-fixture-";
const LINE_BREAK = "\r\n";
const PERCENT_MIN = 0;
const PERCENT_MAX = 1;
const SAVED_CHANCE = 0.25;
const SAVED_GRADIENT: readonly [number, number] = [2, 7];
const SAVED_BEACON_RANGE = 0.75;
const EXCLUDED_SCHEMA = "DebugOverlay";

interface Waypoint {
    x: number;
    label: string;
    waitTicks: number;
}

interface Gradient {
    readonly from: number;
    readonly to: number;
}

interface Patrol extends Component {
    chance: number;
    waypoints: Waypoint[];
    gradient: Gradient;
}

interface Beacon extends Component {
    range: number;
}

interface FixtureModules {
    readonly generated: readonly SchemaEntry[];
    readonly generatedSource: string;
    readonly Patrol: ComponentCtor<Patrol>;
    readonly Beacon: ComponentCtor<Beacon>;
    readonly Waypoint: new () => Waypoint;
    readonly Gradient: new (from: number, to: number) => Gradient;
}

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function fixtureFiles(folder: string): Readonly<Record<string, string>> {
    const engine = relative(folder, join(ROOT, "src", "engine")).replace(/\\/g, "/");
    return {
        [PROJECT_MANIFEST_FILE]: JSON.stringify({name: "Project schemas fixture", entry: "patrol.ts", schemas: {exclude: [EXCLUDED_SCHEMA]}}),
        "gradient.ts": [
            `import type {FieldTypeCodec} from "${engine}/scene";`,
            ``,
            `export class Gradient {`,
            `    public static readonly fieldType: FieldTypeCodec<Gradient> = {`,
            `        encode: gradient => [gradient.from, gradient.to],`,
            `        decode: json => new Gradient((json as number[])[0], (json as number[])[1]),`,
            `        defaultValue: () => new Gradient(0, 1),`,
            `    };`,
            ``,
            `    public constructor(public readonly from: number, public readonly to: number) {`,
            `    }`,
            `}`,
        ].join(LINE_BREAK),
        "patrol.ts": [
            `import {Component} from "${engine}/core";`,
            `import {componentSchema, fieldAlias} from "${engine}/scene";`,
            `import type {Int} from "${engine}/scene";`,
            `import {Gradient} from "./gradient";`,
            ``,
            `export type Percent = number;`,
            `export const Percent = fieldAlias({min: ${PERCENT_MIN}, max: ${PERCENT_MAX}});`,
            ``,
            `export class Waypoint {`,
            `    public x = 0;`,
            `    public label = "";`,
            `    public waitTicks: Int = 0;`,
            `}`,
            ``,
            `export class Patrol extends Component {`,
            `    public chance: Percent = 0.5;`,
            `    public waypoints: Waypoint[] = [];`,
            `    public gradient = new Gradient(0, 1);`,
            `}`,
            ``,
            `export class Beacon extends Component {`,
            `    public static readonly schema = componentSchema(Beacon, "Beacon").number("range", {typeName: "Percent"}).build();`,
            `    public range = 0.5;`,
            `}`,
            ``,
            `export class ${EXCLUDED_SCHEMA} extends Component {`,
            `    public visible = true;`,
            `}`,
        ].join(LINE_BREAK),
    };
}

function loadFixture(folder: string): FixtureModules {
    const patrol = require(join(folder, "patrol.ts")) as Pick<FixtureModules, "Patrol" | "Beacon" | "Waypoint">;
    const gradient = require(join(folder, "gradient.ts")) as Pick<FixtureModules, "Gradient">;
    const generatedPath = join(folder, GENERATED_SCHEMAS_FILE);
    return {
        generated: (require(generatedPath) as {readonly generatedSchemas: readonly SchemaEntry[]}).generatedSchemas,
        generatedSource: readFileSync(generatedPath, "utf8"),
        Patrol: patrol.Patrol,
        Beacon: patrol.Beacon,
        Waypoint: patrol.Waypoint,
        Gradient: gradient.Gradient,
    };
}

function waypoint(fixture: FixtureModules, x: number, label: string, waitTicks: number): Waypoint {
    return Object.assign(new fixture.Waypoint(), {x, label, waitTicks});
}

function roundTripGeneratedFixture(): void {
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        for (const [path, text] of Object.entries(fixtureFiles(folder))) writeFileSync(join(folder, path), text);
        const warnings = writeGeneratedFiles(folder).warnings;
        expect(warnings.length === 0, `the fixture generates without warnings (${JSON.stringify(warnings)})`);
        expect(checkGeneratedFiles(folder).files.every(file => file.state === "upToDate"), "the written fixture files pass --check");

        const fixture = loadFixture(folder);
        const registry = createProjectSchemaRegistry({schemas: fixture.generated});
        const schema = registry.byName("Patrol");
        expect(schema !== undefined && schema.ctor === fixture.Patrol, "the generated module registers Patrol");
        const fields = new Map((schema?.fields ?? []).map(field => [field.key, field]));
        expect(sameJson(fields.get("chance"), {key: "chance", kind: "number", typeName: "Percent", options: {min: PERCENT_MIN, max: PERCENT_MAX}}),
            `the registered alias merges its options into chance (${JSON.stringify(fields.get("chance"))})`);
        expect(sameJson(fields.get("gradient"), {key: "gradient", kind: "custom", typeName: "Gradient"}), "gradient uses the custom field type from Gradient.fieldType");
        const beacon = registry.byName("Beacon");
        expect(beacon !== undefined && beacon.ctor === fixture.Beacon, "Beacon registers through its own static schema");
        expect(sameJson(beacon?.fields, [{key: "range", kind: "number", typeName: "Percent", options: {min: PERCENT_MIN, max: PERCENT_MAX}}]),
            `the alias also reaches the hand-written schema (${JSON.stringify(beacon?.fields)})`);
        expect(registry.byName(EXCLUDED_SCHEMA) === undefined && !fixture.generatedSource.includes(EXCLUDED_SCHEMA), `the manifest exclude list leaves ${EXCLUDED_SCHEMA} out`);
        const waypoints = fields.get("waypoints");
        const element = waypoints?.kind === "list" ? waypoints.element : undefined;
        const elementKeys = element?.kind === "struct" ? element.fields.map(field => `${field.key}:${field.kind}`) : [];
        expect(sameJson(elementKeys, ["x:number", "label:string", "waitTicks:integer"]), `waypoints is a list of Waypoint structs (${elementKeys.join(", ")})`);

        const source = new World({platform: new MemoryPlatform()});
        const patrol = new fixture.Patrol();
        patrol.chance = SAVED_CHANCE;
        patrol.waypoints = [waypoint(fixture, 1, "gate", 3), waypoint(fixture, -2, "tower", 0)];
        patrol.gradient = new fixture.Gradient(...SAVED_GRADIENT);
        const savedBeacon = new fixture.Beacon();
        savedBeacon.range = SAVED_BEACON_RANGE;
        source.entityManager.createEntity("guard", [patrol]);
        source.entityManager.createEntity("beacon", [savedBeacon]);
        const saved = serializeWorld(source, registry);
        const savedPatrol = saved.document.entities[0]?.components.Patrol;
        expect(sameJson(savedPatrol, {
            chance: SAVED_CHANCE,
            waypoints: [{x: 1, label: "gate", waitTicks: 3}, {x: -2, label: "tower", waitTicks: 0}],
            gradient: [...SAVED_GRADIENT],
        }), `Patrol saves its nested fields (${JSON.stringify(savedPatrol)})`);

        const target = new World({platform: new MemoryPlatform()});
        const [guard, beaconEntity] = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document))).entities;
        const loaded = guard === undefined ? undefined : target.entityManager.getComponent<Patrol>(guard, fixture.Patrol);
        expect(loaded !== undefined && loaded.chance === SAVED_CHANCE, "chance loads back");
        const loadedBeacon = beaconEntity === undefined ? undefined : target.entityManager.getComponent<Beacon>(beaconEntity, fixture.Beacon);
        expect(loadedBeacon !== undefined && loadedBeacon.range === SAVED_BEACON_RANGE, "the Beacon range loads back");
        expect(loaded !== undefined && loaded.waypoints.every(each => each instanceof fixture.Waypoint), "waypoints load back as Waypoint instances");
        expect(loaded !== undefined && sameJson(loaded.waypoints, patrol.waypoints), "waypoints load back with their values");
        expect(loaded !== undefined && loaded.gradient instanceof fixture.Gradient && sameJson(loaded.gradient, patrol.gradient), "gradient loads back through its codec");
        expect(sameJson(serializeWorld(target, registry).document.entities, saved.document.entities), "the loaded world saves the same document");
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

roundTripGeneratedFixture();
if (failures > 0) {
    log(`${failures} check(s) failed`);
    process.exitCode = 1;
} else {
    log("all project schema checks passed");
}
