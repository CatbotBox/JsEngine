import {describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import {decodeFieldValue, encodeFieldValue} from "../../engine/scene";
import type {FieldDecodeContext, FieldEncodeContext, PlainFieldSchema, SceneJsonValue} from "../../engine/scene";
import {
    assetText,
    entityLabel,
    entityOptionValue,
    eulerDegreesOfQuaternion,
    eulerDegreeText,
    float32Text,
    isInlineAssetSummary,
    numberOfWire,
    numberText,
    parseAssetPathText,
    parseEntityOptionValue,
    parseEulerDegreeTexts,
    parseIntegerText,
    parseNumberText,
    parseRgbText,
    parseStringText,
    parseTextColorParts,
    parseTextLinesText,
    quaternionOfEulerDegrees,
    rgbText,
    stringText,
    textColorParts,
    textForTextColorMode,
    textLinesText,
    vec3Texts,
    vec3WithComponentText,
    wireNumber,
} from "./fieldValueText";
import type {ParsedFieldText} from "./fieldValueText";

const QUARTER_TURN_DEGREES = 90;
const HALF_SQRT_TWO = Math.SQRT1_2;
const ANGLE_DIGITS = 3;
const QUATERNION_DIGITS = 5;
const NULLABLE = {nullable: true};
const NOT_NULLABLE = {nullable: false};
const NUMBER_FIELD: PlainFieldSchema = {key: "value", kind: "number"};
const ROTATION_FIELD: PlainFieldSchema = {key: "xyzw", kind: "rotation"};
const CODEC_PATH = "test";
const CODEC_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, -0, 0];

function ignore(): void {
}

const CODEC_ENCODE: FieldEncodeContext = {sceneIdOf: () => undefined, reportDanglingEntity: ignore, reportUnsavedAsset: ignore};
const CODEC_DECODE: FieldDecodeContext = {entityOf: () => undefined, reportDanglingEntity: ignore};

function codecWire(field: PlainFieldSchema, value: unknown): SceneJsonValue {
    return encodeFieldValue(field, value, CODEC_ENCODE, CODEC_PATH);
}

function valueOf(parsed: ParsedFieldText): SceneJsonValue | undefined {
    return parsed.valid ? parsed.value : undefined;
}

describe("fieldValueText agrees with the scene codec", () => {
    test("wire numbers and their parsed spellings are what the codec writes", () => {
        for (const value of CODEC_NUMBERS) {
            const wire = codecWire(NUMBER_FIELD, value);
            expect(wireNumber(value)).toEqual(wire);
            expect(valueOf(parseNumberText(numberText(wire)))).toEqual(wire);
            expect(Object.is(numberOfWire(wire), value + 0)).toBe(true);
        }
    });

    test("a quaternion made from Euler degrees is a rotation the codec decodes and re-encodes unchanged", () => {
        const wire = quaternionOfEulerDegrees([10, -20, 135]);
        expect(codecWire(ROTATION_FIELD, decodeFieldValue(ROTATION_FIELD, wire, CODEC_DECODE, CODEC_PATH))).toEqual(wire);
    });
});

describe("fieldValueText numbers", () => {
    test("number text shows wire numbers and the codec's non-finite spellings as they are", () => {
        expect(numberText(1.5)).toBe("1.5");
        expect(numberText("NaN")).toBe("NaN");
        expect(numberText("-Infinity")).toBe("-Infinity");
    });

    test("parses finite numbers and the codec's non-finite spellings, rejects the rest", () => {
        expect(valueOf(parseNumberText(" 2.5 "))).toBe(2.5);
        expect(valueOf(parseNumberText("-0"))).toBe(0);
        expect(valueOf(parseNumberText("1e3"))).toBe(1000);
        expect(valueOf(parseNumberText("NaN"))).toBe("NaN");
        expect(valueOf(parseNumberText("Infinity"))).toBe("Infinity");
        expect(valueOf(parseNumberText("-Infinity"))).toBe("-Infinity");
        expect(parseNumberText("").valid).toBe(false);
        expect(parseNumberText("   ").valid).toBe(false);
        expect(parseNumberText("abc").valid).toBe(false);
        expect(parseNumberText("nan").valid).toBe(false);
        expect(parseNumberText("1e400").valid).toBe(false);
    });

    test("integers must be whole and finite", () => {
        expect(valueOf(parseIntegerText("42"))).toBe(42);
        expect(parseIntegerText("4.2").valid).toBe(false);
        expect(parseIntegerText("Infinity").valid).toBe(false);
        expect(parseIntegerText("").valid).toBe(false);
    });

    test("float32 text is the shortest decimal that rounds to the same float32, other numbers print exactly", () => {
        expect(float32Text(Math.fround(0.1))).toBe("0.1");
        expect(float32Text(Math.fround(1 / 3))).toBe("0.33333334");
        expect(float32Text(1)).toBe("1");
        expect(float32Text(0)).toBe("0");
        expect(float32Text(0.1)).toBe("0.1");
        expect(float32Text(0.1 + 0.2)).toBe(String(0.1 + 0.2));
    });
});

