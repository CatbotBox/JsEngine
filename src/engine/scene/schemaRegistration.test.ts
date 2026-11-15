import {describe, expect, test} from "../testing/harness";
import {Component, Resource} from "../core";
import {Vec} from "../math/types/vec";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema, resourceSchema} from "./componentSchemaBuilder";
import {DEFAULT_COMPONENT_CATEGORY} from "./fieldSchema";
import type {ResourceSchema} from "./fieldSchema";
import {assignInferredFieldValue, inferComponentSchema} from "./inferredSchema";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";

class Spinner extends Component {
    public static readonly schema = componentSchema(Spinner, "Spinner").number("speed").boolean("clockwise").category("Motion").build();
    public speed = 1;
    public clockwise = true;
}

class FastSpinner extends Spinner {
}

class Hover extends Component {
    public height = 2;
}

class Borrowed extends Component {
    public static readonly schema = componentSchema(Hover, "Hover").number("height").build();
}

class Scoreboard extends Resource {
    public static readonly schema = resourceSchema(Scoreboard, "Scoreboard").integer("wave").string("title").build();
    public wave = 1;
    public title = "swarm";
}

class Untyped extends Resource {
}

class Loose extends Component {
    public speed = 3;
    public label = "loose";
    public visible = false;
    public offset = [1, 2, 3];
    public spin = new Float32Array([0, 0, 0, 1]);
    public tags = ["a", "b"];
    public pair = [1, 2];
    public nothing: object | undefined = undefined;
}

describe("component classes with a static schema", () => {
    test("registerComponentClass registers the class's own static schema with its category", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerComponentClass(Spinner);
        expect(registry.byName("Spinner")!.ctor).toBe(Spinner);
        expect(registry.byName("Spinner")!.category).toBe("Motion");
        expect(registry.byName("Spinner")!.fields.map(field => field.key)).toEqual(["speed", "clockwise"]);
    });

    test("a class without a static schema of its own, or with one describing another class, throws naming it", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.registerComponentClass(Hover)).toThrow("Hover declares no static schema of its own");
        expect(() => registry.registerComponentClass(FastSpinner)).toThrow("FastSpinner declares no static schema of its own");
        expect(() => registry.registerComponentClass(Borrowed)).toThrow("Borrowed.schema describes Hover, not Borrowed");
    });

    test("registerComponentClasses registers a list and builder schemas default to the game category", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerComponentClasses([Spinner]);
        registry.register(componentSchema(Hover, "Hover").number("height").build());
        expect(registry.schemas.map(schema => schema.name)).toEqual(["Spinner", "Hover"]);
        expect(registry.byName("Hover")!.category).toBe(DEFAULT_COMPONENT_CATEGORY);
    });

    test("engine schemas carry categories", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        expect(["LocalPosition", "Camera", "Sprite", "RenderMesh", "PointLight", "PrefabInstance"].map(name => registry.byName(name)!.category))
            .toEqual(["Transform", "Camera", "Rendering 2D", "Rendering 3D", "Lighting", "Prefab"]);
    });
});

describe("resource schemas", () => {
    test("register by schema or by class, look up by name and class", () => {
        const registry = new ComponentSchemaRegistry();
        registry.registerResourceClass(Scoreboard);
        expect(registry.resourceByName("Scoreboard")!.ctor).toBe(Scoreboard);
        expect(registry.resourceByCtor(Scoreboard)!.fields.map(field => field.kind)).toEqual(["integer", "string"]);
        expect(registry.resourceSchemas.length).toBe(1);
    });

    test("a resource class without a static schema, a duplicate and an unknown field throw", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.registerResourceClass(Untyped)).toThrow("Untyped declares no static schema of its own");
        registry.registerResource(Scoreboard.schema);
        expect(() => registry.registerResource(resourceSchema(Scoreboard, "Scoreboard").build())).toThrow(`a resource schema named "Scoreboard" is already registered`);
        expect(() => registry.registerResource(resourceSchema(Scoreboard, "Other").build())).toThrow(`Scoreboard is already registered as "Scoreboard"`);
        const typo = {name: "Typo", ctor: Untyped, fields: [{key: "wave", kind: "integer"}], create: () => new Untyped()} as ResourceSchema<Untyped>;
        expect(() => registry.registerResource(typo)).toThrow(`Resource schema "Typo": unknown field "wave"`);
    });
});

describe("inferred component schemas", () => {
    test("own number, boolean, string and 3- or 4-number array fields become an inferred schema", () => {
        const schema = inferComponentSchema(new Loose());
        expect(schema.name).toBe("Loose");
        expect(schema.inferred).toBe(true);
        expect(schema.category).toBe(DEFAULT_COMPONENT_CATEGORY);
        expect(schema.fields).toEqual([
            {key: "speed", kind: "number"},
            {key: "label", kind: "string", nullable: false},
            {key: "visible", kind: "boolean"},
            {key: "offset", kind: "vec3"},
            {key: "spin", kind: "rotation"},
        ]);
        expect(schema.create()).toBeInstanceOf(Loose);
    });

    test("assigning an inferred vector writes into the existing array instead of replacing it", () => {
        const loose = new Loose();
        const offset = loose.offset;
        const spin = loose.spin;
        const schema = inferComponentSchema(loose);
        assignInferredFieldValue(loose, schema.fields[3], Vec.alloc3(7, 8, 9));
        assignInferredFieldValue(loose, schema.fields[4], [0, 1, 0, 0]);
        assignInferredFieldValue(loose, schema.fields[0], 5);
        expect(loose.offset).toBe(offset);
        expect(loose.offset).toEqual([7, 8, 9]);
        expect(Array.isArray(loose.offset)).toBe(true);
        expect(loose.spin).toBe(spin);
        expect(Array.from(loose.spin)).toEqual([0, 1, 0, 0]);
        expect(loose.speed).toBe(5);
    });
});
