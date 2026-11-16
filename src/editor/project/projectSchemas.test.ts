import {describe, expect, test} from "../../engine/testing/harness";
import {Component, ComponentType} from "../../engine/core";
import {componentSchema} from "../../engine/scene";
import type {ComponentSchemaRegistry} from "../../engine/scene";
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
    test("registers engine, then backends, then the project, then generated schemas", () => {
        const order: string[] = [];
        const registry = createProjectSchemaRegistry({
            registerProjectSchemas: projectRegistry => {
                order.push(`project after ${registeredNames(projectRegistry).includes("Backend") ? "backend" : "nothing"}`);
                projectRegistry.registerFieldAlias(PERCENT_TYPE_NAME, {options: PERCENT_OPTIONS});
                projectRegistry.registerComponentClass(Hand);
            },
        }, {
            backendSchemas: [backendRegistry => {
                order.push(`backend after ${backendRegistry.byName("LocalPosition") === undefined ? "nothing" : "engine"}`);
                backendRegistry.register(componentSchema(Foot, "Backend").build());
            }],
            generated: {
                registerGeneratedSchemas: generatedRegistry => {
                    order.push("generated");
                    generatedRegistry.registerGeneratedComponent(Hand, "Hand", [{key: "grip", kind: "number"}]);
                },
            },
        });
        expect(order).toEqual(["backend after engine", "project after backend", "generated"]);
        expect(registry.byType(ComponentType.of(Hand))!.fields).toEqual([{key: "grip", kind: "number", typeName: PERCENT_TYPE_NAME, options: PERCENT_OPTIONS}]);
    });

    test("registerProjectSchemas is optional; generated schemas alone register the project's classes", () => {
        const registry = createProjectSchemaRegistry({}, {
            generated: {registerGeneratedSchemas: generated => generated.registerGeneratedComponent(Foot, "Foot", [{key: "step", kind: "number"}])},
        });
        expect(registry.byName("Foot")!.create()).toBeInstanceOf(Foot);
        expect(registry.byName("LocalPosition")).toBeDefined();
        expect(createProjectSchemaRegistry({}).byName("Foot")).toBeUndefined();
    });
});
