import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {join, relative, resolve} from "path";
import {World} from "../src/engine/core";
import type {Component, ComponentCtor} from "../src/engine/core";
import {MemoryPlatform} from "../src/engine/testing/memoryPlatform";
import {deserializeInto, parseSceneDocument, serializeWorld} from "../src/engine/scene";
import {createProjectSchemaRegistry} from "../src/engine/project/projectSchemas";
import type {GeneratedProjectSchemas} from "../src/engine/project/projectSchemas";
import type {ProjectEntryModule} from "../src/engine/project/projectEntry";
import {checkGeneratedSchemas, GENERATED_FILE_NAME, writeGeneratedSchemas} from "../scripts/projectSchemas/generateProjectSchemas";

const ROOT = resolve(__dirname, "..");
const DEMO_PROJECTS: readonly string[] = ["demo/2d", "demo/3d", "demo/swarm"];
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "projectSchemas-fixture-";
const LINE_BREAK = "\r\n";
const PERCENT_MIN = 0;
const PERCENT_MAX = 1;
const SAVED_CHANCE = 0.25;
const SAVED_GRADIENT: readonly [number, number] = [2, 7];

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

interface FixtureModules {
    readonly entry: ProjectEntryModule;
    readonly generated: GeneratedProjectSchemas;
    readonly Patrol: ComponentCtor<Patrol>;
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
        "gradient.ts": [
            `export class Gradient {`,
            `    public constructor(public readonly from: number, public readonly to: number) {`,
            `    }`,
            `}`,
        ].join(LINE_BREAK),
        "patrol.ts": [
            `import {Component} from "${engine}/core";`,
            `import type {Int} from "${engine}/scene";`,
            `import {Gradient} from "./gradient";`,
            ``,
            `export type Percent = number;`,
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
        ].join(LINE_BREAK),
        "project.ts": [
            `import type {ComponentSchemaRegistry} from "${engine}/scene";`,
            `import {Gradient} from "./gradient";`,
            ``,
            `export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {`,
            `    registry.registerFieldAlias("Percent", {options: {min: ${PERCENT_MIN}, max: ${PERCENT_MAX}}});`,
            `    registry.registerFieldType<Gradient>({`,
            `        name: "Gradient",`,
            `        encode: gradient => [gradient.from, gradient.to],`,
            `        decode: json => new Gradient((json as number[])[0], (json as number[])[1]),`,
            `        defaultValue: () => new Gradient(0, 1),`,
            `    });`,
            `}`,
            ``,
            `export function setupProject(): void {`,
            `}`,
        ].join(LINE_BREAK),
    };
}

function loadFixture(folder: string): FixtureModules {
    const patrol = require(join(folder, "patrol.ts")) as Pick<FixtureModules, "Patrol" | "Waypoint">;
    const gradient = require(join(folder, "gradient.ts")) as Pick<FixtureModules, "Gradient">;
    return {
        entry: require(join(folder, "project.ts")) as ProjectEntryModule,
        generated: require(join(folder, GENERATED_FILE_NAME)) as GeneratedProjectSchemas,
        Patrol: patrol.Patrol,
        Waypoint: patrol.Waypoint,
        Gradient: gradient.Gradient,
    };
}

function checkDemoSchemasAreCurrent(): void {
    for (const project of DEMO_PROJECTS) {
        const file = checkGeneratedSchemas(join(ROOT, project), {repoRoot: ROOT});
        expect(file.upToDate, `${project}/${GENERATED_FILE_NAME} is up to date (regenerate with bun run project:generate-schemas ${project})`);
    }
}

function waypoint(fixture: FixtureModules, x: number, label: string, waitTicks: number): Waypoint {
    return Object.assign(new fixture.Waypoint(), {x, label, waitTicks});
}

function roundTripGeneratedFixture(): void {
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        for (const [path, text] of Object.entries(fixtureFiles(folder))) writeFileSync(join(folder, path), text);
        const written = writeGeneratedSchemas(folder, {repoRoot: ROOT});
        expect(written.warnings.length === 0, `the fixture generates without warnings (${JSON.stringify(written.warnings)})`);
        expect(checkGeneratedSchemas(folder, {repoRoot: ROOT}).upToDate, "the written fixture module passes --check");

        const fixture = loadFixture(folder);
        const registry = createProjectSchemaRegistry(fixture.entry, {generated: fixture.generated});
        const schema = registry.byName("Patrol");
        expect(schema !== undefined && schema.ctor === fixture.Patrol, "the generated module registers Patrol");
        const fields = new Map((schema?.fields ?? []).map(field => [field.key, field]));
        expect(sameJson(fields.get("chance"), {key: "chance", kind: "number", typeName: "Percent", options: {min: PERCENT_MIN, max: PERCENT_MAX}}),
            `the registered alias merges its options into chance (${JSON.stringify(fields.get("chance"))})`);
        expect(sameJson(fields.get("gradient"), {key: "gradient", kind: "custom", typeName: "Gradient"}), "gradient uses the registered custom field type");
        const waypoints = fields.get("waypoints");
        const element = waypoints?.kind === "list" ? waypoints.element : undefined;
        const elementKeys = element?.kind === "struct" ? element.fields.map(field => `${field.key}:${field.kind}`) : [];
        expect(sameJson(elementKeys, ["x:number", "label:string", "waitTicks:integer"]), `waypoints is a list of Waypoint structs (${elementKeys.join(", ")})`);

        const source = new World({platform: new MemoryPlatform()});
        const patrol = new fixture.Patrol();
        patrol.chance = SAVED_CHANCE;
        patrol.waypoints = [waypoint(fixture, 1, "gate", 3), waypoint(fixture, -2, "tower", 0)];
        patrol.gradient = new fixture.Gradient(...SAVED_GRADIENT);
        source.entityManager.createEntity("guard", [patrol]);
        const saved = serializeWorld(source, registry);
        const savedPatrol = saved.document.entities[0]?.components.Patrol;
        expect(sameJson(savedPatrol, {
            chance: SAVED_CHANCE,
            waypoints: [{x: 1, label: "gate", waitTicks: 3}, {x: -2, label: "tower", waitTicks: 0}],
            gradient: [...SAVED_GRADIENT],
        }), `Patrol saves its nested fields (${JSON.stringify(savedPatrol)})`);

        const target = new World({platform: new MemoryPlatform()});
        const [guard] = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document))).entities;
        const loaded = guard === undefined ? undefined : target.entityManager.getComponent<Patrol>(guard, fixture.Patrol);
        expect(loaded !== undefined && loaded.chance === SAVED_CHANCE, "chance loads back");
        expect(loaded !== undefined && loaded.waypoints.every(each => each instanceof fixture.Waypoint), "waypoints load back as Waypoint instances");
        expect(loaded !== undefined && sameJson(loaded.waypoints, patrol.waypoints), "waypoints load back with their values");
        expect(loaded !== undefined && loaded.gradient instanceof fixture.Gradient && sameJson(loaded.gradient, patrol.gradient), "gradient loads back through its codec");
        expect(sameJson(serializeWorld(target, registry).document.entities, saved.document.entities), "the loaded world saves the same document");
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

checkDemoSchemasAreCurrent();
roundTripGeneratedFixture();
if (failures > 0) {
    log(`${failures} check(s) failed`);
    process.exitCode = 1;
} else {
    log("all project schema checks passed");
}
