import {describe, expect, test} from "../testing/harness";
import {Component, ComponentType} from "../core";
import {componentSchema, fieldAlias} from "../scene";
import type {ComponentSchemaRegistry} from "../scene";
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
    test("registers engine, then backends, then the schema entries", () => {
        const order: string[] = [];
        const registry = createProjectSchemaRegistry({
            backendSchemas: [backendRegistry => {
                order.push(`backend after ${backendRegistry.byName("LocalPosition") === undefined ? "nothing" : "engine"}`);
                backendRegistry.register(componentSchema(Foot, "Backend").build());
            }],
            schemas: [
                {kind: "componentClass", ctor: Hand},
                {kind: "fieldAlias", typeName: PERCENT_TYPE_NAME, alias: fieldAlias(PERCENT_OPTIONS)},
            ],
        });
        expect(order).toEqual(["backend after engine"]);
        expect(registeredNames(registry).indexOf("Backend") < registeredNames(registry).indexOf("Hand")).toBe(true);
        expect(registry.byType(ComponentType.of(Hand))!.fields).toEqual([{key: "grip", kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS}]);
    });

    test("schema entries alone register the project's classes", () => {
        const registry = createProjectSchemaRegistry({
            schemas: [{kind: "component", ctor: Foot, name: "Foot", fields: [{key: "step", kind: "number"}]}],
        });
        expect(registry.byName("Foot")!.create()).toBeInstanceOf(Foot);
        expect(registry.byName("LocalPosition")).toBeDefined();
        expect(createProjectSchemaRegistry().byName("Foot")).toBeUndefined();
    });
});
