import {describe, expect, test} from "../testing/harness";
import {Component, ComponentType, FrameLoopSettings, Resource} from "../core";
import type {Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {consoleOverride} from "../debugging";
import {originalConsole} from "../debugging/originalConsole";
import {Vec2} from "../math/types/vec";
import type {Mesh} from "../rendering/3d/mesh";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema, structFields} from "./componentSchemaBuilder";
import {DATA_ASSET_FILE_SUFFIX} from "./dataAssetDocument";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import type {FieldSchema, FieldTypeDefinition} from "./fieldSchema";
import type {PrefabAsset} from "./prefabAsset";

const CURVE_TYPE_NAME = "Curve";
const PERCENT_TYPE_NAME = "Percent";
const COUNT_TYPE_NAME = "Count";
const PERCENT_OPTIONS = {min: 0, max: 1, slider: true};

class Curve {
    public keys: number[] = [];
}

const CURVE_TYPE: FieldTypeDefinition<Curve> = {
    name: CURVE_TYPE_NAME,
    encode: curve => curve.keys,
    decode: json => Object.assign(new Curve(), {keys: json as number[]}),
    defaultValue: () => new Curve(),
};

class Range {
    public min = 0;
    public max = 1;
}

class Tuning extends Resource {
    public speed = 2;
}

class Mover extends Component {
    public speed = 1;
    public chance = 0.5;
    public count = 3;
    public path: Vec2 = Vec2.alloc();
    public falloff = new Curve();
    public spread = new Range();
    public ranges: Range[] = [];
    public targets: Entity[] = [];
    public limit: number | undefined = undefined;
    public tuning: Tuning | undefined = undefined;
    public spawn: PrefabAsset | undefined = undefined;
    public model: Mesh | undefined = undefined;
}

class HandWritten extends Component {
    public static readonly schema = componentSchema(HandWritten, "HandWritten").number("speed").build();
    public speed = 1;
    public secret = 0;
}

class Plain extends Component {
    public speed = 4;
}

class Leftover extends Resource {
    public level = 1;
}

function rangeStruct(): FieldSchema {
    return {key: "spread", kind: "struct", typeName: "Range", fields: structFields<Range>().number("min").number("max").build(), create: () => new Range()};
}

function moverFields(): FieldSchema[] {
    return [
        {key: "chance", kind: "number", typeName: PERCENT_TYPE_NAME, options: {max: 2}},
        {key: "count", kind: "number", typeName: COUNT_TYPE_NAME},
        {key: "falloff", kind: "struct", typeName: CURVE_TYPE_NAME, fields: []},
        {key: "ranges", kind: "list", element: {kind: "list", element: {kind: "number", typeName: PERCENT_TYPE_NAME}}},
    ];
}

class Nested extends Component {
    public chance = 0.5;
    public count = 3;
    public falloff = new Curve();
    public ranges: number[][] = [];
}

function ignore(): void {
}

function capturedWarnings(run: () => void): string[] {
    const warnings: string[] = [];
    const methods: Record<string, (...args: unknown[]) => void> = {};
    for (const key in originalConsole) methods[key] = ignore;
    methods.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    const recorder = methods as unknown as Console;
    consoleOverride.removeConsoleEventListener(originalConsole);
    consoleOverride.addConsoleEventListener(recorder);
    try {
        run();
    } finally {
        consoleOverride.removeConsoleEventListener(recorder);
        consoleOverride.addConsoleEventListener(originalConsole);
    }
    return warnings;
}