describe("fieldValueText vec3 and rotation", () => {
    test("vec3 texts round float32 components and keep non-finite spellings", () => {
        expect(vec3Texts([Math.fround(0.1), "NaN", -2])).toEqual(["0.1", "NaN", "-2"]);
    });

    test("editing one vec3 component keeps the others as the wire has them", () => {
        expect(valueOf(vec3WithComponentText([1, Math.fround(0.1), "Infinity"], 1, "7"))).toEqual([1, 7, "Infinity"]);
        expect(vec3WithComponentText([1, 2, 3], 0, "x").valid).toBe(false);
        expect(vec3WithComponentText(null, 0, "1").valid).toBe(false);
    });

    test("the identity quaternion is zero Euler degrees", () => {
        expect(eulerDegreesOfQuaternion([0, 0, 0, 1])).toEqual([0, 0, 0]);
    });

    test("an unreadable quaternion shows as NaN degrees instead of throwing", () => {
        expect(eulerDegreesOfQuaternion([0, 0, 1]).every(Number.isNaN)).toBe(true);
        expect(eulerDegreesOfQuaternion([0, "x", 0, 1]).every(Number.isNaN)).toBe(true);
        expect(eulerDegreesOfQuaternion(["NaN", 0, 0, 1]).every(Number.isNaN)).toBe(true);
    });

    test("Euler degrees convert to a quaternion and back", () => {
        const yawQuarterTurn = quaternionOfEulerDegrees([0, 0, QUARTER_TURN_DEGREES]) as number[];
        expect(yawQuarterTurn[0]).toBeCloseTo(0, QUATERNION_DIGITS);
        expect(yawQuarterTurn[1]).toBeCloseTo(0, QUATERNION_DIGITS);
        expect(yawQuarterTurn[2]).toBeCloseTo(HALF_SQRT_TWO, QUATERNION_DIGITS);
        expect(yawQuarterTurn[3]).toBeCloseTo(HALF_SQRT_TWO, QUATERNION_DIGITS);
        const [x, y, z] = eulerDegreesOfQuaternion(quaternionOfEulerDegrees([10, 20, 30]));
        expect(x).toBeCloseTo(10, ANGLE_DIGITS);
        expect(y).toBeCloseTo(20, ANGLE_DIGITS);
        expect(z).toBeCloseTo(30, ANGLE_DIGITS);
    });

    test("Euler degree text hides float32 noise and negative zero", () => {
        expect(eulerDegreeText(29.999998)).toBe("30");
        expect(eulerDegreeText(-0.0000001)).toBe("0");
        expect(eulerDegreeText(12.3456)).toBe("12.346");
        expect(eulerDegreeText(Number.NaN)).toBe("NaN");
    });

    test("Euler degree texts must be three finite numbers", () => {
        expect(parseEulerDegreeTexts(["1", " 2 ", "-3"])).toEqual({valid: true, degrees: [1, 2, -3]});
        expect(parseEulerDegreeTexts(["1", "NaN", "3"]).valid).toBe(false);
        expect(parseEulerDegreeTexts(["1", "", "3"]).valid).toBe(false);
        expect(parseEulerDegreeTexts(["1", "2"]).valid).toBe(false);
    });
});

