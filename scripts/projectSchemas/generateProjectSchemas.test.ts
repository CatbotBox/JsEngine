import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join, resolve} from "path";
import {describe, expect, test} from "../../src/engine/testing/harness";
import {GENERATED_HEADER, generateProjectSchemas} from "./generateProjectSchemas";
import type {GeneratedProjectSchemas} from "./generateProjectSchemas";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINE_BREAK = "\r\n";
const INSIDE_REPO_FIXTURE_PREFIX = join(__dirname, "fixture-");
const OUTSIDE_REPO_FIXTURE_PREFIX = join(tmpdir(), "jsengine-schemas-");
const REGISTRATION_END = "]);";
const EMPTY_REGISTRATION_SUFFIX = "[]);";

type FixtureFiles = Readonly<Record<string, string>>;

function generateFixture(files: FixtureFiles, folderPrefix = OUTSIDE_REPO_FIXTURE_PREFIX): GeneratedProjectSchemas {
    const projectFolder = mkdtempSync(folderPrefix);
    try {
        for (const [path, text] of Object.entries(files)) {
            const target = join(projectFolder, path);
            mkdirSync(dirname(target), {recursive: true});
            writeFileSync(target, text);
        }
        return generateProjectSchemas(projectFolder, {repoRoot: REPO_ROOT});
    } finally {
        rmSync(projectFolder, {recursive: true, force: true});
    }
}

function registrationBlock(source: string, schemaName: string): string {
    const lines = source.split(LINE_BREAK);
    const start = lines.findIndex(line => line.includes(`(${schemaName}, ${JSON.stringify(schemaName)}, `));
    if (start < 0) throw new Error(`no registration for ${schemaName} in:\n${source}`);
    if (lines[start].endsWith(EMPTY_REGISTRATION_SUFFIX)) return lines[start].trim();
    const end = lines.findIndex((line, index) => index > start && line.trim() === REGISTRATION_END);
    return lines.slice(start, end + 1).map(line => line.trim()).join("\n");
}

function fieldLine(source: string, schemaName: string, key: string): string | undefined {
    const prefix = `{key: ${JSON.stringify(key)}, `;
    return registrationBlock(source, schemaName).split("\n").find(line => line.startsWith(prefix));
}

function fieldKeys(source: string, schemaName: string): string[] {
    const keyPattern = /^\{key: "([^"]+)"/;
    return registrationBlock(source, schemaName).split("\n").slice(1, -1)
        .map(line => keyPattern.exec(line)?.[1]).filter((key): key is string => key !== undefined);
}

const MAPPING_FIXTURE: FixtureFiles = {
    "mapping.ts": `
import {Component, NULL_ENTITY, Resource} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {Vec2, Vec3, Vec4} from "@jsengine/engine/math/types/vec";
import type {Mesh} from "@jsengine/engine/rendering/3d/mesh";
import type {SpriteImage} from "@jsengine/engine/rendering/2d/spriteImage";
import {TextColor} from "@jsengine/engine/rendering/textColor";
import type {Int, PrefabAsset, Quat, Rgb, TextLines} from "@jsengine/engine/scene";

export type Health = Int;
export type Speed = number;
export type Label = string;
export type Mode = "walk" | "run";
export const Phase = {Idle: "idle", Busy: "busy"} as const;
export type Phase = typeof Phase[keyof typeof Phase];
export enum Facing { North, South = 5 }
export enum Tone { Warm = "warm", Cool = "cool" }

export class GameSettings extends Resource {
    public volume = 1;
}

export class Mapping extends Component {
    public inferredNumber = 0;
    public annotatedNumber: number = 1;
    public flag = false;
    public title = "x";
    public optionalTitle: string | undefined = undefined;
    public optionalCount?: number;
    public nullableCount: number | null = null;
    public count: Int = 0;
    public nullableInt: Int | undefined = undefined;
    public color: Rgb = 0;
    public lines: TextLines = [];
    public textColor: TextColor = TextColor.DEFAULT;
    public inferredTextColor = TextColor.DEFAULT;
    public flat: Vec2 = Vec2.alloc();
    public position: Vec3 = Vec3.alloc();
    public inferredPosition = Vec3.alloc();
    public rotation: Vec4 = Vec4.alloc();
    public quat!: Quat;
    public target: Entity = NULL_ENTITY;
    public inferredTarget = NULL_ENTITY;
    public mode: Mode = "walk";
    public inlineMode: "a" | "b" = "a";
    public numericMode: 1 | 2 = 1;
    public phase: Phase = Phase.Idle;
    public facing = Facing.North;
    public tone: Tone = Tone.Warm;
    public mesh: Mesh | undefined = undefined;
    public sprite?: SpriteImage;
    public prefab: PrefabAsset | undefined = undefined;
    public settings: GameSettings | undefined = undefined;
    public health: Health = 1;
    public speed: Speed = 1;
    public label: Label = "";
    public numbers: number[] = [];
    public readonlyNames: readonly string[] = [];
    public healths: Array<Health> = [];
    public grid: Vec3[][] = [];
}
`,
};

