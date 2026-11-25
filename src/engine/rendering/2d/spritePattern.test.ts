import {describe, expect, test} from "../../testing/harness";
import {MemoryPlatform} from "../../testing/memoryPlatform";
import type {MemoryFileSource} from "../../testing/memoryPlatform";
import {platformSceneAssetLoader} from "../../scene/sceneAssets";
import {SpriteImage} from "./spriteImage";
import {SPRITE_IMAGE_ASSET_TYPE} from "./spriteImageAssetType";
import {SpritePatternColor, spritePatternImage} from "./spritePattern";
import {
    parseSpritePatternFile,
    SPRITE_PATTERN_FILE_FORMAT,
    SPRITE_PATTERN_FILE_SUFFIX,
    SPRITE_PATTERN_FILE_VERSION,
    spritePatternFileJson,
    spritePatternFileText,
} from "./spritePatternFile";

const SHIP_ROWS = ["  #  ", " #o# ", "#####", "#   #"];
const HULL_RGB = 0x40E0FF;
const COCKPIT_RGB = 0xFFFFFF;
const BULLET_RGB = 0xFFFF80;
const OTHER_RGB = 0x102030;
const PATTERN_PATH = "sprites/ship.pattern.json";
const NEWER_VERSION = SPRITE_PATTERN_FILE_VERSION + 1;

function colors(...entries: readonly [string, number][]): SpritePatternColor[] {
    return entries.map(([char, rgb]) => new SpritePatternColor(char, rgb));
}

function patternFile(fields: object): string {
    return JSON.stringify({format: SPRITE_PATTERN_FILE_FORMAT, version: SPRITE_PATTERN_FILE_VERSION, ...fields});
}

const SHIP_FILE_TEXT = patternFile({rows: SHIP_ROWS, palette: [{char: "#", rgb: "#40e0ff"}, {char: "o", rgb: "#ffffff"}]});

describe("sprite patterns", () => {
    test("a pattern image has the same pixels as fromPattern and solid", () => {
        const image = spritePatternImage(SHIP_ROWS, colors(["#", HULL_RGB], ["o", COCKPIT_RGB]));
        const expected = SpriteImage.fromPattern(SHIP_ROWS, {"#": HULL_RGB, "o": COCKPIT_RGB});
        expect([image.sizeX, image.sizeY]).toEqual([expected.sizeX, expected.sizeY]);
        expect([...image.rgba]).toEqual([...expected.rgba]);
        expect([...spritePatternImage(["#"], colors(["#", BULLET_RGB])).rgba]).toEqual([...SpriteImage.solid(1, 1, BULLET_RGB).rgba]);
    });

    test("the first colour of a repeated character wins and unlisted characters stay transparent", () => {
        const image = spritePatternImage(["#x"], colors(["#", BULLET_RGB], ["#", OTHER_RGB]));
        expect([...image.rgba]).toEqual([...SpriteImage.fromPattern(["#x"], {"#": BULLET_RGB}).rgba]);
    });

    test("a pattern image keeps a frozen copy of its rows and palette, and images made from pixels have no pattern", () => {
        const rows = ["#o"];
        const palette = colors(["#", HULL_RGB], ["o", COCKPIT_RGB]);
        const image = spritePatternImage(rows, palette);
        rows[0] = "oo";
        palette[0].rgb = OTHER_RGB;
        expect(image.pattern?.rows).toEqual(["#o"]);
        expect(image.pattern?.palette).toEqual([{char: "#", rgb: HULL_RGB}, {char: "o", rgb: COCKPIT_RGB}]);
        const pattern = image.pattern!;
        expect([Object.isFrozen(pattern), Object.isFrozen(pattern.rows), Object.isFrozen(pattern.palette), Object.isFrozen(pattern.palette[0])]).toEqual([true, true, true, true]);
        expect(image.sourcePath).toBeUndefined();
        expect(SpriteImage.fromPattern(["#"], {"#": BULLET_RGB}).pattern).toBeUndefined();
        expect(SpriteImage.solid(1, 1, BULLET_RGB).pattern).toBeUndefined();
    });
});