describe("fieldValueText colours", () => {
    test("rgb text is a lowercase #rrggbb and parsing accepts it with or without the hash", () => {
        expect(rgbText("#AbCdEf")).toBe("#abcdef");
        expect(rgbText(null)).toBe("#000000");
        expect(valueOf(parseRgbText("#FF8000"))).toBe("#ff8000");
        expect(valueOf(parseRgbText("ff8000"))).toBe("#ff8000");
        expect(parseRgbText("#fff").valid).toBe(false);
        expect(parseRgbText("#gggggg").valid).toBe(false);
    });

    test("text colours split into a mode and a text and parse back to the wire form", () => {
        expect(textColorParts("default")).toEqual({mode: "default", text: ""});
        expect(textColorParts({palette: 12})).toEqual({mode: "palette", text: "12"});
        expect(textColorParts("#00FF00")).toEqual({mode: "rgb", text: "#00ff00"});
        expect(valueOf(parseTextColorParts({mode: "default", text: "ignored"}))).toBe("default");
        expect(valueOf(parseTextColorParts({mode: "palette", text: " 255 "}))).toEqual({palette: 255});
        expect(valueOf(parseTextColorParts({mode: "rgb", text: "#123456"}))).toBe("#123456");
        expect(parseTextColorParts({mode: "palette", text: "256"}).valid).toBe(false);
        expect(parseTextColorParts({mode: "palette", text: "-1"}).valid).toBe(false);
        expect(parseTextColorParts({mode: "palette", text: "1.5"}).valid).toBe(false);
        expect(parseTextColorParts({mode: "palette", text: ""}).valid).toBe(false);
        expect(parseTextColorParts({mode: "rgb", text: "red"}).valid).toBe(false);
    });

    test("switching the text colour mode keeps a text that fits the new mode and otherwise picks one that does", () => {
        expect(textForTextColorMode("default", "12")).toBe("");
        expect(textForTextColorMode("palette", "12")).toBe("12");
        expect(textForTextColorMode("palette", "#ff0000")).toBe("7");
        expect(textForTextColorMode("rgb", "#FF0000")).toBe("#ff0000");
        expect(textForTextColorMode("rgb", "12")).toBe("#ffffff");
        expect(parseTextColorParts({mode: "palette", text: textForTextColorMode("palette", "")}).valid).toBe(true);
    });
});

describe("fieldValueText strings, lines, entities and assets", () => {
    test("a nullable string shows null as empty and saves empty as null", () => {
        expect(stringText(null)).toBe("");
        expect(stringText("#")).toBe("#");
        expect(parseStringText("", NULLABLE)).toBe(null);
        expect(parseStringText("", NOT_NULLABLE)).toBe("");
        expect(parseStringText("x", NULLABLE)).toBe("x");
    });

    test("text lines join with newlines and split on either line ending, empty text being no lines", () => {
        expect(textLinesText(["ab", "", "c"])).toBe("ab\n\nc");
        expect(parseTextLinesText("ab\r\n\nc")).toEqual(["ab", "", "c"]);
        expect(parseTextLinesText("")).toEqual([]);
        expect(textLinesText([])).toBe("");
    });

    test("entity options use the handle as the value and empty for none", () => {
        expect(entityOptionValue(1048577)).toBe("1048577");
        expect(entityOptionValue(null)).toBe("");
        expect(parseEntityOptionValue("1048577")).toBe(1048577);
        expect(parseEntityOptionValue("")).toBe(null);
    });

    test("entity labels are the name, or the handle for an unnamed entity", () => {
        expect(entityLabel(7 as Entity, "camera")).toBe("camera");
        expect(entityLabel(7 as Entity, null)).toBe("Entity 7");
    });

    test("assets show their path, empty for none and a read-only size for inline images", () => {
        const inline = {inline: {width: 4, height: 2}};
        expect(isInlineAssetSummary(inline)).toBe(true);
        expect(isInlineAssetSummary({path: "a.png"})).toBe(false);
        expect(assetText(inline)).toBe("(inline 4x2)");
        expect(assetText({path: "demo/3d/cube.obj"})).toBe("demo/3d/cube.obj");
        expect(assetText(null)).toBe("");
        expect(parseAssetPathText("  demo/3d/cube.obj ")).toEqual({path: "demo/3d/cube.obj"});
        expect(parseAssetPathText("   ")).toBe(null);
    });
});