const SKIPPING_FIXTURE: FixtureFiles = {
    "skips.ts": `
import {Component} from "@jsengine/engine/core";

export class Skips extends Component {
    public kept = 0;
    private hidden = 0;
    protected guarded = 0;
    #secret = 0;
    public _internal = 0;
    public readonly fixed = 0;
    public static shared = 0;
    public callback = () => {};
    public handler: ((value: number) => void) | undefined = undefined;
    private backing = 0;

    public constructor(public fromConstructor: number = 0, private hiddenParameter = 0, public readonly fixedParameter = 0) {
        super();
    }

    public get value(): number {
        return this.backing;
    }

    public set value(value: number) {
        this.backing = value;
    }

    public get onlyGetter(): number {
        return 0;
    }

    public set onlySetter(value: number) {
        this.backing = value;
    }

    private get hiddenAccessor(): number {
        return 0;
    }

    private set hiddenAccessor(value: number) {
    }

    public method(): void {
    }
}

export abstract class AbstractBase extends Component {
    public baseValue = 0;
}

export class Derived extends AbstractBase {
    public ownValue = 0;
}

class NotExported extends Component {
    public value = 0;
}

export class NotASchema {
    public value = 0;
}

export class HandWritten extends Component {
    public static readonly schema = {name: "HandWritten"};
    public value = 0;
}
`,
    "launch/launched.ts": `
import {Component} from "@jsengine/engine/core";
export class FromLaunch extends Component {}
`,
    "skips.test.ts": `
import {Component} from "@jsengine/engine/core";
export class FromTest extends Component {}
`,
    "schemas.generated.ts": `
import {Component} from "@jsengine/engine/core";
export class FromGenerated extends Component {}
`,
    ".jsengine/build/cached.ts": `
import {Component} from "@jsengine/engine/core";
export class FromBuild extends Component {}
`,
};

const STRUCT_FIXTURE: FixtureFiles = {
    "shapes/range.ts": `
export class Range {
    public min = 0;
    public max = 1;
}
`,
    "structs.ts": `
import {Component} from "@jsengine/engine/core";
import type {ComponentSchemaRegistry} from "@jsengine/engine/scene";
import {Range} from "./shapes/range";

export type Pair = [number, number];
export type Lookup = Map<string, number>;

export interface Tint {
    r: number;
    g: number;
}

export type Offset = {dx: number; dy: number};

class Hidden {
    public value = 0;
}

export class NeedsArguments {
    public constructor(public value: number) {
    }
}

export class TreeNode {
    public value = 0;
    public children: TreeNode[] = [];
}

export interface Frozen {
    readonly value: number;
}

export class Structs extends Component {
    public range = new Range();
    public tint: Tint = {r: 0, g: 0};
    public offset: Offset = {dx: 0, dy: 0};
    public inline: {x: number; y: number} = {x: 0, y: 0};
    public ranges: Range[] = [];
    public hidden = new Hidden();
    public needsArguments = new NeedsArguments(1);
    public frozen: Frozen = {value: 0};
    public tree = new TreeNode();
    public table = new Map<string, number>();
    public anything: any = undefined;
    public pair: [number, number] = [0, 0];
    public lookup: {[key: string]: number} = {};
    public maybeRange: Range | undefined = undefined;
    public samples = new Float32Array(4);
    public registry!: ComponentSchemaRegistry;
    public namedPair: Pair = [0, 0];
    public namedLookup: Lookup = new Map();
}
`,
};

