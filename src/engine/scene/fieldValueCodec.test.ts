import {describe, expect, test} from "../testing/harness";
import {makeEntityHandle, NULL_ENTITY} from "../core/entity";
import {Vec, Vec3, Vec4} from "../math/types/vec";
import {TextColor} from "../rendering/textColor";
import {FaceCulling} from "../rendering/3d/faceCulling";
import {Mesh} from "../rendering/3d/mesh";
import {SpriteImage} from "../rendering/2d/spriteImage";
import {decodeFieldValue, encodeFieldValue} from "./fieldValueCodec";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import type {FieldSchema} from "./fieldSchema";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneJsonValue} from "./sceneDocument";
import {decodeBase64, encodeBase64} from "./base64";

const PATH = "entities[2].components.Thing.value";
const TRIANGLE_OBJ = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const KNOWN_ENTITY = makeEntityHandle(5, 1);
const UNKNOWN_ENTITY = makeEntityHandle(6, 1);
const KNOWN_SCENE_ID = 3;
const UNKNOWN_SCENE_ID = 99;
const LONGEST_BASE64_TEST_LENGTH = 10;
const BYTE_VALUES = 256;

const field = {
    number: {key: "value", kind: "number"},
    integer: {key: "value", kind: "integer"},
    boolean: {key: "value", kind: "boolean"},
    string: {key: "value", kind: "string", nullable: false},
    nullableString: {key: "value", kind: "string", nullable: true},
    textLines: {key: "value", kind: "textLines"},
    vec3: {key: "value", kind: "vec3"},
    rotation: {key: "value", kind: "rotation"},
    rgb: {key: "value", kind: "rgb"},
    textColor: {key: "value", kind: "textColor"},
    faceCulling: {key: "value", kind: "enum", members: [
        {name: "BackFaces", value: FaceCulling.BackFaces},
        {name: "FrontFaces", value: FaceCulling.FrontFaces},
        {name: "None", value: FaceCulling.None},
    ]},
    entity: {key: "value", kind: "entity", nullable: true},
    mesh: {key: "value", kind: "mesh"},
    spriteImage: {key: "value", kind: "spriteImage"},
} satisfies Record<string, FieldSchema>;

interface EncodeRecorder {
    readonly context: FieldEncodeContext;
    readonly dangling: string[];
    readonly unsaved: string[];
}

function encodeRecorder(): EncodeRecorder {
    const dangling: string[] = [];
    const unsaved: string[] = [];
    const context: FieldEncodeContext = {
        sceneIdOf: entity => entity === KNOWN_ENTITY ? KNOWN_SCENE_ID : undefined,
        reportDanglingEntity: path => dangling.push(path),
        reportUnsavedAsset: path => unsaved.push(path),
    };
    return {context, dangling, unsaved};
}

interface DecodeRecorder {
    readonly context: FieldDecodeContext;
    readonly dangling: string[];
}

function decodeRecorder(assets?: SceneAssetLoader): DecodeRecorder {
    const dangling: string[] = [];
    const context: FieldDecodeContext = {
        entityOf: sceneId => sceneId === KNOWN_SCENE_ID ? KNOWN_ENTITY : undefined,
        reportDanglingEntity: path => dangling.push(path),
        assets,
        inlineSpriteImages: new Map(),
    };
    return {context, dangling};
}

function encode(schema: FieldSchema, value: unknown): SceneJsonValue {
    return encodeFieldValue(schema, value, encodeRecorder().context, PATH);
}

function decode(schema: FieldSchema, json: SceneJsonValue): unknown {
    return decodeFieldValue(schema, json, decodeRecorder().context, PATH);
}

function floats(value: unknown): number[] {
    return Array.from(value as Float32Array);
}

function meshFrom(sourcePath: string | undefined): Mesh {
    const parsed = Mesh.parseObj(TRIANGLE_OBJ);
    return new Mesh({data: parsed.data.raw, vertCount: parsed.vertCount, triangleCount: parsed.triangleCount, materials: parsed.materials, vertexMaterial: parsed.vertexMaterial}, sourcePath);
}

