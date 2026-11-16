import {describe, expect, test} from "../testing/harness";
import {makeEntityHandle, NULL_ENTITY} from "../core/entity";
import {Vec2, Vec3} from "../math/types/vec";
import {TextColor} from "../rendering/textColor";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {structFields} from "./componentSchemaBuilder";
import {createStructValue, defaultFieldValue} from "./fieldDefaults";
import type {FieldSchema, FieldType, FieldTypeDefinition} from "./fieldSchema";
import {decodeFieldValue, encodeFieldValue} from "./fieldValueCodec";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import {PrefabAsset} from "./prefabAsset";
import type {SceneAssetLoader} from "./sceneAssets";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneDocument, SceneJsonValue} from "./sceneDocument";

const PATH = "entities[0].components.Thing.value";
const KNOWN_ENTITY = makeEntityHandle(4, 1);
const KNOWN_SCENE_ID = 2;
const PREFAB_PATH = "prefabs/enemy.prefab.json";
const EMPTY_PREFAB: SceneDocument = {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []};
const KEYFRAME_SEPARATOR = " ";

class Range {
    public min = 0;
    public max = 1;
}

class Curve {
    public constructor(public readonly keys: number[] = []) {
    }
}

const CURVE_TYPE: FieldTypeDefinition<Curve> = {
    name: "Curve",
    encode: curve => curve.keys.join(KEYFRAME_SEPARATOR),
    decode: (json, path) => {
        if (typeof json !== "string") throw new Error(`${path}: a curve is a string of keys`);
        return new Curve(json.length === 0 ? [] : json.split(KEYFRAME_SEPARATOR).map(Number));
    },
    defaultValue: () => new Curve(),
};

const RANGE_FIELDS = structFields<Range>().number("min").number("max").build();

const field = {
    vec2: {key: "value", kind: "vec2"},
    nullableNumber: {key: "value", kind: "number", nullable: true},
    nullableInteger: {key: "value", kind: "integer", nullable: true},
    uncapped: {key: "value", kind: "number", uncapped: true},
    numbers: {key: "value", kind: "list", element: {kind: "number"}},
    ranges: {key: "value", kind: "list", element: {kind: "struct", typeName: "Range", fields: RANGE_FIELDS, create: () => new Range()}},
    range: {key: "value", kind: "struct", typeName: "Range", fields: RANGE_FIELDS, create: () => new Range()},
    plainRange: {key: "value", kind: "struct", fields: RANGE_FIELDS},
    curve: {key: "value", kind: "custom", typeName: "Curve"},
    prefab: {key: "value", kind: "asset", assetType: "prefab"},
    entities: {key: "value", kind: "list", element: {kind: "entity", nullable: true}},
} satisfies Record<string, FieldSchema>;

function registryWithCurve(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registry.registerFieldType(CURVE_TYPE);
    return registry;
}

function encodeContext(registry?: ComponentSchemaRegistry): FieldEncodeContext {
    return {
        sceneIdOf: entity => entity === KNOWN_ENTITY ? KNOWN_SCENE_ID : undefined,
        reportDanglingEntity: () => undefined,
        reportUnsavedAsset: () => undefined,
        fieldTypes: registry,
    };
}

function decodeContext(registry?: ComponentSchemaRegistry, assets?: SceneAssetLoader): FieldDecodeContext {
    return {
        entityOf: sceneId => sceneId === KNOWN_SCENE_ID ? KNOWN_ENTITY : undefined,
        reportDanglingEntity: () => undefined,
        fieldTypes: registry,
        assets,
    };
}

function encode(type: FieldType, value: unknown, registry?: ComponentSchemaRegistry): SceneJsonValue {
    return encodeFieldValue(type, value, encodeContext(registry), PATH);
}

function decode(type: FieldType, json: SceneJsonValue, registry?: ComponentSchemaRegistry): unknown {
    return decodeFieldValue(type, json, decodeContext(registry), PATH);
}

function prefabLoader(requested: string[]): SceneAssetLoader {
    const prefab = new PrefabAsset(PREFAB_PATH, EMPTY_PREFAB);
    return {
        loadMesh: path => {
            throw new Error(`no mesh ${path}`);
        },
        loadSpriteImage: path => {
            throw new Error(`no image ${path}`);
        },
        loadPrefab: path => {
            requested.push(path);
            return prefab;
        },
        loadDataAsset: path => {
            throw new Error(`no data asset ${path}`);
        },
    };
}