const LOOKALIKE_FIXTURE: FixtureFiles = {
    "lookalikes.ts": `
import {Component} from "@jsengine/engine/core";

export type Int = number;
export type Rgb = number;
export type TextLines = string;

export class PrefabAsset {
    public sourcePath = "";
}

export class Lookalikes extends Component {
    public count: Int = 0;
    public color: Rgb = 0;
    public lines: TextLines = "";
    public prefab = new PrefabAsset();
}
`,
};

const ORDER_FIXTURE: FixtureFiles = {
    "b.ts": `
import {Component} from "@jsengine/engine/core";
export class Zebra extends Component {}
export class Apple extends Component {}
`,
    "a/z.ts": `
import {Component} from "@jsengine/engine/core";
export class Middle extends Component {}
`,
};

const INSIDE_REPO_FIXTURE: FixtureFiles = {
    "inside.ts": `
import {Component} from "../../../src/engine/core";
export class Inside extends Component {
    public value = 0;
}
`,
};

let mappingResult: GeneratedProjectSchemas | undefined;
let skippingResult: GeneratedProjectSchemas | undefined;
let structResult: GeneratedProjectSchemas | undefined;

function mapping(): GeneratedProjectSchemas {
    return mappingResult ??= generateFixture(MAPPING_FIXTURE);
}

function skipping(): GeneratedProjectSchemas {
    return skippingResult ??= generateFixture(SKIPPING_FIXTURE);
}

function structs(): GeneratedProjectSchemas {
    return structResult ??= generateFixture(STRUCT_FIXTURE);
}

describe("generateProjectSchemas type mapping", () => {
    const expectations: readonly (readonly [string, string])[] = [
        ["inferredNumber", `{key: "inferredNumber", kind: "number"},`],
        ["annotatedNumber", `{key: "annotatedNumber", kind: "number"},`],
        ["flag", `{key: "flag", kind: "boolean"},`],
        ["title", `{key: "title", kind: "string", nullable: false},`],
        ["optionalTitle", `{key: "optionalTitle", kind: "string", nullable: true},`],
        ["optionalCount", `{key: "optionalCount", kind: "number", nullable: true},`],
        ["nullableCount", `{key: "nullableCount", kind: "number", nullable: true},`],
        ["count", `{key: "count", kind: "integer"},`],
        ["nullableInt", `{key: "nullableInt", kind: "integer", nullable: true},`],
        ["color", `{key: "color", kind: "rgb"},`],
        ["lines", `{key: "lines", kind: "textLines"},`],
        ["textColor", `{key: "textColor", kind: "textColor"},`],
        ["inferredTextColor", `{key: "inferredTextColor", kind: "textColor"},`],
        ["flat", `{key: "flat", kind: "vec2"},`],
        ["position", `{key: "position", kind: "vec3"},`],
        ["inferredPosition", `{key: "inferredPosition", kind: "vec3"},`],
        ["rotation", `{key: "rotation", kind: "rotation"},`],
        ["quat", `{key: "quat", kind: "rotation"},`],
        ["target", `{key: "target", kind: "entity", nullable: true},`],
        ["inferredTarget", `{key: "inferredTarget", kind: "entity", nullable: true},`],
        ["mode", `{key: "mode", kind: "enum", typeName: "Mode", members: [{name: "walk", value: "walk"}, {name: "run", value: "run"}]},`],
        ["inlineMode", `{key: "inlineMode", kind: "enum", members: [{name: "a", value: "a"}, {name: "b", value: "b"}]},`],
        ["numericMode", `{key: "numericMode", kind: "enum", members: [{name: "1", value: 1}, {name: "2", value: 2}]},`],
        ["phase", `{key: "phase", kind: "enum", typeName: "Phase", members: [{name: "Idle", value: "idle"}, {name: "Busy", value: "busy"}]},`],
        ["facing", `{key: "facing", kind: "enum", typeName: "Facing", members: [{name: "North", value: 0}, {name: "South", value: 5}]},`],
        ["tone", `{key: "tone", kind: "enum", typeName: "Tone", members: [{name: "Warm", value: "warm"}, {name: "Cool", value: "cool"}]},`],
        ["mesh", `{key: "mesh", kind: "asset", assetType: "mesh"},`],
        ["sprite", `{key: "sprite", kind: "asset", assetType: "spriteImage"},`],
        ["prefab", `{key: "prefab", kind: "asset", assetType: "prefab"},`],
        ["settings", `{key: "settings", kind: "asset", assetType: "GameSettings"},`],
        ["health", `{key: "health", kind: "integer", typeName: "Health"},`],
        ["speed", `{key: "speed", kind: "number", typeName: "Speed"},`],
        ["label", `{key: "label", kind: "string", nullable: false, typeName: "Label"},`],
        ["numbers", `{key: "numbers", kind: "list", element: {kind: "number"}},`],
        ["readonlyNames", `{key: "readonlyNames", kind: "list", element: {kind: "string", nullable: false}},`],
        ["healths", `{key: "healths", kind: "list", element: {kind: "integer", typeName: "Health"}},`],
        ["grid", `{key: "grid", kind: "list", element: {kind: "list", element: {kind: "vec3"}}},`],
    ];
    for (const [key, expected] of expectations) {
        test(`maps ${key}`, () => {
            expect(fieldLine(mapping().source, "Mapping", key)).toBe(expected);
        });
    }

    test("emits every mapped field without warnings", () => {
        expect(fieldKeys(mapping().source, "Mapping")).toEqual(expectations.map(([key]) => key));
        expect(mapping().warnings).toEqual([]);
    });

    test("maps the engine names only when they come from the engine", () => {
        const result = generateFixture(LOOKALIKE_FIXTURE);
        expect(fieldLine(result.source, "Lookalikes", "count")).toBe(`{key: "count", kind: "number", typeName: "Int"},`);
        expect(fieldLine(result.source, "Lookalikes", "color")).toBe(`{key: "color", kind: "number", typeName: "Rgb"},`);
        expect(fieldLine(result.source, "Lookalikes", "lines")).toBe(`{key: "lines", kind: "string", nullable: false, typeName: "TextLines"},`);
        expect(fieldLine(result.source, "Lookalikes", "prefab"))
            .toBe(`{key: "prefab", kind: "struct", typeName: "PrefabAsset", create: () => new PrefabAsset(), fields: [`);
        expect(result.warnings).toEqual([]);
    });

    test("registers resource subclasses as resources", () => {
        expect(registrationBlock(mapping().source, "GameSettings")).toBe([
            `registry.registerGeneratedResource(GameSettings, "GameSettings", [`,
            `{key: "volume", kind: "number"},`,
            `]);`,
        ].join("\n"));
    });
});