describe("field value codec", () => {
    test("number: finite values as numbers, non-finite values as strings, -0 as 0", () => {
        expect(encode(field.number, 1.5)).toBe(1.5);
        expect(encode(field.number, Number.NaN)).toBe("NaN");
        expect(encode(field.number, Number.POSITIVE_INFINITY)).toBe("Infinity");
        expect(encode(field.number, Number.NEGATIVE_INFINITY)).toBe("-Infinity");
        expect(Object.is(encode(field.number, -0), 0)).toBe(true);
        expect(decode(field.number, 1.5)).toBe(1.5);
        expect(Number.isNaN(decode(field.number, "NaN") as number)).toBe(true);
        expect(decode(field.number, "Infinity")).toBe(Number.POSITIVE_INFINITY);
        expect(decode(field.number, "-Infinity")).toBe(Number.NEGATIVE_INFINITY);
    });

    test("number errors name the field path", () => {
        expect(() => decode(field.number, "fast")).toThrow(`Scene field ${PATH}: expected a number, "NaN", "Infinity" or "-Infinity", got "fast"`);
        expect(() => encode(field.number, "fast")).toThrow(`Scene field ${PATH}: expected a number`);
    });

    test("integer", () => {
        expect(encode(field.integer, 7)).toBe(7);
        expect(decode(field.integer, 7)).toBe(7);
        expect(() => encode(field.integer, 7.5)).toThrow(`${PATH}: expected a whole number, got 7.5`);
        expect(() => decode(field.integer, "Infinity")).toThrow(`${PATH}: expected a whole number`);
    });

    test("boolean", () => {
        expect(encode(field.boolean, false)).toBe(false);
        expect(decode(field.boolean, true)).toBe(true);
        expect(() => decode(field.boolean, "yes")).toThrow(`${PATH}: expected true or false, got "yes"`);
    });

    test("string, and nullable string as null", () => {
        expect(encode(field.string, "#")).toBe("#");
        expect(decode(field.string, "#")).toBe("#");
        expect(() => decode(field.string, null)).toThrow(`${PATH}: expected a string, got null`);
        expect(encode(field.nullableString, undefined)).toBe(null);
        expect(decode(field.nullableString, null)).toBeUndefined();
        expect(() => encode(field.string, undefined)).toThrow(`${PATH}: expected a string`);
    });

    test("textLines are copied both ways", () => {
        const lines = ["ab", "cd"];
        const encoded = encode(field.textLines, lines);
        expect(encoded).toEqual(lines);
        expect(encoded === lines).toBe(false);
        expect(decode(field.textLines, ["x"])).toEqual(["x"]);
        expect(() => decode(field.textLines, ["x", 1])).toThrow(`${PATH}: expected an array of strings`);
    });

    test("vec3 with non-finite elements, and element errors named by index", () => {
        expect(encode(field.vec3, Vec3.alloc(1, Number.NaN, Number.NEGATIVE_INFINITY))).toEqual([1, "NaN", "-Infinity"]);
        const decoded = decode(field.vec3, [0.25, "Infinity", -2]);
        expect(decoded).toBeInstanceOf(Float32Array);
        expect(floats(decoded)).toEqual([0.25, Number.POSITIVE_INFINITY, -2]);
        expect(() => decode(field.vec3, [1, 2])).toThrow(`${PATH}: expected an array of 3 numbers, got [1,2]`);
        expect(() => decode(field.vec3, [1, "x", 3])).toThrow(`Scene field ${PATH}[1]: expected a number`);
        expect(() => encode(field.vec3, Vec4.alloc())).toThrow(`${PATH}: expected 3 numbers`);
    });

    test("rotation keeps the quaternion exactly, normalized or not", () => {
        const q = Vec4.alloc(0, 0, 0.6, 0.8);
        expect(encode(field.rotation, q)).toEqual([0, 0, Vec.z(q), Vec.w(q)]);
        expect(floats(decode(field.rotation, [0, 0, 2, 0]))).toEqual([0, 0, 2, 0]);
        expect(() => decode(field.rotation, [0, 0, 1])).toThrow(`${PATH}: expected an array of 4 numbers`);
    });

    test("rgb as #rrggbb", () => {
        expect(encode(field.rgb, 0x12ABEF)).toBe("#12abef");
        expect(encode(field.rgb, 0x000001)).toBe("#000001");
        expect(decode(field.rgb, "#12ABEF")).toBe(0x12ABEF);
        expect(() => decode(field.rgb, "red")).toThrow(`${PATH}: expected a "#rrggbb" colour, got "red"`);
        expect(() => decode(field.rgb, "#12abeg")).toThrow(`${PATH}: expected a "#rrggbb" colour`);
        expect(() => encode(field.rgb, 0x1000000)).toThrow(`${PATH}: expected a packed 0xRRGGBB colour`);
    });

    test("textColor as default, palette index or #rrggbb", () => {
        expect(encode(field.textColor, TextColor.DEFAULT)).toBe("default");
        expect(encode(field.textColor, TextColor.BRIGHT_RED)).toEqual({palette: 9});
        expect(encode(field.textColor, TextColor.rgb(1, 2, 3))).toBe("#010203");
        expect(decode(field.textColor, "default")).toBe(TextColor.DEFAULT);
        expect(decode(field.textColor, {palette: 9})).toBe(TextColor.BRIGHT_RED);
        expect(decode(field.textColor, "#010203")).toBe(TextColor.rgb(1, 2, 3));
        expect(() => decode(field.textColor, {palette: 300})).toThrow(`Scene field ${PATH}.palette: expected a whole number in [0, 255], got 300`);
        expect(() => decode(field.textColor, "blue")).toThrow(`${PATH}: expected "default", {"palette": n} or "#rrggbb"`);
        expect(() => encode(field.textColor, -1)).toThrow(`${PATH}: expected a TextColor`);
    });

    test("enum by member name", () => {
        expect(encode(field.faceCulling, FaceCulling.None)).toBe("None");
        expect(decode(field.faceCulling, "FrontFaces")).toBe(FaceCulling.FrontFaces);
        expect(() => decode(field.faceCulling, "Sideways")).toThrow(`${PATH}: expected one of "BackFaces", "FrontFaces", "None", got "Sideways"`);
        expect(() => encode(field.faceCulling, 7)).toThrow(`${PATH}: expected one of 0, 1, 2, got 7`);
    });

    test("entity: null for none, scene ids both ways, dangling references reported as null", () => {
        const recorder = encodeRecorder();
        expect(encodeFieldValue(field.entity, NULL_ENTITY, recorder.context, PATH)).toBe(null);
        expect(encodeFieldValue(field.entity, KNOWN_ENTITY, recorder.context, PATH)).toBe(KNOWN_SCENE_ID);
        expect(encodeFieldValue(field.entity, UNKNOWN_ENTITY, recorder.context, PATH)).toBe(null);
        expect(recorder.dangling).toEqual([PATH]);

        const decoder = decodeRecorder();
        expect(decodeFieldValue(field.entity, null, decoder.context, PATH)).toBe(NULL_ENTITY);
        expect(decodeFieldValue(field.entity, KNOWN_SCENE_ID, decoder.context, PATH)).toBe(KNOWN_ENTITY);
        expect(decodeFieldValue(field.entity, UNKNOWN_SCENE_ID, decoder.context, PATH)).toBe(NULL_ENTITY);
        expect(decoder.dangling).toEqual([PATH]);
        expect(() => decode(field.entity, 0)).toThrow(`${PATH}: expected an entity id (a whole number >= 1) or null, got 0`);
        expect(() => decode(field.entity, "3")).toThrow(`${PATH}: expected an entity id`);
    });

    test("mesh by path; a mesh without one is reported unsaved and saved as null", () => {
        const recorder = encodeRecorder();
        expect(encodeFieldValue(field.mesh, undefined, recorder.context, PATH)).toBe(null);
        expect(encodeFieldValue(field.mesh, meshFrom("models/tri.obj"), recorder.context, PATH)).toEqual({path: "models/tri.obj"});
        expect(encodeFieldValue(field.mesh, meshFrom(undefined), recorder.context, PATH)).toBe(null);
        expect(recorder.unsaved).toEqual([PATH]);
        expect(() => encode(field.mesh, "models/tri.obj")).toThrow(`${PATH}: expected a Mesh or undefined`);

        const loaded = meshFrom("models/tri.obj");
        const requested: string[] = [];
        const assets: SceneAssetLoader = {
            loadMesh: path => {
                requested.push(path);
                return loaded;
            },
            loadSpriteImage: path => {
                throw new Error(`no image ${path}`);
            },
        };
        expect(decodeFieldValue(field.mesh, {path: "models/tri.obj"}, decodeRecorder(assets).context, PATH)).toBe(loaded);
        expect(requested).toEqual(["models/tri.obj"]);
        expect(decode(field.mesh, null)).toBeUndefined();
        expect(() => decode(field.mesh, {path: "models/tri.obj"})).toThrow(`Scene field ${PATH}: loading "models/tri.obj" needs an asset loader`);
        expect(() => decode(field.mesh, {path: ""})).toThrow(`Scene field ${PATH}.path: expected a non-empty file path`);
        expect(() => decodeFieldValue(field.spriteImage, {path: "a.png"}, decodeRecorder(assets).context, PATH)).toThrow(`Scene field ${PATH}: could not load "a.png": no image a.png`);
    });

    test("spriteImage inline as base64 RGBA, or by path", () => {
        const image = SpriteImage.fromPixels(2, 1, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]));
        const encoded = encode(field.spriteImage, image);
        expect(encoded).toEqual({width: 2, height: 1, rgbaBase64: encodeBase64(image.rgba)});
        const decoder = decodeRecorder();
        const decoded = decodeFieldValue(field.spriteImage, encoded, decoder.context, PATH) as SpriteImage;
        expect(decoded.sizeX).toBe(2);
        expect(decoded.sizeY).toBe(1);
        expect(Array.from(decoded.rgba)).toEqual(Array.from(image.rgba));
        expect(decoded.sourcePath).toBeUndefined();
        expect(decodeFieldValue(field.spriteImage, encoded, decoder.context, PATH)).toBe(decoded);
        expect(encode(field.spriteImage, undefined)).toBe(null);
        expect(decode(field.spriteImage, null)).toBeUndefined();
    });

    test("spriteImage errors name the field path", () => {
        expect(() => decode(field.spriteImage, {width: 2, height: 2, rgbaBase64: encodeBase64(new Uint8Array(4))})).toThrow(`Scene field ${PATH}.rgbaBase64: expected 16 bytes for 2x2, got 4`);
        expect(() => decode(field.spriteImage, {width: 1, height: 1, rgbaBase64: "AA!A"})).toThrow(`Scene field ${PATH}.rgbaBase64: base64 text has an invalid character "!"`);
        expect(() => decode(field.spriteImage, {width: -1, height: 1, rgbaBase64: ""})).toThrow(`Scene field ${PATH}.width: expected a whole number >= 0`);
        expect(() => decode(field.spriteImage, {pixels: []})).toThrow(`Scene field ${PATH}: expected {"path": "<file>"}`);
    });

    test("base64 round-trips every length and byte value", () => {
        for (let length = 0; length <= LONGEST_BASE64_TEST_LENGTH; length++) {
            const bytes = new Uint8Array(length).map((_, i) => (i * 97 + length * 13) % BYTE_VALUES);
            expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
        }
        const everyByte = new Uint8Array(BYTE_VALUES).map((_, i) => i);
        expect(Array.from(decodeBase64(encodeBase64(everyByte)))).toEqual(Array.from(everyByte));
        expect(encodeBase64(new Uint8Array([0xFB, 0xFF]))).toBe("+/8=");
        expect(() => decodeBase64("abc")).toThrow("multiple of 4");
    });
});