describe("field codec: new kinds", () => {
    test("vec2 saves as two numbers and loads as a Vec2", () => {
        expect(encode(field.vec2, Vec2.alloc(1.5, -2))).toEqual([1.5, -2]);
        const decoded = decode(field.vec2, [1.5, "Infinity"]) as Vec2;
        expect(decoded).toBeInstanceOf(Float32Array);
        expect(Array.from(decoded as unknown as Float32Array)).toEqual([1.5, Number.POSITIVE_INFINITY]);
        expect(() => decode(field.vec2, [1])).toThrow(`Scene field ${PATH}: expected an array of 2 numbers, got [1]`);
        expect(() => encode(field.vec2, Vec3.alloc())).toThrow(`Scene field ${PATH}: expected 2 numbers`);
    });

    test("nullable numbers and integers save undefined as null; plain ones refuse it", () => {
        expect(encode(field.nullableNumber, undefined)).toBe(null);
        expect(encode(field.nullableNumber, 2.5)).toBe(2.5);
        expect(decode(field.nullableNumber, null)).toBeUndefined();
        expect(Number.isNaN(decode(field.nullableNumber, "NaN") as number)).toBe(true);
        expect(() => encode(field.nullableNumber, "2")).toThrow(`Scene field ${PATH}: expected a number or undefined, got "2"`);
        expect(encode(field.nullableInteger, undefined)).toBe(null);
        expect(encode(field.nullableInteger, 3)).toBe(3);
        expect(decode(field.nullableInteger, null)).toBeUndefined();
        expect(() => encode(field.nullableInteger, 1.5)).toThrow(`Scene field ${PATH}: expected a whole number or undefined, got 1.5`);
        expect(() => decode(field.nullableInteger, 1.5)).toThrow(`Scene field ${PATH}: expected a whole number, got 1.5`);
        expect(() => encode({kind: "number"}, undefined)).toThrow(`Scene field ${PATH}: expected a number, got nothing`);
        expect(() => decode({kind: "number"}, null)).toThrow(`Scene field ${PATH}: expected a number`);
    });

    test("an uncapped number keeps Infinity as its no-cap value", () => {
        expect(encode(field.uncapped, Number.POSITIVE_INFINITY)).toBe("Infinity");
        expect(decode(field.uncapped, "Infinity")).toBe(Number.POSITIVE_INFINITY);
        expect(encode(field.uncapped, 30)).toBe(30);
    });

    test("lists save as arrays and name the failing element", () => {
        expect(encode(field.numbers, [1, -0, Number.NaN])).toEqual([1, 0, "NaN"]);
        expect(decode(field.numbers, [1, 2])).toEqual([1, 2]);
        expect(encode(field.numbers, [])).toEqual([]);
        expect(() => encode(field.numbers, new Float32Array(2))).toThrow(`Scene field ${PATH}: expected an array`);
        expect(() => decode(field.numbers, {length: 1})).toThrow(`Scene field ${PATH}: expected an array`);
        expect(() => decode(field.numbers, [1, "x"])).toThrow(`Scene field ${PATH}[1]: expected a number`);
    });

    test("lists of structs round-trip into created instances", () => {
        const first = new Range();
        first.max = 4;
        const encoded = encode(field.ranges, [first, new Range()]);
        expect(encoded).toEqual([{min: 0, max: 4}, {min: 0, max: 1}]);
        const decoded = decode(field.ranges, encoded) as Range[];
        expect(decoded.map(range => range instanceof Range)).toEqual([true, true]);
        expect(decoded.map(range => range.max)).toEqual([4, 1]);
        expect(() => decode(field.ranges, [{min: 0, max: "x"}])).toThrow(`Scene field ${PATH}[0].max: expected a number`);
    });

    test("a struct loads into its created value; missing keys keep the default", () => {
        const range = new Range();
        range.min = -1;
        expect(encode(field.range, range)).toEqual({min: -1, max: 1});
        const decoded = decode(field.range, {max: 9}) as Range;
        expect(decoded).toBeInstanceOf(Range);
        expect([decoded.min, decoded.max]).toEqual([0, 9]);
        const plain = decode(field.plainRange, {min: 2}) as Record<string, unknown>;
        expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
        expect(plain).toEqual({min: 2, max: 0});
        expect(() => encode(field.range, null)).toThrow(`Scene field ${PATH}: expected an object holding Range's fields, got null`);
        expect(() => encode(field.range, {min: 1})).toThrow(`Scene field ${PATH}.max: expected a number, got nothing`);
    });

    test("unknown struct keys throw by default and are reported when the context reports schema changes", () => {
        expect(() => decode(field.range, {min: 1, mn: 2, mx: 3})).toThrow(`Scene field ${PATH}: Range has no fields "mn", "mx"`);
        expect(() => decode(field.plainRange, {extra: 1})).toThrow(`Scene field ${PATH}: the struct has no field "extra"`);
        const changes: unknown[] = [];
        const context: FieldDecodeContext = {
            ...decodeContext(),
            reportSchemaChange: (typeName, addedKeys, removedKeys) => changes.push({typeName, addedKeys, removedKeys}),
        };
        const decoded = decodeFieldValue(field.range, {min: 3, old: 1}, context, PATH) as Range;
        expect(decoded.min).toBe(3);
        expect(changes).toEqual([{typeName: "Range", addedKeys: ["max"], removedKeys: ["old"]}]);
    });

    test("a custom field type encodes through its registered codec", () => {
        const registry = registryWithCurve();
        expect(encode(field.curve, new Curve([0, 0.5, 1]), registry)).toBe("0 0.5 1");
        const decoded = decode(field.curve, "0 2", registry) as Curve;
        expect(decoded).toBeInstanceOf(Curve);
        expect(decoded.keys).toEqual([0, 2]);
        expect(() => decode(field.curve, 3, registry)).toThrow(`${PATH}: a curve is a string of keys`);
        expect(() => encode(field.curve, new Curve())).toThrow(`Scene field ${PATH}: the custom field type "Curve" is not registered`);
    });

    test("a prefab asset saves its path and loads through the asset loader", () => {
        const requested: string[] = [];
        const prefab = new PrefabAsset(PREFAB_PATH, EMPTY_PREFAB);
        expect(encode(field.prefab, prefab)).toEqual({path: PREFAB_PATH});
        expect(encode(field.prefab, undefined)).toBe(null);
        expect(() => encode(field.prefab, {path: PREFAB_PATH})).toThrow(`Scene field ${PATH}: expected a PrefabAsset or undefined`);
        const loaded = decodeFieldValue(field.prefab, {path: PREFAB_PATH}, decodeContext(undefined, prefabLoader(requested)), PATH);
        expect(loaded).toBeInstanceOf(PrefabAsset);
        expect(requested).toEqual([PREFAB_PATH]);
        expect(decode(field.prefab, null)).toBeUndefined();
        expect(() => decode({kind: "asset", assetType: "Sound"}, {path: "a.wav"})).toThrow(`Scene field ${PATH}: the asset type "Sound" is not registered`);
    });

    test("entities inside lists map through the context like top-level ones", () => {
        expect(encode(field.entities, [KNOWN_ENTITY, NULL_ENTITY])).toEqual([KNOWN_SCENE_ID, null]);
        expect(decode(field.entities, [KNOWN_SCENE_ID, null])).toEqual([KNOWN_ENTITY, NULL_ENTITY]);
        expect(() => decode(field.entities, ["2"])).toThrow(`Scene field ${PATH}[0]: expected an entity id`);
    });
});