describe("generateProjectSchemas field filtering", () => {
    test("keeps public writable data members and accessor pairs in declaration order", () => {
        expect(fieldKeys(skipping().source, "Skips")).toEqual(["kept", "fromConstructor", "value"]);
    });

    test("lists inherited fields before own fields and skips abstract classes", () => {
        expect(fieldKeys(skipping().source, "Derived")).toEqual(["baseValue", "ownValue"]);
        expect(skipping().source.includes("AbstractBase")).toBe(false);
    });

    test("skips non-exported classes and classes outside the Component/Resource chain", () => {
        expect(skipping().source.includes("NotExported")).toBe(false);
        expect(skipping().source.includes("NotASchema")).toBe(false);
    });

    test("still emits a class with a hand-written static schema", () => {
        expect(fieldKeys(skipping().source, "HandWritten")).toEqual(["value"]);
    });

    test("ignores launch, test, generated and .jsengine files", () => {
        for (const name of ["FromLaunch", "FromTest", "FromGenerated", "FromBuild"]) expect(skipping().source.includes(name)).toBe(false);
    });

    test("skips filtered members without warnings", () => {
        expect(skipping().warnings).toEqual([]);
    });
});

describe("generateProjectSchemas structs", () => {
    test("expands classes with create, interfaces and object aliases with type names", () => {
        const source = structs().source;
        expect(fieldLine(source, "Structs", "range")).toBe(`{key: "range", kind: "struct", typeName: "Range", create: () => new Range(), fields: [`);
        expect(registrationBlock(source, "Structs").split("\n").slice(1, 13)).toEqual([
            `{key: "range", kind: "struct", typeName: "Range", create: () => new Range(), fields: [`,
            `{key: "min", kind: "number"},`,
            `{key: "max", kind: "number"},`,
            `]},`,
            `{key: "tint", kind: "struct", typeName: "Tint", fields: [`,
            `{key: "r", kind: "number"},`,
            `{key: "g", kind: "number"},`,
            `]},`,
            `{key: "offset", kind: "struct", typeName: "Offset", fields: [`,
            `{key: "dx", kind: "number"},`,
            `{key: "dy", kind: "number"},`,
            `]},`,
        ]);
    });

    test("expands anonymous object types without a type name", () => {
        expect(fieldLine(structs().source, "Structs", "inline")).toBe(`{key: "inline", kind: "struct", fields: [`);
    });

    test("expands a list of class structs", () => {
        expect(fieldLine(structs().source, "Structs", "ranges"))
            .toBe(`{key: "ranges", kind: "list", element: {kind: "struct", typeName: "Range", create: () => new Range(), fields: [`);
    });

    test("imports struct classes from their own files", () => {
        expect(structs().source.includes(`import {Range} from "./shapes/range";${LINE_BREAK}`)).toBe(true);
    });

    test("falls back to custom for named project types it cannot expand", () => {
        const source = structs().source;
        expect(fieldLine(source, "Structs", "hidden")).toBe(`{key: "hidden", kind: "custom", typeName: "Hidden"},`);
        expect(fieldLine(source, "Structs", "needsArguments")).toBe(`{key: "needsArguments", kind: "custom", typeName: "NeedsArguments"},`);
        expect(fieldLine(source, "Structs", "frozen")).toBe(`{key: "frozen", kind: "custom", typeName: "Frozen"},`);
        expect(fieldLine(source, "Structs", "namedPair")).toBe(`{key: "namedPair", kind: "custom", typeName: "Pair"},`);
        expect(fieldLine(source, "Structs", "namedLookup")).toBe(`{key: "namedLookup", kind: "custom", typeName: "Lookup"},`);
    });

    test("guards self-referential structs with a warning", () => {
        expect(fieldLine(structs().source, "Structs", "tree")).toBe(`{key: "tree", kind: "struct", typeName: "TreeNode", create: () => new TreeNode(), fields: [`);
        expect(structs().warnings.includes("Structs.tree.children[]: recursive type TreeNode skipped")).toBe(true);
    });

    test("skips unsupported fields with a warning", () => {
        expect(structs().warnings.filter(warning => !warning.includes("recursive type"))).toEqual([
            "Structs.table: unsupported type Map<string, number>",
            "Structs.anything: unsupported type any",
            "Structs.pair: unsupported type [number, number]",
            "Structs.lookup: unsupported type {[key: string]: number}",
            "Structs.maybeRange: unsupported type Range | undefined",
            "Structs.samples: unsupported type Float32Array<ArrayBuffer>",
            "Structs.registry: unsupported type ComponentSchemaRegistry",
        ]);
        for (const key of ["table", "anything", "pair", "lookup", "maybeRange", "samples", "registry"]) {
            expect(fieldLine(structs().source, "Structs", key)).toBeUndefined();
        }
    });
});

