import {describe, expect, test} from "../testing/harness";
import {Component, ComponentType} from "../core";
import {componentSchema, ENGINE_SCHEMAS, fieldAlias} from "../scene";
import type {ComponentSchemaRegistry} from "../scene";
import {LOCAL_POSITION_SCHEMA_ENTRY} from "../translation/schemas";
import {createProjectSchemaRegistry} from "./projectSchemas";

const PERCENT_TYPE_NAME = "Percent";
const PERCENT_OPTIONS = {min: 0, max: 1};

class Hand extends Component {
    public static readonly schema = componentSchema(Hand, "Hand").number("grip", {typeName: PERCENT_TYPE_NAME}).build();
    public grip = 0.5;
}

class Foot extends Component {
    public step = 0.25;
}

function registeredNames(registry: ComponentSchemaRegistry): string[] {
    return registry.schemas.map(schema => schema.name);
}

describe("createProjectSchemaRegistry", () => {
    test("registers the host's entries, then the schema entries, then what the scene manager needs", () => {
        const registry = createProjectSchemaRegistry({
            hostSchemas: [{kind: "componentSchema", build: () => componentSchema(Foot, "Backend").build()}],
            schemas: [
                {kind: "componentClass", ctor: Hand},
                {kind: "fieldAlias", typeName: PERCENT_TYPE_NAME, alias: fieldAlias(PERCENT_OPTIONS)},
            ],
        });
        expect(registeredNames(registry)).toEqual(["Backend", "Hand", "SceneInstance"]);
        expect(registry.resourceByName("ActiveScene")).toBeDefined();
        expect(registry.byType(ComponentType.of(Hand))!.fields).toEqual([{key: "grip", kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS}]);
    });

    test("schema entries alone register the project's classes and only the engine schemas they list", () => {
        const registry = createProjectSchemaRegistry({
            schemas: [{kind: "component", ctor: Foot, name: "Foot", fields: [{key: "step", kind: "number"}]}],
        });
        expect(registry.byName("Foot")!.create()).toBeInstanceOf(Foot);
        expect(registry.byName("LocalPosition")).toBeUndefined();
        expect(createProjectSchemaRegistry().byName("Foot")).toBeUndefined();
    });

    test("an engine entry the host and the schema list both carry registers once", () => {
        const registry = createProjectSchemaRegistry({hostSchemas: ENGINE_SCHEMAS, schemas: [LOCAL_POSITION_SCHEMA_ENTRY]});
        expect(registeredNames(registry).filter(name => name === "LocalPosition")).toEqual(["LocalPosition"]);
        expect(registeredNames(registry)).toEqual(registeredNames(createProjectSchemaRegistry({hostSchemas: ENGINE_SCHEMAS})));
    });
});
