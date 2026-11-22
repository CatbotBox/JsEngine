import {describe, expect, test} from "../testing/harness";
import {Component, ComponentType, Resource} from "../core";
import type {AssetType} from "./assetTypes";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema} from "./componentSchemaBuilder";
import {fieldAlias} from "./fieldSchema";
import type {SceneJsonValue} from "./sceneDocument";
import {registerSchemaEntries} from "./schemaEntries";
import type {SchemaEntry} from "./schemaEntries";

const PERCENT_TYPE_NAME = "Percent";
const COUNT_TYPE_NAME = "Count";
const GRADIENT_TYPE_NAME = "Gradient";
const PERCENT_OPTIONS = {min: 0, max: 1};
const COUNT_OPTIONS = {min: 0};
const SAVED_GRADIENT = [2, 7];

class Gradient {
    public static readonly fieldType = {
        encode: (gradient: Gradient): SceneJsonValue => [gradient.from, gradient.to],
        decode: (json: SceneJsonValue) => new Gradient((json as number[])[0], (json as number[])[1]),
        defaultValue: () => new Gradient(0, 1),
    };

    public constructor(public readonly from: number, public readonly to: number) {
    }
}

class Patrol extends Component {
    public chance = 0.5;
    public count = 3;
    public gradient = new Gradient(0, 1);
}

class HandWritten extends Component {
    public static readonly schema = componentSchema(HandWritten, "HandWritten").number("chance", {typeName: PERCENT_TYPE_NAME}).build();
    public chance = 0.5;
}

class Jukebox extends Component {
    public song = "intro.wav";
}

class Settings extends Resource {
    public static readonly schema = resourceSchema(Settings, "Settings").number("volume").build();
    public volume = 1;
}

class Score extends Resource {
    public points = 0;
}

const ENTRIES: readonly SchemaEntry[] = [
    {kind: "component", ctor: Patrol, name: "Patrol", fields: [
        {key: "chance", kind: "number", typeName: PERCENT_TYPE_NAME},
        {key: "count", kind: "number", typeName: COUNT_TYPE_NAME},
        {key: "gradient", kind: "custom", typeName: GRADIENT_TYPE_NAME},
    ], category: "Combat"},
    {kind: "componentClass", ctor: HandWritten},
    {kind: "resourceClass", ctor: Settings},
    {kind: "resource", ctor: Score, name: "Score", fields: [{key: "points", kind: "integer"}]},
    {kind: "fieldAlias", typeName: PERCENT_TYPE_NAME, alias: fieldAlias(PERCENT_OPTIONS)},
    {kind: "fieldAlias", typeName: COUNT_TYPE_NAME, alias: fieldAlias(COUNT_OPTIONS, "integer")},
    {kind: "fieldType", typeName: GRADIENT_TYPE_NAME, definition: Gradient.fieldType},
];

function registered(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerSchemaEntries(registry, ENTRIES);
    return registry;
}

describe("registerSchemaEntries", () => {
    test("registers aliases and field types before the classes that use them, whatever the list order", () => {
        const fields = registered().byName("Patrol")!.fields;
        expect(fields).toEqual([
            {key: "chance", kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS},
            {key: "count", kind: "integer", typeName: COUNT_TYPE_NAME, options: COUNT_OPTIONS},
            {key: "gradient", kind: "custom", typeName: GRADIENT_TYPE_NAME},
        ]);
    });

    test("names a field type after its entry and forwards to the codec", () => {
        const gradient = registered().customFieldType(GRADIENT_TYPE_NAME)!;
        expect(gradient.name).toBe(GRADIENT_TYPE_NAME);
        expect(gradient.encode(new Gradient(2, 7), "gradient")).toEqual(SAVED_GRADIENT);
        expect(gradient.decode(SAVED_GRADIENT, "gradient")).toEqual(new Gradient(2, 7));
        expect(gradient.defaultValue()).toEqual(new Gradient(0, 1));
    });

    test("registers class entries through their own static schema", () => {
        const registry = registered();
        expect(registry.byType(ComponentType.of(HandWritten))!.fields).toEqual([{key: "chance", kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS}]);
        expect(registry.resourceByCtor(Settings)!.fields).toEqual([{key: "volume", kind: "number"}]);
    });

    test("registers generated components with their category and resources with their fields", () => {
        const registry = registered();
        expect(registry.byName("Patrol")!.category).toBe("Combat");
        expect(registry.resourceByName("Score")!.fields).toEqual([{key: "points", kind: "integer"}]);
    });
});

describe("registerSchemaEntries for engine and backend lists", () => {
    const patrolEntry: SchemaEntry = {kind: "componentSchema", build: () => componentSchema(Patrol, "Patrol").number("chance").build()};
    const settingsEntry: SchemaEntry = {kind: "resourceSchema", build: () => resourceSchema(Settings, "Settings").number("volume").build()};
    const soundType: AssetType<string> = {name: "sound", valueName: "Sound", fileSuffixes: [".wav"], isAsset: (value): value is string => typeof value === "string", load: path => path, pathOf: path => path};
    const soundEntry: SchemaEntry = {kind: "assetType", type: soundType as AssetType};

    test("builds a schema entry when it registers, and an entry listed twice registers once", () => {
        const registry = new ComponentSchemaRegistry();
        registerSchemaEntries(registry, [patrolEntry, settingsEntry, soundEntry]);
        registerSchemaEntries(registry, [patrolEntry, settingsEntry, soundEntry]);
        expect(registry.schemas.map(schema => schema.name)).toEqual(["Patrol"]);
        expect(registry.resourceSchemas.map(schema => schema.name)).toEqual(["Settings"]);
        expect(registry.assetTypes.map(type => type.name)).toEqual(["sound", "Settings"]);
    });

    test("registers asset types before the schemas whose fields load them, whatever the list order", () => {
        const holderEntry: SchemaEntry = {kind: "componentSchema", build: () => componentSchema(Jukebox, "Jukebox").asset("song", "sound").build()};
        const registry = new ComponentSchemaRegistry();
        registerSchemaEntries(registry, [holderEntry, soundEntry]);
        expect(registry.byName("Jukebox")!.fields).toEqual([{key: "song", kind: "asset", assetType: "sound"}]);
    });

    test("another schema under a registered name still fails", () => {
        const registry = new ComponentSchemaRegistry();
        registerSchemaEntries(registry, [patrolEntry]);
        expect(() => registerSchemaEntries(registry, [{kind: "componentSchema", build: () => componentSchema(HandWritten, "Patrol").build()}]))
            .toThrow(`a schema named "Patrol" is already registered`);
    });

    test("other backends' type names are carried, not registered", () => {
        const registry = new ComponentSchemaRegistry();
        registerSchemaEntries(registry, [{kind: "otherBackendTypes", names: ["SpriteCellPassSettings"]}]);
        expect(registry.isOtherBackendTypeName("SpriteCellPassSettings")).toBe(true);
        expect(registry.isOtherBackendTypeName("Mystery")).toBe(false);
        expect(registry.byName("SpriteCellPassSettings")).toBeUndefined();
    });
});

describe("fieldAlias", () => {
    test("leaves the kind out unless given", () => {
        expect(fieldAlias(PERCENT_OPTIONS)).toEqual({options: PERCENT_OPTIONS});
        expect(fieldAlias(COUNT_OPTIONS, "integer")).toEqual({kind: "integer", options: COUNT_OPTIONS});
    });
});