describe("sprite pattern files", () => {
    test("a jsengine-sprite-pattern document gives its rows and palette", () => {
        const pattern = parseSpritePatternFile(SHIP_FILE_TEXT, PATTERN_PATH);
        expect(pattern.rows).toEqual(SHIP_ROWS);
        expect(pattern.palette).toEqual(colors(["#", HULL_RGB], ["o", COCKPIT_RGB]));
        expect(parseSpritePatternFile(patternFile({rows: [], palette: []})).rows).toEqual([]);
    });

    test("a pattern written as a file reads back to the same rows and palette", () => {
        const pattern = parseSpritePatternFile(SHIP_FILE_TEXT, PATTERN_PATH);
        const text = spritePatternFileText(spritePatternFileJson(pattern));
        expect(JSON.parse(text)).toEqual(JSON.parse(SHIP_FILE_TEXT));
        expect(text.endsWith("}\n")).toBe(true);
        expect(parseSpritePatternFile(text, PATTERN_PATH)).toEqual(pattern);
    });

    test("a malformed pattern file throws naming the file and the key at fault", () => {
        const label = `Sprite pattern "${PATTERN_PATH}"`;
        const failure = (source: unknown) => () => parseSpritePatternFile(source, PATTERN_PATH);
        expect(failure("{")).toThrow(`${label} is not valid JSON`);
        expect(failure("[]")).toThrow(`${label}: the document must be an object, got []`);
        expect(failure(JSON.stringify({format: "jsengine-scene", version: 1}))).toThrow(`${label}: format must be "${SPRITE_PATTERN_FILE_FORMAT}", got "jsengine-scene"`);
        expect(failure(JSON.stringify({format: SPRITE_PATTERN_FILE_FORMAT, version: "1"}))).toThrow(`${label}: version must be a whole number, got "1"`);
        expect(failure(JSON.stringify({format: SPRITE_PATTERN_FILE_FORMAT, version: NEWER_VERSION, rows: [], palette: []})))
            .toThrow(`${label}: version ${NEWER_VERSION} is newer than the supported version ${SPRITE_PATTERN_FILE_VERSION}`);
        expect(failure(patternFile({rows: "#", palette: []}))).toThrow(`${label}: rows must be an array of strings, got "#"`);
        expect(failure(patternFile({rows: ["#"]}))).toThrow(`${label}: palette must be an array, got nothing`);
        expect(failure(patternFile({rows: ["#"], palette: [{char: "#", rgb: "#ffffff"}, {char: "o", rgb: "white"}]})))
            .toThrow(`${label}: palette[1].rgb must be a "#rrggbb" colour, got "white"`);
        expect(failure(patternFile({rows: ["#"], palette: [{rgb: "#ffffff"}]}))).toThrow(`${label}: palette[0].char must be a string, got nothing`);
    });

    test("the spriteImage asset type loads a pattern file through the scene asset loader once per path and remembers the path", () => {
        const platform = new MemoryPlatform({files: {[PATTERN_PATH]: SHIP_FILE_TEXT}});
        const loader = platformSceneAssetLoader({files: platform.files, inflate: platform.inflate});
        expect(SPRITE_IMAGE_ASSET_TYPE.fileSuffixes.includes(SPRITE_PATTERN_FILE_SUFFIX)).toBe(true);
        const image = SPRITE_IMAGE_ASSET_TYPE.load(PATTERN_PATH, loader);
        expect([image.sourcePath, image.sizeX, image.sizeY]).toEqual([PATTERN_PATH, SHIP_ROWS[0].length, SHIP_ROWS.length]);
        expect(image.pattern?.rows).toEqual(SHIP_ROWS);
        expect([...image.rgba]).toEqual([...SpriteImage.fromPattern(SHIP_ROWS, {"#": HULL_RGB, "o": COCKPIT_RGB}).rgba]);
        (platform.files as MemoryFileSource).set(PATTERN_PATH, patternFile({rows: ["#"], palette: []}));
        expect(SPRITE_IMAGE_ASSET_TYPE.load(PATTERN_PATH, loader)).toBe(image);
        const fresh = SPRITE_IMAGE_ASSET_TYPE.load(PATTERN_PATH, platformSceneAssetLoader({files: platform.files, inflate: platform.inflate}));
        expect(fresh.pattern?.rows).toEqual(["#"]);
        expect(SPRITE_IMAGE_ASSET_TYPE.pathOf(image)).toBe(PATTERN_PATH);
    });
});
