import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {Component, Resource, World} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {Vec2} from "../../engine/math/types/vec";
import type {Mesh} from "../../engine/rendering/3d/mesh";
import {
    ACTIVE_SCENE_RESOURCE_NAME,
    ComponentSchemaRegistry,
    componentSchema,
    ENGINE_COMPONENT_CATEGORIES,
    registerSchemaEntries,
    resourceSchema,
    SCENE_INSTANCE_COMPONENT_NAME,
    SCENE_MANAGER_SCHEMAS,
    structFields,
} from "../../engine/scene";
import type {FieldTypeDefinition, PrefabAsset} from "../../engine/scene";
import {describeSchemas, entityDetails} from "./entityInspection";

class Range {
    public min = 0;
    public max = 1;
}

class Curve {
    public keys: number[] = [];
}

const CURVE_TYPE: FieldTypeDefinition<Curve> = {
    name: "Curve",
    encode: curve => curve.keys,
    decode: json => Object.assign(new Curve(), {keys: json as number[]}),
    defaultValue: () => new Curve(),
};

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed", {min: 0, unit: "m/s"}).build();
    public speed = 1;
}

class Everything extends Component {
    public static readonly schema = componentSchema(Everything, "Everything")
        .nullableNumber("limit", {uncapped: true, typeName: "Seconds"})
        .vec2("offset")
        .list("targets", {kind: "entity", nullable: true})
        .struct("spread", structFields<Range>().number("min").number("max").build(), {typeName: "Range", create: () => new Range()})
        .struct("falloff", [], {typeName: "Curve"})
        .mesh("model")
        .prefab("spawn")
        .dataAsset("tuning", Tuning)
        .build();

    public limit: number | undefined = undefined;
    public offset: Vec2 = Vec2.alloc();
    public targets: Entity[] = [NULL_ENTITY];
    public spread = new Range();
    public falloff = new Curve();
    public model: Mesh | undefined = undefined;
    public spawn: PrefabAsset | undefined = undefined;
    public tuning: Tuning | undefined = undefined;
}

class Lists extends Component {
    public static readonly schema = componentSchema(Lists, "Lists")
        .list("numbers", {kind: "number"})
        .list("optional", {kind: "integer", nullable: true})
        .list("points", {kind: "vec2"})
        .list("ranges", {kind: "struct", typeName: "Range", fields: structFields<Range>().number("min").number("max").build(), create: () => new Range()})
        .list("curves", {kind: "custom", typeName: "Curve"})
        .list("meshes", {kind: "asset", assetType: "mesh"})
        .list("grid", {kind: "list", element: {kind: "integer"}})
        .build();

    public numbers: number[] = [];
    public optional: (number | undefined)[] = [];
    public points: Vec2[] = [];
    public ranges: Range[] = [];
    public curves: Curve[] = [];
    public meshes: (Mesh | undefined)[] = [];
    public grid: number[][] = [];
}

class MaybeSpread extends Component {
    public static readonly schema = componentSchema(MaybeSpread, "MaybeSpread")
        .nullableStruct("spread", structFields<Range>().number("min").number("max").build(), {typeName: "Range", create: () => new Range()})
        .build();

    public spread: Range | undefined = undefined;
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    result.registerFieldType(CURVE_TYPE);
    result.registerResourceClass(Tuning);
    result.registerComponentClass(Everything);
    return result;
}

describe("editor field descriptions", () => {
    test("describe the recursive field types as JSON, without functions", () => {
        const world = new World({platform: new MemoryPlatform()});
        const described = describeSchemas(world, registry());
        const everything = described.components.find(component => component.typeName === "Everything")!;
        expect(everything.fields).toEqual([
            {key: "limit", kind: "number", nullable: true, uncapped: true, typeName: "Seconds"},
            {key: "offset", kind: "vec2"},
            {key: "targets", kind: "list", element: {kind: "entity", nullable: true}, elementDefault: null},
            {key: "spread", kind: "struct", typeName: "Range", fields: [{key: "min", kind: "number"}, {key: "max", kind: "number"}]},
            {key: "falloff", kind: "custom", typeName: "Curve"},
            {key: "model", kind: "asset", assetType: "mesh"},
            {key: "spawn", kind: "asset", assetType: "prefab"},
            {key: "tuning", kind: "asset", assetType: "Tuning"},
        ]);
        expect(described.resources).toEqual([{typeName: "Tuning", fields: [{key: "speed", kind: "number", options: {min: 0, unit: "m/s"}}]}]);
        expect(JSON.parse(JSON.stringify(described))).toEqual(described);
    });

    test("a list carries its element's encoded default, so the page can add rows of any kind", () => {
        const world = new World({platform: new MemoryPlatform()});
        const schemas = registry();
        schemas.registerComponentClass(Lists);
        const lists = describeSchemas(world, schemas).components.find(component => component.typeName === "Lists")!;
        const defaults = Object.fromEntries(lists.fields.map(field => [field.key, field.kind === "list" ? field.elementDefault : undefined]));
        expect(defaults).toEqual({
            numbers: 0,
            optional: null,
            points: [0, 0],
            ranges: {min: 0, max: 1},
            curves: [],
            meshes: null,
            grid: [],
        });
        const grid = lists.fields.find(field => field.key === "grid")!;
        expect(grid.kind === "list" && grid.element.kind === "list" ? grid.element.elementDefault : undefined).toBe(0);
    });

    test("a nullable struct carries the encoded value it starts from when it gets one", () => {
        const world = new World({platform: new MemoryPlatform()});
        const schemas = registry();
        schemas.registerComponentClass(MaybeSpread);
        const described = describeSchemas(world, schemas).components.find(component => component.typeName === "MaybeSpread")!;
        expect(described.fields).toEqual([{
            key: "spread",
            kind: "struct",
            nullable: true,
            typeName: "Range",
            fields: [{key: "min", kind: "number"}, {key: "max", kind: "number"}],
            presentDefault: {min: 0, max: 1},
        }]);
        const entity = world.entityManager.createEntity("maybe", [new MaybeSpread()]);
        expect(entityDetails(world, schemas, entity).components[0].fields.spread).toBe(null);
    });

    test("the active scene resource is described in the Scene category, like SceneInstance", () => {
        const world = new World({platform: new MemoryPlatform()});
        const schemas = new ComponentSchemaRegistry();
        registerSchemaEntries(schemas, SCENE_MANAGER_SCHEMAS);
        const described = describeSchemas(world, schemas);
        expect(described.resources.find(resource => resource.typeName === ACTIVE_SCENE_RESOURCE_NAME)?.category).toBe(ENGINE_COMPONENT_CATEGORIES.scene);
        expect(described.components.find(component => component.typeName === SCENE_INSTANCE_COMPONENT_NAME)?.category).toBe(ENGINE_COMPONENT_CATEGORIES.scene);
    });

    test("entity details encode nested and custom values through the registry", () => {
        const world = new World({platform: new MemoryPlatform()});
        const schemas = registry();
        const component = new Everything();
        component.falloff.keys = [0, 1];
        const entity = world.entityManager.createEntity("everything", [component]);
        component.targets = [entity];
        const fields = entityDetails(world, schemas, entity).components[0].fields;
        expect(fields.targets).toEqual([entity]);
        expect(fields.falloff).toEqual([0, 1]);
        expect(fields.spread).toEqual({min: 0, max: 1});
        expect(fields.limit).toBe(null);
    });
});