describe("generateProjectSchemas output", () => {
    test("starts with the header, uses CRLF and ends with a line break", () => {
        const source = mapping().source;
        expect(source.startsWith(GENERATED_HEADER + LINE_BREAK)).toBe(true);
        expect(source.endsWith("}" + LINE_BREAK)).toBe(true);
        expect(source.split(LINE_BREAK).some(line => line.includes("\n") || line.includes("\r"))).toBe(false);
    });

    test("imports the engine through @jsengine/ when the project is outside the repo", () => {
        expect(mapping().source.split(LINE_BREAK)[1]).toBe(`import type {ComponentSchemaRegistry} from "@jsengine/engine/scene";`);
    });

    test("imports the engine relatively when the project is inside the repo", () => {
        const result = generateFixture(INSIDE_REPO_FIXTURE, INSIDE_REPO_FIXTURE_PREFIX);
        expect(result.source.split(LINE_BREAK).slice(1, 3)).toEqual([
            `import type {ComponentSchemaRegistry} from "../../../src/engine/scene";`,
            `import {Inside} from "./inside";`,
        ]);
    });

    test("orders registrations by file path then class name, deterministically", () => {
        const first = generateFixture(ORDER_FIXTURE);
        const second = generateFixture(ORDER_FIXTURE);
        expect(second.source).toBe(first.source);
        const registrations = first.source.split(LINE_BREAK).filter(line => line.includes("registry.register")).map(line => line.trim());
        expect(registrations).toEqual([
            `registry.registerGeneratedComponent(Middle, "Middle", []);`,
            `registry.registerGeneratedComponent(Apple, "Apple", []);`,
            `registry.registerGeneratedComponent(Zebra, "Zebra", []);`,
        ]);
    });
});
