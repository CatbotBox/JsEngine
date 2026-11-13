import {describe, expect, test} from "../testing/harness";
import {Component, ComponentType} from "../core";
import {LocalPosition} from "../translation/localPosition";
import {LocalToWorld} from "../translation/localToWorld";
import {Parent} from "../translation/parent";
import {Children} from "../translation/children";
import {TextSprite} from "../rendering/textSprite";
import {ScreenAnchor} from "../rendering/screenAnchor";
import {RenderMesh} from "../rendering/3d/renderMesh";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {componentSchema} from "./componentSchemaBuilder";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import type {ComponentSchema, FieldSchema} from "./fieldSchema";

class Tunable extends Component {
    public speed: number = 1;
    public label: string = "tunable";
    private _hidden: number = 0;

    public get readOnlyTotal(): number {
        return this.speed + this._hidden;
    }
}

class Untouched extends Component {
}

function handWritten(name: string, fields: FieldSchema[], overrides: Partial<ComponentSchema<Tunable>> = {}): ComponentSchema<Tunable> {
    return {name, ctor: Tunable, persistence: "fields", fields, create: () => new Tunable(), ...overrides};
}

describe("ComponentSchemaRegistry", () => {
    test("registers the engine schemas in order and finds them by name and by component type", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        const names = registry.schemas.map(schema => schema.name);
        expect(names.slice(0, 4)).toEqual(["LocalPosition", "LocalRotation", "LocalScale", "Parent"]);
        expect(registry.byName("TextSprite")!.ctor).toBe(TextSprite);
        expect(registry.byType(ComponentType.of(LocalPosition))!.name).toBe("LocalPosition");
        expect(registry.byName("LocalToWorld")!.persistence).toBe("presenceOnly");
        expect(registry.byType(ComponentType.of(Children))!.persistence).toBe("implied");
        expect(registry.byType(ComponentType.of(Untouched))).toBeUndefined();
        expect(registry.indexOf(registry.byName("LocalScale")!)).toBe(2);
    });

    test("the engine schemas describe their fields", () => {
        const registry = new ComponentSchemaRegistry();
        registerEngineComponentSchemas(registry);
        expect(registry.byName("Parent")!.fields).toEqual([{key: "entity", kind: "entity", nullable: false}]);
        expect(registry.byName("Parent")!.create()).toBeInstanceOf(Parent);
        expect(registry.byName("TextSprite")!.fields.map(field => field.kind)).toEqual(["textLines", "string", "textColor", "textColor"]);
        const faceCulling = registry.byType(ComponentType.of(RenderMesh))!.fields.find(field => field.key === "faceCulling")!;
        expect(faceCulling).toEqual({key: "faceCulling", kind: "enum", members: [
            {name: "BackFaces", value: 0},
            {name: "FrontFaces", value: 1},
            {name: "None", value: 2},
        ]});
        const anchor = registry.byType(ComponentType.of(ScreenAnchor))!.fields[0];
        expect(anchor.kind === "enum" ? anchor.members.length : 0).toBe(9);
    });

    test("a duplicate name throws", () => {
        const registry = new ComponentSchemaRegistry();
        registry.register(componentSchema(Tunable, "Tunable").number("speed").build());
        expect(() => registry.register(componentSchema(Untouched, "Tunable").build())).toThrow(`a schema named "Tunable" is already registered`);
    });

    test("registering one component class under two names throws", () => {
        const registry = new ComponentSchemaRegistry();
        registry.register(componentSchema(Tunable, "Tunable").build());
        expect(() => registry.register(componentSchema(Tunable, "TunableAgain").build())).toThrow(`Tunable is already registered as "Tunable"`);
    });

    test("unknown field keys throw, naming every one", () => {
        const registry = new ComponentSchemaRegistry();
        const schema = handWritten("Typos", [{key: "sped", kind: "number"}, {key: "speed", kind: "number"}, {key: "lable", kind: "string", nullable: false}]);
        expect(() => registry.register(schema)).toThrow(`unknown fields "sped", "lable"`);
        expect(registry.byName("Typos")).toBeUndefined();
    });

    test("a getter without a setter throws", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.register(handWritten("ReadOnly", [{key: "readOnlyTotal", kind: "number"}]))).toThrow(`field "readOnlyTotal" has a getter but no setter`);
    });

    test("a created value that does not fit its kind throws", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.register(handWritten("WrongKind", [{key: "label", kind: "vec3"}]))).toThrow(`field "label" does not fit kind "vec3"`);
        expect(() => registry.register(handWritten("WrongEnum", [{key: "speed", kind: "enum", members: [{name: "Slow", value: 0}]}]))).toThrow(`field "speed" does not fit kind "enum"`);
    });

    test("duplicate fields, unknown kinds and bad enums throw", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.register(handWritten("Twice", [{key: "speed", kind: "number"}, {key: "speed", kind: "integer"}]))).toThrow(`field "speed" is listed twice`);
        expect(() => registry.register(handWritten("Unknown", [{key: "speed", kind: "complex"} as unknown as FieldSchema]))).toThrow(`unknown kind "complex"`);
        expect(() => registry.register(handWritten("Empty", [{key: "speed", kind: "enum", members: []}]))).toThrow("has no members");
        expect(() => registry.register(handWritten("Same", [{key: "speed", kind: "enum", members: [{name: "One", value: 1}, {name: "Uno", value: 1}]}]))).toThrow("repeats the value 1");
    });

    test("presenceOnly and implied schemas may not list fields", () => {
        const registry = new ComponentSchemaRegistry();
        expect(() => registry.register(handWritten("Presence", [{key: "speed", kind: "number"}], {persistence: "presenceOnly"}))).toThrow(`is presenceOnly and must not list fields ("speed")`);
        expect(() => registry.register(handWritten("Implied", [{key: "speed", kind: "number"}], {persistence: "implied"}))).toThrow(`is implied and must not list fields ("speed")`);
        registry.register(componentSchema(LocalToWorld, "LocalToWorld").presenceOnly().build());
        expect(registry.byName("LocalToWorld")!.fields).toEqual([]);
    });

    test("create() must return the schema's component class", () => {
        const registry = new ComponentSchemaRegistry();
        const schema = handWritten("Impostor", [], {create: () => new Untouched() as unknown as Tunable});
        expect(() => registry.register(schema)).toThrow("create() must return a Tunable");
    });

    test("an empty name throws", () => {
        expect(() => new ComponentSchemaRegistry().register(componentSchema(Tunable, "").build())).toThrow("name must be a non-empty string");
    });
});