describe("defaultFieldValue", () => {
    test("every kind has a default that its codec accepts", () => {
        const registry = registryWithCurve();
        const types: FieldType[] = [
            {kind: "number"}, {kind: "integer"}, field.nullableNumber, field.nullableInteger, {kind: "boolean"}, {kind: "string", nullable: false},
            {kind: "string", nullable: true}, {kind: "textLines"}, {kind: "vec2"}, {kind: "vec3"}, {kind: "rotation"}, {kind: "rgb"}, {kind: "textColor"},
            {kind: "enum", members: [{name: "Low", value: 1}, {name: "High", value: 2}]}, {kind: "entity", nullable: true}, field.prefab,
            field.numbers, field.range, field.plainRange, field.curve,
        ];
        for (const type of types) expect(() => encode(type, defaultFieldValue(type, registry), registry)).not.toThrow();
    });

    test("defaults are fresh, neutral values", () => {
        const registry = registryWithCurve();
        expect(defaultFieldValue({kind: "number"})).toBe(0);
        expect(defaultFieldValue(field.nullableNumber)).toBeUndefined();
        expect(defaultFieldValue({kind: "string", nullable: false})).toBe("");
        expect(Array.from(defaultFieldValue({kind: "rotation"}) as Float32Array)).toEqual([0, 0, 0, 1]);
        expect(defaultFieldValue({kind: "textColor"})).toBe(TextColor.DEFAULT);
        expect(defaultFieldValue({kind: "enum", members: [{name: "Low", value: 1}]})).toBe(1);
        expect(defaultFieldValue({kind: "entity", nullable: false})).toBe(NULL_ENTITY);
        expect(defaultFieldValue(field.numbers)).not.toBe(defaultFieldValue(field.numbers));
        expect(defaultFieldValue(field.range)).toBeInstanceOf(Range);
        expect(createStructValue(field.plainRange)).toEqual({min: 0, max: 0});
        expect(defaultFieldValue(field.curve, registry)).toBeInstanceOf(Curve);
        expect(() => defaultFieldValue(field.curve)).toThrow(`the custom field type "Curve" is not registered`);
    });
});
