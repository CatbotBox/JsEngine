import {describe, expect, test} from "../../../testing/harness";
import {MemoryPlatform} from "../../../testing/memoryPlatform";
import {ComponentType, World} from "../../../core";
import type {Component, ComponentCtor} from "../../../core";
import {ComponentSchemaRegistry} from "../../../scene/componentSchemaRegistry";
import {ENGINE_COMPONENT_CATEGORIES, registerEngineComponentSchemas} from "../../../scene/engineComponentSchemas";
import {deserializeInto, serializeWorld} from "../../../scene/sceneSerialization";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../../scene/sceneDocument";
import {SpotLight, WIDEST_SPOT_CONE_ANGLE} from "./spotLight";
import {SphereAreaLight} from "./sphereAreaLight";
import {TubeAreaLight} from "./tubeAreaLight";
import {RectAreaLight} from "./rectAreaLight";
import {HemisphereLight} from "./hemisphereLight";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";

interface SchemaCase {
    readonly name: string;
    readonly type: ComponentCtor<Component>;
    readonly fields: readonly string[];
    readonly component: () => Component;
    readonly json: Readonly<Record<string, unknown>>;
}

const SCHEMA_CASES: readonly SchemaCase[] = [
    {
        name: "SpotLight", type: SpotLight, fields: ["range", "innerConeAngle", "outerConeAngle", "color", "intensity", "castsShadows"],
        component: () => Object.assign(new SpotLight(12, 0.25, 0.5, 0xFFD9A0, 2), {castsShadows: true}),
        json: {range: 12, innerConeAngle: 0.25, outerConeAngle: 0.5, color: "#ffd9a0", intensity: 2, castsShadows: true},
    },
    {
        name: "SphereAreaLight", type: SphereAreaLight, fields: ["range", "radius", "color", "intensity", "castsShadows"],
        component: () => new SphereAreaLight(8, 0.5, 0xFF8040, 1.5),
        json: {range: 8, radius: 0.5, color: "#ff8040", intensity: 1.5, castsShadows: false},
    },
    {
        name: "TubeAreaLight", type: TubeAreaLight, fields: ["range", "length", "radius", "color", "intensity", "castsShadows"],
        component: () => Object.assign(new TubeAreaLight(9, 4, 0.125, 0x60D0FF, 1.25), {castsShadows: true}),
        json: {range: 9, length: 4, radius: 0.125, color: "#60d0ff", intensity: 1.25, castsShadows: true},
    },
    {
        name: "RectAreaLight", type: RectAreaLight, fields: ["range", "width", "height", "color", "intensity", "castsShadows"],
        component: () => new RectAreaLight(7, 3, 1.5, 0xF0F0FF, 0.75),
        json: {range: 7, width: 3, height: 1.5, color: "#f0f0ff", intensity: 0.75, castsShadows: false},
    },
    {
        name: "HemisphereLight", type: HemisphereLight, fields: ["skyColor", "groundColor", "intensity"],
        component: () => new HemisphereLight(0x9EC8FF, 0x5A4030, 0.5),
        json: {skyColor: "#9ec8ff", groundColor: "#5a4030", intensity: 0.5},
    },
    {
        name: "DirectionalLight", type: DirectionalLight, fields: ["color", "intensity", "castsShadows"],
        component: () => Object.assign(new DirectionalLight(0xFFF4E0, 0.9), {castsShadows: false}),
        json: {color: "#fff4e0", intensity: 0.9, castsShadows: false},
    },
    {
        name: "PointLight", type: PointLight, fields: ["range", "color", "intensity", "castsShadows"],
        component: () => Object.assign(new PointLight(14, 0x4FA3F7, 1.2), {castsShadows: true}),
        json: {range: 14, color: "#4fa3f7", intensity: 1.2, castsShadows: true},
    },
];

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

describe("light schemas", () => {
    test("the engine registers each as a Lighting component with its fields", () => {
        const registry = engineRegistry();
        for (const schemaCase of SCHEMA_CASES) {
            const schema = registry.byType(ComponentType.of(schemaCase.type))!;
            expect([schema.name, schema.category]).toEqual([schemaCase.name, ENGINE_COMPONENT_CATEGORIES.lighting]);
            expect(schema.fields.map(field => field.key)).toEqual([...schemaCase.fields]);
            expect(registry.byName(schemaCase.name)).toBe(schema);
        }
    });

    test("each round-trips explicit values through scene JSON into another world", () => {
        const registry = engineRegistry();
        const source = newWorld();
        for (const schemaCase of SCHEMA_CASES) source.entityManager.createEntity(schemaCase.name, [schemaCase.component()]);
        const saved = serializeWorld(source, registry);
        expect(saved.document.entities.map(record => record.components)).toEqual(SCHEMA_CASES.map(schemaCase => ({[schemaCase.name]: schemaCase.json})));

        const target = newWorld();
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        SCHEMA_CASES.forEach((schemaCase, index) => {
            const component = target.entityManager.getComponent<Component>(loaded.entities[index], schemaCase.type);
            expect(component instanceof schemaCase.type).toBe(true);
        });
        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });

    test("values loaded from a scene go through the same clamps as code", () => {
        const registry = engineRegistry();
        const document = parseSceneDocument({
            format: SCENE_DOCUMENT_FORMAT,
            version: SCENE_DOCUMENT_VERSION,
            entities: [
                {id: 1, name: "spot", enabled: true, components: {SpotLight: {range: -3, innerConeAngle: -1, outerConeAngle: 9}}},
                {id: 2, name: "tube", enabled: true, components: {TubeAreaLight: {length: -2, radius: -1}}},
            ],
        });
        const world = newWorld();
        const loaded = deserializeInto(world, registry, document);
        const spot = world.entityManager.getComponent<SpotLight>(loaded.entities[0], SpotLight)!;
        expect([spot.range, spot.innerConeAngle, spot.outerConeAngle]).toEqual([0, 0, WIDEST_SPOT_CONE_ANGLE]);
        const tube = world.entityManager.getComponent<TubeAreaLight>(loaded.entities[1], TubeAreaLight)!;
        expect([tube.length, tube.radius]).toEqual([0, 0]);
    });

    test("a scene written before castsShadows existed loads with directional lights casting and the others not, and is saved with the field", () => {
        const registry = engineRegistry();
        const document = parseSceneDocument({
            format: SCENE_DOCUMENT_FORMAT,
            version: SCENE_DOCUMENT_VERSION,
            entities: [
                {id: 1, name: "sun", enabled: true, components: {DirectionalLight: {color: "#fff4e0", intensity: 0.9}}},
                {id: 2, name: "lamp", enabled: true, components: {PointLight: {range: 14, color: "#4fa3f7", intensity: 1.2}}},
                {id: 3, name: "spot", enabled: true, components: {SpotLight: {range: 12}}},
                {id: 4, name: "rect", enabled: true, components: {RectAreaLight: {range: 7}}},
            ],
        });
        const world = newWorld();
        const loaded = deserializeInto(world, registry, document);
        const types: readonly ComponentCtor<Component & {castsShadows: boolean}>[] = [DirectionalLight, PointLight, SpotLight, RectAreaLight];
        expect(types.map((type, index) => world.entityManager.getComponent<Component & {castsShadows: boolean}>(loaded.entities[index], type)!.castsShadows)).toEqual([true, false, false, false]);
        const saved = serializeWorld(world, registry).document.entities.map(record => Object.values(record.components)[0] as Record<string, unknown>);
        expect(saved.map(fields => fields.castsShadows)).toEqual([true, false, false, false]);
    });
});