describe("ComponentSchemaRegistry field types", () => {
    test("the builder emits the new field kinds, with mesh and spriteImage as asset sugar", () => {
        const schema = componentSchema(Mover, "Mover")
            .number("speed", {min: 0, unit: "m/s"})
            .vec2("path")
            .struct("spread", structFields<Range>().number("min").number("max").build(), {typeName: "Range", create: () => new Range()})
            .list("ranges", {kind: "struct", typeName: "Range", fields: structFields<Range>().number("min").number("max").build()})
            .list("targets", {kind: "entity", nullable: true})
            .nullableNumber("limit", {uncapped: true})
            .dataAsset("tuning", Tuning)
            .prefab("spawn")
            .mesh("model")
            .build();
        const byKey = new Map(schema.fields.map(field => [field.key, field]));
        expect(byKey.get("speed")).toEqual({key: "speed", kind: "number", options: {min: 0, unit: "m/s"}});
        expect(byKey.get("path")).toEqual({key: "path", kind: "vec2"});
        const spread = byKey.get("spread")!;
        expect(spread.kind === "struct" ? [spread.typeName, spread.fields.map(field => field.key), spread.create?.()] : []).toEqual(["Range", ["min", "max"], new Range()]);
        const ranges = byKey.get("ranges")!;
        expect(ranges.kind === "list" ? ranges.element.kind : undefined).toBe("struct");
        expect(byKey.get("targets")).toEqual({key: "targets", kind: "list", element: {kind: "entity", nullable: true}});
        expect(byKey.get("limit")).toEqual({key: "limit", kind: "number", nullable: true, uncapped: true});
        expect(byKey.get("tuning")).toEqual({key: "tuning", kind: "asset", assetType: "Tuning"});
        expect(byKey.get("spawn")).toEqual({key: "spawn", kind: "asset", assetType: "prefab"});
        expect(byKey.get("model")).toEqual({key: "model", kind: "asset", assetType: "mesh"});
        const registry = new ComponentSchemaRegistry();
        registry.registerResource(resourceSchema(Tuning, "Tuning").number("speed").build());
        registry.register(schema);
        expect(registry.byName("Mover")).toBe(schema);
    });

    test("aliases merge their options into fields with that type name; explicit options win and the kind can change", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerFieldAlias(PERCENT_TYPE_NAME, {options: PERCENT_OPTIONS});
        registry.registerFieldAlias(COUNT_TYPE_NAME, {kind: "integer", options: {min: 0}});
        registry.registerFieldType(CURVE_TYPE);
        registry.register({name: "Nested", ctor: Nested, persistence: "fields", fields: moverFields(), create: () => new Nested()});
        const fields = registry.byName("Nested")!.fields;
        expect(fields[0]).toEqual({key: "chance", kind: "number", typeName: PERCENT_TYPE_NAME, options: {min: 0, max: 2, slider: true}});
        expect(fields[1]).toEqual({key: "count", kind: "integer", typeName: COUNT_TYPE_NAME, options: {min: 0}});
        expect(fields[2]).toEqual({key: "falloff", kind: "custom", typeName: CURVE_TYPE_NAME});
        expect(fields[3]).toEqual({key: "ranges", kind: "list", element: {kind: "list", element: {kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS}}});
    });

    test("an alias that makes a field an integer rejects a fractional default", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerFieldAlias(PERCENT_TYPE_NAME, {kind: "integer", options: {}});
        registry.registerFieldType(CURVE_TYPE);
        expect(() => registry.register({name: "Nested", ctor: Nested, persistence: "fields", fields: moverFields(), create: () => new Nested()}))
            .toThrow(`field "chance" does not fit kind "integer"`);
    });

    test("a custom field naming an unregistered type throws, naming the field and the type", () => {
        const registry = new ComponentSchemaRegistry();
        const fields: FieldSchema[] = [{key: "falloff", kind: "custom", typeName: CURVE_TYPE_NAME}];
        expect(() => registry.register({name: "Nested", ctor: Nested, persistence: "fields", fields, create: () => new Nested()}))
            .toThrow(`Component schema "Nested": field "falloff" uses the custom field type "Curve", which is not registered`);
        const nested: FieldSchema[] = [{key: "ranges", kind: "list", element: {kind: "custom", typeName: CURVE_TYPE_NAME}}];
        expect(() => registry.register({name: "Nested", ctor: Nested, persistence: "fields", fields: nested, create: () => new Nested()}))
            .toThrow(`field "ranges[]" uses the custom field type "Curve"`);
        expect(registry.byName("Nested")).toBeUndefined();
    });

    test("registrations of aliases, field types and asset types validate and refuse duplicates", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerFieldType(CURVE_TYPE);
        expect(() => registry.registerFieldType(CURVE_TYPE)).toThrow(`the field type "Curve" is already registered`);
        expect(() => registry.registerFieldType({...CURVE_TYPE, name: "Broken", decode: undefined as never})).toThrow("needs encode, decode and defaultValue functions");
        registry.registerFieldAlias(PERCENT_TYPE_NAME, {options: PERCENT_OPTIONS});
        expect(() => registry.registerFieldAlias(PERCENT_TYPE_NAME, {options: {}})).toThrow(`a field alias named "Percent" is already registered`);
        expect(() => registry.registerFieldAlias("Name", {kind: "string" as never, options: {}})).toThrow("must be a number or integer");
        expect(registry.assetTypes.map(type => type.name)).toEqual(["mesh", "spriteImage", "prefab", "shader"]);
        expect(() => registry.registerAssetType({...registry.assetType("mesh")!})).toThrow(`the asset type "mesh" is already registered`);
        registry.registerAssetType({name: "sound", valueName: "Sound", fileSuffixes: [".wav"], isAsset: (value): value is string => typeof value === "string", load: path => path, pathOf: path => path});
        expect(registry.assetType("sound")!.fileSuffixes).toEqual([".wav"]);
    });

    test("a registered resource becomes a data asset type", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerResource(resourceSchema(Tuning, "Tuning").number("speed").build());
        const type = registry.assetType("Tuning")!;
        expect(type.fileSuffixes).toEqual([DATA_ASSET_FILE_SUFFIX]);
        expect(type.isAsset(new Tuning())).toBe(true);
        expect(type.isAsset(new Leftover())).toBe(false);
        expect(() => registry.registerResource(resourceSchema(Leftover, "mesh").number("level").build()))
            .toThrow(`the resource "mesh" would be a data asset type, but an asset type with that name is already registered`);
        expect(registry.resourceByName("mesh")).toBeUndefined();
    });

    test("generated registration registers fields, no-ops for registered classes and defers to a static schema", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerComponentClass(HandWritten);
        registry.registerGeneratedComponent(HandWritten, "HandWritten", [{key: "speed", kind: "number"}, {key: "secret", kind: "number"}]);
        expect(registry.byName("HandWritten")).toBe(HandWritten.schema);
        registry.registerGeneratedComponent(Plain, "Plain", [{key: "speed", kind: "number"}], {category: "Motion"});
        const plain = registry.byType(ComponentType.of(Plain))!;
        expect([plain.name, plain.category, plain.persistence, plain.inferred]).toEqual(["Plain", "Motion", "fields", false]);
        expect(plain.create()).toBeInstanceOf(Plain);
        registry.registerGeneratedComponent(Plain, "PlainAgain", []);
        expect(registry.byName("PlainAgain")).toBeUndefined();
        expect(registry.hasComponentCtor(Plain)).toBe(true);
        expect(registry.hasComponentCtor(Mover)).toBe(false);

        const fresh = new ComponentSchemaRegistry();
        fresh.registerGeneratedComponent(HandWritten, "HandWritten", [{key: "speed", kind: "number"}, {key: "secret", kind: "number"}]);
        expect(fresh.byName("HandWritten")).toBe(HandWritten.schema);
        expect(() => fresh.registerGeneratedComponent(Mover, "Mover", [{key: "sped", kind: "number"}])).toThrow(`unknown field "sped"`);

        registry.registerGeneratedResource(Leftover, "Leftover", [{key: "level", kind: "integer"}]);
        registry.registerGeneratedResource(Leftover, "LeftoverAgain", []);
        expect(registry.resourceByName("Leftover")!.create()).toBeInstanceOf(Leftover);
        expect(registry.resourceByName("LeftoverAgain")).toBeUndefined();
        expect(registry.hasResourceCtor(Leftover)).toBe(true);
        expect(registry.hasResourceCtor(Tuning)).toBe(false);
    });

    test("generated registration leaves out custom fields of unregistered types with one warning each", () => {
        const fields: FieldSchema[] = [
            {key: "speed", kind: "number"},
            {key: "falloff", kind: "custom", typeName: CURVE_TYPE_NAME},
            {key: "spread", kind: "struct", typeName: "Range", fields: [{key: "min", kind: "number"}, {key: "max", kind: "custom", typeName: "Bound"}]},
            {key: "ranges", kind: "list", element: {kind: "custom", typeName: "Span"}},
        ];
        const warnings = capturedWarnings(() => new ComponentSchemaRegistry().registerGeneratedComponent(Mover, "Mover", fields));
        expect(warnings).toEqual([
            `ComponentSchemaRegistry: left out the generated field Mover.falloff: its custom field type "Curve" is not registered (registerFieldType)`,
            `ComponentSchemaRegistry: left out the generated field Mover.spread.max: its custom field type "Bound" is not registered (registerFieldType)`,
            `ComponentSchemaRegistry: left out the generated field Mover.ranges[]: its custom field type "Span" is not registered (registerFieldType)`,
        ]);

        const registry = new ComponentSchemaRegistry();
        registry.registerFieldType(CURVE_TYPE);
        expect(capturedWarnings(() => registry.registerGeneratedComponent(Mover, "Mover", fields))).toEqual(warnings.slice(1));
        expect(registry.byName("Mover")!.fields).toEqual([
            {key: "speed", kind: "number"},
            {key: "falloff", kind: "custom", typeName: CURVE_TYPE_NAME},
            {key: "spread", kind: "struct", typeName: "Range", fields: [{key: "min", kind: "number"}]},
        ]);

        const resourceWarnings = capturedWarnings(() => registry.registerGeneratedResource(Tuning, "Tuning", [{key: "speed", kind: "custom", typeName: "Gear"}]));
        expect(resourceWarnings).toEqual([`ComponentSchemaRegistry: left out the generated field Tuning.speed: its custom field type "Gear" is not registered (registerFieldType)`]);
        expect(registry.resourceByName("Tuning")!.fields).toEqual([]);
    });

    test("generated registration of an already registered class neither validates nor warns", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerGeneratedComponent(Plain, "Plain", [{key: "speed", kind: "number"}]);
        expect(capturedWarnings(() => registry.registerGeneratedComponent(Plain, "Plain", [{key: "speed", kind: "custom", typeName: "Gear"}]))).toEqual([]);
    });

    test("nested shapes are validated with their paths", () => {
        const registry = new ComponentSchemaRegistry();
        const twice: FieldSchema[] = [{key: "spread", kind: "struct", fields: [{key: "min", kind: "number"}, {key: "min", kind: "number"}]}];
        expect(() => registry.register({name: "Mover", ctor: Mover, persistence: "fields", fields: twice, create: () => new Mover()})).toThrow(`field "spread.min" is listed twice`);
        const noAssetType: FieldSchema[] = [{key: "model", kind: "asset", assetType: ""}];
        expect(() => registry.register({name: "Mover", ctor: Mover, persistence: "fields", fields: noAssetType, create: () => new Mover()})).toThrow(`asset field "model" needs a non-empty assetType`);
        const stringTargets: FieldSchema[] = [rangeStruct(), {key: "targets", kind: "list", element: {kind: "string", nullable: false}}];
        expect(() => registry.register({name: "Mover", ctor: Mover, persistence: "fields", fields: stringTargets, create: () => new Mover()})).not.toThrow();
        const unfit = new Mover();
        unfit.targets = [NULL_ENTITY];
        expect(() => new ComponentSchemaRegistry().register({name: "Mover", ctor: Mover, persistence: "fields", fields: stringTargets, create: () => unfit}))
            .toThrow(`field "targets" does not fit kind "list": Scene field Mover.targets[0]: expected a string`);
    });

    test("the engine registers FrameLoopSettings as a Settings component with uncapped rates", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        const schema = registry.byType(ComponentType.of(FrameLoopSettings))!;
        expect(schema.category).toBe("Settings");
        expect(schema.fields).toEqual([
            {key: "simulationTickRate", kind: "number"},
            {key: "renderRate", kind: "number", uncapped: true},
            {key: "matchDisplay", kind: "boolean"},
            {key: "cpuRenderRateLimit", kind: "number", uncapped: true},
            {key: "maxCatchUpTicks", kind: "integer"},
        ]);
    });
});
